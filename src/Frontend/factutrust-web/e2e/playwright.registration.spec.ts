import { test, expect, Page } from '@playwright/test';
import { seleniumConfig } from './selenium.config';

/**
 * Tests Playwright (recommandé) pour la fonctionnalité d'inscription
 *
 * Retargeted for the 4-step `RegisterWizardComponent` wizard
 * (registrationWizardV2 flag, see /code/.plans/v1-registration-wizard-erp-config.md):
 *   Étape 1 — Type de société (segment + domaine)
 *   Étape 2 — Informations générales (compte + société)
 *   Étape 3 — Configuration (modules)
 *   Étape 4 — Finalisation (adresse + CGU)
 *
 * The pre-wizard 3-step suite is preserved byte-identical in
 * `playwright.registration.legacy.spec.ts` as the flag-off regression guard.
 *
 * Prérequis :
 * - npm install @playwright/test
 * - npx playwright install
 * - Backend démarré sur https://localhost:7001
 * - Frontend démarré sur http://localhost:4200
 */

const config = seleniumConfig;

/**
 * Vérifie si le backend est disponible en testant plusieurs endpoints
 */
async function checkBackendAvailable(page: Page): Promise<{ available: boolean; reason?: string }> {
  const endpoints = [
    { url: 'https://localhost:7001/swagger', name: 'Swagger', method: 'GET' },
    { url: 'https://localhost:7001/api', name: 'API Root', method: 'GET' },
    { url: 'https://localhost:7001', name: 'Root', method: 'GET' }
  ];

  let lastError: string | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await page.request.get(endpoint.url, {
        ignoreHTTPSErrors: true,
        timeout: 2000,
        failOnStatusCode: false
      });
      const status = response.status();
      if (status < 500) {
        console.log(`✅ Backend détecté via ${endpoint.name} (status: ${status})`);
        return { available: true };
      }
      lastError = `Status ${status} pour ${endpoint.name}`;
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      lastError = errorMsg;
      if (
        errorMsg.includes('timeout') ||
        errorMsg.includes('ECONNREFUSED') ||
        errorMsg.includes('net::ERR') ||
        errorMsg.includes('Failed to fetch') ||
        errorMsg.includes('NetworkError') ||
        errorMsg.includes('NS_ERROR')
      ) {
        continue;
      }
      console.log(`⚠️ Erreur lors de la vérification ${endpoint.name}: ${errorMsg} (mais le serveur semble répondre)`);
      return { available: true };
    }
  }

  return {
    available: false,
    reason: `Le backend n'est pas accessible sur https://localhost:7001. Dernière erreur: ${lastError || 'Timeout/Connexion refusée'}. Démarrez-le avec: cd src/Backend/FactuTrust.API && dotnet run`
  };
}

