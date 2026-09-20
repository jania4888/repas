import { Page, Route } from '@playwright/test';
import { StudioMockContext } from './studio-mock.helpers';

/**
 * Mocks Playwright des workflows Studio (4.4l1) : hub `/studio/workflows`, concepteur,
 * drawer d'instance, page « Mes approbations », onglet « Workflows » de la fiche et badge
 * de navigation. À installer APRÈS `installStudioApiMocks` + `installStudioRuntimeMocks`
 * (Playwright évalue la route la plus récente d'abord : les motifs ci-dessous priment).
 * Aucun backend requis ; chaque appel est poussé dans `ctx.calls` pour les assertions.
 *
 * Écart d'annexe (D-44-l1-1) : `WF_ENTITY_ID` vaut 'e-int' — l'annexe indiquait
 * 'ent-interventions' « renvoyé par installStudioApiMocks », mais les tables sont servies
 * par `installStudioRuntimeMocks` (`RUNTIME_ENTITIES`, id 'e-int'). La constante est
 * utilisée partout (routes + URLs des specs), le comportement est identique.
 */

/** Id de la table `interventions` tel que mocké par `installStudioRuntimeMocks`. */
export const WF_ENTITY_ID = 'e-int';

// ---------------------------------------------------------------------------------------------
// Fixtures (miroir des DTO 4.4a1 : `studio-workflows.models.ts`). Objets littéraux — les
// specs e2e n'importent pas le code applicatif (alias @core/@shared non résolus par Playwright).
// ---------------------------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const NOW = Date.now();
const iso = (deltaMs: number): string => new Date(NOW + deltaMs).toISOString();

