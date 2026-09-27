import { AbstractControl, ValidationErrors, ValidatorFn, AsyncValidatorFn } from '@angular/forms';
import {
  isValidNif,
  isValidTunisianPhone,
  isValidPostalCode,
  isValidTunisianIban,
  isValidRib,
  isValidVatRate,
  isValidGovernorate,
  isValidEmail,
  requiresNif,
  requiresExemptionMention,
  MAX_LENGTHS,
  MIN_LENGTHS,
  NUMERIC_LIMITS,
  VALID_VAT_RATES,
  TUNISIAN_GOVERNORATES
} from './validation-rules';
import { ValidationErrorCodes } from './validation-error.model';

/**
 * Custom Angular validators for Tunisian fiscal compliance.
 * Provides form-level validation synchronized with backend rules.
 */
/** Accepte la forme carte et l'écriture historique. Erreur `pattern` pour les messages existants. */
export function nifAcceptsEitherSpelling(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  return isValidNif(String(value)) ? null : { pattern: true };
}

export class TunisianValidators {

  // ============================================
  // NIF (MATRICULE FISCAL) VALIDATORS
  // ============================================

  /**
   * Validates Tunisian NIF format: 1772793W/A/M/000
   */
  static nif(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      // Empty is valid (use Validators.required for required fields)
      if (!value) return null;

      if (!isValidNif(value)) {
        return {
          [ValidationErrorCodes.INVALID_NIF]: {
            message: $localize`:@@shared.tunisian-validators.ts.matricule.fiscal.invalide.format.attendu.7da88009:Matricule fiscal invalide. Format attendu: 1772793W/A/M/000`,
            actualValue: value
          }
        };
      }

      return null;
    };
  }

  /**
   * Conditionally requires NIF based on client tax type.
   */
  static nifRequiredWhen(taxTypeGetter: () => string | null): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const taxType = taxTypeGetter();
      
      if (!requiresNif(taxType)) {
        return null;
      }

      const value = control.value;
      
      if (!value) {
        return {
          [ValidationErrorCodes.REQUIRED]: {
            message: $localize`:@@shared.tunisian-validators.ts.le.matricule.fiscal.est.obligatoire.pour.51ef6b29:Le matricule fiscal est obligatoire pour un client assujetti`
          }
        };
      }

      if (!isValidNif(value)) {
        return {
          [ValidationErrorCodes.INVALID_NIF]: {
            message: $localize`:@@shared.tunisian-validators.ts.matricule.fiscal.invalide.format.attendu.7da88009:Matricule fiscal invalide. Format attendu: 1772793W/A/M/000`
          }
        };
      }

      return null;
    };
  }

  // ============================================
  // PHONE VALIDATORS
  // ============================================

  /**
   * Validates Tunisian phone number format.
   */
  static tunisianPhone(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (!value) return null;

      if (!isValidTunisianPhone(value)) {
        return {
          [ValidationErrorCodes.INVALID_PHONE]: {
            message: $localize`:@@shared.tunisian-validators.ts.numero.de.telephone.invalide.format.atte.5902825a:Numéro de téléphone invalide. Format attendu: +216 XX XXX XXX`,
            actualValue: value
          }
        };
      }

      return null;
    };
  }

  // ============================================
  // ADDRESS VALIDATORS
  // ============================================

  /**
   * Validates Tunisian postal code (4 digits).
   */
  static postalCode(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (!value) return null;

      if (!isValidPostalCode(value)) {
        return {
          [ValidationErrorCodes.INVALID_POSTAL_CODE]: {
            message: $localize`:@@shared.tunisian-validators.ts.code.postal.invalide.4.chiffres.attendus.83c4543c:Code postal invalide. 4 chiffres attendus`,
            actualValue: value
          }
        };
      }

      return null;
    };
  }

  /**
   * Validates Tunisian governorate.
   */
  static governorate(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (!value) return null;

      if (!isValidGovernorate(value)) {
        return {
          [ValidationErrorCodes.INVALID_GOVERNORATE]: {
            message: $localize`:@@shared.tunisian-validators.ts.gouvernorat.invalide.0e6f2281:Gouvernorat invalide`,
            actualValue: value,
            validValues: TUNISIAN_GOVERNORATES
          }
        };
      }

      return null;
    };
  }

  // ============================================
  // BANKING VALIDATORS
  // ============================================

  /**
   * Validates Tunisian IBAN format.
   */
  static tunisianIban(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (!value) return null;

      if (!isValidTunisianIban(value)) {
        return {
          [ValidationErrorCodes.INVALID_IBAN]: {
            message: $localize`:@@shared.tunisian-validators.ts.iban.invalide.format.tunisien.attendu.tn.49f4bc47:IBAN invalide. Format tunisien attendu: TN59XXXX...`,
            actualValue: value
          }
        };
      }

      return null;
    };
  }

  /**
   * Validates Tunisian RIB format (20 digits).
   */
  static rib(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (!value) return null;

      if (!isValidRib(value)) {
        return {
          [ValidationErrorCodes.INVALID_RIB]: {
            message: $localize`:@@shared.tunisian-validators.ts.rib.invalide.20.chiffres.attendus.c64ee0ff:RIB invalide. 20 chiffres attendus`,
            actualValue: value
          }
        };
      }

      return null;
    };
  }

  // ============================================
  // INVOICE LINE VALIDATORS
  // ============================================

  /**
   * Validates Tunisian VAT rate (0%, 7%, 13%, 19%).
   */
  static vatRate(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (value === null || value === undefined) return null;

      if (!isValidVatRate(Number(value))) {
        return {
          [ValidationErrorCodes.INVALID_VAT_RATE]: {
            message: $localize`:@@shared.tunisian-validators.ts.taux.de.tva.invalide.0.7.13.ou.19.autori.87dd5872:Taux de TVA invalide (0%, 7%, 13% ou 19% autorisés)`,
            actualValue: value,
            validValues: VALID_VAT_RATES
          }
        };
      }

      return null;
    };
  }

  /**
   * Validates that discount doesn't exceed the maximum allowed.
   * For percentage: max 100%
   * For amount: max is line subtotal
   */
  static discountMax(
    discountTypeGetter: () => 'PERCENT' | 'AMOUNT' | null,
    subtotalGetter: () => number
  ): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (!value || value <= 0) return null;

      const discountType = discountTypeGetter();
      
      if (discountType === 'PERCENT' && value > NUMERIC_LIMITS.maxDiscountPercent) {
        return {
          [ValidationErrorCodes.MAX_VALUE]: {
            message: $localize`:@@shared.tunisian-validators.ts.la.remise.en.pourcentage.ne.peut.pas.dep.68d92d07:La remise en pourcentage ne peut pas dépasser 100%`,
            max: NUMERIC_LIMITS.maxDiscountPercent,
            actualValue: value
          }
        };
      }

      if (discountType === 'AMOUNT') {
        const subtotal = subtotalGetter();
        if (value > subtotal) {
          return {
            [ValidationErrorCodes.DISCOUNT_EXCEEDS_TOTAL]: {
              message: $localize`:@@shared.tunisian-validators.ts.la.remise.ne.peut.pas.depasser.le.montan.08bca2a6:La remise ne peut pas dépasser le montant de la ligne`,
              max: subtotal,
              actualValue: value
            }
          };
        }
      }

      return null;
    };
  }

  /**
   * Validates minimum quantity.
   */
  static minQuantity(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (value === null || value === undefined) return null;

      if (Number(value) < NUMERIC_LIMITS.minQuantity) {
        return {
          [ValidationErrorCodes.MIN_VALUE]: {
            message: $localize`:@@shared.tunisian-validators.ts.la.quantite.minimum.est.minquantity.5bbce311:La quantité minimum est ${NUMERIC_LIMITS.minQuantity}:minQuantity:`,
            min: NUMERIC_LIMITS.minQuantity,
            actualValue: value
          }
        };
      }

      return null;
    };
  }

  // ============================================
  // PAYMENT VALIDATORS
  // ============================================

  /**
   * Validates payment days (0-365).
   */
  static paymentDays(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (value === null || value === undefined) return null;

      const numValue = Number(value);

      if (numValue < 0 || numValue > NUMERIC_LIMITS.maxPaymentDays) {
        return {
          [ValidationErrorCodes.INVALID_FORMAT]: {
            message: $localize`:@@shared.tunisian-validators.ts.le.delai.de.paiement.doit.etre.entre.0.e.ea140021:Le délai de paiement doit être entre 0 et ${NUMERIC_LIMITS.maxPaymentDays}:maxPaymentDays: jours`,
            min: 0,
            max: NUMERIC_LIMITS.maxPaymentDays,
            actualValue: value
          }
        };
      }

      return null;
    };
  }

  // ============================================
  // LEGAL MENTIONS VALIDATORS
  // ============================================

  /**
   * Conditionally requires exemption mention for TAX_EXEMPT clients.
   */
  static exemptionMentionRequired(taxTypeGetter: () => string | null): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const taxType = taxTypeGetter();

      if (!requiresExemptionMention(taxType)) {
        return null;
      }

      const value = control.value;

      if (!value || value.trim().length === 0) {
        return {
          [ValidationErrorCodes.REQUIRED]: {
            message: $localize`:@@shared.tunisian-validators.ts.une.mention.d.exoneration.est.requise.po.e773ce77:Une mention d'exonération est requise pour ce client`
          }
        };
      }

      return null;
    };
  }

  // ============================================
  // CREDIT NOTE VALIDATORS
  // ============================================

  /**
   * Requires linked invoice for credit notes.
   */
  static linkedInvoiceRequired(invoiceTypeGetter: () => string): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const invoiceType = invoiceTypeGetter();

      if (invoiceType !== 'CREDIT_NOTE') {
        return null;
      }

      const value = control.value;

      if (!value) {
        return {
          [ValidationErrorCodes.REQUIRED]: {
            message: $localize`:@@shared.tunisian-validators.ts.une.facture.d.avoir.doit.etre.liee.a.une.6f9c798f:Une facture d'avoir doit être liée à une facture existante`
          }
        };
      }

      return null;
    };
  }

  // ============================================
  // LENGTH VALIDATORS
  // ============================================

  /**
   * Creates a max length validator with custom message.
   */
  static maxLength(field: keyof typeof MAX_LENGTHS, fieldLabel: string): ValidatorFn {
    const maxLen = MAX_LENGTHS[field];
    
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (!value) return null;

      if (value.length > maxLen) {
        return {
          [ValidationErrorCodes.MAX_LENGTH]: {
            message: $localize`:@@shared.tunisian-validators.ts.fieldlabel.ne.peut.pas.depasser.maxlen.c.ec0b7c01:${fieldLabel}:fieldLabel: ne peut pas dépasser ${maxLen}:maxLen: caractères`,
            maxLength: maxLen,
            actualLength: value.length
          }
        };
      }

      return null;
    };
  }

  /**
   * Creates a min length validator with custom message.
   */
  static minLength(field: keyof typeof MIN_LENGTHS, fieldLabel: string): ValidatorFn {
    const minLen = MIN_LENGTHS[field];
    
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (!value) return null;

      if (value.length < minLen) {
        return {
          [ValidationErrorCodes.MIN_LENGTH]: {
            message: $localize`:@@shared.tunisian-validators.ts.fieldlabel.doit.contenir.au.moins.minlen.71562127:${fieldLabel}:fieldLabel: doit contenir au moins ${minLen}:minLen: caractères`,
            minLength: minLen,
            actualLength: value.length
          }
        };
      }

      return null;
    };
  }

  // ============================================
  // DATE VALIDATORS
  // ============================================

  /**
   * Validates that date is not in the future.
   */
  static notFutureDate(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (!value) return null;

      const date = new Date(value);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      if (date > tomorrow) {
        return {
          [ValidationErrorCodes.FUTURE_DATE]: {
            message: $localize`:@@shared.tunisian-validators.ts.la.date.ne.peut.pas.etre.dans.le.futur.705ea735:La date ne peut pas être dans le futur`,
            actualValue: value
          }
        };
      }

      return null;
    };
  }

  /**
   * Validates that due date is after or equal to issue date.
   */
  static dueDateAfterIssueDate(issueDateGetter: () => Date | null): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const dueDate = control.value;
      
      if (!dueDate) return null;

      const issueDate = issueDateGetter();
      if (!issueDate) return null;

      const due = new Date(dueDate);
      const issue = new Date(issueDate);
      issue.setHours(0, 0, 0, 0);
      due.setHours(0, 0, 0, 0);

      if (due < issue) {
        return {
          [ValidationErrorCodes.DATE_RANGE]: {
            message: $localize`:@@shared.tunisian-validators.ts.la.date.d.echeance.doit.etre.posterieure.a1cea6c3:La date d'échéance doit être postérieure ou égale à la date d'émission`,
            issueDate,
            dueDate
          }
        };
      }

      return null;
    };
  }

  // ============================================
  // EMAIL VALIDATOR
  // ============================================

  /**
   * Validates email format.
   */
  static email(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      
      if (!value) return null;

      if (!isValidEmail(value)) {
        return {
          [ValidationErrorCodes.INVALID_EMAIL]: {
            message: $localize`:@@shared.tunisian-validators.ts.adresse.email.invalide.393d7440:Adresse email invalide`,
            actualValue: value
          }
        };
      }

      return null;
    };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Extracts the first error message from validation errors.
 */
