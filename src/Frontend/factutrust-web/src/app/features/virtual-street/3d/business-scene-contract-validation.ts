/**
 * Pure L0 validators for the business-scene contracts. No Three.js, no DOM, no
 * HTTP, no Angular: these functions take `unknown` wire data and return violation
 * lists, so the future loader (L3), unit tests and tooling share one normative
 * rule set. Readonly TypeScript types are not a trust boundary — every manifest,
 * reference or config crossing the wire must pass here before use.
 *
 * The Node gate compiles and uses this exact module, without Angular or Three.
 * These are declarative checks, not file safety, release approval or navigation
 * evidence. A catalog that fails here must never reach a renderer.
 *
 * See docs/developer/virtual-street-contracts.md.
 */
import {
  BUSINESS_CATALOG_SCHEMA_VERSION,
  BUSINESS_QUALITIES,
  BusinessCatalogManifest,
  BusinessQuality,
  FACADE_THEMES,
  FacadeTheme,
  MAX_EXPERIENCE_LEASE_SECONDS,
  SCENE_VARIANT_BUDGETS,
  STREET_EXPERIENCE_CONFIG_SCHEMA_VERSION,
  THREE_RENDERER_REVISION,
  VISUAL_PROFILE_REF_SCHEMA_VERSION,
  VisualProfileRef
} from './business-scene-contracts';

/** One rule breach. `code` is stable for tests; `path` locates the offending value. */
export interface ContractViolation {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** Kebab-case public business keys: profileKey, sceneKey, recipeKey, viewpoint/interaction keys. */
export const CONTRACT_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const CONTRACT_KEY_MAX_LENGTH = 64;

/** GLB node / material names (legacy aliases like `Sign_Plane`, `StorefrontRoot_LOD1` stay valid). */
export const NODE_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/** Immutable delivery token; `..` is banned because this token names a directory. */
export const CATALOG_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;
export const CATALOG_VERSION_MAX_LENGTH = 64;

/** Asset keys follow the build-gate token rule (no path separator, no scheme). */
export const ASSET_KEY_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;
export const ASSET_KEY_MAX_LENGTH = 128;

/** Owner-accepted editorial revisions are monotonic: r1, r2, … (plan §5.1/§6.1). */
export const EDITORIAL_REVISION_PATTERN = /^r[1-9][0-9]*$/;

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
export const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;

export const ASSET_PATH_MAX_LENGTH = 256;
/** Matches any URI scheme (`http:`, `data:`, `blob:`, `file:`, …) — never allowed in an asset path. */
const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;

/** Required glTF extensions the r161 runtime may demand (self-hosted decoders only). */
export const SUPPORTED_GLTF_REQUIRED_EXTENSIONS = [
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_texture_basisu'
] as const;

export const EMBEDDED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/ktx2'] as const;

const ASSET_KINDS = ['glb', 'texture', 'environment', 'lightmap', 'decoder', 'render', 'attribution'] as const;
const SCENE_KINDS = ['street-facade', 'local-exterior', 'interior'] as const;
const PROFILE_STATUSES = ['active', 'retired'] as const;
const ACTION_ROLES = ['exit', 'openStorefront', 'inspectScene'] as const;
const EXPERIENCE_MODES = ['list', 'legacy', 'catalog-v2'] as const;

/** Validation-work ceilings, not scene/GPU budgets or proof of release completeness. */
export const CATALOG_VALIDATION_LIMITS = {
  jsonBytes: 8 * 1024 * 1024,
  jsonDepth: 32,
  jsonValues: 250_000,
  arrayEntries: 16_384,
  stringLength: 4096,
  assets: 4096,
  scenes: 1024,
  profiles: 512,
  dependencyEdges: 16_384,
  dependencyDepth: 64
} as const;

/* ---------------------------------- helpers --------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function fail(out: ContractViolation[], code: string, path: string, message: string): void {
  out.push({ code, path, message });
}

/* ----------------------------- format predicates ---------------------------- */

// JS `$` can match before a final line terminator; tokens must match in full.
function isUnpaddedString(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim();
}

export function isContractKey(value: unknown): value is string {
  return (
    isUnpaddedString(value) &&
    value.length <= CONTRACT_KEY_MAX_LENGTH &&
    CONTRACT_KEY_PATTERN.test(value)
  );
}

export function isNodeName(value: unknown): value is string {
  return isUnpaddedString(value) && NODE_NAME_PATTERN.test(value);
}

export function isAssetKey(value: unknown): value is string {
  return (
    isUnpaddedString(value) &&
    value.length <= ASSET_KEY_MAX_LENGTH &&
    ASSET_KEY_PATTERN.test(value)
  );
}

export function isValidCatalogVersionToken(value: unknown): value is string {
  return (
    isUnpaddedString(value) &&
    value.length <= CATALOG_VERSION_MAX_LENGTH &&
    CATALOG_VERSION_PATTERN.test(value) &&
    !value.includes('..')
  );
}

export function isValidEditorialRevision(value: unknown): value is string {
  return isUnpaddedString(value) && EDITORIAL_REVISION_PATTERN.test(value);
}

export function isValidSha256Hex(value: unknown): value is string {
  return isUnpaddedString(value) && SHA256_HEX_PATTERN.test(value);
}

export function isValidMimeType(value: unknown): value is string {
  return isUnpaddedString(value) && MIME_TYPE_PATTERN.test(value);
}

/**
 * Immutable relative asset path below `<catalogVersion>/`. Rejects absolute paths,
 * URI schemes (including `data:`/`blob:`), traversal, backslashes, empty segments
 * and control characters. A path is joined by the loader; it is never a URL.
 */
export function isValidCatalogAssetPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > ASSET_PATH_MAX_LENGTH) {
    return false;
  }
  if (value !== value.trim() || value.startsWith('/') || value.includes('\\')) {
    return false;
  }
  if (URI_SCHEME_PATTERN.test(value) || CONTROL_CHAR_PATTERN.test(value)) {
    return false;
  }
  // Build-gate parity: any `..` substring is refused, not only traversal segments.
  if (value.includes('..')) {
    return false;
  }
  // A closed filename alphabet also refuses encoded/double-encoded traversal,
  // URL query/fragment delimiters and Unicode control/bidi characters.
  return value.split('/').every(segment => isUnpaddedString(segment) && /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(segment));
}

