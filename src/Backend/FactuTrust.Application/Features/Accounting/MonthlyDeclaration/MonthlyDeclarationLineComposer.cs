using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.Services;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

/// <summary>
/// Résultat de la composition : ce que la configuration du dossier produit pour une période, et
/// sous quel régime ce résultat doit être utilisé.
/// </summary>
public sealed record ComposedDeclarationLines
{
    /// <summary>
    /// La configuration a-t-elle été évaluée ? Fausse seulement quand la déclaration mensuelle
    /// unique est éteinte sur la plateforme — il n'y a alors aucun montant à composer.
    /// </summary>
    public bool IsActive { get; init; }

    public IReadOnlyList<RubricEvaluation> Lines { get; init; } = Array.Empty<RubricEvaluation>();

    /// <summary>Familles que le dossier déclare — cochées dans sa configuration.</summary>
    /// <remarks>
    /// C'est cette liste, et non la présence de lignes, qui décide d'un montant : une famille cochée
    /// sans rubrique vaut 0 <b>et</b> le signale, une famille décochée vaut 0 sans discussion.
    /// </remarks>
    public IReadOnlySet<MonthlyDeclarationFamily> IncludedFamilies { get; init; } =
        new HashSet<MonthlyDeclarationFamily>();

    /// <summary>Familles incluses par le dossier <b>et</b> pourvues d'au moins une rubrique applicable.</summary>
    public IReadOnlySet<MonthlyDeclarationFamily> ActiveFamilies { get; init; } =
        new HashSet<MonthlyDeclarationFamily>();

    /// <summary>
    /// Familles incluses mais sans aucune rubrique applicable à la période. En mode configuré,
    /// c'est une anomalie bloquante : elle produirait un zéro qu'aucun contrôle ne rattraperait.
    /// </summary>
    public IReadOnlySet<MonthlyDeclarationFamily> FamiliesWithoutRubric { get; init; } =
        new HashSet<MonthlyDeclarationFamily>();

    public IReadOnlyList<RubricDiagnostic> Diagnostics { get; init; } = Array.Empty<RubricDiagnostic>();

    /// <summary>Rien à composer : déclaration mensuelle unique éteinte sur la plateforme.</summary>
    public static ComposedDeclarationLines Inactive { get; } = new();

    /// <summary>Total de la colonne retenue pour une famille.</summary>
    public decimal WithheldFor(MonthlyDeclarationFamily family) =>
        Lines.Where(l => l.Family == family).Sum(l => l.Withheld);

    /// <summary>Total de la colonne brut pour une famille (assiette reportée sur le formulaire).</summary>
    public decimal GrossFor(MonthlyDeclarationFamily family) =>
        Lines.Where(l => l.Family == family).Sum(l => l.Gross);
}

/// <summary>
/// Résout les données de période, puis confie l'évaluation au moteur pur.
/// </summary>
/// <remarks>
/// <para>
/// C'est le seul point du chantier qui touche la base pour calculer une déclaration, et il le fait
/// en <b>une</b> interrogation du journal : l'union des comptes de toutes les rubriques actives est
/// réunie avant l'appel. Découper par rubrique produirait une centaine d'allers-retours pour un
/// seul calcul mensuel.
/// </para>
/// <para>
/// L'apport de la paie n'est pas rechargé : il est passé par l'appelant, qui l'a déjà obtenu du
/// fournisseur dédié. La dépendance du domaine fiscal vers le domaine paie reste ainsi unique.
/// </para>
/// </remarks>
public sealed class MonthlyDeclarationLineComposer
{
    private readonly IMonthlyDeclarationConfigRepository _config;
    private readonly IJournalEntryRepository _journalEntries;
    private readonly IChartOfAccountRepository _chartOfAccounts;
    private readonly AccountingSettings _settings;

    public MonthlyDeclarationLineComposer(
        IMonthlyDeclarationConfigRepository config,
        IJournalEntryRepository journalEntries,
        IChartOfAccountRepository chartOfAccounts,
        IOptions<AccountingSettings> settings)
    {
        _config = config;
        _journalEntries = journalEntries;
        _chartOfAccounts = chartOfAccounts;
        _settings = settings.Value;
    }

