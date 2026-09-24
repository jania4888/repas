import { test, expect, type Page } from '@playwright/test';
import { mockRegistrationStatus } from './helpers/landing-mocks';

/**
 * Smoke e2e de la page d'accueil refondue (lot A). L'API d'état d'inscription est
 * systématiquement simulée (`GET /api/public/registration-status`) : les tests ne
 * dépendent ni du backend ni de la configuration de production.
 */

/** Attend la fin du chargement de l'état d'inscription (le squelette disparaît). */
async function waitForCtaState(page: Page, state: 'open' | 'closed'): Promise<void> {
  // Certains CTA sont animés par WOW (`visibility:hidden` jusqu'à l'animation) :
  // on attend qu'au moins un CTA de l'état voulu soit réellement visible.
  await expect(page.locator(`[data-cta-state="${state}"]:visible`).first()).toBeVisible({ timeout: 10_000 });
}

test.describe('Landing — page d’accueil', () => {
  test('état fermé : les CTA pointent vers le formulaire, jamais vers /auth/register', async ({ page }) => {
    await mockRegistrationStatus(page, 'closed');
    await page.goto('/');
    await waitForCtaState(page, 'closed');

    const closedCtas = page.locator('[data-cta-state="closed"]');
    // Toutes les instances partagent le même statut : on attend que les squelettes aient basculé.
    await expect
      .poll(async () => closedCtas.count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(5);

    const hrefs = await page.locator('a[href*="/auth/register"]').all();
    for (const link of hrefs) {
      await expect(link).not.toBeVisible();
    }

    const first = closedCtas.first();
    const href = await first.getAttribute('href');
    expect(href).toContain('#contact');
    expect(href).toContain('objet=');
  });

  test('état ouvert : les CTA mènent à /auth/register', async ({ page }) => {
    await mockRegistrationStatus(page, 'open');
    await page.goto('/');
    await waitForCtaState(page, 'open');
    const cta = page.locator('[data-cta-state="open"]').first();
    expect(await cta.getAttribute('href')).toContain('/auth/register');
  });

  test('erreur ou délai API : repli fermé (aucun toast, aucun CTA mort)', async ({ page }) => {
    await mockRegistrationStatus(page, 'error');
    await page.goto('/');
    await waitForCtaState(page, 'closed');
    expect(await page.locator('.p-toast, .p-toast-message').count()).toBe(0);
  });

  test('un seul H1, la bannière « Nouveautés » mène à #nouveautés quand fermé', async ({ page }) => {
    await mockRegistrationStatus(page, 'closed');
    await page.goto('/');
    await waitForCtaState(page, 'closed');

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toContainText(/facturez/i);

    await expect(page.locator('#nouveautes')).toHaveCount(1);
    await expect(page.locator('#modules')).toHaveCount(1);
    await expect(page.locator('#tarifs')).toHaveCount(1);
    await expect(page.locator('#cabinets')).toHaveCount(1);
    await expect(page.locator('#contact')).toHaveCount(1);
    await expect(page.locator('#faq')).toHaveCount(1);
    await expect(page.locator('#securite, #securite-detail').first()).toHaveCount(1);
  });

  test('sélecteurs e2e historiques préservés (visite virtuelle, cas d’usage, conformité)', async ({ page }) => {
    await mockRegistrationStatus(page, 'closed');
    await page.goto('/');
    await expect(page.getByRole('link', { name: /visite virtuelle/i }).first()).toBeAttached();
    await expect(page.getByText(/Rue InstaFact/i).first()).toBeAttached();
    await expect(page.locator('#conformite')).toHaveCount(1);
    await expect(page.locator('#cas-usage .usecase-card').first()).toHaveCount(1);
    await expect(page.locator('.persona-accountant')).toHaveCount(1);
  });

  test('SEO : titre, description, canonical, hreflang, JSON-LD posés au chargement', async ({ page }) => {
    await mockRegistrationStatus(page, 'closed');
    await page.goto('/');
    await expect(page).toHaveTitle(/InstaFact/);
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description?.length).toBeGreaterThan(50);
    // Canonical unique (la balise statique est mise à jour en place, jamais doublée).
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https?:\/\/[^/]+\/$/);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    expect(jsonLd).toContain('SoftwareApplication');
  });

  test('mobile 390×844 : menu burger, section nouveautés et formulaire présents', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockRegistrationStatus(page, 'closed');
    await page.goto('/');
    await waitForCtaState(page, 'closed');
    await expect(page.locator('#nouveautes')).toHaveCount(1);
    await expect(page.locator('#contact')).toHaveCount(1);
  });

  test('aucune erreur console au chargement', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await mockRegistrationStatus(page, 'closed');
    await page.goto('/');
    await waitForCtaState(page, 'closed');
    // Tolérance : les fonts AR et landing-rtl.css ne sont pas chargés en FR ; tout autre échec réseau compte.
    const blocking = errors.filter(e => !/landing-rtl|noto-sans-arabic|favicon/.test(e));
    expect(blocking).toEqual([]);
  });
});
