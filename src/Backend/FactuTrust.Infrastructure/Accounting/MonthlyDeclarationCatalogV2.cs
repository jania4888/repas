using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Infrastructure.Accounting;

/// <summary>
/// Catalogues embarqués des rubriques de la déclaration mensuelle : la v1, référence de ce qu'un
/// dossier a reçu à l'amorçage, et la v2, qui reproduit le calcul historique par la configuration.
/// </summary>
public static class MonthlyDeclarationCatalogs
{
    public const string V1Version = "tn-2026-v1";
    public const string V2Version = "tn-2026-v2";

    private static readonly Lazy<MonthlyDeclarationModelParse> LazyV1 =
        new(() => Load("monthly-declaration-rubrics-tn.json"));

    private static readonly Lazy<MonthlyDeclarationModelParse> LazyV2 =
        new(() => Load("monthly-declaration-rubrics-tn-v2.json"));

    public static MonthlyDeclarationModelParse V1 => LazyV1.Value;
    public static MonthlyDeclarationModelParse V2 => LazyV2.Value;

    /// <summary>
    /// Lit un catalogue embarqué avec l'analyseur du modèle d'intégration — le même que l'import de
    /// fichier, pour que catalogue et fichier ne divergent jamais.
    /// </summary>
    private static MonthlyDeclarationModelParse Load(string fileName)
    {
        var assembly = typeof(MonthlyDeclarationCatalogs).Assembly;
        var name = assembly.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("." + fileName, StringComparison.Ordinal))
            ?? throw new InvalidOperationException($"Catalogue de rubriques embarqué introuvable : {fileName}.");

        using var stream = assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Catalogue de rubriques illisible : {name}.");
        using var reader = new StreamReader(stream);

        var parsed = MonthlyDeclarationModel.Parse(reader.ReadToEnd());
        if (parsed.IsFailure)
            throw new InvalidOperationException($"Catalogue de rubriques illisible ({name}) : {parsed.Error.Description}");

        return parsed.Value;
    }
}

/// <summary>Décision de montée d'une famille : appliquer la v2, ou laisser la famille en l'état.</summary>
/// <param name="Updates">Rubriques v1 existantes à réécrire en v2, avec leur définition v2.</param>
/// <param name="Inserts">Rubriques propres à la v2, à créer.</param>
/// <param name="SkipReason">Motif quand la famille est laissée en l'état ; <c>null</c> sinon.</param>
public sealed record MonthlyDeclarationFamilyUpgrade(
    MonthlyDeclarationFamily Family,
    IReadOnlyList<(string Code, MonthlyDeclarationRubricDraft Target)> Updates,
    IReadOnlyList<MonthlyDeclarationRubricDraft> Inserts,
    string? SkipReason)
{
    public bool IsApplied => SkipReason is null;
}

/// <summary>
/// Passage v1 → v2 des rubriques. Fonctions pures : la montée d'un dossier et l'import d'un fichier
/// v1 appliquent exactement la même règle.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tout ou rien par famille.</b> Une famille n'est montée que si toutes ses rubriques v1 sont
/// intactes. Monter la TFP à 1 % sans celle à 2 % compterait la TFP deux fois ; monter une retenue
/// dont le comptable a retouché une ligne effacerait son choix. La famille est alors laissée, et le
/// motif consigné.
/// </para>
/// <para>
/// « Intacte » porte sur ce qui <b>calcule</b> : types, sens, taux, montants fixes, valeurs de paie
/// ou documentaires, période, état actif et comptes. Le libellé et l'ordre d'affichage, que le
/// comptable a pu retoucher sans rien changer au calcul, n'en font pas partie — et sont conservés.
/// Un compte est intact s'il porte le numéro v1 ou son image par la renumérotation NCT 01, qui
/// passe avant l'amorçage.
/// </para>
/// </remarks>
public static class MonthlyDeclarationCatalogV2
{
    /// <summary>Code de la rubrique TCL dont le taux est celui de la plateforme au moment de la montée.</summary>
    public const string TclRubricCode = "F9_3_1";

