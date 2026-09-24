import { type Page, type Route } from '@playwright/test';

/** État simulé de `GET /api/public/registration-status` (landing). */
export type RegistrationState = 'closed' | 'open' | 'error' | 'slow';

/**
 * Simule l'API d'état d'inscription : les tests de la landing ne dépendent
 * ni du backend ni de la configuration de production.
 */
export async function mockRegistrationStatus(page: Page, state: RegistrationState): Promise<void> {
  await page.route('**/api/public/registration-status', async (route: Route) => {
    if (state === 'error') {
      await route.abort('failed');
      return;
    }
    if (state === 'slow') {
      await new Promise(resolve => setTimeout(resolve, 6_000));
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          companyEnabled: state === 'open',
          firmEnabled: state === 'open'
        }
      })
    });
  });
}
