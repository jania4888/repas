/**
 * Shared Playwright fixtures for the Replenishment V2 E2E suite.
 *
 * These tests run **fully offline** — every backend call is intercepted with
 * `page.route()` and answered with deterministic mocks. The intent is to verify the
 * Angular flow (signals, routing, UI behaviour) without depending on a running
 * `.NET` backend / SQL Server / authenticated tenant.
 *
 * A complementary suite using a real backend can be added later (see CUTOVER.md);
 * keep the mocked suite green at all times so PR validation stays fast.
 */
import { Page, test, expect } from '@playwright/test';

// ─────────────────────────────────────── Fixtures' dataset ───────────────────────────────────────

export const SAMPLE_RECS = (): ReplenishmentRecV2[] => [
  buildRec({
    id: 'rec-1',
    productCode: 'FRI-001',
    productName: 'Farine T55',
    warehouseName: 'Magasin01',
    currentStockOnHand: 0,
    recommendedQty: 12,
    rop: 12,
    reasonCodes: ['OutOfStock', 'DailyDemand:0.56'],
    daysOfStockRemaining: 0,
    urgencyLevel: 'OutOfStock',
    preferredSupplierId: 'sup-A',
    preferredSupplierName: 'Alpha Distribution'
  }),
  buildRec({
    id: 'rec-2',
    productCode: 'TAB5552',
    productName: 'tableau',
    warehouseName: 'Magasin02',
    currentStockOnHand: 4,
    recommendedQty: 27,
    rop: 31,
    reasonCodes: ['BelowSafetyStock', 'DailyDemand:1.54'],
    daysOfStockRemaining: 2.6,
    urgencyLevel: 'Urgent',
    preferredSupplierId: 'sup-A',
    preferredSupplierName: 'Alpha Distribution'
  }),
  buildRec({
    id: 'rec-3',
    productCode: 'STY55666',
    productName: 'stylo',
    warehouseName: 'colise Haddad',
    currentStockOnHand: 5,
    recommendedQty: 63,
    rop: 68,
    reasonCodes: ['BelowSafetyStock', 'DailyDemand:2.93'],
    daysOfStockRemaining: 1.7,
    urgencyLevel: 'Urgent',
    preferredSupplierId: 'sup-B',
    preferredSupplierName: 'Beta Wholesale'
  }),
  buildRec({
    id: 'rec-4',
    productCode: 'PORTE001',
    productName: 'porte',
    warehouseName: 'colise Haddad',
    currentStockOnHand: 2,
    recommendedQty: 2.85,
    rop: 4.85,
    reasonCodes: ['BelowSafetyStock', 'DailyDemand:0.13'],
    daysOfStockRemaining: 15,
    urgencyLevel: 'Normal',
    preferredSupplierId: null,
    preferredSupplierName: null
  })
];

/** Suppliers offered by the mocked `/api/suppliers` endpoint (id → display name). */
export const SUPPLIER_NAMES: Record<string, string> = {
  'sup-A': 'Alpha Distribution',
  'sup-B': 'Beta Wholesale'
};

export function defaultKpi(): ReplenishmentKpi {
  return {
    pendingCount: 11,
    urgentCount: 3,
    outOfStockCount: 1,
    estimatedValueToOrder: 9876.5,
    currency: 'TND',
    serviceLevelPercent: 97.5,
    stockOutRatePercent: 2.5,
    computedAt: new Date().toISOString(),
    topUrgencies: []
  };
}

// ─────────────────────────────────────── Page object ─────────────────────────────────────────────

/**
 * Light page-object for the V2 board. Wraps the most common interactions
 * so each spec stays declarative.
 */
export class ReplenishmentBoardPage {
  constructor(public readonly page: Page) {}

  /** Navigates to /forecasting/replenishment (V2 always forced via this URL). */
  async goto(): Promise<void> {
    await this.page.goto('/forecasting/replenishment');
    await this.page.waitForSelector('#repl-table, .state.empty', { timeout: 8000 });
  }

  rowByCode(productCode: string) {
    return this.page.locator(`tr:has(.code:text-is("${productCode}"))`);
  }

  async toggleSelect(productCode: string): Promise<void> {
    await this.rowByCode(productCode).locator('input[type="checkbox"]').click();
  }

  async clickApprove(productCode: string): Promise<void> {
    await this.rowByCode(productCode).getByRole('button', { name: 'Approuver' }).click();
  }

