import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AutoCompleteSelectEvent } from 'primeng/autocomplete';

import { PERMISSIONS } from '@core/config/permission-keys';
import { ProductListItem } from '@core/services/product.service';
import { SupplierListItem } from '@core/services/supplier.service';
import { PurchaseReceiptImportPrefillStore, PurchaseReceiptImportPayload } from '../../services/purchase-receipt-import-prefill.store';
import {
  PurchaseReceiptImportLine,
  PurchaseReceiptImportProposal,
  PurchaseReceiptImportSupplier
} from '../../models/purchase-receipt-import.models';
import { PurchaseReceiptFormComponent } from './purchase-receipt-form.component';

type ReceiptLineRow = any;

function makeFile(): File {
  return new File(['%PDF-1.4'], 'facture.pdf', { type: 'application/pdf' });
}

function makeSupplier(overrides: Partial<PurchaseReceiptImportSupplier> = {}): PurchaseReceiptImportSupplier {
  return {
    matchOutcome: 'MatchedByNif',
    supplierId: 's-1',
    supplierName: 'ACME',
    extractedName: 'ACME',
    extractedNif: '123456A',
    candidates: [],
    prefill: null,
    ...overrides
  };
}

function makeLine(overrides: Partial<PurchaseReceiptImportLine> = {}): PurchaseReceiptImportLine {
  return {
    index: 0,
    extractedCode: 'ABC',
    designation: 'Chaise',
    unit: 'Un',
    quantity: 2,
    unitPriceHt: 45,
    discountPercent: 0,
    vatRatePercent: 19,
    lineTotalHt: 90,
    matchMethod: 'code',
    productId: 'p-1',
    productCode: 'ABC',
    productName: 'Chaise',
    productVatRatePercent: 19,
    vatMismatch: false,
    candidates: [],
    prefill: null,
    ...overrides
  };
}

function makeProposal(overrides: Partial<PurchaseReceiptImportProposal> = {}): PurchaseReceiptImportProposal {
  return {
    extractionProvider: 'llm-vision',
    ocrApplied: false,
    documentType: 'PurchaseInvoice',
    documentNumber: 'FA-100',
    header: {
      receiptDate: '2026-10-01',
      deliveryNoteNumber: 'BL-9',
      supplierReference: 'REF-9',
      currency: 'TND',
      suggestedNotes: 'Note extraite',
      suggestedWarehouseId: null
    },
    supplier: makeSupplier(),
    lines: [makeLine()],
    documentTotals: { subTotal: 90, totalVat: 17.1, totalAmount: 107.1 },
    expectedReceiptTotals: { subTotal: 90, totalVat: 17.1, totalAmount: 107.1 },
    confidence: 'high',
    warnings: [],
    canCreateSupplier: true,
    canCreateProduct: true,
    canAttach: undefined,
    ...overrides
  } as PurchaseReceiptImportProposal;
}

function makeProductListItem(overrides: Partial<ProductListItem> = {}): ProductListItem {
  return {
    id: 'p-1',
    code: 'ABC',
    name: 'Chaise',
    description: null,
    typeDisplay: 'Produit',
    categoryId: 'c1',
    category: 'Cat',
    unitPrice: 75,
    purchasePrice: 45,
    unit: 'Unité',
    vatRate: 19,
    isActive: true,
    isStockManaged: true,
    ...overrides
  };
}

