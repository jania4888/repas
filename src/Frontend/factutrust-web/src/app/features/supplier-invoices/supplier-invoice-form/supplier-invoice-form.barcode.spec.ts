import { of } from 'rxjs';

import { ProductListItem } from '@core/services/product.service';
import { BarcodeLookupResult } from '@shared/services/barcode-lookup.service';
import { SupplierInvoiceFormComponent } from './supplier-invoice-form.component';

function makeProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'p1',
    code: 'SRV-001',
    name: 'Prestation de maintenance',
    description: null,
    typeDisplay: 'Service',
    categoryId: 'c1',
    category: 'Cat',
    unitPrice: 100,
    purchasePrice: 80,
    unit: 'Unité',
    vatRate: 19,
    isActive: true,
    isStockManaged: false,
    ...overrides
  };
}

/**
 * Scan sur une facture fournisseur directe.
 *
 * <p>
 * Cet écran refuse les articles gérés en stock : ils doivent passer par un bon de réception,
 * seul document qui mouvemente le stock. La douchette ne doit pas devenir un moyen de
 * contourner ce garde-fou comptable — c'est exactement le genre de règle qu'on oublie de
 * reporter quand on ajoute un second chemin de saisie.
 * </p>
 */
describe('SupplierInvoiceFormComponent — scan de code-barres', () => {
  let resolveSpy: jasmine.Spy;
  let reportSpy: jasmine.Spy;
  let failureSpy: jasmine.Spy;
  let successSpy: jasmine.Spy;
  let recalculateSpy: jasmine.Spy;

  function createComponent(): SupplierInvoiceFormComponent {
    const component = Object.create(
      SupplierInvoiceFormComponent.prototype
    ) as SupplierInvoiceFormComponent;

    component.lines = [];

    Object.defineProperty(component, 'barcodeLookup', { value: { resolve: resolveSpy } });
    Object.defineProperty(component, 'barcodeFeedback', {
      value: { success: successSpy, failure: failureSpy, report: reportSpy }
    });

    recalculateSpy = spyOn(component, 'recalculateTotals').and.stub();
    spyOn(component as unknown as { addEmptyAndReturn: () => unknown }, 'addEmptyAndReturn')
      .and.callFake(() => {
        const line = {
          product: null,
          productId: null,
          quantity: 1,
          unitPriceHT: 0,
          discountPercent: 0,
          vatRate: 19,
          isFixedAsset: false,
          assetAccountNumber: ''
        };
        component.lines.push(line as never);
        return line;
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

  it('refuse un article géré en stock et renvoie vers le bon de réception', () => {
    resolveSpy.and.returnValue(of(found(makeProduct({ isStockManaged: true }))));
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(0);
    expect(failureSpy).toHaveBeenCalled();
    expect(failureSpy.calls.mostRecent().args[0]).toContain('bon de réception');
    expect(successSpy).not.toHaveBeenCalled();
  });

  it('accepte un service et le pose au prix d’achat', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].productId).toBe('p1');
    expect(component.lines[0].unitPriceHT).toBe(80);
    expect(component.lines[0].vatRate).toBe(19);
    expect(recalculateSpy).toHaveBeenCalled();
    expect(successSpy).toHaveBeenCalled();
  });

  it('se rabat sur le prix de vente quand aucun prix d’achat n’est connu', () => {
    resolveSpy.and.returnValue(
      of(found(makeProduct({ purchasePrice: null, unitPrice: 120 })))
    );
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines[0].unitPriceHT).toBe(120);
  });

  it('incrémente la quantité au second scan du même article', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');
    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].quantity).toBe(2);
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
});
