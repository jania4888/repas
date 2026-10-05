import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PaginatorModule } from 'primeng/paginator';
import { TabsModule } from 'primeng/tabs';
import { CardModule } from 'primeng/card';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { formatLocalDate } from '@core/utils/date.util';
import {
  SalesReportsService,
  SalesReportsData,
  ReportPeriod,
  RevenueCrossTabData,
  CrossTabInsight
} from '../services/sales-reports.service';
import {
  ReportsApiService,
  ClientTransactionReportRow,
  SalesByLineReportRow,
  SalesVatReportRow,
  ProductPerformanceReportRow,
  ProductSalesTrendReportRow,
  BasketMetricsReportDto,
  ProductNeverSoldReportRow,
  SalesRevenueReportRow,
  ClientWithholdingReportRow
} from '@core/services/reports-api.service';
import { erpDateLocale } from '@core/i18n/erp-format';
import { REPORT_EXPORT_MONTHS_SHORT_FR } from '../shared/report-export-fr';

interface PeriodOption {
  label: string;
  value: ReportPeriod;
}

@Component({
  selector: 'app-sales-reports',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    PaginatorModule,
    TabsModule,
    CardModule,
    PageHeaderComponent,
    StatCardComponent,
    ButtonComponent
  ],
  template: `
    <app-page-header 
      title="Rapports Ventes" i18n-title="@@reports.sales.rapports.ventes.5a196bd1" 
      subtitle="Analysez vos performances et suivez vos indicateurs clés de ventes" i18n-subtitle="@@reports.sales.analysez.vos.performances.et.suivez.vos.54a1d16c">
      <app-button 
        variant="secondary"
        icon="pi-download"
        iconPos="left"
        (click)="onExport()" i18n="@@reports.sales.exporter.0cd84bdc"> Exporter </app-button>
      <app-button 
        variant="secondary"
        icon="pi-print"
        iconPos="left"
        (click)="onPrint()" i18n="@@reports.sales.imprimer.5382c09d"> Imprimer </app-button>
    </app-page-header>

    <!-- Period Filter -->
    <div class="filter-section">
      <div class="filter-group">
        <label for="period" class="filter-label" i18n="@@reports.sales.periode.de2110b7">Période</label>
        <select 
          id="period"
          [(ngModel)]="selectedPeriod" 
          (ngModelChange)="onPeriodChange()"
          class="filter-select"
          aria-label="Sélectionner la période des rapports" i18n-aria-label="@@reports.sales.selectionner.la.periode.des.rapports.d6f7fa31">
          @for (period of periodOptions; track period.value) {
            <option [value]="period.value">{{ period.label }}</option>
          }
        </select>
        @if (periodDateRangeLabel()) {
          <span class="filter-period-range" aria-hidden="true">{{ periodDateRangeLabel() }}</span>
        }
      </div>
    </div>

    <!-- Summary Block -->
    @if (!loading() && reportsData()?.summaryText) {
      <div 
        class="summary-block" 
        [class.summary-block--alert]="reportsData()!.overdueInvoicesCount > 0"
        role="status" 
        aria-live="polite">
        <i class="pi pi-info-circle summary-icon"></i>
        <p class="summary-text">{{ reportsData()!.summaryText }}</p>
      </div>
    }

    <!-- Statistics Cards -->
    @if (loading()) {
      <div class="stats-grid">
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
      </div>
    } @else if (reportsData()) {
      <div class="stats-grid">
        <app-stat-card
          label="Revenus totaux" i18n-label="@@reports.sales.revenus.totaux.7ba0e02a"
          [value]="reportsData()!.totalRevenue"
          icon="pi-dollar"
          variant="success">
        </app-stat-card>
        <app-stat-card
          label="Factures" i18n-label="@@reports.sales.factures.da35e4f2"
          [value]="reportsData()!.totalInvoices"
          icon="pi-file"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Factures payées" i18n-label="@@reports.sales.factures.payees.587e5689"
          [value]="reportsData()!.paidInvoices"
          icon="pi-check-circle"
          variant="success">
        </app-stat-card>
        <app-stat-card
          label="Taux de paiement" i18n-label="@@reports.sales.taux.de.paiement.813ba1e7"
          [value]="reportsData()!.paymentRate"
          icon="pi-percentage"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Montant à encaisser" i18n-label="@@reports.sales.montant.a.encaisser.cee0ab24"
          [value]="reportsData()!.amountToCollect"
          icon="pi-wallet"
          variant="warning">
        </app-stat-card>
        <app-stat-card
          label="Factures en retard" i18n-label="@@reports.sales.factures.en.retard.7fc4c2c8"
          [value]="reportsData()!.overdueInvoicesCount"
          icon="pi-exclamation-triangle"
          [variant]="reportsData()!.overdueInvoicesCount > 0 ? 'error' : 'success'">
        </app-stat-card>
      </div>
    }

    <div class="reports-tabs-wrap">
      <p-tabs
        class="ft-tabs"
        [scrollable]="true"
        [value]="activeTabIndex"
        (valueChange)="onTabChange($event)"
        [lazy]="true">
        <p-tablist>
          <p-tab [value]="0"><i class="pi pi-chart-line"></i><span i18n="@@reports.sales.revenus.et.clients.893c8058">Revenus et clients</span></p-tab>
          <p-tab [value]="1"><i class="pi pi-calendar"></i><span i18n="@@reports.sales.synthese.mensuelle.bab5b563">Synthèse mensuelle</span></p-tab>
          <p-tab [value]="2"><i class="pi pi-table"></i><span i18n="@@reports.sales.chiffres.d.affaires.par.mois.annee.cc6a49c6">Chiffres d'affaires par mois / Année</span></p-tab>
          <p-tab [value]="3"><i class="pi pi-percentage"></i><span i18n="@@reports.sales.taux.de.conversion.devis.8bc52158">Taux de conversion devis</span></p-tab>
          <p-tab [value]="4"><i class="pi pi-chart-bar"></i><span i18n="@@reports.sales.repartition.par.statut.05b7c49b">Répartition par statut</span></p-tab>
          <p-tab [value]="5"><i class="pi pi-chart-bar"></i><span i18n="@@reports.sales.performance.produits.fc69303c">Performance produits</span></p-tab>
          <p-tab [value]="6"><i class="pi pi-chart-line"></i><span i18n="@@reports.sales.evolution.ventes.par.produit.703fd446">Évolution ventes par produit</span></p-tab>
          <p-tab [value]="7"><i class="pi pi-shopping-cart"></i><span i18n="@@reports.sales.indicateurs.panier.1d499282">Indicateurs panier</span></p-tab>
          <p-tab [value]="8"><i class="pi pi-box"></i><span i18n="@@reports.sales.produits.jamais.vendus.607efbe9">Produits jamais vendus</span></p-tab>
          <p-tab [value]="9"><i class="pi pi-tag"></i><span i18n="@@reports.sales.ca.par.categorie.e22fee46">CA par catégorie</span></p-tab>
          <p-tab [value]="10"><i class="pi pi-list"></i><span i18n="@@reports.sales.transactions.clients.32259f49">Transactions clients</span></p-tab>
          <p-tab [value]="11"><i class="pi pi-box"></i><span i18n="@@reports.sales.details.ventes.par.ligne.2ed7995e">Détails ventes par ligne</span></p-tab>
          <p-tab [value]="12"><i class="pi pi-calculator"></i><span i18n="@@reports.sales.tva.ventes.117028f5">TVA ventes</span></p-tab>
          <p-tab [value]="13"><i class="pi pi-percentage"></i><span i18n="@@reports.sales.retenues.clients.68c049c1">Retenues clients</span></p-tab>
          <p-tab [value]="14"><i class="pi pi-exclamation-triangle"></i><span i18n="@@reports.sales.factures.en.retard.7fc4c2c8">Factures en retard</span></p-tab>
        </p-tablist>
        <p-tabpanels>
        <p-tabpanel [value]="0">
        <div class="tab-content">
    <div class="reports-grid">
      <!-- Revenue Chart -->
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.sales.evolution.des.revenus.4d28fd3c">Évolution des revenus</h2>
          <span class="section-subtitle" i18n="@@reports.sales.revenus.des.factures.payees.sur.la.perio.2867bea9">Revenus des factures payées sur la période{{ periodDateRangeLabel() ? ' (' + periodDateRangeLabel() + ')' : '' }}</span>
        </div>
        @if (loading()) {
          <div class="chart-placeholder">
            <div class="loading-placeholder">
              <i class="pi pi-spin pi-spinner"></i>
              <span i18n="@@reports.sales.chargement.a209b664">Chargement...</span>
            </div>
          </div>
        } @else if (reportsData()?.revenueChartData && reportsData()!.revenueChartData.length > 0) {
          <div 
            class="chart-container" 
            role="img" 
            [attr.aria-label]="loc_ui_tern_graphique_en_barres_evolution_des_revenus_b58454 + (periodDateRangeLabel() || loc_sur_la_periode_selectionnee_2fbf29)">
            <div class="chart-y-axis" aria-hidden="true">
              @for (tick of chartYAxisTicks(); track tick.value) {
                <span class="chart-y-tick">{{ tick.label }}</span>
              }
            </div>
            <div class="chart-bars">
              @for (item of reportsData()!.revenueChartData; track item.label) {
                <div class="chart-bar-group">
                  <div class="chart-tooltip" aria-hidden="true" i18n="@@reports.sales.facture.c015f55f.pl">
                    {{ formatCurrency(item.revenue, reportsData()?.currency) }}<br>
                    <small>{{ item.invoiceCount }} {item.invoiceCount, plural, =0 {facture} =1 {facture} other {factures}}</small>
                  </div>
                  <div class="chart-bar-wrapper">
                    <div
                      class="chart-bar"
                      [style.height.%]="getBarHeight(item.revenue)"
                      [attr.aria-label]="item.label + ': ' + formatCurrency(item.revenue, reportsData()?.currency)">
                    </div>
                  </div>
                  <span class="chart-label">{{ item.labelShort }}</span>
                </div>
              }
            </div>
          </div>
        } @else {
          <div class="chart-placeholder">
            <div class="chart-content">
              <i class="pi pi-chart-line chart-icon"></i>
              <p class="chart-text" i18n="@@reports.sales.aucune.donnee.pour.cette.periode.b2a99770">Aucune donnée pour cette période</p>
              <p class="chart-subtext" i18n="@@reports.sales.les.revenus.apparaitront.ici.une.fois.que.vous.a.025be54c">Les revenus apparaîtront ici une fois que vous aurez des factures payées. Changez la période ou créez des factures.</p>
            </div>
          </div>
        }
      </div>

      <!-- Top Clients -->
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.sales.meilleurs.clients.6c8fa779">Meilleurs clients</h2>
          <span class="section-subtitle" i18n="@@reports.sales.top.10.par.montant.total.facture.0344ed0f">Top 10 par montant total facturé</span>
        </div>
        @if (loading()) {
          <div class="loading-placeholder">
            <i class="pi pi-spin pi-spinner"></i>
            <span i18n="@@reports.sales.chargement.a209b664">Chargement...</span>
          </div>
        } @else if (!reportsData()?.topClients?.length) {
          <div class="empty-placeholder">
            <i class="pi pi-info-circle"></i>
            <p i18n="@@reports.sales.aucune.donnee.disponible.78c36aa1">Aucune donnée disponible</p>
            <p class="empty-hint" i18n="@@reports.sales.aucune.facture.sur.cette.periode.changez.la.peri.52e9330e">Aucune facture sur cette période. Changez la période ou créez des factures.</p>
          </div>
        } @else {
          <p-table 
            [value]="reportsData()!.topClients" 
            [paginator]="true"
            [rows]="10"
            [rowsPerPageOptions]="[10, 25, 50]"
            styleClass="p-datatable-sm reports-table"
            aria-label="Tableau des meilleurs clients" i18n-aria-label="@@reports.sales.tableau.des.meilleurs.clients.d678aea7">
            <ng-template pTemplate="header">
              <tr>
                <th i18n="@@reports.sales.client.1bdd79b1">Client</th>
                <th pSortableColumn="invoiceCount" class="text-right"><ng-container i18n="@@reports.sales.factures.da35e4f2">Factures </ng-container> <p-sortIcon field="invoiceCount"></p-sortIcon></th>
                <th pSortableColumn="totalAmount" class="text-right"><ng-container i18n="@@reports.sales.montant.total.dd001537">Montant total </ng-container> <p-sortIcon field="totalAmount"></p-sortIcon></th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-client>
              <tr>
                <td>
                  <span class="client-name">{{ client.clientName }}</span>
                </td>
                <td class="text-right">
                  <span class="invoice-count">{{ client.invoiceCount }}</span>
                </td>
                <td class="text-right amount">
                  {{ client.totalAmount | number:'1.3-3' }} {{ client.currency }}
                </td>
              </tr>
            </ng-template>
          </p-table>
        }
      </div>
    </div>
        </div>
      </p-tabpanel>
            <p-tabpanel [value]="1">
        <div class="tab-content">
    @if (!loading() && reportsData()?.monthlySummary && reportsData()!.monthlySummary.length > 0) {
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.sales.synthese.mensuelle.bab5b563">Synthèse mensuelle</h2>
          <span class="section-subtitle" i18n="@@reports.sales.6.derniers.mois.c9a9f41e">6 derniers mois</span>
        </div>
        <p-table 
          [value]="reportsData()!.monthlySummary" 
          [paginator]="true"
          [rows]="6"
          [rowsPerPageOptions]="[6, 12]"
          styleClass="p-datatable-sm reports-table">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.sales.mois.0d304bea">Mois</th>
              <th class="text-right" i18n="@@reports.sales.chiffre.d.affaires.0a341b9f">Chiffre d'affaires</th>
              <th class="text-right" i18n="@@reports.sales.factures.da35e4f2">Factures</th>
              <th class="text-right" i18n="@@reports.sales.payees.1ff22288">Payées</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.monthShort }} {{ row.year }}</td>
              <td class="text-right amount">
                {{ row.revenue | number:'1.3-3' }} {{ reportsData()!.currency }}
              </td>
              <td class="text-right">{{ row.invoiceCount }}</td>
              <td class="text-right">{{ row.paidCount }}</td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    } @else if (!loading()) {
      <div class="section">
        <div class="empty-placeholder">
          <i class="pi pi-info-circle"></i>
          <p i18n="@@reports.sales.aucune.donnee.pour.la.synthese.mensuelle.8d28c95b">Aucune donnée pour la synthèse mensuelle</p>
        </div>
      </div>
    }
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="2">
        <div class="tab-content">
    <div class="section crosstab-section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.sales.chiffres.d.affaires.par.mois.annee.cc6a49c6">Chiffres d'affaires par mois / Année</h2>
        <span class="section-subtitle" i18n="@@reports.sales.chiffres.d.affaires.par.mois.et.annee.5.derniere.e5892f1b">Chiffres d'affaires par mois et année - 5 dernières années (factures payées)</span>
      </div>
      @if (crossTabLoading()) {
        <div class="loading-placeholder">
          <i class="pi pi-spin pi-spinner"></i>
          <span i18n="@@reports.sales.chargement.a209b664">Chargement...</span>
        </div>
      } @else if (!crossTabData()) {
        <div class="empty-placeholder">
          <i class="pi pi-info-circle"></i>
          <p i18n="@@reports.sales.aucune.donnee.disponible.78c36aa1">Aucune donnée disponible</p>
          <p class="empty-hint" i18n="@@reports.sales.aucune.facture.payee.sur.la.periode.le.tableau.c.82911fcd">Aucune facture payée sur la période. Le tableau croisé sera disponible après enregistrement de factures payées.</p>
        </div>
      } @else {
        @if (crossTabInsights().length > 0) {
        <div class="crosstab-insights">
          <div class="insights-grid">
            @for (insight of crossTabInsights(); track insight.type + insight.label) {
              <div class="insight-card">
                <span class="insight-label">{{ insight.label }}</span>
                <span class="insight-value">{{ insight.value }}</span>
                @if (insight.detail) {
                  <span class="insight-detail">{{ insight.detail }}</span>
                }
              </div>
            }
          </div>
        </div>
        }
        <div class="crosstab-table-wrapper">
          <table class="crosstab-table" aria-label="Tableau croisé des chiffres d'affaires par mois et année" i18n-aria-label="@@reports.sales.tableau.croise.des.chiffres.d.affaires.par.mois.dc33459c">
            <thead>
              <tr>
                <th scope="col" i18n="@@reports.sales.annee.1f910d98">Année</th>
                @for (month of crossTabData()!.monthLabels; track month) {
                  <th scope="col" class="text-right">{{ month }}</th>
                }
                <th scope="col" class="text-right total-col" i18n="@@reports.sales.total.b25928c6">Total</th>
              </tr>
            </thead>
            <tbody>
              @for (year of crossTabData()!.years; track year) {
                <tr>
                  <th scope="row">{{ year }}</th>
                  @for (rev of crossTabData()!.matrix.get(year) ?? []; track $index) {
                    <td class="text-right amount">{{ rev | number:'1.3-3' }}</td>
                  }
                  <td class="text-right amount total-cell">{{ (crossTabData()!.rowTotals.get(year) ?? 0) | number:'1.3-3' }} {{ crossTabData()!.currency }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr class="totals-row">
                <th scope="row" i18n="@@reports.sales.total.b25928c6">Total</th>
                @for (col of crossTabData()!.columnTotals; track $index) {
                  <td class="text-right amount">{{ col | number:'1.3-3' }}</td>
                }
                <td class="text-right amount total-cell">{{ crossTabData()!.grandTotal | number:'1.3-3' }} {{ crossTabData()!.currency }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      }
    </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="3">
        <div class="tab-content">
    @if (!loading() && reportsData()?.quoteConversionRate !== undefined) {
      <div class="section conversion-section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.sales.taux.de.conversion.devis.8bc52158">Taux de conversion devis</h2>
          <span class="section-subtitle" i18n="@@reports.sales.pourcentage.de.devis.convertis.en.facture.67961fcc">Pourcentage de devis convertis en facture</span>
        </div>
        <div class="conversion-value">
          <span class="conversion-percent">{{ reportsData()!.quoteConversionRate }}</span>
        </div>
      </div>
    } @else if (!loading()) {
      <div class="section">
        <div class="empty-placeholder">
          <i class="pi pi-info-circle"></i>
          <p i18n="@@reports.sales.aucune.donnee.de.conversion.devis.disponible.617d80bc">Aucune donnée de conversion devis disponible</p>
        </div>
      </div>
    }
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="4">
        <div class="tab-content">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.sales.repartition.par.statut.05b7c49b">Répartition par statut</h2>
        <span class="section-subtitle" i18n="@@reports.sales.repartition.des.factures.selon.leur.statut.8ebe007e">Répartition des factures selon leur statut</span>
      </div>
      @if (loading()) {
        <div class="loading-placeholder">
          <i class="pi pi-spin pi-spinner"></i>
          <span i18n="@@reports.sales.chargement.a209b664">Chargement...</span>
        </div>
      } @else if (!reportsData()?.statusBreakdown?.length) {
        <div class="empty-placeholder">
          <i class="pi pi-info-circle"></i>
          <p i18n="@@reports.sales.aucune.donnee.disponible.78c36aa1">Aucune donnée disponible</p>
        </div>
      } @else {
        <div class="status-grid">
          @for (status of reportsData()!.statusBreakdown; track status.status) {
            <div class="status-card">
              <div class="status-header">
                <span class="status-label">{{ status.status }}</span>
                <span class="status-count">{{ status.count }}</span>
              </div>
              <div class="status-bar">
                <div 
                  class="status-fill" 
                  [style.width.%]="status.percentage"
                  [style.background]="reportsService.getStatusColor(status.status)">
                </div>
              </div>
              <div class="status-amount">
                {{ status.totalAmount | number:'1.3-3' }} {{ status.currency }}
              </div>
            </div>
          }
        </div>
      }
    </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="5">
        <div class="tab-content">
          <div class="section">
            <div class="section-header">
              <h2 class="section-title" i18n="@@reports.sales.performance.produits.fc69303c">Performance produits</h2>
              <span class="section-subtitle" i18n="@@reports.sales.classement.par.ca.avec.marge.et.part.du.chiffre..8232e13e">Classement par CA avec marge et part du chiffre d'affaires.</span>
            </div>
            @if (productPerformanceLoading()) {
              <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.sales.chargement.a209b664">Chargement...</span></div>
            } @else if (!productPerformance().length) {
              <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.sales.aucune.donnee.pour.cette.periode.254e84f4">Aucune donnée pour cette période.</p></div>
            } @else {
              <p-table
                [value]="productPerformance()"
                [paginator]="true"
                [rows]="25"
                [rowsPerPageOptions]="[10, 25, 50]"
                styleClass="p-datatable-sm reports-table"
                aria-label="Performance produits" i18n-aria-label="@@reports.sales.performance.produits.fc69303c">
                <ng-template pTemplate="header">
                  <tr>
                    <th i18n="@@reports.sales.produit.ff673dc2">Produit</th>
                    <th i18n="@@reports.sales.categorie.6b38300a">Catégorie</th>
                    <th class="text-right" i18n="@@reports.sales.quantite.09a38fda">Quantité</th>
                    <th class="text-right" i18n="@@reports.sales.ca.09acbb7d">CA</th>
                    <th class="text-right" i18n="@@reports.sales.cout.4a4aa395">Coût</th>
                    <th class="text-right" i18n="@@reports.sales.marge.d9ef1a1d">Marge</th>
                    <th class="text-right" i18n="@@reports.sales.marge.143c2670">Marge %</th>
                    <th class="text-right" i18n="@@reports.sales.part.ca.e28d941d">Part CA %</th>
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-row>
                  <tr>
                    <td><span class="client-name">{{ row.productName }}</span><br><span class="code-secondary">{{ row.productCode }}</span></td>
                    <td>{{ row.categoryName ?? '–' }}</td>
                    <td class="text-right">{{ row.quantitySold | number:'1.3-3' }}</td>
                    <td class="text-right amount">{{ row.revenue | number:'1.3-3' }} {{ row.currency }}</td>
                    <td class="text-right">{{ row.totalCost | number:'1.3-3' }}</td>
                    <td class="text-right amount">{{ row.profit | number:'1.3-3' }}</td>
                    <td class="text-right">{{ row.marginPercent != null ? (row.marginPercent | number:'1.1-1') + ' %' : '–' }}</td>
                    <td class="text-right">{{ row.revenueSharePercent | number:'1.1-1' }} %</td>
                  </tr>
                </ng-template>
              </p-table>
            }
          </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="6">
        <div class="tab-content">
          <div class="section">
            <div class="section-header">
              <h2 class="section-title" i18n="@@reports.sales.evolution.ventes.par.produit.703fd446">Évolution ventes par produit</h2>
              <span class="section-subtitle" i18n="@@reports.sales.ventes.par.produit.et.par.mois.sur.la.periode.4d0b191d">Ventes par produit et par mois sur la période.</span>
            </div>
            @if (productSalesTrendLoading()) {
              <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.sales.chargement.a209b664">Chargement...</span></div>
            } @else if (!productSalesTrend().length) {
              <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.sales.aucune.donnee.pour.cette.periode.254e84f4">Aucune donnée pour cette période.</p></div>
            } @else {
              <p-table
                [value]="productSalesTrend()"
                [paginator]="true"
                [rows]="25"
                [rowsPerPageOptions]="[10, 25, 50]"
                styleClass="p-datatable-sm reports-table"
                aria-label="Évolution ventes par produit" i18n-aria-label="@@reports.sales.evolution.ventes.par.produit.703fd446">
                <ng-template pTemplate="header">
                  <tr>
                    <th i18n="@@reports.sales.periode.de2110b7">Période</th>
                    <th i18n="@@reports.sales.produit.ff673dc2">Produit</th>
                    <th i18n="@@reports.sales.categorie.6b38300a">Catégorie</th>
                    <th class="text-right" i18n="@@reports.sales.quantite.09a38fda">Quantité</th>
                    <th class="text-right" i18n="@@reports.sales.ca.09acbb7d">CA</th>
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-row>
                  <tr>
                    <td>{{ row.period }}</td>
                    <td><span class="client-name">{{ row.productName }}</span><br><span class="code-secondary">{{ row.productCode }}</span></td>
                    <td>{{ row.categoryName ?? '–' }}</td>
                    <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
                    <td class="text-right amount">{{ row.revenue | number:'1.3-3' }} {{ row.currency }}</td>
                  </tr>
                </ng-template>
              </p-table>
            }
          </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="7">
        <div class="tab-content">
          <div class="section">
            <div class="section-header">
              <h2 class="section-title" i18n="@@reports.sales.indicateurs.panier.1d499282">Indicateurs panier</h2>
              <span class="section-subtitle" i18n="@@reports.sales.panier.moyen.et.nombre.de.lignes.par.facture.024e4898">Panier moyen et nombre de lignes par facture.</span>
            </div>
            @if (basketMetricsLoading()) {
              <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.sales.chargement.a209b664">Chargement...</span></div>
            } @else if (!basketMetrics()) {
              <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.sales.aucune.donnee.pour.cette.periode.254e84f4">Aucune donnée pour cette période.</p></div>
            } @else {
              <div class="stats-grid">
                <app-stat-card
                  label="Panier moyen" i18n-label="@@reports.sales.panier.moyen.e9ce57ee"
                  [value]="formatCurrency(basketMetrics()!.averageBasket, basketMetrics()!.currency)"
                  icon="pi-shopping-cart"
                  variant="primary">
                </app-stat-card>
                <app-stat-card
                  label="Lignes moy. / facture" i18n-label="@@reports.sales.lignes.moy.facture.471f033e"
                  [value]="(basketMetrics()!.averageLinesPerInvoice | number:'1.1-1') + ''"
                  icon="pi-list"
                  variant="success">
                </app-stat-card>
                <app-stat-card
                  label="Factures" i18n-label="@@reports.sales.factures.da35e4f2"
                  [value]="basketMetrics()!.totalInvoices + ''"
                  icon="pi-file"
                  variant="primary">
                </app-stat-card>
                <app-stat-card
                  label="CA total" i18n-label="@@reports.sales.ca.total.c324bfa2"
                  [value]="formatCurrency(basketMetrics()!.totalRevenue, basketMetrics()!.currency)"
                  icon="pi-dollar"
                  variant="success">
                </app-stat-card>
              </div>
            }
          </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="8">
        <div class="tab-content">
          <div class="section">
            <div class="section-header">
              <h2 class="section-title" i18n="@@reports.sales.produits.jamais.vendus.607efbe9">Produits jamais vendus</h2>
              <span class="section-subtitle" i18n="@@reports.sales.produits.actifs.sans.vente.sur.la.periode.opport.d2c7154c">Produits actifs sans vente sur la période (opportunités de mise en avant).</span>
            </div>
            @if (productsNeverSoldLoading()) {
              <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.sales.chargement.a209b664">Chargement...</span></div>
            } @else if (!productsNeverSold().length) {
              <div class="empty-placeholder"><i class="pi pi-check-circle"></i><p i18n="@@reports.sales.tous.vos.produits.actifs.ont.ete.vendus.sur.cett.377fcc3e">Tous vos produits actifs ont été vendus sur cette période.</p></div>
            } @else {
              <p-table
                [value]="productsNeverSold()"
                [paginator]="true"
                [rows]="25"
                [rowsPerPageOptions]="[10, 25, 50]"
                styleClass="p-datatable-sm reports-table"
                aria-label="Produits jamais vendus" i18n-aria-label="@@reports.sales.produits.jamais.vendus.607efbe9">
                <ng-template pTemplate="header">
                  <tr>
                    <th i18n="@@reports.sales.produit.ff673dc2">Produit</th>
                    <th i18n="@@reports.sales.categorie.6b38300a">Catégorie</th>
                    <th class="text-right" i18n="@@reports.sales.prix.unitaire.3e848c96">Prix unitaire</th>
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-row>
                  <tr>
                    <td><span class="client-name">{{ row.productName }}</span><br><span class="code-secondary">{{ row.productCode }}</span></td>
                    <td>{{ row.categoryName ?? '–' }}</td>
                    <td class="text-right amount">{{ row.unitPrice | number:'1.3-3' }} {{ row.currency }}</td>
                  </tr>
                </ng-template>
              </p-table>
            }
          </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="9">
        <div class="tab-content">
          <div class="section">
            <div class="section-header">
              <h2 class="section-title" i18n="@@reports.sales.ca.par.categorie.e22fee46">CA par catégorie</h2>
              <span class="section-subtitle" i18n="@@reports.sales.repartition.du.chiffre.d.affaires.par.categorie.766851c4">Répartition du chiffre d'affaires par catégorie.</span>
            </div>
            @if (revenueByCategoryLoading()) {
              <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.sales.chargement.a209b664">Chargement...</span></div>
            } @else if (!revenueByCategory().length) {
              <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.sales.aucune.donnee.pour.cette.periode.254e84f4">Aucune donnée pour cette période.</p></div>
            } @else {
              <p-table
                [value]="revenueByCategory()"
                [paginator]="true"
                [rows]="25"
                [rowsPerPageOptions]="[10, 25, 50]"
                styleClass="p-datatable-sm reports-table"
                aria-label="CA par catégorie" i18n-aria-label="@@reports.sales.ca.par.categorie.e22fee46">
                <ng-template pTemplate="header">
                  <tr>
                    <th i18n="@@reports.sales.categorie.6b38300a">Catégorie</th>
                    <th class="text-right" i18n="@@reports.sales.quantite.09a38fda">Quantité</th>
                    <th class="text-right" i18n="@@reports.sales.chiffre.d.affaires.0a341b9f">Chiffre d'affaires</th>
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-row>
                  <tr>
                    <td>{{ row.groupKey }}</td>
                    <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
                    <td class="text-right amount">{{ row.revenue | number:'1.3-3' }} {{ row.currency }}</td>
                  </tr>
                </ng-template>
              </p-table>
            }
          </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="10">
        <div class="tab-content">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.sales.transactions.clients.32259f49">Transactions clients</h2>
        <span class="section-subtitle" i18n="@@reports.sales.factures.et.paiements.sur.la.periode.0d35f728">Factures et paiements sur la période</span>
      </div>
      @if (clientTransactionsLoading()) {
        <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.sales.chargement.a209b664">Chargement...</span></div>
      } @else if (!clientTransactions().length) {
        <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.sales.aucune.transaction.sur.cette.periode.2ed99811">Aucune transaction sur cette période</p></div>
      } @else {
        <p-table 
          [value]="clientTransactions()" 
          [paginator]="true"
          [rows]="25"
          [rowsPerPageOptions]="[10, 25, 50]"
          styleClass="p-datatable-sm reports-table" 
          aria-label="Transactions clients" i18n-aria-label="@@reports.sales.transactions.clients.32259f49">
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="date"><ng-container i18n="@@reports.sales.date.eb9a4bc1">Date </ng-container> <p-sortIcon field="date"></p-sortIcon></th>
              <th i18n="@@reports.sales.type.3deb7456">Type</th>
              <th i18n="@@reports.sales.client.1bdd79b1">Client</th>
              <th i18n="@@reports.sales.reference.f8130bb0">Référence</th>
              <th pSortableColumn="amount" class="text-right"><ng-container i18n="@@reports.sales.montant.4adcd9fc">Montant </ng-container> <p-sortIcon field="amount"></p-sortIcon></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.date | date:'dd/MM/yyyy' }}</td>
              <td>{{ row.transactionType }}</td>
              <td>{{ row.clientName }}</td>
              <td>{{ row.reference }}</td>
              <td class="text-right amount">{{ row.amount | number:'1.3-3' }} {{ row.currency }}</td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="11">
        <div class="tab-content">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.sales.details.ventes.par.ligne.produit.2fe7a584">Détails ventes par ligne produit</h2>
        <span class="section-subtitle" i18n="@@reports.sales.lignes.de.factures.agregees.par.produit.sur.la.p.134198e2">Lignes de factures agrégées par produit sur la période</span>
      </div>
      @if (salesByLineLoading()) {
        <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.sales.chargement.a209b664">Chargement...</span></div>
      } @else if (!salesByLine().length) {
        <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.sales.aucune.ligne.de.vente.sur.cette.periode.86cbba64">Aucune ligne de vente sur cette période</p></div>
      } @else {
        <p-table 
          [value]="salesByLine()" 
          [paginator]="true"
          [rows]="25"
          [rowsPerPageOptions]="[10, 25, 50]"
          styleClass="p-datatable-sm reports-table" 
          aria-label="Détails ventes par ligne" i18n-aria-label="@@reports.sales.details.ventes.par.ligne.2ed7995e">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.sales.produit.ff673dc2">Produit</th>
              <th i18n="@@reports.sales.code.adac6937">Code</th>
              <th i18n="@@reports.sales.categorie.6b38300a">Catégorie</th>
              <th pSortableColumn="quantity" class="text-right"><ng-container i18n="@@reports.sales.quantite.09a38fda">Quantité </ng-container> <p-sortIcon field="quantity"></p-sortIcon></th>
              <th pSortableColumn="revenue" class="text-right"><ng-container i18n="@@reports.sales.chiffre.d.affaires.0a341b9f">Chiffre d'affaires </ng-container> <p-sortIcon field="revenue"></p-sortIcon></th>
              <th class="text-right" i18n="@@reports.sales.tva.fb62cb5d">TVA</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.productName }}</td>
              <td>{{ row.productCode }}</td>
              <td>{{ row.categoryName ?? '-' }}</td>
              <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
              <td class="text-right amount">{{ row.revenue | number:'1.3-3' }} {{ row.currency }}</td>
              <td class="text-right amount">{{ row.vatAmount | number:'1.3-3' }} {{ row.currency }}</td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="12">
        <div class="tab-content">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.sales.tva.ventes.117028f5">TVA ventes</h2>
        <span class="section-subtitle" i18n="@@reports.sales.agregat.tva.par.taux.sur.la.periode.94b0dc97">Agrégat TVA par taux sur la période</span>
      </div>
      @if (salesVatLoading()) {
        <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.sales.chargement.a209b664">Chargement...</span></div>
      } @else if (!salesVat().length) {
        <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.sales.aucune.tva.ventes.sur.cette.periode.0656e86b">Aucune TVA ventes sur cette période</p></div>
      } @else {
        <p-table 
          [value]="salesVat()" 
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[10, 25, 50]"
          styleClass="p-datatable-sm reports-table" 
          aria-label="TVA ventes" i18n-aria-label="@@reports.sales.tva.ventes.117028f5">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.sales.taux.tva.c0830fcc">Taux TVA</th>
              <th class="text-right" i18n="@@reports.sales.base.taxable.449d603a">Base taxable</th>
              <th pSortableColumn="totalVatAmount" class="text-right"><ng-container i18n="@@reports.sales.montant.tva.f0c1b7cc">Montant TVA </ng-container> <p-sortIcon field="totalVatAmount"></p-sortIcon></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.vatRateDisplay | backendLabel }}</td>
              <td class="text-right amount">{{ row.totalTaxableAmount | number:'1.3-3' }} {{ row.currency }}</td>
              <td class="text-right amount">{{ row.totalVatAmount | number:'1.3-3' }} {{ row.currency }}</td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="13">
        <div class="tab-content">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.sales.total.des.retenues.pour.les.clients.040735f7">Total des retenues pour les clients</h2>
        <span class="section-subtitle" i18n="@@reports.sales.retenues.subies.agregees.par.client.date.d.encai.c8b8dc7b">Retenues subies agrégées par client (date d'encaissement) — hors déclaration TEJ déclarant</span>
      </div>
      @if (clientWithholdingsLoading()) {
        <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.sales.chargement.a209b664">Chargement...</span></div>
      } @else if (!clientWithholdings().length) {
        <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.sales.aucune.retenue.client.sur.cette.periode.847be151">Aucune retenue client sur cette période</p></div>
      } @else {
        <p-table
          [value]="clientWithholdings()"
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[10, 25, 50]"
          styleClass="p-datatable-sm reports-table"
          aria-label="Retenues clients" i18n-aria-label="@@reports.sales.retenues.clients.68c049c1">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.sales.client.1bdd79b1">Client</th>
              <th class="text-right" i18n="@@reports.sales.n.paiements.cdb6fb06">N° paiements</th>
              <th class="text-right" i18n="@@reports.sales.total.retenue.31936a2f">Total retenue</th>
              <th i18n="@@reports.sales.devise.eb2e42c4">Devise</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.clientName }}</td>
              <td class="text-right">{{ row.paymentCount }}</td>
              <td class="text-right amount">{{ row.totalWithholding | number:'1.3-3' }}</td>
              <td>{{ row.currency }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            <tr>
              <td><strong i18n="@@reports.sales.total.b25928c6">Total</strong></td>
              <td class="text-right"><strong>{{ clientWithholdingsPaymentTotal() }}</strong></td>
              <td class="text-right amount"><strong>{{ clientWithholdingsTotal() | number:'1.3-3' }}</strong></td>
              <td></td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="14">
        <div class="tab-content">
    @if (!loading() && reportsData()?.overdueInvoicesCount && reportsData()!.overdueInvoicesCount > 0) {
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.sales.factures.en.retard.7fc4c2c8">Factures en retard</h2>
          <a [routerLink]="['/invoices']" class="section-link" i18n="@@reports.sales.voir.tout.7b7d86e8"> Voir tout </a>
        </div>
        <p-table 
          [value]="reportsData()!.overdueInvoices" 
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[5, 10, 25]"
          styleClass="p-datatable-sm reports-table">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.sales.numero.15e73db0">Numéro</th>
              <th i18n="@@reports.sales.client.1bdd79b1">Client</th>
              <th class="text-right" i18n="@@reports.sales.montant.4adcd9fc">Montant</th>
              <th></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-invoice>
            <tr>
              <td>
                <a [routerLink]="['/invoices', invoice.id]" class="invoice-link">{{ invoice.number }}</a>
              </td>
              <td>{{ invoice.clientName }}</td>
              <td class="text-right amount">
                {{ invoice.totalAmount | number:'1.3-3' }} {{ invoice.currency }}
              </td>
              <td>
                <app-button 
                  variant="ghost" 
                  size="sm" 
                  icon="pi-eye" 
                  [iconOnly]="true"
                  [routerLink]="['/invoices', invoice.id]"
                  ariaLabel="Voir la facture" i18n-ariaLabel="@@reports.sales.voir.la.facture.23283cea">
                </app-button>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    } @else if (!loading()) {
      <div class="section">
        <div class="empty-placeholder">
          <i class="pi pi-check-circle"></i>
          <p i18n="@@reports.sales.aucune.facture.en.retard.409595bd">Aucune facture en retard</p>
        </div>
      </div>
    }
        </div>
      </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
    </div>

    <!-- Print-only section -->
    <div class="print-only print-report">
      <!-- Professional Header -->
      <div class="print-header">
        <div class="print-header__brand-bar"></div>
        <div class="print-header__content">
          <div class="print-header__left">
            <h1 class="print-header__title" i18n="@@reports.sales.rapport.ventes.1438231f">RAPPORT VENTES</h1>
            <p class="print-header__subtitle">{{ activeTabName }}</p>
            <p class="print-header__period"><ng-container i18n="@@reports.sales.periode.9a1e2cab">Période : {{ periodOptions[selectedPeriodIndex].label || 'Tout' }}
              </ng-container>@if (periodDateRangeLabel()) {
                <span> — {{ periodDateRangeLabel() }}</span>
              }
            </p>
          </div>
          <div class="print-header__right">
            <p class="print-header__app" i18n="@@reports.sales.instafact.ff6221f4">InstaFact</p>
            <p class="print-header__date" i18n="@@reports.sales.genere.le.2948908d">Généré le {{ printDate }}</p>
          </div>
        </div>
      </div>

      <!-- KPI Summary -->
      @if (reportsData()) {
        <div class="print-kpi-bar">
          <div class="print-kpi-item">
            <span class="print-kpi-item__label" i18n="@@reports.sales.revenus.totaux.7ba0e02a">Revenus totaux</span>
            <span class="print-kpi-item__value">{{ reportsData()!.totalRevenue }}</span>
          </div>
          <div class="print-kpi-item">
            <span class="print-kpi-item__label" i18n="@@reports.sales.factures.da35e4f2">Factures</span>
            <span class="print-kpi-item__value">{{ reportsData()!.totalInvoices }}</span>
          </div>
          <div class="print-kpi-item">
            <span class="print-kpi-item__label" i18n="@@reports.sales.taux.paiement.c676e2b2">Taux paiement</span>
            <span class="print-kpi-item__value">{{ reportsData()!.paymentRate }}</span>
          </div>
          <div class="print-kpi-item">
            <span class="print-kpi-item__label" i18n="@@reports.sales.a.encaisser.2850ec24">À encaisser</span>
            <span class="print-kpi-item__value">{{ reportsData()!.amountToCollect }}</span>
          </div>
          <div class="print-kpi-item" [class.print-kpi-item--alert]="reportsData()!.overdueInvoicesCount > 0">
            <span class="print-kpi-item__label" i18n="@@reports.sales.en.retard.40c1dde3">En retard</span>
            <span class="print-kpi-item__value">{{ reportsData()!.overdueInvoicesCount }}</span>
          </div>
        </div>
      }

      <!-- Tab Content -->
      @if (activeTabIndex === 0 && reportsData()) {
        @if (reportsData()!.revenueChartData.length) {
          <h4 class="print-section-title" i18n="@@reports.sales.evolution.des.revenus.4d28fd3c">Évolution des revenus</h4>
          <table class="print-table">
            <thead><tr><th i18n="@@reports.sales.periode.de2110b7">Période</th><th class="text-right" i18n="@@reports.sales.revenus.a08a099a">Revenus</th><th class="text-right" i18n="@@reports.sales.factures.da35e4f2">Factures</th></tr></thead>
            <tbody>
              @for (item of reportsData()!.revenueChartData; track item.label) {
                <tr>
                  <td>{{ item.label }}</td>
                  <td class="text-right print-amount">{{ item.revenue | number:'1.3-3' }} {{ reportsData()!.currency }}</td>
                  <td class="text-right">{{ item.invoiceCount }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
        @if (reportsData()!.topClients.length) {
          <h4 class="print-section-title" i18n="@@reports.sales.meilleurs.clients.top.10.4404801a">Meilleurs clients (Top 10)</h4>
          <table class="print-table">
            <thead><tr><th i18n="@@reports.sales.client.1bdd79b1">Client</th><th class="text-right" i18n="@@reports.sales.factures.da35e4f2">Factures</th><th class="text-right" i18n="@@reports.sales.montant.total.dd001537">Montant total</th></tr></thead>
            <tbody>
              @for (client of reportsData()!.topClients; track client.clientName) {
                <tr>
                  <td>{{ client.clientName }}</td>
                  <td class="text-right">{{ client.invoiceCount }}</td>
                  <td class="text-right print-amount">{{ client.totalAmount | number:'1.3-3' }} {{ client.currency }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      }

      @if (activeTabIndex === 1 && reportsData()?.monthlySummary?.length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.sales.mois.0d304bea">Mois</th><th class="text-right" i18n="@@reports.sales.chiffre.d.affaires.0a341b9f">Chiffre d'affaires</th><th class="text-right" i18n="@@reports.sales.factures.da35e4f2">Factures</th><th class="text-right" i18n="@@reports.sales.payees.1ff22288">Payées</th></tr></thead>
          <tbody>
            @for (row of reportsData()!.monthlySummary; track row.monthShort + row.year) {
              <tr>
                <td>{{ row.monthShort }} {{ row.year }}</td>
                <td class="text-right print-amount">{{ row.revenue | number:'1.3-3' }} {{ reportsData()!.currency }}</td>
                <td class="text-right">{{ row.invoiceCount }}</td>
                <td class="text-right">{{ row.paidCount }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (activeTabIndex === 2 && crossTabData()) {
        @if (crossTabInsights().length) {
          <div class="print-kpis">
            @for (insight of crossTabInsights(); track insight.type + insight.label) {
              <div class="print-kpi">
                <strong>{{ insight.label }}</strong>
                <span>{{ insight.value }}</span>
                @if (insight.detail) {
                  <small>{{ insight.detail }}</small>
                }
              </div>
            }
          </div>
        }
        <table class="print-table">
          <thead>
            <tr>
              <th i18n="@@reports.sales.annee.1f910d98">Année</th>
              @for (month of crossTabData()!.monthLabels; track month) {
                <th class="text-right">{{ month }}</th>
              }
              <th class="text-right" i18n="@@reports.sales.total.b25928c6">Total</th>
            </tr>
          </thead>
          <tbody>
            @for (year of crossTabData()!.years; track year) {
              <tr>
                <td><strong>{{ year }}</strong></td>
                @for (rev of crossTabData()!.matrix.get(year) ?? []; track $index) {
                  <td class="text-right print-amount">{{ rev | number:'1.3-3' }}</td>
                }
                <td class="text-right print-amount"><strong>{{ (crossTabData()!.rowTotals.get(year) ?? 0) | number:'1.3-3' }} {{ crossTabData()!.currency }}</strong></td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td><strong i18n="@@reports.sales.total.b25928c6">Total</strong></td>
              @for (col of crossTabData()!.columnTotals; track $index) {
                <td class="text-right print-amount"><strong>{{ col | number:'1.3-3' }}</strong></td>
              }
              <td class="text-right print-amount"><strong>{{ crossTabData()!.grandTotal | number:'1.3-3' }} {{ crossTabData()!.currency }}</strong></td>
            </tr>
          </tfoot>
        </table>
      }

      @if (activeTabIndex === 3 && reportsData()) {
        <div class="print-conversion">
          <span class="print-conversion-value">{{ reportsData()!.quoteConversionRate }}</span>
          <span class="print-conversion-label" i18n="@@reports.sales.des.devis.convertis.en.facture.aede1b8a">des devis convertis en facture</span>
        </div>
      }

      @if (activeTabIndex === 4 && reportsData()?.statusBreakdown?.length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.sales.statut.659499f3">Statut</th><th class="text-right" i18n="@@reports.sales.nombre.e68491e9">Nombre</th><th class="text-right" i18n="@@reports.sales.pourcentage.e34218e3">Pourcentage</th><th class="text-right" i18n="@@reports.sales.montant.4adcd9fc">Montant</th></tr></thead>
          <tbody>
            @for (status of reportsData()!.statusBreakdown; track status.status) {
              <tr>
                <td>{{ status.status }}</td>
                <td class="text-right">{{ status.count }}</td>
                <td class="text-right">{{ status.percentage | number:'1.1-1' }} %</td>
                <td class="text-right print-amount">{{ status.totalAmount | number:'1.3-3' }} {{ status.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (activeTabIndex === 5 && productPerformance().length) {
        <table class="print-table print-table--compact">
          <thead>
            <tr><th i18n="@@reports.sales.produit.ff673dc2">Produit</th><th i18n="@@reports.sales.code.adac6937">Code</th><th i18n="@@reports.sales.categorie.6b38300a">Catégorie</th><th class="text-right" i18n="@@reports.sales.qte.a4772129">Qté</th><th class="text-right" i18n="@@reports.sales.ca.09acbb7d">CA</th><th class="text-right" i18n="@@reports.sales.cout.4a4aa395">Coût</th><th class="text-right" i18n="@@reports.sales.marge.d9ef1a1d">Marge</th><th class="text-right" i18n="@@reports.sales.marge.143c2670">Marge %</th><th class="text-right" i18n="@@reports.sales.part.ca.e28d941d">Part CA %</th></tr>
          </thead>
          <tbody>
            @for (row of productPerformance(); track row.productCode) {
              <tr>
                <td>{{ row.productName }}</td>
                <td>{{ row.productCode }}</td>
                <td>{{ row.categoryName ?? '–' }}</td>
                <td class="text-right">{{ row.quantitySold | number:'1.3-3' }}</td>
                <td class="text-right print-amount">{{ row.revenue | number:'1.3-3' }} {{ row.currency }}</td>
                <td class="text-right print-amount">{{ row.totalCost | number:'1.3-3' }}</td>
                <td class="text-right print-amount">{{ row.profit | number:'1.3-3' }}</td>
                <td class="text-right">{{ row.marginPercent != null ? (row.marginPercent | number:'1.1-1') + ' %' : '–' }}</td>
                <td class="text-right">{{ row.revenueSharePercent | number:'1.1-1' }} %</td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (activeTabIndex === 6 && productSalesTrend().length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.sales.periode.de2110b7">Période</th><th i18n="@@reports.sales.produit.ff673dc2">Produit</th><th i18n="@@reports.sales.code.adac6937">Code</th><th i18n="@@reports.sales.categorie.6b38300a">Catégorie</th><th class="text-right" i18n="@@reports.sales.quantite.09a38fda">Quantité</th><th class="text-right" i18n="@@reports.sales.ca.09acbb7d">CA</th></tr></thead>
          <tbody>
            @for (row of productSalesTrend(); track row.period + row.productCode) {
              <tr>
                <td>{{ row.period }}</td>
                <td>{{ row.productName }}</td>
                <td>{{ row.productCode }}</td>
                <td>{{ row.categoryName ?? '–' }}</td>
                <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
                <td class="text-right print-amount">{{ row.revenue | number:'1.3-3' }} {{ row.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (activeTabIndex === 7 && basketMetrics()) {
        <div class="print-kpis">
          <div class="print-kpi"><strong i18n="@@reports.sales.panier.moyen.e9ce57ee">Panier moyen</strong><span>{{ formatCurrency(basketMetrics()!.averageBasket, basketMetrics()!.currency) }}</span></div>
          <div class="print-kpi"><strong i18n="@@reports.sales.lignes.moy.facture.471f033e">Lignes moy. / facture</strong><span>{{ basketMetrics()!.averageLinesPerInvoice | number:'1.1-1' }}</span></div>
          <div class="print-kpi"><strong i18n="@@reports.sales.factures.da35e4f2">Factures</strong><span>{{ basketMetrics()!.totalInvoices }}</span></div>
          <div class="print-kpi"><strong i18n="@@reports.sales.ca.total.c324bfa2">CA total</strong><span>{{ formatCurrency(basketMetrics()!.totalRevenue, basketMetrics()!.currency) }}</span></div>
        </div>
      }

      @if (activeTabIndex === 8 && productsNeverSold().length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.sales.produit.ff673dc2">Produit</th><th i18n="@@reports.sales.code.adac6937">Code</th><th i18n="@@reports.sales.categorie.6b38300a">Catégorie</th><th class="text-right" i18n="@@reports.sales.prix.unitaire.3e848c96">Prix unitaire</th></tr></thead>
          <tbody>
            @for (row of productsNeverSold(); track row.productCode) {
              <tr>
                <td>{{ row.productName }}</td>
                <td>{{ row.productCode }}</td>
                <td>{{ row.categoryName ?? '–' }}</td>
                <td class="text-right print-amount">{{ row.unitPrice | number:'1.3-3' }} {{ row.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (activeTabIndex === 9 && revenueByCategory().length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.sales.categorie.6b38300a">Catégorie</th><th class="text-right" i18n="@@reports.sales.quantite.09a38fda">Quantité</th><th class="text-right" i18n="@@reports.sales.chiffre.d.affaires.0a341b9f">Chiffre d'affaires</th></tr></thead>
          <tbody>
            @for (row of revenueByCategory(); track row.groupKey) {
              <tr>
                <td>{{ row.groupKey }}</td>
                <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
                <td class="text-right print-amount">{{ row.revenue | number:'1.3-3' }} {{ row.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (activeTabIndex === 10 && clientTransactions().length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.sales.date.eb9a4bc1">Date</th><th i18n="@@reports.sales.type.3deb7456">Type</th><th i18n="@@reports.sales.client.1bdd79b1">Client</th><th i18n="@@reports.sales.reference.f8130bb0">Référence</th><th class="text-right" i18n="@@reports.sales.montant.4adcd9fc">Montant</th></tr></thead>
          <tbody>
            @for (row of clientTransactions(); track row.reference) {
              <tr>
                <td>{{ row.date | date:'dd/MM/yyyy' }}</td>
                <td>{{ row.transactionType }}</td>
                <td>{{ row.clientName }}</td>
                <td>{{ row.reference }}</td>
                <td class="text-right print-amount">{{ row.amount | number:'1.3-3' }} {{ row.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (activeTabIndex === 11 && salesByLine().length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.sales.produit.ff673dc2">Produit</th><th i18n="@@reports.sales.code.adac6937">Code</th><th i18n="@@reports.sales.categorie.6b38300a">Catégorie</th><th class="text-right" i18n="@@reports.sales.quantite.09a38fda">Quantité</th><th class="text-right" i18n="@@reports.sales.ca.09acbb7d">CA</th><th class="text-right" i18n="@@reports.sales.tva.fb62cb5d">TVA</th></tr></thead>
          <tbody>
            @for (row of salesByLine(); track row.productCode) {
              <tr>
                <td>{{ row.productName }}</td>
                <td>{{ row.productCode }}</td>
                <td>{{ row.categoryName ?? '-' }}</td>
                <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
                <td class="text-right print-amount">{{ row.revenue | number:'1.3-3' }} {{ row.currency }}</td>
                <td class="text-right print-amount">{{ row.vatAmount | number:'1.3-3' }} {{ row.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (activeTabIndex === 12 && salesVat().length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.sales.taux.tva.c0830fcc">Taux TVA</th><th class="text-right" i18n="@@reports.sales.base.taxable.449d603a">Base taxable</th><th class="text-right" i18n="@@reports.sales.montant.tva.f0c1b7cc">Montant TVA</th></tr></thead>
          <tbody>
            @for (row of salesVat(); track row.vatRateDisplay) {
              <tr>
                <td>{{ row.vatRateDisplay | backendLabel }}</td>
                <td class="text-right print-amount">{{ row.totalTaxableAmount | number:'1.3-3' }} {{ row.currency }}</td>
                <td class="text-right print-amount">{{ row.totalVatAmount | number:'1.3-3' }} {{ row.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (activeTabIndex === 13 && clientWithholdings().length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.sales.client.1bdd79b1">Client</th><th class="text-right" i18n="@@reports.sales.paiements.97ecc646">Paiements</th><th class="text-right" i18n="@@reports.sales.total.retenue.31936a2f">Total retenue</th></tr></thead>
          <tbody>
            @for (row of clientWithholdings(); track row.clientId) {
              <tr>
                <td>{{ row.clientName }}</td>
                <td class="text-right">{{ row.paymentCount }}</td>
                <td class="text-right print-amount">{{ row.totalWithholding | number:'1.3-3' }} {{ row.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (activeTabIndex === 14 && reportsData()?.overdueInvoices?.length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.sales.numero.15e73db0">Numéro</th><th i18n="@@reports.sales.client.1bdd79b1">Client</th><th class="text-right" i18n="@@reports.sales.montant.4adcd9fc">Montant</th></tr></thead>
          <tbody>
            @for (invoice of reportsData()!.overdueInvoices; track invoice.id) {
              <tr>
                <td>{{ invoice.number }}</td>
                <td>{{ invoice.clientName }}</td>
                <td class="text-right print-amount">{{ invoice.totalAmount | number:'1.3-3' }} {{ invoice.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      <!-- Professional Footer -->
      <div class="print-footer">
        <div class="print-footer__content">
          <span class="print-footer__brand" i18n="@@reports.sales.genere.par.instafact.35c72778">Généré par InstaFact</span>
          <span class="print-footer__page">{{ printDate }}</span>
        </div>
        <div class="print-footer__bar"></div>
      </div>
    </div>
  `,
  styles: [`
    /* Layout onglets (le style visuel est fourni par la classe globale .ft-tabs) */
    .reports-tabs-wrap { margin-top: var(--spacing-6); }
    .tab-content { padding-top: var(--spacing-4); }

    .filter-section {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-6);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border-subtle);
    }

    .filter-group {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
    }

    .filter-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
    }

    .filter-select {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      background: var(--color-background);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .filter-select:hover {
      border-color: var(--color-primary-500);
    }

    .filter-select:focus {
      outline: none;
      border-color: var(--color-primary-500);
      box-shadow: 0 0 0 3px rgba(var(--color-primary-500-rgb, 59, 130, 246), 0.1);
    }

    .filter-period-range {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin-inline-start: var(--spacing-2);
    }

    .summary-block {
      background: var(--color-primary-50);
      border-radius: var(--radius-lg);
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-6);
      border: 1px solid var(--color-primary-100);
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
    }

    .summary-block--alert {
      background: var(--color-error-50, #fef2f2);
      border-color: var(--color-error-200, #fecaca);
    }

    .summary-block--alert .summary-icon {
      color: var(--color-error-600, #dc2626);
    }

    .summary-icon {
      color: var(--color-primary-600);
      font-size: 1.25rem;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .summary-text {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      line-height: 1.5;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-6);
      animation: fadeInUp 0.4s ease-out;
    }

    .stat-skeleton {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      height: 120px;
      border: 1px solid var(--color-border-subtle);
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
    }

    .reports-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: var(--spacing-6);
      margin-bottom: var(--spacing-6);
    }

    .section {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-6);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border-subtle);
      transition: all var(--transition-normal);
      animation: fadeInUp 0.4s ease-out;
    }

    .section:hover {
      box-shadow: var(--shadow-md);
      border-color: var(--color-border-default);
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--spacing-2);
      margin-bottom: var(--spacing-6);
      padding-bottom: var(--spacing-4);
      border-bottom: 2px solid var(--color-border-subtle);
    }

    .section-title {
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      margin: 0;
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .section-title::before {
      content: '';
      width: 4px;
      height: 24px;
      background: linear-gradient(180deg, var(--color-primary-500), var(--color-primary-600));
      border-radius: var(--radius-full);
    }

    .section-subtitle {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      font-weight: var(--font-weight-normal);
      width: 100%;
    }

    .section-link {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-primary-600);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
      transition: all var(--transition-fast);
      padding: var(--spacing-1) var(--spacing-2);
      border-radius: var(--radius-md);
    }

    .section-link:hover {
      color: var(--color-primary-700);
      background: var(--color-primary-50);
    }

    .chart-placeholder {
      min-height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      border: 2px dashed var(--color-border-subtle);
    }

    .chart-content {
      text-align: center;
      color: var(--color-text-secondary);
    }

    .chart-icon {
      font-size: 3rem;
      color: var(--color-primary-500);
      margin-bottom: var(--spacing-3);
    }

    .chart-text {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      margin-bottom: var(--spacing-2);
      color: var(--color-text-primary);
    }

    .chart-subtext {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .chart-container {
      padding: var(--spacing-4) 0;
      display: flex;
      align-items: stretch;
      gap: var(--spacing-4);
    }

    .chart-y-axis {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 220px;
      padding-block: 0; padding-inline: 0 var(--spacing-2);
      border-inline-end: 1px solid var(--color-border-subtle);
      min-width: 72px;
    }

    .chart-y-tick {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace;
    }

    .chart-bars {
      display: flex;
      align-items: flex-end;
      justify-content: space-around;
      height: 220px;
      gap: var(--spacing-3);
      padding: 0 var(--spacing-2);
      flex: 1;
    }

    .chart-bar-group {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      max-width: 80px;
      position: relative;
      height: 100%;
      justify-content: flex-end;
    }

    .chart-bar-wrapper {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      position: relative;
    }

    .chart-bar {
      width: 70%;
      min-height: 4px;
      background: linear-gradient(180deg, var(--color-primary-400), var(--color-primary-600));
      border-radius: var(--radius-md) var(--radius-md) 0 0;
      transition: height 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease;
      cursor: pointer;
      position: relative;
    }

    .chart-bar:hover {
      background: linear-gradient(180deg, var(--color-primary-300), var(--color-primary-500));
      opacity: 0.9;
    }

    .chart-tooltip {
      position: absolute;
      top: -8px;
      left: 50%;
      transform: translateX(-50%) translateY(-100%);
      background: var(--color-text-primary);
      color: var(--color-background);
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-md);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--transition-fast);
      z-index: 10;
      text-align: center;
      font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace;
      line-height: 1.4;
    }

    .chart-tooltip small {
      font-weight: var(--font-weight-normal);
      opacity: 0.8;
    }

    .chart-tooltip::after {
      content: '';
      position: absolute;
      bottom: -4px;
      left: 50%;
      transform: translateX(-50%);
      width: 8px;
      height: 8px;
      background: var(--color-text-primary);
      border-radius: 1px;
      transform: translateX(-50%) rotate(45deg);
    }

    .chart-bar-group:hover .chart-tooltip {
      opacity: 1;
    }

    .chart-label {
      margin-top: var(--spacing-2);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .conversion-section .conversion-value {
      padding: var(--spacing-4);
      text-align: center;
    }

    .conversion-percent {
      font-size: var(--font-size-3xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-primary-600);
      font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace;
    }

    .loading-placeholder,
    .empty-placeholder {
      padding: var(--spacing-8);
      text-align: center;
      color: var(--color-text-secondary);
    }

    .loading-placeholder i,
    .empty-placeholder i {
      font-size: 2rem;
      margin-bottom: var(--spacing-3);
      display: block;
    }

    .empty-hint {
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-2);
      opacity: 0.8;
    }

    .invoice-link {
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
      text-decoration: none;
      transition: all var(--transition-fast);
    }

    .invoice-link:hover {
      color: var(--color-primary-700);
      text-decoration: underline;
    }

    :host ::ng-deep .reports-table {
      .p-datatable-thead > tr > th {
        background: var(--color-neutral-50);
        color: var(--color-text-secondary);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-sm);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: var(--spacing-4) var(--spacing-3);
        border-bottom: 2px solid var(--color-border-default);
      }

      .p-datatable-tbody > tr > td {
        padding: var(--spacing-4) var(--spacing-3);
        border-bottom: 1px solid var(--color-border-subtle);
        vertical-align: middle;
        font-size: var(--font-size-sm);
      }

      .p-datatable-tbody > tr:last-child > td {
        border-bottom: none;
      }

      .p-datatable-tbody > tr:hover {
        background: var(--color-primary-50);
      }
    }

    .client-name {
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .code-secondary {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }

    .invoice-count {
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .text-right {
      text-align: end;
    }

    .amount {
      font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace;
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      font-size: var(--font-size-base);
    }

    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-4);
    }

    .status-card {
      padding: var(--spacing-4);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle);
    }

    .status-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-3);
    }

    .status-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .status-count {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
    }

    .status-bar {
      height: 8px;
      background: var(--color-neutral-200);
      border-radius: var(--radius-full);
      overflow: hidden;
      margin-bottom: var(--spacing-3);
    }

    .status-fill {
      height: 100%;
      transition: width var(--transition-normal);
      border-radius: var(--radius-full);
    }

    .status-amount {
      font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .crosstab-section {
      margin-top: var(--spacing-6);
    }

    .crosstab-insights {
      margin-bottom: var(--spacing-6);
    }

    .insights-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-4);
    }

    .insight-card {
      padding: var(--spacing-4);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }

    .insight-label {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .insight-value {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      color: var(--color-primary-600);
    }

    .insight-detail {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .crosstab-table-wrapper {
      overflow-x: auto;
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle);
    }

    .crosstab-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--font-size-base);
    }

    .crosstab-table th,
    .crosstab-table td {
      padding: var(--spacing-3) var(--spacing-4);
      border-bottom: 1px solid var(--color-border-subtle);
    }

    .crosstab-table thead th {
      background: var(--color-neutral-50);
      color: var(--color-text-secondary);
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-sm);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .crosstab-table tbody tr:hover {
      background: var(--color-primary-50);
    }

    .crosstab-table tfoot .totals-row {
      background: var(--color-primary-50);
      border-top: 2px solid var(--color-primary-500);
    }

    .crosstab-table tfoot th,
    .crosstab-table tfoot td {
      font-weight: var(--font-weight-bold);
      color: var(--color-primary-700);
    }

    .crosstab-table .total-col,
    .crosstab-table .total-cell {
      font-weight: var(--font-weight-semibold);
    }

    @media (max-width: 1024px) {
      .reports-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 768px) {
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-3);
      }

      .section {
        padding: var(--spacing-4);
      }

      .section-header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--spacing-2);
      }

      .section-title {
        font-size: var(--font-size-xl);
      }

      .status-grid {
        grid-template-columns: 1fr;
      }

      .chart-bars {
        height: 160px;
      }

      .chart-bar {
        width: 85%;
      }
    }

    /* ── Print ──────────────────────────────────────────────── */
    .print-only { display: none; }

    @media print {
      @page {
        size: A4;
        margin: 12mm 15mm 18mm 15mm;
      }

      :host {
        font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
        font-size: 10pt;
        color: #2d3748;
        line-height: 1.5;
      }

      .filter-section,
      .summary-block,
      .stats-grid,
      .reports-tabs-wrap,
      app-page-header {
        display: none !important;
      }

      .print-only {
        display: block !important;
      }

      .print-report {
        padding: 0;
        max-width: 100%;
      }

      /* ── Header ── */
      .print-header {
        margin-bottom: 20px;
      }

      .print-header__brand-bar {
        height: 5px;
        background: linear-gradient(90deg, #2bbcb3 0%, #1a8a83 60%, #e2e8f0 100%);
        border-radius: 3px;
        margin-bottom: 16px;
      }

      .print-header__content {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding-bottom: 14px;
        border-bottom: 2px solid #e2e8f0;
      }

      .print-header__title {
        font-size: 20pt;
        font-weight: 800;
        color: #1a202c;
        margin: 0 0 4px;
        letter-spacing: 1px;
      }

      .print-header__subtitle {
        font-size: 12pt;
        color: #2bbcb3;
        font-weight: 600;
        margin: 0 0 4px;
      }

      .print-header__period {
        font-size: 9pt;
        color: #718096;
        margin: 0;
      }

      .print-header__right {
        text-align: end;
      }

      .print-header__app {
        font-size: 13pt;
        font-weight: 700;
        color: #2bbcb3;
        margin: 0 0 4px;
      }

      .print-header__date {
        font-size: 8pt;
        color: #a0aec0;
        margin: 0;
      }

      /* ── KPI Bar ── */
      .print-kpi-bar {
        display: flex;
        gap: 10px;
        margin-bottom: 20px;
        flex-wrap: wrap;
      }

      .print-kpi-item {
        flex: 1;
        min-width: 90px;
        padding: 10px 12px;
        border: 1.5px solid #e2e8f0;
        border-radius: 8px;
        text-align: center;
        background: #f7fafc;
      }

      .print-kpi-item--alert {
        border-color: #fc8181;
        background: #fff5f5;
      }

      .print-kpi-item__label {
        display: block;
        font-size: 7pt;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #718096;
        margin-bottom: 4px;
      }

      .print-kpi-item__value {
        display: block;
        font-size: 12pt;
        font-weight: 700;
        color: #1a202c;
      }

      .print-kpi-item--alert .print-kpi-item__value {
        color: #e53e3e;
      }

      /* ── KPI cards (insights) ── */
      .print-kpis {
        display: flex;
        gap: 10px;
        margin-bottom: 18px;
        flex-wrap: wrap;
      }

      .print-kpi {
        flex: 1;
        min-width: 110px;
        padding: 12px 14px;
        border: 1.5px solid #e2e8f0;
        border-radius: 8px;
        text-align: center;
        background: #f7fafc;
      }

      .print-kpi strong {
        display: block;
        font-size: 7.5pt;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        color: #718096;
        margin-bottom: 4px;
      }

      .print-kpi span {
        display: block;
        font-size: 13pt;
        font-weight: 700;
        color: #2d3748;
      }

      .print-kpi small {
        display: block;
        font-size: 7pt;
        color: #a0aec0;
        margin-top: 2px;
      }

      /* ── Section titles ── */
      .print-section-title {
        font-size: 12pt;
        font-weight: 700;
        margin: 18px 0 10px;
        color: #2d3748;
        padding-bottom: 6px;
        border-bottom: 2px solid #2bbcb3;
        display: inline-block;
      }

      /* ── Tables ── */
      .print-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11pt;
        margin-bottom: 18px;
      }

      .print-table thead {
        display: table-header-group;
      }

      .print-table thead th {
        text-align: start;
        padding: 9px 12px;
        font-weight: 700;
        color: #1a202c;
        font-size: 10pt;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        white-space: nowrap;
        border-bottom: 2.5px solid #2bbcb3;
        background: #f7fafc;
      }

      .print-table thead th.text-right {
        text-align: end;
      }

      .print-table tbody td {
        padding: 8px 12px;
        border-bottom: 1px solid #edf2f7;
        color: #4a5568;
        vertical-align: middle;
      }

      .print-table tbody td.text-right {
        text-align: end;
      }

      .print-table tbody tr {
        page-break-inside: avoid;
      }

      .print-table tbody tr:nth-child(even) {
        background: #f7fafc;
      }

      .print-table tbody tr:hover {
        background: transparent;
      }

      .print-table tfoot td {
        padding: 9px 12px;
        border-top: 2.5px solid #2bbcb3;
        font-weight: 700;
        font-size: 11pt;
        color: #1a202c;
        background: #f0fffe;
      }

      .print-amount {
        font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
        font-weight: 600;
        letter-spacing: -0.3px;
      }

      .print-table--compact {
        font-size: 9pt;
      }

      .print-table--compact thead th {
        font-size: 8pt;
        padding: 6px 8px;
      }

      .print-table--compact tbody td {
        padding: 6px 8px;
      }

      /* ── Conversion quote ── */
      .print-conversion {
        text-align: center;
        padding: 30px 0;
        margin: 10px 0 20px;
        border: 2px solid #e2e8f0;
        border-radius: 12px;
        background: #f7fafc;
      }

      .print-conversion-value {
        display: block;
        font-size: 36pt;
        font-weight: 800;
        color: #2bbcb3;
      }

      .print-conversion-label {
        display: block;
        font-size: 10pt;
        color: #718096;
        margin-top: 6px;
      }

      /* ── Footer ── */
      .print-footer {
        margin-top: 24px;
        page-break-inside: avoid;
      }

      .print-footer__content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        border-top: 1px solid #e2e8f0;
      }

      .print-footer__brand {
        font-size: 8pt;
        color: #a0aec0;
        font-weight: 500;
      }

      .print-footer__page {
        font-size: 7pt;
        color: #cbd5e0;
      }

      .print-footer__bar {
        height: 4px;
        margin-top: 8px;
        background: linear-gradient(90deg, #2bbcb3 0%, #1a8a83 40%, transparent 100%);
        border-radius: 2px;
      }
    }
  `]
})
export class SalesReportsComponent implements OnInit {
  protected readonly loc_sur_la_periode_selectionnee_2fbf29 = $localize`:@@reports.sales-reports.tpl.sur.la.periode.selectionnee.2fbf29c3:sur la période sélectionnée`;