/** Catalogue des 7 types d'étapes (miroir `StudioWorkflowStepTypes.cs`, enveloppe D8 `{ entries }`). */
export const WF_STEP_CATALOG = {
  entries: [
    {
      type: 'condition',
      label: 'Condition',
      description: 'Ne poursuit le workflow que si les filtres sont remplis ; sinon arrête, ignore ou saute.',
      properties: [
        { name: 'filters', kind: 'filters', required: true, help: '1 à 10 filtres { field, op, value, value2? }.', allowedValues: null, min: 1, max: 10 },
        { name: 'match', kind: 'enum', required: false, help: '« all » (défaut) : tous les filtres ; « any » : au moins un.', allowedValues: ['all', 'any'], min: null, max: null },
        { name: 'onFalse', kind: 'enum', required: false, help: 'Quand la condition est fausse : « stop » (défaut), « skip » ou « goto ».', allowedValues: ['stop', 'skip', 'goto'], min: null, max: null },
        { name: 'gotoKey', kind: 'string', required: false, help: 'Clé d\'une étape postérieure (requis quand onFalse = « goto »).', allowedValues: null, min: null, max: null }
      ]
    },
    {
      type: 'update_field',
      label: 'Mettre à jour un champ',
      description: 'Écrit une ou plusieurs valeurs dans l\'enregistrement courant (gabarits {{…}} autorisés).',
      properties: [
        { name: 'set', kind: 'fieldMap', required: true, help: '1 à 10 paires champ → valeur.', allowedValues: null, min: 1, max: 10 }
      ]
    },
    {
      type: 'erp_action',
      label: 'Action ERP (pont)',
      description: 'Déclenche une action métier du catalogue Pont (créer une facture, une dépense…).',
      properties: [
        { name: 'action', kind: 'string', required: true, help: 'Clé d\'une action du catalogue Pont.', allowedValues: null, min: null, max: null },
        { name: 'mapping', kind: 'mapping', required: false, help: '0 à 20 entrées { param, source, value }.', allowedValues: null, min: 0, max: 20 },
        { name: 'onFailure', kind: 'enum', required: false, help: '« fail » (défaut) ou « continue ».', allowedValues: ['fail', 'continue'], min: null, max: null },
        { name: 'saveResultAs', kind: 'string', required: false, help: 'Mémorise le résultat sous ce nom (_results.<nom>).', allowedValues: null, min: null, max: null }
      ]
    },
    {
      type: 'notify',
      label: 'Notifier',
      description: 'Envoie une notification à un utilisateur, un rôle ou le lanceur du workflow.',
      properties: [
        { name: 'to', kind: 'recipient', required: true, help: '{ kind ∈ user|role|startedBy, value }.', allowedValues: null, min: null, max: null },
        { name: 'title', kind: 'template', required: true, help: 'Titre de la notification (≤ 200 caractères).', allowedValues: null, min: null, max: 200 },
        { name: 'body', kind: 'template', required: false, help: 'Corps de la notification (≤ 1000 caractères).', allowedValues: null, min: null, max: 1000 },
        { name: 'link', kind: 'string', required: false, help: 'Lien relatif commençant par « / » (≤ 300 caractères).', allowedValues: null, min: null, max: 300 }
      ]
    },
    {
      type: 'approval',
      label: 'Approbation',
      description: 'Suspend le workflow jusqu\'à la décision d\'un utilisateur ou d\'un rôle.',
      properties: [
        { name: 'assignee', kind: 'recipient', required: true, help: '{ kind ∈ user|role, value } ; le lanceur n\'est pas accepté.', allowedValues: null, min: null, max: null },
        { name: 'title', kind: 'template', required: true, help: 'Titre de la demande (≤ 200 caractères).', allowedValues: null, min: null, max: 200 },
        { name: 'message', kind: 'template', required: false, help: 'Message de la demande (≤ 1000 caractères).', allowedValues: null, min: null, max: 1000 },
        { name: 'dueInHours', kind: 'int', required: false, help: 'Délai de décision en heures (défaut 72).', allowedValues: null, min: 1, max: 720 },
        { name: 'onTimeout', kind: 'enum', required: false, help: 'À l\'expiration : « reject » (défaut), « approve » ou « fail ».', allowedValues: ['reject', 'approve', 'fail'], min: null, max: null },
        { name: 'onReject', kind: 'enum', required: false, help: 'Au refus : « stop » (défaut), « goto » ou « continue ».', allowedValues: ['stop', 'goto', 'continue'], min: null, max: null },
        { name: 'gotoKey', kind: 'string', required: false, help: 'Clé d\'une étape postérieure (requis quand onReject = « goto »).', allowedValues: null, min: null, max: null }
      ]
    },
    {
      type: 'wait',
      label: 'Attendre',
      description: 'Suspend le workflow pendant une durée ou jusqu\'à une date.',
      properties: [
        { name: 'hours', kind: 'int', required: false, help: 'Durée d\'attente en heures — « hours » ou « until », exactement un des deux.', allowedValues: null, min: 1, max: 720 },
        { name: 'until', kind: 'template', required: false, help: 'Gabarit d\'une date d\'échéance (ex. {{date_livraison}}).', allowedValues: null, min: null, max: null },
        { name: 'maxHours', kind: 'int', required: false, help: 'Plafond d\'attente en heures (défaut 720).', allowedValues: null, min: 1, max: 720 }
      ]
    },
    {
      type: 'create_record',
      label: 'Créer un enregistrement',
      description: 'Crée un enregistrement dans une autre table active (standard) du tenant.',
      properties: [
        { name: 'entity', kind: 'entity', required: true, help: 'Clé d\'une table active et standard (jonctions exclues).', allowedValues: null, min: null, max: null },
        { name: 'set', kind: 'fieldMap', required: true, help: '1 à 10 paires champ → valeur.', allowedValues: null, min: 1, max: 10 },
        { name: 'saveResultAs', kind: 'string', required: false, help: 'Mémorise l\'identifiant créé sous ce nom (_results.<nom>).', allowedValues: null, min: null, max: null }
      ]
    }
  ]
};