/* --------------------------- VisualProfileRef (§5.1) ------------------------ */

/**
 * Public accepted identity (`profileKey` + `editorialRevision`) carried by future
 * DTOs. `catalogVersion` only selects a technical delivery containing that pair;
 * it never rewrites the accepted editorial identity. Unknown extra fields are
 * tolerated (additive evolution), unknown values of known fields are not.
 */
export function validateVisualProfileRef(value: unknown): ContractViolation[] {
  const out: ContractViolation[] = [];
  if (!isRecord(value)) {
    fail(out, 'ref.type', 'visualProfile', 'VisualProfileRef must be an object');
    return out;
  }
  if (value['schemaVersion'] !== VISUAL_PROFILE_REF_SCHEMA_VERSION) {
    fail(out, 'ref.schema-version', 'visualProfile.schemaVersion', `schemaVersion must be ${VISUAL_PROFILE_REF_SCHEMA_VERSION}`);
  }
  if (!isContractKey(value['profileKey'])) {
    fail(out, 'ref.profile-key', 'visualProfile.profileKey', 'profileKey must be a kebab-case contract key');
  }
  if (!isValidEditorialRevision(value['editorialRevision'])) {
    fail(out, 'ref.editorial-revision', 'visualProfile.editorialRevision', 'editorialRevision must match r<positive integer>');
  }
  if (!isValidCatalogVersionToken(value['catalogVersion'])) {
    fail(out, 'ref.catalog-version', 'visualProfile.catalogVersion', 'catalogVersion must be an immutable delivery token');
  }
  if (value['representationKind'] !== 'illustrative') {
    fail(out, 'ref.representation-kind', 'visualProfile.representationKind', "representationKind must be 'illustrative'");
  }
  return out;
}

/* ------------------------ StreetExperienceConfig (§9) ----------------------- */

/** Future no-store payload; the consumer still re-checks the lease on a monotonic clock. */
export function validateStreetExperienceConfig(value: unknown): ContractViolation[] {
  const out: ContractViolation[] = [];
  if (!isRecord(value)) {
    fail(out, 'config.type', 'experienceConfig', 'StreetExperienceConfig must be an object');
    return out;
  }
  if (value['schemaVersion'] !== STREET_EXPERIENCE_CONFIG_SCHEMA_VERSION) {
    fail(out, 'config.schema-version', 'experienceConfig.schemaVersion', `schemaVersion must be ${STREET_EXPERIENCE_CONFIG_SCHEMA_VERSION}`);
  }
  if (!isNonEmptyString(value['configRevision'])) {
    fail(out, 'config.revision', 'experienceConfig.configRevision', 'configRevision must be a non-empty string');
  }
  const lease = value['leaseSeconds'];
  if (!isFiniteNumber(lease) || lease <= 0 || lease > MAX_EXPERIENCE_LEASE_SECONDS) {
    fail(out, 'config.lease', 'experienceConfig.leaseSeconds', `leaseSeconds must be in (0, ${MAX_EXPERIENCE_LEASE_SECONDS}]`);
  }
  const mode = value['mode'];
  if (typeof mode !== 'string' || !(EXPERIENCE_MODES as readonly string[]).includes(mode)) {
    fail(out, 'config.mode', 'experienceConfig.mode', 'mode must be list | legacy | catalog-v2');
    return out;
  }
  if (mode === 'catalog-v2') {
    if (!isValidCatalogVersionToken(value['catalogVersion'])) {
      fail(out, 'config.catalog-version', 'experienceConfig.catalogVersion', 'catalog-v2 requires a valid immutable catalogVersion');
    }
  } else if (value['catalogVersion'] !== null) {
    fail(out, 'config.catalog-version', 'experienceConfig.catalogVersion', `mode ${mode} requires catalogVersion null`);
  }
  return out;
}

/* ------------------------------ assets (§6.2) ------------------------------- */

function validateVector3(value: unknown, path: string, out: ContractViolation[]): void {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
    fail(out, 'vector3', path, 'expected a finite [x, y, z] triplet');
  }
}

function validateBounds(value: unknown, path: string, out: ContractViolation[]): void {
  if (!isRecord(value)) {
    fail(out, 'bounds.type', path, 'bounds must be an object { min, max }');
    return;
  }
  validateVector3(value['min'], `${path}.min`, out);
  validateVector3(value['max'], `${path}.max`, out);
  const min = value['min'];
  const max = value['max'];
  if (Array.isArray(min) && Array.isArray(max) && min.length === 3 && max.length === 3) {
    for (let axis = 0; axis < 3; axis++) {
      if (isFiniteNumber(min[axis]) && isFiniteNumber(max[axis]) && min[axis] > max[axis]) {
        fail(out, 'bounds.order', path, `min[${axis}] must be <= max[${axis}]`);
      }
    }
  }
}

function validateViewpoint(value: unknown, path: string, out: ContractViolation[]): void {
  if (!isRecord(value)) {
    fail(out, 'viewpoint.type', path, 'viewpoint must be an object');
    return;
  }
  if (!isContractKey(value['key'])) {
    fail(out, 'viewpoint.key', `${path}.key`, 'viewpoint key must be a contract key');
  }
  validateVector3(value['position'], `${path}.position`, out);
  validateVector3(value['target'], `${path}.target`, out);
}

