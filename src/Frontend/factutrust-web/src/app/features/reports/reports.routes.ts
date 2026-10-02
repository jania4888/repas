/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';

export const REPORTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./reports-hub/reports-hub.component').then(m => m.ReportsHubComponent),
    title: $localize`:@@reports.routes.title.Rapports_InstaFact:Rapports - InstaFact`
  },
  {
    path: 'analytics',
    loadComponent: () => import('./analytics/analytics-hub.component').then(m => m.AnalyticsHubComponent),
    title: $localize`:@@reports.routes.title._tats_Analytiques_Inst:États Analytiques - InstaFact`,
    children: [
      {
        path: '',
        redirectTo: 'revenue',
        pathMatch: 'full'
      },
      {
        path: 'revenue',
        loadComponent: () => import('./analytics/revenue/revenue-analytics.component').then(m => m.RevenueAnalyticsComponent),
        title: $localize`:@@reports.routes.title.chiffreAffaires:Chiffre d'affaires - InstaFact`
      },
      {
        path: 'sales',
        loadComponent: () => import('./analytics/sales/sales-analytics.component').then(m => m.SalesAnalyticsComponent),
        title: $localize`:@@reports.routes.title.Analyse_des_ventes_Ins:Analyse des ventes - InstaFact`
      },
      {
        path: 'clients',
        loadComponent: () => import('./analytics/clients/clients-analytics.component').then(m => m.ClientsAnalyticsComponent),
        title: $localize`:@@reports.routes.title.Analyse_clients_InstaF:Analyse clients - InstaFact`
      }
    ]
  },
  {
    path: 'sales',
    loadComponent: () => import('./sales/sales-reports.component').then(m => m.SalesReportsComponent),
    title: $localize`:@@reports.routes.title.Rapports_Ventes_InstaF:Rapports Ventes - InstaFact`
  },
  {
    path: 'purchases-analytics',
    loadComponent: () => import('./purchases-analytics/purchases-analytics-hub.component').then(m => m.PurchasesAnalyticsHubComponent),
    title: $localize`:@@reports.routes.title._tats_Analytiques_Achats:États Analytiques Achats - InstaFact`,
    children: [
      {
        path: '',
        redirectTo: 'expenses',
        pathMatch: 'full'
      },
      {
        path: 'expenses',
        loadComponent: () => import('./purchases-analytics/expenses/expenses-analytics.component').then(m => m.ExpensesAnalyticsComponent),
        title: $localize`:@@reports.routes.title.D_penses_InstaFact:Dépenses - InstaFact`
      },
      {
        path: 'suppliers',
        loadComponent: () => import('./purchases-analytics/suppliers/suppliers-analytics.component').then(m => m.SuppliersAnalyticsComponent),
        title: $localize`:@@reports.routes.title.Analyse_fournisseurs_I:Analyse fournisseurs - InstaFact`
      },
      {
        path: 'orders',
        loadComponent: () => import('./purchases-analytics/orders/orders-analytics.component').then(m => m.OrdersAnalyticsComponent),
        title: $localize`:@@reports.routes.title.Analyse_des_commandes_:Analyse des commandes - InstaFact`
      }
    ]
  },
  {
    path: 'purchases',
    loadComponent: () => import('./purchases/purchases-reports.component').then(m => m.PurchasesReportsComponent),
    title: $localize`:@@reports.routes.title.Rapports_Achats_InstaF:Rapports Achats - InstaFact`
  },
  {
    path: 'stock',
    loadComponent: () => import('./stock/stock-reports.component').then(m => m.StockReportsComponent),
    title: $localize`:@@reports.routes.title.Rapports_Stock_InstaFa:Rapports Stock - InstaFact`
  },
  {
    path: 'stock-status',
    loadComponent: () => import('./stock-status/stock-status-report.component').then(m => m.StockStatusReportComponent),
    title: $localize`:@@reports.routes.title.Etat_de_stock_InstaFa:État de stock - InstaFact`
  },
  {
    path: 'fiches',
    loadComponent: () => import('./fiches/fiches-reports.component').then(m => m.FichesReportsComponent),
    title: $localize`:@@reports.routes.title.Rapports_Fiches_InstaF:Rapports Fiches - InstaFact`
  },
  {
    path: 'payments',
    loadComponent: () => import('./payments/payments-reports.component').then(m => m.PaymentsReportsComponent),
    title: $localize`:@@reports.routes.title.Rapports_Paiements_Ins:Rapports Paiements - InstaFact`
  },
  {
    path: 'sales-by-line',
    loadComponent: () => import('./sales-by-line/sales-by-line-reports.component').then(m => m.SalesByLineReportsComponent),
    title: $localize`:@@reports.routes.title.D_tails_ventes_par_ligne:Détails ventes par ligne - InstaFact`
  },
  {
    path: 'sales-journal',
    loadComponent: () => import('./sales-journal/sales-journal-reports.component').then(m => m.SalesJournalReportsComponent),
    title: $localize`:@@reports.routes.title.Journal_de_ventes_Insta:Journal de ventes - InstaFact`
  },
  {
    path: 'purchases-journal',
    loadComponent: () => import('./purchases-journal/purchases-journal-reports.component').then(m => m.PurchasesJournalReportsComponent),
    title: $localize`:@@reports.routes.title.Journal_d_achats_Insta:Journal d'achats - InstaFact`
  },
  {
    path: 'profit',
    loadComponent: () => import('./profit/profit-reports.component').then(m => m.ProfitReportsComponent),
    title: $localize`:@@reports.routes.title.Rapport_B_n_fices_Inst:Rapport Bénéfices - InstaFact`
  },
  {
    path: 'client-balances',
    loadComponent: () => import('./client-balances/client-balances.component').then(m => m.ClientBalancesComponent),
    title: $localize`:@@reports.routes.title.Solde_par_client_Insta:Solde par client - InstaFact`
  },
  {
    path: 'supplier-balances',
    loadComponent: () => import('./supplier-balances/supplier-balances.component').then(m => m.SupplierBalancesComponent),
    title: $localize`:@@reports.routes.title.Solde_par_fournisseur_:Solde par fournisseur - InstaFact`
  },
  {
    path: 'product-sales-analytics',
    loadComponent: () => import('./product-sales-analytics/product-sales-analytics.component').then(m => m.ProductSalesAnalyticsComponent),
    title: $localize`:@@reports.routes.title.Rapports_d_cisionnels_ve:Rapports décisionnels ventes produits - InstaFact`
  }
];
