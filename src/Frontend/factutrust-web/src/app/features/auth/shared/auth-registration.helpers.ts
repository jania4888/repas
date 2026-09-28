import { AbstractControl, FormGroup, ValidationErrors } from '@angular/forms';
import { canonicalizeNif, NIF_PATTERN } from '@shared/validation/validation-rules';
import type { RegisterRequest } from '@core/services/auth.service';

/**
 * Nettoie et ramène la valeur NIF du masque PrimeNG à la forme carte
 * `1772793W/A/M/000`. L'écriture historique est acceptée puis réécrite.
 */
export function cleanNifValue(value: string | null | undefined): string {
  return canonicalizeNif(value);
}

/** Remove spaces from Tunisian phone mask value. */
export function cleanPhoneValue(value: string | null | undefined): string {
  return (value?.replace(/\s/g, '') ?? '').trim();
}

export function trimOptional(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function trimRequired(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function dropdownStringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value !== null && typeof value === 'object' && 'value' in (value as object)) {
    return String((value as { value: unknown }).value ?? '').trim();
  }
  return String(value ?? '').trim();
}

export interface CompanyRegisterValidationInput {
  taxRegime: unknown;
  governorate: unknown;
  phone: string | null | undefined;
  nif: string | null | undefined;
}

/**
 * Pre-submit validation for company registration (mirrors RegisterComponent.validateFormData).
 */
export function validateCompanyRegisterFormData(
  formValue: CompanyRegisterValidationInput,
  nifOverride?: string,
  nifTouched = false
): string[] {
  const errors: string[] = [];

  if (formValue.taxRegime !== 0 && !formValue.taxRegime) {
    errors.push($localize`:@@auth.auth-registration.helpers.ts.le.regime.fiscal.est.requis.d20a3be7:Le régime fiscal est requis`);
  }

  if (!formValue.governorate) {
    errors.push($localize`:@@auth.auth-registration.helpers.ts.le.gouvernorat.est.requis.7596f54f:Le gouvernorat est requis`);
  }

  const phone = cleanPhoneValue(formValue.phone);
  if (phone && !/^[2-57-9]\d{7}$/.test(phone)) {
    errors.push($localize`:@@auth.auth-registration.helpers.ts.le.numero.de.telephone.doit.contenir.8.c.11d37130:Le numéro de téléphone doit contenir 8 chiffres et commencer par 2, 3, 4, 5, 7 ou 9`);
  }

  const nifToValidate = nifOverride !== undefined
    ? nifOverride
    : cleanNifValue(formValue.nif);

  if (nifToValidate && nifToValidate.length > 0) {
    if (!NIF_PATTERN.test(nifToValidate)) {
      errors.push($localize`:@@auth.auth-registration.helpers.ts.le.format.du.nif.est.invalide.format.att.f4470903:Le format du NIF est invalide (format attendu: 1772793W/A/M/000)`);
    }
  } else if (nifTouched) {
    errors.push($localize`:@@auth.auth-registration.helpers.ts.le.matricule.fiscal.est.requis.format.17.26b09bb0:Le matricule fiscal est requis (format: 1772793W/A/M/000)`);
  }

  return errors;
}

export interface FirmRegisterValidationInput {
  governorate: unknown;
  phone: string | null | undefined;
  nif: string | null | undefined;
}

/** Pre-submit validation for firm registration. */
export function validateFirmRegisterFormData(
  formValue: FirmRegisterValidationInput,
  nifOverride?: string,
  nifTouched = false
): string[] {
  const errors: string[] = [];

  if (!formValue.governorate) {
    errors.push($localize`:@@auth.auth-registration.helpers.ts.le.gouvernorat.est.requis.7596f54f:Le gouvernorat est requis`);
  }

  const phone = cleanPhoneValue(formValue.phone);
  if (phone && !/^[2-57-9]\d{7}$/.test(phone)) {
    errors.push($localize`:@@auth.auth-registration.helpers.ts.le.numero.de.telephone.doit.contenir.8.c.11d37130:Le numéro de téléphone doit contenir 8 chiffres et commencer par 2, 3, 4, 5, 7 ou 9`);
  }

  const nifToValidate = nifOverride !== undefined
    ? nifOverride
    : cleanNifValue(formValue.nif);

  if (nifToValidate && nifToValidate.length > 0) {
    if (!NIF_PATTERN.test(nifToValidate)) {
      errors.push($localize`:@@auth.auth-registration.helpers.ts.le.format.du.nif.est.invalide.format.att.f4470903:Le format du NIF est invalide (format attendu: 1772793W/A/M/000)`);
    }
  } else if (nifTouched) {
    errors.push($localize`:@@auth.auth-registration.helpers.ts.le.matricule.fiscal.est.requis.format.17.26b09bb0:Le matricule fiscal est requis (format: 1772793W/A/M/000)`);
  }

  return errors;
}

/**
 * Validateur de format NIF appliqué à la valeur **nettoyée**.
 *
 * Le contrôle porte la valeur du masque PrimeNG (`1234567A/B/C/000`, voire des `_` résiduels) :
 * un `Validators.pattern(NIF_PATTERN)` direct la rejetterait alors qu'elle est parfaitement
 * valide une fois normalisée par `cleanNifValue()` — d'où ce validateur dédié.
 *
 * Vide ⇒ valide : l'obligation de saisie relève de `Validators.required`.
 */
