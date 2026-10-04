import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal, DOCUMENT } from '@angular/core';
import { ErpDocumentLocaleBridge } from '@core/i18n/erp-document-locale.bridge';
import {
  LANDING_DIR,
  LANDING_LANG_TAG,
  type LandingLocale
} from '@features/home/content/landing-copy.types';

export const LANDING_LOCALE_STORAGE_KEY = 'instafact_landing_locale';
export const LANDING_RTL_BODY_CLASS = 'landing-rtl';

/**
 * État de langue/direction de la landing (FR/AR). Pose `lang` et `dir` sur `<html>`
 * et `body.landing-rtl` ; l'ERP reste FR/LTR via `restore()`.
 * Aucune redirection automatique : `preferred()` n'est qu'une indication (plan D.4.3).
 */
@Injectable({ providedIn: 'root' })
export class LandingLocaleService {
  private readonly doc = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly erpLocaleBridge = inject(ErpDocumentLocaleBridge);
  private readonly _locale = signal<LandingLocale>('fr');

  readonly locale = this._locale.asReadonly();
  readonly dir = computed(() => LANDING_DIR[this._locale()]);
  readonly isRtl = computed(() => this.dir() === 'rtl');
  readonly langTag = computed(() => LANDING_LANG_TAG[this._locale()]);

  /** Appelé par le shell de la landing à l'init (avant `loadChainTheme`). Idempotent. */
  apply(locale: LandingLocale): void {
    this._locale.set(locale);
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const html = this.doc.documentElement;
    html.setAttribute('lang', locale);
    html.setAttribute('dir', LANDING_DIR[locale]);
    this.doc.body?.classList.toggle(LANDING_RTL_BODY_CLASS, locale === 'ar');
    try {
      localStorage.setItem(LANDING_LOCALE_STORAGE_KEY, locale);
    } catch {
      /* navigation privée / stockage désactivé */
    }
  }

  /** Appelé à la destruction du shell : l'application repart en FR/LTR, puis dans la langue ERP de la session. */
  restore(): void {
    this._locale.set('fr');
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const html = this.doc.documentElement;
    html.setAttribute('lang', 'fr');
    html.setAttribute('dir', 'ltr');
    this.doc.body?.classList.remove(LANDING_RTL_BODY_CLASS);
    this.erpLocaleBridge.reapply?.();
  }

  /** Langue mémorisée (indication seulement, jamais de redirection). */
  preferred(): LandingLocale | null {
    try {
      const v = localStorage.getItem(LANDING_LOCALE_STORAGE_KEY);
      return v === 'ar' || v === 'fr' ? v : null;
    } catch {
      return null;
    }
  }
}