  readonly loc_ui_tern_graphique_en_barres_evolution_des_revenus_b58454 = $localize`:@@ui.tern.graphique.en.barres.evolution.des.revenus.b58454:Graphique en barres - évolution des revenus `;
  private readonly route = inject(ActivatedRoute);
  reportsService = inject(SalesReportsService);
  reportsApi = inject(ReportsApiService);

  loading = signal(true);
  reportsData = signal<SalesReportsData | null>(null);
  crossTabData = signal<RevenueCrossTabData | null>(null);
  crossTabLoading = signal(true);
  crossTabInsights = signal<CrossTabInsight[]>([]);
  clientTransactions = signal<ClientTransactionReportRow[]>([]);
  clientTransactionsLoading = signal(false);
  salesByLine = signal<SalesByLineReportRow[]>([]);
  salesByLineLoading = signal(false);
  salesVat = signal<SalesVatReportRow[]>([]);
  salesVatLoading = signal(false);
  productPerformance = signal<ProductPerformanceReportRow[]>([]);
  productPerformanceLoading = signal(false);
  productSalesTrend = signal<ProductSalesTrendReportRow[]>([]);
  productSalesTrendLoading = signal(false);
  basketMetrics = signal<BasketMetricsReportDto | null>(null);
  basketMetricsLoading = signal(false);
  productsNeverSold = signal<ProductNeverSoldReportRow[]>([]);
  productsNeverSoldLoading = signal(false);
  revenueByCategory = signal<SalesRevenueReportRow[]>([]);
  revenueByCategoryLoading = signal(false);
  clientWithholdings = signal<ClientWithholdingReportRow[]>([]);
  clientWithholdingsLoading = signal(false);
  activeTabIndex = 0;
  selectedPeriod: ReportPeriod = 'month';
  private maxRevenue = 0;

