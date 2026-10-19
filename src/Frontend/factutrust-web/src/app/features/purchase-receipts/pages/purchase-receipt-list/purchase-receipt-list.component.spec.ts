import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { PurchaseReceiptListComponent } from './purchase-receipt-list.component';
import { PurchaseReceiptService, PurchaseReceiptStatus } from '@core/services/purchase-receipt.service';
import { SupplierService } from '@core/services/supplier.service';
import { AuthService } from '@core/services/auth.service';
import { DataExportService } from '@core/services/data-export.service';
import { ToastService } from '@core/services/toast.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ExportExcelButtonComponent } from '@shared/components/export-excel-button/export-excel-button.component';
import { PurchaseReceiptImportDialogComponent } from '../../components/purchase-receipt-import-dialog/purchase-receipt-import-dialog.component';
import { PurchaseReceiptImportPrefillStore } from '../../services/purchase-receipt-import-prefill.store';

describe('PurchaseReceiptListComponent (export Excel)', () => {
  let fixture: ComponentFixture<PurchaseReceiptListComponent>;
  let component: PurchaseReceiptListComponent;
  let downloadDataset: jasmine.Spy;

  async function setup(permissions: string[]): Promise<void> {
    downloadDataset = jasmine.createSpy('downloadDataset').and.returnValue(of(undefined));
    const auth = {
      user: signal({ effectivePermissions: permissions }),
      hasPermission: (permission: string) => permissions.includes(permission),
      hasAllPermissions: (required: string[]) => required.every(p => permissions.includes(p)),
      hasAnyPermission: (required: readonly string[]) => required.some(p => permissions.includes(p)),
      isFirmDelegatedReadonly: () => false
    };

    await TestBed.configureTestingModule({
      imports: [PurchaseReceiptListComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: AuthService, useValue: auth },
        {
          provide: PurchaseReceiptService,
          useValue: {
            getPurchaseReceipts: () => of({ success: true, data: { items: [], totalCount: 0 } }),
            getPurchaseReceiptsSummary: () => of({ success: true, data: null })
          }
        },
        { provide: SupplierService, useValue: { getActiveSuppliers: () => of({ success: true, data: { items: [] } }) } },
        { provide: DataExportService, useValue: { downloadDataset } },
        { provide: ToastService, useValue: { add: jasmine.createSpy('add') } },
        { provide: PurchaseReceiptImportPrefillStore, useValue: { set: () => undefined } }
      ]
    })
      .overrideComponent(PurchaseReceiptListComponent, {
        remove: { imports: [PurchaseReceiptImportDialogComponent] },
        add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] }
      })
      .compileComponents();

    fixture = TestBed.createComponent(PurchaseReceiptListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the export button for purchase receipts between Import and New', async () => {
    await setup([PERMISSIONS.purchaseReceipts.read, PERMISSIONS.purchaseReceipts.create, 'ai:chat']);

    const exportButton = fixture.debugElement.query(By.directive(ExportExcelButtonComponent));
    expect(exportButton).withContext('export button').not.toBeNull();
    expect((exportButton.componentInstance as ExportExcelButtonComponent).dataset).toBe('purchase-receipts');

    const header = fixture.nativeElement.querySelector('app-page-header') as HTMLElement;
    const order = Array.from(header.querySelectorAll('app-button, app-export-excel-button'))
      .filter(el => el.tagName.toLowerCase() === 'app-export-excel-button' || !el.closest('app-export-excel-button'))
      .map(el => el.tagName.toLowerCase() === 'app-export-excel-button' ? 'export' : (el.textContent ?? '').trim());
    expect(order.length).toBe(3);
    expect(order[0]).toContain('Importer');
    expect(order[1]).toBe('export');
    expect(order[2]).toContain('Nouveau');
  });

  it('keeps the export button for a read-only user', async () => {
    await setup([PERMISSIONS.purchaseReceipts.read]);

    expect(fixture.debugElement.query(By.directive(ExportExcelButtonComponent))).not.toBeNull();
  });

  it('sends the current screen filters and keeps the Draft (0) status', async () => {
    await setup([PERMISSIONS.purchaseReceipts.read]);
    expect(component.purchaseReceiptExportFilters()).toEqual({
      search: null, status: null, supplierId: null, fromDate: null, toDate: null
    });

    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 31);
    component.searchTerm = 'BR-2026';
    component.selectedStatus = PurchaseReceiptStatus.Draft;
    component.selectedSupplierId = 'supplier-1';
    component.fromDate = from;
    component.toDate = to;

    const exportButton = fixture.debugElement.query(By.directive(ExportExcelButtonComponent));
    (exportButton.componentInstance as ExportExcelButtonComponent).exportNow();

    expect(downloadDataset).toHaveBeenCalledOnceWith('purchase-receipts', {
      search: 'BR-2026', status: 0, supplierId: 'supplier-1', fromDate: from, toDate: to
    });
  });
});
