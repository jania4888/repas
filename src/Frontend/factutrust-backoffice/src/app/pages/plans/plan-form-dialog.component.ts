import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { CheckboxModule } from 'primeng/checkbox';
import { TabsModule } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';

import {
  BillingPeriod,
  type BillingPeriodValue,
  type PlanDto,
  type PlanFeatureDto,
  type PlanLimitDto,
  type PlanModuleDto
} from '@core/models/platform.models';
import type {
  CreatePlanRequest,
  UpdatePlanRequest
} from '@core/services/platform-plans.service';

import { PLANS_FR } from './plans.i18n.fr';

interface ModuleRow {
  module: number;
  display: string;
  isIncluded: boolean;
}

interface FeatureRow {
  featureKey: string;
  enabled: boolean;
}

interface LimitRow {
  key: string;
  value: string;
}

/** Catalogue des modules AppModule (mirror du back, valeurs 0–16). */
const MODULE_CATALOG: { value: number; display: string }[] = [
  { value: 0, display: 'Clients' },
  { value: 1, display: 'Produits et services' },
  { value: 2, display: 'Ventes (factures)' },
  { value: 3, display: 'Trésorerie (paiements)' },
  { value: 4, display: 'Rapports' },
  { value: 5, display: 'Paramètres et utilisateurs' },
  { value: 6, display: 'Achats' },
  { value: 7, display: 'Stock' },
  { value: 8, display: 'Comptabilité' },
  { value: 9, display: 'CRM Commercial' },
  { value: 10, display: 'Fiscal / TEJ' },
  { value: 11, display: 'Assistant IA' },
  { value: 12, display: 'Prévisions IA' },
  { value: 13, display: 'Studio (low-code)' },
  { value: 14, display: 'RH & Paie' },
  { value: 15, display: 'Honoraires' },
  { value: 16, display: 'Projets' }
];

const DEFAULT_FEATURE_KEYS = [
  'ElectronicSignature',
  'XmlExport',
  'PaymentTracking',
  'PrioritySupport'
];

const DEFAULT_LIMIT_KEYS = [
  'MaxInvoicesPerMonth',
  'MaxQuotesPerMonth',
  'MaxClients',
  'MaxProducts',
  'MaxStorageBytes',
  'MaxUsers'
];

/**
 * Lot C1 — Dialog création/édition d'un plan tarifaire.
 *
 * Tab 1 « Général » : code, nom, description, période, prix, devise, trial, ordre, public.
 * Tab 2 « Limites » : table éditable {key, value} (string pour autoriser "∞").
 * Tab 3 « Features » : table key + boolean.
 * Tab 4 « Modules » : 13 cases à cocher pour les AppModule.
 */
