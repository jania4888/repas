import { expect, test, type Page, type Route } from '@playwright/test';
import { installErpSession, settle, ERP_E2E_USER } from '../helpers/erp-session.mock';

/**
 * Écran de lettrage (Phase 2) — API simulée (aucun backend), comme `bank-statement-import.spec.ts` :
 * chaque scénario sert une session dans l'état voulu et vérifie ce que l'écran envoie au serveur.
 */

test.setTimeout(60_000);

const ok = <T,>(data: T) => ({ success: true, data, message: null, errors: [] });
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface LineOverrides {
  lineId: string;
  entryId?: string;
  entryDate?: string;
  journalCode?: string;
  entryNumber?: number;
  lineNumber?: number;
  accountNumber?: string;
  label?: string;
  pieceRef?: string | null;
  sourceCategory?: string;
  debit?: number;
  credit?: number;
  operationCurrency?: string;
  debitInCurrency?: number;
  creditInCurrency?: number;
  letteringCode?: string | null;
  isPartiallyLettered?: boolean;
  periodLocked?: boolean;
}

function line(overrides: LineOverrides) {
  return {
    entryId: `e-${overrides.lineId}`,
    entryDate: '2026-03-02',
    journalCode: 'VE',
    entryNumber: 1,
    lineNumber: 1,
    accountNumber: '4111',
    label: 'Facture client',
    entryLabel: 'Facture client',
    pieceRef: null,
    sourceCategory: 'invoice',
    debit: 0,
    credit: 0,
    operationCurrency: 'TND',
    debitInCurrency: 0,
    creditInCurrency: 0,
    letteringCode: null,
    isPartiallyLettered: false,
    thirdPartyId: null,
    thirdPartyKind: null,
    thirdPartyName: null,
    isDraft: false,
    isReversed: false,
    isReversal: false,
    periodLocked: false,
    ...overrides
  };
}

function totalsFor(lines: ReturnType<typeof line>[]) {
  let debitCount = 0, creditCount = 0, totalDebit = 0, totalCredit = 0;
  for (const l of lines) {
    if (l.debit !== 0) { debitCount++; totalDebit += l.debit; }
    else { creditCount++; totalCredit += l.credit; }
  }
  return { count: lines.length, debitCount, creditCount, totalDebit, totalCredit, balance: totalDebit - totalCredit };
}

function linesPage(lines: ReturnType<typeof line>[], truncated = false) {
  return { items: lines, page: 1, pageSize: 2000, totalCount: lines.length, truncated, totals: totalsFor(lines) };
}

function groupDto(overrides: Record<string, unknown>) {
  return {
    id: 'g-1',
    code: 'L00001',
    accountNumber: '4111',
    amount: 100,
    operationCurrency: 'TND',
    isPartial: false,
    letteredAt: '2026-03-02T10:00:00',
    createdByDisplayName: 'Amina Test',
    lines: [],
    canUnletter: true,
    unletterBlockedReason: null,
    canComplete: false,
    ...overrides
  };
}

const LINES_API = '**/api/accounting/lettering/lines**';
const LETTER_API = '**/api/accounting/letter';
const UNLETTER_API = '**/api/accounting/unletter';
const SETTLE_API = '**/api/accounting/lettering/settle-exchange-difference';
const GROUP_API_PATTERN = /\/api\/accounting\/lettering\/groups\/([^/?]+)$/;

/**
 * Session simulée + API du lettrage : annuaires vides (pas de saisie dans les filtres), lignes servies à la demande.
 * Toujours en français : /accounting/lettering exige un cabinet en mode délégué (voir ci-dessous), et
 * ErpLocaleService force le français pour toute session cabinet (mustForceFrench() → isAccountingFirm()).
 */
