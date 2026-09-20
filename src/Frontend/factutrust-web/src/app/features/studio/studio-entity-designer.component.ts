import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, catchError, of, switchMap, tap, timer } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { SelectModule } from 'primeng/select';
import { MessageModule } from 'primeng/message';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService } from '@core/services/confirmation.service';
import { StudioService } from './studio.service';
import {
  ChangeCustomFieldTypeRequest, CustomEntity, CustomField, CustomFieldType, FIELD_TYPE_OPTIONS, SelectOption,
  StudioFieldTypeCheckDto
} from './studio.models';
import { STUDIO_AI_LABELS } from './ai/studio-ai-labels';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { StudioManyToManyDialogComponent } from './relations/studio-many-to-many-dialog.component';
import { STUDIO_RUNTIME_LABELS } from './shared/studio-runtime-labels';
import { EntityRelationDto, relationKindLabel } from './relations/studio-relations.models';
import { StudioAiCapabilitiesService } from './ai/studio-ai-capabilities.service';

@Component({
  selector: 'app-studio-entity-designer',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    TableModule, ButtonModule, DialogModule, InputTextModule, InputNumberModule, InputSwitchModule, SelectModule,
    MessageModule, TooltipModule, ToastModule, StudioPageShellComponent, StudioManyToManyDialogComponent
  ],
  template: `
    <p-toast></p-toast>
    <app-studio-page-shell
      *ngIf="entity() as e"
      [title]="e.displayName"
      [subtitle]="'Clé : ' + e.key + ' — ' + fields().length + ' champ(s)'"
      [breadcrumbs]="breadcrumbs">
      <div studioActions class="studio-head-actions">
        <button pButton type="button" label="Rapports" icon="fa-solid fa-chart-column"
          class="p-button-outlined p-button-sm" routerLink="/studio/reports/new" [queryParams]="{ source: e.key }"></button>
        <button pButton type="button" label="Mise en page" icon="fa-solid fa-table-cells-large"
          class="p-button-outlined p-button-sm" [routerLink]="['/studio', e.id, 'form']"></button>
        <button pButton type="button" label="Données" icon="fa-solid fa-table-list"
          class="p-button-outlined p-button-sm" [routerLink]="['/studio/d', e.key]"></button>
        <button pButton type="button" label="Pont ERP" icon="fa-solid fa-bolt"
          class="p-button-outlined p-button-sm" [routerLink]="['/studio', e.id, 'automations']"></button>
        @if (workflowsEnabled()) {
          <button pButton type="button" label="Workflows" icon="fa-solid fa-route"
            class="p-button-outlined p-button-sm" [routerLink]="['/studio', 'workflows']" [queryParams]="{ entity: e.id }" data-testid="wf-open"></button>
        }
        @if (manyToManyEnabled()) {
          <button pButton type="button" [label]="runtimeLabels.relations.addManyToMany" icon="fa-solid fa-diagram-project"
            class="p-button-outlined p-button-sm" (click)="m2mVisible.set(true)" data-testid="m2m-open"></button>
        }
        <button pButton type="button" label="Ajouter un champ" icon="fa-solid fa-plus" (click)="openAdd()"></button>
      </div>

      <div class="ft-table-card">
      <p-table [value]="fields()" [loading]="loading()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th style="width:6rem">Ordre</th>
            <th>Libellé</th>
            <th>Clé</th>
            <th>Type</th>
            <th>Requis</th>
            <th style="width:10rem"></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-f let-i="rowIndex">
          <tr [class.ft-inactive]="!f.isActive">
            <td>
              <button pButton type="button" icon="fa-solid fa-arrow-up" class="p-button-text p-button-sm"
                [disabled]="i === 0" (click)="move(i, -1)"></button>
              <button pButton type="button" icon="fa-solid fa-arrow-down" class="p-button-text p-button-sm"
                [disabled]="i === fields().length - 1" (click)="move(i, 1)"></button>
            </td>
            <td><strong>{{ f.label }}</strong></td>
            <td><code>{{ f.key }}</code></td>
            <td>{{ typeLabel(f.fieldType) }}</td>
            <td><i class="fa-solid" [class.fa-check]="f.isRequired" [class.fa-minus]="!f.isRequired"></i></td>
            <td class="ft-actions">
              <button pButton type="button" icon="fa-solid fa-pen" class="p-button-text p-button-sm" (click)="openEdit(f)"></button>
              <button pButton type="button" icon="fa-solid fa-trash" class="p-button-text p-button-sm p-button-danger" (click)="remove(f)"></button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="6" class="ft-empty">Aucun champ. Ajoutez le premier champ de cette table.</td></tr>
        </ng-template>
      </p-table>
      </div>

      @if (manyToManyEnabled()) {
        <div class="ft-table-card" data-testid="relations-section">
          <h3 class="studio-section-title">{{ runtimeLabels.relations.title }}</h3>
          <p-table [value]="relations()" [loading]="relationsLoading()" styleClass="p-datatable-sm">
            <ng-template pTemplate="header">
              <tr><th>Type</th><th>Cible</th><th>Jonction</th></tr>
            </ng-template>
            <ng-template pTemplate="body" let-rel>
              <tr>
                <td>{{ relationKindLabel(rel.kind) }}</td>
                <td>{{ rel.kind === 'many_to_many' ? rel.targetLabel : (rel.sourceEntityKey === e.key ? rel.targetLabel : rel.sourceLabel) }}</td>
                <td>
                  @if (rel.junctionEntityKey) {
                    <a [routerLink]="['/studio', rel.junctionEntityId]">{{ rel.junctionEntityKey }}</a>
                  } @else { — }
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr><td colspan="3" class="ft-empty">{{ runtimeLabels.relations.empty }}</td></tr>
            </ng-template>
          </p-table>
        </div>
      }
    </app-studio-page-shell>

    @if (manyToManyEnabled() && entity()) {
      <app-studio-many-to-many-dialog [sourceEntity]="entity()!" [entities]="allEntities()"
        [(visible)]="m2mVisible" (created)="onRelationCreated()" />
    }

    <p-dialog [header]="editing() ? 'Modifier le champ' : 'Nouveau champ'" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '34rem' }" (onHide)="resetTypeCheck()">
      <div class="ft-form">
        <label>Libellé *</label>
        <input pInputText [(ngModel)]="fLabel" (ngModelChange)="onLabelChange($event)" />

        <label>Clé technique *</label>
        <input pInputText [(ngModel)]="fKey" [disabled]="editing()" />

        <label>Type *</label>
        <p-select [options]="typeOptions" [(ngModel)]="fType" (ngModelChange)="onTypeChange($event)" optionLabel="label" optionValue="value"
          appendTo="body" panelStyleClass="studio-theme" styleClass="ft-w-full" data-testid="field-type-select"></p-select>
        @if (editing() && typeChecking()) {
          <small class="ft-hint" data-testid="type-checking">{{ labels.typeChange.checking }}</small>
        } @else if (editing() && typeCheck()) {
          <p-message [severity]="typeSeverity()" [text]="typeCheck()!.message" data-testid="type-check-message" />
        }

        <div class="ft-row">
          <div><p-inputSwitch [(ngModel)]="fRequired"></p-inputSwitch> <span>Obligatoire</span></div>
          <div><p-inputSwitch [(ngModel)]="fUnique"></p-inputSwitch> <span>Unique</span></div>
        </div>

        <ng-container *ngIf="isSelect()">
          <label>Options (une par ligne, format <code>valeur|libellé</code>)</label>
          <textarea class="ft-textarea" [(ngModel)]="fOptionsText" rows="4"
            placeholder="open|Ouvert&#10;closed|Fermé"></textarea>
        </ng-container>

        <ng-container *ngIf="isRelationCustom()">
          <label>Table cible *</label>
          <p-select [options]="otherEntities()" [(ngModel)]="fRelationRef" optionLabel="displayName" optionValue="key"
            appendTo="body" panelStyleClass="studio-theme" styleClass="ft-w-full" placeholder="Choisir une table"></p-select>
          <small class="ft-hint">Le champ référencera un enregistrement de cette table.</small>
        </ng-container>

        <ng-container *ngIf="isRelationExisting()">
          <label>Donnée existante cible *</label>
          <p-select [options]="existingRelationSources" [(ngModel)]="fRelationRef" optionLabel="label" optionValue="value"
            appendTo="body" panelStyleClass="studio-theme" styleClass="ft-w-full" placeholder="Choisir une source"></p-select>
          <small class="ft-hint">Référence en lecture seule vers une fiche existante.</small>
        </ng-container>

        <ng-container *ngIf="isText()">
          <div class="ft-row">
            <div><label>Longueur min</label><p-inputNumber [(ngModel)]="fMinLen"></p-inputNumber></div>
            <div><label>Longueur max</label><p-inputNumber [(ngModel)]="fMaxLen"></p-inputNumber></div>
          </div>
        </ng-container>

        <ng-container *ngIf="isNumeric()">
          <div class="ft-row">
            <div><label>Valeur min</label><p-inputNumber [(ngModel)]="fMin"></p-inputNumber></div>
            <div><label>Valeur max</label><p-inputNumber [(ngModel)]="fMax"></p-inputNumber></div>
          </div>
        </ng-container>

        <ng-container *ngIf="isMoney()">
          <label>Devise</label>
          <input pInputText [(ngModel)]="fCurrency" maxlength="8" placeholder="TND" />
          <small class="ft-hint">Code ISO de la devise (ex. TND, EUR, USD).</small>
          <div class="ft-row">
            <div><label>Valeur min</label><p-inputNumber [(ngModel)]="fMin"></p-inputNumber></div>
            <div><label>Valeur max</label><p-inputNumber [(ngModel)]="fMax"></p-inputNumber></div>
          </div>
        </ng-container>

        <ng-container *ngIf="isPercentage()">
          <div class="ft-row">
            <div><label>Valeur min</label><p-inputNumber [(ngModel)]="fMin"></p-inputNumber></div>
            <div><label>Valeur max</label><p-inputNumber [(ngModel)]="fMax"></p-inputNumber></div>
          </div>
        </ng-container>

        <ng-container *ngIf="isRating()">
          <label>Nombre d'étoiles</label>
          <p-inputNumber [(ngModel)]="fRatingMax" [min]="1" [max]="10"></p-inputNumber>
          <small class="ft-hint">Note maximale (1 à 10).</small>
        </ng-container>

        <ng-container *ngIf="isBarcode()">
          <label>Symbologie</label>
          <p-select [options]="barcodeFormats" [(ngModel)]="fCodeFormat" optionLabel="label" optionValue="value"
            appendTo="body" panelStyleClass="studio-theme" styleClass="ft-w-full"></p-select>
          <small class="ft-hint">EAN-13 attend 12 à 13 chiffres ; CODE128 accepte tout texte.</small>
        </ng-container>

        <ng-container *ngIf="isQr()">
          <small class="ft-hint">La valeur saisie sera encodée en QR code.</small>
        </ng-container>

        <ng-container *ngIf="isFormula()">
          <label>Expression *</label>
          <textarea class="ft-textarea" [(ngModel)]="fFormulaExpr" rows="3"
            placeholder="montant_ht * 1.19"></textarea>
          <small class="ft-hint">
            Fonctions : ROUND, ABS, MIN, MAX, IF, COALESCE, CONCAT, LEN, LOWER, UPPER, TRIM.
            Opérateurs : + - * / % , comparaisons, AND/OR/NOT.
          </small>
          <small class="ft-hint" *ngIf="otherFieldKeys() as keys">
            Champs disponibles : <code *ngFor="let k of keys">{{ k }}</code>
          </small>
        </ng-container>

        <ng-container *ngIf="isLookup()">
          <label>Champ relation (via) *</label>
          <p-select [options]="relationFields()" [(ngModel)]="fLookupVia" optionLabel="label" optionValue="value"
            appendTo="body" panelStyleClass="studio-theme" styleClass="ft-w-full" placeholder="Choisir un champ relation"></p-select>
          <label>Champ cible *</label>
          <input pInputText [(ngModel)]="fLookupTarget" placeholder="clé du champ à afficher" />
          <small class="ft-hint">Affiche un champ de l'enregistrement/fiche liée par le champ relation.</small>
        </ng-container>

        <ng-container *ngIf="isRollup()">
          <label>Table enfant *</label>
          <p-select [options]="otherEntities()" [(ngModel)]="fRollupEntity" optionLabel="displayName" optionValue="key"
            appendTo="body" panelStyleClass="studio-theme" styleClass="ft-w-full" placeholder="Choisir une table"></p-select>
          <label>Champ relation de l'enfant *</label>
          <input pInputText [(ngModel)]="fRollupRelationField" placeholder="clé du champ relation pointant vers cette table" />
          <label>Agrégat *</label>
          <p-select [options]="aggOptions" [(ngModel)]="fRollupAgg" optionLabel="label" optionValue="value"
            appendTo="body" panelStyleClass="studio-theme" styleClass="ft-w-full"></p-select>
          <ng-container *ngIf="fRollupAgg !== 'count'">
            <label>Champ à agréger *</label>
            <input pInputText [(ngModel)]="fRollupField" placeholder="clé du champ numérique de l'enfant" />
          </ng-container>
          <small class="ft-hint">Agrège les enregistrements de la table enfant qui référencent cette fiche.</small>
        </ng-container>

        <ng-container *ngIf="isAutoNumber()">
          <small class="ft-hint">Référence séquentielle générée à la création, en lecture seule.</small>
          <div class="ft-row">
            <div><label>Préfixe</label><input pInputText [(ngModel)]="fNumPrefix" maxlength="16" placeholder="FACT-" /></div>
            <div><label>Longueur (zéros)</label><p-inputNumber [(ngModel)]="fNumPadding" [min]="0" [max]="12"></p-inputNumber></div>
            <div><label>Suffixe</label><input pInputText [(ngModel)]="fNumSuffix" maxlength="16" placeholder="/2026" /></div>
          </div>
          <small class="ft-hint">Aperçu : <code>{{ autoNumberPreview() }}</code></small>
        </ng-container>
      </div>
      <ng-template pTemplate="footer">
        <button pButton type="button" label="Annuler" class="p-button-text" (click)="closeDialog()"></button>
        <button pButton type="button" label="Enregistrer" icon="fa-solid fa-check" [disabled]="saving() || typeBlocked() || typeChecking()" (click)="save()" data-testid="field-save"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .studio-head-actions { display: flex; flex-wrap: wrap; gap: var(--spacing-2); }
    .ft-actions { text-align: right; white-space: nowrap; }
    .ft-empty { text-align: center; color: var(--color-neutral-500); padding: 2rem; }
    .ft-inactive { opacity: .5; }
    .ft-form { display: flex; flex-direction: column; gap: .35rem; }
    .ft-form label { font-weight: 600; font-size: .85rem; margin-top: .5rem; }
    .ft-row { display: flex; gap: 1rem; align-items: center; margin-top: .5rem; }
    .ft-row > div { display: flex; flex-direction: column; gap: .25rem; }
    .ft-row span { margin-left: .35rem; }
    .ft-textarea { width: 100%; font-family: monospace; padding: .5rem; border: 1px solid var(--surface-300); border-radius: 6px; }
    :host ::ng-deep .ft-w-full { width: 100%; }
  `],
  styleUrl: './shared/studio-layout.scss',
})
export class StudioEntityDesignerComponent implements OnInit {
  private readonly studio = inject(StudioService);
  private readonly toast = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly route = inject(ActivatedRoute);
  private readonly capabilities = inject(StudioAiCapabilitiesService);

