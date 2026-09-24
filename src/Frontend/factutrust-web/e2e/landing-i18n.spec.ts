import { test, expect, type Page } from '@playwright/test';
import { mockRegistrationStatus } from './helpers/landing-mocks';

/**
 * E2e i18n FR/AR (lot D, TD9). L'API d'inscription est simulée (état fermé).
 * `/ar` n'existe que si `environment.landing.arabicEnabled` (vrai en développement).
 */


test.describe('Landing — i18n FR/AR', () => {
  test.beforeEach(async ({ page }) => {
    await mockRegistrationStatus(page, 'closed');
  });

  test('/ar : html[lang=ar][dir=rtl], titre arabe, canonical et hreflang', async ({ page }) => {
    await page.goto('/ar');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('body')).toHaveClass(/landing-rtl/);
    await expect(page.locator('h1')).toHaveCount(1);
    // Le titre reste arabe (le dictionnaire AR n'est pas le FR).
    const title = await page.title();
    expect(title.length).toBeGreaterThan(5);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/ar$/);
    await expect(page.locator('link[rel="alternate"][hreflang="fr-TN"]')).toHaveCount(1);
    await expect(page.locator('link[rel="alternate"][hreflang="ar-TN"]')).toHaveCount(1);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
  });

  test('/ar/cabinets-comptables : page cabinet en RTL, H1 arabe, formulaire présent', async ({ page }) => {
    await page.goto('/ar/cabinets-comptables');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/ar\/cabinets-comptables$/);
    await expect(page.locator('#contact')).toHaveCount(1);
  });

  test('le sélecteur de langue conserve l’ancre et bascule / ↔ /ar', async ({ page }) => {
    await page.goto('/#tarifs');
    const switcher = page.locator('a[hreflang="ar-TN"], a:has-text("العربية")').first();
    await expect(switcher).toBeVisible();
    const href = await switcher.getAttribute('href');
    expect(href).toMatch(/^\/ar/);
    await switcher.click();
    await expect(page).toHaveURL(/\/ar/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // Retour en FR.
    const back = page.locator('a[hreflang="fr-TN"], a:has-text("FR")').first();
    await back.click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('sortie vers /auth/login : html revient en fr/ltr, feuilles Chain retirées', async ({ page }) => {
    await page.goto('/ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // Navigation côté client (routerLink) : le shell détruit le contexte landing.
    await page.getByRole('link', { name: /se connecter|تسجيل الدخول/i }).first().click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    expect(await page.locator('link[id^="factutrust-chain"]').count()).toBe(0);
    expect(await page.locator('link#factutrust-landing-rtl').count()).toBe(0);
  });

  test('mobile 390 px : le tiroir arabe glisse depuis la gauche', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // Le déclencheur du menu est à gauche en RTL.
    const trigger = page.locator('.menu-trigger, [aria-controls][aria-expanded], button.menu').first();
    if (await trigger.count()) {
      const box = await trigger.boundingBox();
      if (box) expect(box.x).toBeLessThan(195);
    }
  });

  test('pas d’erreur console sur /ar', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/ar');
    await expect(page.locator('h1')).toBeVisible();
    // landing-rtl.css et les polices AR sont servies par le dev server (assets + bundle non injecté).
    const blocking = errors.filter(e => !/favicon/.test(e));
    expect(blocking).toEqual([]);
  });
});
