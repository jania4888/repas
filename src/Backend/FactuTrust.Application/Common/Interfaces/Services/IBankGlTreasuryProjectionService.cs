using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>Coordonnées facultatives saisies en même temps qu'une feuille 5321/5324.</summary>
public sealed record BankGlProjectionIdentity
{
    public string? BankCode { get; init; }
    public string? Rib { get; init; }
    public string? Iban { get; init; }
    public string? Currency { get; init; }
    public string? SwiftBic { get; init; }
}

public sealed record BankGlProjectionEnsureResult(int CreatedCount, int SkippedCount);

/// <summary>
/// Projette une feuille 5321/5324 du plan vers un compte de trésorerie, sans RIB obligatoire.
/// Sens inverse de <see cref="IBankAccountChartProvisioningService"/>.
/// </summary>
public interface IBankGlTreasuryProjectionService
{
    Task<Result<BankGlProjectionEnsureResult>> EnsureForChartAccountAsync(
        ChartOfAccount account,
        BankGlProjectionIdentity? identity,
        CancellationToken cancellationToken = default);

    /// <summary>Crée les projections manquantes du dossier (backfill, import de plan, ouverture d'import).</summary>
    Task<Result<BankGlProjectionEnsureResult>> EnsureMissingAsync(CancellationToken cancellationToken = default);

    Task<Result> SyncActiveFlagAsync(string accountNumber, bool isActive, CancellationToken cancellationToken = default);

    Task<Result> SyncLabelAsync(string accountNumber, string oldLabel, string newLabel, CancellationToken cancellationToken = default);

    Task<Result<IReadOnlyList<ImportableBankAccountDto>>> ListImportableAsync(CancellationToken cancellationToken = default);
}
