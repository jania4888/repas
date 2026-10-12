# Intégrité du lettrage (`LetteringGroups` / `LetteringGroupMembers`)

## Contexte

Deux index UNIQUE protègent le lettrage (plan de refonte, Annexe A §4.1) :

- `IX_LetteringGroups_Code` sur `LetteringGroups.Code` ;
- `IX_LetteringGroupMembers_JournalEntryLineId` sur `LetteringGroupMembers.JournalEntryLineId`
  (une ligne d'écriture ne peut appartenir qu'à un seul groupe).

La migration `20261012100000_AddLetteringIntegrityIndexes_Tenant` est **conditionnelle** :
pour chaque index unique, elle vérifie d'abord l'absence de doublon avant de créer
l'index ; en présence d'un doublon, elle conserve l'index non unique existant et
`PRINT`e un message, au lieu d'échouer. Une migration qui échoue bloque le tenant
au boot via `TenantMigrationGuard` (HTTP 503) — un dossier client ne doit **jamais**
être rendu inaccessible par une donnée historique corrompue.

Cette garde protège le déploiement, mais ne répare rien : un tenant qui a des
doublons au moment du déploiement reste **sans protection par index unique**
jusqu'à réparation manuelle. Ce runbook décrit comment détecter et réparer ces
tenants.

## Étape 1 — Balayage de tous les tenants

Deux chemins équivalents :

**Endpoint plateforme** (compte PlatformAdmin) :

```http
GET /api/platform/migrations/tenants/lettering-integrity
Authorization: Bearer <token>
```

Le rapport (`LetteringIntegrityReportDto`) liste, par tenant (`Clean` /
`AnomaliesFound` / `Unreachable`) :

- les codes de groupe en double (`DuplicateCodes`) ;
- les lignes membres de plusieurs groupes à la fois (`LinesInMultipleGroups`) ;
- les membres orphelins, dont la ligne d'écriture a été supprimée (`OrphanMembers`) ;
- les lignes dont `LetteringCode` ne correspond à aucun groupe (`DanglingLetteringCodeLines`) ;
- les groupes dont une ligne membre porte un autre code, ou aucun (`MismatchedLetteringCodes`) ;
- la présence des deux index uniques (`HasUniqueGroupCodeIndex`, `HasUniqueMemberLineIndex`).

Verdict consolidé `IsUniqueIndexSafe`. **Fail-closed** : un tenant injoignable,
ou avec la moindre anomalie, rend le verdict négatif — il n'est jamais compté
comme propre.

**Script DBA** (instance SQL, lecture seule) :
[`docs/runbooks/sql/ScanLetteringIntegrity_AllTenants.sql`](sql/ScanLetteringIntegrity_AllTenants.sql)

## Étape 2 — Arbitrage des anomalies

Si le balayage remonte des anomalies, **ne pas rejouer le script jumeau tant
que le tenant n'est pas réparé** : la garde `IF NOT EXISTS` du script
([`AddLetteringIntegrityIndexes_Tenant.idempotent.sql`](sql/AddLetteringIntegrityIndexes_Tenant.idempotent.sql))
continuera simplement à sauter la création de l'index concerné.

Réparation par catégorie, **toujours décidée par un expert-comptable du
dossier** (jamais automatisée : aucune règle déterministe ne sait quel groupe
garder) :

- **Codes de groupe en double** (`DuplicateCodes`) : renommer l'un des deux
  groupes (ex. `L00042` → `L99999` libre, cf. `NextCodeAsync`) après avoir
  vérifié que ses lignes membres pointent bien vers lui (`LetteringGroupMembers`
  **et** `JournalEntryLines.LetteringCode`), ou le supprimer s'il est vide/erroné
  et re-délettrer ses lignes.
- **Ligne membre de plusieurs groupes** (`LinesInMultipleGroups`) : décider quel
  groupe est le bon lettrage (généralement le plus récent avec une pièce de
  règlement correspondante) ; retirer la ligne de l'autre `LetteringGroupMembers`
  et, si ce dernier groupe devient incomplet, le délettrer entièrement via
  l'écran (jamais par un `DELETE` manuel qui contournerait l'audit).
- **Membre orphelin** (`OrphanMembers`) : la ligne d'écriture a été supprimée
  alors que son appartenance au groupe est restée. Supprimer la ligne
  `LetteringGroupMembers` orpheline ; si le groupe devient vide, le supprimer.
- **`LetteringCode` sans groupe** (`DanglingLetteringCodeLines`) : remettre
  `LetteringCode` à `NULL` sur la ligne (elle redevient non lettrée), ou
  recréer le groupe manquant si son historique (audit) le permet.
- **Incohérence groupe/ligne** (`MismatchedLetteringCodes`) : aligner
  `JournalEntryLines.LetteringCode` sur le code du groupe dont la ligne est
  réellement membre (`LetteringGroupMembers`), après avoir vérifié qu'elle
  n'appartient pas aussi à un autre groupe (cas `LinesInMultipleGroups`).

Chaque réparation doit être tracée (ticket + requête SQL exécutée + validation
du cabinet) avant de considérer le tenant comme propre.

## Étape 3 — Revalidation

Après réparation, relancer le balayage (étape 1). Si le tenant est maintenant
`Clean` mais que `HasUniqueGroupCodeIndex` ou `HasUniqueMemberLineIndex` reste
`false` (la migration a été appliquée alors que le tenant avait encore des
doublons), rejouer le script jumeau
[`AddLetteringIntegrityIndexes_Tenant.idempotent.sql`](sql/AddLetteringIntegrityIndexes_Tenant.idempotent.sql)
sur ce tenant pour créer l'index désormais possible.

## Avant la mise en production de la PR 1

1. Lancer le balayage (étape 1) sur tous les tenants de production.
2. Réparer les tenants avec anomalies (étape 2) avant le déploiement, ou
   accepter qu'ils restent temporairement sans index unique (le contrôle
   applicatif — transaction `Serializable` + validation — reste actif dans
   tous les cas).
3. **Étape de déploiement OBLIGATOIRE sur les gros dossiers** : exécuter le
   script jumeau
   [`AddLetteringIntegrityIndexes_Tenant.idempotent.sql`](sql/AddLetteringIntegrityIndexes_Tenant.idempotent.sql)
   hors heures de pointe **avant** le déploiement, sur chaque tenant volumineux.
   La migration devient alors sans effet (`IF NOT EXISTS`) au démarrage du
   tenant — aucun risque de création d'index longue pendant le boot
   (`TenantMigrationGuard`). Le timeout de commande du migrateur est relevé à
   600 s (`TenantService` / `TenantDatabaseProvisioner`), mais une création en
   ligne sur des millions de lignes peut dépasser toute fenêtre de déploiement.
4. Les créations d'index utilisent `WITH (ONLINE = ON)` quand l'édition le
   permet (Enterprise / Azure SQL : `SERVERPROPERTY('EngineEdition')` ∈ 3, 5,
   8) et basculent sinon en création hors ligne (Standard/Express) — sur ces
   éditions, prévoir une fenêtre sans activité ou l'étape 3.

## Note permissions (D6)

La PR 1 retire la permission `accounting:unletter` aux comptables société et
l'attribue aux rôles de supervision. Les **revendications de permission sont
embarquées dans le JWT** : un utilisateur déjà connecté conserve ses anciens
droits jusqu'au prochain rafraîchissement de jeton (ou reconnexion). Prévenir
les cabinets : après le déploiement, demander une reconnexion aux comptables
pour que l'écran reflète immédiatement la séparation des tâches.
