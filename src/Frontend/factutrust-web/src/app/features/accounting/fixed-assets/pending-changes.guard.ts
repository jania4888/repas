import { CanDeactivateFn } from '@angular/router';
import { inject } from '@angular/core';
// Import de type uniquement : évite d'entraîner le chargement du composant (lazy-loaded via
// `loadComponent`) dans le chunk de routes, qui est instancié à l'initialisation.
import type { FixedAssetDetailComponent } from './fixed-asset-detail.component';
import { DeskWindowService } from '@core/desk/desk-window.service';

/**
 * Garde de navigation CanDeactivate pour le détail d'immobilisation (T15 / C9).
 *
 * `@HostListener('window:beforeunload')` ne couvre que la fermeture ou le rechargement de l'onglet ;
 * ce guard intercepte la navigation interne Angular (routerLink « Retour au registre », changement
 * d'identifiant…). Si le formulaire est « dirty », `component.canDeactivate()` demande une
 * confirmation (boîte native) avant de quitter la page ; un formulaire vierge laisse passer librement.
 */
export const pendingChangesGuard: CanDeactivateFn<FixedAssetDetailComponent> = (component): boolean => {
  if (!component) return true;
  if (inject(DeskWindowService).bypassesDeactivate()) return true;
  return component.canDeactivate();
};
