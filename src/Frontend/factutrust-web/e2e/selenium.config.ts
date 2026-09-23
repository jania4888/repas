/**
 * Configuration Selenium pour tests E2E
 */

export const seleniumConfig = {
  // URLs
  baseUrl: 'http://localhost:4200',
  apiUrl: 'https://localhost:7001/api',
  
  // Timeouts (en millisecondes)
  timeouts: {
    implicit: 10000,
    pageLoad: 30000,
    script: 30000
  },
  
  // Selenium WebDriver
  browser: 'chrome', // 'chrome', 'firefox', 'edge'
  headless: false, // true pour exécution sans interface
  
  // Screenshots
  screenshots: {
    enabled: true,
    path: './e2e/screenshots'
  },
  
  // Données de test
  testData: {
    validUser: {
      // Étape 1 (wizard v2) : type de société — segment/domaine (registration-catalog.ts).
      companySegment: 'commerce',
      companySegmentLabel: 'Commerce',
      businessDomain: 'artisanat',
      businessDomainLabel: 'Artisanat',
      firstName: 'John',
      lastName: 'Doe',
      email: `test-${Date.now()}@example.com`,
      password: 'Test1234@Password',
      confirmPassword: 'Test1234@Password',
      companyName: 'Test Company',
      nif: '1234567A/B/C/000',
      taxRegime: 0, // Régime réel
      companyEmail: 'contact@test.tn',
      phone: '98 455 112',
      street: '155 Rue Test',
      streetLine2: 'Appartement 5',
      city: 'Monastir',
      postalCode: '5000',
      governorate: 'Monastir'
    }
  }
};
