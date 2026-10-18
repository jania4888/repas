using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

public interface IChartOfAccountRepository
{
    Task<int> CountAsync(CancellationToken cancellationToken = default);
    Task<ChartOfAccount?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ChartOfAccount?> GetByAccountNumberAsync(string accountNumber, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ChartOfAccount>> GetAllActiveAsync(CancellationToken cancellationToken = default);
    Task<ChartOfAccount> AddAsync(ChartOfAccount entity, CancellationToken cancellationToken = default);
    Task UpdateAsync(ChartOfAccount entity, CancellationToken cancellationToken = default);

    /// <summary>
    /// Compte auxiliaire (Client/Fournisseur, actif ou non) dont le matricule fiscal normalisé est
    /// <paramref name="fiscalIdNormalized"/>. Ne lit jamais le cache : la détection de doublon a
    /// besoin de l'état transactionnel courant. Au plus une ligne (contrainte d'unicité filtrée).
    /// </summary>
    Task<ChartOfAccount?> FindAuxiliaryByFiscalIdAsync(
        AccountType accountType, string fiscalIdNormalized, CancellationToken cancellationToken = default);

    /// <summary>
    /// Comptes auxiliaires actifs du type donné dont le numéro commence par <paramref name="accountPrefix"/>,
    /// triés par numéro, limités à <paramref name="maxRows"/> — candidats pour le rapprochement par nom à
    /// l'import de factures.
    /// </summary>
    Task<IReadOnlyList<AuxiliaryAccountCandidate>> ListActiveAuxiliaryAccountsAsync(
        AccountType accountType, string accountPrefix, int maxRows, CancellationToken cancellationToken = default);
}

/// <summary>Projection légère d'un compte auxiliaire candidat au rapprochement par nom.</summary>
public sealed record AuxiliaryAccountCandidate(
    Guid Id,
    string AccountNumber,
    string Label,
    string? FiscalId,
    string? FiscalIdNormalized);