  periodOptions: PeriodOption[] = [
    { label: $localize`:@@reports.sales-reports.ts.cette.semaine.af7dc0a9:Cette semaine`, value: 'week' },
    { label: $localize`:@@reports.sales-reports.ts.ce.mois.db74c560:Ce mois`, value: 'month' },
    { label: $localize`:@@reports.sales-reports.ts.ce.trimestre.4d9d129d:Ce trimestre`, value: 'quarter' },
    { label: $localize`:@@reports.sales-reports.ts.cette.annee.052507a0:Cette année`, value: 'year' },
    { label: $localize`:@@reports.sales-reports.ts.tout.6b0b09b8:Tout`, value: 'all' }
  ];

  ngOnInit(): void {
    this.applyTabFromQuery(this.route.snapshot.queryParamMap.get('tab'));
    this.route.queryParamMap.subscribe(params => this.applyTabFromQuery(params.get('tab')));
    this.loadReportsData();
    this.loadCrossTabData();
    this.loadClientTransactions();
    this.loadSalesByLine();
    this.loadSalesVat();
    this.loadProductPerformance();
    this.loadProductSalesTrend();
    this.loadBasketMetrics();
    this.loadProductsNeverSold();
    this.loadRevenueByCategory();
    this.loadClientWithholdings();
  }

