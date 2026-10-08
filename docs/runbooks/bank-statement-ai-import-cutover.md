# Runbook — Mise en service de l'import IA de relevés bancaires

Rampe d'activation de l'import de relevés vers le journal de banque, jusqu'à la **lecture par l'IA de toute page de
tout relevé** (étape 9). Chaque étape est réversible. Fonctionnement : `docs/accounting/bank-statement-ai-import.md`.
Installation du modèle et dimensionnement du serveur : `deploy/README.md`, section GLM-OCR.

> **La rampe ci-dessous est un historique : elle a été exécutée jusqu'à l'étape 9 et les drapeaux sont allumés en
> production.** Deux points ont changé depuis, et priment sur ce qui suit : l'échelle de lecture compte désormais
> **deux essais vision pour tout modèle multimodal** (et non une passe propre à GLM-OCR), et le **repli vers le
> modèle texte est éteint** — une page non lue bloque et le dit. Voir la section « Lecture vision » du document de
> fonctionnement.

## Drapeaux

| Drapeau | Emplacement | Défaut (code) | Production | Portée |
|---|---|---|---|---|
| `Accounting:BankStatementAiPostingEnabled` | `FactuTrust.API/appsettings*.json` | `false` | `true` | Endpoints `api/accounting/bank-statement-import/*` (404 si éteint), entrées de menu côté front |
| `Accounting:BankReconciliationMatchingV2Enabled` | idem | `false` | `true` | `AutoAssociateAsync` : priorité au lien source, comptes 532 ↔ 532x dans les deux sens |
| `Accounting:BrouillardEnabled` | idem | (existant) | `true` | **Requis** pour générer : la génération est refusée sans brouillard |
| `Accounting:BankStatementLayoutParserEnabled` | idem | `false` | `true` | Assistant de rapprochement : lecture par profils quand le parseur historique ne lit rien, avant OCR/IA |
| `Accounting:BankStatementPreviewTimeoutSeconds` | idem | `240` | `240` | Budget OCR + IA de l'aperçu de l'assistant (toujours < 300 s, délai nginx) |
| `Accounting:BankStatementAiForAllDocumentsEnabled` | idem | `false` | `true` | Tout relevé PDF/image passe par l'import IA ; l'aperçu PDF/image de l'assistant est fermé (`bank_statement.ai_import_required`). Sans effet si `BankStatementAiPostingEnabled` est éteint |
| `Accounting:BankStatementImport:AiOnlyReadingEnabled` | idem | `false` | `true` | **D1/D3** : les opérations viennent uniquement de l'IA (plan `ai_only`), la lecture directe ne fournit que des métadonnées, un RIB différent n'empêche pas la lecture. Sans effet si « tout document par l'IA » est éteint |
| `Accounting:BankStatementImport:AiBalanceMismatchAsWarning` | idem | `false` | `true` | **D4** : écart de solde = avertissement à reconnaître (`acknowledgeBalanceWarning`) quand toutes les lignes viennent de l'IA ; éteint, l'écart bloque |
| `Accounting:BankStatementImport:AiPilotTenantIds` | idem (`__0`, `__1`…) | `[]` | `[]` | Liste de dossiers pilotes : non vide, `AiOnlyReadingEnabled` et `AiBalanceMismatchAsWarning` ne s'appliquent qu'à eux |
| `Accounting:BankStatementImport:VisionReadingEnabled` | idem | `false` | `true` | Lecture vision page par page par le modèle d'import configuré ; éteint, le plan `ai_only` lit tout avec le modèle texte (dépannage) |
| `Accounting:BankStatementImport:VisionTextFallbackEnabled` | idem | `true` | **`false`** | Éteint : une page non lue par la vision bloque et le dit, au lieu d'être relue sans son image. Rallumer relève du dépannage |
| `Accounting:BankStatementImport:VisionSendTextLayer` | idem | `false` | `false` | Image de page seule ; la couche texte n'est pas jointe à l'appel vision |
| `Accounting:BankStatementImport:DocStrangeEnabled` | idem | `false` | `false` | Envoie les pages au service externe Docstrange (Nanonets), **hors du serveur**. Exige EN PLUS une clé au back-office. Distinct d'`AiComplementAllowExternal`, qui ne gouverne que les fournisseurs LLM. N'activer qu'avec l'accord écrit du responsable du traitement |
| `Accounting:BankStatementImport:MaxAiPages` / `MaxPages` | idem | `20` / `50` | `20` / `50` | Pages lues par l'IA par relevé / pages par fichier |
| `Accounting:BankStatementImport:VisionCallTimeoutSeconds` | idem | `300` | `300` | Délai d'un appel vision par page |
| `Accounting:BankStatementImport:AiJobBudgetMinutes` | idem | `120` | `180` | Budget de la tâche Hangfire, attente de la file comprise (20 × 360 s × 1,5) |
| `Accounting:BankStatementImport:AiWorkerCount` | idem | `1` | `1` | Ouvriers de la file `bank_statement_ai` ; jamais plus que `Ollama:MaxConcurrentGenerations` (1) |
| `Accounting:BankStatementImport:AiComplementAllowExternal` | idem | `false` | `false` | Autorise l'envoi de pages à une IA externe (jamais en production sans décision du responsable du traitement) |
| `Ollama:BankStatementImportVisionModel` | idem | (vide → `InvoiceImportVisionModel`) | `hf.co/ggml-org/GLM-OCR-GGUF:Q8_0` | Modèle vision des relevés, à nommer explicitement en production |
| `Ollama:TimeoutSeconds` | idem | `120` | `360` | Délai HTTP du client Ollama ; règle : ≥ `VisionCallTimeoutSeconds` + 60 |

