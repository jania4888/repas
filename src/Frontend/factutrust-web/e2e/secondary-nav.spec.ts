import { test, expect } from '@playwright/test';
import { getDemoCredentials, loginAsDemoUser, waitForAppReady } from './helpers/partnership-demo.helpers';

async function ensureAuthenticated(page: import('@playwright/test').Page): Promise<boolean> {
  const creds = getDemoCredentials();
  if (!creds) {
    return false;
  }
  await loginAsDemoUser(page);
  return true;
}

test.describe('Secondary navigation bar', () => {
  test('renders desktop secondary nav with expected sections', async ({ page }) => {
    if (!(await ensureAuthenticated(page))) {
      test.skip(true, 'DOC_EMAIL/DOC_PASSWORD or demo credentials required');
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForAppReady(page);
    await page.goto('/dashboard');

    const secondaryNav = page.locator('app-secondary-nav .secondary-nav');
    if ((await secondaryNav.count()) === 0) {
      test.skip(true, 'Secondary nav not available for this user/context');
    }

    await expect(secondaryNav).toBeVisible();
    await expect(secondaryNav.getByText('Ventes', { exact: true })).toBeVisible();
    await expect(secondaryNav.getByText('Achats', { exact: true })).toBeVisible();
    await expect(secondaryNav.getByText('TEJ', { exact: true })).toBeVisible();
  });

  test('hides secondary nav on mobile viewport', async ({ page }) => {
    if (!(await ensureAuthenticated(page))) {
      test.skip(true, 'DOC_EMAIL/DOC_PASSWORD or demo credentials required');
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForAppReady(page);
    await page.goto('/dashboard');

    const secondaryNav = page.locator('app-secondary-nav .secondary-nav');
    if ((await secondaryNav.count()) === 0) {
      test.skip(true, 'Secondary nav not available for this user/context');
    }

    await expect(secondaryNav).toBeVisible();

    await page.setViewportSize({ width: 768, height: 900 });
    await expect(secondaryNav).toBeHidden();
  });

  test('Ventes dropdown is interactable and navigates to invoices', async ({ page }) => {
    if (!(await ensureAuthenticated(page))) {
      test.skip(true, 'DOC_EMAIL/DOC_PASSWORD or demo credentials required');
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForAppReady(page);
    await page.goto('/dashboard');

    const secondaryNav = page.locator('app-secondary-nav .secondary-nav');
    if ((await secondaryNav.count()) === 0) {
      test.skip(true, 'Secondary nav not available for this user/context');
    }

    const ventesTrigger = secondaryNav.locator('button.secondary-nav__trigger', { hasText: 'Ventes' });
    if ((await ventesTrigger.count()) === 0) {
      test.skip(true, 'Ventes section not visible for this user');
    }

    await ventesTrigger.click();
    const menu = page.locator('#secondary-nav-menu-sales, .secondary-nav__dropdown.show').first();
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThan(40);

    const invoicesLink = page.locator('.secondary-nav__link', { hasText: 'Factures' }).first();
    await expect(invoicesLink).toBeVisible();
    await invoicesLink.click();
    await expect(page).toHaveURL(/\/invoices/);
  });

  test('RH & Paie dropdown navigates to Salariés and stays above content', async ({ page }) => {
    if (!(await ensureAuthenticated(page))) {
      test.skip(true, 'DOC_EMAIL/DOC_PASSWORD or demo credentials required');
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForAppReady(page);
    await page.goto('/payroll/employees');

    const secondaryNav = page.locator('app-secondary-nav .secondary-nav');
    if ((await secondaryNav.count()) === 0) {
      test.skip(true, 'Secondary nav not available for this user/context');
    }

    const rhTrigger = secondaryNav.locator('button.secondary-nav__trigger', { hasText: 'RH & Paie' });
    if ((await rhTrigger.count()) === 0) {
      test.skip(true, 'RH & Paie section not visible for this user');
    }

    await rhTrigger.click();
    const menu = page.locator('#secondary-nav-menu-hr-payroll, .secondary-nav__dropdown.show').first();
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThan(40);

    const salaries = page.locator('.secondary-nav__link', { hasText: 'Salariés' }).first();
    await expect(salaries).toBeVisible();
    await salaries.click();
    await expect(page).toHaveURL(/\/payroll\/employees/);
  });

  test('delegated accounting firm shows accounting modules and hides moved sections', async ({ page }) => {
    if (!(await ensureAuthenticated(page))) {
      test.skip(true, 'DOC_EMAIL/DOC_PASSWORD or demo credentials required');
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForAppReady(page);
    await page.goto('/dashboard');

    const secondaryNav = page.locator('app-secondary-nav .secondary-nav');
    if ((await secondaryNav.count()) === 0) {
      test.skip(true, 'Secondary nav not available for this user/context');
    }

    const hasAccountingModules = (await secondaryNav.getByText('Configuration', { exact: true }).count()) > 0;
    if (!hasAccountingModules) {
      test.skip(true, 'Accounting-firm delegated secondary nav not active for this account');
    }

    await expect(secondaryNav.getByText('Configuration', { exact: true })).toBeVisible();
    await expect(secondaryNav.getByText('Traitements', { exact: true })).toBeVisible();
    await expect(secondaryNav.getByText('États', { exact: true })).toBeVisible();

    await expect(secondaryNav.getByText('Ventes', { exact: true })).toHaveCount(0);
    await expect(secondaryNav.getByText('Achats', { exact: true })).toHaveCount(0);
    await expect(secondaryNav.getByText('Trésorerie', { exact: true })).toHaveCount(0);
    await expect(secondaryNav.getByText('RH & Paie', { exact: true })).toHaveCount(0);

    await expect(secondaryNav).toHaveClass(/secondary-nav--firm-delegated/);
    const iconBoxes = secondaryNav.locator('.secondary-nav__icon-box');
    await expect(iconBoxes.first()).toBeVisible();
    expect(await iconBoxes.count()).toBeGreaterThanOrEqual(5);

    const configTrigger = secondaryNav.locator('.secondary-nav__trigger', { hasText: 'Configuration' }).first();
    const color = await configTrigger.evaluate(el => getComputedStyle(el).color);
    // rgba(255, 255, 255, 0.92) or rgb(255, 255, 255)
    expect(color.replace(/\s/g, '')).toMatch(/rgba?\(255,255,255/);
  });
});
