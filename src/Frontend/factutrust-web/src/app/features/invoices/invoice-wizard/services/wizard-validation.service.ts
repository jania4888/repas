import { Injectable, signal, computed } from '@angular/core';
import { isConfiguredDocumentNumber } from '@core/utils/numbering-validation';
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
  roundToMillimes,
  amountsEqual,
  MAX_LENGTHS,
  MIN_LENGTHS,
  NUMERIC_LIMITS,
  ERROR_MESSAGES
} from '@shared/validation';
import {
  InvoiceWizardState,
  InvoiceType,
  ClientTaxType,
  ComplianceCheck,
  ValidationResult,
  WizardStepKey,
  FieldError,
  WizardFieldErrors
} from '../models/invoice-wizard.models';
import { normalizeDesignation } from '../utils/invoice-line.utils';
import { computeWizardTotalsCheck } from './invoice-wizard-calculation.utils';

/**
 * Enhanced validation service for the invoice wizard.
 * Provides comprehensive Tunisian fiscal compliance validation.
 */
@Injectable({
  providedIn: 'root'
})
export class WizardValidationService {

  // ============================================
  // STATE
  // ============================================

  private readonly _fieldErrors = signal<WizardFieldErrors>(this.createEmptyErrors());
  
  readonly fieldErrors = this._fieldErrors.asReadonly();

  // ============================================
  // STEP VALIDATION
  // ============================================

  /**
   * Validates a specific wizard step and returns field-level errors.
   */
  validateStep(state: InvoiceWizardState, step: number): { isValid: boolean; errors: Record<string, FieldError[]> } {
    switch (step) {
      case 0:
        return this.validateMetadataStep(state);
      case 1:
        return this.validateSellerStep(state);
      case 2:
        return this.validateClientStep(state);
      case 3:
        return this.validateLinesStep(state);
      case 4:
        return this.validatePaymentLegalStep(state);
      case 5:
        return this.validatePreviewStep(state);
      default:
        return { isValid: true, errors: {} };
    }
  }

  /**
   * Validates Step 0: Metadata
   */
  private validateMetadataStep(state: InvoiceWizardState): { isValid: boolean; errors: Record<string, FieldError[]> } {
    const errors: Record<string, FieldError[]> = {};
    const { metadata } = state;

    // Type validation
    if (!metadata.type) {
      errors['type'] = [this.createError('REQUIRED', ERROR_MESSAGES.required($localize`:@@invoices.wizard-validation.ts.le.type.de.document.5fe3257f:Le type de document`))];
    }

    // Issue date validation
    if (!metadata.issueDate) {
      errors['issueDate'] = [this.createError('REQUIRED', ERROR_MESSAGES.required($localize`:@@invoices.wizard-validation.ts.la.date.d.emission.7b93580a:La date d'émission`))];
    } else {
      const issueDate = new Date(metadata.issueDate);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      if (issueDate > tomorrow) {
        errors['issueDate'] = [this.createError('FUTURE_DATE', $localize`:@@invoices.wizard-validation.ts.la.date.d.emission.ne.peut.pas.etre.dans.4ddf0f4c:La date d'émission ne peut pas être dans le futur`)];
      }
    }

    // Due date validation
    if (metadata.dueDate && metadata.issueDate) {
      const dueDate = new Date(metadata.dueDate);
      const issueDate = new Date(metadata.issueDate);
      
      if (dueDate < issueDate) {
        errors['dueDate'] = [this.createError('DATE_RANGE', $localize`:@@invoices.wizard-validation.ts.la.date.d.echeance.doit.etre.posterieure.9663cae1:La date d'échéance doit être postérieure à la date d'émission`)];
      }
    }

    // Internal reference validation
    if (metadata.internalReference && metadata.internalReference.length > MAX_LENGTHS.internalReference) {
      errors['internalReference'] = [
        this.createError('MAX_LENGTH', ERROR_MESSAGES.maxLength($localize`:@@invoices.wizard-validation.ts.la.reference.interne.f731f7eb:La référence interne`, MAX_LENGTHS.internalReference))
      ];
    }

    // Linked invoice validation for credit notes
    if (metadata.type === InvoiceType.CreditNote && !metadata.linkedInvoiceId) {
      errors['linkedInvoiceId'] = [
        this.createError('REQUIRED', ERROR_MESSAGES.linkedInvoiceRequired())
      ];
    }

    this.updateStepErrors('metadata', errors);
    return { isValid: Object.keys(errors).length === 0, errors };
  }

  /**
   * Validates Step 1: Seller
   */
  private validateSellerStep(state: InvoiceWizardState): { isValid: boolean; errors: Record<string, FieldError[]> } {
    const errors: Record<string, FieldError[]> = {};
    const { seller } = state;

    if (!seller) {
      errors['seller'] = [this.createError('REQUIRED', ERROR_MESSAGES.required($localize`:@@invoices.wizard-validation.ts.l.emetteur.4f892b51:L'émetteur`))];
    } else {
      if (!seller.companyName) {
        errors['companyName'] = [this.createError('REQUIRED', ERROR_MESSAGES.required($localize`:@@invoices.wizard-validation.ts.la.raison.sociale.09e20b6c:La raison sociale`))];
      }

      if (!seller.nif || !isValidNif(seller.nif)) {
        errors['nif'] = [this.createError('INVALID_NIF', ERROR_MESSAGES.nif())];
      }

      if (!seller.address?.street || !seller.address?.city || !seller.address?.governorate) {
        errors['address'] = [this.createError('REQUIRED', ERROR_MESSAGES.required("L'adresse"))];
      }
    }

    this.updateStepErrors('seller', errors);
    return { isValid: Object.keys(errors).length === 0, errors };
  }

