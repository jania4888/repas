# Runbook — Mise en service de l'import IA de relevés bancaires

Rampe d'activation de l'import de relevés vers le journal de banque. Chaque étape est réversible.
Fonctionnement : `docs/accounting/bank-statement-ai-import.md`.

## Drapeaux

| Drapeau | Emplacement | Défaut | Portée |
|---|---|---|---|
| `Accounting:BankStatementAiPostingEnabled` | `FactuTrust.API/appsettings*.json` | `false` | Endpoints `api/accounting/bank-statement-import/*` (404 si éteint), entrées de menu côté front |
| `Accounting:BankReconciliationMatchingV2Enabled` | idem | `false` | `AutoAssociateAsync` : priorité au lien source, comptes 532 ↔ 532x dans les deux sens |
| `Accounting:BrouillardEnabled` | idem | (existant) | **Requis** pour générer : la génération est refusée sans brouillard |
| `Accounting:BankStatementLayoutParserEnabled` | idem | `false` | Assistant de rapprochement : lecture par profils (BIAT mensuel, fichiers à plusieurs relevés…) quand le parseur historique ne lit rien, avant OCR/IA |
| `Accounting:BankStatementPreviewTimeoutSeconds` | idem | `240` | Budget OCR + IA de l'aperçu de l'assistant (toujours < 300 s, délai nginx) |
| `Accounting:BankStatementImport:VisionReadingEnabled` | idem | `false` | GLM-OCR page par page (repli texte qwen) |
| `Ollama:BankStatementImportVisionModel` | idem | (vide → `InvoiceImportVisionModel`) | Modèle vision relevés |
| `Accounting:BankStatementAiForAllDocumentsEnabled` | idem | `false` | Tout relevé PDF/image passe par l'import IA ; l'IA relit chaque page non lue avec certitude ; l'aperçu PDF/image de l'assistant est fermé (`bank_statement.ai_import_required`). Sans effet si `BankStatementAiPostingEnabled` est éteint |
| `Accounting:BankStatementImport:AiComplementAllowExternal` | idem | `false` | Autorise l'envoi du texte des pages lisibles à une IA externe |

