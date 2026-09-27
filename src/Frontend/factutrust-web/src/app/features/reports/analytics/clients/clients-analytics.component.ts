import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
    AnalyticsService,
    ClientsData,
    ClientAnalyticsItem
} from '../../services/analytics.service';

@Component({
    selector: 'app-clients-analytics',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        RouterModule,
        TableModule,
        PageHeaderComponent,
        StatCardComponent,
        ButtonComponent
    ],
    template: `
    <app-page-header
      title="Analyse clients" i18n-title="@@reports.analytics.analyse.clients.f6f71bbe"
      subtitle="Identifiez vos meilleurs clients et ceux qui nécessitent votre attention" i18n-subtitle="@@reports.analytics.identifiez.vos.meilleurs.clients.et.ceux.3f3be040">
      <app-button
        variant="secondary"
        icon="pi-print"
        iconPos="left"
        (click)="onPrint()" i18n="@@reports.analytics.imprimer.5382c09d"> Imprimer </app-button>
    </app-page-header>

    <!-- Alerts -->
    @if (!loading() && data()?.alerts?.length) {
      <div class="alerts-section">
        @for (alert of data()!.alerts; track alert.title) {
          <div class="alert-card" [class]="'alert-card--' + alert.type">
            <i class="pi" [class]="alert.icon"></i>
            <div class="alert-content">
              <strong>{{ alert.title }}</strong>
              <p>{{ alert.message }}</p>
            </div>
          </div>
        }
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
          label="Clients total" i18n-label="@@reports.analytics.clients.total.7c655b08"
          [value]="data()!.totalClients"
          icon="pi-users"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Clients actifs" i18n-label="@@reports.analytics.clients.actifs.c6ec334f"
          [value]="data()!.activeCount"
          icon="pi-check-circle"
          variant="success">
        </app-stat-card>
        <app-stat-card
          label="Clients inactifs" i18n-label="@@reports.analytics.clients.inactifs.995a475e"
          [value]="data()!.inactiveCount"
          icon="pi-user-minus"
          [variant]="data()!.inactiveCount > data()!.activeCount ? 'error' : 'warning'">
        </app-stat-card>
      </div>

      <!-- Active/Inactive visual bar -->
      <div class="section activity-section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.analytics.repartition.actifs.inactifs.8882d0b8">Répartition actifs / inactifs</h2>
          <span class="section-hint" i18n="@@reports.analytics.un.client.actif.est.un.client.qui.est.ma.1c3a352e">
            <i class="pi pi-info-circle"></i>
            Un client actif est un client qui est marqué comme actif dans votre base
          </span>
        </div>
        <div class="activity-bar-bg">
          <div class="activity-bar-active" [style.width.%]="data()!.activePercent">
            @if (data()!.activePercent > 15) {
              <span class="activity-label" i18n="@@reports.analytics.actifs.990ea293">{{ data()!.activeCount }} actifs</span>
            }
          </div>
          <div class="activity-bar-inactive" [style.width.%]="100 - data()!.activePercent">
            @if ((100 - data()!.activePercent) > 15) {
              <span class="activity-label" i18n="@@reports.analytics.inactifs.e1cd6d2b">{{ data()!.inactiveCount }} inactifs</span>
            }
          </div>
        </div>
        <div class="activity-legend" i18n="@@reports.analytics.actifs.inactifs.86cbc346">
          <span class="legend-item"><span class="legend-dot active"></span> Actifs ({{ data()!.activePercent | number:'1.0-0' }} %)</span>
          <span class="legend-item"><span class="legend-dot inactive"></span> Inactifs ({{ 100 - data()!.activePercent | number:'1.0-0' }} %)</span>
        </div>
      </div>
    }

    <!-- Filters -->
    <div class="filter-bar">
      <div class="filter-group">
        <div class="search-input-wrap">
          <i class="pi pi-search search-icon"></i>
          <input
            type="text"
            class="search-input"
            placeholder="Rechercher un client..." i18n-placeholder="@@reports.analytics.rechercher.un.client.37880794"
            [(ngModel)]="searchQuery"
            (ngModelChange)="onSearch()"
            aria-label="Rechercher un client" i18n-aria-label="@@reports.analytics.rechercher.un.client.723cebe6">
        </div>
        <div class="filter-tabs">
          <button class="filter-tab" [class.active]="filter === 'all'" (click)="onFilter('all')" i18n="@@reports.analytics.tous.b97ae3b4"> Tous </button>
          <button class="filter-tab" [class.active]="filter === 'active'" (click)="onFilter('active')" i18n="@@reports.analytics.actifs.4fc3a980"> Actifs </button>
          <button class="filter-tab" [class.active]="filter === 'inactive'" (click)="onFilter('inactive')" i18n="@@reports.analytics.inactifs.41c2d03e"> Inactifs </button>
          <button class="filter-tab" [class.active]="filter === 'unpaid'" (click)="onFilter('unpaid')" i18n="@@reports.analytics.impayes.7aa7551c">
            <i class="pi pi-exclamation-circle" style="font-size: 0.7rem;"></i>
            Impayés
          </button>
        </div>
      </div>
    </div>

    <!-- Client Ranking Table -->
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">
          {{ sectionTitle }}
        </h2>
        <span class="section-hint">
          <i class="pi pi-info-circle"></i>
          {{ sectionSubtitle }}
        </span>
      </div>

      @if (loading()) {
        <div class="loading-spinner"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.analytics.chargement.a209b664">Chargement...</span></div>
      } @else if (!filteredClients().length) {
        <div class="empty-state-sm">
          <i class="pi pi-users"></i>
          <p i18n="@@reports.analytics.aucun.client.trouve.ef55e6be">Aucun client trouvé</p>
          <p class="empty-hint">{{ searchQuery ? loc_ui_tern_aucun_resultat_pour_votre_recherche_2cb219 : loc_ui_tern_aucune_donnee_disponible_279625 }}</p>
        </div>
      } @else {
        <div class="clients-table-wrapper">
          <table class="clients-table" aria-label="Tableau de classement des clients" i18n-aria-label="@@reports.analytics.tableau.de.classement.des.clients.85685e36">
            <thead>
              <tr>
                <th class="col-rank" i18n="@@reports.analytics.text.d08f88df">#</th>
                <th i18n="@@reports.analytics.client.1bdd79b1">Client</th>
                <th class="text-center" i18n="@@reports.analytics.statut.659499f3">Statut</th>
                <th class="text-right" title="Nombre de factures" i18n-title="@@reports.analytics.nombre.de.factures.53d3152f" i18n="@@reports.analytics.nb.factures.973edc99">Nb factures</th>
                <th class="text-right" i18n="@@reports.analytics.chiffre.d.affaires.0a341b9f">Chiffre d'affaires</th>
                @if (filter === 'unpaid' || filter === 'all') {
                  <th class="text-right" i18n="@@reports.analytics.impayes.1545a134">Impayés</th>
                }
                <th class="col-actions" i18n="@@reports.analytics.actions.c3cd636a">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (client of filteredClients(); track client.id; let i = $index) {
                <tr [class.row-unpaid]="client.unpaidCount > 0">
                  <td class="col-rank">
                    <span class="rank-num" [class]="'rank-' + (i < 3 ? i + 1 : 'default')">
                      {{ i + 1 }}
                    </span>
                  </td>
                  <td>
                    <div class="client-cell">
                      <span class="client-name">{{ client.name }}</span>
                      <span class="client-email">{{ client.email }}</span>
                    </div>
                  </td>
                  <td class="text-center">
                    <span class="status-badge" [class.active]="client.isActive" [class.inactive]="!client.isActive">
                      {{ client.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033 }}
                    </span>
                  </td>
                  <td class="text-right">
                    <span class="mono-value">{{ client.totalInvoices }}</span>
                  </td>
                  <td class="text-right">
                    <span class="mono-value amount">{{ formatAmount(client.totalRevenue) }}</span>
                  </td>
                  @if (filter === 'unpaid' || filter === 'all') {
                    <td class="text-right">
                      @if (client.unpaidCount > 0) {
                        <div class="unpaid-cell">
                          <span class="unpaid-count">{{ client.unpaidCount }}</span>
                          <span class="unpaid-amount">{{ formatAmount(client.unpaidAmount) }}</span>
                        </div>
                      } @else {
                        <span class="no-unpaid" i18n="@@reports.analytics.aucun.impaye.137feeeb">Aucun impayé</span>
                      }
                    </td>
                  }
                  <td class="col-actions">
                    <app-button
                      variant="ghost"
                      size="sm"
                      icon="pi-eye"
                      [routerLink]="['/invoices']"
                      [queryParams]="{ search: client.name }"
                      ariaLabel="Voir les factures de ce client" i18n-ariaLabel="@@reports.analytics.voir.les.factures.de.ce.client.558dcfb3" i18n="@@reports.analytics.factures.da35e4f2"> Factures </app-button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Results count -->
        <div class="results-count" i18n="@@reports.analytics.client.affiche.169b2144.pl">
          {{ filteredClients().length }} {filteredClients().length, plural, =0 {client affiché} =1 {client affiché} other {clients affichés}}
        </div>
      }
    </div>

    <!-- Print-only section -->
    <div class="print-only print-report">
      <div class="print-header">
        <h1 class="print-title" i18n="@@reports.analytics.analyse.clients.8c024114">Analyse Clients</h1>
        <div class="print-logo" i18n="@@reports.analytics.logo.83fce832">Logo</div>
      </div>
      <div class="print-separator"></div>
      @if (data()) {
        <div class="print-kpis">
          <div class="print-kpi"><strong i18n="@@reports.analytics.total.clients.9c969efc">Total clients</strong><span>{{ data()!.totalClients }}</span></div>
          <div class="print-kpi"><strong i18n="@@reports.analytics.actifs.4fc3a980">Actifs</strong><span>{{ data()!.activeCount }}</span></div>
          <div class="print-kpi"><strong i18n="@@reports.analytics.inactifs.41c2d03e">Inactifs</strong><span>{{ data()!.inactiveCount }}</span></div>
        </div>
        <h3 class="print-subtitle" i18n="@@reports.analytics.classement.par.chiffre.d.affaires.a7553a74">Classement par chiffre d'affaires</h3>
        <table class="print-table">
          <thead>
            <tr>
              <th i18n="@@reports.analytics.text.d08f88df">#</th>
              <th i18n="@@reports.analytics.client.1bdd79b1">Client</th>
              <th i18n="@@reports.analytics.statut.659499f3">Statut</th>
              <th i18n="@@reports.analytics.nb.factures.973edc99">Nb factures</th>
              <th i18n="@@reports.analytics.chiffre.d.affaires.0a341b9f">Chiffre d'affaires</th>
              <th i18n="@@reports.analytics.impayes.1545a134">Impayés</th>
            </tr>
          </thead>
          <tbody>
            @for (client of data()!.clientRanking; track client.id; let i = $index) {
              <tr>
                <td>{{ i + 1 }}</td>
                <td>{{ client.name }}</td>
                <td>{{ client.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033 }}</td>
                <td>{{ client.totalInvoices }}</td>
                <td>{{ formatAmount(client.totalRevenue) }}</td>
                <td>{{ client.unpaidCount > 0 ? client.unpaidCount + ' (' + formatAmount(client.unpaidAmount) + ')' : loc_ui_tern_aucun_impaye_137fee }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
      <div class="print-footer"></div>
    </div>
  `,
    styles: [`
    /* ── Alerts ─────────────────────────────────────────────── */
    .alerts-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
      margin-bottom: var(--spacing-6);
    }

    .alert-card {
      display: flex;
      gap: var(--spacing-3);
      padding: var(--spacing-4) var(--spacing-5);
      border-radius: var(--radius-xl);
      animation: slideIn 0.4s ease-out;
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateX(-10px); }
      to { opacity: 1; transform: translateX(0); }
    }

    .alert-card--danger {
      background: linear-gradient(135deg, var(--color-error-50), rgba(239, 68, 68, 0.03));
      border: 1px solid var(--color-error-200);
    }
    .alert-card--danger .pi { color: var(--color-error-600); font-size: 1.25rem; }

    .alert-card--warning {
      background: linear-gradient(135deg, var(--color-warning-50), rgba(245, 158, 11, 0.03));
      border: 1px solid var(--color-warning-200);
    }
    .alert-card--warning .pi { color: var(--color-warning-600); font-size: 1.25rem; }

    .alert-content { flex: 1; }
    .alert-content strong { font-size: var(--font-size-sm); display: block; margin-bottom: var(--spacing-1); }
    .alert-content p { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }

    /* ── KPI Grid ───────────────────────────────────────────── */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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

    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

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

    .section:hover { box-shadow: var(--shadow-md); }

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

    .section-hint .pi { font-size: 0.75rem; opacity: 0.7; }

    /* ── Activity Bar ───────────────────────────────────────── */
    .activity-section {
      margin-bottom: var(--spacing-6);
    }

    .activity-bar-bg {
      display: flex;
      height: 36px;
      border-radius: var(--radius-xl);
      overflow: hidden;
      border: 1px solid var(--color-border-subtle);
    }

    .activity-bar-active {
      background: linear-gradient(90deg, var(--color-success-500), var(--color-success-400));
      display: flex;
      align-items: center;
      justify-content: center;
      transition: width 0.8s ease;
    }

    .activity-bar-inactive {
      background: var(--color-neutral-200);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: width 0.8s ease;
    }

    .activity-label {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: white;
    }

    .activity-bar-inactive .activity-label {
      color: var(--color-text-secondary);
    }

    .activity-legend {
      display: flex;
      gap: var(--spacing-6);
      justify-content: center;
      margin-top: var(--spacing-3);
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: var(--radius-full);
    }

    .legend-dot.active { background: var(--color-success-500); }
    .legend-dot.inactive { background: var(--color-neutral-300); }

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

    .search-input-wrap {
      position: relative;
      flex: 1;
      min-width: 200px;
    }

    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-text-secondary);
      font-size: 0.9rem;
    }

    .search-input {
      width: 100%;
      padding: var(--spacing-2) var(--spacing-3) var(--spacing-2) 36px;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      background: var(--color-background);
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      font-family: inherit;
      transition: all 0.2s ease;
    }

    .search-input:focus {
      outline: none;
      border-color: var(--color-primary-500);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .filter-tabs {
      display: flex;
      gap: var(--spacing-1);
      background: var(--color-neutral-100);
      border-radius: var(--radius-lg);
      padding: var(--spacing-1);
    }

    .filter-tab {
      padding: var(--spacing-2) var(--spacing-3);
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
      cursor: pointer;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      transition: all 0.2s ease;
      font-family: inherit;
      display: flex;
      align-items: center;
      gap: var(--spacing-1);
    }

    .filter-tab:hover { color: var(--color-text-primary); background: var(--color-background); }

    .filter-tab.active {
      background: var(--color-background-elevated);
      color: var(--color-primary-700);
      box-shadow: var(--shadow-sm);
      font-weight: var(--font-weight-semibold);
    }

    /* ── Clients Table ──────────────────────────────────────── */
    .clients-table-wrapper {
      overflow-x: auto;
      border-radius: var(--radius-lg);
    }

    .clients-table {
      width: 100%;
      border-collapse: collapse;
    }

    .clients-table thead th {
      padding: var(--spacing-3) var(--spacing-4);
      background: var(--color-neutral-50);
      color: var(--color-text-secondary);
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 2px solid var(--color-border-default);
      white-space: nowrap;
    }

    .clients-table tbody td {
      padding: var(--spacing-3) var(--spacing-4);
      border-bottom: 1px solid var(--color-border-subtle);
      vertical-align: middle;
    }

    .clients-table tbody tr:hover {
      background: var(--color-primary-50);
    }

    .clients-table tbody tr:last-child td {
      border-bottom: none;
    }

    .row-unpaid {
      border-left: 3px solid var(--color-error-400);
    }

    .col-rank { width: 48px; text-align: center; }
    .col-actions { width: 120px; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }

    .rank-num {
      display: inline-flex;
      width: 26px;
      height: 26px;
      border-radius: var(--radius-full);
      align-items: center;
      justify-content: center;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
    }

    .rank-1 { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: white; }
    .rank-2 { background: linear-gradient(135deg, #9ca3af, #6b7280); color: white; }
    .rank-3 { background: linear-gradient(135deg, #d97706, #b45309); color: white; }
    .rank-default { background: var(--color-neutral-100); color: var(--color-text-secondary); }

    .client-cell {
      display: flex;
      flex-direction: column;
    }

    .client-name {
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
    }

    .client-email {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    .status-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
    }

    .status-badge.active { background: var(--color-success-100); color: var(--color-success-700); }
    .status-badge.inactive { background: var(--color-neutral-100); color: var(--color-text-secondary); }

    .mono-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: var(--font-size-sm);
    }

    .amount {
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .unpaid-cell {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }

    .unpaid-count {
      font-weight: var(--font-weight-bold);
      color: var(--color-error-600);
      font-size: var(--font-size-sm);
    }

    .unpaid-amount {
      font-size: var(--font-size-xs);
      color: var(--color-error-500);
      font-family: 'JetBrains Mono', monospace;
    }

    .no-unpaid {
      color: var(--color-text-secondary);
    }

    .results-count {
      margin-top: var(--spacing-4);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      text-align: right;
    }

    /* ── Empty & Loading ────────────────────────────────────── */
    .loading-spinner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-8);
      color: var(--color-text-secondary);
    }
    .loading-spinner .pi { font-size: 2rem; }

    .empty-state-sm {
      padding: var(--spacing-8);
      text-align: center;
      color: var(--color-text-secondary);
    }
    .empty-state-sm .pi { font-size: 2rem; margin-bottom: var(--spacing-3); display: block; }
    .empty-hint { font-size: var(--font-size-sm); margin-top: var(--spacing-2); opacity: 0.8; }

    /* ── Print ──────────────────────────────────────────────── */
    .print-only { display: none; }

    @media print {
      :host { font-size: 11pt; color: #333; }

      .alerts-section, .kpi-grid, .section, .filter-bar, .activity-section {
        display: none !important;
      }

      .print-only { display: block !important; }
      .print-report { padding: 40px; }
      .print-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
      .print-title { font-size: 28pt; font-weight: 800; color: #2bbcb3; font-style: italic; margin: 0; }
      .print-logo { width: 70px; height: 70px; border-radius: 50%; background: #f5a623; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14pt; }
      .print-separator { height: 3px; background: linear-gradient(90deg, #2bbcb3, #2bbcb3 80%, transparent); margin-bottom: 20px; }
      .print-kpis { display: flex; gap: 20px; margin-bottom: 20px; }
      .print-kpi { flex: 1; padding: 12px; border: 1px solid #eee; border-radius: 8px; text-align: center; }
      .print-kpi strong { display: block; font-size: 9pt; color: #666; margin-bottom: 4px; }
      .print-kpi span { font-size: 14pt; font-weight: bold; color: #333; }
      .print-subtitle { font-size: 14pt; margin: 16px 0 8px; color: #2bbcb3; }
      .print-table { width: 100%; border-collapse: collapse; font-size: 11pt; }
      .print-table thead th { text-align: left; padding: 12px 16px; font-weight: 600; color: #333; border-bottom: 2px solid #2bbcb3; font-size: 10pt; }
      .print-table tbody td { padding: 14px 16px; border-bottom: 1px solid #eee; color: #555; }
      .print-table tbody tr:nth-child(even) { background: #fafafa; }
      .print-footer { position: fixed; bottom: 0; left: 0; right: 0; height: 12px; background: #2bbcb3; }
    }

    /* ── Responsive ─────────────────────────────────────────── */
    @media (max-width: 768px) {
      .kpi-grid { grid-template-columns: 1fr; }
      .section { padding: var(--spacing-4); }
      .filter-group { flex-direction: column; align-items: stretch; }
      .filter-tabs { flex-wrap: wrap; }
    }
  `]
})
export class ClientsAnalyticsComponent implements OnInit {
  readonly loc_ui_tern_aucun_resultat_pour_votre_recherche_2cb219 = $localize`:@@ui.tern.aucun.resultat.pour.votre.recherche.2cb219:Aucun résultat pour votre recherche.`;
  readonly loc_ui_tern_aucune_donnee_disponible_279625 = $localize`:@@ui.tern.aucune.donnee.disponible.279625:Aucune donnée disponible.`;
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  readonly loc_ui_tern_aucun_impaye_137fee = $localize`:@@ui.tern.aucun.impaye.137fee:Aucun impayé`;
    private readonly analyticsService = inject(AnalyticsService);