  /**
   * Validates Step 2: Client
   */
  private validateClientStep(state: InvoiceWizardState): { isValid: boolean; errors: Record<string, FieldError[]> } {
    const errors: Record<string, FieldError[]> = {};
    const { client } = state;

    if (!client) {
      errors['client'] = [this.createError('REQUIRED', ERROR_MESSAGES.required($localize`:@@invoices.wizard-validation.ts.le.client.668175c9:Le client`))];
      this.updateStepErrors('client', errors);
      return { isValid: false, errors };
    }

    // Name validation
    if (!client.name) {
      errors['name'] = [this.createError('REQUIRED', ERROR_MESSAGES.required($localize`:@@invoices.wizard-validation.ts.le.nom.du.client.19db0b70:Le nom du client`))];
    } else if (client.name.length < MIN_LENGTHS.clientName) {
      errors['name'] = [this.createError('MIN_LENGTH', ERROR_MESSAGES.minLength($localize`:@@invoices.wizard-validation.ts.le.nom.82de3ed9:Le nom`, MIN_LENGTHS.clientName))];
    } else if (client.name.length > MAX_LENGTHS.clientName) {
      errors['name'] = [this.createError('MAX_LENGTH', ERROR_MESSAGES.maxLength($localize`:@@invoices.wizard-validation.ts.le.nom.82de3ed9:Le nom`, MAX_LENGTHS.clientName))];
    }

    // Tax type validation
    if (!client.taxType) {
      errors['taxType'] = [this.createError('REQUIRED', ERROR_MESSAGES.required($localize`:@@invoices.wizard-validation.ts.le.type.de.client.e6adef5f:Le type de client`))];
    }

    // NIF validation (required for TAX_SUBJECT)
    if (requiresNif(client.taxType)) {
      if (!client.nif) {
        errors['nif'] = [this.createError('REQUIRED', $localize`:@@invoices.wizard-validation.ts.le.matricule.fiscal.est.obligatoire.pour.51ef6b29:Le matricule fiscal est obligatoire pour un client assujetti`)];
      } else if (!isValidNif(client.nif)) {
        errors['nif'] = [this.createError('INVALID_NIF', ERROR_MESSAGES.nif())];
      }
    } else if (client.nif && !isValidNif(client.nif)) {
      errors['nif'] = [this.createError('INVALID_NIF', ERROR_MESSAGES.nif())];
    }

    // Email facultatif : format contrôlé seulement s'il est renseigné.
    if (client.email && !isValidEmail(client.email)) {
      errors['email'] = [this.createError('INVALID_EMAIL', ERROR_MESSAGES.email())];
    }

    // Phone validation (optional but must be valid if provided)
    if (client.phone && !isValidTunisianPhone(client.phone)) {
      errors['phone'] = [this.createError('INVALID_PHONE', ERROR_MESSAGES.phone())];
    }

    // Address validation
    if (!client.address?.street) {
      errors['street'] = [this.createError('REQUIRED', ERROR_MESSAGES.required("L'adresse"))];
    } else if (client.address.street.length > MAX_LENGTHS.street) {
      errors['street'] = [this.createError('MAX_LENGTH', ERROR_MESSAGES.maxLength("L'adresse", MAX_LENGTHS.street))];
    }

    if (!client.address?.city) {
      errors['city'] = [this.createError('REQUIRED', ERROR_MESSAGES.required($localize`:@@invoices.wizard-validation.ts.la.ville.819c3a88:La ville`))];
    } else if (client.address.city.length > MAX_LENGTHS.city) {
      errors['city'] = [this.createError('MAX_LENGTH', ERROR_MESSAGES.maxLength($localize`:@@invoices.wizard-validation.ts.la.ville.819c3a88:La ville`, MAX_LENGTHS.city))];
    }

    if (!client.address?.governorate) {
      errors['governorate'] = [this.createError('REQUIRED', ERROR_MESSAGES.required($localize`:@@invoices.wizard-validation.ts.le.gouvernorat.9c3fa2c4:Le gouvernorat`))];
    } else if (!isValidGovernorate(client.address.governorate)) {
      errors['governorate'] = [this.createError('INVALID_GOVERNORATE', ERROR_MESSAGES.governorate())];
    }

    // Postal code validation (optional but must be valid if provided)
    if (client.address?.postalCode && !isValidPostalCode(client.address.postalCode)) {
      errors['postalCode'] = [this.createError('INVALID_POSTAL_CODE', ERROR_MESSAGES.postalCode())];
    }

    this.updateStepErrors('client', errors);
    return { isValid: Object.keys(errors).length === 0, errors };
  }

