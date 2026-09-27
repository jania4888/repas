/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const QUOTES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('@features/quotes/quote-list/quote-list.component').then(m => m.QuoteListComponent),
    title: $localize`:@@quotes.routes.title.Devis_InstaFact:Devis - InstaFact`
  },
  {
    path: 'new',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.quotes.create] },
    loadComponent: () =>
      import('@features/quotes/quote-form/quote-form.component').then(m => m.QuoteFormComponent),
    title: $localize`:@@quotes.routes.title.Nouveau_devis_InstaFac:Nouveau devis - InstaFact`
  },
  {
    path: ':id',
    loadComponent: () =>
      import('@features/quotes/quote-detail/quote-detail.component').then(m => m.QuoteDetailComponent),
    title: $localize`:@@quotes.routes.title.D_tail_devis_InstaFact:Détail devis - InstaFact`
  }
];
