import type { LandingCopy } from './landing-copy.types';
import { CABINETS_FR } from './fr/cabinets';
import { CONTACT_FR } from './fr/contact';
import { HOME_FR } from './fr/home';
import { SEO_FR } from './fr/seo';
import { SHARED_FR } from './fr/shared';

/** Dictionnaire FR — chargé statiquement (bundle initial). */
export const LANDING_COPY_FR = {
  locale: 'fr',
  shared: SHARED_FR,
  home: HOME_FR,
  cabinets: CABINETS_FR,
  contact: CONTACT_FR,
  seo: SEO_FR
} satisfies LandingCopy;
