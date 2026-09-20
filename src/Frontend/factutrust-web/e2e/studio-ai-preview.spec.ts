import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  StudioMockContext,
  StudioMockOptions,
  StudioPreviewMockOptions,
  installStudioPreviewMocks,
  setupStudioAtelier,
  studioPlanEvents,
  studioSystemSpec
} from './helpers/studio-mock.helpers';

/**
 * E2E — Aperçu IA enrichi (PR 3.4, annexe A-34bis §6) : doublons, mode Personnaliser (brouillon +
 * `rowVersion`, conflit 409), mode Tester (GET-only), expiration ⇒ Régénérer (`POST …/replay`),
 * import JSON, export JSON. Backend entièrement mocké (`installStudioPreviewMocks`, au-dessus des
 * mocks de l'atelier) : suite déterministe, aucun serveur .NET requis.
 *
 * Référence QA manuelle : docs/developer/studio-ai-assistant-qa.md, cas 99–102.
 *
 * Captures docs (`test.describe('captures')`) : ignorées par défaut car elles réécrivent les PNG suivis
 * de `docs/screenshots/` (pixels non déterministes) ; définir `STUDIO_DOC_SCREENSHOTS=1` pour les
 * régénérer volontairement.
 */

const DUPLICATES = [
  { specRef: 'employe', specDisplayName: 'Employé', existingKey: 'employes', existingDisplayName: 'Employés', reason: 'same_key' }
];

const CAPABILITIES = { planPreviewEnabled: true, systemExportEnabled: true };

const HERO = 'Décrivez le système que vous souhaitez créer';

async function setup(page: Page, mocks: StudioMockOptions = {}, preview: StudioPreviewMockOptions = {}): Promise<StudioMockContext> {
  const ctx = await setupStudioAtelier(page, {
    chatEvents: studioPlanEvents(),
    ...mocks,
    capabilities: { ...CAPABILITIES, ...(mocks.capabilities ?? {}) }
  });
  await installStudioPreviewMocks(page, ctx, preview);
  return ctx;
}

async function gotoAtelier(page: Page): Promise<void> {
  await page.goto('/studio/ai');
  await expect(page.getByRole('heading', { name: HERO })).toBeVisible();
}

async function submitFromComposer(page: Page, text: string): Promise<void> {
  await page.locator('app-studio-ai-composer textarea').first().fill(text);
  await page.getByRole('button', { name: 'Générer avec l’IA' }).first().click();
}

/** Génère un plan et attend que la spec soit chargée (barre de modes + puces de compteurs). */
async function arriveWithPlan(page: Page): Promise<void> {
  await gotoAtelier(page);
  await submitFromComposer(page, 'Crée un système de gestion des congés');
  await expect(page.locator('app-studio-ai-preview')).toBeVisible();
  await expect(page.locator('app-studio-ai-mode-bar')).toBeVisible();
  await expect(page.locator('.sai-chips')).toBeVisible();
}

/** Passe en mode Personnaliser, ouvre l'onglet Tables et renomme le libellé du champ `nom`. */
async function renameFirstField(page: Page, label: string): Promise<void> {
  await page.locator('app-studio-ai-mode-bar [data-mode="customize"]').click();
  await page.getByRole('tab', { name: /^Tables/ }).click();
  const input = page.locator('[data-component-id="sai-field-label-nom"]');
  await expect(input).toBeVisible();
  await input.fill(label);
}

const specBuffer = () => Buffer.from(JSON.stringify(studioSystemSpec(), null, 2), 'utf8');

async function loadImportFile(page: Page): Promise<void> {
  await page.locator('app-studio-ai-rail [data-action="import"]').click();
  const dialog = page.locator('app-studio-ai-import-dialog');
  await expect(dialog.getByText('Importer un système (JSON)')).toBeVisible();
  await dialog.locator('#saii-file').setInputFiles({ name: 'conges.json', mimeType: 'application/json', buffer: specBuffer() });
  await expect(dialog.getByText('Spécification reconnue')).toBeVisible();
}

async function openExportFromRail(page: Page): Promise<void> {
  await page.locator('app-studio-ai-rail [data-action="export"]').click();
  const dialog = page.locator('app-studio-ai-export-dialog');
  await expect(dialog.getByText('Exporter', { exact: false }).first()).toBeVisible();
  await dialog.locator('#saie-system').click();
  await page.getByRole('option', { name: 'Gestion des congés' }).click();
  await expect(dialog.locator('.saie__json')).toBeVisible();
}

