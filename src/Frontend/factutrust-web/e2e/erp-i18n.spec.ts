import { test, expect } from '@playwright/test';

test.describe('ERP — i18n FR/AR', () => {
  test('login : bascule AR pose dir=rtl quand erp.arabicEnabled', async ({ page }) => {
    await page.goto('/auth/login');
    const switcher = page.locator('app-erp-language-switcher button').filter({ hasText: /العربية|Français/ });
    if ((await switcher.count()) === 0) {
      test.skip(true, 'erp.arabicEnabled désactivé');
    }
    await page.locator('app-erp-language-switcher button', { hasText: 'العربية' }).click();
    await page.waitForLoadState('load');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });
});
