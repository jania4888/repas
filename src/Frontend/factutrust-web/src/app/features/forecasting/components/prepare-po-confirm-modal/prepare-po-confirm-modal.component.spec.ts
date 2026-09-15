import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PreparePoConfirmModalComponent, PreparePoLineUpdate } from './prepare-po-confirm-modal.component';
import { ReplenishmentRecommendation } from '../../models/forecasting.models';
import { SupplierService, SupplierListItem } from '@core/services/supplier.service';

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

function supplier(id: string, name: string): SupplierListItem {
  // The component only reads id + name; cast keeps the stub decoupled from the full interface.
  return { id, name } as SupplierListItem;
}

describe('PreparePoConfirmModalComponent', () => {
  let fixture: ComponentFixture<PreparePoConfirmModalComponent>;
  let component: PreparePoConfirmModalComponent;
  let getSuppliersSpy: jasmine.Spy;

  beforeEach(async () => {
    getSuppliersSpy = jasmine.createSpy('getSuppliers').and.returnValue(
      of({ data: { items: [supplier('sup-A', 'Alpha'), supplier('sup-B', 'Beta')] } } as any)
    );

    await TestBed.configureTestingModule({
      imports: [PreparePoConfirmModalComponent],
      providers: [{ provide: SupplierService, useValue: { getSuppliers: getSuppliersSpy } }]
    }).compileComponents();
    fixture = TestBed.createComponent(PreparePoConfirmModalComponent);
    component = fixture.componentInstance;
  });

  it('groups recommendations by preferred supplier and sums their qty', () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha', recommendedQty: 100 }),
      buildRec({ id: 'r-2', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha', recommendedQty: 50 }),
      buildRec({ id: 'r-3', preferredSupplierId: 'sup-B', preferredSupplierName: 'Beta', recommendedQty: 200 })
    ];
    const groups = component.groups();
    expect(groups.length).toBe(2);
    const alpha = groups.find(g => g.supplierId === 'sup-A')!;
    expect(alpha.recommendations.length).toBe(2);
    expect(alpha.totalQty).toBe(150);
    const beta = groups.find(g => g.supplierId === 'sup-B')!;
    expect(beta.totalQty).toBe(200);
  });

  it('puts recommendations without a supplier in a "Sans fournisseur" group last', () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: null }),
      buildRec({ id: 'r-2', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha' })
    ];
    const groups = component.groups();
    expect(groups.length).toBe(2);
    expect(groups[0].supplierId).toBe('sup-A');
    expect(groups[1].supplierId).toBeNull();
  });

  it('uses manualSupplierOverride when set (priority over preferred)', () => {
    component.selection = [
      buildRec({
        id: 'r-1',
        preferredSupplierId: 'sup-A',
        preferredSupplierName: 'Alpha',
        manualSupplierOverride: 'sup-B'
      })
    ];
    const groups = component.groups();
    expect(groups.length).toBe(1);
    expect(groups[0].supplierId).toBe('sup-B');
  });

  it('uses manualQtyOverride when set', () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha', recommendedQty: 100, manualQtyOverride: 250 })
    ];
    const groups = component.groups();
    expect(groups[0].totalQty).toBe(250);
  });

  it('counts skipped recommendations correctly', () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: null }),
      buildRec({ id: 'r-2', preferredSupplierId: null }),
      buildRec({ id: 'r-3', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha' })
    ];
    expect(component.skippedCount()).toBe(2);
    expect(component.linkableCount()).toBe(1);
  });

  it('canConfirm is false when selection is empty', () => {
    component.selection = [];
    expect(component.canConfirm()).toBe(false);
  });

  it('emits confirm when canConfirm is true', () => {
    component.selection = [buildRec({ preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha' })];
    spyOn(component.confirm, 'emit');
    component.onConfirm();
    expect(component.confirm.emit).toHaveBeenCalledWith({ lineUpdates: [] });
  });

  // ─── Regression for the reported bug: honest count + no-op guard + inline assignment ───

  it('shows the SAME honest PO count in the hint and the confirm button (no double-count of the null group)', async () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha' }),
      buildRec({ id: 'r-2', preferredSupplierId: null })
    ];
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const hint = el.querySelector('.hint')!.textContent!;
    const confirmBtn = el.querySelector('.btn-primary')!.textContent!;

    expect(component.linkableCount()).toBe(1);
    expect(hint).toContain('1 bon(s)');
    expect(confirmBtn).toContain('(1 BC)');
    // The previous bug counted the "Sans fournisseur" group, inflating the hint to "2".
    expect(hint).not.toContain('2 bon(s)');
  });

  it('blocks confirmation when every line lacks a supplier (no-op guard)', () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: null }),
      buildRec({ id: 'r-2', preferredSupplierId: null })
    ];
    expect(component.linkableCount()).toBe(0);
    expect(component.canConfirm()).toBe(false);

    spyOn(component.confirm, 'emit');
    component.onConfirm();
    expect(component.confirm.emit).not.toHaveBeenCalled();
  });

  it('allows confirmation after an in-modal supplier assignment and moves the line out of the null group', () => {
    component.selection = [buildRec({ id: 'r-1', preferredSupplierId: null })];
    component.suppliers.set([supplier('sup-A', 'Alpha')]);

    expect(component.canConfirm()).toBe(false);

    component.assign('r-1', 'sup-A');

    expect(component.linkableCount()).toBe(1);
    expect(component.skippedCount()).toBe(0);
    expect(component.canConfirm()).toBe(true);

    const groups = component.groups();
    expect(groups.length).toBe(1);
    expect(groups[0].supplierId).toBe('sup-A');
    expect(groups[0].supplierName).toBe('Alpha');
  });

  it('clearing an assignment moves the line back to the "Sans fournisseur" group', () => {
    component.selection = [buildRec({ id: 'r-1', preferredSupplierId: null })];
    component.suppliers.set([supplier('sup-A', 'Alpha')]);

    component.assign('r-1', 'sup-A');
    expect(component.skippedCount()).toBe(0);

    component.assign('r-1', null);
    expect(component.skippedCount()).toBe(1);
    expect(component.canConfirm()).toBe(false);
  });

  it('emits only changed lines in the confirm payload (supplier assignment)', () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: null }),
      buildRec({ id: 'r-2', preferredSupplierId: 'sup-B', preferredSupplierName: 'Beta' })
    ];
    component.suppliers.set([supplier('sup-A', 'Alpha')]);
    component.assign('r-1', 'sup-A');

    let emitted: { lineUpdates: PreparePoLineUpdate[] } | undefined;
    component.confirm.subscribe(v => (emitted = v));
    component.onConfirm();

    expect(emitted).toBeDefined();
    expect(emitted!.lineUpdates).toEqual([
      { recommendationId: 'r-1', manualQty: null, manualSupplierId: 'sup-A' }
    ]);
  });

  it('fetches suppliers on open only when a line lacks a supplier', async () => {
    component.selection = [buildRec({ id: 'r-1', preferredSupplierId: null })];
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getSuppliersSpy).toHaveBeenCalled();
  });

  it('fetches suppliers on open even when every line already has one', async () => {
    component.selection = [buildRec({ id: 'r-1', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha' })];
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getSuppliersSpy).toHaveBeenCalled();
  });

  it('fetches only ACTIVE suppliers (isActive: true) — inactive ones are silently rejected by the backend', async () => {
    component.selection = [buildRec({ id: 'r-1', preferredSupplierId: null })];
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getSuppliersSpy).toHaveBeenCalledWith(jasmine.objectContaining({ isActive: true }));
  });

  // ─── Bulk assignment: one supplier for every still-unassigned line in a single action ───

  it('bulk-assigns one supplier to every unassigned line, leaving already-resolved lines untouched', () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: null }),
      buildRec({ id: 'r-2', preferredSupplierId: null }),
      buildRec({ id: 'r-3', preferredSupplierId: 'sup-B', preferredSupplierName: 'Beta' })
    ];
    component.suppliers.set([supplier('sup-A', 'Alpha'), supplier('sup-B', 'Beta')]);
    expect(component.skippedCount()).toBe(2);

    component.onBulkAssign('sup-A');

    expect(component.skippedCount()).toBe(0);
    expect(component.linkableCount()).toBe(2); // Alpha (r-1,r-2) + Beta (r-3)
    expect(component.canConfirm()).toBe(true);

    const alpha = component.groups().find(g => g.supplierId === 'sup-A')!;
    expect(alpha.recommendations.map(r => r.id).sort()).toEqual(['r-1', 'r-2']);
    // r-3 keeps its own preferred supplier.
    const beta = component.groups().find(g => g.supplierId === 'sup-B')!;
    expect(beta.recommendations.map(r => r.id)).toEqual(['r-3']);
  });

  it('bulk assignment is a one-shot action: the picker resets to its placeholder afterwards', () => {
    component.selection = [buildRec({ id: 'r-1', preferredSupplierId: null })];
    component.suppliers.set([supplier('sup-A', 'Alpha')]);

    component.onBulkAssign('sup-A');
    expect(component.bulkSupplierId()).toBeNull();
  });

  it('bulk assignment with no supplier (placeholder) is a no-op', () => {
    component.selection = [buildRec({ id: 'r-1', preferredSupplierId: null })];
    component.suppliers.set([supplier('sup-A', 'Alpha')]);

    component.onBulkAssign(null);
    expect(component.skippedCount()).toBe(1);
    expect(component.canConfirm()).toBe(false);
  });

  it('bulk assignment then emits all newly-assigned lines in the confirm payload', () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: null }),
      buildRec({ id: 'r-2', preferredSupplierId: null })
    ];
    component.suppliers.set([supplier('sup-A', 'Alpha')]);
    component.onBulkAssign('sup-A');

    let emitted: { lineUpdates: PreparePoLineUpdate[] } | undefined;
    component.confirm.subscribe(v => (emitted = v));
    component.onConfirm();

    expect(emitted).toBeDefined();
    expect(emitted!.lineUpdates).toEqual([
      { recommendationId: 'r-1', manualQty: null, manualSupplierId: 'sup-A' },
      { recommendationId: 'r-2', manualQty: null, manualSupplierId: 'sup-A' }
    ]);
  });

  it('updates group total when draft qty changes', () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha', recommendedQty: 100 })
    ];
    expect(component.groups()[0].totalQty).toBe(100);
    component.setDraftQty('r-1', 75);
    expect(component.groups()[0].totalQty).toBe(75);
  });

  it('emits lineUpdates when only qty is edited', () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha', recommendedQty: 100 })
    ];
    component.setDraftQty('r-1', 80);

    let emitted: { lineUpdates: PreparePoLineUpdate[] } | undefined;
    component.confirm.subscribe(v => (emitted = v));
    component.onConfirm();

    expect(emitted!.lineUpdates).toEqual([
      { recommendationId: 'r-1', manualQty: 80, manualSupplierId: null }
    ]);
  });

  it('canConfirm is false when draft qty is zero or invalid', () => {
    component.selection = [buildRec({ id: 'r-1', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha' })];
    expect(component.canConfirm()).toBe(true);
    component.setDraftQty('r-1', 0);
    expect(component.canConfirm()).toBe(false);
  });

  it('combines supplier assignment and qty change in one lineUpdate', () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: null, recommendedQty: 100, manualQtyOverride: 42 })
    ];
    component.assign('r-1', 'sup-A');
    component.setDraftQty('r-1', 50);

    const updates = component.buildLineUpdates();
    expect(updates).toEqual([
      { recommendationId: 'r-1', manualQty: 50, manualSupplierId: 'sup-A' }
    ]);
  });

  it('initializes draft qty with list rounding for discrete units', () => {
    component.selection = [
      buildRec({
        id: 'r-1',
        preferredSupplierId: 'sup-A',
        preferredSupplierName: 'Alpha',
        recommendedQty: 569.74,
        productUnit: 'Pièce'
      })
    ];
    expect(component.draftQtyValue('r-1')).toBe(570);
    expect(component.groups()[0].totalQty).toBe(570);
  });

  it('buildLineUpdates persists rounded qty on confirm without user edit', () => {
    component.selection = [
      buildRec({
        id: 'r-1',
        preferredSupplierId: 'sup-A',
        preferredSupplierName: 'Alpha',
        recommendedQty: 569.74,
        productUnit: 'Pièce'
      })
    ];
    expect(component.buildLineUpdates()).toEqual([
      { recommendationId: 'r-1', manualQty: 570, manualSupplierId: null }
    ]);
  });

  it('displaySupplierId reflects preferred supplier without an in-modal assignment', () => {
    const rec = buildRec({ id: 'r-1', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha' });
    component.selection = [rec];
    expect(component.displaySupplierId(rec)).toBe('sup-A');
  });

  it('changing supplier on a preferred line emits override and regroups', () => {
    component.selection = [
      buildRec({ id: 'r-1', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha' }),
      buildRec({ id: 'r-2', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha' })
    ];
    component.suppliers.set([supplier('sup-A', 'Alpha'), supplier('sup-B', 'Beta')]);

    component.assign('r-1', 'sup-B');

    const groups = component.groups();
    expect(groups.length).toBe(2);
    expect(groups.find(g => g.supplierId === 'sup-B')!.recommendations.map(r => r.id)).toEqual(['r-1']);

    const updates = component.buildLineUpdates();
    expect(updates).toEqual([
      { recommendationId: 'r-1', manualQty: null, manualSupplierId: 'sup-B' }
    ]);
  });

  it('reverting manual override to preferred emits null manualSupplierId', () => {
    component.selection = [
      buildRec({
        id: 'r-1',
        preferredSupplierId: 'sup-A',
        preferredSupplierName: 'Alpha',
        manualSupplierOverride: 'sup-B'
      })
    ];
    component.suppliers.set([supplier('sup-A', 'Alpha'), supplier('sup-B', 'Beta')]);
    component.assign('r-1', 'sup-A');

    expect(component.buildLineUpdates()).toEqual([
      { recommendationId: 'r-1', manualQty: null, manualSupplierId: null }
    ]);
  });

  it('shows supplier select for lines that already have a preferred supplier', async () => {
    component.selection = [buildRec({ id: 'r-1', preferredSupplierId: 'sup-A', preferredSupplierName: 'Alpha' })];
    component.suppliers.set([supplier('sup-A', 'Alpha')]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const selects = fixture.nativeElement.querySelectorAll('select.po-supplier-select');
    expect(selects.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Fournisseur');
  });

  it('shows integer group total in template for discrete unit lines', async () => {
    component.selection = [
      buildRec({
        id: 'r-1',
        preferredSupplierId: 'sup-A',
        preferredSupplierName: 'Alpha',
        recommendedQty: 569.74,
        productUnit: 'Pièce'
      })
    ];
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const count = fixture.nativeElement.querySelector('.group-count')!.textContent!;
    expect(count).toContain('570');
    expect(count).not.toContain('569,74');
  });
});
