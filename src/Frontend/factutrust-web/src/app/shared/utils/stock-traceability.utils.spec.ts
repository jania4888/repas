import { StockFeatures } from '@core/services/stock.service';
import {
  COSTING_AVERAGE,
  COSTING_FIFO,
  COSTING_LIFO,
  PICKING_FEFO,
  PICKING_FIFO_PHYSICAL,
  PICKING_MANUAL,
  PICKING_NONE,
  TRACKING_MODE_LOT,
  TRACKING_MODE_NONE,
  TRACKING_MODE_SERIAL,
  coerceCostingMethod,
  coercePickingPolicy,
  coerceTrackingMode,
  entryAllocationsValid,
  exitAllocationsValid,
  isLiveTracked,
  needsManualLotPicker,
  shouldBlockDocumentStockExit,
  shouldBlockInvoiceValidateForStock,
  showLotSection,
  resolveEffectiveWarehouse,
  buildAllocationPayload,
  buildExitAllocationPayload,
  resolveExitLotId,
  lineMissingWarehouseLots,
  lineBlockedByExpiredLots,
  isLotExpired,
  shouldBlockExpiredLotsOnExit,
  exitTraceabilityReady,
  remainingLotAvailable,
  capQuantityToRemaining,
  exitAllocationsExceedLotStock
} from './stock-traceability.utils';

function features(overrides: Partial<StockFeatures> = {}): StockFeatures {
  return {
    lotTrackingEnabled: false,
    serialTrackingEnabled: false,
    expiryTrackingEnabled: false,
    productVariantsEnabled: false,
    fifoLifoValuationEnabled: false,
    blockExpiredLotsOnExit: false,
    strictTrackedAllocation: false,
    ...overrides
  };
}

describe('coerceTrackingMode', () => {
  it('keeps numeric lot / serial / none values', () => {
    expect(coerceTrackingMode(TRACKING_MODE_NONE)).toBe(TRACKING_MODE_NONE);
    expect(coerceTrackingMode(TRACKING_MODE_LOT)).toBe(TRACKING_MODE_LOT);
    expect(coerceTrackingMode(TRACKING_MODE_SERIAL)).toBe(TRACKING_MODE_SERIAL);
  });

  it('maps API PascalCase strings from JsonStringEnumConverter', () => {
    expect(coerceTrackingMode('None')).toBe(TRACKING_MODE_NONE);
    expect(coerceTrackingMode('Lot')).toBe(TRACKING_MODE_LOT);
    expect(coerceTrackingMode('Serial')).toBe(TRACKING_MODE_SERIAL);
  });

  it('maps numeric strings', () => {
    expect(coerceTrackingMode('0')).toBe(TRACKING_MODE_NONE);
    expect(coerceTrackingMode('1')).toBe(TRACKING_MODE_LOT);
    expect(coerceTrackingMode('2')).toBe(TRACKING_MODE_SERIAL);
  });

  it('returns none for unknown values', () => {
    expect(coerceTrackingMode(undefined)).toBe(TRACKING_MODE_NONE);
    expect(coerceTrackingMode(null)).toBe(TRACKING_MODE_NONE);
    expect(coerceTrackingMode('fefo')).toBe(TRACKING_MODE_NONE);
  });
});

describe('coercePickingPolicy', () => {
  it('keeps numeric picking policy values', () => {
    expect(coercePickingPolicy(PICKING_NONE)).toBe(PICKING_NONE);
    expect(coercePickingPolicy(PICKING_FEFO)).toBe(PICKING_FEFO);
    expect(coercePickingPolicy(PICKING_FIFO_PHYSICAL)).toBe(PICKING_FIFO_PHYSICAL);
    expect(coercePickingPolicy(PICKING_MANUAL)).toBe(PICKING_MANUAL);
  });

  it('maps API PascalCase strings from JsonStringEnumConverter', () => {
    expect(coercePickingPolicy('None')).toBe(PICKING_NONE);
    expect(coercePickingPolicy('Fefo')).toBe(PICKING_FEFO);
    expect(coercePickingPolicy('FifoPhysical')).toBe(PICKING_FIFO_PHYSICAL);
    expect(coercePickingPolicy('Manual')).toBe(PICKING_MANUAL);
  });

  it('maps numeric strings', () => {
    expect(coercePickingPolicy('0')).toBe(PICKING_NONE);
    expect(coercePickingPolicy('1')).toBe(PICKING_FEFO);
    expect(coercePickingPolicy('2')).toBe(PICKING_FIFO_PHYSICAL);
    expect(coercePickingPolicy('3')).toBe(PICKING_MANUAL);
  });

  it('returns none for unknown values', () => {
    expect(coercePickingPolicy(undefined)).toBe(PICKING_NONE);
    expect(coercePickingPolicy(null)).toBe(PICKING_NONE);
    expect(coercePickingPolicy('lot')).toBe(PICKING_NONE);
  });
});

