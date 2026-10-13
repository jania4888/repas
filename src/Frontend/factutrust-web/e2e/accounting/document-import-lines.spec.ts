import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { installErpSession, settle, ERP_E2E_USER } from '../helpers/erp-session.mock';

/**
 * Saisie des écritures > Importer une facture : lignes d'écriture proposées sous la relecture,
 * modifiables avant « Appliquer ». API simulée (aucun backend) : la proposition, le plan comptable
 * et les annuaires sont servis par des routes Playwright.
 *
 * La saisie manuelle est réservée aux cabinets en mode délégué (company-accounting-nav.guard) et
 * toute session cabinet est forcée en français (ErpLocaleService) : pas de scénario RTL ici.
 */

test.setTimeout(120_000);

const ok = <T,>(data: T) => ({ success: true, data, message: null, errors: [] });
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const PDF = {
  name: 'facture-achat.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
};

function account(id: string, accountNumber: string, label: string, accountClass: number) {
  return { id, accountNumber, label, accountClass, isActive: true, isSystem: false, natureType: 0, level: 1 };
}

const CHART = [
  account('a-607', '607', 'Achats de marchandises', 6),
  account('a-6061', '6061', 'Fournitures non stockables', 6),
  account('a-43666', '43666', 'TVA déductible', 4),
  account('a-401', '401', 'Fournisseurs', 4),
  account('a-4011', '4011', 'Fournisseurs d\'exploitation', 4)
];

const SUPPLIERS = [{ id: 'sup-beta', name: 'Beta Distribution SARL', isActive: true }];

type Diagnostic = { severity: 'info' | 'warning' | 'blocking'; code: string; message: string; relatedLineIndex: number | null };

function proposal(diagnostics: Diagnostic[] = []) {
  const line = (accountNumber: string, accountLabel: string, role: string, label: string, debit: number, credit: number, extra: Record<string, unknown> = {}) => ({
    accountNumber, accountLabel, accountStatus: 'found', role, label, debit, credit,
    vatRatePercent: null, thirdPartyId: null, thirdPartyKind: null, ...extra
  });
  return {
    direction: 'PURCHASE',
    directionReason: null,
    journalCode: 'JA',
    entryDate: '2026-10-01',
    label: 'Facture ACME FA-2026-001',
    pieceRef: 'FA-2026-001',
    pieceDate: '2026-10-01',
    thirdParty: {
      kind: 2, matchedId: 'sup-acme', matchedName: 'ACME SARL', matchedBy: 'nif', collectiveAccountNumber: '401',
      name: 'ACME SARL', nif: '1234567A', email: null, phone: null, street: null, city: null, postalCode: null, governorate: null
    },
    lines: [
      line('607', 'Achats de marchandises', 'expense', 'Achats HT', 1000, 0),
      line('43666', 'TVA déductible', 'vat', 'TVA 19 %', 190, 0, { vatRatePercent: 19 }),
      line('401', 'Fournisseurs', 'thirdparty', 'ACME SARL', 0, 1190, { thirdPartyId: 'sup-acme', thirdPartyKind: 2 })
    ],
    totalDebit: 1190,
    totalCredit: 1190,
    documentTotalTtc: 1190,
    extraction: {
      documentType: 'INVOICE', documentNumber: 'FA-2026-001', issueDate: '2026-10-01', dueDate: null, documentStatus: null,
      currency: 'TND', seller: null, buyer: null, lines: [], vatBreakdown: [], totalHt: 1000, totalVat: 190,
      fodecAmount: null, fiscalStampAmount: null, withholdingAmount: null, totalTtc: 1190, confidence: 'high',
      warnings: [], extractionMethod: 'native-pdf', ocrApplied: false, vatBreakdownRecomputed: false
    },
    diagnostics,
    hasBlockingDiagnostic: diagnostics.some(d => d.severity === 'blocking')
  };
}

