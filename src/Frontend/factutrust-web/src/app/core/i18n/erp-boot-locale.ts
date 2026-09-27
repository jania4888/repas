import { loadTranslations } from '@angular/localize';
import {
  ERP_FORCE_FR_SESSION_KEY,
  ERP_LOCALE_STORAGE_KEY,
  normalizeErpLocale,
  type ErpLocale
} from './erp-locale.types';

/** Locale effective après chargement des traductions (utilisée par LOCALE_ID). */
export let erpBootEffectiveLocale: ErpLocale = 'fr';

/** Réservé aux tests : binding de module, non réassignable via import. */
export function setErpBootEffectiveLocaleForTests(value: ErpLocale): void {
  erpBootEffectiveLocale = value;
}

/**
 * Vrai seulement si l'arabe a été demandé et que le catalogue a été refusé.
 * La session reste alors en français de gauche à droite.
 */
export let erpBootArabicCatalogRejected = false;

/** Réservé aux tests : le drapeau est un binding de module, non réassignable via import. */
export function setErpBootArabicCatalogRejectedForTests(value: boolean): void {
  erpBootArabicCatalogRejected = value;
}

/** Plafond du corps JSON. Le catalogue actuel dépasse 512 Ko ; 2 Mio garde une marge et un refus. */
export const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

/** Résolution de locale avant bootstrap (aucun import applicatif). */
export function resolveBootLocale(arabicEnabled: boolean): ErpLocale {
  if (!arabicEnabled) {
    return 'fr';
  }
  try {
    if (sessionStorage.getItem(ERP_FORCE_FR_SESSION_KEY) === '1') {
      return 'fr';
    }
    const raw = localStorage.getItem(ERP_LOCALE_STORAGE_KEY);
    return normalizeErpLocale(raw) ?? 'fr';
  } catch {
    return 'fr';
  }
}

function applyDocumentLocale(locale: ErpLocale): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.setAttribute('lang', locale === 'ar' ? 'ar' : 'fr');
  document.documentElement.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}

/**
 * Charge messages.ar.json si demandé ; en cas d'échec, bascule en français sans bloquer le bootstrap.
 * @returns locale effective pour le reste de la session
 */
export async function prepareBootLocale(requested: ErpLocale): Promise<ErpLocale> {
  if (requested !== 'ar') {
    erpBootEffectiveLocale = 'fr';
    erpBootArabicCatalogRejected = false;
    applyDocumentLocale('fr');
    return 'fr';
  }

  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let catalogUrl = 'assets/i18n/messages.ar.json';
    try {
      const mod = await import('./erp-i18n-manifest.generated');
      if (mod?.ERP_I18N_MANIFEST?.messagesUrl) {
        catalogUrl = mod.ERP_I18N_MANIFEST.messagesUrl;
      }
    } catch {
      /* manifest absent en dev avant premier i18n:build */
    }

    const res = await fetch(catalogUrl, {
      cache: 'no-cache',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const contentLength = Number(res.headers.get('content-length') ?? 0);
    if (contentLength > MAX_CATALOG_BYTES) {
      throw new Error('Catalogue trop volumineux');
    }

    const text = await res.text();
    if (text.length > MAX_CATALOG_BYTES) {
      throw new Error('Catalogue trop volumineux');
    }

    const body = JSON.parse(text) as { translations?: Record<string, unknown> };
    const raw = body.translations ?? {};
    const translations: Record<string, string> = {};
    for (const [id, value] of Object.entries(raw)) {
      if (typeof value !== 'string' || !value.trim()) {
        continue;
      }
      translations[id] = value;
    }
    loadTranslations(translations);
    erpBootArabicCatalogRejected = false;
    erpBootEffectiveLocale = 'ar';
    applyDocumentLocale('ar');
    return 'ar';
  } catch (err) {
    console.warn('[i18n] repli français au démarrage', err);
    erpBootArabicCatalogRejected = true;
    erpBootEffectiveLocale = 'fr';
    applyDocumentLocale('fr');
    return 'fr';
  }
}
