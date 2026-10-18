# Migrations des bases tenant (FactuTrust)

## Erreur HTTP 503 — `TENANT_MIGRATION_FAILED`

Si le frontend affiche **« Impossible d'accéder à la base de données »** avec le code `TENANT_MIGRATION_FAILED` dans la console :

- **Cause :** une migration EF Core tenant est en attente ou a échoué (`TenantMiddleware` bloque toutes les API authentifiées).
- **Diagnostic :** consulter les logs API (`Failed to ensure migrations for tenant {TenantId}`) et l'historique `__EFMigrationsHistory` sur la base du tenant.

### Solution

**Option 1 – Redémarrer l'API (développement)**  
Avec `TenantMigrations.ApplyOnStartup = true`, les migrations en attente sont ré-appliquées au démarrage. En dev, un échec bloque le démarrage pour signaler le problème immédiatement.

**Option 2 – Backoffice / API plateforme**  
Avec un compte **PlatformAdmin** :

```http
POST https://localhost:7001/api/platform/migrations/tenants/apply-migrations
Authorization: Bearer <token>
```

Pour un tenant précis :

```http
POST https://localhost:7001/api/platform/migrations/tenants/{tenantId}/apply-migrations
Authorization: Bearer <token>
```

Statut global :

```http
GET https://localhost:7001/api/platform/migrations/tenants/migrations-status
Authorization: Bearer <token>
```

**Option 3 – Ligne de commande EF (maintenance)**  

```bash
dotnet ef database update \
  --project src/Backend/FactuTrust.Infrastructure \
  --startup-project src/Backend/FactuTrust.API \
  --context TenantDbContext \
  --connection "Server=(localdb)\MSSQLLocalDB;Database=FactuTrust_Tenant_XXXX;..."
```

---

## Erreur « Invalid column name 'Reference' » sur la page Inventaire

Si la page **Inventaire** affiche une erreur de chargement du type :

- **Message :** `Invalid column name 'Reference'.`
- **Cause :** La migration qui ajoute la colonne `Reference` à la table `PhysicalInventories` n'a pas encore été appliquée sur la base de données du tenant.

Appliquer les migrations tenant via l'une des options ci-dessus.

---

## Erreur « Invalid column name 'ApplyCnssCeilingToPayrollTaxes' » sur la fiche salarié / paramètres paie

Si la fiche salarié (`/payroll/employees/{id}`) ou les paramètres paie affichent une erreur HTTP **500** sur `GET /api/payroll/settings/parameters/{year}` :

- **Message :** `Invalid column name 'ApplyCnssCeilingToPayrollTaxes'.`
- **Cause :** la migration tenant `20260810120000_AddPayrollTaxBase_Tenant` n'a pas été appliquée sur la base du tenant alors que le code backend interroge déjà cette colonne sur `PayrollYearParameters`.

### Solution

Appliquer les migrations tenant via l'une des options de la section [Erreur HTTP 503](#erreur-http-503--tenant_migration_failed).

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/AddPayrollTaxBase_Tenant.idempotent.sql`](runbooks/sql/AddPayrollTaxBase_Tenant.idempotent.sql)

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddPayrollTaxBase%';

SELECT COL_LENGTH('dbo.PayrollYearParameters', 'ApplyCnssCeilingToPayrollTaxes') AS ColumnExists;
```

---

## Erreur « Invalid object name 'CustomSystemDefinitions' » sur Studio AI

Si la page **Studio AI** (`/studio/ai`) ou la sidebar Studio affiche une erreur HTTP **500** sur `GET /api/studio/nav` :

- **Message :** `Invalid object name 'CustomSystemDefinitions'.` (ou `Invalid column name 'SystemId'`)
- **Cause :** la migration tenant `20260624181553_AddStudioSystems_Tenant` n'a pas été appliquée sur la base du tenant alors que le code backend la référence déjà.

### Solution

Appliquer les migrations tenant via l'une des options de la section [Erreur HTTP 503](#erreur-http-503--tenant_migration_failed).

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/AddStudioSystems_Tenant.idempotent.sql`](runbooks/sql/AddStudioSystems_Tenant.idempotent.sql)

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddStudioSystems%';

SELECT OBJECT_ID('CustomSystemDefinitions') AS TableExists;
```

---

## Erreur « Invalid column name 'Kind' » sur le Studio (relations plusieurs-à-plusieurs)

Si `GET /api/studio/entities`, `GET /api/studio/records/{entityKey}/schema` ou la création d'une table Studio renvoie un **500** :

- **Message :** `Invalid column name 'Kind'.` — `GET /api/studio/nav` renvoie, lui, une navigation **vide** (garde `IsStudioSchemaMissing`).
- **Cause :** la migration tenant `20260912130000_AddStudioEntityKind_Tenant` (PR 2.1 du programme Studio IA : colonne `CustomEntityDefinitions.Kind`, défaut `0` = Standard, index `(TenantId, Kind)`) n'a pas été appliquée sur la base du tenant alors que le code backend la référence déjà.

### Solution

Appliquer les migrations tenant via l'une des options de la section [Erreur HTTP 503](#erreur-http-503--tenant_migration_failed).

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/AddStudioEntityKind_Tenant.idempotent.sql`](runbooks/sql/AddStudioEntityKind_Tenant.idempotent.sql) — rejouable, ajoute la colonne et l'index s'ils manquent et inscrit la ligne d'historique.

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddStudioEntityKind%';

SELECT COL_LENGTH('CustomEntityDefinitions', 'Kind') AS KindColumnLength; -- 4 attendu
```

Aucune donnée existante n'est modifiée : toutes les tables Studio existantes restent `Kind = 0` (Standard). Le drapeau `Ollama:EnableStudioManyToMany` ne dispense **pas** de la migration : la colonne est lue quel que soit son état.

---

## Erreur « Invalid object name 'CustomRecordViewDefinitions' » sur les vues Studio

