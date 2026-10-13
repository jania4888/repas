import { expect, test, type Page, type Route } from '@playwright/test';
import { installErpSession, settle, ERP_E2E_USER, ERP_PERMISSIONS } from '../helpers/erp-session.mock';

/**
 * Parcours dédié « Relevé bancaire → écritures » (D1, sans rapprochement) : source → mappage
 * CSV/XLSX → contrôle des lignes lues → propositions de contreparties (dont repli 471) →
 * génération atomique des écritures en brouillard. API simulée (aucun backend) : chaque scénario
 * sert les réponses voulues et vérifie ce que l'écran affiche et envoie au serveur.
 */

test.setTimeout(90_000);

const ok = <T,>(data: T) => ({ success: true, data, message: null, errors: [] });
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const IMPORT_API = '**/api/accounting/bank-statement-import';

const BANK_ACCOUNTS = [
  { id: 'bank-1', bankName: 'STB', rib: '10006035123456789012', isActive: true, chartOfAccountNumber: '53210001', currency: 'TND' }
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
  recognizedBanks: ['STB'],
  aiUnavailableReason: null,
  visionUnavailableReason: null,
  tabularEnabled: true,
  tabularExtensions: ['.csv', '.xlsx'],
  maxTabularRows: 5000,
  maxAtomicLines: 500,
  suspenseAccountNumber: '471000'
};

const CHART_OF_ACCOUNTS = [
  { id: 'a-627100', accountNumber: '627100', label: 'Frais bancaires', accountClass: 6, natureType: 0, isSystem: false, isActive: true, level: 3 },
  { id: 'a-471000', accountNumber: '471000', label: "Compte d'attente", accountClass: 4, natureType: 0, isSystem: false, isActive: true, level: 3 },
  { id: 'a-611000', accountNumber: '611000', label: 'Sous-traitance générale', accountClass: 6, natureType: 0, isSystem: false, isActive: true, level: 3 }
];

function tabularMapping(overrides: Record<string, unknown> = {}) {
  return {
    headerRowIndex: 0,
    sheetIndex: null,
    dateFormat: 'dd/MM/yyyy',
    decimalSeparator: ',',
    amountMode: 'debitCredit',
    signConvention: undefined,
    dateColumn: 0,
    valueDateColumn: null,
    labelColumns: [1],
    referenceColumn: null,
    debitColumn: 2,
    creditColumn: 3,
    amountColumn: null,
    balanceColumn: 4,
    ignoredRows: [],
    openingBalance: null,
    closingBalance: null,
    rememberMapping: false,
    encoding: null,
    delimiter: ';',
    ...overrides
  };
}

function tabularPreview(overrides: Record<string, unknown> = {}) {
  return {
    format: 'csv',
    encoding: 'utf-8',
    delimiter: ';',
    headerRowIndex: 0,
    sheetNames: [],
    totalRowCount: 3,
    columns: [
      { index: 0, letter: 'A', header: 'Date', samples: ['02/03/2026'] },
      { index: 1, letter: 'B', header: 'Libellé', samples: ['FRAIS DE TENUE DE COMPTE'] },
      { index: 2, letter: 'C', header: 'Débit', samples: ['10,000'] },
      { index: 3, letter: 'D', header: 'Crédit', samples: [''] },
      { index: 4, letter: 'E', header: 'Solde', samples: ['90,000'] }
    ],
    suggestedMapping: tabularMapping(),
    savedMapping: null,
    savedMappingUpdatedAt: null,
    rows: [
      { rowNumber: 1, cells: ['Date', 'Libellé', 'Débit', 'Crédit', 'Solde'] },
      { rowNumber: 2, cells: ['02/03/2026', 'FRAIS DE TENUE DE COMPTE', '10,000', '', '90,000'] },
      { rowNumber: 3, cells: ['03/03/2026', 'VIREMENT NON IDENTIFIE', '', '15,000', '105,000'] }
    ],
    parsedLines: [
      { rowNumber: 2, transactionDate: '2026-03-02', valueDate: null, label: 'FRAIS DE TENUE DE COMPTE', amount: 10, isDebit: true, error: null },
      { rowNumber: 3, transactionDate: '2026-03-03', valueDate: null, label: 'VIREMENT NON IDENTIFIE', amount: 15, isDebit: false, error: null }
    ],
    issues: [],
    operationRowCount: 2,
    ignoredFooterRows: 0,
    ambiguousDateFormat: false,
    ...overrides
  };
}

