/**
 * Invoice Wizard Models
 * Conformité fiscale tunisienne - InstaFact
 */

// ============================================
// ENUMS
// ============================================

/** Type de document fiscal */
export enum InvoiceType {
  Invoice = 'INVOICE',           // Facture standard
  CreditNote = 'CREDIT_NOTE'     // Facture d'avoir
}

/** Type de client selon la législation tunisienne */
export enum ClientTaxType {
  TaxSubject = 'TAX_SUBJECT',        // Assujetti à la TVA
  NonTaxSubject = 'NON_TAX_SUBJECT', // Non assujetti
  TaxExempt = 'TAX_EXEMPT'           // Exonéré de TVA
}

/** Taux de TVA tunisiens */
export enum TunisianVatRate {
  Exempt = 0,        // 0% - Exonéré
  Reduced = 7,       // 7% - Taux réduit
  Intermediate = 13, // 13% - Taux intermédiaire
  Standard = 19      // 19% - Taux normal
}

/** Mode de paiement */
export enum PaymentMethod {
  Cash = 'CASH',                 // Espèces
  BankTransfer = 'BANK_TRANSFER', // Virement bancaire
  Check = 'CHECK',               // Chèque
  Card = 'CARD',                 // Carte bancaire
  Effect = 'EFFECT'              // Effet de commerce
}

/** Devise */
export enum Currency {
  TND = 'TND', // Dinar Tunisien (défaut)
  EUR = 'EUR', // Euro
  USD = 'USD'  // Dollar américain
}

// ============================================
// STEP 1 - Type de document & métadonnées
// ============================================

export interface InvoiceMetadata {
  type: InvoiceType;
  invoiceNumber: string;           // Auto-généré, non modifiable
  issueDate: Date;
  dueDate: Date | null;
  currency: Currency;
  internalReference: string | null;
  linkedInvoiceId: string | null;  // Pour factures d'avoir
  warehouseId: string | null;
  cashRegisterSessionId: string | null;
}

// ============================================
// STEP 2 - Informations du vendeur
// ============================================

export interface SellerInfo {
  id: string;
  companyName: string;
  tradeName: string | null;
  address: AddressInfo;
  nif: string;                     // Matricule fiscal
  commerceRegistry: string | null; // Registre de commerce
  vatCode: string | null;          // Code TVA
  logo: string | null;             // URL du logo
  phone: string | null;
  email: string;
}

export interface AddressInfo {
  street: string;
  streetLine2: string | null;
  postalCode: string | null;
  city: string;
  governorate: string;
  country: string;
}

// ============================================
// STEP 3 - Informations du client
// ============================================

export interface ClientInfo {
  id: string | null;               // null si création rapide
  isNewClient: boolean;
  name: string;
  taxType: ClientTaxType;
  address: AddressInfo;
  nif: string | null;              // Obligatoire si assujetti
  email: string;
  phone: string | null;
  contactPerson: string | null;
}

// ============================================
// STEP 4 - Lignes de facturation
// ============================================

export interface InvoiceLine {
  id: string;                      // UUID temporaire côté client
  lineNumber: number;
  productId: string | null;
  designation: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPriceHT: number;
  /** True when the user manually set the unit price (bypasses server price resolver on submit). */
  priceOverridden?: boolean;
  /** Origine du prix résolu par le serveur (affichage uniquement). */
  priceSource?: 'Catalog' | 'PriceList' | 'ClientPrice' | null;
  discountType: 'PERCENT' | 'AMOUNT' | null;
  discountValue: number | null;
  vatRate: TunisianVatRate;
  isFodecApplicable: boolean;
  /** Product-level discount cap (from catalog). */
  productIsDiscountEnabled?: boolean;
  productMaxDiscountPercent?: number | null;

  /** Prévisualisation promotion automatique (non envoyée au serveur). */
  promotionDiscountPercent?: number | null;
  promotionName?: string | null;
  promotionEligible?: boolean;
  promotionMinQuantityRequired?: number | null;
  
  // Calculs automatiques
  discountAmount: number;
  totalHT: number;
  fodecAmount: number;
  vatAmount: number;
  totalTTC: number;
}

export interface InvoiceTotals {
  subTotalHT: number;
  totalDiscount: number;
  totalHT: number;
  totalFodec: number;
  vatBreakdown: VatBreakdownItem[];
  totalVat: number;
  /** Timbre fiscal (signé : négatif sur avoir). */
  fiscalStampAmount: number;
  totalTTC: number;
  currency: Currency;
  fodecRatePercent: number;
}