function validateAsset(asset: unknown, path: string, out: ContractViolation[]): void {
  if (!isRecord(asset)) {
    fail(out, 'asset.type', path, 'asset must be an object');
    return;
  }
  const key = asset['assetKey'];
  if (!isAssetKey(key)) {
    fail(out, 'asset.key', `${path}.assetKey`, 'assetKey must match the build-gate token rule');
  }
  const kind = asset['kind'];
  if (typeof kind !== 'string' || !(ASSET_KINDS as readonly string[]).includes(kind)) {
    fail(out, 'asset.kind', `${path}.kind`, `kind must be one of ${ASSET_KINDS.join(' | ')}`);
  }
  if (!isValidCatalogAssetPath(asset['path'])) {
    fail(out, 'asset.path', `${path}.path`, 'path must be an immutable relative path (no URI, traversal or backslash)');
  }
  if (!isValidMimeType(asset['mimeType'])) {
    fail(out, 'asset.mime', `${path}.mimeType`, 'mimeType must be a lowercase type/subtype token');
  }
  if (kind === 'glb' && asset['mimeType'] !== 'model/gltf-binary') {
    fail(out, 'asset.glb-mime', `${path}.mimeType`, "glb assets must declare 'model/gltf-binary'");
  }
  if (!isValidSha256Hex(asset['sha256'])) {
    fail(out, 'asset.sha256', `${path}.sha256`, 'sha256 must be exactly 64 lowercase hex characters');
  }
  const encoded = asset['encodedBytes'];
  if (!isFiniteNumber(encoded) || !Number.isSafeInteger(encoded) || encoded <= 0) {
    fail(out, 'asset.encoded-bytes', `${path}.encodedBytes`, 'encodedBytes must be a positive integer');
  }
  if (!isNonNegativeInt(asset['estimatedDecodedBytes'])) {
    fail(out, 'asset.decoded-bytes', `${path}.estimatedDecodedBytes`, 'estimatedDecodedBytes must be a non-negative integer');
  }
  const deps = asset['dependencyAssetKeys'];
  if (!Array.isArray(deps) || !deps.every(isAssetKey)) {
    fail(out, 'asset.dependencies', `${path}.dependencyAssetKeys`, 'dependencyAssetKeys must be an array of asset keys');
  } else if (typeof key === 'string' && deps.includes(key)) {
    fail(out, 'asset.dependency-self', `${path}.dependencyAssetKeys`, 'an asset cannot depend on itself');
  }
  const gltf = asset['gltf'];
  if (kind !== 'glb' && gltf !== null) {
    fail(out, 'asset.gltf-unexpected', `${path}.gltf`, 'only glb assets may carry a gltf block');
  }
  if (kind === 'glb' && gltf !== null) {
    if (!isRecord(gltf)) {
      fail(out, 'asset.gltf-type', `${path}.gltf`, 'gltf must be an object or null');
    } else {
      const required = gltf['requiredExtensions'];
      if (!Array.isArray(required) || !required.every(e => typeof e === 'string')) {
        fail(out, 'asset.gltf-required', `${path}.gltf.requiredExtensions`, 'requiredExtensions must be a string array');
      } else {
        for (const ext of required) {
          if (!(SUPPORTED_GLTF_REQUIRED_EXTENSIONS as readonly string[]).includes(ext as string)) {
            fail(out, 'asset.gltf-extension', `${path}.gltf.requiredExtensions`, `unsupported required extension ${String(ext)}`);
          }
        }
      }
      const allowed = gltf['allowedExtensions'];
      if (!Array.isArray(allowed) || !allowed.every(e => typeof e === 'string')) {
        fail(out, 'asset.gltf-allowed', `${path}.gltf.allowedExtensions`, 'allowedExtensions must be a string array');
      }
      const embedded = gltf['embeddedImageMimeTypes'];
      if (!Array.isArray(embedded) || !embedded.every(e => (EMBEDDED_IMAGE_MIME_TYPES as readonly string[]).includes(e as string))) {
        fail(out, 'asset.gltf-images', `${path}.gltf.embeddedImageMimeTypes`, `embedded images must be ${EMBEDDED_IMAGE_MIME_TYPES.join(' | ')}`);
      }
    }
  }
  const textures = asset['textures'];
  if (!Array.isArray(textures)) {
    fail(out, 'asset.textures', `${path}.textures`, 'textures must be an array (possibly empty)');
    return;
  }
  const textureKeys = new Set<string>();
  textures.forEach((texture, index) => {
    const tPath = `${path}.textures[${index}]`;
    if (!isRecord(texture)) {
      fail(out, 'texture.type', tPath, 'texture must be an object');
      return;
    }
    if (!isNonEmptyString(texture['key'])) {
      fail(out, 'texture.key', `${tPath}.key`, 'texture key must be a non-empty string');
    } else if (textureKeys.has(texture['key'])) {
      fail(out, 'texture.key-duplicate', tPath, `duplicate texture key ${texture['key']}`);
    } else {
      textureKeys.add(texture['key']);
    }
    for (const dim of ['width', 'height'] as const) {
      const v = texture[dim];
      if (!isNonNegativeInt(v) || v === 0 || v > 16384) {
        fail(out, 'texture.dimensions', `${tPath}.${dim}`, `${dim} must be an integer in [1, 16384]`);
      }
    }
    const mips = texture['mipLevels'];
    if (!isNonNegativeInt(mips) || mips < 1 || mips > 32) {
      fail(out, 'texture.mips', `${tPath}.mipLevels`, 'mipLevels must be an integer in [1, 32]');
    }
    const layers = texture['layers'];
    if (!isNonNegativeInt(layers) || layers < 1 || layers > 256) {
      fail(out, 'texture.layers', `${tPath}.layers`, 'layers must be an integer in [1, 256]');
    }
    if (texture['colorSpace'] !== 'srgb' && texture['colorSpace'] !== 'linear') {
      fail(out, 'texture.color-space', `${tPath}.colorSpace`, "colorSpace must be 'srgb' or 'linear'");
    }
    if (!isNonNegativeInt(texture['estimatedDecodedBytes'])) {
      fail(out, 'texture.decoded-bytes', `${tPath}.estimatedDecodedBytes`, 'estimatedDecodedBytes must be a non-negative integer');
    }
  });
}

