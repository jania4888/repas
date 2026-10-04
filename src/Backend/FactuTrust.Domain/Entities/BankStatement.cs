using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Domain.Entities;

public sealed class BankStatement : AggregateRoot
{
    public string BankName { get; private set; } = null!;
    public string AccountNumber { get; private set; } = null!;
    public DateTime StatementDate { get; private set; }
    public DateTime PeriodStart { get; private set; }
    public DateTime PeriodEnd { get; private set; }
    public Money OpeningBalance { get; private set; } = null!;
    public Money ClosingBalance { get; private set; } = null!;
    public Guid? BankAccountId { get; private set; }
    public string? ChartOfAccountNumber { get; private set; }
    public string? SourceFileName { get; private set; }
    public string? SourceFileHash { get; private set; }
    public BankStatementImportMethod ImportMethod { get; private set; } = BankStatementImportMethod.Manual;

    /// <summary>
    /// Écart du contrôle de solde au moment de l'enregistrement (solde d'ouverture + crédits − débits
    /// − solde de clôture, en millimes signés) : <c>null</c> = contrôle non évalué ou non tracé
    /// (relevés antérieurs), <c>0</c> = équilibré, autre = import confirmé avec écart.
    /// </summary>
    public decimal? BalanceDifference { get; private set; }

    /// <summary>
    /// L'utilisateur a explicitement confirmé l'import malgré un avertissement de solde (relevé lu
    /// entièrement par l'IA, D4). Toujours faux quand le contrôle est vert ou bloquant.
    /// </summary>
    public bool BalanceAcknowledged { get; private set; }

    public ICollection<BankStatementLine> Lines { get; private set; } = new List<BankStatementLine>();

    private BankStatement() { }

    public static BankStatement Create(string bankName, string accountNumber, DateTime statementDate,
        DateTime periodStart, DateTime periodEnd, Money openingBalance, Money closingBalance)
    {
        var entity = new BankStatement
        {
            Id = Guid.NewGuid(),
            BankName = bankName,
            AccountNumber = accountNumber,
            StatementDate = statementDate,
            PeriodStart = periodStart,
            PeriodEnd = periodEnd,
            OpeningBalance = openingBalance,
            ClosingBalance = closingBalance
        };
        return entity;
    }

    public void SetProvenance(
        Guid? bankAccountId,
        string? chartOfAccountNumber,
        string? sourceFileName,
        string? sourceFileHash,
        BankStatementImportMethod importMethod)
    {
        BankAccountId = bankAccountId;
        ChartOfAccountNumber = string.IsNullOrWhiteSpace(chartOfAccountNumber) ? null : chartOfAccountNumber.Trim();
        SourceFileName = string.IsNullOrWhiteSpace(sourceFileName) ? null : sourceFileName.Trim();
        SourceFileHash = string.IsNullOrWhiteSpace(sourceFileHash) ? null : sourceFileHash.Trim();
        ImportMethod = importMethod;
    }

    /// <summary>
    /// Trace le contrôle de solde recalculé côté serveur à la confirmation (<paramref name="difference"/>
    /// signé, <c>null</c> si non évaluable) et l'accusé explicite de l'utilisateur quand un
    /// avertissement de solde subsistait.
    /// </summary>
    public void RecordBalanceCheck(decimal? difference, bool acknowledged)
    {
        BalanceDifference = difference;
        BalanceAcknowledged = acknowledged;
    }
}