    /// <summary>Familles que la v2 modifie : les autres n'ont rien à monter.</summary>
    public static IReadOnlyList<MonthlyDeclarationFamily> TouchedFamilies(
        MonthlyDeclarationModelParse v1, MonthlyDeclarationModelParse v2)
    {
        var byCode = v1.Rubrics.ToDictionary(r => r.Code, StringComparer.Ordinal);
        return v2.Rubrics
            .Where(r => !byCode.TryGetValue(r.Code, out var before) || !SameCalculation(before, r))
            .Select(r => r.Family)
            .Distinct()
            .OrderBy(f => f)
            .ToList();
    }

    /// <summary>
    /// Passe en v2 les familles d'un fichier v1 dont toutes les rubriques sont celles du catalogue
    /// v1 — exactement la règle de la montée des dossiers. Les autres familles du fichier restent
    /// telles quelles.
    /// </summary>
    /// <returns>Les rubriques à importer, et les familles passées en v2.</returns>
    public static (IReadOnlyList<MonthlyDeclarationRubricDraft> Rubrics, IReadOnlyList<MonthlyDeclarationFamily> Upgraded) UpgradeDrafts(
        IReadOnlyList<MonthlyDeclarationRubricDraft> drafts, decimal tclRatePercent)
    {
        var v1 = MonthlyDeclarationCatalogs.V1;
        var v2 = MonthlyDeclarationCatalogs.V2;
        var result = drafts.ToList();
        var upgraded = new List<MonthlyDeclarationFamily>();

        foreach (var family in TouchedFamilies(v1, v2))
        {
            if (!drafts.Any(d => d.Family == family))
                continue;

            var decision = DecideCore(family, drafts, v1, v2, n => n, tclRatePercent);
            if (!decision.IsApplied)
                continue;

            foreach (var (code, target) in decision.Updates)
            {
                var index = result.FindIndex(d => d.Code == code);
                var fromFile = result[index];
                // Libellé, ordre et état actif restent ceux du fichier : seul le calcul change.
                result[index] = target with
                {
                    Label = fromFile.Label,
                    DisplayOrder = fromFile.DisplayOrder,
                    IsActive = fromFile.IsActive
                };
            }

            result.AddRange(decision.Inserts);
            upgraded.Add(family);
        }

        return (result, upgraded);
    }

    private static MonthlyDeclarationFamilyUpgrade DecideCore(
        MonthlyDeclarationFamily family,
        IReadOnlyCollection<MonthlyDeclarationRubricDraft> existing,
        MonthlyDeclarationModelParse v1,
        MonthlyDeclarationModelParse v2,
        Func<string, string> rewrite,
        decimal tclRatePercent)
    {
        MonthlyDeclarationFamilyUpgrade Skip(string reason) => new(family, [], [], reason);

        var v1Rubrics = v1.Rubrics.Where(r => r.Family == family).ToList();
        var v1Codes = v1Rubrics.Select(r => r.Code).ToHashSet(StringComparer.Ordinal);
        var byCode = existing.ToDictionary(r => r.Code, StringComparer.Ordinal);

        if (family == MonthlyDeclarationFamily.Tcl && tclRatePercent <= 0m)
            return Skip("taux de TCL de la plateforme nul : le calcul historique vaut 0, rien à reproduire");

        foreach (var reference in v1Rubrics)
        {
            if (!byCode.TryGetValue(reference.Code, out var current))
                return Skip($"rubrique {reference.Code} supprimée par le dossier");
            if (!IsIntact(current, reference, rewrite))
                return Skip($"rubrique {reference.Code} modifiée par le dossier");
        }

        var added = existing.FirstOrDefault(r => r.Family == family && IsActive(r) && !v1Codes.Contains(r.Code));
        if (added is not null)
            return Skip($"rubrique {added.Code} ajoutée par le dossier");

        var updates = new List<(string, MonthlyDeclarationRubricDraft)>();
        var inserts = new List<MonthlyDeclarationRubricDraft>();

        foreach (var target in v2.Rubrics.Where(r => r.Family == family))
        {
            var adjusted = target.Code == TclRubricCode ? target with { RatePercent = tclRatePercent } : target;
            var before = v1Rubrics.FirstOrDefault(r => r.Code == target.Code);

            if (before is null)
            {
                if (byCode.ContainsKey(target.Code))
                    return Skip($"code {target.Code} déjà utilisé par le dossier");
                inserts.Add(adjusted);
            }
            else if (!SameCalculation(before, adjusted))
            {
                updates.Add((target.Code, adjusted));
            }
        }

        return new MonthlyDeclarationFamilyUpgrade(family, updates, inserts, null);
    }