  async clickDismiss(productCode: string): Promise<void> {
    await this.rowByCode(productCode).getByRole('button', { name: 'Écarter' }).click();
  }
}

// ─────────────────────────────────────── Mock router ─────────────────────────────────────────────

/**
 * Installs deterministic backend mocks for the V2 endpoints. Returns hooks the test can
 * call to inspect what was POSTed (e.g. verify that <c>productId</c> hits the backend on F-C3).
 */
export async function mockV2Backend(page: Page, opts: MockOptions = {}): Promise<MockTracker> {
  const tracker: MockTracker = {
    listCalls: [],
    approveCalls: [],
    dismissCalls: [],
    overrideCalls: [],
    undoCalls: [],
    notesCalls: [],
    createPoCalls: [],
    generateCalls: [],
    historyCalls: [],
    kpiCalls: [],
    exportCalls: []
  };

  let dataset = (opts.dataset ?? SAMPLE_RECS)();
  const kpi = opts.kpi ?? defaultKpi();

  // Phase 9 review P9-M1: the previous design installed two list routes — a wildcard one that
  // ate every V2 URL then fell through, plus a specific regex. Order-dependent + fragile.
  // Keep only the precise regex: `/v2` or `/v2?query=...` (no path segment after v2 = the list).
  await page.route(/\/api\/forecasting\/replenishment\/v2(\?.*)?$/, async (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    tracker.listCalls.push(request.url());
    await route.fulfill({ json: api(paged(dataset)) });
  });

  // KPI
  await page.route(/\/api\/forecasting\/replenishment\/v2\/kpi(\?.*)?$/, async (route) => {
    tracker.kpiCalls.push(route.request().url());
    await route.fulfill({ json: api(kpi) });
  });

  // Approve
  await page.route(/\/api\/forecasting\/replenishment\/v2\/[0-9a-z-]+\/approve$/, async (route) => {
    const id = idFromUrl(route.request().url(), 'approve');
    tracker.approveCalls.push(id);
    const rec = dataset.find(r => r.id === id);
    if (rec) rec.status = 'approved';
    await route.fulfill({ json: api(rec ?? buildRec({ id })) });
  });

  // Dismiss (requires reason)
  await page.route(/\/api\/forecasting\/replenishment\/v2\/[0-9a-z-]+\/dismiss$/, async (route) => {
    const id = idFromUrl(route.request().url(), 'dismiss');
    const body = (await route.request().postDataJSON()) as { reason?: string };
    tracker.dismissCalls.push({ id, reason: body?.reason ?? null });
    if (!body?.reason) {
      await route.fulfill({
        status: 400,
        json: { success: false, message: 'La raison du rejet est obligatoire.', code: 'ReasonRequired' }
      });
      return;
    }
    const rec = dataset.find(r => r.id === id);
    if (rec) rec.status = 'dismissed';
    await route.fulfill({ json: api(rec ?? buildRec({ id })) });
  });

  // Override
  await page.route(/\/api\/forecasting\/replenishment\/v2\/[0-9a-z-]+\/override$/, async (route) => {
    const id = idFromUrl(route.request().url(), 'override');
    const body = (await route.request().postDataJSON()) as { manualQty?: number; manualSupplierId?: string };
    tracker.overrideCalls.push({ id, ...body });
    const rec = dataset.find(r => r.id === id);
    if (rec) {
      rec.manualQtyOverride = body.manualQty ?? null;
      rec.manualSupplierOverride = body.manualSupplierId ?? null;
    }
    await route.fulfill({ json: api(rec ?? buildRec({ id })) });
  });

  // Undo
  await page.route(/\/api\/forecasting\/replenishment\/v2\/[0-9a-z-]+\/undo$/, async (route) => {
    const id = idFromUrl(route.request().url(), 'undo');
    tracker.undoCalls.push(id);
    const rec = dataset.find(r => r.id === id);
    if (rec) rec.status = 'pending';
    await route.fulfill({ json: api(rec ?? buildRec({ id })) });
  });

  // Notes
  await page.route(/\/api\/forecasting\/replenishment\/v2\/[0-9a-z-]+\/notes$/, async (route) => {
    const id = idFromUrl(route.request().url(), 'notes');
    const body = (await route.request().postDataJSON()) as { notes?: string };
    tracker.notesCalls.push({ id, notes: body?.notes ?? null });
    const rec = dataset.find(r => r.id === id);
    if (rec) rec.userNotes = body?.notes ?? null;
    await route.fulfill({ json: api(rec ?? buildRec({ id })) });
  });

  // History
  await page.route(/\/api\/forecasting\/replenishment\/v2\/[0-9a-z-]+\/history$/, async (route) => {
    const id = idFromUrl(route.request().url(), 'history');
    tracker.historyCalls.push(id);
    await route.fulfill({ json: api(opts.history?.(id) ?? []) });
  });

  // Create POs
  await page.route('**/api/forecasting/replenishment/create-purchase-orders', async (route) => {
    const body = (await route.request().postDataJSON()) as { recommendationIds?: string[] };
    const ids = body?.recommendationIds ?? [];
    tracker.createPoCalls.push(ids);

    // Faithful to the backend (PurchaseOrderDraftFactory): a draft PO requires an *effective*
    // supplier (manual override > preferred). Lines without one are reported as unlinked — this is
    // exactly the path the "PO never reaches Brouillon" fix repairs (assign in-modal → override → create).
    const groupedBySupplier = new Map<string, ReplenishmentRecV2[]>();
    const unlinkedRecommendationIds: string[] = [];
    for (const id of ids) {
      const rec = dataset.find(r => r.id === id);
      const supplierId = rec ? (rec.manualSupplierOverride ?? rec.preferredSupplierId) : null;
      if (!rec || !supplierId) {
        if (rec) unlinkedRecommendationIds.push(rec.id);
        continue;
      }
      const list = groupedBySupplier.get(supplierId) ?? [];
      list.push(rec);
      groupedBySupplier.set(supplierId, list);
    }
    const created = [...groupedBySupplier.entries()].map(([sid, recs], i) => ({
      purchaseOrderId: `po-${i + 1}`,
      purchaseOrderNumber: `BC-2026-${String(i + 1).padStart(6, '0')}`,
      supplierId: sid,
      supplierName: recs[0].preferredSupplierName ?? SUPPLIER_NAMES[sid] ?? '?',
      linesCount: recs.length,
      totalAmount: recs.reduce((s, r) => s + r.recommendedQty, 0),
      recommendationIds: recs.map(r => r.id)
    }));
    for (const c of created) {
      for (const recId of c.recommendationIds) {
        const rec = dataset.find(r => r.id === recId);
        if (rec) {
          rec.status = 'ordered';
          rec.linkedPurchaseOrderId = c.purchaseOrderId;
        }
      }
    }
    await route.fulfill({
      json: api({
        createdPurchaseOrdersCount: created.length,
        linkedRecommendationsCount: created.reduce((s, c) => s + c.linesCount, 0),
        totalEstimatedQty: created.reduce((s, c) => s + c.totalAmount, 0),
        createdPurchaseOrders: created,
        warnings: opts.warnings ?? [],
        unlinkedRecommendationIds
      })
    });
  });

  // Generate (fix F-C3 — backend honours productId)
  await page.route('**/api/forecasting/replenishment/generate**', async (route) => {
    const url = new URL(route.request().url());
    const productId = url.searchParams.get('productId');
    const warehouseId = url.searchParams.get('warehouseId');
    tracker.generateCalls.push({ productId, warehouseId });
    // Pretend 1 new rec when scoped to a product, otherwise 3.
    const count = productId ? 1 : 3;
    await route.fulfill({ json: api(count) });
  });

  // V1 Generate (used by ProductDemandModalComponent — fix F-C3 still applies)
  await page.route('**/api/forecasting/replenishment/generate**', async (route) => {
    const url = new URL(route.request().url());
    const productId = url.searchParams.get('productId');
    const warehouseId = url.searchParams.get('warehouseId');
    tracker.generateCalls.push({ productId, warehouseId, v1: true } as never);
    const count = productId ? 1 : 0;
    await route.fulfill({ json: api(count) });
  });

  // Export (CSV blob)
  await page.route(/\/api\/forecasting\/replenishment\/v2\/export(\?.*)?$/, async (route) => {
    tracker.exportCalls.push(route.request().url());
    const csv = 'Code;Nom\r\nFRI-001;Farine T55\r\n';
    await route.fulfill({
      contentType: 'text/csv; charset=utf-8',
      body: '﻿' + csv,
      headers: { 'Content-Disposition': 'attachment; filename="replenishment.csv"' }
    });
  });

  // Suppliers list (needed by the override modal)
  await page.route('**/api/suppliers**', async (route) => {
    await route.fulfill({
      json: api({
        items: [
          { id: 'sup-A', name: 'Alpha Distribution', type: 'Business', typeDisplay: 'Société', nif: null, email: 'a@a.tn', phone: null, contactPerson: null, paymentTermDays: 30, notes: null, isActive: true, fullAddress: 'Tunis', createdAt: '2026-01-01' },
          { id: 'sup-B', name: 'Beta Wholesale', type: 'Business', typeDisplay: 'Société', nif: null, email: 'b@b.tn', phone: null, contactPerson: null, paymentTermDays: 45, notes: null, isActive: true, fullAddress: 'Sfax', createdAt: '2026-01-01' }
        ],
        page: 1, pageSize: 200, totalCount: 2
      })
    });
  });

  // Warehouses list (needed by the filters dropdown)
  await page.route('**/api/stock/warehouses**', async (route) => {
    await route.fulfill({
      json: api([
        { id: 'wh-1', code: 'PRIN', name: 'Magasin01', address: '', isActive: true },
        { id: 'wh-2', code: 'M02',  name: 'Magasin02', address: '', isActive: true }
      ])
    });
  });

  return tracker;
}

