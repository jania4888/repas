import { StudioAiIntent, StudioAiPlanStatus, StudioAiPreviewTab, StudioSpecFieldType } from './studio-ai.models';

/** Une carte d'intention « Que voulez-vous créer ? ». */
export interface StudioAiIntentCardDef {
  intent: StudioAiIntent;
  title: string;
  description: string;
  icon: string;
  /** Texte placé dans le composer au clic (l'utilisateur complète les « … »). */
  prompt: string;
  /** `false` ⇒ carte visible mais désactivée avec badge « Bientôt » (phase ultérieure). */
  available: boolean;
  /** Tooltip affiché quand la carte est désactivée. */
  soonTooltip?: string;
}

export interface StudioAiTabDef {
  id: StudioAiPreviewTab;
  label: string;
  icon: string;
  /** `false` ⇒ onglet rendu désactivé avec badge « Bientôt ». */
  available: boolean;
  soonTooltip?: string;
}

/** Libellés français centralisés de l'atelier Studio IA (P1). */
export const STUDIO_AI_LABELS = {
  page: {
    title: 'Studio IA',
    subtitle: 'Décrivez votre besoin métier : l’IA propose une structure complète, vous la vérifiez, l’ajustez et l’intégrez dans l’ERP.',
    heroTitle: 'Décrivez le système que vous souhaitez créer',
    heroHint: 'Exemple : « Créer un système de gestion des congés avec employés, types de congés, demandes, validations et rapports. »',
    composerPlaceholder: 'Décrivez le système, la table ou le rapport à créer…',
    generate: 'Générer avec l’IA',
    generating: 'Génération en cours…',
    editRequest: 'Modifier la demande',
    regenerate: 'Régénérer',
    newGeneration: 'Nouvelle génération',
    yourRequest: 'VOTRE DEMANDE',
    fromTemplate: 'MODÈLE',
    creating: 'Création en cours…',
    createdOn: 'Créé le',
    advancedModel: 'Modèle avancé',
    advancedModelHint: 'Utilise le modèle avancé configuré par l’administrateur pour cette génération.',
    attach: 'Joindre un document',
    micStart: 'Dicter la demande',
    micStop: 'Arrêter la dictée',
    micUnsupported: 'La dictée n’est pas disponible dans ce navigateur.',
    showCards: 'Afficher les cartes',
    hideCards: 'Masquer les cartes',
    whatToCreate: 'Que voulez-vous créer ?',
    seeDocumentation: 'Voir la documentation',
    resetConversation: 'Réinitialiser la conversation',
    resetConversationHint: 'Annule le plan en attente et repart d’une conversation vide.',
    newRequest: 'Nouvelle demande',
    badge: 'Créer sans coder',
    docLink: '/documentation/studio-ia',
    advancedModelOn: 'Modèle avancé activé',
    advancedModelOff: 'Modèle standard',
    micSoon: 'La dictée arrive dans une prochaine version.',
    // A19 : un message envoyé alors qu'une proposition attend la validation
    pendingPlanTitle: 'Une proposition est en attente',
    pendingPlanMessage: 'Envoyer un nouveau message abandonne la proposition en cours (rien n’est créé). Continuer ?',
    pendingPlanAccept: 'Abandonner le plan et envoyer',
    pendingPlanReject: 'Garder la proposition',
    templateLoading: 'Préparation du modèle…',
    templateFailed: 'Impossible de préparer ce modèle.'
  },

  /** Repli du modèle avancé (D3) : le serveur décide, le client informe. */
  model: {
    fallbackTitle: 'Modèle standard utilisé',
    fallbackReason: {
      disabled: 'le modèle avancé est désactivé par l’administrateur.',
      not_configured: 'le modèle avancé n’est pas configuré.',
      unavailable: 'le modèle avancé est indisponible pour le moment.'
    } as Record<string, string>,
    fallbackGeneric: 'le modèle avancé n’a pas pu être utilisé.',
    usedAdvanced: 'Généré avec le modèle avancé'
  },

  /** Bandeau doublons (PR 1.3 côté serveur, R21 côté atelier). */
  duplicates: {
    title: 'La table « {specDisplayName} » existe déjà',
    item: 'Une table existante « {existingDisplayName} » (clé {existingKey}) semble équivalente.',
    question: 'Voulez-vous la réutiliser ou créer une nouvelle table « {suggestedName} » ?',
    reuse: 'Réutiliser la table existante',
    createAnyway: 'Créer quand même',
    reuseHint: 'Le plan réutilisera cette table sans la modifier.',
    reused: 'Table existante « {existingDisplayName} » réutilisée.',
    renamed: 'Nouvelle table renommée « {displayName} ».',
    reasons: {
      same_key: 'même clé',
      same_name: 'même nom',
      singular_plural: 'singulier / pluriel'
    } as Record<string, string>,
    suffix: '(2)'
  },

  intents: [
    {
      intent: 'system',
      title: 'Système complet',
      description: 'Tables, relations, formulaires, données de référence et rapports en une fois.',
      icon: 'fa-solid fa-layer-group',
      prompt: 'Créer un système de gestion de … avec les tables, relations, formulaires, données de référence et rapports nécessaires.',
      available: true
    },
    {
      intent: 'table',
      title: 'Table',
      description: 'Une table personnalisée avec ses champs et son formulaire.',
      icon: 'fa-solid fa-table',
      prompt: 'Créer une table « … » avec les champs : ….',
      available: true
    },
    {
      intent: 'relations',
      title: 'Relations',
      description: 'Relier des tables entre elles ou aux données de l’ERP.',
      icon: 'fa-solid fa-diagram-project',
      prompt: 'Relier la table « … » à la table « … » (une … a plusieurs …).',
      available: true
    },
    {
      intent: 'form',
      title: 'Formulaire',
      description: 'Une mise en page de saisie pour une table existante.',
      icon: 'fa-solid fa-file-lines',
      prompt: 'Générer un formulaire de saisie pour la table « … » organisé en sections : ….',
      available: true
    },
    {
      intent: 'reference_data',
      title: 'Données de référence',
      description: 'Listes de valeurs et données initiales.',
      icon: 'fa-solid fa-database',
      prompt: 'Charger les valeurs initiales de la table « … » : ….',
      available: true
    },
    {
      intent: 'report',
      title: 'Rapport',
      description: 'Un état regroupé, filtré et trié.',
      icon: 'fa-solid fa-chart-column',
      prompt: 'Créer un rapport « … » regroupé par … avec le total de ….',
      available: true
    },
    {
      intent: 'workflow',
      title: 'Workflow',
      description: 'États, transitions et automatisations.',
      icon: 'fa-solid fa-sitemap',
      prompt: '',
      available: false,
      soonTooltip: 'Disponible dans une prochaine version (workflow de statut).'
    },
    {
      intent: 'page',
      title: 'Page / Interface',
      description: 'Tableaux de bord et pages personnalisées.',
      icon: 'fa-solid fa-display',
      prompt: '',
      available: false,
      soonTooltip: 'Disponible dans une prochaine version (pages et tableaux de bord).'
    }
  ] as readonly StudioAiIntentCardDef[],

  /** Prompt de la carte Workflow quand le serveur l'active (`workflowToolsEnabled`). */
  workflowPrompt: 'Ajouter un workflow de statut à la table … : états, transitions autorisées et règles de validation.',

  intentTitles: {
    system: 'Système complet',
    table: 'Table',
    relations: 'Relations',
    form: 'Formulaire',
    reference_data: 'Données de référence',
    report: 'Rapport',
    workflow: 'Workflow',
    page: 'Page / Interface'
  } satisfies Record<StudioAiIntent, string>,

  tabs: [
    { id: 'overview', label: 'Vue d’ensemble', icon: 'fa-solid fa-sitemap', available: true },
    { id: 'tables', label: 'Tables', icon: 'fa-solid fa-table', available: true },
    { id: 'relations', label: 'Relations', icon: 'fa-solid fa-diagram-project', available: true },
    { id: 'forms', label: 'Formulaires', icon: 'fa-solid fa-file-lines', available: true },
    { id: 'seed', label: 'Données de référence', icon: 'fa-solid fa-database', available: true },
    { id: 'reports', label: 'Rapports', icon: 'fa-solid fa-chart-column', available: true },
    {
      id: 'workflow',
      label: 'Workflow',
      icon: 'fa-solid fa-route',
      available: false,
      soonTooltip: 'Disponible dans une prochaine version (workflow de statut).'
    },
    {
      id: 'pages',
      label: 'Pages',
      icon: 'fa-solid fa-display',
      available: false,
      soonTooltip: 'Disponible dans une prochaine version (pages et tableaux de bord).'
    },
    { id: 'menu', label: 'Menu', icon: 'fa-solid fa-bars', available: true }
  ] as readonly StudioAiTabDef[],

  soon: 'Bientôt',
  soonTeam: 'Disponible avec la bibliothèque d’équipe.',
  disabledByAdmin: 'Fonction désactivée par l’administrateur.',

  /** Résumés de modifications (`summarizeChanges`, FR). */
  changes: {
    fieldsAdded: '{count} champ(s) ajouté(s) à {entity}',
    fieldsRemoved: '{count} champ(s) supprimé(s) de {entity}',
    fieldsChanged: '{count} champ(s) modifié(s) dans {entity}',
    entityAdded: 'Table « {entity} » ajoutée',
    entityRemoved: 'Table « {entity} » supprimée',
    entityRenamed: 'Table « {before} » renommée « {after} »',
    entityReused: 'Table « {entity} » : réutilise la table existante {existingKey}',
    entityChanged: 'Table « {entity} » modifiée',
    systemChanged: 'Paramètres du système modifiés',
    seedChanged: 'Données de référence de « {entity} » modifiées',
    formChanged: 'Formulaire de « {entity} » modifié',
    reportChanged: 'Rapport de « {entity} » modifié'
  },

  /** Zone de saisie : pièces jointes et raccourcis clavier. */
  composer: {
    attachments: 'Pièces jointes',
    extracting: 'Extraction de {name}…',
    extractError: 'Impossible d’extraire le document. Formats acceptés : .txt, .csv, .pdf, .png, .jpg, .jpeg, .webp, .docx, .xlsx (max 10 Mo).',
    maxAttachments: 'Vous ne pouvez joindre que {max} pièces jointes par demande.',
    enterHint: 'Entrée pour envoyer · Maj+Entrée pour un retour à la ligne.',
    empty: 'Décrivez votre besoin avant d’envoyer.'
  },

  preview: {
    title: 'Aperçu de la solution générée',
    emptyTitle: 'Aucune proposition pour le moment',
    emptyHint: 'Décrivez votre besoin ci-dessus pour voir la proposition ici. Rien n’est créé avant votre validation.',
    generatedAt: 'Proposition générée à',
    nothingCreated: 'Rien n’est encore créé — vérifiez puis validez.',
    editingSubtitle: 'Mode personnalisation · vos modifications restent dans la proposition jusqu’à l’intégration.',
    executingSubtitle: 'Intégration en cours',
    completedSubtitle: 'Création terminée le',
    completedHint: 'Aucune donnée n’a été supprimée.',
    test: 'Tester',
    customize: 'Personnaliser',
    integrate: 'Intégrer dans l’ERP',
    integrateDisabledDirty: 'Enregistrez ou réinitialisez vos modifications avant d’intégrer.',
    integrateDisabledErrors: 'Corrigez les erreurs signalées avant d’intégrer.',
    cancelPlan: 'Refuser la proposition',
    cancelled: 'Plan annulé. Rien n’a été créé.',
    summary: 'Résumé',
    tables: 'tables',
    fields: 'champs',
    relations: 'relations',
    forms: 'formulaires',
    seedRecords: 'données de référence',
    reports: 'rapports',
    limitsHint: '8 tables max · 40 champs par table · 200 valeurs de référence par table',
    warningsTitle: 'points à vérifier',
    noWarnings: 'Aucun point à vérifier.',
    structure: 'Structure du système',
    diagram: 'Diagramme des relations',
    diagramSoon: 'Le diagramme interactif arrive dans la prochaine livraison ; les relations sont listées dans l’onglet Relations.',
    stepsTitle: 'Étapes prévues',
    unsaved: 'Modifications non enregistrées',
    changes: 'changements',
    reset: 'Réinitialiser',
    regenerateWithChanges: 'Régénérer avec ces modifications',
    save: 'Enregistrer les modifications',
    validating: 'Vérification…',
    reloadPreview: 'Recharger l’aperçu',
    expiresIn: 'Cette proposition expire dans',
    expired: 'Ce plan a expiré. Redemandez la génération à l’assistant.',
    readOnlyHint: 'L’édition détaillée (Personnaliser) arrive dans la prochaine livraison.',
    referenceDataOf: 'Valeurs initiales de',
    noSeed: 'Aucune donnée de référence proposée.',
    noForms: 'Aucun formulaire spécifique : chaque table utilisera une mise en page par défaut.',
    noReports: 'Aucun rapport proposé.',
    noRelations: 'Aucune relation entre les tables.',
    erpRelations: 'Relations vers des données existantes de l’ERP',
    existingData: 'Donnée existante',
    cardinality: 'Plusieurs {source} → un {target}',
    menuHint: 'Le menu latéral Studio utilisera ce nom et cette icône.',
    onboarding: 'Pour démarrer',

    // — Aperçu en lecture seule (P1a) : en-tête, colonnes de tableaux, mentions « bientôt ». —
    cancel: 'Annuler',
    createNow: 'Créer maintenant',
    edit: 'Modifier',
    loadingSpec: 'Chargement de la proposition…',
    noEntities: 'Aucune table dans cette proposition.',
    limitsTemplate: '{maxEntities} tables max · {maxFields} champs par table · {maxSeedRecords} valeurs de référence par table',
    colLabel: 'Libellé',
    colKey: 'Clé',
    colType: 'Type',
    colRequired: 'Requis',
    colUnique: 'Unique',
    colDetails: 'Détails',
    colSource: 'Table source',
    colField: 'Champ',
    colTarget: 'Cible',
    erpBadge: 'ERP',
    defaultForm: 'Formulaire par défaut : tous les champs',
    seedValues: 'valeurs',
    seedTruncated: '10 premières valeurs affichées sur {count}.',
    groupedBy: 'Regroupé par',
    measures: 'Mesures',
    columns: 'Colonnes',
    filters: 'Filtres',
    sort: 'Tri',
    menuTitle: 'Aperçu du menu latéral'
  },

  confirm: {
    title: 'Intégrer « {name} » dans l’ERP',
    intro: 'Les éléments suivants vont être créés dans votre espace :',
    irreversible: 'La création est définitive ; rien n’est supprimé ; les champs pourront être désactivés ensuite.',
    checkbox: 'J’ai vérifié la structure proposée',
    pendingWarnings: 'Points à vérifier en attente',
    cancel: 'Annuler',
    ok: 'Intégrer'
  },

  progress: {
    title: 'Construction en cours',
    step: 'Étape en cours :',
    dontClose: 'Ne fermez pas cette page.',
    of: 'sur',
    stepCount: 'Étape {current} sur {total}',
    stepsPending: 'En attente…',
    stepRunning: 'En cours…',
    stepSkipped: 'Ignoré'
  },

  result: {
    systemCreated: 'Système « {name} » créé',
    tableCreated: 'Table « {name} » créée',
    stepsDone: 'étapes terminées',
    open: 'Ouvrir',
    newRequest: 'Nouvelle demande',
    openSystem: 'Ouvrir le système',
    openTable: 'Ouvrir la table',
    newRecord: 'Saisir une fiche',
    viewReports: 'Voir les rapports',
    vigilance: 'Points de vigilance',
    saveAsTemplate: 'Enregistrer comme modèle',
    exportZip: 'Exporter (ZIP)',
    duplicate: 'Dupliquer',
    share: 'Partager',
    failedTitle: 'La création a échoué',
    failedHint: 'Rien n’a été conservé. Reformulez votre demande ou réessayez plus tard.'
  },

  conversation: {
    title: 'Conversation avec l’assistant',
    show: 'Afficher la conversation',
    hide: 'Masquer la conversation',
    preparing: 'Préparation en cours…',
    retry: 'Réessayer',
    saveReport: 'Enregistrer comme état',
    saveReportPrompt: 'Enregistre cet état : {title}',
    suggestions: 'Suggestions',
    you: 'Vous',
    assistant: 'Assistant'
  },

  rail: {
    templates: 'Modèles de systèmes',
    seeAll: 'Voir tous',
    use: 'Utiliser',
    replaceCurrent: 'Remplacer la proposition en cours ?',
    quickActions: 'Actions rapides',
    importTemplate: 'Importer un modèle existant',
    duplicateSystem: 'Dupliquer un système',
    exportSystem: 'Exporter le système (JSON)',
    importTemplateJson: 'Importer un modèle (JSON)',
    shareTeam: 'Partager avec l’équipe',
    resetConversation: 'Réinitialiser la conversation',
    resetConfirm: 'Les propositions en attente seront annulées (rien n’est supprimé). Continuer ?',
    resetDone: '{count} plan(s) en attente annulé(s).',
    history: 'Historique des générations',
    historyEmpty: 'Aucune génération pour le moment.',
    seeAllHistory: 'Voir tout',
    promoTitle: 'Une idée ? Laissez l’IA la réaliser !',
    promoText: 'Décrivez un besoin métier en une phrase : l’assistant propose tables, formulaires et rapports.',
    promoCta: 'Découvrir les possibilités',
    promoPrompt: 'Créer un système de gestion de … avec les tables, relations, formulaires, données de référence et rapports nécessaires.',
    resetTitle: 'Réinitialiser la conversation ?',
    resetNoPlan: 'Conversation réinitialisée.',
    templatesEmpty: 'Aucun modèle disponible.',
    templatesLoadFailed: 'Bibliothèque de modèles indisponible.',
    historyLoadFailed: 'Historique indisponible.',
    openPlan: 'Reprendre',
    justNow: 'à l’instant',
    minutesAgo: 'il y a {count} min',
    hoursAgo: 'il y a {count} h',
    daysAgo: 'il y a {count} j',
    panelLabel: 'Panneau latéral',
    comingSoon: 'Cette action arrive dans une prochaine version.'
  },

  /** Page « Mes projets » (`/studio/ai/projects`). */
  history: {
    title: 'Mes projets',
    subtitle: 'Toutes les générations Studio IA de votre espace : propositions à valider, systèmes créés, échecs.',
    columns: {
      title: 'Titre',
      kind: 'Genre',
      status: 'Statut',
      createdAt: 'Créé',
      expiresAt: 'Expire',
      system: 'Système',
      actions: 'Actions'
    },
    filters: {
      status: 'Statut',
      kind: 'Genre',
      allStatuses: 'Tous les statuts',
      allKinds: 'Tous les genres'
    },
    resume: 'Reprendre',
    openSystem: 'Ouvrir le système',
    empty: 'Aucun projet pour le moment. Décrivez un besoin dans l’atelier pour démarrer.',
    loadFailed: 'Impossible de charger vos projets.',
    backToStudio: 'Retour à l’atelier',
    count: '{count} projet(s)'
  },

  /** Page « Bibliothèque de modèles » (`/studio/ai/templates`). */
  templates: {
    title: 'Bibliothèque de modèles',
    subtitle: 'Des systèmes prêts à l’emploi à adapter à votre activité : l’atelier prépare une proposition que vous validez.',
    use: 'Utiliser ce modèle',
    empty: 'Aucun modèle disponible pour le moment.',
    loadFailed: 'Impossible de charger la bibliothèque de modèles.',
    disabled: 'La bibliothèque de modèles est désactivée par l’administrateur.',
    entities: '{count} table(s)',
    uncategorized: 'Autres',
    sourceBuiltin: 'Intégré',
    sourceTenant: 'Votre espace',
    backToStudio: 'Retour à l’atelier',
    opened: 'Proposition préparée depuis un modèle du catalogue : vérifiez-la puis validez.'
  },

  planStatus: {
    Pending: 'À valider',
    Executing: 'En cours',
    Completed: 'Terminé',
    Failed: 'Échec',
    Cancelled: 'Annulé',
    Expired: 'Expiré'
  } satisfies Record<StudioAiPlanStatus, string>,

  planKind: {
    CreateApp: 'Table',
    CreateSystem: 'Système',
    Amendment: 'Modification',
    View: 'Fenêtre',
    Report: 'État',
    RecordView: 'Vue',
    Workflow: 'Workflow'
  } as Record<string, string>,

  fieldTypes: {
    text: 'Texte',
    multilinetext: 'Texte long',
    number: 'Nombre entier',
    decimal: 'Nombre décimal',
    boolean: 'Oui / Non',
    date: 'Date',
    datetime: 'Date et heure',
    select: 'Liste (choix unique)',
    multiselect: 'Liste (choix multiple)',
    money: 'Monétaire',
    percentage: 'Pourcentage',
    rating: 'Note (étoiles)',
    qrcode: 'QR code',
    barcode: 'Code-barres',
    autonumber: 'Numéro automatique',
    attachment: 'Pièce jointe',
    signature: 'Signature',
    relation: 'Relation'
  } satisfies Record<StudioSpecFieldType, string>,

  errors: {
    invalid: 'Demande invalide.',
    invalidSpec: 'La structure proposée est invalide. Corrigez-la puis réessayez.',
    generationFailed: 'Échec de la génération.',
    executionFailed: 'Échec de l’exécution du plan.',
    unauthorized: 'Session expirée. Reconnectez-vous.',
    forbidden: 'Vous n’avez pas la permission de concevoir des tables Studio.',
    planNotFound: 'Ce plan est introuvable ou a expiré.',
    planNotPending: 'Ce plan n’est plus en attente : il a déjà été exécuté, annulé ou a expiré.',
    workbenchDisabled: 'Le workbench Studio IA n’est pas activé.',
    conflict: 'Ce plan a été modifié entre-temps. Rechargez l’aperçu.',
    tooLarge: 'Fichier trop volumineux.',
    rateLimited: 'Trop de demandes. Patientez quelques secondes.',
    network: 'Connexion impossible. Vérifiez votre réseau puis réessayez.',
    generic: 'Une erreur est survenue.'
  },

  /** Messages d'état du flux (barre de statut / bulles système de la conversation). */
  status: {
    analyzing: 'Analyse de votre demande…',
    preparing: 'Préparation en cours…',
    awaitingValidation: 'En attente de votre validation…',
    creating: 'Création en cours…',
    created: 'Création terminée.',
    planCancelled: 'Plan annulé. Rien n’a été créé.',
    draftSaved: 'Modifications enregistrées dans le plan.'
  },

  capabilities: {
    previewDisabled: 'L’aperçu avant création est désactivé par l’administrateur : les demandes sont exécutées directement.',
    workbenchRequired: 'Cette fonction nécessite le workbench Studio IA (désactivé sur cet environnement).'
  }
} as const;

export type StudioAiLabels = typeof STUDIO_AI_LABELS;

/** Remplace les `{jetons}` d'un libellé. */
export function formatLabel(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (values[k] !== undefined ? String(values[k]) : `{${k}}`));
}
