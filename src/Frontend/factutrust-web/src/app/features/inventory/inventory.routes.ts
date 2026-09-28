/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const INVENTORY_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./inventory-list/inventory-list.component')
            .then(m => m.InventoryListComponent),
        title: $localize`:@@inventory.routes.title.Inventaire_InstaFact:Inventaire - InstaFact`
    },
    {
        path: 'new',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.inventory.create] },
        loadComponent: () => import('./inventory-form/inventory-form.component')
            .then(m => m.InventoryFormComponent),
        title: $localize`:@@inventory.routes.title.Nouvel_inventaire_Inst:Nouvel inventaire - InstaFact`
    },
    {
        path: 'wizard',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.inventory.read] },
        loadComponent: () => import('./inventory-wizard/inventory-wizard.component')
            .then(m => m.InventoryWizardComponent),
        title: $localize`:@@inventory.routes.title.Inventaire_physique_mod:Inventaire physique (mode assistant) - InstaFact`
    },
    {
        path: ':id',
        loadComponent: () => import('./inventory-detail/inventory-detail.component')
            .then(m => m.InventoryDetailComponent),
        title: $localize`:@@inventory.routes.title.D_tail_inventaire_Inst:Détail inventaire - InstaFact`
    }
];
