using System.Text.Json;
using System.Text.Json.Serialization;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

/// <summary>
/// Format d'échange de la configuration DM d'un dossier — le « Modèle Intégration DM ».
/// </summary>
/// <remarks>
/// <para>
/// C'est le <b>même format</b> que le catalogue d'amorçage embarqué, et le même analyseur : un
/// fichier de catalogue s'importe tel quel, et un modèle exporté peut servir de catalogue. Deux
/// formats auraient divergé au premier champ ajouté, et l'utilisateur aurait découvert la
/// divergence en important un fichier silencieusement tronqué.
/// </para>
/// <para>
/// Le modèle porte en plus ce que le catalogue n'a pas besoin de dire : montants fixes, période
/// d'application, état actif, et l'inclusion des familles. Ces champs sont <b>facultatifs</b> —
/// un catalogue qui les ignore s'importe sans rien perdre, et un modèle exporté fait un
/// aller-retour complet. Sans eux, exporter puis réimporter effacerait en silence les bornes de
/// période et les montants fixes saisis par le comptable.
/// </para>
/// <para>
/// Ce que le modèle ne porte <b>pas</b>, délibérément : le régime de calcul du dossier et l'état de
/// sa rampe de parité. Ils appartiennent au dossier et à son historique de contrôles, pas à un
/// paramétrage transportable ; les importer ferait basculer un dossier en calcul paramétré sur la
/// foi d'un fichier.
/// </para>
/// </remarks>
public static class MonthlyDeclarationModel
{
    /// <summary>
    /// Version du format, écrite à l'export. v2 ajoute les valeurs documentaires
    /// (<c>GrossDocumentSource</c>, <c>WithheldDocumentSource</c>) ; un fichier v1, qui ne les porte
    /// pas, reste lisible tel quel.
    /// </summary>
    public const string CurrentModelVersion = "dm-model-v2";

    /// <summary>Version de catalogue embarqué contemporaine du format courant.</summary>
    public const string CurrentCatalogVersion = "tn-2026-v2";

    /// <summary>
    /// Le fichier est-il au format courant ? Un modèle exporté en v2 ou le catalogue v2 l'est ; un
    /// export v1, un catalogue v1 ou un fichier sans version ne l'est pas.
    /// </summary>
    public static bool IsCurrentFormat(MonthlyDeclarationModelParse model) =>
        string.Equals(model.ModelVersion, CurrentModelVersion, StringComparison.Ordinal)
        || string.Equals(model.CatalogVersion, CurrentCatalogVersion, StringComparison.Ordinal);

    /// <summary>
    /// Plafond de taille du fichier accepté, en octets. Le plafond de rubriques par dossier
    /// (<see cref="MonthlyDeclarationGuard.MaxRubricsPerTenant"/>) borne le contenu utile ; celui-ci
    /// borne ce qu'on accepte de désérialiser avant même de savoir ce que c'est.
    /// </summary>
    public const int MaxDocumentBytes = 2 * 1024 * 1024;

    private static readonly JsonSerializerOptions ReadOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    // ── Lecture ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Analyse un document et rend les entrées valides <b>et</b> la liste de celles qui ont été
    /// rejetées, avec leur motif.
    /// </summary>
    /// <remarks>
    /// L'analyseur ne décide pas quoi faire des rejets, parce que ses deux appelants n'en veulent
    /// pas la même chose. L'amorçage les ignore : il tourne à la première requête d'un dossier, et
    /// une coquille dans le catalogue embarqué ne doit pas mettre le dossier entier en erreur pour
    /// une ligne de référence. L'import, lui, refuse le fichier entier : un fichier fourni par
    /// l'utilisateur qui passerait à moitié laisserait une configuration dont personne ne sait
    /// dans quel état elle est.
    /// </remarks>
    public static Result<MonthlyDeclarationModelParse> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return Result.Failure<MonthlyDeclarationModelParse>(ModelErrors.Empty);