    loading = signal(true);
    data = signal<ClientsData | null>(null);
    searchQuery = '';
    filter: 'all' | 'active' | 'inactive' | 'unpaid' = 'all';

    private allClients: ClientAnalyticsItem[] = [];

    filteredClients = signal<ClientAnalyticsItem[]>([]);

    ngOnInit(): void {
        this.loadData();
    }

    loadData(): void {
        this.loading.set(true);
        this.analyticsService.loadClientsData().subscribe({
            next: (result) => {
                this.data.set(result);
                this.allClients = result.clientRanking;
                this.applyFilters();
                this.loading.set(false);
            },
            error: () => this.loading.set(false)
        });
    }

    onSearch(): void {
        this.applyFilters();
    }

    onFilter(f: 'all' | 'active' | 'inactive' | 'unpaid'): void {
        this.filter = f;
        this.applyFilters();
    }

    get sectionTitle(): string {
        return this.filter === 'unpaid'
            ? $localize`:@@ui.tern.clients.avec.impayes.ef5206:Clients avec impayés`
            : $localize`:@@ui.tern.classement.clients.par.chiffre.d.affaires.75f08d:Classement clients par chiffre d'affaires`;
    }

    get sectionSubtitle(): string {
        return this.filter === 'unpaid'
            ? $localize`:@@ui.tern.clients.ayant.des.factures.en.attente.ou.e.bc094a:Clients ayant des factures en attente ou en retard de paiement`
            : $localize`:@@ui.tern.vos.clients.tries.par.le.montant.total.des.f76795:Vos clients triés par le montant total des factures payées`;
    }

    private applyFilters(): void {
        let result = [...this.allClients];

        // Text search
        if (this.searchQuery.trim()) {
            const q = this.searchQuery.toLowerCase().trim();
            result = result.filter(c =>
                c.name.toLowerCase().includes(q) ||
                c.email.toLowerCase().includes(q)
            );
        }

        // Status filter
        if (this.filter === 'active') {
            result = result.filter(c => c.isActive);
        } else if (this.filter === 'inactive') {
            result = result.filter(c => !c.isActive);
        } else if (this.filter === 'unpaid') {
            result = result.filter(c => c.unpaidCount > 0);
            result.sort((a, b) => b.unpaidAmount - a.unpaidAmount);
        }

        this.filteredClients.set(result);
    }

    formatAmount(amount: number): string {
        return new Intl.NumberFormat('fr-FR', {
            minimumFractionDigits: 3,
            maximumFractionDigits: 3
        }).format(amount) + ' ' + (this.data()?.currency || 'TND');
    }

    onPrint(): void {
        globalThis.print();
    }
}
