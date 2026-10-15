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

async function getRailWidth(page: import('@playwright/test').Page): Promise<number> {
  const rail = page.locator('.sidebar-icon-rail');
  await expect(rail).toBeVisible();
  const box = await rail.boundingBox();
  expect(box).toBeTruthy();
  return box!.width;
}

test.describe('Sidebar collapse', () => {
  test('brand lockup fills the header when expanded and switches to icon when collapsed', async ({ page }) => {
    if (!(await ensureAuthenticated(page))) {
      test.skip(true, 'DOC_EMAIL/DOC_PASSWORD or demo credentials required');
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForAppReady(page);
    await page.goto('/dashboard');

    const lockup = page.locator('#sidebar .icon-brand-lockup');
    await expect(lockup).toBeVisible();
    const box = await lockup.boundingBox();
    expect(box).toBeTruthy();
    // Logo 2026 détouré au ras (≈ 4,4:1, sans marge transparente intégrée) : il occupe toute
    // la largeur utile (208 px), d'où une boîte moins haute qu'avec l'ancien visuel 3:1.
    expect(box!.height).toBeGreaterThan(36);
    expect(box!.height).toBeLessThan(90);
    expect(box!.width).toBeGreaterThan(170);
    expect(box!.width).toBeLessThan(232);

    await page.locator('.rail-collapse-btn').click();
    await page.waitForTimeout(350);

    await expect(page.locator('#sidebar.sidebar-collapsed')).toBeVisible();
    await expect(page.locator('#sidebar .icon-logo-only')).toBeVisible();
    await expect(page.locator('#sidebar .icon-brand-lockup')).toHaveCount(0);

    const collapsedWidth = await getRailWidth(page);
    expect(collapsedWidth).toBeGreaterThanOrEqual(68);
    expect(collapsedWidth).toBeLessThanOrEqual(76);
  });

  test('rail shrinks from expanded to collapsed width on toggle', async ({ page }) => {
    if (!(await ensureAuthenticated(page))) {
      test.skip(true, 'DOC_EMAIL/DOC_PASSWORD or demo credentials required');
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForAppReady(page);
    await page.goto('/dashboard');

    const expandedWidth = await getRailWidth(page);
    expect(expandedWidth).toBeGreaterThan(225);
    expect(expandedWidth).toBeLessThan(255);

    await page.locator('.rail-collapse-btn').click();
    await page.waitForTimeout(350);

    const collapsedWidth = await getRailWidth(page);
    expect(collapsedWidth).toBeGreaterThanOrEqual(68);
    expect(collapsedWidth).toBeLessThanOrEqual(76);
    expect(collapsedWidth).toBeLessThan(expandedWidth - 80);

    await expect(page.locator('#sidebar.sidebar-collapsed')).toBeVisible();
  });

  test('header toggle expands and collapses the rail', async ({ page }) => {
    if (!(await ensureAuthenticated(page))) {
      test.skip(true, 'DOC_EMAIL/DOC_PASSWORD or demo credentials required');
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForAppReady(page);
    await page.goto('/dashboard');

    await page.locator('.rail-collapse-btn').click();
    await page.waitForTimeout(350);
    await expect(page.locator('#sidebar.sidebar-collapsed')).toBeVisible();

    await page.locator('.sidebar_toggle').click();
    await page.waitForTimeout(350);
    await expect(page.locator('#sidebar.sidebar-collapsed')).toHaveCount(0);

    const expandedWidth = await getRailWidth(page);
    expect(expandedWidth).toBeGreaterThan(225);
    expect(expandedWidth).toBeLessThan(255);
  });

  test('parent section expands sidebar and shows submenu when rail is collapsed', async ({ page }) => {
    if (!(await ensureAuthenticated(page))) {
      test.skip(true, 'DOC_EMAIL/DOC_PASSWORD or demo credentials required');
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForAppReady(page);
    await page.goto('/dashboard');

    await page.locator('.rail-collapse-btn').click();
    await page.waitForTimeout(350);

    const ventesButton = page.locator('button.rail-parent[title="Ventes"]');
    if ((await ventesButton.count()) === 0) {
      test.skip(true, 'Ventes parent nav not available for current user');
    }

    await ventesButton.click();
    await page.waitForTimeout(350);

    await expect(page.locator('#sidebar.sidebar-collapsed')).toHaveCount(0);
    await expect(page.locator('.submenu-title', { hasText: 'Ventes' })).toBeVisible();
  });

  test('collapsed rail stays visible at tablet viewport without horizontal overflow', async ({ page }) => {
    if (!(await ensureAuthenticated(page))) {
      test.skip(true, 'DOC_EMAIL/DOC_PASSWORD or demo credentials required');
    }

    await page.setViewportSize({ width: 768, height: 800 });
    await waitForAppReady(page);
    await page.goto('/dashboard');

    await page.locator('.sidebar_toggle').click();
    await page.waitForTimeout(350);

    const rail = page.locator('.sidebar-icon-rail');
    await expect(rail).toBeVisible();

    const collapsedWidth = await getRailWidth(page);
    expect(collapsedWidth).toBeGreaterThanOrEqual(68);
    expect(collapsedWidth).toBeLessThanOrEqual(76);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('moved sections remain available in sidebar for delegated accounting firm', async ({ page }) => {
    if (!(await ensureAuthenticated(page))) {
      test.skip(true, 'DOC_EMAIL/DOC_PASSWORD or demo credentials required');
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForAppReady(page);
    await page.goto('/dashboard');

    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toBeVisible();

    const hasDelegatedHeader = (await page.locator('.rail-label', { hasText: 'Dossier :' }).count()) > 0;
    if (!hasDelegatedHeader) {
      test.skip(true, 'Delegated accounting-firm context not active for this account');
    }

    await expect(page.locator('.rail-label', { hasText: 'Ventes' })).toBeVisible();
    await expect(page.locator('.rail-label', { hasText: 'Achats' })).toBeVisible();
    await expect(page.locator('.rail-label', { hasText: 'Trésorerie' })).toBeVisible();
    await expect(page.locator('.rail-label', { hasText: 'RH & Paie' })).toBeVisible();
  });
});
