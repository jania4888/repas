import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, shareReplay, catchError, throwError, map, from, of, switchMap } from 'rxjs';
import { environment } from '@environments/environment';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { ApiResponse, PagedResult } from './client.service';

export enum CashOperationStatus {
  Terminee = 0,
  Annulee = 1
}

export enum CashOperationType {
  Debit = 0,
  Credit = 1
}

export enum CashOperationOrigin {
  Manual = 0,
  InvoicePayment = 1,
  SupplierPayment = 2
}

export enum CashExpenseCategory {
  RentPayment = 0,
  SuppliesAndConsumables = 1,
  MaintenanceAndRepair = 2,
  NetSalaries = 3,
  TransportCosts = 4,
  TravelAndTrips = 5,
  VehicleRepairMaintenance = 6,
  VehicleRentalAndTransport = 7,
  UtilitiesAndEnergy = 8,
  ProfessionalFees = 9,
  Insurance = 10,
  TaxesAndDuties = 11,
  MarketingAdvertising = 12,
  ITAndSoftware = 13,
  BankDeposit = 14,
  SupplierInvoicePayment = 15,
  Other = 99
}

export enum CashRevenueCategory {
  CashSalesReceipt = 0,
  ClientReceivablesReceipt = 1,
  PartnerContributionsReceipt = 2,
  BankCreditReceipt = 3,
  Other = 99
}

export interface CashExpenseCategoryOption {
  label: string;
  value: CashExpenseCategory;
  icon: string;
}

export interface CashExpenseCategoryGroup {
  label: string;
  items: CashExpenseCategoryOption[];
}

export interface CashRevenueCategoryOption {
  label: string;
  value: CashRevenueCategory;
  icon: string;
}

export interface CashRevenueCategoryGroup {
  label: string;
  items: CashRevenueCategoryOption[];
}

