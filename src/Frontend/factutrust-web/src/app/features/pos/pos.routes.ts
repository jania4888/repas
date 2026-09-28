/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';

export const POS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pos.component').then(m => m.PosComponent),
    title: $localize`:@@pos.routes.title.Point_de_Vente_InstaFa:Point de Vente - InstaFact`,
    data: { fullWidth: true, hideLayout: true }
  },
  {
    path: 'customer-display',
    loadComponent: () => import('./components/customer-display/customer-display.component').then(m => m.CustomerDisplayComponent),
    title: $localize`:@@pos.routes.title.Affichage_client_POS:Affichage client - POS`,
    data: { fullWidth: true, hideLayout: true }
  }
];
