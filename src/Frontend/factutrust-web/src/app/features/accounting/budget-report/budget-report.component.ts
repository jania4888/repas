import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { AccountingService, BudgetReportDto } from '../services/accounting.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

@Component({
  selector: 'app-budget-report',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    AccountingFilterBarComponent,
    TableTotalsBarComponent
  ],
  template: `
    <app-page-header title="État budgétaire" i18n-title="État budgétaire" subtitle="Budget (Initial / Révisé) vs réalisé par poste — écart et taux de consommation" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" [showRetry]="!!error()" retryLabel="Réessayer" (retry)="load()" />

    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Filtres de l'état budgétaire">
        <div accountingFilterFields class="br-fields">
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="br-year" i18n="@@accounting.budget-report.exercice.e171e2b0">Exercice</label>
            <input id="br-year" type="number" class="accounting-filter-input br-year-inp" [(ngModel)]="fiscalYear" [disabled]="loading()" />
          </div>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="br-month" i18n="@@accounting.budget-report.cumul.jusqu.au.mois.11cf4d39">Cumul jusqu'au mois</label>
            <select id="br-month" class="accounting-filter-input" [(ngModel)]="throughMonth" [disabled]="loading()">
              @for (m of monthNames; track m; let i = $index) {
                <option [ngValue]="i + 1">{{ m }}</option>
              }
            </select>
          </div>
        </div>
        <div accountingFilterActions class="br-actions">
          <app-button variant="secondary" icon="pi pi-refresh" type="button" (click)="load()" [disabled]="loading()" i18n="@@accounting.budget-report.actualiser.9d3b2a7d">Actualiser</app-button>
          <app-button variant="secondary" icon="pi pi-download" type="button" (click)="exportReport('csv')" [disabled]="loading() || exporting() || !report()" i18n="@@accounting.budget-report.csv.32811883">CSV</app-button>
          <app-button variant="secondary" icon="pi pi-file-excel" type="button" (click)="exportReport('excel')" [disabled]="loading() || exporting() || !report()" i18n="@@accounting.budget-report.excel.a08e1111">Excel</app-button>
        </div>
      </app-accounting-filter-bar>
    </div>

    @if (report(); as r) {
      @if (!r.isValidated) {
        <div class="card br-hint-card">
          <i class="pi pi-info-circle"></i>
          Budget initial non validé pour cet exercice : les colonnes « Révisé » reprennent le budget initial.
        </div>
      }
    }

    <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="loading()"></app-table-totals-bar>

    <div class="card br-table-card">
      <p-table [value]="report()?.rows ?? []" [loading]="loading()" [scrollable]="true" scrollHeight="flex"
        styleClass="p-datatable-sm accounting-datatable br-table" [rowHover]="true">
        <ng-template pTemplate="header">
          <tr>
            <th scope="col" i18n="@@accounting.budget-report.code.adac6937">Code</th>
            <th scope="col" i18n="@@accounting.budget-report.poste.86abf0cd">Poste</th>
            <th scope="col" i18n="@@accounting.budget-report.sens.55928a79">Sens</th>
            <th scope="col" class="br-amt" i18n="@@accounting.budget-report.budget.initial.e6954c29">Budget initial</th>
            <th scope="col" class="br-amt" i18n="@@accounting.budget-report.budget.revise.506df1a8">Budget révisé</th>
            <th scope="col" class="br-amt" i18n="@@accounting.budget-report.realise.eed7fe3a">Réalisé</th>
            <th scope="col" class="br-amt" i18n="@@accounting.budget-report.ecart.6ae8dce8">Écart</th>
            <th scope="col" class="br-amt">%</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-r>
          <tr [class.br-offpost]="r.isOffPost">
            <td class="br-mono">{{ r.code }}</td>
            <td>{{ r.label }}</td>
            <td>
              <span class="br-badge" [class.br-badge-expense]="r.kind === 0" [class.br-badge-revenue]="r.kind === 1">
                {{ r.kind === 0 ? loc_ui_tern_charges_cfc370 : loc_ui_tern_produits_480004 }}
              </span>
            </td>
            <td class="br-amt">{{ r.periodInitial | number : '1.3-3' }}</td>
            <td class="br-amt">{{ r.periodRevised | number : '1.3-3' }}</td>
            <td class="br-amt">{{ r.periodActual | number : '1.3-3' }}</td>
            <td class="br-amt" [class.br-over]="r.kind === 0 && r.variance > 0" [class.br-under]="r.kind === 1 && r.variance < 0">
              {{ r.variance | number : '1.3-3' }}
            </td>
            <td class="br-amt">
              @if (r.consumptionPercent !== null && r.consumptionPercent !== undefined) {
                {{ r.consumptionPercent | number : '1.1-1' }} %
              } @else { — }
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="footer">
          @if (report(); as r) {
            <tr class="br-totals-row">
              <td colspan="3" i18n="@@accounting.budget-report.total.charges.892472ca">Total charges</td>
              <td class="br-amt">{{ r.totals.expenseInitial | number : '1.3-3' }}</td>
              <td class="br-amt">{{ r.totals.expenseRevised | number : '1.3-3' }}</td>
              <td class="br-amt">{{ r.totals.expenseActual | number : '1.3-3' }}</td>
              <td class="br-amt">{{ r.totals.expenseActual - r.totals.expenseRevised | number : '1.3-3' }}</td>
              <td></td>
            </tr>
            <tr class="br-totals-row">
              <td colspan="3" i18n="@@accounting.budget-report.total.produits.e59ab731">Total produits</td>
              <td class="br-amt">{{ r.totals.revenueInitial | number : '1.3-3' }}</td>
              <td class="br-amt">{{ r.totals.revenueRevised | number : '1.3-3' }}</td>
              <td class="br-amt">{{ r.totals.revenueActual | number : '1.3-3' }}</td>
              <td class="br-amt">{{ r.totals.revenueActual - r.totals.revenueRevised | number : '1.3-3' }}</td>
              <td></td>
            </tr>
          }
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="8" class="br-empty" i18n="@@accounting.budget-report.aucun.poste.budgetaire.actif.pour.cet.exercice.b075fa50">Aucun poste budgétaire actif pour cet exercice.</td></tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: `
    @use '../shared/accounting-layout';
    .br-fields { display: flex; flex-wrap: wrap; gap: var(--spacing-3); }
    .br-actions { display: flex; flex-wrap: wrap; gap: var(--spacing-2); align-items: flex-end; }
    .br-year-inp { max-width: 7rem; }
    .br-hint-card {
      display: flex; align-items: center; gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-4); border-radius: var(--radius-lg); margin-bottom: var(--spacing-4);
      background: var(--color-warning-50, #fffbeb); border: 1px solid var(--color-warning-200, #fde68a);
      color: var(--color-warning-700, #a16207); font-size: var(--font-size-sm);
    }
    .br-table-card { padding: var(--spacing-4); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-top: var(--spacing-4); }
    .br-amt { text-align: right; font-variant-numeric: tabular-nums; }
    .br-mono { font-family: ui-monospace, monospace; }
    .br-badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: var(--radius-pill, 999px); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); }
    .br-badge-expense { background: var(--color-warning-50, #fffbeb); color: var(--color-warning-700, #a16207); border: 1px solid var(--color-warning-200, #fde68a); }
    .br-badge-revenue { background: var(--color-success-100, #dcfce7); color: var(--color-success-700, #15803d); }
    .br-offpost { opacity: 0.75; font-style: italic; }
    .br-over { color: var(--color-danger-600, #dc2626); font-weight: var(--font-weight-semibold); }
    .br-under { color: var(--color-danger-600, #dc2626); }
    .br-totals-row td { font-weight: var(--font-weight-semibold); border-top: 2px solid var(--color-border-default); }
    .br-empty { text-align: center; padding: var(--spacing-6); color: var(--color-text-tertiary); }
  `
})
export class BudgetReportComponent implements OnInit {
  readonly loc_ui_tern_charges_cfc370 = $localize`:@@ui.tern.charges.cfc370:Charges`;
  readonly loc_ui_tern_produits_480004 = $localize`:@@ui.tern.produits.480004:Produits`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);

  readonly monthNames = MONTH_NAMES;

  fiscalYear = new Date().getFullYear();
  throughMonth = new Date().getMonth() + 1;

  readonly report = signal<BudgetReportDto | null>(null);
  readonly loading = signal(false);
  readonly exporting = signal(false);
  readonly error = signal<string | null>(null);

  readonly summaryMetrics = computed<TotalMetric[]>(() => {
    const r = this.report();
    if (!r) return [];
    const expenseVariance = r.totals.expenseActual - r.totals.expenseRevised;
    return [
      { label: 'Budget charges (révisé)', value: r.totals.expenseRevised, format: 'currency', currency: 'TND', icon: 'pi-wallet', tone: 'primary' },
      { label: 'Réalisé charges', value: r.totals.expenseActual, format: 'currency', currency: 'TND', icon: 'pi-chart-line', tone: expenseVariance > 0 ? 'rose' : 'emerald' },
      { label: 'Écart charges', value: expenseVariance, format: 'currency', currency: 'TND', icon: 'pi-arrows-v', tone: expenseVariance > 0 ? 'rose' : 'emerald' },
      { label: 'Réalisé produits', value: r.totals.revenueActual, format: 'currency', currency: 'TND', icon: 'pi-money-bill', tone: 'emerald' }
    ];
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getBudgetReport(this.fiscalYear, this.throughMonth).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.report.set(res.data);
        else {
          this.report.set(null);
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.de.chargement.de.l.etat.budgetaire.2274ee:Erreur de chargement de l'état budgétaire.`);
        }
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, "Erreur réseau lors du chargement de l'état budgétaire."));
      }
    });
  }

  exportReport(format: 'csv' | 'excel'): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.api.exportBudgetReport(this.fiscalYear, this.throughMonth, format).subscribe({
      next: blob => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `etat_budgetaire_${this.fiscalYear}.${format === 'excel' ? 'xlsx' : 'csv'}`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, "Erreur lors de l'export de l'état budgétaire."));
      }
    });
  }
}
