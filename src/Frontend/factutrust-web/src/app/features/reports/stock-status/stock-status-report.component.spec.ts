import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { StockStatusReportComponent } from './stock-status-report.component';
import { ReportsApiService, StockStatusPdfError } from '@core/services/reports-api.service';
import { StockService } from '@core/services/stock.service';
import { ProductCategoryService } from '@core/services/product-category.service';
import { PrintPreviewService } from '@core/services/print-preview.service';
import { MessageService } from 'primeng/api';
import { COSTING_LIFO } from '@shared/utils/stock-traceability.utils';

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
          stockValue: 20,
          // Le service a déjà coercé l'énum (le back l'envoie par nom) : le composant
          // reçoit un nombre. La coercion est testée dans reports-api.service.costing.spec.ts.
          costingMethod: COSTING_LIFO,
          unitCostIsNextExit: true,
          hasValuationLayers: true,
          quantityDrift: false
        }],
        layeredRowCount: 1,
        driftRowCount: 0
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

  it('exports csv with localized headers and quoted cells', async () => {
    let captured: Blob | undefined;
    spyOn(URL, 'createObjectURL').and.callFake((blob: Blob) => {
      captured = blob;
      return 'blob:stock';
    });
    spyOn(URL, 'revokeObjectURL');
    spyOn(HTMLAnchorElement.prototype, 'click');

    fixture.componentInstance.exportCsv();
    await fixture.whenStable();
    const bytes = new Uint8Array(await captured!.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xEF, 0xBB, 0xBF]);
    const csv = new TextDecoder().decode(bytes);
    const header = [
      $localize`:@@reports.stock-status.col.entrepot:Entrepôt`,
      $localize`:@@reports.stock-status.col.categorie:Catégorie`,
      $localize`:@@reports.stock-status.col.code:Code`,
      $localize`:@@reports.stock-status.col.designation:Désignation`,
      $localize`:@@reports.stock-status.col.qte:Qté`,
      $localize`:@@reports.stock-status.col.pu:P.U.`,
      $localize`:@@reports.stock-status.col.valeur:Valeur`,
      $localize`:@@reports.stock-status.col.devise:Devise`,
      $localize`:@@reports.stock-status.col.methode:Méthode`
    ].join(';');

    expect(csv.split(/\r?\n/)[0]).toBe(header);
    expect(csv).toContain('"Magasin"');
    expect(csv).toContain('"Article"');
    // Sans la colonne Méthode, un P.U. de prochaine sortie est inexplicable dans l'export.
    expect(csv).toContain('"LIFO"');
  });

  it('labels the method on layered rows', () => {
    // Régression du commit 437e1284 : sans coercion en amont, le repère restait muet.
    expect(fixture.componentInstance.costingLabel(
      fixture.componentInstance.report()!.rows[0].costingMethod)).toBe('LIFO');
  });

  it('renders the next-exit legend only when layered rows are present', async () => {
    const legend = () => (fixture.nativeElement as HTMLElement).querySelector('.valuation-legend');
    expect(legend()).toBeTruthy();

    const data = fixture.componentInstance.report()!;
    fixture.componentInstance.report.set({ ...data, layeredRowCount: 0 });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(legend()).toBeNull();
  });

  it('shows an info toast for NoData without reading the french sentence', () => {
    reportsApi.downloadStockStatusPdf.and.returnValue(
      throwError(() => new StockStatusPdfError('لا توجد أصناف في المخزون لهذه المعايير.', 'NoData'))
    );
    const toast = fixture.debugElement.injector.get(MessageService);
    spyOn(toast, 'add');

    fixture.componentInstance.printPdf();

    expect(toast.add).toHaveBeenCalledWith(jasmine.objectContaining({
      severity: 'info',
      detail: 'لا توجد أصناف في المخزون لهذه المعايير.'
    }));
  });

  it('shows an error toast when an empty-looking french message is not NoData', () => {
    reportsApi.downloadStockStatusPdf.and.returnValue(
      throwError(() => new StockStatusPdfError('Aucun article en stock pour ces critères.', 'TooManyLines'))
    );
    const toast = fixture.debugElement.injector.get(MessageService);
    spyOn(toast, 'add');

    fixture.componentInstance.printPdf();

    expect(toast.add).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'error' }));
  });
});
