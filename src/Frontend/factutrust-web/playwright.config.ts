import { defineConfig, devices } from '@playwright/test';

/**
 * Configuration Playwright pour tests E2E
 * 
 * Documentation: https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  
  globalSetup: process.env.CI ? './e2e/ci-global-setup.ts' : undefined,
  
  /* Exclure les fichiers Selenium et les suites i18n à session simulée (playwright.i18n.config.ts :
     port dédié, captures de référence locales) */
  testIgnore: [/.*\.selenium\.spec\.ts$/, /[\\/]i18n[\\/]erp-(rtl|ar-routes|ar-live)[^\\/]*\.spec\.ts$/],
  
  /* Timeouts */
  timeout: 30 * 1000,
  expect: {
    timeout: 5000
  },
  
  /* Parallélisation */
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  
  /* Reporter */
  reporter: [
    ['html'],
    ['list'],
    ['json', { outputFile: 'e2e/test-results/results.json' }],
    ['junit', { outputFile: 'e2e/test-results/junit.xml' }],
    ['./playwright-junit-file-paths.reporter.ts', { outputFile: 'e2e/test-results/junit.xml' }]
  ],
  
  /* Shared settings */
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // Ignorer les erreurs SSL pour localhost
    ignoreHTTPSErrors: true,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test on mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },
  ],

  /* Run local dev server before starting the tests */
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    // Build Angular à froid en CI : 120 s ne suffisent pas (dépassement observé
    // sans le moindre cache de prébundling) ; 5 min donnent une marge sûre.
    timeout: 300 * 1000,
  },
});
