import type {
  Clock,
  DirectionalLight,
  FogExp2,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  WebGLRenderer,
  Group,
  Intersection,
  LOD,
  Mesh,
  Raycaster,
  Vector2
} from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { StreetMapEntry } from '../services/street-api.service';
import {
  applyLogoTextureToGroup,
  buildStorefrontGroup,
  setGroupHighlight,
  type ThreeModule
} from './street-facade.builder';
import { applyBrandingToFacadeVisual } from './street-facade-branding';
import { deepDisposeObject3D } from './street-facade-dispose';
import { detachStorefrontRootsFromGltfClone } from './street-facade-pack-utils';
import {
  cloneGltfSceneForInstance,
  disposeGltfTemplateCache,
  loadFacadeTemplate
} from './street-facade-gltf';
import { isTrustedStreetTextureUrl, parseHexColor, resolveStreetMediaUrl } from './street-media-url';
import { vsEnv } from './street-env';
import { DisposableRegistry } from './street-disposable-registry';
import { disposePbrTextureCache } from './street-texture-cache';
import { disposePropTemplateCache } from './street-props-loader';
import { applyPbrSetToStandardMaterial, ensureUv2, tryLoadPbrSet } from './street-pbr-textures';
import {
  buildSidewalkSlabs,
  buildSkyGradient,
  buildStreetLamps,
  tweakFog
} from './street-atmosphere';
import {
  releaseHoverBounce,
  runCinematicIntro,
  tickAwningSway,
  tickHoverBounce,
  tickLanternFlicker
} from './street-animations';
import { createPostFxBundle, type PostFxBundle } from './street-postfx';
import { findMeshByNames } from './street-facade-mesh-utils';
import { computeStreetFraming } from './street-camera-framing';

export interface VirtualStreetSceneCallbacks {
  onStorefrontClickSlug: (slug: string) => void;
  onHoverSlugChange?: (slug: string | null) => void;
}

/** Inputs of the scene-readiness decision (pure, unit-tested). */
export interface StreetSceneReadinessInput {
  /** Frames actually rendered by the WebGL loop for the current street build. */
  renderedFrames: number;
  /** Storefronts whose legacy GLB visual (with real meshes) is attached. */
  readyFacades: number;
  /** Storefronts expected on the current map (wrapper count). */
  expectedFacades: number;
  /** Readiness must be announced at most once per street build. */
  alreadyAnnounced: boolean;
}

/**
 * The scene is "ready" only once at least one real frame has been rendered AND
 * every expected storefront has its GLB visual attached. An empty street, a
 * missing frame or a fallback-only (procedural/skeleton) facade never qualifies.
 */
export function shouldAnnounceSceneReady(input: StreetSceneReadinessInput): boolean {
  if (input.alreadyAnnounced) return false;
  if (input.renderedFrames < 1) return false;
  if (input.expectedFacades < 1) return false;
  return input.readyFacades >= input.expectedFacades;
}

/**
 * Guards the readiness counter: a GLB clone only counts when it actually
 * contains renderable meshes (an empty or skeleton-only root does not).
 */
export function gltfVisualHasRenderableMesh(root: Object3D): boolean {
  let found = false;
  root.traverse(node => {
    if ((node as Mesh).isMesh) found = true;
  });
  return found;
}

