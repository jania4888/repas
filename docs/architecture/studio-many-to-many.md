# Studio — relations plusieurs‑à‑plusieurs (entités de jonction)

**Date :** 12 septembre 2026 (PR 2.1 du programme « Studio IA », plan maître B‑1)
**Périmètre :** relations N‑N entre tables Studio, portées par des **entités de jonction** ; liste des
relations d'une entité ; unicité de la paire de liens ; filtre serveur exact des enregistrements
(`filterField` / `filterValue`) ; masquage des jonctions dans la navigation. Tout est derrière
`Ollama:EnableStudioManyToMany` (défaut C# `false`, `true` dans `appsettings.json` et
`appsettings.Production.json`).
**Documents liés :** [Doublons et réutilisation](studio-ai-duplicates-and-reuse.md) ·
[QA de l'assistant Studio](../developer/studio-ai-assistant-qa.md) (tests 51–53) ·
[Migrations tenant](../backend-tenant-migrations.md)

---

## 1. Le problème résolu

Le Studio ne connaissait qu'un type de lien : un champ `RelationCustom` porté par une table et
pointant vers une autre (« plusieurs‑à‑un »). Impossible, sans table intermédiaire créée à la main,
d'exprimer « un employé travaille sur plusieurs projets, un projet mobilise plusieurs employés ». La PR
2.1 apporte ce type de lien **sans nouvelle table SQL** : une relation N‑N est une entité Studio
ordinaire, marquée `Kind = Junction`, qui porte exactement deux champs `RelationCustom` requis.

---

## 2. Modèle

### 2.1 `CustomEntityDefinition.Kind`

| Valeur | Sens | Où on la voit |
| --- | --- | --- |
| `Standard` (0 en base, `"Standard"` en JSON) | table métier | partout (nav, écrans, IA) |
| `Junction` (1 en base, `"Junction"` en JSON) | table de liaison d'une relation N‑N | `GET api/studio/entities`, `GET …/relations`, `schema.relations[]` ; **jamais** dans `GET api/studio/nav` |

Colonne `int NOT NULL DEFAULT 0` + index `(TenantId, Kind)` — migration
`20260912130000_AddStudioEntityKind_Tenant` (jumeau idempotent
`docs/runbooks/sql/AddStudioEntityKind_Tenant.idempotent.sql`, snapshot mis à jour à la main).
Toutes les entités existantes restent `Standard`. `CustomEntityDto.Kind` et
`CreateCustomEntityRequest.Kind` sont des paramètres optionnels **en fin de record** : les appels
existants ne changent pas.

### 2.2 Création d'une relation N‑N (`CreateManyToManyRelationCommand`)

`POST api/studio/entities/{id}/relations/many-to-many` (policy `StudioDesignEntities`), corps
`CreateManyToManyRelationRequest { targetEntityId, label?, junctionKey?, junctionDisplayName?,
junctionAttributeLabel? }` (le dernier champ est ajouté en **fin** de DTO pour préserver le
constructeur positionnel — v1.1, D‑47‑40).

Le handler **compose les commandes existantes** (`CreateCustomEntityCommand`, `CreateCustomFieldCommand`)
plutôt que d'écrire directement dans les dépôts, pour bénéficier des mêmes validations, quotas et
audits :

1. Gardes : tenant présent (`Unauthorized`), source trouvée (`CustomEntity.NotFound`), cible
   trouvée et distincte (`Validation.target`), ni la source ni la cible ne sont des jonctions
   (`Validation.source` / `Validation.target`), quota d'entités (`StudioQuotas.MaxEntitiesKey`).
2. Clé de jonction : `junctionKey` explicite (slugifiée) ou `{source}_{target}` ; en collision, la clé
   par défaut est suffixée `_2` … `_9`, une clé **explicite** en collision renvoie `Conflict` (409).
   Le dialogue propose la même clé par défaut `{source}_{target}` **sans préfixe** (4.6e, D-46-09 — le
   préfixe de repli `v_`, réservé aux vues, n'est plus utilisé ; les jonctions `v_*` existantes restent
   valides, aucune migration).
   Nom : `junctionDisplayName` ou « Source – Cible » ; icône `link` ; `SystemId` = celui de la source.
3. Deux champs `RelationCustom` **requis, non uniques**, clés = clés des entités liées
   (`employes`, `projets`) ; `_ref` si la clé est réservée (`id`…), `_a` / `_b` pour un auto‑lien
   (source == cible n'est pas permis aujourd'hui, la règle protège l'avenir).
3bis. **Attribut de liaison optionnel** (v1.1, D‑47‑40) : si `junctionAttributeLabel` est non vide,
   un **troisième** champ `Number` (non requis, non unique, sans règles) est créé **après** les deux
   champs de liaison, dans le même périmètre de compensation. Sa clé = `StudioKey.Slugify(label)`
   (« Quantité » ⇒ `quantit`) ; la garde a lieu **avant toute écriture** : label vide après trim,
   clé de forme invalide, clé réservée (`id`…), ou collision avec l'une des deux clés de liaison
   (casse ignorée) ⇒ `400 Validation.junctionAttributeLabel`. La réponse embarque
   `attributeField?: CustomFieldDto` (dernier champ du DTO, `null` en v1). `FieldCount` de la
   jonction passe à 3. L'audit `Studio.Relation.ManyToManyCreated` porte `junctionAttributeKey`.
4. Best‑effort : `IJsonIndexManager.EnsureFieldIndexAsync` sur les deux clés de champ (colonne calculée
   `jx_<clé>` + index) — un échec est journalisé, jamais remonté.
5. Compensation : si le second champ échoue, la jonction est supprimée
   (`DeleteCustomEntityCommand`) et l'erreur d'origine est renvoyée ; aucun audit ni index.
6. Audit `Studio.Relation.ManyToManyCreated` (entité `CustomEntity`, id de la jonction).

Réponse : `ManyToManyRelationDto { junction: CustomEntityDto (Kind = Junction), sourceField,
targetField, attributeField? }`.

### 2.3 Lecture des relations (`ListEntityRelationsQuery`, `EntityRelationResolver`)

`GET api/studio/entities/{id}/relations` renvoie `EntityRelationDto[]` — la même projection est
embarquée dans `GET api/studio/records/{entityKey}/schema` (`schema.relations[]`, `[]` si le drapeau
est off), pour que l'écran d'enregistrement n'ait qu'un appel à faire.

| `kind` | Signification depuis l'entité demandée | `fieldId` |
| --- | --- | --- |
| `many_to_one` | un champ `RelationCustom` de l'entité pointe vers `target` | le champ porté par l'entité |
| `one_to_many` | une autre entité **standard** porte un champ qui pointe vers l'entité | le champ de l'autre entité |
| `many_to_many` | une jonction porte un champ vers l'entité et un vers `target` | le champ de la jonction qui pointe vers l'entité ; `junctionTargetFieldId` = celui qui pointe vers `target` |

Le résolveur lit les entités actives du tenant puis **tous** les champs `RelationCustom` du tenant en
**une seule** requête (`ICustomFieldRepository.ListByTypeAsync`) — le schéma est chargé à chaque
ouverture de formulaire/table, un N+1 par entité y serait intenable. Les champs inactifs et les cibles
inconnues sont ignorés. `GET api/studio/entities/{id}/relations` sur une **jonction** ne renvoie rien :
ses deux `many_to_one` ne sont pas exposés (la relation se lit depuis une extrémité standard).

La création d'une jonction est **réservée** à la commande N‑N : `CreateCustomEntityCommand` porte un
sceau interne `AllowJunction` (non exposé par le DTO) ; toute requête `{"kind":"Junction"}` directe sur
`POST api/studio/entities` reçoit `400 Validation.kind`. La compensation couvre aussi les **exceptions**
levées entre la création de la jonction et celle du second champ (soft delete avec un jeton neutre,
puis relance). La clé de jonction est résolue contre les définitions **soft-deleted** (`KeyExistsAsync
…, includeDeleted: true`) : l'index unique `(TenantId, Key)` n'étant pas filtré, une clé supprimée
reste verrouillée — d'où le repli `_2…_9`.

---

## 3. Unicité de la paire (`record.duplicate_link`)

Une jonction ne doit pas contenir deux fois la même paire (`employes`, `projets`). Le contrôle vit dans
les handlers `Create`/`UpdateCustomRecord`, **après** le validateur et **avant** l'écriture :

- `JunctionPairChecker.ResolvePairFields` : les deux premiers champs `RelationCustom` actifs par
  `SortOrder` ; `null` (contrôle sauté) si l'entité n'est pas une jonction ou si l'une des deux
  valeurs manque (c'est alors le validateur `IsRequired` qui parle).
- `ICustomRecordRepository.ExistsWithFieldPairAsync(tenantId, entityId, keyA, valueA, keyB, valueB,
  excludeId)` : SQL paramétré, clés validées par `StudioKey.IsValidShape` (sinon `false`),
  lignes soft‑deleted ignorées, `excludeId` = l'enregistrement en cours de mise à jour.
- Échec ⇒ `Error(StudioErrorCodes.RecordDuplicateLink = "record.duplicate_link", "Ce lien existe déjà.")`
  ⇒ **HTTP 409** via `StudioErrorMapping`. Aucune notification de cycle de vie, aucun audit.

Pourquoi pas un index unique SQL ? Les valeurs vivent dans `DataJson` ; un index unique filtré sur
deux colonnes calculées serait fragile (nullabilité, longueur, tenants sans index). Le contrôle
applicatif est **best‑effort face à la concurrence** (deux écritures simultanées peuvent passer) :
acceptable pour un lien métier, documenté comme tel.

> **La « paire » = les deux premiers `RelationCustom` actifs par `SortOrder`.** L'attribut de
> liaison (v1.1) est un champ `Number` créé **après** les deux champs de liaison : il ne fait
> **pas** partie de la paire et l'unicité reste inchangée (couvert par
> `CustomRecordJunctionUniquenessTests`). Une jonction reste
> éditable via son URL dans le concepteur de formulaires : ajouter un champ relation avant les deux
> premiers, ou les réordonner, **déplace silencieusement** la contrainte d'unicité (et l'onglet
> « Liés » lit les mêmes deux champs, tandis que l'attribut affiché = premier champ actif
> **non-relation** par `SortOrder` — le même réordonnancement peut donc changer l'attribut résolu).
> Le designer N‑N devra masquer/verrouiller ces champs (suivi produit, pas de garde technique).

> **Contrat client.** Le type `FactuTrust.API.Controllers.ApiResponse<T>` n'expose pas de propriété
> `code` : le **statut 409** est le seul discriminant de `record.duplicate_link` côté frontend ; le
> message affichable est dans `error`. `Conflict` (concurrence optimiste) renvoie aussi 409 mais sur
> les **nouveaux** endpoints uniquement — `POST/PUT api/studio/records` réservent 409 au doublon de
> lien et gardent 400 pour tout le reste (comportement historique).

---

## 4. Filtre serveur des enregistrements

`GET api/studio/records/{entityKey}?filterField=employes&filterValue=<guid>&search=&page=&pageSize=`

- Les deux paramètres vont ensemble (`Validation.filterField` / `Validation.filterValue` ⇒ 400) ;
  `filterField` doit être un champ **actif** de l'entité ; `filterValue` ≤ 450 caractères
  (`JsonIndexSql.ValueMaxLength`, la borne de la colonne calculée indexée).
- `pageSize` est borné `1..200` **dans le contrôleur** (`Math.Clamp`) ; la garde du handler reste.
- Dépôt (`CustomRecordRepository.ListAsync`) : clé invalide ⇒ page vide sans SQL ; sinon prédicat
  `JSON_VALUE(DataJson, '$.<clé>') = @p0`, **précédé** de `[jx_<clé>] = @p0` quand la colonne indexée
  existe (`IJsonIndexManager.IndexedColumnExistsAsync`, cache mémoire) — le moteur fait alors un
  *seek* sur l'index et vérifie l'égalité exacte sur le JSON. La valeur est toujours un paramètre.
- Le filtre se cumule avec `search` (LIKE sur `DataJson`) et la pagination existante.

---

## 5. Navigation et IA

- `GET api/studio/nav` ne renvoie **jamais** une jonction (ni dans un système, ni à la racine) ; un
  système dont toutes les entités sont des jonctions disparaît de l'arbre. Le garde
  `IsStudioSchemaMissing` reconnaît désormais `Invalid column name 'Kind'` (base non migrée ⇒ nav
  vide au lieu d'un 500).
- `GET api/ai/studio/capabilities` expose `manyToManyEnabled` (câblé sur le drapeau) et fige le
  contrat des cinq booléens suivants (`recordViewsEnabled`, `recordViewToolsEnabled`,
  `systemExportEnabled`, `workflowsEnabled`, `workflowToolsEnabled`), tous `false` jusqu'à leur PR.
- Génération IA d'une relation N‑N : voir §8 (PR 2.2) — pas de nouvel outil `studio_plan_relation`,
  intégré à `studio_plan_system`/`studio_generate_system`.

---

## 5bis. Frontend (PR 2.5)

- **Dialog de création** (2.5f) : `relations/studio-many-to-many-dialog.component.ts` (concepteur de
  table, capability `manyToManyEnabled`) ; section « Relations » de la table (type FR, cible,
  jonction liée). **v1.1 (D‑47‑40)** : champ « Attribut de liaison » actif, envoyé en
  `junctionAttributeLabel` (vide ⇒ `null`).
- **Onglet « Liés »** (2.5e) : `relations/studio-linked-records.service.ts` **compose les endpoints
  CRUD de la jonction** (aucun endpoint « linked » dédié) : liste = `GET records/{jonction}?filterField/
  filterValue`, ajout = `POST records/{jonction}` (409 `record.duplicate_link` en ligne), retrait =
  `DELETE records/{jonction}/{id}` ; `studio-record-form` montre les onglets Fiche / Liés — ⟨cible⟩
  (`shared/studio-record-tabs.component.ts`, contrat réutilisé par 4.4h) uniquement en édition.
  **v1.1 (D‑47‑40)** : la **quantité** (attribut de liaison) est résolue par
  `GET records/{jonction}/schema` — premier champ actif **non-relation** par `SortOrder`, mis en cache
  par jonction (`shareReplay(1)`), 404 ⇒ dégradé silencieux — puis affichée par ligne, saisissable à
  l'ajout et éditable en ligne (`PATCH records/{jonction}/{id}` avec `rowVersion` ; 409 ⇒
  « Modifié entre-temps — liste rechargée. »). Arbitrage n° 5 : le `PATCH` reste gardé par le
  drapeau **`EnableStudioRecordViews`** (historique 4.6) et non par `manyToManyEnabled` — le frontend
  signale l'échec **en ligne** si l'appel répond 404 (l'édition n'est pas masquée à l'avance, comme
  partout ailleurs pour ce drapeau).
- **Puces inline dans la fiche** (v1.1 r4) : `relations/studio-link-chips-editor.component.ts`, monté
  par `studio-record-form` sous la carte du formulaire (`@for (rel of manyToMany())`, **édition
  seulement** — `recordId` requis ; `DynamicFormComponent` n'est pas modifié, une relation N-N n'est
  pas un champ, arbitrage n° 6). Mêmes opérations que l'onglet « Liés » (ajout avec quantité, retrait,
  édition de la quantité au clic), erreurs en ligne dans la carte.
- **Page Relations + diagramme** (2.5g) : `relations/studio-relations-page.component.ts` (N-N
  dédoublonnées par `junctionEntityId`) et `studio-relation-diagram` (SVG en template Angular,
  `DiagramModel`/`toDiagram` — contrat consommé par 3.4e) ; les jonctions sont masquées par défaut
  dans la liste des tables (badge « Jonction »).
- **E2E (2.5h, v1.1)** : `e2e/studio-many-to-many.spec.ts` (5 cas, API mockée) — dont l'ajout avec
  quantité via les puces inline.

## 6. Sécurité

- Isolation tenant sur chaque lecture/écriture (`tenantId` partout, `Unauthorized` sans tenant).
- Policies inchangées : conception `StudioDesignEntities`, données `CustomRecordsRead/Write`.
- SQL : jamais de concaténation de valeur (paramètres) ; les clés de champ passent par
  `StudioKey.IsValidShape` avant d'être insérées dans un chemin `$.<clé>` ou un nom `[jx_<clé>]`.
- Drapeau off ⇒ les deux nouveaux endpoints répondent **404** sans toucher au médiateur ;
  `schema.relations` = `[]` ; aucun autre comportement ne change (tests de non‑régression
  `StudioAiCapabilitiesQueryTests`, `GetStudioNavQueryTests`, contrats des contrôleurs).

---

## 7. Ce que ça ne fait pas (suite du programme)

- Écran de saisie des liens et page « Relations » : **livrés en PR 2.5 (frontend)** — onglet « Liés »
  de la fiche, dialog de création N-N, page `/studio/relations` + diagramme (voir §5bis).
- Pas de suppression/édition d'une relation N‑N par endpoint dédié : on supprime la jonction comme
  toute entité (`DELETE api/studio/entities/{id}`).
- Pas d'unicité SQL stricte de la paire (voir §3).
- Pas d'auto‑lien (source == cible) : refusé `Validation.target`.

---

## 8. Création par l'IA (PR 2.2)

**Écart vs. planification initiale :** pas de nouvel outil `studio_plan_relation` — la relation N‑N
est un tableau `relations[]` optionnel du spec système existant (`studio_plan_system` /
`studio_generate_system`), au même niveau que `entities`/`seed`. Un seul appel d'outil décrit tout le
système, relations comprises.

### 8.1 Spec système : `relations[]`

`{ "kind": "many_to_many", "from": "<ref>", "to": "<ref>", "label"?: string, "junctionName"?: string }`.
Parsé par `StudioAiSystemSpec.ParseRelations` (`FactuTrust.Application/Features/Studio/Ai/StudioAiSystemSpec.cs`) :

- Alias de `kind` acceptés (jamais réémis par la forme canonique) : `n_n`, `nn`, `many-to-many`, `m2m`.
- `from`/`to` doivent référencer deux entités **distinctes** du même spec (auto‑lien ignoré, avec
  avertissement) ; une référence vers une entité inconnue est ignorée (avertissement), jamais un
  rejet franc de tout le spec (contrairement aux champs — cohérent avec « rien ici n'échoue le spec »
  au §2.2).
- Maximum **6 relations** par spec ; au‑delà, les relations excédentaires sont abandonnées avec un
  avertissement (pas de rejet franc).
- Paire `(from, to)` dédupliquée sans tenir compte de l'ordre.
- **Promotion de champ** : un champ typé `many_to_many` (ou alias) avec un `relationTo` n'est pas créé
  comme champ — il devient une relation `relations[]` (dédoublonnée avec les relations explicites).
- `relations` n'apparaît dans la forme canonique (`StudioAiSpecCanonical.CanonicalSystem`) que si la
  liste est non vide ; `label`/`junctionName` sont omis (jamais `null`) quand absents.
- **v1.1 (D‑47‑40, arbitrage n° 8)** : l'attribut de liaison (`junctionAttributeLabel`) n'est
  **pas** exposé au spec IA — la génération d'un attribut de jonction par l'assistant est reportée
  (le champ se saisit au dialogue N-N après génération).

### 8.2 Orchestrateur multi‑passes (`StudioAiSystemOrchestrator`)

La création d'un système passe désormais par **cinq passes** (au lieu d'une boucle unique par
entité), pour que les relations (simples et N‑N) résolvent toujours des clés/ids réels, y compris en
référence en avant (une entité référence une entité déclarée plus loin dans le spec) :