export function nifFormatValidator(control: AbstractControl): ValidationErrors | null {
  const raw = control.value;
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }

  return NIF_PATTERN.test(cleanNifValue(String(raw))) ? null : { nifFormat: true };
}

export function markAllFormControlsTouched(form: FormGroup): void {
  Object.keys(form.controls).forEach(key => {
    form.get(key)?.markAsTouched();
  });
}

/** `true` si l'utilisateur a demandé à réduire les animations (défilement instantané). */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

export function scrollToFirstInvalidField(): void {
  // On vise un CONTRÔLE invalide, pas le premier `.ng-invalid` venu : Angular pose aussi cette
  // classe sur l'élément `<form>` lui-même, qui est donc toujours le premier match — le
  // défilement « vers le champ fautif » ramenait en réalité vers le formulaire entier.
  const firstInvalidField =
    document.querySelector('input.ng-invalid, select.ng-invalid, textarea.ng-invalid, [formcontrolname].ng-invalid')
    ?? document.querySelector('.ng-invalid');
  if (firstInvalidField) {
    firstInvalidField.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    const input = firstInvalidField.matches('input, select, textarea')
      ? (firstInvalidField as HTMLElement)
      : (firstInvalidField.querySelector('input, select, textarea') as HTMLElement | null);
    if (input) {
      setTimeout(() => input.focus(), 300);
    }
  }
}

/**
 * After a wizard step change, bring the form header back into view (page scroll).
 *
 * `target` explicite pour le wizard v2 : ses sélecteurs de repli (`.form-header-text` /
 * `.auth-form-card`) n'existent que dans le formulaire d'inscription legacy, si bien que
 * l'appel était un no-op sur `/auth/register` — la page ne remontait pas d'une étape à l'autre.
 * Sans `target`, le comportement legacy est conservé à l'identique.
 */
export function scrollAuthWizardStepIntoView(target?: Element | null): void {
  queueMicrotask(() => {
    const element =
      target ??
      document.querySelector('.form-header-text') ??
      document.querySelector('.auth-form-card');
    element?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  });
}

/**
 * Company registration form values (raw form value shape), used to assemble a
 * `RegisterRequest` with today's exact cleaning/coercion rules.
 */
export interface CompanyRegisterFormValue {
  email: string | null | undefined;
  password: string | null | undefined;
  confirmPassword: string | null | undefined;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  companyName: string | null | undefined;
  phone: string | null | undefined;
  taxRegime: unknown;
  companyEmail: string | null | undefined;
  website: string | null | undefined;
  street: string | null | undefined;
  streetLine2: string | null | undefined;
  city: string | null | undefined;
  postalCode: string | null | undefined;
  governorate: unknown;
  warehouseName: string | null | undefined;
}

/**
 * Additive helper extracting today's `RegisterComponent.onSubmit()` request-assembly
 * semantics (trims, phone/NIF cleaning, tax-regime dropdown coercion) so the new
 * registration wizard can reuse it verbatim. The legacy `register.component.ts` is
 * NOT refactored to call this — it keeps its own inline logic untouched.
 */
export function buildCompanyRegisterRequest(
  formValue: CompanyRegisterFormValue,
  cleanedNif: string
): Omit<RegisterRequest, 'companySegment' | 'businessDomain' | 'enabledModules'> {
  return {
    email: trimRequired(formValue.email),
    password: formValue.password || '',
    confirmPassword: formValue.confirmPassword || '',
    firstName: trimRequired(formValue.firstName),
    lastName: trimRequired(formValue.lastName),
    companyName: trimRequired(formValue.companyName),
    phone: cleanPhoneValue(formValue.phone),
    nif: cleanedNif,
    taxRegime: typeof formValue.taxRegime === 'number'
      ? formValue.taxRegime
      : (typeof formValue.taxRegime === 'object' && formValue.taxRegime !== null && 'value' in formValue.taxRegime
        ? Number((formValue.taxRegime as { value: unknown }).value)
        : 0),
    companyEmail: trimRequired(formValue.companyEmail),
    website: trimOptional(formValue.website),
    street: trimRequired(formValue.street),
    streetLine2: trimOptional(formValue.streetLine2),
    city: trimRequired(formValue.city),
    postalCode: trimOptional(formValue.postalCode),
    governorate: dropdownStringValue(formValue.governorate),
    warehouseName: trimOptional(formValue.warehouseName)
  };
}

export function applyNifBlurCleanup(form: FormGroup, controlName = 'nif'): void {
  const nifControl = form.get(controlName);
  if (!nifControl) return;

  const currentValue = nifControl.value || '';
  const cleaned = cleanNifValue(currentValue);

  if (cleaned !== currentValue) {
    nifControl.setValue(cleaned, { emitEvent: false });
    nifControl.updateValueAndValidity({ emitEvent: false });
    nifControl.markAsTouched();
  } else if (cleaned) {
    nifControl.updateValueAndValidity({ emitEvent: false });
  }
}
