using System.Globalization;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.OfficialForm;

/// <summary>
/// Projette le détail par rubrique d'une déclaration sur les cases du formulaire officiel.
/// </summary>
/// <remarks>
/// Fonction pure : aucune dépendance sur le PDF ni sur l'infrastructure, comme le binder principal
/// dont elle complète le travail.
/// </remarks>
public static class MonthlyDeclarationLineFormBinder
{
    /// <summary>Tolérance d'arrondi au millime, identique au reste de la chaîne.</summary>
    public const decimal Epsilon = 0.001m;

    /// <summary>
    /// Construit le dictionnaire « clé de case → montant » issu des rubriques.
    /// </summary>
    /// <param name="lines">Détail par rubrique de la période.</param>
    /// <param name="declaredFamilyTotals">
    /// Montant que la déclaration porte pour chaque famille. Sert de plafond : une famille dont le
    /// détail dépasse le total déclaré est abandonnée en entier.
    /// </param>
    /// <param name="formVersion">Millésime du formulaire (ex. <c>mensuelle-2026</c>).</param>
    /// <remarks>
    /// <para>
    /// <b>Règle de sûreté, par famille.</b> Le total déclaré fait foi ; le détail n'est
    /// qu'informatif. Si la ventilation d'une famille excède son total, elle est abandonnée plutôt
    /// que reportée — mieux vaut une déclaration moins détaillée qu'une déclaration fausse. Le
    /// cloisonnement par famille est délibéré : c'est la correction qu'a demandée la ventilation
    /// historique de la retenue à la source, où un dépassement sur les factures emportait au passage
    /// la retenue salariale.
    /// </para>
    /// <para>
    /// La famille « autres informations » ne produit aucune case : elle est déclarative, ne porte
    /// aucun montant à payer, et le millésime 2026 ne lui a pas calibré de cellule.
    /// </para>
    /// </remarks>
    public static IReadOnlyDictionary<string, decimal> Project(
        IReadOnlyList<MonthlyDeclarationLineDto>? lines,
        IReadOnlyDictionary<MonthlyDeclarationFamily, decimal> declaredFamilyTotals,
        string formVersion)
    {
        var boxes = new Dictionary<string, decimal>(StringComparer.Ordinal);
        if (lines is null || lines.Count == 0)
            return boxes;

        foreach (var group in lines.GroupBy(l => (MonthlyDeclarationFamily)l.Family))
        {
            var decision = Decide(group.Key, group.ToList(), declaredFamilyTotals, formVersion);
            if (decision.SuppressedReason is not null)
                continue;

            foreach (var (line, target) in decision.Printed)
            {
                // Plusieurs rubriques peuvent viser la même case — commissions et loyers relèvent
                // tous deux de l'article 4 : on cumule, on n'écrase pas. L'assiette n'est reportée
                // que positive, comme la ventilation historique (« TotalHT > 0 », « net imposable
                // > 0 ») : une assiette nulle écrirait une case vide par-dessus celle du binder.
                if (line.Gross > 0m)
                    Accumulate(boxes, target.BaseKey, line.Gross);
                Accumulate(boxes, target.AmountKey, line.Withheld);
            }
        }

        return boxes;
    }

