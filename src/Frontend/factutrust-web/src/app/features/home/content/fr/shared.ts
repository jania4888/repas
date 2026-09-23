import type { LandingSharedCopy } from '../landing-copy.types';

/** Zone partagée FR (header, footer, CTA, sélecteur de langue). Texte final — TD1. */
export const SHARED_FR: LandingSharedCopy = {
  brand: {
    name: 'InstaFact',
    tagline: 'Gestion commerciale intelligente',
    logoAlt: 'InstaFact — gestion commerciale, comptabilité et paie'
  },
  nav: {
    home: 'Accueil',
    modules: 'Modules',
    newFeatures: 'Nouveautés',
    pricing: 'Tarifs',
    cabinets: 'Cabinets comptables',
    security: 'Sécurité',
    faq: 'FAQ',
    login: 'Se connecter',
    menuOpen: 'Ouvrir le menu',
    menuClose: 'Fermer le menu',
    menuLabel: 'Navigation principale'
  },
  langSwitcher: {
    label: 'Choix de la langue',
    fr: 'FR',
    ar: 'العربية',
    switchTo: {
      fr: 'Afficher la page en français',
      ar: 'Afficher la page en arabe'
    }
  },
  cta: {
    company: {
      open: 'Créer un compte gratuit',
      closed: 'Demander un accès'
    },
    firm: {
      open: 'Créer mon espace cabinet',
      closed: 'Demander une démo cabinet'
    },
    skeleton: 'Chargement du bouton d’action'
  },
  virtualTour: {
    link: 'Visite virtuelle',
    title: 'Rue InstaFact',
    text: 'Parcourez la rue virtuelle des entreprises qui utilisent InstaFact.'
  },
  footer: {
    baseline: 'InstaFact — gestion commerciale, comptabilité et paie pour les entreprises tunisiennes.',
    logoAlt: 'InstaFact',
    product: {
      title: 'Produit',
      modules: 'Modules',
      newFeatures: 'Nouveautés',
      pricing: 'Tarifs',
      security: 'Sécurité',
      faq: 'FAQ'
    },
    segments: {
      title: 'Segments',
      sme: 'PME et commerces',
      cabinets: 'Cabinets comptables',
      virtualTour: 'Visite virtuelle 3D'
    },
    resources: {
      title: 'Ressources',
      faq: 'Questions fréquentes',
      contact: 'Contact',
      login: 'Se connecter'
    },
    legal: {
      title: 'Légal',
      terms: 'Conditions d’utilisation',
      legalNotice: 'Mentions légales'
    },
    copyright: '© {year} InstaFact. Tous droits réservés.'
  },
  common: {
    skipToContent: 'Aller au contenu',
    learnMore: 'En savoir plus',
    uponActivation: '(selon activation)',
    currency: 'TND',
    perMonth: '/mois',
    perYear: '/an'
  }
};
