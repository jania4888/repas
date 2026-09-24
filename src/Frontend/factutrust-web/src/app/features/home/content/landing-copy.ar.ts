import type { LandingCopy } from './landing-copy.types';
import { CABINETS_AR } from './ar/cabinets';
import { CONTACT_AR } from './ar/contact';
import { HOME_AR } from './ar/home';
import { SEO_AR } from './ar/seo';
import { SHARED_AR } from './ar/shared';

/**
 * Dictionnaire AR — chargé UNIQUEMENT via `import('./landing-copy.ar')` (chunk séparé).
 * Ne jamais l'importer statiquement depuis le code applicatif.
 */
export const LANDING_COPY_AR = {
  locale: 'ar',
  shared: SHARED_AR,
  home: HOME_AR,
  cabinets: CABINETS_AR,
  contact: CONTACT_AR,
  seo: SEO_AR
} satisfies LandingCopy;
