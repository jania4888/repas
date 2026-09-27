import { isConfiguredDocumentNumber } from '@core/utils/numbering-validation';
import { createClientUuid } from '@core/utils/safe-random-uuid.util';
import { isValidEmail } from '@shared/validation';
import { normalizeDesignation } from '../utils/invoice-line.utils';
import { Injectable, inject, computed, signal, effect, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, of, BehaviorSubject, defer, throwError } from 'rxjs';
import { map, tap, catchError, switchMap, take } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { ApiResponse } from '@core/services/auth.service';
import { SubscriptionInfo, SubscriptionService } from '@core/services/subscription.service';
import { Company } from '@core/services/company.service';
import { InvoiceService } from '@core/services/invoice.service';
import { isValidInvoiceGuid } from '@core/services/invoice-reference-resolver.service';
import { ClientService, Client, ClientType } from '@core/services/client.service';
import { ProductService } from '@core/services/product.service';
import { TaxService, TaxType, TaxValueType, TaxContext } from '@core/services/tax.service';
import {
  InvoiceWizardState,
  InvoiceMetadata,
  SellerInfo,
  ClientInfo,
  InvoiceLine,
  InvoiceTotals,
  LegalMentions,
  PaymentInfo,
  WizardStep,
  WizardStepKey,
  ValidationResult,
  ComplianceCheck,
  InvoiceType,
  Currency,
  ClientTaxType,
  TunisianVatRate,
  PaymentMethod,
  VatBreakdownItem,
  CreateInvoiceWizardRequest
} from '../models/invoice-wizard.models';
import { isClientReadyForSubmission, normalizeClientInfo } from './invoice-wizard-client.utils';
import { isValidNif } from '@shared/validation/validation-rules';
import { InvoiceImportResult } from '../models/invoice-import.models';
import { FeatureFlagsService } from '@core/services/feature-flags.service';
import { WizardValidationService } from './wizard-validation.service';
import { FieldError } from '../models/invoice-wizard.models';
import {
  DEFAULT_FODEC_RATE_PERCENT,
  computeWizardTotalsCheck,
  roundTnd as roundTndUtil
} from './invoice-wizard-calculation.utils';

const EMPTY_PRODUCT_GUID = '00000000-0000-0000-0000-000000000000';

/** DTO retourné par GET /api/invoices/wizard/next-number */
interface NextInvoiceNumberDto {
  number: string;
  prefix: string;
  year: number;
  sequence: number;
}

/** Stable backend error codes for plan / subscription quota enforcement. */
export const PLAN_QUOTA_ERROR_CODES = [
  'PLAN_INVOICE_QUOTA_EXCEEDED',
  'PLAN_SUBSCRIPTION_CANCELLED',
  'PLAN_SUBSCRIPTION_SUSPENDED',
  'PLAN_SUBSCRIPTION_EXPIRED',
  'PLAN_SUBSCRIPTION_PAST_DUE'
] as const;

export type PlanQuotaErrorCode = typeof PLAN_QUOTA_ERROR_CODES[number];

/**
 * Service de gestion de l'état du wizard de création de facture
 * Implémente la logique métier et les validations conformes à la réglementation tunisienne
 */
@Injectable({
  providedIn: 'root'
})
export class InvoiceWizardService {
  private readonly API_URL = `${environment.apiUrl}/invoices`;
  private readonly WIZARD_API_URL = `${environment.apiUrl}/invoices/wizard`;

  // ============================================
  // STATE MANAGEMENT
  // ============================================

  private readonly featureFlags = inject(FeatureFlagsService);
  private readonly validation = inject(WizardValidationService);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _subscriptionInfo = signal<SubscriptionInfo | null>(null);
  readonly subscriptionInfo = this._subscriptionInfo.asReadonly();
  private readonly _submissionErrorCode = signal<string | null>(null);
  readonly submissionErrorCode = this._submissionErrorCode.asReadonly();
  private subscriptionLoadInFlight: Observable<SubscriptionInfo | null> | null = null;

  /** Exposes per-field validation errors driven by `WizardValidationService`. */
  readonly fieldErrors = this.validation.fieldErrors;

  /**
   * Returns errors for a given step domain (legacy keys: 'metadata' | 'seller' | 'client' | 'lines' | 'legal').
   * Step components use this to display inline error messages aligned with the backend rules.
   */
  getFieldErrors(stepKey: WizardStepKey, fieldPath: string): FieldError[] {
    return this.validation.fieldErrors()[stepKey]?.[fieldPath] ?? [];
  }

  hasFieldError(stepKey: WizardStepKey, fieldPath: string): boolean {
    return this.getFieldErrors(stepKey, fieldPath).some(e => e.severity === 'ERROR');
  }

  /** Absolute value of fixed fiscal stamp from tax catalog (TND). */
  private readonly fiscalStampUnitAbs = signal(1);
  /** FODEC rate (%) from draft/backend; do not read in field initializers declared above this signal. */
  private readonly _fodecRatePercent = signal(DEFAULT_FODEC_RATE_PERCENT);
  private fiscalStampLoadStarted = false;

  private readonly initialState: InvoiceWizardState = {
    currentStep: 0,
    steps: this.initializeSteps(),
    metadata: this.getDefaultMetadata(),
    seller: null,
    client: null,
    lines: [],
    totals: this.getEmptyTotals(),
    legalMentions: this.getDefaultLegalMentions(),
    payment: this.getDefaultPayment(),
    isDirty: false,
    isSaving: false,
    lastSaved: null,
    draftId: null,
    validationResult: null,
    submissionError: null,
    linkedInvoiceCommercialTtc: null
  };

  private state = signal<InvoiceWizardState>({ ...this.initialState });
  /** True only after loadDraft() (route /invoices/new/draft/:id), jamais pour /invoices/new. */
  private openedFromExistingDraft = false;

  // Exposed computed signals
  readonly wizardState = this.state.asReadonly();
  readonly currentStep = computed(() => this.state().currentStep);
  readonly steps = computed(() => this.state().steps);
  readonly metadata = computed(() => this.state().metadata);
  readonly seller = computed(() => this.state().seller);
  readonly client = computed(() => this.state().client);
  readonly lines = computed(() => this.state().lines);
  readonly totals = computed(() => this.state().totals);
  readonly legalMentions = computed(() => this.state().legalMentions);
  readonly payment = computed(() => this.state().payment);
  readonly isDirty = computed(() => this.state().isDirty);
  readonly isSaving = computed(() => this.state().isSaving);
  readonly validationResult = computed(() => this.state().validationResult);
  readonly submissionError = computed(() => this.state().submissionError);

  readonly canGoNext = computed(() => {
    const current = this.state().currentStep;
    const steps = this.state().steps;
    return current < steps.length - 1 && steps[current].isValid;
  });

  readonly canGoPrev = computed(() => this.state().currentStep > 0);
  
  readonly isLastStep = computed(() => 
    this.state().currentStep === this.state().steps.length - 1
  );

  readonly progressPercent = computed(() => 
    ((this.state().currentStep + 1) / this.state().steps.length) * 100
  );

  private readonly invoiceService = inject(InvoiceService);
  private readonly clientService = inject(ClientService);
  private readonly productService = inject(ProductService);
  private readonly taxService = inject(TaxService);

  constructor(private http: HttpClient) {
    this.subscriptionService.subscriptionChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.invalidateSubscriptionCache());

