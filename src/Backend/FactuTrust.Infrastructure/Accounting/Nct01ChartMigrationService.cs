using System.Data;

using FactuTrust.Application.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace FactuTrust.Infrastructure.Accounting;

/// <summary>Politique d'application du remap des numéros de compte.</summary>
public enum ChartMigrationMode
{
    /// <summary>
    /// Défaut, pour tous les chemins automatiques (provisionnement, premier appel HTTP) : le remap
    /// est <b>différé</b> si le dossier contient déjà des écritures ou des bulletins, car il
    /// réécrit les numéros de compte jusque dans les périodes clôturées.
    /// </summary>
    AutoSafe = 0,

    /// <summary>
    /// Bascule explicitement autorisée par un administrateur plateforme, sauvegarde faite
    /// (cf. <c>docs/runbooks/coa-nct01-migration.md</c>).
    /// </summary>
    Authorized = 1
}

/// <summary>
/// Applique le remap PCG hybride → NCT 01 puis UPSERT le catalogue.
/// </summary>
/// <remarks>
/// <para>
/// <b>Deux estampilles distinctes</b>, toutes deux dans <c>ChartOfAccountRemapLogs</c> :
/// <list type="bullet">
/// <item><c>MapVersion = nct01-v1</c> — le <b>remap des numéros</b>, destructif et non rejouable
/// (cycles <c>421↔425</c>, <c>231↔232</c>) : exactement une fois par base, pour toujours.</item>
/// <item><c>CatalogHash</c> — la <b>synchronisation du catalogue</b>, non destructive et rejouable :
/// elle repart dès que le JSON embarqué change d'empreinte. Sans elle, une base estampillée
/// <c>nct01-v1</c> ne reverrait jamais le catalogue, même corrigé ou enrichi.</item>
/// </list>
/// </para>
/// </remarks>
public static class Nct01ChartMigrationService
{
    public const string MapVersion = SceChartCatalog.Version;

    /// <summary>
    /// Tables dont le nom est interpolé dans un <c>SELECT COUNT(1)</c> brut par
    /// <see cref="CountRowsAsync"/> : liste blanche fermée, contrôlée avant tout accès base.
    /// Volontairement distincte des allow-lists de réécriture — élargir l'une ne doit jamais
    /// élargir l'autre.
    /// </summary>
    private static readonly IReadOnlySet<string> CountableTables =
        new HashSet<string>(StringComparer.Ordinal) { "JournalEntryLines", "Payslips" };

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

    public static async Task<TenantRuntimeCatalogReport> EnsureMigratedAsync(
        TenantDbContext db,
        ChartMigrationMode mode = ChartMigrationMode.AutoSafe,
        CancellationToken cancellationToken = default)
    {
        if (!await ChartRewritePrimitives.TableExistsAsync(db, "ChartOfAccounts", cancellationToken))
            return await BuildReportAsync(db, ChartCatalogOutcome.Skipped, hasChart: false, cancellationToken);

        await EnsureLogTableAsync(db, cancellationToken);
        var stamp = await ReadStampAsync(db, cancellationToken);

        if (stamp.RemapApplied)
        {
            // Remap déjà posé : on ne le rejoue JAMAIS. Seul le catalogue peut être resynchronisé,
            // et uniquement si son empreinte a changé depuis la dernière application.
            if (string.Equals(stamp.CatalogHash, SceChartCatalog.CatalogHash, StringComparison.Ordinal))
                return await BuildReportAsync(db, ChartCatalogOutcome.AlreadyApplied, hasChart: true, cancellationToken);

            await SyncCatalogOnlyAsync(db, cancellationToken);
            return await BuildReportAsync(db, ChartCatalogOutcome.CatalogResynced, hasChart: true, cancellationToken);
        }

        if (mode == ChartMigrationMode.AutoSafe && await HasAccountingDataAsync(db, cancellationToken))
        {
            // Ne rien faire est ici le comportement sûr : le remap réécrirait l'historique comptable
            // d'un dossier en production sans sauvegarde préalable ni décision humaine. Le plan
            // hérité reste un état supporté (profil de paie « Legacy »), et le diagnostic
            // plateforme signale le dossier comme « deferred ».
            return await BuildReportAsync(db, ChartCatalogOutcome.DeferredHasAccountingData, hasChart: true, cancellationToken);
        }

        var remap = SceChartCatalog.LoadRemap();
        var catalog = SceChartCatalog.LoadAccounts();

        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await RemapReferencingColumnsAsync(db, remap, cancellationToken);
            await RemapChartRowsAsync(db, remap, cancellationToken);
            await UpsertCatalogAsync(db, catalog, forceActive: true, cancellationToken);
            await DeactivateOrphansAsync(db, remap, cancellationToken);
            await InsertLogAsync(db, cancellationToken);
            await tx.CommitAsync(cancellationToken);
        }
        catch
        {
            await tx.RollbackAsync(cancellationToken);
            throw;
        }

