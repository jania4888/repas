// TypeScript models mirroring the backend DTOs from
// InstaFact.Application.Features.Forecasting.Dtos.ForecastingDtos.
// The serializer in the API uses camelCase + camelCase enum names, so we keep enum
// values as plain string literals to remain forward-compatible with new entries.

export type ForecastScopeType = 'global' | 'category' | 'product' | 'warehouse' | 'client';
export type ForecastHorizon = 'week' | 'month' | 'quarter' | 'custom';
export type ForecastMethod = 'sma' | 'holt' | 'holtWinters' | 'calendarHeuristic';
export type ReplenishmentStatus = 'pending' | 'approved' | 'dismissed' | 'ordered' | 'superseded';
export type PromotionRecommendationType =
  | 'destockage'
  | 'surstock'
  | 'crossSell'
  | 'prePic'
  | 'saisonnier'
  | 'margePush';
export type PromotionRecommendationStatus = 'pending' | 'accepted' | 'dismissed' | 'activated' | 'expired';
export type AbcClass = 'a' | 'b' | 'c' | 'unclassified';
export type XyzClass = 'x' | 'y' | 'z' | 'unclassified';

export interface ForecastBreakdownPoint {
  periodStart: string;
  periodEnd: string;
  expected: number;
  low: number;
  high: number;
}

export interface SalesForecast {
  id: string;
  scopeType: ForecastScopeType;
  scopeId: string | null;
  scopeLabel: string | null;
  horizon: ForecastHorizon;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  expected: number;
  low: number;
  high: number;
  currency: string;
  confidencePercent: number;
  methodUsed: ForecastMethod;
  notes: string | null;
  breakdown: ForecastBreakdownPoint[];
}

export interface ProductDemandForecast {
  productId: string;
  productCode: string;
  productName: string;
  horizon: ForecastHorizon;
  periodStart: string;
  periodEnd: string;
  expectedQty: number;
  lowQty: number;
  highQty: number;
  currentStockOnHand: number;
  suggestedReplenishmentQty: number;
  daysOfStockRemaining: number | null;
  confidencePercent: number;
  methodUsed: ForecastMethod;
}

// ────────────────────── Replenishment ─────────────────────────────────────
// Single set of types since the 2026-05-13 V1 cutover. The interface mirrors the C# DTO in
// InstaFact.Application.Features.Forecasting.Dtos.ReplenishmentRecommendationDto.

/** Urgency tier computed server-side from days-of-stock vs. lead-time. */
export type ReplenishmentUrgency = 'OutOfStock' | 'Urgent' | 'Warning' | 'Normal';

/** Action type stored on each <c>ReplenishmentDecisionAudit</c> row. */
export type ReplenishmentActionType =
  | 'Approve'
  | 'Dismiss'
  | 'Override'
  | 'LinkPO'
  | 'Revert'
  | 'AttachNotes'
  | 'Generate';

export interface ReplenishmentRecommendation {
  // Base fields (formerly the V1 interface — inlined since V1 is gone).
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  generatedAt: string;
  currentStockOnHand: number;
  recommendedQty: number;
  rop: number;
  safetyStock: number;
  leadTimeDays: number;
  dailyDemand: number;
  reasonCodes: string[];
  status: ReplenishmentStatus;
  linkedPurchaseOrderId: string | null;
  processedAt: string | null;
  /** Unité produit (Unité, Kg, Litre, …). Détermine le format d'affichage des quantités. */
  productUnit: string | null;
  // V2 enrichment fields.
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
  quantityOnOrder: number;
  effectiveQty: number;
  manualQtyOverride: number | null;
  manualSupplierOverride: string | null;
  daysOfStockRemaining: number | null;
  userNotes: string | null;
  urgencyLevel: ReplenishmentUrgency;
  /** Prix d'achat HT produit pour préremplissage modale BC (null si non renseigné). */
  suggestedPurchaseUnitPrice: number | null;
}

/** Query-string filters accepted by GET /forecasting/replenishment. */
export interface ReplenishmentFilters {
  warehouseId?: string | null;
  supplierId?: string | null;
  status?: ReplenishmentStatus | null;
  search?: string | null;
  urgencyLevel?: ReplenishmentUrgency | null;
  fromGeneratedAt?: string | null;
  toGeneratedAt?: string | null;
  orderBy?: 'generatedAt' | 'rop' | 'qty' | 'days' | null;
  orderDesc?: boolean;
  page?: number;
  pageSize?: number;
}

export interface DismissReplenishmentRequest {
  reason: string;
}

export interface OverrideReplenishmentRequest {
  manualQty: number | null;
  manualSupplierId: string | null;
}

export interface AttachNotesRequest {
  notes: string | null;
}

