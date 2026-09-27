/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, Input, OnChanges, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonComponent } from '@shared/components/button/button.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import {
  RecurringContractDetail,
  RecurringContractService,
  UsageMetric,
  UsageRecord
} from '@core/services/recurring-contract.service';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { formatContractAmount, parseUsageRecordsCsv } from '../recurring-contracts.ui-utils';
import { fixedMonthlyEstimate } from '../contract-detail.vm';
import { UsageMetricDialogComponent } from '../components/usage-metric-dialog.component';

/**
 * Onglet « Services » : lignes du contrat, saisie et historique des consommations
 * (filtre de période + import CSV), gestion des métriques.
 */
@Component({
  selector: 'app-contract-services-tab',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule, FormsModule, TableModule,
    ButtonComponent, SkeletonTableComponent, UsageMetricDialogComponent
  ],
  template: `
    <section class="ft-card-block">
      <h3 class="block-title"><i class="pi pi-list"></i> Lignes du contrat</h3>
      @if (contract.lines.length === 0) {
        <p class="placeholder-note">Aucune ligne de service.</p>
      } @else {
        <p-table [value]="contract.lines" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Type</th>
              <th>Produit</th>
              <th>Description</th>
              <th style="width: 70px">Qté</th>
              <th style="width: 120px">Prix HT</th>
              <th style="width: 70px">TVA</th>
              <th>Métrique / Inclus / Dépassement</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-line>
            <tr [class.line-inactive]="line.isActive === false">
              <td>
                {{ (line.lineTypeDisplay | backendLabel) || line.lineType }}
                @if (line.isActive === false) {
                  <span class="closed-tag">Clôturée</span>
                }
              </td>
              <td>{{ line.productName || '—' }}</td>
              <td>{{ line.description }}</td>
              <td>{{ line.quantity }}</td>
              <td class="amount">{{ line.unitPriceHT | currency:contract.currency:'symbol':'1.3-3' }}</td>
              <td>{{ line.vatRate }}%</td>
              <td>
                @if (line.lineType === 'UsageMetered') {
                  {{ line.usageMetricName || '—' }}
                  / {{ line.includedQuantity ?? '—' }}
                  / {{ line.overageUnitPriceHT != null ? formatContractAmount(line.overageUnitPriceHT, contract.currency) : '—' }}
                } @else {
                  <span class="muted">—</span>
                }
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            <tr class="lines-total">
              <td colspan="7">
                Estimation mensuelle (lignes fixes) :
                <strong>{{ monthlyEstimate != null ? formatContractAmount(monthlyEstimate, contract.currency) : '—' }}</strong>
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </section>

    <section class="ft-card-block">
      <div class="block-head">
        <h3 class="block-title"><i class="pi pi-chart-bar"></i> Consommations</h3>
        @if (canManage()) {
          <app-button variant="outline" size="sm" icon="pi-sliders-h" (clicked)="metricsDialogVisible = true">
            Gérer les métriques
          </app-button>
        }
      </div>

      @if (canRecordUsage()) {
        <form class="usage-form" (ngSubmit)="submitUsage()">
          <label>Métrique
            <select class="ft-input" [(ngModel)]="usageMetricId" name="usageMetric" required>
              <option value="">— Métrique —</option>
              @for (m of activeMetrics(); track m.id) {
                <option [value]="m.id">{{ m.name }} ({{ m.unit }})</option>
              }
            </select>
          </label>
          <label>Du
            <input class="ft-input" type="date" [(ngModel)]="usagePeriodFrom" name="usageFrom" required />
          </label>
          <label>Au
            <input class="ft-input" type="date" [(ngModel)]="usagePeriodTo" name="usageTo" required />
          </label>
          <label>Quantité
            <input class="ft-input" type="number" min="0" step="any" [(ngModel)]="usageQuantity" name="usageQty" required />
          </label>
          <label>Notes
            <input class="ft-input" [(ngModel)]="usageNotes" name="usageNotes" placeholder="Optionnel" />
          </label>
          <div class="usage-actions">
            <app-button type="submit" variant="primary" size="sm" icon="pi-check" [disabled]="savingUsage()">
              Enregistrer
            </app-button>
            <app-button
              type="button"
              variant="outline"
              size="sm"
              icon="pi-upload"
              [disabled]="importing()"
              (clicked)="fileInput.click()">
              {{ importing() ? 'Import…' : 'Importer (CSV)' }}
            </app-button>
            <input
              #fileInput
              type="file"
              accept=".csv,text/csv"
              class="visually-hidden"
              (change)="onImportFile($event)" />
          </div>
        </form>
        <p class="csv-hint">CSV « code métrique ; du ; au ; quantité ; notes » (séparateur « ; », dates ISO ou jj/mm/aaaa).</p>
      }

      <div class="history-filter">
        <label>Historique du
          <input class="ft-input" type="date" [(ngModel)]="filterFrom" name="filterFrom" />
        </label>
        <label>au
          <input class="ft-input" type="date" [(ngModel)]="filterTo" name="filterTo" />
        </label>
        <app-button variant="outline" size="sm" icon="pi-filter" (clicked)="loadRecords()">Filtrer</app-button>
      </div>

      @if (loadingRecords()) {
        <app-skeleton-table [rows]="4" [columns]="recordsSkeletonColumns"></app-skeleton-table>
      } @else if (usageRecords().length === 0) {
        <p class="placeholder-note">Aucune saisie de consommation sur la période.</p>
      } @else {
        <p-table [value]="usageRecords()" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Métrique</th>
              <th>Période</th>
              <th style="width: 100px">Quantité</th>
              <th style="width: 110px">Source</th>
              <th>Notes</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr>
              <td>{{ r.usageMetricName }}</td>
              <td>{{ r.periodFrom | date:'dd/MM/yyyy' }} — {{ r.periodTo | date:'dd/MM/yyyy' }}</td>
              <td>{{ r.quantity | number:'1.0-3' }}</td>
              <td>{{ r.sourceDisplay }}</td>
              <td>{{ r.notes || '—' }}</td>
            </tr>
          </ng-template>
        </p-table>
      }
    </section>

    <app-usage-metric-dialog
      [(visible)]="metricsDialogVisible"
      [metrics]="usageMetrics()"
      [products]="products()"
      (saved)="onMetricsSaved()">
    </app-usage-metric-dialog>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: var(--spacing-4); }

    .ft-card-block {
      background: var(--color-background-elevated);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-soft-sm, var(--shadow-sm));
      padding: var(--spacing-4);
    }

    .block-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0 0 var(--spacing-3);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-700);
      text-transform: uppercase;
      letter-spacing: 0.05em;

      .pi { color: var(--color-primary-600); }
    }

    .block-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-3);

      .block-title { margin-bottom: 0; }
    }

    .amount {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      white-space: nowrap;
    }

    .muted { color: var(--color-neutral-400); }

    .line-inactive td { color: var(--color-text-tertiary); }

    .closed-tag {
      margin-left: var(--spacing-1);
      padding: 0 var(--spacing-2);
      border-radius: var(--radius-full);
      background: var(--color-neutral-100);
      color: var(--color-text-tertiary);
      font-size: var(--font-size-xs);
    }

    .lines-total td {
      text-align: right;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);

      strong {
        font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
        color: var(--color-text-primary);
      }
    }

    .usage-form {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: var(--spacing-3);
      align-items: end;
      margin-bottom: var(--spacing-2);
    }

    .usage-actions { display: flex; gap: var(--spacing-2); flex-wrap: wrap; }

    .csv-hint {
      margin: 0 0 var(--spacing-4);
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .history-filter {
      display: flex;
      gap: var(--spacing-3);
      align-items: end;
      flex-wrap: wrap;
      margin-bottom: var(--spacing-3);
    }

    label {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .ft-input {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      font-family: inherit;
      background: var(--color-background-elevated);
      color: var(--color-text-primary);
    }

    .ft-input:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 1px;
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .placeholder-note {
      margin: 0;
      color: var(--color-text-tertiary);
      font-size: var(--font-size-sm);
    }
  `]
})
export class ContractServicesTabComponent implements OnInit, OnChanges {
  @Input({ required: true }) contract!: RecurringContractDetail;
  @Input() refreshToken = 0;

