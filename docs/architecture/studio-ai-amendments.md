# Studio IA — amendements enrichis d'une table existante (PR 3.1)

**Date :** 14 septembre 2026 (PR 3.1a — matrice D4 et index JSON ; PR 3.1b — opérations
d'amendement enrichies du DSL IA, §5).
**Périmètre :** politique de conversion de type de champ (« matrice D4 »), mécanique de
suppression/recréation de l'index JSON qui l'accompagne, et six opérations d'amendement
supplémentaires de l'outil IA `studio_plan_changes`. Aucune clé de fonctionnalité nouvelle : les
endpoints REST prolongent le CRUD existant sous `studio:design_entities` (pas de flag).
**Documents liés :** [Doublons et réutilisation](studio-ai-duplicates-and-reuse.md) ·
[QA de l'assistant Studio](../developer/studio-ai-assistant-qa.md)

---

## 1. Le problème résolu

Une table Studio existante contient déjà des enregistrements quand on veut changer le type d'un de
ses champs (`Text` → `Number`, `Select` → `MultiSelect`…). Certaines conversions sont sûres (aucune
perte possible), d'autres exigent que la table soit vide (le risque de perte ou d'erreur de
conversion est réel), d'autres enfin ne doivent jamais être proposées (champs calculés,
pièces jointes, signatures…). `FieldTypeConversionPolicy` est le **point de vérité unique** de cette
décision, partagé par :

- `GET api/studio/entities/{entityId}/fields/{fieldId}/type-check?to=<nom du type>` — vérifie la
  conversion **sans rien modifier** (utilisé par le bouton « Changer de type » avant confirmation).
- `PATCH api/studio/entities/{entityId}/fields/{fieldId}/type` — applique effectivement le
  changement.
- (PR 3.1b) l'opération `change_field_type` de l'outil IA `studio_plan_changes`.

## 2. Matrice D4 (`FieldTypeConversionPolicy.Classify`)

```csharp
public enum FieldTypeConversion { Lossless = 0, RequiresEmptyTable = 1, Forbidden = 2 }
```

`Classify(from, to)` évalue les règles **dans cet ordre strict**, la première qui matche l'emporte ;
tout ce qui n'est couvert par aucune règle est refusé par défaut (règle 7) :

| # | Règle | Résultat |
| --- | --- | --- |
| 1 | `from == to` | `Forbidden` (« Le champ est déjà de ce type. ») |
| 2 | `to` ∈ {Formula, Lookup, Rollup, Attachment, Signature, AutoNumber} | `Forbidden` — ces types se **créent**, ils ne remplacent jamais un champ existant |
| 3 | `from` ∈ {Attachment, Signature, Formula, Lookup, Rollup} | `Forbidden` — champ immuable, il faut créer un nouveau champ |
| 4 | `from` ∈ {RelationCustom, RelationExisting} | `RequiresEmptyTable` si `to` est aussi une relation, sinon `Forbidden` |
| 5 | conversion classée « sans perte » (texte compatible, numériques entre eux, `Date→DateTime`, `Select→MultiSelect`, textes entre eux, `Rating→Number/Decimal`) | `Lossless` |
| 6 | conversion classée « table vide requise » (texte → typé, `DateTime→Date`, numérique → `Number/Rating`, `MultiSelect→Select`, numérique ↔ `Boolean`) | `RequiresEmptyTable` |
| 7 | tout le reste | `Forbidden` (deny-by-default) |

`Describe(from, to, recordCount = 0)` produit le message FR affiché à l'utilisateur (repris tel quel
dans `Error.Validation("fieldType", …)` côté commande). Cas notable **R11** : toute conversion sans
perte vers `Text`/`MultilineText` (p. ex. `Date→Text`, `Select→Text`) précise en plus que le champ
« perd son affichage » (calendrier, liste…) même si les valeurs restent intactes.

`PolicyCode(FieldTypeConversion)` renvoie la forme snake_case exposée par l'API
(`"lossless"` / `"requires_empty_table"` / `"forbidden"`), et `UniqueCapable` liste les types pour
lesquels une contrainte d'unicité a un sens (aucune liste équivalente n'existait avant ailleurs dans
le code) : si un champ `IsUnique` change vers un type absent de cet ensemble, la commande remet
`IsUnique = false`.