/** Étapes de `WF_DEFINITIONS[0]` (3 étapes : condition → approbation → notification). */
const WF_STEPS = {
  version: 1,
  steps: [
    { key: 'condition_1', type: 'condition', label: 'Statut à planifier', filters: [{ field: 'statut', op: 'eq', value: 'a_planifier' }], match: 'all', onFalse: 'stop' },
    {
      key: 'approval_1', type: 'approval', label: 'Validation du responsable',
      assignee: { kind: 'role', value: 'Administrator' }, title: 'Validation de l\'intervention',
      message: 'Merci de valider cette intervention avant clôture.', dueInHours: 72, onTimeout: 'reject', onReject: 'stop'
    },
    { key: 'notify_1', type: 'notify', label: 'Notification du lanceur', to: { kind: 'startedBy' }, title: 'Intervention validée' }
  ]
};

/** `WorkflowDefinitionDto[]` — 1 workflow actif « Validation intervention » (3 étapes). */
export const WF_DEFINITIONS = [
  {
    id: 'wf-1',
    entityDefinitionId: WF_ENTITY_ID,
    key: 'validation_intervention',
    name: 'Validation intervention',
    description: 'Validation systématique avant clôture.',
    trigger: 'on_create',
    triggerConfig: null,
    steps: WF_STEPS,
    stepCount: 3,
    version: 1,
    isActive: true,
    openInstances: 1,
    createdAt: iso(-30 * 24 * HOUR_MS),
    updatedAt: iso(-2 * 24 * HOUR_MS),
    rowVersion: 'WfAAAA'
  }
];

/**
 * `WorkflowInstanceDto[]` — inst-1 « waiting_approval » sur l'étape approval_1 (ouverte, fiche r1),
 * inst-2 « completed » (fiche r1 aussi, pour une liste à 2 lignes dont 1 seule ouverte).
 */
export const WF_INSTANCES = [
  {
    id: 'inst-1',
    workflowDefinitionId: 'wf-1',
    entityDefinitionId: WF_ENTITY_ID,
    workflowKey: 'validation_intervention',
    workflowName: 'Validation intervention',
    definitionVersion: 1,
    recordId: 'r1',
    trigger: 'on_create',
    status: 'waiting_approval',
    currentStepIndex: 1,
    currentStepKey: 'approval_1',
    dueAt: iso(-2 * HOUR_MS),
    startedBy: null,
    startedAt: iso(-26 * HOUR_MS),
    completedAt: null,
    depth: 0,
    originInstanceId: null,
    error: null,
    startedByName: 'Alice Martin' // 4.6b1 : « Demandé par » sur l'onglet fiche (null toléré)
  },
  {
    id: 'inst-2',
    workflowDefinitionId: 'wf-1',
    entityDefinitionId: WF_ENTITY_ID,
    workflowKey: 'validation_intervention',
    workflowName: 'Validation intervention',
    definitionVersion: 1,
    recordId: 'r1',
    trigger: 'on_create',
    status: 'completed',
    currentStepIndex: 3,
    currentStepKey: null,
    dueAt: null,
    startedBy: null,
    startedAt: iso(-2 * 24 * HOUR_MS),
    completedAt: iso(-2 * 24 * HOUR_MS + HOUR_MS),
    depth: 0,
    originInstanceId: null,
    error: null
  }
];

/**
 * `WorkflowInstanceDetailDto` d'inst-1 (drawer 4.4f) : condition terminée, approbation
 * suspendue (« En attente »), approbation a1 en attente. `context` vide (jamais rendu, S-base).
 */
