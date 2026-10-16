/// <reference types="@angular/localize" />
import { PERMISSIONS } from '@core/config/permission-keys';
import { AuthService } from '@core/services/auth.service';

export interface DataExportDatasetOption {
  key: string;
  permission: string;
  label: string;
}

export const DATA_EXPORT_DATASETS: readonly DataExportDatasetOption[] = [
  { key: 'clients', permission: PERMISSIONS.clients.read, label: $localize`:@@dataExport.dataset.clients:Clients` },
  { key: 'products', permission: PERMISSIONS.products.read, label: $localize`:@@dataExport.dataset.products:Produits` },
  { key: 'suppliers', permission: PERMISSIONS.suppliers.read, label: $localize`:@@dataExport.dataset.suppliers:Fournisseurs` },
  { key: 'invoices', permission: PERMISSIONS.invoices.read, label: $localize`:@@dataExport.dataset.invoices:Factures` },
  { key: 'credit-notes', permission: PERMISSIONS.invoices.read, label: $localize`:@@dataExport.dataset.creditNotes:Avoirs` },
  { key: 'supplier-invoices', permission: PERMISSIONS.supplierInvoices.read, label: $localize`:@@dataExport.dataset.supplierInvoices:Factures fournisseurs` },
  { key: 'quotes', permission: PERMISSIONS.quotes.read, label: $localize`:@@dataExport.dataset.quotes:Devis` },
  { key: 'delivery-notes', permission: PERMISSIONS.deliveryNotes.read, label: $localize`:@@dataExport.dataset.deliveryNotes:Bons de livraison` },
  { key: 'purchase-orders', permission: PERMISSIONS.purchaseOrders.read, label: $localize`:@@dataExport.dataset.purchaseOrders:Bons de commande` },
  { key: 'stock-items', permission: PERMISSIONS.stock.read, label: $localize`:@@dataExport.dataset.stockItems:Stock` },
  { key: 'stock-movements', permission: PERMISSIONS.stock.read, label: $localize`:@@dataExport.dataset.stockMovements:Mouvements de stock` }
];

export const DATA_EXPORT_READ_PERMISSIONS: readonly string[] = [
  ...new Set(DATA_EXPORT_DATASETS.map(dataset => dataset.permission))
];

/** Sessions sans permissions explicites conservent l'accès. Sinon, un droit de lecture suffit. */
export function canExportBusinessData(auth: AuthService): boolean {
  const raw = auth.user()?.effectivePermissions;
  if (raw === undefined || raw === null) {
    return true;
  }
  return auth.hasAnyPermission(DATA_EXPORT_READ_PERMISSIONS);
}

export function visibleExportDatasets(auth: AuthService): DataExportDatasetOption[] {
  const raw = auth.user()?.effectivePermissions;
  if (raw === undefined || raw === null) {
    return [...DATA_EXPORT_DATASETS];
  }
  return DATA_EXPORT_DATASETS.filter(dataset => auth.hasPermission(dataset.permission));
}
