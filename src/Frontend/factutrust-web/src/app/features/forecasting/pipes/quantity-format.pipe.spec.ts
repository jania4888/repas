import { QuantityFormatPipe } from './quantity-format.pipe';

describe('QuantityFormatPipe', () => {
  let pipe: QuantityFormatPipe;

  beforeEach(() => { pipe = new QuantityFormatPipe(); });

  it('returns "0" for null/undefined/NaN/Infinity', () => {
    expect(pipe.transform(null, 'Kg')).toBe('0');
    expect(pipe.transform(undefined, 'Kg')).toBe('0');
    expect(pipe.transform(Number.NaN, 'Kg')).toBe('0');
    expect(pipe.transform(Number.POSITIVE_INFINITY, 'Kg')).toBe('0');
  });

  it('rounds discrete units (Pièce, Unité, Pcs) to integers — no decimals', () => {
    expect(pipe.transform(10, 'Pièce')).toBe('10');
    expect(pipe.transform(10, 'piece')).toBe('10');
    expect(pipe.transform(10, 'Unité')).toBe('10');
    expect(pipe.transform(10, 'unite')).toBe('10');
    expect(pipe.transform(10, 'Pcs')).toBe('10');
  });

  it('formats continuous units with 2 decimals and French locale (comma)', () => {
    expect(pipe.transform(12.5, 'Kg')).toBe('12,50');
    expect(pipe.transform(0.56, 'Litre')).toBe('0,56');
    // Le séparateur de milliers fr-FR est un espace insécable (U+202F/U+00A0 selon la version d'ICU) —
    // \s (en JS) matche ces variantes : on normalise en espace ordinaire pour ne tester que le format.
    expect(pipe.transform(1234.5, 'm²').replace(/\s/g, ' ')).toBe('1 234,50');
  });

  it('treats null/unknown unit as continuous (2 decimals)', () => {
    expect(pipe.transform(7, null)).toBe('7,00');
    expect(pipe.transform(7, undefined)).toBe('7,00');
    expect(pipe.transform(7, 'foo')).toBe('7,00');
  });

  it('exposes a static helper isDiscreteUnit', () => {
    expect(QuantityFormatPipe.isDiscreteUnit('Pièce')).toBe(true);
    expect(QuantityFormatPipe.isDiscreteUnit('  PCS  ')).toBe(true);
    expect(QuantityFormatPipe.isDiscreteUnit('Kg')).toBe(false);
    expect(QuantityFormatPipe.isDiscreteUnit(null)).toBe(false);
  });

  it('toEditableQuantity rounds discrete units to integers', () => {
    expect(QuantityFormatPipe.toEditableQuantity(569.74, 'Pièce')).toBe(570);
    expect(QuantityFormatPipe.toEditableQuantity(10.4, 'Pcs')).toBe(10);
  });

  it('toEditableQuantity rounds continuous units to 2 decimals', () => {
    expect(QuantityFormatPipe.toEditableQuantity(12.556, 'Kg')).toBe(12.56);
    expect(QuantityFormatPipe.toEditableQuantity(7, null)).toBe(7);
  });
});