  private readonly service = inject(RecurringContractService);
  private readonly productService = inject(ProductService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);

  readonly usageRecords = signal<UsageRecord[]>([]);
  readonly usageMetrics = signal<UsageMetric[]>([]);
  readonly products = signal<ProductListItem[]>([]);
  readonly loadingRecords = signal(true);
  readonly savingUsage = signal(false);
  readonly importing = signal(false);
  private initialized = false;

  metricsDialogVisible = false;

  usageMetricId = '';
  usagePeriodFrom = '';
  usagePeriodTo = '';
  usageQuantity: number | null = null;
  usageNotes = '';
  filterFrom = '';
  filterTo = '';

  readonly canRecordUsage = computed(() => this.auth.hasPermission(PERMISSIONS.recurringContracts.recordUsage));
  readonly canManage = computed(() => this.auth.hasPermission(PERMISSIONS.recurringContracts.manage));

  readonly activeMetrics = computed(() => this.usageMetrics().filter(m => m.isActive));

  readonly recordsSkeletonColumns: SkeletonColumn[] = [
    { width: '180px' }, { width: '220px' }, { width: '100px' }, { width: '110px' }, { width: '200px' }
  ];

  protected readonly formatContractAmount = formatContractAmount;

  get monthlyEstimate(): number | null {
    return fixedMonthlyEstimate(this.contract);
  }

