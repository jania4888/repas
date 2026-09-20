import { Page, Route } from '@playwright/test';

/**
 * Mocks Playwright pour l'atelier Studio IA (`/studio/ai`) : session authentifiée injectée dans le
 * `localStorage` + routes `/api/**` interceptées. Aucun backend .NET / SQL Server n'est requis :
 * les suites `e2e/studio-*.spec.ts` sont déterministes et indépendantes des PR backend.
 *
 * Ordre d'enregistrement : Playwright évalue les routes de la plus récente à la plus ancienne ;
 * le « filet » `**\/api/**` est donc enregistré en premier et les routes précises ensuite.
 */

export interface StudioCapabilitiesOverrides {
  planPreviewEnabled?: boolean;
  systemGenerationEnabled?: boolean;
  modifyToolsEnabled?: boolean;
  viewToolsEnabled?: boolean;
  reportToolsEnabled?: boolean;
  workbenchEnabled?: boolean;
  templatesEnabled?: boolean;
  pagesEnabled?: boolean;
  advancedModelAvailable?: boolean;
  standardModelLabel?: string;
  advancedModelLabel?: string | null;
  manyToManyEnabled?: boolean;
  recordViewsEnabled?: boolean;
  recordViewToolsEnabled?: boolean;
  systemExportEnabled?: boolean;
  workflowsEnabled?: boolean;
  workflowToolsEnabled?: boolean;
}

/** Capacités « atelier complet » (tous les drapeaux P0/P1 activés, modèle avancé configuré). */
export const STUDIO_CAPABILITIES_ALL_ENABLED: Required<StudioCapabilitiesOverrides> = {
  planPreviewEnabled: true,
  systemGenerationEnabled: true,
  modifyToolsEnabled: true,
  viewToolsEnabled: true,
  reportToolsEnabled: true,
  workbenchEnabled: true,
  templatesEnabled: true,
  pagesEnabled: false,
  advancedModelAvailable: true,
  standardModelLabel: 'Mistral 7B',
  advancedModelLabel: 'GPT-4.1',
  manyToManyEnabled: false,
  recordViewsEnabled: false,
  recordViewToolsEnabled: false,
  systemExportEnabled: false,
  workflowsEnabled: false,
  workflowToolsEnabled: false
};

/** Un `data:` SSE par événement, tel que `AiStreamService` le lit (`type` + `content` JSON). */
export interface SseEvent {
  type: string;
  content?: string;
  conversationId?: string;
  [k: string]: unknown;
}

export interface StudioPlanSummaryMock {
  kind: string;
  title: string;
  steps: { key: string; label: string; detail: string }[];
  entities: { displayName: string; fieldCount: number; relationCount: number; existingKey?: string | null }[];
  warnings: string[];
  duplicates: { specRef: string; specDisplayName: string; existingKey: string; existingDisplayName: string; reason: string }[];
}

export interface StudioMockOptions {
  capabilities?: StudioCapabilitiesOverrides | null;
  /** Événements SSE renvoyés par `POST /api/ai/chat` (par défaut : `meta` avancé + `content` + `done`). */
  chatEvents?: SseEvent[];
  /** Historique renvoyé par `GET /api/studio/ai/plans`. */
  plans?: StudioPlanListItemMock[];
  templates?: StudioTemplateMock[];
  /** Remplace `STUDIO_E2E_USER.effectivePermissions` (ex. ajout de `custom_records:write`). */
  permissions?: string[];
}

export interface StudioPlanListItemMock {
  id: string;
  kind: string;
  status: string;
  title: string;
  entityCount: number;
  createdAt: string;
  expiresAt: string;
  executedAt?: string | null;
  systemKey?: string | null;
  errorMessage?: string | null;
  openUrl?: string | null;
  relationCount?: number;
  viewCount?: number;
  replayable?: boolean;
}

export interface StudioTemplateMock {
  key: string;
  displayName: string;
  description: string;
  category: string;
  moduleTag: string;
  source: string;
  entityCount: number;
  relationCount?: number;
  viewModes?: string[];
}

/** Trace des appels API interceptés (méthode + URL + corps JSON éventuel) pour les assertions. */
export interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}

export interface StudioMockContext {
  calls: RecordedCall[];
  /** Appels correspondant à un motif (sous-chaîne de l'URL) et éventuellement une méthode. */
  find(urlPart: string, method?: string): RecordedCall[];
  /** Remplace les événements SSE du prochain `POST /api/ai/chat`. */
  setChatEvents(events: SseEvent[]): void;
}

const FAKE_JWT = (() => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u-e2e', exp: 4102444800 })}.sig`;
})();

export const STUDIO_E2E_USER = {
  id: 'u-e2e',
  email: 'studio.e2e@instafact.test',
  firstName: 'Studio',
  lastName: 'E2E',
  fullName: 'Studio E2E',
  role: 'Administrator',
  roleDisplay: 'Administrateur',
  tenantId: 't-e2e',
  companyName: 'InstaFact E2E',
  tenantKind: 'company',
  accessMode: 'native',
  twoFactorEnabled: false,
  // Tous les modules (AppModule 0-17) : `moduleGuard` exige AppModule.Studio (13) sur /studio/**.
  enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  effectivePermissions: ['studio:design_entities', 'studio:design_forms', 'studio:design_reports', 'custom_records:read'],
  productOnboardingStatus: 'completed'
};

const ok = <T>(data: T) => ({ success: true, data, message: null, errors: [] });

async function fulfilJson(route: Route, data: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
}

function sseBody(events: SseEvent[]): string {
  return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
}

