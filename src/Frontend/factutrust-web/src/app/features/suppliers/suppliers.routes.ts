/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const SUPPLIERS_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./supplier-list/supplier-list.component').then(m => m.SupplierListComponent),
        title: $localize`:@@suppliers.routes.title.Fournisseurs_InstaFact:Fournisseurs - InstaFact`
    },
    {
        path: 'new',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.suppliers.create] },
        loadComponent: () => import('./supplier-form/supplier-form.component').then(m => m.SupplierFormComponent),
        title: $localize`:@@suppliers.routes.title.Nouveau_fournisseur_In:Nouveau fournisseur - InstaFact`
    },
    {
        path: ':id',
        loadComponent: () => import('./supplier-detail/supplier-detail.component').then(m => m.SupplierDetailComponent),
        title: $localize`:@@suppliers.routes.title.D_tail_fournisseur_Ins:Détail fournisseur - InstaFact`
    },
    {
        path: ':id/edit',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.suppliers.update] },
        loadComponent: () => import('./supplier-form/supplier-form.component').then(m => m.SupplierFormComponent),
        title: $localize`:@@suppliers.routes.title.Modifier_fournisseur_I:Modifier fournisseur - InstaFact`
    }
];
