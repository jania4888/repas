import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';

import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ProductService } from '@core/services/product.service';
import { PurchaseOrderService } from '@core/services/purchase-order.service';
import { PurchaseReceiptService } from '@core/services/purchase-receipt.service';
import { StockService } from '@core/services/stock.service';
import { SupplierService } from '@core/services/supplier.service';
import { ToastService } from '@core/services/toast.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { BarcodeFeedbackService } from '@shared/services/barcode-feedback.service';
import { BarcodeLookupService } from '@shared/services/barcode-lookup.service';
import { ProductAutocompleteService, ProductSuggestion } from '@shared/services/product-autocomplete.service';
import { PurchaseReceiptFormComponent } from './purchase-receipt-form.component';

function suggestion(overrides: Partial<ProductSuggestion> = {}): ProductSuggestion {
  return {
    id: 'chair',
    code: 'CH',
    name: 'chaise',
    unitPrice: 80,
    purchasePrice: 45,
    vatRate: 19,
    unit: 'Un',
    isFodecApplicable: false,
    isDiscountEnabled: false,
    maxDiscountPercent: null,
    ...overrides
  };
}

describe('PurchaseReceiptFormComponent — recherche article', () => {
  let fixture: ComponentFixture<PurchaseReceiptFormComponent>;
  let component: PurchaseReceiptFormComponent;
  let search: jasmine.Spy;
  let filterLocal: jasmine.Spy;
  let searchForSelect: jasmine.Spy;
  let toastAdd: jasmine.Spy;
  const autocomplete = {
    isV2Enabled: false,
    hasWarmCache: false,
    prefetch: jasmine.createSpy('prefetch').and.returnValue(of([])),
    search: jasmine.createSpy('search').and.returnValue(of([])),
    filterLocal: jasmine.createSpy('filterLocal').and.returnValue([])
  };

  function init(): void {
    fixture = TestBed.createComponent(PurchaseReceiptFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function searchFor(query: string): void {
    component.searchProducts({ query, originalEvent: new Event('input') });
  }

  beforeEach(async () => {
    autocomplete.isV2Enabled = false;
    autocomplete.hasWarmCache = false;
    autocomplete.prefetch.calls.reset();
    autocomplete.prefetch.and.returnValue(of([]));
    search = autocomplete.search;
    search.calls.reset();
    search.and.returnValue(of([]));
    filterLocal = autocomplete.filterLocal;
    filterLocal.calls.reset();
    filterLocal.and.returnValue([]);
    searchForSelect = jasmine.createSpy('searchForSelect').and.returnValue(
      of({ success: true, data: { items: [] } })
    );
    toastAdd = jasmine.createSpy('add');

    await TestBed.configureTestingModule({
      imports: [PurchaseReceiptFormComponent],
      providers: [
        provideRouter([]),
        ErrorHandlerService,
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => null },
              queryParamMap: { get: () => null }
            }
          }
        },
        { provide: PurchaseReceiptService, useValue: {} },
        { provide: PurchaseOrderService, useValue: {} },
        {
          provide: SupplierService,
          useValue: { getActiveSuppliers: () => of({ success: true, data: { items: [] } }) }
        },
        { provide: ProductService, useValue: { searchForSelect } },
        { provide: StockService, useValue: { getFeatures: () => of({ success: true, data: null }) } },
        { provide: ProductAutocompleteService, useValue: autocomplete },
        { provide: ToastService, useValue: { add: toastAdd } },
        { provide: WarehouseContextService, useValue: { selectedWarehouseId: () => null } },
        { provide: BarcodeLookupService, useValue: {} },
        { provide: BarcodeFeedbackService, useValue: {} }
      ]
    })
      .overrideComponent(PurchaseReceiptFormComponent, {
        set: { template: '' }
      })
      .compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
  });

  it('réassigne les suggestions à chaque requête vide quand le cache est chaud', fakeAsync(() => {
    autocomplete.isV2Enabled = true;
    autocomplete.hasWarmCache = true;
    filterLocal.and.returnValue([suggestion()]);
    init();

    searchFor('');
    const first = component.productSuggestions();
    tick(400);
    searchFor('');
    const second = component.productSuggestions();
    tick(400);

    expect(first).not.toBe(second);
    expect(first.map(item => item.id)).toEqual(['chair']);
    expect(second.map(item => item.id)).toEqual(['chair']);
    expect(second[0].purchasePrice).toBe(45);
    expect(component.isLoadingProducts()).toBeFalse();
    expect(search).not.toHaveBeenCalled();
    expect(searchForSelect).not.toHaveBeenCalled();
  }));

  it('sert une requête courte depuis le cache sans attendre le debounce', fakeAsync(() => {
    autocomplete.isV2Enabled = true;
    autocomplete.hasWarmCache = true;
    filterLocal.and.callFake((query: string) => (query === 'ch' ? [suggestion()] : []));
    init();

    searchFor('ch');

    expect(component.productSuggestions().map(item => item.name)).toEqual(['chaise']);
    expect(component.isLoadingProducts()).toBeFalse();
    expect(search).not.toHaveBeenCalled();
    tick(300);
    expect(search).not.toHaveBeenCalled();
  }));

  it('appelle la recherche serveur quand le cache chaud n’a aucun hit local', fakeAsync(() => {
    autocomplete.isV2Enabled = true;
    autocomplete.hasWarmCache = true;
    filterLocal.and.returnValue([]);
    search.and.returnValue(of([suggestion({ id: 'server', name: 'zzz-serveur', code: 'ZZ' })]));
    init();

    searchFor('zzzz');
    expect(component.productSuggestions()).toEqual([]);
    expect(search).not.toHaveBeenCalled();

    tick(299);
    expect(search).not.toHaveBeenCalled();
    tick(1);

    expect(search).toHaveBeenCalledOnceWith('zzzz');
    expect(component.productSuggestions().map(item => item.id)).toEqual(['server']);
    expect(component.isLoadingProducts()).toBeFalse();
    expect(searchForSelect).not.toHaveBeenCalled();
    expect(toastAdd).not.toHaveBeenCalled();
  }));

  it('relance la même requête serveur au lieu de l’avaler', fakeAsync(() => {
    autocomplete.isV2Enabled = true;
    autocomplete.hasWarmCache = true;
    filterLocal.and.returnValue([]);
    search.and.returnValue(of([suggestion({ id: 'server', code: 'ZZ', name: 'zzz' })]));
    init();

    searchFor('zzzz');
    tick(300);
    searchFor('zzzz');
    tick(300);

    expect(search).toHaveBeenCalledTimes(2);
    expect(component.isLoadingProducts()).toBeFalse();
    expect(component.productSuggestions().map(item => item.id)).toEqual(['server']);
  }));

  it('annule une recherche serveur encore en debounce quand le cache peut répondre', fakeAsync(() => {
    autocomplete.isV2Enabled = true;
    autocomplete.hasWarmCache = true;
    filterLocal.and.callFake((query: string) => (query.length >= 3 ? [] : [suggestion()]));
    init();

    searchFor('zzzz');
    searchFor('ch');
    tick(300);

    expect(search).not.toHaveBeenCalled();
    expect(component.productSuggestions().map(item => item.name)).toEqual(['chaise']);
    expect(component.isLoadingProducts()).toBeFalse();
  }));

  it('ne montre pas de toast quand la recherche serveur réussit sans résultat', fakeAsync(() => {
    search.and.returnValue(of([]));
    init();

    searchFor('zzzz');
    tick(300);

    expect(component.productSuggestions()).toEqual([]);
    expect(component.isLoadingProducts()).toBeFalse();
    expect(toastAdd).not.toHaveBeenCalled();
  }));

  it('réinitialise le chargement et masque le détail technique en cas d’erreur HTTP', fakeAsync(() => {
    search.and.returnValue(throwError(() => ({
      status: 500,
      error: { success: false, message: 'zzz-secret' }
    })));
    init();

    searchFor('zzzz');
    tick(300);

    expect(component.isLoadingProducts()).toBeFalse();
    expect(component.productSuggestions()).toEqual([]);
    expect(toastAdd).toHaveBeenCalledTimes(1);
    const detail = toastAdd.calls.mostRecent().args[0].detail as string;
    expect(detail).not.toContain('zzz-secret');
    expect(detail).not.toContain('localhost');
  }));

  it('conserve le libellé d’accès pour une recherche refusée', fakeAsync(() => {
    search.and.returnValue(throwError(() => ({ status: 401 })));
    init();

    searchFor('zzzz');
    tick(300);

    expect(toastAdd).toHaveBeenCalledTimes(1);
    const detail = toastAdd.calls.mostRecent().args[0].detail as string;
    expect(detail).toContain('Authentification');
    expect(component.isLoadingProducts()).toBeFalse();
    expect(component.productSuggestions()).toEqual([]);
  }));

  it('ignore le résultat d’une recherche annulée par la suivante', fakeAsync(() => {
    const slow = new Subject<ProductSuggestion[]>();
    search.and.callFake((query: string) => {
      if (query === 't') {
        return slow.asObservable();
      }
      return of([suggestion({ id: 'tab', code: 'TAB', name: 'table' })]).pipe(delay(500));
    });
    init();

    searchFor('t');
    tick(300);
    expect(component.isLoadingProducts()).toBeTrue();

    searchFor('tab');
    tick(300);
    expect(component.isLoadingProducts()).toBeTrue();

    slow.next([suggestion()]);
    slow.complete();
    tick(500);

    expect(component.productSuggestions().map(item => item.id)).toEqual(['tab']);
    expect(component.isLoadingProducts()).toBeFalse();
    expect(toastAdd).not.toHaveBeenCalled();
  }));

  it('éteint le spinner si la recherche serveur ne répond pas', fakeAsync(() => {
    search.and.returnValue(new Subject<ProductSuggestion[]>());
    init();

    searchFor('zzzz');
    tick(300);
    expect(component.isLoadingProducts()).toBeTrue();

    tick(15_000);

    expect(component.isLoadingProducts()).toBeFalse();
    expect(component.productSuggestions()).toEqual([]);
    expect(toastAdd).toHaveBeenCalledTimes(1);
    const detail = toastAdd.calls.mostRecent().args[0].detail as string;
    expect(detail).not.toContain('zzzz');
    expect(detail).not.toContain('localhost');
  }));
});
