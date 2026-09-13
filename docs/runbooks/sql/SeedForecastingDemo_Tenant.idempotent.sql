-- Jeu de données démo pour le module Prévisions IA (CA, réappro, ABC/XYZ, promotions).
-- Idempotent : ne s'exécute qu'une fois (marqueur Reference = DEMO-FORECAST-SEED).
-- Prérequis : au moins 1 client, 1 produit géré en stock, 1 entrepôt.
-- Après exécution : lancer « Recalculer » dans /forecasting ou POST /api/forecasting/recompute

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

IF EXISTS (SELECT 1 FROM Invoices WHERE Reference = N'DEMO-FORECAST-SEED')
BEGIN
    PRINT N'Jeu de données Prévisions IA déjà présent — rien à faire.';
    RETURN;
END;

DECLARE @ClientId uniqueidentifier = (SELECT TOP 1 Id FROM Clients WHERE IsActive = 1 ORDER BY CreatedAt);
DECLARE @WarehouseId uniqueidentifier = (SELECT TOP 1 Id FROM Warehouses ORDER BY CreatedAt);
DECLARE @SupplierId uniqueidentifier = (SELECT TOP 1 Id FROM Suppliers ORDER BY CreatedAt);
DECLARE @Product1 uniqueidentifier = (SELECT TOP 1 Id FROM Products WHERE IsStockManaged = 1 ORDER BY CreatedAt);
DECLARE @Product2 uniqueidentifier = (
    SELECT TOP 1 Id FROM Products
    WHERE IsStockManaged = 1 AND Id <> @Product1
    ORDER BY CreatedAt);

IF @ClientId IS NULL OR @WarehouseId IS NULL OR @Product1 IS NULL
BEGIN
    RAISERROR(N'Prérequis manquants : client, entrepôt ou produit géré en stock.', 16, 1);
    RETURN;
END;

DECLARE @P1Code nvarchar(50) = (SELECT Code FROM Products WHERE Id = @Product1);
DECLARE @P1Name nvarchar(200) = (SELECT Name FROM Products WHERE Id = @Product1);
DECLARE @P2Code nvarchar(50) = (SELECT Code FROM Products WHERE Id = @Product2);
DECLARE @P2Name nvarchar(200) = (SELECT Name FROM Products WHERE Id = @Product2);

-- Prix catalogue pour les lignes de facture
UPDATE Products
SET UnitPrice = CASE WHEN Id = @Product1 THEN 20.000 ELSE UnitPrice END,
    PreferredSupplierId = COALESCE(PreferredSupplierId, @SupplierId),
    LeadTimeDaysOverride = COALESCE(LeadTimeDaysOverride, 7),
    MinimumOrderQuantity = CASE WHEN MinimumOrderQuantity IS NULL OR MinimumOrderQuantity < 1 THEN 10 ELSE MinimumOrderQuantity END
WHERE Id IN (@Product1, @Product2);

IF @Product2 IS NOT NULL
    UPDATE Products SET UnitPrice = 35.000 WHERE Id = @Product2 AND (UnitPrice IS NULL OR UnitPrice = 0);

-- Stock bas pour déclencher des recommandations de réappro
UPDATE StockItems
SET QuantityOnHand = CASE WHEN ProductId = @Product1 THEN 3.0000 ELSE 8.0000 END,
    MinimumStock = 20.0000
WHERE WarehouseId = @WarehouseId AND ProductId IN (@Product1, ISNULL(@Product2, @Product1));

DECLARE @Months TABLE (
    MonthOffset int NOT NULL PRIMARY KEY,
    IssueDate date NOT NULL,
    SeasonMult decimal(6,3) NOT NULL
);

INSERT INTO @Months (MonthOffset, IssueDate, SeasonMult)
SELECT v.n,
       DATEADD(MONTH, v.n, CAST('2024-09-01' AS date)),
       CASE MONTH(DATEADD(MONTH, v.n, CAST('2024-09-01' AS date)))
            WHEN 1 THEN 0.85 WHEN 2 THEN 0.90 WHEN 3 THEN 1.00 WHEN 4 THEN 1.05
            WHEN 5 THEN 1.10 WHEN 6 THEN 1.25 WHEN 7 THEN 1.45 WHEN 8 THEN 1.35
            WHEN 9 THEN 1.15 WHEN 10 THEN 1.00 WHEN 11 THEN 1.20 ELSE 1.55 END