    // Bridge : whenever the wizard state changes, refresh the per-field validation map.
    // Keeps the UI single-source-of-truth aligned with WizardValidationService so the
    // backend rules surfaced as inline errors stay consistent with isStepValid() and
    // the server-side FluentValidation responses.
    effect(() => {
      const state = this.state();
      // Validate every legacy step so all field error slots are populated for both flows.
      // The 4-step flow uses the legacy slots ('metadata', 'seller', 'lines', 'legal') under
      // the hood via the same domain validators ; UI bindings can therefore stay step-agnostic.
      for (let i = 0; i <= 5; i++) {
        this.validation.validateStep(state, i);
      }
    });
  }

  /** Loads active stamp tax once; safe to call multiple times. */
  ensureFiscalStampLoaded(): void {
    if (this.fiscalStampLoadStarted) {
      return;
    }
    this.fiscalStampLoadStarted = true;
    this.taxService
      .getTaxes({ type: TaxType.Stamp, activeOnly: true })
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          const list = res.data ?? [];
          const hit = list.find(
            (t) =>
              t.valueType === TaxValueType.FixedAmount &&
              (t.context === TaxContext.All || t.context === TaxContext.Sales)
          );
          if (hit && hit.value > 0) {
            this.fiscalStampUnitAbs.set(hit.value);
          }
          this.recalculateTotals();
        },
        error: () => {
          /* keep default 1 TND */
        }
      });
  }

  /** Signed stamp for current document type (invoice vs credit note). */
  getFiscalStampSignedAmount(): number {
    return this.getFiscalStampSignedAmountForCreditNote(
      this.state().metadata.type === InvoiceType.CreditNote);
  }

  /** Same as getFiscalStampSignedAmount but allows overriding credit mode (e.g. POS). */
  getFiscalStampSignedAmountForCreditNote(isCreditNote: boolean): number {
    const abs = this.fiscalStampUnitAbs();
    return isCreditNote ? -abs : abs;
  }

  private roundTnd(n: number): number {
    return roundTndUtil(n);
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  /** True when the simplified 4-step wizard is enabled via feature flag. */
  isSimplifiedFlow(): boolean {
    return this.featureFlags.wizardSimplifiedFlow();
  }

  /** Returns the ordered step keys for the active flow. */
  getStepKeys(): WizardStepKey[] {
    return this.isSimplifiedFlow()
      ? ['document', 'client', 'billing', 'review']
      : ['metadata', 'seller', 'client', 'lines', 'legal', 'preview'];
  }

  private initializeSteps(): WizardStep[] {
    const legacyConfigs: { key: WizardStepKey; label: string; description: string; icon: string }[] = [
      { key: 'metadata', label: $localize`:@@invoices.invoice-wizard.ts.type.date.98c6992c:Type & Date`, description: $localize`:@@invoices.invoice-wizard.ts.type.de.document.et.metadonnees.160afbef:Type de document et métadonnées`, icon: 'pi pi-file' },
      { key: 'seller', label: $localize`:@@invoices.invoice-wizard.ts.emetteur.0291ff4e:Émetteur`, description: $localize`:@@invoices.invoice-wizard.ts.informations.du.vendeur.1c75ef39:Informations du vendeur`, icon: 'pi pi-building' },
      { key: 'client', label: $localize`:@@invoices.invoice-wizard.ts.client.1bdd79b1:Client`, description: $localize`:@@invoices.invoice-wizard.ts.informations.du.destinataire.867dab5b:Informations du destinataire`, icon: 'pi pi-user' },
      { key: 'lines', label: $localize`:@@invoices.invoice-wizard.ts.articles.7c422841:Articles`, description: $localize`:@@invoices.invoice-wizard.ts.lignes.de.facturation.5896ee38:Lignes de facturation`, icon: 'pi pi-list' },
      { key: 'legal', label: $localize`:@@invoices.invoice-wizard.ts.paiement.0564e9ba:Paiement`, description: $localize`:@@invoices.invoice-wizard.ts.mentions.legales.paiement.e23893bd:Mentions légales & paiement`, icon: 'pi pi-money-bill' },
      { key: 'preview', label: $localize`:@@invoices.invoice-wizard.ts.validation.dd74d182:Validation`, description: $localize`:@@invoices.invoice-wizard.ts.apercu.et.emission.121aebe7:Aperçu et émission`, icon: 'pi pi-check-circle' }
    ];

    const simplifiedConfigs: { key: WizardStepKey; label: string; description: string; icon: string }[] = [
      { key: 'document', label: $localize`:@@invoices.invoice-wizard.ts.document.e214b8a2:Document`, description: $localize`:@@invoices.invoice-wizard.ts.type.dates.et.emetteur.7a32b9e8:Type, dates et émetteur`, icon: 'pi pi-file' },
      { key: 'client', label: $localize`:@@invoices.invoice-wizard.ts.client.1bdd79b1:Client`, description: $localize`:@@invoices.invoice-wizard.ts.informations.du.destinataire.867dab5b:Informations du destinataire`, icon: 'pi pi-user' },
      { key: 'billing', label: $localize`:@@invoices.invoice-wizard.ts.facturation.04716c6b:Facturation`, description: $localize`:@@invoices.invoice-wizard.ts.articles.et.paiement.9c5d0635:Articles et paiement`, icon: 'pi pi-list' },
      { key: 'review', label: $localize`:@@invoices.invoice-wizard.ts.recap.emission.6d6fc1a1:Récap & Émission`, description: $localize`:@@invoices.invoice-wizard.ts.apercu.et.soumission.82a8ea57:Aperçu et soumission`, icon: 'pi pi-check-circle' }
    ];

    const stepConfigs = this.isSimplifiedFlow() ? simplifiedConfigs : legacyConfigs;

    return stepConfigs.map((config, index) => ({
      index,
      key: config.key,
      label: config.label,
      description: config.description,
      icon: config.icon,
      isComplete: false,
      isValid: index === 0, // First step is valid by default
      isActive: index === 0,
      isDisabled: index > 0
    }));
  }

  private getDefaultMetadata(): InvoiceMetadata {
    return {
      type: InvoiceType.Invoice,
      invoiceNumber: '', // Will be fetched from server
      issueDate: new Date(),
      dueDate: this.addDays(new Date(), 30),
      currency: Currency.TND,
      internalReference: null,
      linkedInvoiceId: null,
      warehouseId: null,
      cashRegisterSessionId: null
    };
  }

  private getEmptyTotals(): InvoiceTotals {
    return {
      subTotalHT: 0,
      totalDiscount: 0,
      totalHT: 0,
      totalFodec: 0,
      vatBreakdown: [],
      totalVat: 0,
      fiscalStampAmount: 0,
      totalTTC: 0,
      currency: Currency.TND,
      fodecRatePercent: DEFAULT_FODEC_RATE_PERCENT
    };
  }

  private getDefaultLegalMentions(): LegalMentions {
    return {
      vatMention: 'TVA due par le vendeur',
      exemptionMention: null,
      customMention: null
    };
  }

  private getDefaultPayment(): PaymentInfo {
    return {
      method: PaymentMethod.BankTransfer,
      terms: 'Paiement à 30 jours',
      daysUntilDue: 30,
      bankName: null,
      iban: null,
      rib: null,
      purchaseOrderRef: null
    };
  }

  // ============================================
  // NAVIGATION
  // ============================================

  goToStep(index: number): void {
    const steps = this.state().steps;
    if (index >= 0 && index < steps.length && !steps[index].isDisabled) {
      this.updateState({
        currentStep: index,
        steps: steps.map((step, i) => ({
          ...step,
          isActive: i === index
        }))
      });
    }
  }

  nextStep(): void {
    if (this.canGoNext()) {
      const current = this.state().currentStep;
      const steps = this.state().steps;
      
      // Mark current step as complete
      const updatedSteps = steps.map((step, i) => ({
        ...step,
        isComplete: i <= current,
        isActive: i === current + 1,
        isDisabled: i > current + 1
      }));

      this.updateState({
        currentStep: current + 1,
        steps: updatedSteps
      });
    }
  }

  prevStep(): void {
    if (this.canGoPrev()) {
      this.goToStep(this.state().currentStep - 1);
    }
  }

  // ============================================
  // STEP 1 - METADATA
  // ============================================

  updateMetadata(metadata: Partial<InvoiceMetadata>): void {
    const current = this.state().metadata;
    const updated = { ...current, ...metadata };
    
    this.updateState({
      metadata: updated,
      isDirty: true
    });

    // Update due date based on payment terms if issue date changed
    if (metadata.issueDate && this.state().payment.daysUntilDue !== null) {
      const dueDate = this.addDays(metadata.issueDate, this.state().payment.daysUntilDue ?? 30);
      this.updateState({
        metadata: { ...this.state().metadata, dueDate }
      });
    }

    this.validateCurrentStep();
    this.recalculateTotals();
  }

  /**
   * Initialize wizard for creating a credit note linked to an existing invoice.
   * Sets type=CreditNote, linkedInvoiceId, and pre-fills client from the original invoice.
   */
  initForCreditNote(invoiceId: string): Observable<void> {
    const preservedSeller = this.state().seller;
    this.reset();
    if (preservedSeller) {
      this.selectSeller(preservedSeller);
    }
    this.updateMetadata({
      type: InvoiceType.CreditNote,
      linkedInvoiceId: invoiceId
    });

    return this.invoiceService.getInvoice(invoiceId).pipe(
      switchMap((invoiceResponse) => {
        if (!invoiceResponse?.success) {
          const message = invoiceResponse?.message || $localize`:@@invoices.invoice-wizard.ts.impossible.de.charger.la.facture.liee.53f3a0f5:Impossible de charger la facture liée.`;
          console.error('[initForCreditNote] Invoice fetch failed:', invoiceResponse);
          return throwError(() => new Error(message));
        }
        const data = invoiceResponse.data;
        if (!data) {
          console.error('[initForCreditNote] Invoice data is null');
          return throwError(() => new Error('Impossible de charger la facture liée.'));
        }

        const invoiceLines = this.mapApiLinesToWizardLines(data.lines);
        const warehouseId = data.warehouseId ?? null;
        const linkedInvoiceCommercialTtc = Math.abs(
          (data.totalAmount ?? 0) - (data.fiscalStampAmount ?? 0)
        );

        const clientId = data.clientId || data.client?.id;
        if (!clientId) {
          console.warn('[initForCreditNote] No clientId found in invoice data');
          return of({
            clientInfo: undefined as ClientInfo | undefined,
            invoiceLines,
            warehouseId,
            linkedInvoiceCommercialTtc
          });
        }
        return this.clientService.getClient(clientId).pipe(
          map((clientResponse) => {
            if (!clientResponse?.success || !clientResponse.data) {
              console.warn('[initForCreditNote] Client fetch failed for id:', clientId);
              return {
                clientInfo: undefined as ClientInfo | undefined,
                invoiceLines,
                warehouseId,
                linkedInvoiceCommercialTtc
              };
            }
            return {
              clientInfo: this.mapClientToClientInfo(clientResponse.data),
              invoiceLines,
              warehouseId,
              linkedInvoiceCommercialTtc
            };
          }),
          catchError((err) => {
            console.error('[initForCreditNote] Error fetching client:', err);
            return of({
              clientInfo: undefined as ClientInfo | undefined,
              invoiceLines,
              warehouseId,
              linkedInvoiceCommercialTtc
            });
          })
        );
      }),
      tap(({ clientInfo, invoiceLines, warehouseId, linkedInvoiceCommercialTtc }) => {
        this.updateMetadata({ warehouseId });
        this.updateState({ linkedInvoiceCommercialTtc });

        if (clientInfo) {
          this.selectClient(clientInfo);
        }

        if (invoiceLines.length > 0) {
          this.updateState({ lines: invoiceLines, isDirty: true });
          this.recalculateTotals();
        }

        this.validateStepByDomain('metadata');
        this.validateStepByDomain('client');
        this.validateStepByDomain('lines');
      }),
      map(() => void 0),
      catchError((err) => {
        console.error('[initForCreditNote] Unexpected error:', err);
        this.validateStepByDomain('metadata');
        return throwError(() => err);
      })
    );
  }

  /**
   * Pré-remplit le wizard à partir d'une facture extraite par l'IA depuis un fichier
   * importé (PDF / image / Word / Excel). Appelée par le wizard dans ngOnInit, après
   * reset(), lorsqu'un import est en attente dans InvoiceImportPrefillStore.
   *
   * Ne compose que des mutateurs publics existants (updateMetadata, selectClient,
   * addLine) : aucun comportement existant n'est modifié. N'écrit jamais l'invoiceNumber
   * (généré côté serveur) — aucune course avec fetchNextInvoiceNumber().
   */
  applyImportedInvoice(data: InvoiceImportResult): void {
    // 1. Métadonnées (type, dates, devise).
    const issueDate = data.issueDate ? new Date(data.issueDate) : new Date();
    this.updateMetadata({
      type: data.documentType === 'CREDIT_NOTE' ? InvoiceType.CreditNote : InvoiceType.Invoice,
      issueDate: isNaN(issueDate.getTime()) ? new Date() : issueDate,
      currency: this.resolveImportedCurrency(data.currency)
    });
    // L'échéance extraite est appliquée séparément : updateMetadata recalcule la dueDate
    // quand issueDate change ; on ne l'écrase qu'après, sans repasser issueDate.
    if (data.dueDate) {
      const dueDate = new Date(data.dueDate);
      if (!isNaN(dueDate.getTime())) {
        this.updateMetadata({ dueDate });
      }
    }

    // 2. Client : rapproché (existant) ou nouveau client à compléter dans le wizard.
    const client = data.client;
    if (client && (client.matchedClientId || client.name)) {
      this.selectClient({
        id: client.matchedClientId,
        isNewClient: !client.matchedClientId,
        name: client.matchedClientName ?? client.name ?? '',
        taxType: this.resolveImportedTaxType(client.taxType),
        address: {
          street: client.street ?? '',
          streetLine2: null,
          postalCode: client.postalCode ?? null,
          city: client.city ?? '',
          governorate: client.governorate ?? '',
          country: 'Tunisie'
        },
        nif: client.nif ?? null,
        email: client.email ?? '',
        phone: client.phone ?? null,
        contactPerson: null
      });
    }

    // 3. Lignes d'articles (addLine recalcule déjà les montants de chaque ligne).
    for (const line of data.lines ?? []) {
      const hasDiscount = line.discountPercent != null && line.discountPercent > 0;
      this.addLine({
        productId: line.matchedProductId,
        designation: line.designation,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit ?? 'Unité',
        unitPriceHT: line.unitPriceHT,
        discountType: hasDiscount ? 'PERCENT' : null,
        discountValue: hasDiscount ? line.discountPercent : null,
        vatRate: line.vatRatePercent as TunisianVatRate
      });
    }

    // 4. Recalcul et revalidation des étapes pré-remplies (même approche que initForCreditNote).
    this.recalculateTotals();
    this.validateStepByDomain('metadata');
    this.validateStepByDomain('client');
    this.validateStepByDomain('lines');
    this.syncFodecFromProducts();
  }

  private resolveImportedCurrency(raw: string | null | undefined): Currency {
    switch ((raw ?? '').toUpperCase()) {
      case 'EUR': return Currency.EUR;
      case 'USD': return Currency.USD;
      default: return Currency.TND;
    }
  }

  private resolveImportedTaxType(raw: string | null | undefined): ClientTaxType {
    switch ((raw ?? '').toUpperCase()) {
      case 'TAX_SUBJECT': return ClientTaxType.TaxSubject;
      case 'TAX_EXEMPT': return ClientTaxType.TaxExempt;
      default: return ClientTaxType.NonTaxSubject;
    }
  }

  private mapApiLinesToWizardLines(apiLines: Array<{
    id: string;
    lineNumber: number;
    productId: string;
    productCode: string;
    productName: string;
    productDescription: string | null;
    quantity: number;
    unit: string | null;
    unitPrice: number;
    vatRatePercent: number;
    discountPercent: number | null;
    discountAmount: number;
    allocatedGlobalDiscount?: number;
    subTotal: number;
    isFodecApplicable?: boolean;
    vatAmount: number;
    total: number;
  }> | undefined | null): InvoiceLine[] {
    if (!apiLines || !Array.isArray(apiLines) || apiLines.length === 0) {
      return [];
    }

    return apiLines.map((apiLine, index) => {
      const vatRate = this.resolveVatRate(apiLine.vatRatePercent);
      const quantity = apiLine.quantity ?? 0;
      const unitPriceHT = apiLine.unitPrice || 0;
      const gross = quantity * unitPriceHT;
      const ht = apiLine.subTotal ?? gross;
      const effectivePct = gross > 0 && ht < gross
        ? ((gross - ht) / gross) * 100
        : (apiLine.discountPercent ?? 0);
      const hasDiscount = effectivePct > 0;
      const productId = apiLine.productId && apiLine.productId !== EMPTY_PRODUCT_GUID
        ? apiLine.productId
        : null;

      const line: InvoiceLine = {
        id: createClientUuid(),
        lineNumber: index + 1,
        productId,
        designation: apiLine.productName || '',
        description: apiLine.productDescription || null,
        quantity,
        unit: apiLine.unit || 'Unité',
        unitPriceHT,
        priceOverridden: true,
        discountType: hasDiscount ? 'PERCENT' : null,
        discountValue: hasDiscount ? effectivePct : null,
        vatRate,
        isFodecApplicable: apiLine.isFodecApplicable ?? false,
        discountAmount: 0,
        totalHT: 0,
        fodecAmount: 0,
        vatAmount: 0,
        totalTTC: 0
      };

      this.calculateLineAmounts(line);
      return line;
    });
  }

  private resolveVatRate(percent: number): TunisianVatRate {
    if (percent === 0) return TunisianVatRate.Exempt;
    if (percent === 7) return TunisianVatRate.Reduced;
    if (percent === 13) return TunisianVatRate.Intermediate;
    if (percent === 19) return TunisianVatRate.Standard;
    // Closest match for non-standard rates
    if (percent <= 3) return TunisianVatRate.Exempt;
    if (percent <= 10) return TunisianVatRate.Reduced;
    if (percent <= 16) return TunisianVatRate.Intermediate;
    return TunisianVatRate.Standard;
  }

  loadClientFromLinkedInvoice(invoiceId: string): void {
    this.invoiceService.getInvoice(invoiceId).pipe(
      switchMap((res) => {
        if (!res?.success || !res.data?.clientId) return of(null);
        return this.clientService.getClient(res.data.clientId).pipe(
          map((cRes) => cRes?.success && cRes.data ? this.mapClientToClientInfo(cRes.data) : null)
        );
      }),
      tap((clientInfo) => {
        if (clientInfo) this.selectClient(clientInfo);
      })
    ).subscribe();
  }

  private mapClientToClientInfo(client: Client): ClientInfo {
    const taxType = this.resolveClientTaxType(client);
    return normalizeClientInfo({
      id: client.id,
      isNewClient: false,
      name: client.name,
      taxType,
      address: {
        street: client.address?.street || '',
        streetLine2: client.address?.streetLine2 || null,
        postalCode: client.address?.postalCode || null,
        city: client.address?.city || '',
        governorate: client.address?.governorate || '',
        country: client.address?.country || 'Tunisie'
      },
      nif: client.nif || null,
      email: client.email ?? '',
      phone: client.phone || null,
      contactPerson: client.contactPerson || null
    });
  }

  private resolveClientTaxType(client: Client): ClientTaxType {
    if (client.nif && this.isValidNIF(client.nif)) {
      return ClientTaxType.TaxSubject;
    }

    const clientType = String(client.type).toLowerCase();
    if (clientType === 'individual' || clientType === 'association') {
      return ClientTaxType.NonTaxSubject;
    }

    return ClientTaxType.TaxSubject;
  }

  fetchNextInvoiceNumber(): Observable<string> {
    const year = new Date().getFullYear();
    const type = this.state().metadata.type;
    const prefix = type === InvoiceType.CreditNote ? 'AVO' : 'FAC';
    const params = { prefix, year: year.toString() };
    return this.http
      .get<ApiResponse<NextInvoiceNumberDto>>(`${this.WIZARD_API_URL}/next-number`, {
        params
      })
      .pipe(
        map(response => {
          if (!response || !response.success) {
            console.warn('[fetchNextInvoiceNumber] API response unsuccessful:', response);
            return '';
          }
          
          const dto = response?.data;
          if (!dto || !dto.number || typeof dto.number !== 'string') {
            console.warn('[fetchNextInvoiceNumber] Invalid DTO or number:', dto);
            return '';
          }
          
          const number = dto.number.trim();
          
          // Vérifier que le numéro ne contient pas "TEMP"
          if (number.toUpperCase().includes('TEMP')) {
            console.warn('[fetchNextInvoiceNumber] Number contains TEMP:', number);
            return '';
          }
          
          // Vérifier le format configuré
          if (!isConfiguredDocumentNumber(number)) {
            console.warn('[fetchNextInvoiceNumber] Number format invalid:', number);
            return '';
          }
          
          return number;
        }),
        tap(number => {
          if (number) {
            this.updateMetadata({ invoiceNumber: number });
            console.log('[fetchNextInvoiceNumber] Invoice number updated:', number);
          } else {
            console.warn('[fetchNextInvoiceNumber] Empty number, using TEMP fallback');
          }
        }),
        catchError((error) => {
          console.error('[fetchNextInvoiceNumber] API error:', error);
          const temp = `TEMP-${Date.now()}`;
          this.updateMetadata({ invoiceNumber: temp });
          return of(temp);
        })
      );
  }

  // ============================================
  // STEP 2 - SELLER
  // ============================================

  loadSellers(): Observable<SellerInfo[]> {
    return this.http.get<ApiResponse<Company>>(`${environment.apiUrl}/company`).pipe(
      map(response => {
        if (!response.success || !response.data) {
          return [];
        }
        
        const company = response.data;
        
        // Map Company DTO to SellerInfo
        const seller: SellerInfo = {
          id: company.id || 'default',
          companyName: company.companyName || '',
          tradeName: company.tradeName || null,
          address: {
            street: company.address?.street || '',
            streetLine2: company.address?.streetLine2 || null,
            postalCode: company.address?.postalCode || null,
            city: company.address?.city || '',
            governorate: company.address?.governorate || '',
            country: company.address?.country || 'Tunisie'
          },
          nif: company.nif || '',
          commerceRegistry: company.commerceRegistry || null,
          vatCode: null, // Not available in Company DTO
          logo: company.logoUrl || null,
          phone: company.phone || null,
          email: company.email || ''
        };
        
        return [seller];
      }),
      catchError(() => of([]))
    );
  }

  selectSeller(seller: SellerInfo): void {
    this.updateState({
      seller,
      isDirty: true
    });

    // Update bank info if available
    if (seller) {
      // Auto-fill payment bank info from seller
    }

    this.validateCurrentStep();
  }

  // ============================================
  // STEP 3 - CLIENT
  // ============================================

  loadClients(search?: string): Observable<any[]> {
    let url = `${environment.apiUrl}/clients`;
    if (search) {
      url += `?search=${encodeURIComponent(search)}`;
    }
    // Le backend retourne ApiResponse<PagedResult<ClientListDto>>
    return this.http.get<ApiResponse<any>>(url).pipe(
      map(response => {
        // Vérification de base
        if (!response) {
          console.warn('[loadClients] Response is null or undefined');
          return [];
        }

        // Vérifier si response a une propriété data
        if (!response.data) {
          console.warn('[loadClients] Response.data is null or undefined', response);
          return [];
        }

        const data = response.data;

        // Cas 1: data est déjà un tableau (cas improbable mais possible)
        if (Array.isArray(data)) {
          console.log('[loadClients] Data is already an array, length:', data.length);
          return data;
        }

        // Cas 2: data est un objet PagedResult avec une propriété items
        if (typeof data === 'object' && data !== null) {
          // Vérifier si c'est un PagedResult (a une propriété items)
          if ('items' in data) {
            const items = data.items;
            if (Array.isArray(items)) {
              console.log('[loadClients] Extracted items from PagedResult, length:', items.length);
              return items;
            } else {
              console.warn('[loadClients] PagedResult.items is not an array:', typeof items, items);
              return [];
            }
          }

          // Cas 3: data est un objet simple (ne devrait pas arriver mais on le gère)
          console.warn('[loadClients] Data is an object without items property, converting to array', data);
          // Ne pas convertir un objet en tableau car cela causerait l'erreur NG02200
          // Si c'est un objet, c'est probablement une erreur, retourner un tableau vide
          return [];
        }

        // Fallback : retourner un tableau vide
        console.warn('[loadClients] Unexpected data type:', typeof data, data);
        return [];
      }),
      catchError((error) => {
        console.error('[loadClients] Error loading clients:', error);
        return of([]);
      })
    );
  }

  /**
   * Charge un client par son ID et le pré-sélectionne dans le wizard.
   * Utilisé notamment quand l'assistant IA navigue vers /invoices/new?clientId=xxx.
   */
  loadAndPreselectClient(clientId: string): Observable<void> {
    if (!clientId) return of(void 0);

    const url = `${environment.apiUrl}/clients/${encodeURIComponent(clientId)}`;
    return this.http.get<ApiResponse<any>>(url).pipe(
      map(response => {
        if (!response?.success || !response.data) {
          throw new Error('Client introuvable');
        }
        const c: any = response.data;
        const address: any = c.address ?? {};
        const nif: string | null = c.nif ?? c.Nif ?? null;
        const rawType: string | undefined = c.type ?? c.Type;

        // Détermine le ClientTaxType en miroir de resolveSearchClientTaxType côté UI
        let taxType: ClientTaxType = ClientTaxType.NonTaxSubject;
        if (nif && this.isValidNIF(nif)) {
          taxType = ClientTaxType.TaxSubject;
        } else if (typeof rawType === 'string') {
          if (rawType === ClientTaxType.TaxSubject
            || rawType === ClientTaxType.NonTaxSubject
            || rawType === ClientTaxType.TaxExempt) {
            taxType = rawType as ClientTaxType;
          } else if (rawType.toLowerCase() === 'business') {
            taxType = ClientTaxType.TaxSubject;
          }
        }

        const clientInfo: ClientInfo = {
          id: c.id ?? c.Id ?? clientId,
          isNewClient: false,
          name: c.name ?? c.Name ?? '',
          taxType,
          address: {
            street: address.street ?? address.Street ?? '',
            streetLine2: address.streetLine2 ?? address.StreetLine2 ?? null,
            postalCode: address.postalCode ?? address.PostalCode ?? null,
            city: address.city ?? address.City ?? '',
            governorate: address.governorate ?? address.Governorate ?? '',
            country: address.country ?? address.Country ?? 'Tunisie'
          },
          nif,
          email: c.email ?? c.Email ?? '',
          phone: c.phone ?? c.Phone ?? null,
          contactPerson: c.contactPerson ?? c.ContactPerson ?? null
        };

        this.selectClient(clientInfo);
        return void 0;
      })
    );
  }

  selectClient(client: ClientInfo | null): void {
    if (!client) {
      this.updateState({
        client: null,
        isDirty: true
      });
      this.validateCurrentStep();
      return;
    }

    const normalized = normalizeClientInfo(client);
    this.updateState({
      client: normalized,
      isDirty: true
    });

    this.updateLegalMentionsForClient(normalized);
    this.validateCurrentStep();
  }

  updateClient(client: Partial<ClientInfo>): void {
    const current = this.state().client;
    if (current) {
      const updated = { ...current, ...client };
      this.selectClient(updated);
    }
  }

  private updateLegalMentionsForClient(client: ClientInfo): void {
    const mentions = { ...this.state().legalMentions };
    
    if (client.taxType === ClientTaxType.TaxExempt) {
      mentions.exemptionMention = 'Client exonéré de TVA - Mention légale obligatoire';
    } else {
      mentions.exemptionMention = null;
    }

    this.updateState({ legalMentions: mentions });
  }

  // ============================================
  // STEP 4 - INVOICE LINES
  // ============================================

  addLine(line: Partial<InvoiceLine>): void {
    const lines = [...this.state().lines];
    const newLine: InvoiceLine = {
      id: createClientUuid(),
      lineNumber: lines.length + 1,
      productId: line.productId || null,
      designation: normalizeDesignation(line.designation),
      description: line.description || null,
      quantity: line.quantity || 1,
      unit: line.unit || 'Unité',
      unitPriceHT: line.unitPriceHT || 0,
      priceOverridden: line.priceOverridden ?? false,
      discountType: line.discountType || null,
      discountValue: line.discountValue || null,
      vatRate: line.vatRate ?? TunisianVatRate.Standard,
      isFodecApplicable: line.isFodecApplicable ?? false,
      discountAmount: 0,
      totalHT: 0,
      fodecAmount: 0,
      vatAmount: 0,
      totalTTC: 0
    };

    this.calculateLineAmounts(newLine);
    lines.push(newLine);

    this.updateState({
      lines,
      isDirty: true
    });

    this.recalculateTotals();
    this.validateCurrentStep();
  }

  updateLine(lineId: string, updates: Partial<InvoiceLine>): void {
    const normalizedUpdates = { ...updates };
    if ('designation' in normalizedUpdates) {
      normalizedUpdates.designation = normalizeDesignation(normalizedUpdates.designation);
    }

    const lines = this.state().lines.map(line => {
      if (line.id === lineId) {
        const updated = { ...line, ...normalizedUpdates };
        this.calculateLineAmounts(updated);
        return updated;
      }
      return line;
    });

    this.updateState({
      lines,
      isDirty: true
    });

    this.recalculateTotals();
    this.validateCurrentStep();
  }

  removeLine(lineId: string): void {
    const lines = this.state().lines
      .filter(line => line.id !== lineId)
      .map((line, index) => ({
        ...line,
        lineNumber: index + 1
      }));

    this.updateState({
      lines,
      isDirty: true
    });

    this.recalculateTotals();
    this.validateCurrentStep();
  }

  duplicateLine(lineId: string): void {
    const original = this.state().lines.find(l => l.id === lineId);
    if (original) {
      this.addLine({
        ...original,
        id: undefined,
        lineNumber: undefined
      });
    }
  }

  moveLine(lineId: string, direction: 'up' | 'down'): void {
    const lines = [...this.state().lines];
    const index = lines.findIndex(l => l.id === lineId);
    
    if (direction === 'up' && index > 0) {
      [lines[index - 1], lines[index]] = [lines[index], lines[index - 1]];
    } else if (direction === 'down' && index < lines.length - 1) {
      [lines[index], lines[index + 1]] = [lines[index + 1], lines[index]];
    }

    // Renumber
    lines.forEach((line, i) => line.lineNumber = i + 1);

    this.updateState({ lines, isDirty: true });
  }

  private calculateLineAmounts(line: InvoiceLine): void {
    const subtotal = line.quantity * line.unitPriceHT;
    
    // Calculate discount
    if (line.discountType === 'PERCENT' && line.discountValue) {
      line.discountAmount = subtotal * (line.discountValue / 100);
    } else if (line.discountType === 'AMOUNT' && line.discountValue) {
      line.discountAmount = line.discountValue;
    } else if (line.promotionEligible && line.promotionDiscountPercent) {
      line.discountAmount = subtotal * (line.promotionDiscountPercent / 100);
    } else {
      line.discountAmount = 0;
    }

    line.totalHT = subtotal - line.discountAmount;
    const rate = this._fodecRatePercent();
    line.fodecAmount = line.isFodecApplicable && rate > 0
      ? this.roundTnd(line.totalHT * (rate / 100))
      : 0;
    const vatBase = line.totalHT + line.fodecAmount;
    line.vatAmount = this.roundTnd(vatBase * (line.vatRate / 100));
    line.totalTTC = this.roundTnd(line.totalHT + line.fodecAmount + line.vatAmount);
  }

  private recalculateTotals(): void {
    const lines = this.state().lines;
    const currency = this.state().metadata.currency;
    const isCreditNote = this.state().metadata.type === InvoiceType.CreditNote;
    const sign = isCreditNote ? -1 : 1;

    const subTotalHT = sign * lines.reduce((sum, line) =>
      sum + (line.quantity * line.unitPriceHT), 0);

    const totalDiscount = lines.reduce((sum, line) =>
      sum + line.discountAmount, 0);

    const totalHT = sign * lines.reduce((sum, line) => sum + line.totalHT, 0);
    const totalFodec = sign * lines.reduce((sum, line) => sum + line.fodecAmount, 0);
    const totalVat = sign * lines.reduce((sum, line) => sum + line.vatAmount, 0);
    const linesTtcSum = sign * lines.reduce((sum, line) => sum + line.totalTTC, 0);
    const fiscalStampAmount = this.getFiscalStampSignedAmount();
    const totalTTC = this.roundTnd(linesTtcSum + fiscalStampAmount);

    const vatGroups = new Map<TunisianVatRate, { base: number; vat: number }>();

    lines.forEach(line => {
      const existing = vatGroups.get(line.vatRate) || { base: 0, vat: 0 };
      existing.base += sign * (line.totalHT + line.fodecAmount);
      existing.vat += sign * line.vatAmount;
      vatGroups.set(line.vatRate, existing);
    });

    const vatBreakdown: VatBreakdownItem[] = Array.from(vatGroups.entries())
      .map(([rate, amounts]) => ({
        rate,
        rateDisplay: `${rate}%`,
        baseAmount: amounts.base,
        vatAmount: amounts.vat
      }))
      .sort((a, b) => b.rate - a.rate);

    this.updateState({
      totals: {
        subTotalHT,
        totalDiscount,
        totalHT,
        totalFodec,
        vatBreakdown,
        totalVat,
        fiscalStampAmount,
        totalTTC,
        currency,
        fodecRatePercent: this._fodecRatePercent()
      }
    });
  }

  // ============================================
  // STEP 5 - LEGAL & PAYMENT
  // ============================================

  updatePayment(payment: Partial<PaymentInfo>): void {
    const current = this.state().payment;
    const updated = { ...current, ...payment };

    this.updateState({
      payment: updated,
      isDirty: true
    });

    // Update due date if days changed
    if (payment.daysUntilDue !== undefined && payment.daysUntilDue !== null) {
      const dueDate = this.addDays(this.state().metadata.issueDate, payment.daysUntilDue ?? 30);
      this.updateMetadata({ dueDate });
    }

    this.validateCurrentStep();
  }

  updateLegalMentions(mentions: Partial<LegalMentions>): void {
    const current = this.state().legalMentions;
    this.updateState({
      legalMentions: { ...current, ...mentions },
      isDirty: true
    });
    this.validateCurrentStep();
  }

  // ============================================
  // STEP 6 - VALIDATION & SUBMISSION
  // ============================================

  validateInvoice(): ValidationResult {
    const checks: ComplianceCheck[] = [];
    const state = this.state();

    // LEGAL CHECKS
    checks.push(this.checkInvoiceNumber());
    checks.push(this.checkIssueDate());
    checks.push(this.checkSellerInfo());
    checks.push(this.checkSellerNIF());
    checks.push(this.checkClientInfo());
    checks.push(this.checkClientIdentity());
    checks.push(this.checkClientNIF());

    // FISCAL CHECKS
    checks.push(this.checkVATRates());
    checks.push(this.checkVATMention());
    checks.push(this.checkExemptionMention());

    // CALCULATION CHECKS
    checks.push(this.checkLinesReady());
    checks.push(this.checkInvoiceQuota());
    checks.push(this.checkCalculations());
    checks.push(this.checkAmountsPositive());

    // FORMAT CHECKS
    checks.push(this.checkNumberFormat());

    const errorCount = checks.filter(c => c.status === 'ERROR').length;
    const warningCount = checks.filter(c => c.status === 'WARNING').length;
    const blockingErrors = checks.filter(c => c.status === 'ERROR' && c.isBlocking);

    const result: ValidationResult = {
      isValid: errorCount === 0,
      checks,
      errorCount,
      warningCount,
      canProceed: blockingErrors.length === 0
    };

    this.updateState({ validationResult: result });
    return result;
  }

  // Compliance check implementations
  private checkInvoiceNumber(): ComplianceCheck {
    const number = this.state().metadata.invoiceNumber;
    
    // Vérifier que le numéro existe et n'est pas vide
    if (!number || number.trim().length === 0) {
      return {
        id: 'invoice-number',
        category: 'LEGAL',
        label: $localize`:@@invoices.invoice-wizard.ts.numero.de.facture.a19ac308:Numéro de facture`,
        description: $localize`:@@invoices.invoice-wizard.ts.le.numero.de.facture.est.obligatoire.et.35fb4297:Le numéro de facture est obligatoire et doit être séquentiel`,
        status: 'ERROR',
        isBlocking: true,
        field: 'invoiceNumber'
      };
    }

    // Vérifier le format configuré dans Paramètres > Numérotations
    const hasValidFormat = isConfiguredDocumentNumber(number);
    
    // Si le numéro est temporaire, ce n'est plus bloquant - il sera généré automatiquement lors de la soumission
    const containsTemp = number.toUpperCase().includes('TEMP');
    const isValid = hasValidFormat || containsTemp;
    
    return {
      id: 'invoice-number',
      category: 'LEGAL',
      label: $localize`:@@invoices.invoice-wizard.ts.numero.de.facture.a19ac308:Numéro de facture`,
      description: hasValidFormat
        ? $localize`:@@invoices.invoice-wizard.ts.numero.sequentiel.valide.number.1268a4cf:Numéro séquentiel valide: ${number}:number:`
        : containsTemp
          ? $localize`:@@invoices.invoice-wizard.ts.le.numero.sera.genere.automatiquement.lo.471884c8:Le numéro sera généré automatiquement lors de la validation`
          : $localize`:@@invoices.invoice-wizard.ts.le.numero.de.facture.doit.respecter.le.f.3f12caac:Le numéro de facture doit respecter le format configuré dans les numérotations`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: false, // Plus bloquant - génération automatique lors de la soumission
      field: 'invoiceNumber'
    };
  }

  private checkIssueDate(): ComplianceCheck {
    const date = this.state().metadata.issueDate;
    const isValid = !!date;
    
    return {
      id: 'issue-date',
      category: 'LEGAL',
      label: $localize`:@@invoices.invoice-wizard.ts.date.d.emission.99f68857:Date d'émission`,
      description: isValid 
        ? $localize`:@@invoices.invoice-wizard.ts.date.tolocaledatestring.35910f2f:Date: ${new Date(date).toLocaleDateString('fr-TN')}:toLocaleDateString:` 
        : $localize`:@@invoices.invoice-wizard.ts.la.date.d.emission.est.obligatoire.b8bfb9d9:La date d'émission est obligatoire`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'issueDate'
    };
  }

  private checkSellerInfo(): ComplianceCheck {
    const seller = this.state().seller;
    const isValid = !!seller && !!seller.companyName && !!seller.address;
    
    return {
      id: 'seller-info',
      category: 'LEGAL',
      label: $localize`:@@invoices.invoice-wizard.ts.informations.emetteur.17adfe24:Informations émetteur`,
      description: isValid 
        ? $localize`:@@invoices.invoice-wizard.ts.emetteur.companyname.a14007d0:Émetteur: ${seller!.companyName}:companyName:` 
        : $localize`:@@invoices.invoice-wizard.ts.les.informations.de.l.emetteur.sont.inco.4de9bcb6:Les informations de l'émetteur sont incomplètes`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'seller'
    };
  }

  private checkSellerNIF(): ComplianceCheck {
    const seller = this.state().seller;
    const nif = seller?.nif;
    const isValid = !!nif && this.isValidNIF(nif);
    
    return {
      id: 'seller-nif',
      category: 'FISCAL',
      label: $localize`:@@invoices.invoice-wizard.ts.matricule.fiscal.emetteur.f1181797:Matricule fiscal émetteur`,
      description: isValid 
        ? `NIF: ${nif}` 
        : $localize`:@@invoices.invoice-wizard.ts.le.matricule.fiscal.de.l.emetteur.est.in.df30f39a:Le matricule fiscal de l'émetteur est invalide ou manquant`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'seller.nif'
    };
  }

  private checkClientInfo(): ComplianceCheck {
    const client = this.state().client;
    const isValid = !!client
      && !!client.name
      && !!client.address?.street
      && !!client.address?.city
      && !!client.address?.governorate;

    return {
      id: 'client-info',
      category: 'LEGAL',
      label: $localize`:@@invoices.invoice-wizard.ts.informations.client.179987af:Informations client`,
      description: isValid
        ? $localize`:@@invoices.invoice-wizard.ts.client.name.6f485dcb:Client: ${client!.name}:name:`
        : $localize`:@@invoices.invoice-wizard.ts.les.informations.du.client.sont.incomple.f1d91037:Les informations du client sont incomplètes (nom, adresse, ville et gouvernorat requis)`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'client'
    };
  }

  /**
   * Client existant (id) ou création explicite (isNewClient) — aligné sur performSubmit.
   */
  private checkClientIdentity(): ComplianceCheck {
    const raw = this.state().client;
    if (!raw) {
      return {
        id: 'client-identity',
        category: 'LEGAL',
        label: $localize`:@@invoices.invoice-wizard.ts.rattachement.client.5a8e02fb:Rattachement client`,
        description: $localize`:@@invoices.invoice-wizard.ts.non.applicable.16ed38d0:Non applicable`,
        status: 'VALID',
        isBlocking: false,
        field: 'client'
      };
    }

    const client = normalizeClientInfo(raw);
    const ok = isClientReadyForSubmission(client);

    return {
      id: 'client-identity',
      category: 'LEGAL',
      label: $localize`:@@invoices.invoice-wizard.ts.rattachement.client.5a8e02fb:Rattachement client`,
      description: ok
        ? (client.isNewClient ? $localize`:@@invoices.invoice-wizard.ts.nouveau.client.sera.cree.a.l.emission.a51a77c3:Nouveau client — sera créé à l'émission` : $localize`:@@invoices.invoice-wizard.ts.client.enregistre.id.4058f56f:Client enregistré (${client.id}:id:)`)
        : $localize`:@@invoices.invoice-wizard.ts.selectionnez.un.client.dans.la.liste.ou.7e038a7f:Sélectionnez un client dans la liste ou utilisez l'onglet « Nouveau client ». Si le problème persiste, resélectionnez le client.`,
      status: ok ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'client'
    };
  }

  private checkClientNIF(): ComplianceCheck {
    const client = this.state().client;
    const isTaxSubject = client?.taxType === ClientTaxType.TaxSubject;
    const hasValidNIF = !!client?.nif && this.isValidNIF(client.nif);
    
    if (!isTaxSubject) {
      return {
        id: 'client-nif',
        category: 'FISCAL',
        label: $localize`:@@invoices.invoice-wizard.ts.matricule.fiscal.client.a6352da1:Matricule fiscal client`,
        description: $localize`:@@invoices.invoice-wizard.ts.non.requis.pour.ce.type.de.client.0a836f2d:Non requis pour ce type de client`,
        status: 'VALID',
        isBlocking: false,
        field: 'client.nif'
      };
    }

    return {
      id: 'client-nif',
      category: 'FISCAL',
      label: $localize`:@@invoices.invoice-wizard.ts.matricule.fiscal.client.a6352da1:Matricule fiscal client`,
      description: hasValidNIF 
        ? `NIF: ${client!.nif}` 
        : $localize`:@@invoices.invoice-wizard.ts.le.matricule.fiscal.est.obligatoire.pour.51ef6b29:Le matricule fiscal est obligatoire pour un client assujetti`,
      status: hasValidNIF ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'client.nif'
    };
  }

  private checkVATRates(): ComplianceCheck {
    const lines = this.state().lines;
    const validRates = [0, 7, 13, 19];
    const allValid = lines.every(l => validRates.includes(l.vatRate));
    
    return {
      id: 'vat-rates',
      category: 'FISCAL',
      label: $localize`:@@invoices.invoice-wizard.ts.taux.de.tva.e704ceaf:Taux de TVA`,
      description: allValid 
        ? $localize`:@@invoices.invoice-wizard.ts.tous.les.taux.tva.sont.conformes.81e5176c:Tous les taux TVA sont conformes` 
        : $localize`:@@invoices.invoice-wizard.ts.certains.taux.tva.ne.sont.pas.conformes.582ab736:Certains taux TVA ne sont pas conformes à la législation tunisienne`,
      status: allValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'lines.vatRate'
    };
  }

  private checkVATMention(): ComplianceCheck {
    const mention = this.state().legalMentions.vatMention;
    const isValid = !!mention && mention.length > 0;
    
    return {
      id: 'vat-mention',
      category: 'LEGAL',
      label: $localize`:@@invoices.invoice-wizard.ts.mention.tva.0fb27cc0:Mention TVA`,
      description: isValid 
        ? $localize`:@@invoices.invoice-wizard.ts.mention.tva.presente.9e85c920:Mention TVA présente` 
        : $localize`:@@invoices.invoice-wizard.ts.la.mention.tva.due.par.le.vendeur.est.ob.c6f879f2:La mention "TVA due par le vendeur" est obligatoire`,
      status: isValid ? 'VALID' : 'WARNING',
      isBlocking: false,
      field: 'legalMentions.vatMention'
    };
  }

  private checkExemptionMention(): ComplianceCheck {
    const client = this.state().client;
    const mentions = this.state().legalMentions;
    const needsExemption = client?.taxType === ClientTaxType.TaxExempt;
    const hasExemption = !!mentions.exemptionMention;
    
    if (!needsExemption) {
      return {
        id: 'exemption-mention',
        category: 'FISCAL',
        label: $localize`:@@invoices.invoice-wizard.ts.mention.d.exoneration.0df903f7:Mention d'exonération`,
        description: $localize`:@@invoices.invoice-wizard.ts.non.applicable.16ed38d0:Non applicable`,
        status: 'VALID',
        isBlocking: false,
        field: null
      };
    }

    return {
      id: 'exemption-mention',
      category: 'FISCAL',
      label: $localize`:@@invoices.invoice-wizard.ts.mention.d.exoneration.0df903f7:Mention d'exonération`,
      description: hasExemption 
        ? $localize`:@@invoices.invoice-wizard.ts.mention.d.exoneration.presente.463fbd71:Mention d'exonération présente` 
        : $localize`:@@invoices.invoice-wizard.ts.une.mention.d.exoneration.est.requise.po.e773ce77:Une mention d'exonération est requise pour ce client`,
      status: hasExemption ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'legalMentions.exemptionMention'
    };
  }

  private checkLinesReady(): ComplianceCheck {
    return this.validation.checkLinesReady(this.state());
  }

  /** Pre-check invoice monthly quota using subscription data from the API (review step). */
  private checkInvoiceQuota(): ComplianceCheck {
    const sub = this._subscriptionInfo();
    if (!sub) {
      return {
        id: 'invoice-quota',
        category: 'CALCULATION',
        label: $localize`:@@invoices.invoice-wizard.ts.quota.factures.dfc0fe56:Quota factures`,
        description: $localize`:@@invoices.invoice-wizard.ts.quota.non.verifie.chargement.en.cours.ou.22625b8a:Quota non vérifié (chargement en cours ou indisponible)`,
        status: 'VALID',
        isBlocking: false,
        field: 'subscription'
      };
    }

    const invoices = sub.usage?.invoices;
    const usageLabel = invoices
      ? invoices.isUnlimited
        ? $localize`:@@invoices.invoice-wizard.ts.used.facture.s.ce.mois.forfait.illimite.f22815e7:${invoices.used}:used: facture(s) ce mois (forfait illimité)`
        : `${invoices.used}/${invoices.limit} facture(s) ce mois`
      : $localize`:@@invoices.invoice-wizard.ts.invoicesthismonth.facture.s.ce.mois.87a8175c:${sub.invoicesThisMonth}:invoicesThisMonth: facture(s) ce mois`;

    if (typeof sub.canCreateInvoice === 'boolean') {
      if (sub.canCreateInvoice) {
        return {
          id: 'invoice-quota',
          category: 'CALCULATION',
          label: $localize`:@@invoices.invoice-wizard.ts.quota.factures.dfc0fe56:Quota factures`,
          description: usageLabel,
          status: 'VALID',
          isBlocking: false,
          field: 'subscription'
        };
      }

      return {
        id: 'invoice-quota',
        category: 'CALCULATION',
        label: $localize`:@@invoices.invoice-wizard.ts.quota.factures.dfc0fe56:Quota factures`,
        description: sub.invoiceBlockMessage
          ?? $localize`:@@invoices.invoice-wizard.ts.statut.d.abonnement.statusdisplay.emissi.f6c66860:Statut d'abonnement « ${sub.statusDisplay}:statusDisplay: » : émission de facture indisponible.`,
        status: 'ERROR',
        isBlocking: true,
        field: 'subscription'
      };
    }

    // Legacy fallback when API has not yet returned eligibility fields.
    const status = (sub.status ?? '').toLowerCase();
    const usableStatuses = ['active', 'trial'];
    if (!usableStatuses.includes(status)) {
      const statusMessages: Record<string, string> = {
        cancelled: 'Votre abonnement est annulé. Réactivez ou changez de forfait dans Paramètres > Abonnement.',
        suspended: 'Votre compte est suspendu. Régularisez votre abonnement dans Paramètres > Abonnement.',
        expired: 'Votre abonnement a expiré. Renouvelez votre forfait dans Paramètres > Abonnement.',
        pastdue: 'Votre paiement est en retard. Régularisez votre abonnement dans Paramètres > Abonnement.'
      };
      const normalized = status.replace('_', '');
      const description = statusMessages[normalized] ?? statusMessages[status]
        ?? $localize`:@@invoices.invoice-wizard.ts.statut.d.abonnement.statusdisplay.emissi.f6c66860:Statut d'abonnement « ${sub.statusDisplay}:statusDisplay: » : émission de facture indisponible.`;

      return {
        id: 'invoice-quota',
        category: 'CALCULATION',
        label: $localize`:@@invoices.invoice-wizard.ts.quota.factures.dfc0fe56:Quota factures`,
        description,
        status: 'ERROR',
        isBlocking: true,
        field: 'subscription'
      };
    }

    if (invoices && !invoices.isUnlimited && invoices.used >= invoices.limit) {
      return {
        id: 'invoice-quota',
        category: 'CALCULATION',
        label: $localize`:@@invoices.invoice-wizard.ts.quota.factures.dfc0fe56:Quota factures`,
        description:
          $localize`:@@invoices.invoice-wizard.ts.limite.mensuelle.atteinte.used.limit.fac.1b98ed0e:Limite mensuelle atteinte (${invoices.used}:used:/${invoices.limit}:limit: factures). Passez à un forfait supérieur dans Paramètres > Abonnement ou attendez le prochain cycle.`,
        status: 'ERROR',
        isBlocking: true,
        field: 'subscription'
      };
    }

    return {
      id: 'invoice-quota',
      category: 'CALCULATION',
      label: $localize`:@@invoices.invoice-wizard.ts.quota.factures.dfc0fe56:Quota factures`,
      description: usageLabel,
      status: 'VALID',
      isBlocking: false,
      field: 'subscription'
    };
  }

  /** Loads subscription for quota pre-checks. Defaults to forceRefresh on review/submit paths. */
  ensureSubscriptionLoaded(options?: { forceRefresh?: boolean }): Observable<SubscriptionInfo | null> {
    const forceRefresh = options?.forceRefresh ?? true;

    if (!forceRefresh) {
      const cached = this._subscriptionInfo();
      if (cached) {
        return of(cached);
      }
    }

    if (this.subscriptionLoadInFlight && !forceRefresh) {
      return this.subscriptionLoadInFlight;
    }

    if (forceRefresh) {
      this.subscriptionLoadInFlight = null;
    }

    this.subscriptionLoadInFlight = this.subscriptionService.getCurrentSubscription(forceRefresh).pipe(
      map(response => (response?.success ? response.data : null)),
      tap(info => {
        if (info) {
          this._subscriptionInfo.set(info);
        }
      }),
      catchError(() => of(null)),
      tap(() => {
        this.subscriptionLoadInFlight = null;
      })
    );

    return this.subscriptionLoadInFlight;
  }

  invalidateSubscriptionCache(): void {
    this._subscriptionInfo.set(null);
    this.subscriptionLoadInFlight = null;
  }

  isPlanQuotaErrorCode(code: string | null | undefined): boolean {
    return !!code && (PLAN_QUOTA_ERROR_CODES as readonly string[]).includes(code);
  }

  private extractSubmitError(error: unknown): { message: string; code: string | null } {
    let errorMessage = $localize`:@@invoices.invoice-wizard.ts.impossible.d.emettre.la.facture.973e03c0:Impossible d'émettre la facture`;
    let errorCode: string | null = null;
    const err = error as {
      error?: {
        message?: string;
        description?: string;
        code?: string;
        errors?: string[];
        globalErrors?: string[];
      };
      message?: string;
      status?: number;
    };

    if (err.error) {
      if (err.error.code) {
        errorCode = err.error.code;
      }
      if (err.error.message) {
        errorMessage = err.error.message;
      } else if (err.error.description) {
        errorMessage = err.error.description;
      } else if (err.error.errors?.length) {
        errorMessage = err.error.errors[0];
      } else if (err.error.globalErrors?.length) {
        errorMessage = err.error.globalErrors[0];
      } else if (typeof err.error === 'string') {
        errorMessage = err.error;
      }
    } else if (err.message) {
      errorMessage = err.message;
    } else if (err.status === 0) {
      errorMessage = $localize`:@@invoices.invoice-wizard.ts.erreur.de.connexion.verifiez.votre.conne.f8b5d2b7:Erreur de connexion. Vérifiez votre connexion réseau.`;
    } else if (err.status && err.status >= 500) {
      errorMessage = $localize`:@@invoices.invoice-wizard.ts.erreur.serveur.veuillez.reessayer.plus.t.e12ec1fc:Erreur serveur. Veuillez réessayer plus tard.`;
    } else if (err.status === 400) {
      errorMessage = $localize`:@@invoices.invoice-wizard.ts.les.donnees.de.la.facture.sont.invalides.38e2b3f3:Les données de la facture sont invalides.`;
    } else if (err.status === 401 || err.status === 403) {
      errorMessage = $localize`:@@invoices.invoice-wizard.ts.vous.n.etes.pas.autorise.a.effectuer.cet.3dfa60c6:Vous n'êtes pas autorisé à effectuer cette action.`;
    }

    return { message: errorMessage, code: errorCode };
  }

  private handleSubmitFailure(error: unknown): Observable<never> {
    const { message, code } = this.extractSubmitError(error);
    this.updateState({ isSaving: false, submissionError: message });
    this._submissionErrorCode.set(code);
    return throwError(() => new Error(message));
  }

  private checkCalculations(): ComplianceCheck {
    const { isValid } = computeWizardTotalsCheck(this.state());

    return {
      id: 'calculations',
      category: 'CALCULATION',
      label: $localize`:@@invoices.invoice-wizard.ts.verification.des.calculs.68a4d18c:Vérification des calculs`,
      description: isValid 
        ? $localize`:@@invoices.invoice-wizard.ts.tous.les.calculs.sont.coherents.1f7d5957:Tous les calculs sont cohérents` 
        : $localize`:@@invoices.invoice-wizard.ts.incoherence.detectee.dans.les.calculs.fd9ab997:Incohérence détectée dans les calculs`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'totals'
    };
  }

  private checkAmountsPositive(): ComplianceCheck {
    const totals = this.state().totals;
    const type = this.state().metadata.type;
    
    // Credit notes can have negative amounts
    if (type === InvoiceType.CreditNote) {
      return {
        id: 'amounts-positive',
        category: 'CALCULATION',
        label: $localize`:@@invoices.invoice-wizard.ts.montants.6b312baa:Montants`,
        description: $localize`:@@invoices.invoice-wizard.ts.facture.d.avoir.montants.verifies.e678bb1e:Facture d'avoir - montants vérifiés`,
        status: 'VALID',
        isBlocking: false,
        field: null
      };
    }

    const isValid = totals.totalHT >= 0 && totals.totalTTC >= 0;

    return {
      id: 'amounts-positive',
      category: 'CALCULATION',
      label: $localize`:@@invoices.invoice-wizard.ts.montants.positifs.d5089c18:Montants positifs`,
      description: isValid 
        ? $localize`:@@invoices.invoice-wizard.ts.tous.les.montants.sont.positifs.e3f5fc38:Tous les montants sont positifs` 
        : $localize`:@@invoices.invoice-wizard.ts.les.montants.doivent.etre.positifs.pour.0d0e6741:Les montants doivent être positifs pour une facture standard`,
      status: isValid ? 'VALID' : 'ERROR',
      isBlocking: true,
      field: 'totals'
    };
  }

  private checkNumberFormat(): ComplianceCheck {
    const number = this.state().metadata.invoiceNumber;
    const isValid = !!number && (isConfiguredDocumentNumber(number) || number.startsWith('TEMP'));
    
    return {
      id: 'number-format',
      category: 'FORMAT',
      label: $localize`:@@invoices.invoice-wizard.ts.format.du.numero.ed424764:Format du numéro`,
      description: isValid 
        ? $localize`:@@invoices.invoice-wizard.ts.format.conforme.2f9c1bfd:Format conforme` 
        : $localize`:@@invoices.invoice-wizard.ts.le.format.du.numero.doit.correspondre.a.8886ba9b:Le format du numéro doit correspondre à la numérotation configurée`,
      status: isValid ? 'VALID' : 'WARNING',
      isBlocking: false,
      field: 'invoiceNumber'
    };
  }

  private isValidNIF(nif: string): boolean {
    return isValidNif(nif);
  }

  // ============================================
  // STEP VALIDATION
  // ============================================

  private validateCurrentStep(): void {
    const step = this.state().currentStep;
    const isValid = this.isStepValid(step);
    
    const steps = this.state().steps.map((s, i) => ({
      ...s,
      isValid: i === step ? isValid : s.isValid,
      isDisabled: i > step + 1 || (i > step && !isValid)
    }));

    this.updateState({ steps });
  }

  private validateSpecificStep(stepIndex: number): void {
    const isValid = this.isStepValid(stepIndex);
    const steps = this.state().steps.map((s, i) => ({
      ...s,
      isValid: i === stepIndex ? isValid : s.isValid,
    }));
    this.updateState({ steps });
  }

  /**
   * Validates the step that owns the given legacy domain key in the active flow.
   * Bridges legacy-index call sites (validateSpecificStep(0|2|3)) to the new key-based model
   * so prefill / import code works identically in both 6-step and 4-step flows.
   */
  private validateStepByDomain(domain: 'metadata' | 'seller' | 'client' | 'lines' | 'legal'): void {
    const targetKeys: WizardStepKey[] = this.isSimplifiedFlow()
      ? (domain === 'metadata' || domain === 'seller'
          ? ['document']
          : domain === 'lines' || domain === 'legal'
            ? ['billing']
            : [domain])
      : [domain];
    const steps = this.state().steps;
    for (const key of targetKeys) {
      const idx = steps.findIndex(s => s.key === key);
      if (idx >= 0) this.validateSpecificStep(idx);
    }
  }

  // ----- Atomic per-domain validators (single source of truth) -----

  private isMetadataValid(): boolean {
    const meta = this.state().metadata;
    if (!meta.issueDate || !meta.type) return false;
    if (meta.type === InvoiceType.CreditNote && !meta.linkedInvoiceId) return false;
    return true;
  }

  private isSellerValid(): boolean {
    const seller = this.state().seller;
    return !!seller && !!seller.companyName && !!seller.nif;
  }

  private isClientValid(): boolean {
    const client = this.state().client;
    if (!client || !client.name) return false;
    if (!isClientReadyForSubmission(normalizeClientInfo(client))) return false;
    if (client.taxType === ClientTaxType.TaxSubject) {
      if (!client.nif || !this.isValidNIF(client.nif)) return false;
    }
    if (client.isNewClient) {
      if (client.email && !isValidEmail(client.email)) return false;
      if (!client.address?.street) return false;
      if (!client.address?.city) return false;
      if (!client.address?.governorate) return false;
    }
    return true;
  }

  private areLinesValid(): boolean {
    return this.validation.validateStep(this.state(), 3).isValid;
  }

  private isPaymentValid(): boolean {
    return !!this.state().payment.method;
  }

  /**
   * Strategy facade : delegates step validation based on the active flow (6-step legacy vs 4-step simplified).
   * Compound steps in the simplified flow aggregate the matching atomic validators.
   */
  private isStepValid(step: number): boolean {
    const key = this.state().steps[step]?.key;
    switch (key) {
      // ----- Legacy 6-step flow -----
      case 'metadata': return this.isMetadataValid();
      case 'seller':   return this.isSellerValid();
      case 'lines':    return this.areLinesValid();
      case 'legal':    return this.isPaymentValid();
      case 'preview':  return true;

      // ----- Simplified 4-step flow -----
      case 'document': return this.isMetadataValid() && this.isSellerValid();
      case 'billing':  return this.areLinesValid() && this.isPaymentValid();
      case 'review':   return true;

      // ----- Shared -----
      case 'client':   return this.isClientValid();

      default:         return false;
    }
  }

  // ============================================
  // PERSISTENCE
  // ============================================

  saveDraft(): Observable<string> {
    this.updateState({ isSaving: true });

    const request = this.buildSaveDraftRequest();
    const url = `${this.WIZARD_API_URL}/drafts`;

    return this.http.post<ApiResponse<{ id: string }>>(url, request).pipe(
      map(response => {
        const draftId = response?.data?.id ?? (response?.data as any)?.Id ?? (response?.data as any);
        return typeof draftId === 'string' ? draftId : String(draftId);
      }),
      tap(id => {
        this.updateState({
          draftId: id,
          isDirty: false,
          isSaving: false,
          lastSaved: new Date()
        });
      }),
      catchError(error => {
        this.updateState({ isSaving: false });
        throw error;
      })
    );
  }

  private submitViaDraftEndpoint(): Observable<string> {
    return this.http.post<ApiResponse<{ id: string }>>(`${this.WIZARD_API_URL}/drafts`, this.buildSaveDraftRequest()).pipe(
      map(res => {
        const id = res?.data?.id ?? (res?.data as any)?.Id ?? (res?.data as any);
        const draftId = typeof id === 'string' ? id : String(id);
        this.updateState({ draftId });
        return draftId;
      }),
      switchMap(draftId => {
        const prefix = this.state().metadata.type === InvoiceType.CreditNote ? 'credit-note' : 'invoice-draft';
        const idempotencyKey = `${prefix}-${Date.now()}-${createClientUuid()}`.slice(0, 64);
        return this.http.post<ApiResponse<{ invoiceId: string }>>(
          `${this.WIZARD_API_URL}/drafts/${draftId}/submit`,
          { idempotencyKey }
        ).pipe(
          map(res => {
            const invoiceId = res?.data?.invoiceId ?? (res?.data as any)?.InvoiceId;
            this.updateState({ isSaving: false, submissionError: null });
            return typeof invoiceId === 'string' ? invoiceId : String(invoiceId);
          })
        );
      }),
      catchError(error => this.handleSubmitFailure(error))
    );
  }

  private buildSaveDraftRequest(): object {
    const state = this.state();
    const meta = state.metadata;

    return {
      draftId: state.draftId || null,
      currentStep: state.currentStep,
      metadata: {
        type: meta.type,
        issueDate: meta.issueDate instanceof Date ? meta.issueDate.toISOString() : meta.issueDate,
        dueDate: meta.dueDate ? (meta.dueDate instanceof Date ? meta.dueDate.toISOString() : meta.dueDate) : null,
        currency: meta.currency,
        internalReference: meta.internalReference,
        linkedInvoiceId: isValidInvoiceGuid(meta.linkedInvoiceId) ? meta.linkedInvoiceId : null,
        warehouseId: meta.warehouseId || null,
        cashRegisterSessionId: meta.cashRegisterSessionId || null
      },
      sellerId: state.seller?.id || null,
      client: state.client ? {
        clientId: state.client.isNewClient ? null : state.client.id,
        isNewClient: state.client.isNewClient,
        newClient: state.client.isNewClient ? {
          name: state.client.name,
          taxType: state.client.taxType,
          nif: state.client.nif,
          address: {
            street: state.client.address.street,
            streetLine2: state.client.address.streetLine2,
            postalCode: state.client.address.postalCode,
            city: state.client.address.city,
            governorate: state.client.address.governorate
          },
          email: state.client.email,
          phone: state.client.phone,
          contactPerson: state.client.contactPerson
        } : undefined
      } : null,
      lines: state.lines.length > 0 ? state.lines.map(line => ({
        productId: line.productId,
        designation: normalizeDesignation(line.designation),
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPriceHT: line.unitPriceHT,
        priceOverridden: line.priceOverridden ?? false,
        discountType: line.discountType,
        discountValue: line.discountValue,
        vatRate: line.vatRate,
        fodecApplicable: line.isFodecApplicable
      })) : null,
      paymentLegal: {
        paymentMethod: state.payment.method,
        paymentTerms: state.payment.terms,
        daysUntilDue: state.payment.daysUntilDue,
        bankInfo: state.payment.iban || state.payment.rib ? {
          bankName: state.payment.bankName || '',
          iban: state.payment.iban,
          rib: state.payment.rib
        } : null,
        purchaseOrderRef: state.payment.purchaseOrderRef,
        legalMentions: {
          vatMention: state.legalMentions.vatMention,
          exemptionMention: state.legalMentions.exemptionMention,
          customMention: state.legalMentions.customMention
        }
      }
    };
  }

  submitInvoice(): Observable<string> {
    // Clear any previous submission error
    this.updateState({ submissionError: null });
    this._submissionErrorCode.set(null);
    
    // Générer automatiquement le numéro séquentiel si le numéro est temporaire
    const currentNumber = this.state().metadata.invoiceNumber;
    if (!currentNumber || currentNumber.toUpperCase().includes('TEMP')) {
      // Générer le numéro séquentiel avant la validation
      this.updateState({ isSaving: true, submissionError: null });
      return this.fetchNextInvoiceNumber().pipe(
        switchMap(() => {
          // Re-vérifier après génération
          const newNumber = this.state().metadata.invoiceNumber;
          if (!newNumber || newNumber.toUpperCase().includes('TEMP')) {
            const errorMessage = $localize`:@@invoices.invoice-wizard.ts.impossible.de.generer.le.numero.sequenti.a5e9a866:Impossible de générer le numéro séquentiel de facture`;
            this.updateState({ isSaving: false, submissionError: errorMessage });
            throw new Error(errorMessage);
          }
          return this.performSubmit();
        }),
        catchError(error => {
          const errorMessage = error.message || $localize`:@@invoices.invoice-wizard.ts.erreur.lors.de.la.generation.du.numero.d.e1d61d23:Erreur lors de la génération du numéro de facture`;
          this.updateState({ isSaving: false, submissionError: errorMessage });
          throw error;
        })
      );
    }

    return this.performSubmit();
  }

  private performSubmit(): Observable<string> {
    // Clear any previous submission error
    this.updateState({ submissionError: null });

    const validation = this.validateInvoice();

    if (!validation.canProceed) {
      const errorMessage = $localize`:@@invoices.invoice-wizard.ts.la.facture.ne.peut.pas.etre.soumise.erre.6ef4e7d5:La facture ne peut pas être soumise - erreurs de validation`;
      this.updateState({ isSaving: false, submissionError: errorMessage });
      return throwError(() => new Error(errorMessage));
    }

    this.updateState({ isSaving: true, submissionError: null });

    let state = this.state();
    if (state.client) {
      const normalized = normalizeClientInfo(state.client);
      this.updateState({ client: normalized });
      state = this.state();
    }

    if (!state.client) {
      const errorMessage = $localize`:@@invoices.invoice-wizard.ts.le.client.est.obligatoire.778453ff:Le client est obligatoire`;
      this.updateState({ isSaving: false, submissionError: errorMessage });
      return throwError(() => new Error(errorMessage));
    }

    if (!isClientReadyForSubmission(state.client)) {
      const errorMessage =
        $localize`:@@invoices.invoice-wizard.ts.selectionnez.un.client.dans.la.liste.ou.7e038a7f:Sélectionnez un client dans la liste ou utilisez l'onglet « Nouveau client ». Si le problème persiste, resélectionnez le client.`;
      this.updateState({ isSaving: false, submissionError: errorMessage });
      return throwError(() => new Error(errorMessage));
    }

    if (state.metadata.type === InvoiceType.CreditNote) {
      return this.submitViaDraftEndpoint();
    }

    if (this.openedFromExistingDraft && state.draftId) {
      return this.submitViaDraftEndpoint();
    }

    if (state.client.isNewClient) {
      return this.createClientAndInvoice();
    }

    return defer(() => {
      const createInvoiceDto = this.convertToCreateInvoiceDto(this.state());
      return this.http.post<ApiResponse<string>>(this.API_URL, createInvoiceDto);
    }).pipe(
      map(response => {
        if (!response || !response.success) {
          const errorMessage = response?.message || $localize`:@@invoices.invoice-wizard.ts.erreur.lors.de.l.emission.de.la.facture.748b038b:Erreur lors de l'émission de la facture`;
          this.updateState({ isSaving: false, submissionError: errorMessage });
          throw new Error(errorMessage);
        }
        // Clear error on success
        this.updateState({ isSaving: false, submissionError: null });
        this._submissionErrorCode.set(null);
        return response.data;
      }),
      catchError(error => this.handleSubmitFailure(error))
    );
  }

  /**
   * Creates a new client first, then creates the invoice.
   */
  private createClientAndInvoice(): Observable<string> {
    const state = this.state();
    
    if (!state.client || !state.client.isNewClient) {
      throw new Error('Le client doit être nouveau pour être créé');
    }

    // Convert ClientTaxType to ClientType (backend enum)
    // TAX_SUBJECT => Business, others => Individual
    const clientType = state.client.taxType === ClientTaxType.TaxSubject ? 'Business' : 'Individual';

    const newClientRequest = {
      name: state.client.name,
      type: clientType, // Backend expects 'Business' or 'Individual'
      nif: state.client.nif || null,
      street: state.client.address.street,
      streetLine2: state.client.address.streetLine2 || null,
      postalCode: state.client.address.postalCode || null,
      city: state.client.address.city,
      governorate: state.client.address.governorate,
      email: state.client.email,
      phone: state.client.phone || null,
      contactPerson: state.client.contactPerson || null,
      notes: null
    };

    // Create client first
    // Le backend retourne ApiResponse<Guid> : data est une string GUID directe.
    // On accepte aussi un objet { id: string } pour robustesse.
    return this.http.post<ApiResponse<unknown>>(`${environment.apiUrl}/clients`, newClientRequest).pipe(
      switchMap(clientResponse => {
        if (!clientResponse || !clientResponse.success || clientResponse.data == null) {
          const errorMessage = $localize`:@@invoices.invoice-wizard.ts.erreur.lors.de.la.creation.du.client.88ca36f6:Erreur lors de la création du client`;
          this.updateState({ isSaving: false, submissionError: errorMessage });
          throw new Error(errorMessage);
        }

        const rawData = clientResponse.data as unknown;
        const clientId: string | null =
          typeof rawData === 'string' && rawData.length > 0
            ? rawData
            : ((rawData as any)?.id ?? (rawData as any)?.Id ?? null);

        if (!clientId) {
          const errorMessage = $localize`:@@invoices.invoice-wizard.ts.erreur.lors.de.la.creation.du.client.ide.7134acd2:Erreur lors de la création du client : identifiant non retourné`;
          this.updateState({ isSaving: false, submissionError: errorMessage });
          throw new Error(errorMessage);
        }

        // Update state with created client ID
        this.updateState({
          client: {
            ...state.client!,
            id: clientId,
            isNewClient: false
          }
        });

        // Now create invoice with the new client ID
        const updatedState = this.state();
        const createInvoiceDto = this.convertToCreateInvoiceDto(updatedState);
        
        return this.http.post<ApiResponse<string>>(this.API_URL, createInvoiceDto);
      }),
      map(response => {
        if (!response || !response.success) {
          const errorMessage = response?.message || $localize`:@@invoices.invoice-wizard.ts.erreur.lors.de.l.emission.de.la.facture.748b038b:Erreur lors de l'émission de la facture`;
          this.updateState({ isSaving: false, submissionError: errorMessage });
          throw new Error(errorMessage);
        }
        // Clear error on success
        this.updateState({ isSaving: false, submissionError: null });
        this._submissionErrorCode.set(null);
        return response.data;
      }),
      catchError(error => this.handleSubmitFailure(error))
    );
  }

  /**
   * Converts wizard state to CreateInvoiceDto format expected by backend.
   * Validates and transforms all data types to match backend expectations.
   */
  private convertToCreateInvoiceDto(state: InvoiceWizardState): any {
    // Validate client
    if (!state.client || !state.client.id) {
      throw new Error('Le client est obligatoire');
    }

    // Validate client ID format (must be a valid GUID)
    let clientId: string;
    try {
      // Ensure it's a valid GUID format
      clientId = state.client.id;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
        throw new Error(`Format d'ID client invalide: ${clientId}`);
      }
    } catch (error) {
      throw new Error('Le client sélectionné est invalide. Veuillez sélectionner un client valide.');
    }

    // Validate that all lines have a product (required by CreateInvoiceCommand).
    // The Articles step now blocks progression when this is violated, so this is a
    // safety net for any code path that bypasses step validation.
    const linesWithoutProduct = state.lines.filter(line => !line.productId);
    if (linesWithoutProduct.length > 0) {
      throw new Error(
        `${linesWithoutProduct.length} ligne(s) ne sont pas liées à un produit. ` +
        `Retournez à l'étape « Articles » pour les associer à un produit existant ou créer un nouveau produit.`
      );
    }

    // Validate issue date
    if (!state.metadata.issueDate || !(state.metadata.issueDate instanceof Date)) {
      throw new Error('La date d\'émission est invalide');
    }

    // Convert dates to ISO strings (backend expects DateTime)
    const issueDate = state.metadata.issueDate.toISOString();
    const dueDate = state.metadata.dueDate && state.metadata.dueDate instanceof Date
      ? state.metadata.dueDate.toISOString()
      : null;

    // Validate and convert lines
    const lines = state.lines
      .filter(line => line.productId) // Filter out lines without product
      .map((line, index) => {
        // Validate product ID format
        if (!line.productId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line.productId)) {
          throw new Error(`Format d'ID produit invalide à la ligne ${index + 1}`);
        }

        // Validate quantity
        if (!line.quantity || line.quantity <= 0) {
          throw new Error(`La quantité doit être supérieure à zéro à la ligne ${index + 1}`);
        }

        // Validate unit price
        if (!line.unitPriceHT || line.unitPriceHT < 0) {
          throw new Error(`Le prix unitaire doit être positif à la ligne ${index + 1}`);
        }

        // Calculate discount percent if needed
        let discountPercent: number | null = null;
        if (line.discountType === 'PERCENT' && line.discountValue) {
          discountPercent = Math.max(0, Math.min(100, line.discountValue)); // Clamp between 0-100
        } else if (line.discountType === 'AMOUNT' && line.discountValue && line.unitPriceHT > 0) {
          // Convert amount discount to percent
          const subtotal = line.quantity * line.unitPriceHT;
          discountPercent = Math.min(100, (line.discountValue / subtotal) * 100);
        }

        return {
          productId: line.productId,
          quantity: Number(line.quantity.toFixed(3)), // Ensure proper decimal precision
          customUnitPrice:
            line.priceOverridden && line.unitPriceHT > 0
              ? Number(line.unitPriceHT.toFixed(3))
              : null,
          discountPercent: discountPercent ? Number(discountPercent.toFixed(2)) : null
        };
      });

    if (lines.length === 0) {
      throw new Error('La facture doit contenir au moins une ligne avec un produit');
    }

    return {
      clientId: clientId,
      issueDate: issueDate,
      dueDate: dueDate,
      reference: state.metadata.internalReference?.trim() || null,
      notes: state.legalMentions.customMention?.trim() || null,
      paymentTerms: state.payment.terms?.trim() || null,
      warehouseId: state.metadata.warehouseId || null,
      lines: lines
    };
  }

  private buildRequest(saveAsDraft: boolean): CreateInvoiceWizardRequest {
    const state = this.state();

    return {
      type: state.metadata.type,
      issueDate: state.metadata.issueDate.toISOString(),
      dueDate: state.metadata.dueDate?.toISOString() || null,
      currency: state.metadata.currency,
      internalReference: state.metadata.internalReference,
      linkedInvoiceId: state.metadata.linkedInvoiceId,
      
      sellerId: state.seller!.id,
      
      clientId: state.client?.isNewClient ? null : state.client?.id || null,
      newClient: state.client?.isNewClient ? {
        name: state.client.name,
        taxType: state.client.taxType,
        nif: state.client.nif,
        street: state.client.address.street,
        streetLine2: state.client.address.streetLine2,
        postalCode: state.client.address.postalCode,
        city: state.client.address.city,
        governorate: state.client.address.governorate,
        email: state.client.email,
        phone: state.client.phone,
        contactPerson: state.client.contactPerson
      } : null,
      
      lines: state.lines.map(line => ({
        productId: line.productId,
        designation: normalizeDesignation(line.designation),
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPriceHT: line.unitPriceHT,
        discountPercent: line.discountType === 'PERCENT' ? line.discountValue : null,
        discountAmount: line.discountType === 'AMOUNT' ? line.discountValue : null,
        vatRate: line.vatRate
      })),
      
      paymentMethod: state.payment.method,
      paymentTerms: state.payment.terms,
      bankInfo: state.payment.iban || state.payment.rib ? {
        bankName: state.payment.bankName || '',
        iban: state.payment.iban,
        rib: state.payment.rib
      } : null,
      purchaseOrderRef: state.payment.purchaseOrderRef,
      
      legalMentions: state.legalMentions.customMention,
      notes: null,
      
      saveAsDraft
    };
  }

  loadDraft(draftId: string): Observable<void> {
    return this.http.get<ApiResponse<any>>(`${this.WIZARD_API_URL}/drafts/${draftId}`).pipe(
      tap(response => {
        if (!response?.success || !response.data) return;
        const d = response.data;
        const meta = d.metadata;
        const seller = d.seller;
        const rawClient = d.client ?? d.Client;
        const lines = d.lines || [];
        const totals = d.totals;
        const paymentLegal = d.paymentLegal;

        const metadata: InvoiceMetadata = {
          type: (meta?.type === 'CREDIT_NOTE' ? InvoiceType.CreditNote : InvoiceType.Invoice) as InvoiceType,
          invoiceNumber: '', // Fetched separately
          issueDate: meta?.issueDate ? new Date(meta.issueDate) : new Date(),
          dueDate: meta?.dueDate ? new Date(meta.dueDate) : this.addDays(new Date(), 30),
          currency: (meta?.currency as Currency) || Currency.TND,
          internalReference: meta?.internalReference || null,
          linkedInvoiceId: meta?.linkedInvoiceId || null,
          warehouseId: meta?.warehouseId ?? null,
          cashRegisterSessionId: meta?.cashRegisterSessionId ?? null
        };

        const sellerInfo: SellerInfo | null = seller ? {
          id: seller.id,
          companyName: seller.companyName,
          tradeName: seller.tradeName || null,
          address: {
            street: seller.address?.street || '',
            streetLine2: seller.address?.streetLine2 || null,
            postalCode: seller.address?.postalCode || null,
            city: seller.address?.city || '',
            governorate: seller.address?.governorate || '',
            country: seller.address?.country || 'Tunisie'
          },
          nif: seller.nif || '',
          commerceRegistry: null,
          vatCode: null,
          logo: seller.logo || null,
          phone: seller.phone || null,
          email: seller.email || ''
        } : null;

        // Le brouillon est sauvegardé sous la forme imbriquée :
        //   { clientId, isNewClient, newClient: { name, taxType, address, ... } }
        // On supporte aussi un format plat (rétrocompatibilité ou client existant).
        const clientInfo: ClientInfo | null = rawClient
          ? (() => {
              const isNew = rawClient.isNewClient === true || rawClient.IsNewClient === true;
              const nested = rawClient.newClient ?? rawClient.NewClient;
              const src: any = (isNew && nested) ? nested : rawClient;

              const resolvedId = isNew
                ? null
                : (rawClient.clientId
                    ?? rawClient.ClientId
                    ?? rawClient.id
                    ?? rawClient.Id
                    ?? null);

              return normalizeClientInfo({
                id: resolvedId,
                isNewClient: isNew,
                name: src.name ?? src.Name ?? '',
                taxType: (src.taxType as ClientTaxType) || ClientTaxType.NonTaxSubject,
                address: {
                  street: src.address?.street ?? src.street ?? '',
                  streetLine2: src.address?.streetLine2 ?? src.streetLine2 ?? null,
                  postalCode: src.address?.postalCode ?? src.postalCode ?? null,
                  city: src.address?.city ?? src.city ?? '',
                  governorate: src.address?.governorate ?? src.governorate ?? '',
                  country: src.address?.country ?? src.country ?? 'Tunisie'
                },
                nif: src.nif ?? src.Nif ?? null,
                email: src.email ?? src.Email ?? '',
                phone: src.phone ?? src.Phone ?? null,
                contactPerson: src.contactPerson ?? src.ContactPerson ?? null
              });
            })()
          : null;

        const invoiceLines: InvoiceLine[] = lines.map((l: any, idx: number) => {
          const discountType = l.discountValue ? (l.discountType === 'PERCENT' ? 'PERCENT' as const : 'AMOUNT' as const) : null;
          return {
            id: `line-${idx}-${Date.now()}`,
            lineNumber: l.lineNumber || idx + 1,
            productId: l.productId || null,
            designation: normalizeDesignation(l.designation),
            description: l.description || null,
            quantity: Number(l.quantity) || 0,
            unit: l.unit || null,
            unitPriceHT: Number(l.unitPriceHT) || 0,
            discountType,
            discountValue: l.discountValue ?? null,
            vatRate: (l.vatRate as TunisianVatRate) ?? TunisianVatRate.Standard,
            isFodecApplicable: l.fodecApplicable ?? false,
            discountAmount: Number(l.discountAmount) || 0,
            totalHT: Number(l.totalHT) || 0,
            fodecAmount: Number(l.fodecAmount) || 0,
            vatAmount: Number(l.vatAmount) || 0,
            totalTTC: Number(l.totalTTC) || 0
          };
        });

        if (totals?.fodecRatePercent != null) {
          this._fodecRatePercent.set(Number(totals.fodecRatePercent) || DEFAULT_FODEC_RATE_PERCENT);
        }

        const totalsState: InvoiceTotals = totals ? {
          subTotalHT: Number(totals.subTotalHT) || 0,
          totalDiscount: Number(totals.totalDiscount) || 0,
          totalHT: Number(totals.totalHT) || 0,
          totalFodec: Number(totals.totalFodec) || 0,
          vatBreakdown: (totals.vatBreakdown || []).map((v: any) => ({
            rate: v.rate as TunisianVatRate,
            rateDisplay: v.rateDisplay || `${v.rate}%`,
            baseAmount: Number(v.baseAmount) || 0,
            vatAmount: Number(v.vatAmount) || 0
          })),
          totalVat: Number(totals.totalVat) || 0,
          fiscalStampAmount: Number(totals.fiscalStampAmount) || 0,
          totalTTC: Number(totals.totalTTC) || 0,
          currency: (totals.currency as Currency) || Currency.TND,
          fodecRatePercent: Number(totals.fodecRatePercent) || this._fodecRatePercent()
        } : this.getEmptyTotals();

        const payment: PaymentInfo = paymentLegal ? {
          method: (paymentLegal.paymentMethod as PaymentMethod) || PaymentMethod.BankTransfer,
          terms: paymentLegal.paymentTerms || null,
          daysUntilDue: paymentLegal.daysUntilDue ?? 30,
          bankName: paymentLegal.bankInfo?.bankName || null,
          iban: paymentLegal.bankInfo?.iban || null,
          rib: paymentLegal.bankInfo?.rib || null,
          purchaseOrderRef: paymentLegal.purchaseOrderRef || null
        } : this.getDefaultPayment();

        const legalMentions: LegalMentions = paymentLegal?.legalMentions ? {
          vatMention: paymentLegal.legalMentions.vatMention || 'TVA due par le vendeur',
          exemptionMention: paymentLegal.legalMentions.exemptionMention || null,
          customMention: paymentLegal.legalMentions.customMention || null
        } : this.getDefaultLegalMentions();

        const baseSteps = this.initializeSteps();
        const currentStep = this.resolveRestoredStepIndex(d.currentStep ?? 0, baseSteps);
        const steps = baseSteps.map((s, i) => ({
          ...s,
          isComplete: i < currentStep,
          isValid: true,
          isActive: i === currentStep,
          isDisabled: i > currentStep
        }));

        this.state.set({
          ...this.initialState,
          currentStep,
          steps,
          metadata,
          seller: sellerInfo,
          client: clientInfo,
          lines: invoiceLines,
          totals: totalsState,
          payment,
          legalMentions,
          draftId,
          isDirty: false
        });
        this.openedFromExistingDraft = true;
        this.syncFodecFromProducts();
        this.validateSpecificStep(currentStep);
      }),
      switchMap(() => this.fetchNextInvoiceNumber().pipe(map(() => void 0))),
      catchError(() => of(void 0))
    );
  }

  /**
   * Assainit l'index d'étape restauré depuis un brouillon persistant.
   * - Index dans les bornes du flux actif → inchangé (aucun impact sur les brouillons
   *   autosauvegardés par le flux courant, ni sur le flux legacy à 6 étapes).
   * - Index >= steps.length (brouillon persisté avec l'indexation legacy à 6 étapes,
   *   ex. brouillons de billing-run avec CurrentStep = 4) → mappage par clé vers
   *   l'étape équivalente du flux actif.
   * - Bornage défensif final pour toute autre valeur inattendue (négatif, NaN).
   */
  private resolveRestoredStepIndex(rawStep: number, steps: WizardStep[]): number {
    const last = steps.length - 1;
    if (Number.isInteger(rawStep) && rawStep >= 0 && rawStep <= last) {
      return rawStep;
    }
    if (Number.isInteger(rawStep) && rawStep > last) {
      const legacyKeys: WizardStepKey[] = ['metadata', 'seller', 'client', 'lines', 'legal', 'preview'];
      const legacyToSimplified: Record<string, WizardStepKey> = {
        metadata: 'document',
        seller: 'document',
        client: 'client',
        lines: 'billing',
        legal: 'billing',
        preview: 'review'
      };
      const legacyKey = legacyKeys[rawStep];
      const targetKey = legacyKey ? legacyToSimplified[legacyKey] : undefined;
      const idx = targetKey ? steps.findIndex(s => s.key === targetKey) : -1;
      if (idx >= 0) return idx;
    }
    return Math.min(Math.max(Number.isFinite(rawStep) ? Math.trunc(rawStep) : 0, 0), last);
  }

  // ============================================
  // UTILITIES
  // ============================================

  reset(): void {
    this.invalidateSubscriptionCache();
    this._submissionErrorCode.set(null);
    this.openedFromExistingDraft = false;
    this.state.set({ ...this.initialState, steps: this.initializeSteps() });
  }

  /**
   * Clear submission error (useful after user acknowledges the error)
   */
  clearSubmissionError(): void {
    this.updateState({ submissionError: null });
    this._submissionErrorCode.set(null);
  }

  private updateState(partial: Partial<InvoiceWizardState>): void {
    this.state.update(current => ({ ...current, ...partial }));
  }

  /** Sync isFodecApplicable from catalog for lines linked to a product (import, draft reload). */
  private syncFodecFromProducts(): void {
    const productIds = [...new Set(
      this.state().lines
        .map(line => line.productId)
        .filter((id): id is string => !!id)
    )];
    if (productIds.length === 0) {
      return;
    }

    this.productService.getFodecFlags(productIds).pipe(
      take(1),
      catchError(() => of({ success: false, data: null as { id: string; isFodecApplicable: boolean }[] | null, message: null, errors: [] as string[] }))
    ).subscribe(res => {
      if (!res.success || !res.data) {
        return;
      }
      const fodecByProductId = new Map(
        res.data.map(r => [r.id, r.isFodecApplicable])
      );
      for (const line of this.state().lines) {
        if (!line.productId || !fodecByProductId.has(line.productId)) {
          continue;
        }
        const isFodecApplicable = fodecByProductId.get(line.productId)!;
        if (line.isFodecApplicable !== isFodecApplicable) {
          this.updateLine(line.id, { isFodecApplicable });
        }
      }
    });
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  formatAmount(amount: number, currency: Currency = Currency.TND): string {
    const decimals = currency === Currency.TND ? 3 : 2;
    return amount.toLocaleString('fr-TN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }) + ' ' + currency;
  }
}