  readonly runtimeLabels = STUDIO_RUNTIME_LABELS;
  readonly labels = STUDIO_AI_LABELS;
  readonly manyToManyEnabled = computed(() =>
    this.capabilities.state() === 'ready' && this.capabilities.capabilities().manyToManyEnabled === true);
  readonly workflowsEnabled = computed(() =>
    this.capabilities.state() === 'ready' && this.capabilities.capabilities().workflowsEnabled === true);
  readonly relations = signal<EntityRelationDto[]>([]);
  readonly relationsLoading = signal(false);
  readonly m2mVisible = signal(false);

  /** 3.4l — vérification du changement de type (débounce 300 ms, `to` = nom d'enum). */
  readonly typeCheck = signal<StudioFieldTypeCheckDto | null>(null);
  readonly typeChecking = signal(false);
  private originalType: CustomFieldType | null = null;
  /** `null` annule la vérification en cours (retour au type d'origine, ouverture, fermeture). */
  private readonly typeCheck$ = new Subject<{ fieldId: string; type: CustomFieldType } | null>();

  constructor() {
    effect(() => { if (this.manyToManyEnabled() && this.entityId) this.loadRelations(); });
    this.typeCheck$.pipe(
      switchMap(req => req === null ? EMPTY : timer(300).pipe(
        switchMap(() => this.studio.checkFieldTypeChange(this.entityId, req.fieldId, CustomFieldType[req.type])),
        catchError(err => of({
          success: false,
          data: {
            from: '', to: CustomFieldType[req.type], policy: 'forbidden', recordCount: 0, allowed: false,
            message: err?.error?.message ?? this.labels.typeChange.forbidden
          } as StudioFieldTypeCheckDto
        }))
      )),
      takeUntilDestroyed(inject(DestroyRef))
    ).subscribe(res => {
      this.typeCheck.set(res.data ?? null);
      this.typeChecking.set(false);
    });
  }

