import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { snapshotErpText } from './erp-text-utils';

const baselineDir = path.join(__dirname, '..', 'baselines', 'fr-text');

function baselinePath(name: string): string {
  return path.join(baselineDir, `${name}.json`);
}

function readBaseline(name: string): string | null {
  const p = baselinePath(name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function writeBaseline(name: string, json: string): void {
  fs.mkdirSync(baselineDir, { recursive: true });
  fs.writeFileSync(baselinePath(name), json, 'utf8');
}

const updateBaselines = process.env.UPDATE_SNAPSHOTS === '1' || process.env.UPDATE_BASELINES === '1';

test.describe('ERP — parité texte FR', () => {
  test('auth/login — titre et texte visible', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('html')).toHaveAttribute('lang', /fr/i);

    const snap = await snapshotErpText(page);
    const payload = JSON.stringify(snap, null, 2);

    if (updateBaselines) {
      writeBaseline('auth-login', payload);
      return;
    }

    const existing = readBaseline('auth-login');
    if (!existing) {
      writeBaseline('auth-login', payload);
      test.info().annotations.push({
        type: 'note',
        description: 'Baseline auth-login créée ; relancer sans UPDATE pour vérifier la parité.'
      });
      return;
    }

    expect(JSON.parse(payload)).toEqual(JSON.parse(existing));
  });
});