export interface VatBreakdownItem {
  rate: TunisianVatRate;
  rateDisplay: string;
  baseAmount: number;
  vatAmount: number;
}

// ============================================
// STEP 5 - Mentions légales & paiement
// ============================================

export interface LegalMentions {
  vatMention: string;              // "TVA due par le vendeur"
  exemptionMention: string | null; // Si client exonéré
  customMention: string | null;    // Mention personnalisée
}

export interface PaymentInfo {
  method: PaymentMethod;
  terms: string | null;            // Conditions de paiement
  daysUntilDue: number | null;     // Délai de paiement
  bankName: string | null;
  iban: string | null;
  rib: string | null;
  purchaseOrderRef: string | null; // Référence bon de commande
}

// ============================================
// STEP 6 - Validation & émission
// ============================================

export interface ComplianceCheck {
  id: string;
  category: 'LEGAL' | 'FISCAL' | 'CALCULATION' | 'FORMAT';
  label: string;
  description: string;
  status: 'VALID' | 'WARNING' | 'ERROR';
  isBlocking: boolean;
  field: string | null;
}

export interface ValidationResult {
  isValid: boolean;
  checks: ComplianceCheck[];
  errorCount: number;
  warningCount: number;
  canProceed: boolean;
}

// ============================================
// VALIDATION ERROR TYPES (Synced with backend)
// ============================================

/** Error severity levels */
export type ErrorSeverity = 'ERROR' | 'WARNING';

/** Individual field error */
export interface FieldError {
  code: string;
  message: string;
  attemptedValue?: unknown;
  severity: ErrorSeverity;
}

/** Unified validation error response from backend */
export interface ValidationErrorResponse {
  success: false;
  code: string;
  message: string;
  fieldErrors: Record<string, FieldError[]>;
  globalErrors: string[];
  wizardStep?: number;
  canProceed: boolean;
  errorCount: number;
  warningCount: number;
}

/** Wizard field errors by step */
export type WizardFieldErrors = Record<WizardStepKey, Record<string, FieldError[]>>;

// ============================================
// WIZARD STATE
// ============================================

export interface WizardStep {
  index: number;
  key: WizardStepKey;
  label: string;
  description: string;
  icon: string;
  isComplete: boolean;
  isValid: boolean;
  isActive: boolean;
  isDisabled: boolean;
}

export type WizardStepKey =
  // Legacy 6-step flow
  | 'metadata'
  | 'seller'
  | 'client'
  | 'lines'
  | 'legal'
  | 'preview'
  // Simplified 4-step flow (feature-flagged)
  | 'document'
  | 'billing'
  | 'review';

export interface InvoiceWizardState {
  currentStep: number;
  steps: WizardStep[];
  
  // Données par étape
  metadata: InvoiceMetadata;
  seller: SellerInfo | null;
  client: ClientInfo | null;
  lines: InvoiceLine[];
  totals: InvoiceTotals;
  legalMentions: LegalMentions;
  payment: PaymentInfo;
  
  // État global
  isDirty: boolean;
  isSaving: boolean;
  lastSaved: Date | null;
  draftId: string | null;
  validationResult: ValidationResult | null;
  submissionError: string | null; // Erreur lors de l'émission
  /** TTC commercial (hors timbre) de la FAC liée, pour le pré-contrôle montant avoir. */
  linkedInvoiceCommercialTtc: number | null;
}

// ============================================
// API REQUESTS
// ============================================

export interface CreateInvoiceWizardRequest {
  type: InvoiceType;
  issueDate: string;
  dueDate: string | null;
  currency: Currency;
  internalReference: string | null;
  linkedInvoiceId: string | null;
  
  sellerId: string;
  
  clientId: string | null;
  newClient: CreateClientRequest | null;
  
  lines: CreateInvoiceLineRequest[];
  
  paymentMethod: PaymentMethod;
  paymentTerms: string | null;
  bankInfo: BankInfoRequest | null;
  purchaseOrderRef: string | null;
  
  legalMentions: string | null;
  notes: string | null;
  
  saveAsDraft: boolean;
}

