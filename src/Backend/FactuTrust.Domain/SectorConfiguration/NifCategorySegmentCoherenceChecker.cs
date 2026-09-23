using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.SectorConfiguration;

/// <summary>
/// Non-blocking coherence check between the NIF's taxpayer category (the first letter, the key
/// glued to the seven digits on <c>NNNNNNNL/A/M/NNN</c>, still the "L" of the historical
/// <c>NNNNNNN/L/A/M/NNN</c> — see <see cref="NIF.TaxpayerCategory"/> /
/// <see cref="TaxpayerCategories"/>) and the <c>CompanySegment</c> chosen during registration
/// (plan §3.2). Deliberately narrow and fail-open, mirroring <see cref="UsualTaxRegimeCatalog"/>:
/// only flags the one clearly-incoherent case the plan calls out (association category vs a
/// non-association segment, and vice versa). An unknown/unmapped combination never produces a
/// warning — never a false positive.
///
/// In particular, a category letter outside the A–G table (<see cref="TaxpayerCategories.IsKnown"/>)
/// is NOT evidence of an incoherence: the NIF format accepts any <c>[A-Z]</c> and real matricules
/// carry letters this table does not map. Warning on those produced messages such as
/// « votre NIF indique la catégorie P (Inconnu) », i.e. an accusation built on a letter the code
/// admits it cannot interpret. See docs/fiscal/nif-taxpayer-category.md.
/// </summary>
public static class NifCategorySegmentCoherenceChecker
{
    /// <summary>
    /// Returns a French, human-readable warning when the NIF's taxpayer category and the chosen
    /// segment look incoherent, or <c>null</c> when there is nothing to report (including when
    /// <paramref name="segmentCode"/> is absent/unknown — fail open).
    /// </summary>
    public static string? CheckCoherence(NIF? nif, string? segmentCode)
    {
        if (nif is null)
            return null;

        var normalizedSegment = CompanySegments.Normalize(segmentCode);
        if (normalizedSegment is null || !CompanySegments.IsKnown(normalizedSegment))
            return null;

        var category = nif.TaxpayerCategory;
        var isAssociationCategory = category == TaxpayerCategories.Association;
        var isAssociationSegment = string.Equals(normalizedSegment, CompanySegments.Association, StringComparison.OrdinalIgnoreCase);

        if (isAssociationCategory && !isAssociationSegment)
        {
            return "Votre NIF indique une association (catégorie D), mais le segment sélectionné n'est pas « Association ». " +
                   "Vérifiez votre choix de segment.";
        }

        // `IsKnown` (et non `category != ' '`) : sur une lettre hors table (P, M, N…) on
        // s'abstient. Cf. le contrat « jamais de faux positif » ci-dessus.
        if (isAssociationSegment && !isAssociationCategory && TaxpayerCategories.IsKnown(category))
        {
            return $"Le segment sélectionné est « Association », mais votre NIF indique la catégorie {category} " +
                   $"({TaxpayerCategories.GetDescription(category)}) et non une association. " +
                   "Vérifiez votre choix de segment ou votre NIF.";
        }

        return null;
    }
}