    /// <summary>
    /// Ajoute à chaque ligne les signalements qui expliquent son sort sur le formulaire officiel :
    /// code rapport sans case, ou famille écartée par le contrôle de total.
    /// </summary>
    /// <remarks>
    /// Même décision que <see cref="Project"/>, calculée par la même fonction : la raison affichée à
    /// l'écran et le formulaire tamponné ne peuvent pas se contredire. Les familles que le
    /// formulaire ne reçoit jamais par ce chemin (T.V.A, autres informations) ne sont pas
    /// signalées : ce n'est pas une anomalie, c'est la règle.
    /// </remarks>
    public static IReadOnlyList<MonthlyDeclarationLineDto> Annotate(
        IReadOnlyList<MonthlyDeclarationLineDto>? lines,
        IReadOnlyDictionary<MonthlyDeclarationFamily, decimal> declaredFamilyTotals,
        string formVersion)
    {
        if (lines is null || lines.Count == 0)
            return Array.Empty<MonthlyDeclarationLineDto>();

        var suppressed = new Dictionary<MonthlyDeclarationFamily, (string Reason, HashSet<MonthlyDeclarationLineDto> Lines)>();
        foreach (var group in lines.GroupBy(l => (MonthlyDeclarationFamily)l.Family))
        {
            var decision = Decide(group.Key, group.ToList(), declaredFamilyTotals, formVersion);
            if (decision.SuppressedReason is not null)
            {
                suppressed[group.Key] = (
                    decision.SuppressedReason,
                    decision.Printed.Select(p => p.Line).ToHashSet());
            }
        }

        return lines.Select(line =>
        {
            var family = (MonthlyDeclarationFamily)line.Family;
            if (!IsProjectedFamily(family))
                return line;

            var added = new List<MonthlyDeclarationDiagnosticDto>();

            if (IsUnmapped(formVersion, family, line.ReportCode))
            {
                added.Add(new MonthlyDeclarationDiagnosticDto
                {
                    Kind = (int)RubricDiagnosticKind.UnmappedReportCode,
                    Detail = line.ReportCode
                });
            }

            if (suppressed.TryGetValue(family, out var s) && s.Lines.Contains(line))
            {
                added.Add(new MonthlyDeclarationDiagnosticDto
                {
                    Kind = (int)RubricDiagnosticKind.SuppressedFromForm,
                    Detail = s.Reason
                });
            }

            return added.Count == 0
                ? line
                : line with { Diagnostics = line.Diagnostics.Concat(added).ToList() };
        }).ToList();
    }

    // ── Décision par famille ──────────────────────────────────────────────────

    /// <summary>
    /// Lignes qu'une famille imprime, et raison pour laquelle elle n'imprime rien le cas échéant.
    /// </summary>
    private sealed record FamilyDecision(
        IReadOnlyList<(MonthlyDeclarationLineDto Line, OfficialFormTarget Target)> Printed,
        string? SuppressedReason);

    private static readonly FamilyDecision Nothing =
        new(Array.Empty<(MonthlyDeclarationLineDto, OfficialFormTarget)>(), null);

    /// <remarks>
    /// <para>
    /// <b>Une ligne sans retenue positive ne produit aucune case</b>, ni base ni montant. C'est la
    /// règle de la ventilation historique (catégories à retenue nulle sautées, IRPP nul non
    /// reporté) : sans elle, une rubrique à zéro effacerait, par un <c>null</c>, la case que le
    /// binder principal venait de poser, et une ligne négative serait imprimée.
    /// </para>
    /// <para>
    /// <b>Une famille dont le total déclaré est nul ou négatif n'imprime aucun détail</b> : le
    /// binder principal n'imprime rien pour elle non plus.
    /// </para>
    /// <para>
    /// <b>Familles à case unique</b> (TFP, FOPROLOS, autres taxes sur le CA) : le détail n'est
    /// projeté que s'il égale le total déclaré, au millime près. Les totaux restant modifiables à la
    /// main, un total corrigé que la ligne calculée viendrait écraser dans la case de détail — le
    /// total et le récapitulatif gardant la valeur corrigée — ferait se contredire le formulaire.
    /// Le binder principal, qui lit le total déclaré, garde alors la main.
    /// </para>
    /// <para>
    /// <b>Retenue à la source</b> : le détail est une ventilation du total, il peut lui être
    /// inférieur (reliquat sans case) mais pas le dépasser. Seules les lignes qui ont une case
    /// comptent, comme dans la ventilation historique.
    /// </para>
    /// </remarks>
    private static FamilyDecision Decide(
        MonthlyDeclarationFamily family,
        IReadOnlyList<MonthlyDeclarationLineDto> lines,
        IReadOnlyDictionary<MonthlyDeclarationFamily, decimal> declaredFamilyTotals,
        string formVersion)
    {
        if (!IsProjectedFamily(family))
            return Nothing;

        var printed = new List<(MonthlyDeclarationLineDto, OfficialFormTarget)>();
        foreach (var line in lines)
        {
            if (line.Withheld <= 0m)
                continue;

            var target = MonthlyDeclarationReportCodeMap.Resolve(formVersion, family, line.ReportCode);
            if (target?.AmountKey is null)
                continue;

            printed.Add((line, target));
        }

        if (printed.Count == 0)
            return Nothing;

        var declared = declaredFamilyTotals.TryGetValue(family, out var total) ? total : 0m;
        var ventilated = printed.Sum(p => p.Item1.Withheld);

        if (declared <= 0m)
            return new FamilyDecision(printed, "total déclaré nul pour la famille");

        if (IsSingleBoxFamily(family))
        {
            return Math.Abs(ventilated - declared) <= Epsilon
                ? new FamilyDecision(printed, null)
                : new FamilyDecision(printed,
                    $"détail {Millimes(ventilated)} ≠ total déclaré {Millimes(declared)} : la case reprend le total déclaré");
        }

        return ventilated <= declared + Epsilon
            ? new FamilyDecision(printed, null)
            : new FamilyDecision(printed, $"détail {Millimes(ventilated)} > total déclaré {Millimes(declared)}");
    }

