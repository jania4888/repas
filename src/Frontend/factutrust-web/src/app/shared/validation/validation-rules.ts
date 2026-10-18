/// <reference types="@angular/localize" />
/**
 * Centralized Validation Rules for InstaFact
 * Tunisian fiscal compliance - Single source of truth
 * 
 * These rules are synchronized with backend validation.
 * Any changes here should be reflected in TunisianValidationRules.cs
 */

// ============================================
// REGEX PATTERNS
// ============================================

/**
 * Forme stockée du matricule fiscal : NNNNNNNL/A/M/NNN (ex. 1772793W/A/M/000).
 * La saisie historique NNNNNNN/L/A/M/NNN est ramenée à cette forme par canonicalizeNif.
 */
export const NIF_PATTERN = /^[0-9]{7}[A-Z]\/[A-Z]\/[A-Z]\/[0-9]{3}$/;

const NIF_COMPACT_PATTERN = /^([0-9]{7})([A-Z])([A-Z])([A-Z])([0-9]{3})$/;
const NIF_LEGACY_PATTERN = /^([0-9]{7})\/([A-Z])\/([A-Z])\/([A-Z])\/([0-9]{3})$/;
export const NIF_MAX_INPUT_LENGTH = 40;

/**
 * Tunisian phone number pattern.
 * Accepts: +216XXXXXXXX, 216XXXXXXXX, XXXXXXXX
 * Must start with 2, 3, 4, 5, 7, 9 after country code.
 */
export const TUNISIAN_PHONE_PATTERN = /^(\+?216)?[2-57-9]\d{7}$/;

/**
 * International phone pattern (fallback).
 */
export const INTERNATIONAL_PHONE_PATTERN = /^\+?[0-9]{8,20}$/;

/**
 * Tunisian postal code: exactly 4 digits.
 */
export const POSTAL_CODE_PATTERN = /^\d{4}$/;

/**
 * Tunisian IBAN: TN + 2 check digits + 20 digits.
 * Total: 24 characters (with or without spaces).
 */
export const TUNISIAN_IBAN_PATTERN = /^TN\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}$/;

/**
 * Tunisian RIB: 20 digits (can have spaces).
 * Format: BB AAA CCCCCCCCCCCCC KK
 */
export const RIB_PATTERN = /^\d{2}\s?\d{3}\s?\d{13}\s?\d{2}$/;

/**
 * Standard email pattern.
 */
export const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// ============================================
// VALID VALUES
// ============================================

/** Valid Tunisian VAT rates (%). */
export const VALID_VAT_RATES = [0, 7, 13, 19] as const;
export type TunisianVatRate = typeof VALID_VAT_RATES[number];

/** Valid currencies. */
export const VALID_CURRENCIES = ['TND', 'EUR', 'USD'] as const;
export type Currency = typeof VALID_CURRENCIES[number];

/** Valid invoice types. */
export const VALID_INVOICE_TYPES = ['INVOICE', 'CREDIT_NOTE'] as const;
export type InvoiceType = typeof VALID_INVOICE_TYPES[number];

/** Valid client tax types. */
export const VALID_CLIENT_TAX_TYPES = ['TAX_SUBJECT', 'NON_TAX_SUBJECT', 'TAX_EXEMPT'] as const;
export type ClientTaxType = typeof VALID_CLIENT_TAX_TYPES[number];

/** Valid payment methods. */
export const VALID_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHECK', 'CARD', 'EFFECT'] as const;
export type PaymentMethod = typeof VALID_PAYMENT_METHODS[number];

/** All 24 Tunisian governorates. */
export const TUNISIAN_GOVERNORATES = [
  'Ariana', 'Béja', 'Ben Arous', 'Bizerte', 'Gabès', 'Gafsa', 'Jendouba',
  'Kairouan', 'Kasserine', 'Kébili', 'Le Kef', 'Mahdia', 'La Manouba',
  'Médenine', 'Monastir', 'Nabeul', 'Sfax', 'Sidi Bouzid', 'Siliana',
  'Sousse', 'Tataouine', 'Tozeur', 'Tunis', 'Zaghouan'
] as const;