function historyPage(items: unknown[] = []) {
  return { items, page: 1, pageSize: 20, totalCount: items.length };
}

function statementLine(overrides: Record<string, unknown> = {}) {
  return {
    index: 0,
    pageNumber: 1,
    transactionDate: '2026-03-02',
    valueDate: null,
    label: 'FRAIS DE TENUE DE COMPTE',
    labelLines: ['FRAIS DE TENUE DE COMPTE'],
    amount: 10,
    isDebit: true,
    source: 'Tabular',
    ...overrides
  };
}

/** Session simulée (étape 2 IA le cas échéant + étape 3 contrôle), modèle partagé document/tabulaire. */
function buildSession(overrides: Record<string, unknown> = {}, lines: unknown[] = [statementLine()], issues: unknown[] = []) {
  const built: Record<string, unknown> = {
    id: 's-1',
    status: 'AwaitingReview',
    progressPercent: 100,
    bankAccountId: 'bank-1',
    journalCode: 'JB',
    fileName: 'releve-mars.csv',
    pageCount: 1,
    extractionMethod: 'none',
    profileId: null,
    aiProviderKind: null,
    errorCode: null,
    statementId: null,
    expiresAt: '2026-10-20T00:00:00',
    extraction: {
      header: {
        rib: '10006035123456789012',
        bankCode: '10',
        currency: 'TND',
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        openingBalance: { value: 100, printedDecimals: 3, signSource: 'Column' },
        closingBalance: { value: 105, printedDecimals: 3, signSource: 'Column' },
        totalDebits: null,
        totalCredits: null,
        totalsLabelled: false
      },
      lines,
      issues,
      profileId: 'tabular',
      pageCount: 1,
      unresolvedPages: [],
      aiPlan: null
    },
    balanceCheck: { sumDebits: 10, sumCredits: 15, computedClosing: 105, difference: 0, isBalanced: true },
    canConfirm: true,
    ...overrides
  };
  const extractionOverride = (overrides.extraction ?? {}) as Record<string, unknown>;
  built.extraction = {
    ...(built.extraction as Record<string, unknown>),
    lines: extractionOverride.lines ?? lines,
    issues: extractionOverride.issues ?? issues
  };
  return built;
}

function proposalLine(overrides: Record<string, unknown> = {}) {
  return {
    lineId: 'line-1',
    transactionDate: '2026-03-02',
    valueDate: null,
    label: 'FRAIS DE TENUE DE COMPTE',
    reference: null,
    amount: 10,
    isDebit: true,
    isReconciled: false,
    status: 'Proposed',
    confidence: 'Probable',
    source: 'DossierRule',
    explanation: null,
    accountNumber: '627100',
    accountLabel: 'Frais bancaires',
    accountStatus: 'found',
    thirdPartyId: null,
    thirdPartyKind: null,
    thirdPartyName: null,
    requiresThirdParty: false,
    vatSplit: null,
    existingEntry: null,
    generatedEntry: null,
    candidateCount: 1,
    diagnostics: [],
    selectedByDefault: true,
    ...overrides
  };
}

function proposalsPayload(lines: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    statementId: 'st-1',
    bankAccountId: 'bank-1',
    bankName: 'STB',
    bankGlAccount: '53210001',
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    openingBalance: 100,
    closingBalance: 105,
    lines,
    unclassifiedDistinctLabels: 0,
    ...overrides
  };
}

function importableAccounts() {
  return BANK_ACCOUNTS.map(a => ({
    id: a.id,
    bankName: a.bankName,
    designation: a.bankName,
    chartOfAccountNumber: a.chartOfAccountNumber,
    currency: a.currency,
    isActive: a.isActive,
    isDefault: true,
    hasBankingIdentity: true,
    ribMasked: `…${a.rib.slice(-4)}`
  }));
}

function firmUser(overrides: Record<string, unknown> = {}) {
  return { ...ERP_E2E_USER, tenantKind: 'accountingFirm', accessMode: 'delegated', preferredLanguage: 'fr', ...overrides };
}

