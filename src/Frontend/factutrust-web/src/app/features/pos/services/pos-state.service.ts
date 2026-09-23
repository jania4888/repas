import { Injectable, computed, inject, signal } from '@angular/core';
import { createClientUuid } from '@core/utils/safe-random-uuid.util';
import { ProductListItem } from '@core/services/product.service';
import { PosDualScreenService } from './pos-dual-screen.service';
import { ClientListItem, ClientOutstanding } from '@core/services/client.service';
import {
  Currency,
  PaymentMethod,
  TunisianVatRate,
  VatBreakdownItem
} from '../../invoices/invoice-wizard/models/invoice-wizard.models';
import {
  calculateLineFodecAmounts,
  DEFAULT_FODEC_RATE_PERCENT,
  roundTnd
} from '../../invoices/invoice-wizard/services/invoice-wizard-calculation.utils';
import { getEffectiveMaxDiscountPercent } from '@shared/utils/product-pricing.utils';
import { POS_PASSENGER_CLIENT_EMAIL } from '../constants/pos-client.constants';
import { LinkedInvoiceRef } from '@core/services/invoice-reference-resolver.service';
import { buildInsufficientStockMessage } from './pos-stock-guard';
import { normalizePaymentSettlement, type PosPaymentSettlement } from './pos-checkout.mapper';

export interface PosClient {
  id: string;
  name: string;
  email: string;
  phone: string;
  nif: string;
  isWalkIn: boolean;
  totalInvoices?: number;
  defaultPaymentTermDays?: number | null;
  creditLimit?: number | null;
}

export interface PosOrderLine {
  id: string;
  productId: string;
  productCode: string;
  designation: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPriceHT: number;
  vatRate: TunisianVatRate;
  isFodecApplicable: boolean;
  productIsDiscountEnabled?: boolean;
  productMaxDiscountPercent?: number | null;
  fodecAmount: number;
  totalHT: number;
  vatAmount: number;
  totalTTC: number;
  imageUrl?: string | null;
  discountType: 'PERCENT' | 'AMOUNT' | null;
  discountValue: number | null;
  discountAmount: number;
  notes: string;
  /**
   * Vrai lorsque `unitPriceHT` provient d'une grille ou d'un accord client plutot que du
   * catalogue. Sert a le signaler a l'ecran : sans cela le caissier croirait a une erreur.
   */
  isNegotiatedPrice?: boolean;
  /** Vrai lorsque le caissier a saisi un prix unitaire différent du catalogue / grille. */
  priceManuallyEdited?: boolean;
  /**
   * Quantité disponible dans l'entrepôt POS au moment de l'ajout (catalogue).
   * Null si le produit n'est pas géré en stock ou si la quantité n'était pas connue (scan).
   */
  quantityAvailable?: number | null;
}

export interface PosTotals {
  subTotalHT: number;
  totalHT: number;
  totalFodec: number;
  totalVat: number;
  totalTTC: number;
  totalDiscount: number;
  firstPurchaseDiscount: number;
  vatBreakdown: VatBreakdownItem[];
  currency: Currency;
  fodecRatePercent: number;
}

export interface PaymentSplit {
  method: PaymentMethod;
  amount: number;
}

