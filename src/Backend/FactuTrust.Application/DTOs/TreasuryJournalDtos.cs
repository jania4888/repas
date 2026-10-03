namespace FactuTrust.Application.DTOs;

/// <summary>Journal de trésorerie : totaux de période, groupes et page de lignes.</summary>
public sealed record TreasuryJournalResultDto
{
    public DateTime From { get; init; }
    public DateTime To { get; init; }
    public string Currency { get; init; } = "TND";
    public decimal TotalCredits { get; init; }
    public decimal TotalDebits { get; init; }
    public decimal Balance { get; init; }
    public int OperationCount { get; init; }
    public IReadOnlyList<TreasuryJournalGroupDto> Groups { get; init; } = Array.Empty<TreasuryJournalGroupDto>();
    public PagedResult<CashOperationListItemDto> Lines { get; init; } = null!;
}

/// <summary>
/// Groupe de catégorie. <see cref="OperationType"/> est 0 (débit) ou 1 (crédit), en entier
/// pour ne pas dépendre du nom d'enum JSON. <see cref="Category"/> est nulle si non classée.
/// </summary>
public sealed record TreasuryJournalGroupDto
{
    public int OperationType { get; init; }
    public int? Category { get; init; }
    public int Count { get; init; }
    public decimal Total { get; init; }
}

public sealed record TreasuryJournalPdfDocument
{
    public bool RightToLeft { get; init; }
    public string CompanyName { get; init; } = "";
    public string? MatriculeFiscal { get; init; }
    public string Title { get; init; } = "";
    public string PeriodLabel { get; init; } = "";
    public string MatriculeLabel { get; init; } = "";
    public string CurrencyCaption { get; init; } = "";
    public string PrintedOnLabel { get; init; } = "";
    public string PageLabel { get; init; } = "";
    public string SubtotalLabel { get; init; } = "";
    public string EmptyLabel { get; init; } = "";
    public IReadOnlyList<string> Columns { get; init; } = Array.Empty<string>();
    public IReadOnlyList<TreasuryJournalPdfSection> Sections { get; init; } = Array.Empty<TreasuryJournalPdfSection>();
    public string TotalCreditsLabel { get; init; } = "";
    public string TotalDebitsLabel { get; init; } = "";
    public string BalanceLabel { get; init; } = "";
    public string CountLabel { get; init; } = "";
    public decimal TotalCredits { get; init; }
    public decimal TotalDebits { get; init; }
    public decimal Balance { get; init; }
    public int OperationCount { get; init; }
    public string Currency { get; init; } = "TND";
}

public sealed record TreasuryJournalPdfSection(
    string Title,
    IReadOnlyList<TreasuryJournalPdfGroup> Groups);

public sealed record TreasuryJournalPdfGroup(
    string Category,
    decimal Subtotal,
    int Count,
    IReadOnlyList<TreasuryJournalPdfLine> Lines);

public sealed record TreasuryJournalPdfLine(
    DateTime Date,
    string Type,
    string Method,
    string Category,
    string Label,
    string Document,
    decimal? Debit,
    decimal? Credit);
