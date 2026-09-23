import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import * as chrome from 'selenium-webdriver/chrome';
import * as firefox from 'selenium-webdriver/firefox';
import { seleniumConfig } from './selenium.config';

/**
 * LEGACY REGRESSION SUITE — pre-wizard 3-step `/auth/register` form.
 *
 * `registration.selenium.spec.ts` was retargeted to the new 4-step
 * `RegisterWizardComponent` flow when `environment.featureFlags.registrationWizardV2`
 * shipped as `true` (see /code/.plans/v1-registration-wizard-erp-config.md, decision C6).
 * This file is the frozen "byte-identical legacy selectors" copy of that suite,
 * kept as the flag-off regression guard: `RegisterComponent` (register.component.ts)
 * is untouched by the wizard work and must keep passing this exact suite.
 *
 * Skipped by default (xdescribe) because it only makes sense against a build with
 * `registrationWizardV2: false` (legacy form served at `/auth/register`). To run it:
 *   1. Temporarily set `registrationWizardV2: false` in `src/environments/environment.ts`.
 *   2. `ng build` (or serve) so `/auth/register` resolves to the legacy `RegisterComponent`.
 *   3. Change `xdescribe` below back to `describe` and run this file.
 *      e.g. `ts-node node_modules/jasmine/bin/jasmine.js e2e/registration.legacy.selenium.spec.ts`
 *   4. Revert both changes afterwards.
 *
 * Note: this file is named `*.selenium.spec.ts` (not `*.spec.ts` alone) so that
 * Playwright's `testIgnore: /.*\.selenium\.spec\.ts$/` (see playwright.config.ts)
 * excludes it from `playwright test` runs — it is a Jasmine/Selenium file, not a
 * Playwright test file, and would fail to load under the Playwright runner.
 *
 * Prérequis :
 * - npm install selenium-webdriver chromedriver
 * - Backend démarré sur https://localhost:7001
 * - Frontend démarré sur http://localhost:4200 avec registrationWizardV2=false
 */

