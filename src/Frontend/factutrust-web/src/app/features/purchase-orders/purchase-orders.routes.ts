/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const PURCHASE_ORDERS_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./purchase-order-list/purchase-order-list.component').then(m => m.PurchaseOrderListComponent),
        title: $localize`:@@purchase-orders.routes.title.Bons_de_commande_Insta:Bons de commande - InstaFact`
    },
    {
        path: 'new',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.purchaseOrders.create] },
        loadComponent: () => import('./purchase-order-create/purchase-order-create.component').then(m => m.PurchaseOrderCreateComponent),
        title: $localize`:@@purchase-orders.routes.title.Nouveau_bon_de_commande_:Nouveau bon de commande - InstaFact`
    },
    {
        path: ':id/edit',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.purchaseOrders.update] },
        loadComponent: () => import('./purchase-order-edit/purchase-order-edit.component').then(m => m.PurchaseOrderEditComponent),
        title: $localize`:@@purchase-orders.routes.title.Modifier_bon_de_commande:Modifier bon de commande - InstaFact`
    },
    {
        path: ':id/receive',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.purchaseOrders.update] },
        loadComponent: () => import('./purchase-order-receive/purchase-order-receive.component').then(m => m.PurchaseOrderReceiveComponent),
        title: $localize`:@@purchase-orders.routes.title.R_ception_marchandise_:Réception marchandise - InstaFact`
    },
    {
        path: ':id',
        loadComponent: () => import('./purchase-order-detail/purchase-order-detail.component').then(m => m.PurchaseOrderDetailComponent),
        title: $localize`:@@purchase-orders.routes.title.D_tail_bon_de_commande_:Détail bon de commande - InstaFact`
    }
];

