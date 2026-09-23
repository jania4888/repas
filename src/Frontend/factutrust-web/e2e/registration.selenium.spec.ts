import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import * as chrome from 'selenium-webdriver/chrome';
import * as firefox from 'selenium-webdriver/firefox';
import { seleniumConfig } from './selenium.config';

/**
 * Tests Selenium pour la fonctionnalité d'inscription
 *
 * Retargeted for the 4-step `RegisterWizardComponent` wizard
 * (registrationWizardV2 flag, see /code/.plans/v1-registration-wizard-erp-config.md):
 *   Étape 1 — Type de société (segment + domaine)
 *   Étape 2 — Informations générales (compte + société)
 *   Étape 3 — Configuration (modules)
 *   Étape 4 — Finalisation (adresse + CGU)
 *
 * The pre-wizard 3-step suite is preserved byte-identical in
 * `registration.legacy.selenium.spec.ts` as the flag-off regression guard.
 *
 * Prérequis :
 * - npm install selenium-webdriver chromedriver
 * - Backend démarré sur https://localhost:7001
 * - Frontend démarré sur http://localhost:4200
 */

describe('Tests Selenium - Inscription FactuTrust (wizard 4 étapes)', () => {
  let driver: WebDriver;
  const config = seleniumConfig;

  beforeAll(async () => {
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
    await driver.get(`${config.baseUrl}/auth/register`);
    await driver.wait(until.elementLocated(By.css('form')), 10000);
    console.log('✅ Page d\'inscription (wizard) chargée');
  });

  afterEach(async () => {
    if (config.screenshots.enabled) {
      await driver.takeScreenshot();
    }
  });

  async function waitForElement(selector: string, timeout = 10000) {
    return await driver.wait(until.elementLocated(By.css(selector)), timeout);
  }

  async function fillField(selector: string, value: string) {
    const field = await waitForElement(selector);
    await field.clear();
    await field.sendKeys(value);
  }

  async function fillPasswordField(selector: string, value: string) {
    const passwordInput = await driver.findElement(By.css(`${selector} input[type="password"]`));
    await passwordInput.clear();
    await passwordInput.sendKeys(value);
  }

  async function fillMaskedField(selector: string, value: string) {
    const maskedInput = await driver.findElement(By.css(`${selector} input`));
    await maskedInput.clear();
    await maskedInput.sendKeys(value);
  }

  async function selectDropdownOption(dropdownSelector: string, optionText: string) {
    const dropdown = await waitForElement(dropdownSelector);
    await dropdown.click();
    await driver.sleep(500);

    const option = await driver.wait(
      until.elementLocated(By.xpath(`//span[contains(text(), '${optionText}')]`)),
      5000
    );
    await option.click();
    await driver.sleep(200);
  }

  async function clickButton(text: string) {
    const button = await driver.wait(
      until.elementLocated(By.xpath(`//button[contains(text(), '${text}')]`)),
      10000
    );
    await button.click();
  }

  async function getErrorMessage(): Promise<string | null> {
    try {
      const errorElement = await driver.findElement(By.css('.global-error'));
      return await errorElement.getText();
    } catch {
      return null;
    }
  }

  /**
   * Étape 1 (index 0) : segment + domaine, puis "Continuer".
   */
  async function completeStepCompanyType(segmentLabel: string, domainLabel: string) {
    const segCard = await driver.wait(
      until.elementLocated(By.xpath(`//div[contains(@class,'seg-card')][.//span[contains(text(), '${segmentLabel}')]]`)),
      5000
    );
    await segCard.click();

    const domItem = await driver.wait(
      until.elementLocated(By.xpath(`//label[contains(@class,'dom-item')][.//span[contains(text(), '${domainLabel}')]]`)),
      5000
    );
    await domItem.click();

    await clickButton('Continuer');
  }

  /**
   * Étape 2 (index 1) : compte + société (fusion des anciennes étapes 1 et 2).
   */
  async function fillStepInformations(testData: typeof config.testData.validUser) {
    await waitForElement('#wiz-firstName');

    await fillField('#wiz-firstName', testData.firstName);
    await fillField('#wiz-lastName', testData.lastName);
    await fillField('#wiz-email', testData.email);
    await fillPasswordField('p-password[formcontrolname="password"]', testData.password);
    await fillPasswordField('p-password[formcontrolname="confirmPassword"]', testData.confirmPassword);

    await fillField('#wiz-companyName', testData.companyName);
    await fillMaskedField('p-inputmask[formcontrolname="nif"]', testData.nif);
    await selectDropdownOption('p-select[formcontrolname="taxRegime"]', 'Régime réel');
    await fillField('#wiz-companyEmail', testData.companyEmail);
    await fillMaskedField('p-inputmask[formcontrolname="phone"]', testData.phone);
  }

  /**
   * Étape 4 (index 3) : adresse + CGU.
   */
  async function fillStepFinalisation(testData: typeof config.testData.validUser) {
    await waitForElement('#wiz-street');

    await fillField('#wiz-street', testData.street);
    await fillField('#wiz-streetLine2', testData.streetLine2);
    await fillField('#wiz-city', testData.city);
    await fillMaskedField('p-inputmask[formcontrolname="postalCode"]', testData.postalCode);
    await selectDropdownOption('p-select[formcontrolname="governorate"]', testData.governorate);

    const cguLabel = await driver.findElement(By.css('label[for="wiz-acceptTerms"]'));
    await cguLabel.click();
  }

  /**
   * Test 1 : NIF avec underscores - Vérifier le nettoyage
   */
  it('devrait nettoyer automatiquement les underscores du NIF au blur', async () => {
    const testData = config.testData.validUser;

    await completeStepCompanyType(testData.companySegmentLabel, testData.businessDomainLabel);

    await waitForElement('#wiz-companyName');
    await fillField('#wiz-companyName', testData.companyName);

    await fillMaskedField('p-inputmask[formcontrolname="nif"]', '1234567A/B/C/000_');
    const nifField = await driver.findElement(By.css('p-inputmask[formcontrolname="nif"] input'));

    await fillField('#wiz-companyEmail', '');
    await driver.sleep(500);

    const nifValue = await nifField.getAttribute('value');
    console.log(`NIF après blur: ${nifValue}`);

    expect(nifValue).not.toContain('_');
    expect(nifValue.toUpperCase().replace(/\s/g, '')).toBe('1234567A/B/C/000');
  }, 60000);

  /**
   * Test 2 : Inscription complète valide (4 étapes)
   */
  it('devrait permettre une inscription complète avec succès', async () => {
    const testData = {
      ...config.testData.validUser,
      email: `test-${Date.now()}@example.com`
    };

    // Étape 1 : Type de société
    await completeStepCompanyType(testData.companySegmentLabel, testData.businessDomainLabel);

    // Étape 2 : Informations générales
    await fillStepInformations(testData);
    await clickButton('Continuer');

    // Étape 3 : Configuration (recommandations par défaut, pas de champ requis)
    await waitForElement('.mod-group');
    await clickButton('Continuer');

    // Étape 4 : Finalisation
    await fillStepFinalisation(testData);

    // Soumettre
    await clickButton('Créer mon espace');

    try {
      await driver.wait(until.urlContains('/dashboard'), 15000);
      const currentUrl = await driver.getCurrentUrl();
      expect(currentUrl).toContain('/dashboard');
      console.log('✅ Inscription réussie, redirection vers dashboard');
    } catch (error) {
      const errorMessage = await getErrorMessage();
      if (errorMessage) {
        console.error(`❌ Erreur lors de l'inscription: ${errorMessage}`);
        throw new Error(`Inscription échouée: ${errorMessage}`);
      }
      throw error;
    }
  }, 90000);

  /**
   * Test 3 : Validation NIF invalide bloque la progression
   */
  it('devrait bloquer la progression avec un NIF invalide', async () => {
    const testData = config.testData.validUser;

    await completeStepCompanyType(testData.companySegmentLabel, testData.businessDomainLabel);

    await waitForElement('#wiz-firstName');
    await fillField('#wiz-firstName', testData.firstName);
    await fillField('#wiz-lastName', testData.lastName);
    await fillField('#wiz-email', `test-${Date.now()}@example.com`);
    await fillPasswordField('p-password[formcontrolname="password"]', testData.password);
    await fillPasswordField('p-password[formcontrolname="confirmPassword"]', testData.confirmPassword);
    await fillField('#wiz-companyName', testData.companyName);

    // NIF incomplet
    await fillMaskedField('p-inputmask[formcontrolname="nif"]', '1234567A/B/C');

    await selectDropdownOption('p-select[formcontrolname="taxRegime"]', 'Régime réel');
    await fillField('#wiz-companyEmail', testData.companyEmail);
    await fillMaskedField('p-inputmask[formcontrolname="phone"]', testData.phone);

    const nextButton = await driver.findElement(By.xpath("//button[contains(@class,'btn-next')][contains(text(), 'Continuer')]"));
    const isEnabled = await nextButton.isEnabled();

    expect(isEnabled).toBe(false);
    console.log('✅ Bouton "Continuer" désactivé car le NIF est invalide');
  }, 60000);

  /**
   * Test 4 : NIF avec espaces - Nettoyage
   */
  it('devrait nettoyer les espaces du NIF', async () => {
    const testData = config.testData.validUser;

    await completeStepCompanyType(testData.companySegmentLabel, testData.businessDomainLabel);

    await waitForElement('#wiz-companyName');
    await fillMaskedField('p-inputmask[formcontrolname="nif"]', '1234567 A/B/C/000');
    const nifField = await driver.findElement(By.css('p-inputmask[formcontrolname="nif"] input'));

    await fillField('#wiz-companyEmail', '');
    await driver.sleep(500);

    const nifValue = await nifField.getAttribute('value');
    expect(nifValue.replace(/\s/g, '')).not.toContain(' ');
  }, 60000);

  /**
   * Test 5 : Validation champs requis vides sur l'étape "Informations générales"
   */
  it('devrait bloquer la progression si les champs requis sont vides', async () => {
    const testData = config.testData.validUser;

    await completeStepCompanyType(testData.companySegmentLabel, testData.businessDomainLabel);

    await waitForElement('#wiz-firstName');

    const nextButton = await driver.findElement(By.xpath("//button[contains(@class,'btn-next')][contains(text(), 'Continuer')]"));
    const isEnabled = await nextButton.isEnabled();

    expect(isEnabled).toBe(false);
  }, 30000);

  /**
   * Test 6 : la première étape ("Type de société") exige à la fois un segment et un domaine
   */
  it('devrait bloquer la progression sur l\'étape "Type de société" sans segment ni domaine', async () => {
    const testData = config.testData.validUser;

    const nextButton = await driver.findElement(By.xpath("//button[contains(@class,'btn-next')][contains(text(), 'Continuer')]"));
    expect(await nextButton.isEnabled()).toBe(false);

    const segCard = await driver.wait(
      until.elementLocated(By.xpath(`//div[contains(@class,'seg-card')][.//span[contains(text(), '${testData.companySegmentLabel}')]]`)),
      5000
    );
    await segCard.click();
    expect(await nextButton.isEnabled()).toBe(false);

    const domItem = await driver.wait(
      until.elementLocated(By.xpath(`//label[contains(@class,'dom-item')][.//span[contains(text(), '${testData.businessDomainLabel}')]]`)),
      5000
    );
    await domItem.click();
    expect(await nextButton.isEnabled()).toBe(true);
  }, 30000);
});