Le front n'a **aucun drapeau propre** : il lit `GET …/capabilities`, qui répond **200 `{ enabled: false }`** quand la
fonctionnalité est éteinte (et non 404, que le navigateur journalisait en rouge à chaque visite de la saisie manuelle
et du rapprochement). Les autres endpoints restent en 404 drapeau éteint.
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
| 7 | **Assistant — lecture par profils** | Indépendant des étapes 4 à 6. `BankStatementLayoutParserEnabled=true` sur feu vert, après recette d'un relevé BIAT mensuel (et d'un fichier de deux mois) dans l'assistant de rapprochement. Les fichiers déjà lus par le parseur historique ne changent pas de chemin. | Oui — bascule du drapeau |
| 8 | **Tout document par l'IA** | Après l'étape 5. (a) Dans chaque dossier, requête « comptes non éligibles » ci-dessous : un compte sans lien 532 ou hors dinars ne pourra plus importer de PDF depuis le rapprochement (le paramétrer, ou passer par un export CSV/OFX). (b) Recette : relevé prouvé (aucun appel IA, retour à l'étape 2) ; relevé dont le solde ne boucle pas (lecture IA, progression « ≈ N min ») ; utilisateur sans `ai:chat` (blocage expliqué) ; CSV inchangé. (c) Mesurer la durée d'un appel sur le serveur de production (processeur seul) et ajuster `AiTextOperationsPerCall`, `MaxAiCalls`, `AiEstimatedSecondsPerCall`. (d) `BankStatementAiForAllDocumentsEnabled=true` sur feu vert. | Oui — bascule du drapeau |

Requête « comptes non éligibles » (étape 8a, lecture seule, sur chaque base tenant) :

```sql
SELECT Id, BankName, RIGHT(Rib, 4) AS RibFin, ChartOfAccountNumber, Currency
FROM BankAccounts
WHERE IsActive = 1
  AND (ChartOfAccountNumber IS NULL OR LTRIM(RTRIM(ChartOfAccountNumber)) = N'' OR Currency <> N'TND');
```

## Recette de la relecture IA (étape 8)

Recette automatisée sur les vrais relevés de la recette privée (jamais commités), avec un **vrai modèle local**
(`BankStatementAiRealModelRecetteTests`, ignorée par défaut). Pour chaque relevé, l'opération du milieu de la page
la plus dense est retirée de la lecture directe, puis la page est relue par le modèle. Les prompts, la consigne, le
schéma et les extraits sont ceux de la production. Le relevé fusionné doit retrouver l'opération à l'identique
(montant, sens, date) et boucler au millime.

```bash
FACTUTRUST_PRIVATE_BANK_FIXTURES='C:\wt\private-bank-fixtures' FACTUTRUST_RECETTE_OLLAMA_URL='http://localhost:11434' dotnet test src/Backend/tests/FactuTrust.Infrastructure.Tests --filter "FullyQualifiedName~BankStatementAiRealModelRecetteTests" --logger "console;verbosity=normal"
```

Les relevés étant réels, n'utiliser qu'une IA **locale**. La sortie ne contient que des noms de fichiers et des
durées. Résultat du 02/10/2026 avec `qwen2.5:7b-instruct`, sur un poste avec GPU :

- STB, BH, Zitouna, Attijari et deux BIAT mensuels : 6 relevés sur 6 restaurés et équilibrés ;
- 118 opérations relues, en 22 appels ;
- 24 s par appel en moyenne, 32 s au plus.

Sur le serveur de production (processeur seul), la durée par appel est **à mesurer** avant activation (étape 8c).
Elle doit rester sous `ImportLlmTimeoutSeconds` (180 s) ; sinon, réduire `AiTextOperationsPerCall`.

La recette a fait apparaître les écueils du modèle, chacun corrigé de façon déterministe :
- lecture de « 2,380 » comme 2 380 : montants normalisés en décimal à point ;
- débit et crédit inversés : sens marqué d'après la colonne imprimée, et sens d'une ligne de l'IA rectifié quand
  son montant n'est imprimé que dans l'autre colonne ;
- 2ᵉ ligne d'un libellé prise pour une opération : une opération par ligne, suite jointe par « / » ;
- montants recopiés multipliés par 1 000 : ramenés à la valeur imprimée ;
- totaux ou solde d'ouverture recopiés comme opérations : montants absents des lignes d'opérations, écartés ;
- dates recopiées « jj/mm/aaaa » : admises pour les extraits texte.

## Données personnelles et IA externe

Si la plateforme est configurée sur un fournisseur externe (OpenRouter, Modal…), les **pages scannées** d'un relevé
lui sont envoyées en image. L'écran d'import l'annonce avant l'analyse. Les PDF à couche texte sont lus sans IA. La
classification n'envoie que le cœur du libellé et le sens. Faire valider ce point par le responsable du traitement
avant l'étape 5 si l'IA est externe.

Avec « tout document par l'IA » (étape 8), le **texte des pages lisibles** non lues avec certitude est aussi relu par
l'IA, en extraits dont les RIB et IBAN sont masqués. Vers une IA externe, ce n'est fait que si
`AiComplementAllowExternal=true` : sans ce réglage, ces pages restent bloquées et seules les pages scannées partent,
comme avant. Ne l'activer qu'avec l'accord du responsable du traitement.

## Le piège de l'étape 2

L'index `IX_JournalEntries_BankStatementLineSource` est **unique et filtré** :
`WHERE [IsReversed] = 0 AND [SourceEntityType] = N'BankStatementLine'`. Si des écritures non extournées portent
déjà ce type de source pour une même ligne, sa création échouerait. La migration ne lève pas d'erreur dans ce cas :
elle **saute la création de l'index**, et l'idempotence ne repose plus que sur le contrôle applicatif. D'où le
balayage de l'étape 1. Après correction des doublons, rejouer le jumeau SQL pour créer l'index.

Le jumeau SQL commence par `SET QUOTED_IDENTIFIER ON` : sans cette option, `sqlcmd` refuse la création d'un index
filtré (Msg 1934).

## Retour arrière

1. Éteindre `BankStatementAiPostingEnabled` (et `BankReconciliationMatchingV2Enabled`). Pour revenir seulement sur
   « tout document par l'IA », éteindre `BankStatementAiForAllDocumentsEnabled` : l'assistant retrouve son aperçu
   PDF historique, les analyses déjà lancées se terminent normalement.
2. Les brouillons déjà générés restent des écritures ordinaires du brouillard : les supprimer ou les valider comme
   les autres.
3. Les relevés enregistrés restent visibles et utilisables dans l'assistant de rapprochement.
4. Le `Down` de la migration n'est nécessaire que pour retirer le schéma, ce qui n'est jamais requis pour désactiver
   la fonctionnalité.
