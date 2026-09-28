/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const CRM_ROUTES: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/crm-dashboard.component').then(m => m.CrmDashboardComponent),
    title: $localize`:@@crm.routes.title.CRM_Tableau_de_bord_:CRM — Tableau de bord - InstaFact`
  },
  {
    path: 'opportunities',
    loadComponent: () => import('./opportunities/opportunity-list.component').then(m => m.OpportunityListComponent),
    title: $localize`:@@crm.routes.title.CRM_Opportunit_s_Ins:CRM — Opportunités - InstaFact`
  },
  {
    path: 'activities',
    loadComponent: () => import('./activities/activity-list.component').then(m => m.ActivityListComponent),
    title: $localize`:@@crm.routes.title.CRM_Activit_s_InstaF:CRM — Activités - InstaFact`
  },
  {
    path: 'targets',
    loadComponent: () => import('./targets/targets.component').then(m => m.TargetsComponent),
    title: $localize`:@@crm.routes.title.CRM_Objectifs_InstaF:CRM — Objectifs - InstaFact`
  },
  {
    path: 'quote-templates/new',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.crm.create] },
    loadComponent: () =>
      import('./quote-templates/quote-template-form.component').then(m => m.QuoteTemplateFormComponent),
    title: $localize`:@@crm.routes.title.CRM_Nouveau_mod_le_de_:CRM — Nouveau modèle de devis - InstaFact`
  },
  {
    path: 'quote-templates/:id/edit',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.crm.update] },
    loadComponent: () =>
      import('./quote-templates/quote-template-form.component').then(m => m.QuoteTemplateFormComponent),
    title: $localize`:@@crm.routes.title.CRM_Modifier_mod_le_de:CRM — Modifier modèle de devis - InstaFact`
  },
  {
    path: 'quote-templates',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.crm.read] },
    loadComponent: () =>
      import('./quote-templates/quote-template-list.component').then(m => m.QuoteTemplateListComponent),
    title: $localize`:@@crm.routes.title.CRM_Mod_les_de_devis_:CRM — Modèles de devis - InstaFact`
  }
];