@Component({
  selector: 'app-plan-form-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    DialogModule,
    ButtonModule,
    InputTextModule,
    Textarea,
    InputNumberModule,
    ToggleSwitchModule,
    SelectModule,
    TableModule,
    CheckboxModule,
    TabsModule,
    TooltipModule
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="onVisibleChange($event)"
      [modal]="true"
      [closable]="!busy"
      [draggable]="false"
      [resizable]="false"
      [style]="{ width: '52rem', maxWidth: '95vw' }"
      [header]="isEdit() ? t('form.title.edit') : t('form.title.create')">

      <p-tabs class="ft-tab-view" [lazy]="true">
        <p-tablist>
          <p-tab [value]="0"><i class="pi pi-info-circle"></i><span>{{ t('form.tab.general') }}</span></p-tab>
          <p-tab [value]="1"><i class="pi pi-sliders-h"></i><span>{{ t('form.tab.limits') }}</span></p-tab>
          <p-tab [value]="2"><i class="pi pi-bolt"></i><span>{{ t('form.tab.features') }}</span></p-tab>
          <p-tab [value]="3"><i class="pi pi-th-large"></i><span>{{ t('form.tab.modules') }}</span></p-tab>
        </p-tablist>
        <p-tabpanels>
        <!-- TAB GENERAL -->
        <p-tabpanel [value]="0">
          <div class="grid">
            <div class="field">
              <label for="pf-code">{{ t('form.field.code') }}</label>
              <input
                id="pf-code"
                type="text"
                pInputText
                [(ngModel)]="code"
                [disabled]="busy || isEdit()"
                maxlength="50"
                class="w-full upper" />
              @if (!isEdit()) {
                <small class="hint">{{ t('form.field.code.hint') }}</small>
              }
            </div>
            <div class="field">
              <label for="pf-name">{{ t('form.field.name') }}</label>
              <input
                id="pf-name"
                type="text"
                pInputText
                [(ngModel)]="name"
                [disabled]="busy"
                maxlength="100"
                class="w-full" />
            </div>
            <div class="field field--full">
              <label for="pf-desc">{{ t('form.field.description') }}</label>
              <textarea
                id="pf-desc"
                pTextarea
                rows="2"
                [(ngModel)]="description"
                [disabled]="busy"
                maxlength="500"
                class="w-full"></textarea>
            </div>
            <div class="field">
              <label for="pf-period">{{ t('form.field.billingPeriod') }}</label>
              <p-select
                inputId="pf-period"
                [options]="periodOptions"
                [(ngModel)]="billingPeriod"
                optionLabel="label"
                optionValue="value"
                [disabled]="busy"
                styleClass="w-full" />
            </div>
            <div class="field">
              <label for="pf-price">{{ t('form.field.basePriceTND') }}</label>
              <p-inputNumber
                inputId="pf-price"
                [(ngModel)]="basePriceTND"
                [min]="0"
                [maxFractionDigits]="3"
                [disabled]="busy"
                styleClass="w-full" />
            </div>
            <div class="field">
              <label for="pf-trial">{{ t('form.field.trialDays') }}</label>
              <p-inputNumber
                inputId="pf-trial"
                [(ngModel)]="trialDays"
                [min]="0"
                [max]="365"
                [disabled]="busy"
                styleClass="w-full" />
            </div>
            <div class="field">
              <label for="pf-order">{{ t('form.field.sortOrder') }}</label>
              <p-inputNumber
                inputId="pf-order"
                [(ngModel)]="sortOrder"
                [min]="0"
                [max]="999"
                [disabled]="busy"
                styleClass="w-full" />
            </div>
            <div class="field">
              <label for="pf-currency">{{ t('form.field.currency') }}</label>
              <input
                id="pf-currency"
                type="text"
                pInputText
                [(ngModel)]="currency"
                [disabled]="busy"
                minlength="3"
                maxlength="3"
                class="w-full upper" />
            </div>
            <div class="field field--full">
              <label class="checkbox">
                <p-toggleswitch [(ngModel)]="isPublic" [disabled]="busy" />
                <span>{{ t('form.field.isPublic') }}</span>
              </label>
            </div>
          </div>
        </p-tabpanel>

        <!-- TAB LIMITS -->
        <p-tabpanel [value]="1">
          <div class="row-actions">
            <p-button
              [label]="t('form.limits.add')"
              icon="pi pi-plus"
              size="small"
              [outlined]="true"
              [disabled]="busy"
              (onClick)="addLimit()" />
            <small class="hint">{{ t('form.limits.hint') }}</small>
          </div>
          <p-table [value]="limits()" styleClass="p-datatable-sm ft-table">
            <ng-template pTemplate="header">
              <tr>
                <th>{{ t('form.limits.key') }}</th>
                <th>{{ t('form.limits.value') }}</th>
                <th></th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row let-i="rowIndex">
              <tr>
                <td>
                  <input
                    type="text"
                    pInputText
                    [(ngModel)]="row.key"
                    [disabled]="busy"
                    placeholder="MaxInvoicesPerMonth"
                    class="w-full mono" />
                </td>
                <td>
                  <input
                    type="text"
                    pInputText
                    [(ngModel)]="row.value"
                    [disabled]="busy"
                    placeholder="100 ou ∞"
                    class="w-full mono" />
                </td>
                <td class="cell-action">
                  <p-button
                    icon="pi pi-trash"
                    severity="danger"
                    [text]="true"
                    [disabled]="busy"
                    (onClick)="removeLimit(i)" />
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="3" class="empty-row">{{ t('form.limits.empty') }}</td>
              </tr>
            </ng-template>
          </p-table>
        </p-tabpanel>

        <!-- TAB FEATURES -->
        <p-tabpanel [value]="2">
          <div class="row-actions">
            <p-button
              [label]="t('form.features.add')"
              icon="pi pi-plus"
              size="small"
              [outlined]="true"
              [disabled]="busy"
              (onClick)="addFeature()" />
            <small class="hint">{{ t('form.features.hint') }}</small>
          </div>
          <p-table [value]="features()" styleClass="p-datatable-sm ft-table">
            <ng-template pTemplate="header">
              <tr>
                <th>{{ t('form.features.key') }}</th>
                <th>{{ t('form.features.enabled') }}</th>
                <th></th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row let-i="rowIndex">
              <tr>
                <td>
                  <input
                    type="text"
                    pInputText
                    [(ngModel)]="row.featureKey"
                    [disabled]="busy"
                    placeholder="ElectronicSignature"
                    class="w-full mono" />
                </td>
                <td>
                  <p-toggleswitch [(ngModel)]="row.enabled" [disabled]="busy" />
                </td>
                <td class="cell-action">
                  <p-button
                    icon="pi pi-trash"
                    severity="danger"
                    [text]="true"
                    [disabled]="busy"
                    (onClick)="removeFeature(i)" />
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="3" class="empty-row">{{ t('form.features.empty') }}</td>
              </tr>
            </ng-template>
          </p-table>
        </p-tabpanel>

        <!-- TAB MODULES -->
        <p-tabpanel [value]="3">
          <p class="hint">{{ t('form.modules.hint') }}</p>
          <div class="modules-grid">
            @for (m of modules(); track m.module) {
              <label class="module-card" [class.included]="m.isIncluded">
                <p-checkbox
                  [(ngModel)]="m.isIncluded"
                  [binary]="true"
                  [disabled]="busy" />
                <span class="module-label">{{ m.display }}</span>
              </label>
            }
          </div>
        </p-tabpanel>
        </p-tabpanels>
      </p-tabs>

      <ng-template pTemplate="footer">
        <p-button label="Annuler" [text]="true" severity="secondary" [disabled]="busy" (onClick)="onCancel()" />
        <p-button
          [label]="isEdit() ? t('form.confirm.update') : t('form.confirm.create')"
          icon="pi pi-check"
          severity="primary"
          [disabled]="busy || !canConfirm()"
          [loading]="busy"
          (onClick)="onConfirm()" />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--gap-md, 1rem);
        padding-top: 0.6rem;
      }
      @media (max-width: 540px) { .grid { grid-template-columns: 1fr; } }
      .field { display: flex; flex-direction: column; gap: 0.35rem; }
      .field--full { grid-column: 1 / -1; }
      .field label {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ft-text-muted, #8b949e);
        font-weight: 600;
      }
      .checkbox { flex-direction: row; align-items: center; gap: 0.6rem; }
      .upper { text-transform: uppercase; }
      .mono { font-family: var(--font-mono, ui-monospace); font-size: 0.88rem; }
      .hint {
        color: var(--ft-text-subtle, #6e7681);
        font-size: 0.78rem;
        margin: 0;
      }

      .row-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.6rem;
      }
      .cell-action { width: 3rem; text-align: right; }
      .empty-row {
        text-align: center;
        color: var(--ft-text-subtle);
        font-style: italic;
        padding: 1rem 0;
      }

      .modules-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--gap-sm, 0.5rem);
        margin-top: 0.6rem;
      }
      @media (max-width: 720px) { .modules-grid { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 480px) { .modules-grid { grid-template-columns: 1fr; } }
      .module-card {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        padding: 0.6rem 0.75rem;
        border: 1px solid var(--ft-border, #30363d);
        border-radius: var(--ft-radius, 8px);
        cursor: pointer;
        transition: border-color var(--duration-fast, 120ms) var(--easing-standard, ease),
          background var(--duration-fast, 120ms) var(--easing-standard, ease);
      }
      .module-card.included {
        border-color: var(--ft-accent, #58a6ff);
        background: var(--ft-accent-surface, rgba(88, 166, 255, 0.10));
      }
      .module-card:hover {
        border-color: var(--ft-accent-border, rgba(88, 166, 255, 0.4));
      }
      .module-label { font-size: 0.9rem; color: var(--ft-text); }

      :host ::ng-deep .w-full { width: 100%; }
      :host ::ng-deep .p-inputnumber { width: 100%; }
      :host ::ng-deep .ft-tab-view .p-tablist-tab-list {
        background: transparent;
        border-bottom: 1px solid var(--ft-border, #30363d);
      }
      :host ::ng-deep .ft-tab-view .p-tab {
        background: transparent;
        color: var(--ft-text-muted);
        border-color: transparent;
      }
      :host ::ng-deep .ft-tab-view .p-tab.p-tab-active {
        color: var(--ft-accent);
        border-color: var(--ft-accent);
      }
      :host ::ng-deep .ft-tab-view .p-tabpanels {
        background: transparent;
        padding: 0.85rem 0 0;
      }
    `
  ]
})
export class PlanFormDialogComponent implements OnChanges {
  @Input() visible = false;
  @Input() editing: PlanDto | null = null;
  @Input() busy = false;

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() confirmed = new EventEmitter<{
    isEdit: boolean;
    id?: string;
    create?: CreatePlanRequest;
    update?: UpdatePlanRequest;
  }>();
  @Output() cancelled = new EventEmitter<void>();

  protected code = '';
  protected name = '';
  protected description = '';
  protected billingPeriod: BillingPeriodValue = 1; // Monthly par défaut
  protected basePriceTND = 0;
  protected trialDays = 0;
  protected sortOrder = 0;
  protected currency = 'TND';
  protected isPublic = true;

  protected readonly limits = signal<LimitRow[]>([]);
  protected readonly features = signal<FeatureRow[]>([]);
  protected readonly modules = signal<ModuleRow[]>(this.buildEmptyModules());

  protected readonly periodOptions = [
    { label: 'Gratuit', value: BillingPeriod.Free },
    { label: 'Mensuel', value: BillingPeriod.Monthly },
    { label: 'Annuel', value: BillingPeriod.Annual },
    { label: 'Paiement unique', value: BillingPeriod.OneShot }
  ];

  protected readonly isEdit = computed(() => this.editing !== null);

  protected readonly canConfirm = computed(() => {
    return (
      (this.isEdit() || (this.code.trim().length >= 2 && /^[A-Z0-9_-]+$/i.test(this.code.trim())))
      && this.name.trim().length >= 2
      && this.basePriceTND >= 0
      && this.currency.trim().length === 3
    );
  });

  protected t(key: keyof typeof PLANS_FR): string {
    return (PLANS_FR as Record<string, string>)[key] ?? key;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      if (this.editing) {
        this.applyEditing(this.editing);
      } else {
        this.resetState();
      }
    }
  }

  private resetState(): void {
    this.code = '';
    this.name = '';
    this.description = '';
    this.billingPeriod = 1;
    this.basePriceTND = 0;
    this.trialDays = 0;
    this.sortOrder = 0;
    this.currency = 'TND';
    this.isPublic = true;
    this.limits.set(DEFAULT_LIMIT_KEYS.map(k => ({ key: k, value: '' })));
    this.features.set(DEFAULT_FEATURE_KEYS.map(k => ({ featureKey: k, enabled: false })));
    this.modules.set(this.buildEmptyModules());
  }

  private applyEditing(p: PlanDto): void {
    this.code = p.code;
    this.name = p.name;
    this.description = p.description ?? '';
    this.billingPeriod = p.billingPeriod;
    this.basePriceTND = p.basePriceTND;
    this.trialDays = p.trialDays;
    this.sortOrder = p.sortOrder;
    this.currency = p.currency || 'TND';
    this.isPublic = p.isPublic;

    this.limits.set(
      p.limits.length > 0
        ? p.limits.map(l => ({ key: l.key, value: l.value }))
        : DEFAULT_LIMIT_KEYS.map(k => ({ key: k, value: '' }))
    );
    this.features.set(
      p.features.length > 0
        ? p.features.map(f => ({ featureKey: f.featureKey, enabled: f.enabled }))
        : DEFAULT_FEATURE_KEYS.map(k => ({ featureKey: k, enabled: false }))
    );

    const incluedSet = new Set(p.modules.filter(m => m.isIncluded).map(m => m.module));
    this.modules.set(MODULE_CATALOG.map(m => ({
      module: m.value,
      display: m.display,
      isIncluded: incluedSet.has(m.value)
    })));
  }

  private buildEmptyModules(): ModuleRow[] {
    return MODULE_CATALOG.map(m => ({ module: m.value, display: m.display, isIncluded: false }));
  }

  // ─── Limits / Features actions ────────────────────────────────────────────

  addLimit(): void {
    this.limits.update(rows => [...rows, { key: '', value: '' }]);
  }

  removeLimit(index: number): void {
    this.limits.update(rows => rows.filter((_, i) => i !== index));
  }

  addFeature(): void {
    this.features.update(rows => [...rows, { featureKey: '', enabled: false }]);
  }

  removeFeature(index: number): void {
    this.features.update(rows => rows.filter((_, i) => i !== index));
  }

  // ─── Outputs ──────────────────────────────────────────────────────────────

  onVisibleChange(v: boolean): void {
    this.visible = v;
    this.visibleChange.emit(v);
  }

  onCancel(): void {
    this.cancelled.emit();
    this.onVisibleChange(false);
  }

  onConfirm(): void {
    if (!this.canConfirm() || this.busy) return;

    const cleanLimits: PlanLimitDto[] = this.limits()
      .filter(l => l.key.trim().length > 0)
      .map(l => ({ key: l.key.trim(), value: (l.value ?? '').trim() }));
    const cleanFeatures: PlanFeatureDto[] = this.features()
      .filter(f => f.featureKey.trim().length > 0)
      .map(f => ({ featureKey: f.featureKey.trim(), enabled: !!f.enabled }));
    const cleanModules: PlanModuleDto[] = this.modules().map(m => ({
      module: m.module,
      moduleDisplay: m.display,
      isIncluded: !!m.isIncluded
    }));

    const description = this.description?.trim() || undefined;
    const currency = (this.currency || 'TND').trim().toUpperCase();

    if (this.isEdit() && this.editing) {
      const update: UpdatePlanRequest = {
        name: this.name.trim(),
        description,
        billingPeriod: this.billingPeriod,
        basePriceTND: this.basePriceTND,
        isPublic: this.isPublic,
        trialDays: this.trialDays,
        sortOrder: this.sortOrder,
        currency,
        limits: cleanLimits,
        features: cleanFeatures,
        modules: cleanModules
      };
      this.confirmed.emit({ isEdit: true, id: this.editing.id, update });
    } else {
      const create: CreatePlanRequest = {
        code: this.code.trim().toUpperCase(),
        name: this.name.trim(),
        description,
        billingPeriod: this.billingPeriod,
        basePriceTND: this.basePriceTND,
        isPublic: this.isPublic,
        trialDays: this.trialDays,
        sortOrder: this.sortOrder,
        currency,
        limits: cleanLimits,
        features: cleanFeatures,
        modules: cleanModules
      };
      this.confirmed.emit({ isEdit: false, create });
    }
  }
}
