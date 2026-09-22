# Migration du plan comptable vers la NCT 01 (`nct01-v1`)

Le plan hérité (hybride PCG français, ~211 comptes semés par les migrations EF) est remplacé par le catalogue NCT 01 + overlay métier (623 comptes). Les écritures stockent un **numéro string** : toutes les colonnes `*AccountNumber*` sont réécrites, y compris sur les périodes clôturées.

> **Depuis la correction du 2026-09-22, le catalogue est posé au PROVISIONNEMENT du dossier**, et non plus seulement au premier appel HTTP. Un dossier neuf naît donc en NCT 01 quelle que soit la stratégie (`Migrate` comme `TemplateClone`). Voir « Ce qui a changé » ci-dessous.

> **Voir aussi — renumérotation des comptes trop longs.** Un second passage,
> `ChartAccountDigitCompactionService`, s'exécute juste après ce remap au boot tenant : il ramène
> sous 8 chiffres les comptes qui les dépassent (auxiliaires salariés hérités du matricule, en
> 10 chiffres). Il partage les primitives de réécriture de ce remap mais garde son **propre**
> inventaire de colonnes, plus complet de six paires, et sa propre allow-list anti-injection.
> Contrairement à ce remap, il est **réversible** — sa carte est injective vers des numéros libres,
> et `ChartOfAccountCompactionLogs` en conserve l'inverse. Pré-contrôle :
> `docs/runbooks/sql/CompactOverlongAccountNumbers.readonly.sql`.

Le remap n’est **pas idempotent** sur les cycles (`421↔425`, `231↔232`). L’idempotence du **remap** repose uniquement sur `ChartOfAccountRemapLogs.MapVersion = nct01-v1`.

## Ce qui a changé le 2026-09-22

Trois défauts cumulés laissaient les dossiers de production sur le plan hérité (~211 comptes) :

1. en `TenantProvisioning__Strategy=Migrate` (valeur de production), le provisionnement n’exécutait
   que les migrations EF — `TenantRuntimeCatalogBootstrapper` n’était appelé que pour la base
   **template**, inatteignable dans ce mode ;
2. `TenantService` marquait ensuite le dossier « migré » dans le cache du garde
   (`TenantMigrationGuard.MarkApplied`), ce qui neutralisait **une heure** le seul rattrapage
   existant ;
3. l’idempotence ne regardait que la constante `nct01-v1` : une base estampillée ne revoyait plus
   jamais le catalogue, même corrigé.

Corrections :

- **Seed au provisionnement** : `TenantService.CreateTenantDatabaseAsync` et
  `CreateAccountingFirmDatabaseAsync` appellent `ITenantRuntimeCatalogSeeder` juste après la
  création de la base (avant les modèles sectoriels). Un échec n’interrompt pas la création du
  dossier : il est journalisé en `LogError` et le garde reprend la main au premier appel.
- **`MarkApplied` conditionnel** : le garde n’est court-circuité que si le plan est réellement en
  NCT 01 (verdict `nct01`).
- **Deux estampilles distinctes** dans `ChartOfAccountRemapLogs` :
  - `MapVersion = nct01-v1` → le **remap des numéros**, destructif, exactement une fois par base ;
  - `CatalogHash` (nouvelle colonne, ajoutée à la volée) → la **synchronisation du catalogue**,
    non destructive et rejouable dès que le JSON embarqué change d’empreinte. La resynchronisation
    aligne libellés, rattachements, classes et natures et crée les comptes manquants, mais ne
    réécrit aucun numéro et **ne réactive pas** un compte désactivé à la main.
- **Mode sûr par défaut** : sur un dossier qui contient déjà des écritures ou des bulletins, le
  chemin automatique (provisionnement, premier appel) **ne fait rien** et journalise un
  avertissement — le remap réécrirait l’historique sans sauvegarde ni décision humaine. La bascule
  passe alors par l’endpoint plateforme ci-dessous. Un dossier vide bascule automatiquement.
- Quand la bascule est différée, seules les étapes **indépendantes du plan comptable** sont
  exécutées (catalogues de retenue à la source, paramètres d’exercice, rubriques de déclaration) :
  la réparation des catégories d’amortissement et les comptes RS visent des numéros NCT
  (`221`/`2821`/`68112`, parent `432`) absents du plan hérité, et les poser créerait des références
  suspendues.

## Diagnostic et bascule (administrateur plateforme)

```
GET  /api/platform/migrations/tenants/chart-of-accounts-status
POST /api/platform/migrations/tenants/{tenantId}/chart-of-accounts/apply?dryRun=true
POST /api/platform/migrations/tenants/{tenantId}/chart-of-accounts/apply?dryRun=false
```

Verdicts : `nct01` (conforme), `legacy` (plan hérité, dossier sans écriture — basculera seul au
prochain appel), `deferred` (plan hérité **avec** écritures : bascule à déclencher ici, après
sauvegarde), `catalog-drift` (remap posé, catalogue plus ancien que celui de l’API : la
resynchronisation part seule), `no-chart` / `no-database` / `unreachable`.

`dryRun=true` ne touche à rien et renvoie le différentiel (comptes à créer, à renuméroter, à
fusionner, à désactiver, lignes d’écriture réécrites, échantillon « ancien → nouveau »). Chaque
appel — simulation comprise — est consigné dans l’audit plateforme sous l’action
`chart-of-accounts.nct01.apply`.