/** Libellé affiché ; la valeur envoyée à l'API reste le nom latin officiel. */
const GOVERNORATE_LABELS: Record<(typeof TUNISIAN_GOVERNORATES)[number], string> = {
  Ariana: $localize`:@@gov.ariana:Ariana`,
  'Béja': $localize`:@@gov.beja:Béja`,
  'Ben Arous': $localize`:@@gov.benArous:Ben Arous`,
  Bizerte: $localize`:@@gov.bizerte:Bizerte`,
  'Gabès': $localize`:@@gov.gabes:Gabès`,
  Gafsa: $localize`:@@gov.gafsa:Gafsa`,
  Jendouba: $localize`:@@gov.jendouba:Jendouba`,
  Kairouan: $localize`:@@gov.kairouan:Kairouan`,
  Kasserine: $localize`:@@gov.kasserine:Kasserine`,
  'Kébili': $localize`:@@gov.kebili:Kébili`,
  'Le Kef': $localize`:@@gov.kef:Le Kef`,
  Mahdia: $localize`:@@gov.mahdia:Mahdia`,
  'La Manouba': $localize`:@@gov.manouba:La Manouba`,
  'Médenine': $localize`:@@gov.medenine:Médenine`,
  Monastir: $localize`:@@gov.monastir:Monastir`,
  Nabeul: $localize`:@@gov.nabeul:Nabeul`,
  Sfax: $localize`:@@gov.sfax:Sfax`,
  'Sidi Bouzid': $localize`:@@gov.sidiBouzid:Sidi Bouzid`,
  Siliana: $localize`:@@gov.siliana:Siliana`,
  Sousse: $localize`:@@gov.sousse:Sousse`,
  Tataouine: $localize`:@@gov.tataouine:Tataouine`,
  Tozeur: $localize`:@@gov.tozeur:Tozeur`,
  Tunis: $localize`:@@gov.tunis:Tunis`,
  Zaghouan: $localize`:@@gov.zaghouan:Zaghouan`
};

/** PrimeNG dropdown options for Tunisian governorates. */
export const TUNISIAN_GOVERNORATE_OPTIONS = TUNISIAN_GOVERNORATES.map(g => ({
  label: GOVERNORATE_LABELS[g],
  value: g
}));

// ============================================
// LENGTH CONSTRAINTS
// ============================================

export const MAX_LENGTHS = {
  clientName: 200,
  street: 200,
  city: 100,
  designation: 500,
  description: 2000,
  internalReference: 50,
  customMention: 1000,
  paymentTerms: 500,
  bankName: 100,
  email: 256,
  phone: 20
} as const;

export const MIN_LENGTHS = {
  clientName: 2,
  designation: 2
} as const;

// ============================================
// NUMERIC CONSTRAINTS
// ============================================

export const NUMERIC_LIMITS = {
  /** Minimum quantity for invoice lines. */
  minQuantity: 0.001,
  /** Minimum unit price. */
  minUnitPrice: 0,
  /** Maximum discount percentage. */
  maxDiscountPercent: 100,
  /** Maximum payment days. */
  maxPaymentDays: 365,
  /** Calculation tolerance in TND (millimes). */
  calculationTolerance: 0.001
} as const;

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Ramène une saisie à la forme carte `1772793W/A/M/000`.
 * Accepte la forme historique, la forme sans slash `1772793WAM000`, les espaces,
 * les underscores de masque et les slashs Unicode. Idempotent.
 * Une chaîne vide, trop longue ou d'une autre forme est renvoyée nettoyée mais non réécrite
 * (ou vide si elle dépasse 40 caractères).
 */
export function canonicalizeNif(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length > NIF_MAX_INPUT_LENGTH) return '';

  const cleaned = value
    .replace(/_/g, '')
    .replace(/[\s\t]/g, '')
    .replace(/[\u2044\u2215/]/g, '/')
    .toUpperCase()
    .trim();

  if (!cleaned || cleaned === '/////' || cleaned === '///') return '';
  if (cleaned.length > NIF_MAX_INPUT_LENGTH) return '';

  const compact = cleaned.match(NIF_COMPACT_PATTERN);
  if (compact) {
    return `${compact[1]}${compact[2]}/${compact[3]}/${compact[4]}/${compact[5]}`;
  }

  const legacy = cleaned.match(NIF_LEGACY_PATTERN);
  if (legacy) {
    return `${legacy[1]}${legacy[2]}/${legacy[3]}/${legacy[4]}/${legacy[5]}`;
  }

  return cleaned;
}

/**
 * Validates a Tunisian NIF after canonisation (forme carte ou historique).
 */
export function isValidNif(nif: string | null | undefined): boolean {
  const canonical = canonicalizeNif(nif);
  return canonical.length > 0 && NIF_PATTERN.test(canonical);
}

/**
 * Valeur à écrire dans le masque `9999999a/a/a/999` lors d'un collage.
 * L'écriture historique est ramenée à la forme carte avant que le masque ne la rejette.
 * Retourne null si le collage n'est pas un matricule valide.
 */
export function nifValueFromPaste(raw: string | null | undefined): string | null {
  const canonical = canonicalizeNif(raw);
  return NIF_PATTERN.test(canonical) ? canonical : null;
}

/**
 * Validates a Tunisian phone number.
 */
