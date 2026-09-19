-- Codes-barres, lot 1 — elargissement de Products.Barcode : nvarchar(13) -> nvarchar(48).
--
-- A executer sur CHAQUE base tenant si la migration EF ne peut pas etre appliquee par l'API.
-- Idempotent : rejouable sans effet de bord.
--
-- Contexte : la colonne n'acceptait que de l'EAN-8 / EAN-13. Le catalogue doit aussi pouvoir
-- porter un UPC-A (12 chiffres), un GTIN-14 de colis et un Code128 alphanumerique. 48
-- caracteres laissent de la marge tout en gardant la cle d'index a 96 octets.
--
-- ATTENTION : l'index filtre IX_Products_Barcode porte le predicat [Barcode] IS NOT NULL.
-- La colonne est donc referencee par la definition de l'index, ce qui fait echouer
-- ALTER COLUMN (erreur 5074). Il faut supprimer l'index, elargir, puis le recreer.
-- Un script qui se contenterait de l'ALTER bloquerait le tenant au demarrage.
--
-- ATTENTION : l'index reste volontairement NON UNIQUE.
-- L'unicite par tenant ne sera livree qu'APRES un balayage des doublons sur tout le parc :
-- voir docs/runbooks/invoice-number-uniqueness.md et docs/runbooks/barcode-cutover.md.

BEGIN TRANSACTION;
GO

-- nvarchar(48) => max_length = 96 octets.
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE [object_id] = OBJECT_ID(N'dbo.Products')
      AND [name] = N'Barcode'
      AND [max_length] < 96
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE [name] = N'IX_Products_Barcode' AND [object_id] = OBJECT_ID(N'dbo.Products')
    )
        DROP INDEX [IX_Products_Barcode] ON [dbo].[Products];

    ALTER TABLE [dbo].[Products] ALTER COLUMN [Barcode] nvarchar(48) NULL;
END;
GO

-- Garde independante : rattrape un script interrompu entre le DROP et le CREATE.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE [name] = N'IX_Products_Barcode' AND [object_id] = OBJECT_ID(N'dbo.Products')
)
BEGIN
    CREATE INDEX [IX_Products_Barcode]
        ON [dbo].[Products] ([Barcode])
        WHERE [Barcode] IS NOT NULL;
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260918120000_WidenProductBarcode_Tenant'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260918120000_WidenProductBarcode_Tenant', N'8.0.1');
END;
GO

COMMIT;
GO

-- Verification post-execution (doit renvoyer 96) :
-- SELECT COL_LENGTH('Products', 'Barcode');
--
-- La colonne ne doit avoir perdu aucune valeur :
-- SELECT COUNT(*) FROM [Products] WHERE [Barcode] IS NOT NULL;
--
-- L'index doit exister, non unique, avec son filtre :
-- SELECT [name], [is_unique], [has_filter], [filter_definition]
-- FROM sys.indexes
-- WHERE [object_id] = OBJECT_ID(N'dbo.Products') AND [name] = N'IX_Products_Barcode';

-- Balayages prealables a une eventuelle contrainte d'unicite (a executer sur CHAQUE tenant) :
-- SELECT [Barcode], COUNT(*) AS n
-- FROM [Products]
-- WHERE [Barcode] IS NOT NULL
-- GROUP BY [Barcode]
-- HAVING COUNT(*) > 1;
-- Un resultat vide sur TOUS les tenants est la condition prealable a l'index UNIQUE.
--
-- SELECT MAX(LEN([Barcode])) AS plus_long FROM [Products];
-- Doit rester <= 48 ; au-dela, la valeur a ete saisie hors application.
