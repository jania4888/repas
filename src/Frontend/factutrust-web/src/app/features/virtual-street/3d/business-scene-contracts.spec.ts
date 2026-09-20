import {
  BUSINESS_CATALOG_MANIFEST_FILENAME,
  BUSINESS_CATALOG_ROOT,
  BUSINESS_CATALOG_SCHEMA_VERSION,
  BUSINESS_QUALITIES,
  FACADE_THEMES,
  MAX_EXPERIENCE_LEASE_SECONDS,
  SCENE_VARIANT_BUDGETS,
  STREET_EXPERIENCE_CONFIG_SCHEMA_VERSION,
  THREE_RENDERER_REVISION,
  VISUAL_PROFILE_REF_SCHEMA_VERSION
} from './business-scene-contracts';
import {
  isContractKey,
  isValidBusinessCatalogManifest,
  isValidCatalogAssetPath,
  isValidCatalogVersionToken,
  isValidEditorialRevision,
  isValidSha256Hex,
  isValidVisualProfileRef,
  validateBusinessCatalogManifest,
  validateStreetExperienceConfig,
  validateVisualProfileRef
} from './business-scene-contract-validation';

/**
 * L0 contract tests: pure validators over raw wire data. The synthetic manifest
 * below is not a production catalog; it only exercises the frozen contract.
 */

import { CATALOG_VALIDATION_CASES } from '../testing/business-catalog-validation-corpus';
import { SHA, glbAsset, variant, scene, validProfile, validManifest } from '../testing/business-catalog-validation-fixture';

function violationCodes(manifest: unknown): string[] {
  return validateBusinessCatalogManifest(manifest).map(violation => violation.code);
}

describe('business-scene-contracts (frozen constants)', () => {
  it('keeps FacadeTheme strictly 0–4 and orthogonal', () => {
    expect([...FACADE_THEMES]).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps exactly the two budgeted quality variants', () => {
    expect([...BUSINESS_QUALITIES]).toEqual(['economy', 'standard']);
    expect(SCENE_VARIANT_BUDGETS.economy.triangles).toBe(120000);
    expect(SCENE_VARIANT_BUDGETS.standard.drawCalls).toBe(180);
  });

  it('pins schema versions, renderer revision, lease bound and catalog root', () => {
    expect(VISUAL_PROFILE_REF_SCHEMA_VERSION).toBe(1);
    expect(BUSINESS_CATALOG_SCHEMA_VERSION).toBe(2);
    expect(STREET_EXPERIENCE_CONFIG_SCHEMA_VERSION).toBe(1);
    expect(THREE_RENDERER_REVISION).toBe('161');
    expect(MAX_EXPERIENCE_LEASE_SECONDS).toBe(60);
    expect(BUSINESS_CATALOG_ROOT).toBe('assets/virtual-street/catalogs');
    expect(BUSINESS_CATALOG_ROOT.startsWith('/')).toBeFalse();
    expect(BUSINESS_CATALOG_MANIFEST_FILENAME).toBe('manifest-v2.json');
  });
});