/** Session + API du parcours dédié : comptes, capacités, plan comptable, et une session par id. */
async function installEntriesMocks(
  page: Page,
  sessions: Record<string, () => unknown> = {},
  userOverrides: Record<string, unknown> | null = {}
): Promise<void> {
  await installErpSession(page, { locale: 'fr' });
  // `canDeactivate()` (fichier sélectionné non encore envoyé) ouvre un `window.confirm()` natif,
  // mais pas après un import réussi (isDirty() retombe à faux dès que l'envoi réussit) : aucun
  // scénario de ce fichier ne doit donc déclencher de dialogue natif non géré.
  if (userOverrides !== null) {
    const user = firmUser(userOverrides);
    await page.addInitScript(userJson => localStorage.setItem('ft_user', userJson), JSON.stringify(user));
    await page.route('**/api/auth/me', route => json(route, ok(user)));
  }
  await page.route('**/api/bank-accounts**', route => json(route, ok(BANK_ACCOUNTS)));
  await page.route('**/api/accounting/bank-gl-projections/ensure**', route => json(route, ok({ createdCount: 0, skippedCount: 0 })));
  await page.route('**/api/accounting/importable-bank-accounts**', route => json(route, ok(importableAccounts())));
  await page.route('**/api/accounting/chart-of-accounts**', route => json(route, ok(CHART_OF_ACCOUNTS)));
  await page.route(`${IMPORT_API}/capabilities**`, route => json(route, ok(CAPABILITIES)));
  await page.route(/\/api\/accounting\/bank-statement-import\/statements(\?.*)?$/, route => json(route, ok(historyPage())));
  await page.route(/\/api\/accounting\/bank-statement-import\/sessions\/([^/?]+)(\?.*)?$/, route => {
    const id = decodeURIComponent(route.request().url().match(/sessions\/([^/?]+)/)![1]);
    const current = sessions[id];
    return current
      ? json(route, ok(current()))
      : json(route, { success: false, data: null, message: 'not_found', errors: [] }, 404);
  });
}

async function openEntries(page: Page): Promise<void> {
  await page.goto('/accounting/bank-statement-entries', { waitUntil: 'domcontentloaded' });
  await settle(page);
}