    /// <summary>Crée une rubrique propre à la v2.</summary>
    public static Domain.Common.Result<MonthlyDeclarationRubric> Create(MonthlyDeclarationRubricDraft target) =>
        MonthlyDeclarationRubric.Create(
            target.Family, target.Code, target.Label, target.ReportCode,
            target.GrossKind, target.WithheldKind, target.GrossSide, target.WithheldSide,
            target.RatePercent, target.FixedGrossAmount, target.FixedWithheldAmount,
            target.PayrollComponent, target.WithheldPayrollComponent,
            target.EffectiveFrom, target.EffectiveTo, target.Accounts, target.DisplayOrder,
            target.GrossDocumentSource, target.WithheldDocumentSource);

    /// <summary>La rubrique calcule-t-elle exactement comme sa définition v1 ?</summary>
    private static bool IsIntact(
        MonthlyDeclarationRubricDraft current, MonthlyDeclarationRubricDraft reference, Func<string, string> rewrite) =>
        IsActive(current)
        && current.Family == reference.Family
        && SameCalculation(current, reference, rewrite);

    /// <summary>Un brouillon muet sur son état actif (catalogue, duplication) est actif.</summary>
    private static bool IsActive(MonthlyDeclarationRubricDraft draft) => draft.IsActive ?? true;

    /// <summary>Deux définitions de rubrique calculent-elles la même chose ?</summary>
    public static bool SameCalculation(MonthlyDeclarationRubricDraft a, MonthlyDeclarationRubricDraft b) =>
        SameCalculation(a, b, n => n);

    private static bool SameCalculation(
        MonthlyDeclarationRubricDraft current, MonthlyDeclarationRubricDraft reference, Func<string, string> rewrite) =>
        string.Equals(current.ReportCode.Trim(), reference.ReportCode.Trim(), StringComparison.Ordinal)
        && current.GrossKind == reference.GrossKind
        && current.WithheldKind == reference.WithheldKind
        && current.GrossSide == reference.GrossSide
        && current.WithheldSide == reference.WithheldSide
        && current.RatePercent == reference.RatePercent
        && current.FixedGrossAmount == reference.FixedGrossAmount
        && current.FixedWithheldAmount == reference.FixedWithheldAmount
        && current.PayrollComponent == reference.PayrollComponent
        && current.WithheldPayrollComponent == reference.WithheldPayrollComponent
        && current.GrossDocumentSource == reference.GrossDocumentSource
        && current.WithheldDocumentSource == reference.WithheldDocumentSource
        && current.EffectiveFrom?.Date == reference.EffectiveFrom?.Date
        && current.EffectiveTo?.Date == reference.EffectiveTo?.Date
        && SameAccounts(current.Accounts, reference.Accounts, rewrite);

    private static bool SameAccounts(
        IReadOnlyList<RubricAccountInput> current, IReadOnlyList<RubricAccountInput> reference, Func<string, string> rewrite)
    {
        if (current.Count != reference.Count)
            return false;

        var remaining = current.ToList();
        foreach (var expected in reference)
        {
            var image = rewrite(expected.AccountNumber);
            var match = remaining.FindIndex(a =>
                a.Role == expected.Role
                && a.MatchMode == expected.MatchMode
                && (a.AccountNumber == expected.AccountNumber || a.AccountNumber == image));
            if (match < 0)
                return false;
            remaining.RemoveAt(match);
        }

        return true;
    }

    private static MonthlyDeclarationRubricDraft ToDraft(MonthlyDeclarationRubric r) => new(
        r.Family, r.Code, r.Label, r.ReportCode, r.GrossKind, r.WithheldKind, r.GrossSide, r.WithheldSide,
        r.RatePercent, r.FixedGrossAmount, r.FixedWithheldAmount, r.PayrollComponent, r.WithheldPayrollComponent,
        r.EffectiveFrom, r.EffectiveTo, r.DisplayOrder, r.IsActive,
        r.Accounts.Select(a => new RubricAccountInput(a.Role, a.AccountNumber, a.MatchMode)).ToList(),
        r.GrossDocumentSource, r.WithheldDocumentSource);
}
