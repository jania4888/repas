using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Scripts;

/// <summary>
/// Balayage plateforme de l'intégrité du lettrage (<c>LetteringGroups</c> /
/// <c>LetteringGroupMembers</c> / <c>JournalEntryLines.LetteringCode</c>) sur toutes les
/// bases tenant. Recommandé avant le déploiement de la migration
/// <c>20261012100000_AddLetteringIntegrityIndexes_Tenant</c> : la migration est gardée (elle
/// n'échoue plus sur doublons), mais un tenant avec anomalies resterait sans protection par
/// index unique jusqu'à réparation — cf. runbook <c>docs/runbooks/lettering-integrity.md</c>.
/// Fail-closed : un tenant injoignable, ou avec une quelconque anomalie, n'est JAMAIS
/// compté comme propre (<see cref="LetteringIntegrityReportDto.IsUniqueIndexSafe"/>).
/// Les listes d'anomalies sont bornées (<see cref="MaxAnomalyRows"/>) : le rapport sert au
/// diagnostic, pas à l'exhaustivité ; un timeout de commande est posé pour ne jamais bloquer
/// l'endpoint plateforme sur une grosse base.
/// Modèle : <see cref="InvoiceNumberIntegrityHelper"/>.
/// </summary>
public static class LetteringIntegrityHelper
{
    /// <summary>Borne haute des listes d'anomalies du rapport (diagnostic, pas exhaustivité).</summary>
    private const int MaxAnomalyRows = 500;

    /// <summary>Timeout par commande SQL (secondes) : le balayage ne doit jamais bloquer l'endpoint.</summary>
    private const int SqlCommandTimeoutSeconds = 120;

    private const string CountsSql = @"
SELECT
    (SELECT COUNT(*) FROM [dbo].[LetteringGroups]),
    (SELECT COUNT(*) FROM [dbo].[JournalEntryLines] WHERE [LetteringCode] IS NOT NULL);";

    private static string UniqueIndexSql(string table, string column) => $@"
SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM sys.indexes ix
    INNER JOIN sys.index_columns ic
        ON ic.object_id = ix.object_id AND ic.index_id = ix.index_id AND ic.key_ordinal = 1
    INNER JOIN sys.columns c
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE ix.object_id = OBJECT_ID(N'[dbo].[{table}]')
      AND ix.is_unique = 1
      AND c.[name] = N'{column}') THEN 1 ELSE 0 END;";

    private static readonly string DuplicateCodesSql = $@"
SELECT TOP ({MaxAnomalyRows}) [Code], COUNT(*) AS [GroupCount]
FROM [dbo].[LetteringGroups]
GROUP BY [Code]
HAVING COUNT(*) > 1
ORDER BY [Code];";

    private static readonly string LinesInMultipleGroupsSql = $@"
SELECT TOP ({MaxAnomalyRows}) m.[JournalEntryLineId], g.[Code]
FROM [dbo].[LetteringGroupMembers] m
INNER JOIN [dbo].[LetteringGroups] g ON g.[Id] = m.[LetteringGroupId]
WHERE m.[JournalEntryLineId] IN (
    SELECT [JournalEntryLineId] FROM [dbo].[LetteringGroupMembers]
    GROUP BY [JournalEntryLineId] HAVING COUNT(*) > 1)
ORDER BY m.[JournalEntryLineId], g.[Code];";

    private static readonly string OrphanMembersSql = $@"
SELECT TOP ({MaxAnomalyRows}) m.[JournalEntryLineId], g.[Code]
FROM [dbo].[LetteringGroupMembers] m
INNER JOIN [dbo].[LetteringGroups] g ON g.[Id] = m.[LetteringGroupId]
LEFT JOIN [dbo].[JournalEntryLines] l ON l.[Id] = m.[JournalEntryLineId]
WHERE l.[Id] IS NULL
ORDER BY g.[Code], m.[JournalEntryLineId];";

    private static readonly string DanglingLetteringCodeLinesSql = $@"
SELECT TOP ({MaxAnomalyRows}) l.[Id], l.[LetteringCode]
FROM [dbo].[JournalEntryLines] l
LEFT JOIN [dbo].[LetteringGroups] g ON g.[Code] = l.[LetteringCode]
WHERE l.[LetteringCode] IS NOT NULL AND g.[Id] IS NULL
ORDER BY l.[LetteringCode], l.[Id];";

    private static readonly string MismatchedLetteringCodesSql = $@"
