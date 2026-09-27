/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const PRODUCT_CATEGORIES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./product-category-list/product-category-list.component').then(m => m.ProductCategoryListComponent),
    title: $localize`:@@product-categories.routes.title.Cat_gories_InstaFact:Catégories - InstaFact`
  },
  {
    path: 'new',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.products.create] },
    loadComponent: () => import('./product-category-form/product-category-form.component').then(m => m.ProductCategoryFormComponent),
    title: $localize`:@@product-categories.routes.title.Nouvelle_cat_gorie_Ins:Nouvelle catégorie - InstaFact`
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.products.update] },
    loadComponent: () => import('./product-category-form/product-category-form.component').then(m => m.ProductCategoryFormComponent),
    title: $localize`:@@product-categories.routes.title.Modifier_la_cat_gorie_:Modifier la catégorie - InstaFact`
  }
];
