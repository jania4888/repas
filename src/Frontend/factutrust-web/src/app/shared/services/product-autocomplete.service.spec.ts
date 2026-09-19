import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  ProductAutocompleteService,
  suggestionToListItem
} from './product-autocomplete.service';
import { ProductService, ProductSelectItem } from '@core/services/product.service';
import { environment } from '@environments/environment';

describe('ProductAutocompleteService', () => {
  let service: ProductAutocompleteService;
  let searchForSelectSpy: jasmine.Spy;
  let getProductsSpy: jasmine.Spy;

  const selectItems: ProductSelectItem[] = [
    {
      id: '1',
      code: 'TAB001',
      name: 'Table001 FODEC',
      unitPrice: 82,
      vatRate: 19,
      unit: 'Unité',
      isFodecApplicable: true,
      isDiscountEnabled: false,
      maxDiscountPercent: null,
      barcode: '4006381333931'
    },
    {
      id: '2',
      code: 'CHA001',
      name: 'Chaise bureau',
      unitPrice: 45,
      vatRate: 19,
      unit: 'Unité',
      isFodecApplicable: false,
      isDiscountEnabled: true,
      maxDiscountPercent: 10,
      barcode: 'REF-CHA-001'
    }
  ];

  beforeEach(() => {
    searchForSelectSpy = jasmine.createSpy('searchForSelect').and.returnValue(
      of({
        success: true,
        data: {
          items: selectItems,
          page: 1,
          pageSize: 100,
          totalCount: 2,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false
        }
      })
    );
    getProductsSpy = jasmine.createSpy('getProducts').and.returnValue(
      of({ success: true, data: { items: [], page: 1, pageSize: 50, totalCount: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false } })
    );

    TestBed.configureTestingModule({
      providers: [
        ProductAutocompleteService,
        {
          provide: ProductService,
          useValue: {
            searchForSelect: searchForSelectSpy,
            getProducts: getProductsSpy
          }
        }
      ]
    });

    service = TestBed.inject(ProductAutocompleteService);
    service.invalidateCache();
    (environment.featureFlags as { invoiceProductSearchV2: boolean }).invoiceProductSearchV2 = true;
  });

  it('prefetch loads once and warms cache', (done) => {
    service.prefetch().subscribe(items => {
      expect(items.length).toBe(2);
      expect(searchForSelectSpy).toHaveBeenCalledTimes(1);
      expect(service.hasWarmCache).toBeTrue();

      service.prefetch().subscribe(again => {
        expect(again.length).toBe(2);
        expect(searchForSelectSpy).toHaveBeenCalledTimes(1);
        done();
      });
    });
  });

  it('empty search serves warm cache without extra HTTP', (done) => {
    service.prefetch().subscribe(() => {
      searchForSelectSpy.calls.reset();
      service.search('').subscribe(items => {
        expect(items.length).toBe(2);
        expect(searchForSelectSpy).not.toHaveBeenCalled();
        done();
      });
    });
  });

  it('filters locally for short queries (case-insensitive code/name)', (done) => {
    service.prefetch().subscribe(() => {
      searchForSelectSpy.calls.reset();
      service.search('tab').subscribe(items => {
        expect(items.length).toBe(1);
        expect(items[0].name).toBe('Table001 FODEC');
        expect(searchForSelectSpy).not.toHaveBeenCalled();
        done();
      });
    });
  });

  it('filterLocal finds by code', () => {
    // Seed via private path: prefetch then filter
    service.prefetch().subscribe();
    // Synchronous after subscribe of of()
    const local = service.filterLocal('CHA');
    expect(local.length).toBe(1);
    expect(local[0].code).toBe('CHA001');
  });

  it('calls server when local filter yields 0 and query length >= 3', (done) => {
    service.prefetch().subscribe(() => {
      searchForSelectSpy.calls.reset();
      searchForSelectSpy.and.returnValue(
        of({
          success: true,
          data: {
            items: [],
            page: 1,
            pageSize: 100,
            totalCount: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false
          }
        })
      );
      service.search('xyz').subscribe(items => {
        expect(items).toEqual([]);
        expect(searchForSelectSpy).toHaveBeenCalled();
        done();
      });
    });
  });

  it('handles prefetch network error without throwing', (done) => {
    searchForSelectSpy.and.returnValue(throwError(() => new Error('network')));
    service.prefetch().subscribe(items => {
      expect(items).toEqual([]);
      expect(service.hasWarmCache).toBeFalse();
      done();
    });
  });

  it('falls back to legacy getProducts when V2 flag is disabled', (done) => {
    (environment.featureFlags as { invoiceProductSearchV2: boolean }).invoiceProductSearchV2 = false;
    service.search('table').subscribe(() => {
      expect(getProductsSpy).toHaveBeenCalled();
      expect(searchForSelectSpy).not.toHaveBeenCalled();
      (environment.featureFlags as { invoiceProductSearchV2: boolean }).invoiceProductSearchV2 = true;
      done();
    });
  });

  it('suggestionToListItem maps required fields', () => {
    const list = suggestionToListItem({
      id: '1',
      code: 'A',
      name: 'Alpha',
      unitPrice: 10,
      vatRate: 19,
      unit: 'u',
      isFodecApplicable: true,
      isDiscountEnabled: false,
      maxDiscountPercent: null
    });
    expect(list.id).toBe('1');
    expect(list.name).toBe('Alpha');
    expect(list.isFodecApplicable).toBeTrue();
  });

  // ─────────────────────── Code-barres ───────────────────────

  it('filterLocal résout un code-barres scanné en entier', (done) => {
    service.prefetch().subscribe(() => {
      const local = service.filterLocal('4006381333931');

      expect(local.length).toBe(1);
      expect(local[0].code).toBe('TAB001');
      done();
    });
  });

  it('filterLocal ne résout JAMAIS un code-barres par préfixe', (done) => {
    // On ne tape pas un morceau de code-barres, on le scanne en entier. Un « includes » ici
    // rouvrirait la correspondance partielle que le scan a précisément corrigée : « 1234 »
    // désignerait « 12345 », et la caisse encaisserait le mauvais article.
    service.prefetch().subscribe(() => {
      expect(service.filterLocal('400638133393').length).toBe(0);
      expect(service.filterLocal('40063813339311').length).toBe(0);
      done();
    });
  });

  it('filterLocal respecte la casse d’un Code 128', (done) => {
    // Le nom et le code interne se cherchent sans tenir compte de la casse. Un Code 128, lui,
    // la distingue : « REF-CHA-001 » et « ref-cha-001 » sont deux symboles différents, et une
    // douchette restitue exactement ce qui est imprimé. Rabattre la casse ferait correspondre
    // deux codes qui, physiquement, n'en sont pas un seul.
    service.prefetch().subscribe(() => {
      expect(service.filterLocal('REF-CHA-001').length).toBe(1);
      expect(service.filterLocal('ref-cha-001').length).toBe(0);
      done();
    });
  });

  it('filterLocal laisse intacte la recherche par nom et par code', (done) => {
    // Non-régression : le troisième prédicat ne doit rien retirer aux deux autres.
    service.prefetch().subscribe(() => {
      expect(service.filterLocal('chaise').length).toBe(1);
      expect(service.filterLocal('TAB').length).toBe(1);
      expect(service.filterLocal('introuvable').length).toBe(0);
      done();
    });
  });

  it('upsertSuggestion conserve le code-barres dans le cache', (done) => {
    // Sans cela, un article créé à la volée deviendrait introuvable au scan jusqu'à
    // l'expiration du cache — un défaut intermittent, donc pénible à diagnostiquer.
    service.prefetch().subscribe(() => {
      service.upsertSuggestion({
        id: '3',
        code: 'NEW001',
        name: 'Article créé à la volée',
        unitPrice: 30,
        vatRate: 19,
        unit: 'Unité',
        isFodecApplicable: false,
        isDiscountEnabled: false,
        maxDiscountPercent: null,
        barcode: '5901234123457'
      });

      const local = service.filterLocal('5901234123457');

      expect(local.length).toBe(1);
      expect(local[0].id).toBe('3');
      done();
    });
  });

  it('suggestionToListItem propage le code-barres', () => {
    const list = suggestionToListItem({
      id: '1',
      code: 'A',
      name: 'Alpha',
      unitPrice: 10,
      vatRate: 19,
      unit: 'u',
      isFodecApplicable: true,
      isDiscountEnabled: false,
      maxDiscountPercent: null,
      barcode: '4006381333931'
    });

    expect(list.barcode).toBe('4006381333931');
  });
});
