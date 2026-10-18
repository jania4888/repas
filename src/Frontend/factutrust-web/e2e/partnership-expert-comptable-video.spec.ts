/**
 * Playwright screencast for expert-comptable partnership video.
 */
import { test } from '@playwright/test';
import {
  getDemoCredentials,
  gotoAndSettle,
  loginAsDemoUser,
  logScene,
  pause,
  saveChapterVideoFromPage,
  scrollToSection,
  waitForAppReady
} from './helpers/partnership-demo.helpers';

test.describe('Vidéo partenariat expert-comptable', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(300_000);

  test.beforeAll(() => {
    if (!getDemoCredentials()) {
      console.warn('\n--- DOC_EMAIL et DOC_PASSWORD requis pour la vidéo partenariat ---\n');
    }
  });

  test.afterEach(async ({ page }, testInfo) => {
    const chapterMatch = testInfo.title.match(/Chapitre\s+(\d+)/i);
    if (!chapterMatch) return;
    const fileName = `chapitre-${chapterMatch[1].padStart(2, '0')}.webm`;
    await saveChapterVideoFromPage(page, fileName);
  });

  test('Chapitre 01 — Introduction landing', async ({ page }) => {
    logScene('01-intro', 'Landing conformité et cas comptable');
    await page.goto('/');
    await waitForAppReady(page);
    await pause(page, 2500);
    await scrollToSection(page, '#conformite');
    await pause(page, 3000);
    await scrollToSection(page, '#cas-usage');
    await page.locator('.persona-accountant, .usecase-card').last().scrollIntoViewIfNeeded();
    await pause(page, 3500);
  });

  test('Chapitre 02 — Connexion et tableau de bord', async ({ page }) => {
    logScene('02-dashboard', 'Login et dashboard KPI');
    await loginAsDemoUser(page);
    await gotoAndSettle(page, '/dashboard');
    await pause(page, 4000);
  });

  test('Chapitre 03 — Factures et journal JV', async ({ page }) => {
    logScene('03-invoices-journal', 'Factures et écritures auto');
    await loginAsDemoUser(page);
    await gotoAndSettle(page, '/invoices');
    const invoiceLink = page.locator('a.invoice-number, table tbody tr a[href*="/invoices/"]').first();
    if (await invoiceLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await invoiceLink.click();
      await page.waitForLoadState('load');
      await pause(page, 3500);
    }
    await gotoAndSettle(page, '/accounting/journal');
    const journalSelect = page.locator('#jrn-code');
    if (await journalSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await journalSelect.selectOption('JV');
      await page.getByRole('button', { name: /Actualiser/i }).click();
      await page.waitForLoadState('load');
    }
    await pause(page, 4000);
  });

  test('Chapitre 04 — Trésorerie', async ({ page }) => {
    logScene('04-treasury', 'Paiements clients et comptes bancaires');
    await loginAsDemoUser(page);
    await gotoAndSettle(page, '/payments/clients');
    await pause(page, 2500);
    await gotoAndSettle(page, '/payments/bank-accounts');
    await pause(page, 3500);
  });

  test('Chapitre 05 — Module comptabilité', async ({ page }) => {
    test.setTimeout(300_000);
    logScene('05-accounting', 'Parcours comptabilité SCE');
    await loginAsDemoUser(page);
    for (const route of [
      '/accounting/dashboard',
      '/accounting/chart',
      '/accounting/journal',
      '/accounting/ledger',
      '/accounting/balance',
      '/accounting/lettering',
      '/accounting/vat-declaration',
      '/accounting/balance-sheet',
      '/accounting/income-statement',
      '/accounting/closing'
    ]) {
      await gotoAndSettle(page, route);
      await pause(page, 2200);
    }
    const fecBtn = page.getByRole('button', { name: /Exporter FEC/i });
    if (await fecBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await fecBtn.scrollIntoViewIfNeeded();
      await pause(page, 2000);
    }
  });

  test('Chapitre 06 — Fiscal TEJ', async ({ page }) => {
    logScene('06-tej', 'Dashboard TEJ et export XML');
    await loginAsDemoUser(page);
    await gotoAndSettle(page, '/withholding-tax/dashboard');
    await pause(page, 2500);
    await gotoAndSettle(page, '/withholding-tax/tej-export');
    const previewBtn = page.getByRole('button', { name: /Prévisualiser XML/i });
    if (await previewBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
      await previewBtn.click();
      await pause(page, 3000);
    } else {
      await pause(page, 2500);
    }
  });

  test('Chapitre 07 — Audit et rôles', async ({ page }) => {
    logScene('07-audit-roles', 'Journal audit et utilisateurs');
    await loginAsDemoUser(page);
    await gotoAndSettle(page, '/audit');
    await pause(page, 3000);
    await gotoAndSettle(page, '/settings/users');
    await pause(page, 3500);
  });

  test('Chapitre 08 — Clôture partenariat', async ({ page }) => {
    logScene('08-partnership', 'Dashboard et message partenariat');
    await loginAsDemoUser(page);
    await gotoAndSettle(page, '/dashboard');
    await pause(page, 2000);
    await page.goto('/');
    await waitForAppReady(page);
    await scrollToSection(page, '#top');
    await pause(page, 4000);
  });
});
