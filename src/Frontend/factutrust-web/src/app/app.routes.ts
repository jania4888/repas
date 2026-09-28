/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { VARIANT_AXES_PATH } from './features/settings/variant-axes/variant-axes.paths';
import { warehouseSelectedGuard } from './core/guards/warehouse-selected.guard';
import { moduleGuard, posModuleGuard } from './core/guards/module.guard';
import { firmNativeRedirectGuard } from './core/guards/firm-native-redirect.guard';
import { delegatedReadonlyGuard } from './core/guards/delegated-readonly.guard';
import { delegatedFirmNavGuard } from './core/guards/delegated-firm-nav.guard';
import { companyAccountingNavGuard } from './core/guards/company-accounting-nav.guard';
import { documentationAccessGuard } from './core/guards/documentation-access.guard';
import { staffShellGuard } from './core/guards/staff-shell.guard';
import { companyAssistanceGuard } from './core/guards/company-assistance.guard';
import { CORE_TITLES } from './core/i18n/core-localize';

export const routes: Routes = [
  {
    path: '',
    loadChildren: () => import('./features/home/home.routes').then(m => m.HOME_ROUTES)
  },
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES)
  },
  {
    path: 'portal',
    loadChildren: () => import('./features/portal/portal.routes').then(m => m.PORTAL_ROUTES)
  },
  {
    path: 'legal/terms',
    loadComponent: () => import('./features/legal/terms/terms.component').then(m => m.TermsComponent),
    title: CORE_TITLES.terms
  },
  {
    path: 'visite-virtuelle',
    loadChildren: () =>
      import('./features/virtual-street/virtual-street.routes').then(m => m.VIRTUAL_STREET_ROUTES),
    title: $localize`:@@app.routes.title.InstaFact_Visite_virtu:InstaFact — Visite virtuelle 3D`
  },
  {
    path: 'pos',
    loadComponent: () => import('./features/pos/pos-shell.component').then(m => m.PosShellComponent),
    loadChildren: () => import('./features/pos/pos.routes').then(m => m.POS_ROUTES),
    canActivate: [authGuard, staffShellGuard, warehouseSelectedGuard, posModuleGuard],
    data: { fullWidth: true, hideLayout: true }
  },
  {
    path: '',
    loadComponent: () => import('./core/layout/main-layout/main-layout.component').then(m => m.MainLayoutComponent),
    canActivate: [authGuard, staffShellGuard, warehouseSelectedGuard, firmNativeRedirectGuard, delegatedFirmNavGuard, companyAccountingNavGuard, delegatedReadonlyGuard, moduleGuard],
    children: [
      {
        path: 'access-denied',
        loadComponent: () =>
          import('./shared/components/access-denied/access-denied.component').then(m => m.AccessDeniedComponent),
        title: CORE_TITLES.accessDenied
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
        title: CORE_TITLES.dashboard
      },
      {
        path: 'invoices',
        loadChildren: () => import('./features/invoices/invoices.routes').then(m => m.INVOICES_ROUTES)
      },
      {
        path: 'quotes',
        loadChildren: () => import('./features/quotes/quotes.routes').then(m => m.QUOTES_ROUTES)
      },
      {
        path: 'delivery-notes',
        loadChildren: () => import('./features/delivery-notes/delivery-notes.routes').then(m => m.DELIVERY_NOTES_ROUTES)
      },
      {
        path: 'return-notes',
        loadChildren: () => import('./features/sales-return-notes/sales-return-notes.routes').then(m => m.SALES_RETURN_NOTES_ROUTES)
      },
      {
        path: 'sales-orders',
        loadChildren: () => import('./features/sales-orders/sales-orders.routes').then(m => m.SALES_ORDERS_ROUTES)
      },
      {
        path: 'pricing',
        loadChildren: () => import('./features/pricing/pricing.routes').then(m => m.PRICING_ROUTES)
      },
      {
        path: 'clients',
        loadChildren: () => import('./features/clients/clients.routes').then(m => m.CLIENTS_ROUTES)
      },
      {
        path: 'products',
        loadChildren: () => import('./features/products/products.routes').then(m => m.PRODUCTS_ROUTES)
      },
      {
        path: 'product-categories',
        loadChildren: () => import('./features/product-categories/product-categories.routes').then(m => m.PRODUCT_CATEGORIES_ROUTES)
      },
      {
        path: 'product-attributes',
        children: [
          { path: '', pathMatch: 'full', redirectTo: VARIANT_AXES_PATH },
          { path: 'new', redirectTo: `${VARIANT_AXES_PATH}/new` },
          { path: ':id/edit', redirectTo: `${VARIANT_AXES_PATH}/:id/edit` }
        ]
      },
      {
        path: 'reports',
        loadChildren: () => import('./features/reports/reports.routes').then(m => m.REPORTS_ROUTES)
      },
      {
        path: 'payments',
        loadChildren: () => import('./features/payments/payments.routes').then(m => m.PAYMENTS_ROUTES)
      },
      {
        path: 'stock',
        loadChildren: () => import('./features/stock/stock.routes').then(m => m.STOCK_ROUTES)
      },
      {
        path: 'inventory',
        loadChildren: () => import('./features/inventory/inventory.routes').then(m => m.INVENTORY_ROUTES)
      },
      {
        path: 'settings',
        loadChildren: () => import('./features/settings/settings.routes').then(m => m.SETTINGS_ROUTES)
      },
      {
        path: 'suppliers',
        loadChildren: () => import('./features/suppliers/suppliers.routes').then(m => m.SUPPLIERS_ROUTES)
      },
      {
        path: 'purchase-orders',
        loadChildren: () => import('./features/purchase-orders/purchase-orders.routes').then(m => m.PURCHASE_ORDERS_ROUTES)
      },
      {
        path: 'purchase-receipts',
        loadChildren: () => import('./features/purchase-receipts/purchase-receipts.routes').then(m => m.PURCHASE_RECEIPTS_ROUTES)
      },
      {
        path: 'supplier-invoices',
        loadChildren: () => import('./features/supplier-invoices/supplier-invoices.routes').then(m => m.SUPPLIER_INVOICES_ROUTES)
      },
      {
        path: 'transfers',
        loadChildren: () => import('./features/transfers/transfers.routes').then(m => m.TRANSFERS_ROUTES)
      },
      {
        path: 'documentation',
        canActivate: [documentationAccessGuard],
        loadChildren: () => import('./features/documentation/documentation.routes').then(m => m.DOCUMENTATION_ROUTES)
      },
      {
        path: 'withholding-tax',
        loadChildren: () => import('./features/withholding-tax/withholding-tax.routes').then(m => m.WITHHOLDING_TAX_ROUTES)
      },
      {
        path: 'accounting',
        loadChildren: () => import('./features/accounting/accounting.routes').then(m => m.ACCOUNTING_ROUTES)
      },
      {
        path: 'crm',
        loadChildren: () => import('./features/crm/crm.routes').then(m => m.CRM_ROUTES)
      },
      {
        path: 'audit',
        loadChildren: () => import('./features/audit/audit.routes').then(m => m.AUDIT_ROUTES)
      },
      {
        path: 'ai-assistant',
        loadChildren: () => import('./features/ai-assistant/ai-assistant.routes').then(m => m.AI_ASSISTANT_ROUTES)
      },
      {
        path: 'forecasting',
        loadChildren: () => import('./features/forecasting/forecasting.routes').then(m => m.FORECASTING_ROUTES)
      },
      {
        path: 'treasury',
        loadChildren: () => import('./features/treasury/treasury.routes').then(m => m.TREASURY_ROUTES)
      },
      {
        path: 'exchanges',
        loadChildren: () =>
          import('./features/exchanges/exchanges.routes').then(m => m.EXCHANGES_ROUTES)
      },
      {
        path: 'assistance',
        canActivate: [companyAssistanceGuard],
        loadComponent: () =>
          import('./features/assistance/assistance-page.component').then(m => m.AssistancePageComponent),
        title: $localize`:@@app.routes.title.Assistance_InstaFact:Assistance - InstaFact`
      },
      {
        path: 'firm',
        loadChildren: () => import('./features/firm/firm.routes').then(m => m.FIRM_ROUTES)
      },
      {
        path: 'studio',
        loadChildren: () => import('./features/studio/studio.routes').then(m => m.STUDIO_ROUTES)
      },
      {
        path: 'payroll',
        loadChildren: () => import('./features/payroll/payroll.routes').then(m => m.PAYROLL_ROUTES)
      },
      {
        path: 'projects',
        loadChildren: () => import('./features/projects/projects.routes').then(m => m.PROJECTS_ROUTES)
      },
      {
        path: 'timesheets',
        loadChildren: () => import('./features/timesheets/timesheets.routes').then(m => m.TIMESHEETS_ROUTES)
      },
      {
        path: 'recurring-contracts',
        loadChildren: () =>
          import('./features/recurring-contracts/recurring-contracts.routes').then(m => m.RECURRING_CONTRACTS_ROUTES)
      }
    ]
  },
  {
    path: '**',
    loadComponent: () => import('./shared/components/not-found/not-found.component').then(m => m.NotFoundComponent)
  }
];
