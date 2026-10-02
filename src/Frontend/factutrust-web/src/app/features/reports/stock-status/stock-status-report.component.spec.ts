import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { StockStatusReportComponent } from './stock-status-report.component';
import { ReportsApiService } from '@core/services/reports-api.service';
import { StockService } from '@core/services/stock.service';
import { ProductCategoryService } from '@core/services/product-category.service';
import { PrintPreviewService } from '@core/services/print-preview.service';
import { MessageService } from 'primeng/api';

describe('StockStatusReportComponent', () => {
  let fixture: ComponentFixture<StockStatusReportComponent>;
  let reportsApi: jasmine.SpyObj<ReportsApiService>;

  beforeEach(async () => {
    reportsApi = jasmine.createSpyObj('ReportsApiService', ['getStockStatus', 'downloadStockStatusPdf']);
    reportsApi.getStockStatus.and.returnValue(of({
      success: true,
      data: {
        groupingMode: 'WarehouseThenCategory',
        totalRows: 1,
        page: 1,
        pageSize: 50,
        grandTotalQuantity: 2,
        grandTotalValue: 20,
        currency: 'TND',
        generatedAtUtc: new Date().toISOString(),
        rows: [{
          productId: 'p1',
          productCode: 'A',
          productName: 'Article',
          categoryName: 'Cat',
          warehouseId: 'w1',
          warehouseCode: 'WH',
          warehouseName: 'Magasin',
          quantityOnHand: 2,
          unitCost: 10,
          stockValue: 20
        }]
      },
      message: null,
      errors: []
    }));

    await TestBed.configureTestingModule({
      imports: [StockStatusReportComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        MessageService,
        { provide: ReportsApiService, useValue: reportsApi },
        {
          provide: StockService,
          useValue: { getWarehouses: () => of({ success: true, data: [], message: null }) }
        },
        {
          provide: ProductCategoryService,
          useValue: { getProductCategories: () => of({ success: true, data: [], message: null }) }
        },
        { provide: PrintPreviewService, useValue: { openPdfForPrintPreview: () => undefined } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(StockStatusReportComponent);
    fixture.detectChanges();
  });

  it('loads stock status on init', () => {
    expect(reportsApi.getStockStatus).toHaveBeenCalled();
    expect(fixture.componentInstance.hasData()).toBeTrue();
  });

  it('builds primary groups from rows', () => {
    const groups = fixture.componentInstance.primaryGroups();
    expect(groups.length).toBeGreaterThan(0);
  });
});
