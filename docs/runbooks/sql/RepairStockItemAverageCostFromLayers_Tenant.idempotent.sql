-- Recale le cache StockItems.AverageCost sur la valeur des couches (idempotent).
--
-- Contexte
--   Pour un article FIFO/LIFO, StockItems.AverageCost n'est qu'un CACHE d'affichage : il est
--   rafraîchi quand une mutation emprunte le chemin « tracé », puis arrondi à 4 décimales. Il peut
--   donc s'écarter de la somme des couches, et cet écart se propageait aux nouvelles couches tant
--   que les écritures lisaient ce cache comme source de coût.
--
--   Depuis la refonte, les lectures et les écritures partent des couches. Ce script sert à remettre
--   le cache en accord avec elles, pour que les deux disent la même chose.
--
-- Ce que le script NE FAIT PAS
--   Il n'invente AUCUNE couche. Les articles FIFO/LIFO sans aucune couche ouverte sont seulement
--   LISTÉS (section 2) : créer une couche d'ouverture est une décision métier, qui passe par le
--   bouton « Créer la couche d'ouverture FIFO/LIFO » de la fiche article.
--   Il ne touche à aucun mouvement, à aucune couche, à aucune écriture comptable.
--
-- Valeurs d'énumération
--   CostingMethod : 0 = Average (CMUP), 1 = Fifo, 2 = Lifo
--
-- Mode opératoire
--   1. Exécuter d'abord ScanStockValuationDrift_Tenant.readonly.sql et conserver sa sortie.
--   2. SAUVEGARDER LA BASE. Le rapport de la section 1 ci-dessous matérialise l'ancienne valeur de
--      chaque ligne touchée : c'est la SEULE trace permettant un retour arrière. La conserver.
--   3. Exécuter ce script, RELIRE les rapports, puis seulement COMMIT.
--   4. Relancer le scan et comparer sa section 6 à la photo « avant ».
--
--   À exécuter sur CHAQUE base tenant :
--     sqlcmd -S <serveur> -d <base> -I -i RepairStockItemAverageCostFromLayers_Tenant.idempotent.sql
--   L'option -I (QUOTED_IDENTIFIER ON) est obligatoire, sinon Msg 1934.
--
-- Idempotence
--   La clause WHERE ne retient que les lignes dont l'écart dépasse la demi-unité du dernier chiffre
--   stocké (0,00005 sur decimal(18,4)). Une deuxième exécution met donc 0 ligne à jour.

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;
GO

-- ── 1. RAPPORT : les lignes qui vont changer, avec leur ANCIENNE valeur ────────────────────────
--    C'est la sauvegarde logique du retour arrière. Ne pas la perdre.
SELECT
    StockItemId        = s.[Id],
    ProduitCode        = p.[Code],
    ProduitNom         = p.[Name],
    Methode            = CASE p.[CostingMethod] WHEN 1 THEN 'FIFO' WHEN 2 THEN 'LIFO' ELSE 'AUTRE' END,
    EntrepotNom        = w.[Name],
    s.[QuantityOnHand],
    AncienAverageCost  = s.[AverageCost],
    AncienneValeur     = s.[QuantityOnHand] * s.[AverageCost],
    CouchesValeur      = l.[Valeur],
    NouveauAverageCost = CASE WHEN s.[QuantityOnHand] > 0 THEN l.[Valeur] / s.[QuantityOnHand] ELSE 0 END,
    Ecart              = l.[Valeur] - (s.[QuantityOnHand] * s.[AverageCost])
FROM [dbo].[StockItems] s
INNER JOIN [dbo].[Products]   p ON p.[Id] = s.[ProductId]
INNER JOIN [dbo].[Warehouses] w ON w.[Id] = s.[WarehouseId]
CROSS APPLY (
    SELECT NbCouches = COUNT(1),
           Valeur    = ISNULL(SUM(v.[RemainingQuantity] * v.[UnitCost]), 0)
    FROM [dbo].[StockValuationLayers] v
    WHERE v.[StockItemId] = s.[Id] AND v.[RemainingQuantity] > 0
) l
WHERE p.[CostingMethod] IN (1, 2)
  AND l.[NbCouches] > 0
  AND ABS(s.[AverageCost]
          - CASE WHEN s.[QuantityOnHand] > 0 THEN l.[Valeur] / s.[QuantityOnHand] ELSE 0 END) > 0.00005
ORDER BY ABS(l.[Valeur] - (s.[QuantityOnHand] * s.[AverageCost])) DESC;
GO

-- ── 2. NON RÉPARABLES : articles FIFO/LIFO sans aucune couche ouverte ─────────────────────────
--    Volontairement laissés tels quels. L'écran retombe sur le cache (repli assumé), mais leur
--    prochaine sortie échouera. À traiter article par article depuis la fiche produit.
SELECT
    Anomalie    = 'FIFO/LIFO sans couche - NON repare',
    ProduitCode = p.[Code],
    ProduitNom  = p.[Name],
    Methode     = CASE p.[CostingMethod] WHEN 1 THEN 'FIFO' WHEN 2 THEN 'LIFO' ELSE 'AUTRE' END,
    EntrepotNom = w.[Name],
    s.[QuantityOnHand],
    s.[AverageCost]
