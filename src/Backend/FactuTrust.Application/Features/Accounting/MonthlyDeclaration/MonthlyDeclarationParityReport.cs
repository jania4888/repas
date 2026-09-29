using System.Globalization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.OfficialForm;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

// Rapport de parité : la preuve, mois par mois, que le calcul paramétré reproduit le calcul
// historique avant que ce dernier ne soit retiré. Code temporaire : il disparaît avec l'historique,
// qui est son oracle.

/// <summary>Verdict d'une comparaison entre calcul historique et calcul paramétré.</summary>
public enum ParityVerdict
{
    /// <summary>Identique au millime.</summary>
    Exact = 0,

    /// <summary>
    /// Écart prouvé dû à la seule règle d'arrondi : recalculer les deux arrondis sur la retenue
    /// brute de chaque ligne redonne exactement les deux montants comparés.
    /// </summary>
    Rounding = 1,

    /// <summary>Écart non expliqué : à corriger avant le retrait de l'historique.</summary>
    Gap = 2
}

/// <summary>
/// Comparaisons du rapport de parité. Fonctions pures : chaque verdict se vérifie sans base.
/// </summary>
public static class MonthlyDeclarationParityComparer
{
    /// <summary>Familles produites par le moteur, et le montant qui les porte sur la déclaration.</summary>
    public static readonly IReadOnlyList<(MonthlyDeclarationFamily Family, Func<VatDeclarationDto, decimal> Amount)> Families =
    [
        (MonthlyDeclarationFamily.Withholding, d => d.WithholdingTax),
        (MonthlyDeclarationFamily.Tfp, d => d.Tfp),
        (MonthlyDeclarationFamily.Foprolos, d => d.Foprolos),
        (MonthlyDeclarationFamily.ConsumptionDuty, d => d.ConsumptionDuty),
        (MonthlyDeclarationFamily.OtherTurnoverTaxes, d => d.Fodec),
        (MonthlyDeclarationFamily.StampDuty, d => d.DroitTimbre),
        (MonthlyDeclarationFamily.HotelTax, d => d.HotelTax),
        (MonthlyDeclarationFamily.Tcl, d => d.Tcl),
        (MonthlyDeclarationFamily.LicenceFee, d => d.LicenceFee)
    ];

    /// <summary>
    /// Compare le montant d'une famille.
    /// </summary>
    /// <param name="lines">Lignes paramétrées de la famille, avec leur retenue avant arrondi.</param>
    /// <remarks>
    /// L'historique arrondit au millime « bancaire » (demi-millime vers le pair), le moteur au
    /// demi-millime écarté de zéro. L'écart n'est classé « arrondi » que si les deux montants sont
    /// exactement, ligne à ligne, ces deux arrondis des mêmes retenues brutes. Toute autre
    /// explication — taux différent, assiette différente, arrondi sur le total plutôt que par
    /// ligne — reste un écart : le rapport ne suppose rien, il prouve ou il signale.
    /// </remarks>
    public static ParityVerdict CompareFamily(decimal legacy, decimal configured, IReadOnlyList<RubricEvaluation> lines)
    {
        if (legacy == configured)
            return ParityVerdict.Exact;
        if (lines.Count == 0)
            return ParityVerdict.Gap;

        var bankers = lines.Sum(l => Math.Round(l.WithheldUnrounded, MillimeRounding.Decimals, MidpointRounding.ToEven));
        var awayFromZero = lines.Sum(l => MillimeRounding.Round(l.WithheldUnrounded));

        return bankers == legacy && awayFromZero == configured
            ? ParityVerdict.Rounding
            : ParityVerdict.Gap;
    }

    /// <summary>
    /// Cases du formulaire officiel qui diffèrent, avec leur verdict.
    /// </summary>
    /// <param name="provenRoundingGaps">
    /// Écarts signés (paramétré − historique) des familles classées « arrondi ». Une case qui
    /// diffère exactement d'une somme de ces écarts — la case de la famille, un sous-total, le total
    /// à payer — hérite du verdict « arrondi » ; toute autre différence est un écart.
    /// </param>
    public static IReadOnlyList<MonthlyDeclarationParityBoxDto> CompareBoxes(
        IReadOnlyDictionary<string, string?> legacy,
        IReadOnlyDictionary<string, string?> configured,
        IReadOnlyList<decimal> provenRoundingGaps)
    {
        var explainable = SubsetSums(provenRoundingGaps);
        var differences = new List<MonthlyDeclarationParityBoxDto>();

        foreach (var key in legacy.Keys.Union(configured.Keys).Order(StringComparer.Ordinal))
        {
            var before = Normalize(legacy.GetValueOrDefault(key));
            var after = Normalize(configured.GetValueOrDefault(key));
            if (string.Equals(before, after, StringComparison.Ordinal))
                continue;

            var verdict = TryParseAmount(before, out var a)
                          && TryParseAmount(after, out var b)
                          && explainable.Contains(b - a)
                ? ParityVerdict.Rounding
                : ParityVerdict.Gap;

            differences.Add(new MonthlyDeclarationParityBoxDto
            {
                Key = key,
                Legacy = before,
                Configured = after,
                Verdict = (int)verdict
            });
        }

        return differences;
    }

