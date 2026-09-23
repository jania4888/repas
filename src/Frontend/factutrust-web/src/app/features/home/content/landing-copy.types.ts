/**
 * Modèle de contenu typé de la landing publique (accueil, page cabinets, formulaire, header/footer, SEO).
 *
 * Deux dictionnaires l'implémentent avec `satisfies LandingCopy` :
 *  - `landing-copy.fr.ts` (référence, importé statiquement) ;
 *  - `landing-copy.ar.ts` (chargé UNIQUEMENT par `import('./landing-copy.ar')` — jamais d'import statique).
 * Toute clé FR manquante ou en trop en AR est une erreur de compilation ; `landing-copy.parity.spec.ts`
 * vérifie ce que le compilateur ne voit pas (longueurs de tableaux, placeholders, HTML interdit…).
 *
 * Règles de rédaction (plan § 4.3) :
 *  - aucune balise HTML dans une chaîne ; l'emphase inline passe par `RichText` + `<app-landing-rich>` ;
 *  - aucun prix ni statistique en dur : ils viennent de `landing-pricing.ts` / `landing-facts.ts` et sont
 *    injectés par `LandingCopyService.format()` via les placeholders `{amount}`, `{count}`, `{percent}`,
 *    `{year}`, `{seconds}`, `{reference}`, `{email}`, `{min}`, `{max}` ;
 *  - listes = tableaux typés (jamais `item1`, `item2`) ; la ponctuation fait partie de la chaîne ;
 *  - limites de longueur documentées en JSDoc (AR ≤ FR × 1,3, vérifié par TD7).
 */
import type { ContactRequestSize, ContactRequestSubject } from '../contact/contact-request.models';

export type LandingLocale = 'fr' | 'ar';
export const LANDING_LOCALES: readonly LandingLocale[] = ['fr', 'ar'] as const;
export const LANDING_DIR: Record<LandingLocale, 'ltr' | 'rtl'> = { fr: 'ltr', ar: 'rtl' };
export const LANDING_LANG_TAG: Record<LandingLocale, string> = { fr: 'fr-TN', ar: 'ar-TN' };

/** Segment de texte riche sans HTML. `ltr` isole un nombre, un sigle ou un e-mail en RTL. */
export interface RichSegment {
  text: string;
  kind?: 'strong' | 'em' | 'ltr';
}
export type RichText = readonly RichSegment[];

// ---------------------------------------------------------------------------------------------
// Zone partagée (header, footer, CTA, sélecteur de langue)
// ---------------------------------------------------------------------------------------------

/** Libellés ouvert / fermé d'un CTA dynamique (`LandingCtaComponent`). ≤ 32 caractères. */
export interface LandingCtaLabels {
  open: string;
  closed: string;
}

export interface LandingSharedCopy {
  brand: {
    /** Toujours « InstaFact » (jamais translittéré en AR). */
    name: string;
    tagline: string;
    logoAlt: string;
  };
  /** Entrées de navigation du header (desktop + tiroir mobile). ≤ 24 caractères. */
  nav: {
    home: string;
    modules: string;
    newFeatures: string;
    pricing: string;
    cabinets: string;
    security: string;
    faq: string;
    login: string;
    menuOpen: string;
    menuClose: string;
    /** `aria-label` du `<nav>` principal. */
    menuLabel: string;
  };
  langSwitcher: {
    /** `aria-label` du sélecteur. */
    label: string;
    fr: string;
    ar: string;
    /** `aria-label` de chaque lien (« Passer en arabe »…). */
    switchTo: Record<LandingLocale, string>;
  };
  cta: {
    company: LandingCtaLabels;
    firm: LandingCtaLabels;
    /** Texte accessible du squelette affiché tant que l'état d'inscription est inconnu. */
    skeleton: string;
  };
  /** Rue virtuelle 3D — libellés préservés pour les tests e2e (« Visite virtuelle », « Rue InstaFact »). */
  virtualTour: {
    link: string;
    title: string;
    text: string;
  };
  footer: {
    baseline: string;
    logoAlt: string;
    product: { title: string; modules: string; newFeatures: string; pricing: string; security: string; faq: string };
    segments: { title: string; sme: string; cabinets: string; virtualTour: string };
    resources: { title: string; faq: string; contact: string; login: string };
    legal: { title: string; terms: string; legalNotice: string };
    /** Placeholder `{year}`. */
    copyright: string;
  };
  common: {
    skipToContent: string;
    learnMore: string;
    /** Suffixe imposé pour toute fonction sous flag : « (selon activation) ». */
    uponActivation: string;
    /** Devise affichée après le montant (« TND » / « د.ت »). */
    currency: string;
    perMonth: string;
    perYear: string;
  };
}

