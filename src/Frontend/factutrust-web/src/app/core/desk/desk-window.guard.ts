import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { readDeskNavigationState } from './desk-window.model';
import { DeskWindowService } from './desk-window.service';

/** Dernière garde du shell, aussi sur chaque enfant : ouvre, restaure ou refuse une fenêtre. */
export const deskWindowGuard: CanActivateFn = (_route, state) => {
  const desk = inject(DeskWindowService);
  const router = inject(Router);
  const navigation = readDeskNavigationState(router.getCurrentNavigation()?.extras?.state);
  const decision = desk.evaluate(state.url, navigation);
  if (decision.kind === 'block') {
    desk.explain(decision.reason);
    return false;
  }
  if (decision.kind === 'redirect') return router.parseUrl(decision.url);
  return true;
};
