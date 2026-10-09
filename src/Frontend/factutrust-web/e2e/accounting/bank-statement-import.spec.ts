import { expect, test, type Page, type Route } from '@playwright/test';
import { installErpSession, settle, ERP_E2E_USER } from '../helpers/erp-session.mock';

/**
 * Import de relevés bancaires — lecture IA seule (GLM-OCR), écran « 1 · Contrôle du relevé ».
 * API simulée (aucun backend) : chaque scénario sert une session dans l'état voulu et vérifie ce
 * que l'utilisateur voit et ce que l'écran envoie au serveur.
 */

test.setTimeout(90_000);

const ok = <T,>(data: T) => ({ success: true, data, message: null, errors: [] });
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const BANK_ACCOUNTS = [
  { id: 'bank-1', bankName: 'STB', rib: '10006035123456789012', isActive: true, chartOfAccountNumber: '53210001', currency: 'TND' },
  { id: 'bank-2', bankName: 'BIAT', rib: '08001234567890123456', isActive: true, chartOfAccountNumber: '53220001', currency: 'TND' }
];

const CAPABILITIES = {
  enabled: true,
  aiAvailable: true,
  aiProviderKind: 'local',
  aiEngine: 'vision',
  allDocumentsViaAi: true,
  maxFileBytes: 15 * 1024 * 1024,
  maxPages: 60,
  acceptedExtensions: ['.pdf', '.png', '.jpg'],
  recognizedBanks: ['STB', 'BIAT'],
  aiUnavailableReason: null,
  visionUnavailableReason: null
};

interface Line {
  index: number;
  pageNumber: number;
  transactionDate: string;
  valueDate: string | null;
  label: string;
  labelLines: string[];
  amount: number;
  isDebit: boolean;
  source: 'Ai' | 'Layout' | 'Manual';
}

interface Issue {
  code: string;
  severity: 'Info' | 'Warning' | 'Blocking';
  message: string;
  pageNumber: number | null;
  lineIndex: number | null;
}

function aiLine(index: number, pageNumber: number, amount = 10, label = `OPERATION ${index + 1}`): Line {
  return {
    index,
    pageNumber,
    transactionDate: '2026-03-02',
    valueDate: null,
    label,
    labelLines: [label],
    amount,
    isDebit: true,
    source: 'Ai'
  };
}

function reading(page: number, engine: 'glm-ocr' | 'text-model' | 'failed', lineCount = 3) {
  return { page, engine, model: engine === 'failed' ? null : engine, attempts: 1, durationMs: 90_000, lineCount, failureReason: null };
}

function visionPlan(pageCount: number, overrides: Record<string, unknown> = {}) {
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  return {
    scannedPages: pages,
    textPages: [],
    reason: 'scanned',
    estimatedCalls: pageCount,
    estimatedSeconds: pageCount * 120,
    engine: 'vision',
    mode: 'ai_only',
    fallbackPages: [],
    pageReadings: [],
    ...overrides
  };
}

function session(overrides: Record<string, unknown> = {}, lines: Line[] = [aiLine(0, 1, 10)], issues: Issue[] = []) {
  const built = {
    id: 's-1',
    status: 'AwaitingReview',
    progressPercent: 100,
    bankAccountId: 'bank-1',
    journalCode: 'JB',
    fileName: 'releve-mars.pdf',
    pageCount: 1,
    extractionMethod: 'ai-vision',
    profileId: null,
    aiProviderKind: 'local',
    errorCode: null,
    statementId: null,
    expiresAt: '2026-10-05T00:00:00',
    extraction: {
      header: {
        rib: '10006035123456789012',
        bankCode: '10',
        currency: 'TND',
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        openingBalance: { value: 100, printedDecimals: 3, signSource: 'Column' },
        closingBalance: { value: 90, printedDecimals: 3, signSource: 'Column' },
        totalDebits: null,
        totalCredits: null,
        totalsLabelled: false
      },
      lines,
      issues,
      profileId: 'generic',
      pageCount: 1,
      unresolvedPages: [],
      aiPlan: visionPlan(1, { pageReadings: [reading(1, 'glm-ocr', lines.length)] })
    },
    balanceCheck: { sumDebits: 10, sumCredits: 0, computedClosing: 90, difference: 0, isBalanced: true },
    canConfirm: true,
    ...overrides
  };
  // Les lignes et signalements passés en argument priment, même quand la surcharge
  // reconstruit `extraction` (un spread d'`extraction` par défaut ne doit pas les perdre).
  const extractionOverride = (overrides.extraction ?? {}) as Record<string, unknown>;
  built.extraction = {
    ...built.extraction,
    lines: (extractionOverride.lines ?? lines) as Line[],
    issues: (extractionOverride.issues ?? issues) as Issue[]
  };
  return built;
}