Si les endpoints de vues enregistrées (`GET/POST /api/studio/records/{entityKey}/views`, `…/{id}/run`) ou la lecture du schéma (`GET /api/studio/records/{entityKey}/schema` avec `views`) renvoient un **500** quand `Ollama:EnableStudioRecordViews` est levé :

- **Message :** `Invalid object name 'CustomRecordViewDefinitions'.`
- **Cause :** la migration tenant `20260912140000_AddStudioRecordViews_Tenant` (PR 2.3 du programme Studio IA : table des vues Liste / Kanban / Calendrier, FK cascade vers `CustomEntityDefinitions`, index unique filtré `(TenantId, EntityDefinitionId, Key) WHERE IsDeleted = 0`, index `(TenantId, EntityDefinitionId, IsDefault)`) n'a pas été appliquée sur la base du tenant alors que le code backend la référence déjà.

### Solution

Appliquer les migrations tenant via l'une des options de la section [Erreur HTTP 503](#erreur-http-503--tenant_migration_failed).

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/AddStudioRecordViews_Tenant.idempotent.sql`](runbooks/sql/AddStudioRecordViews_Tenant.idempotent.sql) — rejouable, crée la table et les index s'ils manquent et inscrit la ligne d'historique.

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddStudioRecordViews%';

SELECT OBJECT_ID('CustomRecordViewDefinitions') AS TableExists;
```

Aucune donnée existante n'est modifiée : la table est nouvelle. Le drapeau `Ollama:EnableStudioRecordViews` ne dispense **pas** de la migration : la table est créée que le drapeau soit levé ou non (migration additive inerte) ; coupé, le drapeau rend simplement les routes 404.

---

## Erreur « Invalid object name 'StudioWorkflowDefinitions' » sur les workflows Studio

Si les endpoints de conception des workflows (`GET/POST /api/studio/entities/{entityId}/workflows`, `GET/PUT/DELETE /api/studio/workflows/{id}`, `…/toggle`, `…/duplicate`, `…/instances`) ou le déclencheur d'exécution renvoient un **500** quand `Ollama:EnableStudioWorkflows` est levé :

