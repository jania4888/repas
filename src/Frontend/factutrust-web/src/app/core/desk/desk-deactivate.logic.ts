import { Router } from '@angular/router';
import { DeskNavigationState, readDeskNavigationState } from './desk-window.model';
import { isDeskHomeUrl, isDeskWindowUrl } from './desk-window-key';

export interface DeskDeactivateContext {
  enabled: boolean;
  bypass: boolean;
  state: DeskNavigationState;
  nextUrl: string;
}

/**
 * Changer ou réduire de fenêtre garde le composant : la garde de sortie ne doit pas demander
 * « quitter la page ? ». Fermer, ou sortir du dossier, laisse la garde d'origine s'exécuter.
 */
export function shouldBypassDeskDeactivate(context: DeskDeactivateContext): boolean {
  if (!context.enabled) return false;
  if (context.bypass || context.state.deskDiscardConfirmed) return true;
  if (context.state.deskAction === 'close-current') return false;
  return isDeskWindowUrl(context.nextUrl) || isDeskHomeUrl(context.nextUrl);
}

export function currentDeskNavigation(router: Router): { state: DeskNavigationState; nextUrl: string } {
  const navigation = router.getCurrentNavigation();
  const nextUrl = navigation?.extractedUrl?.toString() ?? navigation?.finalUrl?.toString() ?? '';
  return { state: readDeskNavigationState(navigation?.extras?.state), nextUrl };
}