// ---------------------------------------------------------------------------------------------
// Accueil (rempli par TA3 ; structure = plan § 5.2)
// ---------------------------------------------------------------------------------------------

export interface LandingTitledItem {
  title: string;
  text: string;
}

export interface LandingIconItem extends LandingTitledItem {
  /** Classe d'icône PrimeIcons (`pi-*`) — conservée identique en AR, le CSS retourne les flèches. */
  icon: string;
}

export interface LandingFaqItem {
  question: string;
  answer: string;
  /** Réponse alternative quand l'inscription est ouverte (Q1 de l'accueil). */
  answerWhenOpen?: string;
}

export interface LandingSectionHeading {
  kicker: string;
  title: string;
  subtitle: string;
}

/** Copy d'un plan tarifaire ; les montants viennent de `LANDING_PRICING`. */
export interface LandingPlanCopy {
  name: string;
  badge: string;
  highlight: string;
  features: string[];
  disabledFeatures: string[];
  /** Libellé du CTA quand l'inscription est ouverte (fermé → `shared.cta.company.closed`). */
  cta: string;
}

export interface LandingHomeCopy {
  promo: {
    open: { text: string; cta: string };
    closed: { text: string; cta: string };
    dismiss: string;
    region: string;
  };
  hero: {
    kicker: string;
    /** H1 unique de la page. ≤ 110 caractères. */
    title: string;
    subtitle: string;
    ctaOpenNote: string;
    ctaClosedNote: string;
    secondaryCta: string;
    /** Placeholder `{count}` (nombre de modules). */
    modulesLink: string;
    imageAlt: string;
  };
  trustStrip: {
    /** Placeholders `{count}`. */
    modules: string;
    roles: string;
    aiTools: string;
    badges: string[];
  };
  problemSolution: {
    title: string;
    items: { problem: string; answer: string }[];
  };
  modules: LandingSectionHeading & {
    tabs: { id: string; label: string; title: string; tagline: string; points: string[] }[];
  };
  features: LandingSectionHeading & { items: LandingIconItem[] };
  ai: LandingSectionHeading & {
    providers: LandingTitledItem[];
    capabilities: string;
    guardrails: string;
    availability: string;
  };
  forecasting: LandingSectionHeading & {
    points: string[];
    chartCaption: string;
    illustrativeNote: string;
  };
  newFeatures: LandingSectionHeading & {
    inAppLabel: string;
    items: { title: string; text: string; location: string }[];
    footnote: string;
  };
  cabinetTeaser: LandingSectionHeading & {
    bullets: string[];
    cta: string;
    demoLink: string;
  };
  pricing: LandingSectionHeading & {
    reassurance: string;
    plans: { free: LandingPlanCopy; monthly: LandingPlanCopy; annual: LandingPlanCopy };
    /** Placeholder `{percent}`. */
    savingsBadge: string;
    /** Placeholder `{amount}`. */
    billedYearly: string;
    /** Placeholder `{amount}`. */
    annualSaving: string;
    cabinet: { title: string; text: string; cta: string; link: string };
    enterprise: { title: string; text: string; cta: string };
    faqTitle: string;
    faq: LandingFaqItem[];
  };
  useCases: LandingSectionHeading & {
    /** `cssClass` conservée pour les tests e2e (`persona-accountant`…). */
    personas: { cssClass: string; title: string; text: string; cta: string }[];
  };
  comparison: LandingSectionHeading & {
    ourLabel: string;
    otherLabel: string;
    criteria: string[];
  };
  compliance: LandingSectionHeading & { cards: LandingIconItem[] };
  security: LandingSectionHeading & { points: LandingTitledItem[] };
  integrations: LandingSectionHeading & { items: LandingIconItem[] };
  stats: {
    /** Libellés seuls ; les valeurs viennent de `LANDING_FACTS`. */
    modules: string;
    roles: string;
    aiTools: string;
    dedicatedDb: string;
  };
  trust: LandingSectionHeading & { cards: LandingIconItem[] };
  faq: LandingSectionHeading & { items: LandingFaqItem[] };
  finalCta: {
    titleOpen: string;
    titleClosed: string;
    subtitle: string;
    loginLink: string;
  };
}

