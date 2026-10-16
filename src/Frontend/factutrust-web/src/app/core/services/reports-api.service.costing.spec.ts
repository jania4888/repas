import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ReportsApiService } from './reports-api.service';
import { COSTING_AVERAGE, COSTING_FIFO, COSTING_LIFO } from '@shared/utils/stock-traceability.utils';
import { environment } from '@environments/environment';

/**
 * L'état de stock reçoit la méthode de valorisation sérialisée par NOM ("Fifo"). Sans coercion
 * ici, le repère de méthode et la légende « P.U. = prochaine sortie » resteraient muets, et
 * l'écart entre P.U. × Qté et la valeur passerait pour un bug de calcul.
 */
describe('ReportsApiService.getStockStatus — coercion de la méthode', () => {
  let service: ReportsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ReportsApiService, provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(ReportsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function row(costingMethod: unknown) {
    return {
      productId: 'p', productCode: 'A', productName: 'Article', categoryName: 'Cat',
      warehouseId: 'w', warehouseCode: 'WH', warehouseName: 'Magasin',
      quantityOnHand: 40, unitCost: 175, stockValue: 6475,
      vatRatePercent: 19, stockValueTtc: 7705.25,
      costingMethod, unitCostIsNextExit: true, hasValuationLayers: true, quantityDrift: false
    };
  }

  it('turns the enum names into numbers', () => {
    let rows: any[] = [];
    service.getStockStatus({}).subscribe(r => (rows = r.data!.rows));

    http.expectOne(req => req.url === `${environment.apiUrl}/reports/stock-status`).flush({
      success: true,
      message: null,
      data: {
        groupingMode: 'WarehouseThenCategory',
        totalRows: 3, page: 1, pageSize: 50,
        grandTotalQuantity: 120, grandTotalValue: 19425,
        layeredRowCount: 2, driftRowCount: 0,
        currency: 'TND', generatedAtUtc: new Date().toISOString(),
        rows: [row('Fifo'), row('Lifo'), row('Average')]
      }
    });

    expect(rows.map(r => r.costingMethod)).toEqual([COSTING_FIFO, COSTING_LIFO, COSTING_AVERAGE]);
  });

  it('keeps the counters that drive the legend', () => {
    let data: any;
    service.getStockStatus({}).subscribe(r => (data = r.data));

    http.expectOne(req => req.url === `${environment.apiUrl}/reports/stock-status`).flush({
      success: true,
      message: null,
      data: {
        groupingMode: 'WarehouseThenCategory',
        totalRows: 1, page: 1, pageSize: 50,
        grandTotalQuantity: 40, grandTotalValue: 6475,
        layeredRowCount: 1, driftRowCount: 0,
        currency: 'TND', generatedAtUtc: new Date().toISOString(),
        rows: [row('Lifo')]
      }
    });

    expect(data.layeredRowCount).toBe(1);
    // Le contrat assumé : sur une ligne FIFO/LIFO, P.U. × Qté ≠ Valeur.
    expect(data.rows[0].unitCost * data.rows[0].quantityOnHand).not.toBe(data.grandTotalValue);
    expect(data.grandTotalValue).toBe(6475);
    expect(data.rows[0].unitCost * data.rows[0].quantityOnHand * 1.19).not.toBe(data.rows[0].stockValueTtc);
    expect(data.rows[0].stockValueTtc).toBe(7705.25);
  });

  it('survives a payload without rows', () => {
    let result: any;
    service.getStockStatus({}).subscribe(r => (result = r));

    http.expectOne(req => req.url === `${environment.apiUrl}/reports/stock-status`).flush({
      success: false, message: 'erreur', data: null
    });

    expect(result.success).toBeFalse();
  });
});