- **Message :** `Invalid object name 'StudioWorkflowDefinitions'.` (ou `StudioWorkflowInstances`, `StudioWorkflowStepRuns`, `StudioWorkflowApprovals`).
- **Cause :** la migration tenant `20260912150000_AddStudioWorkflows_Tenant` (PR 4.1 du programme Studio IA : quatre tables autonomes — définitions, instances, exécutions d'étapes append-only, approbations — sans clé étrangère, avec 9 index dont la clé unique filtrée `(TenantId, EntityDefinitionId, Key) WHERE IsDeleted = 0` des définitions) n'a pas été appliquée sur la base du tenant alors que le code backend la référence déjà.

### Solution

Appliquer les migrations tenant via l'une des options de la section [Erreur HTTP 503](#erreur-http-503--tenant_migration_failed).

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/AddStudioWorkflows_Tenant.idempotent.sql`](runbooks/sql/AddStudioWorkflows_Tenant.idempotent.sql) — rejouable, crée les tables et les index s'ils manquent et inscrit la ligne d'historique.

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddStudioWorkflows%';

SELECT OBJECT_ID('StudioWorkflowDefinitions') AS DefinitionsTableExists;
SELECT OBJECT_ID('StudioWorkflowInstances') AS InstancesTableExists;
SELECT OBJECT_ID('StudioWorkflowStepRuns') AS StepRunsTableExists;
SELECT OBJECT_ID('StudioWorkflowApprovals') AS ApprovalsTableExists;
```

Aucune donnée existante n'est modifiée : les quatre tables sont nouvelles. Le drapeau `Ollama:EnableStudioWorkflows` ne dispense **pas** de la migration : les tables sont créées que le drapeau soit levé ou non (migration additive inerte) ; coupé, le drapeau rend simplement les routes 404.

---

## Historique d'une fiche Studio lent : index `IX_AuditLogs_EntityHistory` absent

Si l'onglet **Historique** d'une fiche Studio (`GET /api/studio/records/{entityKey}/{id}/history`, 4.7h2) répond correctement mais **lentement** sur un tenant dont la table `AuditLogs` est volumineuse :

- **Symptôme :** aucune erreur SQL ni HTTP — la requête filtre `AuditLogs` sur `EntityType = 'CustomRecord'` et `EntityId`, triée par `CreatedAt` décroissant ; sans l'index, aucun index existant ne couvre le couple (`EntityType`, `EntityId`) : plan avec lecture large (scan, ou seek sur `IX_AuditLogs_EntityType` suivi d'un *Key Lookup* massif) puis tri.
- **Cause :** la migration tenant `20260918100000_AddAuditLogsEntityHistoryIndex_Tenant` (programme Studio IA « v1.1 », PR #171) n'est pas appliquée. Elle crée le seul index **non unique** `IX_AuditLogs_EntityHistory` sur `AuditLogs (EntityType, EntityId, CreatedAt)` ; elle ne touche à aucune donnée ni à aucune colonne. `Up` et `Down` sont idempotents (`IF NOT EXISTS` / `IF EXISTS`), donc rejouables sans erreur.

### Solution

Appliquer les migrations tenant via l'une des options de la section [Erreur HTTP 503](#erreur-http-503--tenant_migration_failed) (`dotnet ef database update`, backoffice plateforme ou script de déploiement).

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/AddAuditLogsEntityHistoryIndex_Tenant.idempotent.sql`](runbooks/sql/AddAuditLogsEntityHistoryIndex_Tenant.idempotent.sql) — rejouable, crée l'index s'il manque. Il n'insère **pas** encore la ligne `__EFMigrationsHistory` (à ajouter au lot 4.7★2, U7) : après l'avoir joué, `dotnet ef database update` ré-exécutera la migration, qui ne fera rien (`IF NOT EXISTS`) et consignera la ligne.

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddAuditLogsEntityHistoryIndex%';

SELECT name, is_unique FROM sys.indexes
WHERE object_id = OBJECT_ID('dbo.AuditLogs') AND name = 'IX_AuditLogs_EntityHistory';
-- attendu : 1 ligne, is_unique = 0
```

**Retour arrière :** `Down` supprime l'index s'il existe (garde `IF EXISTS` puis `DROP INDEX`), sans effet sur les données ; la route `/history` reste fonctionnelle, seulement plus lente. La route ne dépend d'aucun drapeau `Ollama:*` : l'index est utile dès que des fiches Studio sont modifiées, que les workflows soient activés ou non.

---

## Erreur « Invalid column name 'ValidatedAt' / 'ValidatedBy' » sur l'échéancier fiscal

Si la page **Échéancier fiscal** (`/accounting/fiscal-schedule`) affiche **« Chargement impossible »** avec une erreur HTTP **500** dans la console :

- **Message :** `Invalid column name 'ValidatedAt'.` et/ou `Invalid column name 'ValidatedBy'.`
- **Cause :** la migration tenant `20260710040719_AddFiscalScheduleValidatedAt_Tenant` n'a pas été appliquée sur la base du tenant alors que le code backend interroge déjà ces colonnes sur `FiscalScheduleEntries`.

### Solution

Appliquer les migrations tenant via l'une des options de la section [Erreur HTTP 503](#erreur-http-503--tenant_migration_failed).

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/AddFiscalScheduleValidatedAt_Tenant.idempotent.sql`](runbooks/sql/AddFiscalScheduleValidatedAt_Tenant.idempotent.sql)

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddFiscalScheduleValidatedAt%';

SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'FiscalScheduleEntries'
  AND COLUMN_NAME IN ('ValidatedAt', 'ValidatedBy');
```

---

## Unicité des numéros de facture de vente (index unique différé)

L'index sur `Invoices.Number` est aujourd'hui **non unique** (migration
`20260717125815_AddInvoiceSearchAndAuditIndexes_Tenant`). L'index UNIQUE exigé
par la réglementation fiscale ne doit être livré qu'après un balayage 100 %
propre de tous les tenants — une migration unique en échec bloquerait le tenant
au boot (`TenantMigrationGuard`).

Procédure complète (balayage → arbitrage → migration gardée) :
[`docs/runbooks/invoice-number-uniqueness.md`](runbooks/invoice-number-uniqueness.md)

Balayage : `GET /api/platform/migrations/tenants/invoice-number-integrity`
(PlatformAdmin) ou [`docs/runbooks/sql/ScanInvoiceNumberDuplicates_AllTenants.sql`](runbooks/sql/ScanInvoiceNumberDuplicates_AllTenants.sql).

---

## Vague 0 « Ventes & Distribution » — 5 migrations tenant (27/07/2026)

Cinq migrations **strictement additives**, livrées ensemble sur la branche
`fix/vague0-ventes-distribution`. Chacune possède un `Down()` complet et un script SQL
idempotent, et aucune ne modifie de document déjà émis.

| Migration | Objet | Script idempotent |
|---|---|---|
| `20260727100000_AddInvoiceSourceDeliveryNote_Tenant` | `Invoices.SourceDeliveryNoteId` — fin de la double déduction de stock. Backfill exhaustif depuis `DeliveryNotes.InvoiceId`. | [AddInvoiceSourceDeliveryNote_Tenant.idempotent.sql](runbooks/sql/AddInvoiceSourceDeliveryNote_Tenant.idempotent.sql) |
| `20260727110000_AddDeliveryNoteLineDiscountFodec_Tenant` | Remise et FODEC sur les lignes de BL. Aucun backfill : les BL existants gardent leurs totaux. | [AddDeliveryNoteLineDiscountFodec_Tenant.idempotent.sql](runbooks/sql/AddDeliveryNoteLineDiscountFodec_Tenant.idempotent.sql) |
| `20260727120000_AddQuoteFodecAndFiscalStamp_Tenant` | FODEC + timbre sur devis. **Aucun recalcul rétroactif.** Normalise aussi à `'TND'` les devises FODEC laissées vides par `20260713171729`. | [AddQuoteFodecAndFiscalStamp_Tenant.idempotent.sql](runbooks/sql/AddQuoteFodecAndFiscalStamp_Tenant.idempotent.sql) |
| `20260727130000_AddInvoiceLinkedInvoice_Tenant` | `Invoices.LinkedInvoiceId` — lien avoir → facture d'origine. Backfill best-effort depuis les brouillons convertis. | [AddInvoiceLinkedInvoice_Tenant.idempotent.sql](runbooks/sql/AddInvoiceLinkedInvoice_Tenant.idempotent.sql) |
| `20260727140000_AddStockMovementShortfall_Tenant` | `StockMovements.ShortfallQuantity` — traçabilité des ruptures. Comportement fonctionnel inchangé. | [AddStockMovementShortfall_Tenant.idempotent.sql](runbooks/sql/AddStockMovementShortfall_Tenant.idempotent.sql) |

### Contrôle à exécuter AVANT le déploiement

La validation de facture applique désormais les règles de conformité fiscale sur **tous** les
chemins (création directe, conversion devis, conversion BL), et plus seulement dans l'assistant.
Les factures déjà validées ne sont pas concernées — `Validate()` exige `Status = Draft`. Seuls
des **brouillons** existants pourraient devenir non validables.

Exécuter sur chaque base tenant, en lecture seule :
[`docs/runbooks/sql/CheckDraftInvoiceCompliance_Tenant.sql`](runbooks/sql/CheckDraftInvoiceCompliance_Tenant.sql)

Un résultat vide signifie qu'aucun brouillon existant ne sera bloqué. Sinon, la colonne
`MotifBlocage` indique la conduite à tenir pour chaque ligne.

---

## Erreur « Invalid column name 'CreatedBy' / 'UpdatedBy' / 'Version' » sur devis ou tarification

Si **Nouveau devis** (`POST /api/quotes`) ou les écrans pricing (`/api/pricing/price-lists`,
`promotions`, `payment-terms`) renvoient HTTP **500** avec :

- **Message :** `Invalid column name 'CreatedBy'.` / `UpdatedBy` / `Version`
- **Cause :** les tables `Promotions`, `PriceLists`, `PaymentTermTemplates`, etc. ont été créées
  sans les colonnes d'audit de `Entity` / `AggregateRoot`, alors que EF les mappe. La création de
  devis échoue dans `PromotionResolver` en lisant `Promotions`.

### Solution

Appliquer la migration tenant `20260731180000_AddPricingAuditColumns_Tenant` (redémarrage API en
dev, ou backoffice plateforme), ou le script :

[`docs/runbooks/sql/AddPricingAuditColumns_Tenant.idempotent.sql`](runbooks/sql/AddPricingAuditColumns_Tenant.idempotent.sql)

---

## Vague 1 « Socle ERP commercial » — migrations tenant

Migrations **strictement additives** de la vague 1 (commande client, conversions, tarification,
régimes TVA, code-barres). Chacune possède un `Down()` complet et un script SQL idempotent, et
aucune ne modifie de document déjà émis.

| Migration | Objet | Script idempotent |
|---|---|---|
| `20260728120000_AddSalesOrders_Tenant` | Tables `SalesOrders` / `SalesOrderLines` — l'agrégat commande client (numérotation `CDE`). Création de tables uniquement. | [AddSalesOrders_Tenant.idempotent.sql](runbooks/sql/AddSalesOrders_Tenant.idempotent.sql) |
| `20260729100000_AddProductBarcode_Tenant` | `Products.Barcode` (EAN-8/13) + index filtré **non unique**. L'unicité par tenant n'est livrée qu'après balayage des doublons. | [AddProductBarcode_Tenant.idempotent.sql](runbooks/sql/AddProductBarcode_Tenant.idempotent.sql) |
| `20260729140000_AddClientVatRegime_Tenant` | `Clients.VatRegime` (défaut 0 = Normal) + attestation de suspension (3 colonnes nullables) + index filtré. Les clients existants gardent leur comportement de facturation. | [AddClientVatRegime_Tenant.idempotent.sql](runbooks/sql/AddClientVatRegime_Tenant.idempotent.sql) |
| `20260730100000_AddPricing_Tenant` | Tables `PriceLists` / `PriceListItems` / `ClientProductPrices` (tarification, tranche 5A) + colonne `Clients.PriceListId` nullable + index. Création de tables + colonne additive. | [AddPricing_Tenant.idempotent.sql](runbooks/sql/AddPricing_Tenant.idempotent.sql) |
| `20260730160000_AddPriceListItemTiers_Tenant` | Table `PriceListItemTiers` — paliers quantitatifs (tranche 5B). Création de table uniquement ; les prix existants restent des prix de base sans palier. | [AddPriceListItemTiers_Tenant.idempotent.sql](runbooks/sql/AddPriceListItemTiers_Tenant.idempotent.sql) |
| `20260730180000_AddGlobalDiscount_Tenant` | Remise de pied (tranche 5B) : `GlobalDiscountPercent` / `GlobalDiscountAmount` sur `Invoices`, `Quotes`, `SalesOrders`, et `AllocatedGlobalDiscount` sur les trois tables de lignes. Montants à 0 par défaut ⇒ calcul inchangé sur l'existant. | [AddGlobalDiscount_Tenant.idempotent.sql](runbooks/sql/AddGlobalDiscount_Tenant.idempotent.sql) |
| `20260730200000_AddPromotionsAndPaymentTerms_Tenant` | Tables `Promotions` et `PaymentTermTemplates` (tranche 5C). Creation de tables uniquement ; le champ texte `PaymentTerms` des documents n'est pas touche. | [AddPromotionsAndPaymentTerms_Tenant.idempotent.sql](runbooks/sql/AddPromotionsAndPaymentTerms_Tenant.idempotent.sql) |
| `20260730220000_AddClientCreditTerms_Tenant` | `Clients.CreditLimit` et `Clients.DefaultPaymentTermDays` (lot 6). Deux colonnes nullables ; le plafond alimente une alerte et ne bloque rien. | [AddClientCreditTerms_Tenant.idempotent.sql](runbooks/sql/AddClientCreditTerms_Tenant.idempotent.sql) |
| `20260731180000_AddPricingAuditColumns_Tenant` | Colonnes d'audit manquantes (`CreatedBy` / `UpdatedBy` / `Version`) sur les tables pricing. Correctif du schéma livré par les migrations 5A–5C. | [AddPricingAuditColumns_Tenant.idempotent.sql](runbooks/sql/AddPricingAuditColumns_Tenant.idempotent.sql) |

Le régime de TVA du client est un attribut du **client**, non du taux de ligne (`VatRate`
inchangé). La validation de facture (`ValidateInvoiceCommand`) refuse désormais toute TVA pour un
client dont le régime la supprime (exonéré, suspension, export) et exige, pour une suspension, une
attestation en cours de validité **à la date d'émission** de la facture. Aucun client existant
n'est concerné : ils sont tous en régime `Normal` par défaut.

La tarification (tranche 5A) introduit un **point de résolution unique** — `IPriceResolver`
(`Infrastructure/Services/Pricing/PriceResolver.cs`) — qui répond au prix HT selon la priorité
**prix négocié client → grille affectée au client → prix catalogue**. Ces tables n'alimentent que
la résolution au moment de créer une ligne : le prix reste **figé** sur les documents émis, aucun
document existant ne change de prix quand une grille bouge. Les grilles et prix négociés bornés
dans le temps (validité, activation) ne sont consultés que s'ils sont applicables à la date du
document. Sans affectation ni prix négocié, le comportement est identique à aujourd'hui (catalogue).

**Remise de pied de document (tranche 5B) — décision de traitement fiscal.** La remise réduit la
base de TVA **et** le FODEC, parce qu'elle réduit le montant HT réellement facturé : le client ne
doit pas payer de TVA sur ce qu'il ne règle pas. Techniquement, elle est **répartie sur les lignes
au prorata de leur base HT** (`GlobalDiscountAllocator`), et non soustraite du total : chaque ligne
recalcule alors son FODEC et sa TVA sur sa base réduite, si bien que la ventilation par taux reste
juste même avec des taux mêlés (7 / 13 / 19 %), et que la comptabilité, le PDF et l'export fiscal
continuent de fonctionner sans modification. Le **timbre fiscal n'est pas touché** : c'est un droit
fixe, appliqué après la remise. La somme des parts imputées vaut exactement la remise annoncée, le
résidu d'arrondi étant donné à la ligne de plus forte base.

---

## Configuration

```json
"TenantMigrations": {
  "ApplyOnStartup": true,
  "ApplyOnlyToMissingMigrations": true
}
```

Quand `ApplyOnlyToMissingMigrations` est `true`, seuls les tenants avec **au moins une migration en attente** sont traités au démarrage (pas les tenants déjà à jour).

---

## Module Honoraires cabinet (01/08/2026)

Migration tenant **additive** `20260801120000_AddHonorairesModule_Tenant` : tables
`HonorairesInvoices` / `HonorairesInvoiceLines` / `HonorairesQuotes` /
`HonorairesQuoteLines` / `HonorairesPayments` / `HonorairesAttachments`.

Aucun schéma Sales (`Invoices`, `Quotes`, `Payments`) n’est modifié.

### Solution

Appliquer les migrations tenant via l’une des options de la section [Erreur HTTP 503](#erreur-http-503--tenant_migration_failed), ou le script :

[`docs/runbooks/sql/AddHonorairesModule_Tenant.idempotent.sql`](runbooks/sql/AddHonorairesModule_Tenant.idempotent.sql)

**Après déploiement :** les utilisateurs firm doivent se **reconnecter** pour recevoir le module JWT `Honoraires` et les permissions `honoraires.*`.

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddHonorairesModule%';

SELECT OBJECT_ID('HonorairesInvoices') AS Invoices,
       OBJECT_ID('HonorairesQuotes') AS Quotes,
       OBJECT_ID('HonorairesPayments') AS Payments,
       OBJECT_ID('HonorairesAttachments') AS Attachments;
```

---

## Trésorerie prévisionnelle par IA — `20260813190000_AddTreasuryCashForecast_Tenant`

Migration **strictement additive** : 7 nouvelles tables, aucune table ni colonne existante n'est
touchée. `Down()` complet (suppression des seuls objets créés, enfants avant parent).

| Table | Rôle |
|---|---|
| `CashFlowForecastRuns` | Une projection calculée (solde d'ouverture, agrégats, traçabilité IA) |
| `CashFlowForecastLines` | Flux attendus datés, rattachés à leur source métier |
| `CashFlowForecastBuckets` | Agrégats mensuels (graphique et tableau de détail) |
| `CashFlowScenarios` | Optimiste / réaliste / pessimiste, probabilités déterministe **et** affichée |
| `CashFlowForecastInsights` | Alertes, facteurs d'influence, recommandations |
| `RecurringCashCommitments` | Engagements récurrents saisis à la main (loyers, traites…) |
| `CashFlowForecastSettings` | Seuils de la jauge de position de trésorerie |

Les tables restent vides tant que `TreasuryForecast:Enabled` vaut `false` (défaut) : appliquer la
migration n'a donc aucun effet fonctionnel et peut se faire avant l'activation du module.

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/AddTreasuryCashForecast_Tenant.idempotent.sql`](runbooks/sql/AddTreasuryCashForecast_Tenant.idempotent.sql)

**Après déploiement :** les utilisateurs doivent se **reconnecter** pour recevoir les permissions
`treasury_forecast:view` / `treasury_forecast:manage` dans leur JWT, sans quoi l'entrée de menu
reste masquée (le front est fail-closed).

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddTreasuryCashForecast%';

SELECT OBJECT_ID('CashFlowForecastRuns')     AS Runs,
       OBJECT_ID('CashFlowForecastLines')    AS Lines,
       OBJECT_ID('CashFlowForecastBuckets')  AS Buckets,
       OBJECT_ID('CashFlowScenarios')        AS Scenarios,
       OBJECT_ID('CashFlowForecastInsights') AS Insights,
       OBJECT_ID('RecurringCashCommitments') AS Commitments,
       OBJECT_ID('CashFlowForecastSettings') AS Settings;
```

> ⚠️ **Le snapshot EF du contexte tenant est désynchronisé de l'historique des migrations.**
> Toutes les migrations tenant depuis le 2026-08-01 sont écrites à la main (attributs `[DbContext]`
> + `[Migration]`, pas de fichier `.Designer.cs`) sans régénérer
> `Migrations/Tenant/TenantDbContextModelSnapshot.cs`. Lancer `dotnet ef migrations add` sur ce
> contexte produit donc une migration qui tente de recréer l'arriéré des autres modules
> (paie, honoraires, contrôle comptable…) — **ne jamais livrer une telle migration**.
> Le snapshot comporte en outre un défaut d'ordre qui fait échouer sa propre lecture
> (`b.Navigation("Items")` de `Pricing.PriceList` et `b.Navigation("Tiers")` de
> `Pricing.PriceListItem` sont déclarés avant les relations qui créent ces navigations : les
> déplacer dans la section finale suffit à corriger). Remettre le snapshot en phase est un
> chantier à part entière, à traiter avant de vouloir régénérer une migration.

---

## Réviseur IA — `20260816120000_AddAccountingRevisionNote_Tenant`

Migration **strictement additive** du socle « contrôles continus / dossier de révision » :

| Objet | Rôle |
|---|---|
| `AccountingControlRuns.EvaluatedRuleCount` | Nombre de règles réellement évaluées par un contrôle. Devient le dénominateur du taux de conformité — sans lui, enrichir le catalogue de règles ferait bondir artificiellement le taux de tous les tenants et rendrait deux exercices incomparables. |
| `AccountingRevisionNotes` | Le dossier de révision rédigé d'un contrôle (synthèse, notes de travail par anomalie, action retenue, impact chiffré). Une note par contrôle : régénérer remplace. |

La colonne a un **défaut à 0** : les contrôles déjà en base conservent leur taux historique tel quel.
La table reste vide tant que la rédaction n'est pas activée — appliquer la migration n'a donc aucun
effet fonctionnel et peut se faire avant l'activation du module.

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/AddAccountingRevisionNote_Tenant.idempotent.sql`](runbooks/sql/AddAccountingRevisionNote_Tenant.idempotent.sql)

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddAccountingRevisionNote%';

