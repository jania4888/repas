/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { AppModule } from '@core/models/app-module';
import { PERMISSIONS } from '@core/config/permission-keys';

export const PAYMENTS_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'clients',
    pathMatch: 'full'
  },
  {
    path: 'clients',
    loadComponent: () => import('./payments.component').then(m => m.PaymentsComponent),
    data: { paymentType: 'client' },
    title: $localize`:@@payments.routes.title.Paiements_clients_Inst:Paiements clients - InstaFact`
  },
  {
    path: 'suppliers',
    loadComponent: () => import('./payments.component').then(m => m.PaymentsComponent),
    data: { paymentType: 'supplier' },
    title: $localize`:@@payments.routes.title.Paiements_fournisseurs_:Paiements fournisseurs - InstaFact`
  },
  {
    path: 'cash-desk',
    loadComponent: () => import('./cash-desk/cash-desk.component').then(m => m.CashDeskComponent),
    canActivate: [permissionGuard],
    data: { modules: [AppModule.Treasury], permissions: [PERMISSIONS.payments.read] },
    title: $localize`:@@payments.routes.title.Caisse_de_tr_sorerie_I:Caisse de trésorerie - InstaFact`
  },
  {
    path: 'bank-accounts',
    loadComponent: () => import('./bank-accounts/bank-accounts.component').then(m => m.BankAccountsComponent),
    title: $localize`:@@payments.routes.title.Comptes_bancaires_Inst:Comptes bancaires - InstaFact`
  }
];
