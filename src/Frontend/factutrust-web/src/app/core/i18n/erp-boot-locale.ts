import { loadTranslations } from '@angular/localize';
import {
  ERP_LOCALE_STORAGE_KEY,
  normalizeErpLocale,
  type ErpLocale
} from './erp-locale.types';

/** Locale effective après chargement des traductions (utilisée par LOCALE_ID). */
export let erpBootEffectiveLocale: ErpLocale = 'fr';

const MAX_CATALOG_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8000;

/** Résolution de locale avant bootstrap (aucun import applicatif). */
export function resolveBootLocale(arabicEnabled: boolean): ErpLocale {
  if (!arabicEnabled) {
    return 'fr';
  }
  try {
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
    erpBootEffectiveLocale = 'ar';
    applyDocumentLocale('ar');
    return 'ar';
  } catch (err) {
    console.warn('[i18n] repli français au démarrage', err);
    erpBootEffectiveLocale = 'fr';
    applyDocumentLocale('fr');
    return 'fr';
  }
}
