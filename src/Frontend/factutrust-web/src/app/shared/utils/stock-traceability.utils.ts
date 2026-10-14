import type { StockFeatures } from '@core/services/stock.service';

export const TRACKING_MODE_NONE = 0;
export const TRACKING_MODE_LOT = 1;
export const TRACKING_MODE_SERIAL = 2;

export const PICKING_NONE = 0;
export const PICKING_FEFO = 1;
export const PICKING_FIFO_PHYSICAL = 2;
export const PICKING_MANUAL = 3;

export const ALLOCATION_QTY_TOLERANCE = 0.0001;

export const COSTING_AVERAGE = 0;
export const COSTING_FIFO = 1;
export const COSTING_LIFO = 2;

export interface AllocationRow {
  lotNumber: string;
  expiryDate: Date | null;
  quantity: number;
  productLotId?: string | null;
  serialNumber?: string | null;
  serialId?: string | null;
  unitCost?: number | null;
}

export function needsManualLotPicker(pickingPolicy: unknown): boolean {
  const policy = coercePickingPolicy(pickingPolicy);
  return policy === PICKING_NONE || policy === PICKING_MANUAL;
}

/**
 * API enums are serialized as PascalCase strings (`JsonStringEnumConverter`).
 * Numeric values remain valid for forms and older payloads.
 */
export function coerceTrackingMode(raw: unknown): number {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw === TRACKING_MODE_LOT) return TRACKING_MODE_LOT;
    if (raw === TRACKING_MODE_SERIAL) return TRACKING_MODE_SERIAL;
    return TRACKING_MODE_NONE;
  }
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (value === 'lot' || value === '1') return TRACKING_MODE_LOT;
    if (value === 'serial' || value === '2') return TRACKING_MODE_SERIAL;
    if (value === 'none' || value === '0') return TRACKING_MODE_NONE;
  }
  return TRACKING_MODE_NONE;
}

export function coercePickingPolicy(raw: unknown): number {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw === PICKING_FEFO) return PICKING_FEFO;
    if (raw === PICKING_FIFO_PHYSICAL) return PICKING_FIFO_PHYSICAL;
    if (raw === PICKING_MANUAL) return PICKING_MANUAL;
    return PICKING_NONE;
  }
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (value === 'fefo' || value === '1') return PICKING_FEFO;
    if (value === 'fifophysical' || value === '2') return PICKING_FIFO_PHYSICAL;
    if (value === 'manual' || value === '3') return PICKING_MANUAL;
    if (value === 'none' || value === '0') return PICKING_NONE;
  }
  return PICKING_NONE;
}

export function coerceCostingMethod(raw: unknown): number {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw === COSTING_FIFO) return COSTING_FIFO;
    if (raw === COSTING_LIFO) return COSTING_LIFO;
    return COSTING_AVERAGE;
  }
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (value === 'fifo' || value === '1') return COSTING_FIFO;
    if (value === 'lifo' || value === '2') return COSTING_LIFO;
    if (value === 'average' || value === '0') return COSTING_AVERAGE;
  }
  return COSTING_AVERAGE;
}

export function showLotSection(
  trackingMode: unknown,
  features: StockFeatures | null
): boolean {
  return (features?.lotTrackingEnabled ?? false)
    && coerceTrackingMode(trackingMode) === TRACKING_MODE_LOT;
}

export function showSerialSection(
  trackingMode: unknown,
  features: StockFeatures | null
): boolean {
  return (features?.serialTrackingEnabled ?? false)
    && coerceTrackingMode(trackingMode) === TRACKING_MODE_SERIAL;
}

/** True when tenant flags and the product all block expired lots on stock exit. */
export function shouldBlockExpiredLotsOnExit(
  features: StockFeatures | null,
  hasExpiryTracking: boolean
): boolean {
  return !!features?.blockExpiredLotsOnExit
    && !!features?.expiryTrackingEnabled
    && hasExpiryTracking;
}

/**
 * Matches `ProductLot.IsExpired`: calendar date of DLUO (UTC) is strictly before today (UTC).
 * Date-only ISO strings (`YYYY-MM-DD`) are compared as calendar days, not local midnights.
 */
export function isLotExpired(
  expiryDate: string | Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (expiryDate == null || expiryDate === '') return false;
  const expiryUtc = utcCalendarDay(expiryDate);
  if (expiryUtc == null) return false;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return expiryUtc < todayUtc;
}

