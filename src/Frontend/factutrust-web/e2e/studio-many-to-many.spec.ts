import { test, expect } from '@playwright/test';
import {
  STUDIO_E2E_USER,
  installStudioApiMocks,
  installStudioAuth,
  installStudioRuntimeMocks
} from './helpers/studio-mock.helpers';

/**
 * E2E du parcours relations plusieurs-à-plusieurs (2.5h) : concepteur de table (dialog + POST),
 * fiche « Liés » (409 en ligne), page Relations, badge Jonction. API entièrement mockée.
 */

const M2M_CAPABILITIES = { manyToManyEnabled: true, recordViewsEnabled: true };

test.describe('Studio — relations plusieurs-à-plusieurs (2.5)', () => {
  test('concepteur de table : bouton, dialog, POST relations/many-to-many', async ({ page }) => {
    await installStudioAuth(page);
    const ctx = await installStudioApiMocks(page, { capabilities: M2M_CAPABILITIES });
    await installStudioRuntimeMocks(page, ctx);

    await page.goto('/studio/e-int');
    await page.getByTestId('m2m-open').click();
    await expect(page.getByRole('dialog', { name: 'Ajouter une relation plusieurs-à-plusieurs' })).toBeVisible();
    await page.getByTestId('m2m-target').click();
    await page.getByRole('option', { name: 'Techniciens' }).click();
    await expect(page.getByTestId('m2m-junction-key')).toHaveAttribute('placeholder', 'interventions_techniciens');
    // v1.1 (D-47-40) : « Attribut de liaison » est un champ actif (plus de bloc « Bientôt »).
    await expect(page.getByTestId('m2m-attribute')).toBeVisible();
    await expect(page.getByText('Attribut de liaison — Bientôt')).toHaveCount(0);
    await page.getByTestId('m2m-attribute').fill('Quantité');
    await page.getByTestId('m2m-submit').click();

    const posts = ctx.find('relations/many-to-many', 'POST');
    expect(posts.length).toBe(1);
    expect((posts[0].body as Record<string, unknown>)['targetEntityId']).toBe('e-tech');
    expect((posts[0].body as Record<string, unknown>)['junctionAttributeLabel']).toBe('Quantité');
    await expect(page.getByRole('dialog', { name: 'Ajouter une relation plusieurs-à-plusieurs' })).toHaveCount(0);
  });

  test('fiche enregistrement : onglets Fiche / Liés, ajout en 409 ⇒ « Lien déjà existant. »', async ({ page }) => {
    const writePermissions = [...STUDIO_E2E_USER.effectivePermissions, 'custom_records:write'];
    await installStudioAuth(page, writePermissions);
    const ctx = await installStudioApiMocks(page, { capabilities: M2M_CAPABILITIES, permissions: writePermissions });
    await installStudioRuntimeMocks(page, ctx, { duplicateLinkOn409: true });

    await page.goto('/studio/d/interventions/r1/edit');
    await expect(page.getByTestId('studio-tab-form')).toBeVisible();
    await page.getByTestId('studio-tab-linked:intervention_technicien').click();
    await expect(page.getByTestId('linked-row-t1')).toContainText('Ben Ali');

    await page.getByTestId('linked-search').click();
    await page.getByRole('option', { name: 'Sassi' }).click();
    await page.getByTestId('linked-add').click();

    const posts = ctx.find('/records/intervention_technicien', 'POST');
    expect(posts.length).toBe(1);
    expect((posts[0].body as Record<string, unknown>)['data']).toEqual({ intervention_id: 'r1', technicien_id: 't2' });
    await expect(page.getByTestId('linked-error')).toContainText('Lien déjà existant.');
    await expect(page.getByTestId('linked-row-t1')).toBeVisible();
  });

  test('fiche : puces inline — affichage quantité, ajout avec quantité, doublon 409, retrait', async ({ page }) => {
    const writePermissions = [...STUDIO_E2E_USER.effectivePermissions, 'custom_records:write'];
    await installStudioAuth(page, writePermissions);
    const ctx = await installStudioApiMocks(page, { capabilities: M2M_CAPABILITIES, permissions: writePermissions });
    await installStudioRuntimeMocks(page, ctx, { junctionAttribute: true });

    await page.goto('/studio/d/interventions/r1/edit');
    // v1.1 (D-47-40) : une carte de puces par relation N-N SOUS le formulaire (onglet Fiche).
    await expect(page.getByTestId('chips-intervention_technicien')).toBeVisible();
    await expect(page.getByTestId('chip-t1')).toContainText('Ben Ali');
    await expect(page.getByTestId('chip-attr-t1')).toContainText('3');

    // Ajout avec quantité.
    await page.getByTestId('chip-search').click();
    await page.getByRole('option', { name: 'Sassi' }).click();
    await page.getByTestId('chip-attr-input').locator('input').fill('2');
    await page.getByTestId('chip-add').click();
    const posts = ctx.find('/records/intervention_technicien', 'POST');
    expect(posts.length).toBe(1);
    expect((posts[0].body as Record<string, Record<string, unknown>>)['data'])
      .toEqual({ intervention_id: 'r1', technicien_id: 't2', quantite: 2 });

    // Doublon ⇒ 409 « Lien déjà existant. » en ligne (route surchargée APRÈS ⇒ prioritaire).
    await page.route('**/api/studio/records/intervention_technicien', route => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(
          { success: false, data: null, message: 'Lien déjà existant.', errors: [], code: 'record.duplicate_link' }) });
      }
      return route.fallback();
    });
    await page.getByTestId('chip-search').click();
    await page.getByRole('option', { name: 'Ben Ali' }).click();
    await page.getByTestId('chip-add').click();
    await expect(page.getByTestId('chips-error')).toContainText('Lien déjà existant.');
    await expect(page.getByTestId('chip-t1')).toBeVisible();

    // Retrait ⇒ DELETE, puce retirée.
    await page.getByTestId('chip-remove-t1').click();
    expect(ctx.find('/records/intervention_technicien/j-rec-1', 'DELETE').length).toBe(1);
    await expect(page.getByTestId('chip-t1')).toHaveCount(0);
  });

  test('page /studio/relations : tableau dédoublonné + diagramme role=img', async ({ page }) => {
    await installStudioAuth(page);
    const ctx = await installStudioApiMocks(page, { capabilities: M2M_CAPABILITIES });
    await installStudioRuntimeMocks(page, ctx);

    await page.goto('/studio/relations');
    await expect(page.getByRole('img', { name: /Diagramme des relations/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Plusieurs-à-plusieurs' })).toBeVisible();
    await expect(page.getByText('intervention_technicien')).toBeVisible();
    expect(ctx.find('/relations', 'GET').length).toBe(2); // une fois par table non jonction
  });

  test('liste des tables : jonction masquée par défaut puis visible avec badge', async ({ page }) => {
    await installStudioAuth(page);
    const ctx = await installStudioApiMocks(page, { capabilities: M2M_CAPABILITIES });
    await installStudioRuntimeMocks(page, ctx);

    await page.goto('/studio');
    await expect(page.getByRole('cell', { name: /Interventions/ }).first()).toBeVisible();
    await expect(page.getByText('Intervention × Technicien')).toHaveCount(0);

    await page.getByTestId('hide-junctions').click();
    await expect(page.getByText('Intervention × Technicien')).toBeVisible();
    await expect(page.getByTestId('junction-badge')).toHaveText('Jonction');
  });
});
