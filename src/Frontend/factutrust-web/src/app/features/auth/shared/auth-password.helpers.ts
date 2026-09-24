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
  if (!criteria.minLength) missing.push(`${AUTH_PASSWORD_MIN_LENGTH} caractères minimum`);
  if (!criteria.hasUpper) missing.push('une majuscule');
  if (!criteria.hasLower) missing.push('une minuscule');
  if (!criteria.hasDigit) missing.push('un chiffre');
  if (!criteria.hasSpecial) missing.push('un caractère spécial');
  if (new Set(p.split('')).size < AUTH_PASSWORD_MIN_UNIQUE_CHARS) {
    missing.push(`${AUTH_PASSWORD_MIN_UNIQUE_CHARS} caractères différents`);
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
    case 'weak': return 'Force du mot de passe : faible';
    case 'fair': return 'Force du mot de passe : moyenne';
    case 'good': return 'Force du mot de passe : bonne';
    case 'strong': return 'Force du mot de passe : forte';
    default: return '';
  }
}
