import { NavigationExtras } from '@angular/router';

/** Plafond de fenêtres vivantes dans un dossier. Au-delà, l'ouverture est refusée. */
export const DESK_WINDOW_CAP = 8;

/** Bureau vide : aucune fenêtre au premier plan. */
export const DESK_HOME_URL = '/desk';

export const DESK_SESSION_PREFIX = 'ft:desk:v1:';

export interface DeskWindow {
  id: string;
  /** Identité stable (chemin, ou saisie + entryId). Les filtres n'en font pas partie. */
  key: string;
  /** Dernière URL complète, filtres compris. */
  url: string;
  title: string;
  minimized: boolean;
  /** `delegated:<contextTenantId>` lu à l'ouverture. */
  tenantKey: string;
  openedAt: number;
  lastFocusedAt: number;
  /** Vrai quand une instance détachée est en mémoire. */
  hydrated: boolean;
}

export interface DeskSessionRecord {
  key: string;
  url: string;
  title: string;
  minimized: boolean;
  lastFocusedAt: number;
}

/**
 * État porté par `NavigationExtras.state`.
 * `close-current` retire la fenêtre quittée. `deskDiscardConfirmed` évite une seconde
 * confirmation après un enregistrement déjà accepté.
 */
export interface DeskNavigationState {
  deskAction?: 'preserve' | 'close-current';
  deskDiscardConfirmed?: boolean;
}

export interface DeskDetachedHandle {
  componentRef?: { instance?: unknown; destroy?: () => void };
  contexts?: unknown;
  route?: unknown;
}

export function withDeskClose(discardConfirmed: boolean, extras: NavigationExtras = {}): NavigationExtras {
  const previous = (extras.state ?? {}) as Record<string, unknown>;
  return {
    ...extras,
    state: {
      ...previous,
      deskAction: 'close-current',
      deskDiscardConfirmed: discardConfirmed
    } satisfies DeskNavigationState
  };
}

export function readDeskNavigationState(state: unknown): DeskNavigationState {
  if (!state || typeof state !== 'object') return {};
  const record = state as DeskNavigationState;
  return {
    deskAction: record.deskAction,
    deskDiscardConfirmed: record.deskDiscardConfirmed === true
  };
}
