/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const PURCHASE_RECEIPTS_ROUTES: Routes = [
  {
    path: '',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.purchaseReceipts.read] },
    loadComponent: () =>
      import('./pages/purchase-receipt-list/purchase-receipt-list.component').then(
        m => m.PurchaseReceiptListComponent
      ),
    title: $localize`:@@purchase-receipts.routes.title.Bons_de_r_ception_Inst:Bons de réception - InstaFact`
  },
  {
    path: 'new',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.purchaseReceipts.create] },
    loadComponent: () =>
      import('./pages/purchase-receipt-form/purchase-receipt-form.component').then(
        m => m.PurchaseReceiptFormComponent
      ),
    title: $localize`:@@purchase-receipts.routes.title.Nouveau_bon_de_r_ception:Nouveau bon de réception - InstaFact`
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.purchaseReceipts.update] },
    loadComponent: () =>
      import('./pages/purchase-receipt-form/purchase-receipt-form.component').then(
        m => m.PurchaseReceiptFormComponent
      ),
    title: $localize`:@@purchase-receipts.routes.title.Modifier_bon_de_r_ceptio:Modifier bon de réception - InstaFact`
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/purchase-receipt-detail/purchase-receipt-detail.component').then(
        m => m.PurchaseReceiptDetailComponent
      ),
    title: $localize`:@@purchase-receipts.routes.title.D_tail_bon_de_r_ception_:Détail bon de réception - InstaFact`
  }
];
