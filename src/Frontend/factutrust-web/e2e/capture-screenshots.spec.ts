/**
 * Script Playwright pour capturer les screenshots de la documentation utilisateur.
 *
 * Prérequis :
 * - Backend démarré (port 7000/7001)
 * - Frontend démarré (port 4200)
 * - Compte de test créé (email/mot de passe via variables d'environnement)
 *
 * Exécution :
 *   cd src/Frontend/factutrust-web
 *   set DOC_EMAIL=your@email.com
 *   set DOC_PASSWORD=YourPassword
 *   npx playwright test capture-screenshots --project=chromium
 *
 * Les screenshots sont sauvegardés dans docs/screenshots/
 */

import { test } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const SCREENSHOTS_BASE = path.join(__dirname, '..', '..', '..', '..', 'docs', 'screenshots');

async function takeScreenshot(page: any, subdir: string, name: string) {
  const dir = path.join(SCREENSHOTS_BASE, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`  Screenshot: ${filepath}`);
}

test.describe('Capture screenshots pour documentation', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    const hasCreds = !!(process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL) &&
      !!(process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD);
    if (!hasCreds) {
      console.log('\n--- DOC_EMAIL et DOC_PASSWORD non définis ---');
      console.log('Seules les captures du chapitre 01 (pages publiques) seront générées.');
      console.log('Pour toutes les captures (chapitres 02-09), exécutez avec :');
      console.log('  $env:DOC_EMAIL="votre@email.com"; $env:DOC_PASSWORD="VotreMotDePasse"; npm run docs:screenshots');
      console.log('---\n');
    }
  });

  test('01 - Page d\'accueil (landing)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '01-premiers-pas', 'landing');
  });

  test('02 - Page de connexion', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '01-premiers-pas', 'connexion');
  });

  test('03 - Inscription étape 1', async ({ page }) => {
    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('input#firstName', { timeout: 10000 });
    await takeScreenshot(page, '01-premiers-pas', 'inscription-etape1');
  });

  test('04 - Inscription étape 2', async ({ page }) => {
    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');
    await page.fill('input#firstName', 'Prénom');
    await page.fill('input#lastName', 'Nom');
    await page.fill('input[formcontrolname="email"]', 'test@example.com');
    const pwdInput = page.locator('p-password[formcontrolname="password"] input');
    await pwdInput.fill('Test1234@Password');
    const confirmPwd = page.locator('p-password[formcontrolname="confirmPassword"] input');
    await confirmPwd.fill('Test1234@Password');
    await page.click('button:has-text("Suivant")');
    await page.waitForSelector('input[formcontrolname="companyName"]', { timeout: 5000 });
    await takeScreenshot(page, '01-premiers-pas', 'inscription-etape2');
  });

  test('05 - Inscription étape 3', async ({ page }) => {
    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');
    await page.fill('input#firstName', 'Prénom');
    await page.fill('input#lastName', 'Nom');
    await page.fill('input[formcontrolname="email"]', 'test@example.com');
    const pwdInput = page.locator('p-password[formcontrolname="password"] input');
    await pwdInput.fill('Test1234@Password');
    const confirmPwd = page.locator('p-password[formcontrolname="confirmPassword"] input');
    await confirmPwd.fill('Test1234@Password');
    await page.click('button:has-text("Suivant")');
    await page.waitForSelector('input[formcontrolname="companyName"]', { timeout: 5000 });
    await page.fill('input[formcontrolname="companyName"]', 'Ma Société');
    await page.locator('p-inputmask[formcontrolname="nif"] input').fill('1234567A/B/C/000');
    await page.fill('input[formcontrolname="companyEmail"]', 'contact@entreprise.tn');
    await page.locator('p-inputmask[formcontrolname="phone"] input').fill('98123456');
    await page.click('p-select[formcontrolname="taxRegime"]');
    await page.waitForSelector('.p-select-overlay', { timeout: 3000 });
    await page.locator('.p-select-option').first().click();
    await page.waitForTimeout(500);
    await page.click('button:has-text("Suivant")');
    await page.waitForSelector('input[formcontrolname="street"]', { timeout: 5000 });
    await takeScreenshot(page, '01-premiers-pas', 'inscription-etape3');
  });

  test('06 - Connexion et tableau de bord', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      console.warn('Variables DOC_EMAIL et DOC_PASSWORD non définies - capture dashboard ignorée');
      return;
    }

    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[formcontrolname="email"]', email);
    const pwdInput = page.locator('p-password[formcontrolname="password"] input');
    await pwdInput.fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '02-tableau-de-bord', 'dashboard-complet');
  });

  test('07 - Liste des factures', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    await page.goto('/auth/login');
    await page.fill('input[formcontrolname="email"]', email);
    await page.locator('p-password[formcontrolname="password"] input').fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.goto('/invoices');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '03-ventes', 'factures-liste');
  });

  test('08 - Assistant facture étape 1', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    await page.goto('/auth/login');
    await page.fill('input[formcontrolname="email"]', email);
    await page.locator('p-password[formcontrolname="password"] input').fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.goto('/invoices/new');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.wizard-stepper, .wizard-container, [class*="wizard"]', { timeout: 10000 }).catch(() => {});
    await takeScreenshot(page, '03-ventes', 'facture-etape1');
  });

  test('09 - Liste des devis', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    await page.goto('/auth/login');
    await page.fill('input[formcontrolname="email"]', email);
    await page.locator('p-password[formcontrolname="password"] input').fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.goto('/quotes');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '03-ventes', 'devis-liste');
  });

  test('10 - Liste des bons de livraison', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    await page.goto('/auth/login');
    await page.fill('input[formcontrolname="email"]', email);
    await page.locator('p-password[formcontrolname="password"] input').fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.goto('/delivery-notes');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '03-ventes', 'bl-liste');
  });

  test('11 - Liste des fournisseurs', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    await page.goto('/auth/login');
    await page.fill('input[formcontrolname="email"]', email);
    await page.locator('p-password[formcontrolname="password"] input').fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.goto('/suppliers');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '04-achats', 'fournisseurs-liste');
  });

  test('12 - Liste des bons de commande', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    await page.goto('/auth/login');
    await page.fill('input[formcontrolname="email"]', email);
    await page.locator('p-password[formcontrolname="password"] input').fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.goto('/purchase-orders');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '04-achats', 'bc-liste');
  });

  test('13 - Liste des clients', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    await page.goto('/auth/login');
    await page.fill('input[formcontrolname="email"]', email);
    await page.locator('p-password[formcontrolname="password"] input').fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '05-fiches', 'clients-liste');
  });

  test('14 - Liste des produits', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    await page.goto('/auth/login');
    await page.fill('input[formcontrolname="email"]', email);
    await page.locator('p-password[formcontrolname="password"] input').fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.goto('/products');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '05-fiches', 'produits-liste');
  });

  test('15 - Gestion du stock', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    await page.goto('/auth/login');
    await page.fill('input[formcontrolname="email"]', email);
    await page.locator('p-password[formcontrolname="password"] input').fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.goto('/stock');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '06-stock', 'stock-gestion');
  });

  test('16 - Paiements', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    await page.goto('/auth/login');
    await page.fill('input[formcontrolname="email"]', email);
    await page.locator('p-password[formcontrolname="password"] input').fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.goto('/payments');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '07-paiements', 'paiements-vue');
  });

  test('17 - Rapports ventes', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    await page.goto('/auth/login');
    await page.fill('input[formcontrolname="email"]', email);
    await page.locator('p-password[formcontrolname="password"] input').fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.goto('/reports/sales');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '08-rapports', 'rapports-ventes');
  });

  test('18 - Paramètres profil', async ({ page }) => {
    const email = process.env.DOC_EMAIL || process.env.FACTUTRUST_TEST_EMAIL;
    const password = process.env.DOC_PASSWORD || process.env.FACTUTRUST_TEST_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    await page.goto('/auth/login');
    await page.fill('input[formcontrolname="email"]', email);
    await page.locator('p-password[formcontrolname="password"] input').fill(password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    await page.goto('/settings/profile');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '09-parametres', 'profil');
  });
});
