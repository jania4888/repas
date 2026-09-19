import { of } from 'rxjs';

import { ProductListItem } from '@core/services/product.service';
import { BarcodeLookupResult } from '@shared/services/barcode-lookup.service';
import { QuoteFormComponent } from './quote-form.component';

function makeProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'p1',
    code: 'ART-001',
    name: 'Article devisé',
    description: null,
    typeDisplay: 'Produit',
    categoryId: 'c1',
    category: 'Cat',
    unitPrice: 100,
    unit: 'Unité',
    vatRate: 19,
    isActive: true,
    isStockManaged: true,
    quantityAvailable: 0,
    ...overrides
  };
}

/**
 * Scan sur un devis.
 *
 * <p>
 * Un devis ne mouvemente pas le stock : un article en rupture peut parfaitement y figurer,
 * puisque le but est justement de s'engager sur du réapprovisionnement. Aucun contrôle de
 * disponibilité ne doit donc s'y glisser — l'ajouter « par prudence » empêcherait de deviser ce
 * qui n'est pas encore en rayon.
 * </p>
 */
describe('QuoteFormComponent — scan de code-barres', () => {
  let resolveSpy: jasmine.Spy;
  let reportSpy: jasmine.Spy;
  let successSpy: jasmine.Spy;
  let applySpy: jasmine.Spy;
  let quantityChangeSpy: jasmine.Spy;

  function createComponent(): QuoteFormComponent {
    const component = Object.create(QuoteFormComponent.prototype) as QuoteFormComponent;

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
          quantity: 1,
          unit: 'unité',
          unitPrice: 0,
          priceOverridden: false,
          vatRatePercent: 19
        }) as never
    );

    // La tarification a ses propres tests : on mesure ici l'aiguillage du scan.
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

  it('crée une ligne à la quantité 1 et applique le produit', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].quantity).toBe(1);
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
        quantity: 1,
        unit: 'unité',
        unitPrice: 0,
        priceOverridden: false,
        vatRatePercent: 19
      } as never
    ];

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].product!.id).toBe('p1');
  });

  it('incrémente la quantité au second scan et relance la tarification', () => {
    // Le prix peut dépendre de paliers de quantité : sauter la retarification afficherait un
    // total que le serveur ne confirmerait pas.
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');
    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].quantity).toBe(2);
    expect(quantityChangeSpy).toHaveBeenCalledWith(component.lines[0]);
  });

  it('n’impose aucun contrôle de disponibilité', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    const options = resolveSpy.calls.mostRecent().args[1];
    expect(options?.requireStockManaged).toBeUndefined();
    expect(component.lines.length).toBe(1);
  });

  it('ne crée aucune ligne quand le socle refuse l’article', () => {
    resolveSpy.and.returnValue(
      of({
        status: 'inactive',
        code: '4006381333931',
        product: null,
        message: 'Article désactivé.'
      } as BarcodeLookupResult)
    );
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(0);
    expect(reportSpy).toHaveBeenCalled();
  });
});
