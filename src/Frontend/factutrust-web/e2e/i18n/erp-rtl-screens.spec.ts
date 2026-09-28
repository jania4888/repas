import { expect, Page, test } from '@playwright/test';
import * as path from 'node:path';
import { installErpSession, settle } from '../helpers/erp-session.mock';

/**
 * Lot 6 — mise en page RTL : écrans représentatifs (tableau de bord, listes, formulaires, tableaux
 * de montants) capturés en arabe et en français, avec des contrôles mécaniques :
 *  - `html[dir][lang]` posés ; sidebar à droite en arabe, à gauche en français ;
 *  - aucun débordement horizontal de la page (symptôme classique d'un `left`/`margin-left` resté physique).
 * Les captures (e2e/test-results/i18n/screens) servent à la recette visuelle et à la relecture native.
 */

const SCREENS: { name: string; route: string }[] = [
  { name: 'dashboard', route: '/dashboard' },
  { name: 'invoices', route: '/invoices' },
  { name: 'client-form', route: '/clients/new' },
  { name: 'product-form', route: '/products/new' },
  { name: 'balance', route: '/accounting/balance' },
  { name: 'invoice-wizard', route: '/invoices/new' },
  { name: 'access-denied', route: '/accounting/manual-entry' },
  { name: 'payroll-employees', route: '/payroll/employees' },
  { name: 'cash-desk', route: '/payments/cash-desk' },
  { name: 'sales-reports', route: '/reports/sales' },
  { name: 'stock', route: '/stock' }
];

const SHOTS = path.resolve(__dirname, '../test-results/i18n/screens');

async function layoutFacts(page: Page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const sidebar = document.querySelector('app-sidebar')?.getBoundingClientRect();
    return {
      dir: html.getAttribute('dir'),
      lang: html.getAttribute('lang'),
      overflowX: html.scrollWidth - window.innerWidth,
      sidebarCenter: sidebar && sidebar.width > 0 ? sidebar.left + sidebar.width / 2 : null,
      viewport: window.innerWidth
    };
  });
}

for (const locale of ['ar', 'fr'] as const) {
  test.describe(`RTL — écrans (${locale})`, () => {
    for (const screen of SCREENS) {
      test(`${screen.name}`, async ({ page }) => {
        await installErpSession(page, { locale });
        await page.goto(screen.route);
        await settle(page);
        await page.screenshot({ path: path.join(SHOTS, `${screen.name}-${locale}.png`), fullPage: false });

        const facts = await layoutFacts(page);
        test.info().attach('layout', { body: JSON.stringify(facts, null, 2), contentType: 'application/json' });
        expect(facts.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
        expect(facts.lang?.startsWith(locale)).toBe(true);
        expect(facts.overflowX, 'débordement horizontal de la page').toBeLessThanOrEqual(1);
        if (facts.sidebarCenter !== null) {
          if (locale === 'ar') expect(facts.sidebarCenter).toBeGreaterThan(facts.viewport / 2);
          else expect(facts.sidebarCenter).toBeLessThan(facts.viewport / 2);
        }
      });
    }
  });
}

test.describe('RTL — dialogue et largeur téléphone (ar)', () => {
  test('dialogue : opération de caisse', async ({ page }) => {
    await installErpSession(page, { locale: 'ar' });
    await page.goto('/payments/cash-desk');
    await settle(page);
    await page.locator('app-page-header button, .page-actions button, button').filter({ hasText: 'تسجيل عملية' }).first().click();
    const dialog = page.locator('.p-dialog').first();
    await expect(dialog).toBeVisible();
    // Fin de l'animation d'ouverture (glissement + opacité) avant la capture et la mesure.
    await page.waitForFunction(() => {
      const el = document.querySelector('.p-dialog') as HTMLElement | null;
      return !!el && getComputedStyle(el).opacity === '1' && getComputedStyle(el).transform === 'none';
    }, undefined, { timeout: 5_000 }).catch(() => page.waitForTimeout(800));
    await page.screenshot({ path: path.join(SHOTS, 'cash-operation-dialog-ar.png') });
    const box = await dialog.boundingBox();
    const facts = await layoutFacts(page);
    expect(facts.overflowX, 'débordement horizontal de la page').toBeLessThanOrEqual(1);
    expect(box && box.x >= 0 && box.x + box.width <= facts.viewport + 1, 'dialogue dans la fenêtre').toBe(true);
  });

});

test.describe('RTL — largeur téléphone', () => {
  for (const locale of ['ar', 'fr'] as const) {
    for (const screen of [{ name: 'dashboard', route: '/dashboard' }, { name: 'invoices', route: '/invoices' }]) {
      test(`téléphone ${locale} : ${screen.name}`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await installErpSession(page, { locale });
        await page.goto(screen.route);
        await settle(page);
        await page.screenshot({ path: path.join(SHOTS, `${screen.name}-${locale}-mobile.png`) });
        const facts = await layoutFacts(page);
        expect(facts.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
        expect(facts.overflowX, 'débordement horizontal de la page').toBeLessThanOrEqual(1);
      });
    }
  }
});

test.describe('RTL — identifiants saisis en LTR (ar)', () => {
  test('fiche client : NIF, téléphone, e-mail', async ({ page }) => {
    await installErpSession(page, { locale: 'ar' });
    await page.goto('/clients/new');
    await settle(page);
    const dirOf = (sel: string) => page.locator(sel).first().evaluate(el => getComputedStyle(el).direction);
    // NIF et téléphone sont des p-inputMask : l'attribut formControlName est porté par l'hôte.
    await page.locator('p-inputmask[formcontrolname="nif"] input').first().pressSequentially('1772793WAM000');
    await page.locator('p-inputmask[formcontrolname="phone"] input').first().pressSequentially('21612345678');
    await page.screenshot({ path: path.join(SHOTS, 'client-form-identifiers-ar.png') });
    expect(await dirOf('p-inputmask[formcontrolname="nif"] input')).toBe('ltr');
    expect(await dirOf('p-inputmask[formcontrolname="phone"] input')).toBe('ltr');
    expect(await dirOf('input[type="email"], input[formcontrolname="email"]')).toBe('ltr');
  });
});
