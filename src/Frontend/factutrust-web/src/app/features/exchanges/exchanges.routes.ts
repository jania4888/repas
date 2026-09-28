/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { accountingFirmsFeatureGuard } from '@core/guards/accounting-firms.guard';

export const EXCHANGES_ROUTES: Routes = [
  {
    path: '',
    canActivate: [accountingFirmsFeatureGuard],
    loadComponent: () =>
      import('./exchange-shell.component').then(m => m.ExchangeShellComponent),
    title: $localize`:@@exchanges.routes.title._changes:Échanges`
  },
  {
    path: ':threadId',
    canActivate: [accountingFirmsFeatureGuard],
    loadComponent: () =>
      import('./exchange-shell.component').then(m => m.ExchangeShellComponent),
    title: $localize`:@@exchanges.routes.title._changes:Échanges`
  }
];