describe('coerceCostingMethod', () => {
  it('keeps numeric costing method values', () => {
    expect(coerceCostingMethod(COSTING_AVERAGE)).toBe(COSTING_AVERAGE);
    expect(coerceCostingMethod(COSTING_FIFO)).toBe(COSTING_FIFO);
    expect(coerceCostingMethod(COSTING_LIFO)).toBe(COSTING_LIFO);
  });

  it('maps API PascalCase strings from JsonStringEnumConverter', () => {
    expect(coerceCostingMethod('Average')).toBe(COSTING_AVERAGE);
    expect(coerceCostingMethod('Fifo')).toBe(COSTING_FIFO);
    expect(coerceCostingMethod('Lifo')).toBe(COSTING_LIFO);
  });

  it('is case-insensitive', () => {
    expect(coerceCostingMethod('FIFO')).toBe(COSTING_FIFO);
    expect(coerceCostingMethod('lifo')).toBe(COSTING_LIFO);
  });

  it('maps numeric strings', () => {
    expect(coerceCostingMethod('0')).toBe(COSTING_AVERAGE);
    expect(coerceCostingMethod('1')).toBe(COSTING_FIFO);
    expect(coerceCostingMethod('2')).toBe(COSTING_LIFO);
  });

  it('returns average for unknown values', () => {
    expect(coerceCostingMethod(undefined)).toBe(COSTING_AVERAGE);
    expect(coerceCostingMethod(null)).toBe(COSTING_AVERAGE);
    expect(coerceCostingMethod('garbage')).toBe(COSTING_AVERAGE);
    expect(coerceCostingMethod({})).toBe(COSTING_AVERAGE);
  });
});

describe('needsManualLotPicker', () => {
  it('requires a picker for None and Manual, including API strings', () => {
    expect(needsManualLotPicker(PICKING_NONE)).toBe(true);
    expect(needsManualLotPicker(PICKING_MANUAL)).toBe(true);
    expect(needsManualLotPicker('None')).toBe(true);
    expect(needsManualLotPicker('Manual')).toBe(true);
  });

  it('does not require a picker for FEFO / FIFO physical', () => {
    expect(needsManualLotPicker(PICKING_FEFO)).toBe(false);
    expect(needsManualLotPicker(PICKING_FIFO_PHYSICAL)).toBe(false);
    expect(needsManualLotPicker('Fefo')).toBe(false);
    expect(needsManualLotPicker('FifoPhysical')).toBe(false);
  });
});

describe('showLotSection', () => {
  it('treats API string Lot as lot tracking when the feature is enabled', () => {
    expect(showLotSection('Lot', features({ lotTrackingEnabled: true }))).toBe(true);
    expect(showLotSection('Lot', features())).toBe(false);
  });
});

describe('isLiveTracked', () => {
  it('returns false when features are missing', () => {
    expect(isLiveTracked(TRACKING_MODE_LOT, COSTING_FIFO, null)).toBe(false);
  });

  it('tracks lot products when lot tracking is enabled', () => {
    expect(isLiveTracked(TRACKING_MODE_LOT, COSTING_AVERAGE, features({ lotTrackingEnabled: true }))).toBe(true);
  });

  it('does not track lot products when lot tracking is disabled', () => {
    expect(isLiveTracked(TRACKING_MODE_LOT, COSTING_AVERAGE, features())).toBe(false);
  });

  it('tracks serial products when serial tracking is enabled', () => {
    expect(isLiveTracked(TRACKING_MODE_SERIAL, COSTING_AVERAGE, features({ serialTrackingEnabled: true }))).toBe(true);
  });

  it('does not track serial products when serial tracking is disabled', () => {
    expect(isLiveTracked(TRACKING_MODE_SERIAL, COSTING_AVERAGE, features())).toBe(false);
  });

  it('tracks FIFO costing from an API PascalCase string when valuation is enabled', () => {
    expect(isLiveTracked(TRACKING_MODE_NONE, 'Fifo', features({ fifoLifoValuationEnabled: true }))).toBe(true);
    expect(isLiveTracked(TRACKING_MODE_NONE, 'Lifo', features({ fifoLifoValuationEnabled: true }))).toBe(true);
  });

  it('tracks FIFO costing when FIFO/LIFO valuation is enabled', () => {
    expect(isLiveTracked(TRACKING_MODE_NONE, COSTING_FIFO, features({ fifoLifoValuationEnabled: true }))).toBe(true);
  });

  it('tracks LIFO costing when FIFO/LIFO valuation is enabled', () => {
    expect(isLiveTracked(TRACKING_MODE_NONE, COSTING_LIFO, features({ fifoLifoValuationEnabled: true }))).toBe(true);
  });

  it('does not treat average costing as live-tracked', () => {
    expect(isLiveTracked(TRACKING_MODE_NONE, COSTING_AVERAGE, features({ fifoLifoValuationEnabled: true }))).toBe(false);
  });
});

