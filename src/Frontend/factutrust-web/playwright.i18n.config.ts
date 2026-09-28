import { defineConfig, devices } from '@playwright/test';

/**
 * Suites i18n/RTL de l'ERP (e2e/i18n/erp-*.spec.ts) sur une session simulée : aucun backend requis,
 * sauf erp-ar-live (API locale isolée, ignorée sans I18N_LIVE_ACCOUNT ; voir l'en-tête du fichier).
 * Port dédié et jamais de réutilisation d'un serveur existant — un `ng serve` lancé depuis une autre
 * copie de travail sur 4200 servirait un autre code.
 *
 * Usage : npx playwright test -c playwright.i18n.config.ts [--grep …]
 */
const PORT = Number(process.env.I18N_E2E_PORT ?? 4210);

export default defineConfig({
  testDir: './e2e/i18n',
  testMatch: /erp-(rtl|ar-routes|ar-live)[^/]*\.spec\.ts$/,
  outputDir: './e2e/test-results/i18n',
  snapshotPathTemplate: './e2e/test-results/i18n-snapshots/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['json', { outputFile: 'e2e/test-results/i18n/results.json' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx ng serve --port ${PORT} --no-hmr`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000
  }
});
