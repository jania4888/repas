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
  WF_ENTITY_ID,
  StudioWorkflowMockOptions,
  installStudioWorkflowMocks
} from './helpers/studio-workflow-mock.helpers';

/**
 * E2E des workflows Studio (4.4l1) : hub, concepteur (ajout d'étape, validation,
 * enregistrement), drawer d'instance via `?instance=`, onglet « Workflows » de la fiche,
 * drapeau coupé (fail-closed) et navigation. API entièrement mockée
 * (`installStudioApiMocks` + `installStudioRuntimeMocks` + `installStudioWorkflowMocks`) —
 * suite déterministe, aucun backend requis.
 *
 * Écarts d'annexe consignés :
 * - D-44-l1-2 : `p-drawer` PrimeNG 19 rend `role="complementary"` (pas « dialog ») — le
 *   drawer d'instance est donc ciblé par `getByRole('complementary')` + `data-testid`.
 * - D-44-l1-3 : la route fiche `/studio/d/:key/:id/edit` exige `custom_records:write`
 *   (permissionGuard, D-44-53) — « sans écriture » y est une redirection /access-denied,
 *   fail-closed plus fort que « bouton absent » (vérifié dans le 4e test).
 *
 * Captures docs (`test.describe('captures')`) : ignorées par défaut ; définir
 * `STUDIO_DOC_SCREENSHOTS=1` pour régénérer `docs/screenshots/studio-ia-workflows-*.png`.
 */

/** `STUDIO_E2E_USER` + `custom_records:write` (décisions, lancement, route /edit). */
const WRITE_PERMISSIONS = [...STUDIO_E2E_USER.effectivePermissions, 'custom_records:write'];