export function studioPlanSummary(overrides: Partial<StudioPlanSummaryMock> = {}): StudioPlanSummaryMock {
  return {
    kind: 'CreateSystem',
    title: 'Gestion des congés',
    steps: [
      { key: 'system', label: 'Système', detail: 'Gestion des congés' },
      { key: 'entities', label: 'Tables', detail: '2 tables' }
    ],
    entities: [
      { displayName: 'Employé', fieldCount: 4, relationCount: 0 },
      { displayName: 'Demande de congé', fieldCount: 5, relationCount: 1 }
    ],
    warnings: [],
    duplicates: [],
    ...overrides
  };
}

/** Spec canonique alignée sur `studioPlanSummary()` (renvoyée par `GET {id}/spec`). */
export function studioSystemSpec(existingKey: string | null = null) {
  return {
    system: { displayName: 'Gestion des congés', description: 'Suivi des congés' },
    entities: [
      {
        ref: 'employe',
        displayName: 'Employé',
        displayNamePlural: 'Employés',
        ...(existingKey ? { existingKey } : {}),
        fields: [
          { key: 'nom', label: 'Nom', type: 'text', required: true },
          { key: 'prenom', label: 'Prénom', type: 'text' },
          { key: 'email', label: 'E-mail', type: 'text' },
          { key: 'poste', label: 'Poste', type: 'text' }
        ]
      },
      {
        ref: 'demande',
        displayName: 'Demande de congé',
        displayNamePlural: 'Demandes de congé',
        fields: [
          { key: 'employe', label: 'Employé', type: 'relation', relationRef: 'employe' },
          { key: 'debut', label: 'Début', type: 'date', required: true },
          { key: 'fin', label: 'Fin', type: 'date', required: true },
          { key: 'type', label: 'Type', type: 'select', options: ['Payé', 'Sans solde'] },
          { key: 'statut', label: 'Statut', type: 'select', options: ['Soumise', 'Validée', 'Refusée'] }
        ]
      }
    ],
    seed: []
  };
}

/** Événements SSE d'une génération aboutissant à un plan `studio_plan` (avec doublons optionnels). */
export function studioPlanEvents(options: {
  planId?: string;
  usedAdvancedModel?: boolean;
  fallbackReason?: string | null;
  duplicates?: StudioPlanSummaryMock['duplicates'];
} = {}): SseEvent[] {
  const planId = options.planId ?? 'plan-e2e-1';
  const usedAdvanced = options.usedAdvancedModel ?? false;
  return [
    {
      type: 'meta',
      content: JSON.stringify({
        usedAdvancedModel: usedAdvanced,
        advancedModelFallbackReason: usedAdvanced ? null : options.fallbackReason ?? null,
        model: usedAdvanced ? 'GPT-4.1' : 'Mistral 7B'
      })
    },
    { type: 'content', content: 'Voici une proposition pour votre système de gestion des congés.' },
    {
      type: 'studio_plan',
      content: JSON.stringify({
        planId,
        kind: 'CreateSystem',
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        summary: studioPlanSummary({ duplicates: options.duplicates ?? [] })
      })
    },
    { type: 'done', content: '', conversationId: 'conv-e2e-1' }
  ];
}

export const STUDIO_E2E_TEMPLATES: StudioTemplateMock[] = [
  { key: 'crm', displayName: 'CRM commercial', description: 'Prospects, opportunités, relances.', category: 'Commercial', moduleTag: 'crm', source: 'builtin', entityCount: 4 },
  { key: 'rh-conges', displayName: 'Gestion des congés', description: 'Employés, demandes, validations.', category: 'RH', moduleTag: 'hr', source: 'builtin', entityCount: 3 },
  { key: 'stock', displayName: 'Gestion de stock', description: 'Articles, mouvements, inventaires.', category: 'Logistique', moduleTag: 'stock', source: 'tenant', entityCount: 3 },
  { key: 'parc', displayName: 'Parc automobile', description: 'Véhicules, entretiens, conducteurs.', category: 'Logistique', moduleTag: 'fleet', source: 'builtin', entityCount: 3 }
];

export const STUDIO_E2E_PLANS: StudioPlanListItemMock[] = [
  { id: 'p-pending', kind: 'CreateSystem', status: 'Pending', title: 'Gestion des congés', entityCount: 2, createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), expiresAt: new Date(Date.now() + 25 * 60_000).toISOString() },
  { id: 'p-done', kind: 'CreateSystem', status: 'Completed', title: 'Suivi des contrats', entityCount: 3, createdAt: new Date(Date.now() - 86_400_000).toISOString(), expiresAt: new Date(Date.now() - 80_000_000).toISOString(), executedAt: new Date(Date.now() - 86_000_000).toISOString(), systemKey: 'contrats' },
  { id: 'p-cancelled', kind: 'CreateApp', status: 'Cancelled', title: 'Table Fournisseurs', entityCount: 1, createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), expiresAt: new Date(Date.now() - 86_400_000).toISOString() }
];

/**
 * Injecte une session « Se souvenir de moi » (jetons + profil dans `localStorage`) avant tout script
 * de l'application : `AuthService` relit ces clés à la construction et `authGuard` laisse passer.
 */
export async function installStudioAuth(page: Page, permissions: string[] = STUDIO_E2E_USER.effectivePermissions): Promise<void> {
  const user = { ...STUDIO_E2E_USER, effectivePermissions: permissions };
  await page.addInitScript(({ token, userJson }) => {
    localStorage.setItem('ft_auth_remember_me', '1');
    localStorage.setItem('ft_access_token', token);
    localStorage.setItem('ft_refresh_token', 'refresh-e2e');
    localStorage.setItem('ft_user', userJson);
  }, { token: FAKE_JWT, userJson: JSON.stringify(user) });
}

/**
 * Intercepte toutes les routes `/api/**` utiles à l'atelier. Les plans en attente (`cancel`,
 * `cancel-pending`) et la suppression de conversation renvoient un succès ; chaque appel est
 * consigné dans `calls` pour les assertions d'ordre (A19) et de charge utile (`useAdvancedModel`).
 */