export interface PosState {
  sessionId: string;
  client: PosClient | null;
  lines: PosOrderLine[];
  paymentMethod: PaymentMethod;
  currency: Currency;
  isDirty: boolean;
  isProcessing: boolean;
  lastError: string | null;
  globalDiscountType: 'PERCENT' | 'AMOUNT' | null;
  globalDiscountValue: number | null;
  globalDiscountAmount: number;
  isSplitPayment: boolean;
  paymentSplits: PaymentSplit[];
  orderNotes: string;
  isQuickMode: boolean;
  isCreditNote: boolean;
  linkedInvoice: LinkedInvoiceRef | null;
  printMode: 'pdf' | 'receipt' | 'both';
  isDemoMode: boolean;
  paymentSchedule: PosPaymentSettlement;
  firstPurchaseDiscountPercent: number | null;
  clientOutstanding: ClientOutstanding | null;
  overLimitAcknowledged: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PosStateService {
  private readonly state = signal<PosState>(this.getInitialState());
  private readonly dualScreenService = inject(PosDualScreenService);

  readonly client = computed(() => this.state().client);
  readonly lines = computed(() => this.state().lines);
  readonly paymentMethod = computed(() => this.state().paymentMethod);
  readonly currency = computed(() => this.state().currency);
  readonly isDirty = computed(() => this.state().isDirty);
  readonly isProcessing = computed(() => this.state().isProcessing);
  readonly lastError = computed(() => this.state().lastError);
  readonly sessionId = computed(() => this.state().sessionId);

  readonly lineCount = computed(() => this.state().lines.length);

  readonly totals = computed<PosTotals>(() => {
    const lines = this.state().lines;
    const currency = this.state().currency;
    const globalDiscountType = this.state().globalDiscountType;
    const globalDiscountValue = this.state().globalDiscountValue;
    const firstPurchasePct = this.state().firstPurchaseDiscountPercent;

    const subTotalHT = lines.reduce((sum, l) => sum + l.totalHT, 0);
    const totalFodec = lines.reduce((sum, l) => sum + l.fodecAmount, 0);

    let totalDiscount = 0;
    if (globalDiscountType === 'PERCENT' && globalDiscountValue != null) {
      totalDiscount = subTotalHT * (Math.min(100, Math.max(0, globalDiscountValue)) / 100);
    } else if (globalDiscountType === 'AMOUNT' && globalDiscountValue != null) {
      totalDiscount = Math.min(subTotalHT, Math.max(0, globalDiscountValue));
    }

    const afterGlobalHT = subTotalHT - totalDiscount;
    let firstPurchaseDiscount = 0;
    if (firstPurchasePct != null && firstPurchasePct > 0) {
      firstPurchaseDiscount = afterGlobalHT * (Math.min(100, Math.max(0, firstPurchasePct)) / 100);
    }

    const totalHT = afterGlobalHT - firstPurchaseDiscount;
    const discountRatio = subTotalHT > 0 ? totalHT / subTotalHT : 1;

    const vatGroups = new Map<TunisianVatRate, { base: number; vat: number }>();
    lines.forEach(line => {
      const existing = vatGroups.get(line.vatRate) || { base: 0, vat: 0 };
      existing.base += (line.totalHT + line.fodecAmount) * discountRatio;
      existing.vat += line.vatAmount * discountRatio;
      vatGroups.set(line.vatRate, existing);
    });

    const vatBreakdown: VatBreakdownItem[] = Array.from(vatGroups.entries())
      .map(([rate, amounts]) => ({
        rate,
        rateDisplay: `${rate}%`,
        baseAmount: roundTnd(amounts.base),
        vatAmount: roundTnd(amounts.vat)
      }))
      .sort((a, b) => b.rate - a.rate);

    const totalVatAfterDiscount = vatBreakdown.reduce((sum, v) => sum + v.vatAmount, 0);
    const totalFodecAfterDiscount = roundTnd(totalFodec * discountRatio);
    const totalTTC = roundTnd(totalHT + totalFodecAfterDiscount + totalVatAfterDiscount);

    return {
      subTotalHT,
      totalHT,
      totalFodec: totalFodecAfterDiscount,
      totalVat: totalVatAfterDiscount,
      totalTTC,
      totalDiscount,
      firstPurchaseDiscount,
      vatBreakdown,
      currency,
      fodecRatePercent: DEFAULT_FODEC_RATE_PERCENT
    };
  });

  readonly hasGlobalDiscount = computed(() =>
    this.state().globalDiscountType != null && this.state().globalDiscountValue != null
  );

  readonly globalDiscountType = computed(() => this.state().globalDiscountType);
  readonly globalDiscountValue = computed(() => this.state().globalDiscountValue);

  readonly canValidate = computed(() => {
    if (this.state().isProcessing) return false;
    if (this.state().isCreditNote) {
      return !!this.state().linkedInvoice?.id && this.state().lines.length > 0;
    }
    if (this.state().lines.length === 0) return false;
    if (this.state().paymentSchedule === 'onAccount' && !this.state().client) return false;
    if (this.state().isSplitPayment) return this.isSplitValid();
    return true;
  });

  readonly canSaveDraft = computed(() => {
    if (this.state().isProcessing) return false;
    if (this.state().isCreditNote) {
      return !!this.state().linkedInvoice?.id && this.state().lines.length > 0;
    }
    if (this.state().lines.length === 0) return false;
    if (this.state().isSplitPayment) return this.isSplitValid();
    return true;
  });

  readonly hasValidClientForValidation = computed(() => {
    const client = this.state().client;
    return client !== null;
  });

  private isPassengerClient(client: PosClient | null): boolean {
    if (client === null) return true;
    const email = (client.email ?? '').trim().toLowerCase();
    return email === POS_PASSENGER_CLIENT_EMAIL.trim().toLowerCase();
  }

  readonly totalItemsQuantity = computed(() =>
    this.state().lines.reduce((sum, l) => sum + l.quantity, 0)
  );

  private getInitialState(): PosState {
    return {
      sessionId: this.generateSessionId(),
      client: null,
      lines: [],
      paymentMethod: PaymentMethod.Cash,
      currency: Currency.TND,
      isDirty: false,
      isProcessing: false,
      lastError: null,
      globalDiscountType: null,
      globalDiscountValue: null,
      globalDiscountAmount: 0,
      isSplitPayment: false,
      paymentSplits: [],
      orderNotes: '',
      isQuickMode: false,
      isCreditNote: false,
      linkedInvoice: null,
      printMode: 'pdf',
      isDemoMode: false,
      paymentSchedule: 'immediate',
      firstPurchaseDiscountPercent: null,
      clientOutstanding: null,
      overLimitAcknowledged: false
    };
  }

  readonly remainingAmount = computed(() => {
    const total = this.totals().totalTTC;
    const sum = this.state().paymentSplits.reduce((s, p) => s + p.amount, 0);
    return total - sum;
  });

  readonly isSplitValid = computed(() => Math.abs(this.remainingAmount()) < 0.001);
  readonly isSplitPayment = computed(() => this.state().isSplitPayment);
  readonly paymentSplits = computed(() => this.state().paymentSplits);
  readonly orderNotes = computed(() => this.state().orderNotes);
  readonly isQuickMode = computed(() => this.state().isQuickMode);
  readonly isCreditNote = computed(() => this.state().isCreditNote);
  readonly linkedInvoice = computed(() => this.state().linkedInvoice);
  readonly linkedInvoiceId = computed(() => this.state().linkedInvoice?.id ?? null);
  readonly linkedInvoiceNumber = computed(() => this.state().linkedInvoice?.number ?? null);
  readonly printMode = computed(() => this.state().printMode);
  readonly isDemoMode = computed(() => this.state().isDemoMode);
  readonly paymentSchedule = computed(() => this.state().paymentSchedule);
  readonly firstPurchaseDiscountPercent = computed(() => this.state().firstPurchaseDiscountPercent);
  readonly clientOutstanding = computed(() => this.state().clientOutstanding);
  readonly overLimitAcknowledged = computed(() => this.state().overLimitAcknowledged);
  readonly isFirstPurchaseDiscount = computed(() => {
    const c = this.state().client;
    const pct = this.state().firstPurchaseDiscountPercent;
    return !!(c && !c.isWalkIn && (c.totalInvoices ?? 0) === 0 && pct != null && pct > 0);
  });

  private generateSessionId(): string {
    const now = new Date();
    const seq = Math.floor(Math.random() * 9000000) + 1000000;
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${seq}`;
  }

  addProduct(product: ProductListItem): void {
    const lines = [...this.state().lines];
    const existing = lines.find(l => l.productId === product.id);

    if (existing) {
      existing.quantity += 1;
      if (product.imageUrl != null && existing.imageUrl == null) {
        existing.imageUrl = product.imageUrl;
      }
      if (product.quantityAvailable != null) {
        existing.quantityAvailable = product.quantityAvailable;
      }
      this.recalculateLine(existing);
    } else {
      const newLine: PosOrderLine = {
        id: createClientUuid(),
        productId: product.id,
        productCode: product.code,
        designation: product.name,
        description: product.description,
        quantity: 1,
        unit: product.unit || 'Unite',
        unitPriceHT: product.unitPrice,
        vatRate: this.resolveVatRate(product.vatRate),
        isFodecApplicable: product.isFodecApplicable ?? false,
        productIsDiscountEnabled: product.isDiscountEnabled ?? false,
        productMaxDiscountPercent: product.maxDiscountPercent ?? null,
        fodecAmount: 0,
        totalHT: 0,
        vatAmount: 0,
        totalTTC: 0,
        imageUrl: product.imageUrl ?? null,
        discountType: null,
        discountValue: null,
        discountAmount: 0,
        notes: '',
        quantityAvailable: product.isStockManaged ? (product.quantityAvailable ?? null) : null
      };
      this.recalculateLine(newLine);
      lines.push(newLine);
    }

    this.updateState({ lines, isDirty: true, lastError: null });
  }

  addProductWithQuantity(product: ProductListItem, quantity: number): void {
    if (quantity < 0.001) return;
    const lines = [...this.state().lines];
    const existing = lines.find(l => l.productId === product.id);

    if (existing) {
      existing.quantity += quantity;
      if (product.imageUrl != null && existing.imageUrl == null) {
        existing.imageUrl = product.imageUrl;
      }
      if (product.quantityAvailable != null) {
        existing.quantityAvailable = product.quantityAvailable;
      }
      this.recalculateLine(existing);
    } else {
      const newLine: PosOrderLine = {
        id: createClientUuid(),
        productId: product.id,
        productCode: product.code,
        designation: product.name,
        description: product.description,
        quantity,
        unit: product.unit || 'Unite',
        unitPriceHT: product.unitPrice,
        vatRate: this.resolveVatRate(product.vatRate),
        isFodecApplicable: product.isFodecApplicable ?? false,
        productIsDiscountEnabled: product.isDiscountEnabled ?? false,
        productMaxDiscountPercent: product.maxDiscountPercent ?? null,
        fodecAmount: 0,
        totalHT: 0,
        vatAmount: 0,
        totalTTC: 0,
        imageUrl: product.imageUrl ?? null,
        discountType: null,
        discountValue: null,
        discountAmount: 0,
        notes: '',
        quantityAvailable: product.isStockManaged ? (product.quantityAvailable ?? null) : null
      };
      this.recalculateLine(newLine);
      lines.push(newLine);
    }

    this.updateState({ lines, isDirty: true, lastError: null });
  }

  updateQuantity(lineId: string, quantity: number): boolean {
    if (quantity < 0.001) return false;
    const line = this.state().lines.find(l => l.id === lineId);
    if (!line) return false;

    if (!this.isCreditNote() && line.quantityAvailable != null && quantity > line.quantityAvailable) {
      this.setError(buildInsufficientStockMessage(line.designation, quantity, line.quantityAvailable));
      return false;
    }

    const lines = this.state().lines.map(l => {
      if (l.id === lineId) {
        const updated = { ...l, quantity };
        this.recalculateLine(updated);
        return updated;
      }
      return l;
    });
    this.updateState({ lines, isDirty: true, lastError: null });
    return true;
  }

  incrementQuantity(lineId: string): boolean {
    const line = this.state().lines.find(l => l.id === lineId);
    if (!line) return false;
    return this.updateQuantity(lineId, line.quantity + 1);
  }

  decrementQuantity(lineId: string): void {
    const line = this.state().lines.find(l => l.id === lineId);
    if (line && line.quantity > 0.001) {
      const next = roundTnd(line.quantity - 1);
      this.updateQuantity(lineId, next >= 0.001 ? next : 0.001);
    }
  }

  removeLine(lineId: string): void {
    const lines = this.state().lines.filter(l => l.id !== lineId);
    this.updateState({ lines, isDirty: lines.length > 0 });
  }

  removeLastLine(): void {
    const lines = [...this.state().lines];
    if (lines.length === 0) return;
    lines.pop();
    this.updateState({ lines, isDirty: lines.length > 0 });
  }

  /**
   * Applique les prix resolus par le serveur aux lignes concernees.
   *
   * Appelee apres un rattachement client : la caisse affiche d'abord le prix catalogue pour
   * rester instantanee au scan, puis s'aligne sur le prix que le serveur appliquera. Les
   * produits absents de la reponse gardent leur prix — une resolution partielle ne doit jamais
   * vider un ticket en cours.
   */
  applyResolvedPrices(prices: ReadonlyArray<{ productId: string; unitPriceHT: number; isNegotiated: boolean }>): void {
    if (prices.length === 0) return;

    const byProduct = new Map(prices.map(p => [p.productId, p]));
    let changed = false;

    const lines = this.state().lines.map(line => {
      const resolved = byProduct.get(line.productId);
      if (!resolved) return line;
      if (line.priceManuallyEdited) return line;
      if (line.unitPriceHT === resolved.unitPriceHT && !!line.isNegotiatedPrice === resolved.isNegotiated) {
        return line;
      }

      const updated = {
        ...line,
        unitPriceHT: resolved.unitPriceHT,
        isNegotiatedPrice: resolved.isNegotiated
      };
      this.recalculateLine(updated);
      changed = true;
      return updated;
    });

    if (changed) {
      this.updateState({ lines });
    }
  }

  selectClient(client: ClientListItem): void {
    const posClient: PosClient = {
      id: client.id,
      name: client.name,
      email: client.email ?? '',
      phone: client.phone,
      nif: client.nif,
      isWalkIn: false,
      totalInvoices: client.totalInvoices,
      defaultPaymentTermDays: client.defaultPaymentTermDays ?? null,
      creditLimit: client.creditLimit ?? null
    };
    this.updateState({ client: posClient, isDirty: true, clientOutstanding: null, overLimitAcknowledged: false });
  }

  setWalkInClient(): void {
    this.updateState({
      client: null,
      isDirty: true,
      clientOutstanding: null,
      overLimitAcknowledged: false,
      paymentSchedule: this.state().paymentSchedule === 'onAccount' ? 'immediate' : this.state().paymentSchedule
    });
  }

  setClientOutstanding(outstanding: ClientOutstanding | null): void {
    this.updateState({ clientOutstanding: outstanding, overLimitAcknowledged: false });
  }

  acknowledgeOverLimit(): void {
    this.updateState({ overLimitAcknowledged: true });
  }

  setPaymentMethod(method: PaymentMethod): void {
    this.updateState({ paymentMethod: method });
  }

  setProcessing(processing: boolean): void {
    this.updateState({ isProcessing: processing });
  }

  setError(error: string | null): void {
    this.updateState({ lastError: error });
  }

  setOrderNotes(notes: string): void {
    this.updateState({ orderNotes: notes, isDirty: true });
  }

  toggleQuickMode(): void {
    this.updateState({ isQuickMode: !this.state().isQuickMode });
  }

  enableCreditNoteMode(linkedInvoice: LinkedInvoiceRef): void {
    if (!linkedInvoice?.id?.trim()) {
      return;
    }
    this.updateState({
      isCreditNote: true,
      linkedInvoice,
      isDirty: true,
      lastError: null
    });
  }

  disableCreditNoteMode(): void {
    this.updateState({
      isCreditNote: false,
      linkedInvoice: null,
      lines: [],
      isDirty: true,
      lastError: null,
      globalDiscountType: null,
      globalDiscountValue: null,
      globalDiscountAmount: 0
    });
  }

  setLines(lines: PosOrderLine[]): void {
    const cloned = lines.map(line => {
      const copy = { ...line };
      this.recalculateLine(copy);
      return copy;
    });
    this.updateState({ lines: cloned, isDirty: true, lastError: null });
  }

  setPrintMode(mode: 'pdf' | 'receipt' | 'both'): void {
    this.updateState({ printMode: mode });
  }

  setDemoMode(enabled: boolean): void {
    this.updateState({ isDemoMode: enabled });
  }

  toggleDemoMode(): void {
    this.updateState({ isDemoMode: !this.state().isDemoMode });
  }

  setPaymentSchedule(schedule: PosPaymentSettlement): void {
    this.updateState({ paymentSchedule: schedule });
  }

  setFirstPurchaseDiscountPercent(percent: number | null): void {
    this.updateState({ firstPurchaseDiscountPercent: percent });
  }

  applyFirstPurchaseDiscountIfEligible(percent: number): void {
    const c = this.state().client;
    if (!c || c.isWalkIn || (c.totalInvoices ?? 0) > 0) return;
    this.updateState({ firstPurchaseDiscountPercent: percent, isDirty: true });
  }

  setLineNotes(lineId: string, notes: string): void {
    const lines = this.state().lines.map(line => {
      if (line.id === lineId) return { ...line, notes };
      return line;
    });
    this.updateState({ lines, isDirty: true });
  }

  setLineDiscount(lineId: string, type: 'PERCENT' | 'AMOUNT', value: number): void {
    const lines = this.state().lines.map(line => {
      if (line.id === lineId) {
        const updated = { ...line, discountType: type, discountValue: value };
        this.recalculateLine(updated);
        return updated;
      }
      return line;
    });
    this.updateState({ lines, isDirty: true });
  }

  removeLineDiscount(lineId: string): void {
    const lines = this.state().lines.map(line => {
      if (line.id === lineId) {
        const updated = { ...line, discountType: null, discountValue: null, discountAmount: 0 };
        this.recalculateLine(updated);
        return updated;
      }
      return line;
    });
    this.updateState({ lines, isDirty: true });
  }

  setGlobalDiscount(type: 'PERCENT' | 'AMOUNT', value: number): void {
    this.updateState({
      globalDiscountType: type,
      globalDiscountValue: value,
      globalDiscountAmount: 0,
      isDirty: true
    });
  }

  removeGlobalDiscount(): void {
    this.updateState({
      globalDiscountType: null,
      globalDiscountValue: null,
      globalDiscountAmount: 0,
      isDirty: true
    });
  }

  enableSplitPayment(): void {
    this.updateState({ isSplitPayment: true, paymentSplits: [] });
  }

  disableSplitPayment(): void {
    this.updateState({ isSplitPayment: false, paymentSplits: [] });
  }

  addPaymentSplit(method: PaymentMethod, amount: number): void {
    this.updateState({
      paymentSplits: [...this.state().paymentSplits, { method, amount }],
      isDirty: true
    });
  }

  removePaymentSplit(index: number): void {
    const splits = [...this.state().paymentSplits];
    splits.splice(index, 1);
    this.updateState({ paymentSplits: splits, isDirty: true });
  }

  updatePaymentSplit(index: number, amount: number): void {
    const splits = [...this.state().paymentSplits];
    splits[index] = { ...splits[index], amount };
    this.updateState({ paymentSplits: splits, isDirty: true });
  }

  resetOrder(): void {
    this.state.set(this.getInitialState());
    this.broadcastToDisplay();
  }

  broadcastDisplayState(): void {
    this.broadcastToDisplay();
  }

  private broadcastToDisplay(): void {
    if (!this.dualScreenService.isOpen()) return;
    const s = this.state();
    const totals = this.totals();
    this.dualScreenService.broadcast({
      lines: s.lines.map(l => ({
        designation: l.designation,
        quantity: l.quantity,
        totalTTC: l.totalTTC
      })),
      totalTTC: totals.totalTTC,
      clientName: s.client?.name ?? 'Client passager'
    });
  }

  getSnapshot(): PosState {
    const s = this.state();
    return {
      ...s,
      client: s.client ? { ...s.client } : null,
      lines: s.lines.map(l => ({ ...l })),
      sessionId: s.sessionId,
      isDirty: false,
      isProcessing: false,
      lastError: null
    };
  }

  restoreSnapshot(state: PosState): void {
    const lines = state.lines.map(l => ({ ...l, notes: l.notes ?? '' }));
    this.state.set({
      ...this.getInitialState(),
      ...state,
      lines,
      orderNotes: state.orderNotes ?? '',
      sessionId: this.generateSessionId(),
      isDirty: true,
      isProcessing: false,
      lastError: null,
      isDemoMode: state.isDemoMode ?? false,
      paymentSchedule: normalizePaymentSettlement(state.paymentSchedule),
      firstPurchaseDiscountPercent: state.firstPurchaseDiscountPercent ?? null,
      clientOutstanding: state.clientOutstanding ?? null,
      overLimitAcknowledged: false
    });
  }

  formatAmount(amount: number): string {
    const currency = this.state().currency;
    const decimals = currency === Currency.TND ? 3 : 2;
    return amount.toLocaleString('fr-TN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  formatAmountWithCurrency(amount: number): string {
    return `${this.formatAmount(amount)} ${this.state().currency}`;
  }

  private recalculateLine(line: PosOrderLine): void {
    const rawHT = line.quantity * line.unitPriceHT;
    let discount = 0;
    if (line.discountType === 'PERCENT' && line.discountValue != null) {
      const maxPercent = getEffectiveMaxDiscountPercent(
        line.productIsDiscountEnabled,
        line.productMaxDiscountPercent
      );
      const cappedValue = Math.min(maxPercent, Math.max(0, line.discountValue));
      discount = rawHT * (cappedValue / 100);
    } else if (line.discountType === 'AMOUNT' && line.discountValue != null) {
      discount = Math.min(rawHT, Math.max(0, line.discountValue));
    }
    line.discountAmount = roundTnd(discount);
    line.totalHT = roundTnd(rawHT - discount);
    const amounts = calculateLineFodecAmounts(
      line.totalHT,
      line.vatRate,
      line.isFodecApplicable,
      DEFAULT_FODEC_RATE_PERCENT
    );
    line.fodecAmount = amounts.fodecAmount;
    line.vatAmount = amounts.vatAmount;
    line.totalTTC = amounts.totalTTC;
  }

  private resolveVatRate(percent: number): TunisianVatRate {
    if (percent === 0) return TunisianVatRate.Exempt;
    if (percent === 7) return TunisianVatRate.Reduced;
    if (percent === 13) return TunisianVatRate.Intermediate;
    if (percent === 19) return TunisianVatRate.Standard;
    if (percent <= 3) return TunisianVatRate.Exempt;
    if (percent <= 10) return TunisianVatRate.Reduced;
    if (percent <= 16) return TunisianVatRate.Intermediate;
    return TunisianVatRate.Standard;
  }

  private updateState(partial: Partial<PosState>): void {
    this.state.update(current => ({ ...current, ...partial }));
    this.broadcastToDisplay();
  }
}
