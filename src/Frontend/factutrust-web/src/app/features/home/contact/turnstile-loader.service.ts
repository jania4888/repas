import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, DOCUMENT } from '@angular/core';
import { environment } from '@environments/environment';
import { TURNSTILE_LOAD_TIMEOUT_MS, TURNSTILE_SCRIPT_ID, TURNSTILE_SCRIPT_URL, type TurnstileApi } from './turnstile.types';

/**
 * Charge le script Turnstile **une seule fois**, et uniquement si `environment.turnstileSiteKey` est renseignée
 * (sinon aucune requête tierce). Résout dès que `window.turnstile` existe ; rejette après 8 s ou sur erreur réseau.
 */
@Injectable({ providedIn: 'root' })
export class TurnstileLoaderService {
  private readonly doc = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private loading: Promise<TurnstileApi> | null = null;

  get enabled(): boolean {
    return isPlatformBrowser(this.platformId) && environment.turnstileSiteKey.trim() !== '';
  }

  load(): Promise<TurnstileApi> {
    if (!this.enabled) {
      return Promise.reject(new Error('Turnstile désactivé (turnstileSiteKey vide)'));
    }
    this.loading ??= this.inject().catch(err => {
      this.loading = null; // autoriser une nouvelle tentative (ex. bouton « Réessayer »)
      throw err;
    });
    return this.loading;
  }

  private inject(): Promise<TurnstileApi> {
    const win = this.doc.defaultView;
    if (win?.turnstile) {
      return Promise.resolve(win.turnstile);
    }
    return new Promise<TurnstileApi>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (!settled) {
          settled = true;
          win?.clearTimeout(timer);
          fn();
        }
      };
      const timer = win?.setTimeout(
        () => finish(() => reject(new Error('Turnstile : délai de chargement dépassé'))),
        TURNSTILE_LOAD_TIMEOUT_MS
      );
      const poll = (): void => {
        if (win?.turnstile) {
          finish(() => resolve(win.turnstile as TurnstileApi));
        } else if (!settled) {
          win?.setTimeout(poll, 50);
        }
      };

      let script = this.doc.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
      if (!script) {
        script = this.doc.createElement('script');
        script.id = TURNSTILE_SCRIPT_ID;
        script.src = TURNSTILE_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.addEventListener('error', () => finish(() => reject(new Error('Turnstile : script indisponible'))));
        this.doc.head.appendChild(script);
      }
      script.addEventListener('load', poll);
      poll();
    });
  }
}
