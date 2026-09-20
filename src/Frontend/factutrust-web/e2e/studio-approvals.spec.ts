import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  STUDIO_E2E_USER,
  StudioCapabilitiesOverrides,
  StudioMockContext,
  installStudioApiMocks,
  installStudioAuth,
  installStudioRuntimeMocks
} from './helpers/studio-mock.helpers';
import {
  StudioWorkflowMockOptions,
  installStudioWorkflowMocks
} from './helpers/studio-workflow-mock.helpers';

/**
 * E2E de la page « Mes approbations » (4.4l1) : KPI, décision Approuver/Refuser (motif
 * obligatoire au refus), lecture seule sans `custom_records:write`, panneau de détail en
 * colonne ≥ 1 280 px / drawer en dessous, garde fail-closed (404 ⇒ /studio, 403 ⇒
 * /access-denied). API entièrement mockée — aucun backend requis.
 *
 * Écart d'annexe consigné — D-44-l1-2 : `p-drawer` PrimeNG 19 rend `role="complementary"`
 * (pas « dialog ») ; le drawer du panneau de détail est ciblé par ce rôle.
 *
 * Captures docs (`test.describe('captures')`) : ignorées par défaut ; définir
 * `STUDIO_DOC_SCREENSHOTS=1` pour régénérer `docs/screenshots/studio-ia-workflows-*.png`.
 */

/** `STUDIO_E2E_USER` + `custom_records:write` (boutons de décision). */
const WRITE_PERMISSIONS = [...STUDIO_E2E_USER.effectivePermissions, 'custom_records:write'];

interface SetupOptions {
  capabilities?: StudioCapabilitiesOverrides;
  permissions?: string[];
  workflows?: StudioWorkflowMockOptions;
}

async function setup(page: Page, options: SetupOptions = {}): Promise<StudioMockContext> {
  await installStudioAuth(page, options.permissions ?? STUDIO_E2E_USER.effectivePermissions);
  const ctx = await installStudioApiMocks(page, {
    capabilities: { workflowsEnabled: true, workflowToolsEnabled: true, ...(options.capabilities ?? {}) },
    ...(options.permissions ? { permissions: options.permissions } : {})
  });
  await installStudioRuntimeMocks(page, ctx);
  await installStudioWorkflowMocks(page, ctx, options.workflows);
  return ctx;
}

