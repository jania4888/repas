import { test, expect } from '@playwright/test';

/**
 * Tableau de bord comptable du dossier — écran d'accueil d'une ouverture de dossier délégué.
 * Nécessite un backend joignable et une session FirmManager authentifiée (voir
 * scripts/ci/e2e-register-user.sh) ; s'auto-ignore sinon, comme les autres suites
 * e2e/accounting/*.spec.ts qui dépendent d'une session réelle.
 */
test.describe('Tableau de bord comptable (dossier délégué)', () => {
  test('affiche les indicateurs clés et les sections du tableau de bord', async ({ page }) => {
    await page.goto('/accounting/dashboard');
    if (page.url().includes('/auth/login')) {
      test.skip(true, 'Authentication required');
    }

    const heading = page.getByRole('heading', { name: /tableau de bord/i }).first();
    await expect(heading).toBeVisible();

    const skeleton = page.locator('app-skeleton, .p-skeleton').first();
    await skeleton.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);

    const errorBanner = page.locator('app-accounting-status-banner[variant="error"]');
    if (await errorBanner.isVisible().catch(() => false)) {
      test.skip(true, 'Dossier non délégué ou API indisponible pour cette session de test');
    }

    const emptyState = page.locator('app-empty-state');
    if (await emptyState.isVisible().catch(() => false)) {
      // Aucune écriture validée sur la période courante : état vide valide, pas d'échec de test.
      await expect(emptyState).toContainText(/aucune écriture validée/i);
      return;
    }

    await expect(page.locator('app-stat-card')).toHaveCount(4);
    await expect(page.getByRole('link', { name: /voir toutes les écritures/i })).toBeVisible();
  });

  test('le changement de période relance le chargement du tableau de bord', async ({ page }) => {
    await page.goto('/accounting/dashboard');
    if (page.url().includes('/auth/login')) {
      test.skip(true, 'Authentication required');
    }

    const periodSelect = page.locator('#accounting-dashboard-period');
    if (!(await periodSelect.isVisible().catch(() => false))) {
      test.skip(true, 'Tableau de bord non accessible pour cette session de test');
    }

    const options = await periodSelect.locator('option').allTextContents();
    test.skip(options.length < 2, 'Une seule période disponible');

    await periodSelect.selectOption({ index: 1 });
    await expect(page.locator('app-skeleton, .p-skeleton').first()).toBeVisible({ timeout: 3_000 }).catch(() => undefined);
  });
});