FROM (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14),(15),(16),(17),(18),(19),(20),(21),(22),(23)) v(n);

DECLARE @MonthOffset int, @IssueDate date, @SeasonMult decimal(6,3);
DECLARE @InvoiceId uniqueidentifier, @LineId uniqueidentifier;
DECLARE @Qty1 decimal(18,4), @Qty2 decimal(18,4);
DECLARE @UnitPrice1 decimal(18,3) = 20.000, @UnitPrice2 decimal(18,3) = 35.000;
DECLARE @SubTotal decimal(18,3), @Vat decimal(18,3), @Total decimal(18,3);
DECLARE @Seq int = 1;
DECLARE @Now datetime2 = SYSUTCDATETIME();

DECLARE month_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT MonthOffset, IssueDate, SeasonMult FROM @Months ORDER BY MonthOffset;
OPEN month_cursor;
FETCH NEXT FROM month_cursor INTO @MonthOffset, @IssueDate, @SeasonMult;

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @Qty1 = CAST(ROUND(60.0 * @SeasonMult + (@MonthOffset % 5), 0) AS decimal(18,4));
    SET @InvoiceId = NEWID();
    SET @SubTotal = @Qty1 * @UnitPrice1;
    SET @Vat = ROUND(@SubTotal * 0.19, 3);
    SET @Total = @SubTotal + @Vat;

    INSERT INTO Invoices (
        Id, Number, NumberPrefix, NumberYear, NumberSequence, IssueDate, DueDate, Status,
        ClientId, Reference, SubTotal, SubTotalCurrency, TotalVat, TotalVatCurrency,
        TotalAmount, TotalAmountCurrency, Type, FodecAmount, FodecAmountCurrency,
        FiscalStampAmount, FiscalStampCurrency, WarehouseId, CreatedAt, Version)
    VALUES (
        @InvoiceId,
        CONCAT(N'FCD-', YEAR(@IssueDate), N'-', RIGHT(CONCAT(N'000', @Seq), 3)),
        N'FCD', YEAR(@IssueDate), @Seq, @IssueDate, DATEADD(DAY, 30, @IssueDate), 1,
        @ClientId, N'DEMO-FORECAST-SEED', @SubTotal, N'TND', @Vat, N'TND',
        @Total, N'TND', 0, 0, N'TND', 0, N'TND', @WarehouseId, @Now, 1);

    SET @LineId = NEWID();
    INSERT INTO InvoiceLines (
        Id, InvoiceId, LineNumber, ProductId, ProductCode, ProductName, Quantity, Unit,
        UnitPrice, UnitPriceCurrency, VatRate, DiscountAmount, DiscountAmountCurrency,
        SubTotal, SubTotalCurrency, VatAmount, VatAmountCurrency, Total, TotalCurrency,
        FodecAmount, FodecAmountCurrency, IsFodecApplicable, AllocatedGlobalDiscount, AllocatedGlobalDiscountCurrency,
        CreatedAt)
    VALUES (
        @LineId, @InvoiceId, 1, @Product1, @P1Code, @P1Name, @Qty1, N'Unité',
        @UnitPrice1, N'TND', 19, 0, N'TND',
        @SubTotal, N'TND', @Vat, N'TND', @Total, N'TND',
        0, N'TND', 0, 0, N'TND', @Now);

    SET @Seq += 1;

    IF @Product2 IS NOT NULL
    BEGIN
        SET @Qty2 = CAST(ROUND(25.0 * @SeasonMult + (@MonthOffset % 3), 0) AS decimal(18,4));
        SET @InvoiceId = NEWID();
        SET @SubTotal = @Qty2 * @UnitPrice2;
        SET @Vat = ROUND(@SubTotal * 0.19, 3);
        SET @Total = @SubTotal + @Vat;

        INSERT INTO Invoices (
            Id, Number, NumberPrefix, NumberYear, NumberSequence, IssueDate, DueDate, Status,
            ClientId, Reference, SubTotal, SubTotalCurrency, TotalVat, TotalVatCurrency,
            TotalAmount, TotalAmountCurrency, Type, FodecAmount, FodecAmountCurrency,
            FiscalStampAmount, FiscalStampCurrency, WarehouseId, CreatedAt, Version)
        VALUES (
            @InvoiceId,
            CONCAT(N'FCD-', YEAR(@IssueDate), N'-', RIGHT(CONCAT(N'000', @Seq), 3)),
            N'FCD', YEAR(@IssueDate), @Seq, DATEADD(DAY, 7, @IssueDate), DATEADD(DAY, 37, @IssueDate), 1,
            @ClientId, N'DEMO-FORECAST-SEED', @SubTotal, N'TND', @Vat, N'TND',
            @Total, N'TND', 0, 0, N'TND', 0, N'TND', @WarehouseId, @Now, 1);

        SET @LineId = NEWID();
        INSERT INTO InvoiceLines (
            Id, InvoiceId, LineNumber, ProductId, ProductCode, ProductName, Quantity, Unit,
            UnitPrice, UnitPriceCurrency, VatRate, DiscountAmount, DiscountAmountCurrency,
            SubTotal, SubTotalCurrency, VatAmount, VatAmountCurrency, Total, TotalCurrency,
            FodecAmount, FodecAmountCurrency, IsFodecApplicable, AllocatedGlobalDiscount, AllocatedGlobalDiscountCurrency,
            CreatedAt)
        VALUES (
            @LineId, @InvoiceId, 1, @Product2, @P2Code, @P2Name, @Qty2, N'Unité',
            @UnitPrice2, N'TND', 19, 0, N'TND',
            @SubTotal, N'TND', @Vat, N'TND', @Total, N'TND',
            0, N'TND', 0, 0, N'TND', @Now);

        SET @Seq += 1;
    END;

    FETCH NEXT FROM month_cursor INTO @MonthOffset, @IssueDate, @SeasonMult;