interface SetupOptions {
  /** Surcharge des capacités (fusionnées sur `{ workflowsEnabled: true, workflowToolsEnabled: true }`). */
  capabilities?: StudioCapabilitiesOverrides;
  /** Remplace `STUDIO_E2E_USER.effectivePermissions` (localStorage + `/api/auth/me`). */
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

test.describe('Studio — workflows (4.4)', () => {

  test('le hub liste les workflows et ouvre le concepteur', async ({ page }) => {
    await setup(page);
    await page.goto(`/studio/workflows?entity=${WF_ENTITY_ID}`);

    const row = page.getByTestId('wf-hub-row-wf-1');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Validation intervention');
    // Workflow actif ⇒ interrupteur coché (input interne du p-toggleswitch).
    await expect(page.getByTestId('wf-hub-toggle-wf-1').locator('input')).toBeChecked();

    await row.getByRole('link', { name: 'Validation intervention' }).click();
    await expect(page).toHaveURL(/\/studio\/workflows\/wf-1$/);
    await expect(page.getByTestId('wf-name')).toHaveValue('Validation intervention');
  });

  test("le concepteur ajoute une étape, valide et enregistre", async ({ page }) => {
    const ctx = await setup(page);
    await page.goto(`/studio/workflows?entity=${WF_ENTITY_ID}`);
    await page.getByTestId('wf-hub-new').click();
    await expect(page).toHaveURL(new RegExp(`/studio/workflows/new\\?entity=${WF_ENTITY_ID}`));

    await expect(page.getByTestId('wf-name')).toBeVisible();
    await page.getByTestId('wf-name').fill('Validation intervention E2E');
    await expect(page.getByTestId('wf-key')).toHaveValue('validation_intervention_e2e');

    // Ajout d'une étape « Approbation » via le menu du catalogue (clé générée approval_1).
    // Le clic de Playwright fait défiler le bouton dans le viewport ; or `html` a
    // `scroll-behavior: smooth` et le défilement résiduel survient APRÈS l'ouverture du
    // p-menu popup — son gestionnaire de défilement le referme aussitôt (échec constaté
    // en l2, artefact de test : un utilisateur ne clique qu'une fois le bouton visible).
    // On amène donc le bouton nous-mêmes et on laisse le défilement se terminer avant le clic.
    await page.getByTestId('wf-step-add').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.getByTestId('wf-step-add').click();
    await page.getByTestId('wf-step-type-approval').click();
    await expect(page.getByTestId('wf-step-approval_1')).toBeVisible();

    await page.getByTestId('wf-validate').click();
    await expect.poll(() => ctx.find('/workflows/validate', 'POST').length).toBe(1);

    await page.getByTestId('wf-save').click();
    // « Enregistrer » valide d'abord (D-44-02) puis crée (201) et ouvre la définition créée.
    await expect(page).toHaveURL(/\/studio\/workflows\/wf-new$/);
    const creates = ctx.find(`/entities/${WF_ENTITY_ID}/workflows`, 'POST')
      .filter(c => c.url.endsWith('/workflows'));
    expect(creates.length).toBe(1);
    // Un workflow créé est inactif tant qu'on ne l'active pas (D-44-23).
    await expect(page.getByTestId('wf-toggle').locator('input')).not.toBeChecked();
  });

  test("le détail d'instance s'ouvre en drawer depuis ?instance=", async ({ page }) => {
    await setup(page);
    await page.goto('/studio/workflows/wf-1?instance=inst-1');

    // D-44-l1-2 : le p-drawer a role="complementary".
    const drawer = page.getByRole('complementary');
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId('wf-detail-summary')).toBeVisible();
    // Déroulé des étapes : condition terminée puis approbation en attente.
    await expect(drawer).toContainText('condition_1');
    await expect(drawer).toContainText('approval_1');
    // Utilisateur sans custom_records:write : bouton « Annuler » absent, note lecture seule.
    await expect(page.getByTestId('wf-cancel')).toHaveCount(0);
    await expect(page.getByTestId('wf-detail-readonly')).toBeVisible();
    // Le panneau « instances récentes » (4.4e2) liste l'instance ouverte.
    await expect(page.getByTestId('wf-instance-inst-1')).toBeVisible();
  });

  test("la fiche affiche l'onglet Workflows avec le nombre d'instances ouvertes", async ({ page }) => {
    // /edit exige custom_records:write (D-44-53) : le parcours nominal est en écriture.
    const ctx = await setup(page, { permissions: WRITE_PERMISSIONS });
    await page.goto('/studio/d/interventions/r1/edit');

    const tab = page.getByTestId('studio-tab-workflows');
    await expect(tab).toBeVisible();
    // 1 instance ouverte (inst-1 « waiting_approval ») ; inst-2 est terminée (D-44-58).
    await expect(tab.locator('.studio-tab__badge')).toHaveText('1');
    await tab.click();

    await expect(page.getByTestId('srw-row-inst-1')).toBeVisible();
    await expect(page.getByTestId('srw-row-inst-2')).toBeVisible();

    // « Détail » (4.5d2, bi-mode) : le tiroir charge l'instance par la route runtime de la fiche
    // (`records/{entityKey}/{recordId}/workflow-instances/{id}`), jamais par la route de conception ;
    // « Ouvrir l'origine » est masqué en portée fiche (D-45-15).
    await page.getByTestId('srw-detail-inst-1').click();
    await expect(page.getByTestId('wf-detail-summary')).toBeVisible();
    await expect.poll(() => ctx.find('/records/interventions/r1/workflow-instances/inst-1', 'GET').length).toBe(1);
    expect(ctx.find('/workflows/instances/inst-1', 'GET').length).toBe(0);
    await expect(page.getByTestId('wf-detail-origin')).toHaveCount(0);
    // 4.6c1 : « Démarré par » affiche le nom du lanceur (startedByName, 4.6b1) dans le tiroir et l'onglet.
    await expect(page.getByTestId('wf-detail-started-by-inst-1')).toHaveText('Alice Martin');
    await expect(page.getByTestId('srw-requested-by-inst-2')).toHaveText('—');
    await page.keyboard.press('Escape'); // p-drawer modal : fermeture clavier avant le lancement manuel
    await expect(page.getByRole('complementary')).toBeHidden();

    // Lancement manuel : dialog → select « Validation intervention » → confirmation (201).
    await page.getByTestId('srw-run').click();
    await page.getByTestId('srw-run-select').click();
    await page.getByRole('option', { name: 'Validation intervention' }).click();
    await page.getByTestId('srw-run-confirm').click();
    await expect.poll(() => ctx.find('/workflows/validation_intervention/run', 'POST').length).toBe(1);

    // Variante sans custom_records:write (D-44-l1-3) : la fiche /edit elle-même est refusée
    // ⇒ aucun bouton d'écriture (srw-run) n'est atteignable.
    const page2 = await page.context().newPage();
    await setup(page2);
    await page2.goto('/studio/d/interventions/r1/edit');
    await expect(page2).toHaveURL(/\/access-denied\?returnUrl=/);
    await page2.close();
  });

  test("drapeau coupé : pas de navigation Workflows, /studio/workflows redirige vers /studio, onglet fiche absent", async ({ page }) => {
    await setup(page, {
      permissions: WRITE_PERMISSIONS, // la fiche /edit exige l'écriture — indépendant du drapeau
      capabilities: { workflowsEnabled: false },
      workflows: { recordProbeStatus: 404 }
    });

    // capabilityGuard('workflowsEnabled') ⇒ repli /studio.
    await page.goto('/studio/workflows');
    await expect(page).toHaveURL(/\/studio\/?$/);

    // Sidebar : la section Studio ne montre ni « Workflows » ni « Mes approbations ».
    await page.getByRole('button', { name: 'Studio', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Workflows', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Mes approbations/ })).toHaveCount(0);

    // Fiche : la sonde 404 masque l'onglet (fail-closed silencieux, D21).
    await page.goto('/studio/d/interventions/r1/edit');
    await expect(page.getByTestId('studio-tab-form')).toBeVisible();
    await expect(page.getByTestId('studio-tab-workflows')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Workflows/ })).toHaveCount(0);
  });

  test("la navigation Studio expose Workflows et Mes approbations avec le badge", async ({ page }) => {
    await setup(page);
    await page.goto('/studio');

    await page.getByRole('button', { name: 'Studio', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Workflows', exact: true })).toBeVisible();
    const approvals = page.getByRole('link', { name: /Mes approbations/ });
    await expect(approvals).toBeVisible();
    // Badge alimenté par la sonde count (2 approbations en attente).
    await expect(approvals.getByTestId('nav-child-badge')).toHaveText('2');
  });
});

// ---------------------------------------------------------------------------------------------
// Captures pour le guide utilisateur : docs/screenshots/studio-ia-workflows-{hub,concepteur,fiche}.png
// (motif de studio-ai-preview.spec.ts ; la capture « approbations » est dans studio-approvals.spec.ts).
// ---------------------------------------------------------------------------------------------

const SCREENSHOTS_BASE = path.join(__dirname, '..', '..', '..', '..', 'docs', 'screenshots');

async function capture(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS_BASE, { recursive: true });
  // Laisse les animations PrimeNG (onglets, overlays) se terminer avant la capture.
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SCREENSHOTS_BASE, `studio-ia-workflows-${name}.png`), fullPage: true });
}