function utcCalendarDay(value: string | Date): number | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!isoDate) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  }
  return Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
}

/** Mirrors TrackedDocumentStockService.IsLiveTracked on the backend. */
export function isLiveTracked(
  trackingMode: unknown,
  costingMethod: unknown,
  features: StockFeatures | null
): boolean {
  if (!features) return false;
  const mode = coerceTrackingMode(trackingMode);
  const costing = coerceCostingMethod(costingMethod);
  if (mode === TRACKING_MODE_LOT && features.lotTrackingEnabled) return true;
  if (mode === TRACKING_MODE_SERIAL && features.serialTrackingEnabled) return true;
  if (
    (costing === COSTING_FIFO || costing === COSTING_LIFO)
    && features.fifoLifoValuationEnabled
  ) {
    return true;
  }
  return false;
}

export interface InvoiceValidateStockLine {
  isStockManaged: boolean;
  trackingMode: number;
  costingMethod: number;
  /** false = insufficient / missing stock; null = availability unknown. */
  isAvailable: boolean | null;
}

/**
 * When at least one stock-managed line is live-tracked, the backend deducts
 * every stock-managed line synchronously and rejects if any StockItem is missing
 * or quantity is insufficient. Untracked-only documents are not blocked here.
 */
export function shouldBlockDocumentStockExit(
  lines: InvoiceValidateStockLine[],
  features: StockFeatures | null
): boolean {
  const stockManaged = lines.filter(l => l.isStockManaged);
  const anyLiveTracked = stockManaged.some(l =>
    isLiveTracked(l.trackingMode, l.costingMethod, features)
  );
  if (!anyLiveTracked) return false;
  return stockManaged.some(l => l.isAvailable !== true);
}

/** Invoice validate dialog — same rule as delivery-note stock exit. */
export const shouldBlockInvoiceValidateForStock = shouldBlockDocumentStockExit;

export interface WarehouseChoice {
  id: string;
  name: string;
  isDefault: boolean;
}

/** Document warehouse if present, otherwise the default warehouse (backend fallback). */
export function resolveEffectiveWarehouse(
  warehouses: WarehouseChoice[],
  documentWarehouseId: string | null | undefined
): { warehouse: WarehouseChoice | null; isDefaultFallback: boolean } {
  const byId = documentWarehouseId
    ? warehouses.find(w => w.id === documentWarehouseId) ?? null
    : null;
  if (byId) return { warehouse: byId, isDefaultFallback: false };
  const fallback = warehouses.find(w => w.isDefault) ?? null;
  return { warehouse: fallback, isDefaultFallback: !!fallback };
}

export function allocationSum(allocations: AllocationRow[]): number {
  return allocations.reduce((acc, a) => acc + (a.quantity ?? 0), 0);
}

export function allocationsMatchQuantity(
  allocations: AllocationRow[],
  lineQuantity: number
): boolean {
  return Math.abs(allocationSum(allocations) - lineQuantity) <= ALLOCATION_QTY_TOLERANCE;
}

export function exitAllocationsValid(
  trackingMode: unknown,
  pickingPolicy: unknown,
  quantity: number,
  allocations: AllocationRow[],
  features: StockFeatures | null
): boolean {
  if (quantity <= 0) return true;
  const lot = showLotSection(trackingMode, features);
  const serial = showSerialSection(trackingMode, features);
  if (!lot && !serial) return true;

  if (serial) {
    if (allocations.length === 0) return true;
    return allocations.length === Math.round(quantity)
      && allocations.every(a => (a.serialId || a.serialNumber?.trim()));
  }

  if (lot) {
    if (needsManualLotPicker(pickingPolicy)) {
      return allocations.length > 0
        && allocationsMatchQuantity(allocations, quantity)
        && allocations.every(a => a.productLotId || a.lotNumber?.trim());
    }
    if (allocations.length > 0) {
      return allocationsMatchQuantity(allocations, quantity);
    }
    return true;
  }

  return true;
}

