/**
 * L0 contracts only. No loader, taxonomy resolver or production catalog is activated.
 * All wire data still requires validation; readonly TypeScript is not a trust boundary.
 * See docs/developer/virtual-street-contracts.md before implementing a consumer.
 */

/** Stable meaning + owner-accepted layout, independent of a technical release. */
export interface VisualProfileIdentity {
  readonly profileKey: string;
  readonly editorialRevision: string;
}

/** Future optional public DTO field: visualProfile?: VisualProfileRef | null. */
export interface VisualProfileRef extends VisualProfileIdentity {
  readonly schemaVersion: 1;
  readonly catalogVersion: string;
  readonly representationKind: 'illustrative';
}

/** Existing backend values: Classic, Modern, Vintage, Minimal, Artisan. Not activities. */
export type FacadeTheme = 0 | 1 | 2 | 3 | 4;
export type BusinessQuality = 'economy' | 'standard';
export type SceneVector3 = readonly [x: number, y: number, z: number];

export interface SceneBounds {
  readonly min: SceneVector3;
  readonly max: SceneVector3;
}

export interface SceneViewpoint {
  readonly key: string;
  readonly position: SceneVector3;
  readonly target: SceneVector3;
}

/** The app supplies the current public slug; assets cannot name another tenant or URL. */
export type BusinessSceneAction =
  | { readonly role: 'exit' }
  | { readonly role: 'openStorefront' }
  | { readonly role: 'inspectScene'; readonly viewpointKey: string };

export interface BusinessSceneInteraction {
  readonly key: string;
  readonly label: string;
  readonly position: SceneVector3;
  readonly action: BusinessSceneAction;
}

export interface BusinessSceneNavigation {
  readonly spawn: SceneViewpoint;
  readonly exit: SceneViewpoint;
  readonly viewpoints: readonly SceneViewpoint[];
  /** Walkable boxes are camera volumes, not decorative floor meshes. */
  readonly walkableBounds: readonly SceneBounds[];
  readonly collisionBounds: readonly SceneBounds[];
}

export interface BusinessBrandingAnchors {
  readonly signNode: string | null;
  readonly logoNode: string | null;
  readonly colorMaterialNames: readonly string[];
  readonly maxSignCharacters: number;
}

export interface BusinessSceneVariant {
  readonly modelAssetKey: string;
  readonly rootNode: string;
  readonly lods: readonly {
    readonly node: string;
    readonly minDistanceMeters: number;
    readonly triangles: number;
  }[];
  readonly requiredWebGlVersion: 1 | 2;
  /** Includes transitive dependencies, not only the root GLB. Estimates are not measurements. */
  readonly transferBytes: number;
  readonly estimatedTextureBytes: number;
  readonly triangles: number;
  readonly drawCalls: number;
}

export interface BusinessSceneDescriptor {
  readonly sceneKey: string;
  readonly kind: 'street-facade' | 'local-exterior' | 'interior';
  readonly units: 'meters';
  readonly upAxis: '+Y';
  readonly frontAxis: '+Z';
  readonly origin: 'threshold-ground';
  readonly bounds: SceneBounds;
  readonly variants: Readonly<Record<BusinessQuality, BusinessSceneVariant>>;
  readonly navigation: BusinessSceneNavigation;
  readonly interactions: readonly BusinessSceneInteraction[];
  readonly branding: BusinessBrandingAnchors;
  /** r161 TEXCOORD_1 -> uv1; lightMap.channel must be 1. */
  readonly lightmaps: readonly {
    readonly materialName: string;
    readonly textureAssetKey: string;
    readonly texCoord: 1;
    readonly intensity: number;
  }[];
}

export interface BusinessStyleRecipe {
  readonly recipeKey: string;
  readonly materialNames: readonly string[];
  readonly assetKeys: readonly string[];
}

export interface BusinessCatalogProfile extends VisualProfileIdentity {
  readonly representationKind: 'illustrative';
  readonly status: 'active' | 'retired';
  readonly facadeSceneKey: string;
  readonly interiorSceneKey: string;
  /** Required for a large local facade; the street connector is not the whole building. */
  readonly localExteriorSceneKey: string | null;
  readonly styleRecipes: Readonly<Record<FacadeTheme, BusinessStyleRecipe>>;
  readonly coverage: {
    readonly exteriorRenderAssetKey: string;
    readonly interiorRenderAssetKey: string;
    readonly attributionAssetKeys: readonly string[];
  };
}

export interface BusinessAssetDescriptor {
  readonly assetKey: string;
  readonly kind: 'glb' | 'texture' | 'environment' | 'lightmap' | 'decoder' | 'render' | 'attribution';
  /** Relative to /assets/virtual-street/catalogs/<catalogVersion>/; never a free URL. */
  readonly path: string;
  readonly mimeType: string;
  /** Exactly 64 lower-case hex characters, verified against the bytes before parsing. */
  readonly sha256: string;
  readonly encodedBytes: number;
  readonly estimatedDecodedBytes: number;
  readonly dependencyAssetKeys: readonly string[];
  readonly gltf: {
    readonly requiredExtensions: readonly string[];
    readonly allowedExtensions: readonly string[];
    readonly embeddedImageMimeTypes: readonly ('image/png' | 'image/jpeg' | 'image/ktx2')[];
  } | null;
  /** Include embedded images too; dimensions/mips/layers must be bounded by validation. */
  readonly textures: readonly {
    readonly key: string;
    readonly width: number;
    readonly height: number;
    readonly mipLevels: number;
    readonly layers: number;
    readonly colorSpace: 'srgb' | 'linear';
    readonly estimatedDecodedBytes: number;
  }[];
}

