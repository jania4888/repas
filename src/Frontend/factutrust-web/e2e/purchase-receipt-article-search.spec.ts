import { expect, test } from '@playwright/test';

import { installErpSession } from './helpers/erp-session.mock';

const products = {
  success: true,
  data: {
    items: [
      {
        id: 'p-chair',
        code: 'CH',
        name: 'chaise',
        unitPrice: 80,
        purchasePrice: 45,
        vatRatePercent: 19,
        unit: 'Un',
        isFodecApplicable: false,
        isDiscountEnabled: false,
        maxDiscountPercent: null,
        barcode: null
      },
      {
        id: 'p-table',
        code: 'TAB',
        name: 'table',
        unitPrice: 100,
        purchasePrice: 60,
        vatRatePercent: 19,
        unit: 'Un',
        isFodecApplicable: false,
        isDiscountEnabled: false,
        maxDiscountPercent: null,
        barcode: null
      }
    ],
    page: 1,
    pageSize: 100,
    totalCount: 2,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false
  },
  message: null,
  errors: []
};

/**
 * Le spinner PrimeNG ne s'éteint que si les suggestions changent de référence.
 * On rejoue le chevron, une seconde ligne, puis une recherche serveur en échec.
 * Un HTTP 500 est absorbé par le service partagé : la liste se vide, le spinner s'éteint,
 * et le message technique n'est pas affiché.
 */
test('la recherche d’article du bon de réception ne reste pas bloquée', async ({ page }) => {
  test.setTimeout(90_000);
  await installErpSession(page, { locale: 'fr' });
  await page.route('**/api/products/select**', async route => {
    const url = route.request().url();
    if (url.includes('search=')) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'zzz-secret' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(products)
    });
  });

  await page.goto('/purchase-receipts/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Nouveau bon de réception' })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Ajouter une ligne' }).click();
  const first = page.locator('p-autocomplete').nth(0);
  const open = async (autocomplete: ReturnType<typeof page.locator>) => {
    await autocomplete.locator('button').click();
  };

  await open(first);
  const panel = page.locator('.receipt-product-panel');
  await expect(panel.getByText('chaise', { exact: true })).toBeVisible();
  await expect(first.locator('.p-autocomplete-loader')).toHaveCount(0);

  await open(first);
  await open(first);
  await expect(panel.getByText('chaise', { exact: true })).toBeVisible();
  await expect(first.locator('.p-autocomplete-loader')).toHaveCount(0);

  await panel.getByText('chaise', { exact: true }).click();
  await expect(first.locator('input')).toHaveValue(/chaise/i);
  await expect(page.locator('tbody tr').first().locator('.col-price input')).toHaveValue(/45[,.]000/);
  await expect(first.locator('.p-autocomplete-loader')).toHaveCount(0);

  await page.getByRole('button', { name: 'Ajouter une ligne' }).click();
  const second = page.locator('p-autocomplete').nth(1);
  await open(second);
  await expect(panel.getByText('table', { exact: true })).toBeVisible();
  await expect(second.locator('.p-autocomplete-loader')).toHaveCount(0);

  await second.locator('input').click();
  await second.locator('input').pressSequentially('zzz', { delay: 30 });
  await expect(panel.getByText('Aucun produit trouvé')).toBeVisible({ timeout: 5000 });
  await expect(second.locator('.p-autocomplete-loader')).toHaveCount(0);
  await expect(page.getByText('zzz-secret')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await open(second);
  await expect(panel.getByText('chaise', { exact: true })).toBeVisible();
  await expect(second.locator('.p-autocomplete-loader')).toHaveCount(0);
});
