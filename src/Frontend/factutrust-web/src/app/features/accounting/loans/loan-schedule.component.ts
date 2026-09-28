import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingExportMenuComponent } from '../shared/accounting-export-menu.component';
import { AccountingExportFormat, downloadBlob, exportExtension } from '../shared/accounting-download.util';
import { AccountingService, LoanScheduleDto } from '../services/accounting.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Tableau d'amortissement d'un emprunt : échéancier complet (capital restant dû, intérêt, capital
 * remboursé, annuité, solde) avec totaux et export PDF/Excel/CSV. Édition seule.
 */
@Component({
  selector: 'app-loan-schedule',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TableModule,
    PageHeaderComponent,
    AccountingStatusBannerComponent,
    AccountingExportMenuComponent
  ],
  template: `
    <app-page-header
      title="Tableau d'amortissement" i18n-title="@@accounting.loans.tableau.d.amortissement.2a7cef27"
      subtitle="Échéancier d'emprunt — capital, intérêts et solde restant dû" i18n-subtitle="@@accounting.loans.echeancier.d.emprunt.capital.interets.et.d25aaa8c" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" [showRetry]="!!error()" retryLabel="Réessayer" i18n-retryLabel="@@accounting.loans.reessayer.c4f78b12" (retry)="load()" />

    @if (schedule(); as s) {
      <div class="card ls-head-card">
        <div class="ls-head">
          <div class="ls-identity">
            <h2 class="ls-title"><span class="ls-code">{{ s.loan.loanNumber }}</span> {{ s.loan.label }}</h2>
            <p class="ls-lender">{{ s.loan.lenderName }}</p>
          </div>
          <div class="ls-actions">
            <a class="ls-back" routerLink="/accounting/loans" i18n="@@accounting.loans.registre.74e24ec2"><i class="pi pi-angle-left" aria-hidden="true"></i> Registre</a>
            <app-accounting-export-menu [disabled]="loading() || exporting()" (exportFormat)="onExport($event)" />
          </div>
        </div>

        <div class="ls-kpis">
          <div class="ls-kpi"><span class="ls-kpi-label" i18n="@@accounting.loans.capital.emprunte.a40c562c">Capital emprunté</span><span class="ls-kpi-value">{{ s.loan.principal | number : '1.3-3' }}</span></div>
          <div class="ls-kpi"><span class="ls-kpi-label" i18n="@@accounting.loans.taux.annuel.ddd3eb7f">Taux annuel</span><span class="ls-kpi-value">{{ s.loan.annualRatePercent | number : '1.2-4' }} %</span></div>
          <div class="ls-kpi"><span class="ls-kpi-label" i18n="@@accounting.loans.echeances.c2079408">Échéances</span><span class="ls-kpi-value">{{ s.loan.installmentCount }} · {{ periodicityLabel(s.loan.periodicity) }}</span></div>
          <div class="ls-kpi"><span class="ls-kpi-label" i18n="@@accounting.loans.amortissement.403d7802">Amortissement</span><span class="ls-kpi-value">{{ methodLabel(s.loan.method) }}</span></div>
          <div class="ls-kpi"><span class="ls-kpi-label" i18n="@@accounting.loans.cout.du.credit.2f8c4b43">Coût du crédit</span><span class="ls-kpi-value">{{ s.totalInterest | number : '1.3-3' }}</span></div>
          <div class="ls-kpi"><span class="ls-kpi-label" i18n="@@accounting.loans.total.rembourse.81bf5cbd">Total remboursé</span><span class="ls-kpi-value">{{ s.totalInstallments | number : '1.3-3' }}</span></div>
        </div>

        <p class="ls-notice" i18n="@@accounting.loans.echeancier.indicatif.les.echeances.ne.so.f6dffc37">
          <i class="pi pi-info-circle" aria-hidden="true"></i>
          Échéancier <strong>indicatif</strong> : les échéances ne sont pas comptabilisées automatiquement.
        </p>

        @if (!s.isSettled) {
          <app-accounting-status-banner variant="warning"
            message="Contrôle : l'échéancier ne solde pas exactement le capital emprunté." i18n-message="@@accounting.loans.controle.l.echeancier.ne.solde.pas.exact.53db8b55" />
        }
      </div>

      <div class="card ls-table-card">
        <p-table [value]="s.lines" [paginator]="true" [rows]="24" [rowsPerPageOptions]="[12, 24, 60, 120]"
          [loading]="loading()" [rowHover]="true" styleClass="p-datatable-sm accounting-datatable">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" class="ls-narrow" i18n="@@accounting.loans.n.754e6095">N°</th>
              <th scope="col" i18n="@@accounting.loans.echeance.f9a77ff6">Échéance</th>
              <th scope="col" class="ls-num" i18n="@@accounting.loans.capital.restant.du.fb1533e2">Capital restant dû</th>
              <th scope="col" class="ls-num" i18n="@@accounting.loans.interet.c10e8ea5">Intérêt</th>
              <th scope="col" class="ls-num" i18n="@@accounting.loans.capital.rembourse.829c9aae">Capital remboursé</th>
              <th scope="col" class="ls-num" i18n="@@accounting.loans.annuite.a3535b86">Annuité</th>
              <th scope="col" class="ls-num" i18n="@@accounting.loans.solde.e5977cf9">Solde</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-l>
            <tr>
              <td data-label="N°" class="ls-narrow">{{ l.installmentNumber }}</td>
              <td data-label="Échéance" i18n-data-label="@@accounting.loan-schedule.echeance.f9a77ff6">{{ l.dueDate | date : 'shortDate' }}</td>
              <td data-label="Capital restant dû" i18n-data-label="@@accounting.loan-schedule.capital.restant.du.fb1533e2" class="ls-num">{{ l.openingBalance | number : '1.3-3' }}</td>
              <td data-label="Intérêt" i18n-data-label="@@accounting.loan-schedule.interet.c10e8ea5" class="ls-num">{{ l.interestAmount | number : '1.3-3' }}</td>
              <td data-label="Capital remboursé" i18n-data-label="@@accounting.loan-schedule.capital.rembourse.829c9aae" class="ls-num">{{ l.principalAmount | number : '1.3-3' }}</td>
              <td data-label="Annuité" i18n-data-label="@@accounting.loan-schedule.annuite.a3535b86" class="ls-num">{{ l.installmentAmount | number : '1.3-3' }}</td>
              <td data-label="Solde" i18n-data-label="@@accounting.loan-schedule.solde.e5977cf9" class="ls-num">{{ l.closingBalance | number : '1.3-3' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            <tr class="acc-totals-row">
              <td colspan="3" i18n="@@accounting.loans.totaux.a1ca02f8">Totaux</td>
              <td class="ls-num">{{ s.totalInterest | number : '1.3-3' }}</td>
              <td class="ls-num">{{ s.totalPrincipal | number : '1.3-3' }}</td>
              <td class="ls-num">{{ s.totalInstallments | number : '1.3-3' }}</td>
              <td></td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="7" style="text-align:center;padding:2rem" i18n="@@accounting.loans.aucune.echeance.248d93b0">Aucune échéance.</td></tr>
          </ng-template>
        </p-table>
      </div>
    }
  `,
  styles: `
    @use '../shared/accounting-layout';
    .ls-head-card, .ls-table-card { padding:var(--spacing-5); }
    .ls-head { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:flex-start; gap:var(--spacing-4); }
    .ls-title { margin:0; font-size:var(--font-size-md); font-weight:var(--font-weight-semibold); }
    .ls-lender { margin:var(--spacing-1) 0 0; color:var(--color-text-secondary); font-size:var(--font-size-sm); }
    .ls-actions { display:flex; align-items:center; gap:var(--spacing-3); }
    .ls-back { color:var(--color-primary-500); text-decoration:none; font-weight:500; white-space:nowrap; font-size:var(--font-size-sm); }
    .ls-back:hover { text-decoration:underline; }
    .ls-code { font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .ls-kpis { display:flex; flex-wrap:wrap; gap:var(--spacing-5); margin-top:var(--spacing-4); padding-top:var(--spacing-4); border-top:1px solid var(--color-border-subtle); }
    .ls-kpi { display:flex; flex-direction:column; gap:2px; }
    .ls-kpi-label { font-size:var(--font-size-xs); color:var(--color-text-tertiary); text-transform:uppercase; letter-spacing:0.04em; }
    .ls-kpi-value { font-size:var(--font-size-lg); font-weight:var(--font-weight-semibold); font-variant-numeric:tabular-nums; }
    .ls-notice { margin:var(--spacing-4) 0 0; font-size:var(--font-size-sm); color:var(--color-text-secondary); display:flex; align-items:center; gap:var(--spacing-2); }
    .ls-num { text-align:end; font-variant-numeric:tabular-nums; }
    .ls-narrow { width:1%; white-space:nowrap; }
    .acc-totals-row td { font-weight:var(--font-weight-bold); background:var(--color-background-subtle); border-top:2px solid var(--color-border-default); }
  `
})
export class LoanScheduleComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly route = inject(ActivatedRoute);

  private loanId = '';
  readonly schedule = signal<LoanScheduleDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly exporting = signal(false);

  periodicityLabel(value: number): string {
    switch (value) {
      case 1: return 'trimestrielle';
      case 2: return 'semestrielle';
      case 3: return 'annuelle';
      default: return 'mensuelle';
    }
  }

  methodLabel(value: number): string {
    return value === 1 ? $localize`:@@ui.tern.amortissement.constant.ccbefc:Amortissement constant` : $localize`:@@ui.tern.annuite.constante.c65591:Annuité constante`;
  }

  ngOnInit(): void {
    this.loanId = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  load(): void {
    if (!this.loanId) {
      this.error.set($localize`:@@accounting.loan-schedule.ts.emprunt.introuvable.55fc0f0a:Emprunt introuvable.`);
      return;
    }
    this.error.set(null);
    this.loading.set(true);
    this.api.getLoanSchedule(this.loanId).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.schedule.set(res.data);
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.loan-schedule.ts.erreur.reseau.0683007f:Erreur réseau`));
      }
    });
  }

  onExport(format: AccountingExportFormat): void {
    if (!this.loanId || this.exporting()) return;
    this.exporting.set(true);
    this.api.exportLoanSchedule(this.loanId, format).subscribe({
      next: blob => {
        this.exporting.set(false);
        const number = this.schedule()?.loan.loanNumber ?? this.loanId;
        downloadBlob(blob, `echeancier_${number}.${exportExtension(format)}`);
      },
      error: err => {
        this.exporting.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.loan-schedule.ts.erreur.lors.de.l.export.cd90f787:Erreur lors de l'export.`));
      }
    });
  }
}