/** Public, immutable delivery metadata. No classification, consent proof or private provenance. */
export interface BusinessCatalogManifest {
  readonly schemaVersion: 2;
  readonly catalogVersion: string;
  readonly renderer: {
    readonly engine: 'three';
    readonly revision: '161';
    readonly minContractVersion: 1;
  };
  /** Unique by (profileKey, editorialRevision), permitting retention of accepted revisions. */
  readonly profiles: readonly BusinessCatalogProfile[];
  readonly scenes: readonly BusinessSceneDescriptor[];
  readonly assets: readonly BusinessAssetDescriptor[];
}

export interface BusinessAssetCacheKey {
  readonly catalogVersion: string;
  readonly assetKey: string;
  readonly quality: BusinessQuality;
}

/** Lifecycle declarations, not a replacement for the existing disposable registry. */
export type ResourceOwnership =
  | { readonly owner: 'visit-runtime'; readonly scopeId: string }
  | {
      readonly owner: 'asset-registry';
      readonly cacheKey: BusinessAssetCacheKey;
      readonly release: 'last-reference-and-eviction';
    }
  | {
      readonly owner: 'scene-instance';
      readonly scopeId: string;
      readonly slug: string;
      readonly publicRevision: string;
    }
  | { readonly owner: 'scene-scope'; readonly scopeId: string; readonly generation: number };

/** Only after public availability, accepted identity, catalog and lease validation. */
export interface BusinessSceneRequest {
  readonly scopeId: string;
  readonly generation: number;
  readonly slug: string;
  readonly visualProfile: VisualProfileRef;
  readonly facadeTheme: FacadeTheme;
  readonly quality: BusinessQuality;
  readonly sceneKey: string;
}

/** Future no-store endpoint payload only; this file implements no polling or permission. */
export type StreetExperienceConfig = {
  readonly schemaVersion: 1;
  readonly configRevision: string;
  /** Positive seconds <= 60, validated by the consumer; local expiry uses monotonic time. */
  readonly leaseSeconds: number;
} & (
  | { readonly mode: 'list' | 'legacy'; readonly catalogVersion: null }
  | { readonly mode: 'catalog-v2'; readonly catalogVersion: string }
);

/* -------------------------------------------------------------------------- */
/* Frozen L0 constants — shared by the pure validators, the synthetic fixture */
/* and future loaders. Values are duplicated nowhere else in this feature.    */
/* -------------------------------------------------------------------------- */

/** Sole `VisualProfileRef.schemaVersion` supported by this contract revision. */
export const VISUAL_PROFILE_REF_SCHEMA_VERSION = 1;

/** Sole `BusinessCatalogManifest.schemaVersion` supported by this contract revision. */
export const BUSINESS_CATALOG_SCHEMA_VERSION = 2;

/** Sole `StreetExperienceConfig.schemaVersion` supported by this contract revision. */
export const STREET_EXPERIENCE_CONFIG_SCHEMA_VERSION = 1;

/** Only Three r161 is contractually supported (uv1 lightmaps, WebGL1 path preserved). */
export const THREE_RENDERER_REVISION = '161';

/**
 * The closed orthogonal aesthetic dimension (Classic, Modern, Vintage, Minimal,
 * Artisan). It never encodes an activity: a profile must declare a recipe for
 * every theme and no theme value may appear or disappear per domain.
 */
export const FACADE_THEMES = [0, 1, 2, 3, 4] as const satisfies readonly FacadeTheme[];

/**
 * The two budgeted quality variants of plan §6.2/§7.4. A future opt-in enhanced
 * tier is deliberately absent from L0; unknown quality strings must be rejected.
 */
export const BUSINESS_QUALITIES = ['economy', 'standard'] as const satisfies readonly BusinessQuality[];

/** Plan §9.2 — a client lease is positive and never exceeds one minute (monotonic clock). */
export const MAX_EXPERIENCE_LEASE_SECONDS = 60;

/**
 * Immutable delivery root, relative to the served `/assets/` folder and mirrored by
 * `scripts/validate-street-catalog.mjs`. Every asset path stays below
 * `<BUSINESS_CATALOG_ROOT>/<catalogVersion>/`; no absolute path or URI is contract-valid.
 */
export const BUSINESS_CATALOG_ROOT = 'assets/virtual-street/catalogs';

/** Immutable manifest: <BUSINESS_CATALOG_ROOT>/<catalogVersion>/manifest-v2.json. */
export const BUSINESS_CATALOG_MANIFEST_FILENAME = 'manifest-v2.json';

/**
 * Per-scene declared-estimate ceilings (plan §7.4), enforced for each variant of
 * every scene by both the TypeScript validator and the Node build gate. A profile
 * "hall" is not exempted; the smallest applicable limit prevails.
 */
export const SCENE_VARIANT_BUDGETS = {
  economy: { triangles: 120_000, drawCalls: 100, textureBytes: 96 * 1024 * 1024 },
  standard: { triangles: 300_000, drawCalls: 180, textureBytes: 192 * 1024 * 1024 }
} as const satisfies Readonly<Record<BusinessQuality, { triangles: number; drawCalls: number; textureBytes: number }>>;
