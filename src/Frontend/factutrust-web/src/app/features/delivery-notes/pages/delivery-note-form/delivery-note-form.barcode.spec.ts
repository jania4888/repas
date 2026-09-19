import { of } from 'rxjs';

import { ProductListItem } from '@core/services/product.service';
import { BarcodeLookupResult } from '@shared/services/barcode-lookup.service';
import { DeliveryNoteFormComponent } from './delivery-note-form.component';

function makeProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'p1',
    code: 'ART-001',
    name: 'Article livré',
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
 * Scan sur un bon de livraison.
 *
 * <p>
 * La quantité qui s'incrémente est la quantité <b>commandée</b>, pas la livrée : le bon se
 * prépare d'abord, puis se confronte au réel au moment de la livraison. Se tromper de champ
 * ferait sortir du stock ce qui n'a pas encore quitté l'entrepôt.
 * </p>
 *
 * <p>
 * Le contrôle de disponibilité reste celui du choix manuel — ni plus strict, ni plus permissif.
 * Rappel : l'article résolu par le socle ne porte pas de quantité disponible.
 * </p>
 */
describe('DeliveryNoteFormComponent — scan de code-barres', () => {
  let resolveSpy: jasmine.Spy;
  let reportSpy: jasmine.Spy;
  let successSpy: jasmine.Spy;
  let applySpy: jasmine.Spy;
  let quantityChangeSpy: jasmine.Spy;

  function createComponent(): DeliveryNoteFormComponent {
    const component = Object.create(
      DeliveryNoteFormComponent.prototype
    ) as DeliveryNoteFormComponent;

    component.lines = [];

    Object.defineProperty(component, 'barcodeLookup', { value: { resolve: resolveSpy } });
    Object.defineProperty(component, 'barcodeFeedback', {
      value: { success: successSpy, failure: jasmine.createSpy('failure'), report: reportSpy }
    });

    spyOn(component, 'createEmptyLine').and.callFake(
      () =>
        ({
          product: null,
          designation: '',
          description: '',
          orderedQuantity: 1,
          unit: '',
          unitPriceHT: 0,
          vatRatePercent: 0,
          discountPercent: null
        }) as never
    );

    applySpy = spyOn(
      component as unknown as { applyProductToLine(line: unknown, p: ProductListItem): void },
      'applyProductToLine'
    ).and.callFake((line: unknown, p: ProductListItem) => {
      (line as { product: ProductListItem }).product = p;
    });
    quantityChangeSpy = spyOn(component, 'onQuantityChange').and.stub();

    return component;
  }

  beforeEach(() => {
    successSpy = jasmine.createSpy('success');
    reportSpy = jasmine.createSpy('report');
    resolveSpy = jasmine.createSpy('resolve').and.returnValue(
      of({ status: 'found', code: '4006381333931', product: makeProduct(), message: '' } as BarcodeLookupResult)
    );
  });

  it('crée une ligne à la quantité commandée 1', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].orderedQuantity).toBe(1);
    expect(applySpy).toHaveBeenCalled();
    expect(successSpy).toHaveBeenCalled();
  });

  it('réutilise la ligne vierge ouverte avec le formulaire', () => {
    const component = createComponent();
    component.lines = [
      {
        product: null,
        designation: '',
        description: '',
        orderedQuantity: 1,
        unit: '',
        unitPriceHT: 0,
        vatRatePercent: 0,
        discountPercent: null
      } as never
    ];

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].product!.id).toBe('p1');
  });

  it('incrémente la quantité commandée au second scan', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');
    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].orderedQuantity).toBe(2);
    expect(quantityChangeSpy).toHaveBeenCalledWith(component.lines[0]);
  });

  it('ne crée aucune ligne quand le socle refuse l’article', () => {
    resolveSpy.and.returnValue(
      of({
        status: 'template',
        code: '4006381333931',
        product: null,
        message: 'Choisissez une variante (SKU).'
      } as BarcodeLookupResult)
    );
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(0);
    expect(reportSpy).toHaveBeenCalled();
    expect(successSpy).not.toHaveBeenCalled();
  });
});