/** Purchase receipt / stock voucher entry — lot number or serial required per tracked line. */
export function entryAllocationsValid(
  trackingMode: number,
  quantity: number,
  allocations: AllocationRow[],
  features: StockFeatures | null
): boolean {
  if (quantity <= 0) return true;
  const lot = showLotSection(trackingMode, features);
  const serial = showSerialSection(trackingMode, features);
  if (!lot && !serial) return true;

  if (serial) {
    return allocations.length === Math.round(quantity)
      && allocations.every(a => a.serialNumber?.trim());
  }

  if (lot) {
    return allocations.length > 0
      && allocationsMatchQuantity(allocations, quantity)
      && allocations.every(a => a.lotNumber?.trim());
  }

  return true;
}

export function createDefaultLotRow(quantity = 0): AllocationRow {
  return { lotNumber: '', expiryDate: null, quantity };
}

export function createDefaultSerialRow(): AllocationRow {
  return { lotNumber: '', expiryDate: null, quantity: 1, serialNumber: '' };
}

export function allocationHasIdentity(a: AllocationRow): boolean {
  return !!(a.productLotId || a.lotNumber?.trim() || a.serialId || a.serialNumber?.trim());
}

export interface ExitLotAvailability {
  productId: string;
  kind: 'lot' | 'serial';
  loaded: boolean;
  availableCount: number;
  /** Lots with stock that were hidden because they are expired (exit picker). */
  expiredExcludedCount?: number;
}

export interface KnownLotOption {
  productLotId: string;
  lotNumber: string;
}

export interface LotStockRef {
  productLotId: string;
  lotNumber?: string;
  quantityAvailable: number;
}

export interface LotStockExceedance {
  productLotId: string;
  lotNumber: string;
  available: number;
  requested: number;
}

export interface LotStockValidity {
  productId: string;
  valid: boolean;
}

/** Available qty on a lot minus other allocation rows (this row excluded). */
export function remainingLotAvailable(
  lots: LotStockRef[],
  allocations: AllocationRow[],
  productLotId: string,
  exceptIndex?: number
): number {
  const lot = lots.find(l => l.productLotId === productLotId);
  if (!lot) return 0;
  const usedByOthers = allocations.reduce((sum, row, i) => {
    if (exceptIndex !== undefined && i === exceptIndex) return sum;
    if (row.productLotId !== productLotId) return sum;
    return sum + (row.quantity ?? 0);
  }, 0);
  return Math.max(0, lot.quantityAvailable - usedByOthers);
}

export function capQuantityToRemaining(quantity: number, remaining: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) return 0;
  if (!Number.isFinite(remaining) || remaining < 0) return 0;
  return Math.min(quantity, remaining);
}

export function lotStockExceedances(
  allocations: AllocationRow[],
  lots: LotStockRef[]
): LotStockExceedance[] {
  const requestedByLot = new Map<string, { requested: number; lotNumber: string }>();
  for (const row of allocations) {
    if (!row.productLotId) continue;
    const prev = requestedByLot.get(row.productLotId);
    requestedByLot.set(row.productLotId, {
      requested: (prev?.requested ?? 0) + (row.quantity ?? 0),
      lotNumber: row.lotNumber || prev?.lotNumber || ''
    });
  }

  const result: LotStockExceedance[] = [];
  for (const [productLotId, agg] of requestedByLot) {
    const lot = lots.find(l => l.productLotId === productLotId);
    const available = lot?.quantityAvailable ?? 0;
    if (agg.requested - available > ALLOCATION_QTY_TOLERANCE) {
      result.push({
        productLotId,
        lotNumber: agg.lotNumber || lot?.lotNumber || productLotId,
        available,
        requested: agg.requested
      });
    }
  }
  return result;
}

export function exitAllocationsExceedLotStock(
  allocations: AllocationRow[],
  lots: LotStockRef[]
): boolean {
  return lotStockExceedances(allocations, lots).length > 0;
}

export type AllocationPayloadRow = {
  quantity: number;
  productLotId?: string;
  lotNumber?: string;
  expiryDate?: string;
  serialId?: string;
  serialNumber?: string;
  unitCost?: number;
};

/** Exact lot-number match only (case-insensitive). Never suffix-matches 566 → 455566. */
export function resolveExitLotId(
  row: AllocationRow,
  knownLots: KnownLotOption[] = []
): string | null {
  if (row.productLotId) return row.productLotId;
  const typed = row.lotNumber?.trim();
  if (!typed) return null;
  const needle = typed.toUpperCase();
  const matches = knownLots.filter(l => l.lotNumber.trim().toUpperCase() === needle);
  return matches.length === 1 ? matches[0].productLotId : null;
}

