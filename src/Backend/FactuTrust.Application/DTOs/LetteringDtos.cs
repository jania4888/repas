namespace FactuTrust.Application.DTOs;

/// <summary>
/// Ligne d'écriture projetée pour l'écran de lettrage (plan de refonte, §4.1). Les montants en
/// devise de tenue sont toujours renseignés (0 en mono-devise) ; <see cref="OperationCurrency"/>
/// est la devise de l'opération (<c>JournalEntry.CurrencyCode</c>), distincte de la devise de
/// tenue : ne pas la confondre avec un éventuel <c>Currency</c> d'un autre DTO.
/// </summary>
public sealed record LetteringLineDto(
    Guid LineId, Guid EntryId, DateTime EntryDate, string JournalCode, int EntryNumber, int LineNumber,
    string AccountNumber, string Label, string EntryLabel, string? PieceRef,
    string SourceCategory,
    decimal Debit, decimal Credit,
    string OperationCurrency,
    decimal DebitInCurrency, decimal CreditInCurrency,
    string? LetteringCode, bool IsPartiallyLettered,
    Guid? ThirdPartyId, int ThirdPartyKind, string? ThirdPartyName,
    bool IsDraft, bool IsReversed, bool IsReversal,
    bool PeriodLocked);

/// <summary>Totaux calculés sur l'ensemble du filtre (pas seulement la page retournée).</summary>
public sealed record LetteringTotalsDto(
    int Count, int DebitCount, int CreditCount,
    decimal TotalDebit, decimal TotalCredit, decimal Balance,
    decimal UnletteredDebit, decimal UnletteredCredit, decimal UnletteredBalance,
    string? SingleForeignCurrency, decimal? TotalDebitInCurrency, decimal? TotalCreditInCurrency);

/// <summary>Réponse de <c>GET api/accounting/lettering/lines</c> (plan §4.1).</summary>
public sealed record LetteringLinesPageDto(
    IReadOnlyList<LetteringLineDto> Items, int Page, int PageSize, int TotalCount,
    bool Truncated, LetteringTotalsDto Totals);

/// <summary>Réponse de <c>GET api/accounting/lettering/groups/{code}</c> (plan §4.2).</summary>
public sealed record LetteringGroupDto(
    Guid Id, string Code, string AccountNumber, decimal Amount, string OperationCurrency, bool IsPartial,
    DateTime LetteredAt, string? CreatedByDisplayName,
    IReadOnlyList<LetteringLineDto> Lines,
    bool CanUnletter, string? UnletterBlockedReason,
    bool CanComplete);

/// <summary>
/// Réponse enrichie de <c>POST letter</c> et de <c>POST lettering/groups/{code}/complete</c>
/// (plan §4.3/4.4). <see cref="PreviousCode"/> n'est renseigné que par « Compléter ».
/// </summary>
public sealed record LetteringResultDto(string Code, Guid GroupId, bool IsPartial, int LineCount, string? PreviousCode);
