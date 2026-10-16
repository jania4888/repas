import { test, expect, Locator, Page } from '@playwright/test';
import {
  SseEvent,
  StudioMockContext,
  setupStudioAtelier,
  studioPlanEvents
} from './helpers/studio-mock.helpers';

/**
 * E2E — Atelier Studio IA (PR 1.4, plan maître §4.5) : coquille 3 colonnes, rail, modèle avancé
 * (D3), bandeau doublons (R21), confirmation « message pendant un plan » (A19), réinitialisation,
 * thème indigo scopé (D2). Tout le backend est mocké par `e2e/helpers/studio-mock.helpers.ts` :
 * la suite est déterministe et indépendante du serveur .NET.
 *
 * Référence QA manuelle : docs/developer/studio-ai-assistant-qa.md, smoke tests 91–94.
 */

const DUPLICATES = [
  { specRef: 'employe', specDisplayName: 'Employé', existingKey: 'employes', existingDisplayName: 'Employés', reason: 'same_key' }
];

async function gotoAtelier(page: Page): Promise<void> {
  await page.goto('/studio/ai');
  // L'atelier (workbench) est branché quand les capacités mockées sont prêtes.
  await expect(page.getByRole('heading', { name: 'Décrivez le système que vous souhaitez créer' })).toBeVisible();
}

/** Remplit le composeur principal et envoie (bouton « Générer avec l’IA »). */
async function submitFromComposer(page: Page, text: string): Promise<void> {
  await page.locator('app-studio-ai-composer textarea').first().fill(text);
  await page.getByRole('button', { name: 'Générer avec l’IA' }).first().click();
}