/** Extraction par défaut sans lignes ni signalements : à spreader dans les surcharges pour
 *  que les arguments `lines`/`issues` de `session()` gardent la main. */
function baseExtraction() {
  const e = session().extraction as Record<string, unknown>;
  const { lines: _lines, issues: _issues, ...rest } = e;
  return rest;
}

const IMPORT_API = '**/api/accounting/bank-statement-import';

/** Session simulée + API de l'import : comptes bancaires, capacités et une session par identifiant. */
async function installImportMocks(page: Page, sessions: Record<string, () => unknown>): Promise<void> {
  await installErpSession(page, { locale: 'fr' });
  // L'import de relevés est réservé aux cabinets (company-accounting-nav.guard) et le cabinet
  // n'atteint /accounting/** qu'en mode délégué, dans un dossier client (firm-native-redirect.guard) :
  // la session simulée est un cabinet connecté à un dossier (la dernière écriture de ft_user gagne)
  // et /api/auth/me renvoie le même profil.
  const firmUser = { ...ERP_E2E_USER, tenantKind: 'accountingFirm', accessMode: 'delegated', preferredLanguage: 'fr' };
  await page.addInitScript(userJson => {
    localStorage.setItem('ft_user', userJson);
  }, JSON.stringify(firmUser));
  await page.route('**/api/auth/me', route => json(route, ok(firmUser)));
  await page.route('**/api/bank-accounts**', route => json(route, ok(BANK_ACCOUNTS)));
  await page.route('**/api/accounting/bank-gl-projections/ensure**', route =>
    json(route, ok({ createdCount: 0, skippedCount: 0 })));
  await page.route('**/api/accounting/importable-bank-accounts**', route => json(route, ok(
    BANK_ACCOUNTS.map(a => ({
      id: a.id,
      bankName: a.bankName,
      designation: a.bankName,
      chartOfAccountNumber: a.chartOfAccountNumber,
      currency: a.currency,
      isActive: a.isActive,
      isDefault: a.id === 'bank-1',
      hasBankingIdentity: true,
      ribMasked: `…${a.rib.slice(-4)}`
    }))
  )));
  await page.route(`${IMPORT_API}/capabilities**`, route => json(route, ok(CAPABILITIES)));
  await page.route(/\/api\/accounting\/bank-statement-import\/sessions\/([^/?]+)(\?.*)?$/, route => {
    const id = decodeURIComponent(route.request().url().match(/sessions\/([^/?]+)/)![1]);
    const current = sessions[id];
    return current ? json(route, ok(current())) : json(route, { success: false, data: null, message: 'not_found', errors: [] }, 404);
  });
}