SELECT COL_LENGTH('dbo.AccountingControlRuns', 'EvaluatedRuleCount') AS EvaluatedRuleCountColumn,
       OBJECT_ID('AccountingRevisionNotes')                          AS RevisionNotesTable;
```

> Le contrôle comptable planifié (`accounting-audit-schedules`, 7 h UTC) **exécute réellement le
> moteur** depuis cette livraison — il se contentait auparavant d'actualiser `LastRunAt`. Les
> planifications actives déjà enregistrées dans `AccountingControlSchedules` se déclencheront donc
> au premier passage. Le drapeau `Accounting:AccountingAuditSchedulingEnabled` reste l'interrupteur.

---

## Réapprovisionnement — unicité des « En attente » — `20260816150000_AddReplenishmentPendingUnique_Tenant`

Migration **additive** (fix C4 du module Prévisions IA) :

| Objet | Rôle |
|---|---|
| Déduplication | Pour chaque couple (ProductId, WarehouseId), seule la recommandation Pending la plus récente est conservée ; les doublons passent à `Superseded` (aucune suppression). |
| `UX_ReplenishmentRecommendations_Pending_ProductWarehouse` | Index unique filtré `WHERE Status = 1` — deux générations concurrentes ne peuvent plus insérer de doublon « En attente ». |

Complétée côté applicatif par un verrou par tenant dans `ReplenishmentService` et par la
conversion d'une violation d'unicité en HTTP 409 (« génération déjà en cours ») au lieu d'un 500.

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/AddReplenishmentPendingUnique_Tenant.idempotent.sql`](runbooks/sql/AddReplenishmentPendingUnique_Tenant.idempotent.sql)

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddReplenishmentPendingUnique%';

