import { test, expect, Page } from '@playwright/test';
import { seleniumConfig } from './selenium.config';

/**
 * LEGACY REGRESSION SUITE — pre-wizard 3-step `/auth/register` form.
 *
 * `playwright.registration.spec.ts` was retargeted to the new 4-step
 * `RegisterWizardComponent` flow when `environment.featureFlags.registrationWizardV2`
 * shipped as `true` (see /code/.plans/v1-registration-wizard-erp-config.md, decision C6).
 * This file is the frozen "byte-identical legacy selectors" copy of that suite,
 * kept as the flag-off regression guard: `RegisterComponent` (register.component.ts)
 * is untouched by the wizard work and must keep passing this exact suite.
 *
 * This suite only applies when the app is built/served with
 * `featureFlags.registrationWizardV2: false` (legacy form served at `/auth/register`).
 * With the flag `true` (current default), `/auth/register` renders the wizard and
 * every test below will fail on missing legacy selectors (`#firstName`, "Suivant",
 * "Créer mon compte") — that is expected, not a regression in the wizard.
 *
 * To actually run this suite as a regression gate:
 *   1. Temporarily set `registrationWizardV2: false` in `src/environments/environment.ts`.
 *   2. `ng build` (or serve) so `/auth/register` resolves to the legacy `RegisterComponent`.
 *   3. `npx playwright test e2e/playwright.registration.legacy.spec.ts`.
 *   4. Revert the flag.
 *
 * Prérequis :
 * - npm install @playwright/test
 * - npx playwright install
 * - Backend démarré sur https://localhost:7001
 * - Frontend démarré sur http://localhost:4200 avec registrationWizardV2=false
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
      // Essayer une requête GET avec ignoreHTTPSErrors
      const response = await page.request.get(endpoint.url, {
        ignoreHTTPSErrors: true,
        timeout: 2000,
        failOnStatusCode: false // Ne pas échouer sur les codes d'erreur
      });
      const status = response.status();
      
      // 200-499 signifie que le serveur répond (même si c'est une erreur, le serveur est là)
      // 405 Method Not Allowed est aussi OK (le serveur répond)
      // 404 Not Found peut aussi signifier que le serveur répond mais l'endpoint n'existe pas
      if (status < 500) {
        console.log(`✅ Backend détecté via ${endpoint.name} (status: ${status})`);
        return { available: true };
      }
      lastError = `Status ${status} pour ${endpoint.name}`;
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      lastError = errorMsg;
      
      // Si c'est une erreur de timeout, connexion refusée, ou erreur réseau, le serveur n'est pas disponible
      if (
        errorMsg.includes('timeout') || 
        errorMsg.includes('ECONNREFUSED') || 
        errorMsg.includes('net::ERR') ||
        errorMsg.includes('Failed to fetch') ||
        errorMsg.includes('NetworkError') ||
        errorMsg.includes('NS_ERROR')
      ) {
        // Continuer avec le prochain endpoint
        continue;
      }
      // Autres erreurs peuvent signifier que le serveur répond mais avec une erreur
      // Ce qui est OK pour notre vérification - on considère que le serveur est disponible
      console.log(`⚠️ Erreur lors de la vérification ${endpoint.name}: ${errorMsg} (mais le serveur semble répondre)`);
      return { available: true };
    }
  }
  
  return { 
    available: false, 
    reason: `Le backend n'est pas accessible sur https://localhost:7001. Dernière erreur: ${lastError || 'Timeout/Connexion refusée'}. Démarrez-le avec: cd src/Backend/FactuTrust.API && dotnet run` 
  };
}

// Skipped by default: only meaningful when the app is built with
// registrationWizardV2=false (see header comment). Run explicitly with
// LEGACY_REGISTRATION_FLOW=1 once the build/serve step above has been done.
test.describe('Tests Playwright - Inscription FactuTrust (LEGACY, flag OFF only)', () => {
  test.skip(process.env['LEGACY_REGISTRATION_FLOW'] !== '1', 'Legacy 3-step /auth/register form — run only against a registrationWizardV2=false build (see file header).');

  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/register');
    await page.waitForSelector('form', { timeout: 15000 });
    console.log('✅ Page d\'inscription chargée');
  });

  test.afterEach(async ({ page }, testInfo) => {
    // Screenshot en cas d'échec
    if (testInfo.status === 'failed') {
      try {
        await page.screenshot({
          path: `e2e/screenshots/failed-${testInfo.title.replace(/\s+/g, '-')}.png`,
          fullPage: true
        });
      } catch (error) {
        // Ignorer les erreurs de screenshot (page peut être fermée)
        console.warn('Impossible de prendre un screenshot:', error);
      }
    }
  });

  /**
   * Helper : Remplir un champ standard (input, textarea)
   */
  async function fillField(page: Page, selector: string, value: string) {
    await page.fill(selector, value);
  }

  /**
   * Helper : Remplir un champ p-password (PrimeNG)
   * PrimeNG p-password contient un input natif à l'intérieur
   */
  async function fillPasswordField(page: Page, selector: string, value: string) {
    try {
      // Cibler l'input natif à l'intérieur du composant p-password
      const passwordInput = page.locator(`${selector} input[type="password"]`);
      await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
      await passwordInput.fill(value);
    } catch (error) {
      // Fallback: essayer avec un sélecteur alternatif
      const altInput = page.locator(`${selector} input`);
      await altInput.waitFor({ state: 'visible', timeout: 5000 });
      await altInput.fill(value);
    }
  }

  /**
   * Helper : Remplir un champ p-inputmask (PrimeNG)
   * PrimeNG p-inputmask contient un input natif à l'intérieur
   */
  async function fillMaskedField(page: Page, selector: string, value: string) {
    try {
      // Cibler l'input natif à l'intérieur du composant p-inputmask
      const maskedInput = page.locator(`${selector} input`);
      await maskedInput.waitFor({ state: 'visible', timeout: 5000 });
      await maskedInput.fill(value);
    } catch (error) {
      // Fallback: essayer de cliquer puis remplir
      const maskedInput = page.locator(`${selector} input`);
      await maskedInput.click();
      await page.waitForTimeout(200);
      await maskedInput.fill(value);
    }
  }

  /**
   * Helper : Sélectionner une option dans un p-select (PrimeNG)
   */
  async function selectDropdownOption(page: Page, dropdownSelector: string, optionText: string) {
    // Cliquer sur le dropdown pour l'ouvrir
    const dropdown = page.locator(dropdownSelector);
    await dropdown.click();
    await page.waitForTimeout(500);
    
    // Attendre que les options soient visibles (plusieurs sélecteurs possibles)
    try {
      await page.waitForSelector('.p-select-list', { timeout: 5000 });
    } catch {
      // Alternative: attendre le panel
      await page.waitForSelector('.p-select-overlay', { timeout: 5000 });
    }
    
    // Cliquer sur l'option - utiliser plusieurs stratégies
    try {
      // Stratégie 1: texte exact
      await page.locator(`text=${optionText}`).click({ timeout: 3000 });
    } catch {
      // Stratégie 2: span avec texte
      await page.locator(`span:has-text("${optionText}")`).click({ timeout: 3000 });
    }
    
    await page.waitForTimeout(300);
  }

  /**
   * Helper : Cliquer sur un bouton
   */
  async function clickButton(page: Page, text: string) {
    try {
      const button = page.locator(`button:has-text("${text}")`);
      await button.waitFor({ state: 'visible', timeout: 5000 });
      await button.click();
    } catch (error) {
      // Fallback: essayer avec getByRole
      const button = page.getByRole('button', { name: text });
      await button.waitFor({ state: 'visible', timeout: 5000 });
      await button.click();
    }
  }

  /**
   * Helper : Attendre et vérifier un message d'erreur
   */
  async function getErrorMessage(page: Page): Promise<string | null> {
    try {
      const errorElement = page.locator('p-message[severity="error"]');
      await errorElement.waitFor({ state: 'visible', timeout: 5000 });
      const text = await errorElement.textContent();
      // Nettoyer le texte pour enlever les espaces et caractères invisibles
      return text ? text.trim() : null;
    } catch {
      // Essayer aussi de récupérer depuis le texte de la page
      try {
        const errorText = await page.locator('text=/Erreur|erreur|Error|error/').first().textContent();
        return errorText ? errorText.trim() : null;
      } catch {
        return null;
      }
    }
  }

  /**
   * Test 1 : NIF avec underscores - Nettoyage automatique
   */
  test('devrait nettoyer automatiquement les underscores du NIF au blur', async ({ page }) => {
    const testData = config.testData.validUser;

    // Étape 1 : Remplir les informations de compte
    await fillField(page, '#firstName', testData.firstName);
    await fillField(page, '#lastName', testData.lastName);
    await fillField(page, '#email', `test-${Date.now()}@example.com`);
    // p-password nécessite un sélecteur spécial
    await fillPasswordField(page, 'p-password[formcontrolname="password"]', testData.password);
    await fillPasswordField(page, 'p-password[formcontrolname="confirmPassword"]', testData.confirmPassword);
    await clickButton(page, 'Suivant');

    // Attendre l'étape 2
    await page.waitForSelector('input[formcontrolname="companyName"]', { timeout: 5000 });

    // Remplir les champs de l'entreprise
    await fillField(page, 'input[formcontrolname="companyName"]', testData.companyName);

    // Saisir le NIF avec underscore (p-inputmask)
    await fillMaskedField(page, 'p-inputmask[formcontrolname="nif"]', '1234567A/B/C/000_'); // Avec underscore
    const nifInput = page.locator('p-inputmask[formcontrolname="nif"] input');

    // Quitter le champ (blur) - cliquer ailleurs
    await fillField(page, 'input[formcontrolname="companyEmail"]', '');

    // Attendre le nettoyage
    await page.waitForTimeout(500);

    // Vérifier que la valeur est nettoyée
    const nifValue = await nifInput.inputValue();
    console.log(`NIF après blur: ${nifValue}`);

    expect(nifValue).not.toContain('_');
    expect(nifValue.toUpperCase().replace(/\s/g, '')).toBe('1234567A/B/C/000');
  });

  /**
   * Test 2 : Inscription complète valide
   */
  test('devrait permettre une inscription complète avec succès', async ({ page }) => {
    // Vérifier si le backend est disponible AVANT de commencer le test
    console.log('🔍 Vérification de la disponibilité du backend...');
    const backendCheck = await checkBackendAvailable(page);
    if (!backendCheck.available) {
      test.skip();
      console.warn(`\n⚠️ BACKEND NON DISPONIBLE - Test ignoré.`);
      console.warn(`   ${backendCheck.reason || 'Le backend n\'est pas accessible'}`);
      console.warn(`\n   Pour exécuter ce test:`);
      console.warn(`   1. Ouvrez un nouveau terminal`);
      console.warn(`   2. cd src/Backend/FactuTrust.API`);
      console.warn(`   3. dotnet run`);
      console.warn(`   4. Attendez que le backend démarre (vous verrez "Now listening on: https://localhost:7001")`);
      console.warn(`   5. Relancez les tests\n`);
      return;
    }
    
    console.log('✅ Backend disponible, démarrage du test d\'inscription complète\n');
    
    // Test de connexion directe depuis le navigateur pour vérifier CORS et HTTPS
    console.log('🔍 Test de connexion directe au backend depuis le navigateur...');
    try {
      // Test OPTIONS (CORS preflight)
      const corsTest = await page.evaluate(async () => {
        try {
          const response = await fetch('https://localhost:7001/api/auth/register', {
            method: 'OPTIONS',
            headers: {
              'Origin': 'http://localhost:4200',
              'Access-Control-Request-Method': 'POST',
              'Access-Control-Request-Headers': 'content-type'
            }
          });
          return {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            ok: response.ok
          };
        } catch (error: any) {
          return {
            error: error.message || String(error),
            type: error.name || 'Unknown',
            stack: error.stack
          };
        }
      });
      console.log('📊 Résultat du test CORS (OPTIONS):', JSON.stringify(corsTest, null, 2));
      
      // Test POST direct
      const postTest = await page.evaluate(async () => {
        try {
          const response = await fetch('https://localhost:7001/api/auth/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Origin': 'http://localhost:4200'
            },
            body: JSON.stringify({ test: 'data' })
          });
          const text = await response.text();
          return {
            status: response.status,
            ok: response.ok,
            body: text.substring(0, 200)
          };
        } catch (error: any) {
          return {
            error: error.message || String(error),
            type: error.name || 'Unknown',
            stack: error.stack?.substring(0, 500)
          };
        }
      });
      console.log('📊 Résultat du test POST direct:', JSON.stringify(postTest, null, 2));
    } catch (error: any) {
      console.warn('⚠️ Impossible de tester depuis le navigateur:', error.message);
    }
    
    const testData = {
      ...config.testData.validUser,
      email: `test-${Date.now()}@example.com`
    };

    // Étape 1 : Compte
    await fillField(page, '#firstName', testData.firstName);
    await fillField(page, '#lastName', testData.lastName);
    await fillField(page, '#email', testData.email);
    await fillPasswordField(page, 'p-password[formcontrolname="password"]', testData.password);
    await fillPasswordField(page, 'p-password[formcontrolname="confirmPassword"]', testData.confirmPassword);
    await clickButton(page, 'Suivant');

    // Attendre l'étape 2
    await page.waitForSelector('input[formcontrolname="companyName"]', { timeout: 5000 });

    // Étape 2 : Entreprise
    await fillField(page, 'input[formcontrolname="companyName"]', testData.companyName);

    // NIF (p-inputmask) - utiliser fillMaskedField puis blur pour nettoyer
    await fillMaskedField(page, 'p-inputmask[formcontrolname="nif"]', testData.nif);
    // Déclencher blur : focus sur companyEmail puis le remplir (évite clear avec '')
    const companyEmailInput = page.locator('input[formcontrolname="companyEmail"]');
    await companyEmailInput.click();
    await page.waitForTimeout(400);
    await fillField(page, 'input[formcontrolname="companyEmail"]', testData.companyEmail);
    await page.waitForTimeout(500); // Laisser onNifBlur + validation se stabiliser

    // Régime fiscal (p-select)
    await selectDropdownOption(page, 'p-select[formcontrolname="taxRegime"]', 'Régime réel');

    // Téléphone (p-inputmask)
    await fillMaskedField(page, 'p-inputmask[formcontrolname="phone"]', testData.phone);

    await clickButton(page, 'Suivant');

    // Attendre l'étape 3
    await page.waitForSelector('input[formcontrolname="street"]', { timeout: 5000 });

    // Étape 3 : Adresse
    await fillField(page, 'input[formcontrolname="street"]', testData.street);
    await fillField(page, 'input[formcontrolname="streetLine2"]', testData.streetLine2);
    await fillField(page, 'input[formcontrolname="city"]', testData.city);

    // Code postal (p-inputmask)
    await fillMaskedField(page, 'p-inputmask[formcontrolname="postalCode"]', testData.postalCode);

    // Gouvernorat (p-select)
    await selectDropdownOption(page, 'p-select[formcontrolname="governorate"]', testData.governorate);

    // Capturer toutes les requêtes réseau pour diagnostic
    const networkRequests: any[] = [];
    const networkErrors: any[] = [];
    const networkResponses: any[] = [];
    
    // Écouter TOUTES les requêtes pour diagnostic
    const allRequests: any[] = [];
    page.on('request', (request) => {
      allRequests.push({
        url: request.url(),
        method: request.method(),
        timestamp: new Date().toISOString()
      });
    });
    
    // Écouter les requêtes (définir AVANT la soumission)
    const requestListener = (request: any) => {
      const url = request.url();
      // Capturer toutes les requêtes vers l'API
      if (url.includes('/api/') || url.includes('/auth/register')) {
        const requestData = {
          url: url,
          method: request.method(),
          postData: request.postData(),
          timestamp: new Date().toISOString()
        };
        networkRequests.push(requestData);
        console.log(`\n📤 REQUÊTE HTTP: ${request.method()} ${url}`);
        if (request.postData()) {
          try {
            const payload = JSON.parse(request.postData() || '{}');
            const sanitizedPayload = { ...payload, password: '***', confirmPassword: '***' };
            console.log(`📦 Payload envoyé:`, JSON.stringify(sanitizedPayload, null, 2));
          } catch {
            console.log(`📦 Payload (raw): ${request.postData()?.substring(0, 200)}...`);
          }
        }
      }
    };
    
    // Écouter les réponses
    const responseListener = async (response: any) => {
      if (response.url().includes('/auth/register')) {
        const status = response.status();
        const responseData: any = {
          status,
          url: response.url(),
          headers: response.headers(),
          timestamp: new Date().toISOString()
        };
        
        console.log(`\n📥 RÉPONSE HTTP: ${status} ${response.url()}`);
        
        try {
          const body = await response.text();
          responseData.body = body;
          if (status >= 400) {
            console.log(`❌ Corps de la réponse d'erreur (${status}):`);
            try {
              const bodyJson = JSON.parse(body);
              console.log(JSON.stringify(bodyJson, null, 2));
            } catch {
              console.log(body.substring(0, 500));
            }
            networkErrors.push({ ...responseData, body });
          } else if (status >= 200 && status < 300) {
            console.log(`✅ Réponse de succès:`);
            try {
              const bodyJson = JSON.parse(body);
              console.log(JSON.stringify(bodyJson, null, 2));
            } catch {
              console.log(body.substring(0, 200));
            }
            networkResponses.push(responseData);
          }
        } catch (error) {
          console.log(`⚠️ Impossible de lire le corps de la réponse: ${error}`);
        }
      }
    };
    
    // Écouter les échecs de requête
    const requestFailedListener = (request: any) => {
      if (request.url().includes('/auth/register')) {
        const failure = request.failure();
        const errorInfo = {
          type: 'requestfailed',
          url: request.url(),
          failure: failure?.errorText || 'Unknown error',
          failureDetails: failure,
          timestamp: new Date().toISOString()
        };
        console.error(`\n❌ REQUÊTE ÉCHOUÉE: ${request.url()}`);
        console.error(`   Erreur: ${failure?.errorText || 'Unknown'}`);
        networkErrors.push(errorInfo);
      }
    };
    
    // Enregistrer les listeners AVANT la soumission pour capturer toutes les requêtes
    // IMPORTANT: Les listeners doivent être enregistrés AVANT toute interaction avec la page
    page.on('request', requestListener);
    page.on('response', responseListener);
    page.on('requestfailed', requestFailedListener);
    
    // Écouter aussi les requêtes OPTIONS (CORS preflight)
    const corsPreflightListener = (request: any) => {
      if (request.url().includes('/auth/register') && request.method() === 'OPTIONS') {
        console.log(`\n🔄 REQUÊTE CORS PREFLIGHT (OPTIONS): ${request.url()}`);
      }
    };
    
    const corsPreflightResponseListener = async (response: any) => {
      if (response.url().includes('/auth/register') && response.request().method() === 'OPTIONS') {
        const status = response.status();
        console.log(`\n🔄 RÉPONSE CORS PREFLIGHT: ${status}`);
        const headers = response.headers();
        if (headers['access-control-allow-origin']) {
          console.log(`   Access-Control-Allow-Origin: ${headers['access-control-allow-origin']}`);
        }
        if (headers['access-control-allow-methods']) {
          console.log(`   Access-Control-Allow-Methods: ${headers['access-control-allow-methods']}`);
        }
        if (status >= 400) {
          console.error(`   ❌ CORS PREFLIGHT ÉCHOUÉ: ${status}`);
        }
      }
    };
    
    page.on('request', corsPreflightListener);
    page.on('response', corsPreflightResponseListener);

    // Vérifier le payload dans la console avant soumission
    let payloadLogged = false;
    let onSubmitCalled = false;
    let registrationSuccessful = false;
    const consoleMessages: string[] = [];
    
    const consoleListener = (msg: any) => {
      const text = msg.text();
      const type = msg.type();
      consoleMessages.push(`[${type}] ${text}`);
      
      if (text.includes('[RegisterComponent] Submitting registration request')) {
        console.log('\n📤 PAYLOAD DÉTECTÉ DANS CONSOLE:', text);
        payloadLogged = true;
        onSubmitCalled = true;
        // Vérifier que le NIF est nettoyé dans le payload
        if (text.includes('"nif"')) {
          const nifMatch = text.match(/"nif"\s*:\s*"([^"]+)"/);
          if (nifMatch) {
            console.log(`📋 NIF dans payload: ${nifMatch[1]}`);
          }
        }
      }
      
      // Capturer les logs AuthService
      if (text.includes('[AuthService]')) {
        console.log(`🔵 AuthService: ${text}`);
      }
      
      if (text.includes('[RegisterComponent] Registration successful')) {
        console.log('✅ Registration successful détecté dans console');
        registrationSuccessful = true;
      }
      
      // Capturer les erreurs du ErrorHandler
      if (text.includes('[ErrorHandler]')) {
        console.log(`🔴 ErrorHandler: ${text}`);
      }
      
      // Capturer toutes les erreurs
      if (type === 'error') {
        console.error(`❌ Erreur console: ${text}`);
      }
    };
    
    page.on('console', consoleListener);

    // Attendre un peu pour s'assurer que tout est prêt
    await page.waitForTimeout(500);

    // Vérifier que le formulaire est valide avant soumission
    const formValid = await page.evaluate(() => {
      const form = document.querySelector('form');
      if (!form) return false;
      return (form as HTMLFormElement).checkValidity();
    });
    console.log(`📋 Formulaire valide avant soumission: ${formValid}`);
    
    // Vérifier que le bouton est activé
    const submitButton = page.locator('button:has-text("Créer mon compte")');
    const isButtonEnabled = await submitButton.isEnabled();
    console.log(`📋 Bouton "Créer mon compte" activé: ${isButtonEnabled}`);
    
    if (!isButtonEnabled) {
      // Attendre un peu pour que le bouton soit activé
      await page.waitForTimeout(1000);
      const isButtonEnabledAfter = await submitButton.isEnabled();
      console.log(`📋 Bouton activé après attente: ${isButtonEnabledAfter}`);
    }

    // Soumettre
    console.log('🖱️ Clic sur le bouton "Créer mon compte"...');
    
    // Attendre que la requête soit envoyée après le clic
    const requestPromise = new Promise<void>((resolve) => {
      const checkRequest = () => {
        if (networkRequests.length > 0 || networkErrors.length > 0 || networkResponses.length > 0) {
          console.log('✅ Requête HTTP détectée !');
          resolve();
        } else {
          setTimeout(checkRequest, 100);
        }
      };
      // Timeout après 5 secondes
      setTimeout(() => {
        if (networkRequests.length === 0 && networkErrors.length === 0 && networkResponses.length === 0) {
          console.warn('⚠️ Aucune requête HTTP détectée après 5 secondes');
          resolve();
        }
      }, 5000);
      checkRequest();
    });
    
    await clickButton(page, 'Créer mon compte');
    console.log('✅ Bouton cliqué');
    
    // Attendre que la requête soit envoyée
    await requestPromise;
    await page.waitForTimeout(500); // Attendre un peu plus pour les réponses

    // Attendre la redirection ou vérifier le succès
    try {
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      const currentUrl = page.url();
      expect(currentUrl).toContain('/dashboard');
      const skipTour = page.locator('.ft-product-tour__skip, .driver-popover-close-btn, button:has-text("Ignorer")').first();
      if (await skipTour.isVisible().catch(() => false)) {
        await skipTour.click();
      }
      console.log('✅ Inscription réussie, redirection vers dashboard');
    } catch (error) {
      // Attendre un peu pour que le message d'erreur apparaisse
      await page.waitForTimeout(2000);
      
      // Analyser les erreurs réseau en détail
      console.log('\n' + '='.repeat(80));
      console.log('📊 ANALYSE DÉTAILLÉE DES ERREURS RÉSEAU');
      console.log('='.repeat(80));
      console.log(`   Requêtes envoyées (vers /api/): ${networkRequests.length}`);
      console.log(`   Toutes les requêtes HTTP: ${allRequests.length}`);
      console.log(`   Réponses reçues: ${networkResponses.length}`);
      console.log(`   Erreurs détectées: ${networkErrors.length}`);
      console.log(`   onSubmit appelé: ${onSubmitCalled}`);
      console.log(`   Payload loggé: ${payloadLogged}`);
      console.log(`   Registration successful: ${registrationSuccessful}`);
      
      // Afficher les dernières requêtes pour diagnostic
      if (allRequests.length > 0) {
        console.log('\n📋 DERNIÈRES REQUÊTES HTTP (toutes):');
        allRequests.slice(-10).forEach((req, idx) => {
          console.log(`   ${idx + 1}. ${req.method} ${req.url}`);
        });
      }
      
      // Afficher les messages console pertinents
      if (consoleMessages.length > 0) {
        console.log('\n📋 MESSAGES CONSOLE PERTINENTS:');
        consoleMessages
          .filter(msg => msg.includes('RegisterComponent') || msg.includes('ErrorHandler') || msg.includes('error'))
          .forEach(msg => console.log(`   ${msg}`));
      }
      
      if (networkRequests.length === 0) {
        console.error('\n❌ PROBLÈME CRITIQUE: Aucune requête HTTP n\'a été envoyée !');
        console.error('   Cela peut indiquer:');
        console.error('   1. Le formulaire n\'a pas été soumis');
        console.error('   2. Une erreur JavaScript a bloqué la soumission');
        console.error('   3. La validation frontend a empêché la soumission');
        console.error('\n   Vérifications à faire:');
        console.error(`   - onSubmit appelé: ${onSubmitCalled}`);
        console.error(`   - Payload loggé: ${payloadLogged}`);
        
        // Vérifier l'état du formulaire
        const formValid = await page.evaluate(() => {
          const form = document.querySelector('form');
          if (!form) return false;
          return (form as HTMLFormElement).checkValidity();
        });
        console.error(`   - Formulaire valide: ${formValid}`);
        
        // Vérifier si le bouton est désactivé
        const submitButton = page.locator('button:has-text("Créer mon compte")');
        const isButtonEnabled = await submitButton.isEnabled();
        console.error(`   - Bouton "Créer mon compte" activé: ${isButtonEnabled}`);
        
        // Vérifier les erreurs de validation
        const validationErrors = await page.evaluate(() => {
          const errors: string[] = [];
          document.querySelectorAll('.p-invalid, .ng-invalid').forEach(el => {
            const errorText = el.textContent || el.getAttribute('aria-label') || '';
            if (errorText) errors.push(errorText);
          });
          return errors;
        });
        if (validationErrors.length > 0) {
          console.error(`   - Erreurs de validation détectées: ${validationErrors.join(', ')}`);
        }
      }
      
      if (networkErrors.length > 0) {
        console.error('\n🔴 DÉTAILS DES ERREURS RÉSEAU:');
        networkErrors.forEach((error, index) => {
          console.error(`\n   Erreur ${index + 1}:`);
          console.error(`   - Type: ${error.type || 'HTTP Error'}`);
          console.error(`   - URL: ${error.url}`);
          if (error.status) {
            console.error(`   - Status: ${error.status}`);
            
            // Messages spécifiques selon le status
            if (error.status === 500) {
              console.error(`   ⚠️ ERREUR SERVEUR (500): Le backend a rencontré une erreur interne.`);
              console.error(`      Cela indique généralement un problème de base de données ou de configuration backend.`);
            } else if (error.status === 400) {
              console.error(`   ⚠️ ERREUR VALIDATION (400): Les données envoyées sont invalides.`);
            } else if (error.status === 401) {
              console.error(`   ⚠️ ERREUR AUTHENTIFICATION (401): Non autorisé.`);
            } else if (error.status === 403) {
              console.error(`   ⚠️ ERREUR AUTORISATION (403): Accès interdit.`);
            }
          }
          if (error.failure) {
            console.error(`   - Échec réseau: ${error.failure}`);
          }
          if (error.body) {
            try {
              const bodyJson = JSON.parse(error.body);
              console.error(`   - Corps (JSON):`, JSON.stringify(bodyJson, null, 2));
              
              // Extraire les messages d'erreur du backend
              if (bodyJson.errors && typeof bodyJson.errors === 'object') {
                const errorMessages: string[] = [];
                Object.values(bodyJson.errors).forEach((err: any) => {
                  if (Array.isArray(err)) {
                    errorMessages.push(...err);
                  } else if (typeof err === 'string') {
                    errorMessages.push(err);
                  }
                });
                if (errorMessages.length > 0) {
                  console.error(`   - Messages d'erreur backend: ${errorMessages.join(', ')}`);
                }
              }
              if (bodyJson.message) {
                console.error(`   - Message backend: ${bodyJson.message}`);
              }
            } catch {
              console.error(`   - Corps (texte): ${error.body.substring(0, 500)}`);
            }
          }
        });
      }
      
      // Vérifier s'il y a une erreur affichée dans l'UI
      const errorMessage = await getErrorMessage(page);
      
      // Capturer les erreurs de la console
      const consoleErrors: string[] = [];
      const consoleListener = (msg: any) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      };
      page.on('console', consoleListener);
      
      // Attendre un peu pour capturer toutes les erreurs
      await page.waitForTimeout(500);
      
      if (errorMessage) {
        // Nettoyer le message d'erreur
        const cleanMessage = errorMessage.replace(/Erreur undefined\.?\s*/i, '').trim();
        const finalMessage = cleanMessage || 'Erreur de connexion. Vérifiez que le backend est démarré.';
        console.error(`\n❌ ERREUR AFFICHÉE DANS L'UI: ${finalMessage}`);
        if (consoleErrors.length > 0) {
          console.error(`❌ ERREURS CONSOLE: ${consoleErrors.join(' | ')}`);
        }
        
        // Construire un message d'erreur détaillé
        let detailedError = `Inscription échouée: ${finalMessage}`;
        if (networkErrors.length > 0) {
          const firstError = networkErrors[0];
          if (firstError.failure) {
            detailedError += `\n   Cause réseau: ${firstError.failure}`;
          } else if (firstError.status) {
            detailedError += `\n   Status HTTP: ${firstError.status}`;
            
            // Messages spécifiques selon le status
            if (firstError.status === 500) {
              detailedError += ` (Erreur serveur - Vérifiez les logs backend et la base de données)`;
            } else if (firstError.status === 400) {
              detailedError += ` (Erreur de validation - Vérifiez les données envoyées)`;
            }
            
            if (firstError.body) {
              try {
                const bodyJson = JSON.parse(firstError.body);
                if (bodyJson.message) {
                  detailedError += `\n   Message serveur: ${bodyJson.message}`;
                }
                
                // Extraire les erreurs de validation
                if (bodyJson.errors && typeof bodyJson.errors === 'object') {
                  const errorMessages: string[] = [];
                  Object.values(bodyJson.errors).forEach((err: any) => {
                    if (Array.isArray(err)) {
                      errorMessages.push(...err);
                    } else if (typeof err === 'string') {
                      errorMessages.push(err);
                    }
                  });
                  if (errorMessages.length > 0) {
                    detailedError += `\n   Erreurs: ${errorMessages.join(', ')}`;
                  }
                } else if (Array.isArray(bodyJson.errors)) {
                  detailedError += `\n   Erreurs: ${bodyJson.errors.join(', ')}`;
                }
              } catch {
                detailedError += `\n   Réponse: ${firstError.body.substring(0, 200)}`;
              }
            }
          }
        }
        
        throw new Error(detailedError);
      }
      
      // Si pas de message d'erreur mais timeout, analyser plus en détail
      if (networkErrors.length > 0) {
        const firstError = networkErrors[0];
        if (firstError.failure) {
          throw new Error(`Inscription échouée: ${firstError.failure} - Le backend n'est probablement pas démarré sur https://localhost:7001`);
        } else if (firstError.status) {
          let errorMsg = `Inscription échouée: HTTP ${firstError.status}`;
          if (firstError.body) {
            try {
              const bodyJson = JSON.parse(firstError.body);
              errorMsg += ` - ${bodyJson.message || JSON.stringify(bodyJson)}`;
            } catch {
              errorMsg += ` - ${firstError.body.substring(0, 200)}`;
            }
          }
          throw new Error(errorMsg);
        }
      }
      
      // Dernier recours
      console.error('\n❌ TIMEOUT: Aucune réponse du serveur');
      throw new Error('Inscription échouée: Timeout - Le backend n\'est probablement pas démarré sur https://localhost:7001. Vérifiez que le backend est démarré et accessible.');
    }
  });

  /**
   * Test 3 : Validation NIF invalide
   */
  test('devrait bloquer la soumission avec un NIF invalide', async ({ page }) => {
    const testData = {
      ...config.testData.validUser,
      email: `test-${Date.now()}@example.com`
    };

    // Aller à l'étape 2
    await fillField(page, '#firstName', testData.firstName);
    await fillField(page, '#lastName', testData.lastName);
    await fillField(page, '#email', testData.email);
    await fillPasswordField(page, 'p-password[formcontrolname="password"]', testData.password);
    await fillPasswordField(page, 'p-password[formcontrolname="confirmPassword"]', testData.confirmPassword);
    await clickButton(page, 'Suivant');

    await page.waitForSelector('input[formcontrolname="companyName"]', { timeout: 5000 });

    // Remplir avec un NIF invalide
    await fillField(page, 'input[formcontrolname="companyName"]', testData.companyName);

    // NIF incomplet (p-inputmask)
    await fillMaskedField(page, 'p-inputmask[formcontrolname="nif"]', '1234567/A/B'); // Incomplet

    // Sélectionner régime fiscal (p-select)
    await selectDropdownOption(page, 'p-select[formcontrolname="taxRegime"]', 'Régime réel');

    await fillField(page, 'input[formcontrolname="companyEmail"]', testData.companyEmail);

    // Téléphone (p-inputmask)
    await fillMaskedField(page, 'p-inputmask[formcontrolname="phone"]', testData.phone);

    // Vérifier que le bouton est désactivé ou qu'il y a une erreur
    const nextButton = page.locator('button:has-text("Suivant")');
    const isEnabled = await nextButton.isEnabled();

    if (!isEnabled) {
      console.log('✅ Bouton désactivé car validation frontend active');
    } else {
      // Essayer de cliquer et vérifier l'erreur
      await nextButton.click();
      await page.waitForTimeout(1000);

      const errorMessage = await getErrorMessage(page);
      expect(errorMessage).toBeTruthy();
      expect(errorMessage?.toLowerCase()).toContain('nif');
    }
  });

  /**
   * Test 4 : NIF avec espaces
   */
  test('devrait nettoyer les espaces du NIF', async ({ page }) => {
    // Aller à l'étape 2
    await fillField(page, '#firstName', config.testData.validUser.firstName);
    await fillField(page, '#lastName', config.testData.validUser.lastName);
    await fillField(page, '#email', `test-${Date.now()}@example.com`);
    await fillPasswordField(page, 'p-password[formcontrolname="password"]', config.testData.validUser.password);
    await fillPasswordField(page, 'p-password[formcontrolname="confirmPassword"]', config.testData.validUser.confirmPassword);
    await clickButton(page, 'Suivant');

    await page.waitForSelector('input[formcontrolname="companyName"]', { timeout: 5000 });

    // Saisir NIF avec espaces (p-inputmask)
    await fillMaskedField(page, 'p-inputmask[formcontrolname="nif"]', '1234567 /A/B/C/000'); // Avec espaces
    const nifInput = page.locator('p-inputmask[formcontrolname="nif"] input');

    // Blur
    await fillField(page, 'input[formcontrolname="companyEmail"]', '');
    await page.waitForTimeout(500);

    // Vérifier nettoyage
    const nifValue = await nifInput.inputValue();
    expect(nifValue.replace(/\s/g, '')).not.toContain(' ');
    console.log(`✅ NIF nettoyé: ${nifValue}`);
  });

  /**
   * Test 5 : Validation champs requis
   */
  test('devrait bloquer la soumission si les champs requis sont vides', async ({ page }) => {
    // Aller à l'étape 2
    await fillField(page, '#firstName', config.testData.validUser.firstName);
    await fillField(page, '#lastName', config.testData.validUser.lastName);
    await fillField(page, '#email', `test-${Date.now()}@example.com`);
    await fillPasswordField(page, 'p-password[formcontrolname="password"]', config.testData.validUser.password);
    await fillPasswordField(page, 'p-password[formcontrolname="confirmPassword"]', config.testData.validUser.confirmPassword);
    await clickButton(page, 'Suivant');

    await page.waitForSelector('input[formcontrolname="companyName"]', { timeout: 5000 });

    // Ne pas remplir le NIF (champ requis)
    const nextButton = page.locator('button:has-text("Suivant")');
    const isEnabled = await nextButton.isEnabled();

    expect(isEnabled).toBe(false);
  });

  /**
   * Test 6 : Vérifier les logs dans la console
   */
  test('devrait logger le payload de soumission dans la console', async ({ page }) => {
    const testData = {
      ...config.testData.validUser,
      email: `test-${Date.now()}@example.com`
    };

    let payloadLogged = false;

    // Écouter les logs de la console (le payload peut être tronqué dans msg.text())
    page.on('console', msg => {
      if (msg.text().includes('[RegisterComponent] Submitting registration request')) {
        payloadLogged = true;
        console.log('📤 Payload capturé:', msg.text());
        const payloadText = msg.text();
        if (payloadText.includes('nif')) {
          expect(payloadText).toContain('1234567A/B/C/000');
          expect(payloadText).not.toContain('_');
        }
      }
    });

    // Compléter jusqu'à la soumission (simplifié)
    await fillField(page, '#firstName', testData.firstName);
    await fillField(page, '#lastName', testData.lastName);
    await fillField(page, '#email', testData.email);
    await fillPasswordField(page, 'p-password[formcontrolname="password"]', testData.password);
    await fillPasswordField(page, 'p-password[formcontrolname="confirmPassword"]', testData.confirmPassword);
    await clickButton(page, 'Suivant');

    await page.waitForSelector('input[formcontrolname="companyName"]', { timeout: 5000 });

    await fillField(page, 'input[formcontrolname="companyName"]', testData.companyName);

    // NIF avec underscore pour tester le nettoyage (p-inputmask)
    await fillMaskedField(page, 'p-inputmask[formcontrolname="nif"]', '1234567A/B/C/000_');

    // Régime fiscal (p-select)
    await selectDropdownOption(page, 'p-select[formcontrolname="taxRegime"]', 'Régime réel');

    await fillField(page, 'input[formcontrolname="companyEmail"]', testData.companyEmail);

    // Téléphone (p-inputmask)
    await fillMaskedField(page, 'p-inputmask[formcontrolname="phone"]', testData.phone);

    await clickButton(page, 'Suivant');

    await page.waitForSelector('input[formcontrolname="street"]', { timeout: 5000 });

    await fillField(page, 'input[formcontrolname="street"]', testData.street);
    await fillField(page, 'input[formcontrolname="city"]', testData.city);

    // Gouvernorat (p-select)
    await selectDropdownOption(page, 'p-select[formcontrolname="governorate"]', testData.governorate);

    // Soumettre pour déclencher le log du payload
    await clickButton(page, 'Créer mon compte');
    await page.waitForTimeout(2000);

    expect(payloadLogged).toBe(true);
  });
});
