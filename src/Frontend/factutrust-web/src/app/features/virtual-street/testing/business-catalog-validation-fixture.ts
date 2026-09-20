/** Synthetic schema data only: no real bytes, rights approval or release coverage. */
export const SHA = 'a'.repeat(64);

export function glbAsset(assetKey: string, path: string): Record<string, unknown> {
  return {
    assetKey,
    kind: 'glb',
    path,
    mimeType: 'model/gltf-binary',
    sha256: SHA,
    encodedBytes: 1024,
    estimatedDecodedBytes: 4096,
    dependencyAssetKeys: [],
    gltf: { requiredExtensions: [], allowedExtensions: [], embeddedImageMimeTypes: ['image/png'] },
    textures: [
      { key: 'albedo', width: 1024, height: 1024, mipLevels: 11, layers: 1, colorSpace: 'srgb', estimatedDecodedBytes: 4194304 }
    ]
  };
}

function simpleAsset(assetKey: string, kind: string, path: string, mimeType: string): Record<string, unknown> {
  return {
    assetKey,
    kind,
    path,
    mimeType,
    sha256: SHA,
    encodedBytes: 512,
    estimatedDecodedBytes: 2048,
    dependencyAssetKeys: [],
    gltf: null,
    textures: []
  };
}

export function variant(modelAssetKey: string): Record<string, unknown> {
  return {
    modelAssetKey,
    rootNode: 'StorefrontRoot',
    lods: [
      { node: 'StorefrontRoot', minDistanceMeters: 0, triangles: 7000 },
      { node: 'StorefrontRoot_LOD1', minDistanceMeters: 25, triangles: 700 }
    ],
    requiredWebGlVersion: 1,
    transferBytes: 2048,
    estimatedTextureBytes: 4 * 1024 * 1024,
    triangles: 7000,
    drawCalls: 40
  };
}

export function scene(sceneKey: string, kind: string, modelPrefix: string): Record<string, unknown> {
  return {
    sceneKey,
    kind,
    units: 'meters',
    upAxis: '+Y',
    frontAxis: '+Z',
    origin: 'threshold-ground',
    bounds: { min: [-2, 0, 0], max: [2, 4, 3] },
    variants: { economy: variant(`${modelPrefix}-eco`), standard: variant(`${modelPrefix}-std`) },
    navigation: {
      spawn: { key: 'spawn', position: [0, 1.7, 2.5], target: [0, 1.2, 0] },
      exit: { key: 'exit', position: [0, 1.7, 3.5], target: [0, 1.2, 10] },
      viewpoints: [{ key: 'overview', position: [1, 1.7, 2], target: [0, 1, 0] }],
      walkableBounds: [{ min: [-1.5, 0, 0], max: [1.5, 2.2, 3] }],
      collisionBounds: [{ min: [-2, 0, 3], max: [2, 3, 3.2] }]
    },
    interactions: [
      { key: 'look-around', label: 'Observer la scène', position: [0, 1.4, 1], action: { role: 'inspectScene', viewpointKey: 'overview' } },
      { key: 'leave', label: 'Retour à la rue', position: [0, 1.4, 3], action: { role: 'exit' } }
    ],
    branding: { signNode: 'Sign_Plane', logoNode: 'Logo_Plane', colorMaterialNames: ['M_Sign'], maxSignCharacters: 48 },
    lightmaps: kind === 'interior'
      ? []
      : [{ materialName: 'M_Walls', textureAssetKey: 'tex-lightmap', texCoord: 1, intensity: 1 }]
  };
}

export function validProfile(): Record<string, unknown> {
  const recipes: Record<string, unknown> = {};
  for (const theme of [0, 1, 2, 3, 4]) {
    recipes[String(theme)] = { recipeKey: `recipe-theme-${theme}`, materialNames: ['M_Sign'], assetKeys: ['tex-sign'] };
  }
  return {
    profileKey: 'syn-commerce-textile-habillement',
    editorialRevision: 'r1',
    representationKind: 'illustrative',
    status: 'active',
    facadeSceneKey: 'syn-facade',
    interiorSceneKey: 'syn-interior',
    localExteriorSceneKey: null,
    styleRecipes: recipes,
    coverage: {
      exteriorRenderAssetKey: 'render-facade',
      interiorRenderAssetKey: 'render-interior',
      attributionAssetKeys: ['attribution-note']
    }
  };
}

export function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    catalogVersion: 'v2.2026-09-17',
    renderer: { engine: 'three', revision: '161', minContractVersion: 1 },
    profiles: [validProfile()],
    scenes: [scene('syn-facade', 'street-facade', 'glb-facade'), scene('syn-interior', 'interior', 'glb-interior')],
    assets: [
      glbAsset('glb-facade-eco', 'facade/economy.glb'),
      glbAsset('glb-facade-std', 'facade/standard.glb'),
      glbAsset('glb-interior-eco', 'interior/economy.glb'),
      glbAsset('glb-interior-std', 'interior/standard.glb'),
      simpleAsset('tex-sign', 'texture', 'textures/sign.png', 'image/png'),
      simpleAsset('tex-lightmap', 'lightmap', 'lightmaps/facade.png', 'image/png'),
      simpleAsset('render-facade', 'render', 'proofs/facade.png', 'image/png'),
      simpleAsset('render-interior', 'render', 'proofs/interior.png', 'image/png'),
      simpleAsset('attribution-note', 'attribution', 'proofs/attribution.md', 'text/markdown')
    ]
  };
}
