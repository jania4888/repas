import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, DOCUMENT } from '@angular/core';
import { environment } from '@environments/environment';
import { LANDING_DIR, type LandingLocale } from '@features/home/content/landing-copy.types';

type ThemeDir = 'ltr' | 'rtl';

const CHAIN_BASE = 'assets/theme/chain/';

export const CHAIN_BOOTSTRAP_LINK_ID = 'factutrust-chain-bootstrap';
export const CHAIN_BOOTSTRAP_NEXT_LINK_ID = 'factutrust-chain-bootstrap-next';
export const CHAIN_THEME_LINK_ID_PREFIX = 'factutrust-chain-theme-';
export const CHAIN_THEME_SCRIPT_ID = 'factutrust-chain-theme-script-0';
export const LANDING_RTL_LINK_ID = 'factutrust-landing-rtl';
export const LANDING_FONT_PRELOAD_ID_PREFIX = 'factutrust-landing-font-';

/** Bootstrap 5.1.3 (LTR embarqué par le thème Chain, RTL ajouté — même version, MIT). */
export const BOOTSTRAP_CSS: Record<ThemeDir, string> = {
  ltr: `${CHAIN_BASE}vendor/bootstrap/css/bootstrap.min.css`,
  rtl: `${CHAIN_BASE}vendor/bootstrap/css/bootstrap.rtl.min.css`
};

/** Feuilles Chain chargées après Bootstrap (owl.css retiré : aucun carrousel sur la landing). */
export const CHAIN_CSS_AFTER_BOOTSTRAP = [
  `${CHAIN_BASE}assets/css/fontawesome.css`,
  `${CHAIN_BASE}assets/css/animated.css`,
  `${CHAIN_BASE}assets/css/templatemo-chain-app-dev.css`
];

/** Bundle global `angular.json` (`inject: false`, `bundleName: landing-rtl`) — nom stable, versionné par query. */
export const LANDING_RTL_CSS = `landing-rtl.css?v=${environment.version}`;

export const CHAIN_ANIMATION_JS = `${CHAIN_BASE}assets/js/animation.js`;

/** Police arabe auto-hébergée (fichiers ajoutés par TD4) — préchargée uniquement en RTL. */
export const LANDING_ARABIC_FONT_PRELOADS = [
  'assets/fonts/noto-sans-arabic/noto-sans-arabic-arabic-400-normal.woff2',
  'assets/fonts/noto-sans-arabic/noto-sans-arabic-arabic-700-normal.woff2'
];

interface WowLike {
  stop?: () => void;
  init?: () => void;
}

/**
 * Charge et décharge les CSS/JS du thème Chain uniquement sur la landing (FR/AR), afin de ne jamais
 * impacter les autres routes (auth, ERP).
 *
 * - `loadChainTheme(locale)` : Bootstrap LTR **ou** RTL, puis fontawesome/animated/templatemo,
 *   `landing-rtl.css` en RTL, `animation.js` (WOW) sauf `prefers-reduced-motion`.
 * - `swapDirection()` : bascule FR ↔ AR sans recharger tout le thème (insère la nouvelle feuille avant
 *   l'ancienne, retire l'ancienne au `load` — jamais de flash non stylé).
 * - `unloadChainTheme()` : différé d'un tick et annulé si un shell se remonte aussitôt (`/` → `/ar`).
 */
