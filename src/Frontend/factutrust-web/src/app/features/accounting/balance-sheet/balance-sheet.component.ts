import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AccountingService, BalanceSheetDto } from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingExportMenuComponent } from '../shared/accounting-export-menu.component';
import { AccountingExportFormat, downloadBlob, exportExtension } from '../shared/accounting-download.util';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-balance-sheet',
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
    <app-page-header title="Bilan" i18n-title="@@accounting.balance-sheet.bilan.a80c4623" subtitle="État de la situation patrimoniale — Actif et Passif" i18n-subtitle="@@accounting.balance-sheet.etat.de.la.situation.patrimoniale.actif.2c43e3c8" />

    <div class="card bs-filters-card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Exercice fiscal" i18n-ariaLabel="@@accounting.balance-sheet.exercice.fiscal.7b79fa50">
        <div accountingFilterFields>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="bs-year" i18n="@@accounting.balance-sheet.exercice.fiscal.25ea5f92">Exercice fiscal</label>
            <input id="bs-year" type="number" [(ngModel)]="fiscalYear" class="accounting-filter-input bs-input-narrow" min="2000" max="2099" />
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
            ariaLabel="Charger le bilan" i18n-ariaLabel="@@accounting.balance-sheet.charger.le.bilan.21c04e99" i18n="@@accounting.balance-sheet.charger.8f860300"> Charger </app-button>
          <app-analyze-with-ai-button
            screenId="accounting-balance-sheet"
            density="toolbar"
            [payloadBuilder]="buildBalanceSheetAnalyzePayload"
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
      retryLabel="Réessayer" i18n-retryLabel="@@accounting.balance-sheet.reessayer.c4f78b12"
      (retry)="load()"
    />

    @if (data(); as d) {
      <div class="bs-grid">
        <!-- Actif -->
        <div class="card bs-section-card">
          <h3 class="bs-section-title" i18n="@@accounting.balance-sheet.actif.0fff68ca">
            <i class="pi pi-arrow-up-right bs-icon bs-icon--assets"></i>
            Actif
          </h3>
          <p-table [value]="d.assets" [rowHover]="true" styleClass="p-datatable-sm">
            <ng-template pTemplate="header">
              <tr>
                <th i18n="@@accounting.balance-sheet.compte.c45740bb">Compte</th>
                <th i18n="@@accounting.balance-sheet.libelle.f5485bba">Libellé</th>
                <th class="text-right" i18n="@@accounting.balance-sheet.montant.4adcd9fc">Montant</th>
                <th class="text-right" i18n="@@accounting.balance-sheet.n.1.4f927fbf">N-1</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-r>
              <tr>
                <td><span class="bs-account-num">{{ r.accountNumber }}</span></td>
                <td>{{ r.label }}</td>
                <td class="text-right tabnum">{{ r.amount | number : '1.3-3' }}</td>
                <td class="text-right tabnum bs-prev-year">{{ r.previousYearAmount != null ? (r.previousYearAmount | number : '1.3-3') : '—' }}</td>
              </tr>
            </ng-template>
            <ng-template pTemplate="footer">
              <tr class="bs-total-row">
                <td colspan="2" i18n="@@accounting.balance-sheet.total.actif.6d8f1286">Total Actif</td>
                <td class="text-right tabnum">{{ d.totalAssets | number : '1.3-3' }}</td>
                <td></td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr><td colspan="4" class="bs-empty" i18n="@@accounting.balance-sheet.aucune.ligne.d.actif.31733d6e">Aucune ligne d'actif.</td></tr>
            </ng-template>
          </p-table>
        </div>

        <!-- Passif -->
        <div class="card bs-section-card">
          <h3 class="bs-section-title" i18n="@@accounting.balance-sheet.passif.69f4aee9">
            <i class="pi pi-arrow-down-left bs-icon bs-icon--liabilities"></i>
            Passif
          </h3>
          <p-table [value]="d.liabilities" [rowHover]="true" styleClass="p-datatable-sm">
            <ng-template pTemplate="header">
              <tr>
                <th i18n="@@accounting.balance-sheet.compte.c45740bb">Compte</th>
                <th i18n="@@accounting.balance-sheet.libelle.f5485bba">Libellé</th>
                <th class="text-right" i18n="@@accounting.balance-sheet.montant.4adcd9fc">Montant</th>
                <th class="text-right" i18n="@@accounting.balance-sheet.n.1.4f927fbf">N-1</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-r>
              <tr>
                <td><span class="bs-account-num">{{ r.accountNumber }}</span></td>
                <td>{{ r.label }}</td>
                <td class="text-right tabnum">{{ r.amount | number : '1.3-3' }}</td>
                <td class="text-right tabnum bs-prev-year">{{ r.previousYearAmount != null ? (r.previousYearAmount | number : '1.3-3') : '—' }}</td>
              </tr>
            </ng-template>
            <ng-template pTemplate="footer">
              <tr class="bs-total-row">
                <td colspan="2" i18n="@@accounting.balance-sheet.total.passif.d3b4a120">Total Passif</td>
                <td class="text-right tabnum">{{ d.totalLiabilities | number : '1.3-3' }}</td>
                <td></td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr><td colspan="4" class="bs-empty" i18n="@@accounting.balance-sheet.aucune.ligne.de.passif.7b2a9f32">Aucune ligne de passif.</td></tr>
            </ng-template>
          </p-table>
        </div>
      </div>

      <!-- Résultat Net -->
      <div class="card bs-result-card">
        <div class="bs-result-content">
          <span class="bs-result-label" i18n="@@accounting.balance-sheet.resultat.net.de.l.exercice.b74bc21d">Résultat Net de l'exercice</span>
          <span class="bs-result-value" [class.bs-positive]="d.netResult >= 0" [class.bs-negative]="d.netResult < 0">
            {{ d.netResult | number : '1.3-3' }}
          </span>
        </div>
        <div class="bs-check-row">
          <span class="bs-check-label" i18n="@@accounting.balance-sheet.controle.actif.passif.b227e86d">Contrôle : Actif − Passif</span>
          <span class="bs-check-value tabnum">{{ d.totalAssets - d.totalLiabilities | number : '1.3-3' }}</span>
        </div>
      </div>
    }
  `,
  styles: `
    .bs-filters-card { padding:var(--spacing-5); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm,0 1px 3px rgba(15,23,42,.08)); margin-bottom:var(--spacing-4); }
    .bs-toolbar { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .form-field { display:flex; flex-direction:column; gap:var(--spacing-2); }
    .field-label { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); color:var(--color-text-primary); }
    .bs-input { padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); background:var(--color-background-elevated); color:var(--color-text-primary); font-size:var(--font-size-sm); min-height:2.5rem; width:7rem; }
    .bs-input:focus { outline:none; border-color:var(--color-primary-500); box-shadow:0 0 0 3px var(--color-primary-200); }
    .bs-toolbar-actions { display:flex; align-items:flex-end; padding-bottom:2px; }
    .bs-grid { display:grid; grid-template-columns:1fr 1fr; gap:var(--spacing-4); margin-bottom:var(--spacing-4); }
    @media (max-width:1024px) { .bs-grid { grid-template-columns:1fr; } }
    .bs-section-card { padding:var(--spacing-5); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm,0 1px 3px rgba(15,23,42,.08)); }
    .bs-section-title { display:flex; align-items:center; gap:var(--spacing-2); font-size:var(--font-size-md); font-weight:var(--font-weight-semibold); color:var(--color-text-primary); margin:0 0 var(--spacing-4); }
    .bs-icon { font-size:1rem; padding:0.35rem; border-radius:var(--radius-md); }
    .bs-icon--assets { background:var(--color-primary-50,#eff6ff); color:var(--color-primary-600,#2563eb); }
    .bs-icon--liabilities { background:var(--color-warning-50,#fffbeb); color:var(--color-warning-600,#d97706); }
    .bs-account-num { font-family:monospace; font-weight:500; }
    .text-right { text-align:right; }
    .tabnum { font-variant-numeric:tabular-nums; }
    .bs-prev-year { color:var(--color-text-tertiary); }
    .bs-total-row { font-weight:700; }
    .bs-empty { text-align:center; padding:2rem; color:var(--color-text-tertiary); }
    .bs-result-card { padding:var(--spacing-5); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm,0 1px 3px rgba(15,23,42,.08)); }
    .bs-result-content { display:flex; justify-content:space-between; align-items:center; }
    .bs-result-label { font-size:var(--font-size-md); font-weight:var(--font-weight-semibold); color:var(--color-text-primary); }
    .bs-result-value { font-size:1.5rem; font-weight:var(--font-weight-bold); font-variant-numeric:tabular-nums; }
    .bs-positive { color:var(--color-success-600,#16a34a); }
    .bs-negative { color:var(--color-danger-600,#dc2626); }
    .bs-check-row { display:flex; justify-content:space-between; align-items:center; margin-top:var(--spacing-3); padding-top:var(--spacing-3); border-top:1px solid var(--color-border-subtle); }
    .bs-check-label { font-size:var(--font-size-sm); color:var(--color-text-tertiary); }
    .bs-check-value { font-size:var(--font-size-sm); color:var(--color-text-tertiary); }
  `
})
export class BalanceSheetComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  fiscalYear = new Date().getFullYear();
  readonly data = signal<BalanceSheetDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly exporting = signal(false);

  readonly buildBalanceSheetAnalyzePayload = (): unknown => {
    const d = this.data();
    if (!d)
      return wrapLegacyAnalyzePayload(
        'accounting-balance-sheet',
        { screen: 'accounting-balance-sheet', noData: true } as Record<string, unknown>
      );
    return wrapLegacyAnalyzePayload(
      'accounting-balance-sheet',
      {
        screen: 'accounting-balance-sheet',
        fiscalYear: this.fiscalYear,
        assets: d.assets.map(a => ({
          accountNumber: a.accountNumber,
          label: a.label,
          amount: a.amount,
          previousYearAmount: a.previousYearAmount
        })),
        liabilities: d.liabilities.map(l => ({
          accountNumber: l.accountNumber,
          label: l.label,
          amount: l.amount,
          previousYearAmount: l.previousYearAmount
        })),
        totalAssets: d.totalAssets,
        totalLiabilities: d.totalLiabilities,
        netResult: d.netResult
      } as Record<string, unknown>
    );
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getBalanceSheet(this.fiscalYear).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.data.set(res.data);
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.du.chargement.du.bilan.760441:Erreur lors du chargement du bilan`);
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.balance-sheet.ts.erreur.reseau.0683007f:Erreur réseau`));
      }
    });
  }

  onExport(format: AccountingExportFormat): void {
    this.exporting.set(true);
    this.api.exportBalanceSheet(this.fiscalYear, format).subscribe({
      next: blob => {
        this.exporting.set(false);
        downloadBlob(blob, `bilan_${this.fiscalYear}.${exportExtension(format)}`);
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.balance-sheet.ts.erreur.lors.de.l.export.cd90f787:Erreur lors de l'export.`));
      }
    });
  }
}
