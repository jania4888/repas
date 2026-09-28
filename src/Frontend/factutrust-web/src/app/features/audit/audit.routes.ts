/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';

export const AUDIT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./audit-log/audit-log.component').then(m => m.AuditLogComponent),
    title: $localize`:@@audit.routes.title.journalAudit:Journal d'audit - InstaFact`
  }
];
