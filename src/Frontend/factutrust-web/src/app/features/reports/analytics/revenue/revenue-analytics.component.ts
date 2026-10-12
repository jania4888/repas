import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
    AnalyticsService,
    AnalyticsPeriod,
    RevenueData
} from '../../services/analytics.service';

@Component({
    selector: 'app-revenue-analytics',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        TableModule,
        PageHeaderComponent,
        StatCardComponent,
        ButtonComponent
    ],
    template: `
    <app-page-header
      title="Chiffre d'affaires HT" i18n-title="@@reports.analytics.chiffre.d.affaires.ht.170920d6"
      subtitle="Suivez l'évolution de votre chiffre d'affaires au fil du temps" i18n-subtitle="@@reports.analytics.suivez.l.evolution.de.votre.chiffre.d.af.76e29594">
      <app-button
        variant="secondary"
        icon="pi-print"
        iconPos="left"
        (click)="onPrint()" i18n="@@reports.analytics.imprimer.5382c09d"> Imprimer </app-button>
    </app-page-header>

    <!-- Period Filter -->
    <div class="filter-bar">
      <div class="filter-group">
        <label class="filter-label" i18n="@@reports.analytics.periode.de2110b7">Période</label>
        <div class="period-tabs">
          @for (p of periodOptions; track p.value) {
            <button
              class="period-tab"
              [class.active]="selectedPeriod === p.value"
              (click)="onPeriodChange(p.value)">
              {{ p.label }}
            </button>
          }
        </div>
      </div>
    </div>

    <!-- Comparison message -->
    @if (!loading() && data()?.comparison) {
      <div class="insight-banner" [class]="'insight-banner--' + data()!.comparison.changeDirection">
        <i class="pi"
           [class.pi-trending-up]="data()!.comparison.changeDirection === 'up'"
           [class.pi-trending-down]="data()!.comparison.changeDirection === 'down'"
           [class.pi-minus]="data()!.comparison.changeDirection === 'stable'">
        </i>
        <p class="insight-message">{{ data()!.comparison.message }}</p>
        <span class="insight-badge" [class]="'badge--' + data()!.comparison.changeDirection">
          {{ data()!.comparison.changeDirection === 'down' ? '' : '+' }}{{ data()!.comparison.changePercent | number:'1.1-1' }} %
        </span>
      </div>
    }

    <!-- KPI Cards -->
    @if (loading()) {
      <div class="kpi-grid">
        <div class="kpi-skeleton"></div>
        <div class="kpi-skeleton"></div>
        <div class="kpi-skeleton"></div>
      </div>
    } @else if (data()) {
      <div class="kpi-grid">
        <app-stat-card
          label="Chiffre d'affaires HT" i18n-label="@@reports.analytics.chiffre.d.affaires.ht.170920d6"
          [value]="formatAmount(data()!.totalRevenue)"
          icon="pi-dollar"
          variant="success"
          [change]="data()!.comparison.changePercent">
        </app-stat-card>
        <app-stat-card
          label="Documents comptés" i18n-label="@@reports.analytics.documents.comptes.ef17ff03"
          [value]="data()!.totalInvoices"
          icon="pi-file"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Période précédente" i18n-label="@@reports.analytics.periode.precedente.5e420e76"
          [value]="formatAmount(data()!.comparison.previousValue)"
          icon="pi-history"
          variant="warning">
        </app-stat-card>
      </div>
    }

    <!-- Revenue Chart -->
    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.analytics.evolution.du.chiffre.d.affaires.ht.58b3551f">Évolution du chiffre d'affaires HT</h2>
        <span class="section-hint" i18n="@@reports.analytics.ce.graphique.montre.vos.revenus.sur.la.p.a0a9ea52">
          <i class="pi pi-info-circle"></i>
          Ce graphique montre vos revenus sur la période sélectionnée
        </span>
      </div>

      @if (loading()) {
        <div class="chart-placeholder">
          <div class="loading-spinner">
            <i class="pi pi-spin pi-spinner"></i>
            <span i18n="@@reports.analytics.chargement.a209b664">Chargement...</span>
          </div>
        </div>
      } @else if (data()?.chartData && hasChartData()) {
        <div class="chart-container" role="img" aria-label="Graphique en barres du chiffre d'affaires" i18n-aria-label="@@reports.analytics.graphique.en.barres.du.chiffre.d.affaires.7fbaa86e">
          <div class="chart-y-axis">
            <span class="y-label">{{ formatAmountShort(maxRevenue) }}</span>
            <span class="y-label">{{ formatAmountShort(maxRevenue / 2) }}</span>
            <span class="y-label">0</span>
          </div>
          <div class="chart-area">
            <div class="chart-grid-lines">
              <div class="grid-line"></div>
              <div class="grid-line"></div>
              <div class="grid-line"></div>
            </div>
            <div class="chart-bars">
              @for (item of getVisibleChartData(); track item.label) {
                <div class="bar-group">
                  <div class="bar-tooltip" i18n="@@reports.analytics.facture.a81448ce.pl">
                    <strong>{{ formatAmount(item.revenue) }}</strong><br>
                    <small>{{ item.invoiceCount }} {item.invoiceCount, plural, =0 {facture} =1 {facture} other {factures}}</small>
                  </div>
                  <div class="bar-wrapper">
                    <div
                      class="bar"
                      [style.height.%]="getBarHeight(item.revenue)"
                      [class.bar-zero]="item.revenue === 0"
                      [class.bar-negative]="item.revenue < 0">
                    </div>
                  </div>
                  <span class="bar-label">{{ item.labelShort }}</span>
                </div>
              }
            </div>
          </div>
        </div>
      } @else {
        <div class="chart-placeholder">
          <div class="empty-state">
            <i class="pi pi-chart-bar empty-icon"></i>
            <p class="empty-title" i18n="@@reports.analytics.aucune.donnee.pour.cette.periode.b2a99770">Aucune donnée pour cette période</p>
            <p class="empty-subtitle" i18n="@@reports.analytics.les.revenus.apparaitront.ici.une.fois.que.vous.a.2eb84cc9">Les revenus apparaîtront ici une fois que vous aurez des factures payées.</p>
          </div>
        </div>
      }
    </div>

    <!-- Revenue by Client -->
    <div class="grid-2-cols">
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.analytics.ca.ht.par.client.4e8ae89a">CA HT par client</h2>
          <span class="section-hint" i18n="@@reports.analytics.vos.meilleurs.clients.par.montant.total.b23d587d">
            <i class="pi pi-info-circle"></i>
            Vos meilleurs clients par montant total des factures payées
          </span>
        </div>

        @if (loading()) {
          <div class="loading-spinner"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.analytics.chargement.a209b664">Chargement...</span></div>
        } @else if (!data()?.byClient?.length) {
          <div class="empty-state-sm">
            <i class="pi pi-users"></i>
            <p i18n="@@reports.analytics.aucune.donnee.disponible.78c36aa1">Aucune donnée disponible</p>
          </div>
        } @else {
          <div class="ranking-list">
            @for (client of data()!.byClient; track client.clientName; let i = $index) {
              <div class="ranking-item">
                <div class="rank-badge" [class]="'rank-' + (i < 3 ? i + 1 : 'default')">
                  {{ i + 1 }}
                </div>
                <div class="rank-info" i18n="@@reports.analytics.facture.e9fce0d2.pl">
                  <span class="rank-name">{{ client.clientName }}</span>
                  <span class="rank-detail">{{ client.invoiceCount }} {client.invoiceCount, plural, =0 {facture} =1 {facture} other {factures}}</span>
                </div>
                <div class="rank-value">
                  <span class="rank-amount">{{ formatAmount(client.totalAmount) }}</span>
                  <div class="rank-bar-wrapper">
                    <div class="rank-bar" [style.width.%]="client.percentOfTotal"></div>
                  </div>
                  <span class="rank-percent">{{ client.percentOfTotal | number:'1.1-1' }} %</span>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Revenue summary table for print -->
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.analytics.resume.chiffre.682deb74">Résumé chiffré</h2>
          <span class="section-hint" i18n="@@reports.analytics.vue.d.ensemble.de.la.periode.selectionne.02b283eb">
            <i class="pi pi-info-circle"></i>
            Vue d'ensemble de la période sélectionnée
          </span>
        </div>

        @if (!loading() && data()) {
          <div class="summary-cards">
            <div class="summary-item">
              <div class="summary-icon-wrap success">
                <i class="pi pi-check-circle"></i>
              </div>
              <div class="summary-content">
                <span class="summary-label" i18n="@@reports.analytics.total.ca.ht.payee.validee.b4cd5bf1">Total CA HT (Payée + Validée)</span>
                <span class="summary-value">{{ formatAmount(data()!.totalRevenue) }}</span>
                <span class="summary-desc" i18n="@@reports.analytics.factures.moins.avoirs.montants.ht.c85ec87d">Factures moins avoirs, montants HT</span>
              </div>
            </div>
            <div class="summary-item">
              <div class="summary-icon-wrap primary">
                <i class="pi pi-file"></i>
              </div>
              <div class="summary-content">
                <span class="summary-label" i18n="@@reports.analytics.documents.comptes.ef17ff03">Documents comptés</span>
                <span class="summary-value">{{ data()!.totalInvoices }}</span>
                <span class="summary-desc" i18n="@@reports.analytics.nombre.total.de.factures.sur.la.periode.9c4fbfde">Nombre total de factures sur la période</span>
              </div>
            </div>
            <div class="summary-item">
              <div class="summary-icon-wrap warning">
                <i class="pi pi-chart-line"></i>
              </div>
              <div class="summary-content">
                <span class="summary-label" i18n="@@reports.analytics.moyenne.ht.par.document.0290e01c">Moyenne HT par document</span>
                <span class="summary-value">{{ data()!.totalInvoices > 0 ? formatAmount(data()!.totalRevenue / data()!.totalInvoices) : '0' }}</span>
                <span class="summary-desc" i18n="@@reports.analytics.montant.moyen.par.facture.payee.4c9910ff">Montant moyen par facture payée</span>
              </div>
            </div>
          </div>
        }
      </div>
    </div>

    <!-- Print-only section -->
    <div class="print-only print-report">
      <div class="print-header">
        <h1 class="print-title" i18n="@@reports.analytics.chiffre.d.affaires.ht.bca48774">Chiffre d'Affaires HT</h1>
        <div class="print-logo" i18n="@@reports.analytics.logo.83fce832">Logo</div>
      </div>
      <div class="print-separator"></div>
      @if (data()) {
        <table class="print-table">
          <thead>
            <tr>
              <th i18n="@@reports.analytics.client.1bdd79b1">Client</th>
              <th i18n="@@reports.analytics.factures.da35e4f2">Factures</th>
              <th i18n="@@reports.analytics.montant.total.dd001537">Montant total</th>
              <th i18n="@@reports.analytics.part.du.ca.da3a868c">Part du CA</th>
            </tr>
          </thead>
          <tbody>
            @for (client of data()!.byClient; track client.clientName) {
              <tr>
                <td>{{ client.clientName }}</td>
                <td>{{ client.invoiceCount }}</td>
                <td>{{ formatAmount(client.totalAmount) }}</td>
                <td>{{ client.percentOfTotal | number:'1.1-1' }} %</td>
              </tr>
            }
          </tbody>
        </table>
      }
      <div class="print-footer"></div>
    </div>
  `,
    styles: [`
    /* ── Filter Bar ─────────────────────────────────────────── */
    .filter-bar {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-4) var(--spacing-5);
      margin-bottom: var(--spacing-6);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border-subtle);
    }

    .filter-group {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      flex-wrap: wrap;
    }

    .filter-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .period-tabs {
      display: flex;
      gap: var(--spacing-1);
      background: var(--color-neutral-100);
      border-radius: var(--radius-lg);
      padding: var(--spacing-1);
    }

    .period-tab {
      padding: var(--spacing-2) var(--spacing-4);
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
      cursor: pointer;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      transition: all 0.2s ease;
      font-family: inherit;
    }

    .period-tab:hover {
      color: var(--color-text-primary);
      background: var(--color-background);
    }

    .period-tab.active {
      background: var(--color-background-elevated);
      color: var(--color-primary-700);
      box-shadow: var(--shadow-sm);
      font-weight: var(--font-weight-semibold);
    }

    /* ── Insight Banner ─────────────────────────────────────── */
    .insight-banner {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-4) var(--spacing-5);
      border-radius: var(--radius-xl);
      margin-bottom: var(--spacing-6);
      animation: slideDown 0.4s ease-out;
    }

    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .insight-banner--up {
      background: linear-gradient(135deg, var(--color-success-50), rgba(34, 197, 94, 0.05));
      border: 1px solid var(--color-success-200);
    }
    .insight-banner--up .pi { color: var(--color-success-600); font-size: 1.25rem; }

    .insight-banner--down {
      background: linear-gradient(135deg, var(--color-error-50), rgba(239, 68, 68, 0.05));
      border: 1px solid var(--color-error-200);
    }
    .insight-banner--down .pi { color: var(--color-error-600); font-size: 1.25rem; }

    .insight-banner--stable {
      background: linear-gradient(135deg, var(--color-primary-50), rgba(59, 130, 246, 0.05));
      border: 1px solid var(--color-primary-200);
    }
    .insight-banner--stable .pi { color: var(--color-primary-600); font-size: 1.25rem; }

    .insight-message {
      margin: 0;
      flex: 1;
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      line-height: 1.5;
    }

    .insight-badge {
      padding: var(--spacing-1) var(--spacing-3);
      border-radius: var(--radius-full);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-bold);
      font-family: 'JetBrains Mono', monospace;
      white-space: nowrap;
    }
    .badge--up { background: var(--color-success-100); color: var(--color-success-700); }
    .badge--down { background: var(--color-error-100); color: var(--color-error-700); }
    .badge--stable { background: var(--color-primary-100); color: var(--color-primary-700); }

    /* ── KPI Grid ───────────────────────────────────────────── */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-6);
      animation: fadeInUp 0.4s ease-out;
    }

    .kpi-skeleton {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      height: 120px;
      border: 1px solid var(--color-border-subtle);
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ── Section ────────────────────────────────────────────── */
    .section {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-6);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border-subtle);
      margin-bottom: var(--spacing-6);
      transition: all 0.2s ease;
      animation: fadeInUp 0.4s ease-out;
    }

    .section:hover {
      box-shadow: var(--shadow-md);
    }

    .section-header {
      margin-bottom: var(--spacing-5);
      padding-bottom: var(--spacing-4);
      border-bottom: 2px solid var(--color-border-subtle);
    }

    .section-title {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      margin: 0 0 var(--spacing-2);
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .section-title::before {
      content: '';
      width: 4px;
      height: 20px;
      background: linear-gradient(180deg, var(--color-primary-500), var(--color-primary-600));
      border-radius: var(--radius-full);
    }

    .section-hint {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      display: flex;
      align-items: center;
      gap: var(--spacing-1);
    }

    .section-hint .pi {
      font-size: 0.75rem;
      opacity: 0.7;
    }

    /* ── Chart ──────────────────────────────────────────────── */
    .chart-placeholder {
      min-height: 280px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      border: 2px dashed var(--color-border-subtle);
    }

    .chart-container {
      display: flex;
      gap: var(--spacing-2);
      padding: var(--spacing-4) 0;
    }

    .chart-y-axis {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding-bottom: 28px;
      min-width: 60px;
      text-align: end;
    }

    .y-label {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      font-family: 'JetBrains Mono', monospace;
    }

    .chart-area {
      flex: 1;
      position: relative;
      min-height: 250px;
    }

    .chart-grid-lines {
      position: absolute;
      top: 0;
      inset-inline-start: 0;
      inset-inline-end: 0;
      bottom: 28px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      pointer-events: none;
    }

    .grid-line {
      height: 1px;
      background: var(--color-border-subtle);
    }

    .chart-bars {
      display: flex;
      align-items: flex-end;
      height: calc(100% - 28px);
      gap: 2px;
      padding: 0;
    }

    .bar-group {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      min-width: 0;
      position: relative;
      height: 100%;
      justify-content: flex-end;
    }

    .bar-wrapper {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }

    .bar {
      width: 70%;
      max-width: 50px;
      min-height: 3px;
      background: linear-gradient(180deg, var(--color-primary-400), var(--color-primary-600));
      border-radius: var(--radius-md) var(--radius-md) 0 0;
      transition: height 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
      cursor: pointer;
    }

    .bar:hover {
      background: linear-gradient(180deg, var(--color-primary-300), var(--color-primary-500));
    }

    .bar-zero {
      background: var(--color-neutral-200);
    }

    .bar-negative {
      background: linear-gradient(180deg, var(--color-error-400), var(--color-error-600));
    }

    .bar-negative:hover {
      background: linear-gradient(180deg, var(--color-error-300), var(--color-error-500));
    }

    .bar-tooltip {
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%) translateY(-100%);
      background: var(--color-text-primary);
      color: var(--color-background);
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-md);
      font-size: var(--font-size-xs);
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      z-index: 10;
      text-align: center;
      font-family: 'JetBrains Mono', monospace;
    }

    .bar-group:hover .bar-tooltip { opacity: 1; }

    .bar-label {
      margin-top: var(--spacing-2);
      font-size: 10px;
      color: var(--color-text-secondary);
      text-align: center;
      line-height: 1;
    }

    /* ── Ranking List ───────────────────────────────────────── */
    .ranking-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .ranking-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-lg);
      transition: background 0.2s ease;
      border: 1px solid transparent;
    }

    .ranking-item:hover {
      background: var(--color-neutral-50);
      border-color: var(--color-border-subtle);
    }

    .rank-badge {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-full);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-bold);
      flex-shrink: 0;
    }

    .rank-1 { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: white; }
    .rank-2 { background: linear-gradient(135deg, #9ca3af, #6b7280); color: white; }
    .rank-3 { background: linear-gradient(135deg, #d97706, #b45309); color: white; }
    .rank-default { background: var(--color-neutral-100); color: var(--color-text-secondary); }

    .rank-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .rank-name {
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .rank-detail {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    .rank-value {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--spacing-1);
      min-width: 120px;
    }

    .rank-amount {
      font-family: 'JetBrains Mono', monospace;
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
    }

    .rank-bar-wrapper {
      width: 100%;
      height: 4px;
      background: var(--color-neutral-200);
      border-radius: var(--radius-full);
      overflow: hidden;
    }

    .rank-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--color-primary-500), var(--color-primary-400));
      border-radius: var(--radius-full);
      transition: width 0.6s ease;
    }

    .rank-percent {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    /* ── Summary Cards ──────────────────────────────────────── */
    .summary-cards {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .summary-item {
      display: flex;
      gap: var(--spacing-4);
      padding: var(--spacing-4);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle);
      background: var(--color-neutral-50);
      transition: all 0.2s ease;
    }

    .summary-item:hover {
      border-color: var(--color-primary-200);
      background: var(--color-primary-50);
    }

    .summary-icon-wrap {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-lg);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 1.1rem;
    }

    .summary-icon-wrap.success { background: var(--color-success-100); color: var(--color-success-700); }
    .summary-icon-wrap.primary { background: var(--color-primary-100); color: var(--color-primary-700); }
    .summary-icon-wrap.warning { background: var(--color-warning-100); color: var(--color-warning-700); }

    .summary-content {
      display: flex;
      flex-direction: column;
    }

    .summary-label {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .summary-value {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      font-family: 'JetBrains Mono', monospace;
    }

    .summary-desc {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      margin-top: var(--spacing-1);
    }

    /* ── Grid ───────────────────────────────────────────────── */
    .grid-2-cols {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: var(--spacing-6);
    }

    /* ── Empty & Loading State ──────────────────────────────── */
    .loading-spinner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-8);
      color: var(--color-text-secondary);
    }

    .loading-spinner .pi { font-size: 2rem; }

    .empty-state {
      text-align: center;
      color: var(--color-text-secondary);
    }

    .empty-icon {
      font-size: 3rem;
      color: var(--color-primary-300);
      margin-bottom: var(--spacing-3);
    }

    .empty-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: var(--spacing-2);
    }

    .empty-subtitle {
      font-size: var(--font-size-sm);
      max-width: 400px;
      margin: 0 auto;
    }

    .empty-state-sm {
      padding: var(--spacing-8);
      text-align: center;
      color: var(--color-text-secondary);
    }

    .empty-state-sm .pi {
      font-size: 2rem;
      margin-bottom: var(--spacing-3);
      display: block;
    }

    /* ── Print Styles ───────────────────────────────────────── */
    .print-only { display: none; }

    @media print {
      :host {
        font-size: 11pt;
        color: #333;
      }

      .filter-bar, .insight-banner, .kpi-grid, .section, .grid-2-cols {
        display: none !important;
      }

      .print-only {
        display: block !important;
      }

      .print-report {
        padding: 40px;
      }

      .print-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }

      .print-title {
        font-size: 28pt;
        font-weight: 800;
        color: #2bbcb3;
        font-style: italic;
        margin: 0;
      }

      .print-logo {
        width: 70px;
        height: 70px;
        border-radius: 50%;
        background: #f5a623;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 14pt;
      }

      .print-separator {
        height: 3px;
        background: linear-gradient(90deg, #2bbcb3, #2bbcb3 80%, transparent);
        margin-bottom: 20px;
      }

      .print-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11pt;
      }

      .print-table thead th {
        text-align: start;
        padding: 12px 16px;
        font-weight: 600;
        color: #333;
        border-bottom: 2px solid #2bbcb3;
        font-size: 10pt;
      }

      .print-table tbody td {
        padding: 14px 16px;
        border-bottom: 1px solid #eee;
        color: #555;
      }

      .print-table tbody tr:nth-child(even) {
        background: #fafafa;
      }

      .print-footer {
        position: fixed;
        bottom: 0;
        inset-inline-start: 0;
        inset-inline-end: 0;
        height: 12px;
        background: #2bbcb3;
      }
    }

    /* ── Responsive ─────────────────────────────────────────── */
    @media (max-width: 1024px) {
      .grid-2-cols {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 768px) {
      .kpi-grid {
        grid-template-columns: 1fr;
      }

      .period-tabs {
        flex-wrap: wrap;
      }

      .chart-y-axis {
        display: none;
      }

      .section {
        padding: var(--spacing-4);
      }
    }
  `]
})
export class RevenueAnalyticsComponent implements OnInit {
    private analyticsService = inject(AnalyticsService);
    private route = inject(ActivatedRoute);

