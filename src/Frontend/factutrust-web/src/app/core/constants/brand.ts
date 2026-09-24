export const BRAND = {
  name: 'InstaFact',
  shortName: 'IF',
  tagline: 'GESTION COMMERCIALE INTELLIGENTE',
  taglineShort: 'GESTION COMMERCIALE',
  taglineLong: 'Plateforme de gestion commerciale intelligente',
  streetName: 'Rue InstaFact',
  // Variantes WebP à taille d'affichage (les PNG d'origine font ~950 Ko pour 56 px de haut).
  logoLockup: 'assets/branding/instafact-lockup.webp',
  logoIcon: 'assets/branding/instafact-icon.webp',
  logoLockupOnDark: 'assets/branding/instafact-lockup-on-dark.webp',
  logoIconOnDark: 'assets/branding/instafact-icon-on-dark.webp',
} as const;

export function pageTitle(page: string): string {
  return `${page} \u2014 ${BRAND.name}`;
}

export function brandAlt(suffix = ''): string {
  return suffix ? `${BRAND.name} \u2014 ${suffix}` : BRAND.name;
}
