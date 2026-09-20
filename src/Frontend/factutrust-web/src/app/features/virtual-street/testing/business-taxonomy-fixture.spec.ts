import {
  DOMAIN_OPTIONS,
  SEGMENT_ALLOWED_DOMAINS,
  SEGMENT_OPTIONS
} from '@features/auth/register-wizard/registration-catalog';
import { isContractKey } from '../3d/business-scene-contract-validation';
import {
  ADMIN_TAXONOMY_CODE_MAX_LENGTH,
  ADMIN_TAXONOMY_CODE_PATTERN,
  BUSINESS_TAXONOMY_FIXTURE_ROWS,
  BusinessTaxonomyFixtureRow,
  FIXTURE_DOMAINS,
  FIXTURE_LOCAL_EXTERIOR_PAIRS,
  FIXTURE_SEEDED_MATRIX,
  FIXTURE_SEGMENT_FALLBACK_FAMILY,
  FIXTURE_SEGMENTS,
  NEUTRAL_GLOBAL_PROFILE_KEY,
  SYNTHETIC_PROFILE_EXPECTATIONS,
  SyntheticProfileExpectation
} from './business-taxonomy-fixture';

/**
 * Pins the synthetic L0 taxonomy baseline against the domain source of truth.
 * The backend canonical is SectorConfigurationCatalog.cs (C#, not importable here);
 * SEGMENT_ALLOWED_DOMAINS / SEGMENT_OPTIONS / DOMAIN_OPTIONS are the documented
 * byte-exact frontend mirror, so equality with them is equality with the source.
 */

const seededMatrixMirror = SEGMENT_ALLOWED_DOMAINS as unknown as Record<string, readonly string[]>;

function pairKey(row: Pick<BusinessTaxonomyFixtureRow, 'companySegment' | 'businessDomain'>): string {
  return `${row.companySegment}/${row.businessDomain}`;
}

function cartesianPairs(): string[] {
  const pairs: string[] = [];
  for (const segment of FIXTURE_SEGMENTS) {
    for (const domain of FIXTURE_DOMAINS) {
      pairs.push(`${segment.code}/${domain.code}`);
    }
  }
  return pairs;
}

function rowsByState(state: BusinessTaxonomyFixtureRow['state']): BusinessTaxonomyFixtureRow[] {
  return BUSINESS_TAXONOMY_FIXTURE_ROWS.filter(row => row.state === state);
}

function expectationByKey(profileKey: string): SyntheticProfileExpectation {
  const found = SYNTHETIC_PROFILE_EXPECTATIONS.find(profile => profile.profileKey === profileKey);
  if (!found) {
    throw new Error(`fixture inconsistency: no expectation for ${profileKey}`);
  }
  return found;
}

