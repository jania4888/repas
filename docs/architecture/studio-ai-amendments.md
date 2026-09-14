# Studio IA — amendements enrichis d'une table existante (PR 3.1)

**Date :** 14 septembre 2026 (PR 3.1a — matrice D4 et index JSON ; le reste des amendements —
`reorder_fields`, `add_relation`, `assign_system`, `set_view`, `set_automation`, outil IA
`change_field_type` — est livré par la PR 3.1b, non couverte par ce document pour l'instant).
**Périmètre :** politique de conversion de type de champ (« matrice D4 ») et mécanique de
suppression/recréation de l'index JSON qui l'accompagne. Aucune clé de fonctionnalité nouvelle : les
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
