import { APIRequestContext, expect, Page, request, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ERP_NAV_ROUTES, settle } from '../helpers/erp-session.mock';
import { findFrenchLeaks, snapshotErpText } from './erp-text-utils';

/**
 * Recette de l'ERP en arabe sur une API réelle (locale, bases dédiées) avec des données : connexion par
 * l'écran de login, toutes les routes du menu société avec leurs listes remplies, fiches de détail,
 * dialogue de confirmation et erreur métier renvoyée par l'API.
 *
 * Les données de la base de test (noms, adresses, codes saisis) sont retirées avant l'analyse : ce ne
 * sont pas des fuites de l'interface. Les référentiels semés (plan comptable NCT…) restent affichés tels
 * quels (hors périmètre) : le rapport les signale, le tri est manuel.
 *
 * Ignorée par défaut. Lancement (compte de test d'une API locale isolée, jamais un compte réel) :
 *   I18N_LIVE_ACCOUNT=<fichier JSON { email, password }> E2E_API_BASE=https://localhost:7011 \
 *   npx playwright test -c playwright.i18n.config.ts erp-ar-live
 * Rapport : e2e/test-results/i18n-live-leaks/<écran>.json ; captures : e2e/test-results/i18n-live/.
 */

const accountFile = process.env.I18N_LIVE_ACCOUNT;
const account: { email: string; password: string } | null =
  accountFile && fs.existsSync(accountFile) ? JSON.parse(fs.readFileSync(accountFile, 'utf8')) : null;

const OUT = path.resolve(__dirname, '../test-results');
// Hors de outputDir (e2e/test-results/i18n), que Playwright vide à chaque exécution.
const SHOTS = path.join(OUT, 'i18n-live');
const REPORT_DIR = path.join(OUT, 'i18n-live-leaks');
/** Session API mise en cache : un échec relance le worker, on évite de se reconnecter à chaque fois. */
const SESSION_FILE = path.join(SHOTS, 'session.json');
const SESSION_TTL_MS = 10 * 60_000;
/** Identifiants techniques affichés tels quels : `stock-simple`, code d'audit `Client.Created`. */
const TECHNICAL_ID = /(^|\s)([a-z0-9]+(-[a-z0-9]+)+|[A-Z][A-Za-z]+(\.[A-Z][A-Za-z]+)+)(?=\s|$)/g;
/**
 * Écarts connus et documentés (PHASE1-STATUS, « Reste à faire ») : signalés dans la synthèse sans la
 * faire échouer. Chaque entrée attend une décision de conception, pas une traduction.
 */
const KNOWN_GAPS: Record<string, string> = {
  '/treasury/cash-forecast':
    'analyses de la prévision (CashFlowAlertRules) rédigées en français et enregistrées avec la prévision : ' +
    'à produire sous forme code + paramètres pour être traduites'
};
/** Libellés enregistrés à la comptabilisation (« Client — FAC-2026-000001 ») : des données. */
const POSTED_LABEL = /^.+ — [A-Z]{2,5}-\d{4}-\d{3,}$/;
const WHITELIST = [
  'InstaFact', 'TEJ', 'CRM', 'POS', 'TND', 'NIF', 'RIB', 'IBAN', 'PDF', 'CSV', 'API', 'URL', 'email', 'Email', 'Français',
  'Ctrl', 'SARL', 'DGI', 'CNSS', 'IRPP', 'TVA', 'FODEC', 'SIVP', 'RS', 'XML', 'FEC', 'JSON', 'ZIP'
];

/**
 * Libellés français envoyés par l'API et traduits par `backendLabel` : affichés tels quels en arabe,
 * c'est une fuite, même sans accent ni mot-outil (« Brouillon »). Les sigles identiques sont exclus.
 */
const BACKEND_LABELS: Set<string> = (() => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/app/core/i18n/backend-display-labels.generated.ts'), 'utf8');
  return new Set(
    [...src.matchAll(/^\s+("(?:[^"\\]|\\.)*"): \$localize/gm)]
      .map(m => JSON.parse(m[1]) as string)
      .filter(t => !/^[A-Z0-9 ./&()-]+$/.test(t) && t !== 'Karama')
  );
})();

type Row = Record<string, unknown> & { id: string };
interface LiveSession {
  accessToken: string;
  refreshToken: string;
  user: unknown;
  data: { clients: Row[]; products: Row[]; suppliers: Row[]; invoices: Row[]; warehouses: Row[] };
  /** Référentiels semés (plan comptable NCT, journaux, catégories d'amortissement, types de retenue). */
  seeded: string[];
}

test.skip(!account, 'Définir I18N_LIVE_ACCOUNT (compte de test d’une API locale isolée)');

