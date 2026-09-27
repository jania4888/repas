/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const TIMESHEETS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./my-timesheets.component').then(m => m.MyTimesheetsComponent),
    title: $localize`:@@timesheets.routes.title.Mes_feuilles_de_temps_:Mes feuilles de temps - FactuTrust`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.projectTime.read] }
  },
  {
    path: 'validation',
    loadComponent: () => import('./timesheet-validation.component').then(m => m.TimesheetValidationComponent),
    title: $localize`:@@timesheets.routes.title.Validation_timesheets_:Validation timesheets - FactuTrust`,
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.projects.update] }
  }
];