test.describe('Studio — mes approbations (4.4)', () => {
  // 4.7 « v1.1 » (ap-f, D-47-60/61) — onglets de la page : « Déléguées » désactivé, « Historique » réel.
  test('onglets : Déléguées « Bientôt » désactivé ; Historique charge mes décisions à l\'activation', async ({ page }) => {
    await setup(page, { permissions: WRITE_PERMISSIONS });
    await page.goto('/studio/approvals');

    // Badge « À traiter » = 2 ; « Déléguées » désactivé avec infobulle.
    await expect(page.getByTestId('studio-tab-pending')).toContainText('2');
    const delegated = page.getByTestId('studio-tab-delegated');
    await expect(delegated).toBeDisabled();
    await expect(delegated).toHaveAttribute('title', 'Bientôt');
    await delegated.click({ force: true });
    await expect(page.getByTestId('sap-row-a1')).toBeVisible();   // toujours sur « À traiter »

    // « Historique » : chargé à l'activation, deux décisions (refusée puis approuvée).
    await page.getByTestId('studio-tab-history').click();
    const h1 = page.getByTestId('sap-history-row-h1');
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('Vanne C7');
    await expect(h1).toContainText('Alice Martin');
    await expect(page.getByTestId('sap-history-decision-h1')).toContainText('Refusée');
    await expect(page.getByTestId('sap-history-comment-h1')).toContainText('Non justifié.');
    const h2 = page.getByTestId('sap-history-row-h2');
    await expect(h2).toBeVisible();
    await expect(page.getByTestId('sap-history-decision-h2')).toContainText('Approuvée');
    await expect(page.getByTestId('sap-history-comment-h2')).toContainText('—');

    // Retour « À traiter » : l'inbox est intacte ; l'historique ne se recharge pas.
    await page.getByTestId('studio-tab-pending').click();
    await expect(page.getByTestId('sap-row-a1')).toBeVisible();
  });

  test('la page liste les approbations et calcule les KPI', async ({ page }) => {
    await setup(page);
    await page.goto('/studio/approvals');

    // KPI « À traiter / En retard / Sous 24 h » : a1 en retard, a2 sous 24 h ⇒ 2 / 1 / 1.
    await expect(page.getByTestId('sap-kpi-pending').locator('.sap-kpi__value')).toHaveText('2');
    await expect(page.getByTestId('sap-kpi-late').locator('.sap-kpi__value')).toHaveText('1');
    await expect(page.getByTestId('sap-kpi-soon').locator('.sap-kpi__value')).toHaveText('1');

    const row1 = page.getByTestId('sap-row-a1');
    await expect(row1).toBeVisible();
    await expect(row1).toContainText('Validation intervention');      // workflow
    await expect(row1).toContainText('Validation de l\'intervention'); // étape = approval.title
    await expect(page.getByTestId('sap-row-a2')).toBeVisible();

    // Colonnes : « Lancé le », « Demandé le » et, depuis 4.5e (D-44-79 levé), « Demandé par »
    // = `startedByName ?? '—'` (a1 : « Alice Martin » ; a2 : lanceur inconnu ⇒ « — »).
    const table = page.locator('.ft-table-card');
    await expect(table.getByRole('columnheader', { name: 'Lancé le' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Demandé le' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Demandé par' })).toBeVisible();
    await expect(page.getByTestId('sap-requested-by-a1')).toHaveText('Alice Martin');
    await expect(page.getByTestId('sap-requested-by-a2')).toHaveText('—');
  });

  test('refuser exige un motif puis retire la ligne', async ({ page }) => {
    const ctx = await setup(page, { permissions: WRITE_PERMISSIONS });
    await page.goto('/studio/approvals');
    await expect(page.getByTestId('sap-row-a1')).toBeVisible();

    await page.getByTestId('sap-reject-a1').click();
    // p-button : le data-testid est sur l'hôte, l'état désactivé se lit sur le bouton interne.
    const confirm = page.getByTestId('sap-confirm').locator('button');
    await expect(confirm).toBeDisabled(); // motif obligatoire au refus
    await page.locator('#sap-comment').fill('Pièce manquante.');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect.poll(() => ctx.find('/approvals/a1/reject', 'POST').length).toBe(1);
    const body = ctx.find('/approvals/a1/reject', 'POST')[0].body as { comment?: string };
    expect(body.comment).toBe('Pièce manquante.');
    // Retrait local de la ligne après décision ; a2 reste.
    await expect(page.getByTestId('sap-row-a1')).toHaveCount(0);
    await expect(page.getByTestId('sap-row-a2')).toBeVisible();
  });

  test('lecture seule sans custom_records:write', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page); // permissions par défaut : pas de custom_records:write
    await page.goto('/studio/approvals');
    await expect(page.getByTestId('sap-row-a1')).toBeVisible();

    // Aucun bouton de décision ; note lecture seule (R17).
    await expect(page.getByTestId('sap-approve-a1')).toHaveCount(0);
    await expect(page.getByTestId('sap-reject-a1')).toHaveCount(0);
    await expect(page.getByRole('note')).toContainText('Lecture seule');

    // Le bouton « Détail » reste rendu (D-44-57) ; à 1 440 px le panneau est en colonne fixe.
    await page.getByTestId('sap-detail-a1').click();
    const panel = page.getByTestId('sap-panel-column');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('En attente');                          // statut
    await expect(panel).toContainText('Merci de valider cette intervention'); // message du demandeur
  });

  test('le panneau bascule en drawer sous 1 280 px', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await setup(page);
    await page.goto('/studio/approvals');
    await expect(page.getByTestId('sap-detail-a1')).toBeVisible();

    await page.getByTestId('sap-detail-a1').click();
    // D-44-l1-2 : le p-drawer a role="complementary" ; pas de colonne fixe sous 1 280 px.
    const drawer = page.getByRole('complementary');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('En attente');
    await expect(page.getByTestId('sap-panel-column')).toHaveCount(0);
  });

  test('404 sur la sonde : redirection vers /dashboard ; 403 : accès refusé', async ({ page }) => {
    // Module coupé côté serveur (fail-closed) ⇒ repli /dashboard (4.5d1, D-45-14 : /studio exige
    // studio:design_entities, un lecteur y serait renvoyé vers /access-denied).
    await setup(page, { workflows: { approvalsStatus: 404 } });
    await page.goto('/studio/approvals');
    await expect(page).toHaveURL(/\/dashboard\/?$/);

    // Droit absent ⇒ /access-denied avec returnUrl (D11) — seconde page, mocks dédiés.
    const page2 = await page.context().newPage();
    await setup(page2, { workflows: { approvalsStatus: 403 } });
    await page2.goto('/studio/approvals');
    await expect(page2).toHaveURL(/\/access-denied\?returnUrl=/);
    await page2.close();
  });
});

// ---------------------------------------------------------------------------------------------
// Capture pour le guide utilisateur : docs/screenshots/studio-ia-workflows-approbations.png
// (panneau de détail ouvert en colonne fixe, utilisateur avec droit d'écriture).
// ---------------------------------------------------------------------------------------------

const SCREENSHOTS_BASE = path.join(__dirname, '..', '..', '..', '..', 'docs', 'screenshots');

async function capture(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS_BASE, { recursive: true });
  // Laisse les animations PrimeNG (panneau, onglets) se terminer avant la capture.
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SCREENSHOTS_BASE, `studio-ia-workflows-${name}.png`), fullPage: true });
}

test.describe('captures', () => {
  test.skip(!process.env.STUDIO_DOC_SCREENSHOTS, 'captures docs — définir STUDIO_DOC_SCREENSHOTS=1');

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('approbations', async ({ page }) => {
    await setup(page, { permissions: WRITE_PERMISSIONS });
    await page.goto('/studio/approvals');
    await expect(page.getByTestId('sap-row-a1')).toBeVisible();
    await page.getByTestId('sap-detail-a1').click();
    await expect(page.getByTestId('sap-panel-column')).toBeVisible();
    await capture(page, 'approbations');
  });
});