async function listOf(api: APIRequestContext, token: string, url: string): Promise<Row[]> {
  const r = await api.get(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (Array.isArray(j)) return j;
  return Array.isArray(j.data) ? j.data : j.data?.items ?? [];
}

async function liveSession(baseURL: string): Promise<LiveSession> {
  if (fs.existsSync(SESSION_FILE) && Date.now() - fs.statSync(SESSION_FILE).mtimeMs < SESSION_TTL_MS) {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  }
  const api = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
  const r = await api.post('/api/auth/login', { data: { email: account!.email, password: account!.password, rememberMe: true } });
  expect(r.ok(), `connexion API ${r.status()}`).toBeTruthy();
  const { accessToken, refreshToken, user } = (await r.json()).data;
  const data = {
    clients: await listOf(api, accessToken, '/api/clients?pageSize=100'),
    products: await listOf(api, accessToken, '/api/products?pageSize=100'),
    suppliers: await listOf(api, accessToken, '/api/suppliers?pageSize=100'),
    invoices: await listOf(api, accessToken, '/api/invoices?pageSize=100'),
    // Entrepôt par défaut semé à l'inscription (« Entrepôt Principal ») : une donnée, renommable.
    warehouses: await listOf(api, accessToken, '/api/stock/warehouses')
  };
  const seeded = [
    ...(await listOf(api, accessToken, '/api/accounting/chart-of-accounts')),
    ...(await listOf(api, accessToken, '/api/accounting/journals')),
    ...(await listOf(api, accessToken, '/api/accounting/fixed-assets/rate-categories')),
    ...(await listOf(api, accessToken, '/api/withholding-tax/types'))
  ]
    .flatMap(x => [x['label'], x['familyLabel']])
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 1);
  await api.dispose();
  const session = { accessToken, refreshToken, user, data, seeded };
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session));
  return session;
}

/** Textes saisis dans la base de test : exclus de l'analyse (plus longs d'abord, pour les inclusions). */
function dataTexts(s: LiveSession): string[] {
  const fields = ['name', 'code', 'street', 'city', 'governorate', 'contactPerson', 'unit', 'email', 'clientName', 'number'];
  const user = s.user as Record<string, unknown>;
  return [...new Set(
    [...s.data.clients, ...s.data.products, ...s.data.suppliers, ...s.data.invoices, ...(s.data.warehouses ?? []), user]
      .flatMap(x => [...fields, 'companyName', 'firstName', 'lastName', 'fullName'].map(f => x?.[f]))
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 1)
      .concat(s.seeded ?? [])
  )].sort((a, b) => b.length - a.length);
}

async function useSession(page: Page, s: LiveSession): Promise<void> {
  await page.addInitScript(({ accessToken, refreshToken, user }) => {
    localStorage.setItem('ft_auth_remember_me', '1');
    localStorage.setItem('ft_access_token', accessToken);
    localStorage.setItem('ft_refresh_token', refreshToken);
    localStorage.setItem('ft_user', JSON.stringify(user));
    localStorage.setItem('instafact_erp_locale', 'ar');
  }, { accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user });
}

async function scan(page: Page, label: string, data: string[]): Promise<string[]> {
  const snap = await snapshotErpText(page, 'fr');
  const lines = [
    `[titre] ${snap.title}`,
    ...snap.visibleText.split('\n'),
    ...snap.placeholders.map(p => `[placeholder] ${p}`),
    ...snap.titles.map(t => `[title] ${t}`),
    ...snap.ariaLabels.map(a => `[aria-label] ${a}`),
    ...snap.alts.map(a => `[alt] ${a}`)
  ];
  const bare = (line: string) => line.replace(/^\[[a-z-]+\] /, '').replace(/[⁦-⁩]/g, ' ').trim();
  const clean = (line: string) => {
    let t = bare(line);
    if (POSTED_LABEL.test(t)) return '';
    for (const d of data) t = t.split(d).join(' ');
    return t.replace(TECHNICAL_ID, ' ');
  };
  const isLeak = (l: string) =>
    findFrenchLeaks(clean(l), WHITELIST).length > 0 || (BACKEND_LABELS.has(bare(l)) && !data.includes(bare(l)));
  const leaks = [...new Set(lines.filter(isLeak))];
  // Un rapport par écran, fuites ou non (URL finale : une redirection d'accès se voit), jugé par la
  // synthèse finale : un échec par écran relancerait le navigateur à chaque fois.
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, `${label}.json`), JSON.stringify({ label, url: page.url(), leaks }, null, 2), 'utf8');
  test.info().attach('fuites', { body: leaks.join('\n') || '(aucune)', contentType: 'text/plain' });
  return leaks;
}

