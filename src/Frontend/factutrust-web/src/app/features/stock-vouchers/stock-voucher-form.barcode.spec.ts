import { signal } from '@angular/core';
import { of } from 'rxjs';

import { ProductListItem } from '@core/services/product.service';
import { BarcodeLookupResult } from '@shared/services/barcode-lookup.service';
import { StockVoucherFormComponent } from './stock-voucher-form.component';

function makeProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'p1',
    code: 'TAB001',
    name: 'Table de bureau',
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
 * Scan sur un bon d'entrée / de sortie.
 *
 * <p>
 * C'est l'écran au garde-fou le plus strict du chantier : un bon de stock ne peut porter que
 * des articles gérés en stock. La douchette ne doit surtout pas devenir un moyen de le
 * contourner — un mouvement de stock sur un service laisserait une écriture sans contrepartie
 * physique.
 * </p>
 *
 * <p>
 * On instancie le composant sans TestBed, comme le fait déjà
 * <c>stock-voucher-form.component.spec.ts</c> : le but est de mesurer la règle métier, pas le
 * rendu.
 * </p>
 */
describe('StockVoucherFormComponent — scan de code-barres', () => {
  let resolveSpy: jasmine.Spy;
  let successSpy: jasmine.Spy;
  let reportSpy: jasmine.Spy;
  let failureSpy: jasmine.Spy;
  let addLineSpy: jasmine.Spy;

  function createComponent(isEntry = true): StockVoucherFormComponent {
    const component = Object.create(StockVoucherFormComponent.prototype) as StockVoucherFormComponent;
    Object.defineProperty(component, 'isEntry', { value: isEntry });
    component.warehouseId = 'wh-1';
    component.lines = [];
    component.submitting = signal(false);
    component.selectedProduct = null;
    component.selectedQuantity = 1;

    Object.defineProperty(component, 'barcodeLookup', {
      value: { resolve: resolveSpy }
    });
    Object.defineProperty(component, 'barcodeFeedback', {
      value: { success: successSpy, failure: failureSpy, report: reportSpy }
    });

    addLineSpy = spyOn(component, 'addLine').and.callFake(() => {
      const product = component.selectedProduct!;
      component.lines.push({
        id: null,
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        unit: product.unit,
        quantity: component.selectedQuantity,
        unitCost: 0,
        notes: '',
        trackingMode: 0,
        pickingPolicy: 0,
        hasExpiryTracking: false,
        lotAllocations: []
      });
      component.selectedProduct = null;
      component.selectedQuantity = 1;
    });

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

  it('exige un article géré en stock auprès du socle de résolution', () => {
    // Le garde-fou n'est pas réimplémenté ici : il est délégué au socle, à condition de le
    // lui demander. Perdre cette option rendrait le scan plus permissif que la saisie.
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(resolveSpy).toHaveBeenCalledWith(
      '4006381333931',
      jasmine.objectContaining({ requireStockManaged: true, warehouseId: 'wh-1' })
    );
  });

  it('ajoute une ligne pour un article géré en stock', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].productId).toBe('p1');
    expect(component.lines[0].quantity).toBe(1);
    expect(successSpy).toHaveBeenCalled();
  });

  it('incrémente la quantité au second scan du même article', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');
    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].quantity).toBe(2);
    expect(addLineSpy).toHaveBeenCalledTimes(1);
  });

  it('ne crée aucune ligne quand le socle refuse l’article', () => {
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

  it('ne crée aucune ligne quand le code est inconnu', () => {
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

    expect(component.lines.length).toBe(0);
    expect(reportSpy).toHaveBeenCalled();
  });

  it('laisse le produit sélectionné vide après un scan, pour ne pas fausser un ajout manuel', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.selectedProduct).toBeNull();
    expect(component.selectedQuantity).toBe(1);
  });
});
