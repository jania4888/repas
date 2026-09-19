export const environment = {
  production: false,
  apiUrl: '/api',
  /** Global search bar + Ctrl+K palette. Set false to disable without code revert. */
  globalSearchEnabled: true,
  appName: 'InstaFact',
  version: '1.0.0',
  aiAssistantProgressTimelineEnabled: true,
  aiAssistantWarmUpEnabled: true,
  /** When true, humanizes short assistant replies that embed business JSON fences. */
  aiAssistantSmartJsonFallbackEnabled: true,
  /** When true, resyncs assistant content from server on done if local prose is too short. */
  aiAssistantContentResyncEnabled: true,
  /** Public 3D virtual street + related APIs (`/api/public/street`, tenant storefront admin). */
  storefrontEnabled: true,
  /** Load GLB façade templates from `/assets/virtual-street/facades/` (see README there). */
  storefrontGltfFacades: true,
  /** Bump to invalidate browser cache after replacing GLB assets. */
  storefrontGltfFacadesVersion: '6',
  /** When true, GLTFLoader uses Draco decoders from `/assets/vendor/draco/gltf/` (run `npm run vendor:draco`). */
  storefrontGltfDraco: false,
  /** When true, GLTFLoader uses Meshopt decoder (bundled `three/examples/jsm/libs/meshopt_decoder.module.js`). */
  storefrontGltfMeshopt: false,
  /** Dev-only: log GLB swap success/failure to console (never enable in production builds). */
  storefrontGltfDebugLog: false,
  /** Indoor-style IBL for PBR reflections (same-origin, no external HDR). */
  storefrontPbrEnvironment: true,
  /** Load extra GLB props (planters, lanterns, address plates) under `/assets/virtual-street/props/`. */
  storefrontPropsEnabled: true,
  /** Load procedurally-generated PBR texture sets under `/assets/virtual-street/textures/`. */
  storefrontPbrTexturesEnabled: true,
  /** Render street lamp instanced meshes + warm point lights between storefronts. */
  storefrontStreetLampsEnabled: true,
  /** Enable EffectComposer post-FX (UnrealBloom + FXAA). OFF by default — re-enable per build. */
  storefrontPostFxEnabled: false,
  /** Hover bounce, lantern flicker, awning sway. Always honors `prefers-reduced-motion`. */
  storefrontMicroAnimationsEnabled: true,
  /** Camera dolly-in on first mount. Always honors `prefers-reduced-motion`. */
  storefrontCinematicIntro: true,
  /** Build the rich procedural fallback (door + mullions + awning + lantern + planters). */
  storefrontProceduralRichEnabled: true,
  /** Smoothly scale camera/LOD/shadow with storefront count. Switch off for legacy fixed framing. */
  storefrontDynamicFramingEnabled: true,
  accountingFirmsEnabled: true,
  /** Optional external help URL for accounting-firm delegated sidemenu footer. */
  firmHelpUrl: 'https://instafact.tn/aide',
  /** Canal WhatsApp (liaison assistant IA + rappels fiscaux). Tuile Paramètres → WhatsApp. */
  channelsEnabled: true,
  featureFlags: {
    /** Simplified 4-step invoice wizard (Document, Client, Billing, Review). Falls back to 6-step legacy flow when false. */
    wizardSimplifiedFlow: true,
    /** Enables the "Download PDF" preview button inside the invoice wizard review step. Requires backend endpoint. */
    pdfPreview: false,
    /** Single GET /exchanges/bootstrap for Échanges cold load. Set false to fall back to legacy multi-call bootstrap. */
    exchangeBootstrapV2: true,
    /**
     * Invoice (and document) product autocomplete: prefetch + local cache + lightweight /products/select.
     * Set false to restore legacy getProducts() per keystroke.
     */
    invoiceProductSearchV2: true,
    /**
     * Trésorerie prévisionnelle par IA (`/treasury/cash-forecast`).
     * À basculer CONJOINTEMENT avec `TreasuryForecast:Enabled` côté API : si le back est off,
     * toutes les routes du module répondent 503.
     */
    treasuryCashForecast: true,
    /** Sector-aware 4-step registration wizard at /auth/register. Set false to serve the legacy 3-step form. */
    registrationWizardV2: true,
    /** Phase 2 sector rules: fetch GET /api/public/sector-catalog once per session. 404/error/off ⇒ silent static fallback. */
    sectorCatalogHttp: true,
    /**
     * Champ de scan de code-barres sur les écrans de document (achats, ventes, stock,
     * inventaire). N'affecte PAS le point de vente, dont le scan est inchangé.
     */
    barcodeScanOnDocuments: false,
    /**
     * Impression d'étiquettes code-barres. À basculer CONJOINTEMENT avec
     * `Features:Barcodes:LabelPrintingEnabled` côté API : si le back est off, l'endpoint
     * d'étiquettes répond 404.
     */
    barcodeLabelPrinting: false
  },
  /** First-login product tour + checklist. Mirror of ProductOnboarding:Enabled. */
  productOnboardingEnabled: true
};