@Injectable({ providedIn: 'root' })
export class HomeThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  private loaded = false;
  private dir: ThemeDir = 'ltr';
  private pendingUnload: ReturnType<typeof setTimeout> | null = null;
  private elements: Element[] = [];

  /** Vrai si le thème est actuellement chargé (ou en cours de déchargement différé). */
  get isLoaded(): boolean {
    return this.loaded;
  }

  get currentDir(): ThemeDir {
    return this.dir;
  }

  prefersReducedMotion(): boolean {
    return this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  loadChainTheme(locale: LandingLocale = 'fr'): void {
    if (!isPlatformBrowser(this.platformId) || !this.doc?.head) {
      return;
    }
    this.cancelPendingUnload();
    const dir = LANDING_DIR[locale];

    if (this.loaded) {
      if (this.dir !== dir) {
        this.swapDirection(dir);
      }
      return;
    }

    this.appendLink(CHAIN_BOOTSTRAP_LINK_ID, BOOTSTRAP_CSS[dir]);
    CHAIN_CSS_AFTER_BOOTSTRAP.forEach((href, i) => this.appendLink(`${CHAIN_THEME_LINK_ID_PREFIX}${i}`, href));
    if (dir === 'rtl') {
      this.appendRtlAssets();
    }
    if (!this.prefersReducedMotion()) {
      this.appendScript(CHAIN_THEME_SCRIPT_ID, CHAIN_ANIMATION_JS);
    }

    this.loaded = true;
    this.dir = dir;
  }

  /**
   * Bascule la direction sans recharger les autres feuilles : la nouvelle feuille Bootstrap est insérée
   * **avant** l'ancienne (qui garde donc la priorité en cascade jusqu'au `load`), puis l'ancienne est retirée.
   */
  swapDirection(target: ThemeDir | LandingLocale): void {
    if (!isPlatformBrowser(this.platformId) || !this.doc?.head) {
      return;
    }
    const dir: ThemeDir = target === 'fr' || target === 'ar' ? LANDING_DIR[target] : target;
    if (!this.loaded) {
      this.loadChainTheme(dir === 'rtl' ? 'ar' : 'fr');
      return;
    }
    if (this.dir === dir) {
      return;
    }
    this.dir = dir;

    // Une bascule déjà en cours : on retire la feuille intermédiaire.
    this.doc.getElementById(CHAIN_BOOTSTRAP_NEXT_LINK_ID)?.remove();
    const old = this.doc.getElementById(CHAIN_BOOTSTRAP_LINK_ID) as HTMLLinkElement | null;
    const next = this.appendLink(CHAIN_BOOTSTRAP_NEXT_LINK_ID, BOOTSTRAP_CSS[dir], old ?? undefined);

    const finalize = (): void => {
      // Le shell a quitté la landing pendant le préchargement (unloadChainTheme) :
      // ne rien réinjecter — la feuille « next » n'est plus suivie, on la retire.
      if (!this.loaded) {
        next.remove();
        return;
      }
      if (old) {
        old.remove();
        this.elements = this.elements.filter(e => e !== old);
      }
      next.id = CHAIN_BOOTSTRAP_LINK_ID;
      this.toggleRtlAssets(dir === 'rtl');
      this.resyncAnimations();
    };
    next.addEventListener('load', finalize, { once: true });
    next.addEventListener('error', finalize, { once: true });
  }

  /** Différé d'un tick : annulé si un shell se remonte dans la même navigation. */
  unloadChainTheme(): void {
    if (!isPlatformBrowser(this.platformId) || !this.doc?.head) {
      return;
    }
    this.cancelPendingUnload();
    const win = this.doc.defaultView;
    const schedule = win?.setTimeout.bind(win) ?? setTimeout;
    this.pendingUnload = schedule(() => {
      this.pendingUnload = null;
      this.removeAll();
    }, 0);
  }

  cancelPendingUnload(): void {
    if (this.pendingUnload !== null) {
      clearTimeout(this.pendingUnload);
      this.pendingUnload = null;
    }
  }

  /** WOW 0.1.x ne masque que les `.wow` présents à l'init : à rappeler après un changement de page. */
  resyncAnimations(): void {
    const wow = (globalThis as { wow?: WowLike }).wow;
    if (!wow) {
      return;
    }
    try {
      wow.stop?.();
      wow.init?.();
    } catch {
      /* animation.js absent ou déjà arrêté */
    }
  }

  // ---------------------------------------------------------------------------

  private removeAll(): void {
    for (const el of this.elements) {
      el.remove();
    }
    this.elements = [];
    this.doc.getElementById(CHAIN_BOOTSTRAP_NEXT_LINK_ID)?.remove();
    this.loaded = false;
    this.dir = 'ltr';

    // Arrête les écouteurs/intervalles WOW pour qu'ils ne fuient pas vers les autres routes.
    const wow = (globalThis as { wow?: WowLike }).wow;
    if (wow && typeof wow.stop === 'function') {
      try {
        wow.stop();
      } catch {
        /* ignore */
      }
    }
  }

  private appendRtlAssets(): void {
    LANDING_ARABIC_FONT_PRELOADS.forEach((href, i) => {
      const id = `${LANDING_FONT_PRELOAD_ID_PREFIX}${i}`;
      if (this.doc.getElementById(id)) {
        return;
      }
      const link = this.doc.createElement('link');
      link.id = id;
      link.rel = 'preload';
      link.as = 'font';
      link.type = 'font/woff2';
      link.href = href;
      link.crossOrigin = 'anonymous';
      this.doc.head.appendChild(link);
      this.elements.push(link);
    });
    if (!this.doc.getElementById(LANDING_RTL_LINK_ID)) {
      this.appendLink(LANDING_RTL_LINK_ID, LANDING_RTL_CSS);
    }
  }

  private toggleRtlAssets(rtl: boolean): void {
    if (rtl) {
      this.appendRtlAssets();
      return;
    }
    const ids = [LANDING_RTL_LINK_ID, ...LANDING_ARABIC_FONT_PRELOADS.map((_, i) => `${LANDING_FONT_PRELOAD_ID_PREFIX}${i}`)];
    for (const id of ids) {
      const el = this.doc.getElementById(id);
      if (el) {
        el.remove();
        this.elements = this.elements.filter(e => e !== el);
      }
    }
  }

  private appendLink(id: string, href: string, before?: Element): HTMLLinkElement {
    const link = this.doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.id = id;
    if (before?.parentNode) {
      before.parentNode.insertBefore(link, before);
    } else {
      this.doc.head.appendChild(link);
    }
    this.elements.push(link);
    return link;
  }

  private appendScript(id: string, src: string): HTMLScriptElement {
    const script = this.doc.createElement('script');
    script.type = 'text/javascript';
    script.src = src;
    script.id = id;
    (this.doc.body ?? this.doc.head).appendChild(script);
    this.elements.push(script);
    return script;
  }
}