    /// <summary>Verdict le plus grave d'un ensemble.</summary>
    public static ParityVerdict Worst(IEnumerable<ParityVerdict> verdicts) =>
        verdicts.DefaultIfEmpty(ParityVerdict.Exact).Max();

    private static string? Normalize(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>Montant au format du formulaire (« 1 234,500 ») ; case vide = 0.</summary>
    private static bool TryParseAmount(string? value, out decimal amount)
    {
        amount = 0m;
        if (value is null)
            return true;

        // Séparateur de milliers : espace, espace insécable ou espace fine insécable selon la
        // source — tous des blancs au sens de char.IsWhiteSpace.
        var invariant = new string(value.Where(c => !char.IsWhiteSpace(c)).ToArray()).Replace(',', '.');
        return decimal.TryParse(invariant, NumberStyles.Number, CultureInfo.InvariantCulture, out amount);
    }

    /// <summary>Sommes non vides des écarts : au plus neuf familles, donc au plus 511 sommes.</summary>
    private static HashSet<decimal> SubsetSums(IReadOnlyList<decimal> gaps)
    {
        var sums = new HashSet<decimal>();
        foreach (var gap in gaps)
        {
            foreach (var existing in sums.ToList())
                sums.Add(existing + gap);
            sums.Add(gap);
        }

        return sums;
    }
}

/// <param name="FromMonth">Premier mois contrôlé (1 à 12).</param>
/// <param name="ToMonth">Dernier mois contrôlé, dans la même année.</param>
public sealed record GetMonthlyDeclarationParityReportQuery(int Year, int FromMonth, int ToMonth)
    : IRequest<Result<MonthlyDeclarationParityReportDto>>;

/// <summary>
/// Calcule, mois par mois, la déclaration par l'historique et par la configuration, et compare les
/// montants par famille <b>et</b> les cases du formulaire officiel.
/// </summary>
/// <remarks>
/// <para>
/// <b>Lecture pure.</b> Le calcul paramétré est forcé sans lire ni écrire le régime du dossier ;
/// la rampe de parité n'est pas créditée ; rien n'est enregistré. Relancer le rapport ne change
/// rien.
/// </para>
/// <para>
/// Les mois sont calculés l'un après l'autre et la demande est annulable : douze mois complets
/// interrogent la base douze fois, en parallèle ils satureraient le pool de connexions.
/// </para>
/// </remarks>
public sealed class GetMonthlyDeclarationParityReportQueryHandler
    : IRequestHandler<GetMonthlyDeclarationParityReportQuery, Result<MonthlyDeclarationParityReportDto>>
{
    public const int MaxMonths = 12;

    private readonly GetVatDeclarationQueryHandler _declarations;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;
    private readonly TimeProvider _timeProvider;

    public GetMonthlyDeclarationParityReportQueryHandler(
        GetVatDeclarationQueryHandler declarations,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings,
        TimeProvider timeProvider)
    {
        _declarations = declarations;
        _currentUser = currentUser;
        _settings = settings.Value;
        _timeProvider = timeProvider;
    }

    public async Task<Result<MonthlyDeclarationParityReportDto>> Handle(
        GetMonthlyDeclarationParityReportQuery request, CancellationToken cancellationToken)
    {
        // Le rapport expose des montants de brouillon : il est réservé au cabinet, comme le calcul.
        if (!_currentUser.IsAccountingFirmDelegatedContext)
        {
            return Result.Failure<MonthlyDeclarationParityReportDto>(Error.Forbidden(
                "Le rapport de parité est réservé au cabinet comptable, en contexte dossier client."));
        }

        if (!_settings.MonthlyDeclarationV2Enabled)
        {
            return Result.Failure<MonthlyDeclarationParityReportDto>(Error.Validation(
                "MonthlyDeclaration",
                "La déclaration mensuelle unique n'est pas activée : il n'y a pas de calcul à comparer."));
        }

        if (!_settings.ConfigurableLinesActive)
            return Result.Failure<MonthlyDeclarationParityReportDto>(MonthlyDeclarationGuard.Disabled);

        if (request.Year is < 2000 or > 2100
            || request.FromMonth is < 1 or > 12
            || request.ToMonth is < 1 or > 12
            || request.FromMonth > request.ToMonth)
        {
            return Result.Failure<MonthlyDeclarationParityReportDto>(Error.Validation(
                "Period",
                $"Période invalide : de 1 à {MaxMonths} mois consécutifs d'une même année."));
        }

        var months = new List<MonthlyDeclarationParityMonthDto>();
        var companyName = string.Empty;
        var nif = string.Empty;

        for (var month = request.FromMonth; month <= request.ToMonth; month++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var probe = await _declarations.ProbeParityAsync(request.Year, month, cancellationToken);
            if (probe.IsFailure)
            {
                months.Add(new MonthlyDeclarationParityMonthDto
                {
                    Month = month,
                    Verdict = (int)ParityVerdict.Gap,
                    Error = probe.Error.Description
                });
                continue;
            }

            companyName = probe.Value.Configured.CompanyName;
            nif = probe.Value.Configured.Nif;
            months.Add(CompareMonth(month, probe.Value));
        }

        var exact = months.Count(m => m.Verdict == (int)ParityVerdict.Exact);
        var rounding = months.Count(m => m.Verdict == (int)ParityVerdict.Rounding);
        var gaps = months.Count(m => m.Verdict == (int)ParityVerdict.Gap);

        return Result.Success(new MonthlyDeclarationParityReportDto
        {
            Year = request.Year,
            FromMonth = request.FromMonth,
            ToMonth = request.ToMonth,
            GeneratedAtUtc = _timeProvider.GetUtcNow().UtcDateTime,
            GeneratedBy = _currentUser.Email ?? string.Empty,
            CompanyName = companyName,
            Nif = nif,
            Months = months,
            ExactMonths = exact,
            RoundingOnlyMonths = rounding,
            MonthsWithGap = gaps,
            ReadyForRetirement = gaps == 0 && months.Count > 0
        });
    }

    private static MonthlyDeclarationParityMonthDto CompareMonth(
        int month, GetVatDeclarationQueryHandler.ParityProbe probe)
    {
        var included = probe.Composed.ActiveFamilies
            .Concat(probe.Composed.FamiliesWithoutRubric)
            .ToHashSet();

        var families = MonthlyDeclarationParityComparer.Families
            .Select(f =>
            {
                var legacy = f.Amount(probe.Legacy);
                var configured = f.Amount(probe.Configured);
                var lines = probe.Composed.Lines.Where(l => l.Family == f.Family).ToList();

                return new MonthlyDeclarationParityFamilyDto
                {
                    Family = (int)f.Family,
                    IsIncluded = included.Contains(f.Family),
                    Legacy = legacy,
                    Configured = configured,
                    Gap = configured - legacy,
                    Verdict = (int)MonthlyDeclarationParityComparer.CompareFamily(legacy, configured, lines)
                };
            })
            .ToList();

        var provenRoundingGaps = families
            .Where(f => f.Verdict == (int)ParityVerdict.Rounding)
            .Select(f => f.Gap)
            .ToList();

        var boxes = MonthlyDeclarationParityComparer.CompareBoxes(
            MonthlyDeclarationOfficialFormInputs.Values(probe.Legacy, probe.WithholdingReportRows),
            MonthlyDeclarationOfficialFormInputs.Values(probe.Configured, probe.WithholdingReportRows),
            provenRoundingGaps);

        var verdict = MonthlyDeclarationParityComparer.Worst(
            families.Select(f => (ParityVerdict)f.Verdict)
                .Concat(boxes.Select(b => (ParityVerdict)b.Verdict)));

        return new MonthlyDeclarationParityMonthDto
        {
            Month = month,
            SavedStatus = probe.SavedStatus is { } status ? (int)status : null,
            Verdict = (int)verdict,
            Families = families,
            BoxDifferences = boxes,
            Diagnostics = probe.Configured.MonthlyDeclarationDiagnostics
        };
    }
}