-- Ne doit retourner aucune ligne :
SELECT ProductId, WarehouseId, COUNT(*) AS PendingCount
FROM ReplenishmentRecommendations WHERE Status = 1
GROUP BY ProductId, WarehouseId HAVING COUNT(*) > 1;
```

> ⚠️ Le `Down()` supprime l'index mais ne restaure pas les lignes dédupliquées (volontaire).

---

## Bons de retour client — `20260816180000_AddSalesReturnNotes_Tenant`

Migration **additive** du document « Bon de retour » (pré-facture, préfixe BRT) :

| Objet | Rôle |
|---|---|
| `DeliveryNoteLines.ReturnedQuantity` | Quantité déjà retournée (défaut 0). La qté facturable devient `DeliveredQuantity - ReturnedQuantity`. |
| `SalesOrderLines.ReturnedQuantity` | Imputation commande : diminue « livré non facturé » sans rouvrir le reste à livrer. |
| `SalesReturnNotes` / `SalesReturnNoteLines` | Agrégat du bon de retour (brouillon puis confirmé). |

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/AddSalesReturnNotes_Tenant.idempotent.sql`](runbooks/sql/AddSalesReturnNotes_Tenant.idempotent.sql)

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddSalesReturnNotes%';

SELECT COL_LENGTH('dbo.DeliveryNoteLines', 'ReturnedQuantity') AS BlReturnedQty,
       COL_LENGTH('dbo.SalesOrderLines', 'ReturnedQuantity')   AS SoReturnedQty,
       OBJECT_ID('dbo.SalesReturnNotes')                       AS ReturnNotesTable,
       OBJECT_ID('dbo.SalesReturnNoteLines')                   AS ReturnNoteLinesTable;
