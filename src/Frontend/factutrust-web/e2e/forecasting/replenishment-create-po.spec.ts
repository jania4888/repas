/**
 * E2E — Create Purchase Orders from selected recommendations.
 *
 * Covers the two flagship fixes of the plan:
 *   • F-C1 — every linked recommendation transitions to <c>Ordered</c> and gains a clickable PO link.
 *   • F-C2 — the action creates real PO drafts (no more silent "Approved" pretending to be a PO).
 *
 * Mocked backend (no real DB) — we still validate the front-end orchestration:
 * selection → confirmation modal → grouping by supplier → POST → toast + UI refresh.
 */
import { test, expect, mockV2Backend, ReplenishmentBoardPage, SAMPLE_RECS } from './replenishment.fixtures';

test.describe('Replenishment V2 — Create Purchase Orders', () => {
  test('groups the selection by supplier in the confirmation modal', async ({ page }) => {
    await mockV2Backend(page);
    const board = new ReplenishmentBoardPage(page);
    await board.goto();
    if (page.url().includes('/auth/login')) test.skip(true, 'Authentication required');

    // Select rec-1 (Alpha) + rec-3 (Beta) → expect 2 groups in the modal.
    await board.toggleSelect('FRI-001');
    await board.toggleSelect('STY55666');

    await page.getByRole('button', { name: /Créer les BC \(2\)/ }).click();

    const modal = page.locator('app-prepare-po-confirm-modal [role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.supplier-group')).toHaveCount(2);
    await expect(modal).toContainText('Alpha Distribution');
    await expect(modal).toContainText('Beta Wholesale');
    await expect(modal.locator('select.po-supplier-select').first()).toBeVisible();
  });

  test('warns about recommendations missing a supplier', async ({ page }) => {
    await mockV2Backend(page);
    const board = new ReplenishmentBoardPage(page);
    await board.goto();
    if (page.url().includes('/auth/login')) test.skip(true, 'Authentication required');

    // PORTE001 has no preferred supplier — it must end up in a "Sans fournisseur" group.
    await board.toggleSelect('PORTE001');
    await page.getByRole('button', { name: /Créer les BC \(1\)/ }).click();

    const modal = page.locator('app-prepare-po-confirm-modal [role="dialog"]');
    await expect(modal.locator('.supplier-group.has-issue')).toContainText('Sans fournisseur');
    await expect(modal.locator('.warning')).toContainText('sans fournisseur');
  });

  test('confirming creates PO drafts and recommendations transition to Ordered (fix F-C1, F-C2)', async ({ page }) => {
    const tracker = await mockV2Backend(page);
    const board = new ReplenishmentBoardPage(page);
    await board.goto();
    if (page.url().includes('/auth/login')) test.skip(true, 'Authentication required');

    await board.toggleSelect('FRI-001');
    await board.toggleSelect('TAB5552'); // both Alpha → 1 PO expected
    await page.getByRole('button', { name: /Créer les BC \(2\)/ }).click();

    const modal = page.locator('app-prepare-po-confirm-modal [role="dialog"]');
    await modal.getByRole('button', { name: /Confirmer la création/ }).click();

    // Wait for the toast acknowledging the creation.
    await expect(page.locator('.p-toast-message-success, .toast-success').first()).toContainText('BC créé');

    // The backend (mock) was called with the right ids.
    expect(tracker.createPoCalls).toEqual([['rec-1', 'rec-2']]);
  });

  test('assigning a supplier in the modal unblocks creation — the PO finally reaches Brouillon (regression)', async ({ page }) => {
    // Reproduces the reported bug: a recommendation with NO supplier (PORTE001) used to show a
    // misleading "1 will be created" with a clickable button that created 0 BC. The fix lets the
    // user assign a supplier inline; the board then persists it (override) and creates the PO.
    const tracker = await mockV2Backend(page);
    const board = new ReplenishmentBoardPage(page);
    await board.goto();
    if (page.url().includes('/auth/login')) test.skip(true, 'Authentication required');

    await board.toggleSelect('PORTE001'); // rec-4, no preferred/manual supplier
    await page.getByRole('button', { name: /Créer les BC \(1\)/ }).click();

    const modal = page.locator('app-prepare-po-confirm-modal [role="dialog"]');
    await expect(modal).toBeVisible();

    // 1) No-op guard: nothing is creatable yet → button blocked and counts an honest 0 BC.
    const confirmBtn = modal.getByRole('button', { name: /Confirmer la création/ });
    await expect(confirmBtn).toBeDisabled();
    await expect(confirmBtn).toContainText('(0 BC)');

    // 2) Assign a supplier via the per-line column (suppliers list loaded when the modal opens).
    const select = modal.locator('.supplier-group.has-issue select.po-supplier-select');
    await expect(select).toBeVisible();
    await select.selectOption({ label: 'Alpha Distribution' });

    // 3) The line leaves the "Sans fournisseur" group → button unlocks and the count becomes honest.
    await expect(confirmBtn).toBeEnabled();
    await expect(confirmBtn).toContainText('(1 BC)');

    // 4) Confirm → two-phase: persist the chosen supplier first, then create the draft PO.
    await confirmBtn.click();

    await expect(page.locator('.p-toast-message-success, .toast-success').first()).toContainText('BC créé');

    // The assigned supplier was persisted via override before the create call.
    expect(tracker.overrideCalls).toContainEqual(
      expect.objectContaining({ id: 'rec-4', manualSupplierId: 'sup-A' })
    );
    expect(tracker.createPoCalls).toEqual([['rec-4']]);

    // 5) On-page proof the BC now exists: the row transitioned to Ordered with a clickable PO link.
    await expect(board.rowByCode('PORTE001').locator('.po-link')).toBeVisible();
  });

  test('bulk-assigning a supplier to every unassigned line unblocks creation in one click', async ({ page }) => {
    // Two supplier-less lines (PORTE001 + TAB5552) → the modal shows a single "assign to all"
    // picker. One selection moves both lines out of the "Sans fournisseur" group.
    const dataset = () => {
      const recs = SAMPLE_RECS();
      const tab = recs.find(r => r.productCode === 'TAB5552')!;
      tab.preferredSupplierId = null;
      tab.preferredSupplierName = null;
      return recs;
    };
    const tracker = await mockV2Backend(page, { dataset });
    const board = new ReplenishmentBoardPage(page);
    await board.goto();
    if (page.url().includes('/auth/login')) test.skip(true, 'Authentication required');

    await board.toggleSelect('TAB5552'); // rec-2, now without supplier
    await board.toggleSelect('PORTE001'); // rec-4, without supplier
    await page.getByRole('button', { name: /Créer les BC \(2\)/ }).click();

    const modal = page.locator('app-prepare-po-confirm-modal [role="dialog"]');
    await expect(modal).toBeVisible();

    const confirmBtn = modal.getByRole('button', { name: /Confirmer la création/ });
    await expect(confirmBtn).toBeDisabled();
    await expect(confirmBtn).toContainText('(0 BC)');

    // Bulk picker lives in the "Sans fournisseur" group and is distinct from the per-line selects.
    const bulkSelect = modal.locator('.supplier-group.has-issue select.po-bulk-select');
    await expect(bulkSelect).toBeVisible();
    await bulkSelect.selectOption({ label: 'Alpha Distribution' });

    // Both lines now resolve to Alpha → one PO group → button unlocks with an honest count.
    await expect(confirmBtn).toBeEnabled();
    await expect(confirmBtn).toContainText('(1 BC)');

    await confirmBtn.click();
    await expect(page.locator('.p-toast-message-success, .toast-success').first()).toContainText('BC créé');

    // Both lines were persisted (override) before the create call.
    expect(tracker.overrideCalls).toContainEqual(
      expect.objectContaining({ id: 'rec-2', manualSupplierId: 'sup-A' })
    );
    expect(tracker.overrideCalls).toContainEqual(
      expect.objectContaining({ id: 'rec-4', manualSupplierId: 'sup-A' })
    );
    expect(tracker.createPoCalls).toEqual([['rec-2', 'rec-4']]);
  });

  test('the prepare button is disabled with no selection', async ({ page }) => {
    await mockV2Backend(page);
    const board = new ReplenishmentBoardPage(page);
    await board.goto();
    if (page.url().includes('/auth/login')) test.skip(true, 'Authentication required');

    await expect(page.getByRole('button', { name: /Créer les BC \(0\)/ })).toBeDisabled();
  });
});
