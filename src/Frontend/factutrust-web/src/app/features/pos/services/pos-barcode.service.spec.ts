import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { PosBarcodeService } from './pos-barcode.service';
import { PosStateService } from './pos-state.service';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';

/**
 * Spec de CARACTÉRISATION du scan en caisse.
 *
 * Elle est écrite AVANT toute extraction du socle de scan partagé, et elle ne doit pas être
 * modifiée après : c'est elle qui prouve que le refactor n'a rien changé. Chaque cas épingle
 * un comportement dont la perte serait un défaut de sûreté, pas de confort — le scan
 * d'origine interrogeait le code produit interne avec repli sur une correspondance
 * approchée bidirectionnelle, et pouvait donc encaisser un autre article.
 *
 * Contrat épinglé ici :
 *  - la détection ne se déclenche jamais quand le focus est dans un champ de saisie ;
 *  - la résolution par code-barres est EXACTE, le repli sur le code interne aussi ;
 *  - un code ambigu signale l'ambiguïté au caissier au lieu de choisir pour lui.
 */
describe('PosBarcodeService', () => {
  let service: PosBarcodeService;

  let getProductByBarcodeSpy: jasmine.Spy;
  let getProductsSpy: jasmine.Spy;
  let addProductSpy: jasmine.Spy;
  let setErrorSpy: jasmine.Spy;
  let isCreditNote: boolean;
  let cartLines: Array<{ productId: string; quantity: number }>;
  let selectedWarehouseId: string | null;

  let hostInput: HTMLInputElement;

  const EAN = '4006381333931';

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

  /** Simule une douchette : des frappes rapides, puis Enter. */
  function typeCode(code: string, target: EventTarget = document): void {
    for (const char of code) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    }
  }

  function pressEnter(target: EventTarget = document): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  function scan(code: string, target: EventTarget = document): void {
    typeCode(code, target);
    pressEnter(target);
  }

  beforeEach(() => {
    getProductByBarcodeSpy = jasmine
      .createSpy('getProductByBarcode')
      .and.returnValue(of({ success: true, data: makeProduct() }));
    getProductsSpy = jasmine.createSpy('getProducts').and.returnValue(of(pagedProducts([])));
    addProductSpy = jasmine.createSpy('addProduct');
    setErrorSpy = jasmine.createSpy('setError');
    isCreditNote = false;
    cartLines = [];
    selectedWarehouseId = null;

    TestBed.configureTestingModule({
      providers: [
        PosBarcodeService,
        {
          provide: ProductService,
          useValue: {
            getProductByBarcode: getProductByBarcodeSpy,
            getProducts: getProductsSpy
          }
        },
        {
          provide: PosStateService,
          useValue: {
            addProduct: addProductSpy,
            setError: setErrorSpy,
            isCreditNote: () => isCreditNote,
            lines: () => cartLines
          }
        },
        {
          provide: WarehouseContextService,
          useValue: { selectedWarehouseId: () => selectedWarehouseId }
        }
      ]
    });

    service = TestBed.inject(PosBarcodeService);

    hostInput = document.createElement('input');
    document.body.appendChild(hostInput);
  });

  afterEach(() => {
    service.stopListening();
    hostInput.remove();
  });

  // ─────────────────────── Détection clavier ───────────────────────

  describe('détection de la douchette', () => {
    it('résout un code tapé rapidement puis validé par Enter', () => {
      service.startListening();

      scan(EAN);

      expect(getProductByBarcodeSpy).toHaveBeenCalledOnceWith(EAN);
      expect(service.lastScannedCode()).toBe(EAN);
    });

    it('n\'écoute rien tant que startListening n\'a pas été appelé', () => {
      scan(EAN);

      expect(getProductByBarcodeSpy).not.toHaveBeenCalled();
    });

    it('ignore totalement les frappes quand le focus est dans un champ de saisie', () => {
      // Garde-fou n°1 du chantier : la capture globale ne doit JAMAIS voler les frappes
      // destinées à un champ quantité ou prix.
      service.startListening();

      scan(EAN, hostInput);

      expect(getProductByBarcodeSpy).not.toHaveBeenCalled();
      expect(service.lastScannedCode()).toBeNull();
    });

    it('ignore les frappes combinées à un modificateur', () => {
      service.startListening();

      for (const char of EAN) {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: char, ctrlKey: true, bubbles: true })
        );
      }
      pressEnter();

      expect(getProductByBarcodeSpy).not.toHaveBeenCalled();
    });

    it('vide le tampon après le délai d\'inactivité : une saisie humaine ne devient pas un scan', fakeAsync(() => {
      service.startListening();

      typeCode(EAN);
      tick(51); // BUFFER_MS = 50
      pressEnter();

      expect(getProductByBarcodeSpy).not.toHaveBeenCalled();
    }));

    it('ignore un code plus court que la longueur minimale', () => {
      service.startListening();

      scan('12'); // MIN_LENGTH = 3

      expect(getProductByBarcodeSpy).not.toHaveBeenCalled();
    });

    it('stopListening retire l\'écoute et vide le tampon', () => {
      service.startListening();
      typeCode(EAN);

      service.stopListening();
      pressEnter();
      scan(EAN);

      expect(getProductByBarcodeSpy).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────── Résolution du code ───────────────────────

  describe('résolution par code-barres', () => {
    it('ajoute l\'article trouvé et signale le succès', () => {
      const product = makeProduct({ id: 'found' });
      getProductByBarcodeSpy.and.returnValue(of({ success: true, data: product }));
      service.startListening();

      scan(EAN);

      expect(addProductSpy).toHaveBeenCalledOnceWith(product);
      expect(service.lastScanResult()).toBe('added');
      expect(getProductsSpy).not.toHaveBeenCalled();
    });

    it('searchByCode suit exactement le même chemin qu\'un scan', () => {
      const product = makeProduct({ id: 'found' });
      getProductByBarcodeSpy.and.returnValue(of({ success: true, data: product }));

      service.searchByCode(EAN);

      expect(service.lastScannedCode()).toBe(EAN);
      expect(addProductSpy).toHaveBeenCalledOnceWith(product);
      expect(service.lastScanResult()).toBe('added');
    });
  });

  // ─────────────────────── Repli sur le code interne ───────────────────────

  describe('repli sur le code produit interne', () => {
    it('se déclenche sur une réponse négative (404 métier)', () => {
      getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));
      const product = makeProduct({ code: 'ART-001' });
      getProductsSpy.and.returnValue(of(pagedProducts([product])));
      service.startListening();

      scan('ART-001');

      expect(getProductsSpy).toHaveBeenCalled();
      expect(addProductSpy).toHaveBeenCalledOnceWith(product);
      expect(service.lastScanResult()).toBe('added');
    });

    it('se déclenche aussi sur une erreur HTTP (400 code mal formé)', () => {
      // Un code refusé pour format invalide arrive par le callback d'erreur, pas par next.
      // Les deux chemins doivent mener au repli, sans quoi un catalogue sans EAN devient
      // inutilisable en caisse.
      getProductByBarcodeSpy.and.returnValue(throwError(() => new Error('400')));
      const product = makeProduct({ code: 'ART-001' });
      getProductsSpy.and.returnValue(of(pagedProducts([product])));
      service.startListening();

      scan('ART-001');

      expect(addProductSpy).toHaveBeenCalledOnceWith(product);
    });

    it('n\'accepte qu\'une correspondance STRICTE : « 1234 » n\'ajoute jamais « 12345 »', () => {
      // Le défaut historique. La recherche serveur est un « contains » ; c'est le filtre
      // local en égalité stricte qui protège la caisse.
      getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));
      getProductsSpy.and.returnValue(of(pagedProducts([makeProduct({ code: '12345' })])));
      service.startListening();

      scan('1234');

      expect(addProductSpy).not.toHaveBeenCalled();
      expect(service.lastScanResult()).toBe('not_found');
    });

    it('compare le code sans tenir compte de la casse', () => {
      getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));
      const product = makeProduct({ code: 'art-001' });
      getProductsSpy.and.returnValue(of(pagedProducts([product])));
      service.startListening();

      scan('ART-001');

      expect(addProductSpy).toHaveBeenCalledOnceWith(product);
    });

    it('signale l\'ambiguïté plutôt que de choisir quand plusieurs articles correspondent', () => {
      getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));
      getProductsSpy.and.returnValue(
        of(
          pagedProducts([
            makeProduct({ id: 'a', code: 'DUP' }),
            makeProduct({ id: 'b', code: 'DUP' })
          ])
        )
      );
      service.startListening();

      scan('DUP');

      expect(addProductSpy).not.toHaveBeenCalled();
      expect(service.lastScanResult()).toBe('multiple');
    });

    it('signale l\'absence quand aucun article ne correspond', () => {
      getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));
      getProductsSpy.and.returnValue(of(pagedProducts([])));
      service.startListening();

      scan('INCONNU');

      expect(service.lastScanResult()).toBe('not_found');
    });

    it('signale l\'absence quand la recherche de repli échoue', () => {
      getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));
      getProductsSpy.and.returnValue(throwError(() => new Error('réseau')));
      service.startListening();

      scan('INCONNU');

      expect(service.lastScanResult()).toBe('not_found');
    });

    it('transmet l\'entrepôt courant à la recherche de repli', () => {
      selectedWarehouseId = 'wh-42';
      getProductByBarcodeSpy.and.returnValue(of({ success: false, data: null }));
      service.startListening();

      scan('ART-001');

      expect(getProductsSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({ search: 'ART-001', isActive: true, warehouseId: 'wh-42' })
      );
    });
  });

  // ─────────────────────── Garde de stock ───────────────────────

  describe('garde de stock', () => {
    it('refuse l\'ajout quand la quantité disponible est insuffisante', () => {
      getProductByBarcodeSpy.and.returnValue(
        of({ success: true, data: makeProduct({ isStockManaged: true, quantityAvailable: 0 }) })
      );
      service.startListening();

      scan(EAN);

      expect(addProductSpy).not.toHaveBeenCalled();
      expect(setErrorSpy).toHaveBeenCalled();
      expect(service.lastScanResult()).toBe('out_of_stock');
    });

    it('tient compte de la quantité déjà au panier', () => {
      cartLines = [{ productId: 'p1', quantity: 3 }];
      getProductByBarcodeSpy.and.returnValue(
        of({
          success: true,
          data: makeProduct({ id: 'p1', isStockManaged: true, quantityAvailable: 3 })
        })
      );
      service.startListening();

      scan(EAN);

      expect(service.lastScanResult()).toBe('out_of_stock');
    });

    it('n\'applique aucun contrôle de stock sur un avoir', () => {
      isCreditNote = true;
      getProductByBarcodeSpy.and.returnValue(
        of({ success: true, data: makeProduct({ isStockManaged: true, quantityAvailable: 0 }) })
      );
      service.startListening();

      scan(EAN);

      expect(addProductSpy).toHaveBeenCalled();
      expect(service.lastScanResult()).toBe('added');
    });

    it('laisse passer un article géré en stock dont la quantité est inconnue', () => {
      // État de fait documenté : la réponse de by-barcode ne porte pas quantityAvailable,
      // donc le garde de stock ne s'applique PAS au scan. Tout écran qui réutilisera cette
      // résolution hérite de cet angle mort et doit faire son propre contrôle.
      getProductByBarcodeSpy.and.returnValue(
        of({ success: true, data: makeProduct({ isStockManaged: true, quantityAvailable: null }) })
      );
      service.startListening();

      scan(EAN);

      expect(addProductSpy).toHaveBeenCalled();
      expect(service.lastScanResult()).toBe('added');
    });
  });
});