Le front n'a **aucun drapeau propre** : il lit `GET …/capabilities`, qui répond **200 `{ enabled: false }`** quand la
fonctionnalité est éteinte (et non 404), et porte `aiUnavailableReason` / `visionUnavailableReason` quand l'IA
manque. Les autres endpoints restent en 404 drapeau éteint.

Les valeurs effectives sont journalisées au démarrage (`Startup.Features`, ligne « Bank statement import IA:
VisionReading=… VisionModel=… TextFallbackModel=… MaxAiPages=… AiJobBudgetMinutes=… AiWorkers=…
MaxConcurrentGenerations=… VisionCallTimeoutSeconds=… OllamaTimeoutSeconds=… »), avec un avertissement si :
l'import est actif sans brouillard ; la lecture vision est active sans modèle ; `AiWorkerCount` dépasse
`MaxConcurrentGenerations` ; `Ollama:TimeoutSeconds` < `VisionCallTimeoutSeconds` + 60 ; `AiOnlyReadingEnabled`
sans `VisionReadingEnabled` ou sans `BankStatementAiForAllDocumentsEnabled` ; `AiComplementAllowExternal=true`.
Quinze secondes après le démarrage, le service `OllamaVisionModelStartupCheckHostedService` journalise si GLM-OCR et
le modèle texte sont installés sur le moteur (« Modèle vision des relevés « … » prêt » ou avertissement) ; il ne
bloque jamais le démarrage. Un retour arrière se fait par variable d'environnement
(`Accounting__BankStatementImport__…`, `deploy/.env`), qui prime sur le fichier, jamais en modifiant le dépôt : la
cohérence des valeurs embarquées est vérifiée par `BankStatementVisionSettingsConsistencyTests`.

## Étapes