describe('business-taxonomy-fixture (segments & domains)', () => {
  it('declares exactly the 6 seeded segments, in source order', () => {
    expect(FIXTURE_SEGMENTS.map(segment => segment.code)).toEqual(SEGMENT_OPTIONS.map(segment => segment.code));
    expect(FIXTURE_SEGMENTS.map(segment => segment.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('segment labels match the domain source mirror', () => {
    for (const segment of FIXTURE_SEGMENTS) {
      const option = SEGMENT_OPTIONS.find(candidate => candidate.code === segment.code);
      expect(option?.label)
        .withContext(`label for ${segment.code}`)
        .toBe(segment.labelFr);
    }
  });

  it('declares exactly the 10 seeded domains, in source order', () => {
    expect(FIXTURE_DOMAINS.map(domain => domain.code)).toEqual(DOMAIN_OPTIONS.map(domain => domain.code));
    expect(FIXTURE_DOMAINS.map(domain => domain.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('domain labels match the domain source mirror', () => {
    for (const domain of FIXTURE_DOMAINS) {
      const option = DOMAIN_OPTIONS.find(candidate => candidate.code === domain.code);
      expect(option?.label)
        .withContext(`label for ${domain.code}`)
        .toBe(domain.labelFr);
    }
  });

  it('every fixture segment/domain code respects the admin custom-code rule', () => {
    for (const entry of [...FIXTURE_SEGMENTS, ...FIXTURE_DOMAINS]) {
      expect(ADMIN_TAXONOMY_CODE_PATTERN.test(entry.code)).toBeTrue();
      expect(entry.code.length).toBeLessThanOrEqual(ADMIN_TAXONOMY_CODE_MAX_LENGTH);
    }
  });
});

describe('business-taxonomy-fixture (seeded matrix parity)', () => {
  it('mirrors the 36 seeded segment→domain links of the domain source exactly', () => {
    const segments = Object.keys(FIXTURE_SEEDED_MATRIX);
    expect(segments).toEqual(FIXTURE_SEGMENTS.map(segment => segment.code));
    let count = 0;
    for (const segment of FIXTURE_SEGMENTS) {
      const fixtureLinks = FIXTURE_SEEDED_MATRIX[segment.code] ?? [];
      const mirrorLinks = seededMatrixMirror[segment.code] ?? [];
      expect([...fixtureLinks])
        .withContext(`AllowedDomainCodes for ${segment.code}`)
        .toEqual([...mirrorLinks]);
      count += fixtureLinks.length;
    }
    expect(count).toBe(36);
  });

  it('keeps autre as the universal seeded safety net in every segment', () => {
    for (const segment of FIXTURE_SEGMENTS) {
      expect(FIXTURE_SEEDED_MATRIX[segment.code]).toContain('autre');
    }
  });

  it('local-exterior pairs are a strict subset of the seeded pairs (8 grands locaux)', () => {
    expect(FIXTURE_LOCAL_EXTERIOR_PAIRS.length).toBe(8);
    expect(new Set(FIXTURE_LOCAL_EXTERIOR_PAIRS).size).toBe(8);
    for (const pair of FIXTURE_LOCAL_EXTERIOR_PAIRS) {
      const [segment, domain] = pair.split('/');
      expect(FIXTURE_SEEDED_MATRIX[segment ?? ''] ?? [])
        .withContext(`${pair} must be a seeded pair`)
        .toContain(domain ?? '');
    }
  });
});

describe('business-taxonomy-fixture (rows)', () => {
  it('contains 36 seeded + 6 missing-domain + 24 known-nonseeded + 8 edge rows (74 total)', () => {
    expect(BUSINESS_TAXONOMY_FIXTURE_ROWS.length).toBe(74);
    expect(rowsByState('seeded').length).toBe(36);
    expect(rowsByState('known-nonseeded').length).toBe(24);
    expect(rowsByState('custom').length).toBe(4);
    expect(rowsByState('inactive').length).toBe(2);
    // 6 canonical per-segment rows + 2 partial/absent-classification edge rows.
    expect(rowsByState('missing-domain').length).toBe(8);
  });

  it('uses unique case keys', () => {
    const keys = BUSINESS_TAXONOMY_FIXTURE_ROWS.map(row => row.caseKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('seeded rows cover exactly the 36 source links, each claiming specialized coverage', () => {
    const seededPairs = rowsByState('seeded').map(pairKey).sort();
    const sourcePairs: string[] = [];
    for (const segment of FIXTURE_SEGMENTS) {
      for (const domain of seededMatrixMirror[segment.code] ?? []) {
        sourcePairs.push(`${segment.code}/${domain}`);
      }
    }
    expect(seededPairs).toEqual(sourcePairs.sort());
    for (const row of rowsByState('seeded')) {
      expect(row.seededRelation).toBeTrue();
      expect(row.countsAsCoverage).toBeTrue();
      expect(row.resolvesToProfileKey).toBe(`syn-${row.companySegment ?? ''}-${row.businessDomain ?? ''}`);
    }
  });

  it('missing-domain canonical rows exist once per segment and alias the (segment, autre) profile', () => {
    const canonical = rowsByState('missing-domain').filter(
      row => row.companySegment !== null && row.businessDomain === null && row.caseKey.startsWith('missing-domain:')
    );
    expect(canonical.length).toBe(6);
    expect(canonical.map(row => row.companySegment).sort()).toEqual(FIXTURE_SEGMENTS.map(s => s.code).sort());
    for (const row of canonical) {
      expect(row.countsAsCoverage).toBeFalse();
      const target = expectationByKey(row.resolvesToProfileKey);
      expect(target.kind).toBe('specialized');
      expect(target.profileKey).toBe(`syn-${row.companySegment ?? ''}-autre`);
    }
  });

  it('known-nonseeded rows are exactly the cartesian product minus the 36 seeded links', () => {
    const seeded = new Set(rowsByState('seeded').map(pairKey));
    const expected = cartesianPairs().filter(pair => !seeded.has(pair)).sort();
    expect(expected.length).toBe(24);
    expect(rowsByState('known-nonseeded').map(pairKey).sort()).toEqual(expected);
    for (const row of rowsByState('known-nonseeded')) {
      expect(seededMatrixMirror[row.companySegment ?? ''] ?? [])
        .withContext(`${pairKey(row)} must not be seeded`)
        .not.toContain(row.businessDomain ?? '');
      expect(row.seededRelation).toBeFalse();
      expect(row.countsAsCoverage).toBeFalse();
    }
  });

  it('custom rows use well-formed but unknown admin codes (kebab, <= 50 chars)', () => {
    const knownSegments = new Set(FIXTURE_SEGMENTS.map(segment => segment.code));
    const knownDomains = new Set(FIXTURE_DOMAINS.map(domain => domain.code));
    for (const row of rowsByState('custom')) {
      const codes = [row.companySegment, row.businessDomain].filter((code): code is string => code !== null);
      expect(codes.length).toBeGreaterThan(0);
      for (const code of codes) {
        expect(ADMIN_TAXONOMY_CODE_PATTERN.test(code)).toBeTrue();
        expect(code.length).toBeLessThanOrEqual(ADMIN_TAXONOMY_CODE_MAX_LENGTH);
      }
      const isCustom =
        (row.companySegment !== null && !knownSegments.has(row.companySegment)) ||
        (row.businessDomain !== null && !knownDomains.has(row.businessDomain));
      expect(isCustom).withContext(`${row.caseKey} must involve at least one unknown code`).toBeTrue();
      expect(row.countsAsCoverage).toBeFalse();
    }
    // The boundary row really sits at the admin length limit.
    const maxLengthRow = rowsByState('custom').find(row => row.caseKey === 'edge:custom-segment-max-length');
    expect(maxLengthRow?.companySegment?.length).toBe(ADMIN_TAXONOMY_CODE_MAX_LENGTH);
  });

  it('inactive rows reference well-formed codes and never claim coverage', () => {
    for (const row of rowsByState('inactive')) {
      for (const code of [row.companySegment, row.businessDomain]) {
        if (code !== null) {
          expect(ADMIN_TAXONOMY_CODE_PATTERN.test(code)).toBeTrue();
        }
      }
      expect(row.countsAsCoverage).toBeFalse();
    }
    // An inactive KNOWN pair is different from an unknown pair: codes exist in the source.
    const knownPair = rowsByState('inactive').find(row => row.caseKey === 'edge:inactive-known-seeded-pair');
    expect(seededMatrixMirror[knownPair?.companySegment ?? ''] ?? []).toContain(knownPair?.businessDomain ?? '');
  });
});

describe('business-taxonomy-fixture (coverage rule)', () => {
  it('every coverage-claiming row resolves to a specialized profile requiring facade AND interior', () => {
    const claimants = BUSINESS_TAXONOMY_FIXTURE_ROWS.filter(row => row.countsAsCoverage);
    expect(claimants.length).toBe(36);
    for (const row of claimants) {
      const target = expectationByKey(row.resolvesToProfileKey);
      expect(target.kind).toBe('specialized');
      expect(target.facadeRequired).withContext(`${target.profileKey} facade`).toBeTrue();
      expect(target.interiorRequired).withContext(`${target.profileKey} interior`).toBeTrue();
    }
  });

  it('neutral fallbacks are never coverage: no fallback row claims a specialized profile as new coverage', () => {
    const fallbacks = BUSINESS_TAXONOMY_FIXTURE_ROWS.filter(row => !row.countsAsCoverage);
    expect(fallbacks.length).toBe(38);
    for (const row of fallbacks) {
      const target = expectationByKey(row.resolvesToProfileKey);
      if (target.kind !== 'specialized') {
        expect(target.interiorRequired).toBeFalse();
      }
      // Resolving to an existing specialized profile (missing-domain alias) still adds no coverage.
      expect(row.state).not.toBe('seeded');
    }
  });

  it('declares 36 distinct specialized profiles plus 4 neutral ones (40 total)', () => {
    const specialized = SYNTHETIC_PROFILE_EXPECTATIONS.filter(profile => profile.kind === 'specialized');
    expect(specialized.length).toBe(36);
    expect(new Set(specialized.map(profile => profile.profileKey)).size).toBe(36);
    expect(SYNTHETIC_PROFILE_EXPECTATIONS.length).toBe(40);
    expect(expectationByKey(NEUTRAL_GLOBAL_PROFILE_KEY).kind).toBe('neutral-global');
  });

  it('every row resolution target exists in the synthetic profile expectations', () => {
    for (const row of BUSINESS_TAXONOMY_FIXTURE_ROWS) {
      expect(() => expectationByKey(row.resolvesToProfileKey)).not.toThrow();
    }
  });

  it('local-exterior requirement is only claimed by specialized profiles of the 8 large-scale pairs', () => {
    const withLocalExterior = SYNTHETIC_PROFILE_EXPECTATIONS.filter(profile => profile.localExteriorRequired);
    expect(withLocalExterior.map(profile => profile.profileKey).sort()).toEqual(
      FIXTURE_LOCAL_EXTERIOR_PAIRS.map(pair => `syn-${pair.replace('/', '-')}`).sort()
    );
    for (const profile of withLocalExterior) {
      expect(profile.kind).toBe('specialized');
    }
  });

  it('all synthetic profile keys are valid contract keys (kebab, bounded length)', () => {
    for (const profile of SYNTHETIC_PROFILE_EXPECTATIONS) {
      expect(isContractKey(profile.profileKey))
        .withContext(profile.profileKey)
        .toBeTrue();
    }
  });

  it('non-seeded fallbacks resolve to the neutral family of their segment, custom segments to the global neutral', () => {
    for (const row of rowsByState('known-nonseeded')) {
      const family = FIXTURE_SEGMENT_FALLBACK_FAMILY[row.companySegment ?? ''];
      expect(row.resolvesToProfileKey).toBe(`syn-neutral-${family ?? '?'}`);
    }
    const customSegmentRows = BUSINESS_TAXONOMY_FIXTURE_ROWS.filter(
      row => row.companySegment !== null && !(row.companySegment in FIXTURE_SEGMENT_FALLBACK_FAMILY)
    );
    expect(customSegmentRows.length).toBeGreaterThan(0);
    for (const row of customSegmentRows) {
      expect(row.resolvesToProfileKey).toBe(NEUTRAL_GLOBAL_PROFILE_KEY);
    }
  });
});
