import { AppModule } from '@core/models/app-module';

/**
 * First path segment (after /) → modules that must all be enabled (AND).
 * Empty array = no module check (any authenticated user with warehouse context).
 */
export const MODULES_REQUIRED_BY_FIRST_SEGMENT: Record<string, AppModule[]> = {
  dashboard: [],
  'ai-assistant': [AppModule.AI],
  invoices: [AppModule.Sales],
  quotes: [AppModule.Sales],
  'delivery-notes': [AppModule.Sales],
  'return-notes': [AppModule.Sales],
  'sales-orders': [AppModule.Sales],
  pricing: [AppModule.Sales],
  clients: [AppModule.Clients],
  products: [AppModule.Products],
  'product-categories': [AppModule.Products],
  reports: [AppModule.Reports],
  payments: [AppModule.Treasury],
  treasury: [AppModule.Treasury],
  forecasting: [AppModule.Forecasting],
  stock: [AppModule.Stock],
  inventory: [AppModule.Stock],
  transfers: [AppModule.Stock],
  settings: [AppModule.Administration],
  suppliers: [AppModule.Purchases],
  'purchase-orders': [AppModule.Purchases],
  'purchase-receipts': [AppModule.Purchases],
  'supplier-invoices': [AppModule.Purchases],
  accounting: [AppModule.Accounting],
  audit: [AppModule.Accounting],
  crm: [AppModule.CRM],
  'withholding-tax': [AppModule.Fiscal],
  studio: [AppModule.Studio],
  payroll: [AppModule.Payroll],
  projects: [AppModule.Projects],
  'recurring-contracts': [AppModule.RecurringContracts]
};

/**
 * When set, user must have every permission (JWT effective) in addition to module checks.
 * Omitted segments: module check only (or none).
 */
export const PERMISSIONS_ALL_REQUIRED_BY_FIRST_SEGMENT: Record<string, string[]> = {
  'ai-assistant': ['ai:chat'],
  quotes: ['quotes:read'],
  'delivery-notes': ['delivery_notes:read'],
  'return-notes': ['return_notes:read'],
  invoices: ['invoices:read'],
  'sales-orders': ['sales_orders:read'],
  pricing: ['pricing:read'],
  clients: ['clients:read'],
  products: ['products:read'],
  'product-categories': ['products:read'],
  stock: ['stock:read'],
  inventory: ['inventory:read'],
  transfers: ['stock_transfers:read'],
  suppliers: ['suppliers:read'],
  'purchase-orders': ['purchase_orders:read'],
  'purchase-receipts': ['purchase_receipts:read'],
  'supplier-invoices': ['supplier_invoices:read'],
  payments: ['payments:read'],
  // Le prévisionnel s'adresse au comptable, qui n'a pas forcément `payments:read` :
  // la garde du segment porte donc sa propre permission.
  treasury: ['treasury_forecast:view'],
  forecasting: ['forecasting:view'],
  reports: ['reports:view'],
  settings: ['settings:read'],
  accounting: ['accounting:read'],
  audit: ['audit:read'],
  crm: ['crm:read'],
  'withholding-tax': ['withholding_tax:read'],
  // Studio (4.5d1, D11 levée) : le segment s'ouvre à tout lecteur `custom_records:read`
  // (fiches `/studio/d/<key>`, « Mes approbations ») ; la granularité concepteur/lecteur
  // reste portée par `permissionGuard` sur chacune des routes Studio.
  studio: ['custom_records:read'],
  payroll: ['payroll:read'],
  projects: ['projects:read'],
  'recurring-contracts': ['recurring_contracts:read']
};

/** POS loads products, warehouses (stock), and creates invoices. */
export const POS_REQUIRED_MODULES: AppModule[] = [
  AppModule.Sales,
  AppModule.Products,
  AppModule.Stock
];

export const POS_REQUIRED_PERMISSIONS_ALL: string[] = [
  'invoices:create',
  'products:read',
  'stock:read'
];
