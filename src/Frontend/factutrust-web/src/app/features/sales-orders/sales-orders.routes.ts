/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const SALES_ORDERS_ROUTES: Routes = [
  {
    path: '',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.salesOrders.read] },
    loadComponent: () =>
      import('@features/sales-orders/sales-order-list/sales-order-list.component').then(
        m => m.SalesOrderListComponent
      ),
    title: $localize`:@@sales-orders.routes.title.Commandes_clients_Inst:Commandes clients - InstaFact`
  },
  {
    // Avant ':id', sinon « backlog » serait pris pour un identifiant.
    path: 'backlog',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.salesOrders.read] },
    loadComponent: () =>
      import('@features/sales-orders/sales-order-backlog/sales-order-backlog.component').then(
        m => m.SalesOrderBacklogComponent
      ),
    title: $localize`:@@sales-orders.routes.title.Carnet_de_commandes_In:Carnet de commandes - InstaFact`
  },
  {
    path: 'new',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.salesOrders.create] },
    loadComponent: () =>
      import('@features/sales-orders/sales-order-create/sales-order-create.component').then(
        m => m.SalesOrderCreateComponent
      ),
    title: $localize`:@@sales-orders.routes.title.Nouvelle_commande_Inst:Nouvelle commande - InstaFact`
  },
  {
    path: ':id',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.salesOrders.read] },
    loadComponent: () =>
      import('@features/sales-orders/sales-order-detail/sales-order-detail.component').then(
        m => m.SalesOrderDetailComponent
      ),
    title: $localize`:@@sales-orders.routes.title.D_tail_commande_InstaF:Détail commande - InstaFact`
  }
];