  private applyTabFromQuery(tab: string | null): void {
    if (tab === 'retenues-clients') {
      this.activeTabIndex = 13;
    }
  }

  clientWithholdingsTotal(): number {
    return this.clientWithholdings().reduce((sum, r) => sum + r.totalWithholding, 0);
  }

  clientWithholdingsPaymentTotal(): number {
    return this.clientWithholdings().reduce((sum, r) => sum + r.paymentCount, 0);
  }

  onPeriodChange(): void {
    this.loadReportsData();
    this.loadClientTransactions();
    this.loadSalesByLine();
    this.loadSalesVat();
    this.loadProductPerformance();
    this.loadProductSalesTrend();
    this.loadBasketMetrics();
    this.loadProductsNeverSold();
    this.loadRevenueByCategory();
    this.loadClientWithholdings();
  }

  onTabChange(index: string | number | undefined): void {
    this.activeTabIndex = typeof index === 'number' ? index : Number(index);
  }

  private getPeriodDates(): { fromDate: string; toDate: string } {
    const to = new Date();
    const toDate = formatLocalDate(to);
    if (this.selectedPeriod === 'all') return { fromDate: '2020-01-01', toDate };
    const daysMap: Record<Exclude<ReportPeriod, 'all'>, number> = { week: 7, month: 30, quarter: 90, year: 365 };
    const from = new Date();
    from.setDate(from.getDate() - daysMap[this.selectedPeriod]);
    return { fromDate: formatLocalDate(from), toDate };
  }

