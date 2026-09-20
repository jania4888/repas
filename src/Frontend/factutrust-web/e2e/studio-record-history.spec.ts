import { test, expect, Page } from '@playwright/test';
import {
  STUDIO_E2E_USER,
  StudioMockContext,
  StudioRuntimeMockOptions,
  installStudioApiMocks,
  installStudioAuth,
  installStudioRuntimeMocks
} from './helpers/studio-mock.helpers';

/**
 * E2E de l'onglet « Historique » de la fiche enregistrement (4.7h5, D-47-66). API entièrement mockée
 * (`installStudioRuntimeMocks` sert `GET records/{clé}/{id}/history` : 3 entrées + page 2 de 2 entrées par
 * défaut, `history.items` pour l'état vide, `historyStatus: 500` pour l'état d'erreur).
 * `/edit` exige `custom_records:write` (D-B1) : le parcours est en écriture, l'onglet reste en lecture seule.
 */

const WRITE_PERMISSIONS = [...STUDIO_E2E_USER.effectivePermissions, 'custom_records:write'];

async function openRecord(page: Page, options: StudioRuntimeMockOptions = {}): Promise<StudioMockContext> {
  await installStudioAuth(page, WRITE_PERMISSIONS);
  const ctx = await installStudioApiMocks(page, { capabilities: { manyToManyEnabled: true, recordViewsEnabled: true }, permissions: WRITE_PERMISSIONS });
  await installStudioRuntimeMocks(page, ctx, options);
  await page.goto('/studio/d/interventions/r1/edit');
  await expect(page.getByTestId('studio-tab-form')).toBeVisible();
  return ctx;
}

test.describe('Studio — onglet Historique de la fiche (4.7 v1.1)', () => {
  test('onglet en dernière position, chargement à l’activation, lignes, « Charger plus »', async ({ page }) => {
    const ctx = await openRecord(page);

    // Ordre des onglets : Fiche | Liés — … | Workflows | Historique (D-B3) ; aucune requête avant l'activation (D-B4).
    const tabKeys = await page.locator('[data-testid^="studio-tab-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
    expect(tabKeys[0]).toBe('studio-tab-form');
    expect(tabKeys[tabKeys.length - 1]).toBe('studio-tab-history');
    expect(tabKeys.indexOf('studio-tab-history')).toBeGreaterThan(tabKeys.indexOf('studio-tab-workflows'));
    expect(ctx.find('/records/interventions/r1/history', 'GET').length).toBe(0);

    await page.getByTestId('studio-tab-history').click();
    await expect(page.getByTestId('srh-row-h1')).toBeVisible();
    await expect.poll(() => ctx.find('/records/interventions/r1/history', 'GET').length).toBe(1);
    expect(ctx.find('/records/interventions/r1/history', 'GET')[0].url).toContain('page=1&pageSize=20');

    await expect(page.getByTestId('srh-action-h1')).toHaveText('Modification');
    await expect(page.getByTestId('srh-user-h1')).toHaveText('Alice Martin');
    await expect(page.getByTestId('srh-change-h1-statut')).toContainText('Statut');
    await expect(page.getByTestId('srh-change-h1-statut')).toContainText('À planifier → Terminé');
    await expect(page.getByTestId('srh-change-h1-nom')).toContainText('Nom');
    await expect(page.getByTestId('srh-user-h2')).toHaveText('Utilisateur inconnu');
    await expect(page.getByTestId('srh-count')).toHaveText('3 sur 5');
    // Lecture seule : aucune action d'écriture dans l'onglet (S-base).
    await expect(page.getByTestId('srh-panel').locator('input, textarea, select')).toHaveCount(0);

    // « Charger plus » (D-B5) : page 2 ajoutée, 5 lignes, bouton disparu, 2 GET au total.
    await page.getByTestId('srh-load-more').click();
    await expect(page.getByTestId('srh-row-h5')).toBeVisible();
    await expect(page.locator('[data-testid^="srh-row-"]')).toHaveCount(5);
    await expect(page.getByTestId('srh-action-h5')).toHaveText('Création');
    await expect(page.getByTestId('srh-change-h5-nom')).toContainText('Nom');
    await expect(page.getByTestId('srh-count')).toHaveText('5 sur 5');
    await expect(page.getByTestId('srh-load-more')).toHaveCount(0);
    await expect.poll(() => ctx.find('/records/interventions/r1/history', 'GET').length).toBe(2);
    expect(ctx.find('/records/interventions/r1/history', 'GET')[1].url).toContain('page=2&pageSize=20');
  });

  test('historique vide ⇒ état vide, sans compteur ni « Charger plus »', async ({ page }) => {
    await openRecord(page, { history: { items: [] } });
    await page.getByTestId('studio-tab-history').click();
    await expect(page.getByTestId('srh-empty')).toContainText('Aucun historique pour cet enregistrement');
    await expect(page.getByTestId('srh-count')).toHaveCount(0);
    await expect(page.getByTestId('srh-load-more')).toHaveCount(0);
  });

  test('erreur serveur ⇒ bannière en ligne, « Réessayer » relance la requête (aucun toast global)', async ({ page }) => {
    const ctx = await openRecord(page, { historyStatus: 500 });
    await page.getByTestId('studio-tab-history').click();
    await expect(page.getByTestId('srh-error')).toContainText('Historique indisponible.');
    await expect.poll(() => ctx.find('/records/interventions/r1/history', 'GET').length).toBe(1);
    await expect(page.locator('.p-toast-message')).toHaveCount(0);

    await page.getByTestId('srh-retry').click();
    await expect.poll(() => ctx.find('/records/interventions/r1/history', 'GET').length).toBe(2);
    await expect(page.getByTestId('srh-error')).toBeVisible();
  });
});
