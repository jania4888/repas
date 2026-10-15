# Runbook — Cutover Stock P0 (lots, variantes, FIFO/LIFO)

> **Objectif** : activer lots / variantes / FEFO / FIFO sur **un tenant pilote** (agro, pharma ou retail) sans casser le CMUP ni le grain `StockItem (Produit × Entrepôt)` des autres tenants.

> **Stratégie** : schéma **additif** déjà déployé, drapeaux `Features:Stock` **tous false** par défaut. Activation **un drapeau à la fois**. Rollback = remettre le drapeau à `false` (les tables restent).

Voir aussi : [`docs/utilisateur/06-stock.md`](../utilisateur/06-stock.md), [`docs/backend-tenant-migrations.md`](../backend-tenant-migrations.md).

---

## 0. TL;DR

| Étape | Action | Réversible ? |
|---|---|---|
| 1 | Déployer le code. Flags = `false`. Recette flag-off (écrans identiques). | ✅ |
| 2 | Appliquer `20260821180000_AddStockTraceabilityAndVariants_Tenant` | Additive only |
| 3 | Pilote : `ProductVariantsEnabled` | ✅ Flag |
| 4 | Pilote : `LotTrackingEnabled` (+ optionnel `ExpiryTrackingEnabled`) | ✅ Flag |
| 5 | Produits pilotes : `PickingPolicy = Fefo` | ✅ Par produit |
| 6 | Optionnel : `FifoLifoValuationEnabled` + couche d'ouverture — voir [`stock-valuation-truth.md`](stock-valuation-truth.md) pour le diagnostic de dérive et la réparation du cache | ✅ Flag ; couche irréversible tant que stock > 0 |
| 7 | Contrôle invariant lots = on-hand | — |

Ne **jamais** activer Lot sur un produit dont `QuantityOnHand > 0` sans inventaire d'ouverture (refus métier). Ne **jamais** passer Average → FIFO sans couche d'ouverture (refus métier).

---

## 1. Pré-requis

- [ ] Build API + tests stock / caractérisation verts.
- [ ] `appsettings.json` contient :

```json
"Features": {
  "Stock": {
    "LotTrackingEnabled": false,
    "SerialTrackingEnabled": false,
    "ExpiryTrackingEnabled": false,
    "ProductVariantsEnabled": false,
    "FifoLifoValuationEnabled": false,
    "BlockExpiredLotsOnExit": true,
    "StrictTrackedAllocation": true
  }
}
```

- [ ] Feature catalogue `stock_lots` disponible (permissions `Permissions.Stock.*`).
- [ ] Un tenant pilote identifié, hors période d'inventaire annuel.

---

## 2. Migration

Préférer l'API (`TenantMigrations.ApplyOnStartup` ou backoffice plateforme). Sinon, script idempotent :

[`sql/AddStockTraceabilityAndVariants_Tenant.idempotent.sql`](sql/AddStockTraceabilityAndVariants_Tenant.idempotent.sql)

Vérification :

```sql
SELECT MigrationId FROM __EFMigrationsHistory
WHERE MigrationId = N'20260821180000_AddStockTraceabilityAndVariants_Tenant';

SELECT COL_LENGTH('dbo.Products', 'TrackingMode'),
       OBJECT_ID('dbo.ProductLots'),
       OBJECT_ID('dbo.StockLotBalances'),
       OBJECT_ID('dbo.StockValuationLayers');
```

---

## 3. Ordre d'activation (pilote)

### 3.1 Variantes (`ProductVariantsEnabled`)

1. Activer le flag pour le tenant (config overlay / secret).
2. Créer un modèle + attributs + générer les SKU.
3. Vérifier : le modèle n'apparaît pas dans les selects, le POS, les lignes.
4. Vendre / réceptionner uniquement les **enfants**.

Rollback : flag `false` — les SKU enfants restent des produits normaux.

### 3.2 Lots (`LotTrackingEnabled`)

1. Choisir des produits **à stock zéro** (ou régulariser par inventaire / lot `OUVERTURE` explicite).
2. Activer le flag.
3. Sur la fiche : `TrackingMode = Lot`, optionnellement `HasExpiryTracking`.
4. Réceptionner un BR avec 2 lots et DLUO différentes.
5. Vérifier drill-down lots sur la fiche stock.

Activation `ExpiryTrackingEnabled` : bandeau DLUO + `GET /api/stock/expiry-alerts`.

