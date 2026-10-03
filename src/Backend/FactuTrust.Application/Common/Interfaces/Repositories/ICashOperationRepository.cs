using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository interface for CashOperation aggregate (formerly CashExpense).
/// </summary>
public interface ICashOperationRepository : IRepository<CashOperation>
{
    Task<bool> ExistsBySourceAsync(
        string sourceType,
        Guid sourceId,
        CancellationToken cancellationToken = default);

    Task<CashOperation?> GetBySourceAsync(
        string sourceType,
        Guid sourceId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets non-cancelled cash operations within the date range, with pagination.
    /// </summary>
    Task<(IReadOnlyList<CashOperation> Items, int TotalCount)> GetNonCancelledByDateRangeAsync(
        DateTime fromDate,
        DateTime toDate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets totals by payment method within the date range, excluding cancelled operations.
    /// Returns all operations regardless of type (debit/credit).
    /// </summary>
    Task<IReadOnlyDictionary<PaymentMethod, decimal>> GetNonCancelledTotalsByMethodAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets totals by payment method AND operation type within the date range, excluding cancelled operations.
    /// Key: (PaymentMethod, CashOperationType) -> decimal total.
    /// </summary>
    Task<IReadOnlyDictionary<(PaymentMethod Method, CashOperationType Type), decimal>> GetNonCancelledTotalsByMethodAndTypeAsync(
        DateTime fromDate,
        DateTime toDate,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Net cash desk balance for a payment method from 2000-01-01 through <paramref name="upToDateInclusive"/> (non-cancelled operations only).
    /// </summary>
    Task<decimal> GetNetBalanceForMethodUpToDateAsync(
        PaymentMethod method,
        DateTime upToDateInclusive,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<CashOperation>> GetByCashRegisterSessionIdAsync(
        Guid cashRegisterSessionId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Totaux des opérations non annulées sur la période, par sens et catégorie.
    /// Le code de catégorie est nul quand la catégorie historique est absente.
    /// </summary>
    Task<IReadOnlyList<CashJournalCategoryTotal>> GetNonCancelledJournalCategoryTotalsAsync(
        DateTime fromDate,
        DateTime toDate,
        PaymentMethod? method,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Lignes non annulées du journal, ordre chronologique (date, numéro, id), pagination bornée.
    /// </summary>
    Task<(IReadOnlyList<CashOperation> Items, int TotalCount)> GetNonCancelledJournalLinesAsync(
        DateTime fromDate,
        DateTime toDate,
        PaymentMethod? method,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Agrégat journal : un sens, une catégorie (ou aucune), un effectif et un montant positif.
/// </summary>
public sealed record CashJournalCategoryTotal(
    CashOperationType OperationType,
    int? CategoryCode,
    int Count,
    decimal Total);