  ngOnInit(): void {
    this.initialized = true;
    this.loadMetrics();
    this.loadRecords();
    // Le catalogue produit est un confort (selects) : une 403 ne doit rien bloquer.
    this.productService.getProducts({ pageSize: 200 }).subscribe({
      next: res => this.products.set(res.data?.items ?? []),
      error: () => this.products.set([])
    });
  }

  ngOnChanges(): void {
    if (this.initialized) this.loadRecords();
  }

  loadMetrics(): void {
    this.service.listUsageMetrics().subscribe({
      next: m => this.usageMetrics.set(m),
      error: err => {
        this.errorHandler.logError('RecurringContracts: usage metrics', err);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-services.tab.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }

  loadRecords(): void {
    this.loadingRecords.set(true);
    this.service.listUsageRecords(this.contract.id, this.filterFrom || undefined, this.filterTo || undefined)
      .subscribe({
        next: records => {
          this.usageRecords.set(records);
          this.loadingRecords.set(false);
        },
        error: err => {
          this.loadingRecords.set(false);
          this.errorHandler.logError('RecurringContracts: usage records', err);
          this.toast.add({ severity: 'error', summary: $localize`:@@contract-services.tab.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
        }
      });
  }

  submitUsage(): void {
    if (!this.usageMetricId) return;
    if (!this.usageQuantity || this.usageQuantity <= 0) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@contract-services.tab.summary.Saisie_invalide:Saisie invalide`, detail: $localize`:@@contract-services.tab.detail.La_quantit_doit:La quantité doit être supérieure à 0.` });
      return;
    }
    if (this.usagePeriodFrom && this.usagePeriodTo && this.usagePeriodTo < this.usagePeriodFrom) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@contract-services.tab.summary.Saisie_invalide:Saisie invalide`, detail: $localize`:@@contract-services.tab.detail.La_fin_de_p_riod:La fin de période doit être postérieure au début.` });
      return;
    }
    this.savingUsage.set(true);
    this.service.recordUsage(this.contract.id, {
      usageMetricId: this.usageMetricId,
      periodFrom: this.usagePeriodFrom,
      periodTo: this.usagePeriodTo,
      quantity: this.usageQuantity,
      notes: this.usageNotes || undefined
    }).subscribe({
      next: () => {
        this.savingUsage.set(false);
        this.usageQuantity = null;
        this.usageNotes = '';
        this.toast.add({ severity: 'success', summary: $localize`:@@contract-services.tab.summary.Consommation_enr:Consommation enregistrée`, detail: $localize`:@@contract-services.tab.detail.La_saisie_a_t_:La saisie a été prise en compte.` });
        this.loadRecords();
      },
      error: err => {
        this.savingUsage.set(false);
        this.errorHandler.logError('RecurringContracts: record usage', err);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-services.tab.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }

  onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.importing.set(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = parseUsageRecordsCsv(String(reader.result ?? ''));
        if (result.error) {
          this.importing.set(false);
          this.toast.add({ severity: 'error', summary: $localize`:@@contract-services.tab.summary.Import impos:Import impossible`, detail: result.error });
          return;
        }
        this.service.importUsageRecords(this.contract.id, result.rows).subscribe({
          next: count => {
            this.importing.set(false);
            this.toast.add({
              severity: 'success',
              summary: $localize`:@@contract-services.tab.summary.Import_termin_:Import terminé`,
              detail: `${count} ligne(s) importée(s).`
            });
            this.loadRecords();
          },
          error: err => {
            this.importing.set(false);
            this.errorHandler.logError('RecurringContracts: import usage', err);
            this.toast.add({ severity: 'error', summary: $localize`:@@contract-services.tab.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
          }
        });
      } catch (e) {
        this.importing.set(false);
        this.errorHandler.logError('RecurringContracts: import parse', e);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-services.tab.summary.Import impos:Import impossible`, detail: $localize`:@@contract-services.tab.detail.Le fichier C:Le fichier CSV est illisible.` });
      }
    };
    reader.onerror = () => {
      this.importing.set(false);
      this.toast.add({ severity: 'error', summary: $localize`:@@contract-services.tab.summary.Import impos:Import impossible`, detail: $localize`:@@contract-services.tab.detail.Le_fichier_n_a_p:Le fichier n'a pas pu être lu.` });
    };
    reader.readAsText(file);
  }

  onMetricsSaved(): void {
    this.loadMetrics();
  }
}