async function installLetteringMocks(
  page: Page,
  options: { lines?: ReturnType<typeof line>[]; permissionOverride?: 'full' | 'no-unletter' } = {}
): Promise<void> {
  await installErpSession(page, { locale: 'fr' });
  // Le lettrage est réservé aux cabinets (company-accounting-nav.guard) et le cabinet n'atteint
  // /accounting/** qu'en mode délégué, dans un dossier client (firm-native-redirect.guard) :
  // la session simulée est un cabinet connecté à un dossier (la dernière écriture de ft_user gagne)
  // et /api/auth/me renvoie le même profil — même motif que bank-statement-import.spec.ts.
  const firmUser = {
    ...ERP_E2E_USER,
    tenantKind: 'accountingFirm',
    accessMode: 'delegated',
    preferredLanguage: 'fr',
    effectivePermissions:
      options.permissionOverride === 'no-unletter'
        ? ERP_E2E_USER.effectivePermissions.filter(p => p !== 'accounting:unletter')
        : ERP_E2E_USER.effectivePermissions
  };
  await page.addInitScript(userJson => {
    localStorage.setItem('ft_user', userJson);
  }, JSON.stringify(firmUser));
  await page.route('**/api/auth/me', route => json(route, ok(firmUser)));
  await page.route('**/api/accounting/chart-of-accounts**', route => json(route, ok([])));
  await page.route('**/api/accounting/third-parties**', route => json(route, ok({ items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false })));
  await page.route('**/api/accounting/journals**', route => json(route, ok([])));
  await page.route(LINES_API, route => json(route, ok(linesPage(options.lines ?? []))));
}

