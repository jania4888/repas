/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const DELIVERY_NOTES_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./pages/delivery-note-list/delivery-note-list.component').then(m => m.DeliveryNoteListComponent),
        title: $localize`:@@delivery-notes.routes.title.Bons_de_Livraison_Inst:Bons de Livraison - InstaFact`
    },
    {
        path: 'new',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.deliveryNotes.create] },
        loadComponent: () => import('./pages/delivery-note-form/delivery-note-form.component').then(m => m.DeliveryNoteFormComponent),
        title: $localize`:@@delivery-notes.routes.title.Nouveau_bon_de_livraison:Nouveau bon de livraison - InstaFact`
    },
    {
        path: ':id',
        loadComponent: () => import('./pages/delivery-note-detail/delivery-note-detail.component').then(m => m.DeliveryNoteDetailComponent),
        title: $localize`:@@delivery-notes.routes.title.D_tail_bon_de_livraison_:Détail bon de livraison - InstaFact`
    }
];