export const CASH_EXPENSE_CATEGORY_GROUPS: CashExpenseCategoryGroup[] = [
  {
    label: $localize`:@@core.cash-desk.ts.locaux.immobilier.3ca8e940:Locaux & immobilier`,
    items: [
      { label: $localize`:@@core.cash-desk.ts.paiement.des.loyers.ebf924d2:Paiement des loyers`, value: CashExpenseCategory.RentPayment, icon: 'pi pi-building' },
      {
        label: $localize`:@@core.cash-desk.ts.charges.locatives.et.energie.eau.electri.82d0d349:Charges locatives et énergie (eau, électricité, gaz)`,
        value: CashExpenseCategory.UtilitiesAndEnergy,
        icon: 'pi pi-bolt'
      }
    ]
  },
  {
    label: $localize`:@@core.cash-desk.ts.achats.exploitation.fa5f8b4e:Achats & exploitation`,
    items: [
      {
        label: $localize`:@@core.cash-desk.ts.reglement.des.factures.d.achats.de.fourn.7770e534:Règlement des factures d'achats de fournitures et consommables`,
        value: CashExpenseCategory.SuppliesAndConsumables,
        icon: 'pi pi-shopping-cart'
      },
      {
        label: $localize`:@@core.cash-desk.ts.reglement.facture.fournisseur.8a8eebc2:Règlement facture fournisseur`,
        value: CashExpenseCategory.SupplierInvoicePayment,
        icon: 'pi pi-file-import'
      },
      {
        label: $localize`:@@core.cash-desk.ts.paiement.des.factures.d.entretien.et.rep.50fa4e38:Paiement des factures d'entretien et réparation`,
        value: CashExpenseCategory.MaintenanceAndRepair,
        icon: 'pi pi-wrench'
      }
    ]
  },
  {
    label: $localize`:@@core.cash-desk.ts.ressources.humaines.5f3cf89d:Ressources humaines`,
    items: [{ label: $localize`:@@core.cash-desk.ts.paiement.des.salaires.nets.3f30baa6:Paiement des salaires nets`, value: CashExpenseCategory.NetSalaries, icon: 'pi pi-users' }]
  },
  {
    label: $localize`:@@core.cash-desk.ts.transport.vehicules.51cf21ea:Transport & véhicules`,
    items: [
      { label: $localize`:@@core.cash-desk.ts.paiement.des.frais.de.transport.43817daf:Paiement des frais de transport`, value: CashExpenseCategory.TransportCosts, icon: 'pi pi-car' },
      { label: $localize`:@@core.cash-desk.ts.voyages.et.deplacements.2e9ba9fc:Voyages et déplacements`, value: CashExpenseCategory.TravelAndTrips, icon: 'pi pi-map' },
      {
        label: $localize`:@@core.cash-desk.ts.vehicule.reparation.entretien.18959cd1:Véhicule (réparation, entretien)`,
        value: CashExpenseCategory.VehicleRepairMaintenance,
        icon: 'pi pi-cog'
      },
      {
        label: $localize`:@@core.cash-desk.ts.location.vehicules.et.transport.210b15fe:Location véhicules et transport`,
        value: CashExpenseCategory.VehicleRentalAndTransport,
        icon: 'pi pi-truck'
      }
    ]
  },
  {
    label: $localize`:@@core.cash-desk.ts.fiscalite.services.58c61dac:Fiscalité & services`,
    items: [
      { label: $localize`:@@core.cash-desk.ts.honoraires.et.prestations.externes.2863df82:Honoraires et prestations externes`, value: CashExpenseCategory.ProfessionalFees, icon: 'pi pi-briefcase' },
      { label: $localize`:@@core.cash-desk.ts.assurances.7011b97e:Assurances`, value: CashExpenseCategory.Insurance, icon: 'pi pi-shield' },
      { label: $localize`:@@core.cash-desk.ts.impots.taxes.et.redevances.b0100f28:Impôts, taxes et redevances`, value: CashExpenseCategory.TaxesAndDuties, icon: 'pi pi-percentage' }
    ]
  },
  {
    label: $localize`:@@core.cash-desk.ts.commercial.digital.79ecb7a5:Commercial & digital`,
    items: [
      { label: $localize`:@@core.cash-desk.ts.marketing.et.publicite.6249d9f3:Marketing et publicité`, value: CashExpenseCategory.MarketingAdvertising, icon: 'pi pi-megaphone' },
      { label: $localize`:@@core.cash-desk.ts.informatique.et.logiciels.0d40e9e7:Informatique et logiciels`, value: CashExpenseCategory.ITAndSoftware, icon: 'pi pi-desktop' }
    ]
  },
  {
    label: $localize`:@@core.cash-desk.ts.tresorerie.e0e75da7:Trésorerie`,
    items: [{ label: $localize`:@@core.cash-desk.ts.remise.en.banque.f42e5169:Remise en banque`, value: CashExpenseCategory.BankDeposit, icon: 'pi pi-building' }]
  },
  {
    label: $localize`:@@core.cash-desk.ts.autres.2f0dd042:Autres`,
    items: [{ label: $localize`:@@core.cash-desk.ts.autre.43dacf9e:Autre`, value: CashExpenseCategory.Other, icon: 'pi pi-ellipsis-h' }]
  }
];

export const CASH_REVENUE_CATEGORY_GROUPS: CashRevenueCategoryGroup[] = [
  {
    label: $localize`:@@core.cash-desk.ts.encaissements.598f53c9:Encaissements`,
    items: [
      { label: $localize`:@@core.cash-desk.ts.encaissement.ventes.au.comptant.9a9c0123:Encaissement ventes au comptant`, value: CashRevenueCategory.CashSalesReceipt, icon: 'pi pi-shopping-bag' },
      { label: $localize`:@@core.cash-desk.ts.encaissement.creances.clients.cb5ad0fc:Encaissement créances clients`, value: CashRevenueCategory.ClientReceivablesReceipt, icon: 'pi pi-users' },
      { label: $localize`:@@core.cash-desk.ts.encaissements.recus.des.associes.c817c5a5:Encaissements reçus des associés`, value: CashRevenueCategory.PartnerContributionsReceipt, icon: 'pi pi-sitemap' },
      { label: $localize`:@@core.cash-desk.ts.encaissement.credit.bancaire.30d2a61d:Encaissement crédit bancaire`, value: CashRevenueCategory.BankCreditReceipt, icon: 'pi pi-building' },
      { label: $localize`:@@core.cash-desk.ts.autres.encaissements.a0755a9d:Autres encaissements`, value: CashRevenueCategory.Other, icon: 'pi pi-ellipsis-h' }
    ]
  }
];

