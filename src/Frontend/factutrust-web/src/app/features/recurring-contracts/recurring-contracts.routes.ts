/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const RECURRING_CONTRACTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/contract-list/contract-list.component').then(m => m.ContractListComponent),
    title: $localize`:@@recurring-contracts.routes.title.Contrats_r_currents_In:Contrats récurrents - InstaFact`
  },
  {
    path: 'pending-drafts',
    loadComponent: () =>
      import('./pages/pending-drafts/pending-drafts.component').then(m => m.PendingDraftsComponent),
    title: $localize`:@@recurring-contracts.routes.title.Brouillons_r_currents_:Brouillons récurrents - InstaFact`
  },
  {
    path: 'new',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.recurringContracts.create] },
    loadComponent: () =>
      import('./pages/contract-form/contract-form.component').then(m => m.ContractFormComponent),
    title: $localize`:@@recurring-contracts.routes.title.Nouveau_contrat_InstaF:Nouveau contrat - InstaFact`
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.recurringContracts.update] },
    loadComponent: () =>
      import('./pages/contract-form/contract-form.component').then(m => m.ContractFormComponent),
    title: $localize`:@@recurring-contracts.routes.title.Modifier_contrat_Insta:Modifier contrat - InstaFact`
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/contract-detail/contract-detail.component').then(m => m.ContractDetailComponent),
    title: $localize`:@@recurring-contracts.routes.title.D_tail_contrat_InstaFa:Détail contrat - InstaFact`
  }
];
