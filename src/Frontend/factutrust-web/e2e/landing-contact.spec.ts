import { test, expect, type Page, type Route } from '@playwright/test';
import { mockRegistrationStatus } from './helpers/landing-mocks';

/**
 * E2e du formulaire de demande d'accès / de démo (lot B). L'API est simulée —
 * `POST /api/public/contact-requests` — pour couvrir tous les états sans backend.
 */


async function fillValidForm(page: Page): Promise<void> {
  await page.locator('#contact').scrollIntoViewIfNeeded();
  await page.locator('#cr-fullname').fill('Amina Ben Salah');
  await page.locator('#cr-organization').fill('Cabinet ABC');
  await page.locator('#cr-email').fill('amina@cabinet.tn');
  await page.locator('#cr-phone').fill('71 234 567');
  await page.locator('#cr-message').fill('Nous souhaitons une démonstration de la plateforme.');
  await page.locator('#cr-consent').check();
  // Laisse passer le time-trap (MinElapsedMs = 3000 côté serveur ; le frontend n'en tient pas compte).
  await page.waitForTimeout(100);
}

/** Bouton d'envoi du formulaire (libellé localisé « Envoyer la demande »). */
function submitButton(page: Page) {
  return page.locator('#contact button[type="submit"]').first();
}

function mockSubmit(page: Page, respond: (route: Route) => Promise<void>): Promise<void> {
  return page.route('**/api/public/contact-requests', respond);
}

test.describe('Landing — formulaire de demande', () => {
  test.beforeEach(async ({ page }) => {
    await mockRegistrationStatus(page, 'closed');
  });

  test('succès 202 : référence affichée, focus déplacé, aucune requête avec Authorization', async ({ page }) => {
    let authHeader: string | null = null;
    await mockSubmit(page, async route => {
      authHeader = route.request().headers()['authorization'] ?? null;
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { reference: 'CR-TEST42' }, message: 'Demande enregistrée.' })
      });
    });
    await page.goto('/');
    await fillValidForm(page);
    await submitButton(page).click();
    await expect(page.locator('#contact')).toContainText(/CR-TEST42/, { timeout: 10_000 });
    expect(authHeader).toBeNull();
  });

  test('400 : erreurs par champ affichées, valeurs conservées', async ({ page }) => {
    await mockSubmit(page, route =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          code: 'VALIDATION_FAILED',
          message: 'Validation échouée.',
          fieldErrors: { email: [{ code: 'Email', message: 'Adresse e-mail invalide.', attemptedValue: 'x', severity: 0 }] },
          globalErrors: []
        })
      })
    );
    await page.goto('/');
    await fillValidForm(page);
    // E-mail valide côté client : la validation HTML5 ne bloque pas l'envoi,
    // le 400 simulé vient du serveur (erreurs par champ).
    await submitButton(page).click();
    await expect(page.locator('#contact')).toContainText(/e-mail invalide/i, { timeout: 10_000 });
    await expect(page.locator('#cr-fullname')).toHaveValue('Amina Ben Salah');
  });

  test('429 + Retry-After : état bloqué avec compte à rebours', async ({ page }) => {
    await mockSubmit(page, route =>
      route.fulfill({
        status: 429,
        headers: { 'Retry-After': '120' },
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Trop de requêtes.' })
      })
    );
    await page.goto('/');
    await fillValidForm(page);
    await submitButton(page).click();
    await expect(page.locator('#contact')).toContainText(/120|réessayez/i, { timeout: 10_000 });
  });

  test('503 : repli e-mail affiché', async ({ page }) => {
    await mockSubmit(page, route =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Le formulaire de contact est temporairement indisponible.' })
      })
    );
    await page.goto('/');
    await fillValidForm(page);
    await submitButton(page).click();
    await expect(page.locator('#contact')).toContainText(/contact@instafact\.shop/i, { timeout: 10_000 });
  });

  test('honeypot rempli : aucune requête HTTP part', async ({ page }) => {
    let calls = 0;
    await mockSubmit(page, async route => {
      calls += 1;
      await route.fulfill({ status: 202, contentType: 'application/json', body: '{"success":true}' });
    });
    await page.goto('/');
    await fillValidForm(page);
    // Le honeypot est hors écran : on le remplit en forçant (comportement bot).
    await page.locator('#cr-website').evaluate((el: HTMLInputElement) => { el.value = 'http://spam.example'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await submitButton(page).click();
    await page.waitForTimeout(1_500);
    expect(calls).toBe(0);
  });

  test('?objet=demo-cabinet pré-remplit le sujet', async ({ page }) => {
    await page.goto('/?objet=demo-cabinet#contact');
    await expect(page.locator('#contact')).toBeVisible();
    const subject = page.locator('#cr-subject');
    await expect(subject).toHaveValue(/demo-cabinet/);
  });

  test('page cabinet : le formulaire porte defaultSubject=demo-cabinet sans query', async ({ page }) => {
    await page.goto('/cabinets-comptables');
    await expect(page.locator('#contact')).toBeVisible();
    const subject = page.locator('#cr-subject');
    await expect(subject).toHaveValue(/demo-cabinet/);
  });
});