    /// <summary>Montant au millime, indépendant de la culture du serveur.</summary>
    private static string Millimes(decimal amount) =>
        amount.ToString("0.000", CultureInfo.InvariantCulture);

    /// <summary>
    /// La T.V.A est hors du moteur : ses cases viennent toujours du module TVA, jamais des
    /// rubriques. « Autres informations » est déclarative, sans case calibrée.
    /// </summary>
    private static bool IsProjectedFamily(MonthlyDeclarationFamily family) =>
        family is not (MonthlyDeclarationFamily.Vat or MonthlyDeclarationFamily.OtherInformation);

    private static bool IsSingleBoxFamily(MonthlyDeclarationFamily family) =>
        family is MonthlyDeclarationFamily.Tfp
            or MonthlyDeclarationFamily.Foprolos
            or MonthlyDeclarationFamily.OtherTurnoverTaxes;

    /// <summary>
    /// Code rapport qui ne vise aucune case du millésime. « * » n'en est pas un : c'est le choix
    /// explicite de ne reporter le montant qu'au total.
    /// </summary>
    private static bool IsUnmapped(string formVersion, MonthlyDeclarationFamily family, string? reportCode) =>
        !string.Equals(reportCode?.Trim(), "*", StringComparison.Ordinal)
        && MonthlyDeclarationReportCodeMap.Resolve(formVersion, family, reportCode ?? string.Empty) is null;

    /// <summary>
    /// Totaux déclarés par famille, tels que la déclaration les porte. Sert de plafond au
    /// garde-fou ci-dessus.
    /// </summary>
    public static IReadOnlyDictionary<MonthlyDeclarationFamily, decimal> DeclaredFamilyTotals(
        VatDeclarationDto declaration) =>
        new Dictionary<MonthlyDeclarationFamily, decimal>
        {
            [MonthlyDeclarationFamily.Withholding] = declaration.WithholdingTax,
            [MonthlyDeclarationFamily.Tfp] = declaration.Tfp,
            [MonthlyDeclarationFamily.Foprolos] = declaration.Foprolos,
            [MonthlyDeclarationFamily.ConsumptionDuty] = declaration.ConsumptionDuty,
            // La TVA n'est pas remontée depuis les rubriques : son plafond est la TVA collectée,
            // seule grandeur que le détail par taux peut totaliser.
            [MonthlyDeclarationFamily.Vat] =
                declaration.CollectedVat19 + declaration.CollectedVat13 + declaration.CollectedVat7
                + declaration.DeductibleVatGoods + declaration.DeductibleVatAssets,
            [MonthlyDeclarationFamily.OtherTurnoverTaxes] = declaration.Fodec,
            [MonthlyDeclarationFamily.StampDuty] = declaration.DroitTimbre,
            [MonthlyDeclarationFamily.HotelTax] = declaration.HotelTax,
            [MonthlyDeclarationFamily.Tcl] = declaration.Tcl,
            [MonthlyDeclarationFamily.LicenceFee] = declaration.LicenceFee
        };

    private static void Accumulate(Dictionary<string, decimal> boxes, string? key, decimal amount)
    {
        if (string.IsNullOrEmpty(key))
            return;

        boxes[key] = boxes.TryGetValue(key, out var existing) ? existing + amount : amount;
    }
}