        MonthlyDeclarationModelDocument? document;
        try
        {
            document = JsonSerializer.Deserialize<MonthlyDeclarationModelDocument>(json, ReadOptions);
        }
        catch (JsonException ex)
        {
            return Result.Failure<MonthlyDeclarationModelParse>(ModelErrors.Malformed(ex.Message));
        }

        if (document is null)
            return Result.Failure<MonthlyDeclarationModelParse>(ModelErrors.Empty);
        if (document.Rubrics is null || document.Rubrics.Count == 0)
            return Result.Failure<MonthlyDeclarationModelParse>(ModelErrors.NoRubrics);

        var rubrics = new List<MonthlyDeclarationRubricDraft>();
        var rejected = new List<MonthlyDeclarationModelRejection>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var entry in document.Rubrics)
        {
            var code = (entry.Code ?? string.Empty).Trim().ToUpperInvariant();
            if (code.Length == 0)
            {
                rejected.Add(new MonthlyDeclarationModelRejection("(sans code)", "Code absent."));
                continue;
            }

            // Un même code deux fois dans un fichier : la seconde entrée écraserait la première
            // sans que rien ne le dise. Mieux vaut nommer le doublon.
            if (!seen.Add(code))
            {
                rejected.Add(new MonthlyDeclarationModelRejection(code, "Code présent deux fois dans le fichier."));
                continue;
            }

            var draft = ToDraft(entry, code);
            if (draft.IsFailure)
            {
                rejected.Add(new MonthlyDeclarationModelRejection(code, draft.Error.Description));
                continue;
            }

            rubrics.Add(draft.Value);
        }

        var families = new List<MonthlyDeclarationFamilyDraft>();
        foreach (var entry in document.Families ?? [])
        {
            if (!TryParseName<MonthlyDeclarationFamily>(entry.Family, out var family))
            {
                rejected.Add(new MonthlyDeclarationModelRejection(
                    entry.Family ?? "(sans nom)", "Famille inconnue."));
                continue;
            }
            families.Add(new MonthlyDeclarationFamilyDraft(family, entry.IsIncluded));
        }

        return Result.Success(new MonthlyDeclarationModelParse(
            document.ModelVersion, document.CatalogVersion, families, rubrics, rejected));
    }

    /// <summary>
    /// Traduit une entrée du document en brouillon de rubrique, ou rend le motif du refus.
    /// </summary>
    /// <remarks>
    /// La validation métier proprement dite reste dans <see cref="MonthlyDeclarationRubric.Create"/> :
    /// la refaire ici ferait exister deux définitions de « rubrique valide », qui divergeraient.
    /// Cette méthode ne fait que traduire les jetons de texte en énumérations, puis passe la main.
    /// </remarks>
    private static Result<MonthlyDeclarationRubricDraft> ToDraft(
        MonthlyDeclarationModelRubricEntry entry, string code)
    {
        if (!TryParseName<MonthlyDeclarationFamily>(entry.Family, out var family))
            return Fail(code, $"Famille inconnue : « {entry.Family} ».");
        if (!TryParseName<RubricGrossKind>(entry.GrossKind, out var grossKind))
            return Fail(code, $"Type de montant brut inconnu : « {entry.GrossKind} ».");
        if (!TryParseName<RubricWithheldKind>(entry.WithheldKind, out var withheldKind))
            return Fail(code, $"Type de retenue inconnu : « {entry.WithheldKind} ».");
        if (!TryParseName<AccountBalanceSide>(entry.GrossSide, out var grossSide))
            return Fail(code, $"Sens du montant brut inconnu : « {entry.GrossSide} ».");
        if (!TryParseName<AccountBalanceSide>(entry.WithheldSide, out var withheldSide))
            return Fail(code, $"Sens de la retenue inconnu : « {entry.WithheldSide} ».");

        var payroll = ParseOptional<PayrollContributionComponent>(entry.PayrollComponent, "Valeur de paie");
        if (payroll.IsFailure)
            return Fail(code, payroll.Error.Description);

        var withheldPayroll = ParseOptional<PayrollContributionComponent>(entry.WithheldPayrollComponent, "Valeur de paie");
        if (withheldPayroll.IsFailure)
            return Fail(code, withheldPayroll.Error.Description);

        var grossDocument = ParseOptional<DeclarationDocumentSource>(entry.GrossDocumentSource, "Valeur documentaire");
        if (grossDocument.IsFailure)
            return Fail(code, grossDocument.Error.Description);

        var withheldDocument = ParseOptional<DeclarationDocumentSource>(entry.WithheldDocumentSource, "Valeur documentaire");
        if (withheldDocument.IsFailure)
            return Fail(code, withheldDocument.Error.Description);

        var accounts = new List<RubricAccountInput>();
        foreach (var (list, role) in new[]
                 {
                     (entry.GrossAccounts, RubricAccountRole.Gross),
                     (entry.WithheldAccounts, RubricAccountRole.Withheld)
                 })
        {
            foreach (var account in list ?? [])
            {
                if (!TryParseName<RubricAccountMatchMode>(account.Mode, out var mode))
                    return Fail(code, $"Mode de sélection de compte inconnu : « {account.Mode} ».");
                accounts.Add(new RubricAccountInput(role, account.Number ?? string.Empty, mode));
            }
        }

        // Construite immédiatement, et jetée : c'est le seul moyen d'appliquer la validation du
        // domaine à une entrée de fichier avant d'avoir décidé de l'insérer ou de la remplacer.
        var probe = MonthlyDeclarationRubric.Create(
            family, code, entry.Label, entry.ReportCode, grossKind, withheldKind,
            grossSide, withheldSide, entry.RatePercent,
            entry.FixedGrossAmount, entry.FixedWithheldAmount,
            payroll.Value, withheldPayroll.Value,
            entry.EffectiveFrom, entry.EffectiveTo, accounts, entry.DisplayOrder,
            grossDocument.Value, withheldDocument.Value);

        if (probe.IsFailure)
            return Fail(code, probe.Error.Description);

        return Result.Success(new MonthlyDeclarationRubricDraft(
            family, code, entry.Label ?? string.Empty, entry.ReportCode ?? string.Empty,
            grossKind, withheldKind, grossSide, withheldSide, entry.RatePercent,
            entry.FixedGrossAmount, entry.FixedWithheldAmount,
            payroll.Value, withheldPayroll.Value,
            entry.EffectiveFrom, entry.EffectiveTo, entry.DisplayOrder,
            entry.IsActive, accounts, grossDocument.Value, withheldDocument.Value));
    }

    /// <summary>
    /// Lit un jeton d'énumération <b>par son nom exact</b>. <c>Enum.TryParse</c> accepte aussi
    /// « 42 » — une valeur hors liste que rien ne détecterait ensuite — et « Debit, Credit », qu'il
    /// combine : un fichier ne doit désigner une valeur que par son nom.
    /// </summary>
    private static bool TryParseName<TEnum>(string? token, out TEnum value) where TEnum : struct, Enum
    {
        value = default;
        var name = token?.Trim();
        if (string.IsNullOrEmpty(name) || !Enum.GetNames<TEnum>().Contains(name, StringComparer.Ordinal))
            return false;

        value = Enum.Parse<TEnum>(name);
        return true;
    }

    private static Result<TEnum?> ParseOptional<TEnum>(string? token, string what) where TEnum : struct, Enum
    {
        if (string.IsNullOrWhiteSpace(token))
            return Result.Success<TEnum?>(null);
        if (!TryParseName<TEnum>(token, out var parsed))
            return Result.Failure<TEnum?>(Error.Validation(typeof(TEnum).Name, $"{what} inconnue : « {token} »."));
        return Result.Success<TEnum?>(parsed);
    }

    private static Result<MonthlyDeclarationRubricDraft> Fail(string code, string reason) =>
        Result.Failure<MonthlyDeclarationRubricDraft>(Error.Validation(code, reason));

    // ── Écriture ─────────────────────────────────────────────────────────────

    /// <summary>Sérialise la configuration d'un dossier au format du modèle.</summary>
    public static string Serialize(
        IReadOnlyList<MonthlyDeclarationRubric> rubrics,
        IReadOnlyList<MonthlyDeclarationFamilySetting> families,
        DateTime exportedAtUtc)
    {
        var document = new MonthlyDeclarationModelDocument
        {
            ModelVersion = CurrentModelVersion,
            ExportedAt = exportedAtUtc,
            Families = families
                .OrderBy(f => f.Family)
                .Select(f => new MonthlyDeclarationModelFamilyEntry
                {
                    Family = f.Family.ToString(),
                    IsIncluded = f.IsIncluded
                })
                .ToList(),
            Rubrics = rubrics
                .OrderBy(r => r.Family)
                .ThenBy(r => r.DisplayOrder)
                .ThenBy(r => r.Code, StringComparer.Ordinal)
                .Select(ToEntry)
                .ToList()
        };

        return JsonSerializer.Serialize(document, WriteOptions);
    }

    private static MonthlyDeclarationModelRubricEntry ToEntry(MonthlyDeclarationRubric r) => new()
    {
        Code = r.Code,
        Family = r.Family.ToString(),
        Label = r.Label,
        ReportCode = r.ReportCode,
        GrossKind = r.GrossKind.ToString(),
        WithheldKind = r.WithheldKind.ToString(),
        GrossSide = r.GrossSide.ToString(),
        WithheldSide = r.WithheldSide.ToString(),
        RatePercent = r.RatePercent,
        FixedGrossAmount = r.FixedGrossAmount,
        FixedWithheldAmount = r.FixedWithheldAmount,
        PayrollComponent = r.PayrollComponent?.ToString(),
        WithheldPayrollComponent = r.WithheldPayrollComponent?.ToString(),
        GrossDocumentSource = r.GrossDocumentSource?.ToString(),
        WithheldDocumentSource = r.WithheldDocumentSource?.ToString(),
        EffectiveFrom = r.EffectiveFrom,
        EffectiveTo = r.EffectiveTo,
        IsActive = r.IsActive,
        DisplayOrder = r.DisplayOrder,
        GrossAccounts = AccountsOf(r, RubricAccountRole.Gross),
        WithheldAccounts = AccountsOf(r, RubricAccountRole.Withheld)
    };

    private static List<MonthlyDeclarationModelAccountEntry> AccountsOf(
        MonthlyDeclarationRubric r, RubricAccountRole role) =>
        r.Accounts
            .Where(a => a.Role == role)
            .OrderBy(a => a.AccountNumber, StringComparer.Ordinal)
            .Select(a => new MonthlyDeclarationModelAccountEntry
            {
                Number = a.AccountNumber,
                Mode = a.MatchMode.ToString()
            })
            .ToList();

    private static class ModelErrors
    {
        public static Error Empty { get; } = Error.Validation(
            "Model", "Le fichier de modèle est vide.");

        public static Error NoRubrics { get; } = Error.Validation(
            "Model", "Le fichier ne contient aucune rubrique.");

        public static Error Malformed(string detail) => Error.Validation(
            "Model", $"Le fichier n'est pas un JSON exploitable : {detail}");
    }
}