/**
 * True when a lot-tracked line has on-hand quantity but the warehouse has no
 * pickable lots — FEFO would fail after submit.
 */
export function lineMissingWarehouseLots(params: {
  trackingMode: unknown;
  features: StockFeatures | null;
  quantity: number;
  availableStock: number | null | undefined;
  availability: ExitLotAvailability | undefined;
}): boolean {
  if (params.quantity <= 0) return false;
  if (!showLotSection(params.trackingMode, params.features)) return false;
  if (params.availability?.kind === 'serial') return false;
  if (!params.availability?.loaded) return false;
  if (params.availability.availableCount > 0) return false;
  if (params.availableStock == null) return true;
  return params.availableStock > 0;
}

/** Stock exists but every warehouse lot is expired and blocked on exit. */
export function lineBlockedByExpiredLots(params: {
  trackingMode: unknown;
  features: StockFeatures | null;
  quantity: number;
  availableStock: number | null | undefined;
  availability: ExitLotAvailability | undefined;
}): boolean {
  if (!lineMissingWarehouseLots(params)) return false;
  return (params.availability?.expiredExcludedCount ?? 0) > 0;
}

export function lineMissingWarehouseSerials(params: {
  trackingMode: unknown;
  features: StockFeatures | null;
  quantity: number;
  availableStock: number | null | undefined;
  availability: ExitLotAvailability | undefined;
}): boolean {
  if (params.quantity <= 0) return false;
  if (!showSerialSection(params.trackingMode, params.features)) return false;
  if (params.availability?.kind === 'lot') return false;
  if (!params.availability?.loaded) return false;
  if (params.availability.availableCount > 0) return false;
  if (params.availableStock == null) return true;
  return params.availableStock > 0;
}

export function exitTraceabilityReady(
  trackingMode: unknown,
  features: StockFeatures | null,
  quantity: number,
  availability: ExitLotAvailability | undefined
): boolean {
  if (quantity <= 0) return true;
  const lot = showLotSection(trackingMode, features);
  const serial = showSerialSection(trackingMode, features);
  if (!lot && !serial) return true;
  return !!availability?.loaded;
}

export function buildAllocationPayload(allocations: AllocationRow[]): AllocationPayloadRow[] {
  return allocations
    .filter(a => a.quantity > 0 && allocationHasIdentity(a))
    .map(a => toAllocationPayloadRow(a));
}

/**
 * Stock exit (invoice validate, delivery, voucher exit): never send a typed
 * lot number without a productLotId. Unmatched numbers are omitted so FEFO
 * can run when the picker was left empty.
 */
export function buildExitAllocationPayload(
  allocations: AllocationRow[],
  knownLots: KnownLotOption[] = []
): AllocationPayloadRow[] {
  return allocations
    .filter(a => a.quantity > 0)
    .map(a => {
      const productLotId = resolveExitLotId(a, knownLots);
      const row = toAllocationPayloadRow({
        ...a,
        productLotId,
        lotNumber: productLotId ? (a.lotNumber ?? '') : ''
      });
      if (productLotId) {
        row.productLotId = productLotId;
        const known = knownLots.find(l => l.productLotId === productLotId);
        if (known?.lotNumber) row.lotNumber = known.lotNumber;
        else if (a.lotNumber?.trim()) row.lotNumber = a.lotNumber.trim();
      } else {
        delete row.lotNumber;
      }
      return row;
    })
    .filter(row => !!(row.productLotId || row.serialId || row.serialNumber));
}

function toAllocationPayloadRow(a: AllocationRow): AllocationPayloadRow {
  const row: AllocationPayloadRow = { quantity: a.quantity };
  if (a.productLotId) row.productLotId = a.productLotId;
  if (a.lotNumber?.trim()) row.lotNumber = a.lotNumber.trim();
  if (a.expiryDate) row.expiryDate = formatLocalDate(a.expiryDate);
  if (a.serialId) row.serialId = a.serialId;
  if (a.serialNumber?.trim()) row.serialNumber = a.serialNumber.trim();
  if (a.unitCost != null) row.unitCost = a.unitCost;
  return row;
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
