import { expect, test, type Page, type Route } from '@playwright/test';
import { installErpSession, settle, ERP_E2E_USER } from '../helpers/erp-session.mock';

/**
 * Propositions de lettrage et lettrage en masse (Phase 3) — API simulée (aucun backend), comme
 * `lettering.spec.ts`. Le drapeau front `letteringProposals` est éteint par défaut ; les scénarios
 * qui l'activent passent par `localStorage` (`ft.accounting.featureFlags`), comme le panneau de
 * diagnostic. Le drapeau serveur (`Accounting:LetteringSuggestionsEnabled`) est simulé par les
 * réponses de l'API.
 */

test.setTimeout(60_000);

const ok = <T,>(data: T) => ({ success: true, data, message: null, errors: [] });
const fail = (code: string, message = code) => ({ success: false, data: null, message, errors: [message], code });
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const LINES_API = '**/api/accounting/lettering/lines**';
const SUGGESTIONS_API = '**/api/accounting/lettering/suggestions**';
const BULK_API = '**/api/accounting/lettering/bulk';
const LETTER_API = '**/api/accounting/letter';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function line(lineId: string, debit: number, credit: number, pieceRef: string) {
  return {
    lineId,
    entryId: `e-${lineId}`,
    entryDate: '2026-03-02',
    journalCode: debit ? 'VE' : 'BQ',
    entryNumber: 1,
    lineNumber: 1,
    accountNumber: '4111',
    label: debit ? 'Facture client' : 'Règlement client',
    entryLabel: debit ? 'Facture client' : 'Règlement client',
    pieceRef,
    sourceCategory: debit ? 'invoice' : 'payment',
    debit,
    credit,
    operationCurrency: 'TND',
    debitInCurrency: debit,
    creditInCurrency: credit,
    letteringCode: null,
    isPartiallyLettered: false,
    thirdPartyId: null,
    thirdPartyKind: null,
    thirdPartyName: null,
    isDraft: false,
    isReversed: false,
    isReversal: false,
    periodLocked: false
  };
}

type Line = ReturnType<typeof line>;

function linesPage(lines: Line[]) {
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  return {
    items: lines, page: 1, pageSize: 2000, totalCount: lines.length, truncated: false,
    totals: {
      count: lines.length,
      debitCount: lines.filter(l => l.debit !== 0).length,
      creditCount: lines.filter(l => l.debit === 0).length,
      totalDebit, totalCredit, balance: totalDebit - totalCredit
    }
  };
}

function suggestionLine(l: Line) {
  return {
    lineId: l.lineId, entryId: l.entryId, entryDate: l.entryDate, journalCode: l.journalCode, entryNumber: l.entryNumber,
    pieceRef: l.pieceRef, label: l.label, debit: l.debit, credit: l.credit,
    debitInCurrency: l.debitInCurrency, creditInCurrency: l.creditInCurrency
  };
}

function suggestion(key: string, debit: Line, credit: Line, over: Record<string, unknown> = {}) {
  return {
    key, kind: 'SameReference', category: 'Exact', score: 90, confidence: 'High',
    accountNumber: '4111', currencyCode: 'TND', thirdPartyId: null, thirdPartyKind: 0, thirdPartyName: null,
    debitLines: [suggestionLine(debit)], creditLines: [suggestionLine(credit)],
    totalAmount: debit.debit, localGap: 0, hasExchangeDifference: false, bulkEligible: true,
    reasons: [{ code: 'SAME_REFERENCE', args: { reference: debit.pieceRef } }],
    ...over
  };
}

function suggestionsResult(list: unknown[]) {
  return {
    suggestions: list, totalFound: list.length, returned: list.length, candidateLineCount: 6,
    truncated: false, truncationReason: null, computedAtUtc: '2026-10-12T10:00:00Z'
  };
}

// Trois paires : deux propositions éligibles en masse (confiance élevée), une avec écart de change.
const d1 = line('d1', 100, 0, 'FAC-1');
const c1 = line('c1', 0, 100, 'FAC-1');
const d2 = line('d2', 250, 0, 'FAC-2');
const c2 = line('c2', 0, 250, 'FAC-2');
const d3 = line('d3', 80, 0, 'FAC-3');
const c3 = line('c3', 0, 80, 'FAC-3');
const ALL_LINES = [d1, c1, d2, c2, d3, c3];
const S1 = suggestion('s1', d1, c1, { score: 95 });
const S2 = suggestion('s2', d2, c2, { score: 90 });
const S3 = suggestion('s3', d3, c3, {
  score: 70, confidence: 'Medium', hasExchangeDifference: true, bulkEligible: false, localGap: 1.5
});

