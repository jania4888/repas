using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Accounting;

/// <summary>
/// Amorce le catalogue standard des rubriques de la déclaration mensuelle sur un dossier.
/// </summary>
/// <remarks>
/// <para>
/// <b>Insertion seule, par code.</b> Une rubrique existante n'est jamais mise à jour : revenir en
/// douce sur le taux qu'un comptable a corrigé serait le pire mode de défaillance possible. Une
/// rubrique supprimée n'est jamais recréée : sans quoi la suppression recommencerait à chaque
/// requête. Le journal de version distingue les deux cas.
/// </para>
/// <para>
/// <b>L'amorçage tourne même drapeau éteint.</b> Ce ne sont que des données inertes, et un dossier
/// qui activerait le drapeau pour découvrir un écran vide en conclurait que la fonctionnalité est
/// cassée. Même posture que le catalogue des retenues à la source, amorcé indépendamment de la
/// déclaration mensuelle unique.
/// </para>
/// <para>
/// <b>Les onze familles sont amorcées « non incluses ».</b> C'est la seconde moitié de la garantie
/// de non-régression : même drapeau allumé, un dossier qui n'ouvre jamais l'écran calcule
/// exactement comme avant.
/// </para>
/// </remarks>
public static class MonthlyDeclarationRubricInitializer
{
    public const string CatalogResourceName =
        "FactuTrust.Infrastructure.Resources.Accounting.monthly-declaration-rubrics-tn.json";

    /// <returns>Nombre de rubriques réellement insérées.</returns>
    public static async Task<int> EnsureDefaultsSeededAsync(
        TenantDbContext context, CancellationToken cancellationToken = default)
    {
        var catalog = LoadCatalog();
        var catalogVersion = catalog.CatalogVersion ?? string.Empty;

        var alreadyApplied = await context.MonthlyDeclarationRubricSeedLogs
            .AsNoTracking()
            .AnyAsync(l => l.CatalogVersion == catalogVersion, cancellationToken);

        var seededFamilies = await EnsureFamiliesAsync(context, cancellationToken);

        if (alreadyApplied)
        {
            if (seededFamilies)
                await context.SaveChangesAsync(cancellationToken);
            return 0;
        }

        var existingCodes = await context.MonthlyDeclarationRubrics
            .AsNoTracking()
            .Select(r => r.Code)
            .ToListAsync(cancellationToken);
        var existing = new HashSet<string>(existingCodes, StringComparer.Ordinal);

        var inserted = 0;
        foreach (var draft in catalog.Rubrics)
        {
            if (existing.Contains(draft.Code))
                continue;

            var rubric = Build(draft);
            if (rubric is null)
                continue;

            context.MonthlyDeclarationRubrics.Add(rubric);
            existing.Add(draft.Code);
            inserted++;
        }

        var log = MonthlyDeclarationRubricSeedLog.Create(catalogVersion);
        if (log.IsSuccess)
            context.MonthlyDeclarationRubricSeedLogs.Add(log.Value);

        await context.SaveChangesAsync(cancellationToken);
        return inserted;
    }

    /// <summary>
    /// Crée les lignes d'inclusion manquantes, toutes à « non incluse ». Ne touche jamais une ligne
    /// existante : c'est un choix du dossier.
    /// </summary>
    private static async Task<bool> EnsureFamiliesAsync(
        TenantDbContext context, CancellationToken cancellationToken)
    {
        var existing = await context.MonthlyDeclarationFamilySettings
            .AsNoTracking()
            .Select(f => f.Family)
            .ToListAsync(cancellationToken);
        var known = new HashSet<MonthlyDeclarationFamily>(existing);

        var added = false;
        foreach (var family in Enum.GetValues<MonthlyDeclarationFamily>())
        {
            if (known.Contains(family))
                continue;

            var setting = MonthlyDeclarationFamilySetting.Create(family, isIncluded: false);
            if (setting.IsFailure)
                continue;

            context.MonthlyDeclarationFamilySettings.Add(setting.Value);
            added = true;
        }

        return added;
    }

    /// <summary>
    /// Construit une rubrique à partir d'un brouillon du catalogue, ou <c>null</c> si le domaine
    /// la refuse.
    /// </summary>
    /// <remarks>
    /// L'analyseur a déjà écarté les entrées qu'il ne sait pas traduire ; ce dernier filet attrape
    /// ce que seul le domaine peut refuser. Une entrée fautive est ignorée plutôt que de faire
    /// échouer l'amorçage : ce dernier tourne à la première requête d'un dossier, et une coquille
    /// dans le catalogue mettrait sinon le dossier entier en erreur pour une ligne de référence.
    /// </remarks>
    private static MonthlyDeclarationRubric? Build(MonthlyDeclarationRubricDraft draft)
    {
        var created = MonthlyDeclarationRubric.Create(
            draft.Family, draft.Code, draft.Label, draft.ReportCode,
            draft.GrossKind, draft.WithheldKind, draft.GrossSide, draft.WithheldSide,
            draft.RatePercent, draft.FixedGrossAmount, draft.FixedWithheldAmount,
            draft.PayrollComponent, draft.WithheldPayrollComponent,
            draft.EffectiveFrom, draft.EffectiveTo, draft.Accounts, draft.DisplayOrder);

        if (created.IsFailure)
            return null;

        var rubric = created.Value;
        rubric.SetAuditInfo("system");
        return rubric;
    }

    /// <summary>
    /// Lit le catalogue embarqué avec <b>l'analyseur du modèle d'intégration</b> — le même que
    /// l'import de fichier.
    /// </summary>
    /// <remarks>
    /// Un analyseur propre à l'amorçage aurait fini par diverger de celui de l'import, et un
    /// modèle exporté depuis un dossier n'aurait plus pu servir de catalogue. Les rejets sont
    /// ignorés ici : c'est la politique de l'amorçage, pas celle de l'import.
    /// </remarks>
    private static MonthlyDeclarationModelParse LoadCatalog()
    {
        var assembly = typeof(MonthlyDeclarationRubricInitializer).Assembly;
        var name = assembly.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("monthly-declaration-rubrics-tn.json", StringComparison.Ordinal))
            ?? throw new InvalidOperationException(
                $"Ressource embarquée introuvable : {CatalogResourceName}.");

        using var stream = assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Ressource embarquée illisible : {name}.");

        using var reader = new StreamReader(stream);
        var json = reader.ReadToEnd();

        var parsed = MonthlyDeclarationModel.Parse(json);
        if (parsed.IsFailure)
            throw new InvalidOperationException($"Catalogue de rubriques illisible ({name}) : {parsed.Error.Description}");

        return parsed.Value;
    }
}