  typeChanged(): boolean {
    return this.editing() && this.originalType !== null && this.fType !== this.originalType;
  }

  typeBlocked(): boolean {
    return this.typeChanged() && this.typeCheck()?.allowed === false;
  }

  typeSeverity(): 'info' | 'warn' | 'error' {
    const c = this.typeCheck();
    if (!c || c.policy === 'lossless') return 'info';
    return c.policy === 'requires_empty_table' ? 'warn' : 'error';
  }

  onTypeChange(type: CustomFieldType): void {
    if (!this.editing() || !this.editId) return;
    if (type === this.originalType) {
      this.resetTypeCheck();
      return;
    }
    this.typeChecking.set(true);
    this.typeCheck$.next({ fieldId: this.editId, type });
  }

  protected resetTypeCheck(): void {
    this.typeCheck$.next(null);
    this.typeCheck.set(null);
    this.typeChecking.set(false);
  }

  protected closeDialog(): void {
    this.dialogVisible = false;
    this.resetTypeCheck();
  }

  breadcrumbs = STUDIO_BREADCRUMBS.entities();

  readonly entity = signal<CustomEntity | null>(null);
  readonly fields = signal<CustomField[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly editing = signal(false);

  readonly typeOptions = FIELD_TYPE_OPTIONS;
  readonly allEntities = signal<CustomEntity[]>([]);
  readonly otherEntities = computed(() => this.allEntities().filter(e => e.id !== this.entityId));
  readonly existingRelationSources = [
    { label: 'Clients', value: 'clients' },
    { label: 'Produits', value: 'products' }
  ];
  readonly barcodeFormats = [
    { label: 'CODE128 (texte)', value: 'code128' },
    { label: 'EAN-13 (chiffres)', value: 'ean13' }
  ];
  readonly aggOptions = [
    { label: 'Nombre (count)', value: 'count' },
    { label: 'Somme (sum)', value: 'sum' },
    { label: 'Moyenne (avg)', value: 'avg' },
    { label: 'Minimum (min)', value: 'min' },
    { label: 'Maximum (max)', value: 'max' }
  ];
  private entityId = '';

  dialogVisible = false;
  private editId: string | null = null;
  fLabel = '';
  fKey = '';
  fType: CustomFieldType = CustomFieldType.Text;
  fRequired = false;
  fUnique = false;
  fOptionsText = '';
  fRelationRef: string | null = null;
  fMinLen: number | null = null;
  fMaxLen: number | null = null;
  fMin: number | null = null;
  fMax: number | null = null;
  fCurrency = 'TND';
  fRatingMax = 5;
  fCodeFormat = 'code128';
  fNumPrefix = '';
  fNumPadding = 4;
  fNumSuffix = '';
  fFormulaExpr = '';
  fLookupVia: string | null = null;
  fLookupTarget = '';
  fRollupEntity: string | null = null;
  fRollupRelationField = '';
  fRollupAgg = 'count';
  fRollupField = '';
  private keyTouched = false;

  ngOnInit(): void {
    this.entityId = this.route.snapshot.paramMap.get('id') ?? '';
    this.loadEntity();
    this.loadFields();
    this.capabilities.ensureLoaded();
    this.studio.listEntities(false).subscribe({ next: res => { if (res.success) this.allEntities.set(res.data ?? []); } });
  }

  loadRelations(): void {
    this.relationsLoading.set(true);
    this.studio.listEntityRelations(this.entityId).subscribe({
      next: res => { this.relationsLoading.set(false); if (res.success) this.relations.set(res.data ?? []); },
      error: () => this.relationsLoading.set(false)
    });
  }

  protected readonly relationKindLabel = relationKindLabel;

  onRelationCreated(): void {
    this.toast.add({ severity: 'success', summary: this.runtimeLabels.relations.title, detail: this.runtimeLabels.relations.created });
    this.loadRelations();
    this.loadFields();
  }

  loadEntity(): void {
    this.studio.getEntity(this.entityId).subscribe({
      next: res => {
        if (res.success) {
          this.entity.set(res.data);
          this.breadcrumbs = STUDIO_BREADCRUMBS.entityDesigner(res.data.displayName);
        }
      }
    });
  }

  loadFields(): void {
    this.loading.set(true);
    this.studio.listFields(this.entityId, true).subscribe({
      next: res => { this.loading.set(false); if (res.success) this.fields.set(res.data ?? []); },
      error: () => { this.loading.set(false); this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Chargement des champs impossible.' }); }
    });
  }

  typeLabel(t: CustomFieldType): string {
    return FIELD_TYPE_OPTIONS.find(o => o.value === t)?.label ?? String(t);
  }

  isSelect(): boolean { return this.fType === CustomFieldType.Select || this.fType === CustomFieldType.MultiSelect; }
  isText(): boolean { return this.fType === CustomFieldType.Text || this.fType === CustomFieldType.MultilineText; }
  isNumeric(): boolean { return this.fType === CustomFieldType.Number || this.fType === CustomFieldType.Decimal; }
  isMoney(): boolean { return this.fType === CustomFieldType.Money; }
  isPercentage(): boolean { return this.fType === CustomFieldType.Percentage; }
  isRating(): boolean { return this.fType === CustomFieldType.Rating; }
  isQr(): boolean { return this.fType === CustomFieldType.QrCode; }
  isBarcode(): boolean { return this.fType === CustomFieldType.Barcode; }
  isAutoNumber(): boolean { return this.fType === CustomFieldType.AutoNumber; }
  isFormula(): boolean { return this.fType === CustomFieldType.Formula; }
  isLookup(): boolean { return this.fType === CustomFieldType.Lookup; }
  isRollup(): boolean { return this.fType === CustomFieldType.Rollup; }

  /** Field keys (other than the one being edited) that a formula can reference. */
  otherFieldKeys(): string[] {
    return this.fields().filter(f => f.id !== this.editId).map(f => f.key);
  }

  /** Relation fields on this entity, usable as a lookup's "via". */
  relationFields(): { value: string; label: string }[] {
    return this.fields()
      .filter(f => f.fieldType === CustomFieldType.RelationCustom || f.fieldType === CustomFieldType.RelationExisting)
      .map(f => ({ value: f.key, label: `${f.label} (${f.key})` }));
  }

  autoNumberPreview(): string {
    const seq = '1'.padStart(Math.max(0, Math.min(12, this.fNumPadding || 0)), '0');
    return `${this.fNumPrefix || ''}${seq}${this.fNumSuffix || ''}`;
  }
  isRelationCustom(): boolean { return this.fType === CustomFieldType.RelationCustom; }
  isRelationExisting(): boolean { return this.fType === CustomFieldType.RelationExisting; }
  isRelation(): boolean { return this.isRelationCustom() || this.isRelationExisting(); }
  /** Money/Percentage reuse the numeric min/max validation rules. */
  private hasNumericRange(): boolean { return this.isNumeric() || this.isMoney() || this.isPercentage(); }

  openAdd(): void {
    this.editing.set(false);
    this.editId = null;
    this.originalType = null;
    this.resetTypeCheck();
    this.fLabel = this.fKey = this.fOptionsText = '';
    this.fType = CustomFieldType.Text;
    this.fRequired = this.fUnique = false;
    this.fRelationRef = null;
    this.fMinLen = this.fMaxLen = this.fMin = this.fMax = null;
    this.fCurrency = 'TND';
    this.fRatingMax = 5;
    this.fCodeFormat = 'code128';
    this.fNumPrefix = this.fNumSuffix = '';
    this.fNumPadding = 4;
    this.fFormulaExpr = '';
    this.fLookupVia = this.fRollupEntity = null;
    this.fLookupTarget = this.fRollupRelationField = this.fRollupField = '';
    this.fRollupAgg = 'count';
    this.keyTouched = false;
    this.dialogVisible = true;
  }

  openEdit(f: CustomField): void {
    this.editing.set(true);
    this.editId = f.id;
    this.fLabel = f.label;
    this.fKey = f.key;
    this.fType = f.fieldType;
    this.originalType = f.fieldType;
    this.resetTypeCheck();
    this.fRequired = f.isRequired;
    this.fUnique = f.isUnique;
    this.fOptionsText = (f.options ?? []).map(o => `${o.value}|${o.label}`).join('\n');
    this.fRelationRef = f.relation?.ref ?? null;
    this.fMinLen = f.rules?.minLength ?? null;
    this.fMaxLen = f.rules?.maxLength ?? null;
    this.fMin = f.rules?.min ?? null;
    this.fMax = f.rules?.max ?? null;
    // Per-type config is exposed nested in the read DTO (money.currency, rating.max, render.format).
    this.fCurrency = (f.config?.['money']?.['currency'] as string) || 'TND';
    this.fRatingMax = Number(f.config?.['rating']?.['max']) || 5;
    this.fCodeFormat = (f.config?.['render']?.['format'] as string) || 'code128';
    this.fNumPrefix = (f.config?.['number']?.['prefix'] as string) || '';
    this.fNumSuffix = (f.config?.['number']?.['suffix'] as string) || '';
    this.fNumPadding = Number(f.config?.['number']?.['padding']) || 4;
    this.fFormulaExpr = (f.config?.['formula']?.['expr'] as string) || '';
    this.fLookupVia = (f.config?.['lookup']?.['via'] as string) || null;
    this.fLookupTarget = (f.config?.['lookup']?.['target'] as string) || '';
    this.fRollupEntity = (f.config?.['rollup']?.['entity'] as string) || null;
    this.fRollupRelationField = (f.config?.['rollup']?.['relationField'] as string) || '';
    this.fRollupAgg = (f.config?.['rollup']?.['agg'] as string) || 'count';
    this.fRollupField = (f.config?.['rollup']?.['field'] as string) || '';
    this.keyTouched = true;
    this.dialogVisible = true;
  }

  onLabelChange(value: string): void {
    if (!this.editing() && !this.keyTouched) {
      this.fKey = (value || '').trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
    }
  }

  private parseOptions(): SelectOption[] {
    return this.fOptionsText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const [value, label] = line.split('|');
      return { value: value.trim(), label: (label ?? value).trim() };
    }).filter(o => o.value);
  }