export const WF_INSTANCE_DETAIL = {
  instance: WF_INSTANCES[0],
  steps: [
    {
      stepIndex: 0, stepKey: 'condition_1', stepType: 'condition', status: 'succeeded', outcome: 'continue',
      result: null, error: null, startedAt: iso(-26 * HOUR_MS), finishedAt: iso(-26 * HOUR_MS + 60_000)
    },
    {
      stepIndex: 1, stepKey: 'approval_1', stepType: 'approval', status: 'suspended', outcome: 'suspend',
      result: null, error: null, startedAt: iso(-26 * HOUR_MS + 60_000), finishedAt: iso(-26 * HOUR_MS + 60_000)
    }
  ],
  approvals: [
    {
      id: 'a1',
      instanceId: 'inst-1',
      stepKey: 'approval_1',
      assigneeUserId: null,
      assigneeRole: 'Administrator',
      title: 'Validation de l\'intervention',
      message: 'Merci de valider cette intervention avant clôture.',
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      comment: null,
      dueAt: iso(-2 * HOUR_MS),
      createdAt: iso(-26 * HOUR_MS),
      rowVersion: 'ApAAAA'
    }
  ],
  context: {}
};

/**
 * `WorkflowApprovalInboxItemDto[]` (forme H-1 imbriquée) — 2 items : a1 en retard
 * (échéance passée de 2 h), a2 sous 24 h (échéance dans 12 h) ⇒ KPI « 2 / 1 / 1 ».
 */
export const WF_APPROVALS = [
  {
    approval: WF_INSTANCE_DETAIL.approvals[0],
    instanceId: 'inst-1',
    workflowKey: 'validation_intervention',
    workflowName: 'Validation intervention',
    entityKey: 'interventions',
    entityName: 'Interventions',
    recordId: 'r1',
    recordLabel: 'Chaudière A12',
    startedBy: null,
    startedAt: iso(-26 * HOUR_MS),
    startedByName: 'Alice Martin' // 4.5a2 : « Demandé par » (11e champ, `null` par défaut)
  },
  {
    approval: {
      id: 'a2',
      instanceId: 'inst-2',
      stepKey: 'approval_1',
      assigneeUserId: null,
      assigneeRole: 'Administrator',
      title: 'Validation de l\'intervention',
      message: null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      comment: null,
      dueAt: iso(12 * HOUR_MS),
      createdAt: iso(-3 * HOUR_MS),
      rowVersion: 'ApAAAB'
    },
    instanceId: 'inst-2',
    workflowKey: 'validation_intervention',
    workflowName: 'Validation intervention',
    entityKey: 'interventions',
    entityName: 'Interventions',
    recordId: 'r2',
    recordLabel: 'Pompe B3',
    startedBy: null,
    startedAt: iso(-3 * HOUR_MS),
    startedByName: null // lanceur inconnu ⇒ « — » (D-45-02)
  }
];

/** 4.7 « v1.1 » (D-47-60) — onglet « Historique » : mes décisions passées (même forme que l'inbox). */
export const WF_APPROVAL_HISTORY = [
  {
    approval: {
      id: 'h1', instanceId: 'inst-9', stepKey: 'approval_1', assigneeUserId: null,
      assigneeRole: 'Administrator', title: 'Validation de l\'intervention', message: null,
      status: 'rejected', decidedBy: 'u-e2e', decidedAt: iso(-2 * HOUR_MS), comment: 'Non justifié.',
      dueAt: null, createdAt: iso(-30 * HOUR_MS), rowVersion: 'AhAAAB'
    },
    instanceId: 'inst-9', workflowKey: 'validation_intervention', workflowName: 'Validation intervention',
    entityKey: 'interventions', entityName: 'Interventions', recordId: 'r9', recordLabel: 'Vanne C7',
    startedBy: null, startedAt: iso(-30 * HOUR_MS), startedByName: 'Alice Martin'
  },
  {
    approval: {
      id: 'h2', instanceId: 'inst-10', stepKey: 'approval_1', assigneeUserId: 'u-e2e',
      assigneeRole: null, title: 'Accord devis', message: null,
      status: 'approved', decidedBy: 'u-e2e', decidedAt: iso(-26 * HOUR_MS), comment: null,
      dueAt: null, createdAt: iso(-50 * HOUR_MS), rowVersion: 'AiAAAB'
    },
    instanceId: 'inst-10', workflowKey: 'validation_devis', workflowName: 'Validation devis',
    entityKey: 'devis', entityName: 'Devis', recordId: 'r10', recordLabel: 'DEV-0042',
    startedBy: null, startedAt: iso(-50 * HOUR_MS), startedByName: null
  }
];