```

---

## POS sessions caisse et clôture Z — `20260818180000_AddPosCashRegisterSessions_Tenant`

Migration **additive** (SQL idempotent, snapshot EF non régénéré) :

| Objet | Rôle |
|---|---|
| `CashRegisters` | Un registre par entrepôt (`WH-{code}`). |
| `CashRegisterSessions` | Vacation de caisse (une session **Open** par registre, index unique filtré). |
| `ZReports` | Snapshot JSON immuable de clôture Z (numérotation `NumberingDocumentType.ZReport = 17`). |
| `PosCartDrafts` / `PosHeldTickets` | Panier et tickets en attente persistés en base tenant. |
| `Invoices.CashRegisterSessionId`, `Payments.CashRegisterSessionId`, `CashExpenses.CashRegisterSessionId` | Tampon nullable, **sans FK** (index filtrés). |

Sans cette migration, les routes `/api/pos/cart`, `/session/open` et `/session/close` provoquent `TENANT_MIGRATION_FAILED` (503).

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddPosCashRegisterSessions%';

SELECT OBJECT_ID('dbo.CashRegisters') AS CashRegisters,
       OBJECT_ID('dbo.CashRegisterSessions') AS Sessions,
       OBJECT_ID('dbo.ZReports') AS ZReports,
       OBJECT_ID('dbo.PosCartDrafts') AS CartDrafts,
       OBJECT_ID('dbo.PosHeldTickets') AS HeldTickets,
       COL_LENGTH('dbo.Invoices', 'CashRegisterSessionId') AS InvoiceSessionCol;
```

---

## Stock P0 — lots, variantes, FIFO/LIFO — `20260821180000_AddStockTraceabilityAndVariants_Tenant`

Migration **additive** (SQL idempotent, snapshot EF non régénéré). Le grain `StockItems (ProductId, WarehouseId)` **n'est pas modifié**. Tous les drapeaux `Features:Stock` restent **false** par défaut.

| Objet | Rôle |
|---|---|
| `Products` colonnes parent/template, `TrackingMode`, `HasExpiryTracking`, `PickingPolicy`, `CostingMethod`, `ExpiryAlertDays` | Variantes SKU + axes traçabilité / valorisation |
| `ProductLots`, `StockLotBalances`, `ProductSerials` | Sous-soldes lots / séries |
| `StockValuationLayers` | Couches FIFO/LIFO |
| `StockDocumentAllocations` | Allocations documentaires (pas de colonnes lot sur les lignes) |
| `StockMovements` colonnes nullables lot / série / couche | Audit par allocation |
| `InventoryCountLines.ProductLotId` / `LotNumber` | Inventaire éclaté par lot |
| Tables attributs variantes | Matrice catalogue |