// ── Résultat d'analyse ───────────────────────────────────────────────────────

/// <summary>Entrée écartée par l'analyseur, avec le motif à afficher.</summary>
public sealed record MonthlyDeclarationModelRejection(string Code, string Reason);

public sealed record MonthlyDeclarationFamilyDraft(MonthlyDeclarationFamily Family, bool IsIncluded);

/// <summary>
/// Rubrique lue depuis un fichier ou copiée d'un autre dossier, détachée de toute base.
/// </summary>
/// <remarks>
/// Partagée par l'import de modèle et la duplication inter-dossiers : les deux écrivent la même
/// chose au même endroit, seule leur source diffère.
/// </remarks>
public sealed record MonthlyDeclarationRubricDraft(
    MonthlyDeclarationFamily Family,
    string Code,
    string Label,
    string ReportCode,
    RubricGrossKind GrossKind,
    RubricWithheldKind WithheldKind,
    AccountBalanceSide GrossSide,
    AccountBalanceSide WithheldSide,
    decimal RatePercent,
    decimal? FixedGrossAmount,
    decimal? FixedWithheldAmount,
    PayrollContributionComponent? PayrollComponent,
    PayrollContributionComponent? WithheldPayrollComponent,
    DateTime? EffectiveFrom,
    DateTime? EffectiveTo,
    int DisplayOrder,
    /// <summary>
    /// État actif voulu, ou <c>null</c> lorsque la source n'en dit rien — un catalogue d'amorçage,
    /// une duplication. Dans ce cas l'état de la rubrique existante n'est pas touché : réactiver
    /// en silence une rubrique qu'un comptable a désactivée la ferait revenir dans le calcul.
    /// </summary>
    bool? IsActive,
    IReadOnlyList<RubricAccountInput> Accounts,
    DeclarationDocumentSource? GrossDocumentSource = null,
    DeclarationDocumentSource? WithheldDocumentSource = null);

