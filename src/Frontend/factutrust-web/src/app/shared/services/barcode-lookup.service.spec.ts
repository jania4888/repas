import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { BarcodeLookupService } from './barcode-lookup.service';
import { ProductService, ProductListItem } from '@core/services/product.service';

/**
 * Résolution d'un code scanné en article, partagée par tous les écrans de document.
 *
 * <p>
 * L'exigence centrale est l'exactitude. Le scan interrogeait autrefois le code produit interne
 * avec un <c>includes</c> bidirectionnel : scanner « 1234 » pouvait désigner l'article
 * « 12345 ». En caisse comme en réception, cela porte sur le mauvais article et fausse le
 * stock. Le repli sur le code interne est conservé — beaucoup de catalogues n'ont pas encore
 * de code-barres — mais en égalité stricte seulement.
 * </p>
 */
describe('BarcodeLookupService', () => {
  let service: BarcodeLookupService;
  let getProductByBarcodeSpy: jasmine.Spy;
  let getProductsSpy: jasmine.Spy;

  function makeProduct(overrides: Partial<ProductListItem> = {}): ProductListItem {
    return {
      id: 'p1',
      code: 'ART-001',
      name: 'Article scanné',
      description: null,
      typeDisplay: 'Produit',
      categoryId: 'c1',
      category: 'general',
      unitPrice: 100,
      unit: 'Unité',
      vatRate: 19,
      isActive: true,
      isStockManaged: false,
      ...overrides
    };
  }

  function pagedProducts(items: ProductListItem[]) {
    return {
      success: true,
      data: {
        items,
        page: 1,
        pageSize: 10,
        totalCount: items.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false
      }
    };
  }

  beforeEach(() => {
    getProductByBarcodeSpy = jasmine
      .createSpy('getProductByBarcode')
      .and.returnValue(of({ success: true, data: makeProduct() }));
    getProductsSpy = jasmine.createSpy('getProducts').and.returnValue(of(pagedProducts([])));

    TestBed.configureTestingModule({
      providers: [
        BarcodeLookupService,
        {
          provide: ProductService,
          useValue: {
            getProductByBarcode: getProductByBarcodeSpy,
            getProducts: getProductsSpy
          }
        }
      ]
    });

    service = TestBed.inject(BarcodeLookupService);
  });

  // ─────────────────────── Résolution directe ───────────────────────

  it('résout un code-barres connu', done => {
    const product = makeProduct({ id: 'found' });
    getProductByBarcodeSpy.and.returnValue(of({ success: true, data: product }));

    service.resolve('4006381333931').subscribe(result => {
      expect(result.status).toBe('found');
      expect(result.product).toBe(product);
      expect(result.message).toBe('');
      expect(getProductsSpy).not.toHaveBeenCalled();
      done();
    });
  });

  it('détoure le code avant de résoudre', done => {
    service.resolve('  4006381333931  ').subscribe(() => {
      expect(getProductByBarcodeSpy).toHaveBeenCalledWith('4006381333931');
      done();
    });
  });

  it('refuse un code vide sans appeler le serveur', done => {
    service.resolve('   ').subscribe(result => {
      expect(result.status).toBe('not_found');
      expect(getProductByBarcodeSpy).not.toHaveBeenCalled();
      done();
    });
  });

  // ─────────────────────── Repli sur le code interne ───────────────────────

  it('se replie sur le code interne quand le code-barres est inconnu', done => {
    getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));
    const product = makeProduct({ code: 'ART-001' });
    getProductsSpy.and.returnValue(of(pagedProducts([product])));

    service.resolve('ART-001').subscribe(result => {
      expect(result.status).toBe('found');
      expect(result.product).toBe(product);
      done();
    });
  });

  it('se replie aussi quand la requête échoue', done => {
    // Un code refusé pour format invalide arrive par le callback d'erreur, pas par next.
    getProductByBarcodeSpy.and.returnValue(throwError(() => new Error('400')));
    const product = makeProduct({ code: 'ART-001' });
    getProductsSpy.and.returnValue(of(pagedProducts([product])));

    service.resolve('ART-001').subscribe(result => {
      expect(result.status).toBe('found');
      done();
    });
  });

  it('n\'accepte qu\'une correspondance STRICTE : « 1234 » ne désigne jamais « 12345 »', done => {
    getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));
    getProductsSpy.and.returnValue(of(pagedProducts([makeProduct({ code: '12345' })])));

    service.resolve('1234').subscribe(result => {
      expect(result.status).toBe('not_found');
      expect(result.product).toBeNull();
      done();
    });
  });

  it('signale l\'ambiguïté plutôt que de choisir', done => {
    getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));
    getProductsSpy.and.returnValue(
      of(pagedProducts([
        makeProduct({ id: 'a', code: 'DUP' }),
        makeProduct({ id: 'b', code: 'DUP' })
      ]))
    );

    service.resolve('DUP').subscribe(result => {
      expect(result.status).toBe('ambiguous');
      expect(result.message).toContain('Plusieurs articles');
      done();
    });
  });

  it('peut se passer du repli quand l\'écran l\'exige', done => {
    getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));

    service
      .resolve('ART-001', { fallbackToExactInternalCode: false })
      .subscribe(result => {
        expect(result.status).toBe('not_found');
        expect(getProductsSpy).not.toHaveBeenCalled();
        done();
      });
  });

  it('transmet l\'entrepôt courant à la recherche de repli', done => {
    getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));

    service.resolve('ART-001', { warehouseId: 'wh-42' }).subscribe(() => {
      expect(getProductsSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({ search: 'ART-001', warehouseId: 'wh-42' })
      );
      done();
    });
  });

  // ─────────────────────── Garde-fous métier ───────────────────────

  it('refuse un modèle de variantes', done => {
    getProductByBarcodeSpy.and.returnValue(
      of({ success: true, data: makeProduct({ isVariantTemplate: true }) })
    );

    service.resolve('4006381333931').subscribe(result => {
      expect(result.status).toBe('template');
      expect(result.message).toContain('variante');
      done();
    });
  });

  it('refuse un article désactivé', done => {
    getProductByBarcodeSpy.and.returnValue(
      of({ success: true, data: makeProduct({ isActive: false }) })
    );

    service.resolve('4006381333931').subscribe(result => {
      expect(result.status).toBe('inactive');
      done();
    });
  });

  it('refuse un article non géré en stock quand l\'écran l\'exige', done => {
    getProductByBarcodeSpy.and.returnValue(
      of({ success: true, data: makeProduct({ isStockManaged: false }) })
    );

    service
      .resolve('4006381333931', { requireStockManaged: true })
      .subscribe(result => {
        expect(result.status).toBe('not_stock_managed');
        expect(result.message).toContain('pas géré en stock');
        done();
      });
  });

  it('accepte un article non géré en stock par défaut', done => {
    // Les documents de vente et d'achat acceptent les services ; seuls les mouvements de
    // stock exigent un article géré.
    getProductByBarcodeSpy.and.returnValue(
      of({ success: true, data: makeProduct({ isStockManaged: false }) })
    );

    service.resolve('4006381333931').subscribe(result => {
      expect(result.status).toBe('found');
      done();
    });
  });

  it('applique les mêmes garde-fous au résultat du repli', done => {
    getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));
    getProductsSpy.and.returnValue(
      of(pagedProducts([makeProduct({ code: 'TSHIRT', isVariantTemplate: true })]))
    );

    service.resolve('TSHIRT').subscribe(result => {
      expect(result.status).toBe('template');
      done();
    });
  });
});
