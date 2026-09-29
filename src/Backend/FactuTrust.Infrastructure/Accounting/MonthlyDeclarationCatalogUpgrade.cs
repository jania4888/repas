using System.Data;
using System.Text.Json;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using AuditActions = FactuTrust.Domain.Entities.AuditActions;

namespace FactuTrust.Infrastructure.Accounting;

/// <summary>Ce que l'amorçage doit savoir pour monter un dossier vers le catalogue v2.</summary>
/// <param name="Enabled">Interrupteur <c>MonthlyDeclarationCatalogV2UpgradeEnabled</c>.</param>
/// <param name="TclRatePercent">Taux de TCL de la plateforme, repris par la rubrique F9_3_1.</param>
public sealed record MonthlyDeclarationCatalogOptions(bool Enabled, decimal TclRatePercent)
{
    public static MonthlyDeclarationCatalogOptions Disabled { get; } = new(false, 0m);
}

/// <summary>Traduit les réglages comptables en options de montée ; éteinte faute de réglages.</summary>
public static class MonthlyDeclarationCatalogOptionsFactory
{
    public static MonthlyDeclarationCatalogOptions From(IOptions<AccountingSettings>? settings) =>
        settings?.Value is { } s
            ? new MonthlyDeclarationCatalogOptions(s.MonthlyDeclarationCatalogV2UpgradeEnabled, s.TclRatePercent)
            : MonthlyDeclarationCatalogOptions.Disabled;
}

/// <summary>Compte rendu de la montée d'un dossier.</summary>
public sealed record MonthlyDeclarationCatalogUpgradeReport(
    IReadOnlyList<MonthlyDeclarationFamily> UpgradedFamilies,
    IReadOnlyList<(MonthlyDeclarationFamily Family, string Reason)> SkippedFamilies,
    IReadOnlyList<(MonthlyDeclarationFamily Family, bool WasIncluded)> InclusionsChanged,
    bool ConfiguredDossierNeedsReview);