async function installMocks(page: Page, served: () => unknown = () => proposal()): Promise<void> {
  await installErpSession(page, { locale: 'fr' });
  const firmUser = { ...ERP_E2E_USER, tenantKind: 'accountingFirm', accessMode: 'delegated', preferredLanguage: 'fr' };
  await page.addInitScript(userJson => {
    localStorage.setItem('ft_user', userJson);
  }, JSON.stringify(firmUser));
  await page.route('**/api/auth/me', route => json(route, ok(firmUser)));
  await page.route('**/api/accounting/chart-of-accounts**', route => json(route, ok(CHART)));
  await page.route('**/api/accounting/journal-templates**', route => json(route, ok([])));
  await page.route('**/api/accounting/periods**', route => json(route, ok([])));
  await page.route('**/api/accounting/journals**', route => json(route, ok([{ code: 'JA', label: 'Achats' }])));
  await page.route('**/api/accounting/currencies**', route => json(route, ok([])));
  await page.route('**/api/tax/vat-rates**', route => json(route, ok([{ id: 'v19', percent: 19, label: '19 %' }])));
  await page.route('**/api/bank-accounts**', route => json(route, ok([])));
  await page.route('**/api/suppliers**', route =>
    json(route, ok({ items: SUPPLIERS, page: 1, pageSize: 10, totalCount: SUPPLIERS.length, totalPages: 1, hasNextPage: false, hasPreviousPage: false })));
  await page.route('**/api/accounting/document-import/capabilities**', route =>
    json(route, {
      enabled: true, documentExtractionProvider: null, nativeParserEnabled: true, aiFallbackAvailable: false,
      ocrAvailable: false, importModel: null, visionModel: null, visionModelReady: false
    }));
  await page.route('**/api/accounting/document-import/propose**', route => json(route, ok(served())));
}

async function openReview(page: Page): Promise<Locator> {
  await page.goto('/accounting/manual-entry', { waitUntil: 'domcontentloaded' });
  await settle(page);
  // Le menu peut être cliqué avant la fin de l'amorçage : on rouvre jusqu'à voir l'entrée.
  const importItem = page.getByRole('button', { name: /Importer une facture/i });
  await expect(async () => {
    if (!(await importItem.isVisible())) await page.getByRole('button', { name: /^Import$/i }).click();
    await expect(importItem).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await importItem.click();
  const dialog = page.getByRole('dialog', { name: /Importer une facture/i });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles(PDF);
  await dialog.getByRole('button', { name: /Analyser la facture/i }).click();
  await expect(linesRegion(dialog)).toBeVisible({ timeout: 30_000 });
  return dialog;
}

const linesRegion = (dialog: Locator) => dialog.getByRole('region', { name: 'Lignes d\'écriture proposées' });
const rows = (dialog: Locator) => linesRegion(dialog).locator('tbody tr').filter({ has: dialog.page().locator('input[placeholder="N° compte"]') });
const accountInputs = (dialog: Locator) => linesRegion(dialog).locator('input[placeholder="N° compte"]');
const applyButton = (dialog: Locator) => dialog.getByRole('button', { name: /^Appliquer/ });

async function accountValues(dialog: Locator): Promise<string[]> {
  return accountInputs(dialog).evaluateAll(nodes => nodes.map(n => (n as HTMLInputElement).value));
}

/** Confirmation (ConfirmDialog PrimeNG) reconnue par son titre de niveau 5. */
function confirmDialog(page: Page, header: string): Locator {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { level: 5, name: header }) });
}

test('les lignes proposées sont visibles sous la relecture (1600×900)', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await installMocks(page);
  const dialog = await openReview(page);

  const region = linesRegion(dialog);
  await region.scrollIntoViewIfNeeded();
  const box = await region.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(300);
  await expect(rows(dialog)).toHaveCount(3);
  expect(await accountValues(dialog)).toEqual(['607', '43666', '401']);
  await expect(region.locator('.adi-lines__summary')).toContainText('Lignes : 3');
  await expect(region.locator('.adi-lines__summary')).toContainText('Contrôles bloquants : 0');
  await expect(region).toContainText('Écriture équilibrée');
  await expect(region).not.toContainText('vous pouvez enregistrer');
  await expect(applyButton(dialog)).toBeEnabled();
  await page.screenshot({ path: 'e2e/test-results/document-import-lines-1600.png' });
});

