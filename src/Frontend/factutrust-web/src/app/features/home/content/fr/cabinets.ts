import type { LandingCabinetsCopy } from '../landing-copy.types';

/**
 * Page « Cabinets comptables » — copy FR finale (TB3 ; plan § 6.2, part B § B.3).
 *
 * Aucun chiffre ni prix : l'offre cabinet est « sur devis » et le seul chiffre du bloc est
 * « 3 étapes » (parcours d'inscription vérifié). Les fonctions sous flag (gouvernance,
 * révision, paie, IA, immobilisations) portent l'astérisque `activationMark`, renvoyée par
 * la note unique `features.footnote`. Aucune promesse de délai de réponse (exclusion § 6.1).
 */
export const CABINETS_FR: LandingCabinetsCopy = {
  hero: {
    kicker: 'Version Cabinet comptable',
    title: 'Vos dossiers. Votre équipe. Une vue d’ensemble.',
    subtitle:
      'InstaFact réunit vos dossiers clients, vos collaborateurs et vos honoraires dans un espace cabinet dédié, avec une comptabilité tunisienne complète pour chaque société.',
    bullets: [
      'Une base de données par dossier client',
      'Chaque collaborateur ne voit que ses dossiers affectés',
      'Journal d’audit chaîné et signé (HMAC-SHA256)'
    ],
    secondaryCta: 'Voir comment ça marche',
    openNote: 'Inscription en 3 étapes : Compte, Cabinet, Adresse & visibilité.'
  },
  howItWorks: {
    title: 'Comment ça marche',
    steps: [
      {
        title: 'Créez votre cabinet',
        text: 'Un compte Responsable cabinet, les informations du cabinet (matricule fiscal, numéro d’inscription professionnelle) et votre adresse.'
      },
      {
        title: 'Ajoutez vos dossiers clients',
        text: 'Créez un dossier pour une société sans compte InstaFact, ou acceptez la demande de liaison d’une société déjà inscrite.'
      },
      {
        title: 'Travaillez en équipe',
        text: 'Invitez vos collaborateurs, affectez-leur des dossiers et ouvrez chaque dossier dans son espace comptable dédié.'
      }
    ]
  },
  features: {
    title: 'Tout ce qu’un cabinet gère au quotidien',
    subtitle: 'Cinq familles de fonctions, du portefeuille aux honoraires.',
    activationMark: '*',
    families: [
      {
        title: 'Portefeuille & dossiers',
        items: [
          'Tableau de bord : échéances en retard, dossiers inactifs, invitations en attente',
          'Échéancier fiscal multi-dossiers : dépôts, paiements, rappels, pièces jointes',
          'Création de dossiers pour des sociétés sans compte InstaFact',
          'Demandes de liaison envoyées par les sociétés déjà inscrites',
          'Échanges cabinet-client : messages et pièces au même endroit'
        ]
      },
      {
        title: 'Équipe & gouvernance',
        items: [
          'Collaborateurs et affectation des dossiers',
          'Dossiers permanents*',
          'Feuilles de temps avec chronomètre*',
          'Rentabilité par dossier et par collaborateur*',
          'Notes de frais, congés et absences*',
          'Paie interne du cabinet*'
        ]
      },
      {
        title: 'Honoraires',
        items: [
          'Devis, factures et avoirs d’honoraires',
          'Codes d’activité et lignes détaillées',
          'TVA et retenue à la source',
          'Encaissements',
          'Facturation récurrente'
        ]
      },
      {
        title: 'Comptabilité & fiscalité par dossier',
        items: [
          'Plan comptable NCT, journaux, grand livre, balances',
          'Lettrage et rapprochement bancaire',
          'TVA et déclaration mensuelle',
          'Retenues à la source et export TEJ',
          'États financiers NCT, clôture, export FEC',
          'Immobilisations et amortissements*',
          'Paie des sociétés clientes : CNSS, IRPP'
        ]
      },
      {
        title: 'Assistant IA « Chef de mission »*',
        items: [
          'Questions en langage naturel sur le portefeuille',
          'Réponses appuyées uniquement sur les données de vos dossiers',
          'Rappels proposés, jamais envoyés sans votre confirmation',
          'Une aide, pas un décideur.'
        ]
      }
    ],
    footnote:
      '* Fonctions disponibles selon leur activation et les permissions accordées par le Responsable cabinet.'
  },
  roles: {
    title: 'Deux rôles, des droits clairs',
    cards: [
      {
        title: 'Responsable cabinet',
        text: 'Crée les dossiers, invite les collaborateurs, affecte les dossiers, gère les honoraires et les paramètres du cabinet. Voit tous les dossiers actifs.'
      },
      {
        title: 'Collaborateur',
        text: 'Travaille sur les dossiers qui lui sont affectés : comptabilité, déclarations, échanges avec le client. Ne voit que ses dossiers.'
      },
      {
        title: 'Assistant IA « Chef de mission »*',
        text: 'Répond aux questions du cabinet à partir des dossiers auxquels l’utilisateur a accès. Une aide, pas un décideur.'
      }
    ],
    banner: 'Chaque ouverture de dossier crée un accès délégué, limité au dossier choisi et tracé dans le journal d’audit.'
  },
  security: {
    title: 'Chaque dossier reste isolé',
    facts: [
      {
        title: 'Une base de données par dossier client',
        text: 'Les écritures d’une société ne partagent jamais la base d’une autre.'
      },
      {
        title: 'Accès délégué et tracé',
        text: 'L’ouverture d’un dossier génère un jeton limité à ce dossier ; les actions sont journalisées.'
      },
      {
        title: 'Journal d’audit inviolable',
        text: 'Chaque entrée est chaînée et signée (HMAC-SHA256) : toute altération est détectable.'
      },
      {
        title: 'Authentification renforcée',
        text: 'Connexion JWT et double authentification (2FA).'
      }
    ],
    aiNote:
      'L’assistant peut fonctionner sur un modèle exécuté sur nos serveurs, avec une option cloud selon la configuration.',
    moreLink: 'En savoir plus sur la sécurité'
  },
  offer: {
    title: 'Offre Cabinet — sur devis',
    text: 'Une offre cabinet distincte des forfaits entreprise, adaptée au nombre de dossiers et de collaborateurs.',
    bullets: [
      'Démonstration personnalisée sur vos cas réels',
      'Formation de vos collaborateurs',
      'Conditions partenaires dédiées pour les cabinets qui accompagnent leurs clients sur InstaFact'
    ],
    note: 'Aucune carte bancaire requise. Les forfaits entreprise restent disponibles pour vos sociétés clientes.',
    cta: 'Demander une démo cabinet',
    pricingLink: 'Voir les tarifs entreprise'
  },
  faq: {
    title: 'Questions fréquentes des cabinets',
    items: [
      {
        question: 'Chaque collaborateur voit-il tous les dossiers ?',
        answer:
          'Non. Un collaborateur ne voit que les dossiers qui lui sont affectés par le Responsable cabinet. Le Responsable cabinet voit l’ensemble des dossiers actifs du cabinet.'
      },
      {
        question: 'Mes clients doivent-ils avoir un compte InstaFact ?',
        answer:
          'Non. Vous pouvez créer un dossier pour une société qui n’a pas de compte. Si le client utilise déjà InstaFact, il vous envoie une demande de liaison que vous acceptez depuis votre espace.'
      },
      {
        question: 'Puis-je facturer mes honoraires depuis InstaFact ?',
        answer:
          'Oui : devis, factures et avoirs d’honoraires, avec TVA et retenue à la source, encaissements et facturation récurrente.'
      },
      {
        question: 'Comment fonctionne l’assistant Chef de mission ?',
        answer:
          'Il répond à partir des données de vos dossiers et refuse de répondre lorsqu’il ne dispose pas d’éléments. Il propose des actions, par exemple un rappel, que vous confirmez avant envoi. Disponible selon activation.'
      },
      {
        question: 'Les données de mes dossiers sont-elles séparées ?',
        answer:
          'Oui. Chaque dossier client dispose de sa propre base de données et l’accès se fait par un jeton délégué limité à ce dossier.'
      },
      {
        question: 'Combien coûte la version Cabinet ?',
        answer:
          'L’offre Cabinet est établie sur devis, selon le nombre de dossiers et de collaborateurs. Demandez une démo : nous revenons vers vous avec une proposition.'
      },
      {
        question: 'Puis-je tester avant de m’engager ?',
        answer:
          'Oui, lors d’une démonstration personnalisée sur vos cas réels. Lorsque l’inscription cabinet est ouverte, vous pouvez aussi créer votre espace directement.'
      }
    ]
  },
  contact: {
    title: 'Parlons de votre cabinet',
    lead: 'Décrivez votre cabinet et vos besoins : nous vous recontactons rapidement.'
  }
};