/** `RunnableWorkflowDto[]` — dialog « Lancer un workflow » de la fiche (4.4h2). */
export const WF_RUNNABLE = [
  { id: 'wf-1', key: 'validation_intervention', name: 'Validation intervention', description: null, stepCount: 3 }
];

/** 4.7c2 — trace de simulation pure (miroir `WorkflowTestResultDto` de 4.7c1) servie par `POST wf-1/test`. */
export const WF_TEST_TRACE = {
  recordId: 'r1',
  entityKey: 'interventions',
  evaluatedSteps: 2,
  suspended: true,
  steps: [
    { key: 'si_prioritaire', type: 'condition', label: 'Priorité haute', verdict: 'would_run', detail: 'Condition remplie (match = all).', rendered: { passed: true, match: 'all' } },
    { key: 'valide', type: 'approval', label: 'Validation', verdict: 'would_suspend', detail: 'Approbation assignée au rôle « Admin » — échéance 2026-09-21T08:00:00Z.', rendered: { title: 'Validation intervention', message: 'Merci de valider.' } }
  ],
  warnings: []
};

// ---------------------------------------------------------------------------------------------

export interface StudioWorkflowMockOptions {
  /** Table hôte runtime (défaut 'interventions'). */
  entityKey?: string;
  /** Définitions listées par le hub (défaut `WF_DEFINITIONS` : 1 workflow actif, 3 étapes). */
  definitions?: unknown[];
  /** Instances (défaut `WF_INSTANCES` : 1 waiting_approval, 1 completed) — fiche r1 + panneau. */
  instances?: unknown[];
  /** Boîte d'approbations (défaut `WF_APPROVALS` : 1 en retard, 1 sous 24 h). */
  approvals?: unknown[];
  /** 4.7 « v1.1 » (ap-f) : onglet « Historique » (défaut `WF_APPROVAL_HISTORY` : 1 approuvée, 1 refusée). */
  approvalHistory?: unknown[];
  /** Statut de la sonde count + de la liste (200 par défaut ; 403/404 = garde fail-closed). */
  approvalsStatus?: 200 | 403 | 404;
  /** Statut de la sonde d'instances de la fiche (200 par défaut ; 404 = onglet masqué, D21). */
  recordProbeStatus?: 200 | 404;
}

const ok = <T>(data: T) => ({ success: true, data, message: null, errors: [] });

/** 4.7a2 — enveloppe `PagedResult` de la route instances paginée (4.7a1) : tableau brut ⇒ page unique. */
const pagedInstances = <T>(items: T[]) => ({
  items, page: 1, pageSize: 20, totalCount: items.length,
  totalPages: items.length ? 1 : 0, hasPreviousPage: false, hasNextPage: false
});

function safeJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Mocks des workflows Studio (conception 4.4a + runtime 4.4f/g/h). Même style que
 * `installStudioRuntimeMocks` : routes génériques enregistrées AVANT les précises, `?**`
 * pour les listes avec query string, chaque appel consigné dans `ctx.calls`.
 * Enveloppe `ok(data)` = `{ success: true, data }` ; erreurs `{ success: false, message }`.
 */