  periodDateRangeLabel(): string {
    const { fromDate, toDate } = this.getPeriodDates();
    const from = new Date(fromDate + 'T12:00:00');
    const to = new Date(toDate + 'T12:00:00');
    const fromStr = from.toLocaleDateString(erpDateLocale('fr-FR'), { day: 'numeric', month: 'long', year: 'numeric' });
    const toStr = to.toLocaleDateString(erpDateLocale('fr-FR'), { day: 'numeric', month: 'long', year: 'numeric' });
    if (fromDate === toDate) return fromStr;
    return `${fromStr} – ${toStr}`;
  }

  private loadClientTransactions(): void {
    this.clientTransactionsLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getClientTransactions(fromDate, toDate).subscribe({
      next: (res) => {
        this.clientTransactions.set(res.success && res.data ? res.data : []);
        this.clientTransactionsLoading.set(false);
      },
      error: () => { this.clientTransactions.set([]); this.clientTransactionsLoading.set(false); }
    });
  }

  private loadSalesByLine(): void {
    this.salesByLineLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getSalesByLine(fromDate, toDate).subscribe({
      next: (res) => {
        this.salesByLine.set(res.success && res.data ? res.data : []);
        this.salesByLineLoading.set(false);
      },
      error: () => { this.salesByLine.set([]); this.salesByLineLoading.set(false); }
    });
  }