| # | Étape | Action | Réversible ? |
|---|---|---|---|
| 1 | **Balayage préalable** | Sur chaque base tenant : `SELECT COUNT(*) FROM JournalEntries WHERE SourceEntityType = N'BankStatementLine';` (doit valoir 0). Une valeur non nulle empêche la création de l'index unique (voir « Le piège »). | n/a (lecture seule) |
| 2 | **Migration de schéma** | `AddBankStatementAiImport_Tenant` par l'API au démarrage, ou son jumeau `docs/runbooks/sql/AddBankStatementAiImport_Tenant.idempotent.sql`. Vérifier : tables `BankStatementImportSessions`, `BankPostingRules`, `BankLabelClassifications` et index `IX_JournalEntries_BankStatementLineSource`. | Oui — `Down` supprime uniquement les objets ajoutés |
| 3 | **Déploiement**, drapeaux éteints | Comportement identique à l'existant. Le menu Import de la saisie manuelle n'affiche pas l'entrée relevé. | Oui — rollback binaire |
| 4 | **Recette locale** | `BankStatementAiPostingEnabled=true` sur une base de recette. Dérouler un relevé par banque (STB, BH, Zitouna, Attijari, BIAT) : contrôle de solde vert, enregistrement, propositions, génération, relance sans doublon, suppression d'un brouillon puis regénération. | Oui |
| 5 | **Production — import** | `BankStatementAiPostingEnabled=true`, sur feu vert explicite. Vérifier la ligne `Startup.Features` au démarrage. | Oui — bascule du drapeau |
| 6 | **Production — rapprochement V2** | `BankReconciliationMatchingV2Enabled=true` après quelques relevés générés et validés. Contrôler qu'un relevé déjà associé l'est toujours (sur-ensemble des associations). | Oui — bascule du drapeau |
| 7 | **Assistant — lecture par profils** | Indépendant des étapes 4 à 6. `BankStatementLayoutParserEnabled=true` sur feu vert, après recette d'un relevé BIAT mensuel (et d'un fichier de deux mois) dans l'assistant de rapprochement. | Oui — bascule du drapeau |
| 8 | **Tout document par l'IA** (lecture historique) | Après l'étape 5. (a) Dans chaque dossier, requête « comptes non éligibles » ci-dessous : un compte sans lien 532 ou hors dinars ne pourra plus importer de PDF depuis le rapprochement. (b) Recette : relevé prouvé (aucun appel IA, retour à l'étape 2) ; relevé dont le solde ne boucle pas (lecture IA) ; utilisateur sans `ai:chat` (blocage expliqué) ; CSV inchangé. (c) Remplacée par la recette D5 de l'étape 9. (d) `BankStatementAiForAllDocumentsEnabled=true` sur feu vert. | Oui — bascule du drapeau |
| 9 | **GLM-OCR pour tout relevé** (D1 à D5) | Séquence détaillée ci-dessous : prérequis, déploiement à comportement constant, recette D5, go/no-go, pilote, généralisation. | Oui — bascule des drapeaux, dans l'ordre du « Retour arrière » |

Requête « comptes non éligibles » (étape 8a, lecture seule, sur chaque base tenant) :

```sql
SELECT Id, BankName, RIGHT(Rib, 4) AS RibFin, ChartOfAccountNumber, Currency
FROM BankAccounts
WHERE IsActive = 1
  AND (ChartOfAccountNumber IS NULL OR LTRIM(RTRIM(ChartOfAccountNumber)) = N'' OR Currency <> N'TND');
```

### Étape 9 — séquence

1. **Prérequis serveur** : GLM-OCR installé à la main dans le conteneur Ollama (`deploy/README.md`, section GLM-OCR),
   vérifié par `VERIFY_ONLY_MODE=1 COMPOSE_EXTRA_FILE=deploy/docker-compose.vps.yml bash deploy/scripts/pull-ollama-models.sh`
   (chaque modèle listé, capacité vision confirmée). Mémoire : `OLLAMA_MAX_LOADED_MODELS=2`,
   `Ollama__EngineRamBudgetGiB=12`, `mem_limit: 12g` (`docker-compose.vps.yml`) ; pire cas ≈ 10 Go (chat 7b +
   GLM-OCR), ne pas passer `OLLAMA_MAX_LOADED_MODELS` à 3.
2. **Migration D4** : `AddBankStatementBalanceCheck_Tenant` par l'API au démarrage, ou son jumeau
   `docs/runbooks/sql/AddBankStatementBalanceCheck_Tenant.idempotent.sql` (colonnes `BalanceDifference`,
   `BalanceAcknowledged` sur `BankStatements`).
3. **Déploiement à comportement constant** : livrer la version avec, dans `deploy/.env`,
   `Accounting__BankStatementImport__AiOnlyReadingEnabled=false` et
   `Accounting__BankStatementImport__AiBalanceMismatchAsWarning=false` (les fichiers embarquent `true`). La lecture
   historique continue ; seuls le contrôle de santé, le journal de démarrage et le script de vérification changent.
   Cette version modifie `deploy/docker-compose.yml` (`OLLAMA_MAX_LOADED_MODELS`) : `deploy.sh` refuse le chemin
   automatique (« changement d'infrastructure ») ; suivre le déploiement manuel du `deploy/README.md`, une fois.
4. **Recette D5** sur le serveur de production (processeur seul), relevés réels, IA locale uniquement : voir
   « Recette GLM-OCR » ci-dessous. Reporter la durée mesurée par page dans `deploy/.env.example` (commentaire
   « GLM-OCR … s/page ») et, si besoin, ajuster `VisionEstimatedSecondsPerPage`.
5. **Go/no-go** : rappel des opérations ≥ 98 % (aucune ligne imprimée oubliée sur l'ensemble des relevés de recette),
   médiane ≤ 180 s par page, maximum ≤ 300 s par page (sinon augmenter `VisionCallTimeoutSeconds` et
   `Ollama:TimeoutSeconds` ensemble, puis `AiJobBudgetMinutes`), étage 1 (GLM-OCR JSON natif) ≥ 80 % des pages,
   étage 3 (repli texte) ≤ 10 % des pages, aucun écart de solde non expliqué par une ligne illisible.
6. **Pilote** : `Accounting__BankStatementImport__AiPilotTenantIds__0=<guid du dossier pilote>` et retrait des deux
   variables de l'étape 3 : seuls les dossiers listés passent en lecture GLM-OCR (`ai_only` + avertissement de
   solde). Une à deux semaines, en suivant « Supervision ».
7. **Généralisation** : retirer `AiPilotTenantIds` (liste vide = tous les dossiers). Vérifier la ligne
   `Startup.Features` et le contrôle `ollama-bank-statement-vision` (Healthy).
8. **Retour arrière** : voir la section dédiée (ordre des drapeaux).

## Recette GLM-OCR (étape 9, décision D5)

Recette automatisée sur les vrais relevés de la recette privée (**jamais commités**), avec le **vrai modèle local**
(`BankStatementVisionRecetteTests`, trait `Category=PrivateBankFixtures`, ignorée sans les variables). Chaque relevé
(texte, scanné, image) est lu page par page comme en production : même gabarit, même rendu, mêmes étages ; la sortie
ne contient que des noms de fichiers, des compteurs et des durées.

```bash
FACTUTRUST_PRIVATE_BANK_FIXTURES='/srv/recette/private-bank-fixtures' \
FACTUTRUST_RECETTE_OLLAMA_URL='http://localhost:11434' \
FACTUTRUST_RECETTE_VISION_MODEL='hf.co/ggml-org/GLM-OCR-GGUF:Q8_0' \
dotnet test src/Backend/tests/FactuTrust.Infrastructure.Tests --filter "Category=PrivateBankFixtures" --logger "console;verbosity=normal"
```

Les relevés étant réels, n'utiliser qu'une IA **locale**, jamais un fournisseur externe. Critères : ceux du go/no-go
(rappel ≥ 98 %, médiane ≤ 180 s/page, max ≤ 300 s/page, étage 1 ≥ 80 %, étage 3 ≤ 10 %).

| Date | Serveur | Relevés (texte / scannés / images) | Pages | Rappel | Étage 1 / 2 / 3 | Médiane s/page | Max s/page | Écarts de solde | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| à compléter | production (CPU) | | | | | | | | |

Historique de la lecture historique (02/10/2026, `qwen2.5:7b-instruct`, poste avec GPU, `BankStatementAiRealModelRecetteTests`) :
6 relevés sur 6 restaurés et équilibrés, 118 opérations relues en 22 appels, 24 s par appel en moyenne, 32 s au plus.
Écueils du modèle texte corrigés de façon déterministe à cette occasion (montants « 2,380 », sens inversé, ligne de
suite prise pour une opération, montants × 1 000, totaux recopiés, dates « jj/mm/aaaa ») : ces garde-fous restent
actifs dans l'étage 3.

## Données personnelles et IA externe

Avec la lecture GLM-OCR, **chaque page** de relevé (texte, scannée, image) est envoyée **en image** au moteur IA
**local** (Ollama) ; une page repliée est envoyée en texte (RIB/IBAN masqués) au modèle texte local. Rien ne quitte
le serveur. La classification n'envoie que le cœur du libellé et le sens, selon la configuration plateforme.

Si la plateforme désigne un fournisseur **externe** pour l'import (OpenRouter, Modal…), **aucune page** ne lui est
envoyée : l'import annonce l'IA indisponible (`external_not_allowed`) tant que `AiComplementAllowExternal` reste
`false`. N'activer ce réglage qu'avec l'accord écrit du responsable du traitement ; il déclenche un avertissement au
démarrage.

## Diagnostic de support

Toujours partir de l'identifiant de session (`SessionId`, visible dans l'URL de l'écran d'analyse). Sur la base du
dossier :

```sql
SELECT Id, Status, ErrorCode, ExtractionMethod, AiProviderKind, PageCount, ProgressPercent,
       JSON_VALUE(ResultJson, '$.AiPlan.Mode')          AS Mode,
       JSON_VALUE(ResultJson, '$.AiPlan.Engine')        AS Engine,
       JSON_QUERY(ResultJson, '$.AiPlan.PageReadings')  AS PageReadings,
       JSON_QUERY(ResultJson, '$.AiPlan.FallbackPages') AS FallbackPages
FROM BankStatementImportSessions
WHERE Id = @id;
```

- `PageReadings[].engine` : `glm-ocr` (étage 1), `glm-ocr-table` (étage 2), `text-model` (étage 3), `failed` ;
  `ExtractionMethod` : `ai-vision`, `ai-text`, `none` (ou valeurs historiques).
- Journaux de l'API : filtrer sur le `SessionId` ; chercher `Outcome`, `Lines`, `invalid_json`, `timeout`,
  « Modèle vision des relevés ». Aucun libellé, montant ni image n'y figure.
- Moteur : `docker exec factutrust-ollama ollama ps` (modèle chargé), `ollama show hf.co/ggml-org/GLM-OCR-GGUF:Q8_0`
  (capacité vision), `docker stats factutrust-ollama` (mémoire), `GET /api/platform/ops/health` (contrôle
  `ollama-bank-statement-vision` : Healthy / Degraded = modèle vision absent ou sans mémoire, repli texte prêt /
  Unhealthy = moteur injoignable ou aucun modèle prêt). **Limite connue** : le contrôle vérifie la présence
  du modèle et la mémoire, pas la capacité vision (projecteur mmproj) — un modèle installé sans son
  projecteur est Healthy ici mais échouera à la lecture. La vérification définitive reste
  `deploy/scripts/pull-ollama-models.sh` (`VERIFY_ONLY_MODE=1`, qui contrôle `ollama show … vision`).
- Audit du dossier : `Accounting.BankStatementAnalyzed` (`AiUnavailableReason`, `Retarget`, `Retry`,
  `PreviousSessionId`), `Accounting.BankStatementAiReadingCompleted` (pages, pages vision, pages repliées, pages
  non lues, durée, modèles), `Accounting.BankStatementExtractionCorrected` (corrections, exclusions, écart reconnu).

## Supervision

- **Hangfire** (`/hangfire`, file `bank_statement_ai`, un ouvrier) : une session `Processing` depuis plus de
  `AiJobBudgetMinutes` (180 min) est une tâche bloquée ; la session ne bloque plus le dossier au-delà du budget,
  l'utilisateur peut relancer (« Relancer l'analyse »).
