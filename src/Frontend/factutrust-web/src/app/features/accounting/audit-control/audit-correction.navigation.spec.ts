import { buildFallbackCorrectionLink } from './audit-correction.navigation';

describe('audit-correction.navigation', () => {
  it('builds drafts link with status filter', () => {
    const link = buildFallbackCorrectionLink(
      {
        id: '1',
        ruleCode: 'drafts',
        deepLinkRoute: '/accounting/journal',
        periodFrom: '2026-01-01',
        periodTo: '2026-12-31'
      },
      2026
    );
    expect(link?.route).toBe('/accounting/entry-search');
    expect(link?.queryParams['status']).toBe('0');
    expect(link?.queryParams['autoSearch']).toBe('1');
  });

  it('builds unlettered link with account and autoLoad', () => {
    const link = buildFallbackCorrectionLink(
      {
        id: '2',
        ruleCode: 'unlettered',
        deepLinkRoute: '/accounting/lettering',
        accountRef: '4111/4011'
      },
      2026
    );
    expect(link?.route).toBe('/accounting/lettering');
    expect(link?.queryParams['account']).toBe('4111');
    expect(link?.queryParams['autoLoad']).toBe('1');
  });

  it('builds unlettered link with the full legacy deep-link contract the new screen parses', () => {
    // Le nouvel écran (Phase 2) lit les anciens paramètres via parseLetteringQueryParams :
    // `from`/`to` (période), `unletteredOnly=1` (→ état « Non lettrées »), `account`, `autoLoad=1`.
    // Cette assertion verrouille le contrat pour qu'une refonte du deep-link ne casse pas l'écran.
    const link = buildFallbackCorrectionLink(
      {
        id: '3',
        ruleCode: 'unlettered',
        deepLinkRoute: '/accounting/lettering',
        accountRef: '4111/4011',
        periodFrom: '2026-01-01T00:00:00',
        periodTo: '2026-12-31T00:00:00'
      },
      2026
    );
    expect(link?.route).toBe('/accounting/lettering');
    expect(link?.queryParams).toEqual(
      jasmine.objectContaining({
        account: '4111',
        from: '2026-01-01',
        to: '2026-12-31',
        unletteredOnly: '1',
        autoLoad: '1'
      })
    );
  });
});
