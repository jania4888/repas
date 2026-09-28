import {
  PAYMENT_TERM_DAY_OPTIONS,
  PAYMENT_TERM_DAY_VALUES,
  PRODUCT_CATEGORY_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
  PRODUCT_UNIT_OPTIONS,
  PRODUCT_UNIT_VALUES,
  PRODUCT_VAT_OPTIONS,
  SUPPLIER_PAYMENT_METHOD_OPTIONS,
  SUPPLIER_PAYMENT_METHOD_VALUES,
} from './coded-option-labels';

describe('coded option values', () => {
  it('keeps product type values in French for the API', () => {
    expect(PRODUCT_TYPE_OPTIONS.map(o => o.value)).toEqual(['Produit', 'Service']);
    expect(PRODUCT_CATEGORY_OPTIONS.map(o => o.value)).toEqual(['Produit', 'Service', 'Abonnement']);
  });

  it('keeps product unit values equal to the stored French codes', () => {
    expect(PRODUCT_UNIT_OPTIONS.map(o => o.value)).toEqual([...PRODUCT_UNIT_VALUES]);
  });

  it('keeps VAT option values numeric', () => {
    expect(PRODUCT_VAT_OPTIONS.map(o => o.value)).toEqual([19, 13, 7, 0]);
  });

  it('keeps payment term day values numeric', () => {
    expect(PAYMENT_TERM_DAY_OPTIONS.map(o => o.value)).toEqual([...PAYMENT_TERM_DAY_VALUES]);
  });

  it('keeps supplier payment method values equal to the posted French labels', () => {
    expect(SUPPLIER_PAYMENT_METHOD_OPTIONS.map(o => o.value)).toEqual([...SUPPLIER_PAYMENT_METHOD_VALUES]);
  });
});
