import { signal } from '@angular/core';
import { of } from 'rxjs';

import { ProductListItem } from '@core/services/product.service';
import { BarcodeLookupResult } from '@shared/services/barcode-lookup.service';
import { PurchaseReceiptFormComponent } from './purchase-receipt-form.component';

function makeProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'p1',
    code: 'ART-001',
    name: 'Article reçu',
    description: null,
    typeDisplay: 'Produit',
    categoryId: 'c1',
    category: 'Cat',
    unitPrice: 100,
    purchasePrice: 70,
    unit: 'Carton',
    vatRate: 13,
    isActive: true,
    isStockManaged: true,
    ...overrides
  };
}

/**
 * Scan sur un bon de réception.
 *
 * <p>
 * Cet écran avait sa PROPRE implémentation du scan, par boîte de dialogue, divergente de celle
 * de la caisse — deux versions du même geste, donc la garantie qu'un correctif n'atteindrait
 * qu'une moitié des utilisateurs. La résolution passe désormais par le socle partagé, mais la
 * sémantique métier propre au bon de réception est conservée, et c'est ce que ces tests
 * épinglent : c'est la <b>quantité reçue</b> qui s'incrémente, et la ligne se crée au
 * <b>prix d'achat</b>.
 * </p>
 */
describe('PurchaseReceiptFormComponent — scan de code-barres', () => {
  let resolveSpy: jasmine.Spy;
  let reportSpy: jasmine.Spy;
  let successSpy: jasmine.Spy;
  let recalcSpy: jasmine.Spy;

  function createComponent(): PurchaseReceiptFormComponent {
    const component = Object.create(
      PurchaseReceiptFormComponent.prototype
    ) as PurchaseReceiptFormComponent;

    component.lines = [];
    Object.defineProperty(component, 'barcodeLookingUp', { value: signal(false) });

    Object.defineProperty(component, 'barcodeLookup', { value: { resolve: resolveSpy } });
    Object.defineProperty(component, 'barcodeFeedback', {
      value: { success: successSpy, failure: jasmine.createSpy('failure'), report: reportSpy }
    });

    spyOn(
      component as unknown as { createEmptyLine(): unknown },
      'createEmptyLine'
    ).and.callFake(() => ({
      product: null,
      productId: null,
      productCode: '',
      productName: '',
      designation: '',
      unit: '',
      unitPriceHT: 0,
      vatRate: 19,
      receivedQuantity: 0,
      lotAllocations: []
    }));

    recalcSpy = spyOn(component, 'recalculateTotals').and.stub();
    return component;
  }

  beforeEach(() => {
    successSpy = jasmine.createSpy('success');
    reportSpy = jasmine.createSpy('report');
    resolveSpy = jasmine.createSpy('resolve').and.returnValue(
      of({ status: 'found', code: '4006381333931', product: makeProduct(), message: '' } as BarcodeLookupResult)
    );
  });

  it('crée une ligne au prix d’achat, avec une quantité reçue de 1', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].productId).toBe('p1');
    expect(component.lines[0].receivedQuantity).toBe(1);
    expect(component.lines[0].unitPriceHT).toBe(70);
    expect(component.lines[0].vatRate).toBe(13);
    expect(component.lines[0].unit).toBe('Carton');
    expect(recalcSpy).toHaveBeenCalled();
    expect(successSpy).toHaveBeenCalled();
  });

  it('se rabat sur le prix de vente quand aucun prix d’achat n’est connu', () => {
    resolveSpy.and.returnValue(
      of(
        {
          status: 'found',
          code: '4006381333931',
          product: makeProduct({ purchasePrice: null, unitPrice: 95 }),
          message: ''
        } as BarcodeLookupResult
      )
    );
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines[0].unitPriceHT).toBe(95);
  });

  it('incrémente la quantité REÇUE au second scan, pas la commandée', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');
    component.onBarcodeScanned('4006381333931');
    component.onBarcodeScanned('4006381333931');

    expect(component.lines.length).toBe(1);
    expect(component.lines[0].receivedQuantity).toBe(3);
  });

  it('libère l’indicateur de recherche, même sur un refus', () => {
    // Le champ de scan est désactivé pendant la résolution : s'il ne se rouvrait pas, un seul
    // code inconnu bloquerait la saisie pour le reste de la réception.
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

    expect(component.barcodeLookingUp()).toBeFalse();
    expect(component.lines.length).toBe(0);
    expect(reportSpy).toHaveBeenCalled();
  });

  it('n’accepte pas un article désactivé', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(resolveSpy).toHaveBeenCalledWith(
      '4006381333931',
      jasmine.objectContaining({ requireActive: true })
    );
  });
});
