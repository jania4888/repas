// TODO-AR : traduction arabe à livrer par TD7 (copie FR provisoire, structure figée par TD1).
import type { LandingHomeCopy } from '../landing-copy.types';

/** Copie provisoire du FR (TA3) — la traduction arabe (TD7) remplace les valeurs, pas la structure. */
/**
 * Accueil FR — copy finale (TA3), conforme au plan § 5.2 / A.4 (termes interdits : § 5.3).
 * Aucun prix ni statistique en dur : `{count}`, `{amount}`, `{percent}` et `{year}` sont
 * injectés par les composants depuis `landing-pricing.ts` et les constantes de faits
 * (modules activables, rôles, outils IA).
 */
export const HOME_AR: LandingHomeCopy = {
  promo: {
    open: {
      text: 'Offre de lancement Tunisie — {count} factures et {count} devis par mois gratuits, sans carte bancaire.',
      cta: 'Créer un compte gratuit'
    },
    closed: {
      text: 'Nouveau en {year} : RH & Paie, Immobilisations, États financiers NCT, Déclaration mensuelle et version Cabinet comptable.',
      cta: 'Voir les nouveautés'
    },
    dismiss: 'Fermer la bannière',
    region: 'Annonce'
  },
  hero: {
    kicker: 'Gestion commerciale, comptabilité et paie — pensé pour la Tunisie',
    title: 'Facturez, tenez votre comptabilité et payez vos équipes dans une seule plateforme tunisienne.',
    subtitle:
      'Facturation conforme TEJ, comptabilité NCT, paie CNSS/IRPP, déclaration mensuelle, stock, projets et un assistant IA qui tourne sur vos serveurs. Pour les PME et les cabinets comptables.',
    ctaOpenNote: '{count} factures par mois, sans carte bancaire.',
    ctaClosedNote: 'L’inscription en ligne est sur invitation : décrivez votre besoin, nous vous recontactons.',
    secondaryCta: 'Découvrir la version Cabinet comptable',
    modulesLink: 'Voir les {count} modules',
    imageAlt: 'Aperçu du tableau de bord InstaFact'
  },
  trustStrip: {
    modules: '{count} modules activables',
    roles: '{count} rôles utilisateurs',
    aiTools: '{count}+ outils IA métier',
    badges: [
      'Facturation TEJ (XML + retenue à la source)',
      'Plan comptable & états NCT',
      'Journal d’audit chaîné (HMAC-SHA256)'
    ]
  },
  problemSolution: {
    title: 'Trois irritants du quotidien, trois réponses concrètes',
    items: [
      {
        problem: 'Facturer, relancer, exporter pour le comptable : trois outils, trois ressaisies.',
        answer:
          'Devis, factures, avoirs, encaissements et écritures comptables partagent la même base. Le comptable exporte le FEC ou travaille directement dans le dossier.'
      },
      {
        problem: 'La retenue à la source, la TVA et la déclaration mensuelle se calculent à la main.',
        answer:
          'InstaFact applique les taux paramétrés, génère les certificats de retenue et prépare la déclaration mensuelle avec son échéancier.'
      },
      {
        problem: 'La paie et les immobilisations vivent dans des fichiers Excel fragiles.',
        answer:
          'Bulletins CNSS/IRPP, soldes de tout compte, fiches d’immobilisations et dotations sont dans la même plateforme, avec un journal d’audit.'
      }
    ]
  },
  modules: {
    kicker: 'Tout est inclus · {count} modules activables',
    title: 'Une plateforme, des modules que vous activez selon votre activité',
    subtitle: 'Chaque module s’active depuis les paramètres, sans changer d’outil.',
    tabs: [
      {
        id: 'invoices',
        label: 'Facturation & TEJ',
        title: 'Facturation & TEJ',
        tagline: 'Des factures conformes, envoyées et suivies',
        points: ['Devis → facture → avoir', 'XML TEJ et certificats de retenue à la source', 'Relances et encaissements']
      },
      {
        id: 'pos',
        label: 'Point de vente',
        title: 'Point de vente',
        tagline: 'Encaissez en caisse, synchronisé avec le stock',
        points: ['Tickets, remises, clôture de caisse', 'Stock décrémenté en direct', 'Rôle Caissier dédié']
      },
      {
        id: 'stock',
        label: 'Stock & achats',
        title: 'Stock & achats',
        tagline: 'Du bon de commande fournisseur au transfert entre dépôts',
        points: ['Achats et réceptions', 'Transferts inter-dépôts et bons de retour', 'Alertes de réapprovisionnement']
      },
      {
        id: 'treasury',
        label: 'Trésorerie & banque',
        title: 'Trésorerie & banque',
        tagline: 'Suivez encaissements, dépôts et rapprochement',
        points: ['Comptes et dépôts', 'Rapprochement bancaire par import', 'Trésorerie prévisionnelle (selon activation)']
      },
      {
        id: 'accounting',
        label: 'Comptabilité NCT',
        title: 'Comptabilité NCT',
        tagline: 'Une comptabilité complète, pas un simple export',
        points: ['Écritures, lettrage, clôture', 'Bilan, compte de résultat, états NCT, livre d’inventaire', 'Export FEC']
      },
      {
        id: 'fiscal',
        label: 'Fiscalité',
        title: 'Fiscalité',
        tagline: 'Déclaration mensuelle et échéancier sous contrôle',
        points: ['Configuration, calcul et suivi de la DM', 'Détermination du résultat fiscal', 'Échéancier fiscal avec rappels']
      },
      {
        id: 'payroll',
        label: 'RH & Paie',
        title: 'RH & Paie',
        tagline: 'La paie tunisienne, de l’embauche au solde de tout compte',
        points: ['Bulletins, CNSS, IRPP', 'Régularisation IRPP et déclarations', 'Livre et journal de paie']
      },
      {
        id: 'assets',
        label: 'Immobilisations',
        title: 'Immobilisations',
        tagline: 'Amortissements calculés, écritures générées',
        points: ['Fiches et catégories', 'Tableau d’amortissement, dotations', 'Paramétrage des méthodes']
      },
      {
        id: 'projects',
        label: 'Projets & contrats',
        title: 'Projets & contrats',
        tagline: 'Suivez le temps, facturez les contrats récurrents',
        points: ['Projets, tâches, feuilles de temps', 'Contrats récurrents et brouillons à valider', 'Commandes clients et carnet']
      },
      {
        id: 'crm',
        label: 'CRM & portail client',
        title: 'CRM & portail client',
        tagline: 'Vos clients suivent leurs factures en libre-service',
        points: ['Pipeline commercial', 'Portail : factures PDF, paiements, relevé', 'Tarifs négociés et promotions']
      },
      {
        id: 'ai',
        label: 'IA & Studio',
        title: 'IA & Studio',
        tagline: 'Un assistant qui agit dans vos données, sur vos serveurs',
        points: [
          'Plus de {toolsCount} outils métier',
          'Modèles locaux (Ollama) ou cloud au choix (OpenRouter)',
          'Studio : tables, formulaires, workflows sans code'
        ]
      },
      {
        id: 'forecasting',
        label: 'Prévisions',
        title: 'Prévisions',
        tagline: 'Anticipez ventes et stock avec le calendrier tunisien',
        points: ['Prévisions de ventes', 'Classification ABC/XYZ', 'Ramadan, Aïd et fêtes intégrés']
      }
    ]
  },
  features: {
    kicker: 'Fonctionnalités',
    title: 'Tout ce dont une entreprise tunisienne a besoin',
    subtitle: 'Des documents commerciaux à la paie, chaque fonction est disponible dans l’application.',
    items: [
      {
        icon: 'pi-file',
        title: 'Documents commerciaux complets',
        text: 'Devis, commandes, bons de livraison, factures, avoirs et bons de retour, numérotés et liés entre eux.'
      },
      {
        icon: 'pi-lock',
        title: 'Scellement et traçabilité',
        text: 'Chaque document est scellé (HMAC-SHA256) et chaque action est inscrite dans un journal d’audit chaîné.'
      },
      {
        icon: 'pi-download',
        title: 'Exports comptables et fiscaux',
        text: 'XML TEJ, certificats de retenue à la source, FEC, PDF et Excel.'
      },
      {
        icon: 'pi-microchip-ai',
        title: 'Assistant IA souverain',
        text: 'Posez vos questions, laissez l’IA créer ou retrouver des documents : plus de {toolsCount} outils, modèles hébergés chez vous.'
      },
      { icon: 'pi-box', title: 'Stock multi-dépôts', text: 'Réceptions, transferts, inventaires et alertes.' },
      {
        icon: 'pi-users',
        title: '{rolesCount} rôles et permissions fines',
        text: 'De l’administrateur au caissier, chaque profil ne voit que ce dont il a besoin.'
      },
      {
        icon: 'pi-send',
        title: 'Envoi et relances par e-mail',
        text: 'Factures et relances envoyées depuis l’application ; WhatsApp et Telegram selon activation.'
      },
      { icon: 'pi-wallet', title: 'Paie CNSS / IRPP', text: 'Bulletins, déclarations, régularisations et soldes de tout compte.' },
      {
        icon: 'pi-globe',
        title: 'Portail client',
        text: 'Vos clients consultent factures, paiements et relevé sans vous appeler.'
      }
    ]
  },
  ai: {
    kicker: 'Intelligence artificielle',
    title: 'Une IA qui connaît votre entreprise — et reste chez vous',
    subtitle: 'Un assistant métier, des modèles hébergés sur votre serveur, une option cloud activable.',
    providers: [
      {
        title: 'Local (Ollama)',
        text: 'Modèles Qwen 2.5 et Gemma 3 exécutés sur votre serveur : vos données ne sortent pas.'
      },
      {
        title: 'Cloud en option (OpenRouter)',
        text: 'Activable par l’administrateur si vous souhaitez un modèle plus puissant.'
      }
    ],
    capabilities:
      'Plus de {count} outils : créer un devis, retrouver une facture, expliquer un solde, importer une facture fournisseur depuis une photo.',
    guardrails:
      'L’assistant répond à partir de vos données et de règles de contrôle (grounding) ; il ne remplace pas votre comptable.',
    availability: 'Disponible selon la configuration de votre instance.'
  },
  forecasting: {
    kicker: 'Prévisions',
    title: 'Anticipez vos ventes et votre stock',
    subtitle: 'Prévisions de ventes, classification ABC/XYZ et calendrier commercial tunisien.',
    points: ['Prévisions de ventes par produit', 'Classification ABC/XYZ du stock', 'Ramadan, Aïd et fêtes intégrés au calendrier'],
    chartCaption: 'Exemple illustratif',
    illustrativeNote: 'Données fictives à titre d’illustration.'
  },
  newFeatures: {
    kicker: 'Nouveautés {year}',
    title: 'Ce qui est arrivé dans InstaFact cette année',
    subtitle: 'Des modules livrés, pas des promesses : chacun est disponible aujourd’hui dans l’application.',
    inAppLabel: 'Dans l’app',
    items: [
      {
        title: 'RH & Paie tunisienne',
        text: 'Bulletins, CNSS, IRPP, régularisations, soldes de tout compte, livre et journal de paie.',
        location: 'Paie › Salariés, Cycles de paie'
      },
      {
        title: 'Immobilisations & amortissements',
        text: 'Fiches, tableau d’amortissement, dotations et écritures générées.',
        location: 'Comptabilité › Immobilisations'
      },
      {
        title: 'États financiers NCT',
        text: 'Bilan, compte de résultat, états NCT, livre d’inventaire, détermination du résultat fiscal.',
        location: 'Comptabilité › États financiers'
      },
      {
        title: 'Déclaration mensuelle & échéancier',
        text: 'Configuration, calcul et suivi de la DM (TVA, retenues, FODEC, TCL selon paramétrage) ; échéancier fiscal.',
        location: 'Comptabilité › Déclaration mensuelle'
      },
      {
        title: 'Contrats récurrents',
        text: 'Abonnements et contrats : factures générées, brouillons à valider avant envoi.',
        location: 'Ventes › Contrats récurrents'
      },
      {
        title: 'Projets & feuilles de temps',
        text: 'Projets, tâches, temps passé et facturation du temps.',
        location: 'Projets'
      },
      {
        title: 'Commandes clients',
        text: 'Carnet de commandes, confirmation, bon de livraison et facture générés depuis la commande.',
        location: 'Ventes › Commandes'
      },
      {
        title: 'Tarification & promotions',
        text: 'Grilles tarifaires, promotions et conditions de paiement par client.',
        location: 'Ventes › Tarification'
      },
      {
        title: 'Portail client',
        text: 'Vos clients consultent factures (PDF), paiements et relevé en libre-service.',
        location: 'Portail client'
      },
      {
        title: 'Studio IA (low-code)',
        text: 'Tables, formulaires, vues et workflows d’approbation créés sans code, assistés par l’IA.',
        location: 'Studio'
      },
      {
        title: 'Audit comptable continu',
        text: 'Règles de contrôle, anomalies détectées, commentaires et planification des contrôles.',
        location: 'Comptabilité › Contrôle d’intégrité'
      },
      {
        title: 'Bons de retour & transferts',
        text: 'Retours clients tracés et transferts entre dépôts.',
        location: 'Stock › Transferts, Ventes › Bons de retour'
      },
      {
        title: 'Rapprochement bancaire & lettrage',
        text: 'Import de relevé, rapprochement et lettrage des comptes tiers.',
        location: 'Comptabilité › Rapprochement'
      }
    ],
    footnote:
      'Trésorerie prévisionnelle, envoi WhatsApp/Telegram et code-barres sont disponibles selon activation par votre administrateur.'
  },
  cabinetTeaser: {
    kicker: 'Pour les cabinets comptables',
    title: 'Une version pensée pour les cabinets',
    subtitle: 'Pilotez tous vos dossiers clients, votre équipe et vos honoraires depuis un seul espace.',
    bullets: [
      'Un dossier par société cliente, isolé et complet',
      'Chaque collaborateur ne voit que ses dossiers affectés',
      'Honoraires, temps et rentabilité du cabinet'
    ],
    cta: 'Découvrir la version Cabinet',
    demoLink: 'Demander une démo'
  },
  pricing: {
    kicker: 'Tarifs',
    title: 'Des tarifs simples, en dinars, sans surprise',
    subtitle: 'Un plan gratuit pour démarrer, des plans payants sans engagement.',
    reassurance: 'Sans carte bancaire. Sans engagement. Annulation en un clic depuis votre espace.',
    plans: {
      free: {
        name: 'Gratuit',
        badge: 'Idéal pour tester',
        highlight: '{count} factures gratuites par mois',
        features: [
          '{count} factures par mois',
          '{count} devis par mois',
          'Jusqu’à {count} clients',
          'Jusqu’à {count} produits ou services',
          '{amount} de stockage documents',
          'Jusqu’à {count} utilisateurs',
          'Export PDF (factures & devis)',
          'Découverte des modules InstaFact (sous quotas)'
        ],
        disabledFeatures: ['Export XML TEJ', 'Scellement des documents', 'Support prioritaire'],
        cta: 'Commencer gratuitement'
      },
      monthly: {
        name: 'Mensuel',
        badge: 'Sans engagement',
        highlight: 'Factures, devis, clients & produits illimités',
        features: [
          'Factures, devis, clients & produits illimités',
          'Achats, stock multi-dépôts, trésorerie & banque',
          'Comptabilité NCT, CRM et fiscalité',
          'Assistant IA — chat et outils métier',
          'Prévisions de ventes et de stock',
          'Export PDF & XML TEJ, certificats de retenue',
          'Scellement des documents (HMAC-SHA256)',
          'Suivi des paiements et rapports',
          '{amount} de stockage documents'
        ],
        disabledFeatures: ['Support prioritaire'],
        cta: 'Choisir Mensuel'
      },
      annual: {
        name: 'Annuel',
        badge: 'Le plus avantageux',
        highlight: 'Tout le plan Mensuel, moins cher',
        features: [
          'Factures, devis, clients & produits illimités',
          'Achats, stock multi-dépôts, trésorerie & banque',
          'Comptabilité NCT, CRM et fiscalité',
          'Assistant IA — chat et outils métier',
          'Prévisions de ventes et de stock',
          'Export PDF & XML TEJ, certificats de retenue',
          'Scellement des documents (HMAC-SHA256)',
          'Suivi des paiements et rapports',
          '{amount} de stockage documents',
          'Support prioritaire'
        ],
        disabledFeatures: [],
        cta: 'Choisir Annuel'
      }
    },
    savingsBadge: 'Économisez {percent} %',
    billedYearly: 'Facturé {amount} par an',
    annualSaving: 'Économie de {amount} par an vs mensuel',
    cabinet: {
      title: 'Version Cabinet comptable — sur devis',
      text: 'Multi-dossiers, rôles cabinet (responsable, collaborateur), missions et honoraires. Tarif selon le nombre de dossiers.',
      cta: 'Demander une démo',
      link: 'En savoir plus'
    },
    enterprise: {
      title: 'Plan Entreprise — sur mesure',
      text: 'Volumes, intégrations, hébergement dédié.',
      cta: 'Discuter de votre projet'
    },
    faqTitle: 'Questions sur les tarifs',
    faq: [
      { question: 'Puis-je changer de plan ?', answer: 'Oui, à tout moment depuis Paramètres › Abonnement.' },
      {
        question: 'Que se passe-t-il si je dépasse le quota de factures ?',
        answer: 'La création est bloquée jusqu’au mois suivant ou au passage à un plan payant.'
      },
      {
        question: 'Les prix incluent-ils la TVA ?',
        answer: 'Les prix sont en dinars tunisiens ; la TVA sera précisée à la facturation si applicable.'
      },
      { question: 'Puis-je exporter mes données ?', answer: 'Oui : PDF, Excel, FEC et XML TEJ selon votre plan.' }
    ]
  },
  useCases: {
    kicker: 'Cas d’usage',
    title: 'Conçu pour votre activité',
    subtitle: 'Quatre profils, une seule plateforme.',
    personas: [
      {
        cssClass: 'persona-services',
        title: 'Prestataire de services',
        text: 'Devis, projets, feuilles de temps et factures récurrentes pour vos missions.',
        cta: 'Démarrer'
      },
      {
        cssClass: 'persona-retail',
        title: 'Commerce & point de vente',
        text: 'Caisse, stock multi-dépôts, promotions et étiquettes (code-barres selon activation).',
        cta: 'Démarrer'
      },
      {
        cssClass: 'persona-distrib',
        title: 'Distribution & négoce',
        text: 'Commandes clients, carnet de commandes, transferts, achats et trésorerie.',
        cta: 'Démarrer'
      },
      {
        cssClass: 'persona-accountant',
        title: 'Cabinet comptable',
        text: 'Gérez plusieurs dossiers clients, missions et honoraires ; états NCT et déclarations centralisés.',
        cta: 'Découvrir la version Cabinet'
      }
    ]
  },
  comparison: {
    kicker: 'Comparaison',
    title: 'InstaFact face aux outils séparés',
    subtitle: 'Ce que vous gagnez à réunir facturation, comptabilité et paie.',
    ourLabel: 'InstaFact',
    otherLabel: 'Excel & outils séparés',
    criteria: [
      'Facturation TEJ + comptabilité NCT dans la même base',
      'Paie CNSS/IRPP intégrée',
      'Déclaration mensuelle préparée',
      'Assistant IA hébergé chez vous',
      '{count} rôles et journal d’audit chaîné',
      'Portail client',
      'Prévisions avec calendrier tunisien',
      'Prix en TND, plan gratuit'
    ]
  },
  compliance: {
    kicker: 'Conformité',
    title: 'Conforme aux exigences tunisiennes',
    subtitle: 'Chaque point ci-dessous existe dans l’application.',
    cards: [
      {
        icon: 'pi-file-check',
        title: 'Facturation TEJ',
        text: 'Génération et validation du XML TEJ, certificats de retenue à la source produits depuis vos règlements.'
      },
      {
        icon: 'pi-download',
        title: 'Export FEC & dossier de révision',
        text: 'Export du fichier des écritures et du dossier comptable en un clic pour votre expert-comptable.'
      },
      {
        icon: 'pi-lock',
        title: 'Scellement des documents',
        text: 'Chaque facture émise est scellée par une empreinte HMAC-SHA256 versionnée : toute modification ultérieure est détectable.'
      },
      {
        icon: 'pi-book',
        title: 'États financiers NCT',
        text: 'Bilan, compte de résultat et notes selon le système comptable des entreprises tunisien.'
      },
      {
        icon: 'pi-database',
        title: 'Isolation des données',
        text: 'Une base de données par entreprise ; accès par rôles ; export complet de vos données à la demande.'
      },
      {
        icon: 'pi-history',
        title: 'Journal d’audit chaîné',
        text: 'Chaque action est journalisée et chaînée par hachage ; un rôle Auditeur en lecture seule est prévu.'
      }
    ]
  },
  security: {
    kicker: 'Sécurité',
    title: 'Des accès maîtrisés, une trace de chaque action',
    subtitle: 'Authentification forte, permissions par rôle et journal d’audit chaîné.',
    points: [
      { title: 'Authentification renforcée', text: 'JWT avec double facteur (2FA) et verrouillage après échecs.' },
      { title: 'Accès par rôle', text: 'Permissions par rôle ({count} rôles) et journal d’audit chaîné.' },
      { title: 'Isolation par entreprise', text: 'Une base de données par entreprise : aucun mélange entre sociétés.' },
      {
        title: 'Limitation de débit',
        text: 'Les points d’entrée publics sont limités en débit et servis avec des en-têtes de sécurité HTTP.'
      },
      { title: 'Vos documents', text: 'Vos documents et exports restent téléchargeables tant que votre compte est actif.' }
    ]
  },
  integrations: {
    kicker: 'Intégrations',
    title: 'Vos données circulent, dans les formats attendus',
    subtitle: 'Exports, e-mail et canaux selon activation.',
    items: [
      { icon: 'pi-envelope', title: 'E-mail', text: 'Envoi des documents et relances depuis l’application.' },
      { icon: 'pi-file-excel', title: 'Excel & PDF', text: 'Exports de vos listes et documents.' },
      { icon: 'pi-code', title: 'XML TEJ & FEC', text: 'Exports fiscaux et comptables.' },
      { icon: 'pi-building-columns', title: 'Relevés bancaires', text: 'Import de relevés bancaires pour le rapprochement.' },
      { icon: 'pi-whatsapp', title: 'WhatsApp Business', text: 'Envoi de documents et rappels (selon activation).' },
      { icon: 'pi-telegram', title: 'Telegram', text: 'Notifications et rappels (selon activation).' },
      { icon: 'pi-money-bill', title: 'Multi-devises', text: 'TND, EUR, USD.' },
      { icon: 'pi-link', title: 'API REST', text: 'Sécurisée par jeton — documentation fournie aux clients Entreprise.' }
    ]
  },
  stats: {
    modules: 'modules activables',
    roles: 'rôles utilisateurs',
    aiTools: 'outils IA',
    dedicatedDb: 'base de données dédiée par entreprise'
  },
  trust: {
    kicker: 'Confiance',
    title: 'Pourquoi les entreprises tunisiennes choisissent InstaFact',
    subtitle: 'Des engagements que nous tenons dans le produit.',
    cards: [
      { icon: 'pi-flag', title: 'Conçu pour la Tunisie', text: 'TEJ, NCT, CNSS, IRPP, déclaration mensuelle et calendrier local.' },
      { icon: 'pi-money-bill', title: 'Prix en dinars', text: 'Des tarifs en TND, sans conversion ni surprise.' },
      {
        icon: 'pi-server',
        title: 'Vos données restent chez vous',
        text: 'L’assistant IA s’exécute sur votre instance, sans envoi à un fournisseur externe ; une base de données par entreprise.'
      },
      { icon: 'pi-comments', title: 'Support en français', text: 'Une équipe qui parle votre langue et connaît vos obligations.' },
      { icon: 'pi-history', title: 'Journal d’audit chaîné', text: 'Chaque action est tracée et vérifiable.' },
      { icon: 'pi-gift', title: 'Un plan gratuit pour démarrer', text: 'Testez sans carte bancaire.' }
    ]
  },
  faq: {
    kicker: 'FAQ',
    title: 'Questions fréquentes',
    subtitle: 'Les réponses aux questions que l’on nous pose le plus.',
    items: [
      {
        question: 'Puis-je créer un compte aujourd’hui ?',
        answer:
          'L’inscription en ligne est actuellement sur invitation. Décrivez votre besoin via le formulaire de contact ; nous ouvrons votre accès.',
        answerWhenOpen: 'Oui, le plan gratuit se crée en ligne sans carte bancaire.'
      },
      {
        question: 'InstaFact est-il conforme à la facturation électronique tunisienne (TEJ) ?',
        answer:
          'InstaFact génère et valide le XML TEJ et produit les certificats de retenue à la source. La transmission dépend de votre habilitation auprès de la plateforme nationale.'
      },
      {
        question: 'Mes données sont-elles envoyées à une IA externe ?',
        answer:
          'Par défaut non : les modèles tournent en local (Ollama). Un fournisseur cloud (OpenRouter) peut être activé par votre administrateur, en connaissance de cause.'
      },
      {
        question: 'Combien d’utilisateurs et de rôles ?',
        answer:
          '{rolesCount} rôles (administrateur, comptable, commercial, caissier, magasinier, auditeur…). Le plan gratuit inclut plusieurs utilisateurs ; les plans payants n’ont pas de limite.'
      },
      {
        question: 'Gérez-vous la paie tunisienne ?',
        answer: 'Oui : bulletins, CNSS, IRPP, régularisations, soldes de tout compte, livre et journal de paie.'
      },
      {
        question: 'Que se passe-t-il si je dépasse le quota de factures du plan gratuit ?',
        answer: 'La création est bloquée jusqu’au mois suivant ; passez au plan Mensuel ou Annuel pour lever la limite.'
      },
      {
        question: 'Puis-je importer mes anciennes factures ?',
        answer: 'Oui, par import Excel ; l’IA peut aussi lire une facture fournisseur à partir d’une photo.'
      },
      {
        question: 'Existe-t-il une application mobile ?',
        answer:
          'InstaFact fonctionne dans le navigateur de votre téléphone et de votre tablette. Il n’y a pas d’application à installer.'
      },
      {
        question: 'Je suis expert-comptable : quelle version choisir ?',
        answer:
          'La version Cabinet comptable gère plusieurs dossiers, vos collaborateurs et vos honoraires. Elle est proposée sur devis, avec une démo.'
      },
      {
        question: 'Puis-je récupérer mes données si je pars ?',
        answer: 'Oui : exports PDF, Excel, FEC et XML TEJ depuis l’application, sans nous demander.'
      }
    ]
  },
  finalCta: {
    titleOpen: 'Prêt à facturer en dinars, en conformité ?',
    titleClosed: 'Parlons de votre entreprise ou de votre cabinet',
    subtitle: 'Créez votre compte ou décrivez votre besoin : nous vous répondons rapidement.',
    loginLink: 'J’ai déjà un compte'
  }
};