/* ------------------------------- scenes (§6.2) ------------------------------ */

function validateVariant(
  variant: unknown,
  quality: BusinessQuality,
  path: string,
  out: ContractViolation[]
): { modelAssetKey?: string } {
  const found: { modelAssetKey?: string } = {};
  if (!isRecord(variant)) {
    fail(out, 'variant.type', path, `variant ${quality} must be an object`);
    return found;
  }
  if (isAssetKey(variant['modelAssetKey'])) {
    found.modelAssetKey = variant['modelAssetKey'];
  } else {
    fail(out, 'variant.model', `${path}.modelAssetKey`, 'modelAssetKey must be an asset key');
  }
  if (!isNodeName(variant['rootNode'])) {
    fail(out, 'variant.root-node', `${path}.rootNode`, 'rootNode must be a GLB node name');
  }
  const lods = variant['lods'];
  if (!Array.isArray(lods)) {
    fail(out, 'variant.lods', `${path}.lods`, 'lods must be an array');
  } else {
    let previousDistance = -1;
    lods.forEach((lod, index) => {
      const lPath = `${path}.lods[${index}]`;
      if (!isRecord(lod)) {
        fail(out, 'lod.type', lPath, 'lod must be an object');
        return;
      }
      if (!isNodeName(lod['node'])) {
        fail(out, 'lod.node', `${lPath}.node`, 'lod node must be a GLB node name');
      }
      const distance = lod['minDistanceMeters'];
      if (!isFiniteNumber(distance) || distance < 0) {
        fail(out, 'lod.distance', `${lPath}.minDistanceMeters`, 'minDistanceMeters must be a finite number >= 0');
      } else {
        if (distance < previousDistance) {
          fail(out, 'lod.order', `${path}.lods`, 'lods must be sorted by ascending minDistanceMeters');
        }
        previousDistance = distance;
      }
      if (!isNonNegativeInt(lod['triangles'])) {
        fail(out, 'lod.triangles', `${lPath}.triangles`, 'triangles must be a non-negative integer');
      }
    });
  }
  if (variant['requiredWebGlVersion'] !== 1 && variant['requiredWebGlVersion'] !== 2) {
    fail(out, 'variant.webgl', `${path}.requiredWebGlVersion`, 'requiredWebGlVersion must be 1 or 2');
  }
  const transfer = variant['transferBytes'];
  if (!isNonNegativeInt(transfer) || transfer === 0) {
    fail(out, 'variant.transfer', `${path}.transferBytes`, 'transferBytes (dependencies included) must be a positive safe integer');
  }
  const budget = SCENE_VARIANT_BUDGETS[quality];
  const triangles = variant['triangles'];
  if (!isNonNegativeInt(triangles) || triangles > budget.triangles) {
    fail(out, 'variant.budget-triangles', `${path}.triangles`, `triangles must be an integer in [0, ${budget.triangles}] for ${quality}`);
  }
  const drawCalls = variant['drawCalls'];
  if (!isNonNegativeInt(drawCalls) || drawCalls > budget.drawCalls) {
    fail(out, 'variant.budget-draws', `${path}.drawCalls`, `drawCalls must be an integer in [0, ${budget.drawCalls}] for ${quality}`);
  }
  const textureBytes = variant['estimatedTextureBytes'];
  if (!isNonNegativeInt(textureBytes) || textureBytes > budget.textureBytes) {
    fail(out, 'variant.budget-textures', `${path}.estimatedTextureBytes`, `estimatedTextureBytes must fit the ${quality} texture budget`);
  }
  return found;
}