    loading = signal(true);
    data = signal<RevenueData | null>(null);
    selectedPeriod: AnalyticsPeriod = 'month';
    maxRevenue = 0;

    periodOptions = [
        { label: $localize`:@@reports.revenue-analytics.ts.aujourd.hui.baca97f6:Aujourd'hui`, value: 'day' as AnalyticsPeriod },
        { label: $localize`:@@reports.revenue-analytics.ts.ce.mois.db74c560:Ce mois`, value: 'month' as AnalyticsPeriod },
        { label: $localize`:@@reports.revenue-analytics.ts.cette.annee.052507a0:Cette année`, value: 'year' as AnalyticsPeriod },
        { label: $localize`:@@reports.revenue-analytics.ts.cumule.39d4fcc6:Cumulé`, value: 'all' as AnalyticsPeriod }
    ];

    ngOnInit(): void {
        // Allow callers (e.g. the dashboard "Chiffre d'affaires" card) to preselect a period.
        const requested = this.route.snapshot.queryParamMap.get('period');
        if (this.periodOptions.some(p => p.value === requested)) {
            this.selectedPeriod = requested as AnalyticsPeriod;
        }
        this.loadData();
    }

    onPeriodChange(period: AnalyticsPeriod): void {
        this.selectedPeriod = period;
        this.loadData();
    }