describe('shouldBlockInvoiceValidateForStock', () => {
  const trackedFeatures = features({ lotTrackingEnabled: true });

  it('does not block untracked stock-managed lines with insufficient stock', () => {
    expect(shouldBlockInvoiceValidateForStock([
      {
        isStockManaged: true,
        trackingMode: TRACKING_MODE_NONE,
        costingMethod: COSTING_AVERAGE,
        isAvailable: false
      }
    ], features())).toBe(false);
  });

  it('blocks when a live-tracked line has insufficient stock', () => {
    expect(shouldBlockInvoiceValidateForStock([
      {
        isStockManaged: true,
        trackingMode: TRACKING_MODE_LOT,
        costingMethod: COSTING_AVERAGE,
        isAvailable: false
      }
    ], trackedFeatures)).toBe(true);
  });

  it('blocks all stock-managed lines when any sibling is live-tracked', () => {
    expect(shouldBlockInvoiceValidateForStock([
      {
        isStockManaged: true,
        trackingMode: TRACKING_MODE_LOT,
        costingMethod: COSTING_AVERAGE,
        isAvailable: true
      },
      {
        isStockManaged: true,
        trackingMode: TRACKING_MODE_NONE,
        costingMethod: COSTING_AVERAGE,
        isAvailable: false
      }
    ], trackedFeatures)).toBe(true);
  });

  it('blocks when availability is unknown for a live-tracked invoice', () => {
    expect(shouldBlockInvoiceValidateForStock([
      {
        isStockManaged: true,
        trackingMode: TRACKING_MODE_LOT,
        costingMethod: COSTING_AVERAGE,
        isAvailable: null
      }
    ], trackedFeatures)).toBe(true);
  });

  it('does not block when every stock-managed line is available', () => {
    expect(shouldBlockInvoiceValidateForStock([
      {
        isStockManaged: true,
        trackingMode: TRACKING_MODE_LOT,
        costingMethod: COSTING_AVERAGE,
        isAvailable: true
      }
    ], trackedFeatures)).toBe(false);
  });

  it('ignores non stock-managed lines', () => {
    expect(shouldBlockInvoiceValidateForStock([
      {
        isStockManaged: false,
        trackingMode: TRACKING_MODE_LOT,
        costingMethod: COSTING_AVERAGE,
        isAvailable: false
      }
    ], trackedFeatures)).toBe(false);
  });

  it('shares the same rule as shouldBlockDocumentStockExit', () => {
    expect(shouldBlockDocumentStockExit).toBe(shouldBlockInvoiceValidateForStock);
  });
});

describe('exitAllocationsValid', () => {
  const trackedFeatures = features({ lotTrackingEnabled: true, serialTrackingEnabled: true });

  it('requires a lot identity when picking policy is Manual as an API string', () => {
    expect(exitAllocationsValid(
      'Lot',
      'Manual',
      10,
      [{ lotNumber: 'LOT-1', expiryDate: null, quantity: 10 }],
      trackedFeatures
    )).toBe(true);

    expect(exitAllocationsValid(
      'Lot',
      'Manual',
      10,
      [{ lotNumber: '', expiryDate: null, quantity: 10 }],
      trackedFeatures
    )).toBe(false);
  });

  it('allows empty allocations for FEFO string policy', () => {
    expect(exitAllocationsValid('Lot', 'Fefo', 10, [], trackedFeatures)).toBe(true);
  });
});