export async function installStudioWorkflowMocks(
  page: Page,
  ctx: StudioMockContext,
  options: StudioWorkflowMockOptions = {}
): Promise<void> {
  const entityKey = options.entityKey ?? 'interventions';
  const definitions = (options.definitions ?? WF_DEFINITIONS) as Record<string, unknown>[];
  const instances = (options.instances ?? WF_INSTANCES) as Record<string, unknown>[];
  const approvals = (options.approvals ?? WF_APPROVALS) as unknown[];
  const approvalHistory = (options.approvalHistory ?? WF_APPROVAL_HISTORY) as unknown[];
  const approvalsStatus = options.approvalsStatus ?? 200;
  const recordProbeStatus = options.recordProbeStatus ?? 200;
  /** Définition renvoyée par le POST de création — resservie par GET wf-new après la navigation. */
  let created: Record<string, unknown> | null = null;

  const record_ = (route: Route) => {
    const req = route.request();
    ctx.calls.push({ method: req.method(), url: req.url(), body: safeJson(req.postData()) });
  };
  const fulfil = async (route: Route, body: unknown, status = 200) => {
    record_(route);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  };
  const forbidden = { success: false, data: null, message: 'Accès refusé.', errors: [] };
  const notFound = { success: false, data: null, message: 'Introuvable.', errors: [] };

  // — Génériques d'abord (évaluées en dernier) —
  // Hub avec ?entity= : une requête de liste par table — vide par défaut pour les tables sans workflow.
  await page.route('**/api/studio/entities/*/workflows', route => fulfil(route, ok([])));
  // Hub « Toutes les tables » (4.5f) : GET api/studio/workflows?page=&pageSize= ⇒ PagedResult vide. RegExp (et non
  // glob `workflows?**`) pour ne jamais capturer `workflows/wf-1`, `workflows/step-catalog`, etc. Aucun scénario
  // actuel ne charge le hub sans ?entity= — filet contre un 404 réel si un futur test l'omet.
  await page.route(/\/api\/studio\/workflows(\?[^/]*)?$/, route =>
    fulfil(route, ok({ items: [], page: 1, pageSize: 200, totalCount: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false })));
  // Pont ERP du concepteur (picker erp_action) : liste vide — non couvert par le filet paginé.
  await page.route('**/api/studio/automations/actions', route => fulfil(route, ok([])));

  // — Approbations (badge g1 / page g2 / décisions h1) —
  await page.route('**/api/studio/workflows/approvals/mine/count', async route => {
    if (approvalsStatus === 403) return fulfil(route, forbidden, 403);
    if (approvalsStatus === 404) return fulfil(route, notFound, 404);
    return fulfil(route, ok({ count: approvals.length }));
  });
  // Déclarée APRÈS mine/count (le motif `mine?**` n'attrape que la liste query-string).
  await page.route('**/api/studio/workflows/approvals/mine?**', async route => {
    if (approvalsStatus === 403) return fulfil(route, forbidden, 403);
    if (approvalsStatus === 404) return fulfil(route, notFound, 404);
    return fulfil(route, ok(approvals));
  });
  // 4.7 « v1.1 » (ap-f) — onglet « Historique » (motif distinct de `mine?**`, aucune collision).
  await page.route('**/api/studio/workflows/approvals/mine/history?**', async route => {
    if (approvalsStatus === 403) return fulfil(route, forbidden, 403);
    if (approvalsStatus === 404) return fulfil(route, notFound, 404);
    return fulfil(route, ok(approvalHistory));
  });
  await page.route('**/api/studio/workflows/approvals/*/approve', route => fulfil(route, ok(instances[0])));
  await page.route('**/api/studio/workflows/approvals/*/reject', route => fulfil(route, ok(instances[0])));

  // — Instances : détail (drawer 4.4f), annulation, relance des approbateurs —
  await page.route('**/api/studio/workflows/instances/inst-1', route => fulfil(route, ok(WF_INSTANCE_DETAIL)));
  await page.route('**/api/studio/workflows/instances/inst-1/cancel', route =>
    fulfil(route, ok({ ...instances[0], status: 'cancelled' })));
  await page.route('**/api/studio/workflows/instances/inst-1/remind', route => fulfil(route, ok(instances[0])));

  // — Définition wf-1 : historique des instances paginé (panneau 4.7a2), activation, GET/PUT/DELETE —
  await page.route('**/api/studio/workflows/wf-1/instances?**', route => fulfil(route, ok(pagedInstances(instances))));
  // 4.7c2 — simulation pure (route 4.7c1) : trace fixe à 2 lignes, aucune écriture attendue.
  await page.route('**/api/studio/workflows/wf-1/test', route => fulfil(route, ok(WF_TEST_TRACE)));
  await page.route('**/api/studio/workflows/wf-1/toggle', async route => {
    const body = (safeJson(route.request().postData()) ?? {}) as { isActive?: boolean };
    await fulfil(route, ok({ ...definitions[0], isActive: body.isActive ?? false }));
  });
  await page.route('**/api/studio/workflows/wf-1', async route => {
    const method = route.request().method();
    if (method === 'DELETE') return fulfil(route, ok({ cancelledInstances: 0 }));
    if (method === 'PUT') {
      const body = (safeJson(route.request().postData()) ?? {}) as Record<string, unknown>;
      return fulfil(route, ok({ ...definitions[0], ...body, id: 'wf-1' }));
    }
    return fulfil(route, ok(definitions[0]));
  });

  // — Catalogue d'étapes (concepteur 4.4c1) —
  await page.route('**/api/studio/workflows/step-catalog', route => fulfil(route, ok(WF_STEP_CATALOG)));

  // — Fiche enregistrement (4.4h2) : sonde d'instances, exécutables, lancement manuel —
  await page.route(`**/api/studio/records/${entityKey}/r1/workflow-instances?**`, async route => {
    if (recordProbeStatus === 404) return fulfil(route, notFound, 404);
    return fulfil(route, ok(instances));
  });
  // Route runtime lecteur (4.5b/d2) : même détail que `workflows/instances/inst-1`, portée fiche.
  await page.route(`**/api/studio/records/${entityKey}/r1/workflow-instances/inst-1`, route =>
    fulfil(route, ok(WF_INSTANCE_DETAIL)));
  await page.route(`**/api/studio/records/${entityKey}/workflows`, route => fulfil(route, ok(WF_RUNNABLE)));
  await page.route(`**/api/studio/records/${entityKey}/r1/workflows/validation_intervention/run`, route =>
    fulfil(route, ok({ ...instances[0], id: 'inst-new', status: 'running', completedAt: null }), 201));

  // — Conception par table (hub 4.4d / « Enregistrer » 201 / « Valider » D-44-02) —
  await page.route(`**/api/studio/entities/${WF_ENTITY_ID}/workflows`, async route => {
    if (route.request().method() === 'POST') {
      const body = (safeJson(route.request().postData()) ?? {}) as Record<string, unknown>;
      // Un workflow créé est inactif (S-base) ; l'id serveur est 'wf-new'.
      created = { ...definitions[0], ...body, id: 'wf-new', isActive: false, openInstances: 0 };
      await fulfil(route, ok(created), 201);
      return;
    }
    await fulfil(route, ok(definitions));
  });
  await page.route(`**/api/studio/entities/${WF_ENTITY_ID}/workflows/validate`, route =>
    fulfil(route, ok({ isValid: true, errors: [], warnings: [], stepCount: 1 })));

  // Après création, le concepteur navigue (replaceUrl) vers /studio/workflows/wf-new et
  // recharge la définition + ses instances (panneau vide pour un workflow neuf).
  await page.route('**/api/studio/workflows/wf-new/instances?**', route => fulfil(route, ok(pagedInstances([]))));
  await page.route('**/api/studio/workflows/wf-new', route =>
    fulfil(route, ok(created ?? { ...definitions[0], id: 'wf-new', isActive: false, openInstances: 0 })));
}
