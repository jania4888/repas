-- Jeu de données pour tester le réapprovisionnement multi-fournisseurs.
-- Crée 5 fournisseurs démo, 15 produits gérés en stock (DEMO-REPL-01 … 15),
-- et 15 recommandations « En attente » (3 lignes par fournisseur).
-- Idempotent : ré-exécutable après des tests BC (recrée 15 Pending sur les produits démo).
--
-- Prérequis : au moins 1 entrepôt et 1 catégorie produit active.
-- Usage : .\src\Backend\scripts\seed-replenishment-multi-supplier.ps1
-- Puis : /forecasting/replenishment → sélectionner les lignes → Créer les BC
--        (attendu : 5 brouillons BC, un par fournisseur).

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

DECLARE @WarehouseId uniqueidentifier = (SELECT TOP 1 Id FROM Warehouses ORDER BY CreatedAt);
DECLARE @CategoryId uniqueidentifier = (SELECT TOP 1 Id FROM ProductCategories WHERE IsActive = 1 ORDER BY DisplayOrder, CreatedAt);

IF @WarehouseId IS NULL OR @CategoryId IS NULL
BEGIN
    RAISERROR(N'Prérequis manquants : entrepôt ou catégorie produit active.', 16, 1);
    RETURN;
END;

DECLARE @Now datetime2 = SYSUTCDATETIME();
DECLARE @i int = 1;
DECLARE @SupplierIdx int;
DECLARE @SupplierId uniqueidentifier;
DECLARE @ProductId uniqueidentifier;
DECLARE @StockItemId uniqueidentifier;
DECLARE @RecoId uniqueidentifier;
DECLARE @Code nvarchar(50);
DECLARE @SupplierName nvarchar(200);
DECLARE @Nif nvarchar(20);

-- ── 5 fournisseurs démo ─────────────────────────────────────────────────────
WHILE @i <= 5
BEGIN
    SET @SupplierName = CONCAT(N'Démo réappro — Fournisseur ', @i);
    SET @Nif = CONCAT(N'9999000/A/B/C/00', RIGHT(CONCAT(N'0', @i), 2));

    SET @SupplierId = NULL;
    SELECT @SupplierId = Id FROM Suppliers WHERE Name = @SupplierName;

    IF @SupplierId IS NULL
    BEGIN
        SET @SupplierId = NEWID();
        INSERT INTO Suppliers (
            Id, Name, Type, IsActive, PaymentTermDays, Version, CreatedAt,
            Street, City, Governorate, Country, PostalCode,
            Email, NIF, Phone,
            IsResident, IsSubjectToWithholding)
        VALUES (
            @SupplierId, @SupplierName, 1, 1, 30, 1, @Now,
            N'10 rue démo réappro', N'Tunis', N'Tunis', N'Tunisie', N'1000',
            CONCAT(N'demo-repl-sup', @i, N'@example.local'), @Nif, N'71123456',
            1, 0);
    END;

    SET @i += 1;
END;

