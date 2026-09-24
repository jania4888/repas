import type { LandingContactCopy } from '../landing-copy.types';

/**
 * Formulaire de demande d'accès / de démo — copy FR finale (TB7 ; plan § 6.4, part B § B.6).
 *
 * Placeholders injectés par `LandingCopyService.format()` : {min}, {max}, {count},
 * {seconds}, {reference}, {email}. Aucune promesse de délai de réponse (exclusion § 6.1) ;
 * la ligne de réassurance ne contient que des engagements contrôlés par l'équipe.
 */
export const CONTACT_FR: LandingContactCopy = {
  title: 'Demander un accès ou une démo',
  lead: 'Décrivez votre besoin en quelques lignes : nous vous recontactons rapidement.',
  subjects: {
    'acces-entreprise': 'Demander un accès (entreprise)',
    'demo-cabinet': 'Demander une démo (cabinet comptable)',
    entreprise: 'Projet sur mesure (grande entreprise)',
    autre: 'Autre demande'
  },
  fields: {
    subject: {
      label: 'Objet de la demande',
      placeholder: 'Choisissez un objet',
      hint: 'Nous orientons votre demande vers la bonne équipe.'
    },
    fullName: {
      label: 'Nom complet',
      placeholder: 'Prénom Nom',
      hint: 'Tel qu’il apparaîtra dans nos échanges.'
    },
    organization: {
      label: 'Société ou cabinet',
      placeholder: 'Nom de votre société ou cabinet',
      hint: 'Raison sociale ou nom commercial.'
    },
    email: {
      label: 'E-mail professionnel',
      placeholder: 'vous@exemple.tn',
      hint: 'Nous répondons à cette adresse.'
    },
    phone: {
      label: 'Téléphone',
      placeholder: '+216 XX XXX XXX',
      hint: 'Numéro tunisien, avec ou sans +216.'
    },
    size: {
      label: 'Taille',
      placeholder: 'Sélectionnez',
      hint: 'Facultatif : une estimation suffit.'
    },
    message: {
      label: 'Message',
      placeholder: 'Décrivez votre activité, vos outils actuels et vos besoins.',
      hint: 'Entre 10 et 2000 caractères.'
    },
    consent: {
      label: 'J’accepte que mes informations soient utilisées pour traiter ma demande.',
      linkLabel: 'Conditions d’utilisation'
    },
    website: { label: 'Site web' }
  },
  sizes: {
    none: 'Non précisé',
    dossiers: [
      { value: 'dossiers:1-5', label: '1 à 5 dossiers' },
      { value: 'dossiers:6-20', label: '6 à 20 dossiers' },
      { value: 'dossiers:21-50', label: '21 à 50 dossiers' },
      { value: 'dossiers:50+', label: 'Plus de 50 dossiers' }
    ],
    employes: [
      { value: 'employes:1-5', label: '1 à 5 employés' },
      { value: 'employes:6-20', label: '6 à 20 employés' },
      { value: 'employes:21-100', label: '21 à 100 employés' },
      { value: 'employes:100+', label: 'Plus de 100 employés' }
    ]
  },
  messageCounter: '{count} / {max}',
  submit: {
    idle: 'Envoyer ma demande',
    submitting: 'Envoi en cours…',
    retry: 'Réessayer',
    another: 'Envoyer une autre demande'
  },
  reassurance: ['Aucune carte bancaire requise', 'Vos données ne sont jamais revendues'],
  success: {
    title: 'Demande enregistrée',
    reference: 'Référence : {reference}',
    text: 'Nous vous recontactons rapidement.'
  },
  errors: {
    required: 'Ce champ est obligatoire.',
    minLength: 'Saisissez au moins {min} caractères.',
    maxLength: 'Saisissez au plus {max} caractères.',
    email: 'Saisissez une adresse e-mail valide.',
    phone: 'Saisissez un numéro tunisien valide (8 chiffres, avec ou sans +216).',
    consent: 'Votre accord est nécessaire pour traiter la demande.',
    validationGlobal: 'Certains champs sont incorrects. Corrigez-les, puis réessayez.',
    rateLimited: 'Trop de demandes. Réessayez dans {seconds} s.',
    rateLimitedFallback: 'Trop de demandes. Réessayez dans quelques instants.',
    disabled: 'Le formulaire est temporairement indisponible. Écrivez-nous à {email}.',
    network: 'Connexion impossible. Vérifiez votre connexion, puis réessayez.',
    unknown: 'Une erreur est survenue. Réessayez dans un instant.',
    turnstileUnavailable: 'La vérification anti-robot n’a pas pu se charger. Rechargez la page, puis réessayez.'
  },
  turnstile: {
    ariaLabel: 'Vérification anti-robot'
  }
};

/**
 * Adresse e-mail de repli affichée quand le formulaire est indisponible (503) : le composant
 * l'injecte dans `errors.disabled` via le placeholder `{email}`.
 * NOTE : la clé `fallbackEmail` n'existe pas dans le type `LandingContactCopy` (figé par TD1) ;
 * la constante est exportée ici en attendant une extension additive du type.
 */
export const CONTACT_FALLBACK_EMAIL = 'contact@instafact.shop';