SELECT TOP ({MaxAnomalyRows}) m.[JournalEntryLineId], g.[Code], l.[LetteringCode]
FROM [dbo].[LetteringGroupMembers] m
INNER JOIN [dbo].[LetteringGroups] g ON g.[Id] = m.[LetteringGroupId]
INNER JOIN [dbo].[JournalEntryLines] l ON l.[Id] = m.[JournalEntryLineId]
WHERE l.[LetteringCode] IS NULL OR l.[LetteringCode] <> g.[Code]
ORDER BY g.[Code], m.[JournalEntryLineId];";

    /// <summary>Balaye tous les tenants actifs et consolide le rapport d'intégrité du lettrage.</summary>
    public static async Task<LetteringIntegrityReportDto> ScanAllTenantsAsync(
        IServiceProvider serviceProvider,
        CancellationToken cancellationToken = default)
    {
        var loggerFactory = serviceProvider.GetRequiredService<ILoggerFactory>();
        var logger = loggerFactory.CreateLogger(typeof(LetteringIntegrityHelper).FullName
            ?? nameof(LetteringIntegrityHelper));

        await using var scope = serviceProvider.CreateAsyncScope();
        var masterContext = scope.ServiceProvider.GetRequiredService<MasterDbContext>();
        var tenantService = scope.ServiceProvider.GetRequiredService<ITenantService>();

        var tenants = await masterContext.Tenants
            .AsNoTracking()
            .Where(t => t.IsActive)
            .OrderBy(t => t.CompanyName)
            .Select(t => new { t.Id, t.CompanyName })
            .ToListAsync(cancellationToken);

        logger.LogInformation(
            "Lettering integrity scan started for {Count} active tenant(s)", tenants.Count);

        var results = new List<TenantLetteringIntegrityDto>(tenants.Count);

        foreach (var tenant in tenants)
        {
            results.Add(await ScanTenantAsync(tenantService, tenant.Id, tenant.CompanyName, logger, cancellationToken));
        }

        var clean = results.Count(r => r.Status == TenantLetteringIntegrityDto.StatusClean);
        var withAnomalies = results.Count(r => r.Status == TenantLetteringIntegrityDto.StatusAnomaliesFound);
        var unreachable = results.Count(r => r.Status == TenantLetteringIntegrityDto.StatusUnreachable);

        var report = new LetteringIntegrityReportDto
        {
            ScannedAtUtc = DateTime.UtcNow,
            TotalTenants = results.Count,
            CleanTenants = clean,
            TenantsWithAnomalies = withAnomalies,
            UnreachableTenants = unreachable,
            IsUniqueIndexSafe = results.Count > 0 && clean == results.Count,
            Tenants = results
        };

        logger.LogInformation(
            "Lettering integrity scan completed. Total: {Total}, Clean: {Clean}, Anomalies: {Anomalies}, Unreachable: {Unreachable}",
            report.TotalTenants, report.CleanTenants, report.TenantsWithAnomalies, report.UnreachableTenants);

        return report;
    }

    private static async Task<TenantLetteringIntegrityDto> ScanTenantAsync(
        ITenantService tenantService,
        Guid tenantId,
        string tenantName,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        try
        {
            var connectionString = await tenantService.GetConnectionStringAsync(tenantId, cancellationToken);
            if (string.IsNullOrEmpty(connectionString))
            {
                return Unreachable(tenantId, tenantName, "Chaîne de connexion introuvable.");
            }

            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync(cancellationToken);

            int groupCount, letteredLineCount;
            await using (var countCommand = CreateCommand(CountsSql, connection))
            await using (var reader = await countCommand.ExecuteReaderAsync(cancellationToken))
            {
                await reader.ReadAsync(cancellationToken);
                groupCount = reader.GetInt32(0);
                letteredLineCount = reader.GetInt32(1);
            }

            var hasGroupCodeIndex = await ScalarBoolAsync(connection, UniqueIndexSql("LetteringGroups", "Code"), cancellationToken);
            var hasMemberLineIndex = await ScalarBoolAsync(connection, UniqueIndexSql("LetteringGroupMembers", "JournalEntryLineId"), cancellationToken);

            var duplicateCodes = await ReadRowsAsync(DuplicateCodesSql, connection,
                r => new DuplicateLetteringCodeDto { Code = r.GetString(0), GroupCount = r.GetInt32(1) }, cancellationToken);
            var multiGroupRows = await ReadRowsAsync(LinesInMultipleGroupsSql, connection,
                r => (LineId: r.GetGuid(0), Code: r.GetString(1)), cancellationToken);
            var orphanMembers = await ReadRowsAsync(OrphanMembersSql, connection,
                r => new OrphanLetteringMemberDto { JournalEntryLineId = r.GetGuid(0), GroupCode = r.GetString(1) }, cancellationToken);
            var danglingLines = await ReadRowsAsync(DanglingLetteringCodeLinesSql, connection,
                r => new DanglingLetteringCodeLineDto { JournalEntryLineId = r.GetGuid(0), LetteringCode = r.GetString(1) }, cancellationToken);
            var mismatches = await ReadRowsAsync(MismatchedLetteringCodesSql, connection,
                r => new MismatchedLetteringCodeDto
                {
                    JournalEntryLineId = r.GetGuid(0),
                    GroupCode = r.GetString(1),
                    LineLetteringCode = r.IsDBNull(2) ? null : r.GetString(2)
                }, cancellationToken);

            // Une ligne membre de plusieurs groupes est rapportée UNE fois, avec tous ses codes.
            var multiGroupLines = multiGroupRows
                .GroupBy(r => r.LineId)
                .Select(g => new MultiGroupLetteringLineDto { JournalEntryLineId = g.Key, GroupCodes = g.Select(r => r.Code).ToList() })
                .OrderBy(d => d.JournalEntryLineId)
                .ToList();

            var hasAnomaly = duplicateCodes.Count > 0 || multiGroupLines.Count > 0
                || orphanMembers.Count > 0 || danglingLines.Count > 0 || mismatches.Count > 0;

            return new TenantLetteringIntegrityDto
            {
                TenantId = tenantId,
                TenantName = tenantName,
                Status = hasAnomaly
                    ? TenantLetteringIntegrityDto.StatusAnomaliesFound
                    : TenantLetteringIntegrityDto.StatusClean,
                LetteringGroupCount = groupCount,
                LetteredLineCount = letteredLineCount,
                HasUniqueGroupCodeIndex = hasGroupCodeIndex,
                HasUniqueMemberLineIndex = hasMemberLineIndex,
                DuplicateCodes = duplicateCodes,
                LinesInMultipleGroups = multiGroupLines,
                OrphanMembers = orphanMembers,
                DanglingLetteringCodeLines = danglingLines,
                MismatchedLetteringCodes = mismatches
            };
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "Lettering integrity scan failed for tenant {TenantId} ({TenantName})",
                tenantId, tenantName);
            return Unreachable(tenantId, tenantName, ex.Message);
        }
    }

    /// <summary>Commande SQL avec timeout explicite : le balayage ne doit jamais bloquer l'endpoint plateforme.</summary>
    private static SqlCommand CreateCommand(string sql, SqlConnection connection) =>
        new(sql, connection) { CommandTimeout = SqlCommandTimeoutSeconds };

    private static async Task<bool> ScalarBoolAsync(SqlConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var command = CreateCommand(sql, connection);
        return (int)(await command.ExecuteScalarAsync(cancellationToken) ?? 0) == 1;
    }

    /// <summary>Lit les lignes d'une requête d'anomalie et les projette via <paramref name="map"/>.</summary>
    private static async Task<List<T>> ReadRowsAsync<T>(
        string sql, SqlConnection connection, Func<SqlDataReader, T> map, CancellationToken cancellationToken)
    {
        var list = new List<T>();
        await using var command = CreateCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(map(reader));
        }
        return list;
    }

    private static TenantLetteringIntegrityDto Unreachable(Guid tenantId, string tenantName, string error) =>
        new()
        {
            TenantId = tenantId,
            TenantName = tenantName,
            Status = TenantLetteringIntegrityDto.StatusUnreachable,
            Error = error
        };
}
