import {
  FIRM_DELEGATED_HOME_ROUTE,
  FIRM_NATIVE_HOME_ROUTE,
  isFirmAreaRoute,
  isFirmOpenDossierRoute,
  resolveFirmAreaRedirect,
  stripRoutePath
} from './firm-area-access';

const firmDelegated = { isAccountingFirm: true, isDelegated: true };
const firmNative = { isAccountingFirm: true, isDelegated: false };
const company = { isAccountingFirm: false, isDelegated: false };

describe('firm-area-access', () => {
  describe('stripRoutePath', () => {
    it('removes query, hash and trailing slash', () => {
      expect(stripRoutePath('/firm/dashboard?x=1')).toBe('/firm/dashboard');
      expect(stripRoutePath('/firm/dashboard#top')).toBe('/firm/dashboard');
      expect(stripRoutePath('/firm/dashboard/')).toBe('/firm/dashboard');
      expect(stripRoutePath('/')).toBe('/');
    });
  });

  describe('route predicates', () => {
    it('recognises the firm area', () => {
      expect(isFirmAreaRoute('/firm')).toBe(true);
      expect(isFirmAreaRoute('/firm/dashboard')).toBe(true);
      expect(isFirmAreaRoute('/firmware')).toBe(false);
      expect(isFirmAreaRoute('/accounting/chart')).toBe(false);
    });

    it('recognises the dossier switch route only', () => {
      expect(isFirmOpenDossierRoute('/firm/open/00000000-0000-0000-0000-000000000003')).toBe(true);
      expect(isFirmOpenDossierRoute('/firm/open')).toBe(false);
      expect(isFirmOpenDossierRoute('/firm/open/a/b')).toBe(false);
    });
  });

  describe('resolveFirmAreaRedirect — delegated firm user', () => {
    ['/firm', '/firm/dashboard', '/firm/clients', '/firm/governance/time-sheets',
     '/firm/dashboard?tab=1', '/firm/dashboard/'].forEach(url => {
      it(`sends ${url} back to the dossier`, () => {
        expect(resolveFirmAreaRedirect(url, firmDelegated)).toBe(FIRM_DELEGATED_HOME_ROUTE);
      });
    });

    it('keeps the dossier switch route reachable', () => {
      expect(
        resolveFirmAreaRedirect('/firm/open/00000000-0000-0000-0000-000000000003', firmDelegated)
      ).toBeNull();
    });

    it('leaves dossier routes alone', () => {
      expect(resolveFirmAreaRedirect('/accounting/chart', firmDelegated)).toBeNull();
      expect(resolveFirmAreaRedirect('/invoices', firmDelegated)).toBeNull();
      expect(resolveFirmAreaRedirect('/ai-assistant/comptabilite', firmDelegated)).toBeNull();
    });
  });

  describe('resolveFirmAreaRedirect — native firm user', () => {
    ['/accounting/chart', '/accounting/ledger', '/withholding-tax', '/ai-assistant/comptabilite'].forEach(url => {
      it(`sends ${url} back to the firm dashboard`, () => {
        expect(resolveFirmAreaRedirect(url, firmNative)).toBe(FIRM_NATIVE_HOME_ROUTE);
      });
    });

    it('leaves the firm area alone', () => {
      expect(resolveFirmAreaRedirect('/firm/dashboard', firmNative)).toBeNull();
      expect(resolveFirmAreaRedirect('/firm/clients', firmNative)).toBeNull();
      expect(resolveFirmAreaRedirect('/access-denied', firmNative)).toBeNull();
      expect(resolveFirmAreaRedirect('/', firmNative)).toBeNull();
    });
  });

  describe('resolveFirmAreaRedirect — non firm users', () => {
    ['/firm/dashboard', '/accounting/chart', '/dashboard', '/portal'].forEach(url => {
      it(`never redirects ${url}`, () => {
        expect(resolveFirmAreaRedirect(url, company)).toBeNull();
        expect(resolveFirmAreaRedirect(url, { isAccountingFirm: false, isDelegated: true })).toBeNull();
      });
    });
  });
});
