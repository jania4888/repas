import {
  COSTING_AVERAGE,
  COSTING_FIFO,
  COSTING_LIFO,
  coerceCostingMethod,
  isLiveTracked,
  requiresLayeredCosting
} from './stock-traceability.utils';
import type { StockFeatures } from '@core/services/stock.service';

const features = (overrides: Partial<StockFeatures> = {}): StockFeatures => ({
  lotTrackingEnabled: false,
  serialTrackingEnabled: false,
  expiryTrackingEnabled: false,
  productVariantsEnabled: false,
  fifoLifoValuationEnabled: false,
  blockExpiredLotsOnExit: true,
  strictTrackedAllocation: true,
  ...overrides
} as StockFeatures);

describe('coerceCostingMethod', () => {
  // L'API sérialise les énums par NOM. Les tests qui n'envoyaient que des nombres ont laissé
  // passer la régression où le repère de méthode restait muet sur la liste de stock.
  it('accepts the names the API actually sends', () => {
    expect(coerceCostingMethod('Fifo')).toBe(COSTING_FIFO);
    expect(coerceCostingMethod('Lifo')).toBe(COSTING_LIFO);
    expect(coerceCostingMethod('Average')).toBe(COSTING_AVERAGE);
  });

  it('accepts numbers and falls back to CMUP for anything else', () => {
    expect(coerceCostingMethod(1)).toBe(COSTING_FIFO);
    expect(coerceCostingMethod(2)).toBe(COSTING_LIFO);
    expect(coerceCostingMethod(0)).toBe(COSTING_AVERAGE);
    expect(coerceCostingMethod(undefined)).toBe(COSTING_AVERAGE);
    expect(coerceCostingMethod('n/importe quoi')).toBe(COSTING_AVERAGE);
  });
});

describe('requiresLayeredCosting', () => {
  // Miroir de StockCostingPolicy côté serveur : les six combinaisons doivent concorder, sinon
  // l'écran annoncerait une valorisation par couches que le moteur n'applique pas.
  const cases: ReadonlyArray<[unknown, boolean, boolean]> = [
    ['Average', true, false],
    ['Average', false, false],
    ['Fifo', true, true],
    ['Fifo', false, false],
    ['Lifo', true, true],
    ['Lifo', false, false]
  ];

  cases.forEach(([method, flag, expected]) => {
    it(`${method} with the flag ${flag ? 'on' : 'off'} is ${expected}`, () => {
      expect(requiresLayeredCosting(method, features({ fifoLifoValuationEnabled: flag }))).toBe(expected);
    });
  });

  it('is false without features', () => {
    expect(requiresLayeredCosting('Fifo', null)).toBeFalse();
  });
});

describe('isLiveTracked', () => {
  it('delegates the costing half to the shared rule', () => {
    expect(isLiveTracked('None', 'Fifo', features({ fifoLifoValuationEnabled: true }))).toBeTrue();
    expect(isLiveTracked('None', 'Fifo', features({ fifoLifoValuationEnabled: false }))).toBeFalse();
  });

  it('still tracks on lot and serial independently of the costing method', () => {
    expect(isLiveTracked('Lot', 'Average', features({ lotTrackingEnabled: true }))).toBeTrue();
    expect(isLiveTracked('Serial', 'Average', features({ serialTrackingEnabled: true }))).toBeTrue();
  });
});