test.describe('Aperçu IA enrichi — 7 cas (3.4m)', () => {
  test('doublon détecté ⇒ Réutiliser la table existante ou Créer quand même', async ({ page }) => {
    const ctx = await setup(page, { chatEvents: studioPlanEvents({ duplicates: DUPLICATES }) });
    await arriveWithPlan(page);

    const banner = page.locator('.sai-dup');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('La table « Employé » existe déjà');
    await expect(banner.getByRole('button', { name: 'Réutiliser la table existante' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Créer quand même' })).toBeVisible();

    await banner.getByRole('button', { name: 'Réutiliser la table existante' }).click();

    await expect.poll(() => ctx.find('/spec', 'PUT').length).toBe(1);
    const puts = ctx.find('/spec', 'PUT');
    const body = puts[0].body as { specJson: string; rowVersion: string };
    expect(body.rowVersion).toBe('AAAA');
    const spec = JSON.parse(body.specJson) as { entities: { ref: string; existingKey?: string }[] };
    expect(spec.entities.find(e => e.ref === 'employe')?.existingKey).toBe('employes');
    await expect(banner).toHaveCount(0);
  });

  test('Personnaliser : renommer une table ⇒ badge de modifications ⇒ Enregistrer le brouillon ⇒ PUT …/spec avec rowVersion', async ({ page }) => {
    const ctx = await setup(page);
    await arriveWithPlan(page);
    expect(ctx.find('/spec', 'GET').length).toBe(1);

    await renameFirstField(page, 'Nom complet');

    await expect(page.locator('.sai-modebar__badge')).toHaveText('1');
    await expect(page.locator('[data-component-id="sai-changes-badge"]')).toContainText('1 modifications');

    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();

    await expect.poll(() => ctx.find('/spec', 'PUT').length).toBe(1);
    const puts = ctx.find('/spec', 'PUT');
    const body = puts[0].body as { specJson: string; rowVersion: string };
    expect(body.rowVersion).toBe('AAAA');
    const spec = JSON.parse(body.specJson) as { entities: { fields: { key: string; label: string }[] }[] };
    expect(spec.entities[0].fields.find(f => f.key === 'nom')?.label).toBe('Nom complet');

    // Brouillon enregistré : le compteur repart à zéro et la conversation le consigne.
    await expect(page.locator('.sai-modebar__badge')).toHaveCount(0);
    await expect(page.locator('app-studio-ai-conversation')).toContainText('Modifications enregistrées dans le plan.');
  });

  test('brouillon 409 ⇒ dialog de conflit', async ({ page }) => {
    const ctx = await setup(page, {}, { specPutConflict: true });
    await arriveWithPlan(page);
    await renameFirstField(page, 'Nom complet');
    await expect(page.locator('.sai-modebar__badge')).toHaveText('1');

    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();

    await expect.poll(() => ctx.find('/spec', 'PUT').length).toBe(1);
    const puts = ctx.find('/spec', 'PUT');
    expect((puts[0].body as { rowVersion: string }).rowVersion).toBe('AAAA');

    // 409 : le brouillon est conservé (badge et bouton toujours actifs), rien n'est enregistré.
    await expect(page.locator('.sai-modebar__badge')).toHaveText('1');
    await expect(page.getByRole('button', { name: 'Enregistrer le brouillon' })).toBeEnabled();
    await expect(page.locator('app-studio-ai-conversation')).not.toContainText('Modifications enregistrées dans le plan.');
    await expect(page.locator('app-studio-ai-preview')).toBeVisible();

    // 3.4n : le conflit est rendu dans un bandeau d'erreur de l'aperçu (validation().errors).
    const banner = page.locator('app-studio-ai-preview [data-testid="sai-validation-error"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner).toContainText('Ce plan a été modifié entre-temps. Rechargez l’aperçu.');
  });

  test('Tester ⇒ GET …/preview et aucune écriture', async ({ page }) => {
    const ctx = await setup(page);
    await arriveWithPlan(page);

    const writes: string[] = [];
    const onRequest = (req: { method(): string; url(): string }) => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method()) && req.url().includes('/api/studio/')) {
        writes.push(`${req.method()} ${req.url()}`);
      }
    };
    page.on('request', onRequest);

    await page.locator('app-studio-ai-mode-bar [data-mode="test"]').click();
    const panel = page.locator('[data-component-id="sai-test-panel"]');
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-component-id="sai-test-report"]')).toBeVisible();

    // Un tour de plus dans le panneau (formulaire simulé) : toujours aucune écriture.
    await panel.locator('input').first().fill('Test');
    await panel.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(panel.locator('[data-component-id="sai-test-saved"]')).toContainText('Enregistrement simulé : aucune donnée écrite.');
    await page.waitForTimeout(500);
    page.off('request', onRequest);

    const previews = ctx.find('/preview', 'GET');
    expect(previews.length).toBe(1);
    expect(previews[0].url).toMatch(/\/api\/studio\/ai\/plans\/plan-e2e-1\/preview$/);
    expect(writes).toEqual([]);
  });

  test('compte à rebours à 0 ⇒ Régénérer ⇒ POST …/replay', async ({ page }) => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const ctx = await setup(page, {
      plans: [{ id: 'p-expired', kind: 'CreateSystem', status: 'Pending', title: 'Gestion des congés', entityCount: 2, createdAt: new Date(Date.now() - 40 * 60_000).toISOString(), expiresAt: past }]
    });
    await gotoAtelier(page);

    await page.locator('app-studio-ai-rail [data-plan-id="p-expired"]').click();
    await expect(page.locator('app-studio-ai-preview')).toBeVisible();

    const expiry = page.locator('.sai-expiry');
    await expect(expiry).toHaveClass(/sai-expiry--expired/);
    await expect(expiry).toContainText('Expiré');
    await expect(page.locator('app-studio-ai-mode-bar [data-mode="customize"]')).toBeDisabled();

    await page.getByRole('button', { name: 'Régénérer' }).click();

    await expect.poll(() => ctx.find('/replay', 'POST').length).toBe(1);
    const replays = ctx.find('/replay', 'POST');
    expect(replays[0].url).toMatch(/\/api\/studio\/ai\/plans\/p-expired\/replay$/);

    // Le nouveau plan (p-replay) est ouvert : pilule active, modes déverrouillés.
    await expect(page.locator('app-studio-ai-conversation')).toContainText('Plan rejoué : une nouvelle proposition est ouverte.');
    await expect(expiry).not.toHaveClass(/sai-expiry--expired/);
    await expect(page.locator('app-studio-ai-mode-bar [data-mode="customize"]')).toBeEnabled();
  });

  test('Importer un JSON ⇒ POST systems/import ⇒ proposition en attente', async ({ page }) => {
    const ctx = await setup(page);
    await gotoAtelier(page);
    await loadImportFile(page);

    const dialog = page.locator('app-studio-ai-import-dialog');
    await expect(dialog).toContainText('2 tables · 1 relations · 0 vues');
    await dialog.locator('#saii-name').fill('Congés importés');
    await dialog.locator('[data-action="import"]').click();

    await expect.poll(() => ctx.find('/api/studio/systems/import', 'POST').length).toBe(1);
    const imports = ctx.find('/api/studio/systems/import', 'POST');
    const body = imports[0].body as { spec: { entities: unknown[] }; displayNameOverride: string | null; includeSeed: boolean };
    expect(body.spec.entities.length).toBe(2);
    expect(body.displayNameOverride).toBe('Congés importés');

    await expect(dialog.locator('p-dialog .p-dialog')).toHaveCount(0);
    await expect(page.locator('app-studio-ai-preview')).toBeVisible();
    await expect(page.locator('app-studio-ai-mode-bar')).toBeVisible();
    await expect(page.locator('app-studio-ai-conversation')).toContainText('Plan ouvert : vérifiez la proposition puis validez.');
    await expect(page.getByRole('button', { name: 'Créer maintenant' })).toBeEnabled();
  });

  test('Exporter ⇒ téléchargement studio-system-<clé>.json', async ({ page }) => {
    const ctx = await setup(page);
    await gotoAtelier(page);
    await openExportFromRail(page);

    const exports = ctx.find('/export', 'GET');
    expect(exports.length).toBe(1);
    expect(exports[0].url).toMatch(/\/api\/studio\/systems\/conges\/export\?includeSeed=false$/);

    const dialog = page.locator('app-studio-ai-export-dialog');
    await expect(dialog).toContainText('2 tables · 1 relations · 0 vues');
    await expect(dialog).toContainText('Fichier : studio-system-conges.json');

    const downloadPromise = page.waitForEvent('download');
    await dialog.locator('[data-action="download"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^studio-system-.+\.json$/);
    expect(download.suggestedFilename()).toBe('studio-system-conges.json');

    // Le fichier contient la spec seule (D16), identique à `download=true` côté serveur.
    const file = await download.path();
    const content = JSON.parse(fs.readFileSync(file!, 'utf8')) as { system?: { displayName: string }; entities?: unknown[] };
    expect(content.system?.displayName).toBe('Gestion des congés');
    expect(content.entities?.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// Captures pour le guide utilisateur (décision 22) : docs/screenshots/studio-ia-apercu-*.png
// ---------------------------------------------------------------------------------------------

const SCREENSHOTS_BASE = path.join(__dirname, '..', '..', '..', '..', 'docs', 'screenshots');

async function capture(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS_BASE, { recursive: true });
  // Laisse les animations PrimeNG (dialog, onglets) se terminer avant la capture.
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SCREENSHOTS_BASE, `studio-ia-apercu-${name}.png`), fullPage: true });
}

test.describe('captures', () => {
  test.skip(!process.env.STUDIO_DOC_SCREENSHOTS, 'captures docs — définir STUDIO_DOC_SCREENSHOTS=1');

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('apercu', async ({ page }) => {
    await setup(page);
    await arriveWithPlan(page);
    await capture(page, 'apercu');
  });

  test('tester', async ({ page }) => {
    await setup(page);
    await arriveWithPlan(page);
    await page.locator('app-studio-ai-mode-bar [data-mode="test"]').click();
    await expect(page.locator('[data-component-id="sai-test-report"]')).toBeVisible();
    await capture(page, 'tester');
  });

  test('personnaliser', async ({ page }) => {
    await setup(page);
    await arriveWithPlan(page);
    await renameFirstField(page, 'Nom complet');
    await expect(page.locator('.sai-modebar__badge')).toHaveText('1');
    await capture(page, 'personnaliser');
  });

  test('progression', async ({ page }) => {
    // `route.fulfill` livre le flux SSE d'un bloc et le store repasse à `idle` à la fin du flux : pour
    // figer la progression, le `fetch` de `POST …/confirm` est remplacé côté page par un flux qui
    // émet les étapes puis reste ouvert quelques secondes avant le résultat.
    const step = (phase: string, label: string, status: string, entityRef: string | null = null) =>
      `data: ${JSON.stringify({ type: 'studio_progress', content: JSON.stringify({ phase, label, status, entityRef, detail: null }) })}\n\n`;
    const chunks = [
      step('creating_system', 'Système « Gestion des congés »', 'done'),
      step('creating_entities', 'Table Employé', 'done', 'employe'),
      step('creating_entities', 'Table Demande de congé', 'running', 'demande'),
      step('creating_views', 'Vue Toutes les demandes', 'running', 'demande')
    ];
    await page.addInitScript(({ body, stallMs }) => {
      const original = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!/\/api\/studio\/ai\/plans\/[^/?]+\/confirm$/.test(url)) return original(input, init);
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(body));
            setTimeout(() => controller.close(), stallMs);
          }
        });
        return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
      };
    }, { body: chunks.join(''), stallMs: 8000 });
    await setup(page);
    await arriveWithPlan(page);
    await page.getByRole('button', { name: 'Créer maintenant' }).click();
    await page.locator('#sacd-ack').click();
    await page.locator('app-studio-ai-confirm-dialog').getByRole('button', { name: 'Intégrer' }).click();
    await expect(page.locator('app-studio-ai-progress')).toBeVisible();
    await expect(page.locator('app-studio-ai-progress')).toContainText('Table Employé');
    await capture(page, 'progression');
  });

  test('resultat', async ({ page }) => {
    await setup(page);
    await arriveWithPlan(page);
    await page.getByRole('button', { name: 'Créer maintenant' }).click();
    await page.locator('#sacd-ack').click();
    await page.locator('app-studio-ai-confirm-dialog').getByRole('button', { name: 'Intégrer' }).click();
    await expect(page.locator('app-studio-ai-result-card')).toBeVisible();
    await expect(page.locator('app-studio-ai-result-card [data-action="export"]')).toBeVisible();
    await capture(page, 'resultat');
  });

  test('import', async ({ page }) => {
    await setup(page);
    await gotoAtelier(page);
    await loadImportFile(page);
    await capture(page, 'import');
  });

  test('export', async ({ page }) => {
    await setup(page);
    await gotoAtelier(page);
    await openExportFromRail(page);
    await capture(page, 'export');
  });
});