export async function installStudioApiMocks(page: Page, options: StudioMockOptions = {}): Promise<StudioMockContext> {
  const calls: RecordedCall[] = [];
  const record = (route: Route) => {
    const req = route.request();
    calls.push({ method: req.method(), url: req.url(), body: safeJson(req.postData()) });
  };
  const capabilities = options.capabilities === null
    ? null
    : { ...STUDIO_CAPABILITIES_ALL_ENABLED, ...(options.capabilities ?? {}) };
  const plans = options.plans ?? STUDIO_E2E_PLANS;
  const templates = options.templates ?? STUDIO_E2E_TEMPLATES;
  let chatEvents = options.chatEvents ?? studioPlanEvents({ usedAdvancedModel: true });

  // Filet : tout appel non prévu renvoie une liste paginée vide (le layout charge notifications,
  // badges, recherche… — `res.data.items` ne doit jamais casser). Enregistré en premier : Playwright
  // évalue les routes de la plus récente à la plus ancienne, donc les routes précises passent avant.
  await page.route('**/api/**', async route => {
    record(route);
    await fulfilJson(route, ok({ items: [], page: 1, pageSize: 10, totalCount: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false }));
  });

  /** Route « triviale » : consigne l'appel puis renvoie un JSON fixe. */
  const mockJson = (url: string, body: unknown) =>
    page.route(url, route => { record(route); return fulfilJson(route, body); });

  await mockJson('**/api/studio/nav', ok([]));
  await mockJson('**/api/ai/health', ok({ available: true }));
  await mockJson('**/api/ai/warm-up', ok({ warmed: true }));
  await mockJson('**/api/auth/me', ok(options.permissions ? { ...STUDIO_E2E_USER, effectivePermissions: options.permissions } : STUDIO_E2E_USER));

  await page.route('**/api/ai/studio/capabilities', async route => {
    record(route);
    if (!capabilities) {
      await fulfilJson(route, { success: false, data: null, message: 'Not found', errors: [] }, 404);
      return;
    }
    await fulfilJson(route, ok(capabilities));
  });

  await mockJson('**/api/studio/templates', ok(templates));

  await page.route('**/api/studio/ai/plans?**', async route => {
    record(route);
    const url = new URL(route.request().url());
    const pageNo = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const status = url.searchParams.get('status');
    const kind = url.searchParams.get('kind');
    const filtered = plans.filter(p => (!status || p.status === status) && (!kind || p.kind === kind));
    const items = filtered.slice((pageNo - 1) * pageSize, pageNo * pageSize);
    await fulfilJson(route, ok({
      items,
      page: pageNo,
      pageSize,
      totalCount: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      hasNextPage: pageNo * pageSize < filtered.length,
      hasPreviousPage: pageNo > 1
    }));
  });

  // Route générique `GET /{id}` : enregistrée avant les sous-routes (`cancel-pending`,
  // `{id}/cancel`, `from-template`…) pour que celles-ci, plus récentes, soient évaluées en priorité.
await page.route(/\/api\/studio\/ai\/plans\/[^/?]+$/, async route => {
    record(route);
    const id = route.request().url().split('/').pop()!;
    const item = plans.find(p => p.id === id);
    if (!item) {
      await fulfilJson(route, { success: false, data: null, message: 'Plan introuvable', errors: [] }, 404);
      return;
    }
    await fulfilJson(route, ok({
      id: item.id, kind: item.kind, status: item.status,
      summaryJson: JSON.stringify(studioPlanSummary({ title: item.title })),
      createdAt: item.createdAt, expiresAt: item.expiresAt, executedAt: item.executedAt ?? null
    }));
  });

  await page.route('**/api/studio/ai/plans/cancel-pending', async route => {
    record(route);
    await fulfilJson(route, ok(plans.filter(p => p.status === 'Pending').length));
  });

  await page.route(/\/api\/studio\/ai\/plans\/[^/?]+\/cancel$/, async route => {
    record(route);
    const id = route.request().url().split('/').slice(-2, -1)[0];
    await fulfilJson(route, ok({ id, kind: 'CreateSystem', status: 'Cancelled', summaryJson: '{}', createdAt: new Date().toISOString(), expiresAt: new Date().toISOString() }));
  });

  await page.route(/\/api\/studio\/ai\/plans\/[^/?]+\/spec$/, async route => {
    record(route);
    const id = route.request().url().split('/').slice(-2, -1)[0];
    const method = route.request().method();
    const body = method === 'PUT' ? route.request().postDataJSON() as { specJson?: string } : null;
    const spec = body?.specJson ? JSON.parse(body.specJson) : studioSystemSpec();
    const specDto = { id, kind: 'CreateSystem', status: 'Pending', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), rowVersion: 'AAAA', spec };
    if (method === 'PUT') {
      const reused = spec.entities?.filter((e: { existingKey?: string | null }) => !!e.existingKey).length ?? 0;
      const summary = studioPlanSummary({
        entities: spec.entities.map((e: { displayName: string; fields?: unknown[]; existingKey?: string | null }) => ({
          displayName: e.displayName, fieldCount: e.fields?.length ?? 0, relationCount: 0, existingKey: e.existingKey ?? null
        })),
        steps: reused
          ? [{ key: 'system', label: 'Système', detail: 'Gestion des congés' }, { key: 'reused', label: 'Tables réutilisées', detail: `${reused}` }]
          : undefined
      });
      await fulfilJson(route, ok({
        plan: { id, kind: 'CreateSystem', status: 'Pending', summaryJson: JSON.stringify(summary), createdAt: new Date().toISOString(), expiresAt: specDto.expiresAt },
        spec: specDto
      }));
      return;
    }
    await fulfilJson(route, ok(specDto));
  });

  await page.route('**/api/studio/ai/plans/from-template', async route => {
    record(route);
    const body = route.request().postDataJSON() as { templateKey: string };
    const template = templates.find(t => t.key === body.templateKey);
    const id = `plan-tpl-${body.templateKey}`;
    const summary = studioPlanSummary({ title: template?.displayName ?? body.templateKey });
    await fulfilJson(route, ok({
      plan: { id, kind: 'CreateSystem', status: 'Pending', summaryJson: JSON.stringify(summary), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() },
      spec: { id, kind: 'CreateSystem', status: 'Pending', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), rowVersion: 'AAAA', spec: studioSystemSpec() }
    }));
  });


  await page.route(/\/api\/ai\/conversations\/[^/?]+$/, async route => {
    record(route);
    await route.fulfill({ status: 204, body: '' });
  });

  await page.route('**/api/ai/chat', async route => {
    record(route);
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Trace-Id': 'trace-e2e' },
      body: sseBody(chatEvents)
    });
  });

  return {
    calls,
    find: (urlPart, method) => calls.filter(c => c.url.includes(urlPart) && (!method || c.method === method)),
    setChatEvents: events => { chatEvents = events; }
  };
}

