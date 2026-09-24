import { test, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Captures de la landing publique FR/AR (plan TD6/TD9) — aucun backend requis
 * (l'état d'inscription et le formulaire de contact sont simulés).
 *
 * Exécution :
 *   npm start &
 *   npx playwright test e2e/capture-landing-screenshots.spec.ts --project=chromium
 *
 * Sortie : docs/screenshots/landing/{fr,ar}/<page>-<largeur>.png
 */

// Écrire dans docs/ pendant que le dev server tourne déclenche un rechargement HMR
// qui tue la capture en cours : on écrit hors de l'arborescence surveillée,
// puis on copie (commande dans l'en-tête) vers docs/screenshots/landing/.
const SCREENSHOTS_BASE =
  process.env.LANDING_SCREENSHOTS_DIR ??
  path.join(__dirname, '..', '..', '..', '..', 'docs', 'screenshots', 'landing');

const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '992', width: 992, height: 768 },
  { name: '1440', width: 1440, height: 900 }
] as const;

const PAGES = [
  { locale: 'fr', url: '/', file: 'accueil' },
  { locale: 'fr', url: '/cabinets-comptables', file: 'cabinets' },
  { locale: 'ar', url: '/ar', file: 'accueil' },
  { locale: 'ar', url: '/ar/cabinets-comptables', file: 'cabinets' }
] as const;

async function mockPublicApis(page: Page): Promise<void> {
  await page.route('**/api/public/registration-status', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { companyEnabled: false, firmEnabled: false } })
    })
  );
  await page.route('**/api/public/contact-requests', route =>
    route.fulfill({ status: 202, contentType: 'application/json', body: '{"success":true}' })
  );
}

test.describe('Captures landing FR/AR (TD6)', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicApis(page);
  });

  for (const target of PAGES) {
    test(`${target.locale} ${target.file} — 3 largeurs`, async ({ page }) => {
      test.setTimeout(120_000);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(target.url, { waitUntil: 'domcontentloaded' });
        await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 });
        // Laisse WOW.js révéler les sections et le statut d'inscription basculer.
        await page.waitForTimeout(1200);
        // Défilement complet pour déclencher les animations paresseuses avant la capture pleine page.
        await page.evaluate(async () => {
          await new Promise<void>(resolve => {
            let y = 0;
            const step = () => {
              y += window.innerHeight;
              window.scrollTo(0, y);
              if (y < document.body.scrollHeight) {
                setTimeout(step, 120);
              } else {
                window.scrollTo(0, 0);
                setTimeout(resolve, 400);
              }
            };
            step();
          });
        });
        const dir = path.join(SCREENSHOTS_BASE, target.locale);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${target.file}-${viewport.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`  Capture: ${file}`);
      }
    });
  }
});
