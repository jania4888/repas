/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const SALES_RETURN_NOTES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/sales-return-note-list.component').then(m => m.SalesReturnNoteListComponent),
    title: $localize`:@@sales-return-notes.routes.title.Bons_de_retour_InstaFa:Bons de retour - InstaFact`
  },
  {
    path: 'new',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.returnNotes.create] },
    loadComponent: () =>
      import('./pages/sales-return-note-form.component').then(m => m.SalesReturnNoteFormComponent),
    title: $localize`:@@sales-return-notes.routes.title.Nouveau_bon_de_retour_:Nouveau bon de retour - InstaFact`
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/sales-return-note-detail.component').then(m => m.SalesReturnNoteDetailComponent),
    title: $localize`:@@sales-return-notes.routes.title.D_tail_bon_de_retour_I:Détail bon de retour - InstaFact`
  }
];