/** Auth + mocks API en un appel ; renvoie le contexte d'enregistrement des appels. */
export async function setupStudioAtelier(page: Page, options: StudioMockOptions = {}): Promise<StudioMockContext> {
  await installStudioAuth(page);
  return installStudioApiMocks(page, options);
}

function safeJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}


// ---------------------------------------------------------------------------
// Runtime des vues enregistrées + relations N-N (2.5h) — mocks au-dessus du filet
// `installStudioApiMocks` (Playwright évalue la route la plus récente d'abord).
// ---------------------------------------------------------------------------

export interface StudioRuntimeMockOptions {
  /** Table hôte du runtime (défaut 'interventions'). */
  entityKey?: string;
  /** Schéma complet (`CustomEntitySchema`) ; un défaut List+Kanban + N-N est fourni. */
  schema?: unknown;
  /** Surcharge du résultat `POST …/views/{id}/run` (par défaut : mode adapté à l'id). */
  runResult?: unknown;
  /** Clé de la table de jonction N-N (défaut 'intervention_technicien'). */
  junctionKey?: string;
  /** `POST records/{jonction}` renvoie 409 `record.duplicate_link`. */
  duplicateLinkOn409?: boolean;
  /** v1.1 (D-47-40) : la jonction porte un attribut de liaison `quantite` (Number) — le schéma de la
   *  jonction est servi et les enregistrements de jonction portent `quantite`. */
  junctionAttribute?: boolean;
  /** `PATCH records/{clé}/{id}` renvoie 409 (conflit rowVersion, drag kanban). */
  patchConflict409?: boolean;
  /** Schéma sans vues enregistrées (cas « drapeau coupé » côté liste). */
  withoutViews?: boolean;
  /** 4.7h5 : `GET records/{clé}/{id}/history` — `items` remplace la page 1 (`totalCount` = `items.length`
   *  par défaut, pas de page 2). Sans option : 3 entrées + une page 2 de 2 entrées (5 au total). */
  history?: { items: unknown[]; totalCount?: number };
  /** `GET …/history` renvoie 500 (bannière d'erreur en ligne + « Réessayer »). */
  historyStatus?: 200 | 500;
}

const RUNTIME_ENTITIES = [
  { id: 'e-int', key: 'interventions', displayName: 'Interventions', displayNamePlural: 'Interventions', icon: null, description: null, isActive: true, fieldCount: 3, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'Standard' },
  { id: 'e-tech', key: 'techniciens', displayName: 'Techniciens', displayNamePlural: 'Techniciens', icon: null, description: null, isActive: true, fieldCount: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'Standard' },
  { id: 'e-jct', key: 'intervention_technicien', displayName: 'Intervention × Technicien', displayNamePlural: 'Liens', icon: null, description: null, isActive: true, fieldCount: 2, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'Junction' }
];

const RUNTIME_FIELDS = [
  { id: 'f-nom', key: 'nom', label: 'Nom', fieldType: 0, isRequired: true, isUnique: false, sortOrder: 0, rules: null, options: null, relation: null, isActive: true },
  { id: 'f-statut', key: 'statut', label: 'Statut', fieldType: 7, isRequired: false, isUnique: false, sortOrder: 1, rules: null,
    options: [{ value: 'a_planifier', label: 'À planifier' }, { value: 'termine', label: 'Terminé' }], relation: null, isActive: true },
  { id: 'f-debut', key: 'debut', label: 'Début', fieldType: 5, isRequired: false, isUnique: false, sortOrder: 2, rules: null, options: null, relation: null, isActive: true }
];

