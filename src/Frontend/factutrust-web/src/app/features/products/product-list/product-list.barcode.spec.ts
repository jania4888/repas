import { signal } from '@angular/core';
import { of } from 'rxjs';

import { ProductListItem } from '@core/services/product.service';
import { BarcodeLookupResult } from '@shared/services/barcode-lookup.service';
import { ProductListComponent } from './product-list.component';

function makeProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'p1',
    code: 'ART-001',
    name: 'Article scanné',
    description: null,
    typeDisplay: 'Produit',
    categoryId: 'c1',
    category: 'Cat',
    unitPrice: 100,
    unit: 'Unité',
    vatRate: 19,
    isActive: true,
    isStockManaged: false,
    ...overrides
  };
}

/**
 * Scan depuis la liste des articles.
 *
 * <p>
 * Écran de consultation : le scan ne modifie rien. Il répond au besoin réel — « quel est cet
 * article que j'ai en main » — en ouvrant directement la fiche. Un code inconnu ne se solde pas
 * par un refus sec : il alimente la recherche, pour que l'utilisateur voie ce qui s'en approche.
 * </p>
 */
describe('ProductListComponent — scan de code-barres', () => {
  let resolveSpy: jasmine.Spy;
  let reportSpy: jasmine.Spy;
  let navigateSpy: jasmine.Spy;
  let searchSpy: jasmine.Spy;

  function createComponent(): ProductListComponent {
    const component = Object.create(ProductListComponent.prototype) as ProductListComponent;

    component.searchTerm = '';
    // Champs `readonly` : l'instance est fabriquée sans passer par le constructeur, il faut
    // donc les poser explicitement.
    Object.defineProperty(component, 'labelDialogVisible', { value: signal(false) });
    Object.defineProperty(component, 'labelTarget', { value: signal(null) });

    Object.defineProperty(component, 'barcodeLookup', { value: { resolve: resolveSpy } });
    Object.defineProperty(component, 'barcodeFeedback', {
      value: { success: jasmine.createSpy('success'), failure: jasmine.createSpy('failure'), report: reportSpy }
    });
    Object.defineProperty(component, 'router', { value: { navigate: navigateSpy } });

    searchSpy = spyOn(component, 'onSearch').and.stub();
    return component;
  }

  beforeEach(() => {
    reportSpy = jasmine.createSpy('report');
    navigateSpy = jasmine.createSpy('navigate');
    resolveSpy = jasmine.createSpy('resolve').and.returnValue(
      of({ status: 'found', code: '4006381333931', product: makeProduct(), message: '' } as BarcodeLookupResult)
    );
  });

  it('ouvre la fiche de l’article reconnu', () => {
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(navigateSpy).toHaveBeenCalledOnceWith(['/products', 'p1']);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('accepte aussi un article désactivé', () => {
    // C'est une consultation : refuser d'ouvrir la fiche d'un article désactivé empêcherait
    // précisément de comprendre pourquoi il ne se vend plus.
    const component = createComponent();

    component.onBarcodeScanned('4006381333931');

    expect(resolveSpy).toHaveBeenCalledWith(
      '4006381333931',
      jasmine.objectContaining({ requireActive: false })
    );
  });

  it('verse le code dans la recherche quand il n’est pas reconnu', () => {
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
    expect(component.searchTerm).toBe('INCONNU');
    expect(searchSpy).toHaveBeenCalled();
    expect(reportSpy).toHaveBeenCalled();
  });

  it('prépare le dialogue d’étiquettes à partir de l’article de la ligne', () => {
    const component = createComponent();

    component.openLabelDialog(makeProduct({ id: 'p9', name: 'Table', barcode: '4006381333931' }));

    expect(component.labelDialogVisible()).toBeTrue();
    expect(component.labelTarget()).toEqual({ id: 'p9', name: 'Table', hasBarcode: true });
  });

  it('signale au dialogue qu’un article n’a pas de code-barres', () => {
    // L'utilisateur doit savoir avant d'imprimer que l'étiquette portera le code interne.
    const component = createComponent();

    component.openLabelDialog(makeProduct({ barcode: null }));

    expect(component.labelTarget()!.hasBarcode).toBeFalse();
  });
});
