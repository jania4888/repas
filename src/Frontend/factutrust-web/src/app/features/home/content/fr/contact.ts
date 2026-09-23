import type { LandingContactCopy } from '../landing-copy.types';

/**
 * Formulaire de contact FR — SQUELETTE TYPÉ (TD1). Structure définitive (plan § 6.4 / B.6) ;
 * texte brouillon finalisé par TB3. Les messages d'erreur utilisent {min}/{max}/{seconds}/{email}.
 */
export const CONTACT_FR: LandingContactCopy = {
  title: 'Demander un accès ou une démo',
  lead: 'Décrivez votre besoin en quelques lignes : nous vous répondons sous 48 heures ouvrées.',
  subjects: {
    'acces-entreprise': 'Demander un accès entreprise',
    'demo-cabinet': 'Demander une démo cabinet',
    entreprise: 'Plan Entreprise / sur mesure',
    autre: 'Autre demande'
  },
  fields: {
    subject: { label: 'Objet de la demande', placeholder: 'Choisissez un objet', hint: 'Nous orientons votre demande vers la bonne équipe.' },
    fullName: { label: 'Nom complet', placeholder: 'Prénom Nom', hint: 'Tel qu’il apparaîtra dans nos échanges.' },
    organization: { label: 'Société ou cabinet', placeholder: 'Nom de votre société ou cabinet', hint: 'Raison sociale ou nom commercial.' },
    email: { label: 'Adresse e-mail', placeholder: 'vous@exemple.tn', hint: 'Nous répondons à cette adresse.' },
    phone: { label: 'Téléphone', placeholder: '+216 XX XXX XXX', hint: 'Numéro tunisien, avec ou sans +216.' },
    size: { label: 'Taille', placeholder: 'Sélectionnez', hint: 'Facultatif.' },
    message: { label: 'Votre message', placeholder: 'Décrivez votre activité et vos besoins.', hint: 'Activité, nombre de dossiers ou d’employés, outils actuels.' },
    consent: {
      label: 'J’accepte que mes informations soient utilisées pour traiter ma demande.',
      linkLabel: 'Mentions légales'
    },
    website: { label: 'Site web (ne pas remplir)' }
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
  messageCounter: '{count} / {max} caractères',
  submit: {
    idle: 'Envoyer ma demande',
    submitting: 'Envoi en cours…',
    retry: 'Réessayer',
    another: 'Envoyer une autre demande'
  },
  reassurance: ['Réponse sous 48 h ouvrées', 'Aucune carte bancaire', 'Vos données ne sont pas revendues'],
  success: {
    title: 'Demande bien reçue',
    reference: 'Référence : {reference}',
    text: 'Nous vous recontactons à l’adresse indiquée. Conservez cette référence pour tout échange.'
  },
  errors: {
    required: 'Ce champ est obligatoire.',
    minLength: 'Saisissez au moins {min} caractères.',
    maxLength: 'Limité à {max} caractères.',
    email: 'Saisissez une adresse e-mail valide.',
    phone: 'Saisissez un numéro tunisien valide (8 chiffres, avec ou sans +216).',
    consent: 'Votre accord est nécessaire pour traiter la demande.',
    validationGlobal: 'Certains champs sont incorrects. Corrigez-les puis réessayez.',
    rateLimited: 'Trop de demandes envoyées. Réessayez dans {seconds} secondes.',
    rateLimitedFallback: 'Trop de demandes envoyées. Réessayez dans quelques instants.',
    disabled: 'Le formulaire est momentanément indisponible. Écrivez-nous à {email}.',
    network: 'Connexion impossible. Vérifiez votre réseau puis réessayez.',
    unknown: 'Une erreur inattendue s’est produite. Réessayez dans quelques instants.',
    turnstileUnavailable: 'La vérification anti-robot n’a pas pu se charger. Rechargez la page puis réessayez.'
  },
  turnstile: {
    ariaLabel: 'Vérification anti-robot'
  }
};
