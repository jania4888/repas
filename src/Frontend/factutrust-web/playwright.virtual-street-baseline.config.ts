import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

/**
 * Baseline L0 de la rue virtuelle : assertions WebGL requises (jamais
 * conditionnelles) sur une carte publique synthétique non vide.
 *
 * Utilise le Chrome système (`channel: 'chrome'`) avec rendu logiciel
 * SwiftShader : aucun téléchargement de navigateur Playwright requis.
 * Sur un profil sans WebGL fonctionnel, le test de scène ÉCHOUE — c'est le
 * signal attendu ; il ne doit jamais être converti en réussite silencieuse.
 *
 *   npx playwright test --config=playwright.virtual-street-baseline.config.ts
 */
export default defineConfig({
  ...baseConfig,
  testMatch: /playwright\.virtual-street\.spec\.ts/,
  webServer: {
    // `npm start` du package.json utilise une syntaxe Windows (`set X=1&&`) ;
    // cette commande équivalente fonctionne aussi sous Linux/macOS CI.
    command: 'npx ng serve --no-hmr --poll=2000',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...baseConfig.projects?.[0]?.use,
        channel: 'chrome',
        launchOptions: {
          args: ['--no-sandbox', '--disable-gpu', '--use-angle=swiftshader']
        }
      }
    }
  ]
});
