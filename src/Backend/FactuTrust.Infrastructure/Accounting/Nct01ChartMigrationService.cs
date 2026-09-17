using System.Data;

using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace FactuTrust.Infrastructure.Accounting;

/// <summary>
/// Applique le remap PCG hybride → NCT 01 puis UPSERT le catalogue. Idempotent via
/// <c>ChartOfAccountRemapLogs.MapVersion = nct01-v1</c>.
/// </summary>
public static class Nct01ChartMigrationService
{
    public const string MapVersion = SceChartCatalog.Version;

    public static async Task<bool> IsAppliedAsync(TenantDbContext db, CancellationToken cancellationToken = default)
    {
        if (!await ChartRewritePrimitives.TableExistsAsync(db, "ChartOfAccounts", cancellationToken))
            return false;
        if (!await ChartRewritePrimitives.TableExistsAsync(db, "ChartOfAccountRemapLogs", cancellationToken))
            return false;

        try
        {
            return await AlreadyAppliedAsync(db, cancellationToken);
        }
        catch
        {
            return false;
        }
    }

    public static async Task EnsureMigratedAsync(TenantDbContext db, CancellationToken cancellationToken = default)
    {
        if (!await ChartRewritePrimitives.TableExistsAsync(db, "ChartOfAccounts", cancellationToken))
            return;

        await EnsureLogTableAsync(db, cancellationToken);
        if (await AlreadyAppliedAsync(db, cancellationToken))
            return;

        var remap = SceChartCatalog.LoadRemap();
        var catalog = SceChartCatalog.LoadAccounts();

        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await RemapReferencingColumnsAsync(db, remap, cancellationToken);
            await RemapChartRowsAsync(db, remap, cancellationToken);
            await UpsertCatalogAsync(db, catalog, cancellationToken);
            await DeactivateOrphansAsync(db, remap, cancellationToken);
            await InsertLogAsync(db, cancellationToken);
            await tx.CommitAsync(cancellationToken);
        }
        catch
        {
            await tx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static async Task RemapReferencingColumnsAsync(
        TenantDbContext db, CoaRemapTable remap, CancellationToken ct)
    {
        var targets = new (string Table, string Column)[]
        {
            ("JournalEntryLines", "AccountNumber"),
            ("LetteringGroups", "AccountNumber"),
            ("JournalEntryTemplateLines", "AccountNumber"),
            ("ThirdPartyAccountingProfiles", "CollectiveAccountNumber"),
            ("BankAccounts", "ChartOfAccountNumber"),
            ("BankStatements", "ChartOfAccountNumber"),
            ("FixedAssets", "AssetAccountNumber"),
            ("FixedAssets", "DepreciationAccountNumber"),
            ("FixedAssets", "ExpenseAccountNumber"),
            ("FixedAssets", "CreditAccountNumber"),
            ("FixedAssets", "DisposalTreasuryAccount"),
            ("DepreciationRateCategories", "DefaultAssetAccount"),
            ("DepreciationRateCategories", "DefaultDepreciationAccount"),
            ("DepreciationRateCategories", "DefaultExpenseAccount"),
            ("SupplierInvoiceLines", "AssetAccountNumber"),
            ("Loans", "LoanAccountNumber"),
            ("Loans", "InterestAccountNumber"),
            ("Loans", "BankAccountNumber"),
            ("Payslips", "EmployeeAuxiliaryAccount"),
            ("PayrollPaymentLines", "EmployeeAuxiliaryAccount"),
            ("AccountingAnomalies", "AccountRef"),
            ("AccountingAnomalyLines", "AccountNumber"),
            // Comptes sélectionnés sur les rubriques de la déclaration mensuelle. Une ligne = un
            // numéro (ou une racine), ce qui suffit à la réécriture générique : c'est précisément
            // pour éviter le traitement spécial de BudgetPosts.AccountPrefixes que cette colonne
            // n'agrège pas plusieurs numéros.
            ("MonthlyDeclarationRubricAccounts", "AccountNumber"),
        };

        foreach (var (table, column) in targets)
        {
            if (!await ChartRewritePrimitives.TableExistsAsync(db, table, ct) || !await ChartRewritePrimitives.ColumnExistsAsync(db, table, column, ct))
                continue;

            var originals = await DistinctValuesAsync(db, table, column, ct);
            await ChartRewritePrimitives.CaseRewriteAsync(db, table, column, originals, remap.Rewrite, ct);
        }

        if (await ChartRewritePrimitives.TableExistsAsync(db, "BudgetPosts", ct)
            && await ChartRewritePrimitives.ColumnExistsAsync(db, "BudgetPosts", "AccountPrefixes", ct))
        {
            var prefixes = await DistinctValuesAsync(db, "BudgetPosts", "AccountPrefixes", ct);
            await ChartRewritePrimitives.CaseRewriteAsync(db, "BudgetPosts", "AccountPrefixes", prefixes, RewritePrefixList(remap), ct);
        }
    }

    private static Func<string, string> RewritePrefixList(CoaRemapTable remap) => value =>
    {
        var parts = value.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return string.Join(';', parts.Select(remap.Rewrite));
    };

    private static async Task RemapChartRowsAsync(
        TenantDbContext db, CoaRemapTable remap, CancellationToken ct)
    {
        var numbers = await db.ChartOfAccounts.AsNoTracking().Select(a => a.AccountNumber).ToListAsync(ct);
        var parents = await db.ChartOfAccounts.AsNoTracking().Select(a => a.ParentAccountNumber).ToListAsync(ct);
        var affectations = await db.ChartOfAccounts.AsNoTracking().Select(a => a.AffectationAccountNumber).ToListAsync(ct);

        await DeleteMergeSourceRowsAsync(db, numbers, remap.Rewrite, ct);

        var remaining = await db.ChartOfAccounts.AsNoTracking().Select(a => a.AccountNumber).ToListAsync(ct);
        await ChartRewritePrimitives.TwoPhaseUniqueRewriteAsync(db, "ChartOfAccounts", "AccountNumber", remaining, remap.Rewrite, ct);
        await ChartRewritePrimitives.CaseRewriteAsync(db, "ChartOfAccounts", "ParentAccountNumber", parents, remap.Rewrite, ct);
        await ChartRewritePrimitives.CaseRewriteAsync(db, "ChartOfAccounts", "AffectationAccountNumber", affectations, remap.Rewrite, ct);

        await ChartRewritePrimitives.RecomputeLevelAndClassAsync(db, ct);

        db.ChangeTracker.Clear();

        // Le remap réécrit les numéros ; les libellés auto-générés qui citent l'ancien numéro
        // resteraient sinon figés dessus (« … — 421 — 4218744456 » sur un compte 4258744456).
        await ChartRewritePrimitives.NormalizeAutoGeneratedLabelsAsync(db, ct);

        var duplicates = await db.ChartOfAccounts
            .GroupBy(a => a.AccountNumber)
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToListAsync(ct);

        foreach (var number in duplicates)
        {
            var rows = await db.ChartOfAccounts.Where(a => a.AccountNumber == number).OrderBy(a => a.CreatedAt).ToListAsync(ct);
            foreach (var extra in rows.Skip(1))
                db.ChartOfAccounts.Remove(extra);
        }

        if (duplicates.Count > 0)
            await db.SaveChangesAsync(ct);

        db.ChangeTracker.Clear();
    }

    private static async Task DeleteMergeSourceRowsAsync(
        TenantDbContext db,
        IReadOnlyList<string?> originals,
        Func<string, string> rewrite,
        CancellationToken ct)
    {
        var numbers = originals
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Cast<string>()
            .Distinct(StringComparer.Ordinal)
            .ToList();

        foreach (var group in numbers.GroupBy(rewrite, StringComparer.Ordinal))
        {
            var members = group.ToList();
            if (members.Count <= 1)
                continue;

            var keep = members.Contains(group.Key, StringComparer.Ordinal)
                ? group.Key
                : members.OrderBy(m => m.Length).ThenBy(m => m, StringComparer.Ordinal).First();

            foreach (var extra in members.Where(m => !string.Equals(m, keep, StringComparison.Ordinal)))
            {
                await ChartRewritePrimitives.ExecAsync(
                    db,
                    "DELETE FROM [ChartOfAccounts] WHERE [AccountNumber] = {0}",
                    [extra],
                    ct);
            }
        }
    }

    private static async Task UpsertCatalogAsync(
        TenantDbContext db, IReadOnlyList<SceChartAccount> catalog, CancellationToken ct)
    {
        var existingNumbers = (await db.ChartOfAccounts.AsNoTracking()
                .Select(a => a.AccountNumber)
                .ToListAsync(ct))
            .ToHashSet(StringComparer.Ordinal);

        var now = DateTime.UtcNow;
        foreach (var account in catalog.OrderBy(a => a.Number.Length).ThenBy(a => a.Number, StringComparer.Ordinal))
        {
            if (existingNumbers.Contains(account.Number))
            {
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                    UPDATE [ChartOfAccounts]
                    SET [Label] = {account.Label},
                        [AccountClass] = {account.AccountClass},
                        [ParentAccountNumber] = {account.Parent},
                        [NatureType] = {account.NatureType},
                        [Level] = {account.Level},
                        [IsSystem] = 1,
                        [IsActive] = 1,
                        [UpdatedAt] = {now},
                        [UpdatedBy] = {MapVersion}
                    WHERE [AccountNumber] = {account.Number}
                    """,
                    ct);
                continue;
            }

            var created = ChartOfAccount.Create(
                account.Number,
                account.Label,
                account.AccountClass,
                account.Parent,
                (AccountNatureType)account.NatureType,
                isSystem: true);

            if (created.IsFailure)
            {
                throw new InvalidOperationException(
                    $"Catalogue NCT : impossible de créer {account.Number} ({account.Label}) : {created.Error.Description}");
            }

            created.Value.SetAuditInfo(MapVersion);
            db.ChartOfAccounts.Add(created.Value);
            existingNumbers.Add(account.Number);
        }

        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();
    }

    private static async Task DeactivateOrphansAsync(
        TenantDbContext db, CoaRemapTable remap, CancellationToken ct)
    {
        var hasJournal = await ChartRewritePrimitives.TableExistsAsync(db, "JournalEntryLines", ct);
        foreach (var entry in remap.DeactivateEntries)
        {
            if (hasJournal)
            {
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                    UPDATE [ChartOfAccounts]
                    SET [IsActive] = 0, [IsSystem] = 0, [UpdatedAt] = {DateTime.UtcNow}, [UpdatedBy] = {MapVersion}
                    WHERE [AccountNumber] = {entry.From}
                      AND NOT EXISTS (
                          SELECT 1 FROM [JournalEntryLines] l WHERE l.[AccountNumber] = {entry.From})
                    """,
                    ct);
            }
            else
            {
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                    UPDATE [ChartOfAccounts]
                    SET [IsActive] = 0, [IsSystem] = 0, [UpdatedAt] = {DateTime.UtcNow}, [UpdatedBy] = {MapVersion}
                    WHERE [AccountNumber] = {entry.From}
                    """,
                    ct);
            }
        }
    }

    /// <summary>
    /// Allow-list of (table, column) pairs that this service is permitted to read through
    /// <see cref="DistinctValuesAsync"/>. Both values are interpolated into raw SQL (bracket-quoted
    /// identifiers, no query params for identifiers); restricting them to constants known at call
    /// sites in this file prevents SQL injection even if a future caller accidentally threads
    /// untrusted input through. Deliberately kept separate from the compaction service's own list:
    /// widening one must never widen the other.
    /// </summary>
    internal static readonly IReadOnlySet<(string Table, string Column)> DistinctValuesAllowList =
        new HashSet<(string Table, string Column)>
        {
            ("JournalEntryLines", "AccountNumber"),
            ("LetteringGroups", "AccountNumber"),
            ("JournalEntryTemplateLines", "AccountNumber"),
            ("ThirdPartyAccountingProfiles", "CollectiveAccountNumber"),
            ("BankAccounts", "ChartOfAccountNumber"),
            ("BankStatements", "ChartOfAccountNumber"),
            ("FixedAssets", "AssetAccountNumber"),
            ("FixedAssets", "DepreciationAccountNumber"),
            ("FixedAssets", "ExpenseAccountNumber"),
            ("FixedAssets", "CreditAccountNumber"),
            ("FixedAssets", "DisposalTreasuryAccount"),
            ("DepreciationRateCategories", "DefaultAssetAccount"),
            ("DepreciationRateCategories", "DefaultDepreciationAccount"),
            ("DepreciationRateCategories", "DefaultExpenseAccount"),
            ("SupplierInvoiceLines", "AssetAccountNumber"),
            ("Loans", "LoanAccountNumber"),
            ("Loans", "InterestAccountNumber"),
            ("Loans", "BankAccountNumber"),
            ("Payslips", "EmployeeAuxiliaryAccount"),
            ("PayrollPaymentLines", "EmployeeAuxiliaryAccount"),
            ("AccountingAnomalies", "AccountRef"),
            ("AccountingAnomalyLines", "AccountNumber"),
            ("BudgetPosts", "AccountPrefixes"),
            ("MonthlyDeclarationRubricAccounts", "AccountNumber"),
        };

    /// <summary>
    /// Conserve la signature historique (couverte par <c>Nct01ChartMigrationServiceAllowListTests</c>)
    /// et délègue à la primitive partagée, en lui passant l'allow-list propre à ce service.
    /// </summary>
    internal static Task<List<string?>> DistinctValuesAsync(
        TenantDbContext db, string table, string column, CancellationToken ct) =>
        ChartRewritePrimitives.DistinctValuesAsync(
            db, table, column, DistinctValuesAllowList, nameof(Nct01ChartMigrationService), ct);

    private static async Task EnsureLogTableAsync(TenantDbContext db, CancellationToken ct) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            IF OBJECT_ID(N'dbo.ChartOfAccountRemapLogs', N'U') IS NULL
            BEGIN
                CREATE TABLE [dbo].[ChartOfAccountRemapLogs] (
                    [Id] uniqueidentifier NOT NULL PRIMARY KEY,
                    [MapVersion] nvarchar(32) NOT NULL,
                    [AppliedAt] datetime2 NOT NULL,
                    [AccountCount] int NOT NULL
                );
                CREATE UNIQUE INDEX [IX_ChartOfAccountRemapLogs_MapVersion]
                    ON [dbo].[ChartOfAccountRemapLogs] ([MapVersion]);
            END
            """,
            ct);

    private static async Task<bool> AlreadyAppliedAsync(TenantDbContext db, CancellationToken ct)
    {
        var conn = db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await db.Database.OpenConnectionAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(1) FROM [dbo].[ChartOfAccountRemapLogs] WHERE [MapVersion] = @v";
        var p = cmd.CreateParameter();
        p.ParameterName = "@v";
        p.Value = MapVersion;
        cmd.Parameters.Add(p);
        if (db.Database.CurrentTransaction is not null)
            cmd.Transaction = db.Database.CurrentTransaction.GetDbTransaction();
        var result = await cmd.ExecuteScalarAsync(ct);
        return Convert.ToInt32(result) > 0;
    }

    private static async Task InsertLogAsync(TenantDbContext db, CancellationToken ct)
    {
        var count = await db.ChartOfAccounts.CountAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO [dbo].[ChartOfAccountRemapLogs] ([Id], [MapVersion], [AppliedAt], [AccountCount])
            VALUES ({Guid.NewGuid()}, {MapVersion}, {DateTime.UtcNow}, {count})
            """,
            ct);
    }
}