const RUNTIME_RECORDS = [
  { id: 'r1', data: { nom: 'Chaudière A12', statut: 'a_planifier', debut: '2026-09-10' }, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', rowVersion: 'AAA=' },
  { id: 'r2', data: { nom: 'Pompe B3', statut: 'termine', debut: '2026-09-12' }, createdAt: '2026-09-02T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z', rowVersion: 'AAB=' }
];

const RUNTIME_TARGETS = [
  { id: 't1', data: { nom: 'Ben Ali' }, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', rowVersion: 'T1' },
  { id: 't2', data: { nom: 'Sassi' }, createdAt: '2026-09-02T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z', rowVersion: 'T2' }
];

const RUNTIME_M2M = {
  kind: 'many_to_many', sourceEntityId: 'e-int', sourceEntityKey: 'interventions', sourceLabel: 'Interventions',
  targetEntityId: 'e-tech', targetEntityKey: 'techniciens', targetLabel: 'Techniciens',
  fieldId: 'jf-int', fieldKey: 'intervention_id', isRequired: true, isUnique: false,
  junctionEntityId: 'e-jct', junctionEntityKey: 'intervention_technicien',
  junctionTargetFieldId: 'jf-tech', junctionTargetFieldKey: 'technicien_id'
};

const LIST_VIEW = {
  id: 'v-list', key: 'actives', displayName: 'Actives', mode: 'List',
  definition: { columns: [{ fieldKey: 'nom', hidden: false }], filters: [], sort: [], kanban: null, calendar: null, searchEnabled: true, pageSize: 25 },
  isDefault: true, isActive: true, rowVersion: 'V1', updatedAt: '2026-09-01T00:00:00Z'
};
const KANBAN_VIEW = {
  id: 'v-kanban', key: 'par_statut', displayName: 'Par statut', mode: 'Kanban',
  definition: { columns: [{ fieldKey: 'nom', hidden: false }], filters: [], sort: [],
    kanban: { groupByFieldKey: 'statut', titleFieldKey: 'nom', cardFieldKeys: [], columnOrder: null, showEmptyGroup: true }, calendar: null,
    searchEnabled: false, pageSize: 25 },
  isDefault: false, isActive: true, rowVersion: 'V2', updatedAt: '2026-09-01T00:00:00Z'
};

/** 4.7h5 : historique de la fiche `r1` (plus récent d'abord) — page 1 (3 entrées) puis page 2 (2 entrées). */
const RUNTIME_HISTORY_PAGE_1 = [
  { id: 'h1', action: 'Studio.Record.Updated', createdAt: '2026-09-19T10:30:00Z', userName: 'Alice Martin',
    changes: [{ key: 'statut', oldValue: 'a_planifier', newValue: 'termine' }, { key: 'nom', oldValue: 'Pompe A', newValue: 'Pompe A2' }] },
  { id: 'h2', action: 'Studio.Record.Updated', createdAt: '2026-09-18T15:00:00Z', userName: null,
    changes: [{ key: 'nom', oldValue: 'Pompe', newValue: 'Pompe A' }] },
  { id: 'h3', action: 'Studio.Record.Updated', createdAt: '2026-09-18T09:00:00Z', userName: 'Alice Martin',
    changes: [{ key: 'debut', oldValue: '2026-09-19', newValue: '2026-09-20' }] }
];
const RUNTIME_HISTORY_PAGE_2 = [
  { id: 'h4', action: 'Studio.Record.Updated', createdAt: '2026-09-17T09:00:00Z', userName: 'Bob Sassi',
    changes: [{ key: 'statut', oldValue: null, newValue: 'a_planifier' }] },
  { id: 'h5', action: 'Studio.Record.Created', createdAt: '2026-09-16T09:00:00Z', userName: 'Alice Martin',
    changes: [{ key: 'nom', oldValue: null, newValue: 'Pompe' }, { key: 'statut', oldValue: null, newValue: null }, { key: 'debut', oldValue: null, newValue: '2026-09-19' }] }
];

function runtimeSchema(): unknown {
  return {
    entity: RUNTIME_ENTITIES[0],
    fields: RUNTIME_FIELDS,
    form: { sections: [] },
    relations: [RUNTIME_M2M],
    views: [LIST_VIEW, KANBAN_VIEW]
  };
}

function runResultFor(viewId: string): unknown {
  if (viewId === 'v-kanban') {
    return {
      mode: 'Kanban', items: [], total: 2, page: 1, pageSize: 500,
      groups: [
        { value: 'a_planifier', label: 'À planifier', count: 1, items: [RUNTIME_RECORDS[0]] },
        { value: 'termine', label: 'Terminé', count: 1, items: [RUNTIME_RECORDS[1]] }
      ],
      events: null, truncated: false
    };
  }
  return { mode: 'List', items: RUNTIME_RECORDS, total: 2, page: 1, pageSize: 25, groups: null, events: null, truncated: false };
}

/**
 * Mocks du runtime 2.5 (vues enregistrées + N-N) à installer APRÈS `installStudioApiMocks`.
 * Chaque appel est poussé dans `ctx.calls` ; les écritures réussissent (201/200/204) sauf options
 * `duplicateLinkOn409` / `patchConflict409`.
 */
export async function installStudioRuntimeMocks(
  page: Page, ctx: StudioMockContext, options: StudioRuntimeMockOptions = {}
): Promise<void> {
  const key = options.entityKey ?? 'interventions';
  const junction = options.junctionKey ?? 'intervention_technicien';
  const schema = options.schema ?? (options.withoutViews ? { ...runtimeSchema(), views: [] } : runtimeSchema());
  const record_ = (route: Route) => {
    const req = route.request();
    ctx.calls.push({ method: req.method(), url: req.url(), body: safeJson(req.postData()) });
  };
  const fulfil = async (route: Route, body: unknown, status = 200) => {
    record_(route);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  };
  const paged = (items: unknown[], totalCount = items.length) =>
    ok({ items, page: 1, pageSize: items.length || 10, totalCount, totalPages: 1, hasNextPage: false, hasPreviousPage: false });

  // Ordre = priorité croissante (Playwright évalue la route la plus récente d'abord) : les motifs
  // génériques sont enregistrés AVANT les motifs précis ; les listes paginées portent un `?**`
  // (le glob doit couvrir la query string).

  // — Table hôte : CRUD d'enregistrement (id), PATCH éventuellement en conflit 409.
  await page.route(`**/api/studio/records/${key}/*`, async route => {
    if (route.request().method() === 'PATCH') {
      if (options.patchConflict409) {
        await fulfil(route, { success: false, data: null, message: 'Conflit de version.', errors: [], code: 'record.stale' }, 409);
        return;
      }
      await fulfil(route, ok(RUNTIME_RECORDS[0]));
      return;
    }
    await fulfil(route, ok(RUNTIME_RECORDS[0]));
  });
  // — Sonde d'instances workflow de la fiche (4.4h2) : la route attend un TABLEAU ; sans cette ligne,
  //   le filet `**/api/**` répond un objet paginé et `workflowInstances().filter` jette en boucle
  //   (page à moitié figée). Enregistrée APRÈS `records/${key}/*` ⇒ prioritaire (ordre inverse).
  await page.route(`**/api/studio/records/${key}/*/workflow-instances?**`, route => fulfil(route, ok([])));
  // — 4.7h5 : historique de la fiche (`GET records/{clé}/{id}/history?page&pageSize`) — même raison que la
  //   sonde ci-dessus (le filet répondrait un objet inattendu) ; enregistrée APRÈS `records/${key}/*` ⇒ prioritaire.
  await page.route(`**/api/studio/records/${key}/*/history?**`, async route => {
    if (options.historyStatus === 500) {
      await fulfil(route, { success: false, data: null, message: 'Historique indisponible.', error: 'Historique indisponible.' }, 500);
      return;
    }
    const pageNo = Number(new URL(route.request().url()).searchParams.get('page') ?? '1') || 1;
    if (options.history) {
      const items = options.history.items;
      await fulfil(route, ok({ items, page: 1, pageSize: 20, totalCount: options.history.totalCount ?? items.length, totalPages: 1, hasNextPage: false, hasPreviousPage: false }));
      return;
    }
    const items = pageNo >= 2 ? RUNTIME_HISTORY_PAGE_2 : RUNTIME_HISTORY_PAGE_1;
    await fulfil(route, ok({ items, page: pageNo, pageSize: 3, totalCount: 5, totalPages: 2, hasNextPage: pageNo < 2, hasPreviousPage: pageNo > 1 }));
  });
  await page.route(`**/api/studio/records/${key}?**`, route => fulfil(route, paged(RUNTIME_RECORDS)));
  await page.route(`**/api/studio/records/${key}`, route => fulfil(route, paged(RUNTIME_RECORDS)));
  await page.route(`**/api/studio/records/${key}/schema`, route => fulfil(route, ok(schema)));

  // — Vues enregistrées : run + CRUD.
  await page.route(`**/api/studio/records/${key}/views/*/run`, route =>
    fulfil(route, ok(options.runResult ?? runResultFor(route.request().url().split('/views/')[1].split('/run')[0]))));
  await page.route(`**/api/studio/records/${key}/views/*/default`, route => fulfil(route, ok(null)));
  await page.route(`**/api/studio/records/${key}/views/*`, async route => {
    const method = route.request().method();
    if (method === 'DELETE') { record_(route); await route.fulfill({ status: 204, body: '' }); return; }
    if (method === 'PUT') { await fulfil(route, ok({ ...LIST_VIEW, ...(safeJson(route.request().postData()) as object) })); return; }
    await fulfil(route, ok(LIST_VIEW));
  });
  // 4.7v2 (R3) : aperçu du brouillon du concepteur — enregistrée APRÈS `views/*` (Playwright
  // évalue les routes en ordre inverse : ce motif spécifique prime sur la capture générique).
  await page.route(`**/api/studio/records/${key}/views/preview`, route =>
    fulfil(route, ok(options.runResult ?? runResultFor('apercu'))));
  await page.route(`**/api/studio/records/${key}/views`, async route => {
    if (route.request().method() === 'POST') {
      const body = (safeJson(route.request().postData()) ?? {}) as Record<string, unknown>;
      await fulfil(route, ok({ ...LIST_VIEW, id: 'v-new', key: body['key'] ?? 'v_new', displayName: body['displayName'] ?? 'Nouvelle vue', mode: body['mode'] ?? 'List', definition: body['definition'] ?? LIST_VIEW.definition }), 201);
      return;
    }
    await fulfil(route, ok([LIST_VIEW, KANBAN_VIEW]));
  });

  // — Jonction : retrait (DELETE {id}), liste des liens (GET ?…), ajout (POST).
  await page.route(`**/api/studio/records/${junction}/*`, async route => {
    if (route.request().method() === 'DELETE') { record_(route); await route.fulfill({ status: 204, body: '' }); return; }
    await fulfil(route, paged([]));
  });
  await page.route(`**/api/studio/records/${junction}?**`, route =>
    fulfil(route, paged([{ id: 'j-rec-1', data: options.junctionAttribute
      ? { intervention_id: 'r1', technicien_id: 't1', quantite: 3 }
      : { intervention_id: 'r1', technicien_id: 't1' },
      createdAt: '2026-09-03T00:00:00Z', updatedAt: '2026-09-03T00:00:00Z', rowVersion: 'J1' }])));
  if (options.junctionAttribute) {
    // v1.1 : schéma de la jonction avec l'attribut `quantite` (Number) — enregistré APRÈS
    // `records/${junction}/*` (qui renverrait une page vide) ⇒ prioritaire (ordre inverse).
    await page.route(`**/api/studio/records/${junction}/schema`, route =>
      fulfil(route, ok({
        entity: { id: 'e-jct', key: junction, displayName: 'Intervention × Technicien' },
        fields: [
          { id: 'jf1', key: 'intervention_id', label: 'Intervention', fieldType: 'RelationCustom', isRequired: true, isUnique: false, sortOrder: 0, rules: null, options: null, relation: { kind: 'custom', ref: 'interventions' }, isActive: true },
          { id: 'jf2', key: 'technicien_id', label: 'Technicien', fieldType: 'RelationCustom', isRequired: true, isUnique: false, sortOrder: 1, rules: null, options: null, relation: { kind: 'custom', ref: 'techniciens' }, isActive: true },
          { id: 'jf3', key: 'quantite', label: 'Quantité', fieldType: 'Number', isRequired: false, isUnique: false, sortOrder: 2, rules: null, options: null, relation: null, isActive: true }
        ],
        form: { sections: [] }, relations: [], views: []
      })));
  }
  await page.route(`**/api/studio/records/${junction}`, async route => {
    if (route.request().method() === 'POST') {
      if (options.duplicateLinkOn409) {
        await fulfil(route, { success: false, data: null, message: 'Lien déjà existant.', errors: [], code: 'record.duplicate_link' }, 409);
        return;
      }
      await fulfil(route, ok({ id: 'j-rec-2', data: {}, createdAt: '2026-09-03T01:00:00Z', updatedAt: '', rowVersion: 'J2' }), 201);
      return;
    }
    await fulfil(route, paged([]));
  });

  // — Cibles candidates (recherche « Liés »).
  await page.route(`**/api/studio/records/techniciens?**`, route => fulfil(route, paged(RUNTIME_TARGETS)));
  await page.route(`**/api/studio/records/techniciens`, route => fulfil(route, paged(RUNTIME_TARGETS)));

  // — Entités + relations (concepteur de table, page Relations, liste des tables).
  await page.route(`**/api/studio/entities/*/relations/many-to-many`, route => {
    // v1.1 (D-47-40) : écho du champ attribut quand `junctionAttributeLabel` est fourni.
    const body = route.request().postDataJSON() as { junctionAttributeLabel?: string | null } | null;
    const attributeField = body?.junctionAttributeLabel
      ? { id: 'f-attr', key: 'quantit', label: body.junctionAttributeLabel, fieldType: 2, isRequired: false, isUnique: false, sortOrder: 2, rules: null, options: null, relation: null, isActive: true }
      : null;
    return fulfil(route, ok({ junction: RUNTIME_ENTITIES[2], sourceField: RUNTIME_FIELDS[0], targetField: RUNTIME_FIELDS[1], attributeField }), 201);
  });
  await page.route(`**/api/studio/entities/*/relations`, route => fulfil(route, ok([RUNTIME_M2M])));
  await page.route(`**/api/studio/entities/*/fields?**`, route => fulfil(route, ok(RUNTIME_FIELDS)));
  await page.route(`**/api/studio/entities/*`, route => fulfil(route, ok(RUNTIME_ENTITIES[0])));
  await page.route(`**/api/studio/entities?**`, route => fulfil(route, ok(RUNTIME_ENTITIES)));
  await page.route(`**/api/studio/entities`, route => fulfil(route, ok(RUNTIME_ENTITIES)));
}


// ---------------------------------------------------------------------------
// Aperçu IA enrichi (3.4) — Tester / Personnaliser / Régénérer / import-export-duplication.
// À installer APRÈS `installStudioApiMocks` (routes plus récentes ⇒ prioritaires).
// ---------------------------------------------------------------------------

export interface StudioPreviewMockOptions {
  /** `GET {id}/preview` : 200 (aperçu structuré) ou 404 (drapeau serveur coupé ⇒ mode Tester dégradé). */
  previewStatus?: 200 | 404;
  /** `PUT {id}/spec` renvoie 409 (le plan a été modifié entre-temps). */
  specPutConflict?: boolean;
  /** `POST systems/import` : 201 (plan ouvert) ou 400 (« La spec dépasse 256 Ko. »). */
  importStatus?: 201 | 400;
  /** `POST {id}/replay` : 201 (nouveau plan `p-replay`) ou 409. */
  replayStatus?: 201 | 409;
  /** Événements SSE de `POST {id}/confirm` (défaut : 3 étapes `studio_progress` + `studio_result` + `done`). */
  confirmEvents?: SseEvent[];
}

export const STUDIO_E2E_SYSTEMS = [
  { id: 's-conges', key: 'conges', displayName: 'Gestion des congés', icon: 'fa-solid fa-umbrella-beach', description: 'Suivi des congés', onboardingSteps: null, isActive: true, entityCount: 2, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z' },
  { id: 's-contrats', key: 'contrats', displayName: 'Suivi des contrats', icon: null, description: null, onboardingSteps: null, isActive: true, entityCount: 3, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-15T00:00:00Z' }
];

/** `StudioAiPlanPreviewDto` aligné sur `studioSystemSpec()` (2 tables, 1 relation, 1 vue par table). */
export function studioPlanPreview(planId: string) {
  const spec = studioSystemSpec();
  return {
    planId,
    kind: 'CreateSystem',
    status: 'Pending',
    title: spec.system.displayName,
    entities: spec.entities.map(e => ({
      ref: e.ref,
      displayName: e.displayName,
      existingKey: null,
      fields: e.fields.map(f => ({
        key: f.key, label: f.label, fieldType: f.type, required: !!(f as { required?: boolean }).required, unique: false,
        options: (f as { options?: string[] }).options ?? null,
        relationToRef: (f as { relationRef?: string }).relationRef ?? null
      })),
      formLayout: { sections: [{ title: 'Général', fields: e.fields.map(f => ({ key: f.key, width: 'half', labelOverride: null })) }] },
      views: [{ mode: 'list', displayName: `Toutes les ${e.displayNamePlural.toLowerCase()}` }],
      seedCount: 2,
      seedSample: [
        Object.fromEntries(e.fields.map(f => [f.key, `${f.label} 1`])),
        Object.fromEntries(e.fields.map(f => [f.key, `${f.label} 2`]))
      ]
    })),
    relations: [{ kind: 'many_to_one', fromRef: 'demande', toRef: 'employe', label: 'Employé', junctionName: null }],
    amendment: null,
    workflows: [],
    warnings: [],
    duplicates: []
  };
}

/** Enveloppe `StudioAiPlanCreationResponse` (`{ plan, spec }`) d'un plan créé côté serveur (201). */
function creationResponse(id: string, title: string, spec: unknown = studioSystemSpec()) {
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const summary = studioPlanSummary({ title });
  return {
    plan: { id, kind: 'CreateSystem', status: 'Pending', summaryJson: JSON.stringify(summary), createdAt: new Date().toISOString(), expiresAt },
    spec: { id, kind: 'CreateSystem', status: 'Pending', expiresAt, rowVersion: 'AAAA', spec }
  };
}

function defaultConfirmEvents(): SseEvent[] {
  const step = (phase: string, label: string, status: string, entityRef: string | null = null) =>
    ({ type: 'studio_progress', content: JSON.stringify({ phase, label, status, entityRef, detail: null }) });
  return [
    step('creating_system', 'Système « Gestion des congés »', 'done'),
    step('creating_entities', 'Table Employé', 'done', 'employe'),
    step('creating_entities', 'Table Demande de congé', 'done', 'demande'),
    step('creating_views', 'Vue Toutes les demandes', 'done', 'demande'),
    {
      type: 'studio_result',
      content: JSON.stringify({
        success: true,
        systemKey: 'conges',
        systemUrl: '/studio/systems/conges',
        displayName: 'Gestion des congés',
        entityCount: 2,
        entities: [
          { refKey: 'employe', entityKey: 'employes', displayName: 'Employé', openUrl: '/studio/records/employes' },
          { refKey: 'demande', entityKey: 'demandes', displayName: 'Demande de congé', openUrl: '/studio/records/demandes' }
        ],
        warnings: [],
        message: 'Système créé.'
      })
    },
    { type: 'done', content: '' }
  ];
}

/**
 * Mocks de l'aperçu IA enrichi (3.4) : `GET {id}/preview`, `POST {id}/replay`, `PUT {id}/spec` (409
 * optionnel), `POST {id}/confirm` (SSE), `GET systems/{key}/export`, `POST systems/{key}/duplicate`,
 * `POST systems/import`, `GET systems`, `GET systems/{key}`. Chaque appel est poussé dans `ctx.calls`.
 */
export async function installStudioPreviewMocks(
  page: Page, ctx: StudioMockContext, options: StudioPreviewMockOptions = {}
): Promise<void> {
  const record_ = (route: Route) => {
    const req = route.request();
    ctx.calls.push({ method: req.method(), url: req.url(), body: safeJson(req.postData()) });
  };
  const fulfil = async (route: Route, body: unknown, status = 200) => {
    record_(route);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  };
  const segment = (route: Route, fromEnd: number) => route.request().url().split('?')[0].split('/').slice(fromEnd, fromEnd + 1)[0];

  // — Plans : aperçu structuré (GET-only), rejeu, conflit de brouillon, confirmation SSE.
  await page.route(/\/api\/studio\/ai\/plans\/[^/?]+\/preview$/, async route => {
    const id = segment(route, -2);
    if (options.previewStatus === 404) {
      await fulfil(route, { success: false, data: null, message: 'Not found', errors: [] }, 404);
      return;
    }
    await fulfil(route, ok(studioPlanPreview(id)));
  });

  await page.route(/\/api\/studio\/ai\/plans\/[^/?]+\/replay$/, async route => {
    if (options.replayStatus === 409) {
      await fulfil(route, { success: false, data: null, message: 'Plan non rejouable.', errors: [] }, 409);
      return;
    }
    await fulfil(route, ok(creationResponse('p-replay', 'Gestion des congés')), 201);
  });

  if (options.specPutConflict) {
    await page.route(/\/api\/studio\/ai\/plans\/[^/?]+\/spec$/, async route => {
      if (route.request().method() !== 'PUT') { await route.fallback(); return; }
      await fulfil(route, { success: false, data: null, message: 'Conflit de version.', errors: [] }, 409);
    });
  }

  await page.route(/\/api\/studio\/ai\/plans\/[^/?]+\/confirm$/, async route => {
    record_(route);
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: sseBody(options.confirmEvents ?? defaultConfirmEvents())
    });
  });

  // — Systèmes : liste, détail, export, duplication, import.
  await page.route('**/api/studio/systems?**', route => fulfil(route, ok(STUDIO_E2E_SYSTEMS)));
  await page.route('**/api/studio/systems', route => fulfil(route, ok(STUDIO_E2E_SYSTEMS)));
  await page.route(/\/api\/studio\/systems\/[^/?]+$/, async route => {
    // Le motif capte aussi `POST …/systems/import` : seul le détail (GET) est servi ici.
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const key = segment(route, -1);
    const system = STUDIO_E2E_SYSTEMS.find(s => s.key === key) ?? STUDIO_E2E_SYSTEMS[0];
    await fulfil(route, ok({ system, entities: [] }));
  });

  await page.route(/\/api\/studio\/systems\/[^/?]+\/export(\?.*)?$/, async route => {
    const key = segment(route, -2);
    const includeSeed = new URL(route.request().url()).searchParams.get('includeSeed') === 'true';
    const system = STUDIO_E2E_SYSTEMS.find(s => s.key === key);
    await fulfil(route, ok({
      specVersion: 1,
      systemKey: key,
      systemDisplayName: system?.displayName ?? key,
      exportedAt: new Date().toISOString(),
      entityCount: 2,
      relationCount: 1,
      viewCount: 0,
      includesSeed: includeSeed,
      warnings: [],
      spec: studioSystemSpec()
    }));
  });

  await page.route(/\/api\/studio\/systems\/[^/?]+\/duplicate$/, async route => {
    const key = segment(route, -2);
    const body = (safeJson(route.request().postData()) ?? {}) as { displayName?: string | null };
    const source = STUDIO_E2E_SYSTEMS.find(s => s.key === key);
    const title = body.displayName || `${source?.displayName ?? key} (copie)`;
    await fulfil(route, ok(creationResponse('p-duplicate', title)), 201);
  });

  await page.route('**/api/studio/systems/import', async route => {
    if (options.importStatus === 400) {
      await fulfil(route, { success: false, data: null, message: 'La spec dépasse 256 Ko.', errors: [] }, 400);
      return;
    }
    const body = (safeJson(route.request().postData()) ?? {}) as { spec?: unknown; displayNameOverride?: string | null };
    const spec = typeof body.spec === 'string' ? JSON.parse(body.spec) : body.spec ?? studioSystemSpec();
    const title = body.displayNameOverride || (spec as { system?: { displayName?: string } })?.system?.displayName || 'Import';
    await fulfil(route, ok(creationResponse('p-import', title, spec)), 201);
  });
}