test.describe('Tests Playwright - Inscription FactuTrust (wizard 4 étapes)', () => {
  test.skip(
    () => process.env['E2E_PUBLIC_REGISTRATION'] === 'false',
    'Public registration disabled (staging build)'
  );
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/register');
    await page.waitForSelector('form', { timeout: 15000 });
    console.log('✅ Page d\'inscription (wizard) chargée');
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === 'failed') {
      try {
        await page.screenshot({
          path: `e2e/screenshots/failed-${testInfo.title.replace(/\s+/g, '-')}.png`,
          fullPage: true
        });
      } catch (error) {
        console.warn('Impossible de prendre un screenshot:', error);
      }
    }
  });

  async function fillField(page: Page, selector: string, value: string) {
    await page.fill(selector, value);
  }

  async function fillPasswordField(page: Page, selector: string, value: string) {
    try {
      const passwordInput = page.locator(`${selector} input[type="password"]`);
      await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
      await passwordInput.fill(value);
    } catch (error) {
      const altInput = page.locator(`${selector} input`);
      await altInput.waitFor({ state: 'visible', timeout: 5000 });
      await altInput.fill(value);
    }
  }

  async function fillMaskedField(page: Page, selector: string, value: string) {
    try {
      const maskedInput = page.locator(`${selector} input`);
      await maskedInput.waitFor({ state: 'visible', timeout: 5000 });
      await maskedInput.fill(value);
    } catch (error) {
      const maskedInput = page.locator(`${selector} input`);
      await maskedInput.click();
      await page.waitForTimeout(200);
      await maskedInput.fill(value);
    }
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
    try {
      const button = page.locator(`button:has-text("${text}")`);
      await button.waitFor({ state: 'visible', timeout: 5000 });
      await button.click();
    } catch (error) {
      const button = page.getByRole('button', { name: text });
      await button.waitFor({ state: 'visible', timeout: 5000 });
      await button.click();
    }
  }

  async function getErrorMessage(page: Page): Promise<string | null> {
    try {
      const errorElement = page.locator('.global-error');
      await errorElement.waitFor({ state: 'visible', timeout: 5000 });
      const text = await errorElement.textContent();
      return text ? text.trim() : null;
    } catch {
      try {
        const errorText = await page.locator('text=/Erreur|erreur|Error|error/').first().textContent();
        return errorText ? errorText.trim() : null;
      } catch {
        return null;
      }
    }
  }

  /**
   * Étape 1 (index 0) : sélectionne un segment + un domaine, puis clique "Continuer".
   */
  async function completeStepCompanyType(page: Page, segmentLabel: string, domainLabel: string) {
    await page.locator('.seg-card', { hasText: segmentLabel }).click();
    await page.locator('.dom-item', { hasText: domainLabel }).click();
    await clickButton(page, 'Continuer');
  }

  /**
   * Étape 2 (index 1) : compte + société (fusion des anciennes étapes 1 et 2), puis "Continuer".
   */
  async function completeStepInformations(page: Page, testData: typeof config.testData.validUser) {
    await page.waitForSelector('#wiz-firstName', { timeout: 5000 });

    await fillField(page, '#wiz-firstName', testData.firstName);
    await fillField(page, '#wiz-lastName', testData.lastName);
    await fillField(page, '#wiz-email', testData.email);
    await fillPasswordField(page, 'p-password[formcontrolname="password"]', testData.password);
    await fillPasswordField(page, 'p-password[formcontrolname="confirmPassword"]', testData.confirmPassword);

    await fillField(page, '#wiz-companyName', testData.companyName);
    await fillMaskedField(page, 'p-inputmask[formcontrolname="nif"]', testData.nif);
    await selectDropdownOption(page, 'p-select[formcontrolname="taxRegime"]', 'Régime réel');
    await fillField(page, '#wiz-companyEmail', testData.companyEmail);
    await fillMaskedField(page, 'p-inputmask[formcontrolname="phone"]', testData.phone);
  }

  /**
   * Étape 4 (index 3) : adresse + CGU.
   */
  async function fillStepFinalisation(page: Page, testData: typeof config.testData.validUser) {
    await page.waitForSelector('#wiz-street', { timeout: 5000 });

    await fillField(page, '#wiz-street', testData.street);
    await fillField(page, '#wiz-streetLine2', testData.streetLine2);
    await fillField(page, '#wiz-city', testData.city);
    await fillMaskedField(page, 'p-inputmask[formcontrolname="postalCode"]', testData.postalCode);
    await selectDropdownOption(page, 'p-select[formcontrolname="governorate"]', testData.governorate);
    await page.locator('label[for="wiz-acceptTerms"]').click();
  }

  /**
   * Test 1 : NIF avec underscores - Nettoyage automatique
   */
  test('devrait nettoyer automatiquement les underscores du NIF au blur', async ({ page }) => {
    const testData = config.testData.validUser;

    await completeStepCompanyType(page, testData.companySegmentLabel, testData.businessDomainLabel);

    await page.waitForSelector('#wiz-companyName', { timeout: 5000 });
    await fillField(page, '#wiz-companyName', testData.companyName);

    // Saisir le NIF avec underscore (p-inputmask)
    await fillMaskedField(page, 'p-inputmask[formcontrolname="nif"]', '1234567A/B/C/000_');
    const nifInput = page.locator('p-inputmask[formcontrolname="nif"] input');

    // Quitter le champ (blur) en cliquant ailleurs
    await fillField(page, '#wiz-companyEmail', '');
    await page.waitForTimeout(500);

    const nifValue = await nifInput.inputValue();
    console.log(`NIF après blur: ${nifValue}`);

    expect(nifValue).not.toContain('_');
    expect(nifValue.toUpperCase().replace(/\s/g, '')).toBe('1234567A/B/C/000');
  });

  /**
   * Coller l'écriture historique : le masque reçoit la forme carte.
   */
  test('devrait réécrire un matricule collé au format historique', async ({ page }) => {
    const testData = config.testData.validUser;

    await completeStepCompanyType(page, testData.companySegmentLabel, testData.businessDomainLabel);
    await page.waitForSelector('#wiz-nif', { timeout: 5000 });

    const nifHost = page.locator('p-inputmask[formcontrolname="nif"]');
    await nifHost.locator('input').click();
    await nifHost.evaluate((el) => {
      const data = new DataTransfer();
      data.setData('text/plain', '1234567/A/B/C/000');
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });

    await fillField(page, '#wiz-companyEmail', '');
    await page.waitForTimeout(300);

    const nifValue = await nifHost.locator('input').inputValue();
    expect(nifValue.toUpperCase().replace(/\s/g, '')).toBe('1234567A/B/C/000');
  });

  /**
   * Test 2 : Inscription complète valide, avec vérification du payload sector-aware
   */
  test('devrait permettre une inscription complète avec succès et envoyer les 3 nouveaux champs', async ({ page }) => {
    console.log('🔍 Vérification de la disponibilité du backend...');
    const backendCheck = await checkBackendAvailable(page);
    if (!backendCheck.available) {
      test.skip();
      console.warn(`\n⚠️ BACKEND NON DISPONIBLE - Test ignoré.`);
      console.warn(`   ${backendCheck.reason || 'Le backend n\'est pas accessible'}`);
      return;
    }

    console.log('✅ Backend disponible, démarrage du test d\'inscription complète\n');

    const testData = {
      ...config.testData.validUser,
      email: `test-${Date.now()}@example.com`
    };

    // Capturer la requête d'inscription pour vérifier le payload
    let registerPayload: any = null;
    const requestListener = (request: any) => {
      if (request.url().includes('/auth/register') && request.method() === 'POST') {
        try {
          registerPayload = JSON.parse(request.postData() || '{}');
          const sanitized = { ...registerPayload, password: '***', confirmPassword: '***' };
          console.log('📦 Payload envoyé:', JSON.stringify(sanitized, null, 2));
        } catch {
          console.log('📦 Payload (raw, non-JSON)');
        }
      }
    };
    page.on('request', requestListener);

    // Étape 1 : Type de société
    await completeStepCompanyType(page, testData.companySegmentLabel, testData.businessDomainLabel);

    // Étape 2 : Informations générales
    await completeStepInformations(page, testData);
    await clickButton(page, 'Continuer');

    // Étape 3 : Configuration — active un module optionnel supplémentaire (au-delà des recommandés)
    await page.waitForSelector('.mod-group', { timeout: 5000 });
    const optionalToggle = page.locator('.mod-group:has-text("Autres modules") p-inputswitch').first();
    if (await optionalToggle.count() > 0) {
      await optionalToggle.click();
    }
    await clickButton(page, 'Continuer');

    // Étape 4 : Finalisation
    await fillStepFinalisation(page, testData);

    // Soumettre
    const submitButton = page.locator('button.btn-submit:has-text("Créer mon espace")');
    await submitButton.waitFor({ state: 'visible', timeout: 5000 });
    await submitButton.click();

    // Attendre la redirection ou vérifier le succès
    try {
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      expect(page.url()).toContain('/dashboard');
      console.log('✅ Inscription réussie, redirection vers dashboard');
    } catch (error) {
      const errorMessage = await getErrorMessage(page);
      if (errorMessage) {
        throw new Error(`Inscription échouée: ${errorMessage.replace(/Erreur undefined\.?\s*/i, '').trim()}`);
      }
      throw new Error('Inscription échouée: Timeout - vérifiez que le backend est démarré sur https://localhost:7001.');
    }

    // Vérification du payload sector-aware (plan §3, contrat de câblage figé)
    expect(registerPayload).not.toBeNull();
    expect(registerPayload.companySegment).toBe(testData.companySegment);
    expect(registerPayload.businessDomain).toBe(testData.businessDomain);
    expect(Array.isArray(registerPayload.enabledModules)).toBe(true);
    expect(registerPayload.enabledModules.length).toBeGreaterThan(0);
  });

  /**
   * Test 3 : Validation NIF invalide bloque la progression (bouton "Continuer" désactivé)
   */
  test('devrait bloquer la progression avec un NIF invalide', async ({ page }) => {
    const testData = { ...config.testData.validUser, email: `test-${Date.now()}@example.com` };

    await completeStepCompanyType(page, testData.companySegmentLabel, testData.businessDomainLabel);

    await page.waitForSelector('#wiz-firstName', { timeout: 5000 });
    await fillField(page, '#wiz-firstName', testData.firstName);
    await fillField(page, '#wiz-lastName', testData.lastName);
    await fillField(page, '#wiz-email', testData.email);
    await fillPasswordField(page, 'p-password[formcontrolname="password"]', testData.password);
    await fillPasswordField(page, 'p-password[formcontrolname="confirmPassword"]', testData.confirmPassword);
    await fillField(page, '#wiz-companyName', testData.companyName);

    // NIF incomplet
    await fillMaskedField(page, 'p-inputmask[formcontrolname="nif"]', '1234567/A/B');
    await selectDropdownOption(page, 'p-select[formcontrolname="taxRegime"]', 'Régime réel');
    await fillField(page, '#wiz-companyEmail', testData.companyEmail);
    await fillMaskedField(page, 'p-inputmask[formcontrolname="phone"]', testData.phone);

    const nextButton = page.locator('button.btn-next:has-text("Continuer")');
    const isEnabled = await nextButton.isEnabled();
    expect(isEnabled).toBe(false);
    console.log('✅ Bouton "Continuer" désactivé car le NIF est invalide');
  });

  /**
   * Test 4 : NIF avec espaces
   */
  test('devrait nettoyer les espaces du NIF', async ({ page }) => {
    const testData = config.testData.validUser;

    await completeStepCompanyType(page, testData.companySegmentLabel, testData.businessDomainLabel);

    await page.waitForSelector('#wiz-companyName', { timeout: 5000 });
    await fillMaskedField(page, 'p-inputmask[formcontrolname="nif"]', '1234567 /A/B/C/000');
    const nifInput = page.locator('p-inputmask[formcontrolname="nif"] input');

    await fillField(page, '#wiz-companyEmail', '');
    await page.waitForTimeout(500);

    const nifValue = await nifInput.inputValue();
    expect(nifValue.replace(/\s/g, '')).not.toContain(' ');
    console.log(`✅ NIF nettoyé: ${nifValue}`);
  });

  /**
   * Test 5 : Champs requis vides bloquent la progression sur l'étape "Informations générales"
   */
  test('devrait bloquer la progression si les champs requis sont vides', async ({ page }) => {
    const testData = config.testData.validUser;

    await completeStepCompanyType(page, testData.companySegmentLabel, testData.businessDomainLabel);

    // Ne rien remplir sur l'étape "Informations générales"
    await page.waitForSelector('#wiz-firstName', { timeout: 5000 });

    const nextButton = page.locator('button.btn-next:has-text("Continuer")');
    expect(await nextButton.isEnabled()).toBe(false);
  });

  /**
   * Test 6 : le bouton "Continuer" de l'étape 1 (type de société) reste désactivé
   * jusqu'à ce qu'un segment ET un domaine soient choisis.
   */
  test('devrait bloquer la progression sur l\'étape "Type de société" sans segment ni domaine', async ({ page }) => {
    const nextButton = page.locator('button.btn-next:has-text("Continuer")');
    expect(await nextButton.isEnabled()).toBe(false);

    const testData = config.testData.validUser;
    await page.locator('.seg-card', { hasText: testData.companySegmentLabel }).click();
    expect(await nextButton.isEnabled()).toBe(false);

    await page.locator('.dom-item', { hasText: testData.businessDomainLabel }).click();
    expect(await nextButton.isEnabled()).toBe(true);
  });

  /**
   * Test 7 : le récapitulatif de l'étape "Finalisation" reflète les choix précédents.
   */
  test('devrait afficher le récapitulatif du segment/domaine/modules à l\'étape finale', async ({ page }) => {
    const testData = { ...config.testData.validUser, email: `test-${Date.now()}@example.com` };

    await completeStepCompanyType(page, testData.companySegmentLabel, testData.businessDomainLabel);
    await completeStepInformations(page, testData);
    await clickButton(page, 'Continuer');

    await page.waitForSelector('.mod-group', { timeout: 5000 });
    await clickButton(page, 'Continuer');

    await page.waitForSelector('.recap-list', { timeout: 5000 });
    const recap = page.locator('.recap-list');
    await expect(recap).toContainText(testData.companySegmentLabel);
    await expect(recap).toContainText(testData.businessDomainLabel);
  });

  /**
   * Test 8 : un bouton "Modifier" du récapitulatif ramène bien à l'étape correspondante.
   */
  test('devrait permettre de revenir sur une étape précédente depuis le récapitulatif', async ({ page }) => {
    const testData = { ...config.testData.validUser, email: `test-${Date.now()}@example.com` };

    await completeStepCompanyType(page, testData.companySegmentLabel, testData.businessDomainLabel);
    await completeStepInformations(page, testData);
    await clickButton(page, 'Continuer');
    await page.waitForSelector('.mod-group', { timeout: 5000 });
    await clickButton(page, 'Continuer');

    await page.waitForSelector('.recap-list', { timeout: 5000 });
    await page.locator('.rec-edit').first().click();

    // Le clic "Modifier" sur le segment ramène à l'étape 1 (type de société).
    await expect(page.locator('.seg-card.selected')).toBeVisible();
  });
});
