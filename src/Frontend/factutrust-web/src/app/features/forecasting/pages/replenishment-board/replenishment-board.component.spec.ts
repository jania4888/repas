import { TestBed } from '@angular/core/testing';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { ReplenishmentBoardComponent } from './replenishment-board.component';
import { ForecastingService } from '../../services/forecasting.service';
import { ReplenishmentExportService } from '../../services/replenishment-export.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { CreatePurchaseOrdersResult, ReplenishmentRecommendation } from '../../models/forecasting.models';

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
    daysOfStockRemaining: null,
    userNotes: null,
    urgencyLevel: 'Normal',
    ...over
  };
}

function poResult(over: Partial<CreatePurchaseOrdersResult> = {}): CreatePurchaseOrdersResult {
  return {
    createdPurchaseOrdersCount: 1,
    linkedRecommendationsCount: 1,
    totalEstimatedQty: 100,
    createdPurchaseOrders: [],
    warnings: [],
    unlinkedRecommendationIds: [],
    ...over
  };
}

describe('ReplenishmentBoardComponent — onPreparePoConfirmed (two-phase create)', () => {
  let component: ReplenishmentBoardComponent;
  let forecasting: {
    overrideReplenishment: jasmine.Spy;
    createPurchaseOrdersFromReplenishment: jasmine.Spy;
    getReplenishment: jasmine.Spy;
    getReplenishmentKpi: jasmine.Spy;
    recomputeCompleted$: typeof NEVER;
  };
  let toast: { add: jasmine.Spy };

  beforeEach(() => {
    forecasting = {
      overrideReplenishment: jasmine.createSpy('overrideReplenishment')
        .and.callFake((id: string) => of(buildRec({ id }))),
      createPurchaseOrdersFromReplenishment: jasmine.createSpy('createPurchaseOrdersFromReplenishment')
        .and.returnValue(of(poResult())),
      getReplenishment: jasmine.createSpy('getReplenishment')
        .and.returnValue(of({ items: [], totalCount: 0 })),
      getReplenishmentKpi: jasmine.createSpy('getReplenishmentKpi')
        .and.returnValue(of(null)),
      recomputeCompleted$: NEVER
    };
    toast = { add: jasmine.createSpy('add') };

    TestBed.configureTestingModule({
      providers: [
        { provide: ForecastingService, useValue: forecasting },
        { provide: ReplenishmentExportService, useValue: {} },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { hasAllPermissions: () => true } }
      ]
    });

    // Instantiate the component class in an injection context so its inject() fields resolve,
    // without compiling the heavy template / child components.
    component = TestBed.runInInjectionContext(() => new ReplenishmentBoardComponent());
  });

  it('overrides each in-modal assignment (preserving manualQty) THEN creates the POs', async () => {
    const targets = [
      buildRec({ id: 'r-1', preferredSupplierId: null, manualQtyOverride: 42 }),
      buildRec({ id: 'r-2', preferredSupplierId: 'sup-X', preferredSupplierName: 'X' })
    ];
    component.preparePoModal.set({ selection: targets });
    forecasting.createPurchaseOrdersFromReplenishment.and.returnValue(
      of(poResult({ createdPurchaseOrdersCount: 2, linkedRecommendationsCount: 2 }))
    );

    await component.onPreparePoConfirmed({
      lineUpdates: [{ recommendationId: 'r-1', manualQty: 42, manualSupplierId: 'sup-A' }]
    });

    expect(forecasting.overrideReplenishment).toHaveBeenCalledWith('r-1', { manualQty: 42, manualSupplierId: 'sup-A' });
    expect(forecasting.overrideReplenishment).toHaveBeenCalledTimes(1);
    // Then every target is sent to the create endpoint.
    expect(forecasting.createPurchaseOrdersFromReplenishment).toHaveBeenCalledWith(['r-1', 'r-2']);
    expect(component.preparePoModal()).toBeNull();
  });

  it('skips override calls when there are no in-modal assignments (happy path)', async () => {
    const targets = [buildRec({ id: 'r-1', preferredSupplierId: 'sup-X', preferredSupplierName: 'X' })];
    component.preparePoModal.set({ selection: targets });

    await component.onPreparePoConfirmed({ lineUpdates: [] });

    expect(forecasting.overrideReplenishment).not.toHaveBeenCalled();
    expect(forecasting.createPurchaseOrdersFromReplenishment).toHaveBeenCalledWith(['r-1']);
    expect(toast.add).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'success', summary: 'Bons de commande' }));
  });

  it('still creates POs when a supplier override fails (allSettled resilience)', async () => {
    forecasting.overrideReplenishment.and.returnValue(throwError(() => new Error('boom')));
    const targets = [buildRec({ id: 'r-1', preferredSupplierId: null })];
    component.preparePoModal.set({ selection: targets });

    await component.onPreparePoConfirmed({
      lineUpdates: [{ recommendationId: 'r-1', manualQty: null, manualSupplierId: 'sup-A' }]
    });

    // The failed override does not abort the flow — creation is still attempted.
    expect(forecasting.createPurchaseOrdersFromReplenishment).toHaveBeenCalledWith(['r-1']);
    expect(toast.add).toHaveBeenCalledWith(
      jasmine.objectContaining({ severity: 'warn', summary: 'Enregistrement partiel' })
    );
  });

  it('surfaces the explicit unlinked guidance and backend warnings when no PO is created', async () => {
    const targets = [buildRec({ id: 'r-1', preferredSupplierId: null })];
    component.preparePoModal.set({ selection: targets });
    forecasting.createPurchaseOrdersFromReplenishment.and.returnValue(of(poResult({
      createdPurchaseOrdersCount: 0,
      linkedRecommendationsCount: 0,
      warnings: ['Recommandation r-1 non liée : aucun fournisseur.'],
      unlinkedRecommendationIds: ['r-1']
    })));

    await component.onPreparePoConfirmed({ lineUpdates: [] });

    expect(toast.add).toHaveBeenCalledWith(jasmine.objectContaining({
      severity: 'warn',
      summary: 'Bons de commande',
      detail: jasmine.stringMatching(/sans fournisseur/)
    }));
    expect(toast.add).toHaveBeenCalledWith(jasmine.objectContaining({ summary: 'Avertissement' }));
  });

  it('refreshes the list and clears the selection after a successful creation', async () => {
    component.selectedIds.set(new Set(['r-1']));
    component.preparePoModal.set({ selection: [buildRec({ id: 'r-1', preferredSupplierId: 'sup-X', preferredSupplierName: 'X' })] });

    await component.onPreparePoConfirmed({ lineUpdates: [] });

    expect(component.selectedIds().size).toBe(0);
    expect(forecasting.getReplenishment).toHaveBeenCalled();
  });

  it('persists qty-only lineUpdates then creates POs', async () => {
    const targets = [
      buildRec({ id: 'r-1', preferredSupplierId: 'sup-X', preferredSupplierName: 'X', recommendedQty: 100 })
    ];
    component.preparePoModal.set({ selection: targets });

    await component.onPreparePoConfirmed({
      lineUpdates: [{ recommendationId: 'r-1', manualQty: 80, manualSupplierId: null }]
    });

    expect(forecasting.overrideReplenishment).toHaveBeenCalledWith('r-1', { manualQty: 80, manualSupplierId: null });
    expect(forecasting.createPurchaseOrdersFromReplenishment).toHaveBeenCalledWith(['r-1']);
  });
});