/**
 * 4.7★2 (S12 / annexe C §4) — parcours 4.7 livrés : déclencheur planifié (4.7b4), dialogue « Tester »
 * (4.7c2) et « Charger plus » du panneau d'instances (4.7a2). API mockée comme la suite 4.4.
 */
test.describe('Studio — workflows 4.7 (planifié, Tester, Charger plus)', () => {

  test('le déclencheur Planifié affiche le cron, le préréglage remplit le champ et Enregistrer envoie triggerConfig.cron', async ({ page }) => {
    const ctx = await setup(page);
    await page.goto('/studio/workflows/wf-1');
    await expect(page.getByTestId('wf-name')).toHaveValue('Validation intervention');

    // Le déclencheur n'est plus « bientôt » : la carte est cliquable et ouvre la configuration cron.
    const card = page.getByTestId('wf-trigger-scheduled');
    await expect(card).not.toHaveAttribute('aria-disabled', 'true');
    await card.click();
    await expect(page.getByTestId('wf-scheduled-config')).toBeVisible();

    // Préréglage « Chaque jour à 06:00 UTC » ⇒ le champ cron est rempli, la sauvegarde devient possible.
    await page.getByTestId('wf-cron-preset').click();
    await page.getByRole('option', { name: 'Chaque jour à 06:00 UTC' }).click();
    await expect(page.getByTestId('wf-cron')).toHaveValue('0 6 * * *');
    await expect(page.getByTestId('wf-save')).toBeEnabled();

    // Saisie libre ensuite : le préréglage passe à « Personnalisé » et la valeur saisie est conservée.
    await page.getByTestId('wf-cron').fill('30 7 * * 1-5');
    await expect(page.getByTestId('wf-cron-preset')).toContainText('Personnalisé');

    await page.getByTestId('wf-save').click();
    await expect.poll(() => ctx.find('/workflows/wf-1', 'PUT').length).toBe(1);
    const body = ctx.find('/workflows/wf-1', 'PUT')[0].body as { trigger: string; triggerConfig: { cron: string } };
    expect(body.trigger).toBe('scheduled');
    expect(body.triggerConfig.cron).toBe('30 7 * * 1-5');
  });

  test('« Tester » ouvre le dialogue, sélectionne une fiche et affiche la trace simulée sans écriture', async ({ page }) => {
    const ctx = await setup(page);
    await page.goto('/studio/workflows/wf-1');
    await expect(page.getByTestId('wf-name')).toHaveValue('Validation intervention');

    await expect(page.getByTestId('wf-test')).toBeEnabled();
    await page.getByTestId('wf-test').click();
    // L'hôte <p-dialog data-testid> n'a pas de boîte : on cible la boîte de dialogue accessible (rôle + titre).
    await expect(page.getByRole('dialog', { name: 'Tester le workflow' })).toBeVisible();
    await expect(page.getByTestId('wf-test-dialog')).toHaveCount(1);
    await expect(page.getByTestId('wf-test-banner')).toBeVisible();

    // Les fiches du dialogue viennent de GET records/interventions?page=1&pageSize=10 (runtime mock).
    const records = page.getByTestId('wf-test-records').locator('.wf-test-record');
    await expect(records.first()).toBeVisible();
    await expect(page.getByTestId('wf-test-run')).toBeDisabled();
    await records.first().click();
    await expect(page.getByTestId('wf-test-run')).toBeEnabled();
    await page.getByTestId('wf-test-run').click();

    // Trace 4.7c2 : 2 lignes (would_run puis would_suspend), résumé, aucun avertissement.
    const trace = page.getByTestId('wf-test-trace');
    await expect(trace).toBeVisible();
    await expect(trace.locator('.wf-trace-row')).toHaveCount(2);
    await expect(trace.locator('.wf-trace-row[data-verdict="would_run"]')).toContainText('Priorité haute');
    await expect(trace.locator('.wf-trace-row[data-verdict="would_suspend"]')).toContainText('Validation');
    await expect(page.getByTestId('wf-test-summary')).toContainText('2');
    await expect(page.getByTestId('wf-test-warnings')).toHaveCount(0);

    // Invariant R17 : un seul POST, celui de la simulation ; aucune écriture (instances, run, PUT, DELETE).
    expect(ctx.find('/workflows/wf-1/test', 'POST').length).toBe(1);
    const writes = ctx.calls.filter(c => (c.method === 'POST' || c.method === 'PUT' || c.method === 'DELETE')
      && !c.url.endsWith('/workflows/wf-1/test') && !c.url.includes('/api/auth/'));
    expect(writes).toEqual([]);
  });

  test('le panneau d\'instances charge la page 2 avec « Charger plus » et retire le bouton une fois tout chargé', async ({ page }) => {
    await setup(page);
    // Surcharge de la route instances (enregistrée après setup ⇒ prioritaire) : 22 instances en 2 pages.
    const instanceCalls: string[] = [];
    const instanceAt = (k: number) => ({
      id: `inst-p${k}`, workflowDefinitionId: 'wf-1', entityDefinitionId: WF_ENTITY_ID, workflowKey: 'validation_intervention',
      workflowName: 'Validation intervention', definitionVersion: 1, recordId: `r${k}`, trigger: 'on_create',
      status: k % 2 ? 'completed' : 'running', currentStepIndex: 0, currentStepKey: null, dueAt: null, startedBy: null,
      startedAt: '2026-09-17T10:00:00Z', completedAt: null, depth: 0, originInstanceId: null, error: null
    });
    await page.route('**/api/studio/workflows/wf-1/instances?**', route => {
      const url = new URL(route.request().url());
      instanceCalls.push(url.search);
      const pageNumber = Number(url.searchParams.get('page') ?? '1');
      const items = pageNumber === 1 ? Array.from({ length: 20 }, (_, k) => instanceAt(k)) : [instanceAt(20), instanceAt(21)];
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {
          items, page: pageNumber, pageSize: 20, totalCount: 22, totalPages: 2,
          hasPreviousPage: pageNumber > 1, hasNextPage: pageNumber < 2
        }, message: null, errors: [] })
      });
    });

    await page.goto('/studio/workflows/wf-1');
    await expect(page.getByTestId('wf-instance-inst-p0')).toBeVisible();
    await expect(page.locator('.wf-inst__item')).toHaveCount(20);
    const more = page.getByTestId('wf-instances-more');
    await expect(more).toBeVisible();
    await expect(more).toContainText('encore 2');

    await more.click();
    await expect(page.getByTestId('wf-instance-inst-p21')).toBeVisible();
    await expect(page.locator('.wf-inst__item')).toHaveCount(22);
    await expect(page.getByTestId('wf-instances-more')).toHaveCount(0);
    // Exactement une requête page=2, aucune page=3 (le total serveur borne la pagination).
    await expect.poll(() => instanceCalls.filter(q => q.includes('page=2')).length).toBe(1);
    expect(instanceCalls.filter(q => q.includes('page=3')).length).toBe(0);
    expect(instanceCalls.every(q => q.includes('pageSize=20'))).toBe(true);
  });
});

test.describe('captures', () => {
  test.skip(!process.env.STUDIO_DOC_SCREENSHOTS, 'captures docs — définir STUDIO_DOC_SCREENSHOTS=1');

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('hub', async ({ page }) => {
    await setup(page);
    await page.goto(`/studio/workflows?entity=${WF_ENTITY_ID}`);
    await expect(page.getByTestId('wf-hub-row-wf-1')).toBeVisible();
    await capture(page, 'hub');
  });

  test('concepteur', async ({ page }) => {
    await setup(page);
    await page.goto('/studio/workflows/wf-1');
    await expect(page.getByTestId('wf-name')).toHaveValue('Validation intervention');
    await expect(page.getByTestId('wf-step-condition_1')).toBeVisible();
    await capture(page, 'concepteur');
  });

  test('fiche', async ({ page }) => {
    await setup(page, { permissions: WRITE_PERMISSIONS });
    await page.goto('/studio/d/interventions/r1/edit');
    await page.getByTestId('studio-tab-workflows').click();
    await expect(page.getByTestId('srw-row-inst-1')).toBeVisible();
    await capture(page, 'fiche');
  });
});