- **Chat** : pendant la lecture d'un relevé, le chat attend derrière l'unique créneau de génération
  (`MaxConcurrentGenerations=1`) ; un relevé de 20 pages ≈ 1 h sur processeur. Prévenir les utilisateurs du pilote.
- **Mémoire** : `docker stats factutrust-ollama` sous 12 Go ; un modèle déchargé en boucle (chat 7b ↔ GLM-OCR)
  signale un `OLLAMA_MAX_LOADED_MODELS` trop bas.
- **Santé** : `ollama-bank-statement-vision` Degraded pendant plus de quelques minutes = modèle désinstallé ou
  mémoire insuffisante ; `smoke-test.sh` l'affiche quand `FACTUTRUST_ADMIN_TOKEN` est fourni.

## Le piège de l'étape 2

L'index `IX_JournalEntries_BankStatementLineSource` est **unique et filtré** :
`WHERE [IsReversed] = 0 AND [SourceEntityType] = N'BankStatementLine'`. Si des écritures non extournées portent
déjà ce type de source pour une même ligne, sa création échouerait. La migration ne lève pas d'erreur dans ce cas :
elle **saute la création de l'index**, et l'idempotence ne repose plus que sur le contrôle applicatif. D'où le
balayage de l'étape 1. Après correction des doublons, rejouer le jumeau SQL pour créer l'index.

