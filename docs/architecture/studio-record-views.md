# Vues enregistrées du Studio (PR 2.3)

> État : livré (backend). Frontend : PR 2.5. Outils IA : PR 2.4. Export : PR 3.3.
> Drapeau : `Ollama:EnableStudioRecordViews` (défaut C# `false`, `true` dans `appsettings*.json`).
> Migration tenant : `20260912140000_AddStudioRecordViews_Tenant` (additive, inerte drapeau coupé).

## Vue d'ensemble

Une **vue enregistrée** est une définition réutilisable d'affichage des enregistrements d'une table
Studio (`CustomEntityDefinition`) : **Liste**, **Kanban** ou **Calendrier**, avec colonnes, filtres, tri
et recherche. Elle est exécutée **côté serveur** en SQL paramétré sur la colonne `DataJson`
(`JSON_VALUE` / `TRY_CONVERT`, colonnes calculées indexées `jx_*`).

À ne pas confondre avec `CustomViewDefinition` (`StudioViewsController`, `api/studio/views`) : ce dernier
est une **fenêtre SQL en lecture seule sur une table ERP existante** — un concept différent, d'où le
nommage `RecordView` partout (entité, DTO, routes, audit).

## Modèle

`CustomRecordViewDefinition` (table `CustomRecordViewDefinitions`) :

| Colonne | Rôle |
|---|---|
| `Id`, `TenantId`, `EntityDefinitionId` | identité + isolation tenant + rattachement à la table (FK cascade) |
| `Key` (64), `DisplayName` (128) | clé machine unique par (tenant, table) parmi les vues non supprimées ; libellé |
| `Mode` (int) | `0 = List`, `1 = Kanban`, `2 = Calendar` (sérialisé en chaîne dans l'API) |
| `DefinitionJson` (nvarchar(max)) | définition typée camelCase (`RecordViewDefinition`) |
| `IsDefault`, `IsActive` | vue par défaut (exclusif) / activée |
| `IsDeleted`, `DeletedAt` | suppression logique (R12 : aucune promotion automatique d'une autre vue) |
| `RowVersion` | concurrence optimiste des mises à jour (409) |

Index : unique filtré `(TenantId, EntityDefinitionId, Key) WHERE IsDeleted = 0`, et
`(TenantId, EntityDefinitionId, IsDefault)`.

## Définition JSON (`RecordViewDefinition`)

```json
{
  "columns":  [{ "fieldKey": "nom", "width": 200, "hidden": false }],
  "filters":  [{ "fieldKey": "statut", "op": "eq", "value": "encours" }],
  "sort":     [{ "fieldKey": "debut", "descending": true }],
  "kanban":   { "groupByFieldKey": "statut", "titleFieldKey": "nom", "cardFieldKeys": ["montant"], "columnOrder": null, "showEmptyGroup": true },
  "calendar": { "startFieldKey": "debut", "endFieldKey": null, "titleFieldKey": "nom", "colorFieldKey": "statut" },
  "searchEnabled": true,
  "pageSize": 25
}
```

`op` ∈ `eq | neq | contains | gt | gte | lt | lte | in | is_empty | is_not_empty | between`.
`RecordViewDefinitionValidator` impose : bornes **25 colonnes / 10 filtres / 3 tris / pageSize 1..200** ;
chaque `fieldKey` ∈ champs actifs (ou `createdAt` / `updatedAt` en colonne/tri) ; compatibilité
opérateur / type (`contains` → textes/select ; `gt…between` → nombres/dates ; `in` → select/multi/
relations) ; `kanban.groupByFieldKey` → `Select` ; `calendar.startFieldKey`/`endFieldKey` →
`Date`/`DateTime` ; champs calculés (`Formula`/`Lookup`/`Rollup`/`AutoNumber`) autorisés en colonne,
**refusés en filtre/tri** (coût non borné).

## Exécution (`RecordQuerySql` + `CustomRecordRepository.QueryAsync`)

`RecordQuerySql.Build` est un **constructeur SQL pur** (testable sans base) : `WHERE` / `ORDER BY` /
paramètres. Garanties :

- `TenantId`, `EntityDefinitionId`, `IsDeleted = 0` **toujours** dans le `WHERE` ;
- chaque clé est revérifiée par `StudioKey.IsValidShape` (sinon `ArgumentException`) ; les chemins JSON
  ne contiennent que ces clés validées ; **aucune valeur utilisateur n'est concaténée** (paramètres
  `@pN` typés `SqlDbType`) ;
- expression par type : textes → `JSON_VALUE(DataJson, '$.<clé>')` ; numériques →
  `TRY_CONVERT(decimal(18,6), JSON_VALUE(...))` ; dates → `TRY_CONVERT(datetime2, JSON_VALUE(...), 127)`
  (ISO 8601) ; booléen `eq` → `IN ('true','1')` ; `in` MultiSelect → `EXISTS (SELECT 1 FROM OPENJSON(...))` ;
- égalité sur clé indexée (≤ 450 caractères) : seek `[jx_<clé>] = @pN` + revérification exacte par
  `JSON_VALUE` (résolution des colonnes présentes via `IJsonIndexManager`, best-effort) ;
- tri par défaut `[CreatedAt] DESC, [Id] ASC` (tie-breaker stable pour OFFSET/FETCH).

`QueryAsync` exécute ce SQL en `DbCommand` paramétré (`SELECT r.*, COUNT(*) OVER() AS [__total] …
OFFSET … FETCH NEXT …`) et matérialise les `CustomRecord`.

### Règles par mode

- **Liste** : pagination `page`/`pageSize` (défaut `definition.pageSize`, **borne 200** ⇒ 400 au-delà) ;
  `items` + `total` exact.
- **Kanban** : requête unique triée par le champ de regroupement puis le tri de la vue,
  `take = StudioRecordViewMaxKanbanCards` (500) ; regroupement **en mémoire** dans l'ordre
  `columnOrder` (filtré aux options) sinon l'ordre des options `Select` ; groupe `value = null`
  « Sans valeur » si `showEmptyGroup` ; `truncated = total > 500`.
- **Calendrier** : `rangeStart`/`rangeEnd` **obligatoires** (400 sinon), fenêtre **≤ 92 jours** ; un
  filtre `between` est ajouté sur `startFieldKey` ; `take = StudioRecordViewMaxCalendarEvents` (1000) ;
  projection en `events[]` (`recordId`, `title`, `start`, `end?`, `colorValue?`) ; `truncated`.
- `extraFilters` (≤ 5) validés comme les filtres de la vue ; `search` → `LIKE` paramétré sur les champs
  recherchables (Text/MultilineText/Select, ≤ 6) ou `DataJson LIKE` si aucun.

## API (`api/studio/records/{entityKey}/views`, gardée par le drapeau)

| Méthode | Route | Policy | Codes |
|---|---|---|---|
| GET | `…/views` | `CustomRecordsRead` | 200 · 404 entité |
| GET | `…/views/{id}` | `CustomRecordsRead` | 200 · 404 |
| POST | `…/views` | `StudioDesignForms` | 201 · 400 `Validation.key` · 409 clé prise |
| PUT | `…/views/{id}` | `StudioDesignForms` | 200 · 400 · 404 · 409 RowVersion |
| DELETE | `…/views/{id}` | `StudioDesignForms` | 204 · 404 (soft delete) |
| POST | `…/views/{id}/default` | `StudioDesignForms` | 204 · 404 (exclusif) |
| POST | `…/views/{id}/run` | `CustomRecordsRead` | 200 · 400 · 404 |
| POST | `…/views/preview` | `StudioDesignForms` | 200 · 400 (validation / définition / `pageSize`) |

**Aperçu d'un brouillon (v1.1, 4.7v1, D-47-20)** : `POST …/views/preview` exécute une définition
**non persistée** fournie dans le corps (`PreviewRecordViewRequest` : `mode`, `definition`, `page`,
`pageSize`, fenêtre calendrier — **ni `search` ni `extraFilters`**). Même validateur
(`RecordViewDefinitionValidator`) et même exécution que `run` — le dispatch par mode et
`QueryRecordsAsync` sont factorisés dans `RecordViewRunExecutor`, partagé 1:1 entre les deux
handlers. **Aucune écriture** : pas de vue créée, pas d'audit `Studio.RecordView.*`, quota
« 20 vues/table » non consommé ; réservé aux concepteurs (`StudioDesignForms`).

Toutes les erreurs passent par `StudioErrorMapping` (`Conflict`/`record.duplicate_link` → 409,
`*.NotFound`/`NotFound` → 404, `Unauthorized` → 401, `Forbidden` → 403, sinon 400).

## PATCH partiel (R5)

`PATCH api/studio/records/{entityKey}/{id}` (`CustomRecordsWrite`, gardé par le drapeau) applique une
**fusion partielle** : `CustomRecordPatchMerger.MergePatch` applique les clés fournies sur le JSON
existant (`null` = effacement), refuse clés inconnues / réservées / calculées (`400 Validation.data`),
puis `CustomRecordValidator.ValidateAndCanonicalize` produit le document canonique complet (les clés
absentes sont conservées). Le flux réutilise les étapes de `Update` (AutoNumber immuable, unicité de
champ et de paire, `OnUpdate` publié). **`rowVersion` est obligatoire** (400 absent, 409 périmé via
pré-contrôle + `DbUpdateConcurrencyException` en secours).

## Quota, capability, audit

- Quota plan : `MaxCustomRecordViewsPerEntity` (`StudioQuotas.MaxRecordViewsKey`, fallback 20, Free = 20,
  Monthly/Annual ∞) → `Validation.Plan` (400) à la création.
- Capability : `StudioAiCapabilitiesDto.RecordViewsEnabled = EnableStudioRecordViews` (les autres
  drapeaux du programme restent `false`).
- Audit (best-effort, `StudioAudit.SafeLogAsync`, `entityType = "CustomRecordViewDefinition"`) :
  `Studio.RecordView.Created` / `Updated` / `Deleted` / `DefaultSet`. Le PATCH est audité par le cycle de
  vie existant (`OnUpdate`).

## Vues proposées par l'IA (PR 2.4)

L'assistant Studio peut **préparer** des vues enregistrées — jamais les créer sans confirmation :

- **Outil `studio_plan_record_view`** (flux plan → aperçu → confirmation, comme `studio_plan_view`) :
  spec JSON `{ entity, name, mode: "list"|"kanban"|"calendar", columns?, filters?, sort?, groupBy?,
  start?, end?, title?, isDefault? }`. Exposé seulement si `Ollama:EnableStudioAiRecordViewTools`
  **et** `EnableStudioRecordViews` **et** `EnableStudioAiPlanPreview` (capability
  `RecordViewToolsEnabled`) ; `RequiredPermission = Studio.DesignForms` (conception des affichages).
- **`entities[].views[]` des specs système** (≤ 3 par table, `StudioAiSystemSpec.MaxViewsPerEntity`) :
  l'orchestrateur les crée en **passe 4** (après champs/relations/rapport, avant le seed), en relisant
  le schéma réel une fois par table ; l'échec d'une vue est un avertissement, jamais un rollback.
- **Résolution contre le schéma réel** (`StudioAiRecordViewSpec.ResolveAgainstSchema`) : clés
  tolérantes (clé exacte → casse → slug de clé ou de libellé ; `createdAt`/`updatedAt` reconnus) ;
  colonnes inconnues retirées (défaut : 6 premiers champs actifs, borne 25) ; chaque filtre revérifié
  par `RecordViewDefinitionValidator` (opérateur inconnu ou incompatible, valeur mal formée ⇒ retiré) ;
  tri sur champ calculé retiré ; kanban sans champ Select à options ou calendrier sans champ date
  **dégradés en Liste** ; filet final `RecordViewDefinitionValidator.Validate` (repli Liste simple).
  Toute dégradation produit un **avertissement explicite** (résumé d'aperçu et payload d'exécution) —
  jamais d'échec silencieux (R6).
- **Plan `StudioAiPlanKind.RecordView = 5`** : résumé `ForRecordView` (table, mode, colonnes, filtres,
  vue par défaut) reflétant la résolution ; exécution par `StudioAiPlanExecutor.ExecuteRecordViewAsync`
  (relecture du schéma à la confirmation — il a pu changer depuis l'aperçu ; clé `vue_<slug>` suffixée
  `_2`…`_99` en cas de collision). Le validate/from-spec accepte `kind: "RecordView"` quand les trois
  drapeaux sont levés (sinon 400 `Validation.kind`).
- Le prompt StudioBuilder gagne la **règle 13 « VUES »** (seulement quand l'outil est exposé) ;
  `SystemPromptCacheRevision = "v6"`.

## Frontend (PR 2.5)

- **Modèles + service** : `views/studio-record-views.models.ts` (`RecordViewDefinition`, DTO,
  `RECORD_VIEW_LIMITS`, `RECORD_VIEW_PERSISTED_KEYS`, `OPERATORS_BY_TYPE`) et
  `views/studio-record-views.service.ts` (CRUD + `/{id}/default` + `/{id}/run` + `/preview` (4.7v2) +
  `patchRecord` ; écritures avec `createHttpContextSkipGlobalErrorUi()`).
- **Runtime (2.5c)** : piloté par `schema.views` servi sous `custom_records:read` (fail-closed
  serveur quand le drapeau est coupé) ; `studio-record-list` monte le sélecteur
  (`studio-view-switcher`) et le `studio-record-view-runner` (`@switch` Liste / Kanban /
  Calendrier, `previewLimit` pour l'aperçu du concepteur). La conception (« Nouvelle vue » /
  « Modifier la vue ») exige en plus `recordViewsEnabled` + `studio:design_forms`.
- **Concepteur (2.5d)** : `views/studio-record-view-designer.component.ts` (routes
  `d/:key/views/new` et `d/:key/views/:viewId`) — mode Liste (colonnes ≤ 25, filtres via
  `studio-filter-builder`, tris ≤ 3, pagination 1..200, recherche, vue par défaut), sections
  Kanban / Calendrier, **aperçu en direct du brouillon** (v1.1, D-47-22) : le panneau « Aperçu »
  exécute la définition en cours d'édition via `views/preview` dès qu'elle est valide
  (`previewEligible` = `canSave` moins nom/clé), reprogrammée par anti-rebond 300 ms à chaque
  modification de la définition, en création comme en édition ; hint « réservé aux concepteurs »
  sinon (D-47-23). Mapping d'erreurs : 409 création ⇒ clé déjà prise,
  409 édition ⇒ vue périmée + « Recharger », 400 « Limite du plan… » ⇒ quota, autre 400 ⇒ message
  serveur, 404 ⇒ retour liste.
- **E2E (2.5h)** : `e2e/studio-runtime-views.spec.ts` (6 cas, API mockée).

## Réversibilité

Drapeau coupé ⇒ toutes les routes répondent 404 sans effet de bord et `schema.views = []`. La table est
inerte. `Down` supprime la table (perte des vues acceptée en préprod ; en prod, désactiver le drapeau
sans `Down`). `EnableStudioAiRecordViewTools` coupé (avec `EnableStudioRecordViews` actif) ⇒ CRUD manuel
intact, seul l'outil IA disparaît ; les plans `RecordView` déjà créés restent exécutables.