  /**
   * Validates Step 3: Lines
   */
  private validateLinesStep(state: InvoiceWizardState): { isValid: boolean; errors: Record<string, FieldError[]> } {
    const errors: Record<string, FieldError[]> = {};
    const { lines } = state;

    if (!lines || lines.length === 0) {
      errors['lines'] = [this.createError('REQUIRED', $localize`:@@invoices.wizard-validation.ts.la.facture.doit.contenir.au.moins.une.li.dd6e3b9a:La facture doit contenir au moins une ligne`)];
      this.updateStepErrors('lines', errors);
      return { isValid: false, errors };
    }

    // Validate each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineErrors: FieldError[] = [];

      // Designation validation
      const designation = normalizeDesignation(line.designation);
      if (!designation) {
        lineErrors.push(this.createError('REQUIRED', $localize`:@@invoices.wizard-validation.ts.ligne.p.la.designation.est.obligatoire.6f317658:Ligne ${i + 1}:p:: La désignation est obligatoire`));
      } else if (designation.length < MIN_LENGTHS.designation) {
        lineErrors.push(this.createError('MIN_LENGTH', `Ligne ${i + 1}: ${ERROR_MESSAGES.minLength($localize`:@@invoices.wizard-validation.ts.la.designation.1246ec05:La désignation`, MIN_LENGTHS.designation)}`));
      } else if (designation.length > MAX_LENGTHS.designation) {
        lineErrors.push(this.createError('MAX_LENGTH', `Ligne ${i + 1}: ${ERROR_MESSAGES.maxLength($localize`:@@invoices.wizard-validation.ts.la.designation.1246ec05:La désignation`, MAX_LENGTHS.designation)}`));
      }

      // Product matching is mandatory: POST /api/invoices rejects lines without productId.
      // Blocks step progression until each line is bound to a catalog product.
      if (!line.productId) {
        lineErrors.push(this.createError(
          'PRODUCT_REQUIRED',
          $localize`:@@invoices.wizard-validation.ts.ligne.p.cette.ligne.doit.etre.liee.a.un.fea33a34:Ligne ${i + 1}:p:: cette ligne doit être liée à un produit du catalogue. Sélectionnez un produit existant ou créez-en un nouveau.`
        ));
      }

      // Quantity validation
      if (line.quantity <= 0) {
        lineErrors.push(this.createError('MIN_VALUE', $localize`:@@invoices.wizard-validation.ts.ligne.p.la.quantite.doit.etre.superieure.18b26153:Ligne ${i + 1}:p:: La quantité doit être supérieure à zéro`));
      } else if (line.quantity < NUMERIC_LIMITS.minQuantity) {
        lineErrors.push(this.createError('MIN_VALUE', $localize`:@@invoices.wizard-validation.ts.ligne.p.la.quantite.minimum.est.minquant.d2328d5d:Ligne ${i + 1}:p:: La quantité minimum est ${NUMERIC_LIMITS.minQuantity}:minQuantity:`));
      }

      // Unit price validation
      if (line.unitPriceHT < 0) {
        lineErrors.push(this.createError('MIN_VALUE', $localize`:@@invoices.wizard-validation.ts.ligne.p.le.prix.unitaire.ne.peut.pas.etr.78c21589:Ligne ${i + 1}:p:: Le prix unitaire ne peut pas être négatif`));
      }

      // VAT rate validation
      if (!isValidVatRate(line.vatRate)) {
        lineErrors.push(this.createError('INVALID_VAT_RATE', `Ligne ${i + 1}: ${ERROR_MESSAGES.vatRate()}`));
      }

      // Discount validation
      if (line.discountType && line.discountValue !== null && line.discountValue !== undefined) {
        if (line.discountValue < 0) {
          lineErrors.push(this.createError('MIN_VALUE', $localize`:@@invoices.wizard-validation.ts.ligne.p.la.remise.ne.peut.pas.etre.negat.b67bbf2f:Ligne ${i + 1}:p:: La remise ne peut pas être négative`));
        } else if (line.discountType === 'PERCENT') {
          const maxAllowed = line.productIsDiscountEnabled && line.productMaxDiscountPercent != null
            ? Math.min(line.productMaxDiscountPercent, NUMERIC_LIMITS.maxDiscountPercent)
            : NUMERIC_LIMITS.maxDiscountPercent;
          if (line.discountValue > maxAllowed) {
            lineErrors.push(this.createError(
              'MAX_VALUE',
              maxAllowed < NUMERIC_LIMITS.maxDiscountPercent
                ? $localize`:@@invoices.wizard-validation.ts.ligne.p.la.remise.ne.peut.pas.depasser.m.27aefc9a:Ligne ${i + 1}:p:: La remise ne peut pas dépasser ${maxAllowed}:maxAllowed:% pour ce produit`
                : $localize`:@@invoices.wizard-validation.ts.ligne.p.la.remise.ne.peut.pas.depasser.1.140565e4:Ligne ${i + 1}:p:: La remise ne peut pas dépasser 100%`
            ));
          }
        } else if (line.discountType === 'AMOUNT') {
          const subtotal = line.quantity * line.unitPriceHT;
          if (line.discountValue > subtotal) {
            lineErrors.push(this.createError('DISCOUNT_EXCEEDS_TOTAL', `Ligne ${i + 1}: ${ERROR_MESSAGES.discountExceedsTotal()}`));
          }
        }
      }

      if (lineErrors.length > 0) {
        errors[`line_${i}`] = lineErrors;
      }
    }

