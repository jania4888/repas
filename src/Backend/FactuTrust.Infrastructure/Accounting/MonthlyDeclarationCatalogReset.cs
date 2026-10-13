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

/// <summary>Ce que l'amorçage doit savoir pour poser le catalogue de rubriques d'un dossier.</summary>
/// <param name="TclRatePercent">
/// Taux de TCL de la plateforme, repris par la rubrique F9_3_1. À <c>0</c>, cette rubrique est posée
/// mais désactivée : le calcul ne doit pas inventer une TCL que la plateforme ne préremplissait pas.
/// </param>
public sealed record MonthlyDeclarationCatalogOptions(decimal TclRatePercent)
{
    /// <summary>Taux légal tunisien, repli quand aucun réglage n'est fourni (outillage EF, tests).</summary>
    public const decimal DefaultTclRatePercent = 0.2m;

    public static MonthlyDeclarationCatalogOptions Default { get; } = new(DefaultTclRatePercent);
}

/// <summary>Traduit les réglages comptables en options de catalogue.</summary>
/// <remarks>
/// Faute de réglages, on retient le taux légal et <b>jamais</b> zéro : la pose n'a lieu qu'une fois
/// par dossier, un zéro accidentel y figerait une TCL éteinte.
/// </remarks>
public static class MonthlyDeclarationCatalogOptionsFactory
{
    public static MonthlyDeclarationCatalogOptions From(IOptions<AccountingSettings>? settings) =>
        settings?.Value is { } s
            ? new MonthlyDeclarationCatalogOptions(s.TclRatePercent)
            : MonthlyDeclarationCatalogOptions.Default;
}

/// <summary>Ce qu'a fait la pose du catalogue sur un dossier.</summary>
public enum MonthlyDeclarationCatalogResetOutcome
{
    /// <summary>Catalogue posé par cet appel.</summary>
    Applied = 0,

    /// <summary>Déjà posé — par un appel antérieur, ou par une autre réplique.</summary>
    AlreadyApplied = 1,

    /// <summary>Échec : le dossier garde sa configuration antérieure, un nouvel essai aura lieu.</summary>
    Failed = 2
}

/// <summary>Compte rendu de la pose du catalogue sur un dossier.</summary>
public sealed record MonthlyDeclarationCatalogResetReport(
    MonthlyDeclarationCatalogResetOutcome Outcome,
    int RubricCount,
    int IncludedFamilyCount,
    decimal TclRatePercent)
{
    public static MonthlyDeclarationCatalogResetReport AlreadyApplied { get; } =
        new(MonthlyDeclarationCatalogResetOutcome.AlreadyApplied, 0, 0, 0m);

    public static MonthlyDeclarationCatalogResetReport Failed { get; } =
        new(MonthlyDeclarationCatalogResetOutcome.Failed, 0, 0, 0m);

    public bool IsFailure => Outcome == MonthlyDeclarationCatalogResetOutcome.Failed;
}

/// <summary>
/// Pose le catalogue de rubriques <c>tn-2026-v2</c> sur un dossier, <b>une fois pour toutes</b>, et
/// coche ses onze familles.
/// </summary>
/// <remarks>
/// <para>
/// <b>Pourquoi remplacer, et non compléter.</b> Le calcul de la déclaration mensuelle n'a plus
/// qu'une source : la configuration du dossier. Le catalogue v1 amorcé jusqu'ici ne reproduit pas le
/// calcul historique — retenues sur honoraires et sur achats à zéro, T.F.P comptée deux fois, FODEC
/// et timbre lus sur des comptes au lieu des factures — et ses familles étaient toutes décochées. Le
/// laisser en place reviendrait à déclarer des zéros. La configuration est donc <b>remplacée</b> par
/// celle qui, elle, reproduit l'historique au millime, preuve à l'appui
/// (<c>MonthlyDeclarationGoldenReferenceTests</c>).
/// </para>
/// <para>
/// <b>La configuration antérieure n'est pas perdue</b> : elle est sérialisée au format du Modèle
/// d'intégration dans l'entrée d'audit, donc relisible et réimportable. Ce n'est pas pour autant un
/// chemin de retour — ses familles décochées remettraient tout à zéro sous le nouveau calcul — mais
/// la trace de ce que le dossier portait.
/// </para>
/// <para>
/// <b>Tout ou rien.</b> Lecture du marqueur, remplacement, journaux et audit forment une seule unité,
/// dans une transaction sérialisable qui relit le marqueur : deux répliques ne posent pas deux fois.
/// Le refus d'une seule rubrique par le domaine fait échouer la pose entière — une configuration à
/// moitié posée déclarerait faux sans que rien ne le signale.
/// </para>
/// <para>
/// <b>Aucune exception ne sort</b> (hors annulation) : l'amorçage tourne à la première requête du
/// dossier, et un échec ici ne doit pas le rendre inaccessible. Le dossier garde sa configuration,
/// l'erreur est journalisée, un nouvel essai a lieu au prochain amorçage — et tant que le marqueur
/// manque, l'enregistrement d'une déclaration est refusé plutôt que faussé.
/// </para>
/// </remarks>
public static class MonthlyDeclarationCatalogReset
{
    /// <summary>Marqueur de la pose, distinct de la version du catalogue qu'elle installe.</summary>
    public const string ResetVersion = "tn-2026-v2-reset";

