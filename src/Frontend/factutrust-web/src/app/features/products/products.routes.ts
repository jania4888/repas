/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const PRODUCTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./product-list/product-list.component').then(m => m.ProductListComponent),
    title: $localize`:@@products.routes.title.Produits_InstaFact:Produits - InstaFact`
  },
  {
    path: 'new',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.products.create] },
    loadComponent: () => import('./product-form/product-form.component').then(m => m.ProductFormComponent),
    title: $localize`:@@products.routes.title.Nouveau_produit_InstaF:Nouveau produit - InstaFact`
  },
  {
    path: ':id/view',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.products.read] },
    loadComponent: () => import('./product-detail/product-detail.component').then(m => m.ProductDetailComponent),
    title: $localize`:@@products.routes.title.D_tails_produit_InstaF:Détails produit - InstaFact`
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.products.update] },
    loadComponent: () => import('./product-form/product-form.component').then(m => m.ProductFormComponent),
    title: $localize`:@@products.routes.title.Modifier_produit_Insta:Modifier produit - InstaFact`
  }
];