Script manuel : [AddStockTraceabilityAndVariants_Tenant.idempotent.sql](runbooks/sql/AddStockTraceabilityAndVariants_Tenant.idempotent.sql). Cutover : [stock-lots-cutover.md](runbooks/stock-lots-cutover.md).

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddStockTraceabilityAndVariants%';

SELECT COL_LENGTH('dbo.Products', 'TrackingMode') AS TrackingMode,
       OBJECT_ID('dbo.ProductLots') AS ProductLots,
       OBJECT_ID('dbo.StockLotBalances') AS LotBalances,
       OBJECT_ID('dbo.StockValuationLayers') AS Layers,
       COL_LENGTH('dbo.InventoryCountLines', 'ProductLotId') AS InvLotCol;
```

---

## Portail client (`20260824120000_AddClientPortal_Tenant`)

Ajoute `Companies.ClientPortalEnabled` (bit, défaut 1) et la table `ClientPortalContacts`. Les comptes portail sont dans la base master (`Users.PortalClientId`).

Scripts idempotents : [`AddClientPortal_Tenant.idempotent.sql`](runbooks/sql/AddClientPortal_Tenant.idempotent.sql), [`AddClientPortal_Master.idempotent.sql`](runbooks/sql/AddClientPortal_Master.idempotent.sql).

```sql
SELECT COL_LENGTH('dbo.Companies', 'ClientPortalEnabled');
SELECT OBJECT_ID('dbo.ClientPortalContacts');
```

---

## Erreur « Invalid column name 'EmployeeAuxiliaryEnabled' » à la validation d'un cycle de paie

Si **Valider** sur un cycle de paie (`POST /api/payroll/runs/{id}/validate`) renvoie HTTP **500**, ou si
l'écran **Paramètres paie** et le **journal de paie** échouent, avec :

- **Message :** `Invalid column name 'EmployeeAuxiliaryEnabled'.`
- **Cause :** la table `PayrollAccountingSettings` existe **sans** sa colonne `EmployeeAuxiliaryEnabled`,
  alors que `20260901160000_AddPayrollAccountingSettings_Tenant` est **déjà inscrite** dans
  `__EFMigrationsHistory`. Cette migration a été appliquée sur une partie du parc dans un état antérieur
  à l'ajout de la colonne, puis complétée sur place ; EF ne rejoue jamais une migration inscrite.

Toute lecture du réglage échoue donc, et avec elle tout ce qui passe par
`IPayrollAccountingProfileResolver` : validation d'un cycle, décaissement de prêt salarié, reclassement
SCE, écran Paramètres paie, drapeaux paie, journal de paie.

**Aucune donnée n'est en jeu.** La validation s'exécute dans une transaction (`TenantUnitOfWork`) : le
cycle reste `Calculé`, sans état partiel. La table est un singleton par tenant, vide tant que le dossier
n'a pas été paramétré ; l'ajout de la colonne avec son défaut `1` ne déplace aucune imputation.

### Solution

Appliquer les migrations tenant via l'une des options de la section [Erreur HTTP 503](#erreur-http-503--tenant_migration_failed).
Le rattrapage est `20260902170000_FixPayrollAccountingSettingsEmployeeAuxiliary_Tenant` : `ALTER` gardé
par `OBJECT_ID` + `COL_LENGTH`, donc strictement sans effet sur une base saine. Son `Down()` est
volontairement vide — la colonne appartient à la migration d'origine, qui la supprime avec la table.

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/FixPayrollAccountingSettingsEmployeeAuxiliary_Tenant.idempotent.sql`](runbooks/sql/FixPayrollAccountingSettingsEmployeeAuxiliary_Tenant.idempotent.sql)

**Vérification SQL (une base) :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%FixPayrollAccountingSettingsEmployeeAuxiliary%';

SELECT COL_LENGTH('dbo.PayrollAccountingSettings', 'EmployeeAuxiliaryEnabled') AS ColumnExists;
```

**Balayage du parc (lecture seule)** — repère les bases où la migration est appliquée mais la colonne
absente ; ne doit renvoyer aucune ligne après correction :

```sql
DECLARE @db sysname, @sql nvarchar(max);
CREATE TABLE #drift (DbName sysname);
DECLARE c CURSOR FAST_FORWARD FOR
    SELECT name FROM sys.databases WHERE name LIKE 'FactuTrust_Tenant_%' AND state = 0;
OPEN c; FETCH NEXT FROM c INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'USE ' + QUOTENAME(@db) + N';
        IF COL_LENGTH(''dbo.PayrollAccountingSettings'', ''EmployeeAuxiliaryEnabled'') IS NULL
           AND EXISTS (SELECT 1 FROM __EFMigrationsHistory
                       WHERE MigrationId = N''20260901160000_AddPayrollAccountingSettings_Tenant'')
            INSERT INTO #drift VALUES (''' + @db + N''');';
    BEGIN TRY EXEC sp_executesql @sql; END TRY BEGIN CATCH END CATCH
    FETCH NEXT FROM c INTO @db;