    public static async Task<MonthlyDeclarationCatalogResetReport> EnsureAppliedAsync(
        TenantDbContext context,
        MonthlyDeclarationCatalogOptions options,
        ILogger? logger = null,
        CancellationToken cancellationToken = default)
    {
        try
        {
            if (!context.Database.IsRelational())
                return await ApplyAsync(context, options, cancellationToken);

            var strategy = context.Database.CreateExecutionStrategy();
            var report = MonthlyDeclarationCatalogResetReport.Failed;

            await strategy.ExecuteAsync(async () =>
            {
                // Une nouvelle tentative repart d'un suivi vierge : les entités de la tentative
                // précédente ne doivent pas se réenregistrer.
                context.ChangeTracker.Clear();

                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);

                report = await ApplyAsync(context, options, cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            });

            return report;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex) when (IsUniqueViolation(ex))
        {
            context.ChangeTracker.Clear();
            logger?.LogInformation(
                "Catalogue de rubriques {Version} : déjà posé par une autre instance.", ResetVersion);
            return MonthlyDeclarationCatalogResetReport.AlreadyApplied;
        }
        catch (Exception ex)
        {
            context.ChangeTracker.Clear();
            logger?.LogError(
                ex,
                "Catalogue de rubriques {Version} : pose impossible sur ce dossier, qui garde sa "
                + "configuration antérieure. Tant que le marqueur manque, l'enregistrement d'une "
                + "déclaration est refusé. Nouvel essai au prochain amorçage ; état : "
                + "docs/runbooks/sql/MonthlyDeclarationCatalogResetStatus.readonly.sql.",
                ResetVersion);
            return MonthlyDeclarationCatalogResetReport.Failed;
        }
    }