test.describe('Atelier Studio IA — coquille et rail', () => {
  test('rail à droite en grand écran, empilé sous la colonne principale en dessous de 1280 px', async ({ page }) => {
    const ctx = await setupStudioAtelier(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAtelier(page);

    const main = page.locator('.studio-ai-page__main');
    const rail = page.locator('app-studio-ai-rail');
    await expect(rail).toBeVisible();

    // Les trois cartes du rail et leurs liens « Voir tous / Voir tout ».
    await expect(rail).toContainText('Modèles de systèmes');
    await expect(rail).toContainText('CRM commercial');
    await expect(rail).toContainText('Actions rapides');
    await expect(rail).toContainText('Historique des générations');
    await expect(rail.getByRole('link', { name: 'Voir tous' })).toHaveAttribute('href', '/studio/ai/templates');
    await expect(rail.getByRole('link', { name: 'Voir tout' })).toHaveAttribute('href', '/studio/ai/projects');

    const mainBox = (await main.boundingBox())!;
    const railBox = (await rail.boundingBox())!;
    expect(railBox.x).toBeGreaterThan(mainBox.x + mainBox.width - 20);

    // Sous 1280 px, le rail s'empile sous la colonne principale.
    await page.setViewportSize({ width: 1000, height: 900 });
    const mainBoxS = (await main.boundingBox())!;
    const railBoxS = (await rail.boundingBox())!;
    expect(railBoxS.y).toBeGreaterThanOrEqual(mainBoxS.y + mainBoxS.height - 2);

    expect(ctx.find('/api/ai/studio/capabilities', 'GET').length).toBeGreaterThan(0);
    expect(ctx.find('/api/studio/templates', 'GET').length).toBeGreaterThan(0);
    expect(ctx.find('/api/studio/ai/plans', 'GET').length).toBeGreaterThan(0);
  });

  test('cartes d’intention : Page reste « Bientôt », Workflow suit la capability', async ({ page }) => {
    await setupStudioAtelier(page);
    await gotoAtelier(page);
    const pageCard = page.locator('app-studio-ai-intent-cards').getByText('Page / Interface');
    await expect(pageCard).toBeVisible();
    await expect(page.locator('app-studio-ai-intent-cards').getByText('Bientôt').first()).toBeVisible();

    // Avec workflowToolsEnabled, la carte Workflow devient cliquable et préremplit le composeur.
    const page2 = await page.context().newPage();
    await setupStudioAtelier(page2, { capabilities: { workflowToolsEnabled: true } });
    await page2.goto('/studio/ai');
    await expect(page2.getByRole('heading', { name: 'Décrivez le système que vous souhaitez créer' })).toBeVisible();
    await page2.locator('app-studio-ai-intent-cards').getByText('Workflow').first().click();
    await expect(page2.locator('app-studio-ai-composer textarea').first()).toHaveValue(/workflow de statut/);
    await page2.close();
  });
});

test.describe('Atelier Studio IA — modèle avancé (D3)', () => {
  test('le toggle envoie useAdvancedModel et le mémo SSE « Généré avec le modèle avancé » s’affiche', async ({ page }) => {
    const ctx = await setupStudioAtelier(page, { chatEvents: studioPlanEvents({ usedAdvancedModel: true }) });
    await gotoAtelier(page);

    const toggle = page.locator('p-toggleswitch').first();
    await expect(toggle).toBeVisible();
    await toggle.click();

    await submitFromComposer(page, 'Crée un système de gestion des congés');

    const chatCalls = ctx.find('/api/ai/chat', 'POST');
    expect(chatCalls.length).toBe(1);
    const body = chatCalls[0].body as { options?: { useAdvancedModel?: boolean } };
    expect(body?.options?.useAdvancedModel).toBe(true);

    await expect(page.locator('[data-testid="model-advanced"]')).toContainText('Généré avec le modèle avancé');
    await expect(page.locator('app-studio-ai-preview')).toBeVisible();

    // Le choix est mémorisé (localStorage) et restauré après rechargement.
    expect(await page.evaluate(() => localStorage.getItem('studio.ai.advancedModel'))).toBe('1');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Décrivez le système que vous souhaitez créer' })).toBeVisible();
    await expect(page.locator('p-toggleswitch input').first()).toBeChecked();
  });

  test('repli serveur : bandeau « Modèle standard utilisé » avec la raison, proposition conservée', async ({ page }) => {
    await setupStudioAtelier(page, {
      chatEvents: studioPlanEvents({ usedAdvancedModel: false, fallbackReason: 'unavailable' })
    });
    await gotoAtelier(page);
    await page.locator('p-toggleswitch').first().click();

    await submitFromComposer(page, 'Crée un système de gestion des congés');

    const banner = page.locator('[data-testid="model-fallback"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Modèle standard utilisé');
    await expect(banner).toContainText('le modèle avancé est indisponible pour le moment.');
    await expect(page.locator('app-studio-ai-preview')).toBeVisible();
  });

  test('sans modèle avancé configuré, le toggle disparaît et aucune option n’est envoyée', async ({ page }) => {
    const ctx = await setupStudioAtelier(page, {
      capabilities: { advancedModelAvailable: false, advancedModelLabel: null },
      chatEvents: studioPlanEvents({ usedAdvancedModel: false })
    });
    await gotoAtelier(page);
    await expect(page.locator('p-toggleswitch')).toHaveCount(0);

    await submitFromComposer(page, 'Crée un système de gestion des congés');
    const chatCalls = ctx.find('/api/ai/chat', 'POST');
    expect(chatCalls.length).toBe(1);
    const body = chatCalls[0].body as { options?: Record<string, unknown> };
    expect(body?.options?.['useAdvancedModel']).toBeFalsy();
    await expect(page.locator('[data-testid="model-fallback"]')).toHaveCount(0);
  });
});

test.describe('Atelier Studio IA — bandeau doublons (R21)', () => {
  test('« Réutiliser la table existante » envoie existingKey dans la spec et ferme le bandeau', async ({ page }) => {
    const ctx = await setupStudioAtelier(page, {
      chatEvents: studioPlanEvents({ usedAdvancedModel: true, duplicates: DUPLICATES })
    });
    await gotoAtelier(page);
    await submitFromComposer(page, 'Crée un système RH avec une table Employés');

    const banner = page.locator('.sai-dup');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('La table « Employé » existe déjà');
    await expect(banner).toContainText('même clé');

    await banner.getByRole('button', { name: 'Réutiliser la table existante' }).click();

    const puts = ctx.find('/spec', 'PUT');
    expect(puts.length).toBe(1);
    const spec = JSON.parse((puts[0].body as { specJson: string }).specJson) as {
      entities: { ref: string; existingKey?: string }[];
    };
    expect(spec.entities.find(e => e.ref === 'employe')?.existingKey).toBe('employes');
    await expect(banner).toHaveCount(0);
  });

  test('« Créer quand même » renomme la table avec le suffixe « (2) »', async ({ page }) => {
    const ctx = await setupStudioAtelier(page, {
      chatEvents: studioPlanEvents({ usedAdvancedModel: true, duplicates: DUPLICATES })
    });
    await gotoAtelier(page);
    await submitFromComposer(page, 'Crée un système RH avec une table Employés');

    const banner = page.locator('.sai-dup');
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Créer quand même' }).click();

    const puts = ctx.find('/spec', 'PUT');
    expect(puts.length).toBe(1);
    const spec = JSON.parse((puts[0].body as { specJson: string }).specJson) as {
      entities: { ref: string; displayName: string; displayNamePlural: string }[];
    };
    const renamed = spec.entities.find(e => e.ref === 'employe');
    expect(renamed?.displayName).toBe('Employé (2)');
    expect(renamed?.displayNamePlural).toBe('Employés (2)');
    await expect(banner).toHaveCount(0);
  });
});

test.describe('Atelier Studio IA — message pendant un plan (A19) et réinitialisation', () => {
  async function arriveWithPlan(page: Page, ctx: StudioMockContext): Promise<void> {
    await gotoAtelier(page);
    await submitFromComposer(page, 'Crée un système de gestion des congés');
    await expect(page.locator('app-studio-ai-preview')).toBeVisible();
  }

  test('« Garder la proposition » annule l’envoi : ni cancel ni nouveau chat', async ({ page }) => {
    const ctx = await setupStudioAtelier(page);
    await arriveWithPlan(page, ctx);

    await page.locator('.studio-ai-page__followup textarea').fill('Ajoute une table Formations');
    await page.locator('.studio-ai-page__followup textarea').press('Enter');

    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.modal-title')).toHaveText('Une proposition est en attente');
    await modal.locator('.confirm-modal-btn-reject').click();
    await expect(modal).toHaveCount(0);

    expect(ctx.find('/api/ai/chat', 'POST').length).toBe(1);
    expect(ctx.find('/cancel', 'POST').length).toBe(0);
    await expect(page.locator('app-studio-ai-preview')).toBeVisible();
  });

  test('« Abandonner le plan et envoyer » annule le plan PUIS envoie le nouveau message', async ({ page }) => {
    const ctx = await setupStudioAtelier(page);
    await arriveWithPlan(page, ctx);

    await page.locator('.studio-ai-page__followup textarea').fill('Ajoute une table Formations');
    await page.locator('.studio-ai-page__followup textarea').press('Enter');

    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();
    await modal.locator('.confirm-modal-btn-accept').click();

    await expect(page.locator('app-studio-ai-preview')).toBeVisible();
    const calls = ctx.calls;
    const cancelIdx = calls.findIndex(c => c.method === 'POST' && /plans\/plan-e2e-1\/cancel$/.test(c.url));
    const chatIdxs = calls.map((c, i) => ({ c, i })).filter(({ c }) => c.method === 'POST' && c.url.includes('/api/ai/chat')).map(({ i }) => i);
    expect(cancelIdx).toBeGreaterThanOrEqual(0);
    expect(chatIdxs.length).toBe(2);
    expect(cancelIdx).toBeLessThan(chatIdxs[1]);
  });

  test('« Réinitialiser la conversation » annule les plans en attente et repart à zéro', async ({ page }) => {
    const ctx = await setupStudioAtelier(page);
    await arriveWithPlan(page, ctx);

    await page.locator('app-studio-ai-rail [data-action="reset"]').click();
    const modal = page.locator('.modal-content');
    await expect(modal.locator('.modal-title')).toHaveText('Réinitialiser la conversation ?');
    await modal.locator('.confirm-modal-btn-accept').click();

    await expect(page.locator('.toast-item').filter({ hasText: '1 plan(s) en attente annulé(s).' })).toBeVisible();
    expect(ctx.find('/cancel-pending', 'POST').length).toBe(1);
    expect(ctx.find('/api/ai/conversations/conv-e2e-1', 'DELETE').length).toBe(1);
    await expect(page.getByRole('heading', { name: 'Décrivez le système que vous souhaitez créer' })).toBeVisible();
    await expect(page.locator('app-studio-ai-preview')).toHaveCount(0);
  });
});

/** Rapport calculé à la volée : aucun plan, la vue reste « compose ». */
function studioReportEvents(): SseEvent[] {
  return [
    { type: 'meta', content: JSON.stringify({ usedAdvancedModel: false, advancedModelFallbackReason: null }) },
    {
      type: 'studio_report_result',
      content: JSON.stringify({
        success: true,
        title: 'ACHATS PAR FOURNISSEUR',
        source: 'purchases',
        sourceLabel: 'Achats',
        result: {
          columns: [
            { key: 'name', label: 'SUPPLIERS · NAME', kind: 'dimension' },
            { key: 'total', label: 'SOMME DE TOTAL AMOUNT', kind: 'measure', numeric: true },
            { key: 'count', label: 'NOMBRE', kind: 'measure', numeric: true }
          ],
          rows: [
            { name: 'Ste samir', total: 6770.55, count: 3 },
            { name: 'Ste Mbarki', total: 583.1, count: 2 }
          ],
          totalRows: 2
        },
        warnings: [],
        message: ''
      })
    },
    { type: 'content', content: 'Voici le rapport.' },
    { type: 'done', content: '', conversationId: 'conv-e2e-1' }
  ];
}

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

test.describe('Atelier Studio IA — résultat sous la saisie', () => {
  test('le tableau d’un rapport est sous la saisie, pas sous les cartes', async ({ page }) => {
    const ctx = await setupStudioAtelier(page, { chatEvents: studioReportEvents() });
    await page.setViewportSize({ width: 1440, height: 1200 });
    await gotoAtelier(page);
    await submitFromComposer(page, 'Créer un rapport d’articles regroupé par fournisseurs avec le total d’achats');

    const composer = page.locator('app-studio-ai-composer').first();
    const conversation = page.locator('app-studio-ai-conversation');
    const cards = page.locator('app-studio-ai-intent-cards');
    const report = conversation.getByRole('heading', { name: 'ACHATS PAR FOURNISSEUR' });
    await expect(conversation).toHaveCount(1);
    await expect(report).toBeVisible();
    await expect(conversation.getByText('Ste samir')).toBeVisible();

    const composerBox = await box(composer);
    const conversationBox = await box(conversation);
    const cardsBox = await box(cards);
    const reportBox = await box(report);
    expect(conversationBox.y).toBeGreaterThanOrEqual(composerBox.y + composerBox.height - 2);
    expect(cardsBox.y).toBeGreaterThanOrEqual(conversationBox.y + conversationBox.height - 2);
    expect(reportBox.y).toBeGreaterThan(composerBox.y);
    expect(reportBox.y).toBeLessThan(1200);

    await conversation.getByRole('button', { name: 'Graphique' }).click();
    await expect(conversation.locator('canvas').first()).toBeVisible();
    await conversation.getByRole('button', { name: 'Tableau' }).click();
    await expect(conversation.getByText('Ste samir')).toBeVisible();

    await conversation.getByRole('button', { name: 'Exporter' }).click();
    await expect(page.getByText('CSV — page courante')).toBeVisible();
    await page.keyboard.press('Escape');

    const composerY = (await box(composer)).y;
    await conversation.getByRole('button', { name: 'Masquer la conversation' }).click();
    await expect(report).toBeHidden();
    expect(Math.abs((await box(composer)).y - composerY)).toBeLessThan(2);
    await conversation.getByRole('button', { name: 'Afficher la conversation' }).click();
    await expect(report).toBeVisible();

    await page.setViewportSize({ width: 900, height: 900 });
    const composerNarrow = await box(composer);
    const conversationNarrow = await box(conversation);
    const cardsNarrow = await box(cards);
    const railNarrow = await box(page.locator('app-studio-ai-rail'));
    const mainNarrow = await box(page.locator('.studio-ai-page__main'));
    expect(conversationNarrow.y).toBeGreaterThanOrEqual(composerNarrow.y + composerNarrow.height - 2);
    expect(cardsNarrow.y).toBeGreaterThanOrEqual(conversationNarrow.y + conversationNarrow.height - 2);
    expect(railNarrow.y).toBeGreaterThanOrEqual(mainNarrow.y + mainNarrow.height - 2);

    await composer.locator('textarea').fill('Et le détail par article');
    await page.getByRole('button', { name: 'Générer avec l’IA' }).first().click();
    await expect(report).toHaveCount(2);

    await conversation.getByRole('button', { name: 'Enregistrer comme état' }).first().click();
    await expect(conversation.getByText('Enregistre cet état : ACHATS PAR FOURNISSEUR')).toBeVisible();
    const chats = ctx.find('/api/ai/chat', 'POST');
    expect(chats.length).toBe(3);
    expect(JSON.stringify(chats[2].body)).toContain('Enregistre cet état');
  });

  test('avec une proposition, le fil reste sous la saisie et l’aperçu en dessous', async ({ page }) => {
    await setupStudioAtelier(page, { chatEvents: studioPlanEvents() });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await gotoAtelier(page);
    await submitFromComposer(page, 'Crée un système de gestion des congés');

    const followup = page.locator('.studio-ai-page__followup');
    const conversation = page.locator('app-studio-ai-conversation');
    const preview = page.locator('app-studio-ai-preview');
    await expect(preview).toBeVisible();
    await expect(conversation).toHaveCount(1);

    const followupBox = await box(followup);
    const conversationBox = await box(conversation);
    const previewBox = await box(preview);
    expect(conversationBox.y).toBeGreaterThanOrEqual(followupBox.y + followupBox.height - 2);
    expect(previewBox.y).toBeGreaterThanOrEqual(conversationBox.y + conversationBox.height - 2);

    await page.getByRole('tab', { name: /^Tables/ }).click();
    await expect(page.getByRole('tab', { name: /^Tables/, selected: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Créer maintenant' })).toBeEnabled();
  });
});

test.describe('Atelier Studio IA — thème indigo scopé (D2)', () => {
  test('/studio/** est indigo #4f46e5 sans toucher au bleu global ; /dashboard reste bleu', async ({ page }) => {
    await setupStudioAtelier(page);
    await gotoAtelier(page);

    const primaryOf = (sel: string) => page.evaluate(selector => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el).getPropertyValue('--color-primary-600').trim() : null;
    }, sel);

    // La racine de l'application conserve le bleu Trust même dans le Studio : le thème est scopé.
    await expect(page.locator('app-studio-shell')).toBeVisible();
    expect(await primaryOf('body')).toBe('#2563eb');
    expect(await primaryOf('.studio-theme')).toBe('#4f46e5');

    // Un composant PrimeNG dans le périmètre rend réellement l'indigo.
    const buttonBg = await page.getByRole('button', { name: 'Générer avec l’IA' }).first()
      .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(buttonBg).toBe('rgb(79, 70, 229)');

    // Hors /studio/** : aucune balise .studio-theme et le bleu global est inchangé.
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: 'Tableau de bord' }).first()).toBeVisible();
    expect(await page.locator('.studio-theme').count()).toBe(0);
    expect(await primaryOf('body')).toBe('#2563eb');
  });
});
