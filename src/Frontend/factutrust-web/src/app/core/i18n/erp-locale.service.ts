import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '@environments/environment';
import { AuthService } from '@core/services/auth.service';
import { ErpPreferencesService } from '@core/services/erp-preferences.service';
import { erpBootArabicCatalogRejected, erpBootEffectiveLocale } from './erp-boot-locale';
import { ErpDocumentLocaleBridge } from './erp-document-locale.bridge';
import {
  ERP_DIR,
  ERP_FORCE_FR_SESSION_KEY,
  ERP_FRENCH_ONLY_PATH,
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
 *
 * Les traductions sont chargées une fois, avant le démarrage : `html[dir]` suit toujours le
 * catalogue réellement chargé, et changer de langue passe par un rechargement de l'onglet.
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

  constructor() {
    inject(ErpDocumentLocaleBridge).reapply = () => this.reapplyFromStorage();
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    // Connexion, déconnexion ou navigation vers un espace qui reste en français.
    this.router?.events
      ?.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.enforceFrenchOnlyScope());
    if (this.auth?.user) {
      effect(() => {
        this.auth!.user();
        untracked(() => this.enforceFrenchOnlyScope());
      });
    }
  }

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
    return this.arabicEnabled() && !this.mustForceFrench();
  }

  /** Résolution initiale (APP_INITIALIZER). */
  resolve(options?: { userPreferredLanguage?: string | null }): ErpLocale {
    if (!this.arabicEnabled() || this.mustForceFrench()) {
      this._userPreference.set(null);
      this.apply('fr', { persist: false });
      return 'fr';
    }
    this.clearForceFrench();

    const fromUser = options?.userPreferredLanguage
      ? normalizeErpLocale(options.userPreferredLanguage)
      : null;
    const fromStorage = this.readStorage();
    const boot = erpBootEffectiveLocale;

    if (erpBootArabicCatalogRejected) {
      this._userPreference.set(fromUser);
      this.apply('fr', { persist: false });
      return 'fr';
    }

    const wanted: ErpLocale = fromUser ?? fromStorage ?? boot;
    if (wanted !== boot && isPlatformBrowser(this.platformId) && this.claimSyncReload()) {
      this.writeStorage(wanted);
      this.reload();
      return wanted;
    }

    this._userPreference.set(fromUser);
    if (!fromUser && fromStorage && this.auth?.isAuthenticated?.() && this.prefs) {
      void this.prefs.setLanguage(fromStorage);
    }

    // Seule la langue du catalogue chargé peut s'afficher sans rechargement.
    this.apply(boot, { persist: false });
    return boot;
  }

  /** Cabinet, portail client, plateforme : ces espaces restent en français. */
  private mustForceFrench(): boolean {
    if (this.auth?.isAccountingFirm?.() || this.auth?.isClientPortal?.()) {
      return true;
    }
    return ERP_FRENCH_ONLY_PATH.test(this.currentPath());
  }

  /** Avant la navigation initiale, `router.url` vaut `/` : lire alors l'adresse du document. */
  private currentPath(): string {
    if (this.router?.navigated) {
      return this.router.url;
    }
    const loc = this.doc.defaultView?.location;
    return loc ? `${loc.pathname}${loc.search}` : (this.router?.url ?? '');
  }

  /**
   * Un espace qui reste en français ne tourne jamais avec le catalogue arabe chargé (connexion
   * d'un utilisateur cabinet depuis une page en arabe, par exemple) : l'onglet repart en français.
   */
  private enforceFrenchOnlyScope(): void {
    if (!this.arabicEnabled() || erpBootEffectiveLocale !== 'ar' || !this.mustForceFrench()) {
      return;
    }
    try {
      sessionStorage.setItem(ERP_FORCE_FR_SESSION_KEY, '1');
    } catch {
      // Sans ce marqueur, le rechargement redémarrerait en arabe : se contenter du sens LTR.
      this.apply('fr', { persist: false });
      return;
    }
    this.reload();
  }

  private clearForceFrench(): void {
    try {
      sessionStorage.removeItem(ERP_FORCE_FR_SESSION_KEY);
    } catch {
      /* navigation privée */
    }
  }

  /** Au plus un rechargement de synchronisation par session d'onglet (pas de boucle). */
  private claimSyncReload(): boolean {
    try {
      if (sessionStorage.getItem(ERP_LOCALE_SYNC_RELOAD_KEY)) {
        return false;
      }
      sessionStorage.setItem(ERP_LOCALE_SYNC_RELOAD_KEY, '1');
      return true;
    } catch {
      return false;
    }
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

  /** Après sortie de la landing : réappliquer la langue ERP de la session (celle du catalogue chargé). */
  reapplyFromStorage(): void {
    if (erpBootArabicCatalogRejected || this.mustForceFrench()) {
      this.apply('fr', { persist: false });
      return;
    }
    this.apply(erpBootEffectiveLocale, { persist: false });
  }

  async setLocaleAndReload(locale: ErpLocale): Promise<void> {
    if (locale === 'ar' && (!this.arabicEnabled() || this.mustForceFrench())) {
      return;
    }
    this.writeStorage(locale);
    this.clearForceFrench();
    if (isPlatformBrowser(this.platformId)) {
      this.reload();
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

  /** Point unique de rechargement (remplacé dans les tests). */
  protected reload(): void {
    this.doc.defaultView?.location.reload();
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