Le jumeau SQL commence par `SET QUOTED_IDENTIFIER ON` : sans cette option, `sqlcmd` refuse la création d'un index
filtré (Msg 1934).

## Retour arrière

Par variables d'environnement dans `deploy/.env`, puis `docker compose up -d api` (les analyses déjà lancées se
terminent avec le réglage en vigueur à leur lancement) ; du plus ciblé au plus large :

1. `Accounting__BankStatementImport__AiBalanceMismatchAsWarning=false` : l'écart de solde redevient bloquant, la
   lecture GLM-OCR continue.
2. `Accounting__BankStatementImport__AiOnlyReadingEnabled=false` : retour à la lecture historique (lecture directe,
   IA sur les pages non lues avec certitude).
3. `Accounting__BankStatementImport__VisionReadingEnabled=false` : plus d'appel GLM-OCR, moteur texte seulement.
4. `Accounting__BankStatementAiForAllDocumentsEnabled=false` : l'assistant retrouve son aperçu PDF historique.
5. Éteindre `BankStatementAiPostingEnabled` (et `BankReconciliationMatchingV2Enabled`) pour tout couper.

Les brouillons déjà générés restent des écritures ordinaires du brouillard : les supprimer ou les valider comme les
autres. Les relevés enregistrés restent visibles et utilisables dans l'assistant de rapprochement ; un relevé
enregistré avec écart reconnu garde `BalanceDifference` et `BalanceAcknowledged`. Le `Down` des migrations n'est
nécessaire que pour retirer le schéma, ce qui n'est jamais requis pour désactiver la fonctionnalité.