public sealed record MonthlyDeclarationModelParse(
    string? ModelVersion,
    string? CatalogVersion,
    IReadOnlyList<MonthlyDeclarationFamilyDraft> Families,
    IReadOnlyList<MonthlyDeclarationRubricDraft> Rubrics,
    IReadOnlyList<MonthlyDeclarationModelRejection> Rejected);

// ── Document sérialisé ───────────────────────────────────────────────────────

internal sealed class MonthlyDeclarationModelDocument
{
    public string? ModelVersion { get; set; }

    /// <summary>Présent sur le catalogue d'amorçage embarqué ; absent d'un modèle exporté.</summary>
    public string? CatalogVersion { get; set; }

    public DateTime? ExportedAt { get; set; }
    public List<MonthlyDeclarationModelFamilyEntry>? Families { get; set; }
    public List<MonthlyDeclarationModelRubricEntry>? Rubrics { get; set; }
}

internal sealed class MonthlyDeclarationModelFamilyEntry
{
    public string? Family { get; set; }
    public bool IsIncluded { get; set; }
}

internal sealed class MonthlyDeclarationModelRubricEntry
{
    public string? Code { get; set; }
    public string? Family { get; set; }
    public string? Label { get; set; }
    public string? ReportCode { get; set; }
    public string? GrossKind { get; set; }
    public string? WithheldKind { get; set; }
    public string? GrossSide { get; set; }
    public string? WithheldSide { get; set; }
    public decimal RatePercent { get; set; }
    public decimal? FixedGrossAmount { get; set; }
    public decimal? FixedWithheldAmount { get; set; }
    public string? PayrollComponent { get; set; }
    public string? WithheldPayrollComponent { get; set; }

    /// <summary>Facultatif (apparu en dm-model-v2) : nom de la valeur documentaire de la colonne brut.</summary>
    public string? GrossDocumentSource { get; set; }

    /// <summary>Facultatif (apparu en dm-model-v2) : nom de la valeur documentaire de la colonne retenue.</summary>
    public string? WithheldDocumentSource { get; set; }

    public DateTime? EffectiveFrom { get; set; }
    public DateTime? EffectiveTo { get; set; }

    /// <summary>Facultatif : absent du catalogue d'amorçage, où tout est actif par construction.</summary>
    public bool? IsActive { get; set; }

    public int DisplayOrder { get; set; }
    public List<MonthlyDeclarationModelAccountEntry>? GrossAccounts { get; set; }
    public List<MonthlyDeclarationModelAccountEntry>? WithheldAccounts { get; set; }
}

internal sealed class MonthlyDeclarationModelAccountEntry
{
    public string? Number { get; set; }
    public string? Mode { get; set; }
}
