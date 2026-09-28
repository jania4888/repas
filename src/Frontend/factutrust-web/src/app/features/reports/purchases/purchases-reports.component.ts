import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { formatLocalDate } from '@core/utils/date.util';
import {
  PurchasesReportsService,
  PurchasesReportsData,
  ReportPeriod,
  ExpenseCrossTabData
} from '../services/purchases-reports.service';
import {
  ReportsApiService,
  SupplierTransactionReportRow,
  PurchasesByLineReportRow,
  PurchasesVatReportRow,
  SupplierBalanceReportRow,
  SupplierWithholdingReportRow
} from '@core/services/reports-api.service';
import { PartyBalancesTableComponent, PartyBalanceRow } from '../shared/party-balances-table.component';
import { mapSupplierBalanceRows } from '../shared/party-balances.util';
import { erpDateLocale } from '@core/i18n/erp-format';
import { REPORT_EXPORT_MONTHS_SHORT_FR } from '../shared/report-export-fr';

interface PeriodOption {
  label: string;
  value: ReportPeriod;
}

@Component({
  selector: 'app-purchases-reports',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    TabsModule,
    PageHeaderComponent,
    StatCardComponent,
    ButtonComponent,
    PartyBalancesTableComponent
  ],
  template: `
    <app-page-header 
      title="Rapports Achats" i18n-title="@@reports.purchases.rapports.achats.ac9a7abf" 
      subtitle="Analysez vos dépenses et suivez vos indicateurs d'achats" i18n-subtitle="@@reports.purchases.analysez.vos.depenses.et.suivez.vos.indi.86c24497">
      <app-button 
        variant="secondary"
        icon="pi-download"
        iconPos="left"
        (click)="onExport()" i18n="@@reports.purchases.exporter.0cd84bdc"> Exporter </app-button>
      <app-button 
        variant="secondary"
        icon="pi-print"
        iconPos="left"
        (click)="onPrint()" i18n="@@reports.purchases.imprimer.5382c09d"> Imprimer </app-button>
    </app-page-header>

    <div class="filter-section">
      <div class="filter-group">
        <label for="period" class="filter-label" i18n="@@reports.purchases.periode.de2110b7">Période</label>
        <select 
          id="period"
          [(ngModel)]="selectedPeriod" 
          (ngModelChange)="onPeriodChange()"
          class="filter-select"
          aria-label="Sélectionner la période des rapports" i18n-aria-label="@@reports.purchases.selectionner.la.periode.des.rapports.d6f7fa31">
          @for (period of periodOptions; track period.value) {
            <option [value]="period.value">{{ period.label }}</option>
          }
        </select>
      </div>
    </div>

    @if (!loading() && reportsData()?.summaryText) {
      <div class="summary-block" role="status" aria-live="polite">
        <i class="pi pi-info-circle summary-icon"></i>
        <p class="summary-text">{{ reportsData()!.summaryText }}</p>
      </div>
    }

    @if (loading()) {
      <div class="stats-grid">
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
        <div class="stat-skeleton"></div>
      </div>
    } @else if (reportsData()) {
      <div class="stats-grid">
        <app-stat-card
          label="Dépenses totales" i18n-label="@@reports.purchases.depenses.totales.7f280e4e"
          [value]="reportsData()!.totalExpenses"
          icon="pi-dollar"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Factures fournisseurs" i18n-label="@@reports.purchases.factures.fournisseurs.1dcbc2ed"
          [value]="reportsData()!.totalInvoices"
          icon="pi-file"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Factures payées" i18n-label="@@reports.purchases.factures.payees.587e5689"
          [value]="reportsData()!.paidInvoices"
          icon="pi-check-circle"
          variant="success">
        </app-stat-card>
        <app-stat-card
          label="Taux de paiement" i18n-label="@@reports.purchases.taux.de.paiement.813ba1e7"
          [value]="reportsData()!.paymentRate"
          icon="pi-percentage"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Montant à payer" i18n-label="@@reports.purchases.montant.a.payer.caf88629"
          [value]="reportsData()!.amountToPay"
          icon="pi-wallet"
          variant="warning">
        </app-stat-card>
      </div>
    }

    <div class="reports-tabs-wrap">
      <p-tabs class="ft-tabs" [scrollable]="true" [value]="activeTabIndex" (valueChange)="onTabChange($event)" [lazy]="true">
        <p-tablist>
          <p-tab [value]="0"><i class="pi pi-chart-line"></i><span i18n="@@reports.purchases.depenses.et.fournisseurs.8acc873e">Dépenses et fournisseurs</span></p-tab>
          <p-tab [value]="1"><i class="pi pi-list"></i><span i18n="@@reports.purchases.transactions.fournisseurs.83a34e96">Transactions fournisseurs</span></p-tab>
          <p-tab [value]="2"><i class="pi pi-box"></i><span i18n="@@reports.purchases.details.achats.par.ligne.20c0118b">Détails achats par ligne</span></p-tab>
          <p-tab [value]="3"><i class="pi pi-calculator"></i><span i18n="@@reports.purchases.tva.achats.48719283">TVA achats</span></p-tab>
          <p-tab [value]="4"><i class="pi pi-wallet"></i><span i18n="@@reports.purchases.soldes.fournisseur.18c92c31">Soldes fournisseur</span></p-tab>
          <p-tab [value]="5"><i class="pi pi-percentage"></i><span i18n="@@reports.purchases.retenues.fournisseurs.a6b3211f">Retenues fournisseurs</span></p-tab>
          <p-tab [value]="6"><i class="pi pi-calendar"></i><span i18n="@@reports.purchases.synthese.mensuelle.bab5b563">Synthèse mensuelle</span></p-tab>
          <p-tab [value]="7"><i class="pi pi-chart-bar"></i><span i18n="@@reports.purchases.repartition.par.statut.05b7c49b">Répartition par statut</span></p-tab>
          <p-tab [value]="8"><i class="pi pi-table"></i><span i18n="@@reports.purchases.depenses.par.mois.annee.a1932f50">Dépenses par mois / Année</span></p-tab>
        </p-tablist>
        <p-tabpanels>
        <p-tabpanel [value]="0">
        <div class="tab-content">
    <div class="reports-grid">
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.purchases.evolution.des.depenses.55b93cad">Évolution des dépenses</h2>
          <span class="section-subtitle" i18n="@@reports.purchases.depenses.des.factures.fournisseurs.payees.sur.la.deaa8033">Dépenses des factures fournisseurs payées sur la période</span>
        </div>
        @if (loading()) {
          <div class="chart-placeholder">
            <div class="loading-placeholder">
              <i class="pi pi-spin pi-spinner"></i>
              <span i18n="@@reports.purchases.chargement.a209b664">Chargement...</span>
            </div>
          </div>
        } @else if (reportsData()?.expenseChartData && reportsData()!.expenseChartData.length > 0) {
          <div class="chart-container" role="img" aria-label="Graphique - évolution des dépenses" i18n-aria-label="@@reports.purchases.graphique.evolution.des.depenses.0949af3b">
            <div class="chart-bars">
              @for (item of reportsData()!.expenseChartData; track item.label) {
                <div class="chart-bar-group">
                  <div class="chart-tooltip" aria-hidden="true" i18n="@@reports.purchases.facture.f80b44a2.pl">
                    {{ formatCurrency(item.amount) }}<br>
                    <small>{{ item.invoiceCount }} {item.invoiceCount, plural, =0 {facture} =1 {facture} other {factures}}</small>
                  </div>
                  <div class="chart-bar-wrapper">
                    <div
                      class="chart-bar chart-bar-blue"
                      [style.height.%]="getBarHeight(item.amount)"
                      [attr.aria-label]="item.label + ': ' + formatCurrency(item.amount)">
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
              <p class="chart-text" i18n="@@reports.purchases.aucune.donnee.pour.cette.periode.b2a99770">Aucune donnée pour cette période</p>
              <p class="chart-subtext" i18n="@@reports.purchases.les.depenses.apparaitront.ici.une.fois.que.vous..631790aa">Les dépenses apparaîtront ici une fois que vous aurez des factures fournisseurs payées. Créez des bons de commande et des factures fournisseurs.</p>
            </div>
          </div>
        }
      </div>

      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.purchases.principaux.fournisseurs.343537e6">Principaux fournisseurs</h2>
          <span class="section-subtitle" i18n="@@reports.purchases.top.10.par.montant.total.achete.b644fbce">Top 10 par montant total acheté</span>
        </div>
        @if (loading()) {
          <div class="loading-placeholder">
            <i class="pi pi-spin pi-spinner"></i>
            <span i18n="@@reports.purchases.chargement.a209b664">Chargement...</span>
          </div>
        } @else if (!reportsData()?.topSuppliers?.length) {
          <div class="empty-placeholder">
            <i class="pi pi-info-circle"></i>
            <p i18n="@@reports.purchases.aucune.donnee.disponible.78c36aa1">Aucune donnée disponible</p>
            <p class="empty-hint" i18n="@@reports.purchases.aucune.facture.fournisseur.sur.cette.periode.cha.99f7521b">Aucune facture fournisseur sur cette période. Changez la période ou créez des factures fournisseurs.</p>
          </div>
        } @else {
          <p-table 
            [value]="reportsData()!.topSuppliers" 
            styleClass="p-datatable-sm reports-table"
            aria-label="Tableau des principaux fournisseurs" i18n-aria-label="@@reports.purchases.tableau.des.principaux.fournisseurs.3b1b86a4">
            <ng-template pTemplate="header">
              <tr>
                <th i18n="@@reports.purchases.fournisseur.97d91d89">Fournisseur</th>
                <th class="text-right" i18n="@@reports.purchases.factures.da35e4f2">Factures</th>
                <th class="text-right" i18n="@@reports.purchases.montant.total.dd001537">Montant total</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-supplier>
              <tr>
                <td><span class="supplier-name">{{ supplier.supplierName }}</span></td>
                <td class="text-right"><span class="invoice-count">{{ supplier.invoiceCount }}</span></td>
                <td class="text-right amount">{{ supplier.totalAmount | number:'1.3-3' }} {{ supplier.currency }}</td>
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
    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.purchases.transactions.fournisseurs.83a34e96">Transactions fournisseurs</h2>
        <span class="section-subtitle" i18n="@@reports.purchases.factures.fournisseurs.et.paiements.sur.la.period.cd6c0301">Factures fournisseurs et paiements sur la période</span>
      </div>
      @if (supplierTransactionsLoading()) {
        <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.purchases.chargement.a209b664">Chargement...</span></div>
      } @else if (!supplierTransactions().length) {
        <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.purchases.aucune.transaction.sur.cette.periode.2ed99811">Aucune transaction sur cette période</p></div>
      } @else {
        <p-table [value]="supplierTransactions()" styleClass="p-datatable-sm reports-table" aria-label="Transactions fournisseurs" i18n-aria-label="@@reports.purchases.transactions.fournisseurs.83a34e96">
          <ng-template pTemplate="header">
            <tr><th i18n="@@reports.purchases.date.eb9a4bc1">Date</th><th i18n="@@reports.purchases.type.3deb7456">Type</th><th i18n="@@reports.purchases.fournisseur.97d91d89">Fournisseur</th><th i18n="@@reports.purchases.reference.f8130bb0">Référence</th><th class="text-right" i18n="@@reports.purchases.montant.4adcd9fc">Montant</th></tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.date | date:'dd/MM/yyyy' }}</td>
              <td>{{ row.transactionType }}</td>
              <td>{{ row.supplierName }}</td>
              <td>{{ row.reference }}</td>
              <td class="text-right amount">{{ row.amount | number:'1.3-3' }} {{ row.currency }}</td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="2">
        <div class="tab-content">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.purchases.details.achats.par.ligne.produit.391443f8">Détails achats par ligne produit</h2>
        <span class="section-subtitle" i18n="@@reports.purchases.lignes.de.factures.fournisseurs.agregees.par.pro.ace648ff">Lignes de factures fournisseurs agrégées par produit sur la période</span>
      </div>
      @if (purchasesByLineLoading()) {
        <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.purchases.chargement.a209b664">Chargement...</span></div>
      } @else if (!purchasesByLine().length) {
        <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.purchases.aucune.ligne.d.achat.sur.cette.periode.fc546c63">Aucune ligne d'achat sur cette période</p></div>
      } @else {
        <p-table [value]="purchasesByLine()" styleClass="p-datatable-sm reports-table" aria-label="Détails achats par ligne" i18n-aria-label="@@reports.purchases.details.achats.par.ligne.20c0118b">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.purchases.produit.ff673dc2">Produit</th>
              <th i18n="@@reports.purchases.code.adac6937">Code</th>
              <th i18n="@@reports.purchases.fournisseur.97d91d89">Fournisseur</th>
              <th class="text-right" i18n="@@reports.purchases.quantite.09a38fda">Quantité</th>
              <th class="text-right" i18n="@@reports.purchases.montant.ttc.a742433a">Montant TTC</th>
              <th class="text-right" i18n="@@reports.purchases.tva.fb62cb5d">TVA</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.productName }}</td>
              <td>{{ row.productCode }}</td>
              <td>{{ row.supplierName }}</td>
              <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
              <td class="text-right amount">{{ row.amountTTC | number:'1.3-3' }} {{ row.currency }}</td>
              <td class="text-right amount">{{ row.vatAmount | number:'1.3-3' }} {{ row.currency }}</td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="3">
        <div class="tab-content">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.purchases.tva.achats.48719283">TVA achats</h2>
        <span class="section-subtitle" i18n="@@reports.purchases.agregat.tva.par.taux.sur.la.periode.94b0dc97">Agrégat TVA par taux sur la période</span>
      </div>
      @if (purchasesVatLoading()) {
        <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.purchases.chargement.a209b664">Chargement...</span></div>
      } @else if (!purchasesVat().length) {
        <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.purchases.aucune.tva.achats.sur.cette.periode.cdd1f640">Aucune TVA achats sur cette période</p></div>
      } @else {
        <p-table [value]="purchasesVat()" styleClass="p-datatable-sm reports-table" aria-label="TVA achats" i18n-aria-label="@@reports.purchases.tva.achats.48719283">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.purchases.taux.tva.c0830fcc">Taux TVA</th>
              <th class="text-right" i18n="@@reports.purchases.base.taxable.449d603a">Base taxable</th>
              <th class="text-right" i18n="@@reports.purchases.montant.tva.f0c1b7cc">Montant TVA</th>
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
      <p-tabpanel [value]="4">
        <div class="tab-content">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.purchases.soldes.fournisseur.18c92c31">Soldes fournisseur</h2>
        <span class="section-subtitle" i18n="@@reports.purchases.total.facture.total.paye.et.solde.par.fournisseu.8e4e2a6a">Total facturé, total payé et solde par fournisseur</span>
        <a class="section-link" routerLink="/reports/supplier-balances" i18n="@@reports.purchases.voir.la.fenetre.dediee.f4185a4c">Voir la fenêtre dédiée</a>
      </div>
      <app-party-balances-table
        [rows]="supplierBalanceRows()"
        [loading]="supplierBalancesLoading()"
        partyLabel="Fournisseur"
        emptyMessage="Aucun solde fournisseur" i18n-emptyMessage="@@reports.purchases.aucun.solde.fournisseur.6ed70d5f"
        ariaLabel="Soldes fournisseurs" i18n-ariaLabel="@@reports.purchases.soldes.fournisseurs.8cbd3b13">
      </app-party-balances-table>
    </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="5">
        <div class="tab-content">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.purchases.total.des.retenues.pour.les.fournisseurs.754a9b6d">Total des retenues pour les fournisseurs</h2>
        <span class="section-subtitle" i18n="@@reports.purchases.agrege.par.fournisseur.selon.la.date.de.solde.pa.16825c6f">Agrégé par fournisseur selon la date de solde (PaidAt), aligné déclaration TEJ</span>
      </div>
      <p class="section-hint">
        <a routerLink="/withholding-tax/dashboard" class="section-link" i18n="@@reports.purchases.tableau.de.bord.retenue.a.la.source.fa7f4511">Tableau de bord retenue à la source</a>
      </p>
      @if (supplierWithholdingsLoading()) {
        <div class="loading-placeholder"><i class="pi pi-spin pi-spinner"></i><span i18n="@@reports.purchases.chargement.a209b664">Chargement...</span></div>
      } @else if (!supplierWithholdings().length) {
        <div class="empty-placeholder"><i class="pi pi-info-circle"></i><p i18n="@@reports.purchases.aucune.retenue.fournisseur.sur.cette.periode.d024c0d1">Aucune retenue fournisseur sur cette période</p></div>
      } @else {
        <p-table [value]="supplierWithholdings()" styleClass="p-datatable-sm reports-table" aria-label="Retenues fournisseurs" i18n-aria-label="@@reports.purchases.retenues.fournisseurs.a6b3211f">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.purchases.fournisseur.97d91d89">Fournisseur</th>
              <th class="text-right" i18n="@@reports.purchases.n.factures.58e98580">N° factures</th>
              <th class="text-right" i18n="@@reports.purchases.montant.ht.3df1d6fe">Montant HT</th>
              <th class="text-right" i18n="@@reports.purchases.retenue.88cf18f4">Retenue</th>
              <th class="text-right" i18n="@@reports.purchases.net.servi.bb6a0c49">Net servi</th>
              <th i18n="@@reports.purchases.devise.eb2e42c4">Devise</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.supplierName }}</td>
              <td class="text-right">{{ row.invoiceCount }}</td>
              <td class="text-right amount">{{ row.totalHT | number:'1.3-3' }}</td>
              <td class="text-right amount">{{ row.totalWithholding | number:'1.3-3' }}</td>
              <td class="text-right amount">{{ row.totalNetPaid | number:'1.3-3' }}</td>
              <td>{{ row.currency }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            <tr>
              <td><strong i18n="@@reports.purchases.total.b25928c6">Total</strong></td>
              <td class="text-right"><strong>{{ supplierWithholdingsInvoiceTotal() }}</strong></td>
              <td class="text-right amount"><strong>{{ supplierWithholdingsHtTotal() | number:'1.3-3' }}</strong></td>
              <td class="text-right amount"><strong>{{ supplierWithholdingsTotal() | number:'1.3-3' }}</strong></td>
              <td class="text-right amount"><strong>{{ supplierWithholdingsNetTotal() | number:'1.3-3' }}</strong></td>
              <td></td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="6">
        <div class="tab-content">
    @if (!loading() && reportsData()?.monthlySummary && reportsData()!.monthlySummary.length > 0) {
      <div class="section">
        <div class="section-header">
          <h2 class="section-title" i18n="@@reports.purchases.synthese.mensuelle.bab5b563">Synthèse mensuelle</h2>
          <span class="section-subtitle" i18n="@@reports.purchases.6.derniers.mois.c9a9f41e">6 derniers mois</span>
        </div>
        <p-table 
          [value]="reportsData()!.monthlySummary" 
          styleClass="p-datatable-sm reports-table">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@reports.purchases.mois.0d304bea">Mois</th>
              <th class="text-right" i18n="@@reports.purchases.depenses.fb667434">Dépenses</th>
              <th class="text-right" i18n="@@reports.purchases.factures.da35e4f2">Factures</th>
              <th class="text-right" i18n="@@reports.purchases.payees.1ff22288">Payées</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.monthShort }} {{ row.year }}</td>
              <td class="text-right amount">{{ row.amount | number:'1.3-3' }} {{ reportsData()!.currency }}</td>
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
          <p i18n="@@reports.purchases.aucune.donnee.pour.la.synthese.mensuelle.8d28c95b">Aucune donnée pour la synthèse mensuelle</p>
        </div>
      </div>
    }
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="7">
        <div class="tab-content">
    <div class="section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.purchases.repartition.par.statut.05b7c49b">Répartition par statut</h2>
        <span class="section-subtitle" i18n="@@reports.purchases.repartition.des.factures.fournisseurs.selon.leur.a8a94e4f">Répartition des factures fournisseurs selon leur statut</span>
      </div>
      @if (loading()) {
        <div class="loading-placeholder">
          <i class="pi pi-spin pi-spinner"></i>
          <span i18n="@@reports.purchases.chargement.a209b664">Chargement...</span>
        </div>
      } @else if (!reportsData()?.statusBreakdown?.length) {
        <div class="empty-placeholder">
          <i class="pi pi-info-circle"></i>
          <p i18n="@@reports.purchases.aucune.donnee.disponible.78c36aa1">Aucune donnée disponible</p>
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
              <div class="status-amount">{{ status.totalAmount | number:'1.3-3' }} {{ status.currency }}</div>
            </div>
          }
        </div>
      }
    </div>
        </div>
      </p-tabpanel>
      <p-tabpanel [value]="8">
        <div class="tab-content">
    <div class="section crosstab-section">
      <div class="section-header">
        <h2 class="section-title" i18n="@@reports.purchases.depenses.par.mois.annee.a1932f50">Dépenses par mois / Année </h2>
        <span class="section-subtitle" i18n="@@reports.purchases.depenses.par.mois.et.annee.5.dernieres.annees.fa.619a238f">Dépenses par mois et année - 5 dernières années (factures payées)</span>
      </div>
      @if (crossTabLoading()) {
        <div class="loading-placeholder">
          <i class="pi pi-spin pi-spinner"></i>
          <span i18n="@@reports.purchases.chargement.a209b664">Chargement...</span>
        </div>
      } @else if (!crossTabData()) {
        <div class="empty-placeholder">
          <i class="pi pi-info-circle"></i>
          <p i18n="@@reports.purchases.aucune.donnee.disponible.78c36aa1">Aucune donnée disponible</p>
          <p class="empty-hint" i18n="@@reports.purchases.aucune.facture.fournisseur.payee.sur.la.periode.60b9a152">Aucune facture fournisseur payée sur la période.</p>
        </div>
      } @else {
        <div class="crosstab-table-wrapper">
          <table class="crosstab-table" aria-label="Tableau croisé des dépenses par mois et année" i18n-aria-label="@@reports.purchases.tableau.croise.des.depenses.par.mois.et.annee.ae18598c">
            <thead>
              <tr>
                <th scope="col" i18n="@@reports.purchases.annee.1f910d98">Année</th>
                @for (month of crossTabData()!.monthLabels; track month) {
                  <th scope="col" class="text-right">{{ month }}</th>
                }
                <th scope="col" class="text-right total-col" i18n="@@reports.purchases.total.b25928c6">Total</th>
              </tr>
            </thead>
            <tbody>
              @for (year of crossTabData()!.years; track year) {
                <tr>
                  <th scope="row">{{ year }}</th>
                  @for (amt of crossTabData()!.matrix.get(year) ?? []; track $index) {
                    <td class="text-right amount">{{ amt | number:'1.3-3' }}</td>
                  }
                  <td class="text-right amount total-cell">{{ (crossTabData()!.rowTotals.get(year) ?? 0) | number:'1.3-3' }} {{ crossTabData()!.currency }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr class="totals-row">
                <th scope="row" i18n="@@reports.purchases.total.b25928c6">Total</th>
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
            <h1 class="print-header__title" i18n="@@reports.purchases.rapport.achats.32ba4625">RAPPORT ACHATS</h1>
            <p class="print-header__subtitle">{{ activeTabName }}</p>
            <p class="print-header__period"><ng-container i18n="@@reports.purchases.periode.9a1e2cab">Période : {{ periodOptions[selectedPeriodIndex].label || 'Tout' }}
              </ng-container>@if (periodDateRangeLabel()) {
                <span> — {{ periodDateRangeLabel() }}</span>
              }
            </p>
          </div>
          <div class="print-header__right">
            <p class="print-header__app" i18n="@@reports.purchases.instafact.ff6221f4">InstaFact</p>
            <p class="print-header__date" i18n="@@reports.purchases.genere.le.2948908d">Généré le {{ printDate }}</p>
          </div>
        </div>
      </div>

      <!-- KPI Summary -->
      @if (reportsData()) {
        <div class="print-kpi-bar">
          <div class="print-kpi-item">
            <span class="print-kpi-item__label" i18n="@@reports.purchases.depenses.totales.7f280e4e">Dépenses totales</span>
            <span class="print-kpi-item__value">{{ reportsData()!.totalExpenses }}</span>
          </div>
          <div class="print-kpi-item">
            <span class="print-kpi-item__label" i18n="@@reports.purchases.factures.da35e4f2">Factures</span>
            <span class="print-kpi-item__value">{{ reportsData()!.totalInvoices }}</span>
          </div>
          <div class="print-kpi-item">
            <span class="print-kpi-item__label" i18n="@@reports.purchases.taux.paiement.c676e2b2">Taux paiement</span>
            <span class="print-kpi-item__value">{{ reportsData()!.paymentRate }}</span>
          </div>
          <div class="print-kpi-item">
            <span class="print-kpi-item__label" i18n="@@reports.purchases.a.payer.4999346b">À payer</span>
            <span class="print-kpi-item__value">{{ reportsData()!.amountToPay }}</span>
          </div>
        </div>
      }

      <!-- Tab 0: Expenses & top suppliers -->
      @if (activeTabIndex === 0 && reportsData()) {
        @if (reportsData()!.expenseChartData.length) {
          <h4 class="print-section-title" i18n="@@reports.purchases.evolution.des.depenses.55b93cad">Évolution des dépenses</h4>
          <table class="print-table">
            <thead><tr><th i18n="@@reports.purchases.periode.de2110b7">Période</th><th class="text-right" i18n="@@reports.purchases.depenses.fb667434">Dépenses</th><th class="text-right" i18n="@@reports.purchases.factures.da35e4f2">Factures</th></tr></thead>
            <tbody>
              @for (item of reportsData()!.expenseChartData; track item.label) {
                <tr>
                  <td>{{ item.label }}</td>
                  <td class="text-right print-amount">{{ item.amount | number:'1.3-3' }} {{ reportsData()!.currency }}</td>
                  <td class="text-right">{{ item.invoiceCount }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
        @if (reportsData()!.topSuppliers.length) {
          <h4 class="print-section-title" i18n="@@reports.purchases.principaux.fournisseurs.top.10.b1a7f036">Principaux fournisseurs (Top 10)</h4>
          <table class="print-table">
            <thead><tr><th i18n="@@reports.purchases.fournisseur.97d91d89">Fournisseur</th><th class="text-right" i18n="@@reports.purchases.factures.da35e4f2">Factures</th><th class="text-right" i18n="@@reports.purchases.montant.total.dd001537">Montant total</th></tr></thead>
            <tbody>
              @for (supplier of reportsData()!.topSuppliers; track supplier.supplierName) {
                <tr>
                  <td>{{ supplier.supplierName }}</td>
                  <td class="text-right">{{ supplier.invoiceCount }}</td>
                  <td class="text-right print-amount">{{ supplier.totalAmount | number:'1.3-3' }} {{ supplier.currency }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      }

      <!-- Tab 1: Transactions fournisseurs -->
      @if (activeTabIndex === 1 && supplierTransactions().length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.purchases.date.eb9a4bc1">Date</th><th i18n="@@reports.purchases.type.3deb7456">Type</th><th i18n="@@reports.purchases.fournisseur.97d91d89">Fournisseur</th><th i18n="@@reports.purchases.reference.f8130bb0">Référence</th><th class="text-right" i18n="@@reports.purchases.montant.4adcd9fc">Montant</th></tr></thead>
          <tbody>
            @for (row of supplierTransactions(); track row.reference) {
              <tr>
                <td>{{ row.date | date:'dd/MM/yyyy' }}</td>
                <td>{{ row.transactionType }}</td>
                <td>{{ row.supplierName }}</td>
                <td>{{ row.reference }}</td>
                <td class="text-right print-amount">{{ row.amount | number:'1.3-3' }} {{ row.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      <!-- Tab 2: Détails achats par ligne -->
      @if (activeTabIndex === 2 && purchasesByLine().length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.purchases.produit.ff673dc2">Produit</th><th i18n="@@reports.purchases.code.adac6937">Code</th><th i18n="@@reports.purchases.fournisseur.97d91d89">Fournisseur</th><th class="text-right" i18n="@@reports.purchases.quantite.09a38fda">Quantité</th><th class="text-right" i18n="@@reports.purchases.montant.ttc.a742433a">Montant TTC</th><th class="text-right" i18n="@@reports.purchases.tva.fb62cb5d">TVA</th></tr></thead>
          <tbody>
            @for (row of purchasesByLine(); track row.productCode) {
              <tr>
                <td>{{ row.productName }}</td>
                <td>{{ row.productCode }}</td>
                <td>{{ row.supplierName }}</td>
                <td class="text-right">{{ row.quantity | number:'1.3-3' }}</td>
                <td class="text-right print-amount">{{ row.amountTTC | number:'1.3-3' }} {{ row.currency }}</td>
                <td class="text-right print-amount">{{ row.vatAmount | number:'1.3-3' }} {{ row.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      <!-- Tab 3: TVA achats -->
      @if (activeTabIndex === 3 && purchasesVat().length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.purchases.taux.tva.c0830fcc">Taux TVA</th><th class="text-right" i18n="@@reports.purchases.base.taxable.449d603a">Base taxable</th><th class="text-right" i18n="@@reports.purchases.montant.tva.f0c1b7cc">Montant TVA</th></tr></thead>
          <tbody>
            @for (row of purchasesVat(); track row.vatRateDisplay) {
              <tr>
                <td>{{ row.vatRateDisplay | backendLabel }}</td>
                <td class="text-right print-amount">{{ row.totalTaxableAmount | number:'1.3-3' }} {{ row.currency }}</td>
                <td class="text-right print-amount">{{ row.totalVatAmount | number:'1.3-3' }} {{ row.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      <!-- Tab 4: Soldes fournisseur -->
      @if (activeTabIndex === 4 && supplierBalances().length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.purchases.fournisseur.97d91d89">Fournisseur</th><th class="text-right" i18n="@@reports.purchases.total.facture.ea06ae9d">Total facturé</th><th class="text-right" i18n="@@reports.purchases.total.paye.57d30be5">Total payé</th><th class="text-right" i18n="@@reports.purchases.solde.e5977cf9">Solde</th></tr></thead>
          <tbody>
            @for (row of supplierBalances(); track row.supplierName) {
              <tr>
                <td>{{ row.supplierName }}</td>
                <td class="text-right print-amount">{{ row.totalInvoiced | number:'1.3-3' }} {{ row.currency }}</td>
                <td class="text-right print-amount">{{ row.totalPaid | number:'1.3-3' }} {{ row.currency }}</td>
                <td class="text-right print-amount" [style.color]="row.balance < 0 ? '#e53e3e' : '#2d3748'">{{ row.balance | number:'1.3-3' }} {{ row.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      <!-- Tab 5: Synthèse mensuelle -->
      @if (activeTabIndex === 5 && supplierWithholdings().length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.purchases.fournisseur.97d91d89">Fournisseur</th><th class="text-right" i18n="@@reports.purchases.factures.da35e4f2">Factures</th><th class="text-right" i18n="@@reports.purchases.ht.64c38cf2">HT</th><th class="text-right" i18n="@@reports.purchases.retenue.88cf18f4">Retenue</th><th class="text-right" i18n="@@reports.purchases.net.9bb81c2e">Net</th></tr></thead>
          <tbody>
            @for (row of supplierWithholdings(); track row.supplierId) {
              <tr>
                <td>{{ row.supplierName }}</td>
                <td class="text-right">{{ row.invoiceCount }}</td>
                <td class="text-right print-amount">{{ row.totalHT | number:'1.3-3' }}</td>
                <td class="text-right print-amount">{{ row.totalWithholding | number:'1.3-3' }}</td>
                <td class="text-right print-amount">{{ row.totalNetPaid | number:'1.3-3' }} {{ row.currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (activeTabIndex === 6 && reportsData()?.monthlySummary?.length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.purchases.mois.0d304bea">Mois</th><th class="text-right" i18n="@@reports.purchases.depenses.fb667434">Dépenses</th><th class="text-right" i18n="@@reports.purchases.factures.da35e4f2">Factures</th><th class="text-right" i18n="@@reports.purchases.payees.1ff22288">Payées</th></tr></thead>
          <tbody>
            @for (row of reportsData()!.monthlySummary; track row.monthShort + row.year) {
              <tr>
                <td>{{ row.monthShort }} {{ row.year }}</td>
                <td class="text-right print-amount">{{ row.amount | number:'1.3-3' }} {{ reportsData()!.currency }}</td>
                <td class="text-right">{{ row.invoiceCount }}</td>
                <td class="text-right">{{ row.paidCount }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      <!-- Tab 6: Répartition par statut -->
      @if (activeTabIndex === 7 && reportsData()?.statusBreakdown?.length) {
        <table class="print-table">
          <thead><tr><th i18n="@@reports.purchases.statut.659499f3">Statut</th><th class="text-right" i18n="@@reports.purchases.nombre.e68491e9">Nombre</th><th class="text-right" i18n="@@reports.purchases.pourcentage.e34218e3">Pourcentage</th><th class="text-right" i18n="@@reports.purchases.montant.4adcd9fc">Montant</th></tr></thead>
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

      <!-- Tab 7: Cross-tab dépenses -->
      @if (activeTabIndex === 8 && crossTabData()) {
        <table class="print-table">
          <thead>
            <tr>
              <th i18n="@@reports.purchases.annee.1f910d98">Année</th>
              @for (month of crossTabData()!.monthLabels; track month) {
                <th class="text-right">{{ month }}</th>
              }
              <th class="text-right" i18n="@@reports.purchases.total.b25928c6">Total</th>
            </tr>
          </thead>
          <tbody>
            @for (year of crossTabData()!.years; track year) {
              <tr>
                <td><strong>{{ year }}</strong></td>
                @for (amt of crossTabData()!.matrix.get(year) ?? []; track $index) {
                  <td class="text-right print-amount">{{ amt | number:'1.3-3' }}</td>
                }
                <td class="text-right print-amount"><strong>{{ (crossTabData()!.rowTotals.get(year) ?? 0) | number:'1.3-3' }} {{ crossTabData()!.currency }}</strong></td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td><strong i18n="@@reports.purchases.total.b25928c6">Total</strong></td>
              @for (col of crossTabData()!.columnTotals; track $index) {
                <td class="text-right print-amount"><strong>{{ col | number:'1.3-3' }}</strong></td>
              }
              <td class="text-right print-amount"><strong>{{ crossTabData()!.grandTotal | number:'1.3-3' }} {{ crossTabData()!.currency }}</strong></td>
            </tr>
          </tfoot>
        </table>
      }

      <!-- Professional Footer -->
      <div class="print-footer">
        <div class="print-footer__content">
          <span class="print-footer__brand" i18n="@@reports.purchases.genere.par.instafact.35c72778">Généré par InstaFact</span>
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

    .filter-group { display: flex; align-items: center; gap: var(--spacing-4); }
    .filter-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); }
    .filter-select {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      background: var(--color-background);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      cursor: pointer;
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

    .summary-icon { color: var(--color-primary-600); font-size: 1.25rem; flex-shrink: 0; }
    .summary-text { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-primary); line-height: 1.5; }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-6);
    }

    .stat-skeleton {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      height: 120px;
      border: 1px solid var(--color-border-subtle);
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

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
    }

    .section-title::before {
      content: '';
      display: inline-block;
      width: 4px;
      height: 24px;
      background: linear-gradient(180deg, #3b82f6, #2563eb);
      border-radius: var(--radius-full);
      margin-inline-end: var(--spacing-2);
      vertical-align: middle;
    }

    .section-subtitle { font-size: var(--font-size-sm); color: var(--color-text-secondary); width: 100%; display: block; }
    .section-link {
      display: inline-block;
      margin-top: var(--spacing-2);
      font-size: var(--font-size-sm);
      color: var(--color-primary-600);
      text-decoration: none;
    }
    .section-link:hover { text-decoration: underline; }

    .chart-placeholder {
      min-height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      border: 2px dashed var(--color-border-subtle);
    }

    .chart-content { text-align: center; color: var(--color-text-secondary); }
    .chart-icon { font-size: 3rem; color: #3b82f6; margin-bottom: var(--spacing-3); }
    .chart-text { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); margin-bottom: var(--spacing-2); color: var(--color-text-primary); }
    .chart-subtext { font-size: var(--font-size-sm); color: var(--color-text-secondary); }

    .chart-container { padding: var(--spacing-4) 0; }
    .chart-bars {
      display: flex;
      align-items: flex-end;
      justify-content: space-around;
      height: 220px;
      gap: var(--spacing-3);
      padding: 0 var(--spacing-2);
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
      border-radius: var(--radius-md) var(--radius-md) 0 0;
      transition: height 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
      cursor: pointer;
    }

    .chart-bar-blue {
      background: linear-gradient(180deg, #60a5fa, #3b82f6);
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
    }

    .chart-bar-group:hover .chart-tooltip { opacity: 1; }
    .chart-label { margin-top: var(--spacing-2); font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); text-transform: uppercase; }

    .loading-placeholder, .empty-placeholder {
      padding: var(--spacing-8);
      text-align: center;
      color: var(--color-text-secondary);
    }

    .empty-hint { font-size: var(--font-size-sm); margin-top: var(--spacing-2); opacity: 0.8; }

    .supplier-name { font-weight: var(--font-weight-medium); color: var(--color-text-primary); }
    .invoice-count { font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .text-right { text-align: end; }
    .amount { font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace; font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .balance-negative { color: var(--color-error-600, #dc2626); }

    :host ::ng-deep .reports-table {
      .p-datatable-thead > tr > th {
        background: var(--color-neutral-50);
        color: var(--color-text-secondary);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-sm);
        text-transform: uppercase;
        padding: var(--spacing-4) var(--spacing-3);
        border-bottom: 2px solid var(--color-border-default);
      }
      .p-datatable-tbody > tr > td { padding: var(--spacing-4) var(--spacing-3); border-bottom: 1px solid var(--color-border-subtle); font-size: var(--font-size-sm); vertical-align: middle; }
      .p-datatable-tbody > tr:hover { background: var(--color-primary-50); }
    }

    .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--spacing-4); }
    .status-card {
      padding: var(--spacing-4);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle);
    }
    .status-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-3); }
    .status-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); text-transform: uppercase; }
    .status-count { font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); color: var(--color-text-primary); }
    .status-bar { height: 8px; background: var(--color-neutral-200); border-radius: var(--radius-full); overflow: hidden; margin-bottom: var(--spacing-3); }
    .status-fill { height: 100%; transition: width var(--transition-normal); border-radius: var(--radius-full); }
    .status-amount { font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace; font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }

    .crosstab-section { margin-top: var(--spacing-6); }
    .crosstab-table-wrapper { overflow-x: auto; border-radius: var(--radius-lg); border: 1px solid var(--color-border-subtle); }
    .crosstab-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-base); }
    .crosstab-table th, .crosstab-table td { padding: var(--spacing-3) var(--spacing-4); border-bottom: 1px solid var(--color-border-subtle); }
    .crosstab-table thead th { background: var(--color-neutral-50); color: var(--color-text-secondary); font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm); text-transform: uppercase; }
    .crosstab-table tbody tr:hover { background: var(--color-primary-50); }
    .crosstab-table tfoot .totals-row { background: var(--color-primary-50); border-top: 2px solid #3b82f6; }
    .crosstab-table tfoot th, .crosstab-table tfoot td { font-weight: var(--font-weight-bold); color: #1d4ed8; }
    .crosstab-table .total-col, .crosstab-table .total-cell { font-weight: var(--font-weight-semibold); }

    @media (max-width: 1024px) { .reports-grid { grid-template-columns: 1fr; } }
    @media (max-width: 768px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .section { padding: var(--spacing-4); }
      .section-title { font-size: var(--font-size-xl); }
      .section-title::before { display: none; }
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
        background: linear-gradient(90deg, #3b82f6 0%, #2563eb 60%, #e2e8f0 100%);
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
        color: #3b82f6;
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
        color: #3b82f6;
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
        min-width: 100px;
        padding: 10px 12px;
        border: 1.5px solid #e2e8f0;
        border-radius: 8px;
        text-align: center;
        background: #f7fafc;
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

      /* ── Section titles ── */
      .print-section-title {
        font-size: 12pt;
        font-weight: 700;
        margin: 18px 0 10px;
        color: #2d3748;
        padding-bottom: 6px;
        border-bottom: 2px solid #3b82f6;
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
        border-bottom: 2.5px solid #3b82f6;
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

      .print-table tfoot td {
        padding: 9px 12px;
        border-top: 2.5px solid #3b82f6;
        font-weight: 700;
        font-size: 11pt;
        color: #1a202c;
        background: #eff6ff;
      }

      .print-amount {
        font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
        font-weight: 600;
        letter-spacing: -0.3px;
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
        background: linear-gradient(90deg, #3b82f6 0%, #2563eb 40%, transparent 100%);
        border-radius: 2px;
      }
    }`]
})
export class PurchasesReportsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  reportsService = inject(PurchasesReportsService);
  reportsApi = inject(ReportsApiService);

  loading = signal(true);
  reportsData = signal<PurchasesReportsData | null>(null);
  crossTabData = signal<ExpenseCrossTabData | null>(null);
  crossTabLoading = signal(true);
  supplierTransactions = signal<SupplierTransactionReportRow[]>([]);
  supplierTransactionsLoading = signal(false);
  purchasesByLine = signal<PurchasesByLineReportRow[]>([]);
  purchasesByLineLoading = signal(false);
  purchasesVat = signal<PurchasesVatReportRow[]>([]);
  purchasesVatLoading = signal(false);
  supplierBalances = signal<SupplierBalanceReportRow[]>([]);
  supplierBalancesLoading = signal(false);
  supplierBalanceRows = computed<PartyBalanceRow[]>(() => mapSupplierBalanceRows(this.supplierBalances()));
  supplierWithholdings = signal<SupplierWithholdingReportRow[]>([]);
  supplierWithholdingsLoading = signal(false);
  selectedPeriod: ReportPeriod = 'month';
  activeTabIndex = 0;
  private maxAmount = 0;

  periodOptions: PeriodOption[] = [
    { label: $localize`:@@reports.purchases-reports.ts.cette.semaine.af7dc0a9:Cette semaine`, value: 'week' },
    { label: $localize`:@@reports.purchases-reports.ts.ce.mois.db74c560:Ce mois`, value: 'month' },
    { label: $localize`:@@reports.purchases-reports.ts.ce.trimestre.4d9d129d:Ce trimestre`, value: 'quarter' },
    { label: $localize`:@@reports.purchases-reports.ts.cette.annee.052507a0:Cette année`, value: 'year' },
    { label: $localize`:@@reports.purchases-reports.ts.tout.6b0b09b8:Tout`, value: 'all' }
  ];

  ngOnInit(): void {
    this.applyTabFromQuery(this.route.snapshot.queryParamMap.get('tab'));
    this.route.queryParamMap.subscribe(params => this.applyTabFromQuery(params.get('tab')));
    this.loadReportsData();
    this.loadCrossTabData();
    this.loadSupplierTransactions();
    this.loadPurchasesByLine();
    this.loadPurchasesVat();
    this.loadSupplierBalances();
    this.loadSupplierWithholdings();
  }

  supplierWithholdingsTotal(): number {
    return this.supplierWithholdings().reduce((sum, r) => sum + r.totalWithholding, 0);
  }

  supplierWithholdingsHtTotal(): number {
    return this.supplierWithholdings().reduce((sum, r) => sum + r.totalHT, 0);
  }

  supplierWithholdingsNetTotal(): number {
    return this.supplierWithholdings().reduce((sum, r) => sum + r.totalNetPaid, 0);
  }

  supplierWithholdingsInvoiceTotal(): number {
    return this.supplierWithholdings().reduce((sum, r) => sum + r.invoiceCount, 0);
  }

  private applyTabFromQuery(tab: string | null): void {
    const tabIndexMap: Record<string, number> = {
      'soldes-fournisseur': 4,
      'retenues-fournisseurs': 5
    };
    if (tab && tabIndexMap[tab] !== undefined) {
      this.activeTabIndex = tabIndexMap[tab];
    }
  }

  onPeriodChange(): void {
    this.loadReportsData();
    this.loadSupplierTransactions();
    this.loadPurchasesByLine();
    this.loadPurchasesVat();
    this.loadSupplierWithholdings();
  }

  onTabChange(index: string | number): void {
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

  private loadSupplierTransactions(): void {
    this.supplierTransactionsLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getSupplierTransactions(fromDate, toDate).subscribe({
      next: (res) => {
        this.supplierTransactions.set(res.success && res.data ? res.data : []);
        this.supplierTransactionsLoading.set(false);
      },
      error: () => { this.supplierTransactions.set([]); this.supplierTransactionsLoading.set(false); }
    });
  }

  private loadPurchasesByLine(): void {
    this.purchasesByLineLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getPurchasesByLine(fromDate, toDate).subscribe({
      next: (res) => {
        this.purchasesByLine.set(res.success && res.data ? res.data : []);
        this.purchasesByLineLoading.set(false);
      },
      error: () => { this.purchasesByLine.set([]); this.purchasesByLineLoading.set(false); }
    });
  }

  private loadPurchasesVat(): void {
    this.purchasesVatLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getPurchasesVat(fromDate, toDate).subscribe({
      next: (res) => {
        this.purchasesVat.set(res.success && res.data ? res.data : []);
        this.purchasesVatLoading.set(false);
      },
      error: () => { this.purchasesVat.set([]); this.purchasesVatLoading.set(false); }
    });
  }

  private loadSupplierBalances(): void {
    this.supplierBalancesLoading.set(true);
    this.reportsApi.getSupplierBalances().subscribe({
      next: (res) => {
        this.supplierBalances.set(res.success && res.data ? res.data : []);
        this.supplierBalancesLoading.set(false);
      },
      error: () => { this.supplierBalances.set([]); this.supplierBalancesLoading.set(false); }
    });
  }

  private loadSupplierWithholdings(): void {
    this.supplierWithholdingsLoading.set(true);
    const { fromDate, toDate } = this.getPeriodDates();
    this.reportsApi.getSupplierWithholdings(fromDate, toDate).subscribe({
      next: (res) => {
        this.supplierWithholdings.set(res.success && res.data ? res.data : []);
        this.supplierWithholdingsLoading.set(false);
      },
      error: () => { this.supplierWithholdings.set([]); this.supplierWithholdingsLoading.set(false); }
    });
  }

  loadReportsData(): void {
    this.loading.set(true);
    this.reportsService.loadReportsData(this.selectedPeriod).subscribe({
      next: (data) => {
        this.reportsData.set(data);
        const amounts = data.expenseChartData.map(d => d.amount);
        this.maxAmount = Math.max(...amounts, 1);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  loadCrossTabData(): void {
    this.crossTabLoading.set(true);
    this.reportsService.loadExpenseCrossTabData().subscribe({
      next: (data) => {
        this.crossTabData.set(data);
        this.crossTabLoading.set(false);
      },
      error: () => {
        this.crossTabData.set(null);
        this.crossTabLoading.set(false);
      }
    });
  }

  getBarHeight(amount: number): number {
    if (this.maxAmount === 0) return 4;
    const percent = (amount / this.maxAmount) * 100;
    return Math.max(percent, 4);
  }

  formatCurrency(amount: number): string {
    const formatted = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(amount);
    return `${formatted} TND`;
  }

  onExport(): void {
    if (this.activeTabIndex === 5) {
      this.exportSupplierWithholdingsTab();
      return;
    }

    const data = this.reportsData();
    const crossTab = this.crossTabData();
    if (!data) return;

    const rows: string[][] = [];
    rows.push(['Rapports Achats InstaFact', '']);
    rows.push(['Période', this.periodOptions.find(p => p.value === this.selectedPeriod)?.label || this.selectedPeriod]);
    rows.push(['']);
    rows.push(['Indicateurs', 'Valeur']);
    rows.push(['Dépenses totales', data.totalExpenses]);
    rows.push(['Factures fournisseurs', data.totalInvoices.toString()]);
    rows.push(['Factures payées', data.paidInvoices.toString()]);
    rows.push(['Taux de paiement', data.paymentRate]);
    rows.push(['Montant à payer', data.amountToPay]);
    rows.push(['']);
    rows.push(['Principaux fournisseurs', '', '']);
    rows.push(['Fournisseur', 'Factures', 'Montant total']);
    data.topSuppliers.forEach(s => {
      rows.push([s.supplierName, s.invoiceCount.toString(), `${s.totalAmount.toFixed(3)} ${s.currency}`]);
    });

    if (crossTab && crossTab.years.length > 0) {
      rows.push(['']);
      rows.push(['Tableau croisé dépenses par mois et année', '']);
      const headerRow = ['Année', ...REPORT_EXPORT_MONTHS_SHORT_FR, 'Total'];
      rows.push(headerRow);
      crossTab.years.forEach(year => {
        const monthAmts = crossTab.matrix.get(year) ?? [];
        const rowTotal = crossTab.rowTotals.get(year) ?? 0;
        rows.push([year.toString(), ...monthAmts.map(a => a.toFixed(3)), `${rowTotal.toFixed(3)} ${crossTab.currency}`]);
      });
      rows.push(['Total', ...crossTab.columnTotals.map(c => c.toFixed(3)), `${crossTab.grandTotal.toFixed(3)} ${crossTab.currency}`]);
    }

    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapports-achats-${formatLocalDate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private exportSupplierWithholdingsTab(): void {
    const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = this.supplierWithholdings();
    const headers = ['Fournisseur', 'N° factures', 'Montant HT', 'Retenue', 'Net servi', 'Devise'];
    const csv = [
      headers.map(escape).join(';'),
      ...rows.map(r =>
        [r.supplierName, r.invoiceCount, r.totalHT.toFixed(3), r.totalWithholding.toFixed(3), r.totalNetPaid.toFixed(3), r.currency].map(escape).join(';')
      )
    ].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapports-achats-retenues-fournisseurs-${formatLocalDate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private readonly tabNames = [
    $localize`:@@reports.purchases-reports.ts.depenses.et.fournisseurs.8acc873e:Dépenses et fournisseurs`, $localize`:@@reports.purchases-reports.ts.transactions.fournisseurs.83a34e96:Transactions fournisseurs`,
    $localize`:@@reports.purchases-reports.ts.details.achats.par.ligne.20c0118b:Détails achats par ligne`, $localize`:@@reports.purchases-reports.ts.tva.achats.48719283:TVA achats`,
    $localize`:@@reports.purchases-reports.ts.soldes.fournisseur.18c92c31:Soldes fournisseur`, $localize`:@@reports.purchases-reports.ts.retenues.fournisseurs.a6b3211f:Retenues fournisseurs`, $localize`:@@reports.purchases-reports.ts.synthese.mensuelle.bab5b563:Synthèse mensuelle`,
    $localize`:@@reports.purchases-reports.ts.repartition.par.statut.05b7c49b:Répartition par statut`, $localize`:@@reports.purchases-reports.ts.depenses.par.mois.annee.a1932f50:Dépenses par mois / Année`
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

  periodDateRangeLabel(): string {
    const { fromDate, toDate } = this.getPeriodDates();
    const from = new Date(fromDate + 'T12:00:00');
    const to = new Date(toDate + 'T12:00:00');
    const fromStr = from.toLocaleDateString(erpDateLocale('fr-FR'), { day: 'numeric', month: 'long', year: 'numeric' });
    const toStr = to.toLocaleDateString(erpDateLocale('fr-FR'), { day: 'numeric', month: 'long', year: 'numeric' });
    if (fromDate === toDate) return fromStr;
    return `${fromStr} – ${toStr}`;
  }

  onPrint(): void {
    globalThis.print();
  }
}
