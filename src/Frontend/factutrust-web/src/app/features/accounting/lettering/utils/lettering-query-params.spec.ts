import { parseLetteringQueryParams, serializeLetteringFilters } from './lettering-query-params';
import { createDefaultLetteringFilters } from '../models/lettering.models';

describe('parseLetteringQueryParams', () => {
  it('parses the exact legacy audit deep-link URL', () => {
    const parsed = parseLetteringQueryParams({
      account: '4111', from: '2026-01-01', to: '2026-12-31', unletteredOnly: '1', autoLoad: '1'
    });
    expect(parsed.filters.account).toBe('4111');
    expect(parsed.filters.from).toBe('2026-01-01');
    expect(parsed.filters.to).toBe('2026-12-31');
    expect(parsed.filters.state).toBe('unlettered');
    expect(parsed.autoLoad).toBeTrue();
  });

  it('reads the accountHint variant', () => {
    const parsed = parseLetteringQueryParams({ account: '4111', accountHint: '4011' });
    expect(parsed.accountHint).toBe('4011');
  });

  it('returns sane defaults with no params at all (no autoLoad)', () => {
    const parsed = parseLetteringQueryParams({});
    expect(parsed.filters.account).toBe('');
    expect(parsed.filters.state).toBe('unlettered');
    expect(parsed.autoLoad).toBeFalse();
  });

  it('gives priority to a valid state over unletteredOnly=1', () => {
    const parsed = parseLetteringQueryParams({ state: 'lettered', unletteredOnly: '1' });
    expect(parsed.filters.state).toBe('lettered');
  });

  it('falls back to unletteredOnly=1 when state is absent', () => {
    const parsed = parseLetteringQueryParams({ unletteredOnly: '1' });
    expect(parsed.filters.state).toBe('unlettered');
  });

  it('ignores an invalid state value and falls back to the default', () => {
    const parsed = parseLetteringQueryParams({ state: 'nonsense' });
    expect(parsed.filters.state).toBe('unlettered');
  });

  it('defaults to unlettered when nothing is specified (Phase 2 default state)', () => {
    const parsed = parseLetteringQueryParams({});
    expect(parsed.filters.state).toBe('unlettered');
  });

  it('round-trips parse -> serialize for a fully populated filter set', () => {
    const parsed = parseLetteringQueryParams({
      account: '4111', accountHint: '4011', from: '2026-01-01', to: '2026-12-31',
      state: 'all', match: 'prefix', journal: 'JV', docType: 'invoice', min: '10', max: '100',
      thirdPartyId: 'tp-1', thirdPartyKind: '1', thirdPartyName: 'Client X'
    });
    const serialized = serializeLetteringFilters(parsed.filters, { accountHint: parsed.accountHint });
    expect(serialized).toEqual({
      account: '4111', from: '2026-01-01', to: '2026-12-31', state: 'all', match: 'prefix',
      journal: 'JV', docType: 'invoice', min: '10', max: '100',
      thirdPartyId: 'tp-1', thirdPartyKind: '1', thirdPartyName: 'Client X', accountHint: '4011'
    });
  });
});

describe('serializeLetteringFilters', () => {
  it('omits empty values', () => {
    const filters = createDefaultLetteringFilters('2026-01-01', '2026-12-31');
    const serialized = serializeLetteringFilters(filters);
    expect(serialized['account']).toBeUndefined();
    expect(serialized['journal']).toBeUndefined();
    expect(serialized['thirdPartyId']).toBeUndefined();
    expect(serialized['from']).toBe('2026-01-01');
    expect(serialized['state']).toBe('unlettered');
  });

  it('omits match=exact (default) but keeps match=prefix', () => {
    const filters = createDefaultLetteringFilters('2026-01-01', '2026-12-31');
    expect(serializeLetteringFilters(filters)['match']).toBeUndefined();
    filters.accountMatch = 'prefix';
    expect(serializeLetteringFilters(filters)['match']).toBe('prefix');
  });
});
