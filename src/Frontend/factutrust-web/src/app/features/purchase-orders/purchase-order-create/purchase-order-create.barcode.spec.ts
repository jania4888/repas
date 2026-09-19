import { of } from 'rxjs';

import { ProductListItem } from '@core/services/product.service';
import { BarcodeLookupResult } from '@shared/services/barcode-lookup.service';
import { PurchaseOrderCreateComponent } from './purchase-order-create.component';

function makeProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'p1',
    code: 'ART-001',
    name: 'Article commandé',
    description: null,
    typeDisplay: 'Produit',
    categoryId: 'c1',
    category: 'Cat',
    unitPrice: 100,
    purchasePrice: 70,
    unit: 'Unité',
    vatRate: 19,
    isActive: true,
    isStockManaged: true,
    ...overrides
  };
}

/**
 * Scan sur une commande fournisseur.
 *
 * <p>
 * Les services sont acceptés : une commande fournisseur peut légitimement porter une
 * prestation. Les seuls refus viennent du socle de résolution — article désactivé, modèle de
 * variantes — et cet écran n'en ajoute aucun.
 * </p>
 */
describe('PurchaseOrderCreateComponent — scan de code-barres', () => {
  let resolveSpy: jasmine.Spy;
  let reportSpy: jasmine.Spy;
  let successSpy: jasmine.Spy;
  let productChangeSpy: jasmine.Spy;
  let recalcLineSpy: jasmine.Spy;

  function createComponent(): PurchaseOrderCreateComponent {
    const component = Object.create(
      PurchaseOrderCreateComponent.prototype
    ) as PurchaseOrderCreateComponent;

    component.lines = [];

    Object.defineProperty(component, 'barcodeLookup', { value: { resolve: resolveSpy } });
    Object.defineProperty(component, 'barcodeFeedback', {
      value: { success: successSpy, failure: jasmine.createSpy('failure'), report: reportSpy }
    });

    spyOn(component, 'addLine').and.callFake(() => {
      component.lines.push({
        product: null,
        quantity: 1,
        unitPriceHT: 0,
        vatRate: 19,
        subTotal: 0,
        vatAmount: 0,
        total: 0
      } as never);
    });

    // Déjà couverts par les tests de la grille : on mesure ici l'aiguillage du scan, pas le calcul.
    productChangeSpy = spyOn(component, 'onProductChange').and.stub();
    recalcLineSpy = spyOn(component, 'recalculateLine').and.stub();

    return component;
  }

  beforeEach(() => {
    successSpy = jasmine.createSpy('success');
    reportSpy = jasmine.createSpy('report');
    resolveSpy = jasmine.createSpy('resolve').and.returnValue(
      of({ status: 'found', code: '4006381333931', product: makeProduct(), message: '' } as BarcodeLookupResult)
    );
  });

  it('crée une ligne et applique le produit', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].product!.id).toBe('p1');
    expect(component.lines[0].quantity).toBe(1);
    expect(productChangeSpy).toHaveBeenCalledOnceWith(0);
    expect(successSpy).toHaveBeenCalled();
  });

  it('réutilise la ligne vierge plutôt que d’en empiler une nouvelle', () => {
    // Le formulaire s'ouvre avec une ligne vide : un premier scan ne doit pas laisser cette
    // ligne orpheline au-dessus de la sienne.
    const component = createComponent();
    component.lines = [
      { product: null, quantity: 1, unitPriceHT: 0, vatRate: 19, subTotal: 0, vatAmount: 0, total: 0 } as never
    ];

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].product!.id).toBe('p1');
  });

  it('incrémente la quantité au second scan du même article', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');
    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].quantity).toBe(2);
    expect(recalcLineSpy).toHaveBeenCalledWith(0);
  });

  it('accepte un service', () => {
    resolveSpy.and.returnValue(
      of({
        status: 'found',
        code: '4006381333931',
        product: makeProduct({ isStockManaged: false, typeDisplay: 'Service' }),
        message: ''
      } as BarcodeLookupResult)
    );
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
  });

  it('ne crée aucune ligne quand le socle refuse l’article', () => {
    resolveSpy.and.returnValue(
      of({
        status: 'template',
        code: '4006381333931',
        product: null,
        message: 'Choisissez une variante.'
      } as BarcodeLookupResult)
    );
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(0);
    expect(reportSpy).toHaveBeenCalled();
    expect(successSpy).not.toHaveBeenCalled();
  });
});
