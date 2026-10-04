import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { SupplierInvoiceFormComponent } from './supplier-invoice-form.component';
import { SupplierInvoiceService } from '@core/services/supplier-invoice.service';
import { SupplierService } from '@core/services/supplier.service';
import { ProductService } from '@core/services/product.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { AccountingFeatureFlagsService } from '@features/accounting/shared/accounting-feature-flags.service';
import { StockService } from '@core/services/stock.service';
import { DrawerOverlayService } from '@core/services/drawer-overlay.service';
import { formatLocalDate } from '@core/utils/date.util';
import { AutoCompleteSelectEvent } from 'primeng/autocomplete';

describe('SupplierInvoiceFormComponent', () => {
  let component: SupplierInvoiceFormComponent;
  let fixture: ComponentFixture<SupplierInvoiceFormComponent>;
  let createSpy: jasmine.Spy;
  let previewNumberSpy: jasmine.Spy;
  let toastAddSpy: jasmine.Spy;
  let navigateSpy: jasmine.Spy;

  const mockProduct = {
    id: 'prod-1',
    code: 'SVC001',
    name: 'Service test',
    isStockManaged: false,
    purchasePrice: 150,
    unitPrice: 150,
    vatRate: 19
  };

  const stockProduct = {
    ...mockProduct,
    id: 'prod-stock',
    isStockManaged: true
  };

  beforeEach(async () => {
    createSpy = jasmine.createSpy('create').and.returnValue(
      of({ success: true, data: { id: 'inv-1', invoiceNumber: 'FS-2026-000001' } })
    );
    previewNumberSpy = jasmine.createSpy('previewNumber').and.returnValue(
      of({ success: true, data: 'FS-2026-000001' })
    );
    toastAddSpy = jasmine.createSpy('add');

    await TestBed.configureTestingModule({
      imports: [SupplierInvoiceFormComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        // Le sous-arbre du composant (directive de permission, services partagés) injecte
        // AuthService → HttpClient : les fournir, les requêtes restent interceptées par le test.
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: SupplierInvoiceService,
          useValue: { create: createSpy, previewNumber: previewNumberSpy }
        },
        {
          provide: SupplierService,
          useValue: {
            getActiveSuppliers: () => of({ success: true, data: { items: [] } })
          }
        },
        {
          provide: ProductService,
          useValue: {
            getProducts: () => of({ success: true, data: { items: [] } })
          }
        },
        { provide: ToastService, useValue: { add: toastAddSpy } },
        {
          provide: ErrorHandlerService,
          useValue: {
            extractErrorMessage: () => 'Erreur API',
            logError: jasmine.createSpy('logError')
          }
        },
        {
          provide: WarehouseContextService,
          useValue: { selectedWarehouseId: () => null }
        },
        {
          provide: AccountingFeatureFlagsService,
          useValue: { isEnabled: () => false }
        },
        {
          provide: StockService,
          useValue: {
            getWarehouses: () => of({ success: true, data: [] })
          }
        },
        {
          provide: DrawerOverlayService,
          useValue: { register: () => {}, unregister: () => {} }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SupplierInvoiceFormComponent);
    component = fixture.componentInstance;
    navigateSpy = spyOn(TestBed.inject(Router), 'navigate').and.returnValue(Promise.resolve(true));
    fixture.detectChanges();
  });

  describe('canSubmit', () => {
    it('returns false without supplier', () => {
      component.selectedSupplierId = null;
      component.lines[0].productId = 'prod-1';
      component.lines[0].quantity = 1;
      expect(component.canSubmit()).toBeFalse();
    });

    it('returns false without valid line', () => {
      component.selectedSupplierId = 'sup-1';
      component.lines[0].productId = null;
      expect(component.canSubmit()).toBeFalse();
    });

    it('returns false without invoice number when not using suggested', () => {
      component.selectedSupplierId = 'sup-1';
      component.lines[0].productId = 'prod-1';
      component.lines[0].quantity = 2;
      component.useSuggestedNumber = false;
      component.invoiceNumber = '   ';
      expect(component.canSubmit()).toBeFalse();
    });

    it('returns true for valid nominal case with suggested number', () => {
      component.selectedSupplierId = 'sup-1';
      component.lines[0].productId = 'prod-1';
      component.lines[0].quantity = 2;
      component.useSuggestedNumber = true;
      expect(component.canSubmit()).toBeTrue();
    });
  });

  describe('lineTotalHT and recalculateTotals', () => {
    it('calculates line total with discount', () => {
      const line = component.lines[0];
      line.quantity = 2;
      line.unitPriceHT = 100;
      line.discountPercent = 10;
      expect(component.lineTotalHT(line)).toBe(180);
    });

    it('aggregates HT, VAT and TTC', () => {
      const line = component.lines[0];
      line.productId = 'prod-1';
      line.quantity = 1;
      line.unitPriceHT = 100;
      line.discountPercent = 0;
      line.vatRate = 19;
      component.recalculateTotals();
      expect(component.totalHT()).toBe(100);
      expect(component.totalVat()).toBe(19);
      expect(component.totalTTC()).toBe(119);
    });
  });

  describe('onProductSelect', () => {
    it('rejects stock-managed products', () => {
      const line = component.lines[0];
      component.onProductSelect(line, { value: stockProduct } as AutoCompleteSelectEvent);
      expect(line.productId).toBeNull();
      expect(toastAddSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'warn' }));
    });

    it('accepts non-stock products and recalculates', () => {
      const line = component.lines[0];
      component.onProductSelect(line, { value: mockProduct } as AutoCompleteSelectEvent);
      expect(line.productId).toBe('prod-1');
      expect(line.unitPriceHT).toBe(150);
      expect(line.vatRate).toBe(19);
      expect(component.totalHT()).toBeGreaterThan(0);
    });
  });

  describe('submit', () => {
    it('sends unchanged payload shape on success', () => {
      component.selectedSupplierId = 'sup-1';
      component.invoiceDate = new Date(2026, 8, 6);
      component.invoiceNumber = 'FS-2026-000001';
      component.useSuggestedNumber = true;
      component.paymentTermDays = 30;
      component.externalReference = 'EXT-1';
      component.notes = 'Note test';
      component.paymentMethod = 'Espèces';
      component.selectedWarehouseId = 'wh-1';
      component.lines[0].productId = 'prod-1';
      component.lines[0].quantity = 2;
      component.lines[0].unitPriceHT = 150;
      component.lines[0].discountPercent = 5;
      component.lines[0].isFixedAsset = false;

      component.submit();

      expect(createSpy).toHaveBeenCalledWith({
        supplierId: 'sup-1',
        invoiceNumber: 'FS-2026-000001',
        invoiceDate: formatLocalDate(component.invoiceDate),
        paymentTermDays: 30,
        externalReference: 'EXT-1',
        notes: 'Note test',
        paymentMethod: 'Espèces',
        warehouseId: 'wh-1',
        useSuggestedNumber: true,
        lines: [{
          productId: 'prod-1',
          quantity: 2,
          unitPriceHt: 150,
          discountPercent: 5,
          isFixedAsset: undefined,
          assetAccountNumber: undefined
        }]
      });
      expect(navigateSpy).toHaveBeenCalledWith(['/supplier-invoices', 'inv-1']);
    });

    it('does not submit when canSubmit is false', () => {
      component.selectedSupplierId = null;
      component.submit();
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  // Ces tests ciblaient `submitBlockers()` / `submitBlockersTooltip()`, qui n'existent pas sur le
  // composant : la soumission est pilotée par `canSubmit()`, un booléen, et le gabarit se contente
  // de désactiver le bouton (`[disabled]="submitting() || !canSubmit()"`). Ils ne compilaient plus et
  // bloquaient le chargement de TOUTE la suite Karma. Couverture reportée sur l'API réelle.
  describe('conditions de soumission (canSubmit)', () => {
    beforeEach(() => {
      component.selectedSupplierId = 'sup-1';
      component.lines[0].productId = 'prod-1';
      component.lines[0].quantity = 1;
      component.useSuggestedNumber = true;
    });

    it('autorise la soumission quand tout est renseigné', () => {
      expect(component.canSubmit()).toBeTrue();
    });

    it('refuse la soumission sans fournisseur', () => {
      component.selectedSupplierId = null;
      expect(component.canSubmit()).toBeFalse();
    });

    it('refuse la soumission sans ligne valide', () => {
      component.lines[0].productId = null;
      expect(component.canSubmit()).toBeFalse();
    });

    it('refuse la soumission sans numéro quand la suggestion est désactivée', () => {
      component.useSuggestedNumber = false;
      component.invoiceNumber = '   ';
      expect(component.canSubmit()).toBeFalse();
    });
  });
});