describe('business-scene-contract-validation (formats)', () => {
  it('accepts only immutable relative catalog asset paths', () => {
    for (const path of ['models/facade.glb', 'textures/fr/enseigne.png', 'x', 'a/b/c.ktx2', 'sign.png']) {
      expect(isValidCatalogAssetPath(path)).withContext(path).toBeTrue();
    }
    const invalid = [
      '',
      '/absolute.glb',
      'facade/../secret.glb',
      '..',
      'a//b.glb',
      'a/./b.glb',
      'C:\\assets\\x.glb',
      'facade\\economy.glb',
      'http://cdn.example.com/x.glb',
      'https://cdn.example.com/x.glb',
      'data:image/png;base64,AAAA',
      'blob:https://app.example.com/uuid',
      '//host/share/x.glb',
      ' leading-space.glb',
      'trailing-space.glb ',
      'a..b/c.glb' // the build gate rejects any '..' substring; so do we
    ];
    for (const path of invalid) {
      expect(isValidCatalogAssetPath(path)).withContext(JSON.stringify(path)).toBeFalse();
    }
  });

  it('requires exactly 64 lowercase hex characters for sha256', () => {
    expect(isValidSha256Hex(SHA)).toBeTrue();
    expect(isValidSha256Hex(SHA.slice(1))).toBeFalse();
    expect(isValidSha256Hex(SHA + 'a')).toBeFalse();
    expect(isValidSha256Hex('A' + SHA.slice(1))).toBeFalse();
    expect(isValidSha256Hex('g'.repeat(64))).toBeFalse();
    expect(isValidSha256Hex('')).toBeFalse();
  });

  it('validates contract keys, catalog version tokens and editorial revisions', () => {
    expect(isContractKey('syn-commerce-textile-habillement')).toBeTrue();
    expect(isContractKey('syn-etablissement-educatif-communication-marketing')).toBeTrue();
    expect(isContractKey('Commerce')).toBeFalse();
    expect(isContractKey('with_underscore')).toBeFalse();
    expect(isContractKey('-leading')).toBeFalse();
    expect(isContractKey('double--dash')).toBeFalse();
    expect(isContractKey('')).toBeFalse();

    expect(isValidCatalogVersionToken('v2.2026-09-17')).toBeTrue();
    expect(isValidCatalogVersionToken('v2.1')).toBeTrue();
    expect(isValidCatalogVersionToken('')).toBeFalse();
    expect(isValidCatalogVersionToken('.hidden')).toBeFalse();
    expect(isValidCatalogVersionToken('v2/../escape')).toBeFalse();
    expect(isValidCatalogVersionToken('has space')).toBeFalse();
    expect(isValidCatalogVersionToken('a..b')).toBeFalse();

    expect(isValidEditorialRevision('r1')).toBeTrue();
    expect(isValidEditorialRevision('r12')).toBeTrue();
    expect(isValidEditorialRevision('r0')).toBeFalse();
    expect(isValidEditorialRevision('v1')).toBeFalse();
    expect(isValidEditorialRevision('')).toBeFalse();
  });
});

describe('validateVisualProfileRef (public accepted identity)', () => {
  const valid = {
    schemaVersion: 1,
    profileKey: 'syn-commerce-textile-habillement',
    editorialRevision: 'r1',
    catalogVersion: 'v2.2026-09-17',
    representationKind: 'illustrative'
  };

  it('accepts a well-formed reference and tolerates unknown additive fields', () => {
    expect(validateVisualProfileRef(valid)).toEqual([]);
    expect(validateVisualProfileRef({ ...valid, futureField: { nested: true } })).toEqual([]);
    expect(isValidVisualProfileRef(valid)).toBeTrue();
  });

  it('rejects any confusion between accepted identity and delivery version', () => {
    expect(validateVisualProfileRef({ ...valid, schemaVersion: 2 })[0]?.code).toBe('ref.schema-version');
    expect(validateVisualProfileRef({ ...valid, editorialRevision: 'r0' })[0]?.code).toBe('ref.editorial-revision');
    expect(validateVisualProfileRef({ ...valid, catalogVersion: '' })[0]?.code).toBe('ref.catalog-version');
    expect(validateVisualProfileRef({ ...valid, representationKind: 'certified' })[0]?.code).toBe('ref.representation-kind');
    expect(validateVisualProfileRef({ ...valid, profileKey: 'Not Kebab' })[0]?.code).toBe('ref.profile-key');
    expect(validateVisualProfileRef(null)[0]?.code).toBe('ref.type');
  });
});

