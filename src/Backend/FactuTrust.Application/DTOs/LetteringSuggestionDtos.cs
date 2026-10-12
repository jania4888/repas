namespace FactuTrust.Application.DTOs;

/// <summary>
/// Réponse de <c>GET api/accounting/lettering/suggestions</c> (plan v2, Phase 3, annexe C §3).
/// Les propositions ne sont jamais stockées : elles sont recalculées à chaque appel.
/// </summary>
/// <param name="Suggestions">Propositions renvoyées, dans l'ordre final du moteur (annexe C §2.6).</param>
/// <param name="TotalFound">Nombre de propositions trouvées avant la limite <c>maxResults</c>.</param>
/// <param name="Returned">Nombre de propositions renvoyées (≤ <c>maxResults</c>).</param>
/// <param name="CandidateLineCount">Nombre de lignes candidates données au moteur.</param>
/// <param name="Truncated">Vrai si le calcul est incomplet (voir <paramref name="TruncationReason"/>).</param>
/// <param name="TruncationReason"><c>CandidateCap</c>, <c>SearchBudget</c> ou <c>TimeFuse</c> ; null sinon.</param>
/// <param name="ComputedAtUtc">Instant du calcul, en UTC.</param>
public sealed record LetteringSuggestionsResultDto(
    IReadOnlyList<LetteringSuggestionDto> Suggestions,
    int TotalFound, int Returned, int CandidateLineCount,
    bool Truncated, string? TruncationReason,
    DateTime ComputedAtUtc);

/// <summary>
/// Une proposition de lettrage : un groupe de lignes d'un même compte, d'une même devise, de somme
/// nulle en devise de l'opération. <see cref="Key"/> est stable d'un appel à l'autre.
/// </summary>
/// <remarks>
/// <see cref="ThirdPartyKind"/> est un entier, comme dans <see cref="LetteringLineDto"/>, pour que
/// l'écran de lettrage n'ait qu'une seule convention.
/// </remarks>
public sealed record LetteringSuggestionDto(
    string Key,
    string Kind,
    string Category,
    int Score, string Confidence,
    string AccountNumber, string CurrencyCode,
    Guid? ThirdPartyId, int ThirdPartyKind, string? ThirdPartyName,
    IReadOnlyList<LetteringSuggestionLineDto> DebitLines,
    IReadOnlyList<LetteringSuggestionLineDto> CreditLines,
    decimal TotalAmount,
    decimal LocalGap, bool HasExchangeDifference,
    bool BulkEligible,
    IReadOnlyList<LetteringSuggestionReasonDto> Reasons);

/// <summary>
/// Ligne d'une proposition. <see cref="Debit"/>/<see cref="Credit"/> sont en devise de tenue (TND) ;
/// les montants en devise ne sont renseignés que pour une opération en devise étrangère (0 sinon,
/// comme dans <see cref="LetteringLineDto"/>). Les montants sont nets : une ligne a un seul sens.
/// </summary>
public sealed record LetteringSuggestionLineDto(
    Guid LineId, Guid EntryId, DateTime EntryDate, string JournalCode, int EntryNumber,
    string? PieceRef, string Label,
    decimal Debit, decimal Credit, decimal DebitInCurrency, decimal CreditInCurrency);

/// <summary>
/// Explication structurée, non localisée côté serveur : le front traduit <see cref="Code"/> et
/// insère <see cref="Args"/> (annexe C §2.5).
/// </summary>
public sealed record LetteringSuggestionReasonDto(string Code, IReadOnlyDictionary<string, string> Args);
