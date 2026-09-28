/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const PAYROLL_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'employees' },
  {
    path: 'employees',
    loadComponent: () => import('./employees/employee-list.component').then(m => m.EmployeeListComponent),
    title: $localize`:@@payroll.routes.title.Salari_s_InstaFact:Salariés - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.read] }
  },
  {
    path: 'employees/new',
    loadComponent: () => import('./employees/employee-form.component').then(m => m.EmployeeFormComponent),
    title: $localize`:@@payroll.routes.title.Nouveau_salari_InstaF:Nouveau salarié - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.manageEmployees] }
  },
  {
    path: 'employees/:id/edit',
    loadComponent: () => import('./employees/employee-form.component').then(m => m.EmployeeFormComponent),
    title: $localize`:@@payroll.routes.title.Modifier_salari_Insta:Modifier salarié - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.manageEmployees] }
  },
  {
    path: 'employees/:id',
    loadComponent: () => import('./employees/employee-detail.component').then(m => m.EmployeeDetailComponent),
    title: $localize`:@@payroll.routes.title.Fiche_salari_InstaFac:Fiche salarié - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.read] }
  },
  {
    path: 'runs',
    loadComponent: () => import('./runs/payroll-run-list.component').then(m => m.PayrollRunListComponent),
    title: $localize`:@@payroll.routes.title.Cycles_de_paie_InstaFa:Cycles de paie - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.read] }
  },
  {
    path: 'runs/:id',
    loadComponent: () => import('./runs/payroll-run-detail.component').then(m => m.PayrollRunDetailComponent),
    title: $localize`:@@payroll.routes.title.Cycle_de_paie_InstaFac:Cycle de paie - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.read] }
  },
  {
    path: 'regularization',
    loadComponent: () => import('./regularization/irpp-regularization.component').then(m => m.IrppRegularizationComponent),
    title: $localize`:@@payroll.routes.title.R_gularisation_IRPP_In:Régularisation IRPP - InstaFact`,
    canActivate: [permissionGuard],
    // Lecture pour consulter et calculer ; l'enregistrement est gaté dans le composant
    // par canRunPayroll (même approche que le détail de cycle).
    data: { permissions: [PERMISSIONS.payroll.read] }
  },
  {
    path: 'terminations',
    loadComponent: () => import('./terminations/termination-settlement-list.component').then(m => m.TerminationSettlementListComponent),
    title: $localize`:@@payroll.routes.title.Soldes_de_tout_compte_:Soldes de tout compte - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.read] }
  },
  {
    path: 'terminations/new',
    loadComponent: () => import('./terminations/termination-settlement-form.component').then(m => m.TerminationSettlementFormComponent),
    title: $localize`:@@payroll.routes.title.Nouveau_solde_InstaFac:Nouveau solde - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.manageTermination] }
  },
  {
    path: 'terminations/:id',
    loadComponent: () => import('./terminations/termination-settlement-form.component').then(m => m.TerminationSettlementFormComponent),
    title: $localize`:@@payroll.routes.title.Solde_de_tout_compte_I:Solde de tout compte - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.read] }
  },
  {
    path: 'settings/annual-bonuses',
    loadComponent: () => import('./settings/annual-bonuses.component').then(m => m.AnnualBonusesSettingsComponent),
    title: $localize`:@@payroll.routes.title.Primes_annuelles_Insta:Primes annuelles - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.settings] }
  },
  {
    path: 'settings',
    loadComponent: () => import('./settings/payroll-settings.component').then(m => m.PayrollSettingsComponent),
    title: $localize`:@@payroll.routes.title.Param_tres_paie_InstaF:Paramètres paie - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.settings] }
  },
  {
    path: 'settings/holidays',
    loadComponent: () => import('./settings/payroll-holidays.component').then(m => m.PayrollHolidaysComponent),
    title: $localize`:@@payroll.routes.title.Jours_f_ri_s_InstaFact:Jours fériés - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.settings] }
  },
  {
    path: 'reports/payroll-book',
    loadComponent: () => import('./reports/payroll-book.component').then(m => m.PayrollBookComponent),
    title: $localize`:@@payroll.routes.title.Livre_de_paie_InstaFac:Livre de paie - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.read] }
  },
  {
    path: 'reports/payroll-journal',
    loadComponent: () => import('./reports/payroll-journal.component').then(m => m.PayrollJournalComponent),
    title: $localize`:@@payroll.routes.title.Journal_de_paie_InstaF:Journal de paie - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.read] }
  },
  {
    path: 'declarations',
    loadComponent: () => import('./declarations/payroll-declarations.component').then(m => m.PayrollDeclarationsComponent),
    title: $localize`:@@payroll.routes.title.D_clarations_paie_Inst:Déclarations paie - InstaFact`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.payroll.declare] }
  }
];
