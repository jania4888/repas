import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ForecastingService } from './forecasting.service';
import { environment } from '@environments/environment';
import {
  CreatePurchaseOrdersResult,
  ReplenishmentDecisionAudit,
  ReplenishmentKpi,
  ReplenishmentRecommendation,
  ReplenishmentStatus
} from '../models/forecasting.models';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

/**
 * Unit tests for the V2 surface of {@link ForecastingService}. Verifies URL paths, HTTP verbs,
 * query-string serialization, payload bodies and response unwrapping (the API wraps payloads
 * in <c>{ success, data, message }</c> and the service is expected to expose <c>data</c> only).
 */
describe('ForecastingService — Replenishment V2', () => {
  let service: ForecastingService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiUrl}/forecasting`;

  beforeEach(() => {
    TestBed.configureTestingModule({
    imports: [],
    providers: [provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
});
    service = TestBed.inject(ForecastingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function buildRec(over: Partial<ReplenishmentRecommendation> = {}): ReplenishmentRecommendation {
    return {
      id: 'rec-1',
      productId: 'p-1',
      productCode: 'P-1',
      productName: 'Produit 1',
      warehouseId: 'w-1',
      warehouseName: 'Principal',
      generatedAt: '2026-05-10T00:00:00Z',
      currentStockOnHand: 5,
      recommendedQty: 100,
      rop: 50,
      safetyStock: 20,
      leadTimeDays: 7,
      dailyDemand: 5,
      reasonCodes: ['BelowSafetyStock'],
      status: 'pending',
      linkedPurchaseOrderId: null,
      processedAt: null,
      productUnit: 'Pièce',
      preferredSupplierId: null,
      preferredSupplierName: null,
      quantityOnOrder: 0,
      effectiveQty: 5,
      manualQtyOverride: null,
      manualSupplierOverride: null,
      daysOfStockRemaining: 1,
      userNotes: null,
      urgencyLevel: 'Urgent',
      ...over
    };
  }

  describe('getReplenishment', () => {
    it('GETs /replenishment with default page/pageSize', () => {
      service.getReplenishment().subscribe(res => {
        expect(res.totalCount).toBe(1);
        expect(res.items[0].id).toBe('rec-1');
      });
      const req = httpMock.expectOne(r => r.url === `${base}/replenishment`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('page')).toBe('1');
      expect(req.request.params.get('pageSize')).toBe('50');
      req.flush({ success: true, data: { items: [buildRec()], page: 1, pageSize: 50, totalCount: 1 } });
    });

    it('capitalises status, propagates supplierId/search/urgency/orderBy/orderDesc', () => {
      service.getReplenishment({
        status: 'pending' as ReplenishmentStatus,
        supplierId: 'sup-1',
        search: 'lait',
        urgencyLevel: 'OutOfStock',
        orderBy: 'days',
        orderDesc: false,
        page: 3,
        pageSize: 100
      }).subscribe();
      const req = httpMock.expectOne(r => r.url === `${base}/replenishment`);
      expect(req.request.params.get('status')).toBe('Pending');
      expect(req.request.params.get('supplierId')).toBe('sup-1');
      expect(req.request.params.get('search')).toBe('lait');
      expect(req.request.params.get('urgencyLevel')).toBe('OutOfStock');
      expect(req.request.params.get('orderBy')).toBe('days');
      expect(req.request.params.get('orderDesc')).toBe('false');
      expect(req.request.params.get('page')).toBe('3');
      expect(req.request.params.get('pageSize')).toBe('100');
      req.flush({ success: true, data: { items: [], page: 3, pageSize: 100, totalCount: 0 } });
    });

    it('does not send omitted filters', () => {
      service.getReplenishment().subscribe();
      const req = httpMock.expectOne(r => r.url === `${base}/replenishment`);
      expect(req.request.params.has('status')).toBe(false);
      expect(req.request.params.has('supplierId')).toBe(false);
      expect(req.request.params.has('search')).toBe(false);
      req.flush({ success: true, data: { items: [], page: 1, pageSize: 50, totalCount: 0 } });
    });
  });

  describe('approveReplenishment', () => {
    it('POSTs /replenishment/{id}/approve with empty body', () => {
      service.approveReplenishment('rec-1').subscribe(res => expect(res.id).toBe('rec-1'));
      const req = httpMock.expectOne(`${base}/replenishment/rec-1/approve`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush({ success: true, data: buildRec({ status: 'approved' }) });
    });
  });

  describe('dismissReplenishment', () => {
    it('POSTs /replenishment/{id}/dismiss with reason in body', () => {
      service.dismissReplenishment('rec-1', 'budget cancelled').subscribe();
      const req = httpMock.expectOne(`${base}/replenishment/rec-1/dismiss`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ reason: 'budget cancelled' });
      req.flush({ success: true, data: buildRec({ status: 'dismissed' }) });
    });
  });

  describe('overrideReplenishment', () => {
    it('POSTs full payload', () => {
      service.overrideReplenishment('rec-1', { manualQty: 250, manualSupplierId: 'sup-1' }).subscribe();
      const req = httpMock.expectOne(`${base}/replenishment/rec-1/override`);
      expect(req.request.body).toEqual({ manualQty: 250, manualSupplierId: 'sup-1' });
      req.flush({ success: true, data: buildRec({ manualQtyOverride: 250 }) });
    });

    it('allows both nulls to clear overrides', () => {
      service.overrideReplenishment('rec-1', { manualQty: null, manualSupplierId: null }).subscribe();
      const req = httpMock.expectOne(`${base}/replenishment/rec-1/override`);
      expect(req.request.body).toEqual({ manualQty: null, manualSupplierId: null });
      req.flush({ success: true, data: buildRec() });
    });
  });

  describe('undoReplenishment', () => {
    it('POSTs /undo with empty body', () => {
      service.undoReplenishment('rec-1').subscribe();
      const req = httpMock.expectOne(`${base}/replenishment/rec-1/undo`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush({ success: true, data: buildRec({ status: 'pending' }) });
    });
  });

  describe('attachNotesReplenishment', () => {
    it('POSTs /notes with notes in body', () => {
      service.attachNotesReplenishment('rec-1', 'Urgent').subscribe();
      const req = httpMock.expectOne(`${base}/replenishment/rec-1/notes`);
      expect(req.request.body).toEqual({ notes: 'Urgent' });
      req.flush({ success: true, data: buildRec({ userNotes: 'Urgent' }) });
    });

    it('accepts null to clear notes', () => {
      service.attachNotesReplenishment('rec-1', null).subscribe();
      const req = httpMock.expectOne(`${base}/replenishment/rec-1/notes`);
      expect(req.request.body).toEqual({ notes: null });
      req.flush({ success: true, data: buildRec() });
    });
  });

  describe('createPurchaseOrdersFromReplenishment', () => {
    it('POSTs /create-purchase-orders with recommendationIds', () => {
      const ids = ['rec-1', 'rec-2'];
      const expected: CreatePurchaseOrdersResult = {
        createdPurchaseOrdersCount: 1,
        linkedRecommendationsCount: 2,
        totalEstimatedQty: 300,
        createdPurchaseOrders: [{
          purchaseOrderId: 'po-1', purchaseOrderNumber: 'BC-2026-000001',
          supplierId: 'sup-1', supplierName: 'F', linesCount: 2, totalAmount: 1000,
          recommendationIds: ids
        }],
        warnings: []
      };
      service.createPurchaseOrdersFromReplenishment(ids).subscribe(res => {
        expect(res.createdPurchaseOrdersCount).toBe(1);
        expect(res.linkedRecommendationsCount).toBe(2);
      });
      const req = httpMock.expectOne(`${base}/replenishment/create-purchase-orders`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ recommendationIds: ids });
      req.flush({ success: true, data: expected });
    });
  });

  describe('generateReplenishment', () => {
    it('passes productId AND warehouseId in query when both provided', () => {
      service.generateReplenishment('w-1', 'p-1').subscribe(n => expect(n).toBe(3));
      const req = httpMock.expectOne(r => r.url === `${base}/replenishment/generate`);
      expect(req.request.method).toBe('POST');
      expect(req.request.params.get('warehouseId')).toBe('w-1');
      expect(req.request.params.get('productId')).toBe('p-1');
      req.flush({ success: true, data: 3 });
    });

    it('omits params when both null', () => {
      service.generateReplenishment().subscribe();
      const req = httpMock.expectOne(r => r.url === `${base}/replenishment/generate`);
      expect(req.request.params.has('warehouseId')).toBe(false);
      expect(req.request.params.has('productId')).toBe(false);
      req.flush({ success: true, data: 0 });
    });
  });

  describe('getReplenishmentHistory', () => {
    it('GETs history endpoint', () => {
      const audit: ReplenishmentDecisionAudit[] = [{
        id: 'a-1', recommendationId: 'rec-1', fromStatus: 'pending',
        toStatus: 'approved', actionType: 'Approve', reason: null,
        actorUserId: 'user-1', actedAt: '2026-05-12T10:00:00Z', payloadJson: null
      }];
      service.getReplenishmentHistory('rec-1').subscribe(res => {
        expect(res.length).toBe(1);
        expect(res[0].actionType).toBe('Approve');
      });
      const req = httpMock.expectOne(`${base}/replenishment/rec-1/history`);
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: audit });
    });

    it('returns empty array when data is null', () => {
      service.getReplenishmentHistory('rec-1').subscribe(res => expect(res).toEqual([]));
      const req = httpMock.expectOne(`${base}/replenishment/rec-1/history`);
      req.flush({ success: true, data: null });
    });
  });

  describe('getReplenishmentKpi', () => {
    it('GETs kpi endpoint with warehouse filter', () => {
      const kpi: ReplenishmentKpi = {
        pendingCount: 10, urgentCount: 3, outOfStockCount: 1,
        estimatedValueToOrder: 5000, currency: 'TND',
        serviceLevelPercent: 97.5, stockOutRatePercent: 2.5,
        computedAt: '2026-05-12T10:00:00Z', topUrgencies: []
      };
      service.getReplenishmentKpi('w-1').subscribe(res => expect(res.pendingCount).toBe(10));
      const req = httpMock.expectOne(r => r.url === `${base}/replenishment/kpi`);
      expect(req.request.params.get('warehouseId')).toBe('w-1');
      req.flush({ success: true, data: kpi });
    });
  });

  describe('exportReplenishment', () => {
    it('GETs CSV as blob and parses filename from header', () => {
      service.exportReplenishment({ status: 'pending' }, 'csv').subscribe(({ blob, fileName }) => {
        expect(blob).toBeInstanceOf(Blob);
        expect(fileName).toBe('replenishment-20260512.csv');
      });
      const req = httpMock.expectOne(r => r.url === `${base}/replenishment/export`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('status')).toBe('Pending');
      expect(req.request.params.get('format')).toBe('csv');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['col1;col2'], { type: 'text/csv' }), {
        headers: { 'Content-Disposition': 'attachment; filename="replenishment-20260512.csv"' }
      });
    });

    it('falls back to a default filename when header is missing', () => {
      service.exportReplenishment({}, 'csv').subscribe(({ fileName }) => {
        expect(fileName).toMatch(/^replenishment-\d{4}-\d{2}-\d{2}\.csv$/);
      });
      const req = httpMock.expectOne(r => r.url === `${base}/replenishment/export`);
      req.flush(new Blob(['x'], { type: 'text/csv' }));
    });
  });

  describe('enum casing normaliser (backend PascalCase → TS camelCase)', () => {
    it('lowercases the status field on the V2 list', () => {
      service.getReplenishment().subscribe(paged => {
        expect(paged.items[0].status).toBe('pending');
      });
      const req = httpMock.expectOne(r => r.url === `${base}/replenishment`);
      // Backend serialises enums in PascalCase per Program.cs convention.
      req.flush({
        success: true,
        data: {
          items: [{ ...buildRec(), status: 'Pending' as unknown as ReplenishmentStatus }],
          page: 1, pageSize: 50, totalCount: 1
        }
      });
    });

    it('lowercases the status field on approve / dismiss / override / undo / notes', () => {
      const flows: Array<[() => any, string, string]> = [
        [() => service.approveReplenishment('rec-1'), 'approve', 'Approved'],
        [() => service.dismissReplenishment('rec-1', 'because'), 'dismiss', 'Dismissed'],
        [() => service.overrideReplenishment('rec-1', { manualQty: 1, manualSupplierId: null }), 'override', 'Approved'],
        [() => service.undoReplenishment('rec-1'), 'undo', 'Pending'],
        [() => service.attachNotesReplenishment('rec-1', 'notes'), 'notes', 'Pending'],
      ];
      const expected = ['approved', 'dismissed', 'approved', 'pending', 'pending'];

      flows.forEach(([call, path, returned], idx) => {
        call().subscribe((rec: ReplenishmentRecommendation) => {
          expect(rec.status).toBe(expected[idx]);
        });
        const req = httpMock.expectOne(r => r.url === `${base}/replenishment/rec-1/${path}`);
        req.flush({ success: true, data: { ...buildRec(), status: returned } });
      });
    });

    it('lowercases fromStatus / toStatus on history rows', () => {
      service.getReplenishmentHistory('rec-1').subscribe(rows => {
        expect(rows[0].fromStatus).toBe('pending');
        expect(rows[0].toStatus).toBe('approved');
      });
      const req = httpMock.expectOne(`${base}/replenishment/rec-1/history`);
      req.flush({
        success: true,
        data: [{
          id: 'a-1', recommendationId: 'rec-1',
          fromStatus: 'Pending', toStatus: 'Approved',  // PascalCase from API
          actionType: 'Approve', reason: null,
          actorUserId: 'user-1', actedAt: '2026-05-12T10:00:00Z', payloadJson: null
        }]
      });
    });

    it('preserves already-lowercase status (defensive — backend bug-fix later)', () => {
      service.getReplenishment().subscribe(paged => {
        expect(paged.items[0].status).toBe('pending');
      });
      const req = httpMock.expectOne(r => r.url === `${base}/replenishment`);
      req.flush({
        success: true,
        data: {
          items: [{ ...buildRec(), status: 'pending' }],  // already lowercase
          page: 1, pageSize: 50, totalCount: 1
        }
      });
    });
  });

  describe('recomputeCompleted$', () => {
    it('notifies subscribers when notifyRecomputeCompleted is called', () => {
      let notified = false;
      service.recomputeCompleted$.subscribe(() => { notified = true; });
      service.notifyRecomputeCompleted();
      expect(notified).toBe(true);
    });
  });
});
