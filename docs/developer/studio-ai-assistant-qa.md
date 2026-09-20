# Studio AI Assistant — QA checklist

## Feature flags

| Drapeau (config serveur `Ollama:*`) | Défaut code | Prod initiale | Rôle |
|---|---|---|---|
| `EnableMutationTools` | `true` (dev) | `false` | Doit être `true` pour toute génération de table/système. |
| `EnableStudioAiTools` | `true` | `true` | Interrupteur maître des outils `studio_*`. |
| `EnableStudioSystemGeneration` | `true` | `false` | `studio_generate_system` (multi-tables). |
| `EnableStudioAiPlanPreview` | **`false`** | `false` | Flux **plan → aperçu → confirmation**. Substitue `studio_plan_*` à `studio_generate_*`. |
| `EnableStudioAiModifyTools` | **`false`** | `false` | Modification de l'existant (`studio_plan_changes`, `studio_get_table_schema`). Sans effet si l'aperçu est off. |
| `EnableStudioAiViewTools` | **`false`** | `false` | Fenêtres sur tables réelles (`studio_plan_view`, `studio_list_sql_tables`). Sans effet si l'aperçu est off. |
| `EnableStudioReportPdf` | `true` | `true` | Coupe-circuit de l'impression PDF des états Studio. |
| `EnableStudioSqlReportEngine` | **`false`** | `false` | Moteur d'ÉTATS sur les tables réelles (concepteur humain **et** IA). |
| `EnableStudioAiReportTools` | **`false`** | `false` | Outils `studio_*_report` de l'assistant. Sans effet si le moteur est off. |
| `EnableStudioReportShortcut` | **`false`** | `false` | Raccourci DÉTERMINISTE : une demande d'état non ambiguë est exécutée AVANT l'appel au modèle. Rend le résultat indépendant du modèle configuré. |
| `EnableStudioSqlSourceGuard` | **`false`** | `false` | Étend le classement par domaine aux FENÊTRES. Passer le runbook d'impact d'abord. |
| `EnableStudioAiAdvancedModel` | **`false`** | `true` | Bascule « Modèle avancé » par requête (`options.useAdvancedModel`). Sans effet tant qu'aucun modèle Studio avancé n'est configuré en back-office. |
| `EnableStudioAiSchemaDigest` | **`false`** | `true` | Digest du schéma existant + dernier plan dans le prompt StudioBuilder (vraies clés). Budgets : `StudioSchemaDigestMaxCharsCpu` 1200 / `StudioSchemaDigestMaxCharsAdvanced` 4000 / `StudioLastPlanDigestMaxChars` 600. |
| `EnableStudioManyToMany` | **`false`** | `true` | Relations plusieurs-à-plusieurs (entités de jonction `kind: "Junction"`) : `GET/POST api/studio/entities/{id}/relations[/many-to-many]`, `schema.relations[]`, unicité de la paire (`409 record.duplicate_link`), filtre serveur `filterField`/`filterValue`. Off ⇒ 404 sur les deux endpoints, `relations: []`, aucun autre changement. |

> Les drapeaux en gras sont **off par défaut** : sans eux, le comportement du Studio IA est
> strictement celui d'avant (gardes couvertes par `StudioAiPlanCatalogTests` et
> `StudioAiReportToolsTests`).

Bornes associées : `StudioReportMaxRows` (défaut 5 000, plafond dur 50 000) et
`StudioReportCommandTimeoutSeconds` (défaut 30).

## Smoke tests — comportement historique (tous drapeaux off)

1. `/studio/ai` — prompt sans « créer » : une table simple est créée.
2. Prompt multi-tables : système avec relations + données de référence.
3. La barre latérale affiche le système groupé avec ses tables.
4. `/studio/systems/{key}` : la page hub se charge.
5. `/ai-assistant` général : inchangé.

## Génération enrichie (aucun drapeau requis)

6. « Crée un système de contrats avec un formulaire sur deux colonnes et un état des contrats actifs
   trié par date » ⇒ vérifier dans le **concepteur de formulaire** que les champs courts sont en
   demi-largeur (`half`) et les libellés personnalisés repris ; dans le **concepteur d'état**, que
   les filtres et le tri sont présents (et pas seulement le regroupement).
7. Rétro-compatibilité : un `spec_json` de l'ancien format (champs de formulaire en simples chaînes,
   rapport avec `groupBy`/`measures` seulement) produit exactement le même résultat qu'avant.

## Aperçu et confirmation (`EnableStudioAiPlanPreview=true`)

8. Prompt de création ⇒ une **carte d'aperçu** s'affiche (Modèle de données / Formulaires / États /
   Données de référence) et **rien n'est créé** : vérifier en base que la table n'existe pas encore.
9. « Annuler » ⇒ aucun objet créé, le plan passe `Cancelled`, le compositeur est déverrouillé.
10. « Valider et créer » ⇒ les étapes de construction s'affichent **une par une** (progression live,
    et non d'un bloc en fin d'exécution), puis la barre latérale se rafraîchit.
11. Double-clic sur « Valider » ⇒ une seule création (verrou `RowVersion`), la seconde requête est
    rejetée proprement.
12. Attendre > 60 min puis valider ⇒ message « Ce plan a expiré », rien n'est créé.
13. Le modèle ne doit **jamais** annoncer que les tables sont créées avant validation (règle 7 du
    prompt) : relire le texte de la réponse.

## Modification de l'existant (`EnableStudioAiPlanPreview` + `EnableStudioAiModifyTools`)

