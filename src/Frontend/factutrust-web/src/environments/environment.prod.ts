export const environment = {
  production: true,
  apiUrl: '/api',
  globalSearchEnabled: true,
  appName: 'InstaFact',
  version: '1.0.0',
  aiAssistantProgressTimelineEnabled: true,
  aiAssistantWarmUpEnabled: true,
  aiAssistantSmartJsonFallbackEnabled: true,
  aiAssistantContentResyncEnabled: true,
  storefrontEnabled: true,
  storefrontGltfFacades: true,
  storefrontGltfFacadesVersion: '6',
  storefrontGltfDraco: false,
  storefrontGltfMeshopt: false,
  storefrontGltfDebugLog: false,
  storefrontPbrEnvironment: true,
  storefrontPropsEnabled: true,
  storefrontPbrTexturesEnabled: true,
  storefrontStreetLampsEnabled: true,
  storefrontPostFxEnabled: false,
  storefrontMicroAnimationsEnabled: true,
  storefrontCinematicIntro: true,
  storefrontProceduralRichEnabled: true,
  storefrontDynamicFramingEnabled: true,
  accountingFirmsEnabled: true,
  firmHelpUrl: 'https://instafact.tn/aide',
  /** Canal WhatsApp (liaison assistant IA + rappels fiscaux). OFF tant que la passerelle n'est pas déployée. */
  channelsEnabled: false,
  featureFlags: {
    wizardSimplifiedFlow: true,
    pdfPreview: false,
    exchangeBootstrapV2: true,
    invoiceProductSearchV2: true,
    /** Trésorerie prévisionnelle par IA. OFF tant que la migration tenant n'est pas appliquée. */
    treasuryCashForecast: false,
    registrationWizardV2: true,
    sectorCatalogHttp: true,
    /** Scan de code-barres sur les documents. OFF tant que la rampe de déploiement n'est pas engagée. */
    barcodeScanOnDocuments: false,
    /** Impression d'étiquettes. OFF tant que Features:Barcodes:LabelPrintingEnabled l'est côté API. */
    barcodeLabelPrinting: false
  },
  productOnboardingEnabled: true,
  /** Staging/production : inscription self-service désactivée (création via backoffice). */
  publicRegistration: {
    companyEnabled: false,
    firmEnabled: false
  },
  /** Base absolue (sans slash final) des `canonical` / `hreflang` / `og:url` / sitemap de la landing. */
  publicSiteOrigin: 'https://instafact.shop',
  /** Landing publique (`features/home`). */
  erp: {
    /** Interface arabe + RTL (espace société). Repli prod : repasser à false. */
    arabicEnabled: true
  },
  landing: {
    /** OFF tant que le texte arabe n'a pas été validé par le client (plan § 8.4). */
    arabicEnabled: false,
    registrationStatusTimeoutMs: 2500
  },
  /** Formulaire public de demande d'accès / de démo. Le backend répond 503 tant que `Features:PublicContact:Enabled` est faux. */
  publicContact: {
    enabled: true
  },
  /** Clé de site Cloudflare Turnstile (publique, optionnelle). Vide = widget jamais chargé. */
  turnstileSiteKey: ''
};
