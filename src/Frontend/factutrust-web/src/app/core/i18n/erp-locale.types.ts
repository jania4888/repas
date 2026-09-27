export type ErpLocale = 'fr' | 'ar';

export const ERP_LOCALES: readonly ErpLocale[] = ['fr', 'ar'] as const;

export const ERP_DIR: Record<ErpLocale, 'ltr' | 'rtl'> = { fr: 'ltr', ar: 'rtl' };

export const ERP_LANG_TAG: Record<ErpLocale, string> = { fr: 'fr-TN', ar: 'ar-TN' };

export const ERP_LOCALE_STORAGE_KEY = 'instafact_erp_locale';

/** Évite les boucles de rechargement lors de la synchro préférence serveur ↔ locale de boot. */
export const ERP_LOCALE_SYNC_RELOAD_KEY = 'instafact_erp_locale_sync_reload';

/**
 * Onglet passé dans un espace qui reste en français (cabinet, portail client…) : le prochain
 * démarrage ne charge pas le catalogue arabe, quelle que soit la langue mémorisée.
 */
export const ERP_FORCE_FR_SESSION_KEY = 'instafact_erp_force_fr';

/** Espaces et pages hors périmètre arabe (reconnus par le chemin). */
export const ERP_FRENCH_ONLY_PATH = /\/(?:firm|portal|platform|auth\/(?:register-firm|accept-portal-invite))(?:[/?#]|$)/i;

export const ERP_RTL_BODY_CLASS = 'erp-rtl';

export const ERP_RTL_LINK_ID = 'factutrust-erp-rtl';

export function normalizeErpLocale(value: unknown): ErpLocale {
  return value === 'ar' ? 'ar' : 'fr';
}