14. « Ajoute un champ Motif de refus sur la table Contrats » ⇒ l'aperçu montre `Ajouter « Motif de
    refus »` avec son type ; après validation, le champ apparaît dans le formulaire.
15. « Retire le champ X de la table Contrats » ⇒ l'aperçu affiche un avertissement orange
    « les valeurs déjà saisies sont CONSERVÉES » ; après validation, **ouvrir un enregistrement
    existant et vérifier que sa donnée est toujours en base** (le champ est désactivé, pas supprimé).
16. Cibler un champ inexistant ⇒ l'opération disparaît de l'aperçu avec un avertissement, elle n'est
    pas annoncée puis échouée silencieusement.
17. Demander la suppression d'une table ou d'un système ⇒ impossible (hors liste blanche) : le modèle
    doit le dire, aucun outil ne le permet.
18. Échec partiel (ex. quota de champs atteint sur un ajout) ⇒ les autres opérations s'appliquent
    quand même et le rapport final liste ce qui a été ignoré.

## Fenêtres sur données existantes (`EnableStudioAiPlanPreview` + `EnableStudioAiViewTools`)

19. « Crée une fenêtre sur les factures avec date, client et total » ⇒ l'aperçu liste la table source
    et les colonnes ; après validation, la fenêtre est identique à ce que produirait le concepteur.
20. Demander une table de la liste de refus (`SqlSchemaGuard.DeniedTables`) ⇒ refus explicite.
21. Demander une colonne inexistante ⇒ elle est écartée avec un avertissement, jamais inventée.
22. Vérifier qu'une fenêtre reste en **lecture seule** : aucun bouton d'écriture sur le runner.

## États PDF (`EnableStudioReportPdf=true`)

23. Ouvrir un état **groupé** (`/studio/reports/{id}`) ⇒ « Imprimer (PDF) » ouvre un PDF avec
    en-tête société, filtres/tri résumés, colonnes mesure alignées à droite et bande de totaux.
24. Ouvrir un état de **détail** (sans regroupement) ⇒ colonnes projetées, dates au format `dd/MM/yyyy`,
    montants au format tunisien (`30 000.000`).
25. État **sans donnée** ⇒ PDF valide affichant « Aucune donnée pour cet état » (pas d'erreur 500).
26. État à plus de 6 colonnes ⇒ bascule automatique en paysage.
27. Drapeau à `false` ⇒ l'endpoint renvoie 404 et le bouton n'aboutit pas.

## États sur les tables réelles (`EnableStudioSqlReportEngine` + `EnableStudioAiReportTools`)

> Architecture et modèle de sécurité : [`docs/architecture/studio-ai-reports.md`](../architecture/studio-ai-reports.md).

### Non-régression (drapeaux à `false`)

28. `/studio/ai` — « Crée une table Fournisseurs avec nom, ville, téléphone » ⇒ comportement identique
    à avant. Le catalogue d'outils ne contient AUCUN `studio_*_report`.
29. `/studio/reports` — les états existants (tables personnalisées et sources historiques) se relancent
    et s'impriment à l'identique ; le sélecteur de source ne propose que « Mes tables » et
    « Données existantes ».

### Fonctionnalité (drapeaux à `true`)

30. « Crée un rapport avancé des ventes de produits pour ce trimestre » ⇒ un **tableau s'affiche dans
    la conversation** (produit, quantité, CA, TVA) avec bascule Graphique et export CSV/XLSX.
    **Plus aucun message « Je n'ai pas pu lancer la création du système ».**
31. **Contrôle croisé obligatoire** : comparer les montants au point 30 avec
    `/reports/sales-by-line` sur la même période ⇒ **égalité au millime**. C'est le test qui valide le
    moteur ; il ne se contourne pas. (Le préréglage reprend le prédicat de
    `GetSalesRevenueAggregatedAsync` : factures `Validated` ou `Paid`.)
32. « Enregistrer comme état » ⇒ carte d'aperçu montrant un **échantillon de vraies lignes** ⇒
    « Valider et enregistrer » ⇒ l'état apparaît dans `/studio/reports`, se relance et s'imprime en PDF.
33. Ouvrir cet état dans le concepteur (`/studio/reports/{id}`) ⇒ source, regroupement, mesures et
    filtres sont modifiables comme pour n'importe quel état Studio.
34. « Ventes par mois de cette année » ⇒ regroupement calendaire correct (une ligne par mois, triée
    chronologiquement).
35. Demander un état de **paie** avec un compte sans `payroll:read` ⇒ refus explicite, **aucune donnée
    affichée** ; le sélecteur de source du concepteur ne montre pas non plus le domaine « Paie & RH ».
36. Demander une colonne inexistante ⇒ écartée avec un avertissement dans l'aperçu, jamais inventée.
37. Demander à croiser deux tables sans clé étrangère (ex. lignes de facture × salariés) ⇒ refus
    explicite mentionnant l'absence de lien.
38. État de **détail** dépassant `StudioReportMaxRows` ⇒ bandeau orange de troncature dans l'interface
    **et** ligne d'avertissement dans le PDF ; l'état **agrégé** équivalent affiche des totaux exacts
    (revérifier contre le point 31).
39. Double-clic sur « Valider et enregistrer » ⇒ une seule création (verrou `RowVersion`).
40. Le modèle ne doit **jamais** annoncer que l'état est enregistré avant validation de l'aperçu.

### Raccourci déterministe (`EnableStudioReportShortcut`)

Le modèle Studio n'émet pas toujours d'appel d'outil — un modèle de *code* n'en émet presque jamais.
Le raccourci reconnaît la demande et exécute l'état lui-même. Vérifier :

42. « créer un rapport détaillé de ventes d'articles » (sans période) ⇒ tableau affiché, **période
    annoncée en clair** dans la réponse (défaut : année en cours).
43. « ventes par client ce trimestre » ⇒ bon préréglage **et** bonne période.
44. « crée une table Rapports avec les champs titre et date » ⇒ **aucun** raccourci d'état ; le flux
    de création de table est intact. C'est le faux positif à ne jamais accepter.
45. « fais-moi un rapport de licornes » ⇒ message adapté à l'intention (« Je n'ai pas pu préparer cet
    état… ») **et** des suggestions cliquables, jamais « créer ce système ».

**Signature de bon fonctionnement dans les logs** (`src/Backend/FactuTrust.API/logs/factutrust-<date>.log`) :

```bash
Select-String -Path src/Backend/FactuTrust.API/logs/factutrust-20260816.log -Pattern "phase=total_request" | Select-Object -Last 3
```

Attendu : `tools_executed_this_request=1` et `content_chars_persisted>0`. La signature d'échec —
`final_response_meaningful=true` **avec** `content_chars_persisted=0` et `content_chars_streamed=0` —
doit avoir disparu. Le chemin d'échec est désormais nommé : `studio_silence_fallback`.

## Contexte et modèle avancé (`EnableStudioAiSchemaDigest` + `EnableStudioAiAdvancedModel`)

> Architecture : [`docs/architecture/studio-ai-context-and-advanced-model.md`](../architecture/studio-ai-context-and-advanced-model.md) §6–7.
> Prérequis : au moins une table Studio existante (ex. `fournisseurs`) ; pour 47–48, un modèle Studio
> avancé configuré en back-office (Configuration IA) et distinct du modèle standard.

46. `EnableStudioAiSchemaDigest=true` — « ajoute un champ téléphone à la table Fournisseurs » ⇒ le plan
    proposé cible la **clé réelle** `fournisseurs` (jamais `fournisseur`, `suppliers` ni une nouvelle
    table). Point d'arrêt (ou trace temporaire) sur
    `AiContextBuilder.BuildStudioBuilderSystemPrompt` : le prompt contient `SCHÉMA EXISTANT (tables Studio de ce
    client) :` suivi d'une ligne `- fournisseurs « Fournisseurs » : …` et la règle **11**. Aucune
    valeur d'enregistrement n'apparaît. Après création d'une table, elle figure dans le digest au tour
    suivant (cache 30 s au plus).
47. `EnableStudioAiAdvancedModel=false`, requête envoyée avec `options.useAdvancedModel=true` (bascule
    active dans l'atelier ou corps forgé) ⇒ la réponse arrive **normalement** sur le modèle standard ;
    le flux SSE contient un événement `type:"meta"` avec `usedAdvancedModel:false` et
    `advancedModelFallbackReason:"disabled"` ; le log API contient `Studio advanced model requested but
    disabled`. **Jamais** de `400` ni d'événement `error`. Variante : drapeau `true` mais réglage
    back-office vide ⇒ `"not_configured"` ; modèle avancé Ollama non installé ⇒ `"unavailable"` et
    réponse sur le standard.
48. `EnableStudioAiAdvancedModel=true` + modèle avancé configuré, `options.useAdvancedModel=true` sur
    « crée un système de gestion de projets avec projets, tâches et jalons liés » ⇒ `meta` porte
    `usedAdvancedModel:true` et `model` = identifiant du modèle avancé ; le log `phase=provider_availability`
    cite la référence avancée ; la boucle d'outils dispose de **4** rounds
    (`StudioAdvancedMaxToolCallRounds`) — jusqu'à quatre phases `llm_stream_round` dans le flux et
    `tool_rounds_executed` dans la ligne `phase=total_request` du log — au lieu du plafond CPU ; la
    même demande sans la bascule repart sur le modèle standard (`usedAdvancedModel:false`, raison
    `null`). Cas limite : si le modèle avancé est un modèle **Ollama** et que le moteur tourne en
    **CPU seul**, le plafond CPU reste appliqué (le budget avancé est réservé au GPU / cloud).

## Doublons et réutilisation de tables (`existingKey`)

> Architecture : [`docs/architecture/studio-ai-duplicates-and-reuse.md`](../architecture/studio-ai-duplicates-and-reuse.md).
> Prérequis : au moins une table Studio existante (ex. `employes` « Employés »). Aucune clé de
> fonctionnalité nouvelle : tout se joue sous `Ollama:EnableStudioAiPlanPreview`.

49. **Bandeau doublon** — « crée un système RH avec une table Employés (nom, poste) et une table
    Demandes » ⇒ l'aperçu du plan affiche la table « Employés » signalée comme **doublon** de la
    table existante `employes` (`summary.duplicates[]` non vide, `reason` = `same_key` /
    `same_name` / `singular_plural`) et un avertissement en clair proposant la réutilisation. Le
    plan reste confirmable tel quel (la table serait recréée sous une clé suffixée) : le signalement
    n'est jamais un blocage. Contre-exemple : « crée une table Contrats » avec `contrats_cadres`
    existante ⇒ **aucun** bandeau (jamais de rapprochement par préfixe).
50. **Réutilisation via `existingKey`** — « crée un système de congés qui s'appuie sur la table
    employes existante et ajoute une table Demandes de congés liée » ⇒ l'aperçu affiche l'étape
    « Tables réutilisées : 1 » ; à la confirmation, l'exécution **ne crée ni ne modifie** la table
    `employes` (aucun appel de création de table/champ/formulaire/état pour elle), la relation de
    « Demandes de congés » pointe vers la clé réelle `employes`, et le payload final distingue
    `createdCount` / `reusedCount`. Cas d'échec : une spec forgée avec `existingKey` inconnu ou
    inactif ⇒ l'exécution échoue **avant** toute création (pas même le système), avec un message qui
    ne cite que la clé demandée. Un lot `seed` visant la table réutilisée est ignoré avec un
    avertissement — jamais d'écriture dans une table existante.



### Avant d'activer `EnableStudioSqlSourceGuard`

41. Exécuter [`docs/runbooks/sql/studio-views-affected-by-guard.sql`](../runbooks/sql/studio-views-affected-by-guard.sql)
    sur chaque base tenant. `FenetresActivesCassees = 0` ⇒ activation sans impact ; sinon, reclasser
    la table ou retirer la fenêtre avant de basculer.

## Relations plusieurs-à-plusieurs (`Ollama:EnableStudioManyToMany`)

> Architecture : [`docs/architecture/studio-many-to-many.md`](../architecture/studio-many-to-many.md).
> Prérequis : migration tenant `20260912130000_AddStudioEntityKind_Tenant` appliquée ; deux tables Studio
> existantes (ex. `employes` « Employés » et `projets` « Projets »), un compte avec la permission de
> conception (`StudioDesignEntities`). Tant qu'aucun écran n'existe (PR 2.5), les appels se font avec
> Swagger / `curl` (jeton porteur du compte).

51. **Création manuelle d'une relation N-N** — `POST api/studio/entities/{idEmployes}/relations/many-to-many`
    corps `{ "targetEntityId": "<idProjets>" }` ⇒ `200` avec `data.junction.key = "employes_projets"`,
    `data.junction.kind = "Junction"` (enum sérialisé en chaîne, stocké `1` en base), `data.sourceField.key = "employes"`, `data.targetField.key = "projets"`,
    les deux champs `isRequired: true`, `isUnique: false`, `relation.kind = "custom"`. Puis
    `GET api/studio/entities/{idEmployes}/relations` ⇒ une entrée `kind: "many_to_many"` dont
    `targetEntityKey = "projets"`, `junctionEntityKey = "employes_projets"` ; `GET api/studio/records/employes/schema`
    ⇒ la même entrée dans `data.relations[]` ; `GET api/studio/entities` liste la jonction avec `kind: "Junction"`.
    Table d'audit : une ligne `Studio.Relation.ManyToManyCreated`. Rejouer le même `POST` ⇒ `200` avec
    `employes_projets_2` ; le rejouer avec `"junctionKey": "employes_projets"` ⇒ `409`. Cas d'erreur :
    `targetEntityId` = source ⇒ `400` ; cible = une jonction ⇒ `400` ; drapeau `false` ⇒ `404` sur les deux
    endpoints et `data.relations = []` sur le schéma, sans autre effet.
52. **Doublon de paire** — `POST api/studio/records/employes_projets` avec
    `{ "data": { "employes": "<idEmp1>", "projets": "<idProj1>" } }` ⇒ `200` ; le **même** corps une seconde
    fois ⇒ **`409`** avec `error = "Ce lien existe déjà."` (code interne `record.duplicate_link` : le statut 409 est
    le discriminant côté client). Paire croisée (`<idEmp1>`, `<idProj2>`) ⇒ créée. `PUT` du second lien vers la
    paire du premier ⇒ `409` ; `PUT` du premier lien sur lui-même (mêmes valeurs) ⇒ `200` (auto-exclusion).
    Corps incomplet (`employes` seul) ⇒ `400` **du validateur** (`isRequired`), pas 409. Supprimer le premier lien
    puis rejouer sa paire ⇒ créée (les lignes supprimées ne comptent pas). Sur une table standard, aucun contrôle
    de paire.
53. **Filtre serveur et navigation** — `GET api/studio/records/employes_projets?filterField=employes&filterValue=<idEmp1>`
    ⇒ seuls les liens d'`<idEmp1>` (`totalCount` exact, cumulable avec `search` et `page`/`pageSize`) ;
    `pageSize=500` ⇒ 200 lignes au plus ; `filterField` seul ou `filterValue` seul ⇒ `400` ; `filterField=inexistant`
    ⇒ `400` ; `filterValue` de 451 caractères ⇒ `400`. Trace SQL (profiler ou log EF `CommandExecuted`) : le
    prédicat est `JSON_VALUE(DataJson, '$.employes') = @p0` — précédé de `[jx_employes] = @p0` si la colonne
    indexée existe — jamais la valeur en clair. `GET api/studio/nav` ⇒ `employes` et `projets` sont présents,
    `employes_projets` **absent** (dans un système comme à la racine) ; la sidebar Studio ne change pas.
54. **Génération IA d'un système avec relation N-N** (`Ollama:EnableStudioManyToMany=true`,
    `EnableStudioAiPlanPreview=true`) — demander à l'atelier IA « un système de formations : employés,
    formations, et un employé peut suivre plusieurs formations ». `studio_plan_system` ⇒ le `spec_json`
    contient `"relations": [{ "kind": "many_to_many", "from": "employes", "to": "formations" }]` et
    **aucun** champ `relationTo` many_to_many sur les entités ; l'aperçu (`GET .../plans/{id}/preview`
    ou SSE) affiche une étape « Relations plusieurs-à-plusieurs » nommant la table de liaison.
    Confirmer le plan ⇒ le système est créé en cinq passes (entités/champs simples, champs relation
    simple, jonctions N-N, formulaires/rapports, données) ; `GET api/studio/entities/{idEmployes}/relations`
    ⇒ une entrée `kind: "many_to_many"` vers `formations` ; le payload de fin de construction contient
    `relations: [{ from: "employes", to: "formations", junctionKey, openUrl }]`. Drapeau
    `EnableStudioManyToMany=false` ⇒ le même prompt ne propose jamais `relations[]` (règle 3e absente du
    prompt) ; si le spec en contient malgré tout (rejoué depuis un aperçu antérieur), la passe jonctions
    est marquée « ignorée » et un avertissement `"Relations N-N non activées (Ollama:EnableStudioManyToMany)."`
    apparaît dans le résultat, sans bloquer la création des tables/champs simples.
55. **Référence en avant et tolérance des relations invalides** — un spec où l'entité `contrats`
    déclare un champ `relation` vers `clients` alors que `clients` est décrite **après** `contrats` dans
    `entities[]` ⇒ la relation résout la vraie clé de `clients` (pas de dégradation en `Text`, grâce aux
    passes 1→2 de l'orchestrateur). Une relation `relations[]` vers une entité inconnue, un auto-lien
    (`from == to`), une paire dupliquée (peu importe l'ordre), ou une 7ᵉ relation au-delà du maximum de 6
    ⇒ ignorés avec un avertissement dans le résultat, **jamais** un rejet franc de tout le spec (à la
    différence d'un champ invalide, qui rejette l'entité).

## Vues enregistrées (`Ollama:EnableStudioRecordViews`)

> Architecture : [`docs/architecture/studio-record-views.md`](../architecture/studio-record-views.md).
> Les cas 60–62 (vues **proposées par l'IA**) exigent en plus `Ollama:EnableStudioAiRecordViewTools: true`
> et `Ollama:EnableStudioAiPlanPreview: true` — capability `recordViewToolsEnabled`.
> Prérequis : migration tenant `20260912140000_AddStudioRecordViews_Tenant` appliquée ; une table Studio
> existante `interventions` (champs `nom` Text, `statut` Select avec options `encours`/`termine`, `debut` Date,
> `montant` Money) alimentée d'enregistrements, un compte avec `StudioDesignForms` (conception) et
> `CustomRecordsRead` (lecture/exécution). Les appels se font avec Swagger / `curl`.

56. **Vue Liste filtrée et triée côté serveur** — `POST api/studio/records/interventions/views` corps
    `{ "key": "en_cours", "displayName": "En cours", "mode": "List", "definition": { "columns": [{ "fieldKey": "nom" }], "filters": [{ "fieldKey": "statut", "op": "eq", "value": "encours" }], "sort": [{ "fieldKey": "debut", "descending": true }], "searchEnabled": true, "pageSize": 25 } }` ⇒ `201` avec
    `data.key = "en_cours"`, `data.mode = "List"` (enum sérialisé en chaîne), `data.isDefault = true` (première
    vue de la table), un `rowVersion` base64 ; la définition est re-validée (filtre `gt` sur `nom` Text ⇒ `400
    Validation.filters`). Puis `POST api/studio/records/interventions/views/{id}/run` corps `{ "page": 1 }` ⇒
    `200` : `data.items[]` ne contient que les `statut = "encours"`, triés par `debut` décroissant,
    `data.total` exact, `data.truncated = false`. `pageSize > 200` ⇒ `400 Validation.pageSize`.
    `GET api/studio/records/interventions/views` ⇒ la vue en tête (défaut d'abord) ;
    `GET api/studio/records/interventions/schema` ⇒ `data.views[]` la contient. Trace SQL : le `WHERE` est
    paramétré (`@t`, `@e`, `@p0`), jamais la valeur en clair, et `SELECT r.*, COUNT(*) OVER()`.
57. **Kanban groupé + borne 500** — `POST …/views` avec `"mode": "Kanban"`, `"kanban": { "groupByFieldKey": "statut", "titleFieldKey": "nom", "showEmptyGroup": true }` ⇒ `201` (un kanban sur un
    champ non-`Select` ⇒ `400 Validation.kanban`). `POST …/views/{id}/run` ⇒ `200` avec `data.groups[]`
    **ordonnés** selon les options (`encours`, `termine`), puis un groupe `{ "value": null, "label": "Sans valeur" }`
    pour les lignes sans statut ; chaque groupe a `count` et `items[]`. Avec plus de 500 enregistrements ⇒
    `data.truncated = true` (au plus 500 cartes chargées, `total` exact). `showEmptyGroup: false` masque les
    colonnes vides.
58. **PATCH partiel avec RowVersion** — `PATCH api/studio/records/interventions/{id}` corps
    `{ "data": { "statut": "termine" }, "rowVersion": "<rowVersion de l'enregistrement>" }` ⇒ `200` : seules
    les clés fournies changent (les autres, dont l'`AutoNumber`, sont conservées), `data.statut = "termine"`.
    Rejouer le **même** corps avec l'ancien `rowVersion` ⇒ `409` (`Conflict`). Corps sans `rowVersion` ⇒
    `400 Validation.rowVersion`. Clé inconnue ou calculée (`Formula`/`Lookup`/`Rollup`/`AutoNumber`) dans
    `data` ⇒ `400 Validation.data` ; `null` sur une clé optionnelle l'efface. La mise à jour déclenche
    l'événement d'automatisation `OnUpdate` existant.
59. **Drapeau coupé** — `EnableStudioRecordViews: false` ⇒ `GET/POST …/views`, `GET/PUT/DELETE …/views/{id}`,
    `POST …/views/{id}/default`, `POST …/views/{id}/run` et `PATCH …/records/{entityKey}/{id}` répondent tous
    `404` **sans effet de bord** ; `GET api/studio/records/interventions/schema` ⇒ `data.views = []` ;
    `GET api/ai/studio/capabilities` ⇒ `recordViewsEnabled: false`. La table `CustomRecordViewDefinitions`
    reste inerte (migration additive).

60. **Vue kanban proposée par l'IA** — `POST api/studio/ai/plans/from-spec` corps
    `{ "kind": "RecordView", "specJson": "{\"entity\":\"interventions\",\"name\":\"Par statut\",\"mode\":\"kanban\",\"groupBy\":\"statut\"}" }`
    ⇒ `200`, `summary.kind = "RecordView"`, étape `mode` = « Kanban », table cible « Interventions » ;
    `POST api/studio/ai/plans/{id}/confirm` ⇒ le résultat porte `openUrl = "/studio/d/interventions?view=<id>"` ;
    `GET api/studio/records/interventions/views` liste la clé `vue_par_statut` en mode `Kanban`. Un compte
    sans `StudioDesignForms` ⇒ `403` à la confirmation (la vue relève de la conception des affichages).
61. **Calendrier dégradé en liste** — même appel avec
    `"{\"entity\":\"interventions\",\"name\":\"Agenda\",\"mode\":\"calendrier\",\"start\":\"nom\"}"`
    (champ `nom` Text) ⇒ `200` avec résumé étape `mode` = « **Liste** » et `warnings[]` contenant
    « Calendrier impossible … » ; la confirmation crée une vue **Liste** (jamais un échec, jamais une
    promesse de calendrier impossible).
62. **Trois vues max par table dans un système** — spec système (`studio_plan_system` ou workbench)
    avec 4 `views` sur une même entité ⇒ résumé `viewCount = 3` + avertissement « Au plus 3 vues par
    table » ; la confirmation montre la progression `creating_views` ×3. Avec
    `EnableStudioAiRecordViewTools: false` ⇒ étape `creating_views` `skipped` + avertissement,
    `GET api/ai/studio/capabilities` ⇒ `recordViewToolsEnabled: false`, l'outil
    `studio_plan_record_view` est absent du catalogue, et `from-spec` avec `kind: "RecordView"` ⇒
    `400 Validation.kind` (« Les vues enregistrées par l'IA ne sont pas activées. »).

## Migrations

- `20260624181553_AddStudioSystems_Tenant` (systèmes multi-tables).
- `20260728001141_AddStudioAiBuildPlans_Tenant` (plans « aperçu → confirmation »).
  Jumeau idempotent : `docs/runbooks/sql/AddStudioAiBuildPlans_Tenant.idempotent.sql`.
- `20260912130000_AddStudioEntityKind_Tenant` (colonne `CustomEntityDefinitions.Kind`, défaut 0 = Standard,
  index `(TenantId, Kind)` — relations N-N). Jumeau idempotent : `docs/runbooks/sql/AddStudioEntityKind_Tenant.idempotent.sql`.
- `20260912140000_AddStudioRecordViews_Tenant` (table `CustomRecordViewDefinitions`, FK cascade vers
  `CustomEntityDefinitions`, index unique filtré `(TenantId, EntityDefinitionId, Key) WHERE IsDeleted = 0`,
  index `(TenantId, EntityDefinitionId, IsDefault)` — vues enregistrées). Jumeau idempotent :
  `docs/runbooks/sql/AddStudioRecordViews_Tenant.idempotent.sql`.
- `20260912150000_AddStudioWorkflows_Tenant` (4 tables autonomes `StudioWorkflowDefinitions`,
  `StudioWorkflowInstances`, `StudioWorkflowStepRuns`, `StudioWorkflowApprovals`, 9 index dont la clé
  unique filtrée `(TenantId, EntityDefinitionId, Key) WHERE IsDeleted = 0`, aucune FK — workflows
  Studio). Jumeau idempotent :
  `docs/runbooks/sql/AddStudioWorkflows_Tenant.idempotent.sql`.
- `20260918100000_AddAuditLogsEntityHistoryIndex_Tenant` (index non unique `IX_AuditLogs_EntityHistory` sur
  `AuditLogs (EntityType, EntityId, CreatedAt)` — historique d'une fiche, 4.7h2 ; `Up`/`Down` idempotents
  `IF NOT EXISTS` / `IF EXISTS`, aucune colonne ajoutée). Jumeau idempotent :
  `docs/runbooks/sql/AddAuditLogsEntityHistoryIndex_Tenant.idempotent.sql`. Test de migration : ajouté en ★2 (U7).

## Portée automatisée

- Backend : `dotnet test src\Backend\tests\FactuTrust.Infrastructure.Tests --filter "FullyQualifiedName~.Studio"`
  (parsers, planificateur de diff, exécuteurs, cycle de vie des plans, catalogue d'outils, rendu PDF,
  politique d'accès aux tables, constructeur SQL des états, préréglages, digest de contexte).
- Backend (doublons + réutilisation) : `--filter "FullyQualifiedName~StudioAiDuplicateDetector|FullyQualifiedName~StudioAiSystemSpec|FullyQualifiedName~StudioAiSystemOrchestrator"`
  (rapprochements, parsing `existingKey`, exécution sans écriture sur les tables réutilisées).
- Backend (contexte + modèle avancé) : `--filter "FullyQualifiedName~SendChatMessageHandlerStudioAdvancedModel|FullyQualifiedName~AiContextBuilderStudioDigest|FullyQualifiedName~StudioContextDigestService"`
  et `dotnet test src\Backend\tests\FactuTrust.API.Tests --filter "FullyQualifiedName~FactuTrust.API.Tests.Studio"`
  (`AiChatOptionsContractTests` + contrats des contrôleurs Studio ; c'est ce filtre qu'exécute `azure-pipelines.yml`
  sous Linux — le projet complet, qui exige LocalDB, tourne dans le workflow GitHub `CI` sous Windows).
- Frontend (runtime vues + relations N-N, PR 2.5) : `npx ng test --include='src/app/features/studio/**/*.spec.ts'`
  (specs Karma `views/`, `shared/`, `relations/`, `studio-record-form`, `studio-entity-list`,
  `studio-entity-designer`) ; E2E API mockée : `npx playwright test e2e/studio-runtime-views.spec.ts
  e2e/studio-many-to-many.spec.ts --project=chromium`.
- Frontend (historique de la fiche, 4.7h3–h5) : `npx ng test --watch=false --browsers=ChromeHeadless
  --include='src/app/features/studio/records/**/*.spec.ts' --include='src/app/features/studio/studio.service.spec.ts'
  --include='src/app/features/studio/studio-record-form.component.spec.ts'` ; E2E API mockée :
  `npx playwright test e2e/studio-record-history.spec.ts --project=chromium`.
- Backend (relations N-N) : `--filter "FullyQualifiedName~CreateManyToManyRelation|FullyQualifiedName~ListEntityRelations|FullyQualifiedName~CustomRecordJunctionUniqueness|FullyQualifiedName~CustomRecordRepositoryFilterSql|FullyQualifiedName~GetStudioNavQuery|FullyQualifiedName~AddStudioEntityKind"`
  (composition de la jonction, résolution des relations, unicité de paire, filtre SQL paramétré — nécessite
  `FACTUTRUST_TEST_SQL_CONNECTION` ou LocalDB, sinon `Skipped` —, nav sans jonction, migration `Kind`) ;
  contrats API : `StudioEntityRelationsControllerContractTests` et `StudioRecordsControllerContractTests`
  dans le filtre `FactuTrust.API.Tests.Studio`.
- Backend (relations N-N dans la spec IA + orchestrateur multi-passes, PR 2.2) :
  `--filter "FullyQualifiedName~StudioAiSystemOrchestrator|FullyQualifiedName~StudioAiSystemSpec|FullyQualifiedName~StudioAiSpecCanonical|FullyQualifiedName~AiContextBuilderStudio|FullyQualifiedName~StudioAiPlanCatalogTests"`
  (alias de `kind`, promotion de champ, cap de 6 relations, dédoublonnage de paire, cinq passes de
  l'orchestrateur, forme canonique de `relations[]`, règle 3e du prompt derrière le drapeau).
- Backend (vues enregistrées proposées par l'IA, PR 2.4) :
  `--filter "FullyQualifiedName~StudioAiRecordViewSpec|FullyQualifiedName~StudioAiPlanExecutor|FullyQualifiedName~StudioAiSystemOrchestrator|FullyQualifiedName~StudioAiPlanCreationFeatures|FullyQualifiedName~StudioSilentFailureGuards|FullyQualifiedName~AiToolRegistryStudioRecordViewTools"`
  (parsing/alias et résolution contre le schéma réel avec avertissements, borne 3 vues/entité, passe 4
  de l'orchestrateur et son ordonnancement, exécution du plan `RecordView`, garde des trois drapeaux,
  catalogue d'outils et `StudioPlanEmittingTools`) ; contrats API `validate`/`from-spec` kind
  `RecordView` dans `StudioAiPlansControllerContractTests` (filtre `FactuTrust.API.Tests.Studio`).
- Historique/aperçu/rejeu (PR 3.2) : `--filter "FullyQualifiedName~StudioAiSeedSampler|FullyQualifiedName~StudioAiPlanPreviewBuilder|FullyQualifiedName~StudioAiPlanPreviewFeatures"`,
  contrat `StudioAiPlansControllerContractTests` (filtre `FactuTrust.API.Tests.Studio`) et
  compteurs de liste dans `StudioAiPlanWorkbenchFeaturesTests` / `StudioAiPlanFeaturesTests`.
- Export / duplication / import + modèles enrichis (PR 3.3) : `--filter "FullyQualifiedName~StudioSystemSpecExporter|FullyQualifiedName~CustomSystemExportFeatures|FullyQualifiedName~StudioTemplateCatalog|FullyQualifiedName~StudioAiSpecCanonical|FullyQualifiedName~StudioKey|FullyQualifiedName~CustomSystemFeatures"`
  (aller-retour export → `TryParse`, dégradations et warnings, bornes de seed, gardes des deux drapeaux, nom
  « (copie) », import chaîne/objet/`specVersion`, 10 modèles et `StudioTemplateStats`, test d'or, clé réservée
  `import`) ; contrats API `StudioSystemsControllerContractTests` et `StudioTemplatesControllerTests`
  (filtre `FactuTrust.API.Tests.Studio`).
- Workflows Studio (PR 4.1) : `--filter "FullyQualifiedName~StudioWorkflow"` (`StudioWorkflow*Tests` :
  entités, spec / validation / lint des étapes, contexte et gabarits, handlers d'étapes, moteur segmenté,
  déclencheur, dépôt et migration — les tests SQL exigent `FACTUTRUST_TEST_SQL_CONNECTION`, sinon `Skipped` —,
  `StudioWorkflowFeaturesTests` pour les handlers de conception) ; contrat API
  `StudioWorkflowsControllerContractTests` (filtre `FactuTrust.API.Tests.Studio`).
- Workflows Studio « v1.1 » (4.7 a/b/c/p — PR #151 à #159, #168) : le même filtre `FullyQualifiedName~StudioWorkflow`
  couvre `StudioWorkflowScheduleServiceTests` (ordonnancement Hangfire, 6), `StudioWorkflowScheduledJobTests`
  (tick, 13), `StudioWorkflowTestFeaturesTests` (simulation `POST workflows/{id}/test`, 10 `[SkippableFact]` —
  SQL réel requis, sinon `Skipped`), `StudioWorkflowApprovalFeaturesTests` (historique de mes décisions) et les
  cas `Scheduled_trigger_*` de `StudioWorkflowStepsSpecTests` ; IA planifiée : `--filter
  "FullyQualifiedName~StudioAiWorkflowSpec|FullyQualifiedName~StudioAiWorkflowPlanner"` ; contrats API
  `StudioWorkflowsControllerContractTests` (13 routes figées) et `StudioWorkflowRuntimeControllerContractTests`
  (11 routes) dans le filtre `FactuTrust.API.Tests.Studio`.
- Journal d'audit des fiches (4.7h1–h2 — PR #170, #171) : `--filter
  "FullyQualifiedName~CustomRecordAudit|FullyQualifiedName~CustomRecordHistory|FullyQualifiedName~AuditLogQueryService"`
  (`CustomRecordAuditTests` 9, `CustomRecordHistoryQueryTests` 6, `AuditLogQueryServiceTests.GetEntityHistoryAsync_*`) ;
  contrat API `StudioRecordsControllerContractTests` (`History_*`, `Routes_and_policies_are_unchanged`).
- Frontend : `ng test --watch=false --browsers=ChromeHeadless` (service de plans + flux SSE de confirmation).
- Gate complet : `powershell -File scripts\verify-all.ps1`.

## Atelier IA frontend — coquille, modèle avancé, doublons, rail (PR 1.4)

> Prérequis : `EnableStudioAiPlanPreview=true`, `EnableStudioAiAdvancedModel=true` avec un modèle Studio
> avancé configuré en back-office, `EnableStudioTemplates=true` ; une table Studio `employes` « Employés »
> existante. Navigateur ≥ 1280 px de large pour la disposition 3 colonnes (rail à droite) ; réduire à
> 1024 px pour vérifier l'empilement (rail sous la colonne principale). Documentation utilisateur :
> [`docs/utilisateur/13-studio-ia.md`](../utilisateur/13-studio-ia.md) (chapitre `studio-ia`).
> Automatisé : `ng test --include='src/app/features/studio/**/*.spec.ts'` et
> `npx playwright test e2e/studio-ai-atelier.spec.ts` (backend entièrement mocké — `e2e/helpers/studio-mock.helpers.ts`).

91. **Thème indigo scopé et modèle avancé** — `/studio/ai` : l'en-tête, les boutons primaires et les
    overlays PrimeNG (menu déroulant d'un `p-select` dans `/studio/forms`, dialogue de confirmation) sont
    **indigo** ; `/dashboard` et `/invoices` restent **bleu** FactuTrust (aucun `.studio-theme` hors
    `/studio/**`, mode sombre inclus). Sous la zone de saisie, l'interrupteur **Modèle avancé** affiche le
    libellé du modèle configuré ; l'activer puis envoyer « crée un système de gestion des congés » ⇒ la
    requête `POST api/ai/chat` (flux SSE) porte `options.useAdvancedModel: true` et `options.studioIntent`
    (`system` si la carte « Système complet » a été choisie) ; l'événement SSE `meta` renvoie
    `usedAdvancedModel: true` ⇒ bandeau vert « Généré avec le modèle avancé » (`data-testid="model-advanced"`). Recharger la page ⇒ l'interrupteur
    est **toujours actif** (mémorisé en `localStorage`). Désactiver le modèle avancé en back-office
    (`EnableStudioAiAdvancedModel=false` ou modèle retiré) et renvoyer ⇒ `meta.usedAdvancedModel: false`
    + `advancedModelFallbackReason` (`disabled` / `not_configured` / `unavailable`) ⇒ bandeau
    **« Modèle standard utilisé : … »** (`data-testid="model-fallback"`, `role="status"`) avec la raison
    traduite ; la proposition reste exploitable. Si `capabilities.advancedModelAvailable = false`, l'interrupteur
    n'apparaît pas et aucune option `useAdvancedModel` n'est envoyée.
92. **Bandeau doublons — Réutiliser / Créer quand même** — « crée un système RH avec une table Employés
    (nom, poste) et une table Contrats » ⇒ `studio_plan.summary.duplicates[]` non vide ⇒ au-dessus de
    l'aperçu, le bandeau **« La table « Employés » existe déjà »** (`.sai-dup`) cite la table existante et la
    raison (`same_key` / `same_name` / `singular_plural`). **Réutiliser la table existante** ⇒
    `PUT api/studio/ai/plans/{id}/spec` avec `entities[0].existingKey = "employes"`, le bandeau disparaît et
    l'onglet Vue d'ensemble affiche « Tables réutilisées : 1 » (la confirmation ne recrée ni champ ni
    formulaire pour `employes`, smoke 50). Rejouer la demande puis **Créer quand même** ⇒ l'entité est renommée
    **« Employé (2) » / « Employés (2) »** (clé suffixée), mise en surbrillance dans l'onglet Tables, le bandeau
    disparaît **sans** réapparaître au prochain rendu (`dismissedDuplicateRefs`) ; cliquer une seconde fois ne
    produit pas « (2) (2) ». Le bandeau n'a **pas** de croix de fermeture : il disparaît dès que chaque doublon
    a été tranché (Réutiliser / Créer quand même) ; tant qu'un doublon est affiché, le plan reste confirmable
    tel quel.
93. **Message pendant un plan en attente, Réinitialiser, Nouvelle demande** — avec une proposition
    **À valider** affichée, saisir « ajoute une table Formations » dans le composeur situé **sous l'aperçu** et
    envoyer ⇒ dialogue **« Une proposition est en attente »** ; **Annuler** ⇒ rien n'est envoyé, le plan reste
    affiché ; **Abandonner le plan et envoyer** ⇒ `POST api/studio/ai/plans/{id}/cancel` **puis** un nouveau
    `POST api/ai/chat` (jamais l'inverse), l'ancien plan passe **Annulé** dans l'historique. Rail →
    **Réinitialiser la conversation** ⇒ confirmation, puis `POST api/studio/ai/plans/cancel-pending` (toujours,
    même sans plan affiché), `DELETE api/ai/conversations/{id}` seulement si une conversation existe, toast
    « 1 plan(s) en attente annulé(s). » (ou « Conversation réinitialisée. » sans plan), composeur vide, cartes d'intention
    de nouveau visibles, historique rafraîchi. En-tête → **Nouvelle demande** ⇒ même réinitialisation ; la
    confirmation n'est demandée que si un plan est affiché. Une carte grisée « Bientôt » (Page) ne fait rien
    au clic ; **Workflow** n'est active que si `capabilities.workflowToolsEnabled = true`.
94. **Rail, modèles, historique et pages dédiées** — le rail affiche **Modèles de systèmes** (3 max, badge
    « Intégré » / « Votre espace »), **Actions rapides**, **Historique** (5 dernières générations, statuts
    À valider / En cours / Terminé / Échec / Annulé / Expiré, dates relatives) et la carte de suggestion.
    **Utiliser** sur un modèle ⇒ `POST api/studio/ai/plans/from-template` `{ templateKey }`, la proposition s'ouvre dans l'aperçu
    sans appel au modèle ; avec un plan déjà affiché ⇒ confirmation « Remplacer la proposition en cours ? ».
    Cliquer une ligne **À valider** de l'historique ⇒ `GET api/studio/ai/plans/{id}` et reprise dans l'aperçu ;
    une ligne Terminé/Annulé n'est pas cliquable. **Voir tout** ⇒ `/studio/ai/projects` : tableau paginé
    **20 par page**, filtres Statut / Genre (retour page 1), compteur « N projet(s) », **Reprendre** ⇒
    `/studio/ai?plan={id}` (rouvre le plan puis nettoie l'URL ; plan expiré ⇒ bandeau d'erreur en ligne
    « Ce plan n'est plus en attente… » — `store.error`, pas un toast), **Ouvrir le système** ⇒
    `/studio/systems/{key}`. **Voir tous** (modèles) ⇒
    `/studio/ai/templates` : cartes groupées par catégorie (« Autres » pour les modèles sans catégorie),
    **Utiliser ce modèle** ⇒ `/studio/ai?template={key}` ⇒ plan ouvert. Avec `templatesEnabled = false`
    ⇒ carte Modèles absente et page `/studio/ai/templates` « La bibliothèque de modèles est désactivée par l’administrateur. » ;
    `planPreviewEnabled = false` ⇒ carte Historique absente, aucun appel `GET api/studio/ai/plans`.
    Sans `systemExportEnabled`, **Exporter le système (JSON)** et **Partager** sont grisés « Bientôt » ;
    Importer / Dupliquer n'apparaissent qu'avec l'export activé (toast « arrive dans une prochaine version »).

## Runtime des vues et relations N-N — frontend (PR 2.5)

95. **Sélecteur de vues** : `/studio/d/<table>` avec vues dans le schéma ⇒ onglets « Liste » +
    vues enregistrées, vue par défaut active (`POST …/views/{id}/run`) ; `?view=<id>` force une vue
    (Kanban rendu groupé) ; schéma sans vues ⇒ liste brute d'avant 2.5, aucun appel `/run`.
96. **Concepteur de vue** : `/studio/d/<table>/views/new` — clé auto-slug immuable en édition, bornes
    (25 colonnes / 10 filtres / 3 tris / 6 champs carte) ; 409 création ⇒ « Une vue porte déjà cette
    clé. », 409 édition ⇒ « La vue a été modifiée ailleurs ; rechargez. » + « Recharger », 400 « Limite
    du plan… » ⇒ bandeau quota ; suppression confirmée ⇒ retour liste ; aperçu R3 en édition
    (`previewLimit=20`, « Actualiser l'aperçu »).
97. **Dialog N-N** : concepteur de table, capability `manyToManyEnabled` seule ⇒ bouton « Ajouter une
    relation plusieurs-à-plusieurs » (après « Pont ERP ») + section Relations ; dialog : cible sans la
    source ni les jonctions, clé `{source}_{cible}` par défaut, bloc « Attribut de liaison — Bientôt » ;
    409 ⇒ « Une table de liaison porte déjà cette clé. », succès ⇒ toast + rechargement.
98. **Onglet « Liés » + page Relations** : fiche en édition avec N-N ⇒ onglets Fiche / Liés — ⟨cible⟩ ;
    ajout ⇒ POST jonction, 409 `record.duplicate_link` ⇒ « Lien déjà existant. » en ligne, liste
    inchangée ; retrait ⇒ DELETE jonction/{id} ; bandeau tronqué si `totalCount > pageSize`. Sans
    `custom_records:write`, Ajouter/Retirer masqués. `/studio/relations` ⇒ tableau dédoublonné +
    diagramme SVG (`role="img"`) ; `/studio` ⇒ jonctions masquées par défaut, badge « Jonction » après
    décoche.

## Amendements enrichis et changement de type (PR 3.1)

> Architecture : [`docs/architecture/studio-ai-amendments.md`](../architecture/studio-ai-amendments.md).
> Prérequis : une table Studio `interventions` (champs `nom` Text, `statut` Select avec options,
> `debut` Date, `montant` Money) alimentée d'enregistrements, un compte avec `studio:design_entities` ;
> pour les cas IA : `Ollama:EnableStudioAiPlanPreview=true` + `Ollama:EnableStudioAiModifyTools=true`
> (+ `EnableStudioManyToMany` / `EnableStudioRecordViews` selon le cas).
> **Smoke chat non exécuté** : le parcours conversationnel complet exige un modèle Ollama (absent de
> l'environnement de vérification) — les cas 64–66 vérifient donc la chaîne serveur via
> `POST api/studio/ai/plans/validate` (kind `Amendment` : parsing + canonicalisation, alias absorbés)
> et renvoient aux tests automatisés (`StudioAiAmendmentSpecTests` / `StudioAiAmendmentPlannerTests` /
> `StudioAiSpecCanonicalTests` / `StudioAiAmendmentExecutorTests`) pour le contenu de l'aperçu
> (étapes, sévérités, avertissements), `studio_plan_changes` partageant le même parseur et le même
> planificateur. Avec un modèle branché, rejouer ces demandes en langage naturel dans l'atelier.

63. **Changement de type : vérification puis application** — avec 3 enregistrements dans
    `interventions`, `GET api/studio/entities/{idEntite}/fields/{idMontant}/type-check?to=Number` ⇒
    `200` `{ from: "Money", to: "Number", policy: "requires_empty_table", recordCount: 3, allowed: false }`
    avec le message « Ce changement exige une table vide (3 enregistrement(s))… » ;
    `PATCH …/type` corps `{ "fieldType": "Number" }` ⇒ `400 Validation.fieldType` (même message, aucune
    écriture). Vider la table puis rejouer ⇒ `200`, `data.fieldType = "Number"` ; audit
    `Studio.Field.TypeChanged` présent. `to=wizard` ou `to=42` ⇒ `400 Validation.to` ;
    `?to=Formula` ⇒ `200` `policy: "forbidden"` (« Ce type se crée comme un nouveau champ… ») ;
    `PATCH` vers le même type ⇒ `400` « Le champ est déjà de ce type. ». Cas sans perte :
    `type-check?to=Decimal` ⇒ `policy: "lossless", allowed: true`, et le `PATCH` réussit même table
    non vide ; la colonne calculée `jx_montant` est conservée (partagée, indépendante du type).
64. **Réordonnancement et changement de type (DSL d'amendement)** — `POST api/studio/ai/plans/validate`
    corps `{ "kind": "Amendment", "specJson": "{\"target\":{\"entityKey\":\"Interventions\"},\"operations\":[{\"op\":\"reordonner_champs\",\"fields\":[\"montant\",\"Nom\",\"fantome\"]},{\"op\":\"change_field_type\",\"key\":\"montant\",\"type\":\"decimal\"}]}" }`
    ⇒ `200`, spec canonique retournée avec `target.entityKey = "interventions"` (slugifié), l'alias
    `reordonner_champs` absorbé en `reorder_fields` et le type en `"decimal"` ; à l'aperçu (outil chat
    / tests) : étape « Réordonner les champs » promettant l'ordre effectif complet (`montant, nom,
    statut, debut` — « Nom » résolu par libellé, champs non cités conservés à la suite) et avertissement
    « Champ « fantome » introuvable : retiré de la réorganisation. » ; l'étape `change_field_type`
    annonce `montant` → `décimal` « sans perte ». `"type": "number"` sur une table non vide ⇒ étape en
    **avertissement** « table vide » SANS nombre fabriqué (le compte est revérifié à l'application) ;
    `"type": "formula"` ⇒ étape **en erreur** « Ce type se crée comme un nouveau champ… » ;
    `"type": "3"` (valeur numérique d'énumération) ⇒ op écartée « type inconnu ».
65. **Relation, système et vue (DSL d'amendement), drapeaux fonctionnels** — même appel avec
    `{ "op": "add_relation", "kind": "many_to_many", "target": "Compétences", "label": "Compétences requises" }`,
    `{ "op": "assign_system", "system": "Gestion Interventions" }` et
    `{ "op": "set_view", "mode": "kanban", "displayName": "Par statut", "groupBy": "statut" }` ⇒ `200`,
    forme canonique `kind: "many_to_many"`, `target: "competences"` (slugifiée),
    `system: "gestion_interventions"`, vue sans clé `entity` (table du plan implicite). Aperçu (flag
    `EnableStudioManyToMany` on) : étape « Relier à « Compétences requises » » ; `"target":
    "interventions"` (la table elle-même) ⇒ étape **en erreur** « La table cible doit être différente
    de la table source. ». Flag off ⇒ l'op est écartée avec avertissement « … relations
    plusieurs-à-plusieurs ne sont pas activées » (plan refusé si c'était la seule op) — idem
    `set_view` avec `EnableStudioRecordViews=false`. Flag views on : la vue est résolue contre le
    schéma réel — `"groupBy": "nom"` (Text) ⇒ l'étape annonce « Liste » + avertissement « Kanban
    impossible… » (dégradation, jamais d'échec). Détachement : `{ "op": "assign_system", "system":
    "none" }` ⇒ aperçu « Détacher la table de son système ».
66. **Exécution réelle des amendements (3.1c/3.1d) — chaque op laisse une étape** — à l'application
    d'un plan `Amendment` confirmé, le suivi affiche une étape par opération au statut `done`,
    `skipped` ou `error` (jamais de succès muet) : `reorder_fields` applique l'ordre promis à
    l'aperçu (les champs de `interventions` sont réordonnés en base, visibles au rechargement du
    concepteur) ; `change_field_type` applique les conversions permises et remonte une étape en
    erreur non bloquante quand le handler refuse (`Forbidden` / table non vide) ; `assign_system`
    rattache la table (rechargée sous le bon système) et `system: "none"` la détache ; `add_relation`
    `many_to_one` crée le champ relation, `many_to_many` crée la table de jonction — avec
    `EnableStudioManyToMany=false` l'étape est `skipped` et **aucune** écriture n'a lieu (vérifier
    l'absence de jonction en base) ; `set_view` crée la vue enregistrée (clé dédupliquée si le nom
    existe déjà) — avec `EnableStudioRecordViews=false` ⇒ `skipped`, aucune écriture ; une cible de
    relation inconnue ou de type jonction ⇒ `skipped` + avertissement. `set_automation` reste valide
    au parsing (`validate` ⇒ `200`), est présenté « Automatisation (non appliquée) » à l'aperçu et
    remonte `skipped_automation` à l'exécution ; un plan sans rien d'applicable échoue explicitement
    (« Aucune modification appliquée »). Une op inconnue de l'exécuteur lève (défaut bruyant, couvert
    par `StudioSilentFailureGuardsTests`). Le prompt système StudioBuilder porte la règle 8 enrichie
    (cinq opérations actionnables listées, révision de cache « v7 » —
    `AiContextBuilderStudioDigestTests`).

## Historique, aperçu structuré et rejeu des plans (PR 3.2)

> Architecture : [`docs/architecture/studio-ai-plans.md`](../architecture/studio-ai-plans.md).
> Prérequis : `Ollama:EnableStudioAiPlanPreview=true`, un compte avec `studio:design_entities`,
> au moins un plan système **confirmé** (ex. `conges` créé) et un plan **échoué** (ex. spec
> validée puis table cible supprimée avant exécution, ou plan annulé/expiré). AUCUN appel LLM :
> l'historique, l'aperçu et le rejeu ne lisent que la spec persistée — ces cas s'exécutent contre
> l'API seule (ou l'atelier une fois le frontend 3.4 livré).

67. **Historique : compteurs relations/vues et lien Ouvrir** — `GET api/studio/ai/plans` ⇒ `200`,
    chaque élément porte les 14 clés du contrat (dont `errorMessage`, `openUrl`, `relationCount`,
    `replayable` ; `viewCount` est omis du JSON tant qu'il vaut 0). Le plan système confirmé
    affiche `relationCount`/`viewCount` cohérents avec son résumé et `openUrl` vers le système
    créé (`/studio/systems/conges`) — le lien **Ouvrir** de Mes projets l'utilise ; le plan échoué
    porte `errorMessage` lisible. `replayable` est `true` sur les quatre états terminaux (et sur
    un plan « À valider » dont l'heure d'expiration est dépassée), `false` sinon. Jamais de clé
    `spec`/`specJson` dans la réponse. Flag `EnableStudioAiPlanPreview` coupé ⇒ `404`
    « Le flux d'aperçu Studio n'est pas activé. » sur la liste comme sur `cancel-pending`.
68. **Aperçu structuré d'un plan système et d'un amendement (dégradé)** —
    `GET api/studio/ai/plans/{id}/preview` sur le plan confirmé ⇒ `200`, `workflows: []` toujours,
    `entities[]` avec champs (`required`/`unique`, options de liste), `formLayout.sections[].fields[]`
    en objets `{ key, width, labelOverride }` (jamais des chaînes), vues proposées, `seedCount`
    réel et `seedSample` borné à 3 lignes / 80 caractères par valeur (troncature « … »),
    `relations[]` typées, `warnings[]`/`duplicates[]` relus du résumé. Amendement dont la table
    cible existe ⇒ diff « avant → après » par opération ; table cible **supprimée** entre-temps ⇒
    `200` DÉGRADÉ (`amendment.degraded: true`, un item par opération demandée, avertissement
    « Table introuvable : aperçu limité aux opérations demandées. »), jamais d'erreur. Plan d'un
    AUTRE utilisateur (ou tenant) ⇒ `404` ; flag coupé ⇒ `404` même message qu'au cas 67 ;
    permission retirée ⇒ `401`.
69. **Rejeu d'un plan échoué ⇒ nouveau plan en attente** — `POST api/studio/ai/plans/{id}/replay`
    sur le plan échoué ⇒ `201 Created` avec en-tête `Location: /api/studio/ai/plans/{nouvelId}` ;
    le corps porte un plan `Pending` NEUF dont le résumé contient `replayedFromPlanId` = id du
    plan d'origine. Le plan d'origine est INCHANGÉ (statut `Failed`, `errorMessage` intact — le
    recharger pour preuve). Le nouveau plan apparaît en tête de l'historique et se confirme par
    le flux SSE habituel (création réelle au clic Valider, jamais au rejeu). Rejeu d'un plan
    « À valider » non échu ou « En cours » ⇒ `409` « Seul un plan terminé, échoué, annulé ou
    expiré peut être rejoué. » ; plan d'un autre utilisateur ⇒ `404` ; flag coupé ⇒ `404`
    « Le flux d'aperçu Studio n'est pas activé. ». Rejouer deux fois le même plan crée deux plans
    distincts (idempotence : aucune écriture de schéma au rejeu).

## Export, duplication et import de systèmes ; modèles enrichis (PR 3.3)

> Architecture : [`docs/architecture/studio-system-export.md`](../architecture/studio-system-export.md).
> Prérequis : `Ollama:EnableStudioSystemExport=true`, `Ollama:EnableStudioAiPlanPreview=true` ; un
> système Studio existant (ex. créé depuis le modèle `gestion-conges`) ; un compte avec
> `studio:design_entities`. AUCUN appel LLM : export, duplication et import ne lisent que le schéma
> persisté — ces cas s'exécutent contre l'API seule (ou l'atelier une fois le frontend 3.4 livré).

70. **Export sans données de départ** — `GET api/studio/systems/{key}/export` ⇒ `200` avec
    `specVersion: 1`, `includesSeed: false`, `entityCount`/`relationCount`/`viewCount` cohérents avec
    le concepteur ; la `spec` porte `specVersion`, `exportedFrom { tenantSystemKey, exportedAt }`,
    `system`, `entities[]`, `relations[]` (présent seulement si le système porte des relations
    N-N — ex. `gestion_de_projets`, clé du système créé depuis le modèle « Gestion de projets ») et ne contient ni `seed`, ni identifiant (`Guid`), ni
    `tenantId`. Avec `?download=true`, le navigateur télécharge `studio-system-{key}.json` (spec
    seule, indentée, accents lisibles). Drapeau `EnableStudioSystemExport=false` ⇒ `404`
    « L'export de systèmes Studio n'est pas activé. » sans appel côté application ; clé avec tiret
    ⇒ `400` « Clé système invalide. » ; clé inconnue ⇒ `404` `CustomSystem.NotFound`.
71. **Export avec données de départ bornées et anonymisées** — `?includeSeed=true` sur un système
    dont une table compte plus de `StudioExportMaxSeedRows` lignes (baisser le réglage à `2` pour le
    test) : `includesSeed: true`, au plus 2 lignes par table, **aucun** avertissement de troncature
    par table (la borne est appliquée à la lecture, avant l'exporteur — l'avertissement « Données
    de départ de « {key} » tronquées à {n} ligne(s). » n'apparaît que si le total de 200 lignes est
    atteint), valeurs des champs relation / pièce jointe / signature / formule à `null`, total
    ≤ 200 lignes. Réglage à `0` ⇒ `includesSeed: false` et aucune clé `seed`.
72. **Duplication ⇒ plan ⇒ système copié** — `POST api/studio/systems/{key}/duplicate` (corps vide)
    ⇒ `201 Created` avec `Location: /api/studio/ai/plans/{id}` et un corps `{ plan, spec }` ; l'aperçu
    du plan (QA 68) montre « <Nom> (copie) », les tables homonymes dans `duplicates[]` et les
    warnings d'export dans `warnings[]` ; la confirmation crée un système dont les clés de tables déjà
    prises sont suffixées `_2` et les relations N-N recréées ; le système source est INCHANGÉ ;
    audits `Studio.System.Exported` puis `Studio.System.DuplicateRequested` présents. Avec
    `{ "displayName": "Congés 2027" }`, le nom est repris tel quel ; un nom de 129 caractères ⇒ `400`
    « Le nom affiché dépasse 128 caractères. ». `EnableStudioAiPlanPreview=false` ⇒ `404`
    « Le flux d'aperçu Studio n'est pas activé. ».
73. **Import d'un export** — `POST api/studio/systems/import` avec `{ "spec": <corps de la spec du
    cas 70> }` ⇒ `201` et plan Pending équivalent (mêmes compteurs) ; `{ "spec": "<le même JSON sous
    forme de chaîne>" }` accepté ; `"specVersion": 2` ⇒ `400` « Version de spécification non prise en
    charge : 2. » ; spec > 256 Ko ⇒ `400` « La spec dépasse 256 Ko. » ; corps > 512 Ko ⇒ `413` ;
    `"spec": "pas du json"` ⇒ `400` « La spécification n'est pas un JSON valide. » ;
    `"includeSeed": false` sur un export avec seed ⇒ aperçu sans données de départ ;
    `"displayNameOverride": "Congés importés"` renomme le système du plan ; audit
    `Studio.System.ImportRequested` présent. Clé réservée par la route : un système « Import »
    créé via l'assistant ou un modèle reçoit la clé `import_2` ; `POST api/studio/systems` avec
    `key: "import"` ⇒ `400` « Clé système réservée. ».
74. **Modèle `gestion-projets` de bout en bout** — `GET api/studio/templates` liste **10** modèles
    avec `relationCount`/`viewModes` (`gestion-projets` : 4 tables, 1 relation,
    `["list","kanban","calendar"]`) ; créer un système depuis `gestion-projets` : 4 tables + jonction
    « Équipe projet », vues kanban « Par statut » et liste « Mes tâches » (tâches), calendrier
    « Jalons », liste « Projets actifs » filtrée `statut = actif`, rapport « Tâches par statut »,
    5 lignes de départ ; l'export de ce système (cas 70) redonne `relationCount: 1` et
    `viewCount: 4`, et sa duplication (cas 72) recrée la relation N-N.

## Aperçu IA enrichi — frontend (PR 3.4)

> Architecture : [`docs/architecture/studio-ai-preview-frontend.md`](../architecture/studio-ai-preview-frontend.md).
> Prérequis : `EnableStudioAiPlanPreview` et `EnableStudioSystemExport` activés (`planPreviewEnabled` /
> `systemExportEnabled` dans `GET api/studio/ai/capabilities`), un compte avec `studio:design_entities`,
> une proposition « Système complet » ouverte dans l'atelier (`/studio/ai`). Suite Playwright miroir :
> `e2e/studio-ai-preview.spec.ts` (7 cas, backend mocké). Les numéros 75–90 (backend 4.x) et 103–106 (4.4)
> restent réservés.

99. **Tester sans écriture** : barre de modes de l'aperçu ⇒ **Tester** ⇒ un seul `GET api/studio/ai/plans/{id}/preview`
    (jamais rejoué tant que le plan est le même), puis le formulaire de la première table rendu par le
    formulaire dynamique réel ; saisir les champs requis puis **Enregistrer** ⇒ message de simulation en
    ligne, **aucune** requête `POST`/`PUT`/`PATCH`/`DELETE` sur `api/studio/*` (vérifier dans l'onglet
    Réseau) ; carte « Rapport » alimentée par `summary.sample` sinon par l'agrégation locale des données
    de départ, bouton Exporter du rapport inactif (`aria-disabled`). `GET …/preview` ⇒ `404` (flag
    serveur absent) ⇒ pilule « Disponible après mise à jour du serveur. » sur le bouton Tester, panneau
    toujours fonctionnel depuis la spec seule, aucun bandeau d'erreur global. Revenir à **Aperçu** ne
    déclenche aucun appel.
100. **Personnaliser : brouillon 409 + import/export aller-retour** : **Personnaliser** ⇒ renommer un champ
    dans l'onglet Tables ⇒ badge « 1 » sur le bouton Personnaliser ⇒ **Enregistrer le brouillon** ⇒
    `PUT api/studio/ai/plans/{id}/spec` avec le `rowVersion` courant ⇒ fil « Modifications enregistrées
    dans le plan. », badge à 0, nouveau `rowVersion` mémorisé. Rejouer avec un `rowVersion` périmé (second
    onglet qui a enregistré entre-temps) ⇒ `409` ⇒ bandeau d'erreur `role="alert"` « Ce plan a été modifié
    entre-temps. Rechargez l’aperçu. » au-dessus de l'aperçu, brouillon **conservé** (badge et bouton
    toujours actifs), rien n'est écrasé. Puis, sur un système créé : carte résultat ou rail ⇒ **Exporter
    (JSON)** ⇒ dialog « Exporter le système » (`p-select` des systèmes quand aucune clé n'est préréglée),
    `GET api/studio/systems/{key}/export` ⇒ compteurs « n tables · n relations · n vues », **Télécharger**
    ⇒ fichier `studio-system-<clé>.json` (spec seule, identique à `?download=true`) ; rail ⇒ **Importer un
    modèle (JSON)** ⇒ déposer ce fichier ⇒ « Spécification reconnue » + compteurs identiques ⇒ **Importer**
    ⇒ `POST api/studio/systems/import` (`displayNameOverride` optionnel, `includeSeed`) ⇒ `201` ⇒ la
    proposition s'ouvre dans l'aperçu avec les mêmes compteurs. Fichier > 256 Ko ⇒ « Fichier trop
    volumineux (256 Ko maximum). » **sans** lecture ni appel réseau ; JSON invalide ⇒ « JSON invalide. » ;
    `specVersion: 2` ⇒ « specVersion non pris en charge (1 attendu). ».
101. **Expiration ⇒ Régénérer ⇒ `POST …/replay`** : laisser le compte à rebours de la barre de modes
    atteindre 0 (ou ouvrir un plan dont `expiresAt` est passé) ⇒ pilule **Expiré**, **Créer maintenant**
    désactivé, boutons de mode désactivés, bouton **Régénérer** visible ⇒ clic ⇒
    `POST api/studio/ai/plans/{id}/replay` ⇒ `201` ⇒ nouvelle proposition **À valider** ouverte à la place
    (fil « Plan rejoué : une nouvelle proposition est ouverte. »), historique du rail rafraîchi. Même
    action depuis le rail (**Rejouer** sur une ligne `replayable`, confirmation « Remplacer la proposition
    en cours ? » si un plan est affiché) et depuis **Mes projets** (`/studio/ai/projects`, bouton Rejouer ⇒
    `201` ⇒ redirection `/studio/ai?plan=<nouvel id>`). `409` ⇒ « Ce plan ne peut pas être rejoué
    maintenant. » (bandeau dans l'atelier, toast dans Mes projets), plan source inchangé.
102. **Changement de type refusé désactive Enregistrer ; `lossless` ⇒ PATCH `…/type`** : concepteur de
    table (`/studio/<entityId>`) ⇒ modifier un champ existant ⇒ changer le type dans la liste (plus
    grisée en édition) ⇒ « Vérification… » puis
    `GET api/studio/entities/{entityId}/fields/{fieldId}/type-check?to=<Type>` (anti-rebond, dernière
    valeur seule) : `lossless` ⇒ `p-message` `info` avec le message serveur verbatim, **Enregistrer**
    actif ⇒ clic ⇒ `PATCH api/studio/entities/{entityId}/fields/{fieldId}/type` puis `PUT` du champ ⇒
    dialog fermé, liste des champs rechargée avec le nouveau type ; `requires_empty_table` ⇒ message
    `warn` avec le nombre d'enregistrements bloquants,
    **Enregistrer désactivé** ; `forbidden` ⇒ message `error`, **Enregistrer désactivé** ; revenir au type
    d'origine ⇒ message effacé, Enregistrer actif, aucun `PATCH` émis. Pendant la vérification le bouton
    reste désactivé (pas de double soumission).

## Workflows Studio — moteur, déclencheur et API de conception (PR 4.1)

> Architecture : [`docs/architecture/studio-workflows.md`](../architecture/studio-workflows.md).
> Prérequis : migration tenant `20260912150000_AddStudioWorkflows_Tenant` appliquée ; drapeau
> `EnableStudioWorkflows` actif — en développement **par variable d'environnement**
> `Ollama__EnableStudioWorkflows=true` (`appsettings.json` reste à `false`), en production `true` par défaut
> dans `appsettings.Production.json` depuis la PR #180 (D-47-90) ; une table Studio `commandes` (champs `statut` Select `brouillon`/`valide`, `montant` Money,
> `traite_le` DateTime, `ref` AutoNumber) et une table `taches` (champ `titre` Text) alimentées ; un compte
> avec `studio:design_entities` (conception) et `custom_records:write` (déclenchement). Appels Swagger /
> `curl` — le frontend arrive en PR 4.4. Les numéros 75–80 sont ceux du registre du plan maître ; l'ordre du
> fichier suit les PR.

75. **Drapeau éteint** — sans `Ollama__EnableStudioWorkflows`, appeler les 13 routes de
    `StudioWorkflowsController` (`GET api/studio/workflows/step-catalog`, `GET api/studio/workflows` (catalogue tenant, 4.5c3 — consommé par le hub 4.5f),
    `GET/POST api/studio/entities/{entityId}/workflows`, `POST …/workflows/validate`, `GET/PUT/DELETE api/studio/workflows/{id}`,
    `POST …/toggle`, `POST …/duplicate`, `POST …/test` (4.7c1), `GET …/instances?page=&pageSize=` (paginée depuis 4.7a1),
    `GET api/studio/workflows/instances/{instanceId}` — contrat figé `FrozenRoutes` = 13, QA 129) ⇒ `404`
    « Les workflows Studio ne sont pas activés. » partout, aucune trace côté application ;
    `GET api/ai/studio/capabilities` ⇒ `workflowsEnabled=false`, `workflowToolsEnabled=false` ; créer puis
    modifier un enregistrement de `commandes` ⇒ `201` / `200` habituels et **aucune ligne** dans
    `StudioWorkflowInstances`.
76. **Création, quota, clé** — drapeau activé : `POST api/studio/entities/{entityId}/workflows` corps
    `{ "key": "relance", "name": "Relance", "trigger": "field_changed", "triggerConfig": { "field": "statut", "to": "valide" }, "steps": { "version": 1, "steps": [ { "key": "verif", "type": "condition", "filters": [{ "field": "montant", "op": "gt", "value": 100 }] }, { "key": "maj", "type": "update_field", "set": { "traite_le": "{{ _now }}" } } ] }, "isActive": true }`
    ⇒ `201`, en-tête `Location` vers `GET api/studio/workflows/{id}`, `version=1`, `stepCount=2`,
    `openInstances=0`, `rowVersion` base64 ; ligne d'audit `Studio.Workflow.Created`. Re-`POST` avec la même
    clé ⇒ `409` « Un workflow avec la clé « relance » existe déjà pour cette table. » ; `POST` avec `RELANCE`
    ⇒ `400` (forme de clé refusée en amont de l'unicité : minuscules, chiffres et `_` uniquement). Créer
    ensuite jusqu'à 20 workflows puis un 21ᵉ ⇒ `400` message de quota (`Validation.Plan`). `GET …/entities/{entityId}/workflows`
    liste les 20, actifs et inactifs. Modifier un enregistrement de `commandes` en passant `statut` à `valide` avec
    `montant > 100` ⇒ `GET api/studio/workflows/{id}/instances` montre une instance `completed`, `trigger=field_changed`,
    `depth=0` ; `GET api/studio/workflows/instances/{instanceId}` ⇒ deux step runs `succeeded` (`verif` puis `maj`),
    `context.previous = null`, `traite_le` renseigné sur l'enregistrement.
77. **Validation des étapes** — `POST api/studio/entities/{entityId}/workflows/validate` avec, tour à tour :
    `type: "teleport"` ; `update_field` sur un champ `inconnu` ; `condition` avec `onFalse: "goto"` et `gotoKey`
    vers une étape **antérieure** ; 31 étapes ⇒ toujours `200` avec `isValid=false` et `errors[].path` =
    `steps[0].type`, `steps[0].set` (« Champ « inconnu » inconnu, inactif ou calculé. »), `steps[1].gotoKey`
    (« doit référencer une étape postérieure »), `steps` (31 > 30) ;
    `warnings[]` peut lister les étapes jamais atteintes. `PUT api/studio/workflows/{id}` du workflow du cas 76
    avec les mêmes étapes et son `rowVersion` ⇒ `400` dont le message est celui de la **première** issue,
    suivi de « (+n autre(s) erreur(s) — utilisez la validation pour la liste complète.) » s'il y en a
    plusieurs ; `GET` ⇒ définition inchangée (`version` identique, mêmes étapes).
78. **Déclencheur planifié accepté (4.7b1, D-47-B02 — remplace le refus « bientôt disponible » de la PR 4.1)** —
    `POST` et `PUT` avec `"trigger": "scheduled"` et `"triggerConfig": { "cron": "0 6 * * 1" }` ⇒ `201` / `200` ;
    sans `cron` ⇒ `400` `path="triggerConfig.cron"` « Une expression cron (5 champs, UTC) est requise pour le
    déclencheur « scheduled ». » ; cron à 4 ou 6 champs, texte libre, hors bornes ou plage inversée ⇒ `400`
    « Expression cron invalide : « … » (5 champs : minute heure jour-du-mois mois jour-de-semaine). » ; toute autre
    clé que `cron` / `filters` ⇒ « Propriété « x » non reconnue. » ; `filters` non tableau ⇒
    « « filters » doit être un tableau de 0 à 10 filtres { field, op, value, value2? }. » ; plus de 10 entrées ⇒
    « Le déclencheur planifié accepte au plus 10 filtres. » (chemin `triggerConfig.filters` dans les deux cas). `POST …/validate` avec le
    même corps ⇒ `200` `isValid=false` et les mêmes issues ; aucune définition créée ni modifiée. Détail : QA 122.
79. **Anti-boucle** — workflow **A** sur `commandes`, `trigger: "on_update"`, une étape `update_field`
    (`set: { "montant": "{{ montant }}" }`) : modifier un enregistrement ⇒ `GET workflows/{A}/instances` ⇒
    **une seule** instance `completed`, `depth=0`, pas de relance par sa propre écriture. Workflow **B** sur
    `taches`, `trigger: "on_create"`, étape `create_record` vers `commandes` (`set: { "statut": "brouillon" }`)
    et workflow **C** sur `commandes`, `on_create`, étape `create_record` vers `taches` : créer une tâche ⇒ B
    (`depth=0`) crée une commande ⇒ C (`depth=2`, `originInstanceId` = instance de B) crée une tâche ⇒ la
    relance de B est **refusée** (profondeur 3 > `MaxDepth = 2`, journal « Workflow trigger ignored beyond max
    depth ») : une seule instance de B, une seule de C, toutes deux `completed`, aucun enregistrement
    supplémentaire (chaque maillon ajoute 2 à la profondeur : le moteur exécute sous `Depth + 1` et le
    déclencheur démarre l'instance dérivée à `Depth + 1`). Les instances créées sont `completed` ou `failed`
    avec un message explicite — jamais `running` bloquée.
80. **`erp_action` via le Pont ERP** — `POST …/validate` avec une étape `erp_action` dont `action` n'est
    pas dans `StudioBridgeActionCatalog.List()` ⇒ `isValid=false`, `errors[].path = steps[i].action`. Avec une
    action bridgeable et `saveResultAs: "res"` sur un workflow `on_update` (le lancement `manual` arrive en
    PR 4.2) : modifier l'enregistrement ⇒ instance `completed`, `GET workflows/instances/{id}`
    montre le step run `erp_action` `succeeded` avec `result` non nul, `context.results.res` renseigné ; les
    journaux applicatifs portent la corrélation `studio-workflow:<instanceId>:<clé d'étape>` **sans** valeurs
    d'enregistrement. Simuler un échec (action bridgeable sur un enregistrement incomplet) : `onFailure`
    absent ⇒ instance `failed`, step run `failed`, notification `StudioWorkflowStepFailed` (type 17) au
    lanceur avec lien `/studio/d/commandes/{recordId}/edit` ; `onFailure: "continue"` ⇒ step run `failed`,
    instance poursuivie jusqu'à `completed`.

## Exécution des workflows (PR 4.2)

Prérequis : `Ollama:EnableStudioWorkflows=true`, un compte `custom_records:write`, un workflow
`manual` à 3 étapes dont une approbation « rôle Administrator, 1 h » sur une table de test.

### 81. Lancement manuel

`POST api/studio/records/{entityKey}/{recordId}/workflows/{key}/run` ⇒ `201` + en-tête `Location`
vers `api/studio/workflows/instances/{id}`. `GET api/studio/records/{entityKey}/{recordId}/workflow-instances`
liste l'instance en `waiting_approval`. Baisser le quota `MaxWorkflowInstancesPerRecord` à 1 sur le plan
de test puis relancer ⇒ `400 Validation.Plan` (aucune instance supplémentaire créée).

### 82. Boîte d'approbations

Avec un compte **Administrator** : `GET api/studio/workflows/approvals/mine` liste l'élément (workflow,
table, enregistrement, libellé) et `GET api/studio/workflows/approvals/mine/count` ⇒ `{ count: 1 }`.
Avec un compte **Accountant** non assigné : liste vide, et `POST …/approvals/{id}/approve` ⇒ `404`
(l'existence de l'approbation n'est pas révélée).

### 83. Décision

`POST …/approvals/{id}/reject` sans commentaire ⇒ `400 Validation.comment`. `POST …/approve` ⇒ `200`
`WorkflowInstanceDto` dont le statut a avancé (`running` puis `completed`). Un second `approve` sur la
même approbation ⇒ `409`. Le lanceur reçoit la notification 16 « Approbation « … » accordée ».

### 84. Expiration et reprise par le job

Créer une approbation à 1 h, avancer l'horloge (ou attendre). Au tick suivant du job
`studio-workflow-resume` (10 min) : l'approbation passe `expired` et l'instance suit `onTimeout`
(`reject` ⇒ `cancelled` « Approbation refusée » ; `approve` ⇒ la suite des étapes). Sur une instance
encore en attente : `POST …/instances/{id}/remind` ⇒ `200` (notification « Rappel : … » ré-émise) puis
un second appel immédiat ⇒ `409` (1 relance / 24 h).

### 85. Fail-closed

Désactiver l'utilisateur lanceur (ou lui donner un rôle plateforme) avant le tick : l'instance passe
`failed` avec « Lanceur introuvable ou inactif : reprise refusée. » et le lanceur reçoit la
notification 17. `POST …/instances/{id}/cancel` avec un compte `custom_records:write` **sans**
`studio:design_entities` ⇒ `200` `cancelled`. Couper `EnableStudioWorkflows=false` ⇒ les 11 routes
runtime de `StudioWorkflowRuntimeController` (9 de la PR 4.2, `records/{entityKey}/{recordId}/workflow-instances/{instanceId}`
de 4.5b2, `workflows/approvals/mine/history` de 4.7p1) répondent `404` « Les workflows Studio ne sont pas activés. » sans aucun traitement ; la route
`GET records/{entityKey}/{id}/history` (4.7h2) n'est **pas** sous ce drapeau (QA 152).

## Workflows par l'IA (PR 4.3)

Outil `studio_plan_workflow` (drapeaux `EnableStudioWorkflows` **et** `EnableStudioAiWorkflowTools`,
plus `EnableStudioAiPlanPreview`) ⇒ événement `studio_plan` de nature `Workflow` (aperçu
`summary.workflows[]`) ⇒ confirmation ⇒ `StudioAiWorkflowExecutor` (création **inactive** tout-ou-rien).

### 86. Flags off

`EnableStudioAiWorkflowTools=false` (ou `EnableStudioWorkflows=false`) ⇒ `studio_plan_workflow` absent
des outils envoyés au modèle, règle 14 « WORKFLOWS » absente du prompt StudioBuilder, capabilities
`workflowToolsEnabled=false`. Un appel direct `studio_plan_workflow` (réponse LLM forgée ou rejeu) ⇒
« Les workflows générés par l'IA ne sont pas activés. ». Un plan `Workflow` **déjà créé** dont la
confirmation arrive après l'extinction de l'un des trois drapeaux ⇒ « Les workflows Studio ne sont pas
activés. », aucun workflow créé (garde de l'exécuteur, y compris via le rejeu du plan).

### 87. Plan nominal

Drapeaux levés, demande « quand une facture passe à payée, notifie le commercial » ⇒ un événement
`studio_plan` unique dans le flux de chat, `summary.kind = "Workflow"`, `summary.workflows[0]` porte
clé, table (`entityKey` + `entityDisplayName`), déclencheur, étapes et `isActive:false`. Aperçu
`GET api/studio/ai/plans/{id}/preview` ⇒ `200` (feuille workflow). Confirmation ⇒ workflow créé
**inactif** (clé suffixée `_2…_9` si prise), `resultJson.workflows[0].id`, `openUrl: "/studio/workflows"`,
message « 1 workflow créé — inactif : activez-le depuis le hub après relecture. », audits
`Studio.Workflow.Created` et `Studio.AiPlan.Executed`. Le workflow n'a aucun effet tant qu'il n'est pas
activé depuis le hub.

### 88. Déclencheur planifié (réécrit en 4.7b5, D-47-B06 — l'IA conserve les workflows planifiés)

Demande « tous les lundis à 6 h » ⇒ le plan conserve le workflow avec `trigger: "scheduled"` (alias FR
« planifié » accepté par la spec) et `triggerConfig: { cron: "0 6 * * 1", filters?: [...] }` (alias `filtres`
replié en `filters`) ; aucun avertissement « bientôt disponible », plus aucune erreur « aucun workflow
réalisable » (les deux ont été retirés). Si le modèle omet le cron ou en produit un invalide ⇒ **contrôle
bloquant** du planificateur : « Workflow « … » : déclencheur planifié sans expression cron valide
(triggerConfig.cron — 5 champs, UTC). » (`BlockingErrors`, plan non créé — prérequis de la recette P1). Le
plan confirmé passe ensuite par la validation API de QA 78 / 122 (cron, filtres, clés inconnues). Détail : QA 126.

### 89. Champ / action inconnus bloqués

Spec forçant `update_field.set.inexistant`, `erp_action.action = "studio_plan_app"` ou
`approval.assignee.kind = "startedBy"` ⇒ erreur FR de l'outil (planner de revue), **aucun plan créé** ;
le message cite `studio_get_table_schema` pour revérifier les noms. Tolérés : `condition.filters[].field`
en `_previous.<champ connu>`, `_approval.*`, `_results.*`.

### 90. Exécution tout-ou-rien + legacy pont

Plan de 2 workflows dont le 2ᵉ dépasse le quota ⇒ aucun workflow restant après l'échec (rollback par
`DeleteWorkflowCommand`, `CancellationToken.None`), plan `Failed` avec message (et, si une suppression de
rollback échoue, « Annulation incomplète — workflow(s) inactif(s) à supprimer depuis le hub : … »). Côté
pont legacy : `GET api/studio/automations/actions` ne liste **plus** les outils `studio_*`
(`create_product` toujours présent) ; `POST api/studio/entities/{id}/automations` avec
`actionKey = "studio_plan_app"` ⇒ `400` `Validation.action` « Action ERP inconnue ou non autorisée. ».

## Workflows Studio — frontend (PR 4.4)

### 103. Hub et concepteur de workflows

`/studio/workflows` (drapeau on, `studio:design_entities`) : liste des workflows de la table choisie
(25 tables max sans sélection) ; création (nom, table, déclencheur, étapes dont une approbation et une
action ERP — le sélecteur ne liste que les actions `IsBridgeable`) ; « Valider » puis « Enregistrer » ⇒
workflow créé **inactif** ; activer depuis le hub ⇒ badge actif. Drapeau `EnableStudioWorkflows` coupé ⇒
redirection `/studio`, entrée de navigation « Workflows » absente.

### 104. Fiche : onglet Workflows

Fiche en édition d'une table dotée d'un workflow manuel actif : onglet « Workflows (n) » (n = instances
ouvertes) ; « Lancer un workflow » (permission write) ⇒ instance `waiting_approval` ; sans write : lecture
seule ; « Détail » (concepteur) ⇒ tiroir d'instance (déroulé des étapes, annulation avec motif, relance) ;
sonde 403/404 ⇒ onglet absent (aucun toast).

### 105. Mes approbations

Badge rouge dans la sidebar au plus tard 60 s après connexion (sonde `approvals/mine/count`) ; page
`/studio/approvals` : KPI (À traiter / En retard / Sous 24 h), tableau, « Détail » (colonne fixe ≥ 1 280 px,
tiroir sinon), **Approuver**, **Refuser sans motif bloqué** (commentaire obligatoire), 409 « déjà traitée »
⇒ toast + rechargement de la liste ; notification cloche type 15 ⇒ navigation + badge rafraîchi ; profil
`custom_records:read` seul ⇒ `/access-denied` (D11, U2).

### 106. Aperçu IA — plan Workflow

Carte d'intention « Workflow » active seulement si `workflowToolsEnabled` (sinon info-bulle
« Génération de workflows désactivée par l'administrateur. ») ; prompt « crée un workflow de validation
des congés… » ⇒ aperçu **onglet Workflow seul** (cartes-chronologies depuis `summary.workflows[]`,
Tester/Personnaliser désactivés, « Créer maintenant » actif) ; confirmation ⇒ carte
« Workflow « … » créé » avec bouton « Ouvrir dans le concepteur » (workflow créé **inactif**).

- Portée automatisée : +48 `it` Karma sous `features/studio` (g1 7, g2 12, h1 6, h2 8, i 4, j 1, k1 7, k2 4 — plus ceux d'A-44a) + 8 `it` sous `core/` (navigation j) ; 11 parcours Playwright + 4 captures (e2e, mocks HTTP). Baseline Studio 551 → 672 `it`.

## Consolidation Studio IA 4.5 — accès lecteur, « Demandé par », hub global, polish (PR #125 et suivantes)

Fiches transverses (UI + API) : les cas API figurent en sous-points, aucune fiche API séparée (D-45-25).

### 107. Accès lecteur (profil `Accountant` : `custom_records:read` sans `studio:design_entities`)

Connexion lecteur, drapeau on : « Mes approbations » apparaît dans la navigation dès la première réponse
200 de la sonde `approvals/mine/count` (au plus tard 60 s ; entrée « Workflows » absente) ; `/studio/approvals`
accessible ; « Voir l'instance » (inbox) et « Détail » (onglet Workflows d'une fiche) ouvrent le tiroir par
la **route runtime** `GET records/{entityKey}/{recordId}/workflow-instances/{instanceId}` — aucun appel à
`workflows/instances/{id}` (conception) ; bouton « Ouvrir l'origine » absent en portée fiche ; `/studio`
et `/studio/workflows` ⇒ `/access-denied`. Drapeau coupé ⇒ `/studio/approvals` redirige vers `/dashboard`
(et non `/access-denied`). API : 200 pour l'instance de la fiche avec `context.startedBy.email` = `null` et
`context.results` / `context.vars` = `{}` (route de conception : inchangée — D-45-27) ; 404 `StudioWorkflowInstance.NotFound`
pour une instance d'une autre fiche ou d'une autre table ; 400 `Validation.entityKey` pour une table
inconnue ou inactive ; 404 `CustomRecord.NotFound` pour un enregistrement inconnu ; 403 sans
`custom_records:read` ; 404 drapeau coupé avant tout appel au médiateur.

### 108. « Demandé par »

Page « Mes approbations » : 7e colonne « Demandé par » avec « Prénom Nom » du lanceur ; panneau de détail :
fait « Demandé par » ; « — » si le lanceur est inconnu, sans nom, supprimé ou d'un autre tenant (mode
délégué cabinet) — jamais d'email. API : `GET workflows/approvals/mine` renvoie `startedByName` (camelCase)
en fin d'élément, `null` par défaut ; une seule requête master pour les lanceurs distincts ;
`WorkflowInstanceDto` inchangé (pas de `startedByName`).

### 109. Hub « Toutes les tables »

`/studio/workflows` sans `?entity=` : **une** requête `GET workflows?page=1&pageSize=200` (plus de requête
par table, plus de message « plus de 25 tables ») ; colonne « Table » renseignée depuis `entityDisplayName`,
tri table puis nom ; au-delà de 200 workflows, message « Seuls les 200 premiers workflows sont affichés :
choisissez une table pour voir les autres. » et liste toujours affichée ; `?entity=` ⇒
`GET entities/{id}/workflows` inchangé ; 500 ou 404 ⇒ liste vide (toast d'erreur soumis à D-44-95 : pas
d'hôte `<p-toast>` dans le hub). API : `search` (contient, nom ou clé, ≤ 128), `page` ≥ 1, `pageSize`
borné 1..200 (0 ⇒ 1, 500 ⇒ 200), `page=2147483647` ⇒ 200 avec page vide (jamais 500 — D-45-28), tri
`entityDisplayName, name, key`, tables actives non-jonction
seulement, définitions actives et inactives, `PagedResult` (`totalCount`, `totalPages`, `hasNextPage`) ;
403 sans `studio:design_entities` (policy **et** handler) ; 404 drapeau coupé.

### 110. Déconnexion et toast unique

Connecté avec n approbations en attente (badge n) : déconnexion (ou jeton expiré) ⇒ badge à 0, plus aucune
requête `approvals/mine/count` (observer le réseau pendant 60 s) ; reconnexion ⇒ badge rafraîchi au plus
tard 60 s après. Fiche enregistrement, onglet Workflows : lancer, annuler ou relancer une instance ⇒ **un
seul** toast (celui de la fiche hôte), plus de doublon ; le toast n'a plus la classe `studio-theme`
(accepté, D-45-20).

- Portée automatisée : +22 `it` Karma (`features/studio` +19 dont 2 issus de la revue ★ — portée figée du tiroir
  D-45-29, routes ouvertes au lecteur — , `core` +3 ; 5 réécrits 1:1, 0 supprimé) ; backend : API Studio 131 → **136**,
  Infra Studio **1440** (+1 borne `page`, assertions D-45-27), dépôt SQL **18** (0 ignoré) ; Playwright mocké :
  2 mocks ajoutés (`records/{entityKey}/r1/workflow-instances/inst-1`, `GET workflows` paginé), deux assertions
  de `studio-approvals.spec.ts` réalignées (« Demandé par » visible ; sonde 404 ⇒ `/dashboard` — D-45-26) et
  +1 assertion « Détail » (route runtime) dans le parcours fiche de `studio-workflows.spec.ts` — aucun
  nouveau parcours (11 réussis + 4 ignorés).

### 111. Hub « Toutes les tables » : pagination serveur

Concepteur, plus de 50 workflows dans l'entreprise : le hub « Toutes les tables » n'affiche que 50 lignes,
le compteur indique le **total serveur** (« 250 workflow(s) ») et un paginateur apparaît ; page 2 ⇒
nouvelle requête `GET workflows?page=2&pageSize=50`, ordre du serveur conservé (pas de re-tri local).
Avec `?entity=` : liste intégrale de la table, **pas** de paginateur (4.6a1, D-46-02).

- Portée automatisée : Karma hub réécrit (`paged(items, totalCount)`, paramètres `page`/`pageSize`
  vérifiés, paginateur absent en mode table) ; la page unique de 200 et le message de troncature ont
  disparu (D-45-F07 levé).

### 112. Hub : recherche serveur

Concepteur, hub « Toutes les tables » : taper « relance » ⇒ aucune requête avant 300 ms (anti-rebond),
puis `GET workflows?search=relance&page=1&pageSize=50` et retour page 1 ; vider le champ ⇒ `search` absent
(page 1 rechargée). En mode table (`?entity=`), la recherche reste **locale** (aucune requête serveur)
(4.6a1, D-46-03 ; jokers `LIKE` acceptés tels quels côté API — D-45-28).

- Portée automatisée : Karma hub (`fakeAsync` 299/300 ms, `expectNone`/`expectOne` avec paramètres).

### 113. Concepteur : panneau « Historique » paginé (ex-« instances récentes » borné à 50 — remplacé en 4.7a1/a2)

Concepteur, définition avec plus de 20 instances : le panneau, retitré **« Historique »**, demande
`GET workflows/{id}/instances?page=1&pageSize=20` et affiche 20 lignes puis le total serveur ; le bouton
« Charger plus — encore N » accumule les pages suivantes et disparaît quand tout est chargé. L'ancienne
invite « Les 50 instances les plus récentes sont affichées. » et le paramètre `?max=` n'existent plus (D-46-01
**levé**, D-47-B01/F01). Détail : QA 120.

- Portée automatisée : Karma panneau `studio-workflow-instances-panel.component.spec.ts` (6 `it` : page 1 de 20,
  « Charger plus » page 2, disparition du bouton, `refreshToken`, badge, état vide) ; API
  `List_instances_defaults_page_1_size_50_clamps_size_to_1_200_and_returns_paged_envelope`.

### 114. « Demandé par » sur les instances

Fiche enregistrement, onglet Workflows : la colonne **Demandé par** affiche le nom du lanceur
(`startedByName`, « — » si inconnu ou non résolu). Tiroir de détail (fiche et « Mes approbations ») :
« Demandé par » = nom du lanceur, guid si le nom n'est pas servi, « Système » si démarrage automatique.
Les réponses d'écriture (lancer, annuler, relancer) ne portent pas le nom (repli guid/Système jusqu'au
rechargement) (4.6b1 + 4.6c1, D-46-04/06).

- Portée automatisée : Karma onglet (+1 `it` colonne) et tiroir (+1 `it`, +1 assertion « Système ») ;
  Playwright mocké : `startedByName: 'Alice Martin'` sur inst-1, `wf-detail-started-by-inst-1` =
  « Alice Martin », `srw-requested-by-inst-2` = « — » ; backend : Infra Studio +4 (résolution en un lot,
  nom servi en portée lecteur avec email toujours masqué), API Studio +1 (`startedByName` camelCase,
  défaut null).

### 115. Surface lecteur : résultats d'étapes masqués

Lecteur (`custom_records:read` sans `studio:design_entities`), tiroir depuis la fiche : le détail de
l'instance ne sert plus `steps[].result` ni `steps[].error` (null), y compris sur une étape en échec ;
l'`error` au niveau instance est masquée aussi (détail ET liste de la fiche — revue ★ 4.6) ;
`context.startedBy.email`, `results`, `vars` restent expurgés. La route de conception (concepteur) sert
toujours tout (4.6b2, D-46-05 — résiduel D-45-27 levé).

- Portée automatisée : Infra Studio — runtime : `Assert.All(Steps, Result/Error null)` + 2 faits
  (erreur instance masquée au détail et à la liste) ; conception : étape en échec avec `Error` servi et
  `Result` null (1:1) + 1 fait (erreur instance servie sur la route de conception).

### 116. Toasts du hub

Concepteur, hub : basculer un workflow en conflit (409), le supprimer, le dupliquer ou le créer ⇒ le toast
de succès/d'erreur **s'affiche** (avant 4.6d1, `MessageService.add` sans hôte `<p-toast>` = muet —
D-44-95). Un seul hôte par page ; l'onglet Workflows de la fiche garde celui de la fiche (D-44-89
inchangé).

- Portée automatisée : Karma hub (+1 `it` : `p-toast` présent + toast de succès après bascule).

### 117. Toasts du concepteur

Concepteur : **Enregistrer** ⇒ toast de succès visible ; conflit 409 (jeton périmé) ⇒ toast d'avertissement
visible (4.6d1, D-44-95).

- Portée automatisée : Karma concepteur (+1 `it` : `p-toast` présent + succès après enregistrement ;
  spy `MessageService.add` ajouté au setup).

### 118. Onglet Workflows de la fiche : annulation confirmée

Fiche enregistrement (écriture), onglet Workflows : **Annuler** n'envoie plus le POST immédiatement — un
panneau inline demande un **motif optionnel** (500 caractères max, compteur) ; « Confirmer l'annulation »
envoie le POST (motif trimmé) et referme le panneau ; « Retour » ferme sans rien envoyer ; en cas d'erreur
(409 « déjà terminée »), le panneau reste ouvert et le message serveur s'affiche. Rouvrir sur une autre
instance repart avec un motif vide (4.6d2, D-44-96).

- Portée automatisée : Karma onglet (2 `it` réécrits 1:1 : confirmation + motif trimmé + réinitialisation
  + 409 ; « Retour » sans POST).

### 119. Accessibilité de l'onglet et clé de jonction

Fiche enregistrement, onglet Workflows : les boutons icônes (Détail, Relancer, Annuler) ont un nom
accessible (`aria-label`), le sélecteur du dialogue « Lancer » aussi, l'en-tête de la colonne d'actions
n'est plus vide. Studio → Relations, « Relation plusieurs-à-plusieurs » : la clé de jonction proposée est
`{table}_{table}` **sans préfixe `v_`** (réservé aux vues) ; les jonctions existantes restent valides
(4.6d2 + 4.6e, D-46-08/09).

- Portée automatisée : Karma onglet (assertions `aria-label`) ; Karma dialogue M-à-N (+1 `it` : la clé par
  défaut ne commence jamais par `v_`).

## Studio IA 4.7 « v1.1 » — workflows : historique paginé, déclencheur planifié, test (PR #151 à #159)

> Prérequis : `EnableStudioWorkflows=true` (et `EnableStudioAiWorkflowTools=true` pour 126) ; un compte avec
> `studio:design_entities` ; une table `commandes` alimentée (voir le prérequis de la PR 4.1). Sous-flux 4.7a
> (instances paginées, D-47-B01/F01/F02), 4.7b (déclencheur planifié, D-47-B02→B06, F03) et 4.7c (simulation
> « Tester », D-47-B07/B08, F04) ; lignes de reconstruction au Journal (4.7d1). Architecture :
> [`docs/architecture/studio-workflows.md`](../architecture/studio-workflows.md) (« Déclencheur planifié (4.7b) »).
> Les numéros 120–129 sont ceux annoncés par les corps de commit a2, b1→b5, c1, c2.

### 120. Historique des instances paginé

Concepteur, workflow **enregistré** : le panneau « Historique » émet **1 GET** `workflows/{id}/instances?page=1&pageSize=20`
et affiche 20 lignes puis le total serveur ; « Charger plus — encore N » émet `page=2` et **accumule** ; le bouton
disparaît quand tout est chargé (dès la page 1 si total ≤ 20) ; un enregistrement / une exécution manuelle fait
varier `refreshToken` (enregistrement réussi d'un workflow existant ; annulation / relance d'une instance depuis le
drawer) ⇒ rechargement depuis la page 1, accumulation réinitialisée. API : `page` défaut 1 (clamp
D-45-28 `int.MaxValue / 200`), `pageSize` défaut 50 clampé 1..200, enveloppe `PagedResult<WorkflowInstanceDto>`
(`items`, `page`, `pageSize`, `totalCount`) ; `?max=` n'est plus accepté (ignoré).

- Portée automatisée : Karma `studio-workflow-instances-panel.component.spec.ts` (6 `it` : page 1 de 20 et
  total, « Charger plus » `page=2` accumule, bouton absent si tout chargé, `refreshToken`, badge, état vide sans
  requête) ; Karma service (`listInstances` `?page=&pageSize=` + bornes 1 / 1..200) ; API
  `List_instances_defaults_page_1_size_50_clamps_size_to_1_200_and_returns_paged_envelope`.

### 121. Badge « ouvertes »

Le badge `wf-instances-open-count` du panneau affiche `openCount`, valeur fournie par le concepteur depuis
`openInstances()` de la définition (pas de comptage local des lignes chargées) ; à 0 le badge est **absent** du
DOM ; il ne change pas quand on charge plus de pages.

- Portée automatisée : Karma panneau (« badge = entrée openCount même sans instance chargée ») ; Playwright
  `e2e/studio-workflows.spec.ts` (mocks en enveloppe `PagedResult`, `pagedInstances` de
  `e2e/helpers/studio-workflow-mock.helpers.ts`).

### 122. Déclencheur planifié : validation API

`POST api/studio/entities/{entityId}/workflows` / `PUT api/studio/workflows/{id}` avec `"trigger": "scheduled"` :
`triggerConfig` sans `cron` ⇒ `400` `triggerConfig.cron` (« Une expression cron (5 champs, UTC) est requise … ») ;
cron à 4 ou 6 champs, texte libre (« chaque jour »), valeur hors bornes (`61 * * * *`, `0 6 * * 8`), pas nul
(`*/0 * * * *`), plage inversée ⇒ `400` « Expression cron invalide : … » ; clé autre que `cron` / `filters` ⇒ « Propriété « x » non reconnue. » ; `filters` > 10 entrées ou
non tableau ⇒ `400` `triggerConfig.filters` ; filtre sur champ inconnu, inactif ou calculé, sur `_previous` /
`_results`, ou avec un opérateur incompatible avec le type ⇒ `400` sur `triggerConfig.filters` (chemin **sans**
indice, contrairement aux étapes `condition` ; messages « Champ de filtre inconnu ou inactif : « x ». », « Champ
calculé non filtrable : « x ». », « Opérateur « op » incompatible avec le champ « x ». », « Opérateur inconnu : « op ». ») ; forme valide
(`*/10 * * * *`, `0 6 * * 1`, `0 0 1 JAN *`, `0 18 * * MON-FRI`, `0 6 * * 0`) avec 0..10 filtres ⇒ `201` / `200`,
`triggerConfig` restitué tel quel (`TriggerConfigJson`, aucune migration). `POST …/validate` renvoie les mêmes issues
avec `isValid=false`.

- Portée automatisée : Infra `StudioWorkflowStepsSpecTests` — `Scheduled_trigger_requires_a_valid_cron`,
  `Scheduled_trigger_accepts_valid_cron_expressions`, `Scheduled_trigger_rejects_unknown_properties_and_bad_filters`,
  `Scheduled_trigger_accepts_valid_filters` ; `StudioWorkflowFeaturesTests` —
  `Create_accepts_a_scheduled_trigger_with_a_valid_cron`, `Create_rejects_a_scheduled_trigger_without_a_valid_cron`.
  **Aucun test dédié à `StudioWorkflowCronSpec`** (analyseur pur) : ajouté en ★2.

### 123. Ordonnancement Hangfire aux écritures

Créer / modifier / activer un workflow **actif et planifié** ⇒ job récurrent Hangfire
`studio-workflow-scheduled:{tenantId:N}:{definitionId:N}` ajouté ou mis à jour (`AddOrUpdate`, cron en UTC) ;
désactiver, supprimer, changer le type de déclencheur ⇒ `RemoveIfExists` ; bascule `toggle` idempotente (même état)
⇒ aucune synchronisation ; cron illisible en base ⇒ retrait du job + `LogWarning`, sans exception ; Hangfire
indisponible ⇒ l'écriture métier réussit quand même (erreur absorbée, journalisée). La synchronisation a lieu
**après** l'écriture réussie, jamais avant.

- Portée automatisée : Infra `StudioWorkflowScheduleServiceTests` (6 : `Sync_registers_the_job_for_an_active_scheduled_definition`,
  `Sync_removes_the_job_for_an_inactive_or_deleted_definition`, `Sync_removes_the_job_for_a_non_scheduled_trigger`,
  `Sync_removes_the_job_without_throwing_when_the_cron_is_unreadable`, `Sync_swallows_a_hangfire_failure_best_effort`,
  `RemoveDefinition_removes_the_job_id_and_swallows_failures`) ; accroches dans `StudioWorkflowFeaturesTests` :
  `Create_syncs_the_schedule_after_the_write`, `Update_syncs_the_schedule_after_a_successful_write`,
  `Toggle_syncs_the_schedule_once_per_effective_change`, `Delete_removes_the_scheduled_job`.

### 124. Tick du job planifié

À chaque tick (`StudioWorkflowScheduledJob.FireAsync(tenantId, definitionId)`, `DisableConcurrentExecution 540 s`,
`AutomaticRetry 0`) : drapeau `EnableStudioWorkflows` coupé ⇒ aucun traitement ; tenant sans chaîne de connexion ⇒
tick ignoré ; définition inactive, supprimée ou retypée ⇒ **job retiré**, rien démarré ; filtres illisibles ⇒ tick
ignoré ; sinon balayage `QueryAsync` des enregistrements filtrés par lot (`StudioWorkflowScheduledBatchSize`, défaut 100,
clamp 10..500) ⇒ **une instance système** par fiche (`trigger=scheduled`, `startedBy` nul, « Demandé par » vide) ;
fiche ayant déjà une instance **ouverte** de ce workflow (ou de sa chaîne) ⇒ ignorée ; instance terminée ou ouverte
sur un **autre** workflow ⇒ redémarrée ; quota `MaxWorkflowInstancesPerRecord` atteint ⇒ ignorée ; total > lot ⇒
`LogWarning` « suite au prochain tick » ; une fiche en erreur n'interrompt pas les autres ; compteurs
balayés / démarrés / ignorés / échoués dans le log.

- Portée automatisée : Infra `StudioWorkflowScheduledJobTests` (13 faits `Fire_*` / `Tick_*`, mocks stricts :
  drapeau coupé, sans connexion, une instance par fiche, filtres + lot clampé transmis à la requête, instance ouverte
  ignorée, autres workflows ⇒ redémarrage, quota, définition inactive / supprimée ⇒ retrait, filtres illisibles,
  total > lot, fiche en erreur isolée, `SetTenant` bout en bout).

### 125. Concepteur : carte « Planifié »

Concepteur, déclencheur : la carte « Planifié » est **sélectionnable** (plus de veto « bientôt ») ; le sous-formulaire
`wf-scheduled-config` propose les préréglages « Toutes les heures » (`0 * * * *`), « Chaque jour à 06:00 UTC » (`0 6 * * *`),
« Chaque lundi à 06:00 UTC » (`0 6 * * 1`) et « Personnalisé » (saisie libre `wf-cron`, aide « fuseau UTC ») ; les filtres passent par
`app-studio-filter-builder` (`between` replié en `value` / `value2`) ; **Enregistrer** reste désactivé tant que le
cron est vide ; changer de type de déclencheur réinitialise `triggerConfig` (aucune clé `field_changed` résiduelle) ;
la jauge « La configuration du déclencheur dépasse 2 Ko. » s'applique aussi au planifié ; un `400
triggerConfig.cron` serveur s'affiche en bannière.

- Portée automatisée : Karma `studio-workflow-designer.component.spec.ts` (6 `it` : carte sélectionnable + cron requis,
  préréglage / « Personnalisé », filtres via l'adaptateur, réinitialisation au changement de type, enregistrement
  `{ cron, filters }`, bannière `400`).

### 126. IA : plan planifié

Assistant, outil `studio_plan_workflow` : « rappel tous les lundis à 6 h » ⇒ le plan **conserve** le workflow
(`trigger: scheduled`, alias FR « planifié », `triggerConfig.cron`, alias `filtres` ⇒ `filters`) ; sans cron ou cron
invalide ⇒ contrôle **bloquant** « Workflow « … » : déclencheur planifié sans expression cron valide (triggerConfig.cron
— 5 champs, UTC). », plan non créé ; la description de l'outil (`AiToolRegistry`) ne parle plus de « bientôt
disponible ». Voir QA 88 (réécrite). L'aperçu du plan dans l'atelier affiche le déclencheur comme « Planifié »
(`studio-ai-labels.ts`, clé `scheduled` — libellé « Planifié (bientôt) » corrigé au lot ★1, D-47-76 ; QA 153).

- Portée automatisée : Infra `StudioAiWorkflowSpecTests.Keeps_scheduled_workflows_with_cron_and_filters`,
  `StudioAiWorkflowSpecTests.Parses_a_scheduled_only_plan_with_the_french_alias`,
  `StudioAiWorkflowPlannerTests.Review_blocks_a_scheduled_workflow_without_a_valid_cron`.
- **Écart prompt clôturé (4.7 suite)** : la règle 14 du prompt StudioBuilder (`AiContextBuilder.cs`) propose
  désormais `scheduled` avec `triggerConfig.cron` (5 champs, UTC, requis — exemple « chaque matin » ⇒ `"0 6 * * *"`) ;
  fait `Workflow_rule_14_stays_short_and_names_the_scheduled_trigger_with_a_utc_cron` (budget ≤ 560) ;
  `SystemPromptCacheRevision` « v8 » → « v9 ». Comportement antérieur (modèle conservait un planifié demandé
  sans le proposer) : D-47-73.

### 127. `POST workflows/{id}/test` : simulation pure

`POST api/studio/workflows/{id}/test` corps `{ "recordId": "<guid>" }` ⇒ `200` `WorkflowTestResultDto`
(`recordId`, `entityKey`, `evaluatedSteps`, `suspended`, `steps[]` `{ key, type, label, verdict, detail, rendered }`,
`warnings[]`) : le **premier segment** (≤ 30 lignes de trace, puis avertissement « Segment épuisé … ») est simulé sur
une **copie** du document ; verdicts `would_run` / `skipped` / `would_suspend` / `would_fail` ; les sorties
`_results.*` non produites ⇒ avertissement « Sorties fictives : … ». **Aucune écriture** : aucune instance, aucun
step run, aucune approbation, fiche inchangée. Fiche inconnue ou d'un autre tenant ⇒ `404` ; définition dont `StepsJson`
est illisible ⇒ `400` `Validation.steps` ; drapeau coupé ⇒ `404` ; sans `studio:design_entities` ⇒ `403` (policy du
contrôleur ; le handler re-vérifie la permission).

- Portée automatisée : Infra `StudioWorkflowTestFeaturesTests` (10 `[SkippableFact]`, SQL réel, invariant
  `AssertNoWriteAsync` : 0 ligne dans `StudioWorkflowInstances`, `StudioWorkflowStepRuns`, `StudioWorkflowApprovals`
  et `AuditLogs` après chaque simulation) ; API `Test_sends_the_query_and_returns_200_with_the_trace`,
  `Test_maps_not_found_to_404_and_invalid_definition_to_400`.

### 128. Dialogue « Tester sur un enregistrement »

Concepteur : bouton `wf-test` (après « Valider ») **désactivé** tant que le brouillon est sale ou non enregistré,
infobulle « Enregistrez d’abord pour tester. » (apostrophe typographique, comme le libellé) ; ouverture ⇒ 10 enregistrements chargés, recherche anti-rebond
300 ms, libellé = premier champ texte (D-44-24) ; « Lancer le test » ⇒ `POST { recordId }` puis trace rendue
(verdict par étape — Exécutée / Sautée / En attente / En échec —, détail, « Valeurs rendues ») sous le bandeau « Simulation — aucune donnée n’a été écrite. » ; `400` / `404`
affichés **en ligne** dans le dialogue (aucun toast, `skipErrorUi`) ; aucun appel d'écriture émis.

- Portée automatisée : Karma concepteur `describe('dialogue « Tester » (4.7c2)')` (4 `it` : bouton désactivé +
  infobulle, 10 enregistrements + anti-rebond + libellés, simulation sans appel d'écriture, `404` inline) ; Karma
  service (`testWorkflow poste { recordId } sur workflows/{id}/test`).

### 129. Garde-fous conception v1.1

`StudioWorkflowsController` expose **13 routes figées** (`FrozenRoutes` : 11 de la PR 4.1 + `GET workflows` — catalogue tenant
4.5c3, consommé par le hub 4.5f — + `POST workflows/{id}/test`) ; drapeau coupé ⇒ `404` sur les 13 sans appel au médiateur ; policy de classe
`StudioDesignEntities`, aucune action avec un `[Authorize]` plus faible ; `?max=` a disparu de la route
`instances` (rupture interne assumée, seul consommateur = panneau).

- Portée automatisée : API `Route_table_matches_the_frozen_contract`,
  `Every_route_returns_404_and_calls_nothing_when_the_flag_is_off`, `No_action_carries_a_weaker_authorize_attribute`.

## Studio IA 4.7 « v1.1 » — vues : aperçu en direct du brouillon (PR #160, #161)

### 130. Création d'une vue : l'aperçu suit le brouillon sans enregistrer

`/studio/d/<table>/views/new` : la grille d'aperçu se remplit dès la définition valide ; ajouter une
colonne ou un filtre ⇒ mise à jour après ~300 ms ; `POST /views/preview` est émis, **jamais** `/run`
ni `/views` tant qu'« Enregistrer » n'est pas cliqué ; le compteur de vues de la table n'augmente pas.

- Portée automatisée : Karma concepteur de vues (création : runner monté d'emblée, POST
  `/views/preview` au montage, jamais `/run`) ; Karma service (`previewRecordView`).

### 131. Édition : l'aperçu reflète le brouillon, y compris le mode

Modifier un tri/un filtre ⇒ aperçu mis à jour après ~300 ms (aucune requête avant le délai) ;
basculer Liste → Kanban ⇒ le kanban **du brouillon** s'affiche (plus de message « version
enregistrée ») ; « Actualiser l'aperçu » force une exécution immédiate.

- Portée automatisée : Karma concepteur (anti-rebond vérifié en temps réel — `tick()` annule les
  XHR en attente sous Karma/zone.js, motif retenu : `sleep` 250/400 ms ; changement de mode :
  `/preview` repart avec le nouveau `mode` ; Actualiser : exécution hors anti-rebond).

### 132. Définition invalide et erreur serveur

Kanban sans champ de regroupement / pageSize hors bornes ⇒ hint « Complétez la définition pour voir
l'aperçu. », **aucune** requête émise ; champ supprimé entre-temps ⇒ 400 rendu en ligne dans le
panneau avec « Réessayer », aucun toast global pendant la frappe.

- Portée automatisée : Karma concepteur (hint invalide + 0 requête) ; Karma runner (erreur réseau ⇒
  état inline sans toast en mode preview).

### 133. Garde-fous

Profil lecteur (sans `studio:design_forms`) : hint « L'aperçu en direct est réservé aux
concepteurs. », pas de runner ; `POST /views/preview` ⇒ 403 ; drapeau `EnableStudioRecordViews`
coupé ⇒ 404 ; aucune ligne d'audit `Studio.RecordView.*` pour un aperçu ; quota « 20 vues/table »
non consommé.

- Portée automatisée : Karma concepteur (lecture seule : hint, pas de runner) ; API contract
  (policy + gabarit figés, drapeau coupé ⇒ 404) ; Infrastructure (handler sans dépendances
  vues/quota/audit — `VerifyNoOtherCalls`).

---

## Studio IA 4.7 « v1.1 » — approbations : onglet Historique (PR #168, #169)

> Prérequis : `EnableStudioWorkflows=true` ; un compte approbateur (`custom_records:read` + `custom_records:write`)
> ayant déjà approuvé et refusé au moins une demande (QA 82–84). Page `/studio/approvals` (« Mes approbations »).
> Décisions D-47-60 (API + onglet) et D-47-61 (« Déléguées » désactivé) au Journal.

### 134. Onglet « Historique » de Mes approbations

Onglets `À traiter | Déléguées | Historique` (`app-studio-record-tabs`). Première activation de **Historique** ⇒
**1 GET** `workflows/approvals/mine/history?max=50`, squelette (5 lignes) puis tableau Workflow / étape / Enregistrement /
Demandé par / Décidée le (`dd/MM/yyyy HH:mm`) / Décision (`p-tag` « Approuvée » vert, « Refusée » rouge) /
Commentaire (tronqué à 80 caractères + « … », texte complet en `title`). Revenir sur « À traiter » puis sur
« Historique » ⇒ **aucun** nouvel appel (chargement paresseux, une seule fois). Le badge de « À traiter » reste
celui des demandes en attente.

- Portée automatisée : Karma `studio-approvals-page.component.spec.ts` (« onglet « Historique » : chargé à la
  première activation seulement, statut et date affichés ») ; Playwright `e2e/studio-approvals.spec.ts` (onglets :
  `studio-tab-history`, `sap-history-row-h1`, `sap-history-decision-h1` « Refusée », `sap-history-comment-h1`).

### 135. États vide et erreur

Aucune décision passée ⇒ icône horloge + « Aucune décision passée » et l'indice « Vos décisions d'approbation
apparaîtront ici (conservées 180 jours). » (`StudioWorkflowRetentionDays`, défaut 180 : les instances purgées
disparaissent aussi de l'historique). API en `500` ⇒ bannière en ligne « Impossible de charger l'historique. » +
bouton `sap-history-retry` ; **aucun toast global** (`skipErrorUi`) ; « Réessayer » relance le GET.

- Portée automatisée : Karma (« onglet « Historique » : erreur ⇒ bannière + Réessayer ») ; Infra
  `ListMyApprovalHistory_keeps_terminal_instances_and_skips_purged_ones`.

### 136. Onglet « Déléguées »

Onglet **désactivé** (`button[disabled]`, `title` « Bientôt », opacité réduite, curseur `not-allowed`) : clic sans
effet ; les flèches ← / → du clavier passent dessus sans le sélectionner (`select` refuse un onglet `disabled`) ;
jamais activé ⇒ aucune requête ; aucun concept de délégation dans le domaine, aucune donnée inventée (convention
« Bientôt », D-47-61).

- Portée automatisée : Karma (« onglet « Déléguées » : désactivé avec infobulle « Bientôt », jamais activé ») ;
  Playwright `e2e/studio-approvals.spec.ts` (même test que 134).

### 137. API historique

`GET api/studio/workflows/approvals/mine/history?max=50` : uniquement mes décisions (`DecidedBy` = moi) au statut
`Approved` / `Rejected`, tri `DecidedAt` décroissant, `max` clampé 1..200 (`0` ⇒ 1, `999` ⇒ 200, défaut 50), même
forme d'élément que l'inbox `approvals/mine` (`StudioApprovalInboxEnrichment` sans filtrage des instances
terminales) ; instance purgée ⇒ décision omise ; drapeau coupé ⇒ `404` « Les workflows Studio ne sont pas
activés. » ; sans `custom_records:read` ⇒ `403`.

- Portée automatisée : API `ListMyApprovalHistory_returns_200_with_the_inbox_item_shape_and_default_max_50`,
  `Every_route_returns_404_and_calls_nothing_when_the_flag_is_off` (contrat runtime) ; Infra
  `StudioWorkflowApprovalFeaturesTests` — `ListMyApprovalHistory_returns_my_decisions_with_status_comment_and_starter_name`,
  `ListMyApprovalHistory_clamps_max_to_200`, `ListMyApprovalHistory_requires_records_read`.

### 138. Autorisations runtime

Les **11 routes** de `StudioWorkflowRuntimeController` sont sous `api/studio` : tous les `GET` exigent la policy
`CustomRecordsRead`, tous les `POST` la policy `CustomRecordsWrite` (R17) ; la nouvelle route `history` suit la
règle. Un profil `custom_records:read` seul lit ses approbations et son historique mais ne peut ni approuver ni
refuser (`403`).

- Portée automatisée : API `Controller_is_routed_under_api_studio_with_read_policies_on_GET_and_write_policies_on_POST`.

### 139. Réservé

Numéro laissé libre pour un scénario « approbations » ultérieur (délégation réelle ou filtre de l'historique).

---

## Studio IA 4.7 « v1.1 » — relations : attribut de liaison et puces inline (PR #163 à #166)

### 140. Dialogue N-N : attribut de liaison

Dans le concepteur de table, dialogue « Nouvelle relation plusieurs-à-plusieurs » : « Attribut de
liaison » renseigné (« Quantité ») ⇒ la jonction créée porte un **3ᵉ champ numérique** (clé
`quantit`), visible dans le concepteur via l'URL de la jonction ; laissé vide ⇒ comportement v1
inchangé (deux champs seulement). Libellé réservé (`id`) ou en collision avec une clé de liaison ⇒
`400 Validation.junctionAttributeLabel`, **aucune** écriture.

- Portée automatisée : Infrastructure `CreateManyToManyRelationCommandTests` (nominal 3 champs +
  séquence + audit ; [Theory] ×4 rejets sans écriture ni audit ; compensation) ; Karma dialogue
  (champ actif, label envoyé, vidé au reset) ; contrat API (`attributeField` en réponse).

### 141. Onglet « Liés » : quantité affichée et saisie à l'ajout

La quantité s'affiche par lien ; ajout avec quantité ⇒ valeur visible après rafraîchissement ;
jonction **sans** attribut ⇒ aucune colonne/affichage (non-régression v1) ; schéma de jonction en
404 ⇒ dégradé silencieux (pas de bannière d'erreur pour la lecture).

- Portée automatisée : Karma service `getJunctionAttribute` (résolution via `/schema`, cache
  `shareReplay` — un seul appel HTTP, 404 ⇒ `null`) ; Karma onglet (affichage, ajout avec quantité).

### 142. Onglet « Liés » : édition inline de la quantité

Crayon ⇒ `p-inputNumber` ⇒ Enregistrer ⇒ `PATCH records/{jonction}/{id}` avec `rowVersion` ; 409
jeton périmé (deux onglets ouverts) ⇒ « Modifié entre-temps — liste rechargée. » + rechargement ;
la paire reste protégée (doublon à l'ajout ⇒ 409 « Lien déjà existant. » en ligne).

- Portée automatisée : Karma service `patchLink` (motif `patchRecord`, `skipErrorUi`) ; Karma onglet
  (édition + 409) ; Infrastructure `CustomRecordJunctionUniquenessTests` (la paire reste contrôlée
  avec un 3ᵉ champ attribut).

### 143. Fiche en édition : puces inline par relation N-N

Sous le formulaire (onglet Fiche), **une carte de puces par relation N-N** ; ajout avec quantité,
retrait, édition de la quantité au clic ; fiche en **création** ⇒ aucune carte (les puces exigent un
enregistrement existant, comme l'onglet « Liés »).

- Portée automatisée : Karma composant puces (montage + libellés + quantité) ; Karma fiche (une
  carte par relation N-N en édition, aucune en création) ; Playwright mocké (scénario complet).

### 144. Puces : doublon et retrait

Ajout d'un doublon ⇒ 409 « Lien déjà existant. » **en ligne** dans la carte, puces inchangées ;
retrait ⇒ DELETE + toast de succès (hôte `<p-toast>` de la fiche, pas de toast en double).

- Portée automatisée : Karma composant (doublon 409 en ligne ; retrait + `toast.add` appelé une
  fois) ; Playwright mocké (surcharge de route 409 ; DELETE vérifié).

### 145. Lecture seule

Profil `custom_records:read` sans `:write` : quantités et puces visibles, **aucune** action
d'écriture (barre d'ajout, crayons et croix masqués) — miroir de la garde `canWrite` de l'onglet.

- Portée automatisée : Karma composant puces (lecture seule) ; Karma onglet (miroir existant) ;
  Playwright mocké (parcours lecteur couvert par les permissions mockées).

## Studio IA 4.7 « v1.1 » — historique de la fiche (PR #173 à #175)

Onglet **Historique** de la fiche enregistrement (`app-studio-record-history-tab`), consommateur de
`GET api/studio/records/{entityKey}/{id}/history?page&pageSize` (audit `StudioRecordAudit`, 4.7h1–h2).
Décisions D-47-64 (socle), D-47-65 (composant), D-47-66 (branchement) au Journal.

### 146. Onglet Historique de la fiche

Fiche **en édition** (`d/:key/:id/edit`) : onglets `Fiche | [Liés — …] | [Workflows] | Historique`, l'onglet
Historique toujours **en dernier**, sans badge ; la barre d'onglets est désormais présente sur toute fiche
existante (D-B2), même sans relation N-N ni workflow. Fiche **en création** : aucun onglet. Aucune requête
`/history` tant que l'onglet n'est pas activé ; à l'activation : **1 GET** `page=1&pageSize=20`, squelette
puis tableau.

- Portée automatisée : Karma fiche (`studio-record-form.component.spec.ts` : onglets `['form','history']`,
  `['form','linked:…','history']`, `['form','workflows','history']` ; aucune requête avant activation puis
  1 GET ; création ⇒ ni onglet ni requête) ; Playwright mocké `e2e/studio-record-history.spec.ts` (ordre
  des onglets, `ctx.find('/r1/history')` = 0 puis 1).

### 147. Lignes : action, utilisateur, changements

Une ligne par entrée telle que servie (plus récent d'abord) : date `dd/MM/yyyy HH:mm`, tag **Création**
(`success`) / **Modification** (`info`) / **Suppression** (`danger`), utilisateur ou « Utilisateur inconnu »
(grisé), changements `Champ : ancien → nouveau` — création `Champ : nouveau`, retrait `… → (vide)`,
suppression « — ». Libellé de champ résolu sur le **schéma complet** (champs inactifs compris, D-B8), repli
sur la clé brute (`_raw`, champ supprimé) ; valeurs `Boolean` ⇒ Oui / Non, `Select` ⇒ libellé d'option ;
au-delà de 5 changements, **« Afficher les n autres »** / **« Réduire »** (`aria-expanded` + `aria-controls`).
Limites connues (v1) : les valeurs `Date`, `DateTime`, `MultiSelect`, `Money`… sont affichées brutes
(`2026-09-19T10:30:00`, `["a","b"]`) ; une clé explicitement nulle dans un document créé est rendue
`Champ : (vide)` (kind `added`, sans flèche) — volontaire, testé côté util.

- Portée automatisée : Karma util (9 : libellés, sévérités, formats, repli, dédoublonnage, nul → nul) ; Karma composant
  (lignes, tags, utilisateur inconnu, changements changed / added / removed, « — », libellés + repli,
  repli > 5 puis dépliage) ; Playwright (`srh-action-h1` = « Modification », `srh-change-h1-statut` contient
  « À planifier → Terminé », `srh-user-h2` = « Utilisateur inconnu »).

### 148. Pagination « Charger plus » et états vide / erreur

Compteur « {affichés} sur {total} » (masqué à 0). **« Charger plus »** rendu tant que `hasNextPage` ; ajoute
la page suivante **dédoublonnée par `id`** (D-B5) puis disparaît ; en cas d'échec, le tableau reste affiché et
un toast `warn` est émis. Historique vide ⇒ « Aucun historique pour cet enregistrement ». Erreur au chargement
⇒ bannière **en ligne** (message serveur) + **« Réessayer »** qui relance la page 1 — aucun toast ni modale
global (`skipErrorUi` côté service).

- Portée automatisée : Karma service (URL, `page/pageSize`, `SKIP_ERROR_TOAST`) ; Karma composant (vide ;
  500 ⇒ `srh-error` + `srh-retry` relance ; « Charger plus » présent si `hasNextPage`, ajoute la page 2,
  disparaît ; échec de page suivante ⇒ toast `warn`, tableau conservé) ; Playwright (page 2 ⇒ 5 lignes,
  bouton disparu, 2 GET ; `history.items: []` ⇒ `srh-empty` ; `historyStatus: 500` ⇒ `srh-error`,
  « Réessayer » ⇒ 2 GET, aucun `.p-toast-message`).

### 149. Garde-fous

Aucune action d'écriture dans l'onglet (aucun bouton hors « Réessayer », « Charger plus » et le repli des
changements ; aucun champ de saisie) ; aucun `innerHTML` ; aucune donnée personnelle hors le **nom** de
l'utilisateur (jamais d'identifiant, d'e-mail ni d'adresse IP — le backend n'expose que `userName`). La route
`/edit` exige `custom_records:write` (D-B1) : un profil `custom_records:read` seul ne voit pas l'onglet (constat
consigné — « mode lecteur de la fiche » hors périmètre 4.7). Le backend re-vérifie `custom_records:read` sur la
route `/history` (403 sinon) et répond 404 si la fiche n'existe pas.

Portée de l'audit (rappel, `StudioRecordAudit`) : seules les mutations via l'API records (POST / PUT / PATCH /
DELETE) sont journalisées — le moteur de workflows et l'outil IA `update_field` écrivent hors de ces handlers
(traçables via StepRuns / plan IA) ; pas de rétroactivité. Le guide utilisateur l'énonce dans les mêmes termes.
En mode création, `tabs()` ne contient que `form` (aucune barre d'onglets, aucune requête `/history`).

- Portée automatisée : Karma composant (aucun bouton d'écriture, aucun champ, aucun e-mail dans le DOM) ;
  Playwright (aucun `input/textarea/select` dans `srh-panel`) ; contrats backend `StudioRecordsController`
  (`CustomRecordsRead`) inchangés depuis #171.

## Studio IA 4.7 « v1.1 » — journal d'audit des fiches (PR #170, #171)

> Prérequis : une table Studio `interventions` alimentée ; un compte `custom_records:write` (mutations) et un
> compte `custom_records:read` seul (lecture de l'historique par l'API — la fiche `/edit` reste réservée à
> `custom_records:write`, D-B1). Aucun drapeau requis. Décisions D-47-62 (audit) et D-47-63 (aucune ligne si
> identique, index) au Journal ; consommateur frontend : QA 146–149.

### 150. Audit des mutations

`POST api/studio/records/{entityKey}` ⇒ ligne d'audit `Studio.Record.Created` (`EntityType = CustomRecord`,
`EntityId` = id de la fiche, valeurs = document canonique **aplati** au premier niveau ; JSON illisible ⇒ repli
`_raw`). `PUT` / `PATCH` ⇒ `Studio.Record.Updated` avec **seulement les clés modifiées** (ajoutées, retirées,
changées — `oldValues` / `newValues`) ; `PUT` sans changement effectif ⇒ **aucune ligne** (D-47-63) ; `PATCH` d'un
seul champ ⇒ une seule clé. `DELETE` ⇒ `Studio.Record.Deleted` **sans valeurs**. Service d'audit indisponible
(exception simulée) ⇒ la mutation réussit quand même (`SafeLogAsync`, best-effort, `IAuditService?` optionnel).
Portée : uniquement les 4 handlers de l'API records — le moteur de workflows et l'outil IA `update_field`
n'écrivent pas de ligne (QA 149) ; aucune rétroactivité.

- Portée automatisée : Infra `CustomRecordAuditTests` (9 : `Diff_reports_added_removed_and_changed_top_level_keys_only`,
  `Diff_returns_null_when_documents_are_identical`, `Diff_falls_back_to_raw_documents_when_json_is_unreadable`,
  `Create_logs_Created_with_the_full_canonical_document`, `Update_logs_Updated_with_only_the_changed_keys`,
  `Update_without_effective_change_writes_no_audit_line`, `Patch_logs_Updated_with_only_the_patched_key`,
  `Delete_logs_Deleted_without_values`, `Audit_failure_is_swallowed_and_the_mutation_succeeds`).

### 151. Route `GET records/{entityKey}/{id}/history`

`GET api/studio/records/{entityKey}/{id}/history?page=1&pageSize=20` ⇒ `200` `PagedResult<RecordHistoryEntryDto>`
(`items[] { id, action, createdAt, userName, changes[] { key, oldValue, newValue } }`, `totalCount`) ; tri
`CreatedAt` décroissant puis `Id` ; `pageSize` clampé 1..100 (défaut 20), `page` ≥ 1 ; `userName` résolu par
`IStudioUserNameResolver` — **jamais** d'identifiant, d'e-mail, d'adresse IP, d'agent ni de hash ; valeurs
tronquées à **200** caractères ; ligne d'audit au JSON illisible ⇒ entrée présente avec `changes = []`. Entité
inconnue ou inactive ⇒ `400` `Validation.entityKey` ; fiche inconnue ⇒ `404` `CustomRecord.NotFound` (non
révélateur) ; sans `custom_records:read` ⇒ `403` (policy `CustomRecordsRead` du contrôleur ; le handler re-vérifie
la permission et n'appelle rien).

- Portée automatisée : Infra `CustomRecordHistoryQueryTests` (6 : `Handle_without_read_permission_returns_unauthorized_and_calls_nothing`,
  `Handle_unknown_entity_returns_a_validation_error`, `Handle_unknown_record_returns_not_found`,
  `Handle_maps_rows_with_resolved_names_and_key_diffs`, `Handle_truncates_change_values_to_200_characters`,
  `Handle_with_unreadable_json_lists_the_entry_with_empty_changes`) ; `AuditLogQueryServiceTests.GetEntityHistoryAsync_*`
  (filtre type + id et tri, pagination, clamp 1..100 défaut 20 en `[Theory]`, projection des colonnes internes) ;
  API `History_forwards_paging_and_maps_success_without_any_flag`, `History_maps_notfound_to_404_and_validation_to_400`.

### 152. Sans drapeau + index

`EnableStudioWorkflows=false` (et tout autre drapeau Studio coupé) ⇒ la route `/history` répond toujours `200`
(4.7h2 / D-47-63 : route sans drapeau — l'historique ne dépend d'aucune fonctionnalité optionnelle) ; les 8 routes de `StudioRecordsController` et
leurs policies sont inchangées depuis la PR #171. En base tenant : index non unique `IX_AuditLogs_EntityHistory`
sur `AuditLogs (EntityType, EntityId, CreatedAt)` présent (migration `20260918100000_AddAuditLogsEntityHistoryIndex_Tenant`,
`Up` `IF NOT EXISTS` / `Down` `IF EXISTS`, jumeau `docs/runbooks/sql/AddAuditLogsEntityHistoryIndex_Tenant.idempotent.sql`) ;
sans l'index, `/history` reste fonctionnel mais lent sur un gros journal (aucune erreur SQL).

- Portée automatisée : API `Routes_and_policies_are_unchanged` ; test de migration (`Up`/`Down` idempotents, ligne
  `__EFMigrationsHistory` du jumeau) : **à ajouter en ★2** (U7) — aucun test aujourd'hui.

## Studio IA 4.7 « v1.1 » — passes ★ (revue sécurité, tests, simplify)

### 153. Passes ★ 4.7

Passe de sécurité **S-base** (S1–S17, plan C §4.2) sur le périmètre v1.1 puis passes de tests et de simplification —
**aucun changement de contrat** (routes, `data-testid`, libellés hors D-47-76, codes d'erreur, migrations).

**★1 — corrections de revue (D-47-74 → D-47-76, D-47-81).**

- **D-47-74 (S3 / U6)** : avec un profil disposant de `studio:design_entities` **sans** `custom_records:read`, ouvrir un
  workflow ⇒ **Tester sur un enregistrement** ⇒ choisir une fiche ⇒ **Lancer le test** : le dialogue affiche le message
  serveur « Permission de lecture des enregistrements requise. » (403), aucune trace rendue. Avec les deux permissions
  (rôles livrés) : trace inchangée (QA 128). Aucune écriture dans les deux cas.
- **D-47-75 (S9 / R52)** : `GET api/studio/records/{entityKey}/{id}/history?page=2147483647` ⇒ `200`, page vide,
  `page` renvoyé = `21474836` (`int.MaxValue / 100`), `totalCount` réel — plus de `500`. `pageSize=999` ⇒ `200`, `pageSize`
  renvoyé `100` (QA 151 inchangée).
- **D-47-76 (S17)** : atelier IA, plan contenant un workflow au déclencheur planifié ⇒ onglet **Workflows** de l'aperçu :
  « Déclencheur : Planifié » (plus de « (bientôt) »).
- **D-47-81** : constats consignés sans code (Journal) — purge des `AuditLogs` absente (R41 / R51), job récurrent orphelin
  (R54, runbook), cron « chaque minute » accepté (U5), mécanique `soon` conservée (P-d), 22 `skipErrorUi` relus (S13),
  journaux du job planifié sans valeur métier (S15).

- Portée automatisée : Infra `StudioWorkflowTestFeaturesTests.Without_records_read_the_test_is_unauthorized` (+ les 10
  faits existants, harnais accordant `RecordsRead`), `AuditLogQueryServiceTests.GetEntityHistoryAsync_bounds_page_so_that_skip_never_overflows` ;
  Karma `studio-ai-workflows-tab.component.spec.ts` « affiche « Planifié » (sans « bientôt ») … D-47-76 ».

**★2 — tests (D-47-77, D-47-78).** Aucun code de production ; un seul fichier hors tests, le jumeau SQL (`docs/runbooks/sql/`).

- **S6 cron** : `StudioWorkflowCronSpecTests` — 5 champs exigés, bornes (`60`, `24`, `0`/`32`, `0`/`13`, `8` refusés), pas
  (`*/0`, `*/-5`, `*/` refusés), plages inversées, listes vides, noms `SUN-SAT` / `JAN-DEC` (pas `LUN`, `JANV`), `?` / `L`
  refusés, normalisation des espaces ; les 24 sorties des helpers `Hangfire.Cron.*` sont acceptées ; recoupement par
  réflexion avec l'analyseur Cronos embarqué dans Hangfire.Core 1.8.14 (tout ce que la spec accepte, Cronos l'accepte ;
  les bornes hors plage sont refusées des deux côtés). `* * * * *` reste accepté (U5).
- **S14 migration (U7)** : `AddAuditLogsEntityHistoryIndexMigrationTests` — 6 faits dont un sur SQL Server réel
  (`MigrateAsync` ×2 puis rejeu du jumeau : 1 index `IX_AuditLogs_EntityHistory` sur `(EntityType, EntityId, CreatedAt)`,
  1 ligne `__EFMigrationsHistory`). Jumeau SQL complété de la ligne d'historique (R37) ; migration intacte.
- **S5 job planifié** : `Fire_is_decorated_with_disable_concurrent_execution_540s_and_no_retry` (attributs relus par
  `CustomAttributeData`, signature `(Guid, Guid, CancellationToken)`).
- **S2 simulation** : `TestWorkflowQueryHandler_depends_on_no_writing_service` — constructeur limité à 6 dépendances de
  lecture (`IStudioWorkflowRepository`, `ICustomEntityRepository`, `ICustomFieldRepository`, `ICustomRecordRepository`,
  `ICurrentUser`, `TimeProvider`) ; aucun type `Engine` / `Notification` / `Audit` / `Mediator` / `UnitOfWork`…
- **S7 filtre sur champ supprimé** : `RecordQuerySqlTests.Eq_on_a_field_that_no_longer_exists_falls_back_to_a_parameterized_text_comparison`
  — un filtre planifié dont le champ n'existe plus est traduit en `JSON_VALUE(...) = @p0` (texte, paramétré), sans
  exception : le tick continue (l'isolement d'une fiche en échec reste couvert par
  `Tick_isolates_a_failing_record_and_processes_the_rest`).
- **S10 historique des approbations** : borne haute déjà couverte (`ListMyApprovalHistory_clamps_max_to_200`) ; ajout de la
  borne basse `ListMyApprovalHistory_clamps_max_to_1_when_not_positive` (0 et −25 ⇒ dépôt appelé avec `1`).
- **S1 surface `StudioRecordsController`** : `Action_surface_is_frozen_with_an_explicit_policy_per_action_and_history_reads_no_flag`
  — exactement 8 actions, verbe / gabarit / policy figés par action, `[Authorize]` de classe sans policy, aucun
  `[AllowAnonymous]` ; drapeaux tous à `false` ⇒ `History` répond `200`, `Patch` répond `404` sans MediatR.
- **S12 Karma (+3)** : panneau d'instances — badge absent quand `openCount = 0` même avec des instances en cours sur la
  page (D-47-F02) ; « Charger plus » porte `p-button-loading` / `p-disabled` pendant la page 2 et un second clic n'émet
  aucune requête ; concepteur — trace « Tester » hostile (`<img onerror>`, `<b>`, `<script>` dans `detail`, `rendered`,
  `warnings`) rendue en texte : aucun élément `img` / `b` / `script` dans `wf-test-trace`.
- **Playwright (+3, `e2e/studio-workflows.spec.ts`, API mockée)** : (a) carte **Planifié** cliquable (plus de
  `aria-disabled`), préréglage « Chaque jour à 06:00 UTC » ⇒ `wf-cron` = `0 6 * * *`, saisie libre ⇒ préréglage
  « Personnalisé », **Enregistrer** ⇒ `PUT wf-1` avec `trigger: 'scheduled'` et `triggerConfig.cron` ; (b) **Tester** ⇒
  boîte de dialogue « Tester le workflow », fiches de `GET records/interventions?page=1&pageSize=10`, **Lancer le test**
  désactivé sans fiche, trace 2 lignes (`would_run` « Priorité haute », `would_suspend` « Validation »), résumé « 2 »,
  aucun avertissement, un seul `POST …/test` et **aucune** autre écriture ; (c) panneau d'instances 22 instances en
  2 pages ⇒ 20 lignes, « Charger plus — encore 2 », clic ⇒ 22 lignes, bouton retiré, une seule requête `page=2`, aucune
  `page=3`, `pageSize=20` partout.
- Écart de test consigné : l'hôte `<p-dialog data-testid="wf-test-dialog">` n'a pas de boîte visible (PrimeNG 19) — le
  dialogue est ciblé par `getByRole('dialog', { name: 'Tester le workflow' })`, le `data-testid` vérifié par `toHaveCount(1)`.
- Portée automatisée ★2 : Infra +51 cas (`StudioWorkflowCronSpecTests` 40, `AddAuditLogsEntityHistoryIndexMigrationTests` 6,
  job 1, simulation 1, `RecordQuerySql` 1, approbations 2), API +1 (`StudioRecordsControllerContractTests` : 21 cas),
  Karma +3, Playwright +3 (suite Studio attendue 47 réussis / 11 ignorés — captures docs — / 58).

**★3 — simplify (D-47-79, D-47-80).** Aucun changement de contrat (routes, `data-testid`, libellés, migrations) ; passe de
lecture croisée (R56) avant commit : « aucun blocage », deux agents.

- **S16 DI du job planifié (D-47-79)** : `StudioWorkflowScheduledJob` n'était pas enregistré dans `DependencyInjection.cs`
  (l'activateur Hangfire le construisait implicitement, contrairement à `StudioWorkflowResumeJob`) ⇒ `AddScoped` explicite,
  et fait `StudioWorkflowDependencyInjectionTests.Scheduled_and_resume_jobs_are_registered_scoped_and_the_scheduled_job_resolves`
  (descripteur unique, `Scoped`, résolution depuis un scope du conteneur de production `AddApplication` + `AddInfrastructure`).
- **Constantes moteur (D-47-80)** : `StudioWorkflowStepsSpec.DefaultApprovalDueInHours` (72) et `DefaultWaitMaxHours`
  (`= MaxHours`, 720) remplacent quatre constantes privées (handlers `approval` / `wait` et leurs miroirs dans la simulation) ;
  la dernière valeur miroir (`MaxSimulatedSteps` ↔ `StudioWorkflowEngine.MaxStepsPerSegment`) est verrouillée par
  `Simulated_segment_bound_matches_the_real_engine_segment_bound`.
- **Helper JSON** : `StudioWorkflowJson.TryParseObject` (Application/Spec) remplace trois blocs identiques (cron, filtres du
  déclencheur, colonnes JSON du mapping) ; testé directement (`StudioWorkflowJsonTests`, 12 cas : absent, blanc, illisible,
  tronqué, tableau, `null`, scalaire, chaîne ⇒ `false` ; objets ⇒ `true`).
- **Dialogue « Tester » extrait** : `StudioWorkflowTestDialogComponent` (`app-studio-workflow-test-dialog`, entrées
  `workflowId` / `entityKey` / `fields`, ouvert par `#testDialog.open()` depuis le bouton `wf-test`) ; gabarit, styles
  (`studio-workflow-test-dialog.scss`) et les 4 cas Karma déplacés à l'identique ; le concepteur garde le test du bouton
  désactivé et gagne un test d'intégration (entrées propagées, `visible` bascule au clic, `GET records … pageSize=10`).
