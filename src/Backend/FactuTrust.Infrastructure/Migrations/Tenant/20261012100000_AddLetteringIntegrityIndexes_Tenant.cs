using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations.Tenant
{
    /// <summary>
    /// Refonte de l'écran de lettrage « v2 » (plan de refonte, §6/§15, Annexe A §4.1) : cinq index
    /// pour l'intégrité et la performance du lettrage, sans toucher aux données.
    /// <list type="bullet">
    /// <item><c>IX_LetteringGroups_Code</c> UNIQUE — compteur partagé L/P garanti unique en base
    /// (D7/D8), défense ultime derrière la transaction Serializable de <c>LetteringService</c>.</item>
    /// <item><c>IX_LetteringGroupMembers_JournalEntryLineId</c> UNIQUE (remplace l'index non-unique
    /// posé par <c>AddAccountingModule_Tenant</c>) — une ligne d'écriture ne peut appartenir qu'à un
    /// seul groupe de lettrage à la fois.</item>
    /// <item><c>IX_JournalEntryLines_AccountNumber_LetteringCode</c> INCLUDE (<c>JournalEntryId</c>,
    /// <c>DebitAmount</c>, <c>CreditAmount</c>, <c>ThirdPartyId</c>, <c>ThirdPartyKind</c>) — remplace
    /// <c>IX_JournalEntryLines_AccountNumber</c> : requête principale de l'écran de lettrage,
    /// agrégats, contrôles de pré-clôture.</item>
    /// <item><c>IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId</c> filtré
    /// <c>WHERE [ThirdPartyId] IS NOT NULL</c> — filtre tiers de l'écran, lettrage auto des
    /// paiements.</item>
    /// <item><c>IX_JournalEntries_EntryDate</c> INCLUDE (<c>Status</c>, <c>JournalCode</c>,
    /// <c>EntryNumber</c>, <c>AccountingPeriodId</c>) — filtre de dates de l'écran, aujourd'hui
    /// absent.</item>
    /// </list>
    /// Additif pur (aucune donnée touchée), écrit à la main (pas de <c>dotnet ef migrations add</c> —
    /// la dérive préexistante du snapshot sur des entités sans rapport aurait tout mélangé), idempotent,
    /// jumeau SQL : <c>docs/runbooks/sql/AddLetteringIntegrityIndexes_Tenant.idempotent.sql</c>.
    /// </summary>
    [DbContext(typeof(TenantDbContext))]
    [Migration("20261012100000_AddLetteringIntegrityIndexes_Tenant")]
    public partial class AddLetteringIntegrityIndexes_Tenant : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LetteringGroups_Code' AND object_id = OBJECT_ID(N'[dbo].[LetteringGroups]'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [IX_LetteringGroups_Code]
        ON [dbo].[LetteringGroups] ([Code]);
END;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LetteringGroupMembers_JournalEntryLineId' AND object_id = OBJECT_ID(N'[dbo].[LetteringGroupMembers]') AND is_unique = 0)
BEGIN
    DROP INDEX [IX_LetteringGroupMembers_JournalEntryLineId] ON [dbo].[LetteringGroupMembers];
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LetteringGroupMembers_JournalEntryLineId' AND object_id = OBJECT_ID(N'[dbo].[LetteringGroupMembers]'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX [IX_LetteringGroupMembers_JournalEntryLineId]
        ON [dbo].[LetteringGroupMembers] ([JournalEntryLineId]);
END;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntryLines_AccountNumber' AND object_id = OBJECT_ID(N'[dbo].[JournalEntryLines]'))
BEGIN
    DROP INDEX [IX_JournalEntryLines_AccountNumber] ON [dbo].[JournalEntryLines];
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntryLines_AccountNumber_LetteringCode' AND object_id = OBJECT_ID(N'[dbo].[JournalEntryLines]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_JournalEntryLines_AccountNumber_LetteringCode]
        ON [dbo].[JournalEntryLines] ([AccountNumber], [LetteringCode])
        INCLUDE ([JournalEntryId], [DebitAmount], [CreditAmount], [ThirdPartyId], [ThirdPartyKind]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId' AND object_id = OBJECT_ID(N'[dbo].[JournalEntryLines]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId]
        ON [dbo].[JournalEntryLines] ([ThirdPartyKind], [ThirdPartyId])
        WHERE [ThirdPartyId] IS NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntries_EntryDate' AND object_id = OBJECT_ID(N'[dbo].[JournalEntries]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_JournalEntries_EntryDate]
        ON [dbo].[JournalEntries] ([EntryDate])
        INCLUDE ([Status], [JournalCode], [EntryNumber], [AccountingPeriodId]);
END;
""");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntries_EntryDate' AND object_id = OBJECT_ID(N'[dbo].[JournalEntries]'))
BEGIN
    DROP INDEX [IX_JournalEntries_EntryDate] ON [dbo].[JournalEntries];
END;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId' AND object_id = OBJECT_ID(N'[dbo].[JournalEntryLines]'))
BEGIN
    DROP INDEX [IX_JournalEntryLines_ThirdPartyKind_ThirdPartyId] ON [dbo].[JournalEntryLines];
END;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntryLines_AccountNumber_LetteringCode' AND object_id = OBJECT_ID(N'[dbo].[JournalEntryLines]'))
BEGIN
    DROP INDEX [IX_JournalEntryLines_AccountNumber_LetteringCode] ON [dbo].[JournalEntryLines];
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_JournalEntryLines_AccountNumber' AND object_id = OBJECT_ID(N'[dbo].[JournalEntryLines]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_JournalEntryLines_AccountNumber]
        ON [dbo].[JournalEntryLines] ([AccountNumber]);
END;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LetteringGroupMembers_JournalEntryLineId' AND object_id = OBJECT_ID(N'[dbo].[LetteringGroupMembers]') AND is_unique = 1)
BEGIN
    DROP INDEX [IX_LetteringGroupMembers_JournalEntryLineId] ON [dbo].[LetteringGroupMembers];
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LetteringGroupMembers_JournalEntryLineId' AND object_id = OBJECT_ID(N'[dbo].[LetteringGroupMembers]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_LetteringGroupMembers_JournalEntryLineId]
        ON [dbo].[LetteringGroupMembers] ([JournalEntryLineId]);
END;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LetteringGroups_Code' AND object_id = OBJECT_ID(N'[dbo].[LetteringGroups]'))
BEGIN
    DROP INDEX [IX_LetteringGroups_Code] ON [dbo].[LetteringGroups];
END;
""");
        }
    }
}
