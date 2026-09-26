import { test, expect } from '@playwright/test';

/**
 * Baseline visuelle FR (lot 0) — exécuter avec un compte de démo et
 * UPDATE_SNAPSHOTS=1 pour (re)générer les captures.
 *
 * Les tests sont ignorés par défaut en CI sans credentials E2E_ERP_*.
 */
const hasCreds = Boolean(process.env.E2E_ERP_EMAIL && process.env.E2E_ERP_PASSWORD);

test.describe('ERP — baseline visuelle FR', () => {
  test.skip(!hasCreds, 'Définir E2E_ERP_EMAIL et E2E_ERP_PASSWORD');

  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel(/e-mail|email/i).fill(process.env.E2E_ERP_EMAIL!);
    await page.getByLabel(/mot de passe|password/i).fill(process.env.E2E_ERP_PASSWORD!);
    await page.getByRole('button', { name: /connexion|se connecter/i }).click();
    await page.waitForURL(/\/(dashboard|auth\/select-warehouse)/);
    if (page.url().includes('select-warehouse')) {
      await page.getByRole('button', { name: /continuer/i }).click();
      await page.waitForURL(/\/dashboard/);
    }
  });

  test('dashboard FR inchangé', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page).toHaveScreenshot('dashboard-fr.png', { fullPage: true, maxDiffPixelRatio: 0.02 });
  });

  test('stock FR inchangé', async ({ page }) => {
    await page.goto('/stock');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('stock-fr.png', { fullPage: true, maxDiffPixelRatio: 0.02 });
  });
});