/// <summary>
/// Monte un dossier du catalogue de rubriques v1 vers la v2, à l'amorçage, une seule fois.
/// </summary>
/// <remarks>
/// <para>
/// <b>Données uniquement, derrière son propre interrupteur</b>, éteint par défaut : le code qui sait
/// lire la v2 se déploie d'abord, la montée ensuite.
/// </para>
/// <para>
/// <b>Tout ou rien par famille</b> (voir <see cref="MonthlyDeclarationCatalogV2"/>) : une famille
/// dont une rubrique v1 a été retouchée, supprimée, ou complétée par le dossier est laissée en
/// l'état et consignée. Une rubrique supprimée n'est jamais recréée.
/// </para>
/// <para>
/// <b>Inclusion des familles.</b> Pour un dossier sans réglage, en calcul historique ou en contrôle
/// de parité, toutes les familles sont cochées : ses montants déclarés viennent encore de
/// l'historique, cocher ne les déplace pas. Un dossier <b>déjà en calcul paramétré</b> n'est pas
/// touché — ses montants changeraient sans contrôle — et il est signalé pour revue.
/// </para>
/// <para>
/// <b>Un seul enregistrement</b>, dans une transaction sérialisable qui lit le dernier maillon de la
/// chaîne d'audit : l'entrée « catalogue monté » s'y enchaîne comme toute autre. Entre répliques,
/// une violation d'unicité (codes, journal de version) signifie « déjà monté ailleurs ».
/// </para>
/// <para>
/// <b>Aucune exception ne sort</b> (hors annulation) : l'amorçage tourne à la première requête du
/// dossier, et un échec ici ne doit pas le rendre inaccessible. Le dossier reste en v1, l'erreur
/// est journalisée, un nouvel essai a lieu au prochain amorçage.
/// </para>
/// </remarks>
public static class MonthlyDeclarationCatalogUpgrade
{
    /// <returns>Le compte rendu, ou <c>null</c> si rien n'a été fait (éteint, déjà monté, échec).</returns>
    public static async Task<MonthlyDeclarationCatalogUpgradeReport?> EnsureAppliedAsync(
        TenantDbContext context,
        MonthlyDeclarationCatalogOptions options,
        ILogger? logger = null,
        CancellationToken cancellationToken = default)
    {
        if (!options.Enabled)
            return null;

        try
        {
            return await ApplyAsync(context, options, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex) when (IsUniqueViolation(ex))
        {
            context.ChangeTracker.Clear();
            logger?.LogInformation(
                "Catalogue de rubriques {Version} : déjà monté par une autre instance.", MonthlyDeclarationCatalogs.V2Version);
            return null;
        }
        catch (Exception ex)
        {
            context.ChangeTracker.Clear();
            logger?.LogError(
                ex,
                "Catalogue de rubriques {Version} : montée impossible sur ce dossier, qui reste en v1. "
                + "Nouvel essai au prochain amorçage ; état : docs/runbooks/sql/MonthlyDeclarationCatalogUpgradeStatus.readonly.sql.",
                MonthlyDeclarationCatalogs.V2Version);
            return null;
        }
    }

    private static async Task<MonthlyDeclarationCatalogUpgradeReport?> ApplyAsync(
        TenantDbContext context, MonthlyDeclarationCatalogOptions options, CancellationToken cancellationToken)
    {
        var logs = await context.MonthlyDeclarationRubricSeedLogs
            .AsNoTracking()
            .Select(l => l.CatalogVersion)
            .ToListAsync(cancellationToken);

        // La v1 doit être posée (l'initialiseur passe juste avant) ; la v2 ne se monte qu'une fois.
        if (!logs.Contains(MonthlyDeclarationCatalogs.V1Version) || logs.Contains(MonthlyDeclarationCatalogs.V2Version))
            return null;

        var v1 = MonthlyDeclarationCatalogs.V1;
        var v2 = MonthlyDeclarationCatalogs.V2;
        var remap = SceChartCatalog.LoadRemap();

        var rubrics = await context.MonthlyDeclarationRubrics
            .Include(r => r.Accounts)
            .ToListAsync(cancellationToken);

        var upgraded = new List<MonthlyDeclarationFamily>();
        var skipped = new List<(MonthlyDeclarationFamily, string)>();
        var created = new List<MonthlyDeclarationRubric>();

        foreach (var family in MonthlyDeclarationCatalogV2.TouchedFamilies(v1, v2))
        {
            var decision = MonthlyDeclarationCatalogV2.Decide(
                family, rubrics, v1, v2, number => remap.Rewrite(number), options.TclRatePercent);

            if (!decision.IsApplied)
            {
                skipped.Add((family, decision.SkipReason!));
                continue;
            }

            foreach (var (code, target) in decision.Updates)
            {
                var rubric = rubrics.Single(r => r.Code == code);
                var applied = MonthlyDeclarationCatalogV2.ApplyTo(rubric, target);
                if (applied.IsFailure)
                    throw new InvalidOperationException($"Rubrique {code} : {applied.Error.Description}");

                var stale = await context.MonthlyDeclarationRubricAccounts
                    .Where(a => a.RubricId == rubric.Id)
                    .ToListAsync(cancellationToken);
                context.MonthlyDeclarationRubricAccounts.RemoveRange(stale);
                foreach (var account in rubric.Accounts)
                    context.Entry(account).State = EntityState.Added;

                rubric.SetAuditInfo("system", isUpdate: true);
            }

            foreach (var target in decision.Inserts)
            {
                var rubric = MonthlyDeclarationCatalogV2.Create(target);
                if (rubric.IsFailure)
                    throw new InvalidOperationException($"Rubrique {target.Code} : {rubric.Error.Description}");

                rubric.Value.SetAuditInfo("system");
                context.MonthlyDeclarationRubrics.Add(rubric.Value);
                created.Add(rubric.Value);
            }

            upgraded.Add(family);
        }

        // Le catalogue monté ne doit lire aucune source deux fois — une rubrique ajoutée par le
        // dossier dans une autre famille pourrait déjà reprendre ce que la v2 reprend.
        var conflict = MonthlyDeclarationSourceOverlap.AllConflicts(rubrics.Concat(created).ToList()).FirstOrDefault();
        if (conflict is not null)
            throw new InvalidOperationException(MonthlyDeclarationSourceOverlap.Refusal(conflict).Description);

        var (inclusions, needsReview) = await IncludeFamiliesAsync(context, cancellationToken);

        var log = MonthlyDeclarationRubricSeedLog.Create(MonthlyDeclarationCatalogs.V2Version);
        if (log.IsSuccess)
            context.MonthlyDeclarationRubricSeedLogs.Add(log.Value);

        var report = new MonthlyDeclarationCatalogUpgradeReport(upgraded, skipped, inclusions, needsReview);
        await SaveWithAuditAsync(context, report, cancellationToken);
        return report;
    }

    /// <summary>
    /// Coche toutes les familles, sauf pour un dossier déjà en calcul paramétré.
    /// </summary>
    private static async Task<(IReadOnlyList<(MonthlyDeclarationFamily, bool)> Changed, bool NeedsReview)> IncludeFamiliesAsync(
        TenantDbContext context, CancellationToken cancellationToken)
    {
        var settings = await context.MonthlyDeclarationSettings.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        if (settings?.Mode == MonthlyDeclarationMode.Configured)
            return (Array.Empty<(MonthlyDeclarationFamily, bool)>(), true);

        var existing = await context.MonthlyDeclarationFamilySettings.ToDictionaryAsync(f => f.Family, cancellationToken);
        var changed = new List<(MonthlyDeclarationFamily, bool)>();

        foreach (var family in Enum.GetValues<MonthlyDeclarationFamily>())
        {
            if (existing.TryGetValue(family, out var setting))
            {
                if (setting.IsIncluded)
                    continue;
                setting.SetIncluded(true);
                setting.SetAuditInfo("system", isUpdate: true);
                changed.Add((family, false));
                continue;
            }

            var created = MonthlyDeclarationFamilySetting.Create(family, isIncluded: true);
            if (created.IsFailure)
                continue;
            created.Value.SetAuditInfo("system");
            context.MonthlyDeclarationFamilySettings.Add(created.Value);
            changed.Add((family, false));
        }

        return (changed, false);
    }

    /// <summary>
    /// Enregistre la montée et son entrée d'audit en une fois. En base relationnelle, dans une
    /// transaction sérialisable : le dernier maillon de la chaîne d'audit est lu dans la transaction
    /// qui y ajoute le suivant, comme le fait <c>AuditService</c>.
    /// </summary>
    private static async Task SaveWithAuditAsync(
        TenantDbContext context, MonthlyDeclarationCatalogUpgradeReport report, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(new
        {
            CatalogVersion = MonthlyDeclarationCatalogs.V2Version,
            UpgradedFamilies = report.UpgradedFamilies.Select(f => f.ToString()),
            SkippedFamilies = report.SkippedFamilies.Select(s => new { Family = s.Family.ToString(), s.Reason }),
            InclusionsChanged = report.InclusionsChanged.Select(i => new { Family = i.Family.ToString(), i.WasIncluded }),
            report.ConfiguredDossierNeedsReview
        });

        if (!context.Database.IsRelational())
        {
            context.AuditLogs.Add(AuditEntry(payload, await LastHashAsync(context, cancellationToken)));
            await context.SaveChangesAsync(cancellationToken);
            return;
        }

        var strategy = context.Database.CreateExecutionStrategy();
        AuditLog? entry = null;
        await strategy.ExecuteAsync(async () =>
        {
            // Une nouvelle tentative relit le dernier maillon : l'entrée précédente est retirée.
            if (entry is not null)
                context.Entry(entry).State = EntityState.Detached;

            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);

            entry = AuditEntry(payload, await LastHashAsync(context, cancellationToken));
            context.AuditLogs.Add(entry);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    private static AuditLog AuditEntry(string payload, string previousHash) => AuditLog.Create(
        tenantId: null,
        userId: null,
        userEmail: "system",
        action: AuditActions.Accounting.MonthlyDeclarationCatalogUpgraded,
        entityType: nameof(MonthlyDeclarationRubricSeedLog),
        entityId: null,
        oldValues: null,
        newValues: payload,
        ipAddress: "system",
        userAgent: null,
        previousHash: previousHash);

    private static async Task<string> LastHashAsync(TenantDbContext context, CancellationToken cancellationToken) =>
        await context.AuditLogs
            .OrderByDescending(a => a.CreatedAt)
            .ThenByDescending(a => a.Id)
            .Select(a => a.Hash)
            .FirstOrDefaultAsync(cancellationToken)
        ?? "GENESIS";

    private static bool IsUniqueViolation(Exception ex)
    {
        for (var current = ex; current is not null; current = current.InnerException)
        {
            if (current is SqlException { Number: 2601 or 2627 })
                return true;
        }

        return false;
    }
}
