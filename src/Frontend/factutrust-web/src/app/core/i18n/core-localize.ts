/** Libellés core migrés vers @angular/localize (remplace core.fr / ErpCopyService). */

export const CORE_NAV = {
  dashboard: $localize`:@@core.nav.dashboard:Tableau de bord`,
  aiAssistant: $localize`:@@core.nav.aiAssistant:Assistant IA`,
  aiForecasts: $localize`:@@core.nav.aiForecasts:Prévisions IA`,
  pos: $localize`:@@core.nav.pos:Point de Vente`,
  sales: $localize`:@@core.nav.sales:Ventes`,
  purchases: $localize`:@@core.nav.purchases:Achats`,
  records: $localize`:@@core.nav.records:Fiches`,
  stock: $localize`:@@core.nav.stock:Stock`,
  treasury: $localize`:@@core.nav.treasury:Trésorerie`,
  crm: $localize`:@@core.nav.crm:CRM Commercial`,
  projects: $localize`:@@core.nav.projects:Projets`,
  fiscalTej: $localize`:@@core.nav.fiscalTej:Fiscal / TEJ`,
  tejShort: $localize`:@@core.nav.tejShort:TEJ`,
  hrPayroll: $localize`:@@core.nav.hrPayroll:RH & Paie`,
  accounting: $localize`:@@core.nav.accounting:Comptabilité`
} as const;

export const CORE_COMMON = {
  sessionInvalid: $localize`:@@core.common.sessionInvalid:Session invalide`,
  accessDenied: $localize`:@@core.common.accessDenied:Accès refusé`,
  conflictConfirm: $localize`:@@core.common.conflictConfirm:Conflit de confirmation`,
  database: $localize`:@@core.common.database:Base de données`,
  error: $localize`:@@core.common.error:Erreur`
};

export const CORE_HTTP = {
  contextError: $localize`:@@core.http.contextError:Votre session ne comporte pas d'entreprise valide. Veuillez vous reconnecter.`,
  purchaseOrderConflict: $localize`:@@core.http.purchaseOrderConflict:Cette commande n’est plus confirmable dans son état actuel. Actualisez la page puis réessayez.`
};

export const CORE_VALIDATION = {
  required: $localize`:@@core.validation.required:Ce champ est obligatoire`,
  email: $localize`:@@core.validation.email:Veuillez saisir une adresse email valide`,
  minlength: $localize`:@@core.validation.minlength:Ce champ doit contenir au moins {minLength} caractères`,
  maxlength: $localize`:@@core.validation.maxlength:Ce champ ne doit pas dépasser {maxLength} caractères`,
  pattern: $localize`:@@core.validation.pattern:Le format saisi est incorrect`,
  min: $localize`:@@core.validation.min:La valeur minimale est {min}`,
  max: $localize`:@@core.validation.max:La valeur maximale est {max}`,
  passwordMismatch: $localize`:@@core.validation.passwordMismatch:Les mots de passe ne correspondent pas`,
  generic: $localize`:@@core.validation.generic:Ce champ contient une erreur`
};

export const CORE_TITLES = {
  accessDenied: $localize`:@@core.titles.accessDenied:Accès refusé - InstaFact`,
  dashboard: $localize`:@@core.titles.dashboard:Tableau de bord - InstaFact`,
  terms: $localize`:@@core.titles.terms:Conditions d'utilisation - InstaFact`
};
