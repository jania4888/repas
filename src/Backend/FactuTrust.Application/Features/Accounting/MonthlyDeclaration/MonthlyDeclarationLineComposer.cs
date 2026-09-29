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
    public required MonthlyDeclarationMode Mode { get; init; }

    public IReadOnlyList<RubricEvaluation> Lines { get; init; } = Array.Empty<RubricEvaluation>();

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

    /// <summary>Rien à composer : dossier en calcul historique, ou drapeau éteint.</summary>
    public static ComposedDeclarationLines Inactive { get; } =
        new() { Mode = MonthlyDeclarationMode.Legacy };

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
        // Drapeau éteint : un test booléen, aucune requête. C'est ce qui garantit qu'un dossier non
        // concerné ne paie strictement rien pour l'existence de cette fonctionnalité.
        if (!_settings.ConfigurableLinesActive)
            return ComposedDeclarationLines.Inactive;

        var settings = await _config.GetSettingsAsync(cancellationToken);
        var mode = settings?.ResolveModeFor(year, month) ?? MonthlyDeclarationMode.Legacy;
        if (mode == MonthlyDeclarationMode.Legacy)
            return ComposedDeclarationLines.Inactive;

        return await ComposeInModeAsync(year, month, mode, payroll, documents, cancellationToken);
    }

    /// <summary>
    /// Compose la période comme si le dossier était en calcul paramétré, <b>sans lire ni écrire</b>
    /// son régime. Réservé au rapport de parité, qui doit montrer ce que produira le calcul
    /// paramétré une fois l'historique retiré, sans déplacer la rampe ni toucher aux réglages.
    /// </summary>
    /// <remarks>
    /// Seul l'interrupteur de plateforme est respecté : éteint, il n'y a pas de calcul paramétré à
    /// montrer.
    /// </remarks>
    public Task<ComposedDeclarationLines> ComposeAsConfiguredAsync(
        int year,
        int month,
        PayrollMonthlyContribution payroll,
        DeclarationDocumentContribution documents,
        CancellationToken cancellationToken = default) =>
        _settings.ConfigurableLinesActive
            ? ComposeInModeAsync(year, month, MonthlyDeclarationMode.Configured, payroll, documents, cancellationToken)
            : Task.FromResult(ComposedDeclarationLines.Inactive);

    private async Task<ComposedDeclarationLines> ComposeInModeAsync(
        int year,
        int month,
        MonthlyDeclarationMode mode,
        PayrollMonthlyContribution payroll,
        DeclarationDocumentContribution? documents,
        CancellationToken cancellationToken)
    {

        var familySettings = await _config.GetFamilySettingsAsync(cancellationToken);
        var includedFamilies = familySettings
            .Where(f => f.IsIncluded)
            .Select(f => f.Family)
            .ToHashSet();

        // Aucune famille cochée : rien à composer. Un dossier CONFIGURÉ reste pourtant configuré —
        // le rendre « historique » faisait afficher « Calcul historique » à un dossier basculé.
        // En contrôle de parité, en revanche, on reste inactif : un contrôle qui ne mesure aucune
        // famille ne doit pas allonger la série sans écart qui ouvre la bascule.
        if (includedFamilies.Count == 0)
        {
            return mode == MonthlyDeclarationMode.Configured
                ? new ComposedDeclarationLines { Mode = MonthlyDeclarationMode.Configured }
                : ComposedDeclarationLines.Inactive;
        }

        var rubrics = (await _config.GetRubricsAsync(includeInactive: false, cancellationToken))
            .Where(r => includedFamilies.Contains(r.Family) && r.IsApplicableTo(year, month))
            .ToList();

        var withRubric = rubrics.Select(r => r.Family).ToHashSet();
        var withoutRubric = includedFamilies.Where(f => !withRubric.Contains(f)).ToHashSet();

        var data = await ResolvePeriodDataAsync(
            year, month, rubrics, payroll, documents ?? DeclarationDocumentContribution.None, cancellationToken);
        var lines = MonthlyDeclarationRubricEvaluator.Evaluate(rubrics, data);

        var diagnostics = lines
            .SelectMany(l => l.Diagnostics)
            .Concat(withoutRubric.Select(f =>
                new RubricDiagnostic(RubricDiagnosticKind.MissingRubricForFamily, f.ToString())))
            .Concat(MonthlyDeclarationSourceOverlap.AllConflicts(rubrics).Select(c =>
                new RubricDiagnostic(
                    RubricDiagnosticKind.DuplicateSourceRead,
                    MonthlyDeclarationSourceOverlap.Refusal(c).Description)))
            .ToList();

        return new ComposedDeclarationLines
        {
            Mode = mode,
            Lines = lines,
            ActiveFamilies = withRubric,
            FamiliesWithoutRubric = withoutRubric,
            Diagnostics = diagnostics
        };
    }

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