export function getCashExpenseCategoryLabel(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  for (const g of CASH_EXPENSE_CATEGORY_GROUPS) {
    const item = g.items.find(i => i.value === value);
    if (item) return item.label;
  }
  return undefined;
}

export function getCashRevenueCategoryLabel(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  for (const g of CASH_REVENUE_CATEGORY_GROUPS) {
    const item = g.items.find(i => i.value === value);
    if (item) return item.label;
  }
  return undefined;
}

/** Libellés déjà traduits (mêmes identifiants que la saisie caisse). */
export function getCashPaymentMethodLabel(value: number | null | undefined): string {
  switch (value) {
    case 0:
      return $localize`:@@pay.cash:Espèces`;
    case 1:
      return $localize`:@@pay.transfer:Virement bancaire`;
    case 2:
      return $localize`:@@pay.check:Chèque`;
    case 3:
      return $localize`:@@pay.card:Carte bancaire`;
    case 4:
      return $localize`:@@pay.mobile:Paiement mobile`;
    case 5:
      return $localize`:@@shared.record-payment-dialog.ts.traite.effet.de.commerce.b1384467:Traite (effet de commerce)`;
    case 99:
      return $localize`:@@pay.other:Autre`;
    default:
      return '';
  }
}

/** Matches backend PaymentMethod (JsonStringEnumConverter camelCase). */
const PAYMENT_METHOD_FROM_API: Record<string, number> = {
  cash: 0,
  bankTransfer: 1,
  check: 2,
  card: 3,
  mobilePayment: 4,
  other: 99,
  Cash: 0,
  BankTransfer: 1,
  Check: 2,
  Card: 3,
  MobilePayment: 4,
  Other: 99
};

const CASH_OP_TYPE_FROM_API: Record<string, number> = {
  debit: CashOperationType.Debit,
  credit: CashOperationType.Credit,
  Debit: CashOperationType.Debit,
  Credit: CashOperationType.Credit
};

const CASH_OP_STATUS_FROM_API: Record<string, number> = {
  terminee: CashOperationStatus.Terminee,
  annulee: CashOperationStatus.Annulee,
  Terminee: CashOperationStatus.Terminee,
  Annulee: CashOperationStatus.Annulee
};

const CASH_OP_ORIGIN_FROM_API: Record<string, number> = {
  manual: CashOperationOrigin.Manual,
  invoicePayment: CashOperationOrigin.InvoicePayment,
  supplierPayment: CashOperationOrigin.SupplierPayment,
  Manual: CashOperationOrigin.Manual,
  InvoicePayment: CashOperationOrigin.InvoicePayment,
  SupplierPayment: CashOperationOrigin.SupplierPayment
};

function coerceEnumFromApi(
  value: number | string,
  namedMap: Record<string, number>
): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return Number.NaN;
  const s = value.trim();
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  const direct = namedMap[s];
  if (direct !== undefined) return direct;
  const camel = s.length ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  return namedMap[camel] ?? Number.NaN;
}

/**
 * API returns PaymentMethod as string enums; UI compares numeric codes (e.g. cash desk, payloads).
 */
export function normalizePaymentMethod(value: number | string): number {
  return coerceEnumFromApi(value, PAYMENT_METHOD_FROM_API);
}

export function normalizeCashOperationType(value: number | string): number {
  return coerceEnumFromApi(value, CASH_OP_TYPE_FROM_API);
}

