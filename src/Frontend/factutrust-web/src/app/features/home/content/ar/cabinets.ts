// TODO-AR : traduction arabe à livrer par TD7 (copie FR provisoire, structure figée par TD1).
import type { LandingCabinetsCopy } from '../landing-copy.types';

/**
 * Page Cabinets FR — SQUELETTE TYPÉ (TD1). Structure définitive (plan § 6.2 / B.3) ;
 * texte brouillon finalisé par TB2. Aucun chiffre ni prix ici.
 */
export const CABINETS_AR: LandingCabinetsCopy = {
  hero: {
    kicker: 'Version Cabinet comptable',
    title: 'Tous vos dossiers clients, votre équipe et vos honoraires dans un seul espace',
    subtitle:
      'InstaFact Cabinet réunit la tenue comptable, la fiscalité et la paie de chaque client dans des dossiers isolés, avec des rôles cabinet et un suivi des missions.',
    bullets: [
      'Un dossier par société cliente, isolé et complet',
      'Chaque collaborateur ne voit que ses dossiers affectés',
      'Honoraires, temps et rentabilité du cabinet'
    ],
    secondaryCta: 'Voir les fonctionnalités',
    openNote: 'Espace cabinet créé en ligne ; l’offre cabinet est ensuite établie sur devis.'
  },
  howItWorks: {
    title: 'Comment ça marche',
    steps: [
      { title: 'Créez votre cabinet', text: 'Nom, matricule fiscal, coordonnées : votre espace cabinet est prêt.' },
      { title: 'Ajoutez vos dossiers clients', text: 'Chaque société cliente devient un dossier isolé avec sa propre comptabilité.' },
      { title: 'Affectez vos collaborateurs', text: 'Responsable ou collaborateur : chacun accède uniquement à ses dossiers.' },
      { title: 'Pilotez missions et honoraires', text: 'Suivez le temps passé, facturez vos honoraires et mesurez la rentabilité.' }
    ]
  },
  features: {
    title: 'Ce que la version Cabinet ajoute',
    subtitle: 'Des fonctions dédiées au cabinet, en plus de tous les modules InstaFact dans chaque dossier.',
    activationMark: 'selon activation',
    families: [
      {
        title: 'Multi-dossiers',
        items: ['Un dossier isolé par client', 'Tableau de bord consolidé du cabinet', 'Bascule rapide entre dossiers']
      },
      {
        title: 'Équipe et affectations',
        items: ['Rôles Responsable et Collaborateur', 'Affectation par dossier', 'Journal d’audit des accès']
      },
      {
        title: 'Missions et honoraires',
        items: ['Missions récurrentes ou ponctuelles', 'Temps passé par dossier', 'Facturation des honoraires']
      },
      {
        title: 'Comptabilité et fiscalité par dossier',
        items: ['Plan comptable et états NCT', 'Déclaration mensuelle et échéancier', 'Paie CNSS / IRPP']
      }
    ],
    footnote: 'Certaines fonctions s’activent selon le paramétrage de votre cabinet.'
  },
  roles: {
    title: 'Des rôles pensés pour le cabinet',
    cards: [
      { title: 'Responsable de cabinet', text: 'Voit tous les dossiers, gère l’équipe, les affectations et les honoraires.' },
      { title: 'Collaborateur', text: 'Travaille uniquement dans les dossiers qui lui sont affectés.' },
      { title: 'Client du cabinet', text: 'Accède à son propre dossier avec les rôles InstaFact habituels.' }
    ],
    banner: 'Chaque dossier client conserve ses propres rôles et son propre journal d’audit.'
  },
  security: {
    title: 'Sécurité et confidentialité des dossiers',
    facts: [
      { title: 'Isolation', text: 'Une base de données par dossier client ; aucun mélange entre sociétés.' },
      { title: 'Accès', text: 'Authentification avec double facteur (2FA) et permissions par rôle.' },
      { title: 'Traçabilité', text: 'Journal d’audit chaîné par dossier et au niveau du cabinet.' },
      { title: 'Réversibilité', text: 'Exports FEC, PDF et Excel disponibles à tout moment.' }
    ],
    aiNote: 'L’assistant IA travaille dossier par dossier, avec des modèles hébergés sur nos serveurs par défaut.',
    moreLink: 'Voir la sécurité InstaFact'
  },
  offer: {
    title: 'Offre Cabinet — sur devis',
    text: 'Le tarif dépend du nombre de dossiers et de collaborateurs. Une démo personnalisée précède toute proposition.',
    bullets: ['Tous les modules InstaFact dans chaque dossier', 'Accompagnement à la mise en place', 'Support prioritaire'],
    note: 'Sans engagement de durée.',
    cta: 'Demander une démo cabinet',
    pricingLink: 'Voir les tarifs entreprises'
  },
  faq: {
    title: 'Questions des cabinets',
    items: [
      {
        question: 'Mes clients peuvent-ils accéder à leur dossier ?',
        answer: 'Oui : chaque client dispose de ses propres utilisateurs et rôles dans son dossier.'
      },
      {
        question: 'Puis-je migrer un client existant vers mon cabinet ?',
        answer: 'Oui, un dossier InstaFact existant peut être rattaché à votre cabinet.'
      },
      {
        question: 'Comment sont facturés les honoraires ?',
        answer: 'Depuis le cabinet, avec vos propres factures d’honoraires ; le temps passé est suivi par dossier.'
      },
      {
        question: 'Le cabinet voit-il les données de tous les dossiers ?',
        answer: 'Le responsable oui ; les collaborateurs uniquement leurs dossiers affectés.'
      }
    ]
  },
  contact: {
    title: 'Demander une démo cabinet',
    lead: 'Décrivez votre cabinet : nous vous recontactons pour une démonstration personnalisée.'
  }
};
