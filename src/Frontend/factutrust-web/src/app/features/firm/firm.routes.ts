import { Routes } from '@angular/router';
import { firmNativeGuard, accountingFirmsFeatureGuard } from '@core/guards/accounting-firms.guard';
import { firmDelegatedAreaGuard } from '@core/guards/firm-delegated-area.guard';
import { firmManagerGuard } from '@core/guards/firm-manager.guard';
import { firmGovernanceFeatureGuard } from '@core/guards/firm-governance.guard';
import { firmRevisionFeatureGuard } from '@core/guards/firm-revision.guard';

export const FIRM_ROUTES: Routes = [
  {
    path: '',
    // Les gardes d'un noeud de route ne rejouent pas quand seul un enfant change : sans ceci, une
    // navigation interne a /firm/** (depuis /firm/open/:id notamment) ne reverifierait pas le mode.
    runGuardsAndResolvers: 'always',
    canActivate: [accountingFirmsFeatureGuard, firmDelegatedAreaGuard, firmNativeGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./firm-dashboard/firm-dashboard.component').then(m => m.FirmDashboardComponent),
        title: 'Cabinet — Tableau de bord'
      },
      {
        path: 'clients',
        loadComponent: () => import('./firm-clients/firm-clients.component').then(m => m.FirmClientsComponent),
        title: 'Cabinet — Dossiers clients'
      },
      {
        path: 'clients/new',
        canActivate: [firmManagerGuard],
        loadComponent: () =>
          import('./managed-clients/firm-managed-client-wizard.component').then(m => m.FirmManagedClientWizardComponent),
        title: 'Cabinet — Nouveau dossier client'
      },
      {
        path: 'affectation',
        canActivate: [firmGovernanceFeatureGuard, firmManagerGuard],
        loadComponent: () =>
          import('./affectation/firm-dossier-affectation.component').then(m => m.FirmDossierAffectationComponent),
        title: 'Cabinet — Affectation des dossiers'
      },
      {
        path: 'assistant',
        loadComponent: () => import('./assistant/firm-assistant.component').then(m => m.FirmAssistantComponent),
        data: { fullWidth: true, fillPane: true },
        title: 'Cabinet — Chef de mission'
      },
      {
        path: 'revision',
        canActivate: [firmRevisionFeatureGuard],
        loadComponent: () =>
          import('./revision/firm-revision-page.component').then(m => m.FirmRevisionPageComponent),
        title: 'Cabinet — Révision du portefeuille'
      },
      {
        path: 'fiscal-schedule',
        loadComponent: () =>
          import('../accounting/fiscal-schedule/fiscal-schedule.component').then(m => m.FiscalScheduleComponent),
        data: { fiscalScheduleScope: 'firm' },
        title: 'Cabinet - Echeancier fiscal'
      },
      {
        path: 'open/:tenantId',
        loadComponent: () =>
          import('./firm-open-dossier/firm-open-dossier.component').then(m => m.FirmOpenDossierComponent),
        title: 'Cabinet — Ouverture dossier'
      },
      {
        path: 'invitations',
        loadComponent: () => import('./firm-invitations/firm-invitations.component').then(m => m.FirmInvitationsComponent),
        title: 'Cabinet — Invitations'
      },
      {
        path: 'exchanges',
        loadChildren: () =>
          import('../exchanges/exchanges.routes').then(m => m.EXCHANGES_ROUTES),
        title: 'Cabinet — Échanges'
      },
      {
        path: 'settings',
        loadComponent: () => import('./firm-settings/firm-settings.component').then(m => m.FirmSettingsComponent),
        title: 'Cabinet — Paramètres'
      },
      {
        path: 'settings/users',
        redirectTo: '/firm/collaborateurs',
        pathMatch: 'full'
      },
      {
        path: 'settings/profile',
        canActivate: [firmManagerGuard],
        loadComponent: () => import('./firm-profile/firm-profile.component').then(m => m.FirmProfileComponent),
        title: 'Cabinet — Fiche annuaire'
      },
      {
        path: 'settings/activity-codes',
        canActivate: [firmManagerGuard],
        loadComponent: () =>
          import('./activity-codes/firm-activity-codes.component').then(m => m.FirmActivityCodesComponent),
        title: 'Cabinet — Types d’activité'
      },
      {
        path: 'collaborateurs',
        canActivate: [firmManagerGuard],
        loadComponent: () =>
          import('./collaborators/firm-collaborators-list.component').then(m => m.FirmCollaboratorsListComponent),
        title: 'Cabinet — Collaborateurs'
      },
      {
        path: 'collaborateurs/new',
        canActivate: [firmManagerGuard],
        data: { mode: 'create' },
        loadComponent: () =>
          import('./collaborators/firm-collaborator-form.component').then(m => m.FirmCollaboratorFormComponent),
        title: 'Cabinet — Nouveau collaborateur'
      },
      {
        path: 'collaborateurs/:id',
        canActivate: [firmManagerGuard],
        loadComponent: () =>
          import('./collaborators/firm-collaborator-form.component').then(m => m.FirmCollaboratorFormComponent),
        title: 'Cabinet — Consultation collaborateur'
      },
      {
        path: 'collaborateurs/:id/edit',
        canActivate: [firmManagerGuard],
        loadComponent: () =>
          import('./collaborators/firm-collaborator-form.component').then(m => m.FirmCollaboratorFormComponent),
        title: 'Cabinet — Modification collaborateur'
      },
      {
        path: 'governance',
        loadChildren: () => import('./governance/governance.routes').then(m => m.FIRM_GOVERNANCE_ROUTES)
      },
      {
        path: 'billing',
        canActivate: [firmManagerGuard],
        loadChildren: () => import('./billing/billing.routes').then(m => m.FIRM_BILLING_ROUTES)
      },
      {
        path: 'payroll',
        loadChildren: () => import('./payroll/firm-payroll.routes').then(m => m.FIRM_PAYROLL_ROUTES)
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  }
];
