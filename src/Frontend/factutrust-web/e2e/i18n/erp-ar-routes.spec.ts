import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ERP_NAV_ROUTES, installErpSession, settle } from '../helpers/erp-session.mock';
import { findFrenchLeaks, snapshotErpText } from './erp-text-utils';

/**
 * Lot 7 — fuites françaises dans l'ERP en arabe : chaque route du menu société (registre de
 * navigation, lu à l'exécution) et les formulaires de création sont ouverts en session simulée ;
 * toute ligne de texte visible, placeholder, title, aria-label ou titre d'onglet contenant du
 * français (mot-outil, accent) est une fuite, hors liste blanche (sigles, noms propres) et hors
 * données de la maquette.
 *
 * Rapport : e2e/test-results/i18n-leaks/<route>.json (lignes fautives par route).
 */

const CREATION_FORMS = [
  '/invoices/new',
  '/quotes/new',
  '/clients/new',
  '/suppliers/new',
  '/products/new',
  '/purchase-orders/new',
  '/delivery-notes/new',
  '/sales-orders/new',
  '/sales-return-notes/new',
  '/purchase-receipts/new',
  '/supplier-invoices/new',
  '/recurring-contracts/new'
];
const ROUTES = [...new Set([...ERP_NAV_ROUTES, ...CREATION_FORMS])].sort();

/** Textes légitimement latins : marque, sigles, sélecteur de langue, données de la session simulée. */
const WHITELIST = [
  'InstaFact', 'TEJ', 'CRM', 'POS', 'TND', 'NIF', 'RIB', 'IBAN', 'PDF', 'CSV', 'API', 'URL', 'email', 'Email', 'Français',
  'Amina', 'Test', 'E2E', 'Ctrl', 'SARL', 'ABC', 'DGI', 'CNSS', 'IRPP', 'TVA', 'FODEC', 'SIVP', 'RS', 'XML', 'FEC', 'JSON', 'ZIP'
];

/** Un fichier par route (un échec relance le worker Playwright : un état en mémoire serait perdu). */
const REPORT_DIR = path.resolve(__dirname, '../test-results/i18n-leaks');
/** Identifiants techniques affichés tels quels (écran `stock-simple`, clé `invoice-list`). */
const TECHNICAL_ID = /(^|\s)[a-z0-9]+(-[a-z0-9]+)+(?=\s|$)/g;

test.describe('Fuites françaises — ERP en arabe', () => {
  for (const route of ROUTES) {
    test(route, async ({ page }) => {
      await installErpSession(page, { locale: 'ar' });
      await page.goto(route);
      await settle(page);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

      // `lang="fr"` : français voulu (questions d'exemple de l'assistant IA, routées en français).
      const snap = await snapshotErpText(page, 'fr');
      const lines = [
        `[titre] ${snap.title}`,
        ...snap.visibleText.split('\n'),
        ...snap.placeholders.map(p => `[placeholder] ${p}`),
        ...snap.titles.map(t => `[title] ${t}`),
        ...snap.ariaLabels.map(a => `[aria-label] ${a}`),
        ...snap.alts.map(a => `[alt] ${a}`)
      ];
      const leaks = [
        ...new Set(lines.filter(l => findFrenchLeaks(l.replace(/^\[[a-z-]+\] /, '').replace(TECHNICAL_ID, ' '), WHITELIST).length))
      ];
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      const file = path.join(REPORT_DIR, `${route.replace(/[^a-z0-9]+/gi, '_')}.json`);
      if (leaks.length) fs.writeFileSync(file, JSON.stringify({ route, leaks }, null, 2), 'utf8');
      else if (fs.existsSync(file)) fs.unlinkSync(file);
      test.info().attach('fuites', { body: leaks.join('\n') || '(aucune)', contentType: 'text/plain' });
      expect.soft(leaks, `Fuites françaises sur ${route}`).toEqual([]);
    });
  }
});