describe('lot stock remaining / cap / exceed', () => {
  const lots = [
    { productLotId: 'lot-567777', lotNumber: '567777', quantityAvailable: 3 }
  ];

  it('subtracts other rows on the same lot from remaining', () => {
    const allocations = [
      { lotNumber: '567777', expiryDate: null, quantity: 2, productLotId: 'lot-567777' },
      { lotNumber: '567777', expiryDate: null, quantity: 4, productLotId: 'lot-567777' }
    ];
    expect(remainingLotAvailable(lots, allocations, 'lot-567777', 1)).toBe(1);
    expect(remainingLotAvailable(lots, allocations, 'lot-567777', 0)).toBe(0);
  });

  it('returns 0 remaining when the lot is unknown', () => {
    expect(remainingLotAvailable(lots, [], 'missing')).toBe(0);
  });

  it('caps quantity to remaining and floors at 0', () => {
    expect(capQuantityToRemaining(4, 3)).toBe(3);
    expect(capQuantityToRemaining(2, 3)).toBe(2);
    expect(capQuantityToRemaining(-1, 3)).toBe(0);
    expect(capQuantityToRemaining(4, -2)).toBe(0);
  });

  it('detects when allocated qty exceeds lot stock', () => {
    expect(exitAllocationsExceedLotStock([
      { lotNumber: '567777', expiryDate: null, quantity: 4, productLotId: 'lot-567777' }
    ], lots)).toBe(true);

    expect(exitAllocationsExceedLotStock([
      { lotNumber: '567777', expiryDate: null, quantity: 3, productLotId: 'lot-567777' }
    ], lots)).toBe(false);
  });

  it('sums two rows on the same lot against available', () => {
    expect(exitAllocationsExceedLotStock([
      { lotNumber: '567777', expiryDate: null, quantity: 2, productLotId: 'lot-567777' },
      { lotNumber: '567777', expiryDate: null, quantity: 2, productLotId: 'lot-567777' }
    ], lots)).toBe(true);

    expect(exitAllocationsExceedLotStock([
      { lotNumber: '567777', expiryDate: null, quantity: 2, productLotId: 'lot-567777' },
      { lotNumber: '567777', expiryDate: null, quantity: 1, productLotId: 'lot-567777' }
    ], lots)).toBe(false);
  });

  it('ignores rows without a productLotId', () => {
    expect(exitAllocationsExceedLotStock([
      { lotNumber: '', expiryDate: null, quantity: 4 }
    ], lots)).toBe(false);
  });
});

describe('buildAllocationPayload', () => {
  it('omits rows with quantity but no lot or serial identity', () => {
    expect(buildAllocationPayload([
      { lotNumber: '', expiryDate: null, quantity: 7 }
    ])).toEqual([]);
  });

  it('keeps rows that identify a lot by number', () => {
    expect(buildAllocationPayload([
      { lotNumber: 'L-1', expiryDate: null, quantity: 7 }
    ])).toEqual([{ quantity: 7, lotNumber: 'L-1' }]);
  });

  it('keeps rows that identify a product lot id', () => {
    expect(buildAllocationPayload([
      { lotNumber: '', expiryDate: null, quantity: 3, productLotId: 'lot-id' }
    ])).toEqual([{ quantity: 3, productLotId: 'lot-id' }]);
  });
});

describe('resolveExitLotId', () => {
  const lots = [{ productLotId: 'id-455566', lotNumber: '455566' }];

  it('returns the product lot id when already set', () => {
    expect(resolveExitLotId(
      { lotNumber: '566', expiryDate: null, quantity: 4, productLotId: 'id-455566' },
      lots
    )).toBe('id-455566');
  });

  it('matches an exact lot number case-insensitively', () => {
    expect(resolveExitLotId(
      { lotNumber: '455566', expiryDate: null, quantity: 4 },
      lots
    )).toBe('id-455566');
  });

  it('does not suffix-match a partial lot number', () => {
    expect(resolveExitLotId(
      { lotNumber: '566', expiryDate: null, quantity: 4 },
      lots
    )).toBeNull();
  });
});

