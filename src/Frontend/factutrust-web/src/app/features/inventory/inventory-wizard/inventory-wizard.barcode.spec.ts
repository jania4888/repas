import { signal } from '@angular/core';
import { of } from 'rxjs';

import { ProductListItem } from '@core/services/product.service';
import { BarcodeLookupResult } from '@shared/services/barcode-lookup.service';
import { InventoryWizardComponent } from './inventory-wizard.component';

function makeProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'p1',
    code: 'ART-001',
    name: 'Article compté',
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
 * Scan pendant un comptage d'inventaire.
 *
 * <p>
 * L'inventaire est le seul écran où le scan ne CRÉE rien. Son périmètre est arrêté à
 * l'ouverture : y ajouter une ligne fausserait l'écart entre théorique et compté, qui est
 * précisément ce que l'inventaire mesure. Le scan sert à se positionner, pas à saisir.
 * </p>
 */
describe('InventoryWizardComponent — scan de code-barres', () => {
  let resolveSpy: jasmine.Spy;
  let reportSpy: jasmine.Spy;
  let failureSpy: jasmine.Spy;
  let successSpy: jasmine.Spy;
  let navigateSpy: jasmine.Spy;

  function createComponent(
    step: 'start' | 'count' | 'summary' | 'success' = 'count',
    productIds: string[] = ['p1', 'p2']
  ): InventoryWizardComponent {
    const component = Object.create(InventoryWizardComponent.prototype) as InventoryWizardComponent;

    component.step = signal(step) as InventoryWizardComponent['step'];
    component.activeInventory = signal({
      warehouseId: 'wh-1',
      products: productIds.map((id, index) => ({
        productId: id,
        productName: `Article ${index}`,
        productCode: `ART-00${index}`,
        theoreticalQuantity: 10,
        countedQuantity: null,
        isCounted: false
      }))
    }) as unknown as InventoryWizardComponent['activeInventory'];

    Object.defineProperty(component, 'barcodeLookup', { value: { resolve: resolveSpy } });
    Object.defineProperty(component, 'barcodeFeedback', {
      value: { success: successSpy, failure: failureSpy, report: reportSpy }
    });

    navigateSpy = spyOn(component, 'navigateToProduct');
    return component;
  }

  function found(product: ProductListItem): BarcodeLookupResult {
    return { status: 'found', code: '4006381333931', product, message: '' };
  }

  beforeEach(() => {
    successSpy = jasmine.createSpy('success');
    failureSpy = jasmine.createSpy('failure');
    reportSpy = jasmine.createSpy('report');
    resolveSpy = jasmine.createSpy('resolve').and.returnValue(of(found(makeProduct())));
  });

  it('amène directement sur l’article scanné', () => {
    const component = createComponent('count', ['p0', 'p1', 'p2']);

    component.onBarcodeScanned('4006381333931');

    expect(navigateSpy).toHaveBeenCalledOnceWith(1);
    expect(successSpy).toHaveBeenCalled();
  });

  it('transmet l’entrepôt de l’inventaire au socle de résolution', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(resolveSpy).toHaveBeenCalledWith(
      '4006381333931',
      jasmine.objectContaining({ warehouseId: 'wh-1' })
    );
  });

  it('refuse un article hors du périmètre de l’inventaire, sans l’ajouter', () => {
    // Le point central : le périmètre est figé à l'ouverture. Ajouter une ligne au vol
    // fausserait l'écart théorique/compté, qui est tout l'objet de l'inventaire.
    resolveSpy.and.returnValue(of(found(makeProduct({ id: 'inconnu' }))));
    const component = createComponent('count', ['p1', 'p2']);

    component.onBarcodeScanned('4006381333931');

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(failureSpy).toHaveBeenCalled();
    expect(failureSpy.calls.mostRecent().args[1]).toBe('Hors périmètre');
    expect(component.activeInventory()!.products.length).toBe(2);
  });

  it('ne fait rien hors de l’étape de comptage', () => {
    const component = createComponent('summary');

    component.onBarcodeScanned('4006381333931');

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('signale un code inconnu sans se déplacer', () => {
    resolveSpy.and.returnValue(
      of({
        status: 'not_found',
        code: 'INCONNU',
        product: null,
        message: 'Aucun article ne correspond.'
      } as BarcodeLookupResult)
    );
    const component = createComponent();

    component.onBarcodeScanned('INCONNU');

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(reportSpy).toHaveBeenCalled();
  });
});
