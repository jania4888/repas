import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { WithholdingTaxService, WithholdingDashboardDto } from '@core/services/withholding-tax.service';

@Component({
  selector: 'app-withholding-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="page-container">
      <div class="page-header">
        <div>
          <h1 i18n="@@withholding-tax.withholding-dashboard.tableau.de.bord.retenues.a.la.source.ed610282">Tableau de bord — Retenues à la source</h1>
          <p class="subtitle" i18n="@@withholding-tax.withholding-dashboard.vue.d.ensemble.de.l.activite.fiscale.tej.349ff0bc">Vue d'ensemble de l'activité fiscale TEJ</p>
        </div>
        <div class="header-controls">
          <select [(ngModel)]="selectedYear" (ngModelChange)="loadDashboard()">
            @for (y of years; track y) {
              <option [ngValue]="y">{{ y }}</option>
            }
          </select>
          <a routerLink="/withholding-tax/tej-export" class="btn btn-primary">
            <i class="fa-solid fa-file-export"></i> Export TEJ
          </a>
        </div>
      </div>

      @if (loading) {
        <div class="loading-state"><i class="fa-solid fa-spinner fa-spin"></i> Chargement…</div>
      }

      @if (data) {
        <!-- KPI row -->
        <div class="kpi-row">
          <div class="kpi-card">
            <span class="kpi-label">Total retenues ({{ data.dashboardYear }})</span>
            <span class="kpi-value">{{ data.totalWithheldForYear | number:'1.3-3' }}</span>
            <span class="kpi-unit" i18n="@@withholding-tax.withholding-dashboard.tnd.51da21a7">TND</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">FF soldées avec RS ({{ data.dashboardYear }})</span>
            <span class="kpi-value">{{ data.totalCertificatesForYear }}</span>
            <span class="kpi-hint" i18n="@@withholding-tax.withholding-dashboard.base.sur.la.date.de.solde.paidat.agrege.pour.le..7bf088bb">Basé sur la date de solde (PaidAt), agrégé pour le tableau</span>
          </div>
          <div class="kpi-card kpi-card-muted">
            <span class="kpi-label" i18n="@@withholding-tax.withholding-dashboard.retenues.subies.ventes.8d65f638">Retenues subies (ventes)</span>
            <span class="kpi-value">{{ data.totalClientWithholdingSubieForYear | number:'1.3-3' }}</span>
            <span class="kpi-unit" i18n="@@withholding-tax.withholding-dashboard.tnd.51da21a7">TND</span>
            <span class="kpi-hint" i18n="@@withholding-tax.withholding-dashboard.encaissements.clients.hors.declaration.tej.decla.6a0657e2">Encaissements clients — hors déclaration TEJ déclarant</span>
          </div>
        </div>

        @if (data.alerts.length) {
          <div class="alerts-banner" role="status">
            @for (a of data.alerts; track a) {
              <p>{{ a }}</p>
            }
          </div>
        }

        <!-- Monthly breakdown -->
        @if (data.monthlyBreakdown.length) {
          <div class="card">
            <h3>Répartition mensuelle ({{ data.dashboardYear }})</h3>
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th i18n="@@withholding-tax.withholding-dashboard.mois.0d304bea">Mois</th>
                    <th class="right" i18n="@@withholding-tax.withholding-dashboard.operations.8d02bd5b">Opérations</th>
                    <th class="right" i18n="@@withholding-tax.withholding-dashboard.montant.ht.3df1d6fe">Montant HT</th>
                    <th class="right" i18n="@@withholding-tax.withholding-dashboard.retenue.88cf18f4">Retenue</th>
                    <th class="right" i18n="@@withholding-tax.withholding-dashboard.net.servi.bb6a0c49">Net servi</th>
                  </tr>
                </thead>
                <tbody>
                  @for (m of data.monthlyBreakdown; track m.month) {
                    <tr>
                      <td>{{ getMonthName(m.month) }}</td>
                      <td class="right">{{ m.certificateCount }}</td>
                      <td class="right">{{ m.totalHT | number:'1.3-3' }}</td>
                      <td class="right">{{ m.totalWithheld | number:'1.3-3' }}</td>
                      <td class="right">{{ m.totalNetPaid | number:'1.3-3' }}</td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr>
                    <td><strong i18n="@@withholding-tax.withholding-dashboard.total.b25928c6">Total</strong></td>
                    <td class="right"><strong>{{ getTotalCount() }}</strong></td>
                    <td class="right"><strong>{{ getTotalHT() | number:'1.3-3' }}</strong></td>
                    <td class="right"><strong>{{ data.totalWithheldForYear | number:'1.3-3' }}</strong></td>
                    <td class="right"><strong>{{ getTotalNet() | number:'1.3-3' }}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        }

        @if (data.clientWithholdingSubieByMonth.length) {
          <div class="card card-muted">
            <h3>Retenues subies par mois ({{ data.dashboardYear }})</h3>
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th i18n="@@withholding-tax.withholding-dashboard.mois.0d304bea">Mois</th>
                    <th class="right" i18n="@@withholding-tax.withholding-dashboard.paiements.97ecc646">Paiements</th>
                    <th class="right" i18n="@@withholding-tax.withholding-dashboard.total.retenu.33b9224b">Total retenu</th>
                  </tr>
                </thead>
                <tbody>
                  @for (m of data.clientWithholdingSubieByMonth; track m.month) {
                    @if (m.totalSubie > 0 || m.paymentCount > 0) {
                      <tr>
                        <td>{{ getMonthName(m.month) }}</td>
                        <td class="right">{{ m.paymentCount }}</td>
                        <td class="right">{{ m.totalSubie | number:'1.3-3' }}</td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          </div>
        }

        <!-- Quick links -->
        <div class="quick-links">
          <a routerLink="/withholding-tax/tej-export" class="link-card">
            <i class="fa-solid fa-file-export"></i>
            <span i18n="@@withholding-tax.withholding-dashboard.export.tej.xml.e91753b7">Export TEJ XML</span>
          </a>
          <a routerLink="/withholding-tax/settings" class="link-card">
            <i class="fa-solid fa-cog"></i>
            <span i18n="@@withholding-tax.withholding-dashboard.types.de.retenue.b0d657ed">Types de retenue</span>
          </a>
        </div>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 1.5rem; max-width: 1100px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; }
    .page-header h1 { font-size: 1.5rem; font-weight: 600; margin: 0; }
    .subtitle { color: var(--text-secondary); margin: 0.25rem 0 0; font-size: 0.875rem; }
    .header-controls { display: flex; gap: 0.75rem; align-items: center; }
    .header-controls select { padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 0.875rem; }
    .loading-state { padding: 3rem; text-align: center; color: var(--text-secondary); }

    .kpi-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .kpi-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.25rem; }
    .kpi-label { font-size: 0.75rem; font-weight: 500; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.025em; }
    .kpi-value { font-size: 1.75rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .kpi-unit { font-size: 0.8125rem; color: var(--text-secondary); }
    .kpi-card-muted { border-style: dashed; opacity: 0.95; }
    .kpi-hint { font-size: 0.65rem; color: var(--text-secondary); line-height: 1.3; margin-top: 0.25rem; }
    .card-muted { border-style: dashed; }
    .accent-success { color: #16a34a; }
    .accent-warning { color: #d97706; }
    .accent-info { color: #2563eb; }
    .alerts-banner { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem; font-size: 0.875rem; }
    .alerts-banner p { margin: 0.25rem 0; }

    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; }
    .card h3 { font-size: 1rem; font-weight: 600; margin: 0 0 1rem; }
    .table-wrapper { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); text-align: left; }
    th { font-weight: 500; color: var(--text-secondary); font-size: 0.8125rem; }
    .right { text-align: right; font-variant-numeric: tabular-nums; }
    tfoot td { border-top: 2px solid var(--border); border-bottom: none; }

    .quick-links { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
    .link-card { display: flex; align-items: center; gap: 0.75rem; padding: 1rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; text-decoration: none; color: inherit; transition: box-shadow 0.15s; }
    .link-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .link-card i { font-size: 1.25rem; color: var(--primary); }
    .btn { padding: 0.5rem 1rem; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 0.875rem; display: inline-flex; align-items: center; gap: 0.5rem; text-decoration: none; }
    .btn-primary { background: var(--primary); color: white; border-color: var(--primary); }
  `]
})
export class WithholdingDashboardComponent implements OnInit {
  private service = inject(WithholdingTaxService);

  data: WithholdingDashboardDto | null = null;
  loading = true;
  selectedYear = new Date().getFullYear();
  years = Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - i);

  private monthNames = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];

  ngOnInit() {
    this.loadDashboard();
  }

  loadDashboard() {
    this.loading = true;
    this.service.getDashboard(this.selectedYear).subscribe({
      next: d => { this.data = d; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  getMonthName(month: number): string {
    return this.monthNames[month - 1] ?? '';
  }

  getTotalCount(): number {
    return this.data?.monthlyBreakdown?.reduce((s, m) => s + m.certificateCount, 0) ?? 0;
  }

  getTotalHT(): number {
    return this.data?.monthlyBreakdown?.reduce((s, m) => s + m.totalHT, 0) ?? 0;
  }

  getTotalNet(): number {
    return this.data?.monthlyBreakdown?.reduce((s, m) => s + m.totalNetPaid, 0) ?? 0;
  }
}