describe('validateStreetExperienceConfig (runtime kill-switch payload)', () => {
  it('accepts the three modes with their catalogVersion rule', () => {
    expect(validateStreetExperienceConfig({ schemaVersion: 1, configRevision: 'cfg-1', leaseSeconds: 30, mode: 'list', catalogVersion: null })).toEqual([]);
    expect(validateStreetExperienceConfig({ schemaVersion: 1, configRevision: 'cfg-1', leaseSeconds: 60, mode: 'legacy', catalogVersion: null })).toEqual([]);
    expect(
      validateStreetExperienceConfig({ schemaVersion: 1, configRevision: 'cfg-1', leaseSeconds: 45, mode: 'catalog-v2', catalogVersion: 'v2.2026-09-17' })
    ).toEqual([]);
  });

  it('rejects inverted mode/catalogVersion combinations', () => {
    const base = { schemaVersion: 1, configRevision: 'cfg-1', leaseSeconds: 30 };
    expect(validateStreetExperienceConfig({ ...base, mode: 'list', catalogVersion: 'v2.1' }).map(v => v.code)).toContain('config.catalog-version');
    expect(validateStreetExperienceConfig({ ...base, mode: 'catalog-v2', catalogVersion: null }).map(v => v.code)).toContain('config.catalog-version');
    expect(validateStreetExperienceConfig({ ...base, mode: 'catalog-v2', catalogVersion: 'bad version' }).map(v => v.code)).toContain('config.catalog-version');
    expect(validateStreetExperienceConfig({ ...base, mode: 'immersive', catalogVersion: null }).map(v => v.code)).toContain('config.mode');
  });

  it('bounds the lease to positive seconds <= 60 (fail-closed expiry)', () => {
    const base = { schemaVersion: 1, configRevision: 'cfg-1', mode: 'list', catalogVersion: null };
    for (const leaseSeconds of [0, -5, 61, Number.NaN, Number.POSITIVE_INFINITY, '30']) {
      expect(validateStreetExperienceConfig({ ...base, leaseSeconds }).map(v => v.code))
        .withContext(`leaseSeconds=${String(leaseSeconds)}`)
        .toContain('config.lease');
    }
    expect(validateStreetExperienceConfig({ ...base, leaseSeconds: 0.5 })).toEqual([]);
  });

  it('rejects an unknown schema version', () => {
    expect(
      validateStreetExperienceConfig({ schemaVersion: 2, configRevision: 'cfg-1', leaseSeconds: 30, mode: 'list', catalogVersion: null }).map(v => v.code)
    ).toContain('config.schema-version');
  });
});