async function openReview(page: Page, sessionId: string): Promise<void> {
  await page.goto(`/accounting/bank-statement-import/session/${sessionId}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
}

test('lecture en cours : page en cours, pastilles de pages et temps écoulé', async ({ page }) => {
  const extracting = session({
    id: 's-run',
    status: 'Extracting',
    progressPercent: 50,
    pageCount: 4,
    extractionMethod: null,
    extraction: {
      ...baseExtraction(),
      lines: [],
      pageCount: 4,
      aiPlan: visionPlan(4, { pageReadings: [reading(1, 'glm-ocr'), reading(2, 'text-model', 2)] })
    },
    balanceCheck: null,
    canConfirm: false
  });
  await installImportMocks(page, { 's-run': () => extracting });

  await openReview(page, 's-run');

  await expect(page.getByText(/Lecture des pages par l'IA… page 3 sur 4 — 50 %/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await expect(page.locator('.bsr-progress__pct')).toHaveText('50 %');
  const fill = page.locator('.bsr-bar__fill');
  await expect(fill).toHaveAttribute('style', /width:\s*50%/);
  await expect(fill).toHaveCSS('width', /.+/);
  const fillWidth = await fill.evaluate(node => node.getBoundingClientRect().width);
  const barWidth = await page.locator('.bsr-bar').evaluate(node => node.getBoundingClientRect().width);
  expect(fillWidth).toBeGreaterThan(0);
  expect(fillWidth / barWidth).toBeGreaterThan(0.45);
  expect(fillWidth / barWidth).toBeLessThan(0.55);
  await expect(page.getByText('Temps restant estimé : environ 4 min', { exact: false })).toBeVisible();

  const chips = page.locator('.bsr-pages .bsr-page');
  await expect(chips).toHaveCount(4);
  await expect(chips.nth(0)).toHaveClass(/is-done/);
  await expect(chips.nth(1)).toHaveClass(/is-fallback/);
  await expect(chips.nth(2)).toHaveClass(/is-current/);
  await expect(chips.nth(2)).toHaveText(/Page 3 · en cours/);
  await expect(page.getByText('Pages 2 : lues en secours, sans l\'image de la page.')).toBeVisible();
  await expect(page.getByText(/\d+ s écoulées/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer le relevé et passer aux propositions' })).toHaveCount(0);
});

test('lecture terminée : méthode GLM-OCR, pages relues par le modèle texte et opérations marquées', async ({ page }) => {
  const lines = [aiLine(0, 1, 10), aiLine(1, 2, 20, 'VIREMENT FOURNISSEUR'), aiLine(2, 3, 30)];
  const done = session(
    {
      id: 's-done',
      pageCount: 3,
      extraction: {
        ...baseExtraction(),
        lines,
        pageCount: 3,
        aiPlan: visionPlan(3, { fallbackPages: [2], pageReadings: [reading(1, 'glm-ocr'), reading(2, 'text-model'), reading(3, 'glm-ocr')] })
      },
      balanceCheck: { sumDebits: 60, sumCredits: 0, computedClosing: 40, difference: 0, isBalanced: true }
    },
    lines,
    [{ code: 'statement.ai_text_fallback', severity: 'Warning', message: 'Lecture de secours sur cette page.', pageNumber: 2, lineIndex: null }]
  );
  await installImportMocks(page, { 's-done': () => done });

  await openReview(page, 's-done');

  await expect(page.getByRole('heading', { name: '1 · Contrôle du relevé' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Lu par GLM-OCR — page 2 relue par le modèle texte')).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: 'GLM-OCR n\'a pas pu lire la page 2' })).toBeVisible();
  await expect(page.locator('.bsr-issue', { hasText: 'Page relue par le modèle texte' })).toContainText('Page 2 ·');

  const fallbackRow = page.locator('tr', { hasText: 'VIREMENT FOURNISSEUR' });
  await expect(fallbackRow.locator('.bsr-badge--fallback')).toHaveText('modèle texte');
  await expect(page.locator('.bsr-badge--fallback')).toHaveCount(1);
  await expect(page.getByText('Soldes contrôlés : le relevé est complet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer le relevé et passer aux propositions' })).toBeEnabled();
});

test('écart de solde : accusé explicite puis confirmation envoyée avec acknowledgeBalanceWarning', async ({ page }) => {
  const warning = session(
    {
      id: 's-warn',
      requiresBalanceAcknowledgement: true,
      balanceCheck: { sumDebits: 12.5, sumCredits: 0, computedClosing: 87.5, difference: 2.5, isBalanced: false }
    },
    [aiLine(0, 1, 12.5)],
    [{ code: 'statement.balance_mismatch', severity: 'Warning', message: 'Écart de solde', pageNumber: null, lineIndex: null }]
  );
  await installImportMocks(page, { 's-warn': () => warning });
  const confirmBodies: unknown[] = [];
  await page.route(`${IMPORT_API}/sessions/s-warn/confirm`, route => {
    confirmBodies.push(route.request().postDataJSON());
    return json(route, ok({ statementId: 'st-1', lineCount: 1, alreadyImportedCount: 0 }));
  });
  await page.route(`${IMPORT_API}/statements/st-1/proposals`, route =>
    json(
      route,
      ok({
        statementId: 'st-1',
        bankAccountId: 'bank-1',
        bankName: 'STB',
        bankGlAccount: '53210001',
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        openingBalance: 100,
        closingBalance: 87.5,
        lines: [],
        unclassifiedDistinctLabels: 0
      })
    )
  );

  await openReview(page, 's-warn');

  const alert = page.getByRole('alert').filter({ hasText: 'Écart de solde de' });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText('2,500 TND');
  await expect(alert).toContainText('lus par l\'IA');
  const save = page.getByRole('button', { name: 'Enregistrer le relevé malgré l\'écart de solde' });
  await expect(save).toBeDisabled();

  await page.getByLabel('J\'ai vérifié les opérations ci-dessous et je souhaite enregistrer ce relevé malgré l\'écart de solde.').check();
  await expect(save).toBeEnabled();
  await save.click();

  const modal = page.locator('ngb-modal-window');
  await expect(modal).toContainText('Enregistrer malgré l\'écart de solde ?');
  await expect(modal).toContainText('Écart de 2,500 TND');
  await modal.getByRole('button', { name: 'Enregistrer malgré l\'écart' }).click();

  await expect(page).toHaveURL(/\/accounting\/bank-statement-import\/statement\/st-1/, { timeout: 15_000 });
  expect(confirmBodies).toEqual([{ corrections: [], acknowledgeBalanceWarning: true }]);
});

test('IA indisponible avant toute lecture : explication, relance et nouvelle session', async ({ page }) => {
  const unavailable = session(
    {
      id: 's-ia',
      pageCount: 5,
      extractionMethod: 'none',
      canConfirm: false,
      balanceCheck: null,
      extraction: {
        ...baseExtraction(),
        header: { ...session().extraction.header, rib: null },
        lines: [],
        pageCount: 5,
        aiPlan: visionPlan(5, { estimatedSeconds: 900 })
      }
    },
    [],
    [{ code: 'statement.ai_unavailable', severity: 'Blocking', message: 'GLM-OCR indisponible', pageNumber: null, lineIndex: null }]
  );
  const restarted = session({
    id: 's-9',
    status: 'Extracting',
    progressPercent: 0,
    pageCount: 5,
    extractionMethod: null,
    canConfirm: false,
    balanceCheck: null,
    extraction: { ...baseExtraction(), lines: [], pageCount: 5, aiPlan: visionPlan(5) }
  });
  await installImportMocks(page, { 's-ia': () => unavailable, 's-9': () => restarted });
  let retries = 0;
  await page.route(`${IMPORT_API}/sessions/s-ia/retry`, route => {
    retries++;
    return json(route, ok(restarted));
  });

  await openReview(page, 's-ia');

  await expect(page.getByText('Lecture IA non effectuée')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Lecture IA indisponible')).toBeVisible();
  await expect(page.getByText('non lu', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'la relance reprend le fichier complet (5 pages, environ 15 min)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer le relevé et passer aux propositions' })).toBeDisabled();

  await page.getByRole('button', { name: 'Relancer l\'analyse du relevé' }).click();

  await expect(page).toHaveURL(/\/accounting\/bank-statement-import\/session\/s-9/, { timeout: 15_000 });
  expect(retries).toBe(1);
  await expect(page.getByText('Lecture des pages par GLM-OCR… page 1 sur 5 — 0 %')).toBeVisible();
});

test('RIB d\'un autre compte : relance complète par GLM-OCR expliquée, ou compte à créer', async ({ page }) => {
  const otherKnown = session(
    {
      id: 's-rib',
      pageCount: 5,
      canConfirm: false,
      extraction: {
        ...baseExtraction(),
        header: { ...session().extraction.header, rib: '08001234567890123456' },
        pageCount: 5,
        aiPlan: visionPlan(5, { estimatedSeconds: 600, pageReadings: [1, 2, 3, 4, 5].map(p => reading(p, 'glm-ocr')) })
      }
    },
    [aiLine(0, 1, 10)],
    [{ code: 'statement.rib_mismatch', severity: 'Blocking', message: 'Relevé d\'un autre compte', pageNumber: null, lineIndex: null }]
  );
  const unknown = session(
    {
      id: 's-rib-unknown',
      canConfirm: false,
      extraction: { ...baseExtraction(), header: { ...session().extraction.header, rib: '12345678901234563456' } }
    },
    [aiLine(0, 1, 10)],
    [{ code: 'statement.rib_mismatch', severity: 'Blocking', message: 'Relevé d\'un autre compte', pageNumber: null, lineIndex: null }]
  );
  await installImportMocks(page, { 's-rib': () => otherKnown, 's-rib-unknown': () => unknown });

  await openReview(page, 's-rib');

  await expect(page.getByText('Ce relevé appartient au compte BIAT (…3456).')).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("Analyser avec ce compte relance la lecture complète du fichier par l'IA (5 pages, environ 10 min).", { exact: false })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyser avec ce compte bancaire' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Enregistrer le relevé et passer aux propositions' })).toBeDisabled();

  await openReview(page, 's-rib-unknown');

  await expect(page.getByText('Ce relevé appartient à un autre compte (RIB …3456) qui n\'existe pas dans ce dossier.', { exact: false })).toBeVisible({
    timeout: 30_000
  });
  await expect(page.getByText('Paiements › Comptes bancaires', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyser avec ce compte bancaire' })).toHaveCount(0);
});

test('session en échec : motif IA expliqué et relance proposée seulement pour un motif IA', async ({ page }) => {
  const timedOut = session({
    id: 's-timeout',
    status: 'Failed',
    errorCode: 'ai_timeout',
    progressPercent: 40,
    canConfirm: false,
    balanceCheck: null,
    extraction: null
  });
  const otherFailure = session({ id: 's-ko', status: 'Failed', errorCode: 'file_corrupted', canConfirm: false, balanceCheck: null, extraction: null });
  await installImportMocks(page, { 's-timeout': () => timedOut, 's-ko': () => otherFailure });

  await openReview(page, 's-timeout');

  await expect(page.getByText('La lecture a dépassé le temps alloué. Réessayez avec un relevé plus court ou plus tard.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Relancer l\'analyse du relevé' })).toBeVisible();

  await openReview(page, 's-ko');

  await expect(page.getByText('L\'analyse de ce relevé n\'a pas abouti.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('La lecture a dépassé le temps alloué', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Relancer l\'analyse du relevé' })).toHaveCount(0);
});


test('session héritée (avant GLM-OCR) : aucun champ nouveau, rendu et confirmation sans erreur', async ({ page }) => {
  // Non-régression : une session créée par l'ancien assistant (extractionMethod 'ai', sans
  // pageReadings/mode/requiresBalanceAcknowledgement) doit s'afficher et se confirmer normalement.
  const legacyRaw = session({ id: 's-legacy', extractionMethod: 'ai' }) as Record<string, unknown>;
  delete legacyRaw.requiresBalanceAcknowledgement;
  const legacyExtraction = legacyRaw.extraction as Record<string, unknown>;
  const legacyPlan = { ...(legacyExtraction.aiPlan as Record<string, unknown>) };
  delete legacyPlan.mode;
  delete legacyPlan.pageReadings;
  delete legacyPlan.fallbackPages;
  legacyExtraction.aiPlan = legacyPlan;

  const consoleErrors: string[] = [];
  page.on('pageerror', e => consoleErrors.push(String(e)));
  await installImportMocks(page, { 's-legacy': () => legacyRaw });
  let confirms = 0;
  await page.route(`${IMPORT_API}/sessions/s-legacy/confirm`, route => {
    confirms++;
    return json(route, ok({ statementId: 'st-9', lineCount: 1, alreadyImportedCount: 0 }));
  });
  await page.route(`${IMPORT_API}/statements/st-9/proposals`, route =>
    json(route, ok({
      statementId: 'st-9', bankAccountId: 'bank-1', bankName: 'STB', bankGlAccount: '53210001',
      periodStart: '2026-03-01', periodEnd: '2026-03-31', openingBalance: 100, closingBalance: 90,
      lines: [], unclassifiedDistinctLabels: 0
    })));

  await openReview(page, 's-legacy');

  await expect(page.getByText('Lu par l\'IA locale', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Page relue par le modèle texte', { exact: false })).toHaveCount(0);
  await expect(page.getByText('écart de solde', { exact: false })).toHaveCount(0);

  await page.getByRole('button', { name: 'Enregistrer le relevé et passer aux propositions' }).click();
  await expect(page).toHaveURL(/\/accounting\/bank-statement-import\/statement\/st-9/, { timeout: 15_000 });
  expect(confirms).toBe(1);
  expect(consoleErrors).toEqual([]);
});
