import { Page, Route } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Session ERP société simulée pour les suites i18n/RTL : administrateur natif, tous les modules et
 * toutes les permissions déclarées dans le code, `/api/**` intercepté. Aucun backend ni base n'est
 * requis ; les écrans s'affichent avec des listes vides (en-têtes, filtres, formulaires, états vides).
 *
 * Les permissions et les routes sont lues dans les sources à l'exécution : la liste suit le code
 * sans maintenance (une permission ajoutée est accordée, une route ajoutée au menu est parcourue).
 */

const APP_DIR = path.resolve(__dirname, '../../src/app');
const OUT_OF_SCOPE = /[\\/]features[\\/](firm|portal|platform|home|legal|virtual-street)[\\/]/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|html)$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Toutes les chaînes « domaine:action » du code (`invoices:write`, `studio:design_entities`…). */
export const ERP_PERMISSIONS: string[] = (() => {
  const set = new Set<string>();
  for (const file of sourceFiles(APP_DIR)) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/['"`]([a-z][a-z_]*:[a-z][a-z_]*)['"`]/g)) set.add(m[1]);
  }
  return [...set].sort();
})();

/** Routes du menu de l'ERP société (registre de navigation), hors espaces forcés en français. */
export const ERP_NAV_ROUTES: string[] = (() => {
  const registry = fs.readFileSync(path.join(APP_DIR, 'core/config/app-navigation.registry.ts'), 'utf8');
  const routes = new Set<string>();
  for (const m of registry.matchAll(/route:\s*'(\/[^']*)'/g)) routes.add(m[1]);
  return [...routes].filter(r => !/^\/(firm|portal|platform|home|legal)\b/.test(r)).sort();
})();

export const ERP_E2E_USER = {
  id: 'u-erp-e2e',
  email: 'erp.e2e@instafact.test',
  firstName: 'Amina',
  lastName: 'Test',
  fullName: 'Amina Test',
  role: 'Administrator',
  roleDisplay: 'Administrateur',
  tenantId: 't-erp-e2e',
  companyName: 'InstaFact E2E',
  tenantKind: 'company',
  accessMode: 'native',
  twoFactorEnabled: false,
  enabledModuleIds: Array.from({ length: 18 }, (_, i) => i),
  effectivePermissions: ERP_PERMISSIONS,
  productOnboardingStatus: 'completed'
};

const FAKE_JWT = (() => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ERP_E2E_USER.id, exp: 4102444800 })}.sig`;
})();

const ok = <T>(data: T) => ({ success: true, data, message: null, errors: [] });
const EMPTY_PAGE = { items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false };

async function fulfil(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

export interface ErpSessionOptions {
  locale: 'fr' | 'ar';
}

/**
 * À appeler avant `page.goto` : jetons + profil + langue dans `localStorage`, API interceptée.
 * Playwright évalue les routes de la plus récente à la plus ancienne : le filet d'abord.
 */
export async function installErpSession(page: Page, { locale }: ErpSessionOptions): Promise<void> {
  await page.addInitScript(
    ({ token, userJson, locale }) => {
      localStorage.setItem('ft_auth_remember_me', '1');
      localStorage.setItem('ft_access_token', token);
      localStorage.setItem('ft_refresh_token', 'refresh-e2e');
      localStorage.setItem('ft_user', userJson);
      localStorage.setItem('instafact_erp_locale', locale);
    },
    { token: FAKE_JWT, userJson: JSON.stringify({ ...ERP_E2E_USER, preferredLanguage: locale }), locale }
  );
  await page.route('**/api/**', route => fulfil(route, ok(EMPTY_PAGE)));
  await page.route('**/api/auth/me', route => fulfil(route, ok({ ...ERP_E2E_USER, preferredLanguage: locale })));
  await page.route('**/api/studio/nav', route => fulfil(route, ok([])));
  // Un seul entrepôt actif : sélectionné d'office par warehouseSelectedGuard (pas d'écran de choix).
  await page.route(/\/api\/.*warehouses(\?.*)?$/, route =>
    fulfil(route, ok([{ id: 'w-e2e', name: 'المستودع الرئيسي', code: 'W01', isActive: true, isDefault: true }]))
  );
}

/** Attend que l'écran soit rendu (plus de requête en vol, plus de squelette de chargement). */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => !document.querySelector('app-skeleton, .p-skeleton, .skeleton-loader'), undefined, { timeout: 5_000 })
    .catch(() => undefined);
}
