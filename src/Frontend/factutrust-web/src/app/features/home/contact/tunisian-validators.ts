import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { EMAIL_PATTERN } from '@shared/validation/validation-rules';
import { CONTACT_REQUEST_LIMITS, isContactRequestSize } from './contact-request.models';

/**
 * Validateurs du formulaire de contact public (plan § 4.5) — règles identiques au backend
 * `SubmitPublicContactRequestCommandValidator`. Fichier distinct de `shared/validation/tunisian-validators.ts`
 * (ERP) pour ne pas modifier des règles utilisées ailleurs.
 */

/** Numéro tunisien normalisé : 8 chiffres commençant par 2–9, préfixe `+216` optionnel. */
export const TUNISIAN_PHONE_NORMALIZED_RE = /^(\+216)?[2-9]\d{7}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/;
const LINE_BREAKS_RE = /[\r\n\u0085\u2028\u2029]/;

/** Chiffres arabo-indiens (٠-٩) et persans (۰-۹) → ASCII. */
export function toAsciiDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, d => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Normalisation partagée avec le backend : chiffres → ASCII, espaces/points/tirets/parenthèses retirés,
 * `00216` → `+216`. Ne valide pas.
 */
export function normalizeTunisianPhone(raw: string): string {
  let v = toAsciiDigits(raw ?? '')
    .replace(/[\s.\-()\u00a0\u200f\u200e]/g, '')
    .replace(/^00216/, '+216');
  if (v.startsWith('216') && v.length === 11) {
    v = `+${v}`;
  }
  return v;
}

export function isValidTunisianContactPhone(raw: string): boolean {
  return TUNISIAN_PHONE_NORMALIZED_RE.test(normalizeTunisianPhone(raw));
}

export function isValidContactEmail(raw: string): boolean {
  const v = (raw ?? '').trim();
  return v.length > 0 && v.length <= CONTACT_REQUEST_LIMITS.email.max && !/\s/.test(v) && !CONTROL_CHARS_RE.test(v) && EMAIL_PATTERN.test(v);
}

export function isSingleLine(raw: string): boolean {
  return !LINE_BREAKS_RE.test(raw ?? '') && !CONTROL_CHARS_RE.test(raw ?? '');
}

/** Contrôle vide ⇒ valide (laisser `Validators.required` gérer l'obligation). */
function isEmpty(control: AbstractControl): boolean {
  const v = control.value;
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

export class ContactValidators {
  /** `{ tunisianPhone: true }` si le numéro normalisé ne respecte pas la règle. */
  static tunisianPhone(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null =>
      isEmpty(control) || isValidTunisianContactPhone(String(control.value)) ? null : { tunisianPhone: true };
  }

  /** `{ email: true }` — EMAIL_PATTERN partagé + longueur ≤ 254 + aucun espace. */
  static email(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null =>
      isEmpty(control) || isValidContactEmail(String(control.value)) ? null : { email: true };
  }

  /** `{ singleLine: true }` si sauts de ligne ou caractères de contrôle. */
  static singleLine(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null =>
      isEmpty(control) || isSingleLine(String(control.value)) ? null : { singleLine: true };
  }

  /** `{ controlChars: true }` — sauts de ligne autorisés (message), autres caractères de contrôle interdits. */
  static noControlChars(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (isEmpty(control)) {
        return null;
      }
      const v = String(control.value).replace(/[\r\n\t]/g, '');
      return CONTROL_CHARS_RE.test(v) ? { controlChars: true } : null;
    };
  }

  /** `{ size: true }` si la valeur n'appartient pas à la liste blanche (vide accepté). */
  static contactSize(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null =>
      isEmpty(control) || isContactRequestSize(control.value) ? null : { size: true };
  }
}
