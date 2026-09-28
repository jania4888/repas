/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const SUPPLIER_INVOICES_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./supplier-invoice-list/supplier-invoice-list.component').then(m => m.SupplierInvoiceListComponent),
        title: $localize`:@@supplier-invoices.routes.title.Factures_fournisseurs_:Factures fournisseurs - InstaFact`
    },
    {
        path: 'unpaid',
        loadComponent: () => import('./supplier-invoice-list/supplier-invoice-list.component').then(m => m.SupplierInvoiceListComponent),
        title: $localize`:@@supplier-invoices.routes.title.Factures_impay_es_fourni:Factures impayées fournisseurs - InstaFact`,
        data: { unpaidOnly: true }
    },
    {
        path: 'new',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.supplierInvoices.create] },
        loadComponent: () => import('./supplier-invoice-form/supplier-invoice-form.component').then(m => m.SupplierInvoiceFormComponent),
        title: $localize`:@@supplier-invoices.routes.title.Nouvelle_facture_fournis:Nouvelle facture fournisseur - InstaFact`
    },
    {
        path: 'unpaid/:id',
        loadComponent: () => import('./supplier-invoice-detail/supplier-invoice-detail.component').then(m => m.SupplierInvoiceDetailComponent),
        title: $localize`:@@supplier-invoices.routes.title.D_tail_facture_fournisse:Détail facture fournisseur - InstaFact`,
        data: { unpaidOnly: true }
    },
    {
        path: ':id',
        loadComponent: () => import('./supplier-invoice-detail/supplier-invoice-detail.component').then(m => m.SupplierInvoiceDetailComponent),
        title: $localize`:@@supplier-invoices.routes.title.D_tail_facture_fournisse:Détail facture fournisseur - InstaFact`
    }
];