export function isValidTunisianPhone(phone: string | null | undefined): boolean {
  if (!phone) return true; // Optional field
  const cleaned = phone.replace(/[\s\-\.]/g, '');
  return TUNISIAN_PHONE_PATTERN.test(cleaned);
}

/**
 * Validates an international phone number.
 */
export function isValidInternationalPhone(phone: string | null | undefined): boolean {
  if (!phone) return true; // Optional field
  const cleaned = phone.replace(/[\s\-\.]/g, '');
  return INTERNATIONAL_PHONE_PATTERN.test(cleaned);
}

/**
 * Validates a Tunisian postal code.
 */
export function isValidPostalCode(postalCode: string | null | undefined): boolean {
  if (!postalCode) return true; // Optional field
  return POSTAL_CODE_PATTERN.test(postalCode.trim());
}

/**
 * Validates a Tunisian IBAN.
 */
export function isValidTunisianIban(iban: string | null | undefined): boolean {
  if (!iban) return true; // Optional field
  const cleaned = iban.replace(/\s/g, '').toUpperCase();
  return TUNISIAN_IBAN_PATTERN.test(cleaned);
}

/**
 * Validates a Tunisian RIB.
 */
export function isValidRib(rib: string | null | undefined): boolean {
  if (!rib) return true; // Optional field
  const cleaned = rib.replace(/\s/g, '');
  return RIB_PATTERN.test(cleaned);
}

/**
 * Validates a Tunisian VAT rate.
 */
export function isValidVatRate(rate: number): rate is TunisianVatRate {
  return VALID_VAT_RATES.includes(rate as TunisianVatRate);
}

/**
 * Validates a governorate name.
 */
export function isValidGovernorate(governorate: string | null | undefined): boolean {
  if (!governorate) return false;
  return TUNISIAN_GOVERNORATES.some(
    g => g.toLowerCase() === governorate.toLowerCase().trim()
  );
}

/**
 * Validates an email address.
 */
export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return EMAIL_PATTERN.test(email.trim());
}

/**
 * Checks if client tax type requires NIF.
 */
export function requiresNif(taxType: string | null | undefined): boolean {
  return taxType?.toUpperCase() === 'TAX_SUBJECT';
}

/**
 * Checks if client tax type requires exemption mention.
 */
export function requiresExemptionMention(taxType: string | null | undefined): boolean {
  return taxType?.toUpperCase() === 'TAX_EXEMPT';
}

/**
 * Normalizes NIF to uppercase standard format.
 */
export function normalizeNif(nif: string | null | undefined): string | null {
  if (!nif) return null;
  return nif.trim().toUpperCase();
}

/**
 * Normalizes phone number to standard format.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let cleaned = phone.trim().replace(/[\s\-\.]/g, '');
  
  // Add +216 prefix if missing for Tunisian numbers
  if (cleaned.length === 8 && !cleaned.startsWith('216') && !cleaned.startsWith('+')) {
    cleaned = '+216' + cleaned;
  } else if (cleaned.startsWith('216')) {
    cleaned = '+' + cleaned;
  }
  
  return cleaned;
}

/**
 * Rounds amount to Tunisian millimes (3 decimal places).
 */
export function roundToMillimes(amount: number): number {
  return Math.round(amount * 1000) / 1000;
}

/**
 * Compares two amounts with millime tolerance.
 */
export function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < NUMERIC_LIMITS.calculationTolerance;
}

// ============================================
// VALIDATION RULES OBJECT (for dynamic usage)
// ============================================