  private loadSalesVat(): void {
    this.salesVatLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getSalesVat(fromDate, toDate).subscribe({
      next: (res) => {
        this.salesVat.set(res.success && res.data ? res.data : []);
        this.salesVatLoading.set(false);
      },
      error: () => { this.salesVat.set([]); this.salesVatLoading.set(false); }
    });
  }

  private loadProductPerformance(): void {
    this.productPerformanceLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getProductPerformance(fromDate, toDate).subscribe({
      next: (res) => {
        this.productPerformance.set(res.success && res.data ? res.data : []);
        this.productPerformanceLoading.set(false);
      },
      error: () => { this.productPerformance.set([]); this.productPerformanceLoading.set(false); }
    });
  }

  private loadProductSalesTrend(): void {
    this.productSalesTrendLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getProductSalesTrend(fromDate, toDate).subscribe({
      next: (res) => {
        this.productSalesTrend.set(res.success && res.data ? res.data : []);
        this.productSalesTrendLoading.set(false);
      },
      error: () => { this.productSalesTrend.set([]); this.productSalesTrendLoading.set(false); }
    });
  }

  private loadBasketMetrics(): void {
    this.basketMetricsLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getBasketMetrics(fromDate, toDate).subscribe({
      next: (res) => {
        this.basketMetrics.set(res.success && res.data ? res.data : null);
        this.basketMetricsLoading.set(false);
      },
      error: () => { this.basketMetrics.set(null); this.basketMetricsLoading.set(false); }
    });
  }