describe('ReplenishmentBoardComponent — recompute refresh', () => {
  let component: ReplenishmentBoardComponent;
  let recomputeCompleted$: Subject<void>;
  let forecasting: {
    getReplenishment: jasmine.Spy;
    getReplenishmentKpi: jasmine.Spy;
    recomputeCompleted$: ReturnType<Subject<void>['asObservable']>;
  };

  beforeEach(() => {
    recomputeCompleted$ = new Subject<void>();
    forecasting = {
      getReplenishment: jasmine.createSpy('getReplenishment')
        .and.returnValue(of({ items: [], totalCount: 0 })),
      getReplenishmentKpi: jasmine.createSpy('getReplenishmentKpi')
        .and.returnValue(of(null)),
      recomputeCompleted$: recomputeCompleted$.asObservable()
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ForecastingService, useValue: forecasting },
        { provide: ReplenishmentExportService, useValue: {} },
        { provide: ToastService, useValue: { add: jasmine.createSpy('add') } },
        { provide: AuthService, useValue: { hasAllPermissions: () => true } }
      ]
    });

    component = TestBed.runInInjectionContext(() => new ReplenishmentBoardComponent());
    component.ngOnInit();
  });

  it('reloads list and KPI when hub recompute completes', () => {
    forecasting.getReplenishment.calls.reset();
    forecasting.getReplenishmentKpi.calls.reset();

    recomputeCompleted$.next();

    expect(forecasting.getReplenishment).toHaveBeenCalled();
    expect(forecasting.getReplenishmentKpi).toHaveBeenCalled();
  });
});
