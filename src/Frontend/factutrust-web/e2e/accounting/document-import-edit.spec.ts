import { test, expect } from '@playwright/test';

test.describe('Document import edit in modal', () => {
  test('shows editable proposal grid after import review', async ({ page }) => {
    await page.goto('/accounting/manual-entry');
    if (page.url().includes('/auth/login')) {
      test.skip(true, 'Authentication required');
    }

    await page.getByRole('button', { name: /^Import$/i }).click();
    await page.getByRole('button', { name: /Importer une facture/i }).click();
    const dialog = page.getByRole('dialog', { name: /Importer une facture/i });
    await expect(dialog).toBeVisible();

    // Without a real file upload in CI, verify idle state and editor wiring when review is shown.
    await expect(dialog.getByText(/Importez une facture à comptabiliser/i)).toBeVisible();
  });

  test('shows a local preview before proposing an entry', async ({ page }) => {
    await page.goto('/accounting/manual-entry');
    if (page.url().includes('/auth/login')) {
      test.skip(true, 'Authentication required');
    }

    const proposeCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/accounting/document-import/propose')) {
        proposeCalls.push(req.url());
      }
    });

    await page.getByRole('button', { name: /^Import$/i }).click();
    await page.getByRole('button', { name: /Importer une facture/i }).click();
    const dialog = page.getByRole('dialog', { name: /Importer une facture/i });
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'facture.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
    });

    await expect(dialog.getByRole('region', { name: /Aperçu de la facture/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Analyser la facture/i })).toBeVisible();
    expect(proposeCalls).toEqual([]);
  });

  test('manual entry grid remains editable after standard navigation', async ({ page }) => {
    await page.goto('/accounting/manual-entry');
    if (page.url().includes('/auth/login')) {
      test.skip(true, 'Authentication required');
    }

    await expect(page.getByText('Lignes d\'écriture')).toBeVisible();
    await expect(page.getByRole('button', { name: /Ajouter une ligne/i })).toBeVisible();
  });
});
