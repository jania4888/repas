# Studio IA — historique, aperçu structuré et rejeu des plans (PR 3.2)

**Date :** 15 septembre 2026 (PR 3.2a — liste enrichie et bascule de garde ; PR 3.2b — constructeurs
purs `StudioAiSeedSampler` / `StudioAiPlanPreviewBuilder` ; PR 3.2c — requête d'aperçu et commande
de rejeu ; PR 3.2d — routes HTTP et contrat).
**Périmètre :** historique paginé des générations, aperçu structuré d'un plan persisté et rejeu
d'un plan en état terminal. Aucune migration, aucun flag nouveau : tout est gardé par
`Ollama:EnableStudioAiPlanPreview` (livré en P0).
**Documents liés :** [Amendements enrichis](studio-ai-amendments.md) ·
[QA de l'assistant Studio](../developer/studio-ai-assistant-qa.md)

---

## 1. Cycle de vie d'un plan

Un plan (`StudioAiBuildPlan`) naît `Pending` (proposé, en attente de validation), passe à
`Executing` à la confirmation (transition protégée par `RowVersion`), puis aboutit à `Completed`
ou `Failed` (avec `ErrorMessage`). L'utilisateur peut l'annuler avant exécution (`Cancelled`) ;
sans confirmation sous **60 minutes** (`StudioAiPlanDefaults.Lifetime`), le plan est présenté et
traité comme `Expired`.

Les statuts **rejouables** (`StudioAiPlanDefaults.ReplayableStatuses` / `IsReplayable`) sont les
quatre états terminaux — `Completed`, `Failed`, `Cancelled`, `Expired` — auxquels s'ajoute un plan
`Pending` **échu** (durée de vie dépassée : il est déjà expiré de fait). Un plan `Pending` encore
valide ou `Executing` n'est jamais rejouable (409).

## 2. Liste enrichie (`GET api/studio/ai/plans`)

L'historique paginé n'expose jamais de spec. Chaque élément (`StudioAiPlanListItemDto`) porte
**14 clés** : les 9 historiques (`id`, `kind`, `status`, `title`, `entityCount`, `createdAt`,
`expiresAt`, `executedAt`, `systemKey`) plus, **ajoutées en fin de record avec défauts** (aucun
appelant existant à modifier) :

| Clé | Défaut | Source |
|---|---|---|
| `errorMessage` | `null` | `plan.ErrorMessage` (échec lisible dans la liste) |
| `openUrl` | `null` | `resultJson.openUrl`, sinon `systemUrl`, sinon repli `/studio/systems/{systemKey}` |
| `relationCount` | `0` | tableau racine `relations[]` du résumé (toujours émis) |
| `viewCount` | `0` | Σ `entities[].viewCount` du résumé — **omis du JSON quand 0** (`WhenWritingDefault`) |
| `replayable` | `false` | calculé serveur (`IsReplayable`, cf. §1) |

Résumé illisible ou absent ⇒ compteurs à 0 (tolérant, jamais d'erreur de liste).

## 3. Aperçu structuré (`GET api/studio/ai/plans/{id}/preview`)

La spec **persistée** est re-parsée et re-projetée en `StudioAiPlanPreviewDto` par le
constructeur pur `StudioAiPlanPreviewBuilder` (aucune écriture, aucun appel LLM, déterministe) :
`entities[]` (champs, `formLayout.sections[].fields[]` en objets `{key, width, labelOverride}`,
vues, `seedCount` + échantillon borné à 3 lignes / 80 caractères), `relations[]`, `amendment`,
`warnings[]`, `duplicates[]`, et `workflows` du DTO d'aperçu qui reste `[]` ; depuis 4.3, le **résumé**
(`summary.workflows[]`) porte les workflows d'un plan `Workflow` (shape figé `{ key, name, entityKey,
entityDisplayName, trigger, stepCount, steps: [{ key, type, label }], isActive }` — le frontend 4.4 le
consomme) et, après confirmation, `resultJson.workflows[]` liste les workflows créés (inactifs). Les flags `EnableStudioManyToMany` / `EnableStudioRecordViews` bornent
relations N-N et vues, comme à la création.

Deux particularités :

- **Amendement dégradé** : le diff est résolu contre le schéma RÉEL de la table cible (relu via
  `GetCustomEntitySchemaQuery`). Table introuvable ou illisible ⇒ aperçu quand même rendu
  (`200`), avec `amendment.degraded: true`, un item par opération demandée (les 12 ops du DSL) et
  l'avertissement figé « Table introuvable : aperçu limité aux opérations demandées. » — jamais
  d'erreur.
- **View / Report / RecordView** : zéro entité ; l'aperçu porte `title` + `warnings` (mode et
  regroupement relus de la spec). Il n'y a **pas de slot `views`** pour un plan RecordView :
  le DTO figé (§12) prime sur la proposition initiale du plan (écart assumé, Journal).

Une spec persistée devenue incanonisable renvoie `400 Validation.spec`.

## 4. Rejeu (`POST api/studio/ai/plans/{id}/replay`)

Rejouer = créer un plan **NEUF** `Pending` à partir de la spec persistée, sans JAMAIS modifier le
plan d'origine. Gardes du handler, dans l'ordre : flag coupé ⇒ `404` « Fonctionnalité non
disponible. » → tenant / propriétaire ⇒ `404` → permission par nature ⇒ `401` → statut non
terminal ⇒ `409` « Seul un plan terminé, échoué, annulé ou expiré peut être rejoué. » →
re-canonicalisation impossible ⇒ `400 Validation.spec`.

La spec re-passe parse → canonicalisation → résumé recalculé (doublons relus contre les tables
actives, schéma réel d'une vue enregistrée rechargé) — aucune confiance au contenu stocké. **E1** :
pour les natures sans résumé recalculé (Amendment / View / Report), le summary persisté sert de
repli. Le résumé du nouveau plan porte `replayedFromPlanId` **à sa racine** (traçabilité, autres
clés intactes). La création est déléguée à `CreateStudioAiPlanCommand` : même permission par
nature, même audit `Studio.AiPlan.Created` (aucune écriture directe de schéma). Réponse `201` avec
`Location: /api/studio/ai/plans/{nouvelId}` — première 201 du contrôleur (E5).

## 5. Flags : `EnableStudioAiPlanPreview` vs `EnableStudioAiWorkbench`

Deux gardes distinctes, deux messages figés, 404 fail-closed dans les deux cas :

| Garde | Flag | Endpoints |
|---|---|---|
| `PlanPreviewUnavailableOrNull` (« Le flux d'aperçu Studio n'est pas activé. ») | `EnableStudioAiPlanPreview` | `GET /` (liste), `POST /cancel-pending`, `GET /{id}/preview`, `POST /{id}/replay`, refus SSE de `POST /{id}/confirm` |
| `WorkbenchUnavailableOrNull` (« Le workbench Studio IA n'est pas activé. ») | `EnableStudioAiWorkbench` | `POST /validate`, `POST /from-spec`, `POST /from-template`, `GET|PUT /{id}/spec` |

La bascule (3.2a) aligne le backend sur le frontend 2.5, dont l'historique est déjà keyed sur
`planPreviewEnabled` : l'historique et le rejeu fonctionnent workbench coupé.

## 6. Sécurité

- **Tenant / propriétaire** : chargement par `StudioAiPlanDefaults.LoadAuthorizedAsync`
  (prédicat `TenantId` + `OwnerId`) — un plan d'un autre tenant ou d'un autre utilisateur est
  introuvable (`404`), jamais une fuite d'existence.
- **Permission revalidée** : par nature de plan (`studio:design_entities` et déclinaisons) à
  chaque lecture d'aperçu et à chaque rejeu, en plus de la politique de classe du contrôleur.
- **Aucune spec dans la liste ni les audits** : l'historique ne porte que des métadonnées ;
  l'audit de création (rejeu inclus) n'émet que `Kind` / `ExpiresAt`.
- **Idempotence** : le rejeu crée toujours un nouveau plan `Pending` à confirmer — rejouer deux
  fois ne ré-applique rien (l'exécution reste derrière la confirmation SSE existante).
