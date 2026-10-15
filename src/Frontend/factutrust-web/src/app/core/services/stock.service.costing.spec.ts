import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { StockService } from './stock.service';
import { COSTING_FIFO, COSTING_LIFO } from '@shared/utils/stock-traceability.utils';
import { environment } from '@environments/environment';

/**
 * Le back sérialise les énums par NOM ("Fifo"), alors que les écrans comparent des nombres.
 * Sans coercion ici, le repère de méthode affichait toujours « CMUP » et le bouton
 * « Couches FIFO/LIFO » restait invisible — en silence, sans erreur ni requête manquante.
 */
describe('StockService.getStockItems — coercion de la méthode de valorisation', () => {
  let service: StockService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StockService, provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(StockService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('turns the enum names sent by the API into numbers', () => {
    let items: ReturnType<() => any[]> = [];
    service.getStockItems().subscribe(r => (items = r.data!.items));

    http.expectOne(req => req.url === `${environment.apiUrl}/stock/items`).flush({
      success: true,
      message: null,
      data: {
        items: [
          { id: '1', costingMethod: 'Fifo', unitCost: 2, stockValue: 90, averageCost: 3 },
          { id: '2', costingMethod: 'Lifo', unitCost: 4, stockValue: 90, averageCost: 3 },
          { id: '3', costingMethod: 'Average', unitCost: 5, stockValue: 50, averageCost: 5 }
        ],
        totalCount: 3,
        page: 1,
        pageSize: 20,
        totalStockValue: 230
      }
    });

    expect(items.map(i => i.costingMethod)).toEqual([COSTING_FIFO, COSTING_LIFO, 0]);
  });

  it('keeps the server-side total, which covers more than the loaded page', () => {
    let result: any;
    service.getStockItems().subscribe(r => (result = r.data));

    http.expectOne(req => req.url === `${environment.apiUrl}/stock/items`).flush({
      success: true,
      message: null,
      data: {
        items: [{ id: '1', costingMethod: 'Average', stockValue: 10, averageCost: 10 }],
        totalCount: 400,
        page: 1,
        pageSize: 20,
        totalStockValue: 9999
      }
    });

    expect(result.totalStockValue).toBe(9999);
    expect(result.items.length).toBe(1);
  });

  it('survives a payload without items', () => {
    let result: any;
    service.getStockItems().subscribe(r => (result = r));

    http.expectOne(req => req.url === `${environment.apiUrl}/stock/items`).flush({
      success: false,
      message: 'erreur',
      data: null
    });

    expect(result.success).toBeFalse();
  });
});
