using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <param name="PreviousCode">Rempli seulement par « Compléter un partiel » (D7) ; null sinon.</param>
public sealed record LetteringOutcome(
    Guid GroupId, string Code, string AccountNumber, decimal Amount, string Currency,
    bool IsPartial, IReadOnlyList<Guid> LineIds, string? PreviousCode = null);

public sealed record UnletteringOutcome(
    Guid GroupId, string Code, string AccountNumber, decimal Amount, string Currency,
    bool IsPartial, IReadOnlyList<Guid> LineIds);

public interface ILetteringService
{
    /// <summary>
    /// Lettre manuellement des lignes d'un même compte. Équilibre débit/crédit exigé, sauf si
    /// <paramref name="allowPartial"/> : le groupe est alors marqué partiel (code préfixé « P »).
    /// Refuse (<c>LETTERING_PERIOD_LOCKED</c>) toute ligne d'une période verrouillée, sauf pour
    /// <see cref="LetteringOrigin.Automatic"/> (auto-lettrage des paiements et de la paie, D9).
    /// </summary>
    Task<Result<LetteringOutcome>> ManualLetterAsync(
        IReadOnlyList<Guid> journalEntryLineIds,
        bool allowPartial = false,
        LetteringOrigin origin = LetteringOrigin.Manual,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Délettre un groupe : libère les lignes (LetteringCode remis à null) et supprime le groupe.
    /// Refusé si une ligne membre appartient à une période verrouillée (D8), quelle que soit
    /// l'origine.
    /// </summary>
    Task<Result<UnletteringOutcome>> UnletterAsync(
        string code,
        LetteringOrigin origin = LetteringOrigin.Manual,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Complète un groupe partiel (« P ») avec de nouvelles lignes, sans délettrage préalable
    /// (D7). Si l'ensemble (membres + nouvelles lignes) s'équilibre, le groupe devient définitif
    /// (« L », même numéro) ; sinon, s'il reste déséquilibré et que <paramref name="allowPartial"/>
    /// est vrai, il reste partiel avec les nouveaux membres.
    /// </summary>
    Task<Result<LetteringOutcome>> CompletePartialAsync(
        string code,
        IReadOnlyList<Guid> newLineIds,
        bool allowPartial,
        LetteringOrigin origin = LetteringOrigin.Manual,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Attempts to automatically letter a payment journal entry against the corresponding
    /// invoice journal entry on the third-party account (4111 for clients, 4011 for suppliers).
    /// Silently succeeds if lettering is not possible (partial payment, already lettered, etc.).
    /// </summary>
    Task<Result> AutoLetterPaymentAsync(
        string sourceEntityType,
        Guid sourceEntityId,
        string invoiceSourceType,
        Guid invoiceSourceId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Lettrage automatique d'un paiement paie contre l'écriture OD du cycle (comptes 425xxxx).
    /// </summary>
    Task<Result> AutoLetterPayrollPaymentAsync(
        Guid payrollPaymentId,
        Guid payrollRunId,
        CancellationToken cancellationToken = default);

    /// <summary>Délettre les groupes liés à l'écriture de paiement paie annulée.</summary>
    Task<Result> UnletterPayrollPaymentAsync(Guid payrollPaymentId, CancellationToken cancellationToken = default);
}
