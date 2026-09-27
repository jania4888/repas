/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const INVOICES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./invoice-list/invoice-list.component').then(m => m.InvoiceListComponent),
    title: $localize`:@@invoices.routes.title.Factures_InstaFact:Factures - InstaFact`
  },
  {
    path: 'new',
    canActivate: [permissionGuard],
    loadComponent: () => import('./invoice-wizard/invoice-wizard.component').then(m => m.InvoiceWizardComponent),
    title: $localize`:@@invoices.routes.title.Nouvelle_facture_Insta:Nouvelle facture - InstaFact`,
    data: {
      fullWidth: true,
      hideLayout: true,
      permissions: [PERMISSIONS.invoices.create]
    }
  },
  {
    path: 'new/draft/:draftId',
    canActivate: [permissionGuard],
    loadComponent: () => import('./invoice-wizard/invoice-wizard.component').then(m => m.InvoiceWizardComponent),
    title: $localize`:@@invoices.routes.title.Brouillon_facture_Inst:Brouillon facture - InstaFact`,
    data: {
      fullWidth: true,
      hideLayout: true,
      permissions: [PERMISSIONS.invoices.create]
    }
  },
  {
    path: 'credit-note/new',
    canActivate: [permissionGuard],
    loadComponent: () => import('./credit-note-entry/credit-note-entry.component').then(m => m.CreditNoteEntryComponent),
    title: $localize`:@@invoices.routes.title.Nouvel_avoir_de_vente_:Nouvel avoir de vente - InstaFact`,
    data: {
      permissions: [PERMISSIONS.invoices.create]
    }
  },
  {
    path: 'credit-notes',
    loadComponent: () => import('./invoice-list/invoice-list.component').then(m => m.InvoiceListComponent),
    title: $localize`:@@invoices.routes.title.Avoirs_de_vente_InstaF:Avoirs de vente - InstaFact`,
    data: { creditNotesOnly: true }
  },
  {
    path: 'credit-notes/:id',
    loadComponent: () => import('./invoice-detail/invoice-detail.component').then(m => m.InvoiceDetailComponent),
    title: $localize`:@@invoices.routes.title.D_tail_avoir_InstaFact:Détail avoir - InstaFact`,
    data: { creditNotesOnly: true }
  },
  {
    path: 'unpaid',
    loadComponent: () => import('./invoice-list/invoice-list.component').then(m => m.InvoiceListComponent),
    title: $localize`:@@invoices.routes.title.Factures_impay_es_Inst:Factures impayées - InstaFact`,
    data: { unpaidOnly: true }
  },
  {
    path: 'unpaid/:id',
    loadComponent: () => import('./invoice-detail/invoice-detail.component').then(m => m.InvoiceDetailComponent),
    title: $localize`:@@invoices.routes.title.D_tail_facture_InstaFa:Détail facture - InstaFact`,
    data: { unpaidOnly: true }
  },
  {
    path: ':id',
    loadComponent: () => import('./invoice-detail/invoice-detail.component').then(m => m.InvoiceDetailComponent),
    title: $localize`:@@invoices.routes.title.D_tail_facture_InstaFa:Détail facture - InstaFact`
  },
  {
    path: ':id/credit-note',
    canActivate: [permissionGuard],
    loadComponent: () => import('./invoice-wizard/invoice-wizard.component').then(m => m.InvoiceWizardComponent),
    title: "Facture d'avoir - InstaFact",
    data: {
      fullWidth: true,
      hideLayout: true,
      isCreditNote: true,
      permissions: [PERMISSIONS.invoices.create]
    }
  }
];