describe('buildExitAllocationPayload', () => {
  it('omits a typed lot number that has no productLotId', () => {
    expect(buildExitAllocationPayload([
      { lotNumber: '455566', expiryDate: null, quantity: 4 }
    ])).toEqual([]);
  });

  it('sends productLotId and does not invent a suffix match', () => {
    expect(buildExitAllocationPayload(
      [{ lotNumber: '566', expiryDate: null, quantity: 4 }],
      [{ productLotId: 'id-455566', lotNumber: '455566' }]
    )).toEqual([]);
  });

  it('resolves an exact lot number to productLotId', () => {
    expect(buildExitAllocationPayload(
      [{ lotNumber: '455566', expiryDate: null, quantity: 4 }],
      [{ productLotId: 'id-455566', lotNumber: '455566' }]
    )).toEqual([{ quantity: 4, productLotId: 'id-455566', lotNumber: '455566' }]);
  });

  it('keeps a picked lot id', () => {
    expect(buildExitAllocationPayload([
      { lotNumber: '455566', expiryDate: null, quantity: 4, productLotId: 'id-455566' }
    ])).toEqual([{ quantity: 4, productLotId: 'id-455566', lotNumber: '455566' }]);
  });
});

describe('isLotExpired', () => {
  it('is false when there is no expiry date', () => {
    expect(isLotExpired(null)).toBe(false);
    expect(isLotExpired(undefined)).toBe(false);
    expect(isLotExpired('')).toBe(false);
  });

  it('treats today as not expired and yesterday as expired (UTC calendar)', () => {
    const now = new Date(Date.UTC(2026, 7, 26, 1, 51, 52));
    expect(isLotExpired('2026-08-26', now)).toBe(false);
    expect(isLotExpired('2026-08-26T23:59:59Z', now)).toBe(false);
    expect(isLotExpired('2026-08-25', now)).toBe(true);
    expect(isLotExpired('2026-08-25T00:00:00', now)).toBe(true);
  });

  it('reads Date values as UTC calendar days', () => {
    const now = new Date(Date.UTC(2026, 7, 26, 12, 0, 0));
    expect(isLotExpired(new Date(Date.UTC(2026, 7, 25)), now)).toBe(true);
    expect(isLotExpired(new Date(Date.UTC(2026, 7, 26)), now)).toBe(false);
  });
});

describe('shouldBlockExpiredLotsOnExit', () => {
  it('requires tenant flags and product expiry tracking', () => {
    const blocking = features({
      expiryTrackingEnabled: true,
      blockExpiredLotsOnExit: true
    });
    expect(shouldBlockExpiredLotsOnExit(blocking, true)).toBe(true);
    expect(shouldBlockExpiredLotsOnExit(blocking, false)).toBe(false);
    expect(shouldBlockExpiredLotsOnExit(features({
      expiryTrackingEnabled: true,
      blockExpiredLotsOnExit: false
    }), true)).toBe(false);
    expect(shouldBlockExpiredLotsOnExit(features({
      expiryTrackingEnabled: false,
      blockExpiredLotsOnExit: true
    }), true)).toBe(false);
    expect(shouldBlockExpiredLotsOnExit(null, true)).toBe(false);
  });
});

describe('lineMissingWarehouseLots', () => {
  const tracked = features({ lotTrackingEnabled: true });

  it('blocks when stock exists but no warehouse lots are loaded', () => {
    expect(lineMissingWarehouseLots({
      trackingMode: TRACKING_MODE_LOT,
      features: tracked,
      quantity: 4,
      availableStock: 89,
      availability: { productId: 'p1', kind: 'lot', loaded: true, availableCount: 0 }
    })).toBe(true);
  });

  it('does not block when pickable lots exist', () => {
    expect(lineMissingWarehouseLots({
      trackingMode: TRACKING_MODE_LOT,
      features: tracked,
      quantity: 4,
      availableStock: 89,
      availability: { productId: 'p1', kind: 'lot', loaded: true, availableCount: 1 }
    })).toBe(false);
  });

  it('does not block before lots have loaded', () => {
    expect(lineMissingWarehouseLots({
      trackingMode: TRACKING_MODE_LOT,
      features: tracked,
      quantity: 4,
      availableStock: 89,
      availability: { productId: 'p1', kind: 'lot', loaded: false, availableCount: 0 }
    })).toBe(false);
  });
});

describe('lineBlockedByExpiredLots', () => {
  const tracked = features({ lotTrackingEnabled: true });

  it('is true when stock exists but only expired lots were excluded', () => {
    expect(lineBlockedByExpiredLots({
      trackingMode: TRACKING_MODE_LOT,
      features: tracked,
      quantity: 3,
      availableStock: 8,
      availability: {
        productId: 'p1',
        kind: 'lot',
        loaded: true,
        availableCount: 0,
        expiredExcludedCount: 2
      }
    })).toBe(true);
  });

  it('is false when there are simply no lots', () => {
    expect(lineBlockedByExpiredLots({
      trackingMode: TRACKING_MODE_LOT,
      features: tracked,
      quantity: 3,
      availableStock: 8,
      availability: { productId: 'p1', kind: 'lot', loaded: true, availableCount: 0 }
    })).toBe(false);
  });
});

