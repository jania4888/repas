import { expect, test, type Page } from '@playwright/test';
import { installErpSession, settle } from './helpers/erp-session.mock';

test.setTimeout(90_000);

const journalBody = {
  success: true,
  data: {
    from: '2026-10-01',
    to: '2026-10-31',
    currency: 'TND',
    totalCredits: 1000,
    totalDebits: 145,
    balance: 855,
    operationCount: 3,
    groups: [
      { operationType: 1, category: 0, count: 2, total: 1000 },
      { operationType: 1, category: 99, count: 0, total: 0 },
      { operationType: 0, category: 0, count: 1, total: 100 },
      { operationType: 0, category: 14, count: 1, total: 45 }
    ],
    lines: {
      items: [
        {
          id: 'line-1',
          operationType: 'Credit',
          operationTypeDisplay: 'Crédit',
          operationDate: '2026-10-02',
          method: 'Cash',
          methodDisplay: 'Espèces',
          label: 'Vente comptoir',
          category: null,
          categoryDisplay: 'SHOULD_NOT_APPEAR',
          revenueCategory: 'CashSalesReceipt',
          revenueCategoryDisplay: 'SHOULD_NOT_APPEAR',
          document: 'ENC-2026-000001',
          amount: 250,
          currency: 'TND',
          reference: null,
          notes: 'note secrète',
          status: 'Terminee',
          origin: 'Manual',
          sourceType: null,
          sourceId: null,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          sourceSupplierInvoiceId: null,
          sourceSupplierInvoiceNumber: null
        }
      ],
      page: 1,
      pageSize: 50,
      totalCount: 3,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false
    }
  },
  message: null,
  errors: []
};

const balancesBody = {
  success: true,
  data: {
    currency: 'TND',
    primary: [],
    secondary: [],
    primaryTotal: 855,
    secondaryTotal: 0,
    primaryCreditsTotal: 1000,
    primaryDebitsTotal: 145,
    secondaryCreditsTotal: 0,
    secondaryDebitsTotal: 0
  },
  message: null,
  errors: []
};

const operationsBody = {
  success: true,
  data: {
    items: [],
    page: 1,
    pageSize: 20,
    totalCount: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false
  },
  message: null,
  errors: []
};

async function installJournalMocks(page: Page): Promise<void> {
  await page.route(/\/api\/cash-desk\/journal\/pdf/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
    })
  );
  await page.route(/\/api\/cash-desk\/journal\?/, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(journalBody) })
  );
  await page.route('**/api/cash-desk/balances**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(balancesBody) })
  );
  await page.route('**/api/cash-desk/operations**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(operationsBody) })
  );
}

test('le journal suit la Caisse, regroupe les catégories et imprime', async ({ page }) => {
  await installErpSession(page, { locale: 'fr' });
  await installJournalMocks(page);

  await page.goto('/payments/cash-journal', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await expect(page.getByRole('button', { name: 'Imprimer (PDF)' })).toBeEnabled({ timeout: 30_000 });

  await expect(page.getByRole('heading', { name: 'Journal de trésorerie' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Encaissements' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Décaissements' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Encaissement ventes au comptant' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Paiement des loyers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Remise en banque' })).toBeVisible();
  await expect(page.getByText('SHOULD_NOT_APPEAR')).toHaveCount(0);
  await expect(page.getByText('note secrète')).toHaveCount(0);
  await expect(page.getByText('Autres encaissements')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enregistrer une opération' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remise en banque' })).toHaveCount(0);
  await expect(page.getByText('Vente comptoir')).toBeVisible();
  await expect(page.getByText('ENC-2026-000001')).toBeVisible();

  await page.locator('button.rail-parent', { hasText: 'Trésorerie' }).click();
  const labels = await page.locator('a.submenu-link span').allInnerTexts();
  const caisse = labels.findIndex(label => label.trim() === 'Caisse');
  const journal = labels.findIndex(label => label.trim() === 'Journal de trésorerie');
  expect(caisse).toBeGreaterThanOrEqual(0);
  expect(journal).toBe(caisse + 1);

  await page.locator('input[name="from"]').fill('2026-09-01');
  await page.locator('input[name="to"]').fill('2026-09-30');
  const listed = page.waitForRequest(
    request => request.url().includes('/api/cash-desk/journal') && !request.url().includes('/pdf')
  );
  await page.getByRole('button', { name: 'Afficher' }).click();
  const listRequest = await listed;
  expect(listRequest.url()).toContain('from=2026-09-01');
  expect(listRequest.url()).toContain('to=2026-09-30');

  const printed = page.waitForRequest(request => request.url().includes('/api/cash-desk/journal/pdf'));
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Imprimer (PDF)' }).click();
  expect((await printed).url()).toContain('from=2026-09-01');
  await popup;

  await page.goto('/payments/cash-desk', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await expect(page.getByRole('heading', { name: 'Caisse de trésorerie' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Enregistrer une opération' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remise en banque' }).first()).toBeVisible();
});

test('le journal arabe se lit de droite à gauche', async ({ page }) => {
  await installErpSession(page, { locale: 'ar' });
  await installJournalMocks(page);

  await page.goto('/payments/cash-journal', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await expect(page.getByRole('button', { name: /PDF/ })).toBeEnabled({ timeout: 30_000 });

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'يومية الخزينة' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'المقبوضات' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'المدفوعات' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'قبض مبيعات نقدية' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'دفع معينات الكراء' })).toBeVisible();
  await expect(page.getByText('SHOULD_NOT_APPEAR')).toHaveCount(0);

  await page.locator('button.rail-parent', { hasText: 'الخزينة' }).click();
  await expect(page.locator('a.submenu-link span', { hasText: 'يومية الخزينة' })).toBeVisible();
  await expect(page.locator('a.submenu-link span', { hasText: 'الصندوق' })).toBeVisible();
});