## Pré-checks

1. **Backup** de chaque base tenant (restore = rollback sûr).
2. Compter les lignes avant migration :

```sql
SELECT '4477' AS N, COUNT(*) FROM JournalEntryLines WHERE AccountNumber LIKE N'4477%'
UNION ALL SELECT '421', COUNT(*) FROM JournalEntryLines WHERE AccountNumber LIKE N'421%'
UNION ALL SELECT '211', COUNT(*) FROM JournalEntryLines WHERE AccountNumber LIKE N'211%'
UNION ALL SELECT '412', COUNT(*) FROM JournalEntryLines WHERE AccountNumber LIKE N'412%'
UNION ALL SELECT 'coa', COUNT(*) FROM ChartOfAccounts;
```

3. Noter le FODEC du mois en cours (somme `Invoices.FodecAmount` vs journal `4477`).
4. Vérifier que la balance générale est équilibrée (total débit = total crédit).

## Déploiement

1. Déployer l’API (JSON embarqués `nct01-coa-catalog.json` / `coa-remap-v1.json`).
2. **Dossiers neufs** : le catalogue est posé à la fin du provisionnement, quelle que soit la
   stratégie. Aucune action.
3. **Dossiers existants sans écriture** : `TenantMigrationGuard` applique la bascule au premier
   appel du dossier (migration EF `20260817140000` pour la table de log, puis
   `Nct01ChartMigrationService` avant le seed des comptes de RS).
4. **Dossiers existants avec écritures** : rien ne part tout seul. Passer par le diagnostic puis
   l’endpoint de bascule, après sauvegarde.
5. Un échec du remap bloque le tenant (HTTP 503), comme les autres migrations ; un dossier
   simplement *différé* n’est jamais bloqué.

## Post-checks

```sql
-- Idempotence posée (CatalogHash = empreinte du catalogue embarqué au moment de l'application)
SELECT MapVersion, AppliedAt, AccountCount, CatalogHash FROM ChartOfAccountRemapLogs WHERE MapVersion = N'nct01-v1';

-- Plan réellement migré : le libellé hérité « Capital et réserves assimilées » doit avoir disparu,
-- et le nombre de comptes dépasser 600.
SELECT COUNT(*) AS Comptes FROM ChartOfAccounts;
SELECT AccountNumber, Label FROM ChartOfAccounts WHERE AccountNumber IN (N'10', N'102', N'106', N'6813');

-- FODEC overlay
SELECT AccountNumber, Label, IsSystem, IsActive, ParentAccountNumber
FROM ChartOfAccounts WHERE AccountNumber IN (N'43652', N'4371', N'4320', N'228', N'425');

-- Plus aucune ligne sur les anciens numéros opérationnels
SELECT AccountNumber, COUNT(*) FROM JournalEntryLines
WHERE AccountNumber IN (N'4477', N'4478', N'6371', N'412')
   OR AccountNumber LIKE N'4456%'
GROUP BY AccountNumber;

-- Balance toujours équilibrée
SELECT SUM(DebitAmount), SUM(CreditAmount) FROM JournalEntryLines;
```

Contrôles métier :

- `43652` existe, `IsSystem = 1`, parent `4365`.
- Aucune ligne `4477` ; le FODEC du mois = somme des factures (agrégat document, pas le n° de compte).
- Paie : net sur `425` / `425xxxx`, avances `421`, État `432`, CNSS `453`. TFP/FOPROLOS restent agrégés `647`+`432` (pas `6611`/`6612`).
- Terrains : soldes sous `221*` dans la liasse corporelle, pas sous `21` (incorporelles NCT).

## Rollback

- **Restore DB** : méthode par défaut dès qu’une écriture NCT-only a été saisie après le remap (`43652`, `228`, `425xxxx`, etc.).
- **Carte inverse** (`coa-remap-v1.json` inversé) : uniquement si **aucune** nouvelle pièce n’a été comptabilisée sur des numéros NCT-only. Les cycles `421↔425` et `231↔232` rendent un second passage de `Rewrite` destructeur. Ne jamais relancer le service sans vider `ChartOfAccountRemapLogs` **et** sans restore.

Pour forcer un rejeu après restore :

```sql
DELETE FROM ChartOfAccountRemapLogs WHERE MapVersion = N'nct01-v1';
```

Puis redémarrer l’API / invalider le cache `TenantMigrationGuard`.

## Hors périmètre

- Ne pas poster TFP/FOPROLOS sur `6611`/`6612`.
- Ne pas réécrire la seed historique `20260326233329_AddAccountingModule_Tenant`.
- Ne pas modifier les journaux `JV` / `JA` / `JB` / `JC` / `JOD` / `JAN`.
- Ne pas bloquer `/api/accounting/*` pour un cabinet en mode natif : l’écran **Échéancier fiscal**
  du cabinet (`/firm/fiscal-schedule`) charge le composant `features/accounting/fiscal-schedule`,
  qui appelle `/api/accounting/fiscal-schedule` hors contexte dossier. Un blocage par préfixe
  casserait aussi `/api/accounting-firms` (affectations, badges, navigation).