function validateScene(
  scene: unknown,
  path: string,
  assetByKey: ReadonlyMap<string, Record<string, unknown>>,
  out: ContractViolation[]
): { sceneKey?: string; kind?: string } {
  const found: { sceneKey?: string; kind?: string } = {};
  if (!isRecord(scene)) {
    fail(out, 'scene.type', path, 'scene must be an object');
    return found;
  }
  if (isContractKey(scene['sceneKey'])) {
    found.sceneKey = scene['sceneKey'];
  } else {
    fail(out, 'scene.key', `${path}.sceneKey`, 'sceneKey must be a contract key');
  }
  const kind = scene['kind'];
  if (typeof kind === 'string' && (SCENE_KINDS as readonly string[]).includes(kind)) {
    found.kind = kind;
  } else {
    fail(out, 'scene.kind', `${path}.kind`, `kind must be one of ${SCENE_KINDS.join(' | ')}`);
  }
  if (scene['units'] !== 'meters') {
    fail(out, 'scene.units', `${path}.units`, "units must be 'meters'");
  }
  if (scene['upAxis'] !== '+Y') {
    fail(out, 'scene.up-axis', `${path}.upAxis`, "upAxis must be '+Y'");
  }
  if (scene['frontAxis'] !== '+Z') {
    fail(out, 'scene.front-axis', `${path}.frontAxis`, "frontAxis must be '+Z'");
  }
  if (scene['origin'] !== 'threshold-ground') {
    fail(out, 'scene.origin', `${path}.origin`, "origin must be 'threshold-ground'");
  }
  validateBounds(scene['bounds'], `${path}.bounds`, out);

  const variants = scene['variants'];
  if (!isRecord(variants)) {
    fail(out, 'scene.variants', `${path}.variants`, 'variants must be an object keyed by quality');
  } else {
    const keys = Object.keys(variants);
    for (const quality of BUSINESS_QUALITIES) {
      if (!(quality in variants)) {
        fail(out, 'scene.variant-missing', `${path}.variants`, `missing ${quality} variant`);
        continue;
      }
      const found_ = validateVariant(variants[quality], quality, `${path}.variants.${quality}`, out);
      if (found_.modelAssetKey !== undefined) {
        const asset = assetByKey.get(found_.modelAssetKey);
        if (!asset) {
          fail(out, 'variant.model-ref', `${path}.variants.${quality}.modelAssetKey`, `unknown asset ${found_.modelAssetKey}`);
        } else if (asset['kind'] !== 'glb') {
          fail(out, 'variant.model-kind', `${path}.variants.${quality}.modelAssetKey`, 'modelAssetKey must reference a glb asset');
        }
      }
    }
    for (const key of keys) {
      if (!(BUSINESS_QUALITIES as readonly string[]).includes(key)) {
        fail(out, 'scene.variant-unknown', `${path}.variants`, `unknown quality variant ${key}`);
      }
    }
  }

  const navigation = scene['navigation'];
  if (!isRecord(navigation)) {
    fail(out, 'scene.navigation', `${path}.navigation`, 'navigation must be an object');
  } else {
    validateViewpoint(navigation['spawn'], `${path}.navigation.spawn`, out);
    validateViewpoint(navigation['exit'], `${path}.navigation.exit`, out);
    const viewpoints = navigation['viewpoints'];
    if (!Array.isArray(viewpoints)) {
      fail(out, 'scene.viewpoints', `${path}.navigation.viewpoints`, 'viewpoints must be an array');
    } else {
      const keys = new Set<string>();
      viewpoints.forEach((viewpoint, index) => {
        validateViewpoint(viewpoint, `${path}.navigation.viewpoints[${index}]`, out);
        if (isRecord(viewpoint) && isNonEmptyString(viewpoint['key'])) {
          if (keys.has(viewpoint['key'])) {
            fail(out, 'viewpoint.duplicate', `${path}.navigation.viewpoints[${index}]`, `duplicate viewpoint key ${viewpoint['key']}`);
          }
          keys.add(viewpoint['key']);
        }
      });
    }
    for (const boundsKey of ['walkableBounds', 'collisionBounds'] as const) {
      const list = navigation[boundsKey];
      if (!Array.isArray(list)) {
        fail(out, 'scene.nav-bounds', `${path}.navigation.${boundsKey}`, `${boundsKey} must be an array`);
      } else {
        list.forEach((bounds, index) => validateBounds(bounds, `${path}.navigation.${boundsKey}[${index}]`, out));
      }
    }
  }

  const viewpointKeys = new Set<string>();
  if (isRecord(navigation) && Array.isArray(navigation['viewpoints'])) {
    for (const viewpoint of navigation['viewpoints']) {
      if (isRecord(viewpoint) && isNonEmptyString(viewpoint['key'])) {
        viewpointKeys.add(viewpoint['key']);
      }
    }
  }
  const interactions = scene['interactions'];
  if (!Array.isArray(interactions)) {
    fail(out, 'scene.interactions', `${path}.interactions`, 'interactions must be an array');
  } else {
    const keys = new Set<string>();
    interactions.forEach((interaction, index) => {
      const iPath = `${path}.interactions[${index}]`;
      if (!isRecord(interaction)) {
        fail(out, 'interaction.type', iPath, 'interaction must be an object');
        return;
      }
      if (!isContractKey(interaction['key'])) {
        fail(out, 'interaction.key', `${iPath}.key`, 'interaction key must be a contract key');
      } else if (keys.has(interaction['key'])) {
        fail(out, 'interaction.duplicate', iPath, `duplicate interaction key ${interaction['key']}`);
      } else {
        keys.add(interaction['key']);
      }
      const label = interaction['label'];
      if (!isNonEmptyString(label) || label.length > 120) {
        fail(out, 'interaction.label', `${iPath}.label`, 'label must be a non-empty string of at most 120 chars');
      }
      validateVector3(interaction['position'], `${iPath}.position`, out);
      const action = interaction['action'];
      if (!isRecord(action) || typeof action['role'] !== 'string' || !(ACTION_ROLES as readonly string[]).includes(action['role'])) {
        fail(out, 'interaction.role', `${iPath}.action.role`, `role must be one of ${ACTION_ROLES.join(' | ')}`);
      } else if (action['role'] === 'inspectScene') {
        const viewpointKey = action['viewpointKey'];
        if (!isContractKey(viewpointKey)) {
          fail(out, 'interaction.viewpoint', `${iPath}.action.viewpointKey`, 'inspectScene requires a contract viewpointKey');
        } else if (!viewpointKeys.has(viewpointKey)) {
          fail(out, 'interaction.viewpoint-ref', `${iPath}.action.viewpointKey`, `unknown viewpoint ${viewpointKey}`);
        }
      }
    });
  }

  const branding = scene['branding'];
  if (!isRecord(branding)) {
    fail(out, 'scene.branding', `${path}.branding`, 'branding must be an object');
  } else {
    for (const anchor of ['signNode', 'logoNode'] as const) {
      const node = branding[anchor];
      if (node !== null && !isNodeName(node)) {
        fail(out, 'branding.anchor', `${path}.branding.${anchor}`, `${anchor} must be null or a GLB node name`);
      }
    }
    const materials = branding['colorMaterialNames'];
    if (!Array.isArray(materials) || !materials.every(isNodeName)) {
      fail(out, 'branding.materials', `${path}.branding.colorMaterialNames`, 'colorMaterialNames must be an array of material names');
    }
    const maxChars = branding['maxSignCharacters'];
    if (!isNonNegativeInt(maxChars) || maxChars < 1 || maxChars > 500) {
      fail(out, 'branding.max-sign', `${path}.branding.maxSignCharacters`, 'maxSignCharacters must be an integer in [1, 500]');
    }
  }

  const lightmaps = scene['lightmaps'];
  if (!Array.isArray(lightmaps)) {
    fail(out, 'scene.lightmaps', `${path}.lightmaps`, 'lightmaps must be an array (possibly empty)');
  } else {
    const materials = new Set<string>();
    lightmaps.forEach((lightmap, index) => {
      const lPath = `${path}.lightmaps[${index}]`;
      if (!isRecord(lightmap)) {
        fail(out, 'lightmap.type', lPath, 'lightmap must be an object');
        return;
      }
      if (!isNodeName(lightmap['materialName'])) {
        fail(out, 'lightmap.material', `${lPath}.materialName`, 'materialName must be a material name');
      } else if (materials.has(lightmap['materialName'])) {
        fail(out, 'lightmap.material-duplicate', lPath, `duplicate lightmap for material ${lightmap['materialName']}`);
      } else {
        materials.add(lightmap['materialName']);
      }
      const textureKey = lightmap['textureAssetKey'];
      if (!isAssetKey(textureKey)) {
        fail(out, 'lightmap.texture', `${lPath}.textureAssetKey`, 'textureAssetKey must be an asset key');
      } else {
        const asset = assetByKey.get(textureKey);
        if (!asset) {
          fail(out, 'lightmap.texture-ref', `${lPath}.textureAssetKey`, `unknown asset ${textureKey}`);
        } else if (asset['kind'] !== 'lightmap' && asset['kind'] !== 'texture') {
          fail(out, 'lightmap.texture-kind', `${lPath}.textureAssetKey`, 'lightmap must reference a lightmap or texture asset');
        }
      }
      if (lightmap['texCoord'] !== 1) {
        fail(out, 'lightmap.texcoord', `${lPath}.texCoord`, 'r161 maps TEXCOORD_1 to uv1: texCoord must be 1');
      }
      const intensity = lightmap['intensity'];
      if (!isFiniteNumber(intensity) || intensity < 0) {
        fail(out, 'lightmap.intensity', `${lPath}.intensity`, 'intensity must be a finite number >= 0');
      }
    });
  }
  return found;
}