describe('PurchaseReceiptFormComponent — import de document', () => {
  let component: any;
  let authMock: { hasPermission: jasmine.Spy; isFirmDelegatedReadonly: jasmine.Spy };
  let productServiceMock: { getProduct: jasmine.Spy };
  let receiptServiceMock: {
    createPurchaseReceipt: jasmine.Spy;
    updatePurchaseReceipt: jasmine.Spy;
    uploadAttachment: jasmine.Spy;
    validatePurchaseReceipt: jasmine.Spy;
    getPurchaseReceipt: jasmine.Spy;
  };
  let toastSpy: jasmine.Spy;
  let navigateSpy: jasmine.Spy;
  let importStoreMock: { hasPending: boolean; consume: jasmine.Spy; clear: jasmine.Spy };

  function createComponent(): any {
    const c: any = Object.create(PurchaseReceiptFormComponent.prototype);

    c.lines = [];
    c.suppliers = signal<SupplierListItem[]>([]);
    c.purchaseOrderOptions = signal<{ id: string; label: string }[]>([]);
    c.importState = signal(null);
    c.stockFeatures = signal(null);
    c.traceabilityByProduct = signal(new Map());
    c.totalTTC = signal(0);
    c.totalHT = signal(0);
    c.totalVat = signal(0);
    c.totalOrderedHT = signal(0);
    c.remainingHT = signal(0);
    c.loading = signal(true);
    c.submitting = signal(false);
    c.submitMode = signal(null);
    c.isEdit = signal(false);
    c.savedId = signal(null);
    c.selectedSupplierId = null;
    c.selectedPurchaseOrderId = null;
    c.lockedPurchaseOrderId = null;
    c.selectedWarehouseId = null;
    c.receiptDate = new Date();
    c.supplierReference = '';
    c.deliveryNoteNumber = '';
    c.notes = '';
    c.quickCreateSupplierVisible = false;
    c.quickCreateSupplierPrefill = null;
    c.quickCreateProductVisible = false;
    c.quickCreateProductPrefillValue = null;
    c.lineIndexForNewProduct = -1;

    authMock = {
      hasPermission: jasmine.createSpy('hasPermission').and.returnValue(true),
      isFirmDelegatedReadonly: jasmine.createSpy('isFirmDelegatedReadonly').and.returnValue(false)
    };
    c.auth = authMock;

    importStoreMock = {
      hasPending: false,
      consume: jasmine.createSpy('consume').and.returnValue(null),
      clear: jasmine.createSpy('clear')
    };
    c.importStore = importStoreMock;

    productServiceMock = {
      getProduct: jasmine.createSpy('getProduct').and.returnValue(of({ success: true, data: makeProductListItem() }))
    };
    c.productService = productServiceMock;

    receiptServiceMock = {
      createPurchaseReceipt: jasmine.createSpy('createPurchaseReceipt').and.returnValue(of({ success: true, data: 'r-1' })),
      updatePurchaseReceipt: jasmine.createSpy('updatePurchaseReceipt').and.returnValue(of({ success: true })),
      uploadAttachment: jasmine.createSpy('uploadAttachment').and.returnValue(of({ success: true })),
      validatePurchaseReceipt: jasmine.createSpy('validatePurchaseReceipt').and.returnValue(of({ success: true })),
      getPurchaseReceipt: jasmine.createSpy('getPurchaseReceipt').and.returnValue(of({ success: true, data: { lines: [] } }))
    };
    c.receiptService = receiptServiceMock;

    toastSpy = jasmine.createSpy('add');
    c.toastService = { add: toastSpy };

    navigateSpy = jasmine.createSpy('navigate');
    c.router = { navigate: navigateSpy };
    c.route = { snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null } } };
    c.errorHandler = { extractErrorMessage: () => 'erreur' };

    spyOn(c, 'loadTraceabilityContext').and.stub();
    spyOn(c, 'recalculateTotals').and.callFake(() => {
      let ht = 0;
      for (const l of c.lines as ReceiptLineRow[]) {
        const discount = (l.discountPercent ?? 0) / 100;
        ht += l.receivedQuantity * l.unitPriceHT * (1 - discount);
      }
      c.totalTTC.set(ht);
    });
    spyOn(c, 'loadEligiblePurchaseOrders').and.stub();
    spyOn(c, 'defaultAllocationsForProduct').and.returnValue([{ quantity: 1 }]);
    spyOn(c, 'hasTrackedLines').and.returnValue(false);
    spyOn(c, 'ensureEditUrl').and.callFake((id: string) => navigateSpy(['/purchase-receipts', id, 'edit']));

    return c;
  }

  beforeEach(() => {
    component = createComponent();
  });

  describe('applyImport', () => {
    it('présélectionne le fournisseur reconnu par NIF et charge ses BC', () => {
      component.applyImport({ proposal: makeProposal(), file: makeFile() } as PurchaseReceiptImportPayload);

      expect(component.selectedSupplierId).toBe('s-1');
      expect(component.importState()?.supplierResolution).toBe('matched');
      expect(component.loadEligiblePurchaseOrders).toHaveBeenCalledWith('s-1');
    });

    it('présélectionne le fournisseur reconnu par nom', () => {
      const proposal = makeProposal({ supplier: makeSupplier({ matchOutcome: 'MatchedByName', supplierId: 's-2' }) });
      component.applyImport({ proposal, file: makeFile() } as PurchaseReceiptImportPayload);

      expect(component.selectedSupplierId).toBe('s-2');
      expect(component.importState()?.supplierResolution).toBe('matched');
    });

    it('ne présélectionne rien pour un fournisseur ambigu ou introuvable, mais ajoute les candidats', () => {
      const proposal = makeProposal({
        supplier: makeSupplier({
          matchOutcome: 'NotFound',
          supplierId: null,
          candidates: [{ id: 's-3', name: 'Candidat', nif: null, city: null, isActive: true }]
        })
      });
      component.applyImport({ proposal, file: makeFile() } as PurchaseReceiptImportPayload);

      expect(component.selectedSupplierId).toBeNull();
      expect(component.importState()?.supplierResolution).toBe('pending');
      expect(component.suppliers().some((s: SupplierListItem) => s.id === 's-3')).toBeTrue();
    });

    it('applique les champs d’en-tête et utilise la date du jour si absente', () => {
      const before = new Date();
      const proposal = makeProposal({
        header: {
          receiptDate: null,
          deliveryNoteNumber: 'BL-42',
          supplierReference: 'REF-42',
          currency: 'TND',
          suggestedNotes: 'Notes',
          suggestedWarehouseId: null
        }
      });
      component.applyImport({ proposal, file: makeFile() } as PurchaseReceiptImportPayload);

      expect(component.deliveryNoteNumber).toBe('BL-42');
      expect(component.supplierReference).toBe('REF-42');
      expect(component.notes).toBe('Notes');
      expect(component.receiptDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('utilise l’entrepôt suggéré seulement si aucun entrepôt n’est déjà sélectionné', () => {
      component.selectedWarehouseId = 'wh-already-set';
      const proposal = makeProposal({
        header: {
          receiptDate: null, deliveryNoteNumber: null, supplierReference: null,
          currency: null, suggestedNotes: null, suggestedWarehouseId: 'wh-suggested'
        }
      });
      component.applyImport({ proposal, file: makeFile() } as PurchaseReceiptImportPayload);
      expect(component.selectedWarehouseId).toBe('wh-already-set');

      const component2 = createComponent();
      component2.applyImport({ proposal, file: makeFile() } as PurchaseReceiptImportPayload);
      expect(component2.selectedWarehouseId).toBe('wh-suggested');
    });

    it('refuse canCreateSupplier/canCreateProduct si le droit local manque, même si la proposition les autorise', () => {
      authMock.hasPermission.and.callFake((perm: string) => perm !== PERMISSIONS.suppliers.create);
      const proposal = makeProposal({ canCreateSupplier: true, canCreateProduct: true });
      component.applyImport({ proposal, file: makeFile() } as PurchaseReceiptImportPayload);

      expect(component.importState()?.canCreateSupplier).toBeFalse();
      expect(component.importState()?.canCreateProduct).toBeTrue();
    });

    it('refuse toute création pour un cabinet délégué en lecture seule', () => {
      authMock.isFirmDelegatedReadonly.and.returnValue(true);
      const proposal = makeProposal({ canCreateSupplier: true, canCreateProduct: true });
      component.applyImport({ proposal, file: makeFile() } as PurchaseReceiptImportPayload);

      expect(component.importState()?.canCreateSupplier).toBeFalse();
      expect(component.importState()?.canCreateProduct).toBeFalse();
    });

    it('repose sur hasPermission(purchaseReceipts.update) quand canAttach est absent', () => {
      authMock.hasPermission.and.callFake((perm: string) => perm === PERMISSIONS.purchaseReceipts.update);
      const proposal = makeProposal({ canAttach: undefined });
      component.applyImport({ proposal, file: makeFile() } as PurchaseReceiptImportPayload);

      expect(component.importState()?.canAttach).toBeTrue();
    });

    it('ramène une quantité nulle ou négative à 1 et marque la ligne à vérifier', () => {
      const proposal = makeProposal({ lines: [makeLine({ quantity: 0, productId: null, matchMethod: 'none' })] });
      component.applyImport({ proposal, file: makeFile() } as PurchaseReceiptImportPayload);

      const line = component.lines[0] as ReceiptLineRow & { importInfo: any };
      expect(line.receivedQuantity).toBe(1);
      expect(line.importInfo.quantityToCheck).toBeTrue();
    });

    it('marque une ligne ambiguë ou sans correspondance comme "pending" avec ses candidats', () => {
      const candidates = [{ id: 'c-1', code: 'X', name: 'Candidat X', vatRatePercent: 19, purchasePrice: 10 }];
      const proposal = makeProposal({
        lines: [makeLine({ productId: null, matchMethod: 'ambiguous', candidates })]
      });
      component.applyImport({ proposal, file: makeFile() } as PurchaseReceiptImportPayload);

      const line = component.lines[0] as ReceiptLineRow & { importInfo: any };
      expect(line.productId).toBeNull();
      expect(line.importInfo.resolution).toBe('pending');
      expect(line.importInfo.candidates).toEqual(candidates);
    });

    it('enrichit la ligne reconnue avec les données catalogue tout en gardant le prix du document', (done) => {
      productServiceMock.getProduct.and.returnValue(of({
        success: true,
        data: makeProductListItem({ vatRate: 7, unit: 'Kg' })
      }));
      const proposal = makeProposal({ lines: [makeLine({ unitPriceHt: 45, productId: 'p-1' })] });
      component.applyImport({ proposal, file: makeFile() } as PurchaseReceiptImportPayload);

      setTimeout(() => {
        const line = component.lines[0] as ReceiptLineRow;
        expect(line.vatRate).toBe(7);
        expect(line.unit).toBe('Kg');
        expect(line.unitPriceHT).toBe(45);
        expect(component.loading()).toBeFalse();
        done();
      }, 0);
    });

    it('repasse la ligne en "pending" si le produit catalogue est introuvable', (done) => {
      productServiceMock.getProduct.and.returnValue(of({ success: false, data: null }));
      const proposal = makeProposal({ lines: [makeLine({ productId: 'p-missing' })] });
      component.applyImport({ proposal, file: makeFile() } as PurchaseReceiptImportPayload);

      setTimeout(() => {
        const line = component.lines[0] as ReceiptLineRow & { importInfo: any };
        expect(line.productId).toBeNull();
        expect(line.importInfo.resolution).toBe('pending');
        done();
      }, 0);
    });
  });

  describe('onProductSelect (ligne importée)', () => {
    it('conserve le prix et la remise du document et passe en "mapped"', () => {
      const line: any = {
        product: null, productId: null, productCode: '', productName: '', designation: '',
        unit: '', orderedQuantity: 0, receivedQuantity: 2, alreadyReceivedQuantity: 0,
        unitPriceHT: 0, discountPercent: null, vatRate: 19, purchaseOrderLineId: null,
        trackingMode: 0, pickingPolicy: 0, lotAllocations: [],
        importInfo: { index: 0, extractedUnitPriceHt: 45, extractedDiscountPercent: 5, resolution: 'pending' }
      };
      component.lines.push(line);

      component.onProductSelect(line, { value: makeProductListItem({ purchasePrice: 999 }) } as AutoCompleteSelectEvent);

      expect(line.unitPriceHT).toBe(45);
      expect(line.discountPercent).toBe(5);
      expect(line.importInfo.resolution).toBe('mapped');
    });
  });

  describe('onQuickProductCreated', () => {
    it('applique le produit créé à la ligne cible et aux lignes "pending" de même code extrait', () => {
      const target: any = {
        product: null, productId: null, productCode: '', productName: '', designation: '',
        unit: '', orderedQuantity: 0, receivedQuantity: 1, alreadyReceivedQuantity: 0,
        unitPriceHT: 0, discountPercent: null, vatRate: 19, purchaseOrderLineId: null,
        trackingMode: 0, pickingPolicy: 0, lotAllocations: [],
        importInfo: { index: 0, extractedCode: 'XYZ', resolution: 'pending' }
      };
      const sameCode: any = {
        product: null, productId: null, productCode: '', productName: '', designation: '',
        unit: '', orderedQuantity: 0, receivedQuantity: 1, alreadyReceivedQuantity: 0,
        unitPriceHT: 0, discountPercent: null, vatRate: 19, purchaseOrderLineId: null,
        trackingMode: 0, pickingPolicy: 0, lotAllocations: [],
        importInfo: { index: 1, extractedCode: 'xyz', resolution: 'pending' }
      };
      const otherCode: any = {
        product: null, productId: null, productCode: '', productName: '', designation: '',
        unit: '', orderedQuantity: 0, receivedQuantity: 1, alreadyReceivedQuantity: 0,
        unitPriceHT: 0, discountPercent: null, vatRate: 19, purchaseOrderLineId: null,
        trackingMode: 0, pickingPolicy: 0, lotAllocations: [],
        importInfo: { index: 2, extractedCode: 'OTHER', resolution: 'pending' }
      };
      component.lines = [target, sameCode, otherCode];
      component.lineIndexForNewProduct = 0;

      component.onQuickProductCreated(makeProductListItem());

      expect(target.productId).toBe('p-1');
      expect(target.importInfo.resolution).toBe('created');
      expect(sameCode.productId).toBe('p-1');
      expect(sameCode.importInfo.resolution).toBe('created');
      expect(otherCode.productId).toBeNull();
      expect(toastSpy).toHaveBeenCalled();
    });
  });

  describe('onSupplierCreated', () => {
    it('ajoute le fournisseur aux options, le sélectionne et notifie', () => {
      component.onSupplierChange = jasmine.createSpy('onSupplierChange');
      component.importState.set({
        supplierResolution: 'pending', canAttach: true, canCreateSupplier: true, canCreateProduct: true,
        attachment: 'pending', gapAccepted: false, suggestionsConfirmed: false
      } as any);

      component.onSupplierCreated({ id: 's-new', name: 'Nouveau fournisseur' } as any);

      expect(component.selectedSupplierId).toBe('s-new');
      expect(component.suppliers().some((s: SupplierListItem) => s.id === 's-new')).toBeTrue();
      expect(component.importState()?.supplierResolution).toBe('created');
      expect(component.quickCreateSupplierVisible).toBeFalse();
      expect(toastSpy).toHaveBeenCalled();
    });
  });

  describe('importBlockingReasons / canSave', () => {
    it('ne renvoie rien hors import', () => {
      expect(component.importBlockingReasons()).toEqual([]);
    });

    it('liste le fournisseur, l’entrepôt et les lignes "pending" manquants', () => {
      component.importState.set({} as any);
      component.selectedSupplierId = null;
      component.selectedWarehouseId = null;
      component.lines = [
        { importInfo: { index: 0, resolution: 'pending' } } as any,
        { importInfo: { index: 1, resolution: 'matched' } } as any
      ];

      const reasons = component.importBlockingReasons();
      expect(reasons.length).toBe(3);
      expect(reasons.some((r: any) => r.targetId === 'supplier')).toBeTrue();
      expect(reasons.some((r: any) => r.targetId === 'receipt-warehouse')).toBeTrue();
      expect(reasons.some((r: any) => r.targetId === 'line-import-actions-0')).toBeTrue();
    });

    it('canSave() reste faux tant qu’une ligne importée n’a pas de produit', () => {
      component.selectedSupplierId = 's-1';
      component.selectedWarehouseId = 'wh-1';
      component.receiptDate = new Date();
      component.lines = [{ productId: null, receivedQuantity: 1 } as any];

      expect(component.canSave()).toBeFalse();
    });
  });

  describe('save() avec pièce jointe d’import', () => {
    function withImportState(overrides: Record<string, any> = {}) {
      component.selectedSupplierId = 's-1';
      component.selectedWarehouseId = 'wh-1';
      component.receiptDate = new Date();
      component.lines = [{
        productId: 'p-1', receivedQuantity: 1, unitPriceHT: 10, orderedQuantity: 0,
        purchaseOrderLineId: null, discountPercent: 0
      } as any];
      component.importState.set({
        sourceFile: makeFile(),
        canAttach: true,
        attachment: 'pending',
        ...overrides
      } as any);
    }

    it('à la création, enregistre puis joint le document une seule fois avant de naviguer', () => {
      withImportState();

      component.save('draft');

      expect(receiptServiceMock.createPurchaseReceipt).toHaveBeenCalledTimes(1);
      expect(receiptServiceMock.uploadAttachment).toHaveBeenCalledTimes(1);
      expect(receiptServiceMock.uploadAttachment).toHaveBeenCalledWith('r-1', jasmine.any(File));
      expect(component.importState()?.attachment).toBe('uploaded');
      expect(component.ensureEditUrl).toHaveBeenCalledWith('r-1');
    });

    it('si l’envoi de la pièce jointe échoue, affiche un avertissement mais considère le bon enregistré', () => {
      withImportState();
      receiptServiceMock.uploadAttachment.and.returnValue(of({ success: false }));

      component.save('draft');

      expect(component.importState()?.attachment).toBe('failed');
      expect(toastSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'warn' }));
      expect(component.ensureEditUrl).toHaveBeenCalledWith('r-1');
    });

    it('en mode "validate", enregistre puis joint le document avant de valider', () => {
      withImportState();
      const callOrder: string[] = [];
      receiptServiceMock.uploadAttachment.and.callFake(() => {
        callOrder.push('upload');
        return of({ success: true });
      });
      receiptServiceMock.validatePurchaseReceipt.and.callFake(() => {
        callOrder.push('validate');
        return of({ success: true });
      });

      component.save('validate');

      expect(callOrder).toEqual(['upload', 'validate']);
    });

    it('ne joint rien si l’utilisateur n’a pas le droit, et avertit', () => {
      withImportState({ canAttach: false });

      component.save('draft');

      expect(receiptServiceMock.uploadAttachment).not.toHaveBeenCalled();
      expect(component.importState()?.attachment).toBe('skipped');
      expect(toastSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'info' }));
    });

    it('ne joint le document qu’une seule fois : un second enregistrement (édition) ne le renvoie pas', () => {
      withImportState();
      component.save('draft');
      expect(receiptServiceMock.uploadAttachment).toHaveBeenCalledTimes(1);

      // Deuxième enregistrement : savedId() est maintenant renseigné (édition), attachment "uploaded".
      component.save('draft');
      expect(receiptServiceMock.uploadAttachment).toHaveBeenCalledTimes(1);
    });
  });

  describe('ngOnInit', () => {
    function baseNgOnInitSetup() {
      component.warehouseContext = { selectedWarehouseId: () => null };
      spyOn(component, 'setupProductSearch').and.stub();
      component.stockService = { getFeatures: () => of({ success: true, data: null }) };
      spyOn(component, 'loadSuppliers').and.stub();
      spyOn(component, 'applyImport').and.stub();
      spyOn(component, 'prefillFromPo').and.stub();
      component.breadcrumbItems = [];
    }

    it('un purchaseOrderId prioritaire vide le store d’import sans l’appliquer', () => {
      baseNgOnInitSetup();
      component.route.snapshot.queryParamMap.get = (key: string) => (key === 'purchaseOrderId' ? 'po-1' : null);
      importStoreMock.hasPending = true;

      component.ngOnInit();

      expect(importStoreMock.clear).toHaveBeenCalled();
      expect(component.applyImport).not.toHaveBeenCalled();
      expect(component.prefillFromPo).toHaveBeenCalledWith('po-1');
    });

    it('un id d’édition ne consomme pas le store', () => {
      baseNgOnInitSetup();
      spyOn(component, 'loadReceipt').and.stub();
      component.route.snapshot.paramMap.get = (key: string) => (key === 'id' ? 'r-1' : null);
      importStoreMock.hasPending = true;

      component.ngOnInit();

      expect(importStoreMock.consume).not.toHaveBeenCalled();
      expect(importStoreMock.clear).not.toHaveBeenCalled();
      expect(component.applyImport).not.toHaveBeenCalled();
    });

    it('sans id ni BC, applique la proposition en attente du store', () => {
      baseNgOnInitSetup();
      const payload = { proposal: makeProposal(), file: makeFile() } as PurchaseReceiptImportPayload;
      importStoreMock.hasPending = true;
      importStoreMock.consume.and.returnValue(payload);

      component.ngOnInit();

      expect(component.applyImport).toHaveBeenCalledWith(payload);
    });
  });
});
