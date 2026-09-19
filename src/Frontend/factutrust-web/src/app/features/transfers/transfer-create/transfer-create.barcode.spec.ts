import { of } from 'rxjs';

import { ProductListItem } from '@core/services/product.service';
import { BarcodeLookupResult } from '@shared/services/barcode-lookup.service';
import { TransferCreateComponent } from './transfer-create.component';

function makeProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'p1',
    code: 'ART-001',
    name: 'Article transféré',
    description: null,
    typeDisplay: 'Produit',
    categoryId: 'c1',
    category: 'Cat',
    unitPrice: 100,
    unit: 'Unité',
    vatRate: 19,
    isActive: true,
    isStockManaged: true,
    ...overrides
  };
}

/**
 * Scan sur un transfert inter-dépôts.
 *
 * <p>
 * Deux exigences propres à cet écran. D'abord, seuls les articles <b>gérés en stock</b> sont
 * recevables : on ne transfère pas une prestation. Ensuite, la disponibilité s'évalue sur
 * l'entrepôt <b>source</b>, celui d'où part la marchandise — l'interroger sur la destination
 * afficherait un disponible qui n'a rien à voir avec ce qu'on peut réellement expédier.
 * </p>
 */
describe('TransferCreateComponent — scan de code-barres', () => {
  let resolveSpy: jasmine.Spy;
  let reportSpy: jasmine.Spy;
  let successSpy: jasmine.Spy;

  function createComponent(): TransferCreateComponent {
    const component = Object.create(TransferCreateComponent.prototype) as TransferCreateComponent;

    component.lines = [];
    component.selectedProduct = null;
    component.selectedQuantity = 1;
    component.sourceWarehouseId = 'wh-source';
    component.destinationWarehouseId = 'wh-dest';

    Object.defineProperty(component, 'barcodeLookup', { value: { resolve: resolveSpy } });
    Object.defineProperty(component, 'barcodeFeedback', {
      value: { success: successSpy, failure: jasmine.createSpy('failure'), report: reportSpy }
    });

    spyOn(component, 'addLine').and.callFake(() => {
      const product = component.selectedProduct!;
      component.lines.push({
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        unit: product.unit || 'Unité',
        requestedQuantity: component.selectedQuantity,
        notes: ''
      } as never);
      component.selectedProduct = null;
      component.selectedQuantity = 1;
    });

    return component;
  }

  beforeEach(() => {
    successSpy = jasmine.createSpy('success');
    reportSpy = jasmine.createSpy('report');
    resolveSpy = jasmine.createSpy('resolve').and.returnValue(
      of({ status: 'found', code: '4006381333931', product: makeProduct(), message: '' } as BarcodeLookupResult)
    );
  });

  it('évalue la disponibilité sur l’entrepôt SOURCE', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(resolveSpy).toHaveBeenCalledWith(
      '4006381333931',
      jasmine.objectContaining({ warehouseId: 'wh-source' })
    );
  });

  it('exige un article géré en stock', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(resolveSpy).toHaveBeenCalledWith(
      '4006381333931',
      jasmine.objectContaining({ requireStockManaged: true })
    );
  });

  it('ajoute une ligne à la quantité 1', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].productId).toBe('p1');
    expect(component.lines[0].requestedQuantity).toBe(1);
    expect(successSpy).toHaveBeenCalled();
  });

  it('incrémente la quantité demandée au second scan', () => {
    // La saisie manuelle refuse un doublon ; au scan, l'incrément est le geste attendu quand
    // on passe dix cartons identiques devant la douchette.
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');
    component.onBarcodeScanned('4006381333931');
    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].requestedQuantity).toBe(3);
  });

  it('laisse la zone d’ajout vide après le scan', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.selectedProduct).toBeNull();
    expect(component.selectedQuantity).toBe(1);
  });

  it('n’ajoute rien quand l’article n’est pas géré en stock', () => {
    resolveSpy.and.returnValue(
      of({
        status: 'not_stock_managed',
        code: '4006381333931',
        product: null,
        message: 'L’article n’est pas géré en stock.'
      } as BarcodeLookupResult)
    );
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(0);
    expect(reportSpy).toHaveBeenCalled();
    expect(successSpy).not.toHaveBeenCalled();
  });
});