/** Session cabinet en mode délégué (voir `lettering.spec.ts`), annuaires vides, lignes servies. */
async function installMocks(page: Page, options: { flag: boolean }): Promise<void> {
  await installErpSession(page, { locale: 'fr' });
  const firmUser = { ...ERP_E2E_USER, tenantKind: 'accountingFirm', accessMode: 'delegated', preferredLanguage: 'fr' };
  await page.addInitScript(
    ([userJson, flag]) => {
      localStorage.setItem('ft_user', userJson);
      if (flag) localStorage.setItem('ft.accounting.featureFlags', JSON.stringify({ letteringProposals: true }));
      else localStorage.removeItem('ft.accounting.featureFlags');
    },
    [JSON.stringify(firmUser), options.flag] as const
  );
  await page.route('**/api/auth/me', route => json(route, ok(firmUser)));
  await page.route('**/api/accounting/chart-of-accounts**', route => json(route, ok([])));
  await page.route('**/api/accounting/third-parties**', route =>
    json(route, ok({ items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false }))
  );
  await page.route('**/api/accounting/journals**', route => json(route, ok([])));
}

async function openLettering(page: Page): Promise<void> {
  await page.goto('/accounting/lettering?account=4111&from=2026-01-01&to=2026-10-11&autoLoad=1', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible({ timeout: 15_000 });
}

/** Ouvre le dialogue de masse depuis le tiroir « Voir toutes les propositions ». */
async function openBulkDialog(page: Page) {
  await page.getByTestId('lettering-proposals-show-all').click();
  await expect(page.getByTestId('lettering-proposals-drawer')).toBeVisible();
  await page.getByTestId('lettering-proposals-open-bulk').locator('button').click();
  const dialog = page.getByTestId('lettering-bulk-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('drapeau éteint (défaut) : aucun bandeau, aucun appel lettering/suggestions', async ({ page }) => {
  await installMocks(page, { flag: false });
  await page.route(LINES_API, route => json(route, ok(linesPage(ALL_LINES))));
  let suggestionCalls = 0;
  await page.route(SUGGESTIONS_API, route => {
    suggestionCalls++;
    return json(route, ok(suggestionsResult([S1])));
  });

  await openLettering(page);
  // Laisse passer l'anti-rebond (300 ms) du calcul des propositions.
  await page.waitForTimeout(1_000);

  await expect(page.getByTestId('lettering-proposals-strip')).toHaveCount(0);
  await expect(page.getByTestId('lettering-proposals-header-button')).toHaveCount(0);
  expect(suggestionCalls).toBe(0);
});

test('drapeau actif : le bandeau reçoit les filtres de l\'écran et valide une proposition (origine Suggestion)', async ({ page }) => {
  await installMocks(page, { flag: true });
  let loadCount = 0;
  await page.route(LINES_API, route => {
    loadCount++;
    return json(route, ok(linesPage(ALL_LINES)));
  });
  const suggestionUrls: string[] = [];
  await page.route(SUGGESTIONS_API, route => {
    suggestionUrls.push(route.request().url());
    return json(route, ok(suggestionsResult([S1, S2, S3])));
  });
  const letterBodies: unknown[] = [];
  await page.route(LETTER_API, route => {
    letterBodies.push(route.request().postDataJSON());
    return json(route, ok({ code: 'L00077', groupId: 'g-77', isPartial: false, lineCount: 2, previousCode: null }));
  });

  await openLettering(page);
  const strip = page.getByTestId('lettering-proposals-strip');
  await expect(strip).toBeVisible({ timeout: 10_000 });
  await expect(strip.getByTestId('lettering-proposal-card')).toHaveCount(3);

  const url = new URL(suggestionUrls[0]);
  expect(url.searchParams.get('account')).toBe('4111');
  expect(url.searchParams.get('from')).toBe('2026-01-01');
  expect(url.searchParams.get('to')).toBe('2026-10-11');

  const loadsBefore = loadCount;
  await strip.getByTestId('lettering-proposal-validate').first().locator('button').click();
  const modal = page.locator('ngb-modal-window');
  await expect(modal).toContainText('Lettrer les 2 lignes de cette proposition ?');
  await modal.getByRole('button', { name: 'Lettrer' }).click();

  await expect(page.getByText(/Proposition validée : lettrage L00077 créé/)).toBeVisible({ timeout: 10_000 });
  expect(letterBodies).toEqual([{ journalEntryLineIds: ['d1', 'c1'], allowPartial: false, origin: 'Suggestion', suggestionKey: 's1' }]);
  await expect.poll(() => loadCount).toBeGreaterThan(loadsBefore);
});

test('lettrage en masse : choix par défaut, confirmation explicite, rapport puis rechargement des lignes', async ({ page }) => {
  await installMocks(page, { flag: true });
  let loadCount = 0;
  await page.route(LINES_API, route => {
    loadCount++;
    return json(route, ok(linesPage(ALL_LINES)));
  });
  await page.route(SUGGESTIONS_API, route => json(route, ok(suggestionsResult([S1, S2, S3]))));
  const bulkBodies: Array<{ requestId: string; groups: unknown[] }> = [];
  await page.route(BULK_API, route => {
    const body = route.request().postDataJSON() as { requestId: string; groups: unknown[] };
    bulkBodies.push(body);
    return json(route, ok({
      requestId: body.requestId, total: 2, lettered: 1, alreadyLettered: 1, rejected: 0, notProcessed: 0,
      results: [
        { clientKey: 's1', status: 'Lettered', code: 'L00100', errorCode: null, message: null },
        { clientKey: 's2', status: 'AlreadyLettered', code: 'L00090', errorCode: null, message: null }
      ]
    }));
  });

  await openLettering(page);
  await expect(page.getByTestId('lettering-proposals-strip')).toBeVisible({ timeout: 10_000 });
  const dialog = await openBulkDialog(page);

  // Les deux propositions à confiance élevée sont cochées ; celle avec écart de change est bloquée et expliquée.
  const checks = dialog.getByTestId('lettering-bulk-check');
  await expect(checks).toHaveCount(3);
  await expect(checks.nth(0)).toBeChecked();
  await expect(checks.nth(1)).toBeChecked();
  await expect(checks.nth(2)).toBeDisabled();
  await expect(dialog.getByTestId('lettering-bulk-why')).toContainText('Écart de change');
  await expect(dialog.getByTestId('lettering-bulk-summary')).toContainText('2 propositions cochées · 4 lignes');

  // Aucun envoi avant la confirmation explicite.
  await page.getByTestId('lettering-bulk-next').locator('button').click();
  const question = page.getByTestId('lettering-bulk-confirm-question');
  await expect(question).toHaveText('Lettrer 2 propositions (4 lignes) ?');
  await expect(question).toBeFocused();
  expect(bulkBodies).toHaveLength(0);

  await page.getByTestId('lettering-bulk-run').locator('button').click();
  const summary = page.getByTestId('lettering-bulk-report-summary');
  await expect(summary).toContainText('Lettrées : 1');
  await expect(summary).toBeFocused();
  await expect(page.getByTestId('lettering-bulk-not-processed-hint')).toHaveCount(0);

  expect(bulkBodies).toHaveLength(1);
  expect(bulkBodies[0].requestId).toMatch(UUID);
  expect(bulkBodies[0].groups).toEqual([
    { clientKey: 's1', journalEntryLineIds: ['d1', 'c1'] },
    { clientKey: 's2', journalEntryLineIds: ['d2', 'c2'] }
  ]);

  const loadsBefore = loadCount;
  await page.getByTestId('lettering-bulk-close').locator('button').click();
  await expect(page.getByTestId('lettering-bulk-dialog')).toHaveCount(0);
  await expect.poll(() => loadCount).toBeGreaterThan(loadsBefore);
});

test('lettrage en masse : après une erreur serveur, « Réessayer » renvoie le même lot (même requestId)', async ({ page }) => {
  await installMocks(page, { flag: true });
  await page.route(LINES_API, route => json(route, ok(linesPage(ALL_LINES))));
  await page.route(SUGGESTIONS_API, route => json(route, ok(suggestionsResult([S1, S2, S3]))));
  const bulkBodies: Array<{ requestId: string; groups: unknown[] }> = [];
  await page.route(BULK_API, route => {
    const body = route.request().postDataJSON() as { requestId: string; groups: unknown[] };
    bulkBodies.push(body);
    if (bulkBodies.length === 1) return json(route, fail('INTERNAL_ERROR', 'Erreur serveur'), 500);
    return json(route, ok({
      requestId: body.requestId, total: 2, lettered: 2, alreadyLettered: 0, rejected: 0, notProcessed: 0,
      results: [
        { clientKey: 's1', status: 'Lettered', code: 'L00101', errorCode: null, message: null },
        { clientKey: 's2', status: 'Lettered', code: 'L00102', errorCode: null, message: null }
      ]
    }));
  });

  await openLettering(page);
  await expect(page.getByTestId('lettering-proposals-strip')).toBeVisible({ timeout: 10_000 });
  await openBulkDialog(page);
  await page.getByTestId('lettering-bulk-next').locator('button').click();
  await page.getByTestId('lettering-bulk-run').locator('button').click();

  const error = page.getByTestId('lettering-bulk-error');
  await expect(error).toContainText('une partie a pu être lettrée');
  await expect(error).toBeFocused();

  await page.getByTestId('lettering-bulk-retry').locator('button').click();
  await expect(page.getByTestId('lettering-bulk-report-summary')).toContainText('Lettrées : 2');
  expect(bulkBodies).toHaveLength(2);
  expect(bulkBodies[1]).toEqual(bulkBodies[0]);
});

test('drapeau serveur éteint (LETTERING_FEATURE_DISABLED) : le bandeau disparaît, l\'écran reste utilisable', async ({ page }) => {
  await installMocks(page, { flag: true });
  await page.route(LINES_API, route => json(route, ok(linesPage(ALL_LINES))));
  await page.route(SUGGESTIONS_API, route =>
    json(route, fail('LETTERING_FEATURE_DISABLED', 'Les propositions de lettrage sont désactivées.'), 400)
  );

  await openLettering(page);
  await page.waitForTimeout(1_000);

  await expect(page.getByTestId('lettering-proposal-card')).toHaveCount(0);
  await expect(page.getByTestId('lettering-proposals-strip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Valider le lettrage' })).toBeVisible();
});
