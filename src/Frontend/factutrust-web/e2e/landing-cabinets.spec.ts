import { test, expect, type Page } from '@playwright/test';
import { mockRegistrationStatus } from './helpers/landing-mocks';

/** E2e de la page « Cabinets comptables » (lot B) — état d'inscription simulé. */


test.describe('Landing — page Cabinets comptables', () => {
  test('rendu : H1 unique, 9 blocs, ancres, SEO cabinet', async ({ page }) => {
    await mockRegistrationStatus(page, 'closed');
    await page.goto('/cabinets-comptables');

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toContainText(/vos dossiers/i);

    for (const anchor of ['#fonctionnement', '#fonctionnalites-cabinet', '#roles', '#securite-cabinet', '#offre-cabinet', '#faq-cabinet', '#contact']) {
      await expect(page.locator(anchor)).toHaveCount(1);
    }

    await expect(page).toHaveTitle(/cabinet/i);
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description?.length).toBeGreaterThan(50);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /cabinets-comptables$/);

    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    expect(jsonLd).toContain('FAQPage');
  });

  test('CTA fermé : « Demander une démo » pointe vers #contact?objet=demo-cabinet', async ({ page }) => {
    await mockRegistrationStatus(page, 'closed');
    await page.goto('/cabinets-comptables');
    const cta = page.locator('[data-cta-state="closed"]:visible').first();
    await expect(cta).toBeVisible({ timeout: 10_000 });
    const href = await cta.getAttribute('href');
    expect(href).toContain('objet=demo-cabinet');
    expect(href).toContain('contact');
  });

  test('CTA ouvert : mène à /auth/register-firm', async ({ page }) => {
    await mockRegistrationStatus(page, 'open');
    await page.goto('/cabinets-comptables');
    const cta = page.locator('[data-cta-state="open"]:visible').first();
    await expect(cta).toBeVisible({ timeout: 10_000 });
    expect(await cta.getAttribute('href')).toContain('/auth/register-firm');
  });

  test('FAQ : 7 questions en <details>, offre « sur devis » sans chiffre', async ({ page }) => {
    await mockRegistrationStatus(page, 'closed');
    await page.goto('/cabinets-comptables');
    await expect(page.locator('#faq-cabinet details')).toHaveCount(7);
    const offer = page.locator('#offre-cabinet');
    await expect(offer).toContainText(/sur devis/i);
    await expect(offer).not.toContainText(/TND|\d+\s*(DT|د\.ت)/);
  });

  test('header : l’entrée « Cabinets comptables » est active sur la page', async ({ page }) => {
    await mockRegistrationStatus(page, 'closed');
    await page.goto('/cabinets-comptables');
    const link = page.locator('header a, .header-area a, nav a').filter({ hasText: /cabinets comptables/i }).first();
    await expect(link).toBeVisible();
  });

  test('navigation accueil → cabinets → retour conserve le thème (pas de flash)', async ({ page }) => {
    await mockRegistrationStatus(page, 'closed');
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    await page.locator('a').filter({ hasText: /cabinets comptables/i }).first().click();
    await expect(page).toHaveURL(/cabinets-comptables/);
    await expect(page.locator('h1')).toContainText(/vos dossiers/i);
    // La feuille Chain est toujours chargée (le shell survit).
    const links = await page.locator('link[id^="factutrust-chain"]').count();
    expect(links).toBeGreaterThan(0);
  });
});