FROM [dbo].[StockItems] s
INNER JOIN [dbo].[Products]   p ON p.[Id] = s.[ProductId]
INNER JOIN [dbo].[Warehouses] w ON w.[Id] = s.[WarehouseId]
WHERE p.[CostingMethod] IN (1, 2)
  AND s.[QuantityOnHand] > 0
  AND NOT EXISTS (
      SELECT 1 FROM [dbo].[StockValuationLayers] v
      WHERE v.[StockItemId] = s.[Id] AND v.[RemainingQuantity] > 0)
ORDER BY p.[Code];
GO

-- ── 3. NON RÉPARABLES : dérive de QUANTITÉ ────────────────────────────────────────────────────
--    Les couches ne totalisent pas le stock physique. Recaler le coût ici masquerait un problème
--    plus grave sans le résoudre : ces lignes exigent un inventaire, pas un UPDATE.
SELECT
    Anomalie      = 'Derive quantite - NON repare',
    ProduitCode   = p.[Code],
    ProduitNom    = p.[Name],
    EntrepotNom   = w.[Name],
    s.[QuantityOnHand],
    CouchesQuantite = l.[Quantite],
    EcartQuantite   = l.[Quantite] - s.[QuantityOnHand]
FROM [dbo].[StockItems] s
INNER JOIN [dbo].[Products]   p ON p.[Id] = s.[ProductId]
INNER JOIN [dbo].[Warehouses] w ON w.[Id] = s.[WarehouseId]
CROSS APPLY (
    SELECT NbCouches = COUNT(1),
           Quantite  = ISNULL(SUM(v.[RemainingQuantity]), 0)
    FROM [dbo].[StockValuationLayers] v
    WHERE v.[StockItemId] = s.[Id] AND v.[RemainingQuantity] > 0
) l
WHERE p.[CostingMethod] IN (1, 2)
  AND l.[NbCouches] > 0
  AND ABS(l.[Quantite] - s.[QuantityOnHand]) > 0.0001
ORDER BY ABS(l.[Quantite] - s.[QuantityOnHand]) DESC;
GO

-- ── 4. RÉPARATION ─────────────────────────────────────────────────────────────────────────────
--    Uniquement les articles FIFO/LIFO qui ONT des couches ET dont la quantité concorde.
--    UpdatedBy est estampillé pour que la trace reste lisible dans l'audit.
UPDATE s
SET s.[AverageCost] = CASE WHEN s.[QuantityOnHand] > 0 THEN l.[Valeur] / s.[QuantityOnHand] ELSE 0 END,
    s.[UpdatedAt]   = SYSUTCDATETIME(),
    s.[UpdatedBy]   = N'runbook:RepairStockItemAverageCostFromLayers'
FROM [dbo].[StockItems] s
INNER JOIN [dbo].[Products] p ON p.[Id] = s.[ProductId]
CROSS APPLY (
    SELECT NbCouches = COUNT(1),
           Quantite  = ISNULL(SUM(v.[RemainingQuantity]), 0),
           Valeur    = ISNULL(SUM(v.[RemainingQuantity] * v.[UnitCost]), 0)
    FROM [dbo].[StockValuationLayers] v
    WHERE v.[StockItemId] = s.[Id] AND v.[RemainingQuantity] > 0
) l
WHERE p.[CostingMethod] IN (1, 2)
  AND l.[NbCouches] > 0
  AND ABS(l.[Quantite] - s.[QuantityOnHand]) <= 0.0001
  AND ABS(s.[AverageCost]
          - CASE WHEN s.[QuantityOnHand] > 0 THEN l.[Valeur] / s.[QuantityOnHand] ELSE 0 END) > 0.00005;
GO

SELECT LignesReparees = @@ROWCOUNT;
GO

-- ── 5. CONTRÔLE : il ne doit plus rester d'écart réparable ────────────────────────────────────
--    0 ligne attendue. Toute ligne restante relève des sections 2 ou 3.
SELECT
    Controle    = 'Ecart residuel',
    ProduitCode = p.[Code],
    EntrepotNom = w.[Name],
    s.[AverageCost],
    Cible       = CASE WHEN s.[QuantityOnHand] > 0 THEN l.[Valeur] / s.[QuantityOnHand] ELSE 0 END
FROM [dbo].[StockItems] s
INNER JOIN [dbo].[Products]   p ON p.[Id] = s.[ProductId]
INNER JOIN [dbo].[Warehouses] w ON w.[Id] = s.[WarehouseId]
CROSS APPLY (
    SELECT NbCouches = COUNT(1),
           Quantite  = ISNULL(SUM(v.[RemainingQuantity]), 0),
           Valeur    = ISNULL(SUM(v.[RemainingQuantity] * v.[UnitCost]), 0)
    FROM [dbo].[StockValuationLayers] v
    WHERE v.[StockItemId] = s.[Id] AND v.[RemainingQuantity] > 0
) l
WHERE p.[CostingMethod] IN (1, 2)
  AND l.[NbCouches] > 0
  AND ABS(l.[Quantite] - s.[QuantityOnHand]) <= 0.0001
  AND ABS(s.[AverageCost]
          - CASE WHEN s.[QuantityOnHand] > 0 THEN l.[Valeur] / s.[QuantityOnHand] ELSE 0 END) > 0.00005;
GO

-- RELIRE LES RAPPORTS CI-DESSUS, PUIS :
--   COMMIT TRANSACTION;   -- si tout est conforme
--   ROLLBACK TRANSACTION; -- au moindre doute
PRINT N'Transaction ouverte. Relire les rapports, puis COMMIT ou ROLLBACK explicitement.';
GO