    this.updateStepErrors('lines', errors);
    return { isValid: Object.keys(errors).length === 0, errors };
  }

  /**
   * Validates Step 4: Payment & Legal
   */
  private validatePaymentLegalStep(state: InvoiceWizardState): { isValid: boolean; errors: Record<string, FieldError[]> } {
    const errors: Record<string, FieldError[]> = {};
    const { payment, legalMentions, client } = state;

    // Payment method validation
    if (!payment.method) {
      errors['method'] = [this.createError('REQUIRED', ERROR_MESSAGES.required($localize`:@@invoices.wizard-validation.ts.le.mode.de.paiement.6e11b4cd:Le mode de paiement`))];
    }

    // Days until due validation
    if (payment.daysUntilDue !== null && payment.daysUntilDue !== undefined) {
      if (payment.daysUntilDue < 0 || payment.daysUntilDue > NUMERIC_LIMITS.maxPaymentDays) {
        errors['daysUntilDue'] = [
          this.createError('INVALID_FORMAT', $localize`:@@invoices.wizard-validation.ts.le.delai.de.paiement.doit.etre.entre.0.e.ea140021:Le délai de paiement doit être entre 0 et ${NUMERIC_LIMITS.maxPaymentDays}:maxPaymentDays: jours`)
        ];
      }
    }

    // Bank info validation for bank transfer
    if (payment.method === 'BANK_TRANSFER') {
      if (payment.rib && !isValidRib(payment.rib)) {
        errors['rib'] = [this.createError('INVALID_RIB', ERROR_MESSAGES.rib())];
      }
      if (payment.iban && !isValidTunisianIban(payment.iban)) {
        errors['iban'] = [this.createError('INVALID_IBAN', ERROR_MESSAGES.iban())];
      }
    }

    // Payment terms max length
    if (payment.terms && payment.terms.length > MAX_LENGTHS.paymentTerms) {
      errors['terms'] = [this.createError('MAX_LENGTH', ERROR_MESSAGES.maxLength($localize`:@@invoices.wizard-validation.ts.les.conditions.de.paiement.ecfab95a:Les conditions de paiement`, MAX_LENGTHS.paymentTerms))];
    }

    // VAT mention validation
    if (!legalMentions.vatMention) {
      errors['vatMention'] = [this.createWarning('REQUIRED', $localize`:@@invoices.wizard-validation.ts.la.mention.tva.est.recommandee.d90b26c6:La mention TVA est recommandée`)];
    }

    // Exemption mention validation for TAX_EXEMPT clients
    if (client && requiresExemptionMention(client.taxType)) {
      if (!legalMentions.exemptionMention) {
        errors['exemptionMention'] = [
          this.createError('REQUIRED', $localize`:@@invoices.wizard-validation.ts.une.mention.d.exoneration.est.requise.po.e773ce77:Une mention d'exonération est requise pour ce client`)
        ];
      }
    }

    // Custom mention max length
    if (legalMentions.customMention && legalMentions.customMention.length > MAX_LENGTHS.customMention) {
      errors['customMention'] = [
        this.createError('MAX_LENGTH', ERROR_MESSAGES.maxLength($localize`:@@invoices.wizard-validation.ts.la.mention.personnalisee.4c158626:La mention personnalisée`, MAX_LENGTHS.customMention))
      ];
    }

    this.updateStepErrors('legal', errors);
    return { isValid: Object.keys(errors).filter(k => errors[k].some(e => e.severity === 'ERROR')).length === 0, errors };
  }

  /**
   * Validates Step 5: Preview (final validation)
   */
  private validatePreviewStep(state: InvoiceWizardState): { isValid: boolean; errors: Record<string, FieldError[]> } {
    // Preview step validation is handled by full compliance validation
    const errors: Record<string, FieldError[]> = {};
    this.updateStepErrors('preview', errors);
    return { isValid: true, errors };
  }

  // ============================================
  // COMPLIANCE VALIDATION
  // ============================================

  /**
   * Performs full compliance validation for final submission.
   */
  validateCompliance(state: InvoiceWizardState): ValidationResult {
    const checks: ComplianceCheck[] = [];

    // LEGAL CHECKS
    checks.push(this.checkInvoiceNumber(state));
    checks.push(this.checkIssueDate(state));
    checks.push(this.checkSellerInfo(state));
    checks.push(this.checkSellerNif(state));
    checks.push(this.checkClientInfo(state));
    checks.push(this.checkClientNif(state));

    // FISCAL CHECKS
    checks.push(this.checkVatRates(state));
    checks.push(this.checkVatMention(state));
    checks.push(this.checkExemptionMention(state));
    checks.push(this.checkCurrency(state));

    // CALCULATION CHECKS
    checks.push(this.checkLinesReady(state));
    checks.push(this.checkCalculations(state));
    checks.push(this.checkAmountsPositive(state));
    checks.push(this.checkDiscountLimits(state));

    // FORMAT CHECKS
    checks.push(this.checkNumberFormat(state));
    checks.push(this.checkDateConsistency(state));

    // CREDIT NOTE CHECKS
    if (state.metadata.type === InvoiceType.CreditNote) {
      checks.push(this.checkLinkedInvoice(state));
      checks.push(this.checkCreditNoteAmount(state));
    }

    const errorCount = checks.filter(c => c.status === 'ERROR').length;
    const warningCount = checks.filter(c => c.status === 'WARNING').length;
    const blockingErrors = checks.filter(c => c.status === 'ERROR' && c.isBlocking);

    return {
      isValid: errorCount === 0,
      checks,
      errorCount,
      warningCount,
      canProceed: blockingErrors.length === 0
    };
  }

  // ============================================
  // COMPLIANCE CHECK IMPLEMENTATIONS
  // ============================================

  private checkInvoiceNumber(state: InvoiceWizardState): ComplianceCheck {
    const number = state.metadata.invoiceNumber;
    
    // Vérifier que le numéro existe et n'est pas vide
    if (!number || number.trim().length === 0) {
      return {
        id: 'invoice-number',
        category: 'LEGAL',
        label: $localize`:@@invoices.wizard-validation.ts.numero.de.facture.a19ac308:Numéro de facture`,
        description: $localize`:@@invoices.wizard-validation.ts.le.numero.de.facture.est.obligatoire.et.35fb4297:Le numéro de facture est obligatoire et doit être séquentiel`,
        status: 'ERROR',
        isBlocking: true,
        field: 'invoiceNumber'
      };
    }

    // Vérifier le format séquentiel attendu: PREFIX-YYYY-NNNNNN (ex: FAC-2026-000001)
    const hasValidFormat = isConfiguredDocumentNumber(number);
    
    // Si le numéro est temporaire, ce n'est plus bloquant - il sera généré automatiquement lors de la soumission
    const containsTemp = number.toUpperCase().includes('TEMP');
    const isValid = hasValidFormat || containsTemp;

    return {
      id: 'invoice-number',
      category: 'LEGAL',
      label: $localize`:@@invoices.wizard-validation.ts.numero.de.facture.a19ac308:Numéro de facture`,
      description: hasValidFormat
        ? $localize`:@@invoices.wizard-validation.ts.numero.sequentiel.valide.number.1268a4cf:Numéro séquentiel valide: ${number}:number:`
        : containsTemp
          ? $localize`:@@invoices.wizard-validation.ts.le.numero.sera.genere.automatiquement.lo.471884c8:Le numéro sera généré automatiquement lors de la validation`
          : $localize`:@@invoices.wizard-validation.ts.le.numero.de.facture.doit.respecter.le.f.3f12caac:Le numéro de facture doit respecter le format configuré dans les numérotations`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: false, // Plus bloquant - génération automatique lors de la soumission
      field: 'invoiceNumber'
    };
  }

  private checkIssueDate(state: InvoiceWizardState): ComplianceCheck {
    const date = state.metadata.issueDate;
    const isValid = !!date;

    return {
      id: 'issue-date',
      category: 'LEGAL',
      label: $localize`:@@invoices.wizard-validation.ts.date.d.emission.99f68857:Date d'émission`,
      description: isValid
        ? $localize`:@@invoices.wizard-validation.ts.date.tolocaledatestring.35910f2f:Date: ${new Date(date).toLocaleDateString('fr-TN')}:toLocaleDateString:`
        : $localize`:@@invoices.wizard-validation.ts.la.date.d.emission.est.obligatoire.b8bfb9d9:La date d'émission est obligatoire`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'issueDate'
    };
  }

  private checkSellerInfo(state: InvoiceWizardState): ComplianceCheck {
    const seller = state.seller;
    const isValid = !!seller && !!seller.companyName && !!seller.address;

    return {
      id: 'seller-info',
      category: 'LEGAL',
      label: $localize`:@@invoices.wizard-validation.ts.informations.emetteur.17adfe24:Informations émetteur`,
      description: isValid
        ? $localize`:@@invoices.wizard-validation.ts.emetteur.companyname.a14007d0:Émetteur: ${seller!.companyName}:companyName:`
        : $localize`:@@invoices.wizard-validation.ts.les.informations.de.l.emetteur.sont.inco.4de9bcb6:Les informations de l'émetteur sont incomplètes`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'seller'
    };
  }

  private checkSellerNif(state: InvoiceWizardState): ComplianceCheck {
    const seller = state.seller;
    const nif = seller?.nif;
    const isValid = !!nif && isValidNif(nif);

    return {
      id: 'seller-nif',
      category: 'FISCAL',
      label: $localize`:@@invoices.wizard-validation.ts.matricule.fiscal.emetteur.f1181797:Matricule fiscal émetteur`,
      description: isValid
        ? `NIF: ${nif}`
        : $localize`:@@invoices.wizard-validation.ts.le.matricule.fiscal.de.l.emetteur.est.in.df30f39a:Le matricule fiscal de l'émetteur est invalide ou manquant`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'seller.nif'
    };
  }

  private checkClientInfo(state: InvoiceWizardState): ComplianceCheck {
    const client = state.client;
    const isValid = !!client && !!client.name && !!client.address;

    return {
      id: 'client-info',
      category: 'LEGAL',
      label: $localize`:@@invoices.wizard-validation.ts.informations.client.179987af:Informations client`,
      description: isValid
        ? $localize`:@@invoices.wizard-validation.ts.client.name.6f485dcb:Client: ${client!.name}:name:`
        : $localize`:@@invoices.wizard-validation.ts.les.informations.du.client.sont.incomple.5191db2e:Les informations du client sont incomplètes`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'client'
    };
  }

  private checkClientNif(state: InvoiceWizardState): ComplianceCheck {
    const client = state.client;
    const isTaxSubject = client?.taxType === ClientTaxType.TaxSubject;
    const hasValidNif = !!client?.nif && isValidNif(client.nif);

    if (!isTaxSubject) {
      return {
        id: 'client-nif',
        category: 'FISCAL',
        label: $localize`:@@invoices.wizard-validation.ts.matricule.fiscal.client.a6352da1:Matricule fiscal client`,
        description: $localize`:@@invoices.wizard-validation.ts.non.requis.pour.ce.type.de.client.0a836f2d:Non requis pour ce type de client`,
        status: 'VALID',
        isBlocking: false,
        field: 'client.nif'
      };
    }

    return {
      id: 'client-nif',
      category: 'FISCAL',
      label: $localize`:@@invoices.wizard-validation.ts.matricule.fiscal.client.a6352da1:Matricule fiscal client`,
      description: hasValidNif
        ? `NIF: ${client!.nif}`
        : $localize`:@@invoices.wizard-validation.ts.le.matricule.fiscal.est.obligatoire.pour.51ef6b29:Le matricule fiscal est obligatoire pour un client assujetti`,
      status: hasValidNif ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'client.nif'
    };
  }

  private checkVatRates(state: InvoiceWizardState): ComplianceCheck {
    const lines = state.lines;
    const allValid = lines.every(l => isValidVatRate(l.vatRate));

    return {
      id: 'vat-rates',
      category: 'FISCAL',
      label: $localize`:@@invoices.wizard-validation.ts.taux.de.tva.e704ceaf:Taux de TVA`,
      description: allValid
        ? $localize`:@@invoices.wizard-validation.ts.tous.les.taux.tva.sont.conformes.81e5176c:Tous les taux TVA sont conformes`
        : $localize`:@@invoices.wizard-validation.ts.certains.taux.tva.ne.sont.pas.conformes.582ab736:Certains taux TVA ne sont pas conformes à la législation tunisienne`,
      status: allValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'lines.vatRate'
    };
  }

  private checkVatMention(state: InvoiceWizardState): ComplianceCheck {
    const mention = state.legalMentions.vatMention;
    const isValid = !!mention && mention.length > 0;

    return {
      id: 'vat-mention',
      category: 'LEGAL',
      label: $localize`:@@invoices.wizard-validation.ts.mention.tva.0fb27cc0:Mention TVA`,
      description: isValid
        ? $localize`:@@invoices.wizard-validation.ts.mention.tva.presente.9e85c920:Mention TVA présente`
        : $localize`:@@invoices.wizard-validation.ts.la.mention.tva.due.par.le.vendeur.est.ob.c6f879f2:La mention "TVA due par le vendeur" est obligatoire`,
      status: isValid ? 'VALID' : 'WARNING',
      isBlocking: false,
      field: 'legalMentions.vatMention'
    };
  }

  private checkExemptionMention(state: InvoiceWizardState): ComplianceCheck {
    const client = state.client;
    const mentions = state.legalMentions;
    const needsExemption = client?.taxType === ClientTaxType.TaxExempt;
    const hasExemption = !!mentions.exemptionMention;

    if (!needsExemption) {
      return {
        id: 'exemption-mention',
        category: 'FISCAL',
        label: $localize`:@@invoices.wizard-validation.ts.mention.d.exoneration.0df903f7:Mention d'exonération`,
        description: $localize`:@@invoices.wizard-validation.ts.non.applicable.16ed38d0:Non applicable`,
        status: 'VALID',
        isBlocking: false,
        field: null
      };
    }

    return {
      id: 'exemption-mention',
      category: 'FISCAL',
      label: $localize`:@@invoices.wizard-validation.ts.mention.d.exoneration.0df903f7:Mention d'exonération`,
      description: hasExemption
        ? $localize`:@@invoices.wizard-validation.ts.mention.d.exoneration.presente.463fbd71:Mention d'exonération présente`
        : $localize`:@@invoices.wizard-validation.ts.une.mention.d.exoneration.est.requise.po.e773ce77:Une mention d'exonération est requise pour ce client`,
      status: hasExemption ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'legalMentions.exemptionMention'
    };
  }

  private checkCurrency(state: InvoiceWizardState): ComplianceCheck {
    const currency = state.metadata.currency;
    const isLocal = currency === 'TND';

    if (!isLocal) {
      return {
        id: 'currency',
        category: 'FISCAL',
        label: $localize`:@@invoices.wizard-validation.ts.devise.eb2e42c4:Devise`,
        description: $localize`:@@invoices.wizard-validation.ts.devise.etrangere.currency.l.equivalent.e.b8e1b7bb:Devise étrangère (${currency}:currency:) - L'équivalent en TND doit être mentionné`,
        status: 'WARNING',
        isBlocking: false,
        field: 'metadata.currency'
      };
    }

    return {
      id: 'currency',
      category: 'FISCAL',
      label: $localize`:@@invoices.wizard-validation.ts.devise.eb2e42c4:Devise`,
      description: $localize`:@@invoices.wizard-validation.ts.dinar.tunisien.tnd.76fa137a:Dinar Tunisien (TND)`,
      status: 'VALID',
      isBlocking: false,
      field: 'metadata.currency'
    };
  }

  /**
   * Validates that all invoice lines are complete and linked to catalog products.
   * Reuses validateLinesStep (legacy step index 3) as the single source of truth.
   */
  checkLinesReady(state: InvoiceWizardState): ComplianceCheck {
    const { isValid, errors } = this.validateStep(state, 3);
    const lineCount = state.lines.length;
    const firstError = this.firstFieldErrorMessage(errors);

    return {
      id: 'lines-product-link',
      category: 'CALCULATION',
      label: $localize`:@@invoices.wizard-validation.ts.lignes.de.facturation.5896ee38:Lignes de facturation`,
      description: isValid
        ? $localize`:@@invoices.wizard-validation.ts.linecount.ligne.s.valide.s.3460a885:${lineCount}:lineCount: ligne(s) valide(s)`
        : firstError ?? $localize`:@@invoices.wizard-validation.ts.certaines.lignes.sont.incompletes.ou.non.72eddfde:Certaines lignes sont incomplètes ou non liées à un produit`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'lines'
    };
  }

  private firstFieldErrorMessage(errors: Record<string, FieldError[]>): string | null {
    for (const fieldErrors of Object.values(errors)) {
      const blocking = fieldErrors.find(e => e.severity === 'ERROR');
      if (blocking) {
        return blocking.message;
      }
    }
    return null;
  }

  private checkCalculations(state: InvoiceWizardState): ComplianceCheck {
    const { isValid } = computeWizardTotalsCheck(state);

    return {
      id: 'calculations',
      category: 'CALCULATION',
      label: $localize`:@@invoices.wizard-validation.ts.verification.des.calculs.68a4d18c:Vérification des calculs`,
      description: isValid
        ? $localize`:@@invoices.wizard-validation.ts.tous.les.calculs.sont.coherents.1f7d5957:Tous les calculs sont cohérents`
        : $localize`:@@invoices.wizard-validation.ts.incoherence.detectee.dans.les.calculs.fd9ab997:Incohérence détectée dans les calculs`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'totals'
    };
  }

  private checkAmountsPositive(state: InvoiceWizardState): ComplianceCheck {
    const totals = state.totals;
    const type = state.metadata.type;

    // Credit notes can have negative amounts
    if (type === InvoiceType.CreditNote) {
      return {
        id: 'amounts-positive',
        category: 'CALCULATION',
        label: $localize`:@@invoices.wizard-validation.ts.montants.6b312baa:Montants`,
        description: $localize`:@@invoices.wizard-validation.ts.facture.d.avoir.montants.verifies.e678bb1e:Facture d'avoir - montants vérifiés`,
        status: 'VALID',
        isBlocking: false,
        field: null
      };
    }

    const isValid = totals.totalHT >= 0 && totals.totalTTC >= 0;

    return {
      id: 'amounts-positive',
      category: 'CALCULATION',
      label: $localize`:@@invoices.wizard-validation.ts.montants.positifs.d5089c18:Montants positifs`,
      description: isValid
        ? $localize`:@@invoices.wizard-validation.ts.tous.les.montants.sont.positifs.e3f5fc38:Tous les montants sont positifs`
        : $localize`:@@invoices.wizard-validation.ts.les.montants.doivent.etre.positifs.pour.0d0e6741:Les montants doivent être positifs pour une facture standard`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'totals'
    };
  }

  private checkDiscountLimits(state: InvoiceWizardState): ComplianceCheck {
    const lines = state.lines;
    const invalidDiscounts: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.discountValue && line.discountValue > 0) {
        const subtotal = line.quantity * line.unitPriceHT;

        if (line.discountType === 'PERCENT' && line.discountValue > 100) {
          invalidDiscounts.push(`Ligne ${i + 1}: ${line.discountValue}% > 100%`);
        } else if (line.discountType === 'AMOUNT' && line.discountValue > subtotal) {
          invalidDiscounts.push(`Ligne ${i + 1}: remise > sous-total`);
        }
      }
    }

    const isValid = invalidDiscounts.length === 0;

    return {
      id: 'discount-limits',
      category: 'CALCULATION',
      label: $localize`:@@invoices.wizard-validation.ts.limites.des.remises.640b5bd9:Limites des remises`,
      description: isValid
        ? $localize`:@@invoices.wizard-validation.ts.toutes.les.remises.sont.dans.les.limites.8d0ce863:Toutes les remises sont dans les limites`
        : invalidDiscounts.join('; '),
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'lines.discountValue'
    };
  }

  private checkNumberFormat(state: InvoiceWizardState): ComplianceCheck {
    const number = state.metadata.invoiceNumber;
    const isValid = !!number && (isConfiguredDocumentNumber(number) || number.startsWith('TEMP'));

    return {
      id: 'number-format',
      category: 'FORMAT',
      label: $localize`:@@invoices.wizard-validation.ts.format.du.numero.ed424764:Format du numéro`,
      description: isValid
        ? $localize`:@@invoices.wizard-validation.ts.format.conforme.2f9c1bfd:Format conforme`
        : $localize`:@@invoices.wizard-validation.ts.le.format.du.numero.de.facture.doit.etre.495b6b5d:Le format du numéro de facture doit être: PREFIX-AAAA-NNNNNN`,
      status: isValid ? 'VALID' : 'WARNING',
      isBlocking: false,
      field: 'invoiceNumber'
    };
  }

  private checkDateConsistency(state: InvoiceWizardState): ComplianceCheck {
    const { issueDate, dueDate } = state.metadata;

    if (!dueDate) {
      return {
        id: 'date-consistency',
        category: 'FORMAT',
        label: $localize`:@@invoices.wizard-validation.ts.coherence.des.dates.bc690eeb:Cohérence des dates`,
        description: $localize`:@@invoices.wizard-validation.ts.date.d.echeance.non.definie.53c03b44:Date d'échéance non définie`,
        status: 'VALID',
        isBlocking: false,
        field: null
      };
    }

    const isValid = new Date(dueDate) >= new Date(issueDate);

    return {
      id: 'date-consistency',
      category: 'FORMAT',
      label: $localize`:@@invoices.wizard-validation.ts.coherence.des.dates.bc690eeb:Cohérence des dates`,
      description: isValid
        ? $localize`:@@invoices.wizard-validation.ts.les.dates.sont.coherentes.eef58581:Les dates sont cohérentes`
        : $localize`:@@invoices.wizard-validation.ts.la.date.d.echeance.doit.etre.posterieure.9663cae1:La date d'échéance doit être postérieure à la date d'émission`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'metadata.dueDate'
    };
  }

  private checkLinkedInvoice(state: InvoiceWizardState): ComplianceCheck {
    const linkedId = state.metadata.linkedInvoiceId;
    const isValid = !!linkedId;

    return {
      id: 'linked-invoice',
      category: 'LEGAL',
      label: $localize`:@@invoices.wizard-validation.ts.facture.liee.aa5f63ce:Facture liée`,
      description: isValid
        ? $localize`:@@invoices.wizard-validation.ts.facture.liee.selectionnee.861e3603:Facture liée sélectionnée`
        : $localize`:@@invoices.wizard-validation.ts.une.facture.d.avoir.doit.etre.liee.a.une.6f9c798f:Une facture d'avoir doit être liée à une facture existante`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'metadata.linkedInvoiceId'
    };
  }

  private checkCreditNoteAmount(state: InvoiceWizardState): ComplianceCheck {
    const available = state.linkedInvoiceCommercialTtc;
    if (available == null) {
      return {
        id: 'credit-note-amount',
        category: 'CALCULATION',
        label: $localize`:@@invoices.wizard-validation.ts.montant.avoir.b37fa84e:Montant avoir`,
        description: $localize`:@@invoices.wizard-validation.ts.montant.a.verifier.a.l.emission.b075bf4b:Montant à vérifier à l'émission`,
        status: 'VALID',
        isBlocking: false,
        field: 'totals'
      };
    }

    const draftCommercial = roundToMillimes(
      state.lines.reduce((sum, line) => sum + (line.totalTTC ?? 0), 0)
    );
    const isValid = draftCommercial <= available + NUMERIC_LIMITS.calculationTolerance;

    return {
      id: 'credit-note-amount',
      category: 'CALCULATION',
      label: $localize`:@@invoices.wizard-validation.ts.montant.avoir.b37fa84e:Montant avoir`,
      description: isValid
        ? $localize`:@@invoices.wizard-validation.ts.montant.valide.tofixed.tnd.tofixed1.tnd.50de07d6:Montant valide: ${draftCommercial.toFixed(3)}:toFixed: TND ≤ ${available.toFixed(3)}:toFixed1: TND`
        : $localize`:@@invoices.wizard-validation.ts.le.montant.de.l.avoir.tofixed.tnd.depass.effdb094:Le montant de l'avoir (${draftCommercial.toFixed(3)}:toFixed: TND) dépasse la facture originale (${available.toFixed(3)}:toFixed1: TND)`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'totals'
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private createError(code: string, message: string): FieldError {
    return { code, message, severity: 'ERROR' };
  }

  private createWarning(code: string, message: string): FieldError {
    return { code, message, severity: 'WARNING' };
  }

  private createEmptyErrors(): WizardFieldErrors {
    return {
      // Legacy 6-step flow
      metadata: {},
      seller: {},
      client: {},
      lines: {},
      legal: {},
      preview: {},
      // Simplified 4-step flow
      document: {},
      billing: {},
      review: {}
    };
  }

  private updateStepErrors(stepKey: WizardStepKey, errors: Record<string, FieldError[]>): void {
    this._fieldErrors.update(current => ({
      ...current,
      [stepKey]: errors
    }));
  }

  /**
   * Clears all validation errors.
   */
  clearAllErrors(): void {
    this._fieldErrors.set(this.createEmptyErrors());
  }

  /**
   * Clears errors for a specific step.
   */
  clearStepErrors(stepKey: WizardStepKey): void {
    this._fieldErrors.update(current => ({
      ...current,
      [stepKey]: {}
    }));
  }
}