export interface CreateClientRequest {
  name: string;
  taxType: ClientTaxType;
  nif: string | null;
  street: string;
  streetLine2: string | null;
  postalCode: string | null;
  city: string;
  governorate: string;
  email: string;
  phone: string | null;
  contactPerson: string | null;
}

export interface CreateInvoiceLineRequest {
  productId: string | null;
  designation: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPriceHT: number;
  discountPercent: number | null;
  discountAmount: number | null;
  vatRate: TunisianVatRate;
}

export interface BankInfoRequest {
  bankName: string;
  iban: string | null;
  rib: string | null;
}

// ============================================
// DROPDOWN OPTIONS
// ============================================

export interface SelectOption<T = string> {
  label: string;
  value: T;
  disabled?: boolean;
  icon?: string;
  description?: string;
}

export const INVOICE_TYPE_OPTIONS: SelectOption<InvoiceType>[] = [
  { 
    label: $localize`:@@invoices.invoice-wizard.ts.facture.3953b9f5:Facture`, 
    value: InvoiceType.Invoice,
    icon: 'pi pi-file',
    description: $localize`:@@invoices.invoice-wizard.ts.facture.de.vente.standard.3f8e51cd:Facture de vente standard`
  },
  { 
    label: $localize`:@@invoices.invoice-wizard.ts.facture.d.avoir.541e4451:Facture d'avoir`, 
    value: InvoiceType.CreditNote,
    icon: 'pi pi-file-edit',
    description: $localize`:@@invoices.invoice-wizard.ts.pour.correction.ou.remboursement.c6cb6293:Pour correction ou remboursement`
  }
];

export const CLIENT_TAX_TYPE_OPTIONS: SelectOption<ClientTaxType>[] = [
  { 
    label: $localize`:@@invoices.invoice-wizard.ts.assujetti.a.la.tva.8ec85b01:Assujetti à la TVA`, 
    value: ClientTaxType.TaxSubject,
    description: $localize`:@@invoices.invoice-wizard.ts.client.soumis.a.la.tva.matricule.fiscal.9faeeba3:Client soumis à la TVA - Matricule fiscal obligatoire`
  },
  { 
    label: $localize`:@@invoices.invoice-wizard.ts.non.assujetti.c686966b:Non assujetti`, 
    value: ClientTaxType.NonTaxSubject,
    description: $localize`:@@invoices.invoice-wizard.ts.client.non.soumis.a.la.tva.3412dd9a:Client non soumis à la TVA`
  },
  { 
    label: $localize`:@@invoices.invoice-wizard.ts.exonere.de.tva.be6ac1a9:Exonéré de TVA`, 
    value: ClientTaxType.TaxExempt,
    description: $localize`:@@invoices.invoice-wizard.ts.beneficie.d.une.exoneration.legale.abdecb34:Bénéficie d'une exonération légale`
  }
];

export const VAT_RATE_OPTIONS: SelectOption<TunisianVatRate>[] = [
  { label: $localize`:@@invoices.invoice-wizard.ts.19.taux.normal.1dc12a7c:19% - Taux normal`, value: TunisianVatRate.Standard },
  { label: $localize`:@@invoices.invoice-wizard.ts.13.taux.intermediaire.f50bb2e0:13% - Taux intermédiaire`, value: TunisianVatRate.Intermediate },
  { label: $localize`:@@invoices.invoice-wizard.ts.7.taux.reduit.e464d7cf:7% - Taux réduit`, value: TunisianVatRate.Reduced },
  { label: $localize`:@@invoices.invoice-wizard.ts.0.exonere.45b95f13:0% - Exonéré`, value: TunisianVatRate.Exempt }
];

export const PAYMENT_METHOD_OPTIONS: SelectOption<PaymentMethod>[] = [
  { label: $localize`:@@invoices.invoice-wizard.ts.virement.bancaire.8306f08e:Virement bancaire`, value: PaymentMethod.BankTransfer, icon: 'pi pi-building' },
  { label: $localize`:@@invoices.invoice-wizard.ts.especes.b7679d62:Espèces`, value: PaymentMethod.Cash, icon: 'pi pi-money-bill' },
  { label: $localize`:@@invoices.invoice-wizard.ts.cheque.8bbb89a9:Chèque`, value: PaymentMethod.Check, icon: 'pi pi-credit-card' },
  { label: $localize`:@@invoices.invoice-wizard.ts.carte.bancaire.9e3d9bfa:Carte bancaire`, value: PaymentMethod.Card, icon: 'pi pi-credit-card' },
  { label: $localize`:@@invoices.invoice-wizard.ts.effet.de.commerce.9793a8f7:Effet de commerce`, value: PaymentMethod.Effect, icon: 'pi pi-file' }
];