xdescribe('Tests Selenium - Inscription FactuTrust (LEGACY, flag OFF only)', () => {
  let driver: WebDriver;
  const config = seleniumConfig;

  beforeAll(async () => {
    // Configuration du driver selon le navigateur
    const options = new chrome.Options();
    if (config.headless) {
      options.addArguments('--headless');
    }
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--window-size=1920,1080');

    driver = await new Builder()
      .forBrowser(config.browser)
      .setChromeOptions(options)
      .build();

    await driver.manage().setTimeouts({
      implicit: config.timeouts.implicit,
      pageLoad: config.timeouts.pageLoad,
      script: config.timeouts.script
    });

    console.log('✅ WebDriver initialisé');
  });

  afterAll(async () => {
    if (driver) {
      await driver.quit();
      console.log('✅ WebDriver fermé');
    }
  });

  beforeEach(async () => {
    // Naviguer vers la page d'inscription avant chaque test
    await driver.get(`${config.baseUrl}/auth/register`);
    await driver.wait(until.elementLocated(By.css('form')), 10000);
    console.log('✅ Page d\'inscription chargée');
  });

  afterEach(async () => {
    // Screenshot en cas d'échec
    if (config.screenshots.enabled) {
      const screenshot = await driver.takeScreenshot();
      // Sauvegarder le screenshot si nécessaire
    }
  });

  /**
   * Helper : Attendre que l'élément soit visible et cliquable
   */
  async function waitForElement(selector: string, timeout = 10000) {
    return await driver.wait(
      until.elementLocated(By.css(selector)),
      timeout
    );
  }

  /**
   * Helper : Remplir un champ de formulaire standard
   */
  async function fillField(selector: string, value: string) {
    const field = await waitForElement(selector);
    await field.clear();
    await field.sendKeys(value);
  }

  /**
   * Helper : Remplir un champ p-password (PrimeNG)
   * PrimeNG p-password contient un input natif à l'intérieur
   */
  async function fillPasswordField(selector: string, value: string) {
    const passwordInput = await driver.findElement(By.css(`${selector} input[type="password"]`));
    await passwordInput.clear();
    await passwordInput.sendKeys(value);
  }

  /**
   * Helper : Remplir un champ p-inputmask (PrimeNG)
   * PrimeNG p-inputmask contient un input natif à l'intérieur
   */
  async function fillMaskedField(selector: string, value: string) {
    const maskedInput = await driver.findElement(By.css(`${selector} input`));
    await maskedInput.clear();
    await maskedInput.sendKeys(value);
  }

  /**
   * Helper : Sélectionner une option dans un p-select (PrimeNG)
   */
  async function selectDropdownOption(dropdownSelector: string, optionText: string) {
    // Cliquer sur le dropdown pour l'ouvrir
    const dropdown = await waitForElement(dropdownSelector);
    await dropdown.click();
    await driver.sleep(500);
    
    // Attendre que les options soient visibles et cliquer sur l'option
    const option = await driver.wait(
      until.elementLocated(By.xpath(`//span[contains(text(), '${optionText}')]`)),
      5000
    );
    await option.click();
    await driver.sleep(200);
  }

  /**
   * Helper : Cliquer sur un bouton
   */
  async function clickButton(text: string) {
    const button = await driver.wait(
      until.elementLocated(By.xpath(`//button[contains(text(), '${text}')]`)),
      10000
    );
    await button.click();
  }

  /**
   * Helper : Vérifier la présence d'un message d'erreur
   */
  async function getErrorMessage(): Promise<string | null> {
    try {
      const errorElement = await driver.findElement(By.css('p-message[severity="error"]'));
      return await errorElement.getText();
    } catch {
      return null;
    }
  }

  /**
   * Test 1 : NIF avec underscores - Vérifier le nettoyage
   */
  it('devrait nettoyer automatiquement les underscores du NIF au blur', async () => {
    const testData = config.testData.validUser;

    // Aller à l'étape 2 (Entreprise)
    await fillField('#firstName', testData.firstName);
    await fillField('#lastName', testData.lastName);
    await fillField('#email', testData.email);
    await fillPasswordField('p-password[formcontrolname="password"]', testData.password);
    await fillPasswordField('p-password[formcontrolname="confirmPassword"]', testData.confirmPassword);
    await clickButton('Suivant');

    // Attendre l'étape 2
    await driver.wait(until.elementLocated(By.css('input[formcontrolname="companyName"]')), 5000);

    // Remplir les champs de l'entreprise
    await fillField('input[formcontrolname="companyName"]', testData.companyName);
    
    // Saisir le NIF avec underscore (p-inputmask)
    await fillMaskedField('p-inputmask[formcontrolname="nif"]', '1234567A/B/C/000_'); // Avec underscore
    const nifField = await driver.findElement(By.css('p-inputmask[formcontrolname="nif"] input'));
    
    // Quitter le champ (blur) - cliquer ailleurs
    await fillField('input[formcontrolname="companyEmail"]', '');
    
    // Attendre un peu pour que le nettoyage se fasse
    await driver.sleep(500);
    
    // Vérifier que la valeur est nettoyée
    const nifValue = await nifField.getAttribute('value');
    console.log(`NIF après blur: ${nifValue}`);
    
    expect(nifValue).not.toContain('_');
    expect(nifValue.toUpperCase().replace(/\s/g, '')).toBe('1234567A/B/C/000');
  }, 60000);

  /**
   * Test 2 : Inscription complète valide
   */
  it('devrait permettre une inscription complète avec succès', async () => {
    const testData = {
      ...config.testData.validUser,
      email: `test-${Date.now()}@example.com` // Email unique
    };

    // Étape 1 : Compte
    await fillField('#firstName', testData.firstName);
    await fillField('#lastName', testData.lastName);
    await fillField('#email', testData.email);
    await fillPasswordField('p-password[formcontrolname="password"]', testData.password);
    await fillPasswordField('p-password[formcontrolname="confirmPassword"]', testData.confirmPassword);
    await clickButton('Suivant');

    // Attendre l'étape 2
    await driver.wait(until.elementLocated(By.css('input[formcontrolname="companyName"]')), 5000);

    // Étape 2 : Entreprise
    await fillField('input[formcontrolname="companyName"]', testData.companyName);
    
    // NIF (p-inputmask)
    await fillMaskedField('p-inputmask[formcontrolname="nif"]', testData.nif);
    
    // Sélectionner régime fiscal (p-select)
    await selectDropdownOption('p-select[formcontrolname="taxRegime"]', 'Régime réel');
    
    await fillField('input[formcontrolname="companyEmail"]', testData.companyEmail);
    
    // Téléphone (p-inputmask)
    await fillMaskedField('p-inputmask[formcontrolname="phone"]', testData.phone);
    
    await clickButton('Suivant');

    // Attendre l'étape 3
    await driver.wait(until.elementLocated(By.css('input[formcontrolname="street"]')), 5000);

    // Étape 3 : Adresse
    await fillField('input[formcontrolname="street"]', testData.street);
    await fillField('input[formcontrolname="streetLine2"]', testData.streetLine2);
    await fillField('input[formcontrolname="city"]', testData.city);
    
    // Code postal (p-inputmask)
    await fillMaskedField('p-inputmask[formcontrolname="postalCode"]', testData.postalCode);
    
    // Sélectionner gouvernorat (p-select)
    await selectDropdownOption('p-select[formcontrolname="governorate"]', testData.governorate);

    // Soumettre le formulaire
    await clickButton('Créer mon compte');

    // Attendre la redirection ou un message de succès
    try {
      // Vérifier si on est redirigé vers le dashboard
      await driver.wait(
        until.urlContains('/dashboard'),
        15000
      );
      
      const currentUrl = await driver.getCurrentUrl();
      expect(currentUrl).toContain('/dashboard');
      console.log('✅ Inscription réussie, redirection vers dashboard');
    } catch (error) {
      // Vérifier s'il y a une erreur
      const errorMessage = await getErrorMessage();
      if (errorMessage) {
        console.error(`❌ Erreur lors de l'inscription: ${errorMessage}`);
        throw new Error(`Inscription échouée: ${errorMessage}`);
      }
      throw error;
    }
  }, 90000);

  /**
   * Test 3 : Validation NIF invalide
   */
  it('devrait bloquer la soumission avec un NIF invalide', async () => {
    const testData = config.testData.validUser;

    // Aller à l'étape 2
    await fillField('#firstName', testData.firstName);
    await fillField('#lastName', testData.lastName);
    await fillField('#email', `test-${Date.now()}@example.com`);
    await fillPasswordField('p-password[formcontrolname="password"]', testData.password);
    await fillPasswordField('p-password[formcontrolname="confirmPassword"]', testData.confirmPassword);
    await clickButton('Suivant');

    await driver.wait(until.elementLocated(By.css('input[formcontrolname="companyName"]')), 5000);

    // Remplir avec un NIF invalide
    await fillField('input[formcontrolname="companyName"]', testData.companyName);

    // NIF incomplet (p-inputmask)
    await fillMaskedField('p-inputmask[formcontrolname="nif"]', '1234567A/B/C'); // Incomplet

    // Sélectionner régime fiscal (p-select)
    await selectDropdownOption('p-select[formcontrolname="taxRegime"]', 'Régime réel');
    
    await fillField('input[formcontrolname="companyEmail"]', testData.companyEmail);
    
    // Téléphone (p-inputmask)
    await fillMaskedField('p-inputmask[formcontrolname="phone"]', testData.phone);
    
    // Essayer de passer à l'étape suivante
    const nextButton = await driver.findElement(By.xpath("//button[contains(text(), 'Suivant')]"));
    const isEnabled = await nextButton.isEnabled();
    
    // Le bouton devrait être désactivé si le NIF est invalide
    // OU il devrait y avoir un message d'erreur après soumission
    if (isEnabled) {
      await nextButton.click();
      
      // Vérifier le message d'erreur
      await driver.sleep(1000);
      const errorMessage = await getErrorMessage();
      expect(errorMessage).toBeTruthy();
      expect(errorMessage).toContain('NIF');
    } else {
      console.log('✅ Bouton désactivé car validation frontend active');
    }
  }, 60000);

  /**
   * Test 4 : Erreur réseau - Backend non accessible
   */
  it('devrait afficher un message d\'erreur clair si le backend n\'est pas accessible', async () => {
    // Note: Ce test nécessite d'arrêter le backend manuellement
    // ou d'utiliser un mock
    
    const testData = {
      ...config.testData.validUser,
      email: `test-${Date.now()}@example.com`
    };

    // Compléter toutes les étapes rapidement
    // (Simplifié pour cet exemple)
    
    // Essayer de soumettre
    // Vérifier que le message d'erreur contient "se connecter au serveur"
    
    // Ce test devrait être adapté selon votre stratégie de test
    console.log('⚠️ Test d\'erreur réseau nécessite un backend arrêté');
  }, 30000);

  /**
   * Test 5 : NIF avec espaces - Nettoyage
   */
  it('devrait nettoyer les espaces du NIF', async () => {
    // Aller à l'étape 2
    await fillField('#firstName', config.testData.validUser.firstName);
    await fillField('#lastName', config.testData.validUser.lastName);
    await fillField('#email', `test-${Date.now()}@example.com`);
    await fillPasswordField('p-password[formcontrolname="password"]', config.testData.validUser.password);
    await fillPasswordField('p-password[formcontrolname="confirmPassword"]', config.testData.validUser.confirmPassword);
    await clickButton('Suivant');

    await driver.wait(until.elementLocated(By.css('input[formcontrolname="companyName"]')), 5000);

    // Saisir NIF avec espaces (p-inputmask)
    await fillMaskedField('p-inputmask[formcontrolname="nif"]', '1234567 A/B/C/000'); // Avec espaces
    const nifField = await driver.findElement(By.css('p-inputmask[formcontrolname="nif"] input'));
    
    // Blur
    await fillField('input[formcontrolname="companyEmail"]', '');
    await driver.sleep(500);
    
    // Vérifier nettoyage
    const nifValue = await nifField.getAttribute('value');
    expect(nifValue.replace(/\s/g, '')).not.toContain(' ');
  }, 60000);

  /**
   * Test 6 : Validation champs requis
   */
  it('devrait bloquer la soumission si les champs requis sont vides', async () => {
    // Aller à l'étape 2
    await fillField('#firstName', config.testData.validUser.firstName);
    await fillField('#lastName', config.testData.validUser.lastName);
    await fillField('#email', `test-${Date.now()}@example.com`);
    await fillPasswordField('p-password[formcontrolname="password"]', config.testData.validUser.password);
    await fillPasswordField('p-password[formcontrolname="confirmPassword"]', config.testData.validUser.confirmPassword);
    await clickButton('Suivant');

    await driver.wait(until.elementLocated(By.css('input[formcontrolname="companyName"]')), 5000);

    // Ne pas remplir le NIF (champ requis)
    // Essayer de passer à l'étape suivante
    const nextButton = await driver.findElement(By.xpath("//button[contains(text(), 'Suivant')]"));
    const isEnabled = await nextButton.isEnabled();
    
    expect(isEnabled).toBe(false);
  }, 30000);
});