// ---------------------------------------------------------------------------------------------
// Page « Cabinets comptables » (remplie par TB3 ; structure = plan § 6.2)
// ---------------------------------------------------------------------------------------------

export interface LandingCabinetsCopy {
  hero: {
    kicker: string;
    /** H1 unique. */
    title: string;
    subtitle: string;
    bullets: string[];
    secondaryCta: string;
    /** Sous le CTA ouvert : « Inscription en 3 étapes… ». */
    openNote: string;
  };
  howItWorks: { title: string; steps: LandingTitledItem[] };
  features: {
    title: string;
    subtitle: string;
    /** Symbole d'appel de note (« * »). */
    activationMark: string;
    families: { title: string; items: string[] }[];
    footnote: string;
  };
  roles: { title: string; cards: LandingTitledItem[]; banner: string };
  security: { title: string; facts: LandingTitledItem[]; aiNote: string; moreLink: string };
  offer: { title: string; text: string; bullets: string[]; note: string; cta: string; pricingLink: string };
  faq: { title: string; items: LandingFaqItem[] };
  /** En-tête de la section `#contact` de la page cabinet (« Parlons de votre cabinet »). */
  contact: { title: string; lead: string };
}

// ---------------------------------------------------------------------------------------------
// Formulaire de demande d'accès / de démo (rempli par TB7 ; structure = plan § 6.4)
// ---------------------------------------------------------------------------------------------

export interface LandingFieldCopy {
  label: string;
  placeholder: string;
  hint: string;
}

export interface LandingContactCopy {
  /** En-tête de la section `#contact` de l'accueil. */
  title: string;
  lead: string;
  subjects: Record<ContactRequestSubject, string>;
  fields: {
    subject: LandingFieldCopy;
    fullName: LandingFieldCopy;
    organization: LandingFieldCopy;
    email: LandingFieldCopy;
    phone: LandingFieldCopy;
    size: LandingFieldCopy;
    message: LandingFieldCopy;
    consent: { label: string; linkLabel: string };
    /** Champ piège (hors écran) — libellé neutre. */
    website: { label: string };
  };
  sizes: {
    none: string;
    dossiers: { value: ContactRequestSize; label: string }[];
    employes: { value: ContactRequestSize; label: string }[];
  };
  /** Placeholders `{count}` et `{max}`. */
  messageCounter: string;
  submit: { idle: string; submitting: string; retry: string; another: string };
  /** Segments de réassurance, chacun retirable indépendamment. */
  reassurance: string[];
  success: {
    title: string;
    /** Placeholder `{reference}`. */
    reference: string;
    text: string;
  };
  errors: {
    required: string;
    /** Placeholder `{min}`. */
    minLength: string;
    /** Placeholder `{max}`. */
    maxLength: string;
    email: string;
    phone: string;
    consent: string;
    validationGlobal: string;
    /** Placeholder `{seconds}`. */
    rateLimited: string;
    rateLimitedFallback: string;
    /** Placeholder `{email}`. */
    disabled: string;
    network: string;
    unknown: string;
    turnstileUnavailable: string;
  };
  turnstile: { ariaLabel: string };
}

// ---------------------------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------------------------

export interface LandingSeoPageCopy {
  /** ≤ 60 caractères. */
  title: string;
  /** ≤ 160 caractères. */
  description: string;
}

export interface LandingSeoCopy {
  home: LandingSeoPageCopy;
  cabinets: LandingSeoPageCopy;
}

// ---------------------------------------------------------------------------------------------
// Racine
// ---------------------------------------------------------------------------------------------

export interface LandingCopy {
  locale: LandingLocale;
  shared: LandingSharedCopy;
  home: LandingHomeCopy;
  cabinets: LandingCabinetsCopy;
  contact: LandingContactCopy;
  seo: LandingSeoCopy;
}
