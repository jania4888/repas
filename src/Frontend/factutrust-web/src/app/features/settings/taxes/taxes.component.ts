/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import {
  TaxService,
  Tax,
  TaxType,
  TaxValueType,
  TaxContext,
  CreateTaxRequest
} from '@core/services/tax.service';

@Component({
  selector: 'app-taxes',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    TableModule,
    ButtonModule,
    TabsModule,
    DialogModule,
    SelectModule,
    InputTextModule,
    InputNumberModule,
    InputSwitchModule,
    ToastModule,
    TooltipModule,
    PageHeaderComponent,
    BreadcrumbComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Taxes et TVA" i18n-title="@@settings.taxes.taxes.et.tva.08d48b76"
      subtitle="Configurez les taxes applicables et les taux de TVA" i18n-subtitle="@@settings.taxes.configurez.les.taxes.applicables.et.les.fea90a6b">
      <div class="header-actions">
        <p-button
          label="Retour" i18n-label="@@settings.taxes.retour.e5befb1f"
          icon="pi pi-arrow-left"
          [outlined]="true"
          routerLink="/settings">
        </p-button>
        <p-button
          label="Ajouter" i18n-label="@@settings.taxes.ajouter.87c57ed1"
          icon="pi pi-plus"
          (onClick)="openAddDialog()"
          [disabled]="loading()">
        </p-button>
      </div>
    </app-page-header>

    @if (loading() && !taxes().length) {
      <div class="loading-container" role="status" aria-live="polite">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem" aria-hidden="true"></i>
        <p i18n="@@settings.taxes.chargement.des.taxes.71337aa1">Chargement des taxes...</p>
      </div>
    } @else {
      <p-tabs [(value)]="activeTabIndex" class="taxes-tabview" [lazy]="true">
        <p-tablist>
          <p-tab [value]="0" i18n="@@settings.taxes.taxe.7acfb8ad">Taxe</p-tab>
          <p-tab [value]="1" i18n="@@settings.taxes.tva.fb62cb5d">TVA</p-tab>
        </p-tablist>
        <p-tabpanels>
        <p-tabpanel [value]="0">
          <p-table
            [value]="nonVatTaxes()"
            [paginator]="nonVatTaxes().length > 10"
            [rows]="10"
            responsiveLayout="scroll"
            styleClass="p-datatable-sm">
            <ng-template pTemplate="header">
              <tr>
                <th scope="col" i18n="@@settings.taxes.nom.7ff20370">Nom</th>
                <th scope="col" i18n="@@settings.taxes.contexte.8112e9eb">Contexte</th>
                <th scope="col" i18n="@@settings.taxes.valeur.68f92b0d">Valeur</th>
                <th scope="col" i18n="@@settings.taxes.sur.produits.c07ac283">Sur produits</th>
                <th scope="col" i18n="@@settings.taxes.etat.d3b28a2a">État</th>
                <th scope="col" class="col-actions" i18n="@@settings.taxes.actions.c3cd636a">Actions</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              <tr>
                <td>{{ row.name }}</td>
                <td>{{ row.contextDisplay | backendLabel }}</td>
                <td>{{ formatValue(row) }}</td>
                <td>{{ row.isAppliedToProducts ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
                <td>
                  <p-inputSwitch
                    [ngModel]="row.isActive"
                    (ngModelChange)="onToggleActive(row, $event)"
                    [inputId]="'active-' + row.id"
                    [attr.aria-label]="loc_ui_tern_activer_ou_desactiver_04c31b + row.name">
                  </p-inputSwitch>
                </td>
                <td class="col-actions">
                  <p-button
                    icon="pi pi-pencil"
                    [text]="true"
                    [rounded]="true"
                    (onClick)="openEditDialog(row)"
                    [attr.aria-label]="loc_ui_tern_modifier_6efdfe + row.name">
                  </p-button>
                  @if (!row.isSystem) {
                    <p-button
                      icon="pi pi-trash"
                      [text]="true"
                      [rounded]="true"
                      severity="danger"
                      (onClick)="confirmDelete(row)"
                      [attr.aria-label]="loc_ui_tern_supprimer_52af4f + row.name">
                    </p-button>
                  }
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="6" class="empty-cell" i18n="@@settings.taxes.aucune.taxe.hors.tva.utilisez.ajouter.pour.en.cr.2ff1aa23">Aucune taxe hors TVA. Utilisez « Ajouter » pour en créer une.</td>
              </tr>
            </ng-template>
          </p-table>
        </p-tabpanel>

        <p-tabpanel [value]="1">
          <p-table
            [value]="vatTaxes()"
            [paginator]="vatTaxes().length > 10"
            [rows]="10"
            responsiveLayout="scroll"
            styleClass="p-datatable-sm">
            <ng-template pTemplate="header">
              <tr>
                <th scope="col" i18n="@@settings.taxes.nom.7ff20370">Nom</th>
                <th scope="col" i18n="@@settings.taxes.contexte.8112e9eb">Contexte</th>
                <th scope="col" i18n="@@settings.taxes.valeur.68f92b0d">Valeur</th>
                <th scope="col" i18n="@@settings.taxes.sur.produits.c07ac283">Sur produits</th>
                <th scope="col" i18n="@@settings.taxes.etat.d3b28a2a">État</th>
                <th scope="col" class="col-actions" i18n="@@settings.taxes.actions.c3cd636a">Actions</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              <tr>
                <td>{{ row.name }}</td>
                <td>{{ row.contextDisplay | backendLabel }}</td>
                <td>{{ formatValue(row) }}</td>
                <td>{{ row.isAppliedToProducts ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
                <td>
                  <p-inputSwitch
                    [ngModel]="row.isActive"
                    (ngModelChange)="onToggleActive(row, $event)"
                    [inputId]="'vat-active-' + row.id"
                    [attr.aria-label]="loc_ui_tern_activer_ou_desactiver_04c31b + row.name">
                  </p-inputSwitch>
                </td>
                <td class="col-actions">
                  <p-button
                    icon="pi pi-pencil"
                    [text]="true"
                    [rounded]="true"
                    (onClick)="openEditDialog(row)"
                    [attr.aria-label]="loc_ui_tern_modifier_6efdfe + row.name">
                  </p-button>
                  @if (!row.isSystem) {
                    <p-button
                      icon="pi pi-trash"
                      [text]="true"
                      [rounded]="true"
                      severity="danger"
                      (onClick)="confirmDelete(row)"
                      [attr.aria-label]="loc_ui_tern_supprimer_52af4f + row.name">
                    </p-button>
                  }
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="6" class="empty-cell" i18n="@@settings.taxes.aucun.taux.de.tva.42d1391e">Aucun taux de TVA.</td>
              </tr>
            </ng-template>
          </p-table>
        </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
    }

    <p-dialog
      [header]="dialogTitle()"
      [(visible)]="dialogVisible"
      [modal]="true"
      [style]="{ width: 'min(560px, 95vw)' }"
      [draggable]="false"
      [dismissableMask]="true"
      (onHide)="onDialogHide()"
      [attr.aria-modal]="true">
      <form [formGroup]="form" (ngSubmit)="onSubmitForm()" class="tax-form">
        @if (isEditingSystemTax()) {
          <div
            class="hint-banner hint-banner--top"
            role="region"
            aria-labelledby="tax-system-info-title">
            <span id="tax-system-info-title" class="hint-banner__title" i18n="@@settings.taxes.taxe.systeme.cce09290">Taxe système</span>
            <p class="hint-banner__text" i18n="@@settings.taxes.les.champs.type.mode.de.calcul.valeur.et.b5b73647">
              <ng-container> Les champs </ng-container> <strong>Type</strong>, <strong>Mode de calcul</strong>, <strong>Valeur</strong> et
              <strong>Contexte</strong> sont en lecture seule. Vous pouvez modifier le libellé, l’ordre d’affichage et
              l’application sur les produits.
            </p>
          </div>
        }

        <div class="form-grid">
          <div class="form-section">
            <span class="section-title" id="section-identification" i18n="@@settings.taxes.identification.9d2c7063">Identification</span>
            <label class="form-field" for="tax-name">
              <span class="label-text"><ng-container i18n="@@settings.taxes.nom.7ff20370">Nom </ng-container> <span class="required" aria-hidden="true" i18n="@@settings.taxes.text.df58248c">*</span></span>
              <input pInputText id="tax-name" formControlName="name" class="w-full" autocomplete="off" />
            </label>
            @if (!isEditingSystemTax()) {
              <label class="form-field" for="tax-type">
                <span class="label-text" i18n="@@settings.taxes.type.3deb7456">Type</span>
                <p-select
                  inputId="tax-type"
                  formControlName="type"
                  [options]="typeOptions()"
                  optionLabel="label"
                  optionValue="value"
                  styleClass="w-full">
                </p-select>
              </label>
            }
          </div>

          @if (isEditingSystemTax()) {
            <div
              class="tax-form__locked"
              role="group"
              aria-labelledby="tax-locked-legend">
              <div id="tax-locked-legend" class="locked-legend">
                <i class="pi pi-lock locked-legend__icon" aria-hidden="true"></i>
                <span i18n="@@settings.taxes.regles.imposees.par.la.plateforme.lecture.seule.de5b8a6f">Règles imposées par la plateforme (lecture seule)</span>
              </div>
              <label class="form-field" for="tax-type">
                <span class="label-text" i18n="@@settings.taxes.type.3deb7456">Type</span>
                <p-select
                  inputId="tax-type"
                  formControlName="type"
                  [options]="typeOptions()"
                  optionLabel="label"
                  optionValue="value"
                  styleClass="w-full">
                </p-select>
              </label>
              <label class="form-field" for="tax-value-type">
                <span class="label-text" i18n="@@settings.taxes.mode.de.calcul.803843c7">Mode de calcul</span>
                <p-select
                  inputId="tax-value-type"
                  formControlName="valueType"
                  [options]="valueTypeOptions"
                  optionLabel="label"
                  optionValue="value"
                  styleClass="w-full">
                </p-select>
              </label>
              <label class="form-field" for="tax-value">
                <span class="label-text" i18n="@@settings.taxes.valeur.68f92b0d">Valeur</span>
                <p-inputNumber
                  inputId="tax-value"
                  formControlName="value"
                  [min]="0"
                  [max]="valueMax()"
                  [useGrouping]="false"
                  [minFractionDigits]="0"
                  [maxFractionDigits]="3"
                  inputStyleClass="w-full"
                  styleClass="w-full">
                </p-inputNumber>
              </label>
              <label class="form-field" for="tax-context">
                <span class="label-text" i18n="@@settings.taxes.contexte.8112e9eb">Contexte</span>
                <p-select
                  inputId="tax-context"
                  formControlName="context"
                  [options]="contextOptions"
                  optionLabel="label"
                  optionValue="value"
                  styleClass="w-full">
                </p-select>
              </label>
            </div>
          } @else {
            <div class="form-section" role="group" aria-labelledby="section-calcul">
              <span class="section-title" id="section-calcul" i18n="@@settings.taxes.calcul.c0976407">Calcul</span>
              <label class="form-field" for="tax-value-type">
                <span class="label-text" i18n="@@settings.taxes.mode.de.calcul.803843c7">Mode de calcul</span>
                <p-select
                  inputId="tax-value-type"
                  formControlName="valueType"
                  [options]="valueTypeOptions"
                  optionLabel="label"
                  optionValue="value"
                  styleClass="w-full">
                </p-select>
              </label>
              <label class="form-field" for="tax-value">
                <span class="label-text" i18n="@@settings.taxes.valeur.68f92b0d">Valeur</span>
                <p-inputNumber
                  inputId="tax-value"
                  formControlName="value"
                  [min]="0"
                  [max]="valueMax()"
                  [useGrouping]="false"
                  [minFractionDigits]="0"
                  [maxFractionDigits]="3"
                  inputStyleClass="w-full"
                  styleClass="w-full">
                </p-inputNumber>
              </label>
            </div>
            <div class="form-section" role="group" aria-labelledby="section-perimetre">
              <span class="section-title" id="section-perimetre" i18n="@@settings.taxes.perimetre.b5d08ec3">Périmètre</span>
              <label class="form-field" for="tax-context">
                <span class="label-text" i18n="@@settings.taxes.contexte.8112e9eb">Contexte</span>
                <p-select
                  inputId="tax-context"
                  formControlName="context"
                  [options]="contextOptions"
                  optionLabel="label"
                  optionValue="value"
                  styleClass="w-full">
                </p-select>
              </label>
            </div>
          }

          <div class="form-section" role="group" aria-labelledby="section-perimetre-produits">
            <span class="section-title" id="section-perimetre-produits" i18n="@@settings.taxes.produits.48000473">Produits</span>
            <div class="form-field switch-field">
              <label class="switch-field__label" for="tax-on-products">
                <span class="label-text" i18n="@@settings.taxes.appliquee.sur.les.produits.0ff18fd8">Appliquée sur les produits</span>
              </label>
              <p-inputSwitch formControlName="isAppliedToProducts" inputId="tax-on-products"></p-inputSwitch>
            </div>
          </div>

          <div class="form-section" role="group" aria-labelledby="section-affichage">
            <span class="section-title" id="section-affichage" i18n="@@settings.taxes.affichage.bc8f3ed6">Affichage</span>
            <label class="form-field" for="tax-order">
              <span class="label-text" i18n="@@settings.taxes.ordre.d.affichage.0b1cb263">Ordre d’affichage</span>
              <p-inputNumber
                inputId="tax-order"
                formControlName="displayOrder"
                [useGrouping]="false"
                inputStyleClass="w-full"
                styleClass="w-full">
              </p-inputNumber>
            </label>
          </div>
        </div>

        <div class="dialog-actions">
          <p-button type="button" label="Annuler" i18n-label="@@settings.taxes.annuler.49ba3292" [text]="true" (onClick)="dialogVisible = false"></p-button>
          <p-button
            type="submit"
            label="Enregistrer" i18n-label="@@settings.taxes.enregistrer.f7c8bcd8"
            icon="pi pi-check"
            iconPos="right"
            [loading]="saving()"
            [disabled]="form.invalid || saving()">
          </p-button>
        </div>
      </form>
    </p-dialog>

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
    .tax-form .form-grid {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-5);
    }
    .form-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }
    .section-title {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-neutral-500);
      margin: 0;
    }
    .form-field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      min-width: 0;
    }
    .label-text {
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-700);
      font-size: var(--font-size-sm);
    }
    .required {
      color: var(--color-error-500);
    }
    .switch-field {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-3);
    }
    .switch-field__label {
      margin: 0;
      flex: 0 1 auto;
      min-width: 0;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-2);
      margin-top: var(--spacing-5);
      padding-top: var(--spacing-4);
      border-top: 1px solid var(--color-neutral-200);
    }
    .empty-cell {
      text-align: center;
      color: var(--color-neutral-500);
      padding: var(--spacing-6) !important;
    }
    .col-actions {
      white-space: nowrap;
      text-align: right;
    }
    .hint-banner {
      padding: var(--spacing-3) var(--spacing-4);
      background: var(--color-neutral-50);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-700);
    }
    .hint-banner--top {
      margin: 0 0 var(--spacing-5) 0;
    }
    .hint-banner__title {
      display: block;
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800);
      margin-bottom: var(--spacing-2);
      font-size: var(--font-size-sm);
    }
    .hint-banner__text {
      margin: 0;
      line-height: 1.5;
    }
    .tax-form__locked {
      padding: var(--spacing-4);
      background: var(--color-neutral-50);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-md);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }
    .locked-legend {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-700);
    }
    .locked-legend__icon {
      margin-top: 0.125rem;
      flex-shrink: 0;
      color: var(--color-neutral-500);
    }
    :host ::ng-deep .tax-form .p-inputnumber,
    :host ::ng-deep .tax-form .p-inputnumber .p-inputtext,
    :host ::ng-deep .tax-form .p-select {
      width: 100%;
      min-width: 0;
    }
    :host ::ng-deep .tax-form__locked p-select.p-disabled .p-select-label,
    :host ::ng-deep .tax-form__locked p-select.p-disabled .p-select-trigger {
      opacity: 1;
      background: var(--color-neutral-100);
      color: var(--color-neutral-700);
    }
    :host ::ng-deep .tax-form__locked .p-inputnumber-input:disabled {
      opacity: 1;
      background: var(--color-neutral-100) !important;
      color: var(--color-neutral-700);
      cursor: not-allowed;
    }
    :host ::ng-deep .taxes-tabview .p-tabpanels {
      padding-top: var(--spacing-4);
    }
  `]
})
export class TaxesComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  readonly loc_ui_tern_activer_ou_desactiver_04c31b = $localize`:@@ui.tern.activer.ou.desactiver.04c31b:Activer ou désactiver `;
  readonly loc_ui_tern_modifier_6efdfe = $localize`:@@ui.tern.modifier.6efdfe:Modifier `;
  readonly loc_ui_tern_supprimer_52af4f = $localize`:@@ui.tern.supprimer.52af4f:Supprimer `;
  private readonly taxService = inject(TaxService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Paramètres', route: '/settings' },
    { label: 'Taxes et TVA' }
  ];

  loading = signal(false);
  saving = signal(false);
  taxes = signal<Tax[]>([]);
  dialogVisible = false;
  activeTabIndex = 0;
  editingTax = signal<Tax | null>(null);

  dialogTitle = computed(() => (this.editingTax() ? $localize`:@@ui.tern.modifier.la.taxe.d99686:Modifier la taxe` : $localize`:@@ui.tern.nouvelle.taxe.f9702f:Nouvelle taxe`));

  /** Aligné sur `editingTax()?.isSystem` pour le template (message + bloc verrouillé). */
  readonly isEditingSystemTax = computed(() => !!this.editingTax()?.isSystem);

  valueTypeOptions = [
    { label: 'Pourcentage', value: TaxValueType.Percentage },
    { label: 'Montant fixe (TND)', value: TaxValueType.FixedAmount }
  ];

  contextOptions = [
    { label: 'Tous', value: TaxContext.All },
    { label: 'Ventes', value: TaxContext.Sales },
    { label: 'Achats', value: TaxContext.Purchases }
  ];

  private allTypeOptions = [
    { label: 'TVA', value: TaxType.VAT },
    { label: 'Timbre', value: TaxType.Stamp },
    { label: 'FODEC', value: TaxType.FODEC },
    { label: 'Droit de consommation', value: TaxType.Consumption },
    { label: 'Autre', value: TaxType.Other }
  ];

  typeOptions = computed(() => {
    if (this.activeTabIndex === 1) {
      return this.allTypeOptions.filter((o) => o.value === TaxType.VAT);
    }
    return this.allTypeOptions.filter((o) => o.value !== TaxType.VAT);
  });

  form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    type: [TaxType.Stamp, Validators.required],
    valueType: [TaxValueType.FixedAmount, Validators.required],
    value: [0, [Validators.required, Validators.min(0)]],
    context: [TaxContext.All, Validators.required],
    isAppliedToProducts: [false],
    displayOrder: [0, Validators.required]
  });

  nonVatTaxes = computed(() =>
    this.taxes()
      .filter((t) => t.type !== TaxType.VAT)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
  );

  vatTaxes = computed(() =>
    this.taxes()
      .filter((t) => t.type === TaxType.VAT)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
  );

  valueMax(): number {
    return this.form.get('valueType')?.value === TaxValueType.Percentage ? 100 : 999999;
  }

  ngOnInit(): void {
    this.loadTaxes();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadTaxes(): void {
    this.loading.set(true);
    this.taxService
      .getTaxes()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.taxes.set(res.data);
          } else {
            this.toast.add({ severity: 'error', summary: $localize`:@@taxes.component.summary.Erreur:Erreur`, detail: res.errors?.join(', ') || 'Chargement impossible' });
          }
          this.loading.set(false);
        },
        error: (err) => {
          this.errorHandler.logError('Failed to load taxes', err);
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@taxes.component.summary.Erreur:Erreur`,
            detail: this.errorHandler.extractErrorMessage(err) || 'Impossible de charger les taxes'
          });
          this.loading.set(false);
        }
      });
  }

  formatValue(tax: Tax): string {
    if (tax.valueType === TaxValueType.Percentage) {
      return `+${tax.value} %`;
    }
    return `+${tax.value} TND`;
  }

  openAddDialog(): void {
    this.editingTax.set(null);
    this.form.enable({ emitEvent: false });
    const isVatTab = this.activeTabIndex === 1;
    this.form.reset({
      name: '',
      type: isVatTab ? TaxType.VAT : TaxType.Stamp,
      valueType: isVatTab ? TaxValueType.Percentage : TaxValueType.FixedAmount,
      value: isVatTab ? 19 : 1,
      context: TaxContext.All,
      isAppliedToProducts: isVatTab,
      displayOrder: 0
    });
    this.dialogVisible = true;
  }

  openEditDialog(tax: Tax): void {
    this.editingTax.set(tax);
    this.form.enable({ emitEvent: false });
    this.form.patchValue({
      name: tax.name,
      type: tax.type,
      valueType: tax.valueType,
      value: tax.value,
      context: tax.context,
      isAppliedToProducts: tax.isAppliedToProducts,
      displayOrder: tax.displayOrder
    });
    if (tax.isSystem) {
      this.form.get('type')?.disable({ emitEvent: false });
      this.form.get('valueType')?.disable({ emitEvent: false });
      this.form.get('value')?.disable({ emitEvent: false });
      this.form.get('context')?.disable({ emitEvent: false });
    }
    this.dialogVisible = true;
  }

  onDialogHide(): void {
    this.editingTax.set(null);
  }

  onSubmitForm(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body: CreateTaxRequest = {
      name: v.name.trim(),
      type: v.type,
      valueType: v.valueType,
      value: v.value,
      context: v.context,
      isAppliedToProducts: v.isAppliedToProducts,
      displayOrder: v.displayOrder
    };

    const current = this.editingTax();
    this.saving.set(true);
    if (current) {
      this.taxService
        .updateTax(current.id, body)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            this.saving.set(false);
            if (res.success && res.data) {
              this.toast.add({ severity: 'success', summary: $localize`:@@taxes.component.summary.Succès:Succès`, detail: res.message || 'Taxe mise à jour' });
              this.dialogVisible = false;
              this.loadTaxes();
            } else {
              this.toast.add({ severity: 'error', summary: $localize`:@@taxes.component.summary.Erreur:Erreur`, detail: res.errors?.join(', ') || 'Échec' });
            }
          },
          error: (err) => {
            this.saving.set(false);
            this.toast.add({
              severity: 'error',
              summary: $localize`:@@taxes.component.summary.Erreur:Erreur`,
              detail: this.errorHandler.extractErrorMessage(err) || 'Échec de la mise à jour'
            });
          }
        });
    } else {
      this.taxService
        .createTax(body)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (res) => {
            this.saving.set(false);
            if (res.success && res.data) {
              this.toast.add({ severity: 'success', summary: $localize`:@@taxes.component.summary.Succès:Succès`, detail: res.message || 'Taxe créée' });
              this.dialogVisible = false;
              this.loadTaxes();
            } else {
              this.toast.add({ severity: 'error', summary: $localize`:@@taxes.component.summary.Erreur:Erreur`, detail: res.errors?.join(', ') || 'Échec' });
            }
          },
          error: (err) => {
            this.saving.set(false);
            this.toast.add({
              severity: 'error',
              summary: $localize`:@@taxes.component.summary.Erreur:Erreur`,
              detail: this.errorHandler.extractErrorMessage(err) || 'Échec de la création'
            });
          }
        });
    }
  }

  onToggleActive(tax: Tax, active: boolean): void {
    if (tax.isActive === active) return;
    this.taxService
      .setTaxActive(tax.id, { isActive: active })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.taxes.update((list) => list.map((t) => (t.id === tax.id ? res.data! : t)));
            this.toast.add({ severity: 'success', summary: $localize`:@@taxes.component.summary.Succès:Succès`, detail: $localize`:@@taxes.component.detail.État mis à j:État mis à jour` });
          } else {
            this.toast.add({ severity: 'error', summary: $localize`:@@taxes.component.summary.Erreur:Erreur`, detail: res.errors?.join(', ') || 'Échec' });
            this.loadTaxes();
          }
        },
        error: (err) => {
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@taxes.component.summary.Erreur:Erreur`,
            detail: this.errorHandler.extractErrorMessage(err) || 'Échec'
          });
          this.loadTaxes();
        }
      });
  }

  confirmDelete(tax: Tax): void {
    this.confirmation.confirm({
      header: 'Supprimer la taxe',
      message: `Supprimer « ${tax.name} » ? Cette action est irréversible.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@taxes.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@taxes.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.taxService
          .deleteTax(tax.id)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (res) => {
              if (res.success) {
                this.toast.add({ severity: 'success', summary: $localize`:@@taxes.component.summary.Succès:Succès`, detail: $localize`:@@taxes.component.detail.Taxe supprim:Taxe supprimée` });
                this.loadTaxes();
              } else {
                this.toast.add({ severity: 'error', summary: $localize`:@@taxes.component.summary.Erreur:Erreur`, detail: res.errors?.join(', ') || 'Échec' });
              }
            },
            error: (err) => {
              this.toast.add({
                severity: 'error',
                summary: $localize`:@@taxes.component.summary.Erreur:Erreur`,
                detail: this.errorHandler.extractErrorMessage(err) || 'Échec de la suppression'
              });
            }
          });
      }
    });
  }
}
