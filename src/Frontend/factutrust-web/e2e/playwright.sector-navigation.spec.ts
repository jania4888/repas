import { test, expect, Page } from '@playwright/test';

/**
 * Review R6 — end-to-end proof that a sector's module scoping (plan §3, "dynamic ERP
 * configuration per segment/domain") actually gates navigation, not just the registration
 * payload: register as a BTP & Construction company (segment `btp-construction`, domain
 * `immobilier` — MODULES_REQUIRED_BY_SEGMENT for this segment is
 * [Purchases, Stock, Projects, Fiscal], which does NOT include CRM), then verify:
 *   1. the sidebar has no "CRM Commercial" navigation group;
 *   2. a direct navigation to `/crm` is redirected to `/access-denied` by `moduleGuard`
 *      (see core/guards/module.guard.ts).
 *
 * Follows the same live-backend convention as `playwright.registration.spec.ts` /
 * `playwright.registration.legacy.spec.ts`: `test.skip()` when no backend is reachable on
 * https://localhost:7001, so this spec is a no-op (not a failure) in a sandbox with no backend
 * running.
 *
 * Prérequis :
 * - npm install @playwright/test
 * - npx playwright install
 * - Backend démarré sur https://localhost:7001
 * - Frontend démarré sur http://localhost:4200
 */

async function checkBackendAvailable(page: Page): Promise<{ available: boolean; reason?: string }> {
  const endpoints = [
    { url: 'https://localhost:7001/swagger', name: 'Swagger' },
    { url: 'https://localhost:7001/api', name: 'API Root' },
    { url: 'https://localhost:7001', name: 'Root' }
  ];

  let lastError: string | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await page.request.get(endpoint.url, {
        ignoreHTTPSErrors: true,
        timeout: 2000,
        failOnStatusCode: false
      });
      if (response.status() < 500) {
        return { available: true };
      }
      lastError = `Status ${response.status()} pour ${endpoint.name}`;
    } catch (error: any) {
      lastError = error.message || String(error);
      continue;
    }
  }

  return {
    available: false,
    reason: `Le backend n'est pas accessible sur https://localhost:7001. Dernière erreur: ${lastError || 'Timeout/Connexion refusée'}. Démarrez-le avec: cd src/Backend/FactuTrust.API && dotnet run`
  };
}

async function fillField(page: Page, selector: string, value: string) {
  await page.fill(selector, value);
}

async function fillPasswordField(page: Page, selector: string, value: string) {
  const passwordInput = page.locator(`${selector} input[type="password"]`);
  await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
  await passwordInput.fill(value);
}

async function fillMaskedField(page: Page, selector: string, value: string) {
  const maskedInput = page.locator(`${selector} input`);
  await maskedInput.waitFor({ state: 'visible', timeout: 5000 });
  await maskedInput.fill(value);
}

async function selectDropdownOption(page: Page, dropdownSelector: string, optionText: string) {
  const dropdown = page.locator(dropdownSelector);
  await dropdown.click();
  await page.waitForTimeout(500);
  try {
    await page.waitForSelector('.p-select-list', { timeout: 5000 });
  } catch {
    await page.waitForSelector('.p-select-overlay', { timeout: 5000 });
  }
  try {
    await page.locator(`text=${optionText}`).click({ timeout: 3000 });
  } catch {
    await page.locator(`span:has-text("${optionText}")`).click({ timeout: 3000 });
  }
  await page.waitForTimeout(300);
}

async function clickButton(page: Page, text: string) {
  const button = page.locator(`button:has-text("${text}")`);
  await button.waitFor({ state: 'visible', timeout: 5000 });
  await button.click();
}

test.describe('Tests Playwright - Navigation sectorielle (module scoping BTP & Construction)', () => {
  test('un compte BTP & Construction (segment sans module CRM) ne voit pas le CRM et /crm redirige vers /access-denied', async ({ page }) => {
    const backendCheck = await checkBackendAvailable(page);
    if (!backendCheck.available) {
      test.skip();
      console.warn(`\n⚠️ BACKEND NON DISPONIBLE - Test ignoré.\n   ${backendCheck.reason}`);
      return;
    }

    await page.goto('/auth/register');
    await page.waitForSelector('form', { timeout: 15000 });

    // Étape 1 : Type de société — segment BTP & Construction, domaine Immobilier
    // (SEGMENT_ALLOWED_DOMAINS['btp-construction'] in registration-catalog.ts).
    await page.locator('.seg-card', { hasText: 'BTP & Construction' }).click();
    await page.locator('.dom-item', { hasText: 'Immobilier' }).click();
    await clickButton(page, 'Continuer');

    // Étape 2 : Informations générales
    await page.waitForSelector('#wiz-firstName', { timeout: 5000 });
    const email = `test-btp-${Date.now()}@example.com`;
    await fillField(page, '#wiz-firstName', 'Jane');
    await fillField(page, '#wiz-lastName', 'Builder');
    await fillField(page, '#wiz-email', email);
    await fillPasswordField(page, 'p-password[formcontrolname="password"]', 'Test1234@Password');
    await fillPasswordField(page, 'p-password[formcontrolname="confirmPassword"]', 'Test1234@Password');
    await fillField(page, '#wiz-companyName', 'BTP Test Company');
    await fillMaskedField(page, 'p-inputmask[formcontrolname="nif"]', '1234567A/B/C/000');
    await selectDropdownOption(page, 'p-select[formcontrolname="taxRegime"]', 'Régime réel');
    await fillField(page, '#wiz-companyEmail', 'contact@btp-test.tn');
    await fillMaskedField(page, 'p-inputmask[formcontrolname="phone"]', '98 455 112');
    await clickButton(page, 'Continuer');

    // Étape 3 : Configuration — garder les modules recommandés par défaut (pas de CRM pour ce segment).
    await page.waitForSelector('.mod-group', { timeout: 5000 });
    await clickButton(page, 'Continuer');

    // Étape 4 : Finalisation
    await page.waitForSelector('#wiz-street', { timeout: 5000 });
    await fillField(page, '#wiz-street', '155 Rue Test');
    await fillField(page, '#wiz-city', 'Monastir');
    await fillMaskedField(page, 'p-inputmask[formcontrolname="postalCode"]', '5000');
    await selectDropdownOption(page, 'p-select[formcontrolname="governorate"]', 'Monastir');
    await page.locator('label[for="wiz-acceptTerms"]').click();

    const submitButton = page.locator('button.btn-submit:has-text("Créer mon espace")');
    await submitButton.waitFor({ state: 'visible', timeout: 5000 });
    await submitButton.click();

    await page.waitForURL('**/dashboard', { timeout: 15000 });
    expect(page.url()).toContain('/dashboard');

    // La visite guidée peut masquer la sidebar — l'ignorer si présente.
    const skipTour = page.locator('.ft-product-tour__skip, .driver-popover-close-btn, button:has-text("Ignorer")').first();
    if (await skipTour.isVisible().catch(() => false)) {
      await skipTour.click();
    }

    // 1) Le sidebar (app-navigation.registry.ts) n'affiche pas le groupe "CRM Commercial" —
    // le segment btp-construction ne débloque pas AppModule.CRM.
    await expect(page.locator('.rail-label', { hasText: 'CRM' })).toHaveCount(0);

    // 2) moduleGuard redirige toute navigation directe vers /crm vers /access-denied.
    await page.goto('/crm');
    await page.waitForURL('**/access-denied**', { timeout: 10000 });
    await expect(page.locator('h2.title')).toHaveText('Accès refusé');
  });
});
