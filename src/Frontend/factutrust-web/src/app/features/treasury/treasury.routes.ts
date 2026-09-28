/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

/**
 * Routes du module Trésorerie.
 *
 * Le segment `/treasury` est créé ici : il était référencé par le menu mais n'existait pas encore
 * dans `app.routes.ts`.
 */
export const TREASURY_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'cash-forecast',
    pathMatch: 'full'
  },
  {
    path: 'cash-forecast',
    loadComponent: () =>
      import('./cash-forecast/cash-forecast.component').then(m => m.CashForecastComponent),
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.treasuryForecast.view] },
    title: $localize`:@@treasury.routes.title.Tr_sorerie_pr_visionnell:Trésorerie prévisionnelle — InstaFact`
  }
];
