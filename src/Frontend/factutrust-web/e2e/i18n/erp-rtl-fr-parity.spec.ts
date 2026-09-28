import { expect, test } from '@playwright/test';
import { installErpSession, settle } from '../helpers/erp-session.mock';

/**
 * Lot 6 — non-régression du français : les écrans FR doivent rester identiques au pixel près après
 * la conversion du CSS physique en propriétés logiques (équivalentes en LTR par construction).
 *
 * 1. Référence (code d'avant) : npx playwright test -c playwright.i18n.config.ts erp-rtl-fr-parity --update-snapshots
 * 2. Comparaison (code d'après) : npx playwright test -c playwright.i18n.config.ts erp-rtl-fr-parity
 * Les captures de référence vivent dans e2e/test-results (non versionné) : preuve ponctuelle, pas une porte CI.
 */

const SCREENS: { name: string; route: string }[] = [
  { name: 'dashboard', route: '/dashboard' },
  { name: 'invoices', route: '/invoices' },
  { name: 'client-form', route: '/clients/new' },
  { name: 'product-form', route: '/products/new' },
  { name: 'balance', route: '/accounting/balance' },
  { name: 'invoice-wizard', route: '/invoices/new' },
  { name: 'payroll-employees', route: '/payroll/employees' },
  { name: 'cash-desk', route: '/payments/cash-desk' },
  { name: 'sales-reports', route: '/reports/sales' },
  { name: 'stock', route: '/stock' },
  { name: 'quotes', route: '/quotes' },
  { name: 'crm-dashboard', route: '/crm/dashboard' },
  { name: 'projects', route: '/projects' },
  { name: 'pos', route: '/pos' }
];

test.describe('FR — parité visuelle après passage aux propriétés logiques', () => {
  for (const screen of SCREENS) {
    test(`${screen.name}`, async ({ page }) => {
      await installErpSession(page, { locale: 'fr' });
      await page.goto(screen.route);
      await settle(page);
      await expect(page).toHaveScreenshot(`fr-${screen.name}.png`, {
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixels: 0
      });
    });
  }
});