END
CLOSE c; DEALLOCATE c;
SELECT * FROM #drift ORDER BY DbName;
DROP TABLE #drift;
```

> ⚠️ **Ne jamais modifier une migration déjà livrée.** C'est l'origine exacte de cette panne : le
> correctif n'atteint que les bases où la migration n'avait pas encore tourné, et la divergence devient
> permanente sur les autres. Toute correction passe par une **nouvelle** migration additive et gardée.
>
> Le provisionnement par défaut aggrave la propagation : `TenantProvisioning:Strategy` vaut
> `TemplateClone`, et `TenantTemplateFreshness.CanRestoreWithoutRebuild` juge la base modèle réutilisable
> dès qu'aucune migration n'est en attente — jamais sur l'état réel de son schéma. Un modèle dérivé
> serait donc cloné tel quel vers **chaque nouveau dossier**. Publier une nouvelle migration est ce qui
> le rend obsolète et force sa reconstruction ; un script SQL appliqué aux seules bases existantes ne
> l'aurait pas fait.
>
> Depuis cette livraison, une erreur SQL 207/208 sur un chemin de **lecture** ne ressort plus en 500
> `INTERNAL_ERROR` : `ExceptionHandlingMiddleware` renvoie 503 avec le code `TENANT_MIGRATION_FAILED`,
> déjà interprété par le client (bannière « mise à jour de la base de données »).

## Élargir une colonne portée par un index FILTRÉ — `20260918120000_WidenProductBarcode_Tenant`

Migration d'élargissement de `Products.Barcode` (`nvarchar(13)` → `nvarchar(48)`) pour accueillir
UPC-A, GTIN-14 et Code 128.

### Le piège

`IX_Products_Barcode` porte le prédicat `WHERE [Barcode] IS NOT NULL`. **La colonne est donc
référencée par la définition de l'index**, ce qui crée une dépendance de schéma : un
`ALTER TABLE … ALTER COLUMN` direct échoue (erreur SQL 5074, « The index is dependent on
column »).

C'est contre-intuitif, parce qu'élargir un `nvarchar` qui n'est *que* clé d'index est
normalement toléré. C'est la présence de la colonne **dans le filtre** qui change tout.

Une migration qui se contenterait de l'`ALTER` échouerait au démarrage, donc **bloquerait le
tenant** (503 `TENANT_MIGRATION_FAILED`). Le défaut ne se voit ni à la relecture du diff ni sur
une base de développement encore vide d'index.

### La forme correcte

Trois instructions, gardées **indépendamment** :

1. `DROP INDEX` puis `ALTER COLUMN`, sous une garde sur la largeur actuelle
   (`sys.columns … AND [max_length] < 96` pour `nvarchar(48)`) — le rejeu est ainsi inerte ;
2. `CREATE INDEX` sous sa propre garde `NOT EXISTS sys.indexes` — cela rattrape un `Up`
   interrompu entre la suppression et la recréation, cas qui laisserait sinon la table sans son
   index ;
3. un `Down` qui **refuse de rétrécir** si une valeur dépasse déjà la largeur d'origine
   (`IF NOT EXISTS (SELECT 1 … WHERE LEN([Barcode]) > 13)`). Un retour arrière ne doit jamais
   tronquer : mieux vaut laisser la colonne large, ce qui est sans conséquence fonctionnelle.

`WidenProductBarcodeMigrationTests` vérifie sur le **texte source** que le `DROP INDEX` précède
l'`ALTER COLUMN`, qu'aucun `CREATE UNIQUE INDEX` ne s'est glissé dans la migration, et que le
`Down` porte bien sa garde de non-troncature.

### Ordre de déploiement

La migration doit être appliquée **avant** le déploiement du binaire. L'inverse expose à une
troncature SQL silencieuse sur tout tenant non encore migré dès qu'un code de plus de 13
caractères est enregistré. Le sens retenu est sans risque : élargir un `nvarchar` est une
opération de métadonnées seules, et une instance non encore déployée continue d'écrire des
valeurs courtes dans une colonne large.

Rampe complète : `docs/runbooks/barcode-cutover.md`.

---

## Erreur « Invalid column name 'FiscalId' » sur le plan comptable / l'import de factures

Si l'écran plan comptable (création/édition d'un compte auxiliaire) ou l'import de factures par IA affiche une erreur HTTP **500** sur `POST /api/accounting/chart-of-accounts`, `PUT /api/accounting/chart-of-accounts/{id}` ou lors de la proposition d'écriture à l'import :

- **Message :** `Invalid column name 'FiscalId'.` (ou `'FiscalIdNormalized'`).
- **Cause :** la migration tenant `20261018100000_AddChartOfAccountFiscalId_Tenant` n'a pas été appliquée sur la base du tenant alors que le code backend interroge déjà ces colonnes sur `ChartOfAccounts` (matricule fiscal des comptes auxiliaires Client/Fournisseur, plan « Matricule fiscal sur les comptes auxiliaires et rattachement à l'import de facture »).

### Solution

Appliquer les migrations tenant via l'une des options de la section [Erreur HTTP 503](#erreur-http-503--tenant_migration_failed).

**Script idempotent (production / DBA) :** [`docs/runbooks/sql/AddChartOfAccountFiscalId_Tenant.idempotent.sql`](runbooks/sql/AddChartOfAccountFiscalId_Tenant.idempotent.sql)

**Vérification SQL :**

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId LIKE '%AddChartOfAccountFiscalId%';

SELECT COL_LENGTH('dbo.ChartOfAccounts', 'FiscalId') AS FiscalIdColumnExists,
       COL_LENGTH('dbo.ChartOfAccounts', 'FiscalIdNormalized') AS FiscalIdNormalizedColumnExists;

SELECT name FROM sys.indexes
WHERE name = 'IX_ChartOfAccounts_AccountType_FiscalIdNormalized'
  AND object_id = OBJECT_ID('dbo.ChartOfAccounts');
```

Si l'index n'existe pas alors que les deux colonnes sont présentes, rejouer le script : il n'est intentionnellement pas posé en cas de doublon préexistant de matricule fiscal sur des comptes auxiliaires du même type (le script l'annonce par un `PRINT`).

---

## En résumé

- En **développement**, corriger l'erreur de migration puis redémarrer l'API.
- En **production**, utiliser le backoffice plateforme ou un script de déploiement qui applique les migrations tenant avant le trafic utilisateur.
- Une migration **additive et idempotente** (par exemple l'index `IX_AuditLogs_EntityHistory` de 4.7h2) peut être jouée par son jumeau SQL `docs/runbooks/sql/*.idempotent.sql` sur les bases existantes, puis reprise sans erreur par `dotnet ef database update`.
