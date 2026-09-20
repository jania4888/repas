/** Shared data and expected codes used by Jasmine and the Node catalogue gate tests. */
import corpus from './business-catalog-validation-corpus.json';
import { glbAsset, validManifest } from './business-catalog-validation-fixture';

export interface CatalogValidationCase {
  readonly name: string;
  readonly create: () => unknown;
  readonly expectedCodes: readonly string[];
}

interface Change {
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
  readonly delete?: boolean;
}

function changedManifest(changes: readonly Change[]): Record<string, unknown> {
  const manifest = validManifest();
  for (const change of changes) {
    let target = manifest;
    for (const key of change.path.slice(0, -1)) target = target[key] as Record<string, unknown>;
    const key = change.path[change.path.length - 1];
    if (change.delete) delete target[key];
    else target[key] = change.value;
  }
  return manifest;
}

function emptyManifest(): Record<string, unknown> {
  return { ...validManifest(), assets: [], profiles: [], scenes: [] };
}

/** Order-independent depth checks: chains contain `length` assets, not edges. */
function dependencyChain(length: number, reversed = false): Record<string, unknown> {
  const assets = Array.from({ length }, (_, index) => ({
    ...glbAsset(`chain-${index}`, `chain/${index}.glb`),
    dependencyAssetKeys: index + 1 < length ? [`chain-${index + 1}`] : []
  }));
  return { ...emptyManifest(), assets: reversed ? assets.reverse() : assets };
}

export const CATALOG_VALIDATION_CASES: readonly CatalogValidationCase[] = [
  ...corpus.map(entry => ({
    name: entry.name,
    create: () => changedManifest(entry.changes),
    expectedCodes: entry.expectedCodes
  })),
  { name: 'null-manifest', create: () => null, expectedCodes: ['manifest.type'] },
  { name: 'empty-low-level-schema-valid', create: emptyManifest, expectedCodes: [] },
  { name: 'chain-at-depth-limit', create: () => dependencyChain(64), expectedCodes: [] },
  { name: 'chain-over-depth-limit', create: () => dependencyChain(65), expectedCodes: ['asset.dependency-depth'] },
  { name: 'reverse-chain-over-depth-limit', create: () => dependencyChain(65, true), expectedCodes: ['asset.dependency-depth'] },
  {
    name: 'cyclic-dependencies', expectedCodes: ['asset.dependency-cycle'],
    create: () => {
      const manifest = dependencyChain(3);
      (manifest['assets'] as Record<string, unknown>[])[2]['dependencyAssetKeys'] = ['chain-0'];
      return manifest;
    }
  },
  {
    name: 'shared-dependency-dag', expectedCodes: [],
    create: () => {
      const manifest = dependencyChain(3);
      (manifest['assets'] as Record<string, unknown>[])[0]['dependencyAssetKeys'] = ['chain-1', 'chain-2'];
      return manifest;
    }
  },
  {
    name: 'duplicate-accepted-identity', expectedCodes: ['profile.duplicate-identity'],
    create: () => {
      const manifest = validManifest();
      const profiles = manifest['profiles'] as unknown[];
      profiles.push(profiles[0]);
      return manifest;
    }
  },
  { name: 'asset-count-limit', create: () => ({ ...emptyManifest(), assets: Array(4097).fill(null) }), expectedCodes: ['manifest.limit-assets'] },
  { name: 'scene-count-limit', create: () => ({ ...emptyManifest(), scenes: Array(1025).fill(null) }), expectedCodes: ['manifest.limit-scenes'] },
  { name: 'profile-count-limit', create: () => ({ ...emptyManifest(), profiles: Array(513).fill(null) }), expectedCodes: ['manifest.limit-profiles'] },
  {
    name: 'edge-count-limit', expectedCodes: ['manifest.limit-edges'],
    create: () => ({ ...emptyManifest(), assets: Array.from({ length: 257 }, (_, index) => ({
      ...glbAsset(`node-${index}`, `node/${index}.glb`), dependencyAssetKeys: Array(64).fill('node-0')
    })) })
  },
  { name: 'array-count-limit', create: () => ({ ...emptyManifest(), future: Array(16385).fill(0) }), expectedCodes: ['manifest.limit-array'] },
  { name: 'string-size-limit', create: () => ({ ...emptyManifest(), future: 'a'.repeat(4097) }), expectedCodes: ['manifest.limit-string'] },
  {
    name: 'json-depth-limit', expectedCodes: ['manifest.limit-depth'],
    create: () => {
      let future: unknown = {};
      for (let index = 0; index < 33; index++) future = { nested: future };
      return { ...emptyManifest(), future };
    }
  },
  {
    name: 'json-value-count-limit', expectedCodes: ['manifest.limit-values'],
    create: () => ({ ...emptyManifest(), future: Array.from({ length: 1000 }, () => Array(251).fill(0)) })
  }
];