    loadData(): void {
        this.loading.set(true);
        this.analyticsService.loadRevenueData(this.selectedPeriod).subscribe({
            next: (result) => {
                this.data.set(result);
                // Bars can be negative (avoirs > factures on a given period) :
                // size the axis on magnitude, not the signed value.
                this.maxRevenue = Math.max(...result.chartData.map(d => Math.abs(d.revenue)), 1);
                this.loading.set(false);
            },
            error: () => this.loading.set(false)
        });
    }

    hasChartData(): boolean {
        return this.data()?.chartData.some(d => d.revenue !== 0) || false;
    }

    getVisibleChartData() {
        const chartData = this.data()?.chartData || [];
        // For day view: show all 24h, for month: show all days, for year: 12 months
        if (this.selectedPeriod === 'day') {
            return chartData;
        }
        return chartData;
    }

    getBarHeight(revenue: number): number {
        if (this.maxRevenue === 0) return 2;
        return Math.max((Math.abs(revenue) / this.maxRevenue) * 100, 2);
    }

    formatAmount(amount: number): string {
        return new Intl.NumberFormat('fr-FR', {
            minimumFractionDigits: 3,
            maximumFractionDigits: 3
        }).format(amount) + ' ' + (this.data()?.currency || 'TND');
    }

    formatAmountShort(amount: number): string {
        if (amount >= 1000000) return (amount / 1000000).toFixed(1) + 'M';
        if (amount >= 1000) return (amount / 1000).toFixed(1) + 'K';
        return amount.toFixed(0);
    }

    onPrint(): void {
        window.print();
    }
}