  private buildRules(): Record<string, number | null> | null {
    if (this.isText()) {
      if (this.fMinLen == null && this.fMaxLen == null) return null;
      return { minLength: this.fMinLen, maxLength: this.fMaxLen };
    }
    if (this.hasNumericRange()) {
      if (this.fMin == null && this.fMax == null) return null;
      return { min: this.fMin, max: this.fMax };
    }
    return null;
  }

  /** Flat per-type settings consumed by the backend BuildOptionsJson (currency / max / format). */
  private buildConfig(): Record<string, unknown> | null {
    if (this.isMoney()) return { currency: (this.fCurrency || 'TND').trim().toUpperCase() };
    if (this.isRating()) return { max: this.fRatingMax };
    if (this.isBarcode()) return { format: this.fCodeFormat };
    if (this.isAutoNumber()) return { prefix: (this.fNumPrefix || '').trim(), padding: this.fNumPadding, suffix: (this.fNumSuffix || '').trim() };
    if (this.isFormula()) return { expr: (this.fFormulaExpr || '').trim() };
    if (this.isLookup()) return { via: this.fLookupVia || '', target: (this.fLookupTarget || '').trim() };
    if (this.isRollup()) return {
      entity: this.fRollupEntity || '', relationField: (this.fRollupRelationField || '').trim(),
      agg: this.fRollupAgg, field: (this.fRollupField || '').trim()
    };
    return null;
  }

