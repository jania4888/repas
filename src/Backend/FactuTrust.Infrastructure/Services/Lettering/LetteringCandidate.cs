using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>
/// Ligne non lettrée candidate du moteur de propositions (plan v2, annexe C §2.1). Construite par le
/// loader, jamais par le moteur. Montants en millimes entiers : les colonnes sont en <c>decimal(18,3)</c>,
/// la conversion <c>(long)(montant * 1000m)</c> est donc exacte.
/// </summary>
/// <param name="SignedMillimesOp">(débit − crédit) en devise de l'opération, en millimes.</param>
/// <param name="SignedMillimesLocal">(débit − crédit) en devise de tenue (TND), en millimes.</param>
/// <param name="OrderRank">
/// Rang dans l'ordre de lecture stable (<c>EntryDate, JournalCode, EntryNumber, LineNumber, LineId</c>),
/// calculé par le loader. Sert de départage déterministe partout dans le moteur. Un <c>int</c> suffit :
/// le loader plafonne à <c>MaxCandidateLines</c> (5 000 par défaut).
/// </param>
internal sealed record LetteringCandidate(
    Guid LineId,
    Guid EntryId,
    int LineNumber,
    string AccountNumber,
    string CurrencyCode,
    long SignedMillimesOp,
    long SignedMillimesLocal,
    ThirdPartyKind ThirdPartyKind,
    Guid? ThirdPartyId,
    string Label,
    string? PieceRef,
    string EntryLabel,
    string JournalCode,
    int EntryNumber,
    DateTime EntryDate,
    string? SourceEntityType,
    Guid? SourceEntityId,
    int OrderRank)
{
    /// <summary>
    /// Montant signé utilisé pour l'équilibre : devise de l'opération si elle diffère de la devise de
    /// tenue, sinon TND. Même règle que <c>LetteringService.ValidateLinesAsync</c>.
    /// </summary>
    internal long SignedForBalance => CurrencyCode == Money.DefaultCurrency ? SignedMillimesLocal : SignedMillimesOp;

    internal bool HasThirdParty => ThirdPartyId.HasValue;
}