## 3. Application du changement (`ChangeCustomFieldTypeCommand`)

1. `Classify(ancien type, nouveau type)`. `Forbidden` ⇒ `Validation.fieldType`, aucun accès SQL.
2. Si `RequiresEmptyTable`, compte les enregistrements de la table
   (`ICustomRecordRepository.CountAsync`) **seulement dans ce cas** (jamais pour `Lossless`, jamais
   pour vérifier `Forbidden` — évite un aller-retour SQL inutile). Table non vide ⇒
   `Validation.fieldType` avec le nombre exact dans le message, et **aucune** écriture.
3. Les options/la relation sont validées via `CreateCustomFieldCommandHandler.BuildOptionsJson`
   (déjà réutilisé par `UpdateCustomFieldCommandHandler` pour ne pas dupliquer la logique de
   sérialisation par type).
4. `CustomFieldDefinition.ChangeType(...)` remplace `FieldType`/`OptionsJson`/`ValidationRulesJson`
   et **réinitialise `DefaultValueJson`** (une valeur par défaut sérialisée pour l'ancien type n'a pas
   de sens dans le nouveau).
5. Si le champ était unique et que le nouveau type n'est pas `UniqueCapable`, `IsUnique` retombe à
   `false` via `Update(...)`.
6. L'index JSON est toujours redéposé (§4) puis recréé si le champ reste unique.
7. Audit best-effort `Studio.Field.TypeChanged` (`StudioAudit.SafeLogAsync`, ne fait jamais échouer
   la mutation).

`CheckCustomFieldTypeChangeQuery` exécute les étapes 1–2 en lecture seule (jamais d'appel à
`UpdateAsync`) et renvoie `FieldTypeChangeCheckDto { From, To, Policy, RecordCount, Message,
Allowed }` — `Allowed` est vrai pour `Lossless`, et pour `RequiresEmptyTable` seulement si
`RecordCount == 0`.

## 4. Index JSON : colonne partagée, jamais supprimée lors d'un changement de type

La colonne calculée `jx_<clé>` est un `CAST(JSON_VALUE([DataJson], '$.<clé>') AS nvarchar(…))` :
elle est **indépendante du type de champ** et **partagée par toutes les tables du tenant** qui
utilisent la même clé (l'index filtré `IX_CustomRecords_jx_<clé>` porte `TenantId`,
`EntityDefinitionId`, `jx_<clé>`). Un changement de type ne la supprime donc **jamais** : la
supprimer casserait les requêtes concurrentes qui s'appuient encore sur le cache positif
`IndexedColumnExistsAsync` (local à chaque instance, TTL 10 min) et retirerait l'accélération aux
autres tables partageant la clé.

Comportement de `ChangeCustomFieldTypeCommand` :

1. Si le champ reste `IsUnique` après le changement, `EnsureUniqueFieldIndexAsync` est rappelé
   (idempotent) ; sinon rien n'est touché côté SQL.
2. `IJsonIndexManager.DropFieldIndexAsync` existe (idempotent, best-effort, testé contre SQL réel)
   pour les opérations de maintenance explicites — il n'est **pas** appelé par le changement de type.

### Fenêtre de course sur « table vide »

Aucune transaction n'englobe le comptage et la mise à jour de la définition. Pour une conversion
`RequiresEmptyTable`, le handler **recompte après la persistance** : si des enregistrements sont
apparus entre-temps, le champ est ramené à son ancien type (options, règles, valeur par défaut et
unicité restaurés) et l'appel renvoie `Validation.fieldType`. Le risque résiduel se limite à une
insertion survenant entre le second comptage et la lecture qui suit ; la lecture des enregistrements
reste tolérante (`TRY_CONVERT`) et n'échoue pas sur une valeur incompatible.

---

## 5. Opérations d'amendement enrichies du DSL IA (PR 3.1b)

L'outil `studio_plan_changes` accepte désormais douze opérations — les six historiques
(`add_field`, `update_field`, `remove_field`, `update_entity`, `set_form`, `set_report`) et six
nouvelles :

