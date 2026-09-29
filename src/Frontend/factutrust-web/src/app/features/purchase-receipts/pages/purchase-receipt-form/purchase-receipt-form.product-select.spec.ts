import { signal } from '@angular/core';
import { AutoCompleteSelectEvent } from 'primeng/autocomplete';

import { ProductListItem } from '@core/services/product.service';
import { suggestionToListItem } from '@shared/services/product-autocomplete.service';
import { PurchaseReceiptFormComponent } from './purchase-receipt-form.component';

function makeProductListItem(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'p-table',
    code: 'TAB',
    name: 'Table',
    description: null,
    typeDisplay: 'Produit',
    categoryId: 'c1',
    category: 'Cat',
    unitPrice: 75,
    purchasePrice: 50,
    unit: 'Unité',
    vatRate: 19,
    isActive: true,
    isStockManaged: true,
    ...overrides
  };
}

describe('PurchaseReceiptFormComponent — sélection produit', () => {
  let recalcSpy: jasmine.Spy;
  let loadTraceabilitySpy: jasmine.Spy;

  function createComponent(): PurchaseReceiptFormComponent {
    const component = Object.create(
      PurchaseReceiptFormComponent.prototype
    ) as PurchaseReceiptFormComponent;

    component.lines = [];
    Object.defineProperty(component, 'traceabilityByProduct', {
      value: signal(new Map<string, { trackingMode: number; pickingPolicy: number }>())
    });

    loadTraceabilitySpy = spyOn(
      component as unknown as { loadTraceabilityContext(): void },
      'loadTraceabilityContext'
    ).and.stub();
    recalcSpy = spyOn(component, 'recalculateTotals').and.stub();

    spyOn(
      component as unknown as { defaultAllocationsForProduct(): unknown },
      'defaultAllocationsForProduct'
    ).and.returnValue([{ quantity: 1 }]);

    return component;
  }

  it('onProductSelect applique le prix d’achat HT, pas le prix de vente', () => {
    const component = createComponent();
    const line: {
      product: ProductListItem | null;
      productId: string | null;
      productCode: string;
      productName: string;
      designation: string;
      unit: string;
      orderedQuantity: number;
      receivedQuantity: number;
      alreadyReceivedQuantity: number;
      unitPriceHT: number;
      discountPercent: number | null;
      vatRate: number;
      purchaseOrderLineId: string | null;
      trackingMode: number;
      pickingPolicy: number;
      lotAllocations: unknown[];
    } = {
      product: null,
      productId: null,
      productCode: '',
      productName: '',
      designation: '',
      unit: '',
      orderedQuantity: 0,
      receivedQuantity: 1,
      alreadyReceivedQuantity: 0,
      unitPriceHT: 0,
      discountPercent: null,
      vatRate: 19,
      purchaseOrderLineId: null,
      trackingMode: 0,
      pickingPolicy: 0,
      lotAllocations: []
    };
    component.lines.push(line as never);

    const fromAutocomplete = suggestionToListItem({
      id: 'p-table',
      code: 'TAB',
      name: 'Table',
      unitPrice: 75,
      purchasePrice: 50,
      vatRate: 19,
      unit: 'Unité',
      isFodecApplicable: false,
      isDiscountEnabled: false,
      maxDiscountPercent: null
    });

    component.onProductSelect(line as never, {
      value: fromAutocomplete
    } as AutoCompleteSelectEvent);

    expect(line.unitPriceHT).toBe(50);
    expect(line.productId).toBe('p-table');
    expect(recalcSpy).toHaveBeenCalled();
    expect(loadTraceabilitySpy).toHaveBeenCalled();
  });

  it('onProductSelect retombe sur le prix de vente si le prix d’achat est absent', () => {
    const component = createComponent();
    const line: {
      product: ProductListItem | null;
      productId: string | null;
      productCode: string;
      productName: string;
      designation: string;
      unit: string;
      orderedQuantity: number;
      receivedQuantity: number;
      alreadyReceivedQuantity: number;
      unitPriceHT: number;
      discountPercent: number | null;
      vatRate: number;
      purchaseOrderLineId: string | null;
      trackingMode: number;
      pickingPolicy: number;
      lotAllocations: unknown[];
    } = {
      product: null,
      productId: null,
      productCode: '',
      productName: '',
      designation: '',
      unit: '',
      orderedQuantity: 0,
      receivedQuantity: 1,
      alreadyReceivedQuantity: 0,
      unitPriceHT: 0,
      discountPercent: null,
      vatRate: 19,
      purchaseOrderLineId: null,
      trackingMode: 0,
      pickingPolicy: 0,
      lotAllocations: []
    };
    component.lines.push(line as never);

    component.onProductSelect(line as never, {
      value: makeProductListItem({ purchasePrice: null, unitPrice: 95 })
    } as AutoCompleteSelectEvent);

    expect(line.unitPriceHT).toBe(95);
  });
});
