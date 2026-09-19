import { signal } from '@angular/core';
import { of } from 'rxjs';

import { ProductListItem } from '@core/services/product.service';
import { BarcodeLookupResult } from '@shared/services/barcode-lookup.service';
import { StepLinesComponent } from './step-lines.component';

function makeProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'p1',
    code: 'ART-001',
    name: 'Article facturé',
    description: null,
    typeDisplay: 'Produit',
    categoryId: 'c1',
    category: 'Cat',
    unitPrice: 100,
    unit: 'Unité',
    vatRate: 19,
    isFodecApplicable: true,
    isDiscountEnabled: false,
    maxDiscountPercent: null,
    isActive: true,
    isStockManaged: true,
    barcode: '4006381333931',
    ...overrides
  };
}

/**
 * Scan dans l'assistant de facture.
 *
 * <p>
 * Le wizard n'a pas de ligne modifiable en place : il faut ouvrir l'édition d'une ligne avant
 * d'y poser un article. Le scan doit donc réutiliser la ligne vierge en attente plutôt que d'en
 * empiler une à chaque passage de douchette — sinon dix scans laissent neuf lignes vides.
 * </p>
 */
describe('StepLinesComponent — scan de code-barres', () => {
  let resolveSpy: jasmine.Spy;
  let reportSpy: jasmine.Spy;
  let successSpy: jasmine.Spy;
  let updateLineSpy: jasmine.Spy;
  let applySpy: jasmine.Spy;
  let addNewLineSpy: jasmine.Spy;
  let startEditSpy: jasmine.Spy;
  let resolvePriceSpy: jasmine.Spy;

  interface FakeLine {
    id: string;
    productId: string | null;
    designation: string;
    quantity: number;
  }

  function createComponent(lines: FakeLine[] = []): StepLinesComponent {
    const component = Object.create(StepLinesComponent.prototype) as StepLinesComponent;

    const state = signal(lines);
    Object.defineProperty(component, 'lines', { value: state });
    component.editingLineId = null;

    updateLineSpy = jasmine.createSpy('updateLine').and.callFake(
      (id: string, patch: Partial<FakeLine>) => {
        state.update(list => list.map(l => (l.id === id ? { ...l, ...patch } : l)));
      }
    );
    Object.defineProperty(component, 'wizardService', { value: { updateLine: updateLineSpy } });

    Object.defineProperty(component, 'barcodeLookup', { value: { resolve: resolveSpy } });
    Object.defineProperty(component, 'barcodeFeedback', {
      value: { success: successSpy, failure: jasmine.createSpy('failure'), report: reportSpy }
    });

    addNewLineSpy = spyOn(component, 'addNewLine').and.callFake(() => {
      const line: FakeLine = { id: `L${state().length + 1}`, productId: null, designation: '', quantity: 1 };
      state.update(list => [...list, line]);
      component.editingLineId = line.id;
    });
    startEditSpy = spyOn(component, 'startEditLine').and.callFake(line => {
      component.editingLineId = (line as unknown as FakeLine).id;
    });
    applySpy = spyOn(
      component as unknown as { applyProductToEditingLine(p: unknown): void },
      'applyProductToEditingLine'
    ).and.callFake(() => undefined);
    resolvePriceSpy = spyOn(
      component as unknown as { resolveLinePrice(...a: unknown[]): void },
      'resolveLinePrice'
    ).and.stub();

    return component;
  }

  beforeEach(() => {
    successSpy = jasmine.createSpy('success');
    reportSpy = jasmine.createSpy('report');
    resolveSpy = jasmine.createSpy('resolve').and.returnValue(
      of({ status: 'found', code: '4006381333931', product: makeProduct(), message: '' } as BarcodeLookupResult)
    );
  });

  it('ouvre une nouvelle ligne et y pose l’article quand la facture est vide', () => {
    const component = createComponent([]);

    component.onBarcodeScanned('4006381333931');

    expect(addNewLineSpy).toHaveBeenCalled();
    expect(applySpy).toHaveBeenCalled();
    expect(successSpy).toHaveBeenCalled();
  });

  it('réutilise la ligne vierge en attente plutôt que d’en empiler une', () => {
    const component = createComponent([
      { id: 'L1', productId: null, designation: '', quantity: 1 }
    ]);

    component.onBarcodeScanned('4006381333931');

    expect(startEditSpy).toHaveBeenCalled();
    expect(addNewLineSpy).not.toHaveBeenCalled();
    expect(component.lines().length).toBe(1);
  });

  it('ne confond pas une ligne libre renseignée avec une ligne vierge', () => {
    // Une ligne sans article mais avec une désignation est une saisie libre voulue : la
    // réutiliser écraserait le travail de l'utilisateur.
    const component = createComponent([
      { id: 'L1', productId: null, designation: 'Frais de port', quantity: 1 }
    ]);

    component.onBarcodeScanned('4006381333931');

    expect(addNewLineSpy).toHaveBeenCalled();
    expect(startEditSpy).not.toHaveBeenCalled();
  });

  it('incrémente la quantité et retarife quand l’article est déjà facturé', () => {
    const component = createComponent([
      { id: 'L1', productId: 'p1', designation: 'Article facturé', quantity: 2 }
    ]);

    component.onBarcodeScanned('4006381333931');

    expect(updateLineSpy).toHaveBeenCalledOnceWith('L1', { quantity: 3 });
    expect(resolvePriceSpy).toHaveBeenCalled();
    expect(addNewLineSpy).not.toHaveBeenCalled();
  });

  it('n’ajoute rien quand le socle refuse l’article', () => {
    resolveSpy.and.returnValue(
      of({
        status: 'template',
        code: '4006381333931',
        product: null,
        message: 'Choisissez une variante (SKU).'
      } as BarcodeLookupResult)
    );
    const component = createComponent([]);

    component.onBarcodeScanned('4006381333931');

    expect(addNewLineSpy).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
    expect(reportSpy).toHaveBeenCalled();
  });
});