test('édition complète, puis application d\'une écriture déséquilibrée après confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await installMocks(page);
  const dialog = await openReview(page);
  const region = linesRegion(dialog);

  // Libellé de ligne : la frappe garde le focus (pas de recréation de la ligne).
  const firstLabel = region.locator('input[placeholder="Libellé"]').first();
  await firstLabel.fill('');
  await firstLabel.pressSequentially('Marchandises');
  await expect(firstLabel).toBeFocused();
  await expect(firstLabel).toHaveValue('Marchandises');

  // Ajout d'une ligne 6061 D 10 : le bandeau signale l'écart.
  await region.getByRole('button', { name: '+ Ajouter une ligne' }).click();
  await expect(rows(dialog)).toHaveCount(4);
  await accountInputs(dialog).nth(3).fill('6061');
  // Échap ferme la liste de suggestions ouverte, sans demander la fermeture de la modale.
  const suggestions = page.locator('.me-autocomplete-panel').filter({ hasText: '6061' });
  await expect(suggestions).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(suggestions).toBeHidden();
  await expect(confirmDialog(page, 'Confirmation')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  const newDebit = region.locator('[data-row="3"][data-field="debit"] input');
  await newDebit.fill('10');
  // Clic hors du montant (Tab sur la dernière ligne ajoute une ligne, comme dans la grille principale).
  await rows(dialog).nth(3).locator('input[placeholder="Libellé"]').click();
  const banner = region.locator('[data-banner="unbalanced"]');
  await expect(banner).toContainText('écart 10,000 TND');

  // Dupliquer puis supprimer la copie.
  await rows(dialog).nth(3).getByTitle('Dupliquer').click();
  await expect(rows(dialog)).toHaveCount(5);
  await rows(dialog).nth(4).locator('.btn-outline-danger').click();
  await expect(rows(dialog)).toHaveCount(4);

  // Tiers choisi par autocomplétion sur la ligne fournisseur.
  const tiers = rows(dialog).nth(2).locator('input[placeholder="Tiers"]');
  await tiers.fill('');
  await tiers.pressSequentially('Beta');
  await page.locator('.me-autocomplete-panel').getByText('Beta Distribution SARL').click();

  await applyButton(dialog).click();
  const confirm = confirmDialog(page, 'Écriture non équilibrée');
  await expect(confirm).toContainText('Écriture non équilibrée');
  await confirm.getByRole('button', { name: 'Appliquer quand même' }).click();
  await expect(dialog).toBeHidden();

  const main = page.locator('.entry-lines-table');
  const mainAccounts = await main.locator('input[placeholder="N° compte"]').evaluateAll(nodes => nodes.map(n => (n as HTMLInputElement).value));
  expect(mainAccounts).toEqual(['607', '43666', '401', '6061']);
  const mainTiers = await main.locator('input[placeholder="Tiers"]').nth(2).inputValue();
  expect(mainTiers).toContain('Beta Distribution SARL');
  expect(mainTiers).not.toBe('2');
  await expect(main.locator('input[placeholder="Libellé"]').first()).toHaveValue('Marchandises');
});

test('contrôle bloquant du serveur : Appliquer désactivé et bandeau', async ({ page }) => {
  await installMocks(page, () => proposal([
    { severity: 'blocking', code: 'AlreadyPosted', message: 'Cette pièce est déjà comptabilisée.', relatedLineIndex: null }
  ]));
  const dialog = await openReview(page);
  const region = linesRegion(dialog);

  await expect(region.locator('[data-banner="blocking"]')).toContainText('Contrôles bloquants à corriger : 1');
  await expect(applyButton(dialog)).toBeDisabled();
  await region.getByRole('button', { name: 'Voir les contrôles' }).click();
  await expect(dialog.locator('.adi-diagnostics-card')).toBeFocused();
});

test('valider le débit de la ligne de TVA ne crée pas de seconde ligne de TVA', async ({ page }) => {
  await installMocks(page);
  const dialog = await openReview(page);
  const vatDebit = linesRegion(dialog).locator('[data-row="1"][data-field="debit"] input');
  await vatDebit.click();
  await vatDebit.press('Tab');
  await expect(rows(dialog)).toHaveCount(3);
  expect(await accountValues(dialog)).toEqual(['607', '43666', '401']);
});

test('fermeture protégée : Échap après une modification demande confirmation', async ({ page }) => {
  await installMocks(page);
  const dialog = await openReview(page);
  const label = linesRegion(dialog).locator('input[placeholder="Libellé"]').first();
  await label.fill('Libellé modifié');
  await page.locator('body').click({ position: { x: 2, y: 2 }, force: true }).catch(() => undefined);
  await label.focus();
  await page.keyboard.press('Escape');

  const confirm = confirmDialog(page, 'Confirmation');
  await expect(confirm).toContainText('Vos modifications sur l\'écriture proposée seront perdues');
  await confirm.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toBeVisible();
  await expect(label).toHaveValue('Libellé modifié');
});

test('960 px : une colonne, lignes visibles, pas de débordement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 800 });
  await installMocks(page);
  const dialog = await openReview(page);
  const region = linesRegion(dialog);
  await region.scrollIntoViewIfNeeded();
  await expect(region).toBeInViewport();

  const overflow = await dialog.locator('.p-dialog-content').evaluate(el => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const regionBox = await region.boundingBox();
  const reviewBox = await dialog.locator('.adi-review').boundingBox();
  expect(regionBox && reviewBox ? regionBox.y >= reviewBox.y + reviewBox.height - 1 : false).toBe(true);
  await page.screenshot({ path: 'e2e/test-results/document-import-lines-960.png' });
});