/* ------------------------------- profiles (§5) ------------------------------ */

function validateProfile(
  profile: unknown,
  path: string,
  sceneByKey: ReadonlyMap<string, string>,
  assetByKey: ReadonlyMap<string, Record<string, unknown>>,
  out: ContractViolation[]
): void {
  if (!isRecord(profile)) {
    fail(out, 'profile.type', path, 'profile must be an object');
    return;
  }
  if (!isContractKey(profile['profileKey'])) {
    fail(out, 'profile.key', `${path}.profileKey`, 'profileKey must be a contract key');
  }
  if (!isValidEditorialRevision(profile['editorialRevision'])) {
    fail(out, 'profile.revision', `${path}.editorialRevision`, 'editorialRevision must match r<positive integer>');
  }
  if (profile['representationKind'] !== 'illustrative') {
    fail(out, 'profile.representation', `${path}.representationKind`, "representationKind must be 'illustrative'");
  }
  const status = profile['status'];
  if (typeof status !== 'string' || !(PROFILE_STATUSES as readonly string[]).includes(status)) {
    fail(out, 'profile.status', `${path}.status`, "status must be 'active' or 'retired'");
  }

  const sceneExpectations: readonly [string, string][] = [
    ['facadeSceneKey', 'street-facade'],
    ['interiorSceneKey', 'interior']
  ];
  for (const [field, expectedKind] of sceneExpectations) {
    const key = profile[field];
    if (!isContractKey(key)) {
      fail(out, 'profile.scene-key', `${path}.${field}`, `${field} must be a contract key`);
      continue;
    }
    const kind = sceneByKey.get(key);
    if (kind === undefined) {
      fail(out, 'profile.scene-ref', `${path}.${field}`, `unknown scene ${key}`);
    } else if (kind !== expectedKind) {
      fail(out, 'profile.scene-kind', `${path}.${field}`, `${field} must reference a ${expectedKind} scene, got ${kind}`);
    }
  }
  const localExterior = profile['localExteriorSceneKey'];
  if (localExterior !== null) {
    if (!isContractKey(localExterior)) {
      fail(out, 'profile.scene-key', `${path}.localExteriorSceneKey`, 'localExteriorSceneKey must be null or a contract key');
    } else {
      const kind = sceneByKey.get(localExterior);
      if (kind === undefined) {
        fail(out, 'profile.scene-ref', `${path}.localExteriorSceneKey`, `unknown scene ${localExterior}`);
      } else if (kind !== 'local-exterior') {
        fail(out, 'profile.scene-kind', `${path}.localExteriorSceneKey`, `localExteriorSceneKey must reference a local-exterior scene, got ${kind}`);
      }
    }
  }

  const recipes = profile['styleRecipes'];
  if (!isRecord(recipes)) {
    fail(out, 'profile.recipes', `${path}.styleRecipes`, 'styleRecipes must be keyed by every FacadeTheme');
  } else {
    for (const theme of FACADE_THEMES) {
      const recipe = recipes[String(theme)];
      if (recipe === undefined) {
        fail(out, 'profile.recipe-missing', `${path}.styleRecipes`, `missing recipe for FacadeTheme ${theme} (theme is orthogonal, never per-domain)`);
        continue;
      }
      const rPath = `${path}.styleRecipes.${theme}`;
      if (!isRecord(recipe)) {
        fail(out, 'recipe.type', rPath, 'recipe must be an object');
        continue;
      }
      if (!isContractKey(recipe['recipeKey'])) {
        fail(out, 'recipe.key', `${rPath}.recipeKey`, 'recipeKey must be a contract key');
      }
      const materials = recipe['materialNames'];
      if (!Array.isArray(materials) || !materials.every(isNodeName)) {
        fail(out, 'recipe.materials', `${rPath}.materialNames`, 'materialNames must be an array of material names');
      }
      const assetKeys = recipe['assetKeys'];
      if (!Array.isArray(assetKeys) || !assetKeys.every(isAssetKey)) {
        fail(out, 'recipe.assets', `${rPath}.assetKeys`, 'assetKeys must be an array of asset keys');
      } else {
        for (const assetKey of assetKeys) {
          if (!assetByKey.has(assetKey as string)) {
            fail(out, 'recipe.asset-ref', `${rPath}.assetKeys`, `unknown asset ${String(assetKey)}`);
          }
        }
      }
    }
    for (const key of Object.keys(recipes)) {
      if (!(FACADE_THEMES as readonly FacadeTheme[]).map(String).includes(key)) {
        fail(out, 'profile.recipe-unknown', `${path}.styleRecipes`, `unknown FacadeTheme key ${key}; themes stay 0–4`);
      }
    }
  }

  const coverage = profile['coverage'];
  if (!isRecord(coverage)) {
    fail(out, 'profile.coverage', `${path}.coverage`, 'coverage must reference the human proof renders');
  } else {
    for (const field of ['exteriorRenderAssetKey', 'interiorRenderAssetKey'] as const) {
      const key = coverage[field];
      if (!isAssetKey(key)) {
        fail(out, 'coverage.render-key', `${path}.coverage.${field}`, `${field} must be an asset key`);
        continue;
      }
      const asset = assetByKey.get(key);
      if (!asset) {
        fail(out, 'coverage.render-ref', `${path}.coverage.${field}`, `unknown asset ${key}`);
      } else if (asset['kind'] !== 'render') {
        fail(out, 'coverage.render-kind', `${path}.coverage.${field}`, `${field} must reference a render asset`);
      }
    }
    const attributions = coverage['attributionAssetKeys'];
    if (!Array.isArray(attributions) || !attributions.every(isAssetKey)) {
      fail(out, 'coverage.attribution', `${path}.coverage.attributionAssetKeys`, 'attributionAssetKeys must be an array of asset keys');
    } else {
      for (const key of attributions) {
        const asset = assetByKey.get(key as string);
        if (!asset) {
          fail(out, 'coverage.attribution-ref', `${path}.coverage.attributionAssetKeys`, `unknown asset ${String(key)}`);
        } else if (asset['kind'] !== 'attribution') {
          fail(out, 'coverage.attribution-kind', `${path}.coverage.attributionAssetKeys`, 'attribution keys must reference attribution assets');
        }
      }
    }
  }
}