async function openLettering(page: Page, query = ''): Promise<void> {
  await page.goto(`/accounting/lettering${query}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
}

test('deep-link : les paramètres déclenchent un chargement avec les bons filtres, deux volets affichés', async ({ page }) => {
  const debit = line({ lineId: 'd1', debit: 100, credit: 0 });
  const credit = line({ lineId: 'c1', debit: 0, credit: 100 });
  await installLetteringMocks(page, { lines: [debit, credit] });

  const requests: string[] = [];
  await page.route(LINES_API, route => {
    requests.push(route.request().url());
    return json(route, ok(linesPage([debit, credit])));
  });

  await openLettering(page, '?account=4111&state=unlettered&from=2026-01-01&to=2026-10-11&autoLoad=1');

  await expect(page.getByRole('heading', { name: 'Lettrage' })).toBeVisible({ timeout: 15_000 });
  expect(requests.length).toBeGreaterThanOrEqual(1);
  const url = new URL(requests[0]);
  expect(url.searchParams.get('account')).toBe('4111');
  expect(url.searchParams.get('state')).toBe('unlettered');
  expect(url.searchParams.get('from')).toBe('2026-01-01');
  expect(url.searchParams.get('to')).toBe('2026-10-11');

  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Crédit' })).toBeVisible();
});

test('deep-link : sans paramètres, aucun appel automatique et l\'état vide s\'affiche', async ({ page }) => {
  await installLetteringMocks(page, { lines: [] });
  const requests: string[] = [];
  await page.route(LINES_API, route => {
    requests.push(route.request().url());
    return json(route, ok(linesPage([])));
  });

  await openLettering(page);

  await expect(page.getByText('Saisissez un numéro de compte et cliquez sur Charger les écritures pour afficher les lignes à lettrer.')).toBeVisible({ timeout: 15_000 });
  expect(requests.length).toBe(0);
});

test('lettrage équilibré : Valider envoie allowPartial=false et recharge', async ({ page }) => {
  const debit = line({ lineId: 'd1', debit: 100, credit: 0 });
  const credit = line({ lineId: 'c1', debit: 0, credit: 100 });
  await installLetteringMocks(page, { lines: [debit, credit] });

  let loadCount = 0;
  await page.route(LINES_API, route => {
    loadCount++;
    return json(route, ok(linesPage([debit, credit])));
  });
  const letterBodies: unknown[] = [];
  await page.route(LETTER_API, route => {
    letterBodies.push(route.request().postDataJSON());
    return json(route, ok({ code: 'L00042', groupId: 'g-42', isPartial: false, lineCount: 2, previousCode: null }));
  });

  await openLettering(page, '?account=4111&autoLoad=1');
  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible({ timeout: 15_000 });

  await page.locator('.lettering-pane--debit p-tablecheckbox input[type="checkbox"]').first().check();
  await page.locator('.lettering-pane--credit p-tablecheckbox input[type="checkbox"]').first().check();

  const validate = page.getByRole('button', { name: 'Valider le lettrage' });
  await expect(validate).toBeEnabled();
  await validate.click();

  await expect(page.getByText(/Lettrage effectué avec succès \(code L00042\)/)).toBeVisible({ timeout: 10_000 });
  expect(letterBodies).toEqual([{ journalEntryLineIds: ['d1', 'c1'], allowPartial: false }]);
  expect(loadCount).toBeGreaterThanOrEqual(2);
});

test('lettrage partiel : sélection déséquilibrée désactive Valider, la case partielle envoie allowPartial=true', async ({ page }) => {
  const debit = line({ lineId: 'd1', debit: 100, credit: 0 });
  const credit = line({ lineId: 'c1', debit: 0, credit: 60 });
  await installLetteringMocks(page, { lines: [debit, credit] });
  await page.route(LINES_API, route => json(route, ok(linesPage([debit, credit]))));
  const letterBodies: unknown[] = [];
  await page.route(LETTER_API, route => {
    letterBodies.push(route.request().postDataJSON());
    return json(route, ok({ code: 'P00007', groupId: 'g-7', isPartial: true, lineCount: 2, previousCode: null }));
  });

  await openLettering(page, '?account=4111&autoLoad=1');
  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible({ timeout: 15_000 });

  await page.locator('.lettering-pane--debit p-tablecheckbox input[type="checkbox"]').first().check();
  await page.locator('.lettering-pane--credit p-tablecheckbox input[type="checkbox"]').first().check();

  const validate = page.getByRole('button', { name: 'Valider le lettrage' });
  await expect(validate).toBeDisabled();

  await page.getByText('Lettrage partiel').click();
  const partialValidate = page.getByRole('button', { name: 'Valider le lettrage partiel' });
  await expect(partialValidate).toBeEnabled();
  await partialValidate.click();

  await expect(page.getByText(/Lettrage partiel effectué \(code P00007\)/)).toBeVisible({ timeout: 10_000 });
  expect(letterBodies).toEqual([{ journalEntryLineIds: ['d1', 'c1'], allowPartial: true }]);
});

test('devise : écart de change détecté, Équilibrer envoie le compte d\'imputation', async ({ page }) => {
  const debit = line({ lineId: 'd1', debit: 300, credit: 0, operationCurrency: 'EUR', debitInCurrency: 100, creditInCurrency: 0 });
  const credit = line({ lineId: 'c1', debit: 0, credit: 295, operationCurrency: 'EUR', debitInCurrency: 0, creditInCurrency: 100 });
  await installLetteringMocks(page, { lines: [debit, credit] });
  await page.route(LINES_API, route => json(route, ok(linesPage([debit, credit]))));
  const settleBodies: unknown[] = [];
  await page.route(SETTLE_API, route => {
    settleBodies.push(route.request().postDataJSON());
    return json(route, ok('ok'));
  });

  await openLettering(page, '?account=4111&autoLoad=1');
  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible({ timeout: 15_000 });

  await page.locator('.lettering-pane--debit p-tablecheckbox input[type="checkbox"]').first().check();
  await page.locator('.lettering-pane--credit p-tablecheckbox input[type="checkbox"]').first().check();

  const equilibrer = page.getByRole('button', { name: 'Équilibrer' });
  await expect(equilibrer).toBeVisible();
  await equilibrer.click();

  const dialog = page.getByRole('dialog', { name: "Équilibrer l'écart de change" });
  await expect(dialog).toBeVisible();
  await dialog.locator('#lettering-settle-account').fill('655');
  await dialog.getByRole('button', { name: 'Équilibrer et lettrer' }).click();

  await expect(page.getByText(/Écart de change apuré sur le compte 655/)).toBeVisible({ timeout: 10_000 });
  expect(settleBodies).toEqual([{ journalEntryLineIds: ['d1', 'c1'], accountNumber: '655' }]);
});

test('délettrage : ouverture du tiroir, confirmation puis rechargement', async ({ page }) => {
  const lettered = line({ lineId: 'd1', debit: 100, credit: 0, letteringCode: 'L00001' });
  await installLetteringMocks(page, { lines: [lettered] });
  let loadCount = 0;
  await page.route(LINES_API, route => {
    loadCount++;
    return json(route, ok(linesPage([lettered])));
  });
  await page.route(GROUP_API_PATTERN, route =>
    json(route, ok(groupDto({ lines: [lettered] })))
  );
  const unletterBodies: unknown[] = [];
  await page.route(UNLETTER_API, route => {
    unletterBodies.push(route.request().postDataJSON());
    return json(route, ok(true));
  });

  await openLettering(page, '?account=4111&state=all&autoLoad=1');
  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible({ timeout: 15_000 });

  await page.locator('.lettering-code-badge').first().click();
  const drawer = page.locator('.lettering-group-drawer');
  await expect(drawer).toBeVisible();

  await drawer.getByRole('button', { name: 'Délettrer' }).click();
  const modal = page.locator('ngb-modal-window');
  await expect(modal).toContainText('Confirmation de délettrage');
  await modal.getByRole('button', { name: 'Délettrer' }).click();

  await expect(page.getByText(/Groupe L00001 délettré/)).toBeVisible({ timeout: 10_000 });
  expect(unletterBodies).toEqual([{ code: 'L00001' }]);
  expect(loadCount).toBeGreaterThanOrEqual(2);
});

test('délettrage : sans la permission accounting:unletter, le bouton Délettrer est absent et la raison est affichée', async ({ page }) => {
  const lettered = line({ lineId: 'd1', debit: 100, credit: 0, letteringCode: 'L00001' });
  await installLetteringMocks(page, { lines: [lettered], permissionOverride: 'no-unletter' });
  await page.route(LINES_API, route => json(route, ok(linesPage([lettered]))));
  await page.route(GROUP_API_PATTERN, route =>
    json(route, ok(groupDto({ lines: [lettered], canUnletter: false, unletterBlockedReason: 'permission' })))
  );

  await openLettering(page, '?account=4111&state=all&autoLoad=1');
  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible({ timeout: 15_000 });

  await page.locator('.lettering-code-badge').first().click();
  const drawer = page.locator('.lettering-group-drawer');
  await expect(drawer).toBeVisible();

  await expect(drawer.getByRole('button', { name: 'Délettrer' })).toHaveCount(0);
  await expect(drawer.getByText('Droit insuffisant pour délettrer ce groupe.')).toBeVisible();
});

test('délettrage : groupe d\'une période clôturée, raison « période clôturée » affichée', async ({ page }) => {
  const lettered = line({ lineId: 'd1', debit: 100, credit: 0, letteringCode: 'L00001', periodLocked: true });
  await installLetteringMocks(page, { lines: [lettered] });
  await page.route(LINES_API, route => json(route, ok(linesPage([lettered]))));
  await page.route(GROUP_API_PATTERN, route =>
    json(route, ok(groupDto({ lines: [lettered], canUnletter: false, unletterBlockedReason: 'period_locked' })))
  );

  await openLettering(page, '?account=4111&state=all&autoLoad=1');
  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible({ timeout: 15_000 });

  await page.locator('.lettering-code-badge').first().click();
  const drawer = page.locator('.lettering-group-drawer');
  await expect(drawer).toBeVisible();

  await expect(drawer.getByRole('button', { name: 'Délettrer' })).toHaveCount(0);
  await expect(drawer.getByText('La période est clôturée : ce groupe ne peut plus être délettré.')).toBeVisible();
});

test('case d\'en-tête : « tout sélectionner » ne coche aucune ligne déjà lettrée', async ({ page }) => {
  const unlettered = line({ lineId: 'd1', debit: 100, credit: 0 });
  const lettered = line({ lineId: 'd2', debit: 50, credit: 0, letteringCode: 'L00099' });
  const credit = line({ lineId: 'c1', debit: 0, credit: 100 });
  await installLetteringMocks(page, { lines: [unlettered, lettered, credit] });
  await page.route(LINES_API, route => json(route, ok(linesPage([unlettered, lettered, credit]))));
  const letterBodies: unknown[] = [];
  await page.route(LETTER_API, route => {
    letterBodies.push(route.request().postDataJSON());
    return json(route, ok({ code: 'L00050', groupId: 'g-50', isPartial: false, lineCount: 2, previousCode: null }));
  });

  await openLettering(page, '?account=4111&state=all&autoLoad=1');
  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible({ timeout: 15_000 });

  await page.locator('.lettering-pane--debit p-tableheadercheckbox input[type="checkbox"]').check();
  await page.locator('.lettering-pane--credit p-tablecheckbox input[type="checkbox"]').first().check();

  await page.getByRole('button', { name: 'Valider le lettrage' }).click();

  await expect(page.getByText(/Lettrage effectué avec succès \(code L00050\)/)).toBeVisible({ timeout: 10_000 });
  const body = letterBodies[0] as { journalEntryLineIds: string[] };
  expect(body.journalEntryLineIds).not.toContain('d2');
  expect(body.journalEntryLineIds.sort()).toEqual(['c1', 'd1']);
});

test('double-clic sur Valider : un seul POST envoyé', async ({ page }) => {
  const debit = line({ lineId: 'd1', debit: 100, credit: 0 });
  const credit = line({ lineId: 'c1', debit: 0, credit: 100 });
  await installLetteringMocks(page, { lines: [debit, credit] });
  await page.route(LINES_API, route => json(route, ok(linesPage([debit, credit]))));
  let letterCalls = 0;
  await page.route(LETTER_API, async route => {
    letterCalls++;
    await new Promise(resolve => setTimeout(resolve, 300));
    return json(route, ok({ code: 'L00060', groupId: 'g-60', isPartial: false, lineCount: 2, previousCode: null }));
  });

  await openLettering(page, '?account=4111&autoLoad=1');
  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible({ timeout: 15_000 });

  await page.locator('.lettering-pane--debit p-tablecheckbox input[type="checkbox"]').first().check();
  await page.locator('.lettering-pane--credit p-tablecheckbox input[type="checkbox"]').first().check();

  const validate = page.getByRole('button', { name: 'Valider le lettrage' });
  await validate.click();
  await validate.click({ force: true }).catch(() => undefined);

  await expect(page.getByText(/Lettrage effectué avec succès/)).toBeVisible({ timeout: 10_000 });
  expect(letterCalls).toBe(1);
});

test('responsive : à 1000px de large, les deux volets sont empilés', async ({ page }) => {
  const debit = line({ lineId: 'd1', debit: 100, credit: 0 });
  const credit = line({ lineId: 'c1', debit: 0, credit: 100 });
  await installLetteringMocks(page, { lines: [debit, credit] });
  await page.route(LINES_API, route => json(route, ok(linesPage([debit, credit]))));

  await page.setViewportSize({ width: 1000, height: 800 });
  await openLettering(page, '?account=4111&autoLoad=1');
  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible({ timeout: 15_000 });

  const debitBox = await page.locator('.lettering-pane--debit').boundingBox();
  const creditBox = await page.locator('.lettering-pane--credit').boundingBox();
  expect(debitBox).toBeTruthy();
  expect(creditBox).toBeTruthy();
  if (debitBox && creditBox) {
    expect(creditBox.y).toBeGreaterThanOrEqual(debitBox.y + debitBox.height - 1);
  }
});

// Note RTL : /accounting/lettering n'est accessible qu'au cabinet en mode délégué
// (company-accounting-nav.guard + firm-native-redirect.guard, cf. installLetteringMocks ci-dessus),
// et ErpLocaleService force le français pour toute session cabinet quel que soit `locale` demandé
// (mustForceFrench() → isAccountingFirm()) : il n'existe donc aucun moyen réaliste de faire s'afficher
// cet écran en arabe/RTL via une vraie navigation de session simulée. Le calcul de la position du
// tiroir (`isRtl() ? 'left' : 'right'`) est couvert directement sur le composant isolé par
// lettering-group-drawer.component.spec.ts (cas LTR et RTL). Ce test-ci vérifie seulement que ce
// calcul atteint bien le DOM réel en français (position par défaut 'right').
test('tiroir : position par défaut (session cabinet, toujours en français) ouverte à droite', async ({ page }) => {
  const lettered = line({ lineId: 'd1', debit: 100, credit: 0, letteringCode: 'L00001' });
  await installLetteringMocks(page, { lines: [lettered] });
  await page.route(LINES_API, route => json(route, ok(linesPage([lettered]))));
  await page.route(GROUP_API_PATTERN, route => json(route, ok(groupDto({ lines: [lettered] }))));

  await openLettering(page, '?account=4111&state=all&autoLoad=1');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr', { timeout: 15_000 });

  await page.locator('.lettering-code-badge').first().click();
  const drawer = page.locator('.lettering-group-drawer');
  await expect(drawer).toBeVisible();
  await expect(page.locator('.p-drawer-right')).toBeVisible();
});

test('compléter depuis le tiroir : les membres du groupe P non chargés restent inclus, seules les nouvelles lignes sont envoyées', async ({ page }) => {
  // Le membre « m1 » est chargé (il ouvre le tiroir) ; le membre « m2 » ne l'est pas (hors filtre).
  const m1 = line({ lineId: 'm1', debit: 100, credit: 0, letteringCode: 'P00002', isPartiallyLettered: true });
  const m2 = line({ lineId: 'm2', debit: 0, credit: 40, letteringCode: 'P00002', isPartiallyLettered: true, entryDate: '2025-12-30' });
  const fresh = line({ lineId: 'n1', debit: 0, credit: 60 });
  await installLetteringMocks(page, { lines: [m1, fresh] });
  await page.route(GROUP_API_PATTERN, route =>
    json(route, ok(groupDto({ code: 'P00002', isPartial: true, amount: 40, canComplete: true, lines: [m1, m2] })))
  );
  const completeBodies: unknown[] = [];
  await page.route('**/api/accounting/lettering/groups/P00002/complete', route => {
    completeBodies.push(route.request().postDataJSON());
    return json(route, ok({ code: 'L00007', groupId: 'g-1', isPartial: false, lineCount: 3, previousCode: 'P00002' }));
  });
  const letterBodies: unknown[] = [];
  await page.route(LETTER_API, route => {
    letterBodies.push(route.request().postDataJSON());
    return json(route, ok({ code: 'L09999', groupId: 'g-x', isPartial: false, lineCount: 2, previousCode: null }));
  });

  await openLettering(page, '?account=4111&state=all&autoLoad=1');
  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible({ timeout: 15_000 });

  await page.locator('.lettering-code-badge').first().click();
  const drawer = page.locator('.lettering-group-drawer');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Compléter ce lettrage' }).click();

  await expect(page.getByTestId('lettering-completion-group')).toContainText('P00002');
  await expect(page.getByTestId('lettering-completion-group')).toContainText('2');

  await page.locator('.lettering-pane--credit p-tablecheckbox input[type="checkbox"]').first().check();

  const validate = page.getByRole('button', { name: /Compléter le lettrage P00002/ });
  await expect(validate).toBeEnabled();
  await validate.click();

  await expect(page.getByText(/Lettrage complété \(code L00007\)/)).toBeVisible({ timeout: 10_000 });
  expect(completeBodies).toEqual([{ journalEntryLineIds: ['n1'], allowPartial: false }]);
  expect(letterBodies).toEqual([]);
});

test('correctifs revue P2 : recherche en lien profond, état d\'équilibre en texte, ligne clôturée non cochable, menu « Ouvrir un groupe »', async ({ page }) => {
  const debit = line({ lineId: 'd1', debit: 100, credit: 0 });
  const credit = line({ lineId: 'c1', debit: 0, credit: 100 });
  const locked = line({ lineId: 'c2', debit: 0, credit: 30, periodLocked: true });
  await installLetteringMocks(page, { lines: [debit, credit, locked], permissionOverride: 'no-unletter' });
  const requests: string[] = [];
  await page.route(LINES_API, route => {
    requests.push(route.request().url());
    return json(route, ok(linesPage([debit, credit, locked])));
  });

  await openLettering(page, '?account=4111&search=FAC-12&autoLoad=1');
  await expect(page.getByRole('heading', { name: 'Débit' })).toBeVisible({ timeout: 15_000 });

  // La recherche du lien profond est envoyée au serveur et reste visible (« Plus de filtres » ouvert).
  expect(new URL(requests[0]).searchParams.get('search')).toBe('FAC-12');
  await expect(page.getByTestId('lettering-filter-search')).toHaveValue('FAC-12');

  // Sélection équilibrée : l'état s'affiche en texte (pas seulement en couleur).
  await page.locator('.lettering-pane--debit p-tablecheckbox input[type="checkbox"]').first().check();
  const creditBoxes = page.locator('.lettering-pane--credit p-tablecheckbox input[type="checkbox"]');
  await creditBoxes.nth(0).check();
  await expect(page.getByTestId('lettering-balance-state')).toHaveText(/Équilibré/);
  await expect(page.getByRole('button', { name: 'Valider le lettrage' })).toBeEnabled();

  // Ligne d'une période clôturée : jamais cochable dans le volet (règle D9) ; le store la bloque
  // aussi (garde-fou `lockedLines`, testé en unitaire) au cas où elle entrerait dans la sélection.
  await expect(creditBoxes.nth(1)).toBeDisabled();
  await creditBoxes.nth(0).uncheck();
  await expect(page.getByTestId('lettering-balance-state')).toHaveText(/Non équilibré/);
  await expect(page.getByRole('button', { name: 'Valider le lettrage' })).toBeDisabled();

  // Menu Actions : « Ouvrir un groupe par code… » est proposé même sans le droit de délettrer.
  await page.getByRole('button', { name: 'Menu des actions' }).click();
  await expect(page.getByText('Ouvrir un groupe par code…')).toBeVisible();
  await expect(page.getByText('Exporter le grand livre (Excel)')).toBeVisible();
  await expect(page.getByText('Délettrer un groupe par code…')).toHaveCount(0);
});
