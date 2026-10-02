# Runbook — Mise en service de l'import IA de relevés bancaires

Rampe d'activation de l'import de relevés vers le journal de banque. Chaque étape est réversible.
Fonctionnement : `docs/accounting/bank-statement-ai-import.md`.

## Drapeaux

| Drapeau | Emplacement | Défaut | Portée |
|---|---|---|---|
| `Accounting:BankStatementAiPostingEnabled` | `FactuTrust.API/appsettings*.json` | `false` | Endpoints `api/accounting/bank-statement-import/*` (404 si éteint), entrées de menu côté front |
| `Accounting:BankReconciliationMatchingV2Enabled` | idem | `false` | `AutoAssociateAsync` : priorité au lien source, comptes 532 ↔ 532x dans les deux sens |
| `Accounting:BrouillardEnabled` | idem | (existant) | **Requis** pour générer : la génération est refusée sans brouillard |

Le front n'a **aucun drapeau propre** : il lit `GET …/capabilities` (404 → fonctionnalité masquée).
Les valeurs effectives sont journalisées au démarrage (`Startup.Features`, « Effective feature flags:
Accounting.BankStatementAiPosting=… »), avec un avertissement si l'import est actif sans brouillard.

## Étapes

| # | Étape | Action | Réversible ? |
|---|---|---|---|
| 1 | **Balayage préalable** | Sur chaque base tenant : `SELECT COUNT(*) FROM JournalEntries WHERE SourceEntityType = N'BankStatementLine';` (doit valoir 0). Une valeur non nulle empêche la création de l'index unique (voir « Le piège »). | n/a (lecture seule) |
| 2 | **Migration de schéma** | `AddBankStatementAiImport_Tenant` par l'API au démarrage, ou son jumeau `docs/runbooks/sql/AddBankStatementAiImport_Tenant.idempotent.sql`. Vérifier : tables `BankStatementImportSessions`, `BankPostingRules`, `BankLabelClassifications` et index `IX_JournalEntries_BankStatementLineSource`. | Oui — `Down` supprime uniquement les objets ajoutés |
| 3 | **Déploiement**, drapeaux éteints | Comportement identique à l'existant. Le menu Import de la saisie manuelle n'affiche pas l'entrée relevé. | Oui — rollback binaire |
| 4 | **Recette locale** | `BankStatementAiPostingEnabled=true` sur une base de recette. Dérouler un relevé par banque (STB, BH, Zitouna, Attijari, BIAT) : contrôle de solde vert, enregistrement, propositions, génération, relance sans doublon, suppression d'un brouillon puis regénération. | Oui |
| 5 | **Production — import** | `BankStatementAiPostingEnabled=true`, sur feu vert explicite. Vérifier la ligne `Startup.Features` au démarrage. | Oui — bascule du drapeau |
| 6 | **Production — rapprochement V2** | `BankReconciliationMatchingV2Enabled=true` après quelques relevés générés et validés. Contrôler qu'un relevé déjà associé l'est toujours (sur-ensemble des associations). | Oui — bascule du drapeau |

## Données personnelles et IA externe

Si la plateforme est configurée sur un fournisseur externe (OpenRouter, Modal…), les **pages scannées** d'un relevé
lui sont envoyées en image. L'écran d'import l'annonce avant l'analyse. Les PDF à couche texte sont lus sans IA. La
classification n'envoie que le cœur du libellé et le sens. Faire valider ce point par le responsable du traitement
avant l'étape 5 si l'IA est externe.

## Le piège de l'étape 2

L'index `IX_JournalEntries_BankStatementLineSource` est **unique et filtré** :
`WHERE [IsReversed] = 0 AND [SourceEntityType] = N'BankStatementLine'`. Si des écritures non extournées portent
déjà ce type de source pour une même ligne, sa création échouerait. La migration ne lève pas d'erreur dans ce cas :
elle **saute la création de l'index**, et l'idempotence ne repose plus que sur le contrôle applicatif. D'où le
balayage de l'étape 1. Après correction des doublons, rejouer le jumeau SQL pour créer l'index.

Le jumeau SQL commence par `SET QUOTED_IDENTIFIER ON` : sans cette option, `sqlcmd` refuse la création d'un index
filtré (Msg 1934).

## Retour arrière

1. Éteindre `BankStatementAiPostingEnabled` (et `BankReconciliationMatchingV2Enabled`).
2. Les brouillons déjà générés restent des écritures ordinaires du brouillard : les supprimer ou les valider comme
   les autres.
3. Les relevés enregistrés restent visibles et utilisables dans l'assistant de rapprochement.
4. Le `Down` de la migration n'est nécessaire que pour retirer le schéma, ce qui n'est jamais requis pour désactiver
   la fonctionnalité.