/* ------------------------------- manifest (§6) ------------------------------ */

/** Bound all JSON-shaped input before field loops, including unknown additive data. */
function validateManifestEnvelope(manifest: Record<string, unknown>, out: ContractViolation[]): void {
  for (const field of ['assets', 'scenes', 'profiles'] as const) {
    const list = manifest[field];
    if (Array.isArray(list) && list.length > CATALOG_VALIDATION_LIMITS[field]) {
      fail(out, `manifest.limit-${field}`, `manifest.${field}`, `${field} exceeds ${CATALOG_VALIDATION_LIMITS[field]}`);
      return;
    }
  }
  const stack: { value: unknown; depth: number }[] = [{ value: manifest, depth: 0 }];
  let values = 1;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (depth > CATALOG_VALIDATION_LIMITS.jsonDepth) {
      fail(out, 'manifest.limit-depth', 'manifest', 'JSON nesting exceeds the validation ceiling');
      return;
    }
    if (typeof value === 'string' && value.length > CATALOG_VALIDATION_LIMITS.stringLength) {
      fail(out, 'manifest.limit-string', 'manifest', 'JSON string exceeds the validation ceiling');
      return;
    }
    if (typeof value !== 'object' || value === null) continue;
    if (Array.isArray(value) && value.length > CATALOG_VALIDATION_LIMITS.arrayEntries) {
      fail(out, 'manifest.limit-array', 'manifest', 'JSON array exceeds the validation ceiling');
      return;
    }
    // Do not allocate Object.entries on an unbounded object. No recursive descent.
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (++values > CATALOG_VALIDATION_LIMITS.jsonValues) {
        fail(out, 'manifest.limit-values', 'manifest', 'JSON value count exceeds the validation ceiling');
        return;
      }
      if (key.length > CATALOG_VALIDATION_LIMITS.stringLength) {
        fail(out, 'manifest.limit-string', 'manifest', 'JSON key exceeds the validation ceiling');
        return;
      }
      stack.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
    }
  }
  let edges = 0;
  const assets = manifest['assets'];
  if (Array.isArray(assets)) {
    for (const asset of assets) {
      if (!isRecord(asset) || !Array.isArray(asset['dependencyAssetKeys'])) continue;
      edges += asset['dependencyAssetKeys'].length;
      if (edges > CATALOG_VALIDATION_LIMITS.dependencyEdges) {
        fail(out, 'manifest.limit-edges', 'manifest.assets', 'Dependency edge count exceeds the validation ceiling');
        return;
      }
    }
  }
}

