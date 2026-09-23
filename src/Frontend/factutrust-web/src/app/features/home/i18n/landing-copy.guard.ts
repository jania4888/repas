import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { LandingCopyService } from '../content/landing-copy.service';
import { localeFromUrl } from './landing-locale.util';

/**
 * Charge le dictionnaire de la locale portée par l'URL (`/ar…` → AR) avant d'activer la route,
 * afin que le premier rendu soit déjà dans la bonne langue. Ne bloque jamais : repli FR sur erreur.
 */
export const landingCopyGuard: CanActivateFn = async (_route, state) => {
  const copy = inject(LandingCopyService);
  await copy.ensureLoaded(localeFromUrl(state.url));
  return true;
};
