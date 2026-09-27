/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const CLIENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./client-list/client-list.component').then(m => m.ClientListComponent),
    title: $localize`:@@clients.routes.title.Clients_InstaFact:Clients - InstaFact`
  },
  {
    path: 'new',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.clients.create] },
    loadComponent: () => import('./client-form/client-form.component').then(m => m.ClientFormComponent),
    title: $localize`:@@clients.routes.title.Nouveau_client_InstaFa:Nouveau client - InstaFact`
  },
  {
    path: ':id',
    loadComponent: () => import('./client-detail/client-detail.component').then(m => m.ClientDetailComponent),
    title: $localize`:@@clients.routes.title.D_tail_client_InstaFac:Détail client - InstaFact`
  },
  {
    path: ':id/edit',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.clients.update] },
    loadComponent: () => import('./client-form/client-form.component').then(m => m.ClientFormComponent),
    title: $localize`:@@clients.routes.title.Modifier_client_InstaF:Modifier client - InstaFact`
  }
];