        return await BuildReportAsync(db, ChartCatalogOutcome.Applied, hasChart: true, cancellationToken);
    }

    /// <summary>
    /// Compte rendu <b>en lecture seule</b> : état des estampilles, volumétrie et différentiel
    /// attendu d'une bascule. N'écrit rien — sert au diagnostic plateforme et au <c>dryRun</c>.
    /// </summary>
    public static async Task<TenantRuntimeCatalogReport> InspectAsync(
        TenantDbContext db,
        CancellationToken cancellationToken = default)
    {
        if (!await ChartRewritePrimitives.TableExistsAsync(db, "ChartOfAccounts", cancellationToken))
            return await BuildReportAsync(db, ChartCatalogOutcome.Skipped, hasChart: false, cancellationToken);

        // Lecture seule : on ne CRÉE pas la table de log ici. Un dossier resté sur le plan hérité
        // n'a souvent pas encore de ChartOfAccountRemapLogs — c'est précisément le cas qu'on veut
        // voir remonter en « legacy », pas en erreur.
        var stamp = await ChartRewritePrimitives.TableExistsAsync(db, "ChartOfAccountRemapLogs", cancellationToken)
            ? await ReadStampAsync(db, cancellationToken)
            : new ChartStamp(false, null);

        var outcome = stamp.RemapApplied
            ? ChartCatalogOutcome.AlreadyApplied
            : await HasAccountingDataAsync(db, cancellationToken)
                ? ChartCatalogOutcome.DeferredHasAccountingData
                : ChartCatalogOutcome.NotApplied;

        var report = await BuildReportAsync(db, outcome, hasChart: true, cancellationToken);

        // Le différentiel n'a de sens que pour une base encore sur le plan hérité.
        return stamp.RemapApplied
            ? report
            : report with { Preview = await ComputePreviewAsync(db, cancellationToken) };
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

    /// <param name="forceActive">
    /// <c>true</c> au premier passage (remap) : le catalogue impose <c>IsActive = 1</c>, comportement
    /// historique. <c>false</c> lors d'une resynchronisation de catalogue : seule la <b>structure</b>
    /// (libellé, rattachement, classe, nature) est alignée — une désactivation décidée par un
    /// comptable ne doit pas être annulée par une simple correction de libellé.
    /// </param>
    private static async Task UpsertCatalogAsync(
        TenantDbContext db, IReadOnlyList<SceChartAccount> catalog, bool forceActive, CancellationToken ct)
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
                if (forceActive)
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
                }
                else
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
                            [UpdatedAt] = {now},
                            [UpdatedBy] = {MapVersion}
                        WHERE [AccountNumber] = {account.Number}
                        """,
                        ct);
                }

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

    /// <summary>
    /// Resynchronise le catalogue <b>sans</b> remap : ni réécriture de numéro, ni désactivation
    /// d'orphelin, ni réactivation d'un compte désactivé à la main. Rejouable sans risque.
    /// </summary>
    private static async Task SyncCatalogOnlyAsync(TenantDbContext db, CancellationToken ct)
    {
        var catalog = SceChartCatalog.LoadAccounts();

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            await UpsertCatalogAsync(db, catalog, forceActive: false, ct);
            await StampCatalogHashAsync(db, ct);
            await tx.CommitAsync(ct);
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }

    /// <summary>
    /// Le dossier porte-t-il déjà de la matière comptable ? C'est le seul critère qui rend le remap
    /// sensible : il réécrit <c>JournalEntryLines.AccountNumber</c> (périodes clôturées comprises) et
    /// les comptes auxiliaires figés sur les bulletins.
    /// </summary>
    private static async Task<bool> HasAccountingDataAsync(TenantDbContext db, CancellationToken ct) =>
        await CountRowsAsync(db, "JournalEntryLines", ct) > 0
        || await CountRowsAsync(db, "Payslips", ct) > 0;

    private static async Task<int> CountRowsAsync(TenantDbContext db, string table, CancellationToken ct)
    {
        if (!CountableTables.Contains(table))
            throw new InvalidOperationException($"Table non autorisée au comptage : {table}.");

        if (!await ChartRewritePrimitives.TableExistsAsync(db, table, ct))
            return 0;

        var conn = db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await db.Database.OpenConnectionAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT COUNT(1) FROM [dbo].[{table}]";
        if (db.Database.CurrentTransaction is not null)
            cmd.Transaction = db.Database.CurrentTransaction.GetDbTransaction();
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
    }

    private static async Task<TenantRuntimeCatalogReport> BuildReportAsync(
        TenantDbContext db, ChartCatalogOutcome outcome, bool hasChart, CancellationToken ct)
    {
        var accountCount = hasChart ? await db.ChartOfAccounts.CountAsync(ct) : 0;
        var lineCount = hasChart ? await CountRowsAsync(db, "JournalEntryLines", ct) : 0;
        var stamp = hasChart && await ChartRewritePrimitives.TableExistsAsync(db, "ChartOfAccountRemapLogs", ct)
            ? await ReadStampAsync(db, ct)
            : new ChartStamp(false, null);

        return new TenantRuntimeCatalogReport
        {
            ChartOutcome = outcome,
            HasChart = hasChart,
            AccountCount = accountCount,
            AccountingLineCount = lineCount,
            AppliedMapVersion = stamp.RemapApplied ? MapVersion : null,
            AppliedCatalogHash = stamp.CatalogHash,
            CurrentCatalogHash = SceChartCatalog.CatalogHash
        };
    }

    /// <summary>
    /// Différentiel attendu, calculé en lecture seule. Les compteurs sont des <b>estimations
    /// d'exploitation</b> destinées à la relecture avant bascule, pas un plan d'exécution.
    /// </summary>
    private static async Task<ChartMigrationPreview> ComputePreviewAsync(TenantDbContext db, CancellationToken ct)
    {
        var remap = SceChartCatalog.LoadRemap();
        var catalog = SceChartCatalog.LoadAccounts();

        var existing = await db.ChartOfAccounts.AsNoTracking()
            .Select(a => new { a.AccountNumber, a.Label })
            .ToListAsync(ct);

        var rewritten = existing
            .Select(e => new { e.AccountNumber, e.Label, Target = remap.Rewrite(e.AccountNumber) })
            .ToList();

        var renumbered = rewritten
            .Where(e => !string.Equals(e.AccountNumber, e.Target, StringComparison.Ordinal))
            .OrderBy(e => e.AccountNumber, StringComparer.Ordinal)
            .ToList();

        var targetCounts = rewritten
            .GroupBy(e => e.Target, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal);

        var labelByTarget = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var row in rewritten)
            labelByTarget[row.Target] = row.Label;

        var finalNumbers = targetCounts.Keys.ToHashSet(StringComparer.Ordinal);

        var journalLines = 0;
        if (await ChartRewritePrimitives.TableExistsAsync(db, "JournalEntryLines", ct))
        {
            var distinct = await DistinctValuesAsync(db, "JournalEntryLines", "AccountNumber", ct);
            var changing = ChartRewritePrimitives.DistinctChanging(distinct, remap.Rewrite);
            if (changing.Count > 0)
            {
                journalLines = await db.JournalEntryLines.AsNoTracking()
                    .CountAsync(l => changing.Contains(l.AccountNumber), ct);
            }
        }

        return new ChartMigrationPreview
        {
            AccountsToCreate = catalog.Count(a => !finalNumbers.Contains(a.Number)),
            AccountsToRelabel = catalog.Count(a =>
                labelByTarget.TryGetValue(a.Number, out var label)
                && !string.Equals(label, a.Label, StringComparison.Ordinal)),
            AccountsToRenumber = renumbered.Count,
            AccountsToMerge = renumbered.Count(e => targetCounts.GetValueOrDefault(e.Target) > 1),
            AccountsToDeactivate = remap.DeactivateEntries
                .Count(entry => existing.Exists(x => string.Equals(x.AccountNumber, entry.From, StringComparison.Ordinal))),
            JournalLinesToRewrite = journalLines,
            SampleRenumbering = renumbered
                .Take(20)
                .Select(e => $"{e.AccountNumber} -> {e.Target}")
                .ToList()
        };
    }

    private static async Task EnsureLogTableAsync(TenantDbContext db, CancellationToken ct) =>
        await db.Database.ExecuteSqlRawAsync(
            """
            IF OBJECT_ID(N'dbo.ChartOfAccountRemapLogs', N'U') IS NULL
            BEGIN
                CREATE TABLE [dbo].[ChartOfAccountRemapLogs] (
                    [Id] uniqueidentifier NOT NULL PRIMARY KEY,
                    [MapVersion] nvarchar(32) NOT NULL,
                    [AppliedAt] datetime2 NOT NULL,
                    [AccountCount] int NOT NULL,
                    [CatalogHash] nvarchar(64) NULL
                );
                CREATE UNIQUE INDEX [IX_ChartOfAccountRemapLogs_MapVersion]
                    ON [dbo].[ChartOfAccountRemapLogs] ([MapVersion]);
            END

            -- Bases estampillées avant l'empreinte de catalogue : colonne ajoutée à la volée, comme
            -- la table elle-même, qui vit hors du modèle EF.
            IF COL_LENGTH(N'dbo.ChartOfAccountRemapLogs', N'CatalogHash') IS NULL
                ALTER TABLE [dbo].[ChartOfAccountRemapLogs] ADD [CatalogHash] nvarchar(64) NULL;
            """,
            ct);

    private sealed record ChartStamp(bool RemapApplied, string? CatalogHash);

    private static async Task<ChartStamp> ReadStampAsync(TenantDbContext db, CancellationToken ct)
    {
        var conn = db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await db.Database.OpenConnectionAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText =
            "SELECT TOP 1 [CatalogHash] FROM [dbo].[ChartOfAccountRemapLogs] WHERE [MapVersion] = @v";
        var p = cmd.CreateParameter();
        p.ParameterName = "@v";
        p.Value = MapVersion;
        cmd.Parameters.Add(p);
        if (db.Database.CurrentTransaction is not null)
            cmd.Transaction = db.Database.CurrentTransaction.GetDbTransaction();

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
            return new ChartStamp(false, null);

        return new ChartStamp(true, reader.IsDBNull(0) ? null : reader.GetString(0));
    }

    private static async Task<bool> AlreadyAppliedAsync(TenantDbContext db, CancellationToken ct) =>
        (await ReadStampAsync(db, ct)).RemapApplied;

    private static async Task InsertLogAsync(TenantDbContext db, CancellationToken ct)
    {
        var count = await db.ChartOfAccounts.CountAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO [dbo].[ChartOfAccountRemapLogs] ([Id], [MapVersion], [AppliedAt], [AccountCount], [CatalogHash])
            VALUES ({Guid.NewGuid()}, {MapVersion}, {DateTime.UtcNow}, {count}, {SceChartCatalog.CatalogHash})
            """,
            ct);
    }

    private static async Task StampCatalogHashAsync(TenantDbContext db, CancellationToken ct)
    {
        var count = await db.ChartOfAccounts.CountAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            UPDATE [dbo].[ChartOfAccountRemapLogs]
            SET [CatalogHash] = {SceChartCatalog.CatalogHash},
                [AccountCount] = {count},
                [AppliedAt] = {DateTime.UtcNow}
            WHERE [MapVersion] = {MapVersion}
            """,
            ct);
    }
}