describe('exitTraceabilityReady', () => {
  const tracked = features({ lotTrackingEnabled: true });

  it('is not ready until the editor has loaded lots', () => {
    expect(exitTraceabilityReady(TRACKING_MODE_LOT, tracked, 4, undefined)).toBe(false);
    expect(exitTraceabilityReady(
      TRACKING_MODE_LOT,
      tracked,
      4,
      { productId: 'p1', kind: 'lot', loaded: true, availableCount: 0 }
    )).toBe(true);
  });
});

describe('entryAllocationsValid', () => {
  const trackedFeatures = features({ lotTrackingEnabled: true, serialTrackingEnabled: true });

  it('returns true for untracked lines', () => {
    expect(entryAllocationsValid(TRACKING_MODE_NONE, 5, [], features())).toBe(true);
  });

  it('returns true when quantity is zero', () => {
    expect(entryAllocationsValid(TRACKING_MODE_LOT, 0, [], trackedFeatures)).toBe(true);
  });

  it('requires lot number and matching quantity for lot entry', () => {
    expect(entryAllocationsValid(
      TRACKING_MODE_LOT,
      10,
      [{ lotNumber: 'LOT-1', expiryDate: null, quantity: 10 }],
      trackedFeatures
    )).toBe(true);

    expect(entryAllocationsValid(
      TRACKING_MODE_LOT,
      10,
      [{ lotNumber: '', expiryDate: null, quantity: 10 }],
      trackedFeatures
    )).toBe(false);

    expect(entryAllocationsValid(
      TRACKING_MODE_LOT,
      10,
      [{ lotNumber: 'LOT-1', expiryDate: null, quantity: 5 }],
      trackedFeatures
    )).toBe(false);
  });

  it('requires one serial per unit for serial entry', () => {
    expect(entryAllocationsValid(
      TRACKING_MODE_SERIAL,
      2,
      [
        { lotNumber: '', expiryDate: null, quantity: 1, serialNumber: 'SN-1' },
        { lotNumber: '', expiryDate: null, quantity: 1, serialNumber: 'SN-2' }
      ],
      trackedFeatures
    )).toBe(true);

    expect(entryAllocationsValid(
      TRACKING_MODE_SERIAL,
      2,
      [{ lotNumber: '', expiryDate: null, quantity: 1, serialNumber: 'SN-1' }],
      trackedFeatures
    )).toBe(false);

    expect(entryAllocationsValid(
      TRACKING_MODE_SERIAL,
      1,
      [{ lotNumber: '', expiryDate: null, quantity: 1, serialNumber: '' }],
      trackedFeatures
    )).toBe(false);
  });

  it('returns false when lot tracking is disabled', () => {
    expect(entryAllocationsValid(
      TRACKING_MODE_LOT,
      5,
      [{ lotNumber: 'LOT-1', expiryDate: null, quantity: 5 }],
      features()
    )).toBe(true);
  });
});

describe('resolveEffectiveWarehouse', () => {
  const principal = { id: 'wh-1', name: 'Principal', isDefault: true };
  const secondary = { id: 'wh-2', name: 'Secondaire', isDefault: false };

  it('uses the document warehouse when it exists', () => {
    const result = resolveEffectiveWarehouse([principal, secondary], 'wh-2');
    expect(result.warehouse?.id).toBe('wh-2');
    expect(result.isDefaultFallback).toBe(false);
  });

  it('falls back to the default warehouse when the document has none', () => {
    const result = resolveEffectiveWarehouse([principal, secondary], null);
    expect(result.warehouse?.id).toBe('wh-1');
    expect(result.isDefaultFallback).toBe(true);
  });

  it('falls back to default when the document warehouse is unknown', () => {
    const result = resolveEffectiveWarehouse([principal, secondary], 'missing');
    expect(result.warehouse?.id).toBe('wh-1');
    expect(result.isDefaultFallback).toBe(true);
  });

  it('returns null when no warehouse can be resolved', () => {
    const result = resolveEffectiveWarehouse([secondary], null);
    expect(result.warehouse).toBeNull();
    expect(result.isDefaultFallback).toBe(false);
  });
});
