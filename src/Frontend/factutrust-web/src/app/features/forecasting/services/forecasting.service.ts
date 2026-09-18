import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { ApiResponse } from '@core/services/auth.service';
import { formatLocalDate } from '@core/utils/date.util';
import {
  AbcClass,
  AbcXyzMatrix,
  CreatePurchaseOrdersResult,
  ForecastHorizon,
  ForecastScopeType,
  PreparePromotionDraftResult,
  ProductDemandForecast,
  PromotionRecommendation,
  PromotionSimulationResult,
  RecomputeAudit,
  RecomputeResult,
  ReplenishmentDecisionAudit,
  ReplenishmentKpi,
  ReplenishmentRecommendation,
  ReplenishmentStatus,
  ReplenishmentFilters,
  SalesForecast,
  SeasonalImpact,
  XyzClass
} from '../models/forecasting.models';

interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

/**
 * Single Angular gateway to the AI Forecasting REST endpoints.
 * Mirrors ForecastingController. All numeric outputs come from the deterministic
 * statistical engine on the server — never invented client-side.
 */
@Injectable({ providedIn: 'root' })
export class ForecastingService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/forecasting`;

  /** Emitted after a successful hub-level « Recalculer tout » so open child tabs reload their data. */
  private readonly recomputeCompletedSubject = new Subject<void>();
  readonly recomputeCompleted$ = this.recomputeCompletedSubject.asObservable();

  notifyRecomputeCompleted(): void {
    this.recomputeCompletedSubject.next();
  }

  // ────────────────────── Revenue / demand ──────────────────────────────

  getRevenueForecast(opts: {
    scope?: ForecastScopeType;
    scopeId?: string | null;
    horizon?: ForecastHorizon;
    from?: string;
    to?: string;
  } = {}): Observable<SalesForecast> {
    let p = new HttpParams();
    if (opts.scope) p = p.set('scope', this.capitalise(opts.scope));
    if (opts.scopeId) p = p.set('scopeId', opts.scopeId);
    if (opts.horizon) p = p.set('horizon', this.capitalise(opts.horizon));
    if (opts.from) p = p.set('from', opts.from);
    if (opts.to) p = p.set('to', opts.to);
    return this.http
      .get<ApiResponse<SalesForecast>>(`${this.base}/revenue`, { params: p })
      .pipe(map(r => r.data!));
  }

  getProductDemandForecast(productId: string, horizon: ForecastHorizon = 'month'): Observable<ProductDemandForecast> {
    const p = new HttpParams().set('horizon', this.capitalise(horizon));
    return this.http
      .get<ApiResponse<ProductDemandForecast>>(`${this.base}/product-demand/${productId}`, { params: p })
      .pipe(map(r => r.data!));
  }

  // ────────────────────── Replenishment ─────────────────────────────────
  // V1 methods removed in the 2026-05-13 cutover. The V2 surface below is the only one.

  getReplenishment(filters: ReplenishmentFilters = {}): Observable<PagedResult<ReplenishmentRecommendation>> {
    let p = new HttpParams();
    if (filters.warehouseId) p = p.set('warehouseId', filters.warehouseId);
    if (filters.supplierId) p = p.set('supplierId', filters.supplierId);
    if (filters.status) p = p.set('status', this.capitalise(filters.status));
    if (filters.search) p = p.set('search', filters.search);
    if (filters.urgencyLevel) p = p.set('urgencyLevel', filters.urgencyLevel);
    if (filters.fromGeneratedAt) p = p.set('fromGeneratedAt', filters.fromGeneratedAt);
    if (filters.toGeneratedAt) p = p.set('toGeneratedAt', filters.toGeneratedAt);
    if (filters.orderBy) p = p.set('orderBy', filters.orderBy);
    if (filters.orderDesc !== undefined) p = p.set('orderDesc', String(filters.orderDesc));
    p = p.set('page', String(filters.page ?? 1));
    p = p.set('pageSize', String(filters.pageSize ?? 50));
    return this.http
      .get<ApiResponse<PagedResult<ReplenishmentRecommendation>>>(`${this.base}/replenishment`, { params: p })
      .pipe(map(r => this.normalizePaged(r.data!, x => this.normalizeRecStatus(x))));
  }

  approveReplenishment(id: string): Observable<ReplenishmentRecommendation> {
    return this.http
      .post<ApiResponse<ReplenishmentRecommendation>>(`${this.base}/replenishment/${id}/approve`, {})
      .pipe(map(r => this.normalizeRecStatus(r.data!)));
  }

  dismissReplenishment(id: string, reason: string): Observable<ReplenishmentRecommendation> {
    // Phase 4 review P4-M1: short-circuit empty reasons client-side to avoid a useless round trip.
    // The backend still validates and returns 400 — this is a defence-in-depth + a faster UX.
    const trimmed = reason?.trim();
    if (!trimmed) {
      return throwError(() => ({
        error: { message: 'La raison du rejet est obligatoire.', code: 'ReasonRequired' }
      }));
    }
    return this.http
      .post<ApiResponse<ReplenishmentRecommendation>>(`${this.base}/replenishment/${id}/dismiss`, { reason: trimmed })
      .pipe(map(r => this.normalizeRecStatus(r.data!)));
  }

  overrideReplenishment(
    id: string,
    payload: { manualQty: number | null; manualSupplierId: string | null }
  ): Observable<ReplenishmentRecommendation> {
    return this.http
      .post<ApiResponse<ReplenishmentRecommendation>>(`${this.base}/replenishment/${id}/override`, payload)
      .pipe(map(r => this.normalizeRecStatus(r.data!)));
  }

  undoReplenishment(id: string): Observable<ReplenishmentRecommendation> {
    return this.http
      .post<ApiResponse<ReplenishmentRecommendation>>(`${this.base}/replenishment/${id}/undo`, {})
      .pipe(map(r => this.normalizeRecStatus(r.data!)));
  }

  attachNotesReplenishment(id: string, notes: string | null): Observable<ReplenishmentRecommendation> {
    return this.http
      .post<ApiResponse<ReplenishmentRecommendation>>(`${this.base}/replenishment/${id}/notes`, { notes })
      .pipe(map(r => this.normalizeRecStatus(r.data!)));
  }

  createPurchaseOrdersFromReplenishment(
    recommendationIds: string[],
    linePrices: { recommendationId: string; unitPrice: number }[]
  ): Observable<CreatePurchaseOrdersResult> {
    return this.http
      .post<ApiResponse<CreatePurchaseOrdersResult>>(
        `${this.base}/replenishment/create-purchase-orders`,
        { recommendationIds, linePrices }
      )
      .pipe(map(r => r.data!));
  }

  generateReplenishment(warehouseId?: string | null, productId?: string | null): Observable<number> {
    let p = new HttpParams();
    if (warehouseId) p = p.set('warehouseId', warehouseId);
    if (productId) p = p.set('productId', productId);
    return this.http
      .post<ApiResponse<number>>(`${this.base}/replenishment/generate`, {}, { params: p })
      .pipe(map(r => r.data ?? 0));
  }

  getReplenishmentHistory(id: string): Observable<ReplenishmentDecisionAudit[]> {
    return this.http
      .get<ApiResponse<ReplenishmentDecisionAudit[]>>(`${this.base}/replenishment/${id}/history`)
      .pipe(map(r => (r.data ?? []).map(row => this.normalizeAuditStatus(row))));
  }

  getReplenishmentKpi(warehouseId?: string | null): Observable<ReplenishmentKpi> {
    let p = new HttpParams();
    if (warehouseId) p = p.set('warehouseId', warehouseId);
    return this.http
      .get<ApiResponse<ReplenishmentKpi>>(`${this.base}/replenishment/kpi`, { params: p })
      .pipe(map(r => r.data!));
  }

  /**
   * Downloads the filtered recommendations as a CSV blob.
   * Returns `{ blob, fileName }` so the caller can trigger a browser download.
   */
  exportReplenishment(filters: ReplenishmentFilters = {}, format: 'csv' = 'csv'): Observable<{ blob: Blob; fileName: string }> {
    let p = new HttpParams();
    if (filters.warehouseId) p = p.set('warehouseId', filters.warehouseId);
    if (filters.supplierId) p = p.set('supplierId', filters.supplierId);
    if (filters.status) p = p.set('status', this.capitalise(filters.status));
    if (filters.search) p = p.set('search', filters.search);
    if (filters.urgencyLevel) p = p.set('urgencyLevel', filters.urgencyLevel);
    if (filters.fromGeneratedAt) p = p.set('fromGeneratedAt', filters.fromGeneratedAt);
    if (filters.toGeneratedAt) p = p.set('toGeneratedAt', filters.toGeneratedAt);
    p = p.set('format', format);
    return this.http
      .get(`${this.base}/replenishment/export`, {
        params: p,
        responseType: 'blob',
        observe: 'response'
      })
      .pipe(map(res => ({
        blob: res.body!,
        fileName: this.parseFileName(res.headers.get('Content-Disposition'))
          ?? `replenishment-${formatLocalDate(new Date())}.csv`
      })));
  }

  private parseFileName(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null;
    // Supports both `filename="x"` and `filename*=UTF-8''x`.
    const star = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (star?.[1]) return decodeURIComponent(star[1].trim());
    const plain = contentDisposition.match(/filename="?([^";]+)"?/i);
    return plain?.[1]?.trim() ?? null;
  }

  // ────────────────────── Promotions ────────────────────────────────────

  getPromotions(opts: {
    productId?: string;
    categoryId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  } = {}): Observable<PagedResult<PromotionRecommendation>> {
    let p = new HttpParams();
    if (opts.productId) p = p.set('productId', opts.productId);
    if (opts.categoryId) p = p.set('categoryId', opts.categoryId);
    if (opts.from) p = p.set('from', opts.from);
    if (opts.to) p = p.set('to', opts.to);
    p = p.set('page', String(opts.page ?? 1));
    p = p.set('pageSize', String(opts.pageSize ?? 50));
    return this.http
      .get<ApiResponse<PagedResult<PromotionRecommendation>>>(`${this.base}/promotions`, { params: p })
      .pipe(map(r => r.data!));
  }

  simulatePromotion(productId: string, discountPercent: number, durationDays: number): Observable<PromotionSimulationResult> {
    return this.http
      .post<ApiResponse<PromotionSimulationResult>>(`${this.base}/promotions/simulate`, {
        productId, discountPercent, durationDays
      })
      .pipe(map(r => r.data!));
  }

  prepareDiscountDraft(promotionId: string): Observable<PreparePromotionDraftResult> {
    return this.http
      .post<ApiResponse<PreparePromotionDraftResult>>(`${this.base}/promotions/${promotionId}/prepare-discount`, {})
      .pipe(map(r => r.data!));
  }

  dismissPromotion(promotionId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/promotions/${promotionId}/dismiss`, {});
  }

  generatePromotionsNow(horizonDays?: number): Observable<number> {
    let p = new HttpParams();
    if (horizonDays != null) p = p.set('horizonDays', String(horizonDays));
    return this.http
      .post<ApiResponse<number>>(`${this.base}/promotions/generate`, {}, { params: p })
      .pipe(map(r => r.data ?? 0));
  }

  // ────────────────────── ABC / XYZ ─────────────────────────────────────

  getAbcXyzMatrix(opts: { warehouseId?: string; abcClass?: AbcClass; xyzClass?: XyzClass } = {}): Observable<AbcXyzMatrix> {
    let p = new HttpParams();
    if (opts.warehouseId) p = p.set('warehouseId', opts.warehouseId);
    if (opts.abcClass) p = p.set('abcClass', opts.abcClass.toUpperCase());
    if (opts.xyzClass) p = p.set('xyzClass', opts.xyzClass.toUpperCase());
    return this.http
      .get<ApiResponse<AbcXyzMatrix>>(`${this.base}/abc-xyz`, { params: p })
      .pipe(map(r => r.data!));
  }

  recomputeAbcXyz(): Observable<number> {
    return this.http
      .post<ApiResponse<number>>(`${this.base}/abc-xyz/recompute`, {})
      .pipe(map(r => r.data ?? 0));
  }

  // ────────────────────── Calendar / Seasonal ───────────────────────────

  getSeasonalImpact(opts: { productId?: string; categoryId?: string; from?: string; to?: string } = {}): Observable<SeasonalImpact> {
    let p = new HttpParams();
    if (opts.productId) p = p.set('productId', opts.productId);
    if (opts.categoryId) p = p.set('categoryId', opts.categoryId);
    if (opts.from) p = p.set('from', opts.from);
    if (opts.to) p = p.set('to', opts.to);
    return this.http
      .get<ApiResponse<SeasonalImpact>>(`${this.base}/seasonal-impact`, { params: p })
      .pipe(map(r => r.data!));
  }

  // ────────────────────── Recompute ─────────────────────────────────────

  recomputeAll(): Observable<RecomputeResult> {
    return this.http
      .post<ApiResponse<RecomputeResult>>(`${this.base}/recompute`, {})
      .pipe(map(r => r.data!));
  }

  getRecomputeAudit(): Observable<RecomputeAudit | null> {
    return this.http
      .get<ApiResponse<RecomputeAudit | null>>(`${this.base}/recompute-audit`)
      .pipe(map(r => r.data ?? null));
  }

  private capitalise(s: string): string {
    return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
  }

  // ────────────────────── Enum casing normalisation ─────────────────────
  // The backend serialises enum *values* in PascalCase (see Program.cs L213-217 — global
  // convention to match Angular comparisons like `status === 'Draft'`). The Forecasting
  // TypeScript types were however authored in camelCase, so a status of `"Pending"` from
  // the wire never matched the `{ pending: 'En attente' }` lookup table — the cells in the
  // V1 board ended up empty.
  //
  // The two normalisers below are the single chokepoint: every response that carries an
  // enum-valued status field is converted to camelCase right after deserialisation, so the
  // rest of the codebase (templates, CSS classes, switch-cases) stays consistent with the
  // declared TypeScript types. The request side already capitalises before sending.

  private lowerFirst(s: string | null | undefined): string | null | undefined {
    if (!s) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  private normalizeRecStatus<T extends { status?: string }>(rec: T): T {
    return { ...rec, status: this.lowerFirst(rec.status) as T['status'] };
  }

  private normalizeAuditStatus(a: ReplenishmentDecisionAudit): ReplenishmentDecisionAudit {
    return {
      ...a,
      fromStatus: this.lowerFirst(a.fromStatus) as ReplenishmentDecisionAudit['fromStatus'],
      toStatus: this.lowerFirst(a.toStatus) as ReplenishmentDecisionAudit['toStatus']
    };
  }

  private normalizePaged<T extends { status?: string }>(
    paged: PagedResult<T>,
    mapper: (item: T) => T
  ): PagedResult<T> {
    return { ...paged, items: paged.items.map(mapper) };
  }
}
