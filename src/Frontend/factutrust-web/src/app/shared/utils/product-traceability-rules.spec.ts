import { StockFeatures } from '@core/services/stock.service';
import {
  COSTING_AVERAGE,
  COSTING_FIFO,
  COSTING_LIFO,
  PICKING_FEFO,
  PICKING_NONE,
  TRACKING_MODE_LOT,
  TRACKING_MODE_NONE,
  TRACKING_MODE_SERIAL
} from './stock-traceability.utils';
import {
  DEFAULT_TRACEABILITY_STATE,
  formatCostingMethodLabel,
  getCostingMethodOptions,
  getPickingPolicyOptions,
  getTrackingModeOptions,
  isTraceabilityEditable,
  isTraceabilitySectionVisible,
  normalizeTraceabilityForm,
  showCostingMethodDropdown,
  showExpiryFields,
  showPickingField
} from './product-traceability-rules';

function features(overrides: Partial<StockFeatures> = {}): StockFeatures {
  return {
    lotTrackingEnabled: false,
    serialTrackingEnabled: false,
    expiryTrackingEnabled: false,
    productVariantsEnabled: false,
    fifoLifoValuationEnabled: false,
    blockExpiredLotsOnExit: true,
    strictTrackedAllocation: true,
    ...overrides
  };
}

describe('product-traceability-rules', () => {
  const allFeatures = features({
    lotTrackingEnabled: true,
    serialTrackingEnabled: true,
    expiryTrackingEnabled: true,
    fifoLifoValuationEnabled: true
  });

  it('shows section only for Produit with at least one flag', () => {
    expect(isTraceabilitySectionVisible('Produit', allFeatures, true)).toBe(true);
    expect(isTraceabilitySectionVisible('Service', allFeatures, true)).toBe(false);
    expect(isTraceabilitySectionVisible('Produit', features(), true)).toBe(false);
  });

  it('filters tracking options by feature flags', () => {
    const opts = getTrackingModeOptions(features({ lotTrackingEnabled: true }));
    expect(opts.map(o => o.value)).toEqual([TRACKING_MODE_NONE, TRACKING_MODE_LOT]);
  });

  it('hides picking when tracking is none or serial', () => {
    expect(showPickingField(TRACKING_MODE_NONE)).toBe(false);
    expect(showPickingField(TRACKING_MODE_SERIAL)).toBe(false);
    expect(showPickingField(TRACKING_MODE_LOT)).toBe(true);
  });

  it('disables FEFO without expiry tracking', () => {
    const opts = getPickingPolicyOptions(TRACKING_MODE_LOT, false);
    const fefo = opts.find(o => o.value === PICKING_FEFO);
    expect(fefo?.disabled).toBe(true);
  });

  it('normalizes traceability when stock management is off', () => {
    const result = normalizeTraceabilityForm(
      {
        category: 'Produit',
        isStockManaged: false,
        trackingMode: TRACKING_MODE_LOT,
        hasExpiryTracking: true,
        pickingPolicy: PICKING_FEFO,
        costingMethod: COSTING_FIFO,
        expiryAlertDays: 10
      },
      allFeatures
    );
    expect(result.state).toEqual(DEFAULT_TRACEABILITY_STATE);
  });

  it('downgrades FEFO to FIFO physical when expiry is off', () => {
    const result = normalizeTraceabilityForm(
      {
        category: 'Produit',
        isStockManaged: true,
        trackingMode: TRACKING_MODE_LOT,
        hasExpiryTracking: false,
        pickingPolicy: PICKING_FEFO,
        costingMethod: 0,
        expiryAlertDays: null
      },
      allFeatures
    );
    expect(result.fefoDowngraded).toBe(true);
    expect(result.state.pickingPolicy).toBe(2);
  });

  it('returns CMUP-only costing when fifo/lifo flag is off', () => {
    const opts = getCostingMethodOptions(features(), false, 0);
    expect(opts).toEqual([{ label: 'CMUP', value: 0 }]);
    expect(showCostingMethodDropdown(features())).toBe(false);
  });

  it('locks CMUP in edit mode when original was FIFO', () => {
    const opts = getCostingMethodOptions(allFeatures, true, COSTING_FIFO);
    const cmup = opts.find(o => o.value === 0);
    expect(cmup?.disabled).toBe(true);
  });

  it('shows expiry fields for lot when flag enabled', () => {
    expect(showExpiryFields(TRACKING_MODE_LOT, allFeatures)).toBe(true);
    expect(showExpiryFields(TRACKING_MODE_LOT, features())).toBe(false);
  });

  it('isTraceabilityEditable requires product and stock', () => {
    expect(isTraceabilityEditable('Produit', true)).toBe(true);
    expect(isTraceabilityEditable('Produit', false)).toBe(false);
  });

  // Régression : l'API renvoie les énums en chaînes PascalCase (JsonStringEnumConverter).
  // Une chaîne 'Fifo' non coercée retombait en CMUP et corrompait la fiche au ré-enregistrement.
  it('preserves FIFO when costing arrives as an API PascalCase string', () => {
    const result = normalizeTraceabilityForm(
      {
        category: 'Produit',
        isStockManaged: true,
        trackingMode: TRACKING_MODE_NONE,
        hasExpiryTracking: false,
        pickingPolicy: PICKING_NONE,
        costingMethod: 'Fifo' as unknown as number,
        expiryAlertDays: null
      },
      allFeatures
    );
    expect(result.state.costingMethod).toBe(COSTING_FIFO);
  });

  it('locks CMUP in edit mode when original was the FIFO API string', () => {
    const opts = getCostingMethodOptions(allFeatures, true, 'Fifo' as unknown as number);
    const cmup = opts.find(o => o.value === 0);
    expect(cmup?.disabled).toBe(true);
  });

  it('labels costing methods from both numbers and API strings', () => {
    expect(formatCostingMethodLabel(COSTING_FIFO)).toBe('FIFO');
    expect(formatCostingMethodLabel(COSTING_LIFO)).toBe('LIFO');
    expect(formatCostingMethodLabel(COSTING_AVERAGE)).toBe('CMUP');
    expect(formatCostingMethodLabel('Fifo')).toBe('FIFO');
    expect(formatCostingMethodLabel('Lifo')).toBe('LIFO');
    expect(formatCostingMethodLabel('Average')).toBe('CMUP');
  });

  it('resets picking when tracking mode is none', () => {
    const result = normalizeTraceabilityForm(
      {
        category: 'Produit',
        isStockManaged: true,
        trackingMode: TRACKING_MODE_NONE,
        hasExpiryTracking: false,
        pickingPolicy: PICKING_FEFO,
        costingMethod: 0,
        expiryAlertDays: null
      },
      allFeatures
    );
    expect(result.state.pickingPolicy).toBe(PICKING_NONE);
  });
});