export function normalizeCashOperationStatus(value: number | string): number {
  return coerceEnumFromApi(value, CASH_OP_STATUS_FROM_API);
}

export function normalizeCashOperationOrigin(value: number | string): number {
  return coerceEnumFromApi(value, CASH_OP_ORIGIN_FROM_API);
}

export interface CashOperationListItem {
  id: string;
  operationType: number;
  operationTypeDisplay: string;
  operationDate: string;
  method: number;
  methodDisplay: string;
  label: string;
  category: number | null;
  categoryDisplay: string | null;
  revenueCategory: number | null;
  revenueCategoryDisplay: string | null;
  document: string;
  amount: number;
  currency: string;
  reference: string | null;
  notes: string | null;
  status: CashOperationStatus;
  origin: CashOperationOrigin;
  sourceType: string | null;
  sourceId: string | null;
  sourceInvoiceId: string | null;
  sourceInvoiceNumber: string | null;
  sourceSupplierInvoiceId: string | null;
  sourceSupplierInvoiceNumber: string | null;
  vatRatePercent?: number | null;
  htAmount?: number | null;
  vatAmount?: number | null;
}

export interface TreasuryJournalGroup {
  operationType: number;
  category: number | null;
  count: number;
  total: number;
}

export interface TreasuryJournalResult {
  from: string;
  to: string;
  currency: string;
  totalCredits: number;
  totalDebits: number;
  balance: number;
  operationCount: number;
  groups: TreasuryJournalGroup[];
  lines: PagedResult<CashOperationListItem>;
}

function normalizeNamedEnum(value: number | string | null | undefined, enumObj: object): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const named = Object.entries(enumObj).find(([key, entry]) => key === value && typeof entry === 'number');
  return named ? (named[1] as number) : null;
}

function normalizeJournalCategory(
  operationType: number | string,
  category: number | string | null | undefined
): number | null {
  const type = normalizeCashOperationType(operationType);
  const vocabulary = type === CashOperationType.Credit ? CashRevenueCategory : CashExpenseCategory;
  return normalizeNamedEnum(category, vocabulary);
}

/** Taux de TVA proposés pour les encaissements « ventes au comptant » (cf. VatRate backend : Exempt=0, Reduced=7, Intermediate=13, Standard=19). */
export interface VatRateOption {
  label: string;
  value: number | null;
}

export const VAT_RATE_OPTIONS: VatRateOption[] = [
  { label: $localize`:@@core.cash-desk.ts.non.renseignee.d6a3c5fe:Non renseignée`, value: null },
  { label: $localize`:@@core.cash-desk.ts.0.exonere.077b7639:0 % Exonéré`, value: 0 },
  { label: '7 %', value: 7 },
  { label: '13 %', value: 13 },
  { label: '19 %', value: 19 }
];

export interface CashDeskFeatureFlags {
  vatEnabled: boolean;
}

export interface CashDeskBalanceRow {
  method: number;
  methodDisplay: string;
  amount: number;
  credits: number;
  debits: number;
}

export interface CashDeskBalances {
  currency: string;
  primary: CashDeskBalanceRow[];
  secondary: CashDeskBalanceRow[];
  primaryTotal: number;
  secondaryTotal: number;
  primaryCreditsTotal: number;
  primaryDebitsTotal: number;
  secondaryCreditsTotal: number;
  secondaryDebitsTotal: number;
}

function normalizeBalanceRow(row: CashDeskBalanceRow): CashDeskBalanceRow {
  return {
    ...row,
    method: normalizePaymentMethod(row.method as number | string)
  };
}

function normalizeCashDeskBalancesData(data: CashDeskBalances): CashDeskBalances {
  return {
    ...data,
    primary: data.primary.map(normalizeBalanceRow),
    secondary: data.secondary.map(normalizeBalanceRow)
  };
}

