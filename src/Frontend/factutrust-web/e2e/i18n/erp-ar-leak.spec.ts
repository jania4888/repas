import { test, expect } from '@playwright/test';
import { findBasicLatinLeaks, snapshotErpText } from './erp-text-utils';

const ERP_LOCALE_STORAGE_KEY = 'instafact_erp_locale';

test.describe('ERP — fuites latines en AR (v2)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((key: string) => {
      localStorage.setItem(key, 'ar');
    }, ERP_LOCALE_STORAGE_KEY);
    await page.goto('/auth/login');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('login — détection fuites latines (non bloquant)', async ({ page }) => {
    const snap = await snapshotErpText(page);
    const blob = [snap.title, snap.visibleText, ...snap.placeholders, ...snap.ariaLabels].join('\n');
    const leaks = findBasicLatinLeaks(blob);
    test.info().attach('latin-leaks-login', {
      body: leaks.length ? leaks.join('\n') : '(aucune)',
      contentType: 'text/plain'
    });
    const blocking = leaks.filter(t => /connexion|password|welcome|bienvenue|mot de passe/i.test(t));
    expect(blocking, `Fuites latines bloquantes: ${blocking.join(', ')}`).toEqual([]);
  });
});
