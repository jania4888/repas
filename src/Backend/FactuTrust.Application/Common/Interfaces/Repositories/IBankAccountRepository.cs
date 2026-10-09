using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>
/// Repository for <see cref="BankAccount"/> aggregates.
/// </summary>
public interface IBankAccountRepository : IRepository<BankAccount>
{
    Task<IReadOnlyList<BankAccount>> GetActiveByCompanyAsync(Guid companyId, CancellationToken cancellationToken = default);

    Task<BankAccount?> GetByIdAndCompanyAsync(Guid id, Guid companyId, CancellationToken cancellationToken = default);

    Task<BankAccount?> GetDefaultAsync(Guid companyId, CancellationToken cancellationToken = default);

    Task<int> CountActiveByCompanyAsync(Guid companyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns true if another active account already uses this IBAN (normalized).
    /// </summary>
    Task<bool> ExistsIbanForCompanyAsync(Guid companyId, string normalizedIban, Guid? excludeAccountId, CancellationToken cancellationToken = default);

    /// <summary>Projection ou compte déjà lié à ce numéro de plan, actif ou non.</summary>
    Task<BankAccount?> GetByCompanyAndChartNumberAsync(Guid companyId, string chartOfAccountNumber, CancellationToken cancellationToken = default);

    /// <summary>
    /// Clears <see cref="BankAccount.IsDefault"/> for all active accounts of the company.
    /// </summary>
    Task ClearDefaultFlagsForCompanyAsync(Guid companyId, CancellationToken cancellationToken = default);
}