  save(): void {
    if (this.typeBlocked() || this.typeChecking()) return;
    if (!this.fLabel.trim() || (!this.editing() && !this.fKey.trim())) {
      this.toast.add({ severity: 'warn', summary: 'Champs requis', detail: 'Libellé et clé obligatoires.' });
      return;
    }
    const options = this.isSelect() ? this.parseOptions() : null;
    if (this.isSelect() && (!options || options.length === 0)) {
      this.toast.add({ severity: 'warn', summary: 'Options requises', detail: 'Ajoutez au moins une option.' });
      return;
    }
    if (this.isRelation() && !this.fRelationRef) {
      this.toast.add({ severity: 'warn', summary: 'Cible requise', detail: 'Choisissez la cible de la relation.' });
      return;
    }
    if (this.isFormula() && !this.fFormulaExpr.trim()) {
      this.toast.add({ severity: 'warn', summary: 'Expression requise', detail: 'Saisissez l\'expression de la formule.' });
      return;
    }
    if (this.isLookup() && (!this.fLookupVia || !this.fLookupTarget.trim())) {
      this.toast.add({ severity: 'warn', summary: 'Recherche incomplète', detail: 'Choisissez le champ relation et le champ cible.' });
      return;
    }
    if (this.isRollup() && (!this.fRollupEntity || !this.fRollupRelationField.trim()
        || (this.fRollupAgg !== 'count' && !this.fRollupField.trim()))) {
      this.toast.add({ severity: 'warn', summary: 'Agrégat incomplet', detail: 'Renseignez la table enfant, le champ relation et le champ à agréger.' });
      return;
    }
    const relation = this.isRelationCustom()
      ? { kind: 'custom', ref: this.fRelationRef! }
      : this.isRelationExisting()
        ? { kind: 'existing', ref: this.fRelationRef! }
        : null;
    const rules = this.buildRules();
    const config = this.buildConfig();
    this.saving.set(true);

    const done = (ok: boolean, detail?: string) => {
      this.saving.set(false);
      if (ok) {
        this.dialogVisible = false;
        this.loadFields();
        this.loadEntity();
      } else {
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: detail ?? 'Échec.' });
      }
    };

    if (this.editing() && this.editId) {
      const fieldId = this.editId;
      const update$ = this.studio.updateField(this.entityId, fieldId, {
        label: this.fLabel.trim(), isRequired: this.fRequired, isUnique: this.fUnique,
        rules: rules as any, options, relation, isActive: true, config
      });
      const typeReq: ChangeCustomFieldTypeRequest = { fieldType: this.fType, options, rules: rules as any, relation, config };
      /** PATCH type réussi puis PUT en échec : la liste doit refléter le nouveau type. */
      let typeApplied = false;
      const save$ = this.typeChanged()
        ? this.studio.changeFieldType(this.entityId, fieldId, typeReq).pipe(
            tap(res => { typeApplied = res.success !== false; }),
            switchMap(() => update$)
          )
        : update$;
      save$.subscribe({
        next: res => done(res.success, res.errors?.[0] ?? res.message ?? undefined),
        error: err => {
          if (typeApplied) {
            this.loadFields();
            this.loadEntity();
          }
          done(false, err?.error?.message);
        }
      });
    } else {
      this.studio.createField(this.entityId, {
        key: this.fKey.trim().toLowerCase(), label: this.fLabel.trim(), fieldType: this.fType,
        isRequired: this.fRequired, isUnique: this.fUnique, rules: rules as any, options, relation, config
      }).subscribe({
        next: res => done(res.success, res.errors?.[0] ?? res.message ?? undefined),
        error: err => done(false, err?.error?.message)
      });
    }
  }

  remove(f: CustomField): void {
    this.confirmation.confirm({
      message: `Supprimer le champ « ${f.label} » ? Les données existantes sont conservées.`,
      header: 'Confirmation',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      accept: () => {
        this.studio.deleteField(this.entityId, f.id).subscribe({
          next: res => { if (res.success) this.loadFields(); },
          error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Suppression impossible.' })
        });
      }
    });
  }

  move(index: number, delta: number): void {
    const arr = [...this.fields()];
    const target = index + delta;
    if (target < 0 || target >= arr.length) return;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    this.fields.set(arr);
    this.studio.reorderFields(this.entityId, arr.map(f => f.id)).subscribe({
      error: () => { this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Réordonnancement impossible.' }); this.loadFields(); }
    });
  }
}
