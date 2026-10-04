
import { Injectable, inject, DOCUMENT } from '@angular/core';

/** Hauteur du header fixe de la landing à compenser lors du défilement vers une ancre. */
export const LANDING_HEADER_OFFSET_PX = 80;
export const LANDING_SCROLL_RETRY_MS = 300;
export const LANDING_SCROLL_MAX_RETRIES = 3;

/**
 * Défilement vers les ancres de la landing (`#tarifs`, `#contact`…), utilisé par le header,
 * le shell (fragment de route) et les CTA. Respecte `prefers-reduced-motion`.
 */
@Injectable({ providedIn: 'root' })
export class LandingScrollService {
  private readonly doc = inject(DOCUMENT);

  prefersReducedMotion(): boolean {
    return this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  /**
   * Défile vers `#id` en compensant le header ; ré-essaie jusqu'à 3 fois (300 ms) pour les sections
   * rendues après le premier paint (`@defer`). Donne le focus à la cible si elle porte `tabindex`.
   * Retourne `true` si la cible a été trouvée immédiatement.
   */
  scrollToAnchor(id: string, attempt = 0): boolean {
    const win = this.doc.defaultView;
    const el = this.doc.getElementById(id);
    if (!el || !win) {
      if (attempt < LANDING_SCROLL_MAX_RETRIES) {
        win?.setTimeout(() => this.scrollToAnchor(id, attempt + 1), LANDING_SCROLL_RETRY_MS);
      }
      return false;
    }
    const top = Math.max(0, el.getBoundingClientRect().top + win.scrollY - LANDING_HEADER_OFFSET_PX);
    win.scrollTo({ top, behavior: this.prefersReducedMotion() ? 'auto' : 'smooth' });
    if (el.hasAttribute('tabindex')) {
      el.focus({ preventScroll: true });
    }
    return true;
  }

  /** Alias historique de `scrollToAnchor`. */
  scrollTo(id: string): boolean {
    return this.scrollToAnchor(id);
  }

  scrollToTop(): void {
    this.doc.defaultView?.scrollTo({ top: 0, behavior: this.prefersReducedMotion() ? 'auto' : 'smooth' });
  }
}