export interface CreatePurchaseOrderLinePrice {
  recommendationId: string;
  unitPrice: number;
}

export interface CreatePurchaseOrdersRequest {
  recommendationIds: string[];
  linePrices: CreatePurchaseOrderLinePrice[];
}

export interface CreatePurchaseOrdersResult {
  createdPurchaseOrdersCount: number;
  linkedRecommendationsCount: number;
  totalEstimatedQty: number;
  createdPurchaseOrders: CreatedPurchaseOrder[];
  warnings: string[];
  /** Ids of recommendations that could not be linked to a PO (no resolvable supplier, etc.). Additive/optional. */
  unlinkedRecommendationIds?: string[];
}

export interface CreatedPurchaseOrder {
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierName: string;
  linesCount: number;
  totalAmount: number;
  recommendationIds: string[];
}

export interface ReplenishmentKpi {
  pendingCount: number;
  urgentCount: number;
  outOfStockCount: number;
  estimatedValueToOrder: number;
  currency: string;
  serviceLevelPercent: number;
  stockOutRatePercent: number;
  computedAt: string;
  topUrgencies: KpiTopUrgency[];
}

export interface KpiTopUrgency {
  recommendationId: string;
  productCode: string;
  productName: string;
  currentStockOnHand: number;
  daysOfStockRemaining: number | null;
  recommendedQty: number;
}

export interface ReplenishmentDecisionAudit {
  id: string;
  recommendationId: string;
  fromStatus: ReplenishmentStatus;
  toStatus: ReplenishmentStatus;
  actionType: ReplenishmentActionType | string;
  reason: string | null;
  actorUserId: string;
  actedAt: string;
  payloadJson: string | null;
}

/** Standard reason codes shown in the dismiss modal — last one ("Other") opens a free-text field. */
export const DISMISS_REASON_CODES = [
  'SupplierUnavailable',
  'BudgetExhausted',
  'DemandOverestimated',
  'AlternativeStockAvailable',
  'Other'
] as const;
export type DismissReasonCode = typeof DISMISS_REASON_CODES[number];

export interface PromotionRecommendation {
  id: string;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  generatedAt: string;
  type: PromotionRecommendationType;
  suggestedDiscountPercent: number;
  expectedUpliftPercent: number;
  validFrom: string;
  validUntil: string;
  reasoningSummary: string;
  reasonCodes: string[];
  status: PromotionRecommendationStatus;
  relatedEventCode: string | null;
}

export interface PromotionSimulationResult {
  productId: string;
  productCode: string;
  productName: string;
  discountPercent: number;
  durationDays: number;
  baselineRevenue: number;
  projectedRevenueWithoutPromo: number;
  projectedRevenueWithPromo: number;
  expectedUpliftPercent: number;
  marginImpactPercent: number;
  approxElasticity: number;
  notes: string;
}

export interface AbcXyzCell {
  matrixCode: string;
  abcClass: AbcClass;
  xyzClass: XyzClass;
  productCount: number;
  revenueShare: number;
}

export interface ProductClassification {
  productId: string;
  productCode: string;
  productName: string;
  abcClass: AbcClass;
  xyzClass: XyzClass;
  matrixCode: string;
  cumulativeRevenuePercent: number;
  demandCv: number;
  referenceRevenue: number;
  activeMonths: number;
  computedAt: string;
}

export interface AbcXyzMatrix {
  computedAt: string;
  totalProducts: number;
  totalReferenceRevenue: number;
  cells: AbcXyzCell[];
  products: ProductClassification[];
}

export interface CalendarEvent {
  code: string;
  displayName: string;
  startDate: string;
  endDate: string;
  isHoliday: boolean;
  isCommercialWindow: boolean;
  category: string;
}

export interface SeasonalImpact {
  productId: string | null;
  productName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  periodStart: string;
  periodEnd: string;
  applicableEvents: CalendarEvent[];
  weightedSeasonalFactor: number;
  baselineExpected: number;
  adjustedExpected: number;
  currency: string;
  notes: string;
}

export interface RecomputeResult {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  forecastsGenerated: number;
  replenishmentsGenerated: number;
  promotionsGenerated: number;
  classificationsUpdated: number;
  success: boolean;
  errorMessage: string | null;
}

export interface PreparePromotionDraftResult {
  promotionRecommendationId: string;
  productId: string | null;
  categoryId: string | null;
  suggestedDiscountPercent: number;
  validFrom: string;
  validUntil: string;
  notes: string;
}

export interface RecomputeAudit {
  id: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  triggerType: string;
  triggeredBy: string | null;
  forecastsGenerated: number;
  replenishmentsGenerated: number;
  promotionsGenerated: number;
  classificationsUpdated: number;
  success: boolean;
  errorMessage: string | null;
}