function normalizeCashOperationListItem(op: CashOperationListItem): CashOperationListItem {
  return {
    ...op,
    method: normalizePaymentMethod(op.method as number | string),
    operationType: normalizeCashOperationType(op.operationType as number | string),
    status: normalizeCashOperationStatus(op.status as number | string),
    origin: normalizeCashOperationOrigin(op.origin as number | string),
    sourceSupplierInvoiceId: op.sourceSupplierInvoiceId ?? null,
    sourceSupplierInvoiceNumber: op.sourceSupplierInvoiceNumber ?? null
  };
}

export interface CreateCashOperationPayload {
  operationType: number;
  operationDate: string;
  amount: number;
  method: number;
  label: string;
  category?: number | null;
  revenueCategory?: number | null;
  reference?: string | null;
  notes?: string | null;
  vatRate?: number | null;
}

@Injectable({
  providedIn: 'root'
})
export class CashDeskService {
  private readonly API_URL = `${environment.apiUrl}/cash-desk`;
  private readonly http = inject(HttpClient);

  private balancesCache = new Map<string, Observable<ApiResponse<CashDeskBalances>>>();
  private operationsCache = new Map<string, Observable<ApiResponse<PagedResult<CashOperationListItem>>>>();

  getBalances(year: number, month: number): Observable<ApiResponse<CashDeskBalances>> {
    const cacheKey = `${year}-${month}`;
    const cached = this.balancesCache.get(cacheKey);
    if (cached) return cached;

    const request$ = this.http
      .get<ApiResponse<CashDeskBalances>>(`${this.API_URL}/balances`, {
        params: new HttpParams().set('year', year).set('month', month)
      })
      .pipe(
        map(res =>
          res.success && res.data ? { ...res, data: normalizeCashDeskBalancesData(res.data) } : res
        ),
        shareReplay(1),
        catchError(err => {
          this.balancesCache.delete(cacheKey);
          return throwError(() => err);
        })
      );

    this.balancesCache.set(cacheKey, request$);
    return request$;
  }

  getOperations(
    year: number,
    month: number,
    page: number,
    pageSize: number
  ): Observable<ApiResponse<PagedResult<CashOperationListItem>>> {
    const cacheKey = `${year}-${month}-${page}-${pageSize}`;
    const cached = this.operationsCache.get(cacheKey);
    if (cached) return cached;

    const params = new HttpParams()
      .set('year', year)
      .set('month', month)
      .set('page', page)
      .set('pageSize', pageSize);

    const request$ = this.http
      .get<ApiResponse<PagedResult<CashOperationListItem>>>(`${this.API_URL}/operations`, { params })
      .pipe(
        map(res =>
          res.success && res.data
            ? {
                ...res,
                data: {
                  ...res.data,
                  items: res.data.items.map(normalizeCashOperationListItem)
                }
              }
            : res
        ),
        shareReplay(1),
        catchError(err => {
          this.operationsCache.delete(cacheKey);
          return throwError(() => err);
        })
      );

    this.operationsCache.set(cacheKey, request$);
    return request$;
  }

  createOperation(payload: CreateCashOperationPayload): Observable<ApiResponse<CashOperationListItem>> {
    // 403 (payments:create) is handled locally by the dialog (French inline message) — suppress the
    // duplicate global "ACCÈS REFUSÉ" modal via SKIP_ERROR_TOAST.
    return this.http.post<ApiResponse<CashOperationListItem>>(`${this.API_URL}/operations`, payload, {
      context: createHttpContextSkipGlobalErrorUi()
    });
  }

  getFeatureFlags(): Observable<ApiResponse<CashDeskFeatureFlags>> {
    return this.http.get<ApiResponse<CashDeskFeatureFlags>>(`${this.API_URL}/feature-flags`);
  }

  cancelOperation(operationId: string, reason: string): Observable<ApiResponse<object>> {
    // 403 (payments:update) is handled locally by the cancel dialog — suppress the duplicate global modal.
    return this.http.post<ApiResponse<object>>(
      `${this.API_URL}/operations/${operationId}/cancel`,
      { cancellationReason: reason },
      { context: createHttpContextSkipGlobalErrorUi() }
    );
  }