describe('validateBusinessCatalogManifest (catalog contract)', () => {
  it('accepts the minimal synthetic manifest', () => {
    const violations = validateBusinessCatalogManifest(validManifest());
    expect(violations).toEqual([]);
    expect(isValidBusinessCatalogManifest(validManifest())).toBeTrue();
  });

  it('accepts an empty but well-formed manifest (nothing to load)', () => {
    const manifest = {
      schemaVersion: 2,
      catalogVersion: 'v2.0',
      renderer: { engine: 'three', revision: '161', minContractVersion: 1 },
      profiles: [],
      scenes: [],
      assets: []
    };
    expect(validateBusinessCatalogManifest(manifest)).toEqual([]);
  });

  it('tolerates unknown additive fields but rejects an unknown schema version', () => {
    const additive = validManifest();
    additive['futureSection'] = { anything: true };
    expect(validateBusinessCatalogManifest(additive)).toEqual([]);
    const wrong = validManifest();
    wrong['schemaVersion'] = 3;
    expect(violationCodes(wrong)).toContain('manifest.schema-version');
  });

  it('pins the renderer to three r161', () => {
    const manifest = validManifest();
    manifest['renderer'] = { engine: 'three', revision: '160', minContractVersion: 1 };
    expect(violationCodes(manifest)).toContain('manifest.renderer-revision');
  });

  it('rejects a duplicate accepted (profileKey, editorialRevision) identity', () => {
    const manifest = validManifest();
    (manifest['profiles'] as unknown[]).push(validProfile());
    expect(violationCodes(manifest)).toContain('profile.duplicate-identity');
  });

  it('requires every profile to reference a facade AND an interior scene of the right kind', () => {
    const missingInterior = validManifest();
    const profile = (missingInterior['profiles'] as Record<string, unknown>[])[0]!;
    delete profile['interiorSceneKey'];
    expect(violationCodes(missingInterior)).toContain('profile.scene-key');

    const wrongKind = validManifest();
    const profile2 = (wrongKind['profiles'] as Record<string, unknown>[])[0]!;
    profile2['facadeSceneKey'] = 'syn-interior';
    expect(violationCodes(wrongKind)).toContain('profile.scene-kind');

    const unknown = validManifest();
    const profile3 = (unknown['profiles'] as Record<string, unknown>[])[0]!;
    profile3['facadeSceneKey'] = 'ghost-scene';
    expect(violationCodes(unknown)).toContain('profile.scene-ref');
  });

  it('requires a local-exterior scene to be of local-exterior kind when present', () => {
    const manifest = validManifest();
    (manifest['scenes'] as unknown[]).push(scene('syn-local', 'local-exterior', 'glb-local'));
    (manifest['assets'] as unknown[]).push(glbAsset('glb-local-eco', 'local/economy.glb'), glbAsset('glb-local-std', 'local/standard.glb'));
    const profile = (manifest['profiles'] as Record<string, unknown>[])[0]!;
    profile['localExteriorSceneKey'] = 'syn-local';
    expect(validateBusinessCatalogManifest(manifest)).toEqual([]);
    profile['localExteriorSceneKey'] = 'syn-interior';
    expect(violationCodes(manifest)).toContain('profile.scene-kind');
  });

  it('keeps FacadeTheme recipes complete (0–4) and rejects extra theme keys', () => {
    const missing = validManifest();
    const profile = (missing['profiles'] as Record<string, unknown>[])[0]!;
    delete (profile['styleRecipes'] as Record<string, unknown>)['4'];
    expect(violationCodes(missing)).toContain('profile.recipe-missing');

    const extra = validManifest();
    const profile2 = (extra['profiles'] as Record<string, unknown>[])[0]!;
    (profile2['styleRecipes'] as Record<string, unknown>)['5'] = { recipeKey: 'recipe-theme-5', materialNames: [], assetKeys: [] };
    expect(violationCodes(extra)).toContain('profile.recipe-unknown');
  });

  it('rejects arbitrary URIs, traversal and non-lowercase hashes in assets', () => {
    const uri = validManifest();
    ((uri['assets'] as Record<string, unknown>[])[0]!)['path'] = 'https://cdn.example.com/facade.glb';
    expect(violationCodes(uri)).toContain('asset.path');

    const traversal = validManifest();
    ((traversal['assets'] as Record<string, unknown>[])[0]!)['path'] = '../outside.glb';
    expect(violationCodes(traversal)).toContain('asset.path');

    const hash = validManifest();
    ((hash['assets'] as Record<string, unknown>[])[0]!)['sha256'] = 'A'.repeat(64);
    expect(violationCodes(hash)).toContain('asset.sha256');
  });

  it('resolves asset dependencies and rejects unknown, self and cyclic references', () => {
    const unknownDep = validManifest();
    ((unknownDep['assets'] as Record<string, unknown>[])[0]!)['dependencyAssetKeys'] = ['ghost'];
    expect(violationCodes(unknownDep)).toContain('asset.dependency-ref');

    const selfDep = validManifest();
    ((selfDep['assets'] as Record<string, unknown>[])[0]!)['dependencyAssetKeys'] = ['glb-facade-eco'];
    expect(violationCodes(selfDep)).toContain('asset.dependency-self');

    const cyclic = validManifest();
    const assets = cyclic['assets'] as Record<string, unknown>[];
    assets[0]!['dependencyAssetKeys'] = ['tex-sign'];
    assets.find(a => a['assetKey'] === 'tex-sign')!['dependencyAssetKeys'] = ['glb-facade-eco'];
    expect(violationCodes(cyclic)).toContain('asset.dependency-cycle');
  });

  it('enforces the glTF block rules (glb only, supported required extensions)', () => {
    const nonGlb = validManifest();
    (nonGlb['assets'] as Record<string, unknown>[]).find(a => a['assetKey'] === 'tex-sign')!['gltf'] =
      { requiredExtensions: [], allowedExtensions: [], embeddedImageMimeTypes: [] };
    expect(violationCodes(nonGlb)).toContain('asset.gltf-unexpected');

    const badExt = validManifest();
    const glb = (badExt['assets'] as Record<string, unknown>[])[0]!;
    (glb['gltf'] as Record<string, unknown>)['requiredExtensions'] = ['ACME_unsupported'];
    expect(violationCodes(badExt)).toContain('asset.gltf-extension');

    const wrongMime = validManifest();
    ((wrongMime['assets'] as Record<string, unknown>[])[0]!)['mimeType'] = 'application/octet-stream';
    expect(violationCodes(wrongMime)).toContain('asset.glb-mime');
  });

  it('requires both quality variants and enforces the declared budgets per scene', () => {
    const missingStandard = validManifest();
    const facade = (missingStandard['scenes'] as Record<string, unknown>[])[0]!;
    delete (facade['variants'] as Record<string, unknown>)['standard'];
    expect(violationCodes(missingStandard)).toContain('scene.variant-missing');

    const extraVariant = validManifest();
    ((extraVariant['scenes'] as Record<string, unknown>[])[0]!['variants'] as Record<string, unknown>)['enhanced'] = variant('glb-facade-eco');
    expect(violationCodes(extraVariant)).toContain('scene.variant-unknown');

    const overBudget = validManifest();
    const scenesRef = overBudget['scenes'] as Record<string, unknown>[];
    (((scenesRef[0]!['variants'] as Record<string, unknown>)['economy']) as Record<string, unknown>)['triangles'] = 120001;
    expect(violationCodes(overBudget)).toContain('variant.budget-triangles');

    const overTextures = validManifest();
    ((((overTextures['scenes'] as Record<string, unknown>[])[0]!['variants'] as Record<string, unknown>)['standard']) as Record<string, unknown>)['estimatedTextureBytes'] = 193 * 1024 * 1024;
    expect(violationCodes(overTextures)).toContain('variant.budget-textures');
  });

  it('validates interactions: closed roles and resolvable viewpoints only', () => {
    const badRole = validManifest();
    (((badRole['scenes'] as Record<string, unknown>[])[0]!['interactions'] as Record<string, unknown>[])[0]!)['action'] = { role: 'purchase' };
    expect(violationCodes(badRole)).toContain('interaction.role');

    const badViewpoint = validManifest();
    ((((badViewpoint['scenes'] as Record<string, unknown>[])[0]!['interactions'] as Record<string, unknown>[])[0]!)['action'] as Record<string, unknown>)['viewpointKey'] = 'ghost';
    expect(violationCodes(badViewpoint)).toContain('interaction.viewpoint-ref');
  });

  it('pins lightmaps to r161 TEXCOORD_1 -> uv1 and resolvable texture assets', () => {
    const wrongTexCoord = validManifest();
    ((((wrongTexCoord['scenes'] as Record<string, unknown>[])[0]!['lightmaps'] as Record<string, unknown>[])[0]!))['texCoord'] = 2;
    expect(violationCodes(wrongTexCoord)).toContain('lightmap.texcoord');

    const unknownTexture = validManifest();
    ((((unknownTexture['scenes'] as Record<string, unknown>[])[0]!['lightmaps'] as Record<string, unknown>[])[0]!))['textureAssetKey'] = 'ghost';
    expect(violationCodes(unknownTexture)).toContain('lightmap.texture-ref');
  });

  it('rejects incoherent geometry numbers', () => {
    const inverted = validManifest();
    ((inverted['scenes'] as Record<string, unknown>[])[0]!)['bounds'] = { min: [2, 0, 0], max: [-2, 4, 3] };
    expect(violationCodes(inverted)).toContain('bounds.order');

    const nan = validManifest();
    (((nan['scenes'] as Record<string, unknown>[])[0]!['navigation'] as Record<string, unknown>)['spawn'] as Record<string, unknown>)['position'] = [0, Number.NaN, 2];
    expect(violationCodes(nan)).toContain('vector3');

    const unsortedLods = validManifest();
    ((((unsortedLods['scenes'] as Record<string, unknown>[])[0]!['variants'] as Record<string, unknown>)['economy']) as Record<string, unknown>)['lods'] = [
      { node: 'StorefrontRoot_LOD1', minDistanceMeters: 25, triangles: 700 },
      { node: 'StorefrontRoot', minDistanceMeters: 0, triangles: 7000 }
    ];
    expect(violationCodes(unsortedLods)).toContain('lod.order');
  });

  it('requires human-proof coverage renders and attribution assets of the right kind', () => {
    const manifest = validManifest();
    const profile = (manifest['profiles'] as Record<string, unknown>[])[0]!;
    (profile['coverage'] as Record<string, unknown>)['exteriorRenderAssetKey'] = 'glb-facade-eco';
    expect(violationCodes(manifest)).toContain('coverage.render-kind');

    const unknownAttribution = validManifest();
    const profile2 = (unknownAttribution['profiles'] as Record<string, unknown>[])[0]!;
    (profile2['coverage'] as Record<string, unknown>)['attributionAssetKeys'] = ['ghost'];
    expect(violationCodes(unknownAttribution)).toContain('coverage.attribution-ref');
  });
});


describe('shared catalogue parity corpus', () => {
  for (const testCase of CATALOG_VALIDATION_CASES) {
    it(testCase.name, () => {
      const value = testCase.create();
      const before = JSON.stringify(value);
      const codes = [...new Set(validateBusinessCatalogManifest(value).map(v => v.code))].sort();
      expect(codes).toEqual([...testCase.expectedCodes].sort());
      expect(JSON.stringify(value)).withContext('validation must not mutate wire data').toBe(before);
    });
  }
});