| Op | Rôle | Gardes |
| --- | --- | --- |
| `reorder_fields` | Réordonner les champs (`fields: [clé…]`) ; les champs non cités conservent leur ordre relatif à la suite | références inconnues écartées avec avertissement |
| `change_field_type` | Changer le type d'un champ (`key`, `type`, `options?`, `config?`) | classé par la **matrice D4** (§2) : `Forbidden` ⇒ étape **en erreur** dans l'aperçu ; `RequiresEmptyTable` ⇒ **avertissement** (le compte d'enregistrements n'est vérifié qu'à l'application, jamais fabriqué dans l'aperçu) |
| `add_relation` | `kind: many_to_one` (champ relation) ou `many_to_many` (table de jonction) vers `target` | `many_to_many` exige `EnableStudioManyToMany` (sinon op écartée + avertissement) ; cible = table source, ou source de type jonction ⇒ étape **en erreur** (miroir de `CreateManyToManyRelationCommand`) |
| `assign_system` | Rattacher la table à un système (`system: clé`) ou la détacher (`system: "none"`) | clé normalisée en slug ; système résolu à l'exécution |
| `set_view` | Ajouter une vue enregistrée (`mode: list|kanban|calendar`, `columns`, `filters`, `sort`, `groupBy`/`start`…) | exige `EnableStudioRecordViews` (sinon op écartée + avertissement) ; résolue contre le schéma réel par `StudioAiRecordViewSpec.ResolveAgainstSchema` — kanban sans champ Select ou calendrier sans champ Date **dégradés en Liste avec avertissement** |
| `set_automation` | Déclarer une automatisation | acceptée mais **toujours ignorée** (aucun backend d'automatisation IA en v1) : étape d'aperçu portant l'avertissement « étape ignorée » |

Points de conception :

- **Parsing tolérant, jamais silencieux** (`StudioAiAmendmentSpec`) : alias FR/EN absorbés
  (`reordonner_champs`, `changer_type`, `ajouter_relation`, `rattacher_systeme`, `definir_vue`…),
  références de table/système normalisées en **slugs**, doublons de `reorder_fields` éliminés dès le
  parsing. Toute opération mal formée est écartée avec un avertissement, pas d'échec global ;
  `MaxOperations` reste 20. `change_field_type` accepte volontairement les cibles interdites
  (`formula`…) pour que la matrice D4 les classe `Forbidden` **dans l'aperçu** au lieu de les faire
  disparaître au parsing ; en revanche une valeur numérique d'énumération (`"3"`) n'est jamais
  acceptée (`TryMapType`, contrat « nom uniquement »).
- **Canonicalisation** (`StudioAiSpecCanonical.CanonicalAmendment`) : chaque op est réémise en forme
  canonique (`op`, clés fixes, types en noms d'énumération minuscules rejouables), et l'aller-retour
  parse → canonique → parse est stable à l'octet près — y compris le détachement de système, émis
  `system: "none"` (une clé absente serait relue comme un oubli du modèle et écartée).
- **Aperçu = promesse exacte** (`StudioAiAmendmentPlanner.BuildPreview`) : l'ordre affiché d'un
  `reorder_fields` est l'ordre effectif complet (cités puis non cités), et la description d'un
  `set_view` reflète la résolution réelle (mode dégradé inclus). Le planificateur reste pur : il
  reçoit les drapeaux `EnableStudioManyToMany` / `EnableStudioRecordViews` en paramètres.
- **Exécution** : en 3.1b, les six ops étaient reconnues de la spec et de l'aperçu mais pas encore
  appliquées — l'exécuteur les signalait explicitement (étape `skipped` + avertissement). Elles sont
  appliquées depuis 3.1c/3.1d ; voir §6.

## 6. Exécution des amendements (PR 3.1c/3.1d)

`StudioAiAmendmentExecutor` applique désormais chaque opération confirmée au moment de la validation
du plan. Chaque op laisse une étape visible dans le suivi (phase → statut `running` puis
`done` / `skipped` / `error`) — aucune op n'est passée sous silence :

| Op | Phase | Commande appliquée | `skipped` quand… | `error` quand… |
| --- | --- | --- | --- | --- |
| `reorder_fields` | `reordering_fields` | `ReorderCustomFieldsCommand` (cités résolus par clé/libellé, puis non cités dans l'ordre `SortOrder`) | — | aucun champ reconnu ⇒ avertissement, pas d'appel ; échec du handler |
| `change_field_type` | `changing_field_type` | `ChangeCustomFieldTypeCommand` (options/relation/config mappées, règles à null) | — | `Forbidden` / `RequiresEmptyTable` du handler (matrice D4) — non bloquant pour les ops suivantes |
| `assign_system` | `assigning_system` | `GetCustomSystemByKeyQuery` puis `AssignEntityToSystemCommand` ; `system: "none"` ⇒ détachement sans requête | — | clé de système inconnue ⇒ avertissement + étape en erreur, rien n'est rattaché |
| `add_relation` | `adding_relation` | N-1 ⇒ `CreateCustomFieldCommand` (`RelationCustom` + `RelationRefDto("custom", cible)`) ; N-N ⇒ `CreateManyToManyRelationCommand` | drapeau `EnableStudioManyToMany` coupé (N-N, aucun appel) ; dépôt indisponible / cible introuvable / cible jonction | échec du handler |
| `set_view` | `creating_record_view` | `ResolveAgainstSchema` (avertissements propagés) + `SlugKey` dédupliqué + `CreateCustomRecordViewCommand` — séquence identique à `ExecuteRecordViewAsync` | drapeau `EnableStudioRecordViews` coupé (aucun appel) | échec du handler |
| `set_automation` | `skipped_automation` | aucune (pas de backend d'automatisation IA en v1) | **toujours** | — |

Garde-fous transverses :

- **Drapeaux lus à l'exécution, pas seulement à l'aperçu** : le planificateur écarte déjà les ops
  N-N / vues quand les drapeaux sont coupés, mais l'exécuteur revérifie `EnableStudioManyToMany` /
  `EnableStudioRecordViews` juste avant l'appel (un plan confirmé ne dépend plus de l'état du cache
  d'aperçu). Le drapeau N-N est testé **avant** la lecture du dépôt d'entités, comme au planning.
- **Câblage** : `StudioAiPlanExecutor` construit l'exécuteur avec `OllamaSettings` et
  `ICustomEntityRepository` (paramètres optionnels en queue — les constructions à deux arguments
  existantes continuent de compiler ; la DI les résout automatiquement).
- **Défaut bruyant** : toute op inconnue du sélecteur lève `InvalidOperationException` au lieu
  d'être ignorée silencieusement (couvert par `StudioSilentFailureGuardsTests`) ; le handler de
  confirmation rattrape toute exception échappant à l'exécuteur pour marquer le plan `Failed` au
  lieu de le figer en `Executing` (inannulable, inconfirmable) — l'erreur est ensuite relancée.
- **Fenêtre aperçu → confirmation** : les drapeaux sont relus à l'exécution ; si un drapeau est
  *réactivé* entre l'aperçu (qui avait écarté l'op avec avertissement) et la confirmation, l'op
  s'applique. Fenêtre étroite (changement de configuration entre deux clics), assumée : la source de
  vérité est l'état au moment de l'application.
- **Permission de conception des vues** : `set_view` revérifie `studio:design_forms` à l'exécution —
  un plan Amendment n'exige que `studio:design_entities` (même règle que `set_form` et `set_report`,
  qui revérifient leurs droits propres) ; la vue est sinon ignorée avec avertissement, sans étape
  annoncée.
- **Un échec n'interrompt pas les ops suivantes** : une étape `error` est consignée et l'exécution
  se poursuit ; le plan se termine par `completed` (« Modifications appliquées »), ou par `failed`
  (« Aucune modification appliquée ») si rien n'a abouti.
- **Prompt** : la règle 8 du prompt StudioBuilder liste les cinq opérations actionnables et
  `SystemPromptCacheRevision` passe de « v6 » à « v7 » (convention de projet à tout changement de
  prompt, même si le prompt StudioBuilder est reconstruit à chaque appel).
