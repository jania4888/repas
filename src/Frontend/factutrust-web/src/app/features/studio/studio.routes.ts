import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';
import { StudioShellComponent } from './shared/studio-shell.component';
import { capabilityGuard } from './shared/capability.guard';
import { approvalsAccessGuard } from './approvals/approvals-access.guard';

/**
 * Routes enfants du module Studio. Elles sont enveloppées par `StudioShellComponent`
 * (classe `studio-theme`, décision D2) : toute page sous `/studio/**` hérite du thème indigo.
 */
export const STUDIO_CHILD_ROUTES: Routes = [
  {
    path: '',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designEntities] },
    loadComponent: () => import('./studio-entity-list.component').then(m => m.StudioEntityListComponent),
    title: 'Studio — Tables - InstaFact'
  },
  // ---- AI builder (natural-language app generation) ----
  // L'entrée aiguille vers l'atelier (workbench activé) ou la page legacy (`StudioAiBuilderComponent`).
  {
    path: 'ai',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designEntities] },
    loadComponent: () => import('./ai/studio-ai-entry.component').then(m => m.StudioAiEntryComponent),
    title: 'Assistant Studio (IA) - InstaFact'
  },
  // Pages « Voir tout » du rail de l'atelier (déclarées avant `systems/:key`).
  {
    path: 'ai/projects',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designEntities] },
    loadComponent: () => import('./ai/projects/studio-ai-projects-page.component').then(m => m.StudioAiProjectsPageComponent),
    title: 'Mes projets - InstaFact'
  },
  {
    path: 'ai/templates',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designEntities] },
    loadComponent: () => import('./ai/templates/studio-ai-templates-page.component').then(m => m.StudioAiTemplatesPageComponent),
    title: 'Bibliothèque de modèles - InstaFact'
  },
  {
    path: 'systems/:key',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.customData.recordsRead] },
    loadComponent: () => import('./studio-system-hub.component').then(m => m.StudioSystemHubComponent),
    title: 'Système Studio - InstaFact'
  },
  // ---- Forms hub (discoverable entry point for the form designer) ----
  {
    path: 'forms',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designForms] },
    loadComponent: () => import('./studio-form-hub.component').then(m => m.StudioFormHubComponent),
    title: 'Formulaires - InstaFact'
  },
  // ---- Read-only views over existing SQL tables ----
  {
    path: 'views/new',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designForms] },
    loadComponent: () => import('./studio-view-designer.component').then(m => m.StudioViewDesignerComponent),
    title: 'Nouvelle vue - InstaFact'
  },
  {
    path: 'views/:id/view',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.customData.reportsView] },
    loadComponent: () => import('./studio-view-runner.component').then(m => m.StudioViewRunnerComponent),
    title: 'Vue - InstaFact'
  },
  {
    path: 'views/:id',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designForms] },
    loadComponent: () => import('./studio-view-designer.component').then(m => m.StudioViewDesignerComponent),
    title: 'Modifier la vue - InstaFact'
  },
  // ---- Reports (top-level: custom tables + existing sources) ----
  {
    path: 'reports/new',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designReports] },
    loadComponent: () => import('./studio-report-designer.component').then(m => m.StudioReportDesignerComponent),
    title: 'Nouveau rapport - InstaFact'
  },
  {
    path: 'reports/:id/view',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.customData.reportsView] },
    loadComponent: () => import('./studio-report-view.component').then(m => m.StudioReportViewComponent),
    title: 'Rapport - InstaFact'
  },
  {
    path: 'reports/:id',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designReports] },
    loadComponent: () => import('./studio-report-designer.component').then(m => m.StudioReportDesignerComponent),
    title: 'Modifier rapport - InstaFact'
  },
  {
    path: 'reports',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designReports] },
    loadComponent: () => import('./studio-report-list.component').then(m => m.StudioReportListComponent),
    title: 'Rapports - InstaFact'
  },
  // ---- Runtime data routes (by entity key) ----
  {
    path: 'd/:key/new',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.customData.recordsWrite] },
    loadComponent: () => import('./studio-record-form.component').then(m => m.StudioRecordFormComponent),
    title: 'Nouvel enregistrement - InstaFact'
  },
  // Déclarées avant `d/:key/:id/edit` pour que `views` ne soit pas capturé comme `:id` (V4/spec).
  // Stub 2.5a (« Concepteur de vue — bientôt ») ; remplacé par le vrai concepteur en 2.5d.
  {
    path: 'd/:key/views/new',
    canActivate: [permissionGuard, capabilityGuard('recordViewsEnabled', r => '/studio/d/' + r.paramMap.get('key'))],
    data: { permissions: [PERMISSIONS.studio.designForms] },
    loadComponent: () => import('./views/studio-record-view-designer.component').then(m => m.StudioRecordViewDesignerComponent),
    title: 'Nouvelle vue - InstaFact'
  },
  {
    path: 'd/:key/views/:viewId',
    canActivate: [permissionGuard, capabilityGuard('recordViewsEnabled', r => '/studio/d/' + r.paramMap.get('key'))],
    data: { permissions: [PERMISSIONS.studio.designForms] },
    loadComponent: () => import('./views/studio-record-view-designer.component').then(m => m.StudioRecordViewDesignerComponent),
    title: 'Modifier la vue - InstaFact'
  },
  {
    path: 'd/:key/:id/edit',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.customData.recordsWrite] },
    loadComponent: () => import('./studio-record-form.component').then(m => m.StudioRecordFormComponent),
    title: 'Modifier enregistrement - InstaFact'
  },
  // 4.7 suite (D-47-94) : fiche en lecture seule pour un profil `custom_records:read` seul.
  // Même composant que `/edit` ; le composant détecte la route `/view` et passe DynamicForm en
  // lecture seule (champs désactivés, actions d'écriture masquées). Tous les endpoints lus sont
  // en recordsRead (schéma, enregistrement, historique, instances de workflow).
  {
    path: 'd/:key/:id/view',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.customData.recordsRead] },
    loadComponent: () => import('./studio-record-form.component').then(m => m.StudioRecordFormComponent),
    title: 'Consulter enregistrement - InstaFact'
  },
  {
    path: 'd/:key',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.customData.recordsRead] },
    loadComponent: () => import('./studio-record-list.component').then(m => m.StudioRecordListComponent),
    title: 'Données - InstaFact'
  },
  // ---- Design routes (by entity id) ----
  {
    path: ':id/form',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designForms] },
    loadComponent: () => import('./studio-form-designer.component').then(m => m.StudioFormDesignerComponent),
    title: 'Mise en page du formulaire - InstaFact'
  },
  {
    path: ':id/automations',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designEntities] },
    loadComponent: () => import('./studio-automations.component').then(m => m.StudioAutomationsComponent),
    title: 'Pont ERP - InstaFact'
  },
  // Workflows (4.4d/4.4e1) : routes plates déclarées avant `relations` et `:id` (P11).
  {
    path: 'workflows',
    canActivate: [permissionGuard, capabilityGuard('workflowsEnabled', () => '/studio')],
    data: { permissions: [PERMISSIONS.studio.designEntities] },
    loadComponent: () => import('./workflows/studio-workflows-hub.component').then(m => m.StudioWorkflowsHubComponent),
    title: 'Workflows - InstaFact'
  },
  // Concepteur (4.4e1) : `workflows/new` AVANT `workflows/:id`, sinon `new` serait capturé comme identifiant.
  {
    path: 'workflows/new',
    canActivate: [permissionGuard, capabilityGuard('workflowsEnabled', () => '/studio')],
    data: { permissions: [PERMISSIONS.studio.designEntities] },
    loadComponent: () => import('./workflows/studio-workflow-designer.component').then(m => m.StudioWorkflowDesignerComponent),
    title: 'Nouveau workflow - InstaFact'
  },
  {
    path: 'workflows/:id',
    canActivate: [permissionGuard, capabilityGuard('workflowsEnabled', () => '/studio')],
    data: { permissions: [PERMISSIONS.studio.designEntities] },
    loadComponent: () => import('./workflows/studio-workflow-designer.component').then(m => m.StudioWorkflowDesignerComponent),
    title: 'Workflow - InstaFact'
  },
  {
    // Pas de capabilityGuard : les liens de notification (types 15–18, 4.4j) doivent mener à la
    // fiche même si le flag workflows est coupé ensuite (D6).
    path: 'records/:key/:id',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.customData.recordsRead] },
    loadComponent: () => import('./workflows/studio-record-redirect.component').then(m => m.StudioRecordRedirectComponent),
    title: 'Enregistrement - InstaFact'
  },
  // Mes approbations (4.4g2, D-44-19 : déclarée ici seulement) : permissionGuard PUIS
  // approvalsAccessGuard (sonde count — 404 ⇒ /dashboard (4.5d1), 403 ⇒ /access-denied). Pas de
  // studio:design_entities au niveau route (U2/D11) : la page décision exige recordsWrite.
  {
    path: 'approvals',
    canActivate: [permissionGuard, approvalsAccessGuard],
    data: { permissions: [PERMISSIONS.customData.recordsRead] },
    loadComponent: () => import('./approvals/studio-approvals-page.component').then(m => m.StudioApprovalsPageComponent),
    title: 'Mes approbations - InstaFact'
  },
  // Déclarée avant `:id` pour que `relations` ne soit pas capturé comme un identifiant de table (V5/E5).
  {
    path: 'relations',
    canActivate: [permissionGuard, capabilityGuard('manyToManyEnabled', () => '/studio')],
    data: { permissions: [PERMISSIONS.studio.designEntities] },
    loadComponent: () => import('./relations/studio-relations-page.component').then(m => m.StudioRelationsPageComponent),
    title: 'Relations - InstaFact'
  },
  {
    path: ':id',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.studio.designEntities] },
    loadComponent: () => import('./studio-entity-designer.component').then(m => m.StudioEntityDesignerComponent),
    title: 'Concepteur de table - InstaFact'
  }
];

export const STUDIO_ROUTES: Routes = [
  { path: '', component: StudioShellComponent, children: STUDIO_CHILD_ROUTES }
];