test('1. CSV → mappage → contrôle → contreparties (dont repli 471) → N brouillons générés', async ({ page }) => {
  await installEntriesMocks(page, {
    's-csv-1': () => buildSession({ id: 's-csv-1', fileName: 'releve-mars.csv' })
  });

  await page.route(`${IMPORT_API}/tabular/preview`, route => json(route, ok(tabularPreview())));
  await page.route(`${IMPORT_API}/sessions/tabular`, route =>
    json(route, ok(buildSession({ id: 's-csv-1', fileName: 'releve-mars.csv' })))
  );
  const confirmBodies: unknown[] = [];
  await page.route(`${IMPORT_API}/sessions/s-csv-1/confirm`, route => {
    confirmBodies.push(route.request().postDataJSON());
    return json(route, ok({ statementId: 'st-csv-1', lineCount: 2, alreadyImportedCount: 0 }));
  });
  const lines = [
    proposalLine({ lineId: 'line-1', label: 'FRAIS DE TENUE DE COMPTE', amount: 10, isDebit: true, accountNumber: '627100', accountLabel: 'Frais bancaires', source: 'DossierRule', status: 'Proposed', confidence: 'Probable' }),
    proposalLine({
      lineId: 'line-2',
      label: 'VIREMENT NON IDENTIFIE',
      amount: 15,
      isDebit: false,
      accountNumber: '471000',
      accountLabel: "Compte d'attente",
      accountStatus: 'found',
      source: 'Fallback',
      status: 'ToComplete',
      confidence: 'ToCheck'
    })
  ];
  await page.route(`${IMPORT_API}/statements/st-csv-1/proposals**`, route => json(route, ok(proposalsPayload(lines))));
  let generateBody: Record<string, unknown> | null = null;
  await page.route(`${IMPORT_API}/statements/st-csv-1/generate`, route => {
    generateBody = route.request().postDataJSON();
    return json(
      route,
      ok({
        created: 2,
        skipped: 0,
        failed: 0,
        firstEntryNumber: 101,
        lastEntryNumber: 102,
        entryNumberRangesByYear: [{ fiscalYear: 2026, first: 101, last: 102 }],
        outcomes: [
          { lineId: 'line-1', outcome: 'created', code: null, message: null, journalEntryId: 'je-1', entryNumber: 101 },
          { lineId: 'line-2', outcome: 'created', code: null, message: null, journalEntryId: 'je-2', entryNumber: 102 }
        ],
        atomic: true,
        committed: true
      })
    );
  });

  await openEntries(page);
  await expect(page.getByRole('heading', { name: 'Source du relevé' })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('CSV ou Excel (.xlsx)').check();
  await page.locator('.bse-file-input').setInputFiles({
    name: 'releve-mars.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Date;Libellé;Débit;Crédit;Solde\n02/03/2026;FRAIS DE TENUE DE COMPTE;10,000;;90,000\n03/03/2026;VIREMENT NON IDENTIFIE;;15,000;105,000\n')
  });

  await expect(page.getByTestId('bse-continue-mapping')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('bse-continue-mapping').click();

  await expect(page.getByRole('heading', { name: 'Mappage des colonnes' })).toBeVisible();
  await expect(page.getByTestId('bse-mapping-source-suggested')).toBeVisible();
  await expect(page.getByTestId('bse-submit-tabular')).toBeEnabled();
  await page.getByTestId('bse-submit-tabular').click();

  await expect(page).toHaveURL(/\/session\/s-csv-1$/);
  await expect(page.getByTestId('bse-statement-check')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Soldes cohérents')).toBeVisible();
  await page.getByTestId('bse-confirm-statement').click();

  const confirmModal = page.locator('ngb-modal-window');
  await expect(confirmModal).toBeVisible();
  await confirmModal.getByRole('button', { name: 'Oui' }).click();

  await expect(page).toHaveURL(/\/statement\/st-csv-1(?:\?.*)?$/);
  expect(confirmBodies).toHaveLength(1);
  await expect(page.getByTestId('bse-rows-table')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('bse-row-line-1')).toBeVisible();
  await expect(page.getByTestId('bse-row-line-2')).toBeVisible();

  // La ligne non identifiée est proposée au compte d'attente 471 (repli).
  await page.getByTestId('bse-filter-at471').click();
  await expect(page.getByTestId('bse-row-line-2')).toBeVisible();
  await expect(page.getByTestId('bse-row-line-1')).toHaveCount(0);
  await page.getByTestId('bse-filter-all').click();

  await page.getByTestId('bse-generate').click();
  const generateModal = page.locator('ngb-modal-window');
  await expect(generateModal).toBeVisible();
  await generateModal.getByRole('button', { name: 'Générer' }).click();

  await expect(page.getByTestId('bse-result-success')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('bse-entry-ranges')).toContainText('101');
  await expect(page.getByTestId('bse-entry-ranges')).toContainText('102');
  expect(generateBody).toMatchObject({ atomic: true, assist: true, journalCode: 'JB' });
  expect((generateBody as { items: unknown[] }).items).toHaveLength(2);
});

test("2. Rejet atomique (compte invalide côté serveur) → correction de la ligne → régénération réussie", async ({ page }) => {
  await installEntriesMocks(page, {});

  const lines = [
    proposalLine({ lineId: 'line-a', label: 'ACHAT FOURNITURES', amount: 20, isDebit: true, accountNumber: '627100', accountLabel: 'Frais bancaires', source: 'Catalog', status: 'Proposed', confidence: 'Probable' }),
    proposalLine({ lineId: 'line-b', label: 'ABONNEMENT LOGICIEL', amount: 30, isDebit: true, accountNumber: '611000', accountLabel: 'Sous-traitance générale', source: 'Catalog', status: 'Proposed', confidence: 'Probable' })
  ];
  await page.route(`${IMPORT_API}/statements/st-2/proposals**`, route => json(route, ok(proposalsPayload(lines))));

  let generateCalls = 0;
  await page.route(`${IMPORT_API}/statements/st-2/generate`, route => {
    generateCalls++;
    if (generateCalls === 1) {
      return json(
        route,
        {
          success: false,
          error: null,
          message: null,
          code: 'bank_statement_posting.atomic_rejected',
          data: {
            created: 0,
            skipped: 0,
            failed: 1,
            firstEntryNumber: null,
            lastEntryNumber: null,
            entryNumberRangesByYear: [],
            outcomes: [
              { lineId: 'line-a', outcome: 'failed', code: 'bank_statement_posting.account_invalid', message: null, journalEntryId: null, entryNumber: null },
              { lineId: 'line-b', outcome: 'ready', code: null, message: null, journalEntryId: null, entryNumber: null }
            ],
            atomic: true,
            committed: false
          }
        },
        400
      );
    }
    return json(
      route,
      ok({
        created: 2,
        skipped: 0,
        failed: 0,
        firstEntryNumber: 201,
        lastEntryNumber: 202,
        entryNumberRangesByYear: [{ fiscalYear: 2026, first: 201, last: 202 }],
        outcomes: [
          { lineId: 'line-a', outcome: 'created', code: null, message: null, journalEntryId: 'je-10', entryNumber: 201 },
          { lineId: 'line-b', outcome: 'created', code: null, message: null, journalEntryId: 'je-11', entryNumber: 202 }
        ],
        atomic: true,
        committed: true
      })
    );
  });

  await page.goto('/accounting/bank-statement-entries/statement/st-2', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await expect(page.getByTestId('bse-rows-table')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('bse-generate').click();
  const firstModal = page.locator('ngb-modal-window');
  await expect(firstModal).toBeVisible();
  await firstModal.getByRole('button', { name: 'Générer' }).click();

  await expect(page.getByTestId('bse-result-failed')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('bse-rejected-lines')).toContainText('ACHAT FOURNITURES');
  await expect(page.getByTestId('bse-rejected-lines')).toContainText('Compte absent du plan, désactivé ou égal au compte banque.');

  await page.getByTestId('bse-back-to-grid').click();
  await expect(page.getByTestId('bse-rows-table')).toBeVisible();

  // Corrige le compte de la ligne rejetée puis régénère.
  await page.locator('[data-testid="bse-row-line-a"] .bse-input--account').fill('611000');
  await page.locator('[data-testid="bse-row-line-a"] .bse-input--account').blur();

  await page.getByTestId('bse-generate').click();
  const secondModal = page.locator('ngb-modal-window');
  await expect(secondModal).toBeVisible();
  await secondModal.getByRole('button', { name: 'Générer' }).click();

  await expect(page.getByTestId('bse-result-success')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('bse-entry-ranges')).toContainText('201');
  expect(generateCalls).toBe(2);
});

test("3. Réimport du même fichier → message « déjà importé »", async ({ page }) => {
  await installEntriesMocks(page, {});

  await page.route(`${IMPORT_API}/sessions`, route =>
    json(route, { success: false, error: null, message: null, code: 'bank_statement_import.already_imported', data: null })
  );

  await openEntries(page);
  await expect(page.getByRole('heading', { name: 'Source du relevé' })).toBeVisible({ timeout: 30_000 });

  // Type de fichier par défaut (document) : import PDF/image analysé par l'IA.
  await page.locator('.bse-file-input').setInputFiles({
    name: 'releve-mars.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake content for e2e')
  });

  await expect(page.getByTestId('bse-continue-ai')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('bse-continue-ai').click();

  await expect(page.getByTestId('bse-source-error')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('bse-source-error')).toHaveText('Ce relevé a déjà été importé pour ce compte bancaire.');
  await expect(page).toHaveURL(/\/accounting\/bank-statement-entries$/);
});

test('4. PDF — lecture simulée par l\'IA → contrôle du relevé → propositions', async ({ page }) => {
  const pdfLines = [
    statementLine({ index: 0, label: 'VIREMENT RECU', amount: 40, isDebit: false, source: 'Ai' }),
    statementLine({ index: 1, label: 'PRELEVEMENT ASSURANCE', amount: 12, isDebit: true, source: 'Ai' })
  ];
  await installEntriesMocks(page, {
    's-pdf-1': () =>
      buildSession(
        {
          id: 's-pdf-1',
          fileName: 'releve-mars.pdf',
          extractionMethod: 'ai-vision',
          aiProviderKind: 'local',
          balanceCheck: { sumDebits: 12, sumCredits: 40, computedClosing: 128, difference: 0, isBalanced: true },
          extraction: {
            header: {
              rib: '10006035123456789012',
              bankCode: '10',
              currency: 'TND',
              periodStart: '2026-03-01',
              periodEnd: '2026-03-31',
              openingBalance: { value: 100, printedDecimals: 3, signSource: 'Column' },
              closingBalance: { value: 128, printedDecimals: 3, signSource: 'Column' },
              totalDebits: null,
              totalCredits: null,
              totalsLabelled: false
            },
            profileId: 'generic',
            pageCount: 1,
            unresolvedPages: [],
            aiPlan: { scannedPages: [1], textPages: [], reason: 'scanned', estimatedCalls: 1, estimatedSeconds: 120, engine: 'vision', mode: 'ai_only', fallbackPages: [], pageReadings: [] }
          }
        },
        pdfLines,
        []
      )
  });

  await page.route(`${IMPORT_API}/sessions`, route =>
    json(route, ok(buildSession({ id: 's-pdf-1', fileName: 'releve-mars.pdf', extractionMethod: 'ai-vision', aiProviderKind: 'local' }, pdfLines, [])))
  );
  const confirmBodies: unknown[] = [];
  await page.route(`${IMPORT_API}/sessions/s-pdf-1/confirm`, route => {
    confirmBodies.push(route.request().postDataJSON());
    return json(route, ok({ statementId: 'st-pdf-1', lineCount: 2, alreadyImportedCount: 0 }));
  });
  const lines = [
    proposalLine({ lineId: 'line-pdf-1', label: 'VIREMENT RECU', amount: 40, isDebit: false, accountNumber: '471000', accountLabel: "Compte d'attente", source: 'Fallback', status: 'ToComplete', confidence: 'ToCheck' }),
    proposalLine({ lineId: 'line-pdf-2', label: 'PRELEVEMENT ASSURANCE', amount: 12, isDebit: true, accountNumber: '611000', accountLabel: 'Sous-traitance générale', source: 'Catalog', status: 'Proposed', confidence: 'Probable' })
  ];
  await page.route(`${IMPORT_API}/statements/st-pdf-1/proposals**`, route => json(route, ok(proposalsPayload(lines, { statementId: 'st-pdf-1' }))));

  await openEntries(page);
  await expect(page.getByRole('heading', { name: 'Source du relevé' })).toBeVisible({ timeout: 30_000 });

  await page.locator('.bse-file-input').setInputFiles({
    name: 'releve-mars.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake content for e2e')
  });
  await expect(page.getByTestId('bse-continue-ai')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('bse-continue-ai').click();

  await expect(page).toHaveURL(/\/session\/s-pdf-1$/);
  await expect(page.getByTestId('bse-statement-check')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Soldes cohérents')).toBeVisible();
  await page.getByTestId('bse-confirm-statement').click();

  const modal = page.locator('ngb-modal-window');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Oui' }).click();

  await expect(page).toHaveURL(/\/statement\/st-pdf-1(?:\?.*)?$/);
  expect(confirmBodies).toHaveLength(1);
  await expect(page.getByTestId('bse-rows-table')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('bse-row-line-pdf-1')).toBeVisible();
  await expect(page.getByTestId('bse-row-line-pdf-2')).toBeVisible();
});

test('5a. Société en mode natif : accès au parcours bloqué (hors allowlist comptabilité société)', async ({ page }) => {
  // Utilisateur société par défaut (tenantKind: 'company', accessMode: 'native') : aucune
  // surcharge de ft_user ici, le companyAccountingNavGuard doit bloquer la route.
  await installErpSession(page, { locale: 'fr' });
  await page.route('**/api/accounting/importable-bank-accounts**', route => json(route, ok(importableAccounts())));
  await page.route(`${IMPORT_API}/capabilities**`, route => json(route, ok(CAPABILITIES)));

  await page.goto('/accounting/bank-statement-entries', { waitUntil: 'domcontentloaded' });
  await settle(page);

  await expect(page).toHaveURL(/\/access-denied/);
  await expect(page).toHaveURL(/reason=company-accounting-restricted/);
});

test('5b. Cabinet sans la permission accounting:create : accès au parcours bloqué', async ({ page }) => {
  const restrictedPermissions = ERP_PERMISSIONS.filter(p => p !== 'accounting:create');
  await installEntriesMocks(page, {}, { effectivePermissions: restrictedPermissions });

  await page.goto('/accounting/bank-statement-entries', { waitUntil: 'domcontentloaded' });
  await settle(page);

  await expect(page).toHaveURL(/\/access-denied/);
});
