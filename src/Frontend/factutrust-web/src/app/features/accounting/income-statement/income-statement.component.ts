import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AccountingService, IncomeStatementDto } from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingExportMenuComponent } from '../shared/accounting-export-menu.component';
import { AccountingExportFormat, downloadBlob, exportExtension } from '../shared/accounting-download.util';
import {
  buildNoDataPayload,
  buildScreenAnalysisPayloadV2,
  computeYoYVariation
} from '@features/ai-assistant/utils/ai-screen-payload.factory';
import { ScreenAnalysisHighlight } from '@features/ai-assistant/models/ai-screen-analysis-payload.schema';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-income-statement',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    PageHeaderComponent,
    AccountingStatusBannerComponent,
    AnalyzeWithAiButtonComponent,
    AccountingFilterBarComponent,
    ButtonComponent,
    AccountingExportMenuComponent
  ],
  template: `
    <app-page-header title="Compte de résultat" i18n-title="Compte de résultat" subtitle="Produits et charges de l'exercice" />

    <div class="card is-filters-card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Exercice fiscal">
        <div accountingFilterFields>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="is-year" i18n="@@accounting.income-statement.exercice.fiscal.25ea5f92">Exercice fiscal</label>
            <input id="is-year" type="number" [(ngModel)]="fiscalYear" class="accounting-filter-input is-input-narrow" min="2000" max="2099" />
          </div>
        </div>
        <div accountingFilterActions>
          <app-button
            variant="secondary"
            icon="pi pi-refresh"
            iconPos="left"
            type="button"
            (click)="load()"
            [disabled]="loading()"
            ariaLabel="Charger le compte de résultat" i18n="@@accounting.income-statement.charger.8f860300">Charger</app-button>
          <app-analyze-with-ai-button
            screenId="accounting-income-statement"
            density="toolbar"
            [payloadBuilder]="buildIncomeStatementAnalyzePayload"
            [disabled]="loading()" />
          <app-accounting-export-menu
            [disabled]="loading() || exporting() || !data()"
            (exportFormat)="onExport($event)" />
        </div>
      </app-accounting-filter-bar>
    </div>

    <app-accounting-status-banner
      variant="error"
      [message]="error() ?? ''"
      [showRetry]="!!error()"
      retryLabel="Réessayer"
      (retry)="load()"
    />

    @if (data(); as d) {
      <!-- Produits -->
      <div class="card is-section-card">
        <h3 class="is-section-title">
          <i class="pi pi-trending-up is-icon is-icon--revenue"></i>
          Produits
        </h3>
        <p-table [value]="d.revenue" [rowHover]="true" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@accounting.income-statement.compte.c45740bb">Compte</th>
              <th i18n="@@accounting.income-statement.libelle.f5485bba">Libellé</th>
              <th class="text-right" i18n="@@accounting.income-statement.montant.4adcd9fc">Montant</th>
              <th class="text-right" i18n="@@accounting.income-statement.n.1.4f927fbf">N-1</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr>
              <td><span class="is-account-num">{{ r.accountNumber }}</span></td>
              <td>{{ r.label }}</td>
              <td class="text-right tabnum">{{ r.amount | number : '1.3-3' }}</td>
              <td class="text-right tabnum is-prev-year">{{ r.previousYearAmount != null ? (r.previousYearAmount | number : '1.3-3') : '—' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            <tr class="is-total-row">
              <td colspan="2" i18n="@@accounting.income-statement.total.produits.0a1a9e7c">Total Produits</td>
              <td class="text-right tabnum">{{ d.totalRevenue | number : '1.3-3' }}</td>
              <td></td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="4" class="is-empty" i18n="@@accounting.income-statement.aucun.produit.enregistre.7424f061">Aucun produit enregistré.</td></tr>
          </ng-template>
        </p-table>
      </div>

      <!-- Charges -->
      <div class="card is-section-card">
        <h3 class="is-section-title">
          <i class="pi pi-trending-down is-icon is-icon--expenses"></i>
          Charges
        </h3>
        <p-table [value]="d.expenses" [rowHover]="true" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@accounting.income-statement.compte.c45740bb">Compte</th>
              <th i18n="@@accounting.income-statement.libelle.f5485bba">Libellé</th>
              <th class="text-right" i18n="@@accounting.income-statement.montant.4adcd9fc">Montant</th>
              <th class="text-right" i18n="@@accounting.income-statement.n.1.4f927fbf">N-1</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr>
              <td><span class="is-account-num">{{ r.accountNumber }}</span></td>
              <td>{{ r.label }}</td>
              <td class="text-right tabnum">{{ r.amount | number : '1.3-3' }}</td>
              <td class="text-right tabnum is-prev-year">{{ r.previousYearAmount != null ? (r.previousYearAmount | number : '1.3-3') : '—' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            <tr class="is-total-row">
              <td colspan="2" i18n="@@accounting.income-statement.total.charges.621ad2d8">Total Charges</td>
              <td class="text-right tabnum">{{ d.totalExpenses | number : '1.3-3' }}</td>
              <td></td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="4" class="is-empty" i18n="@@accounting.income-statement.aucune.charge.enregistree.f28b8d4f">Aucune charge enregistrée.</td></tr>
          </ng-template>
        </p-table>
      </div>

      <!-- Résultat Net -->
      <div class="card is-result-card">
        <div class="is-result-content">
          <span class="is-result-label" i18n="@@accounting.income-statement.resultat.net.6adc7311">Résultat Net</span>
          <span class="is-result-value" [class.is-positive]="d.netResult >= 0" [class.is-negative]="d.netResult < 0">
            {{ d.netResult | number : '1.3-3' }}
          </span>
        </div>
        <div class="is-result-badge-row">
          <span class="is-result-badge" [class.is-badge--profit]="d.netResult >= 0" [class.is-badge--loss]="d.netResult < 0">
            {{ d.netResult >= 0 ? 'Bénéfice' : 'Déficit' }}
          </span>
          <span class="is-result-detail tabnum">
            Produits {{ d.totalRevenue | number : '1.3-3' }} − Charges {{ d.totalExpenses | number : '1.3-3' }}
          </span>
        </div>
      </div>
    }
  `,
  styles: `
    .is-filters-card { padding:var(--spacing-5); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm,0 1px 3px rgba(15,23,42,.08)); margin-bottom:var(--spacing-4); }
    .is-toolbar { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .form-field { display:flex; flex-direction:column; gap:var(--spacing-2); }
    .field-label { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); color:var(--color-text-primary); }
    .is-input { padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); background:var(--color-background-elevated); color:var(--color-text-primary); font-size:var(--font-size-sm); min-height:2.5rem; width:7rem; }
    .is-input:focus { outline:none; border-color:var(--color-primary-500); box-shadow:0 0 0 3px var(--color-primary-200); }
    .is-toolbar-actions { display:flex; align-items:flex-end; padding-bottom:2px; }
    .is-section-card { padding:var(--spacing-5); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm,0 1px 3px rgba(15,23,42,.08)); margin-bottom:var(--spacing-4); }
    .is-section-title { display:flex; align-items:center; gap:var(--spacing-2); font-size:var(--font-size-md); font-weight:var(--font-weight-semibold); color:var(--color-text-primary); margin:0 0 var(--spacing-4); }
    .is-icon { font-size:1rem; padding:0.35rem; border-radius:var(--radius-md); }
    .is-icon--revenue { background:var(--color-success-50,#f0fdf4); color:var(--color-success-600,#16a34a); }
    .is-icon--expenses { background:var(--color-danger-50,#fef2f2); color:var(--color-danger-600,#dc2626); }
    .is-account-num { font-family:monospace; font-weight:500; }
    .text-right { text-align:right; }
    .tabnum { font-variant-numeric:tabular-nums; }
    .is-prev-year { color:var(--color-text-tertiary); }
    .is-total-row { font-weight:700; }
    .is-empty { text-align:center; padding:2rem; color:var(--color-text-tertiary); }
    .is-result-card { padding:var(--spacing-5); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm,0 1px 3px rgba(15,23,42,.08)); }
    .is-result-content { display:flex; justify-content:space-between; align-items:center; }
    .is-result-label { font-size:var(--font-size-md); font-weight:var(--font-weight-semibold); color:var(--color-text-primary); }
    .is-result-value { font-size:1.5rem; font-weight:var(--font-weight-bold); font-variant-numeric:tabular-nums; }
    .is-positive { color:var(--color-success-600,#16a34a); }
    .is-negative { color:var(--color-danger-600,#dc2626); }
    .is-result-badge-row { display:flex; align-items:center; gap:var(--spacing-3); margin-top:var(--spacing-3); padding-top:var(--spacing-3); border-top:1px solid var(--color-border-subtle); }
    .is-result-badge { padding:0.2rem 0.65rem; border-radius:var(--radius-md); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }
    .is-badge--profit { background:var(--color-success-50,#f0fdf4); color:var(--color-success-700,#15803d); border:1px solid var(--color-success-200,#bbf7d0); }
    .is-badge--loss { background:var(--color-danger-50,#fef2f2); color:var(--color-danger-700,#b91c1c); border:1px solid var(--color-danger-200,#fecaca); }
    .is-result-detail { font-size:var(--font-size-sm); color:var(--color-text-tertiary); }
  `
})
export class IncomeStatementComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  fiscalYear = new Date().getFullYear();
  readonly data = signal<IncomeStatementDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly exporting = signal(false);

  readonly buildIncomeStatementAnalyzePayload = (): unknown => {
    const d = this.data();
    if (!d) {
      return buildNoDataPayload('accounting-income-statement');
    }

    const cogs = d.expenses
      .filter(e => e.accountNumber.startsWith('60'))
      .reduce((sum, e) => sum + e.amount, 0);
    const grossMargin = d.totalRevenue - cogs;
    const grossMarginPct = d.totalRevenue !== 0 ? (grossMargin / d.totalRevenue) * 100 : null;

    const revenuePrev = d.revenue.reduce((s, r) => s + (r.previousYearAmount ?? 0), 0);
    const expensePrev = d.expenses.reduce((s, e) => s + (e.previousYearAmount ?? 0), 0);

    const highlights: ScreenAnalysisHighlight[] = [...d.revenue, ...d.expenses]
      .map(line => ({
        line,
        variation: computeYoYVariation(line.amount, line.previousYearAmount)
      }))
      .filter(x => x.variation != null && Math.abs(x.variation) >= 25)
      .sort((a, b) => Math.abs(b.variation!) - Math.abs(a.variation!))
      .slice(0, 5)
      .map(x => ({
        type: 'warning' as const,
        label: x.line.label,
        value: x.line.amount,
        context: `Variation N/N-1 : ${x.variation!.toFixed(1)} %`
      }));

    if (grossMargin < 0) {
      highlights.unshift({
        type: 'anomaly' as const,
        label: 'Marge brute négative',
        value: grossMargin,
        context: 'Les achats/consommations dépassent les produits'
      });
    }

    return buildScreenAnalysisPayloadV2({
      screenId: 'accounting-income-statement',
      filters: { fiscalYear: this.fiscalYear },
      summary: {
        totalRevenue: d.totalRevenue,
        totalExpenses: d.totalExpenses,
        costOfGoodsSold: cogs,
        grossMargin,
        grossMarginPct,
        netResult: d.netResult,
        revenueYoYPct: computeYoYVariation(d.totalRevenue, revenuePrev || null),
        expensesYoYPct: computeYoYVariation(d.totalExpenses, expensePrev || null)
      },
      highlights,
      rows: [
        ...d.revenue.map(r => ({ section: 'revenue', ...r })),
        ...d.expenses.map(e => ({ section: 'expense', ...e }))
      ],
      sampling: {
        strategy: 'all',
        totalAvailable: d.revenue.length + d.expenses.length,
        included: d.revenue.length + d.expenses.length,
        truncated: false
      },
      dataQuality: { hasData: true, isPartial: false, warnings: [] }
    });
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getIncomeStatement(this.fiscalYear).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.data.set(res.data);
        else this.error.set(res.error ?? 'Erreur lors du chargement du compte de résultat');
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'));
      }
    });
  }

  onExport(format: AccountingExportFormat): void {
    this.exporting.set(true);
    this.api.exportIncomeStatement(this.fiscalYear, format).subscribe({
      next: blob => {
        this.exporting.set(false);
        downloadBlob(blob, `compte_resultat_${this.fiscalYear}.${exportExtension(format)}`);
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, "Erreur lors de l'export."));
      }
    });
  }
}