export const CURRENCY_OPTIONS: SelectOption<Currency>[] = [
  { label: $localize`:@@invoices.invoice-wizard.ts.tnd.dinar.tunisien.ecb6c7c0:TND - Dinar Tunisien`, value: Currency.TND },
  { label: $localize`:@@invoices.invoice-wizard.ts.eur.euro.dd8e746b:EUR - Euro`, value: Currency.EUR },
  { label: $localize`:@@invoices.invoice-wizard.ts.usd.dollar.americain.c7ec61f6:USD - Dollar américain`, value: Currency.USD }
];

export const TUNISIAN_GOVERNORATES: SelectOption<string>[] = [
  { label: $localize`:@@invoices.invoice-wizard.ts.ariana.4787a016:Ariana`, value: 'Ariana' },
  { label: $localize`:@@invoices.invoice-wizard.ts.beja.603d1fac:Béja`, value: 'Béja' },
  { label: $localize`:@@invoices.invoice-wizard.ts.ben.arous.3fab69ae:Ben Arous`, value: 'Ben Arous' },
  { label: $localize`:@@invoices.invoice-wizard.ts.bizerte.2e83a969:Bizerte`, value: 'Bizerte' },
  { label: $localize`:@@invoices.invoice-wizard.ts.gabes.e4b74f5d:Gabès`, value: 'Gabès' },
  { label: $localize`:@@invoices.invoice-wizard.ts.gafsa.eae1e5d1:Gafsa`, value: 'Gafsa' },
  { label: $localize`:@@invoices.invoice-wizard.ts.jendouba.c6f39067:Jendouba`, value: 'Jendouba' },
  { label: $localize`:@@invoices.invoice-wizard.ts.kairouan.62201cff:Kairouan`, value: 'Kairouan' },
  { label: $localize`:@@invoices.invoice-wizard.ts.kasserine.2ac4b4c3:Kasserine`, value: 'Kasserine' },
  { label: $localize`:@@invoices.invoice-wizard.ts.kebili.5c50d601:Kébili`, value: 'Kébili' },
  { label: $localize`:@@invoices.invoice-wizard.ts.le.kef.6dfe486f:Le Kef`, value: 'Le Kef' },
  { label: $localize`:@@invoices.invoice-wizard.ts.mahdia.00f1b39b:Mahdia`, value: 'Mahdia' },
  { label: $localize`:@@invoices.invoice-wizard.ts.la.manouba.25ff50d2:La Manouba`, value: 'La Manouba' },
  { label: $localize`:@@invoices.invoice-wizard.ts.medenine.0e0d3c6a:Médenine`, value: 'Médenine' },
  { label: $localize`:@@invoices.invoice-wizard.ts.monastir.aef3b69f:Monastir`, value: 'Monastir' },
  { label: $localize`:@@invoices.invoice-wizard.ts.nabeul.43036f00:Nabeul`, value: 'Nabeul' },
  { label: $localize`:@@invoices.invoice-wizard.ts.sfax.7f5b35de:Sfax`, value: 'Sfax' },
  { label: $localize`:@@invoices.invoice-wizard.ts.sidi.bouzid.923cd336:Sidi Bouzid`, value: 'Sidi Bouzid' },
  { label: $localize`:@@invoices.invoice-wizard.ts.siliana.279c3c64:Siliana`, value: 'Siliana' },
  { label: $localize`:@@invoices.invoice-wizard.ts.sousse.e45910eb:Sousse`, value: 'Sousse' },
  { label: $localize`:@@invoices.invoice-wizard.ts.tataouine.d3f11bd9:Tataouine`, value: 'Tataouine' },
  { label: $localize`:@@invoices.invoice-wizard.ts.tozeur.0c755425:Tozeur`, value: 'Tozeur' },
  { label: $localize`:@@invoices.invoice-wizard.ts.tunis.e58b2d54:Tunis`, value: 'Tunis' },
  { label: $localize`:@@invoices.invoice-wizard.ts.zaghouan.65a3dc81:Zaghouan`, value: 'Zaghouan' }
];