-- ── 15 produits + stock ───────────────────────────────────────────────────────
SET @i = 1;
WHILE @i <= 15
BEGIN
    SET @Code = CONCAT(N'DEMO-REPL-', RIGHT(CONCAT(N'00', @i), 2));
    SET @SupplierIdx = ((@i - 1) % 5) + 1;
    SET @SupplierName = CONCAT(N'Démo réappro — Fournisseur ', @SupplierIdx);

    SET @SupplierId = NULL;
    SELECT @SupplierId = Id FROM Suppliers WHERE Name = @SupplierName;

    SET @ProductId = NULL;
    SELECT @ProductId = Id FROM Products WHERE Code = @Code;

    IF @ProductId IS NULL
    BEGIN
        SET @ProductId = NEWID();
        INSERT INTO Products (
            Id, CategoryId, Code, Name, Description, Type,
            UnitPrice, Currency,
            PurchasePrice, PurchasePriceCurrency,
            VatRate, Unit, IsActive, IsStockManaged, IsFodecApplicable, IsDiscountEnabled,
            IsPubliclyListed, PreferredSupplierId, LeadTimeDaysOverride, MinimumOrderQuantity,
            Version, CreatedAt)
        VALUES (
            @ProductId, @CategoryId, @Code,
            CONCAT(N'Article démo réappro ', @i),
            N'Données de test — module Réapprovisionnement (multi-fournisseurs).',
            0,
            25.000, N'TND', 15.000, N'TND',
            19, N'Unité', 1, 1, 0, 0, 0,
            @SupplierId, 7, 10.000,
            1, @Now);
    END
    ELSE
    BEGIN
        UPDATE Products
        SET PreferredSupplierId = @SupplierId,
            IsStockManaged = 1,
            IsActive = 1,
            PurchasePrice = COALESCE(PurchasePrice, 15.000),
            PurchasePriceCurrency = COALESCE(PurchasePriceCurrency, N'TND'),
            LeadTimeDaysOverride = COALESCE(LeadTimeDaysOverride, 7),
            MinimumOrderQuantity = CASE WHEN MinimumOrderQuantity IS NULL OR MinimumOrderQuantity < 1 THEN 10.000 ELSE MinimumOrderQuantity END
        WHERE Id = @ProductId;
    END;

    IF NOT EXISTS (SELECT 1 FROM StockItems WHERE ProductId = @ProductId AND WarehouseId = @WarehouseId)
    BEGIN
        SET @StockItemId = NEWID();
        INSERT INTO StockItems (
            Id, ProductId, WarehouseId,
            QuantityOnHand, QuantityReserved, MinimumStock, MaximumStock,
            AverageCost, IsActive, Version, CreatedAt)
        VALUES (
            @StockItemId, @ProductId, @WarehouseId,
            2.0000, 0.0000, 25.0000, 120.0000,
            15.0000, 1, 1, @Now);
    END
    ELSE
    BEGIN
        UPDATE StockItems
        SET QuantityOnHand = 2.0000,
            MinimumStock = 25.0000,
            MaximumStock = 120.0000,
            IsActive = 1
        WHERE ProductId = @ProductId AND WarehouseId = @WarehouseId;
    END;

    SET @i += 1;
END;

-- ── Recommandations : superséder les Pending existantes sur ces produits ───────
UPDATE r
SET r.Status = 5, -- Superseded
    r.UpdatedAt = @Now
FROM ReplenishmentRecommendations r
INNER JOIN Products p ON p.Id = r.ProductId
WHERE p.Code LIKE N'DEMO-REPL-%'
  AND r.Status = 1; -- Pending

-- ── Insérer 15 recommandations « En attente » ─────────────────────────────────
SET @i = 1;
WHILE @i <= 15
BEGIN
    SET @Code = CONCAT(N'DEMO-REPL-', RIGHT(CONCAT(N'00', @i), 2));

    SET @ProductId = NULL;
    SELECT @ProductId = Id FROM Products WHERE Code = @Code;

    SET @SupplierIdx = ((@i - 1) % 5) + 1;
    SET @SupplierName = CONCAT(N'Démo réappro — Fournisseur ', @SupplierIdx);

    SET @SupplierId = NULL;
    SELECT @SupplierId = Id FROM Suppliers WHERE Name = @SupplierName;

    SET @RecoId = NEWID();
    INSERT INTO ReplenishmentRecommendations (
        Id, ProductId, WarehouseId, GeneratedAt,
        RecommendedQty, Rop, SafetyStock, LeadTimeDays, DailyDemand,
        ReasonCodesJson, Status,
        PreferredSupplierId, PreferredSupplierName,
        QuantityOnOrder, EffectiveQty, DaysOfStockRemaining,
        CreatedAt)
    VALUES (
        @RecoId, @ProductId, @WarehouseId, @Now,
        50.000, 30.000, 8.000, 7, 5.000,
        N'["BelowUserMinimumStock","AtOrBelowReorderPoint"]', 1,
        @SupplierId, @SupplierName,
        0.000, 2.000, 0.40,
        @Now);

    SET @i += 1;
END;

DECLARE @PendingCount int = (
    SELECT COUNT(*)
    FROM ReplenishmentRecommendations r
    INNER JOIN Products p ON p.Id = r.ProductId
    WHERE p.Code LIKE N'DEMO-REPL-%' AND r.Status = 1);

DECLARE @SupplierCount int = (
    SELECT COUNT(DISTINCT r.PreferredSupplierId)
    FROM ReplenishmentRecommendations r
    INNER JOIN Products p ON p.Id = r.ProductId
    WHERE p.Code LIKE N'DEMO-REPL-%' AND r.Status = 1);

PRINT CONCAT(N'OK — ', @PendingCount, N' recommandation(s) En attente sur les articles DEMO-REPL-* (', @SupplierCount, N' fournisseur(s)).');
PRINT N'→ /forecasting/replenishment : filtre « En attente », sélectionner tout, « Créer les BC » (5 brouillons attendus).';
