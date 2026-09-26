import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '@environments/environment';
import { AuthService } from '@core/services/auth.service';
import { ErpPreferencesService } from '@core/services/erp-preferences.service';
import { erpBootEffectiveLocale } from './erp-boot-locale';
import {
  ERP_DIR,
  ERP_LANG_TAG,
  ERP_LOCALE_STORAGE_KEY,
  ERP_LOCALE_SYNC_RELOAD_KEY,
  ERP_RTL_BODY_CLASS,
  ERP_RTL_LINK_ID,
  normalizeErpLocale,
  type ErpLocale
} from './erp-locale.types';

export const ERP_RTL_CSS = `erp-rtl.css?v=${environment.version}`;

/**
 * Locale ERP (FR/AR). Seul service autorisé à poser `html[lang][dir]` hors landing active.
 */
@Injectable({ providedIn: 'root' })
export class ErpLocaleService {
  private readonly doc = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router, { optional: true });
  private readonly auth = inject(AuthService, { optional: true });
  private readonly prefs = inject(ErpPreferencesService, { optional: true });
  private readonly _locale = signal<ErpLocale>('fr');
  private readonly _userPreference = signal<ErpLocale | null>(null);

  readonly locale = this._locale.asReadonly();
  readonly dir = computed(() => ERP_DIR[this._locale()]);
  readonly isRtl = computed(() => this.dir() === 'rtl');
  readonly langTag = computed(() => ERP_LANG_TAG[this._locale()]);

  arabicEnabled(): boolean {
    return Boolean(environment.erp?.arabicEnabled);
  }

  effectiveLocale(): ErpLocale {
    if (!this.arabicEnabled()) {
      return 'fr';
    }
    return this._locale();
  }

  /** Affiche le sélecteur (espace société uniquement, drapeau actif). */
  shouldShowLanguageSwitcher(): boolean {
    if (!this.arabicEnabled()) {
      return false;
    }
    if (this.auth?.isAccountingFirm?.()) {
      return false;
    }
    const url = this.router?.url ?? '';
    if (/\/(firm|portal|platform)(\/|$)/i.test(url)) {
      return false;
    }
    if (/\/auth\/(register-firm|accept-portal-invite)(\/|$)/i.test(url)) {
      return false;
    }
    return true;
  }

  /** Résolution initiale (APP_INITIALIZER). */
  resolve(options?: { userPreferredLanguage?: string | null }): ErpLocale {
    if (!this.arabicEnabled() || this.mustForceFrench()) {
      this._userPreference.set(null);
      this.apply('fr', { persist: false });
      return 'fr';
    }

    const fromUser = options?.userPreferredLanguage
      ? normalizeErpLocale(options.userPreferredLanguage)
      : null;
    const fromStorage = this.readStorage();
    const boot = erpBootEffectiveLocale;

    if (fromUser && fromUser !== boot && isPlatformBrowser(this.platformId)) {
      const reloaded = sessionStorage.getItem(ERP_LOCALE_SYNC_RELOAD_KEY);
      if (!reloaded) {
        sessionStorage.setItem(ERP_LOCALE_SYNC_RELOAD_KEY, '1');
        this.writeStorage(fromUser);
        this.doc.defaultView?.location.reload();
        return fromUser;
      }
    }

    let loc: ErpLocale = fromUser ?? fromStorage ?? boot ?? 'fr';
    this._userPreference.set(fromUser);

    if (!fromUser && fromStorage && this.auth?.isAuthenticated?.() && this.prefs) {
      void this.prefs.setLanguage(fromStorage);
    }

    this.apply(loc, { persist: !fromUser && fromStorage === loc });
    return loc;
  }

  private mustForceFrench(): boolean {
    if (this.auth?.isAccountingFirm?.()) {
      return true;
    }
    const url = this.router?.url ?? '';
    return /\/(firm|portal|platform)(\/|$)/i.test(url);
  }

  apply(locale: ErpLocale, options?: { persist?: boolean }): void {
    const effective = this.arabicEnabled() ? locale : 'fr';
    this._locale.set(effective);
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const html = this.doc.documentElement;
    html.setAttribute('lang', effective);
    html.setAttribute('dir', ERP_DIR[effective]);
    this.doc.body?.classList.toggle(ERP_RTL_BODY_CLASS, effective === 'ar');
    if (effective === 'ar') {
      this.ensureRtlStylesheet();
      this.preloadArabicFont();
    } else {
      this.removeRtlStylesheet();
    }
    if (options?.persist !== false) {
      this.writeStorage(effective);
    }
  }

  /** Après sortie de la landing : réappliquer la locale ERP mémorisée. */
  reapplyFromStorage(): void {
    this.apply(this.readStorage() ?? 'fr');
  }

  async setLocaleAndReload(locale: ErpLocale): Promise<void> {
    if (!this.arabicEnabled() && locale === 'ar') {
      return;
    }
    this.writeStorage(locale);
    if (isPlatformBrowser(this.platformId)) {
      this.doc.defaultView?.location.reload();
    }
  }

  readStorage(): ErpLocale | null {
    try {
      const v = localStorage.getItem(ERP_LOCALE_STORAGE_KEY);
      return v === 'ar' || v === 'fr' ? v : null;
    } catch {
      return null;
    }
  }

  private writeStorage(locale: ErpLocale): void {
    try {
      localStorage.setItem(ERP_LOCALE_STORAGE_KEY, locale);
    } catch {
      /* navigation privée */
    }
  }

  private ensureRtlStylesheet(): void {
    const head = this.doc.head;
    if (!head || this.doc.getElementById(ERP_RTL_LINK_ID)) {
      return;
    }
    const link = this.doc.createElement('link');
    link.id = ERP_RTL_LINK_ID;
    link.rel = 'stylesheet';
    link.href = ERP_RTL_CSS;
    head.appendChild(link);
  }

  private removeRtlStylesheet(): void {
    this.doc.getElementById(ERP_RTL_LINK_ID)?.remove();
  }

  private preloadArabicFont(): void {
    const head = this.doc.head;
    if (!head) return;
    const id = 'factutrust-erp-noto-preload';
    if (this.doc.getElementById(id)) return;
    const link = this.doc.createElement('link');
    link.id = id;
    link.rel = 'preload';
    link.as = 'font';
    link.type = 'font/woff2';
    link.crossOrigin = 'anonymous';
    link.href =
      'assets/fonts/noto-sans-arabic/noto-sans-arabic-arabic-400-normal.woff2';
    head.appendChild(link);
  }
}