export class VirtualStreetScene {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private frame = 0;
  private resizeObs: ResizeObserver | null = null;
  private visibilityHandler: (() => void) | null = null;
  private three: ThreeModule | null = null;
  private streetRoot: Group | null = null;
  private slugToGroup = new Map<string, Group>();
  private raycaster: Raycaster | null = null;
  private pointerNdc: Vector2 | null = null;
  private dragStart: { x: number; y: number; t: number } | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private selectedSlug: string | null = null;
  private logoQueue: Promise<void> = Promise.resolve();
  private lastHoverSlug: string | null = null;
  private disposed = false;
  private readonly disposables = new DisposableRegistry();
  private clock: Clock | null = null;
  private hoveredGroup: Group | null = null;
  private prevHoveredGroup: Group | null = null;
  private lampLights: PointLight[] = [];
  private awningMeshes: Object3D[] = [];
  private postFx: PostFxBundle | null = null;
  private keyShadowLight: DirectionalLight | null = null;
  private currentLodSwapDistance = 24;
  private readyFacadeCount = 0;
  private readyAnnounced = false;
  private renderedFrameCount = 0;
  private readonly reducedMotion: boolean =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private readonly callbacks: VirtualStreetSceneCallbacks,
    private readonly parent: HTMLElement,
    private readonly canvasEl: HTMLCanvasElement
  ) {}

  async mount(map: StreetMapEntry[]): Promise<void> {
    if (this.disposed) return;
    try {
      await this.mountInternal(map);
    } catch (err) {
      this.markSceneUnavailable(err);
    }
  }

  /**
   * WebGL can be unavailable (old device, blocked driver) or a lazy chunk can
   * fail to load. Surface a plain non-sensitive marker instead of an unhandled
   * rejection; the page keeps the accessible list as the independent fallback.
   */
  private markSceneUnavailable(err: unknown): void {
    this.canvasEl.dataset['sceneUnavailable'] = 'true';
    if (!vsEnv.production) {
      console.warn('[VirtualStreet] Scène 3D indisponible (WebGL ou chargement).', err);
    }
  }

  private async mountInternal(map: StreetMapEntry[]): Promise<void> {
    const three = await import('three');
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
    this.three = three;
    this.canvas = this.canvasEl;

    const scene = new three.Scene();
    scene.background = new three.Color(0x070b14);
    scene.fog = new three.FogExp2(0x0b1220, 0.025);
    this.scene = scene;

    const camera = new three.PerspectiveCamera(44, 1, 0.1, 120);
    camera.position.set(0, 5.15, 14.2);
    camera.lookAt(0, 2.35, 0);
    camera.layers.enable(1);
    this.camera = camera;

    const renderer = new three.WebGLRenderer({
      canvas: this.canvasEl,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = three.SRGBColorSpace;
    renderer.toneMapping = three.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = three.PCFSoftShadowMap;
    this.renderer = renderer;

    const controls = new OrbitControls(camera, this.canvasEl);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minPolarAngle = 0.85;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minAzimuthAngle = -0.55;
    controls.maxAzimuthAngle = 0.55;
    controls.minDistance = 8.2;
    controls.maxDistance = 24;
    controls.target.set(0, 2.35, 0);
    controls.update();
    this.controls = controls;

    scene.add(new three.AmbientLight(0xe2e8f0, 0.38));
    const key = new three.DirectionalLight(0xffffff, 1.12);
    key.position.set(8, 22, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 4;
    key.shadow.camera.far = 48;
    key.shadow.camera.left = -20;
    key.shadow.camera.right = 20;
    key.shadow.camera.top = 20;
    key.shadow.camera.bottom = -20;
    this.keyShadowLight = key;
    scene.add(key);
    const fill = new three.DirectionalLight(0x94a3b8, 0.28);
    fill.position.set(-12, 10, -6);
    scene.add(fill);

    const hemi = new three.HemisphereLight(0xbae6fd, 0x0f172a, 0.45);
    scene.add(hemi);

    if (vsEnv.storefrontPbrEnvironment) {
      try {
        const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
        const pmrem = new three.PMREMGenerator(renderer);
        const generated = pmrem.fromScene(new RoomEnvironment(), 0.04);
        scene.environment = generated.texture;
        pmrem.dispose();
      } catch {
        /* IBL optionnelle : ne pas bloquer la scène */
      }
    }

    const streetRoot = new three.Group();
    this.streetRoot = streetRoot;
    scene.add(streetRoot);

    this.clock = new three.Clock();
    this.buildStreet(three, map, streetRoot);
    this.setSelectedSlug(this.selectedSlug);

    buildSkyGradient(three, scene, this.disposables);
    tweakFog(three, scene);
    if (vsEnv.storefrontPostFxEnabled) {
      this.postFx = await createPostFxBundle(three, renderer, scene, camera);
      if (this.postFx) {
        const w0 = this.parent.clientWidth || 640;
        const h0 = this.parent.clientHeight || 480;
        this.postFx.setSize(w0, h0, renderer.getPixelRatio());
        this.disposables.add(this.postFx);
      }
    }

    this.raycaster = new three.Raycaster();
    this.raycaster.layers.set(0);
    this.raycaster.params.Line.threshold = 0.1;
    this.pointerNdc = new three.Vector2();

    this.bindPointer();
    this.bindVisibility();

    const loop = () => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(loop);
      if (document.visibilityState === 'visible') {
        controls.update();
        if (streetRoot && camera) {
          streetRoot.traverse(o => {
            const lod = o as LOD;
            if (lod.isLOD) lod.update(camera);
          });
        }
        if (vsEnv.storefrontMicroAnimationsEnabled && !this.reducedMotion && this.clock) {
          const t = this.clock.getElapsedTime();
          if (this.prevHoveredGroup && this.prevHoveredGroup !== this.hoveredGroup) {
            releaseHoverBounce(this.prevHoveredGroup);
          }
          tickHoverBounce(this.hoveredGroup, t);
          tickLanternFlicker(this.lampLights, t);
          tickAwningSway(this.awningMeshes, t);
          this.prevHoveredGroup = this.hoveredGroup;
        }
        if (this.postFx) this.postFx.render();
        else renderer.render(scene, camera);
        this.renderedFrameCount += 1;
        this.announceSceneReadyWhenRendered();
      }
    };
    loop();

    const resize = () => {
      const w = this.parent.clientWidth || 640;
      const h = this.parent.clientHeight || 480;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      this.postFx?.setSize(w, h, renderer.getPixelRatio());
    };
    resize();
    this.resizeObs = new ResizeObserver(() => resize());
    this.resizeObs.observe(this.parent);

    if (vsEnv.storefrontCinematicIntro && !this.reducedMotion && !this.disposed) {
      void runCinematicIntro(camera, controls, 1200, () => this.disposed);
    }
  }

  private buildStreet(three: ThreeModule, map: StreetMapEntry[], streetRoot: Group): void {
    this.readyFacadeCount = 0;
    this.readyAnnounced = false;
    this.renderedFrameCount = 0;
    if (this.canvas) {
      // A rebuild re-arms readiness: a stale "ready" marker must not survive it.
      delete this.canvas.dataset['sceneReady'];
      delete this.canvas.dataset['sceneReadyFacades'];
    }
    while (streetRoot.children.length) {
      streetRoot.remove(streetRoot.children[0]!);
    }
    this.slugToGroup.clear();
    if (this.lastHoverSlug !== null) {
      this.lastHoverSlug = null;
      this.callbacks.onHoverSlugChange?.(null);
    }

    const ordered = [...map].sort((a, b) => a.streetPositionIndex - b.streetPositionIndex);
    const n = Math.max(ordered.length, 1);
    const dynamic = vsEnv.storefrontDynamicFramingEnabled;
    const R = dynamic
      ? (19 + Math.min(n, 24) * 0.55) * 1.06
      : (19 + Math.min(n, 12) * 0.35) * 1.06;
    const span = dynamic
      ? Math.min(1.55, 0.16 * n + 0.18)
      : Math.min(1.25, 0.22 * n + 0.18);

    const useGltf = !!vsEnv.storefrontGltfFacades;
    const enableLod = dynamic
      ? ordered.length >= 18 && useGltf
      : ordered.length >= 10 && useGltf;

    this.awningMeshes = [];
    this.lampLights = [];

    for (let i = 0; i < ordered.length; i++) {
      const entry = ordered[i]!;
      const wrapper = new three.Group();
      wrapper.userData['pickSlug'] = entry.slug;
      wrapper.userData['displayName'] = entry.displayName;

      const procedural = buildStorefrontGroup(three, entry);
      procedural.name = '__procedural';
      wrapper.add(procedural);

      const t = n === 1 ? 0 : -span / 2 + (i / (n - 1)) * span;
      const x = R * Math.sin(t);
      const z = -R * Math.cos(t) + R * 0.88;
      wrapper.position.set(x, 0, z);
      wrapper.lookAt(0, 2.1, 6);
      wrapper.userData['baseY'] = wrapper.position.y;
      streetRoot.add(wrapper);
      this.slugToGroup.set(entry.slug, wrapper);
      this.collectAnimationTargets(procedural);

      if (useGltf) {
        void this.trySwapToGltf(three, entry, wrapper, procedural, enableLod);
      }
    }

    this.addStreetBackdropSilhouettes(three, streetRoot, R);

    const groundW = Math.max(n * 4.85 + 16, 26);
    const groundD = 16;
    const groundGeo = new three.PlaneGeometry(groundW, groundD, 1, 1);
    const groundMat = this.makeTiledGroundMaterial(three, groundW, groundD);
    const ground = new three.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    streetRoot.add(ground);
    this.scheduleGroundPbrUpgrade(three, ground, groundW, groundD);

    buildSidewalkSlabs(three, streetRoot, n, this.disposables, R);
    void buildStreetLamps(three, streetRoot, n, this.disposables, R).then(({ pointLights }) => {
      if (this.disposed) return;
      this.lampLights = pointLights;
    });

    this.enqueueLogoTextures(three, ordered);
    this.applyStreetCameraFraming(ordered.length, R);
  }

  /** Walks a freshly-built procedural or GLTF visual root to register awning meshes for the sway animation. */
  private collectAnimationTargets(root: Group): void {
    const awning = findMeshByNames(root, ['Awning_Canopy']);
    if (awning) this.awningMeshes.push(awning);
  }

  /**
   * Async post-mount swap of the ground material with a PBR texture set when the
   * concrete-sidewalk maps are available. Non-blocking; if loading fails the
   * canvas-tiled material stays in place and nothing crashes.
   */
  private scheduleGroundPbrUpgrade(three: ThreeModule, ground: Mesh, w: number, d: number): void {
    if (!vsEnv.storefrontPbrTexturesEnabled || !this.renderer) return;
    const renderer = this.renderer;
    const run = (): void => {
      if (this.disposed) return;
      const aniso = renderer.capabilities.getMaxAnisotropy?.() ?? 1;
      void tryLoadPbrSet(three, 'concrete-sidewalk', aniso).then(set => {
        if (this.disposed || !set) return;
        const mat = ground.material as import('three').MeshStandardMaterial;
        ensureUv2(ground);
        applyPbrSetToStandardMaterial(
          mat as unknown as Parameters<typeof applyPbrSetToStandardMaterial>[0],
          set,
          w / 3.2,
          d / 3.2
        );
      });
    };
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (typeof idle === 'function') idle(run);
    else setTimeout(run, 0);
  }

  /** Tighter framing when a single storefront fills the scene; default for multi-store arc. */
  private applyStreetCameraFraming(storefrontCount: number, arcRadius = 22): void {
    const cam = this.camera;
    const ctrl = this.controls;
    if (!cam || !ctrl) return;

    if (!vsEnv.storefrontDynamicFramingEnabled) {
      ctrl.target.set(0, 2.42, 0);
      if (storefrontCount === 1) {
        cam.position.set(0, 5.05, 12.2);
        ctrl.minDistance = 7.0;
        ctrl.maxDistance = 19;
      } else {
        cam.position.set(0, 5.15, 14.2);
        ctrl.minDistance = 8.2;
        ctrl.maxDistance = 24;
      }
      cam.lookAt(ctrl.target);
      ctrl.update();
      return;
    }

    const params = computeStreetFraming(storefrontCount, arcRadius);

    cam.fov = params.fov;
    cam.updateProjectionMatrix();

    cam.position.set(params.position.x, params.position.y, params.position.z);
    ctrl.target.set(params.target.x, params.target.y, params.target.z);
    ctrl.minDistance = params.minDistance;
    ctrl.maxDistance = params.maxDistance;
    ctrl.minAzimuthAngle = -params.azimuth;
    ctrl.maxAzimuthAngle = params.azimuth;

    this.currentLodSwapDistance = params.lodSwapDistance;

    if (this.keyShadowLight) {
      const half = params.shadowOrthoHalfSize;
      const cam2 = this.keyShadowLight.shadow.camera;
      cam2.left = -half;
      cam2.right = half;
      cam2.top = half;
      cam2.bottom = -half;
      cam2.far = Math.max(48, half * 2.4);
      cam2.updateProjectionMatrix();
    }

    if (this.scene?.fog) {
      const fog = this.scene.fog as FogExp2 & { isFogExp2?: boolean };
      if (fog.isFogExp2) fog.density = params.fogDensity;
    }

    cam.lookAt(ctrl.target);
    ctrl.update();
  }

  /** Distant building silhouettes (same-origin geometry only) to reduce empty-void feel. */
  private addStreetBackdropSilhouettes(three: ThreeModule, streetRoot: Group, arcRadius: number): void {
    const mat = new three.MeshStandardMaterial({
      color: 0x0b1220,
      roughness: 0.92,
      metalness: 0.04
    });
    const group = new three.Group();
    group.name = '__streetBackdrop';

    const depth = 1.2;
    const spread = Math.max(arcRadius * 1.35, 26);
    const heights = [9.5, 11.2, 8.8, 10.4, 7.6];
    for (let i = 0; i < 5; i++) {
      const w = 2.4 + (i % 3) * 0.55;
      const h = heights[i]!;
      const mesh = new three.Mesh(new three.BoxGeometry(w, h, depth), mat);
      const side = i % 2 === 0 ? -1 : 1;
      mesh.position.set(side * (spread * 0.42 + i * 0.35), h / 2, -10.5 - (i % 2) * 1.8);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.layers.set(1);
      group.add(mesh);
    }
    streetRoot.add(group);
  }

  private async trySwapToGltf(
    three: ThreeModule,
    entry: StreetMapEntry,
    wrapper: Group,
    procedural: Group,
    enableLod: boolean
  ): Promise<void> {
    const gltf = await loadFacadeTemplate(entry.facadeTheme);
    if (this.disposed || !gltf) {
      if (!vsEnv.production && vsEnv.storefrontGltfDebugLog) {
        console.warn('[VirtualStreet] GLB indisponible — procédural conservé', {
          slug: entry.slug,
          theme: entry.facadeTheme
        });
      }
      return;
    }
    // Late loads from a previous street build must not count for the current one.
    if (this.slugToGroup.get(entry.slug) !== wrapper) return;
    const stillHas = wrapper.children.some(c => c === procedural && c.name === '__procedural');
    if (!stillHas) return;

    const clone = cloneGltfSceneForInstance(three, gltf);
    const { high, lod1, emptyPack } = detachStorefrontRootsFromGltfClone(clone);
    if (emptyPack) deepDisposeObject3D(emptyPack);

    applyBrandingToFacadeVisual(three, high, entry);

    wrapper.remove(procedural);
    deepDisposeObject3D(procedural);

    this.collectAnimationTargets(high);

    // A GLB without renderable meshes (empty/skeleton-only) never counts as ready.
    const countsForReadiness = gltfVisualHasRenderableMesh(high);

    if (enableLod) {
      const lod = new three.LOD();
      lod.name = '__gltfLod';
      lod.addLevel(high, 0);
      const swapAt = this.currentLodSwapDistance;
      if (lod1) {
        lod.addLevel(lod1, swapAt);
      } else {
        const low = new three.Mesh(
          new three.BoxGeometry(2.12, 3.15, 1.32),
          new three.MeshStandardMaterial({
            color: parseHexColor(entry.brandPrimaryColorHex, 0x334155),
            roughness: 0.88,
            metalness: 0.06
          })
        );
        low.position.y = 1.35;
        low.name = '__lodLow';
        lod.addLevel(low, swapAt);
      }
      wrapper.add(lod);
      if (countsForReadiness) this.readyFacadeCount += 1;
    } else {
      high.name = '__gltf';
      wrapper.add(high);
      if (countsForReadiness) this.readyFacadeCount += 1;
      if (lod1) deepDisposeObject3D(lod1);
    }

    this.enqueueLogoTextures(three, [entry]);

    if (!vsEnv.production && vsEnv.storefrontGltfDebugLog) {
      console.info('[VirtualStreet] GLB swap OK', {
        slug: entry.slug,
        theme: entry.facadeTheme,
        lod: enableLod
      });
    }
  }

  /** Rebuild façades when the public map payload changes (e.g. after filter). */
  updateMap(map: StreetMapEntry[]): void {
    const three = this.three;
    if (!three || !this.streetRoot) return;
    const sel = this.selectedSlug;
    this.buildStreet(three, map, this.streetRoot);
    this.setSelectedSlug(sel);
  }

  private makeTiledGroundMaterial(three: ThreeModule, w: number, d: number) {
    const tile = 256;
    const canvas = document.createElement('canvas');
    canvas.width = tile;
    canvas.height = tile;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, tile, tile);
      ctx.strokeStyle = 'rgba(148,163,184,0.12)';
      ctx.lineWidth = 1;
      const step = 32;
      for (let x = 0; x <= tile; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, tile);
        ctx.stroke();
      }
      for (let y = 0; y <= tile; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(tile, y);
        ctx.stroke();
      }
      let wear = 0x6a09e667;
      const rndWear = (): number => {
        wear = Math.imul(wear ^ (wear >>> 15), wear | 1);
        wear ^= wear + Math.imul(wear ^ (wear >>> 7), wear | 61);
        return (wear >>> 0) / 0xffffffff;
      };
      for (let k = 0; k < 48; k++) {
        const rx = Math.floor(rndWear() * (tile - 6));
        const ry = Math.floor(rndWear() * (tile - 6));
        ctx.fillStyle = `rgba(30,41,59,${0.04 + rndWear() * 0.06})`;
        ctx.fillRect(rx, ry, 4 + rndWear() * 8, 3 + rndWear() * 6);
      }
    }
    const tex = new three.CanvasTexture(canvas);
    tex.wrapS = three.RepeatWrapping;
    tex.wrapT = three.RepeatWrapping;
    tex.repeat.set(w / 3.2, d / 3.2);
    tex.colorSpace = three.SRGBColorSpace;
    return new three.MeshStandardMaterial({
      map: tex,
      roughness: 0.88,
      metalness: 0.05,
      color: 0x1e293b
    });
  }

  private enqueueLogoTextures(three: ThreeModule, ordered: StreetMapEntry[]): void {
    const withUrls = ordered
      .map(e => {
        const abs = resolveStreetMediaUrl(e.publicLogoUrl);
        return abs && isTrustedStreetTextureUrl(abs) ? { entry: e, url: abs } : null;
      })
      .filter((x): x is { entry: StreetMapEntry; url: string } => x != null);

    let active = 0;
    const maxConcurrent = vsEnv.storefrontDynamicFramingEnabled
      ? Math.min(4, Math.max(2, Math.ceil(withUrls.length / 4)))
      : 2;

    const runOne = async (url: string, slug: string): Promise<void> => {
      const group = this.slugToGroup.get(slug);
      if (!group || this.disposed) return;
      await new Promise<void>((resolve, reject) => {
        const loader = new three.TextureLoader();
        loader.setCrossOrigin('anonymous');
        loader.load(
          url,
          tex => {
            if (this.disposed) {
              tex.dispose();
              resolve();
              return;
            }
            applyLogoTextureToGroup(three, group, tex, 256);
            resolve();
          },
          undefined,
          () => resolve()
        );
      });
    };

    for (const { entry, url } of withUrls) {
      this.logoQueue = this.logoQueue.then(async () => {
        while (active >= maxConcurrent) {
          await new Promise(r => setTimeout(r, 30));
          if (this.disposed) return;
        }
        active++;
        try {
          await runOne(url, entry.slug);
        } finally {
          active--;
        }
      });
    }
  }

  setSelectedSlug(slug: string | null): void {
    const three = this.three;
    if (!three || !this.streetRoot) return;
    const prev = this.selectedSlug;
    if (prev && this.slugToGroup.has(prev)) {
      setGroupHighlight(three, this.slugToGroup.get(prev)!, false);
    }
    this.selectedSlug = slug;
    if (slug && this.slugToGroup.has(slug)) {
      setGroupHighlight(three, this.slugToGroup.get(slug)!, true);
    }
  }

  /**
   * Exposes a plain UI readiness marker for assistive automation and the
   * baseline E2E only after real GLB geometry is attached and rendered.
   * Non-sensitive: a boolean plus the public storefront count already visible
   * on the page. No scene/graph/GPU object ever leaves the runtime.
   */
  private announceSceneReadyWhenRendered(): void {
    if (!this.canvas) return;
    const announce = shouldAnnounceSceneReady({
      renderedFrames: this.renderedFrameCount,
      readyFacades: this.readyFacadeCount,
      expectedFacades: this.slugToGroup.size,
      alreadyAnnounced: this.readyAnnounced
    });
    if (!announce) return;
    this.readyAnnounced = true;
    this.canvas.dataset['sceneReady'] = 'true';
    this.canvas.dataset['sceneReadyFacades'] = String(this.readyFacadeCount);
  }

  private bindPointer(): void {
    const canvas = this.canvasEl;
    const onDown = (ev: PointerEvent) => {
      this.dragStart = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    };
    const onUp = (ev: PointerEvent) => {
      if (!this.dragStart || !this.raycaster || !this.camera || !this.scene) return;
      const dx = ev.clientX - this.dragStart.x;
      const dy = ev.clientY - this.dragStart.y;
      const dt = performance.now() - this.dragStart.t;
      this.dragStart = null;
      if (dx * dx + dy * dy > 36 || dt > 650) return;

      const rect = canvas.getBoundingClientRect();
      this.pointerNdc!.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1
      );
      this.raycaster.setFromCamera(this.pointerNdc!, this.camera);
      const hits = this.raycaster.intersectObjects(this.scene.children, true);
      const slug = this.pickSlugFromHits(hits);
      if (slug) this.callbacks.onStorefrontClickSlug(slug);
    };
    const onMove = (ev: PointerEvent) => {
      if (!this.raycaster || !this.camera || !this.scene) return;
      const rect = canvas.getBoundingClientRect();
      this.pointerNdc!.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1
      );
      this.raycaster.setFromCamera(this.pointerNdc!, this.camera);
      const hits = this.raycaster.intersectObjects(this.scene.children, true);
      const slug = this.pickSlugFromHits(hits);
      if (slug !== this.lastHoverSlug) {
        this.lastHoverSlug = slug;
        this.hoveredGroup = slug ? this.slugToGroup.get(slug) ?? null : null;
        this.callbacks.onHoverSlugChange?.(slug);
      }
    };
    const onLeave = () => {
      if (this.lastHoverSlug !== null) {
        this.lastHoverSlug = null;
        this.hoveredGroup = null;
        this.callbacks.onHoverSlugChange?.(null);
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    (canvas as unknown as { _vsCleanup?: () => void })._vsCleanup = () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }

  private pickSlugFromHits(hits: Intersection[]): string | null {
    for (const h of hits) {
      let o: typeof h.object | null = h.object;
      while (o) {
        const slug = o.userData['pickSlug'] as string | undefined;
        if (slug) return slug;
        o = o.parent;
      }
    }
    return null;
  }

  private bindVisibility(): void {
    const handler = () => {
      /* render loop already gates on visibilityState */
    };
    document.addEventListener('visibilitychange', handler);
    this.visibilityHandler = () => document.removeEventListener('visibilitychange', handler);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.visibilityHandler?.();
    this.visibilityHandler = null;
    const cleanup = (this.canvasEl as unknown as { _vsCleanup?: () => void })._vsCleanup;
    cleanup?.();

    this.disposables.disposeAll();

    this.controls?.dispose();
    this.controls = null;

    if (this.renderer && this.scene) {
      const envTex = this.scene.environment as { dispose?: () => void } | null;
      envTex?.dispose?.();
      this.scene.environment = null;
      this.scene.traverse(obj => {
        const mesh = obj as Mesh;
        if (!mesh.geometry) return;
        mesh.geometry.dispose();
        const mat = mesh.material as
          | { dispose: () => void; map?: { dispose: () => void } }
          | Array<{ dispose: () => void; map?: { dispose: () => void } }>
          | undefined;
        if (!mat) return;
        if (Array.isArray(mat)) {
          mat.forEach(x => {
            x.map?.dispose();
            x.dispose();
          });
        } else {
          mat.map?.dispose();
          mat.dispose();
        }
      });
      this.renderer.dispose();
      this.renderer.forceContextLoss?.();
    }
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.streetRoot = null;
    this.slugToGroup.clear();
    this.three = null;
    this.raycaster = null;
    this.canvas = null;
    disposeGltfTemplateCache();
    disposePbrTextureCache();
    disposePropTemplateCache();
  }
}
