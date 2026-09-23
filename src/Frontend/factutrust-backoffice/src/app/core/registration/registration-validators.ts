import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import {
  NIF_PATTERN,
  PASSWORD_POLICY,
  POSTAL_CODE_PATTERN,
  TUNISIAN_PHONE_PATTERN,
  isValidGovernorate,
  normalizeNif
} from './tunisian-validation';

/** Une règle de mot de passe et son état, pour afficher une checklist plutôt qu'un booléen. */
export interface PasswordRuleState {
  key: string;
  label: string;
  satisfied: boolean;
}

/**
 * Matricule fiscal. Le contrôle est normalisé (majuscules, espaces retirés) avant d'être testé :
 * l'opérateur peut coller une valeur telle qu'elle figure sur un document.
 */
export const nifValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const raw = control.value as string | null;
  if (!raw) return null;
  return NIF_PATTERN.test(normalizeNif(raw)) ? null : { nifFormat: true };
};

export const tunisianPhoneValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const raw = (control.value as string | null) ?? '';
  if (!raw.trim()) return null;
  return TUNISIAN_PHONE_PATTERN.test(raw.replace(/[\s.-]/g, '').trim()) ? null : { phoneFormat: true };
};

/** Champ facultatif : vide ⇒ valide. */
export const postalCodeValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const raw = (control.value as string | null) ?? '';
  if (!raw.trim()) return null;
  return POSTAL_CODE_PATTERN.test(raw.trim()) ? null : { postalCodeFormat: true };
};

export const governorateValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const raw = (control.value as string | null) ?? '';
  if (!raw.trim()) return null;
  return isValidGovernorate(raw) ? null : { governorateUnknown: true };
};

function countDistinctChars(value: string): number {
  return new Set(value.split('')).size;
}

/**
 * Évalue la politique ASP.NET Identity réellement appliquée par le serveur
 * (`Program.cs`) : 12 caractères, chiffre, minuscule, majuscule, non-alphanumérique et
 * 4 caractères distincts. Exposé séparément du validateur pour alimenter la checklist.
 */
export function evaluatePasswordRules(value: string | null | undefined): PasswordRuleState[] {
  const password = value ?? '';
  return [
    {
      key: 'length',
      label: `Au moins ${PASSWORD_POLICY.requiredLength} caractères`,
      satisfied: password.length >= PASSWORD_POLICY.requiredLength
    },
    { key: 'lowercase', label: 'Une minuscule', satisfied: /[a-z]/.test(password) },
    { key: 'uppercase', label: 'Une majuscule', satisfied: /[A-Z]/.test(password) },
    { key: 'digit', label: 'Un chiffre', satisfied: /\d/.test(password) },
    {
      key: 'symbol',
      label: 'Un caractère spécial',
      satisfied: /[^a-zA-Z0-9]/.test(password)
    },
    {
      key: 'unique',
      label: `${PASSWORD_POLICY.requiredUniqueChars} caractères différents`,
      satisfied: countDistinctChars(password) >= PASSWORD_POLICY.requiredUniqueChars
    }
  ];
}

/**
 * Bloque la soumission tant que la politique du serveur n'est pas satisfaite. Sans ce validateur,
 * l'opérateur découvre la règle via un 400 après avoir rempli tout le formulaire.
 */
export const identityPasswordValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = (control.value as string | null) ?? '';
  if (!value) return null;

  const failing = evaluatePasswordRules(value).filter(rule => !rule.satisfied);
  return failing.length === 0 ? null : { passwordPolicy: failing.map(r => r.key) };
};

/**
 * Validateur de groupe : pose l'erreur sur le contrôle de confirmation pour que le message
 * s'affiche au bon endroit, et la retire dès que les deux valeurs concordent.
 */
export function passwordsMatchValidator(
  passwordKey = 'password',
  confirmKey = 'confirmPassword'
): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const password = group.get(passwordKey);
    const confirm = group.get(confirmKey);
    if (!password || !confirm) return null;
    if (!confirm.value) return null;

    if (password.value === confirm.value) {
      if (confirm.hasError('passwordMismatch')) {
        const { passwordMismatch, ...rest } = confirm.errors ?? {};
        confirm.setErrors(Object.keys(rest).length > 0 ? rest : null);
      }
      return null;
    }

    confirm.setErrors({ ...(confirm.errors ?? {}), passwordMismatch: true });
    return { passwordMismatch: true };
  };
}

/** Messages FR par clé d'erreur, consommés par `ft-field-error`. */
export const REGISTRATION_ERROR_MESSAGES: Record<string, string> = {
  required: 'Ce champ est obligatoire.',
  email: 'Adresse e-mail invalide.',
  nifFormat: 'Format attendu : 1772793W/A/M/000.',
  phoneFormat: 'Numéro tunisien attendu (ex. 71123456 ou +21671123456).',
  postalCodeFormat: 'Le code postal doit comporter 4 chiffres.',
  governorateUnknown: 'Sélectionnez un gouvernorat dans la liste.',
  passwordPolicy: 'Le mot de passe ne respecte pas toutes les règles ci-dessous.',
  passwordMismatch: 'Les mots de passe ne correspondent pas.',
  requiredTrue: 'Vous devez confirmer pour continuer.'
};
