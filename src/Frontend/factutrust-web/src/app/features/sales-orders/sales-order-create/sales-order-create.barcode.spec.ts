import { signal } from '@angular/core';
import { of } from 'rxjs';

import { ProductListItem } from '@core/services/product.service';
import { BarcodeLookupResult } from '@shared/services/barcode-lookup.service';
import { SalesOrderCreateComponent } from './sales-order-create.component';

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
    unit: 'Unité',
    vatRate: 19,
    isActive: true,
    isStockManaged: true,
    quantityAvailable: 0,
    ...overrides
  };
}

/**
 * Scan sur une commande client.
 *
 * <p>
 * Cet écran n'a pas de grille modifiable : on y ajoute par un couple « article + quantité »,
 * puis on valide. Le scan emprunte exactement le même chemin — il renseigne ce couple et
 * appelle <c>addLine()</c> — plutôt que d'ouvrir une seconde voie d'écriture qui divergerait à
 * la première évolution.
 * </p>
 *
 * <p>
 * La disponibilité n'est pas bloquante : une commande peut légitimement porter sur du stock à
 * venir, c'est même sa raison d'être.
 * </p>
 */
describe('SalesOrderCreateComponent — scan de code-barres', () => {
  let resolveSpy: jasmine.Spy;
  let reportSpy: jasmine.Spy;
  let successSpy: jasmine.Spy;
  let quantityChangeSpy: jasmine.Spy;

  function createComponent(): SalesOrderCreateComponent {
    const component = Object.create(SalesOrderCreateComponent.prototype) as SalesOrderCreateComponent;

    Object.defineProperty(component, 'lines', { value: signal([] as never[]), writable: true });
    component.newProduct = null;
    component.newQuantity = 1;

    Object.defineProperty(component, 'barcodeLookup', { value: { resolve: resolveSpy } });
    Object.defineProperty(component, 'barcodeFeedback', {
      value: { success: successSpy, failure: jasmine.createSpy('failure'), report: reportSpy }
    });

    spyOn(component, 'addLine').and.callFake(() => {
      const product = component.newProduct!;
      component.lines.update(list => [
        ...list,
        {
          product,
          quantity: component.newQuantity ?? 1,
          unitPrice: product.unitPrice,
          discountPercent: null,
          notes: null,
          priceSource: null,
          priceOverridden: false
        } as never
      ]);
      component.newProduct = null;
      component.newQuantity = 1;
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

  it('ajoute une ligne en passant par la zone d’ajout de l’écran', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines().length).toBe(1);
    expect(component.lines()[0].product!.id).toBe('p1');
    expect(component.lines()[0].quantity).toBe(1);
    expect(successSpy).toHaveBeenCalled();
  });

  it('adapte l’article au format attendu par la zone d’ajout', () => {
    // La zone d'ajout attend un libellé d'affichage que le DTO de liste ne porte pas : sans
    // cette adaptation, la ligne s'ajouterait sans nom lisible.
    const component = createComponent();
    let captured: { label?: string } | null = null;

    (component.addLine as jasmine.Spy).and.callFake(() => {
      captured = component.newProduct as unknown as { label?: string };
    });

    component.onBarcodeScanned('4006381333931');

    expect(captured).not.toBeNull();
    expect(captured!.label).toBe('ART-001 — Article commandé');
  });

  it('laisse la zone d’ajout vide après le scan', () => {
    // Sinon le prochain clic sur « Ajouter » rejouerait le dernier article scanné.
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.newProduct).toBeNull();
    expect(component.newQuantity).toBe(1);
  });

  it('incrémente la quantité au second scan et relance la tarification', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');
    component.onBarcodeScanned('4006381333931');

    expect(component.lines().length).toBe(1);
    expect(component.lines()[0].quantity).toBe(2);
    expect(quantityChangeSpy).toHaveBeenCalledWith(0);
  });

  it('accepte un article en rupture', () => {
    // Une commande porte précisément sur ce qui n'est pas encore en stock.
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(component.lines().length).toBe(1);
  });

  it('n’ajoute rien quand le socle refuse l’article', () => {
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

    expect(component.lines().length).toBe(0);
    expect(reportSpy).toHaveBeenCalled();
  });
});
