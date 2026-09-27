import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  AnalyticsService,
  SalesData
} from '../../services/analytics.service';

@Component({
  selector: 'app-sales-analytics',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    StatCardComponent,
    ButtonComponent
  ],
  template: `
    <app-page-header
      title="Analyse des ventes" i18n-title="Analyse des ventes"
      subtitle="Comprenez vos performances commerciales en un coup d'œil">
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
            <div class="alert-icon-wrap">
              <i class="pi" [class]="alert.icon"></i>
            </div>
            <div class="alert-content">
              <strong class="alert-title">{{ alert.title }}</strong>
              <p class="alert-message">{{ alert.message }}</p>
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
        <div class="kpi-skeleton"></div>
      </div>
    } @else if (data()) {
      <div class="kpi-grid">
        <app-stat-card
          label="Taux de conversion" i18n-label="Taux de conversion"
          [value]="data()!.conversionRate.toFixed(1) + ' %'"
          icon="pi-sync"
          [variant]="data()!.conversionRate >= 50 ? 'success' : data()!.conversionRate >= 30 ? 'warning' : 'error'">
        </app-stat-card>
        <div class="kpi-explained">
          <app-stat-card
            label="Panier moyen" i18n-label="Panier moyen"
            [value]="formatAmount(data()!.averageBasket)"
            icon="pi-shopping-cart"
            variant="primary">
          </app-stat-card>
          <span class="kpi-definition">
            <i class="pi pi-info-circle"></i>
            Le panier moyen correspond au montant moyen dépensé par client.
          </span>
        </div>
        <app-stat-card
          label="Devis convertis" i18n-label="Devis convertis"
          [value]="data()!.convertedQuotes + ' / ' + data()!.totalQuotes"
          icon="pi-check-square"
          variant="success">
        </app-stat-card>
        <app-stat-card
          label="Factures payées" i18n-label="Factures payées"
          [value]="data()!.totalInvoices"
          icon="pi-file"
          variant="primary">
        </app-stat-card>
      </div>
    }

    <!-- Conversion Visual -->
    @if (!loading() && data()) {
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.analytics.taux.de.transformation.devis.facture.cdf4fcd5">Taux de transformation devis → facture</h2>
          <span class="section-hint">
            <i class="pi pi-info-circle"></i>
            Ce pourcentage montre combien de vos devis sont devenus des factures
          </span>
        </div>
        <div class="conversion-visual">
          <div class="conversion-bar-bg">
            <div class="conversion-bar-fill" [style.width.%]="data()!.conversionRate">
              <span class="conversion-bar-label" *ngIf="data()!.conversionRate > 15">
                {{ data()!.conversionRate.toFixed(1) }} %
              </span>
            </div>
          </div>
          <div class="conversion-legend">
            <div class="legend-item">
              <span class="legend-dot converted"></span>
              <span>Convertis ({{ data()!.convertedQuotes }})</span>
            </div>
            <div class="legend-item">
              <span class="legend-dot not-converted"></span>
              <span>Non convertis ({{ data()!.totalQuotes - data()!.convertedQuotes }})</span>
            </div>
          </div>
        </div>
      </div>
    }

    <!-- Products Grid -->
    <div class="grid-2-cols">
      <!-- Top Products -->
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">
            <i class="pi pi-star-fill" style="color: #fbbf24; font-size: 0.9rem;"></i>
            Produits avec les meilleures marges
          </h2>
          <span class="section-hint">
            <i class="pi pi-info-circle"></i>
            Classement de vos produits par marge bénéficiaire
          </span>
        </div>

        @if (loading()) {
          <div class="loading-spinner"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.analytics.chargement.a209b664">Chargement...</span></div>
        } @else if (!data()?.topProducts?.length) {
          <div class="empty-state-sm">
            <i class="pi pi-box"></i>
            <p i18n="@@reports.analytics.aucun.produit.enregistre.786c098d">Aucun produit enregistré</p>
            <p class="empty-hint" i18n="@@reports.analytics.ajoutez.des.produits.avec.un.prix.d.achat.pour.v.2f7717d9">Ajoutez des produits avec un prix d'achat pour voir les marges.</p>
          </div>
        } @else {
          <div class="product-list">
            @for (product of data()!.topProducts; track product.productCode; let i = $index) {
              <div class="product-item">
                <div class="product-rank" [class]="'rank-' + (i < 3 ? i + 1 : 'default')">
                  {{ i + 1 }}
                </div>
                <div class="product-info">
                  <span class="product-name">{{ product.productName }}</span>
                  <span class="product-code">{{ product.productCode }}</span>
                </div>
                <div class="product-prices">
                  <span class="product-sell">{{ formatAmountRaw(product.unitPrice) }}</span>
                  @if (product.purchasePrice !== null) {
                    <span class="product-buy">Achat : {{ formatAmountRaw(product.purchasePrice) }}</span>
                  }
                </div>
                <div class="product-margin">
                  @if (product.marginPercent !== null) {
                    <span class="margin-badge"
                      [class.margin-good]="product.marginPercent >= 30"
                      [class.margin-ok]="product.marginPercent >= 15 && product.marginPercent < 30"
                      [class.margin-low]="product.marginPercent < 15">
                      {{ product.marginPercent | number:'1.1-1' }} %
                    </span>
                    <span class="margin-label" i18n="@@reports.analytics.marge.c424ae3c">marge</span>
                  } @else {
                    <span class="margin-badge margin-na" i18n="@@reports.analytics.n.a.08d2e98e">N/A</span>
                    <span class="margin-label" i18n="@@reports.analytics.pas.de.prix.d.achat.caa759dc">pas de prix d'achat</span>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Worst Products -->
      <div class="section">
        <div class="section-header">
          <h2 class="section-title">
            <i class="pi pi-exclamation-triangle" style="color: var(--color-warning-500); font-size: 0.9rem;"></i>
            Marges les plus faibles
          </h2>
          <span class="section-hint">
            <i class="pi pi-info-circle"></i>
            Produits dont la marge est la plus basse — à surveiller
          </span>
        </div>

        @if (loading()) {
          <div class="loading-spinner"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.analytics.chargement.a209b664">Chargement...</span></div>
        } @else if (!data()?.worstProducts?.length) {
          <div class="empty-state-sm">
            <i class="pi pi-check-circle" style="color: var(--color-success-500);"></i>
            <p i18n="@@reports.analytics.aucun.produit.a.faible.marge.detecte.918ba19d">Aucun produit à faible marge détecté</p>
          </div>
        } @else {
          <div class="product-list">
            @for (product of data()!.worstProducts; track product.productCode) {
              <div class="product-item product-item--warning">
                <div class="product-info">
                  <span class="product-name">{{ product.productName }}</span>
                  <span class="product-code">{{ product.productCode }}</span>
                </div>
                <div class="product-margin">
                  @if (product.marginPercent !== null) {
                    <span class="margin-badge margin-low">
                      {{ product.marginPercent | number:'1.1-1' }} %
                    </span>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>

    <!-- Recommendations -->
    @if (!loading() && data()?.recommendations?.length) {
      <div class="section recommendations-section">
        <div class="section-header">
          <h2 class="section-title">
            <i class="pi pi-lightbulb" style="color: #fbbf24; font-size: 0.9rem;"></i>
            Recommandations
          </h2>
          <span class="section-hint">
            <i class="pi pi-info-circle"></i>
            Suggestions pour améliorer vos performances
          </span>
        </div>
        <div class="reco-list">
          @for (reco of data()!.recommendations; track reco) {
            <div class="reco-item">
              <i class="pi pi-arrow-right reco-icon"></i>
              <p class="reco-text">{{ reco }}</p>
            </div>
          }
        </div>
      </div>
    }

    <!-- Print-only section -->
    <div class="print-only print-report">
      <div class="print-header">
        <h1 class="print-title" i18n="@@reports.analytics.analyse.des.ventes.35adf138">Analyse Des Ventes</h1>
        <div class="print-logo" i18n="@@reports.analytics.logo.83fce832">Logo</div>
      </div>
      <div class="print-separator"></div>
      @if (data()) {
        <div class="print-kpis">
          <div class="print-kpi">
            <strong i18n="@@reports.analytics.taux.de.conversion.296dbcee">Taux de conversion</strong>
            <span>{{ data()!.conversionRate.toFixed(1) }} %</span>
          </div>
          <div class="print-kpi">
            <strong i18n="@@reports.analytics.panier.moyen.e9ce57ee">Panier moyen</strong>
            <span>{{ formatAmount(data()!.averageBasket) }}</span>
          </div>
          <div class="print-kpi">
            <strong i18n="@@reports.analytics.devis.convertis.e8e2b1c5">Devis convertis</strong>
            <span>{{ data()!.convertedQuotes }} / {{ data()!.totalQuotes }}</span>
          </div>
        </div>
        <h3 class="print-subtitle" i18n="@@reports.analytics.produits.marges.f4fc65aa">Produits - Marges</h3>
        <table class="print-table">
          <thead>
            <tr>
              <th i18n="@@reports.analytics.produit.ff673dc2">Produit</th>
              <th i18n="@@reports.analytics.code.adac6937">Code</th>
              <th i18n="@@reports.analytics.prix.vente.620ba2f4">Prix vente</th>
              <th i18n="@@reports.analytics.prix.achat.22f9864c">Prix achat</th>
              <th i18n="@@reports.analytics.marge.d9ef1a1d">Marge</th>
            </tr>
          </thead>
          <tbody>
            @for (product of data()!.topProducts; track product.productCode) {
              <tr>
                <td>{{ product.productName }}</td>
                <td>{{ product.productCode }}</td>
                <td>{{ formatAmountRaw(product.unitPrice) }}</td>
                <td>{{ product.purchasePrice !== null ? formatAmountRaw(product.purchasePrice) : 'N/A' }}</td>
                <td>{{ product.marginPercent !== null ? (product.marginPercent | number:'1.1-1') + ' %' : 'N/A' }}</td>
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

    .alert-card--warning {
      background: linear-gradient(135deg, var(--color-warning-50), rgba(245, 158, 11, 0.03));
      border: 1px solid var(--color-warning-200);
    }
    .alert-card--warning .alert-icon-wrap { color: var(--color-warning-600); }

    .alert-card--danger {
      background: linear-gradient(135deg, var(--color-error-50), rgba(239, 68, 68, 0.03));
      border: 1px solid var(--color-error-200);
    }
    .alert-card--danger .alert-icon-wrap { color: var(--color-error-600); }

    .alert-card--success {
      background: linear-gradient(135deg, var(--color-success-50), rgba(34, 197, 94, 0.03));
      border: 1px solid var(--color-success-200);
    }
    .alert-card--success .alert-icon-wrap { color: var(--color-success-600); }

    .alert-card--info {
      background: linear-gradient(135deg, var(--color-primary-50), rgba(59, 130, 246, 0.03));
      border: 1px solid var(--color-primary-200);
    }
    .alert-card--info .alert-icon-wrap { color: var(--color-primary-600); }

    .alert-icon-wrap {
      font-size: 1.25rem;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .alert-content { flex: 1; }
    .alert-title { font-size: var(--font-size-sm); display: block; margin-bottom: var(--spacing-1); }
    .alert-message { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); line-height: 1.5; }

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

    .kpi-explained {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .kpi-definition {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      display: flex;
      align-items: center;
      gap: var(--spacing-1);
      padding: 0 var(--spacing-2);
    }

    .kpi-definition .pi {
      font-size: 0.7rem;
      opacity: 0.6;
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

    /* ── Conversion Visual ──────────────────────────────────── */
    .conversion-visual {
      padding: var(--spacing-4) 0;
    }

    .conversion-bar-bg {
      height: 40px;
      background: var(--color-neutral-100);
      border-radius: var(--radius-xl);
      overflow: hidden;
      position: relative;
    }

    .conversion-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--color-success-500), var(--color-success-400));
      border-radius: var(--radius-xl);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: width 1s cubic-bezier(0.34, 1.56, 0.64, 1);
      min-width: 0;
    }

    .conversion-bar-label {
      color: white;
      font-weight: var(--font-weight-bold);
      font-size: var(--font-size-sm);
      font-family: 'JetBrains Mono', monospace;
    }

    .conversion-legend {
      display: flex;
      gap: var(--spacing-6);
      margin-top: var(--spacing-3);
      justify-content: center;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .legend-dot {
      width: 12px;
      height: 12px;
      border-radius: var(--radius-full);
    }

    .legend-dot.converted { background: var(--color-success-500); }
    .legend-dot.not-converted { background: var(--color-neutral-200); }

    /* ── Product List ───────────────────────────────────────── */
    .product-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .product-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-lg);
      border: 1px solid transparent;
      transition: all 0.2s ease;
    }

    .product-item:hover {
      background: var(--color-neutral-50);
      border-color: var(--color-border-subtle);
    }

    .product-item--warning {
      border-left: 3px solid var(--color-warning-400);
    }

    .product-rank {
      width: 28px;
      height: 28px;
      border-radius: var(--radius-full);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      flex-shrink: 0;
    }

    .rank-1 { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: white; }
    .rank-2 { background: linear-gradient(135deg, #9ca3af, #6b7280); color: white; }
    .rank-3 { background: linear-gradient(135deg, #d97706, #b45309); color: white; }
    .rank-default { background: var(--color-neutral-100); color: var(--color-text-secondary); }

    .product-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .product-name {
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .product-code {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      font-family: 'JetBrains Mono', monospace;
    }

    .product-prices {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      min-width: 80px;
    }

    .product-sell {
      font-family: 'JetBrains Mono', monospace;
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
    }

    .product-buy {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    .product-margin {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 70px;
    }

    .margin-badge {
      padding: var(--spacing-1) var(--spacing-3);
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-bold);
      font-family: 'JetBrains Mono', monospace;
    }

    .margin-good { background: var(--color-success-100); color: var(--color-success-700); }
    .margin-ok { background: var(--color-warning-100); color: var(--color-warning-700); }
    .margin-low { background: var(--color-error-100); color: var(--color-error-700); }
    .margin-na { background: var(--color-neutral-100); color: var(--color-text-secondary); }

    .margin-label {
      font-size: 10px;
      color: var(--color-text-secondary);
      margin-top: 2px;
    }

    /* ── Grid ───────────────────────────────────────────────── */
    .grid-2-cols {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: var(--spacing-6);
    }

    /* ── Recommendations ────────────────────────────────────── */
    .recommendations-section {
      background: linear-gradient(135deg, var(--color-background-elevated), var(--color-primary-50));
    }

    .reco-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    .reco-item {
      display: flex;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-lg);
      background: var(--color-background-elevated);
      border: 1px solid var(--color-border-subtle);
    }

    .reco-icon {
      color: var(--color-primary-500);
      flex-shrink: 0;
      margin-top: 3px;
    }

    .reco-text {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      line-height: 1.5;
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
      .alerts-section, .kpi-grid, .section, .grid-2-cols, .recommendations-section { display: none !important; }
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
    @media (max-width: 1024px) {
      .grid-2-cols { grid-template-columns: 1fr; }
    }

    @media (max-width: 768px) {
      .kpi-grid { grid-template-columns: 1fr; }
      .section { padding: var(--spacing-4); }
    }
  `]
})
export class SalesAnalyticsComponent implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  loading = signal(true);
  data = signal<SalesData | null>(null);

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    this.analyticsService.loadSalesData().subscribe({
      next: (result) => {
        this.data.set(result);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  formatAmount(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(amount) + ' ' + (this.data()?.currency || 'TND');
  }

  formatAmountRaw(amount: number): string {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(amount);
  }

  onPrint(): void {
    globalThis.print();
  }
}