    public async Task<ComposedDeclarationLines> ComposeAsync(
        int year,
        int month,
        PayrollMonthlyContribution payroll,
        DeclarationDocumentContribution? documents = null,
        CancellationToken cancellationToken = default)
    {
        // Déclaration mensuelle unique éteinte : un test booléen, aucune requête. Les scalaires que
        // le moteur alimente n'existent pas dans ce mode, il n'y a rien à composer.
        if (!_settings.MonthlyDeclarationV2Enabled)
            return ComposedDeclarationLines.Inactive;

        // Le catalogue n'a pas encore été posé sur ce dossier : sa configuration ne reproduit pas ce
        // qu'il déclarait. On compose tout de même — l'écran doit montrer ce qu'il y a — mais le
        // signalement rend l'enregistrement impossible.
        var catalogApplied = await _config.IsCatalogAppliedAsync(cancellationToken);

        var familySettings = await _config.GetFamilySettingsAsync(cancellationToken);
        var includedFamilies = familySettings
            .Where(f => f.IsIncluded)
            .Select(f => f.Family)
            .ToHashSet();

        // TOUTES les rubriques applicables sont évaluées, y compris celles des familles décochées :
        // c'est ce qui permet de dire « cette famille que vous ne déclarez pas aurait produit tant ».
        var rubrics = (await _config.GetRubricsAsync(includeInactive: false, cancellationToken))
            .Where(r => r.IsApplicableTo(year, month))
            .ToList();

        var data = await ResolvePeriodDataAsync(
            year, month, rubrics, payroll, documents ?? DeclarationDocumentContribution.None, cancellationToken);
        var evaluated = MonthlyDeclarationRubricEvaluator.Evaluate(rubrics, data);

        var lines = evaluated.Where(l => includedFamilies.Contains(l.Family)).ToList();
        var withRubric = lines.Select(l => l.Family).ToHashSet();
        var withoutRubric = includedFamilies
            .Where(f => !withRubric.Contains(f) && MovesAnAmount(f))
            .ToHashSet();

        // Les signalements ne portent que sur ce que le dossier déclare : une rubrique cassée dans
        // une famille décochée ne doit pas bloquer l'enregistrement d'une déclaration qui l'ignore.
        var includedRubrics = rubrics.Where(r => includedFamilies.Contains(r.Family)).ToList();

        var diagnostics = lines
            .SelectMany(l => l.Diagnostics)
            .Concat(withoutRubric.Select(f =>
                new RubricDiagnostic(RubricDiagnosticKind.MissingRubricForFamily, f.ToString())))
            .Concat(MonthlyDeclarationSourceOverlap.AllConflicts(includedRubrics).Select(c =>
                new RubricDiagnostic(
                    RubricDiagnosticKind.DuplicateSourceRead,
                    MonthlyDeclarationSourceOverlap.Refusal(c).Description)))
            .Concat(ExcludedFamiliesWithAmount(evaluated, includedFamilies))
            .ToList();

        if (!catalogApplied)
        {
            diagnostics.Insert(0, new RubricDiagnostic(
                RubricDiagnosticKind.ConfigurationNotInitialized,
                "La configuration de la déclaration mensuelle de ce dossier n'est pas encore "
                + "initialisée : les montants ci-dessous ne font pas foi."));
        }

        return new ComposedDeclarationLines
        {
            IsActive = true,
            Lines = lines,
            IncludedFamilies = includedFamilies,
            ActiveFamilies = withRubric,
            FamiliesWithoutRubric = withoutRubric,
            Diagnostics = diagnostics
        };
    }

    /// <summary>
    /// Une famille décochée dont les rubriques auraient produit un montant : le dossier a choisi de
    /// ne pas la déclarer, le montant vaut donc 0 — mais ce 0 doit se voir.
    /// </summary>
    private static IEnumerable<RubricDiagnostic> ExcludedFamiliesWithAmount(
        IReadOnlyList<RubricEvaluation> evaluated,
        IReadOnlySet<MonthlyDeclarationFamily> includedFamilies) =>
        evaluated
            .Where(l => !includedFamilies.Contains(l.Family) && MovesAnAmount(l.Family))
            .GroupBy(l => l.Family)
            .Where(g => g.Sum(l => l.Withheld) != 0m)
            .OrderBy(g => g.Key)
            .Select(g => new RubricDiagnostic(RubricDiagnosticKind.ExcludedFamilyWithAmount, g.Key.ToString()));

    /// <summary>
    /// La famille déplace-t-elle un montant déclaré ? La T.V.A vient du module T.V.A, et les
    /// « autres informations » n'ont que des cases de contexte : ni l'une ni l'autre ne doit faire
    /// refuser un enregistrement, ni produire un avertissement d'exclusion.
    /// </summary>
    private static bool MovesAnAmount(MonthlyDeclarationFamily family) =>
        family is not (MonthlyDeclarationFamily.Vat or MonthlyDeclarationFamily.OtherInformation);

    /// <summary>
    /// Résout les mouvements des comptes de toutes les rubriques en UNE interrogation du journal,
    /// et la liste des comptes existants pour distinguer « sans mouvement » d'« inexistant ».
    /// </summary>
    private async Task<RubricPeriodData> ResolvePeriodDataAsync(
        int year,
        int month,
        IReadOnlyList<MonthlyDeclarationRubric> rubrics,
        PayrollMonthlyContribution payroll,
        DeclarationDocumentContribution documents,
        CancellationToken cancellationToken)
    {
        var start = new DateTime(year, month, 1);
        var end = start.AddMonths(1).AddDays(-1);

        var exact = new HashSet<string>(StringComparer.Ordinal);
        var prefixes = new HashSet<string>(StringComparer.Ordinal);

        foreach (var account in rubrics.SelectMany(r => r.Accounts))
        {
            var bucket = account.MatchMode == RubricAccountMatchMode.Prefix ? prefixes : exact;
            bucket.Add(account.AccountNumber);
        }

        var movements = await _journalEntries.SumMovementsByAccountsAsync(
            exact, prefixes, start, end, cancellationToken);

        // Le plan comptable n'est chargé que si une rubrique désigne effectivement un compte :
        // une configuration entièrement en valeurs fixes ou issues de la paie n'en a pas besoin.
        var knownAccounts = exact.Count == 0 && prefixes.Count == 0
            ? new HashSet<string>(StringComparer.Ordinal)
            : (await _chartOfAccounts.GetAllActiveAsync(cancellationToken))
                .Select(a => a.AccountNumber)
                .ToHashSet(StringComparer.Ordinal);

        return new RubricPeriodData
        {
            Year = year,
            Month = month,
            MovementsByAccount = movements,
            Payroll = payroll,
            Documents = documents,
            KnownAccounts = knownAccounts
        };
    }
}
