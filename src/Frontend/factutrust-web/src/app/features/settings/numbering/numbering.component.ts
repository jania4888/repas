/// <reference types="@angular/localize" />
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Subject, takeUntil } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { NumberingService } from '@core/services/numbering.service';
import {
  BLOCK_TYPE_LABELS,
  DEFAULT_FREE_TEXT,
  DOCUMENT_TYPE_TABS,
  NumberingBlock,
  NumberingBlockType,
  NumberingDocumentType,
  NumberingScheme,
  PALETTE_BLOCKS,
  PaletteBlockTemplate,
  cloneBlock,
  findSchemeForType,
  getDefaultBlocksForType,
  getDocumentTypeForTabIndex
} from './models/numbering.models';
import { blockDisplayLabel, render, validateBlocks } from './numbering-format-renderer';
import { NumberingDocTabsComponent } from './components/numbering-doc-tabs.component';

@Component({
  selector: 'app-numbering',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    DragDropModule,
    ButtonModule,
    InputNumberModule,
    InputTextModule,
    ToastModule,
    TagModule,
    TooltipModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    NumberingDocTabsComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Numérotations" i18n-title="@@settings.numbering.numerotations.f8fd8b5e"
      [subtitle]="pageSubtitle()">
      <div class="header-actions">
        <p-button
          label="Retour" i18n-label="@@settings.numbering.retour.e5befb1f"
          icon="pi pi-arrow-left"
          [outlined]="true"
          routerLink="/settings">
        </p-button>
        @if (canUpdate()) {
          <p-button
            label="Réinitialiser" i18n-label="@@settings.numbering.reinitialiser.e0e2ad54"
            icon="pi pi-refresh"
            [outlined]="true"
            severity="secondary"
            (onClick)="confirmReset()"
            [disabled]="loading() || saving()">
          </p-button>
          <p-button
            label="Enregistrer" i18n-label="@@settings.numbering.enregistrer.f7c8bcd8"
            icon="pi pi-check"
            (onClick)="save()"
            [loading]="saving()"
            [disabled]="loading() || saving() || !previewValid() || !startNumberValid()">
          </p-button>
        }
      </div>
    </app-page-header>

    @if (loading() && !schemes().length) {
      <div class="loading-container" role="status" aria-live="polite">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem" aria-hidden="true"></i>
        <p i18n="@@settings.numbering.chargement.des.numerotations.83350921">Chargement des numérotations...</p>
      </div>
    } @else {
      <app-numbering-doc-tabs
        [tabs]="documentTabs"
        [activeIndex]="activeTabIndex()"
        (activeIndexChange)="onTabSelected($event)"
        [lockedByIndex]="lockedTabFlags()" />

      <div
        class="numbering-content"
        role="tabpanel"
        [attr.id]="'numbering-panel-' + currentDocumentType()"
        [attr.aria-labelledby]="'numbering-tab-' + currentDocumentType()">
        <div class="meta-row">
          <div class="meta-item">
            <span class="meta-label" i18n="@@settings.numbering.annee.fiscale.a3f33eb8">Année fiscale</span>
            <span class="meta-value">{{ fiscalYear() }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label" i18n="@@settings.numbering.dernier.numero.emis.44a4a0db">Dernier numéro émis</span>
            <span class="meta-value">{{ currentSequence() }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label" i18n="@@settings.numbering.prochain.numero.d628cf0d">Prochain numéro</span>
            <span class="meta-value">{{ previewSequence() }}</span>
          </div>
          @if (isFormatLocked() || hasIssuedDocuments()) {
            <p-tag
              severity="warn"
              icon="pi pi-lock"
              value="Format verrouillé — des documents existent déjà"
              styleClass="lock-tag">
            </p-tag>
          }
        </div>

        <div class="numbering-grid">
          <section
            class="panel palette-panel"
            [class.palette-panel--hidden]="isFormatLocked()"
            aria-labelledby="palette-title">
              <h3 id="palette-title" class="panel-title" i18n="@@settings.numbering.blocs.disponibles.f8d62517">Blocs disponibles</h3>
              <p class="panel-hint" i18n="@@settings.numbering.glissez.un.bloc.vers.le.format.ci.dessous.50f2d4b2">Glissez un bloc vers le format ci-dessous.</p>
              <div
                class="palette-list"
                cdkDropList
                id="numbering-palette"
                [cdkDropListData]="paletteBlocks"
                [cdkDropListConnectedTo]="['numbering-builder']"
                [cdkDropListSortingDisabled]="true"
                [cdkDropListDisabled]="isFormatLocked()">
                @for (template of paletteBlocks; track $index) {
                  <div class="palette-block" cdkDrag [cdkDragData]="template">
                    <i class="pi pi-plus-circle" aria-hidden="true"></i>
                    <span>{{ paletteLabel(template) }}</span>
                  </div>
                }
              </div>
            </section>

          <section class="panel builder-panel" aria-labelledby="builder-title">
            <h3 id="builder-title" class="panel-title" i18n="@@settings.numbering.format.de.numerotation.7a70df22">Format de numérotation</h3>
            @if (isFormatLocked()) {
              <p class="panel-hint" i18n="@@settings.numbering.le.format.ne.peut.plus.etre.modifie.car.des.docu.95baed70"> Le format ne peut plus être modifié car des documents ont déjà été créés.
                Vous pouvez uniquement ajuster le numéro de départ. </p>
            } @else {
              <p class="panel-hint" i18n="@@settings.numbering.reorganisez.les.blocs.par.glisser.deposer.b5d0e34a">Réorganisez les blocs par glisser-déposer.</p>
            }

            <div
              class="builder-list"
              cdkDropList
              id="numbering-builder"
              [cdkDropListData]="blocks()"
              [cdkDropListConnectedTo]="isFormatLocked() ? [] : ['numbering-palette']"
              [cdkDropListDisabled]="isFormatLocked()"
              (cdkDropListDropped)="onDrop($any($event))">
              @for (block of blocks(); let i = $index; track trackBlock(i, block)) {
                <div
                  class="builder-block"
                  [class.builder-block--locked]="isFormatLocked()"
                  cdkDrag
                  [cdkDragDisabled]="isFormatLocked()">
                  <div class="builder-block__handle" cdkDragHandle [class.hidden]="isFormatLocked()">
                    <i class="pi pi-bars" aria-hidden="true"></i>
                  </div>
                  <div class="builder-block__content">
                    <span class="builder-block__label">{{ blockDisplayLabel(block) }}</span>
                    @if (!isFormatLocked() && block.type === blockTypeEnum.FreeText) {
                      <input
                        pInputText
                        class="builder-block__input"
                        [ngModel]="block.value ?? ''"
                        (ngModelChange)="onFreeTextChange(i, $event)"
                        maxlength="20"
                        [attr.aria-label]="loc_ui_tern_texte_libre_du_bloc_5705af + (i + 1)" />
                    } @else if (!isFormatLocked() && block.type === blockTypeEnum.Separator) {
                      <select
                        class="builder-block__select"
                        [ngModel]="block.value ?? '-'"
                        (ngModelChange)="onSeparatorChange(i, $event)"
                        [attr.aria-label]="loc_ui_tern_separateur_du_bloc_c00677 + (i + 1)">
                        <option value="-">-</option>
                        <option value="/" i18n="@@settings.numbering.text.42099b4a">/</option>
                      </select>
                    } @else if (block.value) {
                      <span class="builder-block__value">{{ block.value }}</span>
                    }
                  </div>
                  @if (!isFormatLocked()) {
                    <p-button
                      icon="pi pi-times"
                      [text]="true"
                      [rounded]="true"
                      severity="danger"
                      (onClick)="removeBlock(i)"
                      [attr.aria-label]="loc_ui_tern_supprimer_le_bloc_460dfb + (i + 1)">
                    </p-button>
                  }
                </div>
              } @empty {
                <div class="builder-empty" i18n="@@settings.numbering.aucun.bloc.glissez.des.elements.depuis.la.palett.2c3d0c0d"> Aucun bloc. Glissez des éléments depuis la palette ou réinitialisez le format. </div>
              }
            </div>
          </section>

          <section class="panel preview-panel" aria-labelledby="preview-title">
            <h3 id="preview-title" class="panel-title" i18n="@@settings.numbering.apercu.en.direct.da6d683e">Aperçu en direct</h3>
            <div class="preview-box" [class.preview-box--error]="!previewValid()">
              @if (previewValid()) {
                <span class="preview-value">{{ previewText() }}</span>
              } @else {
                <span class="preview-error">{{ previewError() }}</span>
              }
            </div>
            <p class="panel-hint preview-hint" i18n="@@settings.numbering.apercu.du.prochain.numero.qui.sera.emis.selon.le.4c15e340"> Aperçu du prochain numéro qui sera émis (selon le format et la séquence). </p>
          </section>
        </div>

        <div class="start-number-card">
          <label class="start-number-label" for="start-number" i18n="@@settings.numbering.numero.de.depart.d05888c4"> Numéro de départ </label>
          <p-inputNumber
            inputId="start-number"
            [ngModel]="startNumber()"
            (ngModelChange)="onStartNumberChange($event)"
            [min]="minimumStartNumber()"
            [useGrouping]="false"
            [disabled]="!canUpdate()"
            inputStyleClass="start-number-input"
            styleClass="start-number-field">
          </p-inputNumber>
          @if (!startNumberValid()) {
            <p class="start-number-error" i18n="@@settings.numbering.le.numero.de.depart.doit.etre.au.minimum.5cb7b6fa">
              Le numéro de départ doit être au minimum {{ minimumStartNumber() }}.
            </p>
          }
          <p class="panel-hint">
            @if (hasIssuedDocuments() || isFormatLocked()) {<ng-container i18n="@@settings.numbering.des.documents.existent.deja.le.numero.de.1c1ca836">
              Des documents existent déjà : le numéro de départ doit être supérieur au dernier numéro émis.
            </ng-container>} @else {<ng-container i18n="@@settings.numbering.le.prochain.document.utilisera.au.minimu.b339b381">
              Le prochain document utilisera au minimum ce numéro de départ.
            </ng-container>}
          </p>
        </div>
      </div>
    }

    <p-toast></p-toast>
  `,
  styles: [`
    .header-actions {
      display: flex;
      gap: var(--spacing-2);
      flex-wrap: wrap;
      align-items: center;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-8);
      gap: var(--spacing-3);
      color: var(--color-neutral-600);
    }

    .numbering-content {
      margin-top: var(--spacing-4);
    }

    .meta-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-4);
    }

    .meta-item {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }

    .meta-label {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-neutral-500);
    }

    .meta-value {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
    }

  .lock-tag {
      margin-inline-start: auto;
    }

    .numbering-grid {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(280px, 2fr) minmax(200px, 1fr);
      gap: var(--spacing-4);
      align-items: start;
    }

    @media (max-width: 1024px) {
      .numbering-grid {
        grid-template-columns: 1fr;
      }
    }

    .panel {
      background: white;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      min-height: 200px;
    }

    .panel-title {
      margin: 0 0 var(--spacing-2);
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
    }

    .panel-hint {
      margin: 0 0 var(--spacing-4);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
      line-height: 1.5;
    }

    .palette-panel--hidden {
      display: none;
    }

    .palette-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      min-height: 120px;
    }

    .palette-block {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-3);
      border: 1px dashed var(--color-neutral-300);
      border-radius: var(--radius-md);
      background: var(--color-neutral-50);
      cursor: grab;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-700);

      i {
        color: var(--color-primary-500);
      }
    }

    .builder-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      min-height: 160px;
    }

    .builder-block {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-3);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-md);
      background: white;
    }

    .builder-block--locked {
      background: var(--color-neutral-50);
    }

    .builder-block__handle {
      color: var(--color-neutral-400);
      cursor: grab;

      &.hidden {
        display: none;
      }
    }

    .builder-block__content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      min-width: 0;
    }

    .builder-block__label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-700);
    }

    .builder-block__input,
    .builder-block__select {
      width: 100%;
      max-width: 240px;
    }

    .builder-block__value {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
    }

    .builder-empty {
      padding: var(--spacing-6);
      text-align: center;
      color: var(--color-neutral-500);
      border: 1px dashed var(--color-neutral-300);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
    }

    .preview-box {
      padding: var(--spacing-5);
      border-radius: var(--radius-lg);
      background: var(--color-neutral-50);
      border: 1px solid var(--color-neutral-200);
      min-height: 72px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .preview-box--error {
      border-color: var(--color-error-300);
      background: var(--color-error-50);
    }

    .preview-value {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      font-family: ui-monospace, monospace;
      color: var(--color-primary-700);
      letter-spacing: 0.02em;
    }

    .preview-error {
      font-size: var(--font-size-sm);
      color: var(--color-error-600);
      text-align: center;
    }

    .preview-hint {
      margin-top: var(--spacing-3);
      margin-bottom: 0;
    }

    .start-number-card {
      margin-top: var(--spacing-4);
      padding: var(--spacing-5);
      background: white;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
    }

    .start-number-label {
      display: block;
      margin-bottom: var(--spacing-2);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-700);
      font-size: var(--font-size-sm);
    }

    .start-number-error {
      margin: var(--spacing-2) 0 0;
      font-size: var(--font-size-sm);
      color: var(--color-error-600);
    }

    .start-number-card .panel-hint {
      margin-top: var(--spacing-3);
      margin-bottom: 0;
    }

    :host ::ng-deep .start-number-field,
    :host ::ng-deep .start-number-field .p-inputnumber-input {
      width: 100%;
      max-width: 200px;
    }

    .cdk-drag-preview {
      box-shadow: var(--shadow-md);
    }

    .cdk-drag-placeholder {
      opacity: 0.35;
    }
  `]
})
export class NumberingComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_texte_libre_du_bloc_5705af = $localize`:@@ui.tern.texte.libre.du.bloc.5705af:Texte libre du bloc `;
  readonly loc_ui_tern_separateur_du_bloc_c00677 = $localize`:@@ui.tern.separateur.du.bloc.c00677:Séparateur du bloc `;
  readonly loc_ui_tern_supprimer_le_bloc_460dfb = $localize`:@@ui.tern.supprimer.le.bloc.460dfb:Supprimer le bloc `;
  private readonly numberingService = inject(NumberingService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly destroy$ = new Subject<void>();

  readonly documentTabs = DOCUMENT_TYPE_TABS;
  readonly paletteBlocks = PALETTE_BLOCKS;
  readonly blockTypeEnum = NumberingBlockType;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@settings.numbering.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@settings.numbering.ts.parametres.ef8f0121:Paramètres`, route: '/settings' },
    { label: $localize`:@@settings.numbering.ts.numerotations.f8fd8b5e:Numérotations` }
  ];

  loading = signal(false);
  saving = signal(false);
  schemes = signal<NumberingScheme[]>([]);
  activeTabIndex = signal(0);
  blocks = signal<NumberingBlock[]>([]);
  startNumber = signal(1);
  fiscalYear = signal(new Date().getFullYear());
  currentSequence = signal(0);
  nextSequence = signal(1);
  minimumStartNumber = signal(1);
  hasIssuedDocuments = signal(false);
  isFormatLocked = signal(false);

  canUpdate = computed(() => this.auth.hasPermission(PERMISSIONS.settings.update));

  pageSubtitle = computed(() => {
    const tab = DOCUMENT_TYPE_TABS[this.activeTabIndex()];
    return tab
      ? $localize`:@@ui.tern.configuration.ph.format.et.numero.de.depar.ee4d8f:Configuration : ${tab.label}:p0: — format et numéro de départ`
      : $localize`:@@ui.tern.definissez.le.format.et.le.numero.de.depar.b96754:Définissez le format et le numéro de départ pour chaque type de document`;
  });

  lockedTabFlags = computed(() =>
    DOCUMENT_TYPE_TABS.map(
      (t) => findSchemeForType(this.schemes(), t.documentType)?.isFormatLocked ?? false
    )
  );

  currentDocumentType = computed(
    () => getDocumentTypeForTabIndex(this.activeTabIndex())
  );

  previewSequence = computed(() =>
    Math.max(this.currentSequence() + 1, this.startNumber())
  );

  previewResult = computed(() => {
    const freeText = this.blocks().find((b) => b.type === NumberingBlockType.FreeText)?.value ?? undefined;
    return render(this.blocks(), this.previewSequence(), new Date(), freeText);
  });

  previewText = computed(() => this.previewResult().value);
  previewError = computed(() => this.previewResult().error ?? $localize`:@@ui.tern.format.invalide.7c4729:Format invalide.`);
  previewValid = computed(() => validateBlocks(this.blocks()).valid && !!this.previewText());

  startNumberValid = computed(() => this.startNumber() >= this.minimumStartNumber());

  blockDisplayLabel = blockDisplayLabel;

  ngOnInit(): void {
    this.loadSchemes();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadSchemes(): void {
    this.loading.set(true);
    this.numberingService
      .getSchemes()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.schemes.set(res.data);
            this.applySchemeForCurrentTab();
          } else {
            this.toast.add({
              severity: 'error',
              summary: $localize`:@@numbering.component.summary.Erreur:Erreur`,
              detail: res.errors?.join(', ') || $localize`:@@settings.numbering.ts.chargement.impossible.4c82ffbe:Chargement impossible`
            });
          }
          this.loading.set(false);
        },
        error: (err) => {
          this.errorHandler.logError('Failed to load numbering schemes', err);
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@numbering.component.summary.Erreur:Erreur`,
            detail:
              this.errorHandler.extractErrorMessage(err) ||
              $localize`:@@settings.numbering.ts.impossible.de.charger.les.numerotations.6f52d8ae:Impossible de charger les numérotations`
          });
          this.loading.set(false);
        }
      });
  }

  onTabSelected(index: number): void {
    if (index < 0 || index >= DOCUMENT_TYPE_TABS.length) {
      return;
    }
    if (index === this.activeTabIndex()) {
      return;
    }
    this.activeTabIndex.set(index);
    this.applySchemeForCurrentTab();
  }

  private applySchemeForCurrentTab(): void {
    const docType = this.currentDocumentType();
    const scheme = findSchemeForType(this.schemes(), docType);

    if (!scheme) {
      this.fiscalYear.set(new Date().getFullYear());
      this.startNumber.set(1);
      this.currentSequence.set(0);
      this.nextSequence.set(1);
      this.minimumStartNumber.set(1);
      this.hasIssuedDocuments.set(false);
      this.isFormatLocked.set(false);
      this.blocks.set(getDefaultBlocksForType(docType));
      return;
    }

    this.fiscalYear.set(scheme.fiscalYear);
    this.startNumber.set(scheme.startNumber);
    this.currentSequence.set(scheme.currentSequence);
    this.nextSequence.set(scheme.nextSequence ?? Math.max(scheme.currentSequence + 1, scheme.startNumber));
    this.minimumStartNumber.set(scheme.minimumStartNumber ?? (scheme.hasIssuedDocuments ? scheme.currentSequence + 1 : 1));
    this.hasIssuedDocuments.set(scheme.hasIssuedDocuments ?? scheme.currentSequence > 0);
    this.isFormatLocked.set(scheme.isFormatLocked);
    this.blocks.set(
      scheme.blocks.map((b, index) =>
        cloneBlock({ ...b, label: b.label ?? BLOCK_TYPE_LABELS[b.type] }, b.order ?? index)
      )
    );
  }

  paletteLabel(template: PaletteBlockTemplate): string {
    if (template.type === NumberingBlockType.Separator) {
      return $localize`:@@settings.numbering.ts.separateur.p.82bbc528:Séparateur « ${template.value ?? '-'}:p: »`;
    }
    return BLOCK_TYPE_LABELS[template.type];
  }

  trackBlock(index: number, block: NumberingBlock): string {
    return `${block.type}-${block.order}-${index}`;
  }

  onDrop(event: CdkDragDrop<NumberingBlock[] | readonly PaletteBlockTemplate[]>): void {
    if (this.isFormatLocked()) {
      return;
    }

    const containerData = event.container.data as NumberingBlock[];
    const previousData = event.previousContainer.data as NumberingBlock[] | readonly PaletteBlockTemplate[];

    if (event.previousContainer === event.container) {
      moveItemInArray(containerData, event.previousIndex, event.currentIndex);
      this.reindexBlocks();
      return;
    }

    const template = previousData[event.previousIndex] as PaletteBlockTemplate;
    const newBlock = this.templateToBlock(template, event.currentIndex);
    const target = containerData;
    target.splice(event.currentIndex, 0, newBlock);
    this.reindexBlocks();
  }

  private templateToBlock(template: PaletteBlockTemplate, order: number): NumberingBlock {
    let value = template.value;
    if (template.type === NumberingBlockType.FreeText && !value) {
      value = DEFAULT_FREE_TEXT[this.currentDocumentType()];
    }
    return {
      type: template.type,
      value,
      order,
      label: BLOCK_TYPE_LABELS[template.type]
    };
  }

  private reindexBlocks(): void {
    this.blocks.update((list) =>
      list.map((block, index) => ({ ...block, order: index }))
    );
  }

  onFreeTextChange(index: number, value: string): void {
    this.blocks.update((list) => {
      const copy = [...list];
      copy[index] = { ...copy[index], value };
      return copy;
    });
  }

  onSeparatorChange(index: number, value: string): void {
    this.blocks.update((list) => {
      const copy = [...list];
      copy[index] = { ...copy[index], value };
      return copy;
    });
  }

  onStartNumberChange(value: number | null): void {
    if (value !== null && value >= 1) {
      this.startNumber.set(value);
    }
  }

  removeBlock(index: number): void {
    if (this.isFormatLocked()) {
      return;
    }
    this.blocks.update((list) => {
      const copy = [...list];
      copy.splice(index, 1);
      return copy;
    });
    this.reindexBlocks();
  }

  save(): void {
    if (!this.canUpdate() || !this.previewValid() || !this.startNumberValid()) {
      return;
    }

    const request = {
      startNumber: this.startNumber(),
      blocks: this.blocks().map((b, index) => ({
        type: b.type,
        value: b.value,
        order: index,
        label: b.label ?? BLOCK_TYPE_LABELS[b.type]
      }))
    };

    this.saving.set(true);
    this.numberingService
      .saveScheme(this.currentDocumentType(), request)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          if (res.success && res.data) {
            this.toast.add({
              severity: 'success',
              summary: $localize`:@@numbering.component.summary.Succès:Succès`,
              detail: res.message || $localize`:@@settings.numbering.ts.numerotation.enregistree.8368ad19:Numérotation enregistrée`
            });
            this.schemes.update((list) => {
              const idx = list.findIndex((s) => s.documentType === res.data!.documentType);
              if (idx >= 0) {
                const updated = [...list];
                updated[idx] = res.data!;
                return updated;
              }
              return [...list, res.data!];
            });
            this.applySchemeForCurrentTab();
          } else {
            this.toast.add({
              severity: 'error',
              summary: $localize`:@@numbering.component.summary.Erreur:Erreur`,
              detail: res.errors?.join(', ') || $localize`:@@settings.numbering.ts.echec.de.l.enregistrement.f21d2b1c:Échec de l'enregistrement`
            });
          }
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@numbering.component.summary.Erreur:Erreur`,
            detail:
              this.errorHandler.extractErrorMessage(err) ||
              $localize`:@@settings.numbering.ts.echec.de.l.enregistrement.f21d2b1c:Échec de l'enregistrement`
          });
        }
      });
  }

  confirmReset(): void {
    this.confirmation.confirm({
      header: $localize`:@@settings.numbering.ts.reinitialiser.la.numerotation.32c2252c:Réinitialiser la numérotation`,
      message:
        $localize`:@@settings.numbering.ts.reinitialiser.le.format.et.le.numero.de.9094a778:Réinitialiser le format et le numéro de départ pour ce type de document ? Cette action est irréversible si des documents existent.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@numbering.component.acceptLabel.R_initialiser:Réinitialiser`,
      rejectLabel: $localize`:@@numbering.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.resetScheme()
    });
  }

  private resetScheme(): void {
    this.saving.set(true);
    this.numberingService
      .reset(this.currentDocumentType())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          if (res.success && res.data) {
            this.toast.add({
              severity: 'success',
              summary: $localize`:@@numbering.component.summary.Succès:Succès`,
              detail: res.message || $localize`:@@settings.numbering.ts.numerotation.reinitialisee.bb77b239:Numérotation réinitialisée`
            });
            this.schemes.update((list) => {
              const idx = list.findIndex((s) => s.documentType === res.data!.documentType);
              if (idx >= 0) {
                const updated = [...list];
                updated[idx] = res.data!;
                return updated;
              }
              return [...list, res.data!];
            });
            this.applySchemeForCurrentTab();
          } else {
            this.toast.add({
              severity: 'error',
              summary: $localize`:@@numbering.component.summary.Erreur:Erreur`,
              detail: res.errors?.join(', ') || $localize`:@@settings.numbering.ts.echec.de.la.reinitialisation.7b376ac0:Échec de la réinitialisation`
            });
          }
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@numbering.component.summary.Erreur:Erreur`,
            detail:
              this.errorHandler.extractErrorMessage(err) ||
              $localize`:@@settings.numbering.ts.echec.de.la.reinitialisation.7b376ac0:Échec de la réinitialisation`
          });
        }
      });
  }
}