/** Kahn traversal: O(assets + edges), no call-stack recursion or growing trail strings. */
function validateDependencyGraph(assets: ReadonlyMap<string, Record<string, unknown>>, out: ContractViolation[]): void {
  const incoming = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const depths = new Map<string, number>();
  for (const key of assets.keys()) incoming.set(key, 0);
  for (const [key, asset] of assets) {
    const edges: string[] = [];
    const deps = asset['dependencyAssetKeys'];
    if (Array.isArray(deps)) {
      for (const dep of deps) {
        if (typeof dep !== 'string') continue;
        if (!assets.has(dep)) {
          fail(out, 'asset.dependency-ref', 'manifest.assets', `asset ${key} depends on unknown asset ${dep}`);
        } else {
          edges.push(dep);
          incoming.set(dep, incoming.get(dep)! + 1);
        }
      }
    }
    adjacency.set(key, edges);
  }
  const queue: string[] = [];
  for (const [key, count] of incoming) {
    depths.set(key, 1);
    if (count === 0) queue.push(key);
  }
  let excessiveDepth = false;
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    for (const dep of adjacency.get(key)!) {
      const depth = Math.max(depths.get(dep)!, depths.get(key)! + 1);
      depths.set(dep, depth);
      excessiveDepth ||= depth > CATALOG_VALIDATION_LIMITS.dependencyDepth;
      const remaining = incoming.get(dep)! - 1;
      incoming.set(dep, remaining);
      if (remaining === 0) queue.push(dep);
    }
  }
  if (queue.length !== assets.size) {
    fail(out, 'asset.dependency-cycle', 'manifest.assets', 'Dependency graph contains a cycle');
  }
  if (excessiveDepth) {
    fail(out, 'asset.dependency-depth', 'manifest.assets', `Dependency chains may contain at most ${CATALOG_VALIDATION_LIMITS.dependencyDepth} assets`);
  }
}

/**
 * Full manifest validation. Never throws on malformed data; every rule breach is
 * returned as a stable-coded violation. Unknown extra fields are tolerated so a
 * newer catalog can evolve additively; an unknown major `schemaVersion` rejects.
 */
export function validateBusinessCatalogManifest(manifest: unknown): ContractViolation[] {
  const out: ContractViolation[] = [];
  if (!isRecord(manifest)) {
    fail(out, 'manifest.type', 'manifest', 'manifest must be an object');
    return out;
  }
  validateManifestEnvelope(manifest, out);
  if (out.length) return out;
  if (manifest['schemaVersion'] !== BUSINESS_CATALOG_SCHEMA_VERSION) {
    fail(out, 'manifest.schema-version', 'manifest.schemaVersion', `schemaVersion must be ${BUSINESS_CATALOG_SCHEMA_VERSION}; an unknown major is a controlled rejection`);
  }
  if (!isValidCatalogVersionToken(manifest['catalogVersion'])) {
    fail(out, 'manifest.catalog-version', 'manifest.catalogVersion', 'catalogVersion must be an immutable delivery token (convention: v2.<release>)');
  }
  const renderer = manifest['renderer'];
  if (!isRecord(renderer)) {
    fail(out, 'manifest.renderer', 'manifest.renderer', 'renderer must be an object');
  } else {
    if (renderer['engine'] !== 'three') {
      fail(out, 'manifest.renderer-engine', 'manifest.renderer.engine', "engine must be 'three'");
    }
    if (renderer['revision'] !== THREE_RENDERER_REVISION) {
      fail(out, 'manifest.renderer-revision', 'manifest.renderer.revision', `revision must be '${THREE_RENDERER_REVISION}'`);
    }
    if (renderer['minContractVersion'] !== 1) {
      fail(out, 'manifest.renderer-contract', 'manifest.renderer.minContractVersion', 'minContractVersion must be 1 for this contract revision');
    }
  }

  const assets = manifest['assets'];
  const assetByKey = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(assets)) {
    fail(out, 'manifest.assets', 'manifest.assets', 'assets must be an array');
  } else {
    assets.forEach((asset, index) => {
      const aPath = `manifest.assets[${index}]`;
      validateAsset(asset, aPath, out);
      if (isRecord(asset) && isAssetKey(asset['assetKey'])) {
        const key = asset['assetKey'];
        if (assetByKey.has(key)) {
          fail(out, 'asset.duplicate', aPath, `duplicate assetKey ${key}`);
        } else {
          assetByKey.set(key, asset);
        }
      }
    });
    validateDependencyGraph(assetByKey, out);
  }

  const scenes = manifest['scenes'];
  const sceneByKey = new Map<string, string>();
  if (!Array.isArray(scenes)) {
    fail(out, 'manifest.scenes', 'manifest.scenes', 'scenes must be an array');
  } else {
    scenes.forEach((scene, index) => {
      const sPath = `manifest.scenes[${index}]`;
      const found = validateScene(scene, sPath, assetByKey, out);
      if (found.sceneKey !== undefined) {
        if (sceneByKey.has(found.sceneKey)) {
          fail(out, 'scene.duplicate', sPath, `duplicate sceneKey ${found.sceneKey}`);
        } else if (found.kind !== undefined) {
          sceneByKey.set(found.sceneKey, found.kind);
        }
      }
    });
  }

  const profiles = manifest['profiles'];
  const identities = new Set<string>();
  if (!Array.isArray(profiles)) {
    fail(out, 'manifest.profiles', 'manifest.profiles', 'profiles must be an array');
  } else {
    profiles.forEach((profile, index) => {
      const pPath = `manifest.profiles[${index}]`;
      validateProfile(profile, pPath, sceneByKey, assetByKey, out);
      if (isRecord(profile) && isNonEmptyString(profile['profileKey']) && isNonEmptyString(profile['editorialRevision'])) {
        // The accepted identity is the pair; catalogVersion must never substitute it.
        const identity = `${profile['profileKey']}\u0000${profile['editorialRevision']}`;
        if (identities.has(identity)) {
          fail(out, 'profile.duplicate-identity', pPath, `duplicate accepted identity ${identity}`);
        }
        identities.add(identity);
      }
    });
  }
  return out;
}

/* ------------------------- typed convenience wrappers ----------------------- */

/** Narrows a validated manifest for consumers that still keep their own runtime checks. */
export function isValidBusinessCatalogManifest(manifest: unknown): manifest is BusinessCatalogManifest {
  return validateBusinessCatalogManifest(manifest).length === 0;
}

export function isValidVisualProfileRef(ref: unknown): ref is VisualProfileRef {
  return validateVisualProfileRef(ref).length === 0;
}
