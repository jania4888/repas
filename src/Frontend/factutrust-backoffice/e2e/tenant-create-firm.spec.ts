import { test, expect } from '@playwright/test';

/**
 * E2E création de cabinet depuis la liste des entreprises (port 4300).
 * Prérequis : backoffice démarré (`npm start`), API jointe, session plateforme valide portant
 * `platform.tenants:write`, et `Features:AccountingFirms:Enabled` à true côté serveur.
 *
 * Ce scénario reproduit le défaut d'origine : le menu s'ouvrait, mais cliquer
 * « Nouveau cabinet comptable » ne déclenchait aucune navigation — le `<li>` du TieredMenu était
 * recréé entre `mousedown` et `mouseup`, donc aucun `click` n'était émis.
 */
test.describe('Backoffice — création de cabinet comptable', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:4300/tenants');
  });

  test('le menu du bouton scindé navigue vers le formulaire cabinet', async ({ page }) => {
    await page.locator('p-splitbutton .p-splitbutton-dropdown, p-splitButton .p-splitbutton-dropdown').first().click();

    const menu = page.locator('.p-tieredmenu-overlay, .p-tieredmenu').last();
    await expect(menu).toBeVisible();

    await menu.getByText('Nouveau cabinet comptable').click();

    await expect(page).toHaveURL(/\/tenants\/new\/firm$/);
    await expect(page.getByLabel('Nom du cabinet')).toBeVisible();
  });

  test('le bouton principal mène toujours au formulaire entreprise', async ({ page }) => {
    await page.getByRole('button', { name: 'Nouvelle entreprise' }).first().click();
    await expect(page).toHaveURL(/\/tenants\/new\/company$/);
  });
});