### 3.3 FEFO (`PickingPolicy = Fefo` sur les produits suivis)

1. Livrer / facturer sans saisie manuelle de lot : le lot qui expire en premier doit sortir.
2. Vérifier PDF BL / facture (libellé lot).
3. Avoir : le même lot doit être réintégré (pas un nouveau FEFO).

`BlockExpiredLotsOnExit = true` (défaut) : un lot périmé ne sort pas.

### 3.4 FIFO (`FifoLifoValuationEnabled`)

1. Produit encore en CMUP, stock > 0 : **couche d'ouverture** (`POST /api/products/{id}/opening-valuation-layer`) puis `CostingMethod = Fifo`.
2. Recette : 2 entrées 10@2 puis 10@4, sortie 12 → coût 28 (FIFO) ; CMUP des autres produits inchangé.
3. LIFO : disponible, **avertissement comptable** (souvent non retenu TN / IFRS). Ne pas l'imposer au parc.

---

## 4. Invariant de recette (obligatoire après chaque flux pilote)

Aucun `StockItem` d'article suivi (`TrackingMode <> 0`) ne doit diverger des soldes lots :

```sql
SELECT si.Id,
       p.Code,
       si.QuantityOnHand,
       ISNULL(SUM(b.QuantityOnHand), 0) AS LotSum
FROM dbo.StockItems si
INNER JOIN dbo.Products p ON p.Id = si.ProductId
LEFT JOIN dbo.StockLotBalances b ON b.StockItemId = si.Id
WHERE p.TrackingMode <> 0
GROUP BY si.Id, p.Code, si.QuantityOnHand
HAVING ABS(si.QuantityOnHand - ISNULL(SUM(b.QuantityOnHand), 0)) > 0.0001;
```

Résultat vide = OK.

Invariant couches FIFO/LIFO (après activation du flag et pour les articles `CostingMethod` FIFO/LIFO) :

```sql
SELECT si.Id,
       p.Code,
       si.QuantityOnHand,
       ISNULL(SUM(l.RemainingQuantity), 0) AS LayerSum
FROM dbo.StockItems si
INNER JOIN dbo.Products p ON p.Id = si.ProductId
LEFT JOIN dbo.StockValuationLayers l ON l.StockItemId = si.Id
WHERE p.CostingMethod IN (1, 2) -- Fifo, Lifo
GROUP BY si.Id, p.Code, si.QuantityOnHand
HAVING ABS(si.QuantityOnHand - ISNULL(SUM(l.RemainingQuantity), 0)) > 0.0001;
```

Résultat vide = OK.

### Transfert, avoir, facture mixte

- Transfert : les couches destination doivent reprendre qty / coût / `ReceivedAt` / lot de la source. Pas d'entrée destination au CMUP source.
- Avoir / annulation / BR retour : restauration via `ValuationLayerId` (même entrepôt). `ReceivedAt` d'origine conservé.
- Facture mixte FIFO + CMUP : si une ligne est suivie (lot/série/FIFO), toutes les lignes stock sont déduites dans la commande ; l'événement ne doit pas rejouer.
- Concurrence : SQL Server `UPDLOCK` sur l'article. InMemory ne la simule pas ; recette SQL = deux sorties 6+6 sur 10, une doit échouer.

Scénario bout-en-bout attendu : variante SKU → BR 2 lots DLUO différentes → BL FEFO → avoir restitue le lot sorti → valeur FIFO si activée. Transfert miroir des couches. Facture mixte. Inventaire +/- sans casser les lots.

---

## 5. Interdits opérationnels

- Activer Lot / Série si `OnHand > 0` sans régularisation (l'API refuse).
- Ajustement global / comptage rapide sur article suivi (l'API refuse ; inventaire **par lot**).
- Double déduction facture issue de BL (inchangé : skip `SourceDeliveryNoteId`).
- Fusionner les références BC et BR (idempotence inchangée).

---

## 6. Rollback

1. Remettre les flags `Features:Stock:*Enabled` à `false` pour le tenant.
2. Les documents déjà validés **avec lots** restent historisés ; les nouveaux documents redeviennent CMUP / sans allocation.
3. Ne pas dropper les tables.

---

## 7. Checklist post-activation (J+1 / J+7)

- J+1 : invariant SQL, 1 BR + 1 BL FEFO, 1 avoir, bandeau DLUO.
- J+7 : décider d'étendre à d'autres familles / tenants. FIFO seulement si le pilote l'exige.