  invalidateCachesForPeriod(year: number, month: number): void {
    const balancesKey = `${year}-${month}`;
    this.balancesCache.delete(balancesKey);

    const prefix = `${year}-${month}-`;
    for (const key of Array.from(this.operationsCache.keys())) {
      if (key.startsWith(prefix)) this.operationsCache.delete(key);
    }
  }

  getTreasuryJournal(params: {
    from: string;
    to: string;
    method: number | null;
    page: number;
    pageSize: number;
  }): Observable<ApiResponse<TreasuryJournalResult>> {
    let httpParams = new HttpParams()
      .set('from', params.from)
      .set('to', params.to)
      .set('page', String(params.page))
      .set('pageSize', String(params.pageSize));
    if (params.method !== null && params.method !== undefined) {
      httpParams = httpParams.set('method', String(params.method));
    }

    return this.http.get<ApiResponse<TreasuryJournalResult>>(`${this.API_URL}/journal`, { params: httpParams }).pipe(
      map(res => {
        if (!res.success || !res.data) return res;
        const lines = res.data.lines;
        return {
          ...res,
          data: {
            ...res.data,
            groups: (res.data.groups ?? []).map(group => ({
              ...group,
              operationType: normalizeCashOperationType(group.operationType as number | string),
              category: normalizeJournalCategory(group.operationType, group.category)
            })),
            lines: {
              ...lines,
              items: (lines?.items ?? []).map(item => {
                const normalized = normalizeCashOperationListItem(item);
                return {
                  ...normalized,
                  category: normalizeNamedEnum(normalized.category as number | string | null, CashExpenseCategory),
                  revenueCategory: normalizeNamedEnum(
                    normalized.revenueCategory as number | string | null,
                    CashRevenueCategory
                  )
                };
              })
            }
          }
        };
      })
    );
  }

  downloadTreasuryJournalPdf(params: { from: string; to: string; method: number | null }): Observable<Blob> {
    let httpParams = new HttpParams().set('from', params.from).set('to', params.to);
    if (params.method !== null && params.method !== undefined) {
      httpParams = httpParams.set('method', String(params.method));
    }
    const fallback = $localize`:@@payments.cash-journal.pdf-error:Impossible de générer le PDF.`;
    return this.http
      .get(`${this.API_URL}/journal/pdf`, { params: httpParams, responseType: 'blob', observe: 'response' })
      .pipe(
        switchMap(response => of(response.body ?? new Blob())),
        catchError((err: HttpErrorResponse) => {
          const blob = err.error;
          if (!(blob instanceof Blob)) return throwError(() => new Error(fallback));
          return from(blob.text()).pipe(
            switchMap(text => {
              let message = fallback;
              try {
                const parsed = JSON.parse(text) as { message?: string; errors?: string[] };
                message = parsed.errors?.[0] ?? parsed.message ?? fallback;
              } catch {
                /* réponse non JSON */
              }
              return throwError(() => new Error(message));
            })
          );
        })
      );
  }

  /**
   * Clears cached HTTP streams for cash desk data affected by a movement on operationDateIso (YYYY-MM-DD).
   * Balance panels for months m..12 in the same year share a YTD window that includes this date — all those balance keys are dropped.
   * Operation rows are listed by operation month only — keys for that month are dropped.
   */
  invalidateCachesAfterCashLedgerMutation(operationDateIso: string): void {
    const trimmed = operationDateIso?.trim();
    if (!trimmed) return;

    const parts = trimmed.split('-');
    if (parts.length < 2) return;

    const year = Number(parts[0]);
    const month = Number(parts[1]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return;

    for (let m = month; m <= 12; m++) {
      this.balancesCache.delete(`${year}-${m}`);
    }

    const opPrefix = `${year}-${month}-`;
    for (const key of Array.from(this.operationsCache.keys())) {
      if (key.startsWith(opPrefix)) this.operationsCache.delete(key);
    }
  }
}