- Conservés volontairement (consignés D-47-80) : double clamp `max` 1..200 du dépôt (`ListDecidedApprovalsByUserAsync`,
  contrat documenté de `IStudioWorkflowRepository`, défense en profondeur) ; `cronPresets` mutable (`p-select [options]`
  exige `any[]` en PrimeNG 19.1) ; préfixe `test*` des signaux du dialogue (déplacement vérifiable à l'identique).
- Vérification manuelle (Chromium, administrateur du tenant de démonstration, `dotnet run` + `ng serve`) : dialogue « Tester »
  identique — bouton grisé tant que le brouillon est sale, recherche anti-rebond, 10 fiches, trace et verdicts, erreur 404
  inline ; approbation sans `dueInHours` ⇒ échéance +72 h, attente sans `maxHours` ⇒ plafond 720 h ; tick planifié
  inchangé (filtres lus, `value2` replié).
- Portée automatisée ★3 : Infra +14 (`StudioWorkflowJsonTests` 12, DI 1, borne simulation 1), Karma +1 net
  (`studio-workflow-test-dialog.component.spec.ts` 4 cas déplacés + 1 intégration concepteur ; dossier `workflows` 105),
  Playwright inchangé (`studio-workflows.spec.ts` 9 réussis / 3 ignorés ; suite Studio 47 / 11 / 58).
- V-full du lot ★ (HEAD `107d44d2`, Release, collections xUnit sérialisées) : Infra 8552 / 8552 (d3 : 8485, soit +67 = ★1 2 +
  ★2 51 + ★3 14), API 450 / 450 (+1), 0 ignoré ; Karma 3955 (d3 : 3950) ; Playwright Studio 47 / 11 / 58 ; `build:prod`
  initial 1,38 Mo inchangé ; `npm audit` critique 0 ; parité catalogue OK ; aucune migration dans le diff `d0c6111d..HEAD`.