// ─────────────────────────────────────── Helpers ─────────────────────────────────────────────────

function buildRec(over: Partial<ReplenishmentRecV2> = {}): ReplenishmentRecV2 {
  return {
    id: 'rec-default',
    productId: 'p-1',
    productCode: 'P-1',
    productName: 'Produit',
    warehouseId: 'wh-1',
    warehouseName: 'Principal',
    generatedAt: new Date().toISOString(),
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
    suggestedPurchaseUnitPrice: 15,
    ...over
  };
}

function paged<T>(items: T[]) {
  return { items, page: 1, pageSize: 50, totalCount: items.length };
}

function api<T>(data: T) {
  return { success: true, data, message: null };
}

function idFromUrl(url: string, suffix: string): string {
  const m = url.match(new RegExp(`/v2/([0-9a-z-]+)/${suffix}`, 'i'));
  return m?.[1] ?? '';
}

// ─────────────────────────────────────── Types ───────────────────────────────────────────────────

export type ReplenishmentStatusE2E = 'pending' | 'approved' | 'dismissed' | 'ordered' | 'superseded';

export interface ReplenishmentRecV2 {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  generatedAt: string;
  currentStockOnHand: number;
  recommendedQty: number;
  rop: number;
  safetyStock: number;
  leadTimeDays: number;
  dailyDemand: number;
  reasonCodes: string[];
  status: ReplenishmentStatusE2E;
  linkedPurchaseOrderId: string | null;
  processedAt: string | null;
  productUnit: string | null;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
  quantityOnOrder: number;
  effectiveQty: number;
  manualQtyOverride: number | null;
  manualSupplierOverride: string | null;
  daysOfStockRemaining: number | null;
  userNotes: string | null;
  urgencyLevel: 'OutOfStock' | 'Urgent' | 'Warning' | 'Normal';
  suggestedPurchaseUnitPrice: number | null;
}

export interface ReplenishmentKpi {
  pendingCount: number;
  urgentCount: number;
  outOfStockCount: number;
  estimatedValueToOrder: number;
  currency: string;
  serviceLevelPercent: number;
  stockOutRatePercent: number;
  computedAt: string;
  topUrgencies: unknown[];
}

export interface MockOptions {
  dataset?: () => ReplenishmentRecV2[];
  kpi?: ReplenishmentKpi;
  warnings?: string[];
  history?: (recId: string) => unknown[];
}

export interface MockTracker {
  listCalls: string[];
  approveCalls: string[];
  dismissCalls: { id: string; reason: string | null }[];
  overrideCalls: { id: string; manualQty?: number; manualSupplierId?: string }[];
  undoCalls: string[];
  notesCalls: { id: string; notes: string | null }[];
  createPoCalls: string[][];
  generateCalls: { productId: string | null; warehouseId: string | null }[];
  historyCalls: string[];
  kpiCalls: string[];
  exportCalls: string[];
}

// Re-export Playwright test/expect so each spec can `import` from the fixture file directly.
export { test, expect };
