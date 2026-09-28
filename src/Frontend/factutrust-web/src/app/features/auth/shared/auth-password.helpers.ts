import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Backend Identity password policy (`Program.cs`): minimum length and distinct characters. */
export const AUTH_PASSWORD_MIN_LENGTH = 12;
export const AUTH_PASSWORD_MIN_UNIQUE_CHARS = 4;

export interface PasswordCriteria {
  minLength: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
}

export type PasswordStrengthLevel = 'empty' | 'weak' | 'fair' | 'good' | 'strong';

/** Backend Identity password complexity pattern (12+ chars, upper, lower, digit, special). */
export const AUTH_PASSWORD_VALIDATORS_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).+$/;

export function passwordMismatch(password: string | null | undefined, confirm: string | null | undefined): boolean {
  return !!(confirm && password !== confirm);
}

export function passwordMatches(password: string | null | undefined, confirm: string | null | undefined): boolean {
  return !!(password && confirm && password === confirm);
}

export function passwordCriteria(password: string | null | undefined): PasswordCriteria {
  const p = password ?? '';
  return {
    minLength: p.length >= AUTH_PASSWORD_MIN_LENGTH,
    hasUpper: /[A-Z]/.test(p),
    hasLower: /[a-z]/.test(p),
    hasDigit: /\d/.test(p),
    hasSpecial: /[^a-zA-Z0-9]/.test(p)
  };
}

export function passwordStrengthMetCount(criteria: PasswordCriteria): number {
  return [criteria.minLength, criteria.hasUpper, criteria.hasLower, criteria.hasDigit, criteria.hasSpecial]
    .filter(Boolean).length;
}

export function passwordStrengthLevel(password: string | null | undefined, criteria: PasswordCriteria): PasswordStrengthLevel {
  const n = passwordStrengthMetCount(criteria);
  const p = password ?? '';
  if (!p) return 'empty';
  if (n <= 2) return 'weak';
  if (n === 3) return 'fair';
  if (n === 4) return 'good';
  return 'strong';
}

/**
 * Server policy rules the password does not meet yet, worded for the user.
 * Same checks as Identity: ASCII letters and digits, distinct characters counted in UTF-16 units.
 */
export function passwordPolicyMissingRules(password: string | null | undefined): string[] {
  const p = password ?? '';
  const criteria = passwordCriteria(p);
  const missing: string[] = [];
  if (!criteria.minLength) missing.push($localize`:@@auth.auth-password.helpers.ts.auth.password.min.length.caracteres.mini.a9533917:${AUTH_PASSWORD_MIN_LENGTH}:AUTH_PASSWORD_MIN_LENGTH: caractères minimum`);
  if (!criteria.hasUpper) missing.push($localize`:@@auth.auth-password.helpers.ts.une.majuscule.707c869a:une majuscule`);
  if (!criteria.hasLower) missing.push($localize`:@@auth.auth-password.helpers.ts.une.minuscule.39f40740:une minuscule`);
  if (!criteria.hasDigit) missing.push($localize`:@@auth.auth-password.helpers.ts.un.chiffre.feda3574:un chiffre`);
  if (!criteria.hasSpecial) missing.push($localize`:@@auth.auth-password.helpers.ts.un.caractere.special.3cddad47:un caractère spécial`);
  if (new Set(p.split('')).size < AUTH_PASSWORD_MIN_UNIQUE_CHARS) {
    missing.push($localize`:@@auth.auth-password.helpers.ts.auth.password.min.unique.chars.caractere.f8e71249:${AUTH_PASSWORD_MIN_UNIQUE_CHARS}:AUTH_PASSWORD_MIN_UNIQUE_CHARS: caractères différents`);
  }
  return missing;
}

/**
 * Optional password: empty (after trimming, as the server does) is accepted — the account is then
 * created by invitation; otherwise it must meet the server policy.
 */
export function optionalAuthPasswordValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value.trim() : '';
    if (!value) return null;
    const missing = passwordPolicyMissingRules(value);
    return missing.length ? { passwordPolicy: { missing } } : null;
  };
}

export function passwordStrengthLabel(level: PasswordStrengthLevel): string {
  switch (level) {
    case 'empty': return '';
    case 'weak': return $localize`:@@auth.auth-password.helpers.ts.force.du.mot.de.passe.faible.ef369fa3:Force du mot de passe : faible`;
    case 'fair': return $localize`:@@auth.auth-password.helpers.ts.force.du.mot.de.passe.moyenne.c8d67cee:Force du mot de passe : moyenne`;
    case 'good': return $localize`:@@auth.auth-password.helpers.ts.force.du.mot.de.passe.bonne.1bc2e600:Force du mot de passe : bonne`;
    case 'strong': return $localize`:@@auth.auth-password.helpers.ts.force.du.mot.de.passe.forte.0ea699a1:Force du mot de passe : forte`;
    default: return '';
  }
}
