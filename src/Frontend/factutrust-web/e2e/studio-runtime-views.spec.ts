import { test, expect } from '@playwright/test';
const VIEWS_CAPABILITIES = { recordViewsEnabled: true, manyToManyEnabled: true };

import {
  STUDIO_E2E_USER,
  installStudioApiMocks,
  installStudioAuth,
  installStudioRuntimeMocks
} from './helpers/studio-mock.helpers';

/**
 * E2E du runtime des vues enregistrées (2.5h) : API entièrement mockée
 * (`installStudioApiMocks` + `installStudioRuntimeMocks`), aucun appel réseau réel.
 */

test.describe('Studio — runtime des vues (2.5)', () => {
  test('la page Données affiche le sélecteur de vues et la vue par défaut', async ({ page }) => {
    await installStudioAuth(page);
    const ctx = await installStudioApiMocks(page, { capabilities: VIEWS_CAPABILITIES });
    await installStudioRuntimeMocks(page, ctx);

    await page.goto('/studio/d/interventions');
    await expect(page.getByRole('tab', { name: 'Actives' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Par statut' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Modifier la vue' })).toBeVisible();
    await expect(page.getByText('Chaudière A12')).toBeVisible();
    await expect(page.getByText('Pompe B3')).toBeVisible();
    expect(ctx.find('/views/v-list/run', 'POST').length).toBe(1);
  });

  test('?view=v-kanban rend le kanban groupé par statut', async ({ page }) => {
    await installStudioAuth(page);
    const ctx = await installStudioApiMocks(page, { capabilities: VIEWS_CAPABILITIES });
    await installStudioRuntimeMocks(page, ctx);

    await page.goto('/studio/d/interventions?view=v-kanban');
    await expect(page.getByRole('region', { name: /Tableau kanban/ })).toBeVisible();
    await expect(page.getByText('À planifier')).toBeVisible();
    await expect(page.getByText('Chaudière A12')).toBeVisible();
    expect(ctx.find('/views/v-kanban/run', 'POST').length).toBe(1);
  });

  test('sans vues dans le schéma (drapeau coupé) ⇒ pas de sélecteur ni de bouton, liste brute inchangée', async ({ page }) => {
    await installStudioAuth(page);
    // Schéma sans `views` (fail-closed serveur) + capability coupée (fail-closed conception).
    const ctx = await installStudioApiMocks(page, { capabilities: { recordViewsEnabled: false } });
    await installStudioRuntimeMocks(page, ctx, { withoutViews: true });

    await page.goto('/studio/d/interventions');
    await expect(page.getByText('Chaudière A12')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Actives' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nouvelle vue' })).toHaveCount(0);
    // 4.7v2 : le concepteur poste l'aperçu sur /views/preview — exclu du comptage par sous-chaîne.
    expect(ctx.find('/views/', 'POST').filter(c => !c.url.includes('/views/preview')).length).toBe(0);
  });

  test('« Nouvelle vue » : formulaire, Enregistrer ⇒ POST /views', async ({ page }) => {
    await installStudioAuth(page);
    const ctx = await installStudioApiMocks(page, { capabilities: VIEWS_CAPABILITIES });
    // Sans vue existante, le bouton de tête est « Nouvelle vue » (sinon « Modifier la vue »).
    await installStudioRuntimeMocks(page, ctx, { withoutViews: true });

    await page.goto('/studio/d/interventions');
    await expect(page.getByText('Chaudière A12')).toBeVisible();
    await page.getByRole('button', { name: 'Nouvelle vue' }).click();
    await expect(page).toHaveURL(/\/studio\/d\/interventions\/views\/new/);
    await page.getByTestId('designer-name').fill('Vue E2E');
    await expect(page.getByTestId('designer-key')).toHaveValue('vue_e2e');
    await page.getByTestId('designer-save').click();
    // 4.7v2 : l'aperçu en direct émet POST /views/preview pendant la saisie — exclu du comptage.
    const posts = ctx.find('/views', 'POST').filter(c => !c.url.includes('/views/preview'));
    expect(posts.length).toBe(1);
    const body = posts[0].body as Record<string, unknown>;
    expect(body['key']).toBe('vue_e2e');
    expect(body['mode']).toBe('List');
    await expect(page).toHaveURL(/\/studio\/d\/interventions\?view=v-new/);
  });

  test('kanban en lecture seule sans custom_records:write : aucune carte déplaçable', async ({ page }) => {
    await installStudioAuth(page); // STUDIO_E2E_USER sans custom_records:write
    const ctx = await installStudioApiMocks(page, { capabilities: VIEWS_CAPABILITIES });
    await installStudioRuntimeMocks(page, ctx);

    await page.goto('/studio/d/interventions?view=v-kanban');
    await expect(page.getByRole('region', { name: /Tableau kanban/ })).toBeVisible();
    const draggable = page.locator('.cdk-drag:not(.cdk-drag-disabled)');
    await expect(draggable).toHaveCount(0);
    expect(ctx.find('/records/interventions/', 'PATCH').length).toBe(0);
  });

  test('drag kanban avec écriture + PATCH 409 ⇒ message de conflit, carte revenue', async ({ page }) => {
    const writePermissions = [...STUDIO_E2E_USER.effectivePermissions, 'custom_records:write'];
    await installStudioAuth(page, writePermissions);
    const ctx = await installStudioApiMocks(page, { capabilities: VIEWS_CAPABILITIES, permissions: writePermissions });
    await installStudioRuntimeMocks(page, ctx, { patchConflict409: true });

    await page.goto('/studio/d/interventions?view=v-kanban');
    await expect(page.getByRole('region', { name: /Tableau kanban/ })).toBeVisible();
    const card = page.locator('.kcard', { hasText: 'Chaudière A12' });
    await expect(card).toBeVisible();
    const cardBox = (await card.boundingBox())!;
    const target = page.locator('.kanban-col__body[aria-label="Fiches Terminé"]');
    const targetBox = (await target.boundingBox())!;

    // CDK drag (pointer events) : déplacement manuel par petits pas, puis repli sur le menu
    // « Déplacer vers… » (même `moveCard`, même PATCH) si le pointeur n'a pas déclenché le drag.
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 30, cardBox.y + 30, { steps: 8 });
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 24 });
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(300);
    if (ctx.find('/records/interventions/', 'PATCH').length === 0) {
      await page.getByRole('button', { name: 'Actions pour Chaudière A12' }).click();
      await page.getByRole('menuitem', { name: 'Terminé' }).click();
    }

    await expect.poll(() => ctx.find('/records/interventions/', 'PATCH').length, { timeout: 5000 }).toBe(1);
    await expect(page.getByText(/modifiée ailleurs/i)).toBeVisible();
    // La carte est revenue dans sa colonne d'origine (rechargement après 409).
    await expect(page.locator('.kanban-col', { hasText: 'À planifier' }).getByText('Chaudière A12')).toBeVisible();
  });
});
