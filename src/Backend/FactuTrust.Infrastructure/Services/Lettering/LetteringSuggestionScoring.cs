namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>Faits d'une proposition qui modulent son score (plan v2, annexe C §2.5).</summary>
/// <param name="SharedReference">Une référence est partagée par les deux sens, hors règle R2 elle-même.</param>
/// <param name="SameThirdPartyBothSides">Le même tiers est renseigné au débit et au crédit.</param>
/// <param name="DateGapDays">Écart entre la date la plus ancienne et la plus récente du groupe.</param>
/// <param name="Ambiguous">D'autres appariements équivalents existaient (raison <c>AmbiguousAmount</c>).</param>
/// <param name="PaymentBeforeInvoice">Un règlement est antérieur à la facture (côté déduit du compte).</param>
internal readonly record struct ScoreFacts(
    bool SharedReference,
    bool SameThirdPartyBothSides,
    int DateGapDays,
    bool Ambiguous,
    bool PaymentBeforeInvoice);

/// <summary>
/// Score entier de 0 à 100 = base de la règle + bonus − pénalités, et niveau de confiance. Pur et sans
/// état : les mêmes faits donnent toujours le même score.
/// </summary>
internal static class LetteringSuggestionScoring
{
    internal const int BonusSharedReference = 5;
    internal const int BonusSameThirdParty = 5;
    internal const int BonusCloseDates = 3;
    internal const int PenaltyAmbiguous = 15;
    internal const int PenaltyFarDates = 10;
    internal const int PenaltyPaymentBeforeInvoice = 5;

    internal const int CloseDatesMaxDays = 31;
    internal const int FarDatesMinDays = 366; // écart strictement supérieur à 365 jours

    internal const int HighThreshold = 85;
    internal const int MediumThreshold = 60;

    internal static int Score(int baseScore, ScoreFacts facts)
    {
        var score = baseScore;
        if (facts.SharedReference) score += BonusSharedReference;
        if (facts.SameThirdPartyBothSides) score += BonusSameThirdParty;
        if (facts.DateGapDays <= CloseDatesMaxDays) score += BonusCloseDates;
        if (facts.Ambiguous) score -= PenaltyAmbiguous;
        if (facts.DateGapDays >= FarDatesMinDays) score -= PenaltyFarDates;
        if (facts.PaymentBeforeInvoice) score -= PenaltyPaymentBeforeInvoice;
        return Math.Clamp(score, 0, 100);
    }

    internal static SuggestionConfidence Confidence(int score)
        => score >= HighThreshold ? SuggestionConfidence.High
         : score >= MediumThreshold ? SuggestionConfidence.Medium
         : SuggestionConfidence.Low;
}