  private loadProductsNeverSold(): void {
    this.productsNeverSoldLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getProductsNeverSold(fromDate, toDate).subscribe({
      next: (res) => {
        this.productsNeverSold.set(res.success && res.data ? res.data : []);
        this.productsNeverSoldLoading.set(false);
      },
      error: () => { this.productsNeverSold.set([]); this.productsNeverSoldLoading.set(false); }
    });
  }

  private loadRevenueByCategory(): void {
    this.revenueByCategoryLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getSalesRevenueByProduct(fromDate, toDate, 'Category').subscribe({
      next: (res) => {
        this.revenueByCategory.set(res.success && res.data ? res.data : []);
        this.revenueByCategoryLoading.set(false);
      },
      error: () => { this.revenueByCategory.set([]); this.revenueByCategoryLoading.set(false); }
    });
  }

  private loadClientWithholdings(): void {
    this.clientWithholdingsLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getClientWithholdings(fromDate, toDate).subscribe({
      next: (res) => {
        this.clientWithholdings.set(res.success && res.data ? res.data : []);
        this.clientWithholdingsLoading.set(false);
      },
      error: () => { this.clientWithholdings.set([]); this.clientWithholdingsLoading.set(false); }
    });
  }

  loadReportsData(): void {
    this.loading.set(true);
    this.reportsService.loadReportsData(this.selectedPeriod).subscribe({
      next: (data) => {
        this.reportsData.set(data);
        const revenues = data.revenueChartData.map(d => d.revenue);
        this.maxRevenue = Math.max(...revenues, 1);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  loadCrossTabData(): void {
    this.crossTabLoading.set(true);
    this.reportsService.loadRevenueCrossTabData().subscribe({
      next: (data) => {
        this.crossTabData.set(data);
        this.crossTabInsights.set(data ? this.reportsService.computeCrossTabInsights(data) : []);
        this.crossTabLoading.set(false);
      },
      error: () => {
        this.crossTabData.set(null);
        this.crossTabInsights.set([]);
        this.crossTabLoading.set(false);
      }
    });
  }

  getBarHeight(revenue: number): number {
    if (this.maxRevenue === 0) return 4;
    const percent = (revenue / this.maxRevenue) * 100;
    return Math.max(percent, 4);
  }

  chartYAxisTicks(): { value: number; label: string }[] {
    const currency = this.reportsData()?.currency ?? 'TND';
    const steps = [1, 0.75, 0.5, 0.25, 0];
    return steps.map(p => {
      const value = p * this.maxRevenue;
      const formatted = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
      return { value, label: `${formatted} ${currency}` };
    });
  }

  formatCurrency(amount: number, currency?: string): string {
    const formatted = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(amount);
    return `${formatted} ${currency ?? 'TND'}`;
  }

  private exportDecisionnelTab(tabIndex: number): void {
    const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const dateStr = formatLocalDate(new Date());
    let csv = '';
    if (tabIndex === 9) {
      const rows = this.productPerformance();
      const headers = ['Produit', 'Code', 'Catégorie', 'Quantité', 'CA', 'Coût', 'Marge', 'Marge %', 'Part CA %', 'Devise'];
      csv = [headers.map(escape).join(';'), ...rows.map(r =>
        [r.productName, r.productCode, r.categoryName ?? '', r.quantitySold, r.revenue.toFixed(3), r.totalCost.toFixed(3), r.profit.toFixed(3), r.marginPercent != null ? r.marginPercent.toFixed(1) : '', r.revenueSharePercent.toFixed(1), r.currency].map(escape).join(';')
      )].join('\n');
    } else if (tabIndex === 10) {
      const rows = this.productSalesTrend();
      const headers = ['Période', 'Produit', 'Code', 'Catégorie', 'Quantité', 'CA', 'Devise'];
      csv = [headers.map(escape).join(';'), ...rows.map(r =>
        [r.period, r.productName, r.productCode, r.categoryName ?? '', r.quantity, r.revenue.toFixed(3), r.currency].map(escape).join(';')
      )].join('\n');
    } else if (tabIndex === 11) {
      const m = this.basketMetrics();
      if (m) csv = 'Indicateur;Valeur\n"Panier moyen";' + m.averageBasket.toFixed(3) + '\n"Lignes moy. / facture";' + m.averageLinesPerInvoice.toFixed(1) + '\n"Factures";' + m.totalInvoices + '\n"CA total";' + m.totalRevenue.toFixed(3) + '\n"Devise";' + m.currency;
    } else if (tabIndex === 12) {
      const rows = this.productsNeverSold();
      const headers = ['Produit', 'Code', 'Catégorie', 'Prix unitaire', 'Devise'];
      csv = [headers.map(escape).join(';'), ...rows.map(r =>
        [r.productName, r.productCode, r.categoryName ?? '', r.unitPrice.toFixed(3), r.currency].map(escape).join(';')
      )].join('\n');
    } else if (tabIndex === 13) {
      const rows = this.revenueByCategory();
      const headers = ['Catégorie', 'Quantité', 'Chiffre d\'affaires', 'Devise'];
      csv = [headers.map(escape).join(';'), ...rows.map(r =>
        [r.groupKey, r.quantity, r.revenue.toFixed(3), r.currency].map(escape).join(';')
      )].join('\n');
    }
    if (!csv) return;
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rapports-ventes-${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private exportClientWithholdingsTab(): void {
    const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = this.clientWithholdings();
    const headers = ['Client', 'N° paiements', 'Total retenue', 'Devise'];
    const csv = [
      headers.map(escape).join(';'),
      ...rows.map(r =>
        [r.clientName, r.paymentCount, r.totalWithholding.toFixed(3), r.currency].map(escape).join(';')
      )
    ].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rapports-ventes-retenues-clients-${formatLocalDate(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  onExport(): void {
    if (this.activeTabIndex === 13) {
      this.exportClientWithholdingsTab();
      return;
    }
    if (this.activeTabIndex >= 9 && this.activeTabIndex <= 12) {
      this.exportDecisionnelTab(this.activeTabIndex);
      return;
    }

    const data = this.reportsData();
    const crossTab = this.crossTabData();
    if (!data) return;

    // Export uses full data (signals/reportsData), not the current page of paginated tables.
    const rows: string[][] = [];
    rows.push(['Rapports Ventes InstaFact', '']);
    rows.push(['Période', this.periodOptions.find(p => p.value === this.selectedPeriod)?.label || this.selectedPeriod]);
    rows.push(['']);
    rows.push(['Indicateurs', 'Valeur']);
    rows.push(['Revenus totaux', data.totalRevenue]);
    rows.push(['Factures', data.totalInvoices.toString()]);
    rows.push(['Factures payées', data.paidInvoices.toString()]);
    rows.push(['Taux de paiement', data.paymentRate]);
    rows.push(['Montant à encaisser', data.amountToCollect]);
    rows.push(['Factures en retard', data.overdueInvoicesCount.toString()]);
    rows.push(['']);
    rows.push(['Meilleurs clients', '', '']);
    rows.push(['Client', 'Factures', 'Montant total']);
    data.topClients.forEach(c => {
      rows.push([c.clientName, c.invoiceCount.toString(), `${c.totalAmount.toFixed(3)} ${c.currency}`]);
    });

    if (crossTab && crossTab.years.length > 0) {
      rows.push(['']);
      rows.push(['Tableau croisé CA - Chiffres d\'affaires par mois et année', '']);
      const headerRow = ['Année', ...REPORT_EXPORT_MONTHS_SHORT_FR, 'Total'];
      rows.push(headerRow);
      crossTab.years.forEach(year => {
        const monthRevs = crossTab.matrix.get(year) ?? [];
        const rowTotal = crossTab.rowTotals.get(year) ?? 0;
        const row = [
          year.toString(),
          ...monthRevs.map(r => r.toFixed(3)),
          `${rowTotal.toFixed(3)} ${crossTab.currency}`
        ];
        rows.push(row);
      });
      const totalsRow = [
        'Total',
        ...crossTab.columnTotals.map(c => c.toFixed(3)),
        `${crossTab.grandTotal.toFixed(3)} ${crossTab.currency}`
      ];
      rows.push(totalsRow);
    }

    const csv = rows.map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')
    ).join('\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapports-ventes-${formatLocalDate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private readonly tabNames = [
    $localize`:@@reports.sales-reports.ts.revenus.et.clients.893c8058:Revenus et clients`, $localize`:@@reports.sales-reports.ts.synthese.mensuelle.bab5b563:Synthèse mensuelle`,
    $localize`:@@reports.sales-reports.ts.chiffres.d.affaires.par.mois.annee.cc6a49c6:Chiffres d'affaires par mois / Année`,
    $localize`:@@reports.sales-reports.ts.taux.de.conversion.devis.8bc52158:Taux de conversion devis`, $localize`:@@reports.sales-reports.ts.repartition.par.statut.05b7c49b:Répartition par statut`,
    'Performance produits', 'Évolution ventes par produit',
    'Indicateurs panier', 'Produits jamais vendus',
    'CA par catégorie', 'Transactions clients',
    'Détails ventes par ligne', 'TVA ventes',
    'Retenues clients', 'Factures en retard'
  ];

  get activeTabName(): string {
    return this.tabNames[this.activeTabIndex] ?? $localize`:@@ui.tern.rapport.f25c40:Rapport`;
  }

  get printDate(): string {
    return new Date().toLocaleDateString(erpDateLocale('fr-FR'), {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  get selectedPeriodIndex(): number {
    return this.periodOptions.findIndex(p => p.value === this.selectedPeriod);
  }

  onPrint(): void {
    globalThis.print();
  }
}
