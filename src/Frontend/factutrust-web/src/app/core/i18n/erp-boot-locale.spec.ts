import { ERP_I18N_MANIFEST } from './erp-i18n-manifest.generated';
import {
  MAX_CATALOG_BYTES,
  erpBootArabicCatalogRejected,
  erpBootEffectiveLocale,
  prepareBootLocale,
  setErpBootArabicCatalogRejectedForTests
} from './erp-boot-locale';

describe('prepareBootLocale catalogue arabe', () => {
  const originalFetch = window.fetch.bind(window);

  afterEach(() => {
    window.fetch = originalFetch;
    setErpBootArabicCatalogRejectedForTests(false);
    document.documentElement.setAttribute('lang', 'fr');
    document.documentElement.setAttribute('dir', 'ltr');
  });

  it('garde le catalogue pointé par le manifeste sous le plafond de 2 Mio', async () => {
    const res = await originalFetch(ERP_I18N_MANIFEST.messagesUrl);
    expect(res.ok).withContext(ERP_I18N_MANIFEST.messagesUrl).toBeTrue();
    const text = await res.text();
    expect(text.length).toBeGreaterThan(512 * 1024);
    expect(text.length).toBeLessThanOrEqual(MAX_CATALOG_BYTES);
  });

  it('refuse un corps au-dessus de 2 Mio et reste en français de gauche à droite', async () => {
    const huge = 'x'.repeat(MAX_CATALOG_BYTES + 1);
    window.fetch = jasmine.createSpy('fetch').and.resolveTo(
      new Response(huge, { status: 200, headers: { 'content-type': 'application/json' } })
    ) as typeof window.fetch;

    document.documentElement.setAttribute('dir', 'rtl');
    const locale = await prepareBootLocale('ar');

    expect(locale).toBe('fr');
    expect(erpBootEffectiveLocale).toBe('fr');
    expect(erpBootArabicCatalogRejected).toBeTrue();
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('fr');
  });
});