export function getFirstValidationError(errors: ValidationErrors | null): string | null {
  if (!errors) return null;

  const firstKey = Object.keys(errors)[0];
  if (!firstKey) return null;

  const error = errors[firstKey];
  
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return error.message as string;
  }

  // Default messages for standard validators
  switch (firstKey) {
    case 'required':
      return $localize`:@@shared.tunisian-validators.ts.ce.champ.est.obligatoire.17061b6a:Ce champ est obligatoire`;
    case 'minlength':
      return $localize`:@@shared.tunisian-validators.ts.minimum.requiredlength.caracteres.requis.74eda4f6:Minimum ${error.requiredLength}:requiredLength: caractères requis`;
    case 'maxlength':
      return $localize`:@@shared.tunisian-validators.ts.maximum.requiredlength.caracteres.autori.f9fb6c0b:Maximum ${error.requiredLength}:requiredLength: caractères autorisés`;
    case 'min':
      return $localize`:@@shared.tunisian-validators.ts.la.valeur.minimum.est.min.fdb5a870:La valeur minimum est ${error.min}:min:`;
    case 'max':
      return $localize`:@@shared.tunisian-validators.ts.la.valeur.maximum.est.max.4a02a3c7:La valeur maximum est ${error.max}:max:`;
    case 'email':
      return 'Adresse email invalide';
    case 'pattern':
      return 'Format invalide';
    default:
      return 'Valeur invalide';
  }
}

/**
 * Checks if a form control has a specific error.
 */
export function hasValidationError(control: AbstractControl | null, errorCode: string): boolean {
  if (!control || !control.errors) return false;
  return errorCode in control.errors;
}