async function visitAndScan(page: Page, s: LiveSession, route: string, label: string): Promise<void> {
  await useSession(page, s);
  await page.goto(route);
  await settle(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(new URL(page.url()).pathname, 'session refusée').not.toMatch(/^\/auth\//);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${label}.png`), fullPage: true });
  await scan(page, label, dataTexts(s));
}

const slug = (route: string) => route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'racine';

test.describe('Recette arabe — connexion', () => {
  test('écran de login en arabe, connexion réelle', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('instafact_erp_locale', 'ar'));
    await page.goto('/auth/login');
    await settle(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.locator('input[formcontrolname="email"]').fill(account!.email);
    await page.locator('p-password[formcontrolname="password"] input, input[formcontrolname="password"]').first().fill(account!.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(url => !url.pathname.startsWith('/auth/'), { timeout: 30_000 });
    await settle(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'apres-connexion.png'), fullPage: true });
  });
});

test.describe('Recette arabe — écrans avec données', () => {
  for (const route of ERP_NAV_ROUTES) {
    test(route, async ({ page, baseURL }) => {
      await visitAndScan(page, await liveSession(baseURL!), route, slug(route));
    });
  }

  const details: [string, (s: LiveSession) => string | undefined][] = [
    // `status` de la liste : libellé français (« Validée », « Brouillon »).
    ['facture-validee', s => s.data.invoices.find(i => /valid/i.test(String(i['status'])))?.id],
    ['facture-brouillon', s => s.data.invoices.find(i => /brouillon|draft/i.test(String(i['status'])))?.id],
    ['fiche-client', s => s.data.clients.find(c => !/passager/i.test(String(c['name'])))?.id],
    ['fiche-produit', s => s.data.products[0]?.id],
    ['fiche-fournisseur', s => s.data.suppliers[0]?.id]
  ];
  const base: Record<string, string> = {
    'facture-validee': '/invoices',
    'facture-brouillon': '/invoices',
    'fiche-client': '/clients',
    'fiche-produit': '/products',
    'fiche-fournisseur': '/suppliers'
  };
  for (const [label, pick] of details) {
    test(`détail : ${label}`, async ({ page, baseURL }) => {
      const s = await liveSession(baseURL!);
      const id = pick(s);
      test.skip(!id, `aucune donnée pour ${label}`);
      await visitAndScan(page, s, `${base[label]}/${id}`, label);
    });
  }

  test('dialogue de suppression et refus de l’API en arabe', async ({ page, baseURL }) => {
    const s = await liveSession(baseURL!);
    // La liste des factures ne porte que le nom du client.
    const invoiced = new Set(s.data.invoices.map(i => String(i['clientName'])));
    const client = s.data.clients.find(c => invoiced.has(String(c['name'])));
    test.skip(!client, 'aucun client facturé');
    await useSession(page, s);
    await page.goto(`/clients/${client!.id}`);
    await settle(page);
    await page.locator('app-button', { hasText: 'حذف' }).first().click();
    // Confirmation de l'application : fenêtre ng-bootstrap (app-confirm-modal).
    const dialog = page.locator('ngb-modal-window .modal-content').first();
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'dialogue-suppression-client.png') });
    await scan(page, 'dialogue-suppression-client', dataTexts(s));

    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes(`/api/clients/${client!.id}`)),
      dialog.locator('button', { hasText: 'حذف' }).click()
    ]);
    expect(response.ok(), 'la suppression d’un client facturé doit être refusée').toBeFalsy();
    // Le refus métier s'affiche dans une fenêtre d'alerte (ConfirmationService.alert), en arabe.
    const alert = page.locator('ngb-modal-window .modal-content').last();
    await expect(alert).toContainText(/[؀-ۿ]/);
    await expect(alert.locator('button', { hasText: 'حسنًا' })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'alerte-refus-suppression.png') });
    await scan(page, 'alerte-refus-suppression', dataTexts(s));
  });

  test('synthèse : aucune fuite française', () => {
    const reports: { label: string; url: string; leaks: string[] }[] = fs.existsSync(REPORT_DIR)
      ? fs.readdirSync(REPORT_DIR).map(f => JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf8')))
      : [];
    expect(reports.length, 'aucun écran analysé').toBeGreaterThan(0);
    const known = reports.filter(r => r.leaks.length && KNOWN_GAPS[new URL(r.url).pathname]);
    for (const r of known) {
      test.info().annotations.push({ type: 'écart connu', description: `${r.label} : ${KNOWN_GAPS[new URL(r.url).pathname]}` });
    }
    const leaking = reports
      .filter(r => r.leaks.length && !KNOWN_GAPS[new URL(r.url).pathname])
      .map(r => `${r.label} (${r.url}) :\n  ${r.leaks.join('\n  ')}`);
    expect(leaking, `${leaking.length} écran(s) avec des fuites sur ${reports.length}`).toEqual([]);
  });
});