END;

CLOSE month_cursor;
DEALLOCATE month_cursor;

-- Ventes hebdomadaires sur les 90 derniers jours (réapprovisionnement)
DECLARE @Week int = 0;
WHILE @Week < 12
BEGIN
    SET @IssueDate = DATEADD(DAY, -84 + (@Week * 7), CAST(GETUTCDATE() AS date));
    SET @Qty1 = 15 + (@Week % 4) * 3;
    SET @InvoiceId = NEWID();
    SET @SubTotal = @Qty1 * @UnitPrice1;
    SET @Vat = ROUND(@SubTotal * 0.19, 3);
    SET @Total = @SubTotal + @Vat;

    INSERT INTO Invoices (
        Id, Number, NumberPrefix, NumberYear, NumberSequence, IssueDate, DueDate, Status,
        ClientId, Reference, SubTotal, SubTotalCurrency, TotalVat, TotalVatCurrency,
        TotalAmount, TotalAmountCurrency, Type, FodecAmount, FodecAmountCurrency,
        FiscalStampAmount, FiscalStampCurrency, WarehouseId, CreatedAt, Version)
    VALUES (
        @InvoiceId,
        CONCAT(N'FCW-', YEAR(@IssueDate), N'-', RIGHT(CONCAT(N'000', @Seq), 3)),
        N'FCW', YEAR(@IssueDate), @Seq, @IssueDate, DATEADD(DAY, 30, @IssueDate), 1,
        @ClientId, N'DEMO-FORECAST-SEED', @SubTotal, N'TND', @Vat, N'TND',
        @Total, N'TND', 0, 0, N'TND', 0, N'TND', @WarehouseId, @Now, 1);

    SET @LineId = NEWID();
    INSERT INTO InvoiceLines (
        Id, InvoiceId, LineNumber, ProductId, ProductCode, ProductName, Quantity, Unit,
        UnitPrice, UnitPriceCurrency, VatRate, DiscountAmount, DiscountAmountCurrency,
        SubTotal, SubTotalCurrency, VatAmount, VatAmountCurrency, Total, TotalCurrency,
        FodecAmount, FodecAmountCurrency, IsFodecApplicable, AllocatedGlobalDiscount, AllocatedGlobalDiscountCurrency,
        CreatedAt)
    VALUES (
        @LineId, @InvoiceId, 1, @Product1, @P1Code, @P1Name, @Qty1, N'Unité',
        @UnitPrice1, N'TND', 19, 0, N'TND',
        @SubTotal, N'TND', @Vat, N'TND', @Total, N'TND',
        0, N'TND', 0, 0, N'TND', @Now);

    SET @Seq += 1;
    SET @Week += 1;
END;

PRINT CONCAT(N'OK — ', @Seq - 1, N' factures démo insérées (24 mois + ventes hebdo).');
PRINT N'→ Ouvrez /forecasting puis cliquez sur Recalculer (ou POST /api/forecasting/recompute).';