export const VALIDATION_RULES = {
  metadata: {
    type: { required: true, enum: VALID_INVOICE_TYPES },
    issueDate: { required: true },
    dueDate: { required: false },
    currency: { required: true, enum: VALID_CURRENCIES },
    internalReference: { required: false, maxLength: MAX_LENGTHS.internalReference },
    linkedInvoiceId: { requiredWhen: (form: { type: string }) => form.type === 'CREDIT_NOTE' }
  },
  
  client: {
    name: { 
      required: true, 
      minLength: MIN_LENGTHS.clientName, 
      maxLength: MAX_LENGTHS.clientName 
    },
    taxType: { required: true, enum: VALID_CLIENT_TAX_TYPES },
    nif: { 
      requiredWhen: (form: { taxType: string }) => requiresNif(form.taxType),
      pattern: NIF_PATTERN,
      validator: isValidNif
    },
    email: { 
      required: true, 
      pattern: EMAIL_PATTERN,
      maxLength: MAX_LENGTHS.email 
    },
    phone: { 
      required: false, 
      pattern: TUNISIAN_PHONE_PATTERN,
      maxLength: MAX_LENGTHS.phone,
      validator: isValidTunisianPhone
    },
    address: {
      street: { required: true, maxLength: MAX_LENGTHS.street },
      city: { required: true, maxLength: MAX_LENGTHS.city },
      governorate: { required: true, enum: TUNISIAN_GOVERNORATES },
      postalCode: { 
        required: false, 
        pattern: POSTAL_CODE_PATTERN,
        validator: isValidPostalCode
      }
    }
  },
  
  line: {
    designation: { 
      required: true, 
      minLength: MIN_LENGTHS.designation, 
      maxLength: MAX_LENGTHS.designation 
    },
    description: { required: false, maxLength: MAX_LENGTHS.description },
    quantity: { required: true, min: NUMERIC_LIMITS.minQuantity },
    unitPriceHT: { required: true, min: NUMERIC_LIMITS.minUnitPrice },
    vatRate: { required: true, enum: VALID_VAT_RATES },
    discountType: { required: false, enum: ['PERCENT', 'AMOUNT'] },
    discountValue: { 
      requiredWhen: (form: { discountType: string }) => !!form.discountType,
      min: 0,
      max: (form: { discountType: string; quantity: number; unitPriceHT: number }) => 
        form.discountType === 'PERCENT' 
          ? NUMERIC_LIMITS.maxDiscountPercent 
          : form.quantity * form.unitPriceHT
    }
  },
  
  payment: {
    method: { required: true, enum: VALID_PAYMENT_METHODS },
    daysUntilDue: { required: false, min: 0, max: NUMERIC_LIMITS.maxPaymentDays },
    paymentTerms: { required: false, maxLength: MAX_LENGTHS.paymentTerms },
    bankName: { required: false, maxLength: MAX_LENGTHS.bankName },
    rib: { 
      required: false, 
      pattern: RIB_PATTERN,
      validator: isValidRib
    },
    iban: { 
      required: false, 
      pattern: TUNISIAN_IBAN_PATTERN,
      validator: isValidTunisianIban
    }
  },
  
  legal: {
    vatMention: { required: true },
    exemptionMention: { 
      requiredWhen: (form: { clientTaxType: string }) => requiresExemptionMention(form.clientTaxType)
    },
    customMention: { required: false, maxLength: MAX_LENGTHS.customMention }
  }
} as const;

// ============================================
// ERROR MESSAGES (French)
// ============================================

export const ERROR_MESSAGES = {
  required: (field: string) => $localize`:@@shared.validation-rules.ts.field.est.obligatoire.c6d452cd:${field}:field: est obligatoire`,
  minLength: (field: string, min: number) => $localize`:@@shared.validation-rules.ts.field.doit.contenir.au.moins.min.caracte.aa92ad30:${field}:field: doit contenir au moins ${min}:min: caractères`,
  maxLength: (field: string, max: number) => $localize`:@@shared.validation-rules.ts.field.ne.peut.pas.depasser.max.caractere.650212c0:${field}:field: ne peut pas dépasser ${max}:max: caractères`,
  min: (field: string, min: number) => $localize`:@@shared.validation-rules.ts.field.doit.etre.superieur.ou.egal.a.min.25317166:${field}:field: doit être supérieur ou égal à ${min}:min:`,
  max: (field: string, max: number) => $localize`:@@shared.validation-rules.ts.field.doit.etre.inferieur.ou.egal.a.max.4664cf44:${field}:field: doit être inférieur ou égal à ${max}:max:`,
  pattern: (field: string) => $localize`:@@shared.validation-rules.ts.format.invalide.pour.field.68a8afd3:Format invalide pour ${field}:field:`,
  email: () => 'Adresse email invalide',
  nif: () => 'Matricule fiscal invalide. Format attendu: 1772793W/A/M/000',
  phone: () => $localize`:@@shared.validation-rules.ts.numero.de.telephone.invalide.format.atte.5902825a:Numéro de téléphone invalide. Format attendu: +216 XX XXX XXX`,
  postalCode: () => 'Code postal invalide. 4 chiffres attendus',
  iban: () => 'IBAN invalide. Format tunisien attendu: TN59XXXX...',
  rib: () => 'RIB invalide. 20 chiffres attendus',
  vatRate: () => $localize`:@@shared.validation-rules.ts.taux.de.tva.invalide.0.7.13.ou.19.autori.87dd5872:Taux de TVA invalide (0%, 7%, 13% ou 19% autorisés)`,
  governorate: () => 'Gouvernorat invalide',
  discountExceedsTotal: () => $localize`:@@shared.validation-rules.ts.la.remise.ne.peut.pas.depasser.le.montan.08bca2a6:La remise ne peut pas dépasser le montant de la ligne`,
  linkedInvoiceRequired: () => $localize`:@@shared.validation-rules.ts.une.facture.d.avoir.doit.etre.liee.a.une.6f9c798f:Une facture d'avoir doit être liée à une facture existante`
} as const;
