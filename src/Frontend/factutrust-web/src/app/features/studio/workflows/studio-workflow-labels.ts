import type { WorkflowStepType } from './studio-workflows.models';

/**
 * Libellés FR centralisés de la fonctionnalité « Workflows » du Studio (4.4a1). Groupes figés
 * (contrat exposé à la partie B) : `nav`, `hub`, `triggers`, `triggerHints`, `designer`, `steps`,
 * `stepTypes`, `enumValues`, `assignee`, `roles`, `instanceStatus`, `stepRunStatus`, `outcomes`,
 * `approvalStatus`, `instances`, `approvals`, `recordTab`, `soon`.
 */
export const STUDIO_WORKFLOW_LABELS = {
  nav: {
    workflows: 'Workflows',
    approvals: 'Mes approbations'
  },

  hub: {
    title: 'Workflows',
    subtitle: 'Automatisez les traitements de vos tables.',
    newWorkflow: 'Nouveau workflow',
    allTables: 'Toutes les tables',
    search: 'Rechercher un workflow…',
    columns: {
      name: 'Nom',
      table: 'Table',
      trigger: 'Déclencheur',
      steps: 'Étapes',
      active: 'Actif',
      openInstances: 'Instances ouvertes',
      lastRun: 'Dernière exécution',
      actions: 'Actions'
    },
    neverRun: 'Jamais exécuté',
    emptyTitle: 'Aucun workflow pour cette table',
    emptyHint: 'Créez votre premier workflow pour automatiser les traitements de cette table.',
    deleteConfirm: 'Supprimer « {name} » ? {count} instance(s) ouverte(s) seront annulées.',
    deleted: '{count} instance(s) annulée(s).',
    duplicateKey: 'Un workflow porte déjà cette clé pour cette table.',
    duplicated: 'Copie créée (inactive).',
    toggled: 'Workflow {state}.',
    loadError: 'Chargement des workflows impossible.',
    /** 4.4d — compléments du hub (libellés manquants ajoutés selon l'annexe, cités en PR). */
    edit: 'Modifier',
    duplicate: 'Dupliquer',
    delete: 'Supprimer',
    deleteTitle: 'Supprimer le workflow',
    deleteMessage: 'Supprimer « {name} » ? Cette action est irréversible.',
    deleteWithInstances: 'Supprimer « {name} » ? {count} instance(s) ouverte(s) seront annulées.',
    stateActive: 'activé',
    stateInactive: 'désactivé'
  },

  triggers: {
    on_create: 'À la création',
    on_update: 'À la modification',
    field_changed: 'Quand un champ change',
    manual: 'Manuel',
    scheduled: 'Planifié'
  },

  triggerHints: {
    on_create: 'Se déclenche à chaque nouvel enregistrement.',
    on_update: 'Se déclenche à chaque modification.',
    field_changed: 'Se déclenche quand le champ surveillé change (valeurs optionnelles).',
    manual: 'Lancé depuis la fiche par un utilisateur autorisé.',
    scheduled: 'Selon un horaire (UTC), sur les enregistrements filtrés.'
  },

  designer: {
    title: 'Workflow',
    newTitle: 'Nouveau workflow',
    name: 'Nom',
    key: 'Clé',
    table: 'Table',
    trigger: 'Déclencheur',
    watchedField: 'Champ surveillé',
    from: 'Ancienne valeur',
    to: 'Nouvelle valeur',
    cronPreset: 'Fréquence',
    cronPresets: { hourly: 'Toutes les heures', daily: 'Chaque jour à 06:00 UTC', weekly: 'Chaque lundi à 06:00 UTC', custom: 'Personnalisé' },
    cron: 'Expression cron (5 champs)',
    cronHint: 'Format « minute heure jour mois jour-de-semaine » — fuseau UTC.',
    scheduledFilters: 'Enregistrements concernés (filtres optionnels)',
    active: 'Actif',
    inactive: 'Inactif',
    validate: 'Valider',
    save: 'Enregistrer',
    duplicate: 'Dupliquer',
    saved: 'Workflow enregistré.',
    validOk: 'Aucune erreur.',
    validErrors: '{count} erreur(s) à corriger.',
    conflict: 'Ce workflow a été modifié par ailleurs. Rechargez la page.',
    quota: 'Limite de {max} workflows par table atteinte.',
    stepsCount: '{count} / {max}',
    addStep: 'Ajouter une étape',
    properties: 'Propriétés de l\'étape',
    noStep: 'Sélectionnez une étape.',
    unknownKind: 'Propriété non prise en charge par le concepteur, JSON brut.',
    keyHint: 'Minuscule initiale, lettres, chiffres ou « _ » (2 à 64 caractères).',
    keyImmutable: 'La clé est immuable après création.',
    dirty: 'Modifications non enregistrées.',
    reload: 'Recharger',
    tooLarge: 'Le workflow dépasse 64 Ko : réduisez le nombre d\'étapes ou la taille des gabarits.',
    noSteps: 'Ajoutez au moins une étape.',
    unsavedInstances: 'Enregistrez le workflow pour voir ses instances.',
    warnings: '{count} avertissement(s).'
  },

  steps: {
    moveUp: 'Monter',
    moveDown: 'Descendre',
    remove: 'Supprimer',
    key: 'Clé',
    label: 'Libellé',
    keyInvalid: 'Clé invalide : minuscule initiale, puis lettres, chiffres ou « _ » (2 à 64 caractères).',
    keyDuplicate: 'Cette clé est déjà utilisée par une autre étape.',
    conditionPreview: 'Aperçu de la condition',
    gotoTarget: 'Aller à l\'étape',
    addPair: 'Ajouter une affectation'
  },

  /** Repli FR si le catalogue serveur ne fournit pas de `label`. */
  stepTypes: {
    condition: 'Condition',
    update_field: 'Mettre à jour un champ',
    erp_action: 'Action ERP (pont)',
    notify: 'Notifier',
    approval: 'Approbation',
    wait: 'Attendre',
    create_record: 'Créer un enregistrement'
  },

  /** Libellés des valeurs `enum` du catalogue d'étapes (clés = nom de propriété puis valeur). */
  enumValues: {
    match: { all: 'Toutes les conditions', any: 'Au moins une' },
    onFalse: { stop: 'Arrêter le workflow', skip: 'Passer l\'étape', goto: 'Aller à une étape' },
    onFailure: { fail: 'Échouer', continue: 'Continuer' },
    onTimeout: { reject: 'Refuser', approve: 'Approuver', fail: 'Échouer' },
    onReject: { stop: 'Arrêter', goto: 'Aller à une étape', continue: 'Continuer' }
  },

  assignee: {
    role: 'Un rôle',
    user: 'Un utilisateur',
    startedBy: 'La personne qui a lancé',
    pickRole: 'Choisir un rôle',
    pickUser: 'Choisir un utilisateur',
    usersUnavailable: 'Liste des utilisateurs réservée aux administrateurs.',
    userIdHint: 'Identifiant (GUID) de l\'utilisateur — la liste est réservée aux administrateurs.'
  },

  /** 11 rôles tenant (D15) — `FirmManager`/`FirmAccountant` exclus (D-44-13) ; clés = noms exacts de l'enum `UserRole`. */
  roles: {
    Administrator: 'Administrateur',
    Accountant: 'Comptable',
    Client: 'Client',
    SalesRep: 'Commercial',
    SalesManager: 'Responsable commercial',
    Warehouse: 'Magasinier',
    Purchaser: 'Acheteur',
    Cashier: 'Caissier',
    Auditor: 'Auditeur',
    Supervisor: 'Superviseur',
    Developer: 'Développeur'
  },

  /** Réutilise les mots de `planStatus` (studio-ai-labels.ts). */
  instanceStatus: {
    running: 'En cours',
    waiting: 'En attente',
    waiting_approval: 'À valider',
    completed: 'Terminé',
    failed: 'Échec',
    cancelled: 'Annulé'
  },

  stepRunStatus: {
    succeeded: 'Terminée',
    skipped: 'Ignorée',
    failed: 'Échec',
    suspended: 'En attente'
  },

  outcomes: {
    continue: 'Continuer',
    skip: 'Ignorer',
    goto: 'Aller à',
    stop: 'Arrêter',
    suspend: 'Suspendre',
    fail: 'Échec'
  },

  approvalStatus: {
    pending: 'En attente',
    approved: 'Approuvée',
    rejected: 'Refusée',
    cancelled: 'Annulée',
    expired: 'Expirée'
  },

  instances: {
    /** 4.7a2 / D-47-F01 — le panneau devient l'historique paginé (était « Instances récentes »). */
    history: 'Historique',
    empty: 'Aucune instance.',
    detail: 'Détail',
    close: 'Fermer',
    cancel: 'Annuler l\'instance',
    cancelReason: 'Motif (optionnel, 500 caractères max.)',
    cancelTitle: 'Annuler cette instance ?',
    cancelled: 'Instance annulée.',
    cancelConflict: 'Cette instance est déjà terminée.',
    remind: 'Relancer les approbateurs',
    reminded: 'Rappel envoyé.',
    remindConflict: 'Rappel déjà envoyé depuis moins de 24 h',
    startedBy: 'Démarré par',
    startedAt: 'Démarré le',
    dueAt: 'Échéance',
    currentStep: 'Étape courante',
    error: 'Erreur',
    timeline: 'Déroulé',
    duration: '{value}',
    approvals: 'Approbations',
    noApprovals: 'Aucune approbation.',
    context: 'Contexte masqué.',
    summary: '{done} étape(s) terminée(s) · {waiting} en attente · {todo} à venir'
  },

  approvals: {
    title: 'Mes approbations',
    subtitle: 'Approbations qui vous sont assignées ou assignées à votre rôle.',
    kpiPending: 'À traiter',
    kpiLate: 'En retard',
    kpiSoon: 'Sous 24 h',
    tabPending: 'À traiter',
    // 4.7 « v1.1 » (D-47-60/61) — onglets de la page ; « Déléguées » désactivé (pas de concept de
    // délégation dans le domaine — convention « Bientôt », aucune donnée inventée).
    tabDelegated: 'Déléguées',
    tabHistory: 'Historique',
    delegatedSoon: 'Bientôt',
    colDecidedAt: 'Décidée le',
    colDecision: 'Décision',
    colComment: 'Commentaire',
    decisionApproved: 'Approuvée',
    decisionRejected: 'Refusée',
    historyEmpty: 'Aucune décision passée',
    historyEmptyHint: 'Vos décisions d\'approbation apparaîtront ici (conservées 180 jours).',
    historyLoadError: 'Impossible de charger l\'historique.',
    columns: {
      workflow: 'Workflow',
      record: 'Enregistrement',
      requestedBy: 'Demandé par',
      requestedAt: 'Demandé le',
      dueAt: 'Échéance',
      actions: 'Actions'
    },
    approve: 'Approuver',
    reject: 'Refuser',
    detail: 'Détail',
    comment: 'Commentaire',
    commentRequired: 'Le commentaire est obligatoire pour refuser.',
    approved: 'Approbation enregistrée.',
    rejected: 'Refus enregistré.',
    alreadyDecided: 'Cette approbation a déjà été traitée.',
    notAssigned: 'Cette approbation ne vous est plus assignée.',
    empty: 'Aucune approbation en attente',
    emptyHint: 'Vous êtes à jour.',
    noDue: 'Aucune échéance',
    late: 'En retard de {value}',
    due: 'Dans {value}',
    openRecord: 'Ouvrir la fiche',
    readOnly: 'Lecture seule : votre rôle ne permet pas de décider.',
    // 4.4g2 (H-3, ajout additif) — les clés déjà définies en 4.4a1 (`subtitle`, `commentRequired`,
    // `approved`, `rejected`, `alreadyDecided`, `notAssigned`, `emptyHint`, `readOnly`…) gardent
    // leur libellé d'origine ; la page n'utilise que les clés plates ci-dessous pour les colonnes.
    refresh: 'Actualiser',
    colWorkflow: 'Workflow / étape',
    colRecord: 'Enregistrement',
    colStartedAt: 'Lancé le',
    colRequestedBy: 'Demandé par',
    colRequestedAt: 'Demandé le',
    colDue: 'Échéance',
    colActions: 'Actions',
    approveTitle: 'Approuver la demande',
    rejectTitle: 'Refuser la demande',
    commentOptional: 'Commentaire (facultatif)',
    commentMissing: 'Indiquez le motif du refus.',
    cancel: 'Annuler',
    decisionError: 'La décision n\'a pas pu être enregistrée.',
    loadError: 'Impossible de charger vos approbations.',
    retry: 'Réessayer',
    // 4.4h1 (ajout additif, panneau de détail) — `detail` existait déjà (4.4a1) ; `due` N'EST
    // PAS repris : il vaut déjà 'Dans {value}' (gabarit d'échéance) et le panneau utilise
    // `colDue` (« Échéance ») pour l'étiquette du dt.
    close: 'Fermer',
    record: 'Enregistrement',
    startedAt: 'Lancé le',
    requestedBy: 'Demandé par',
    requestedAt: 'Demandé le',
    requestComment: 'Message du demandeur',
    openInstance: 'Voir l\'instance'
  },

  /** 4.7c2 — dialogue « Tester sur un enregistrement » (simulation pure, 4.7c1). */
  test: {
    button: 'Tester sur un enregistrement',
    saveFirst: 'Enregistrez d\u2019abord pour tester.',
    dialogTitle: 'Tester le workflow',
    banner: 'Simulation — aucune donnée n\u2019a été écrite.',
    searchPlaceholder: 'Rechercher un enregistrement…',
    searching: 'Recherche…',
    noRecords: 'Aucun enregistrement.',
    run: 'Lancer le test',
    error: 'La simulation a échoué.',
    rendered: 'Valeurs rendues',
    evaluatedSuffix: 'étape(s) réellement évaluée(s)',
    suspendedSuffix: 'le workflow s\u2019arrêterait en attente',
    verdicts: {
      wouldRun: 'Exécutée',
      skipped: 'Sautée',
      wouldSuspend: 'En attente',
      wouldFail: 'En échec'
    }
  },

  recordTab: {
    label: 'Workflows',
    launch: 'Lancer un workflow',
    launchPick: 'Choisir un workflow',
    run: 'Lancer',
    started: 'Workflow lancé.',
    quota: 'Limite de 200 instances atteinte pour cet enregistrement.',
    empty: 'Aucun workflow exécuté sur cet enregistrement.',
    // 4.4h2 (H-3, ajout additif) — les clés déjà définies en 4.4a1 (`label`, `launch`, `run`
    // = « Lancer », `started`, `empty` = « Aucun workflow exécuté sur cet enregistrement. »…)
    // gardent leur libellé d'origine ; l'onglet n'utilise que les clés plates ci-dessous
    // (même motif que les `colXxx` de `approvals` en 4.4g2).
    tabLabel: 'Workflows',
    title: 'Workflows',
    hint: 'Instances de workflow liées à cet enregistrement.',
    runTitle: 'Lancer un workflow',
    runPlaceholder: 'Choisir un workflow',
    runEmpty: 'Aucun workflow actif à lancement manuel pour cette table.',
    alreadyRunning: 'Une instance de ce workflow est déjà en cours pour cet enregistrement.',
    runError: 'Le workflow n\'a pas pu être lancé.',
    cancel: 'Annuler',
    cancelled: 'Instance annulée.',
    remind: 'Relancer les approbateurs',
    reminded: 'Rappel envoyé.',
    actionError: 'L\'action n\'a pas pu être effectuée.',
    /** 4.6d2 (D-44-96) — confirmation d'annulation inline, même motif et libellés que le tiroir (D-44-26). */
    cancelConfirmTitle: 'Annuler cette instance ?',
    cancelReason: 'Motif (optionnel, 500 caractères max.)',
    cancelConfirm: 'Confirmer l\'annulation',
    cancelBack: 'Retour',
    colActions: 'Actions',
    detail: 'Détail',
    close: 'Fermer',
    colWorkflow: 'Workflow',
    colStatus: 'Statut',
    colStep: 'Étape',
    colStarted: 'Démarré le',
    /** 4.6c1 (D-46-F03) — nom du lanceur servi par `WorkflowInstanceDto.startedByName` (4.6b1) ; « — » si inconnu. */
    colRequestedBy: 'Demandé par',
    colDue: 'Échéance'
  },

  soon: 'Bientôt'
} as const;

export type StudioWorkflowLabels = typeof STUDIO_WORKFLOW_LABELS;

/** Remplace les `{jetons}` d'un libellé — alias ré-exporté de `formatLabel` (shared/studio-text.util.ts, 4.5h — D-44-08 clos). */
export { formatLabel as formatWorkflowLabel } from '../shared/studio-text.util';

/** Libellé d'un type d'étape : `label` du catalogue s'il est fourni, sinon repli FR local, sinon la clé brute. */
export function stepTypeLabel(type: WorkflowStepType, catalogLabel?: string | null): string {
  return catalogLabel?.trim() || STUDIO_WORKFLOW_LABELS.stepTypes[type] || type;
}

/** Icônes Font Awesome par type d'étape (vocabulaire partagé avec les maquettes — D-44-09). */
export const STEP_TYPE_ICONS: Readonly<Record<WorkflowStepType, string>> = { condition: 'fa-solid fa-code-branch', update_field: 'fa-solid fa-pen-to-square', erp_action: 'fa-solid fa-bolt', notify: 'fa-solid fa-bell', approval: 'fa-solid fa-user-check', wait: 'fa-solid fa-hourglass-half', create_record: 'fa-solid fa-file-circle-plus' };