1. **Entités + champs simples** : chaque entité est créée avec ses champs non‑relationnels ;
   `entityKeyMap`/`entityIdMap` (ref → clé/id réels) sont complets à la fin de cette passe.
2. **Champs relation simple** (`RelationCustom`) : résolus via `entityKeyMap`/`entityIdMap`, donc
   sans dégradation même si la cible est déclarée après la source dans le spec.
3. **Jonctions N‑N** : une `CreateManyToManyRelationCommand` par relation de `spec.Relations`, si
   `Ollama:EnableStudioManyToMany` est actif. Drapeau off ⇒ passe marquée `skipped` + avertissement,
   aucune jonction créée. Un échec de jonction individuelle **n'abandonne pas** la construction du
   système (avertissement, `Report(..., "error", ...)`, la passe continue).
4. **Formulaires et rapports** : après que toutes les relations existent, pour que leurs champs
   `relationTo` référencent des tables déjà réellement créées.
5. **Pré‑remplissage des données** (seed) : en tout dernier, pour que les valeurs de relation du seed
   puissent résolver.

Constructeur : `StudioAiSystemOrchestrator(IMediator, ICurrentUser, IStudioQuotaService? quota = null,
OllamaSettings? settings = null)`. Le quota d'entités (`EnsureUnderLimitAsync`) inclut le nombre de
relations N‑N (une jonction = une entité) quand le drapeau est actif.

### 8.3 Payload et aperçu

Le payload de fin de construction gagne un tableau `relations[]` (`from`, `to`, `junctionKey`,
`openUrl`) et le `message` mentionne le nombre de relations créées. L'aperçu structuré
(`StudioAiPlanSummary.ForSystem`) gagne une clé `relations` (toujours un tableau, jamais `null`) et,
si `spec.Relations` est non vide, une étape `relations` listant les tables de liaison.

### 8.4 Prompt

Règle « 3e. RELATION PLUSIEURS‑À‑PLUSIEURS » et exemple dédié (« EXEMPLE système formations »),
émis dans `AiContextBuilder.BuildStudioBuilderSystemPrompt` **uniquement si**
`Ollama:EnableStudioManyToMany` est actif — drapeau off, le modèle ne voit ni la règle ni l'exemple et
continue de proposer des champs `relationTo` plusieurs‑à‑un comme avant. La révision de cache du
prompt (`SystemPromptCacheRevision`) reste `"v5"` : le prompt StudioBuilder est reconstruit à chaque
appel (retour avant `GetCachedStaticSystemPromptAsync`) — le drapeau est donc pris en compte
immédiatement et aucune révision de cache n'est à incrémenter pour cette PR.