    private static async Task<MonthlyDeclarationCatalogResetReport> ApplyAsync(
        TenantDbContext context, MonthlyDeclarationCatalogOptions options, CancellationToken cancellationToken)
    {
        // Relu DANS la transaction : c'est ce qui sérialise deux répliques qui amorceraient le même
        // dossier au même instant.
        var logs = await context.MonthlyDeclarationRubricSeedLogs
            .Select(l => l.CatalogVersion)
            .ToListAsync(cancellationToken);

        if (logs.Contains(ResetVersion))
            return MonthlyDeclarationCatalogResetReport.AlreadyApplied;

        var rubrics = await context.MonthlyDeclarationRubrics
            .Include(r => r.Accounts)
            .ToListAsync(cancellationToken);
        var families = await context.MonthlyDeclarationFamilySettings.ToListAsync(cancellationToken);

        var previous = rubrics.Count == 0 && families.Count == 0
            ? null
            : MonthlyDeclarationModel.Serialize(rubrics, families, DateTime.UtcNow);

        // Suppression en entités SUIVIES : les comptes partent en cascade, et EF ordonne le DELETE
        // avant l'INSERT — sans quoi la réinsertion des mêmes codes violerait leur index unique.
        context.MonthlyDeclarationRubrics.RemoveRange(rubrics);

        var created = new List<MonthlyDeclarationRubric>();
        foreach (var draft in MonthlyDeclarationCatalogs.V2.Rubrics)
        {
            var target = draft.Code == MonthlyDeclarationCatalogV2.TclRubricCode
                ? draft with { RatePercent = MonthlyDeclarationCatalogOptions.DefaultTclRatePercent }
                : draft;

            var rubric = MonthlyDeclarationCatalogV2.Create(target);
            if (rubric.IsFailure)
                throw new InvalidOperationException($"Rubrique {target.Code} : {rubric.Error.Description}");

            // Taux de TCL éteint sur la plateforme : la rubrique est posée mais inactive. Le calcul
            // historique valait 0 ; la reproduire à 0 % est impossible (le domaine refuse un
            // « brut × taux » à taux nul), la désactiver donne exactement le même montant.
            if (target.Code == MonthlyDeclarationCatalogV2.TclRubricCode && options.TclRatePercent <= 0m)
                rubric.Value.ToggleActive();

            rubric.Value.SetAuditInfo("system");
            context.MonthlyDeclarationRubrics.Add(rubric.Value);
            created.Add(rubric.Value);
        }

        // Le catalogue posé ne doit lire aucune source deux fois.
        var conflict = MonthlyDeclarationSourceOverlap.AllConflicts(created).FirstOrDefault();
        if (conflict is not null)
            throw new InvalidOperationException(MonthlyDeclarationSourceOverlap.Refusal(conflict).Description);

        var includedFamilies = IncludeAllFamilies(context, families);

        // Le dossier porte désormais le catalogue v2 : on l'estampille comme tel, en plus du
        // marqueur de la pose elle-même.
        if (!logs.Contains(MonthlyDeclarationCatalogs.V2Version))
            AddSeedLog(context, MonthlyDeclarationCatalogs.V2Version);
        AddSeedLog(context, ResetVersion);

        var report = new MonthlyDeclarationCatalogResetReport(
            MonthlyDeclarationCatalogResetOutcome.Applied,
            created.Count,
            includedFamilies,
            options.TclRatePercent);

        context.AuditLogs.Add(AuditEntry(
            previous,
            JsonSerializer.Serialize(new
            {
                CatalogVersion = MonthlyDeclarationCatalogs.V2Version,
                Marker = ResetVersion,
                report.RubricCount,
                report.IncludedFamilyCount,
                report.TclRatePercent,
                ReplacedRubricCount = rubrics.Count
            }),
            await LastHashAsync(context, cancellationToken)));

        await context.SaveChangesAsync(cancellationToken);
        return report;
    }

    /// <summary>
    /// Coche les onze familles. Les lignes existantes sont mises à jour <b>en place</b> : leur index
    /// unique sur la famille interdit de les supprimer puis de les réinsérer dans le même lot.
    /// </summary>
    private static int IncludeAllFamilies(
        TenantDbContext context, List<MonthlyDeclarationFamilySetting> existing)
    {
        var byFamily = existing.ToDictionary(f => f.Family);
        var count = 0;

        foreach (var family in Enum.GetValues<MonthlyDeclarationFamily>())
        {
            if (byFamily.TryGetValue(family, out var setting))
            {
                if (!setting.IsIncluded)
                {
                    setting.SetIncluded(true);
                    setting.SetAuditInfo("system", isUpdate: true);
                }

                count++;
                continue;
            }

            var created = MonthlyDeclarationFamilySetting.Create(family, isIncluded: true);
            if (created.IsFailure)
                throw new InvalidOperationException($"Famille {family} : {created.Error.Description}");

            created.Value.SetAuditInfo("system");
            context.MonthlyDeclarationFamilySettings.Add(created.Value);
            count++;
        }

        return count;
    }

    private static void AddSeedLog(TenantDbContext context, string version)
    {
        var log = MonthlyDeclarationRubricSeedLog.Create(version);
        if (log.IsSuccess)
            context.MonthlyDeclarationRubricSeedLogs.Add(log.Value);
    }

    private static AuditLog AuditEntry(string? previousConfiguration, string payload, string previousHash) =>
        AuditLog.Create(
            tenantId: null,
            userId: null,
            userEmail: "system",
            action: AuditActions.Accounting.MonthlyDeclarationCatalogReset,
            entityType: nameof(MonthlyDeclarationRubricSeedLog),
            entityId: null,
            oldValues: previousConfiguration,
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
