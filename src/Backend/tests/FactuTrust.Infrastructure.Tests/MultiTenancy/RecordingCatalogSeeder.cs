using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;

namespace FactuTrust.Infrastructure.Tests.MultiTenancy;

/// <summary>
/// Double de test de <see cref="ITenantRuntimeCatalogSeeder"/> : enregistre les appels et rejoue au
/// choix un verdict ou une exception. Aucune base requise — c'est précisément l'intérêt du contrat.
/// </summary>
internal sealed class RecordingCatalogSeeder : ITenantRuntimeCatalogSeeder
{
    private readonly string _verdict;
    private readonly Exception? _failure;

    public RecordingCatalogSeeder(string verdict = "nct01", Exception? failure = null)
    {
        _verdict = verdict;
        _failure = failure;
    }

    public List<string> EnsureConnectionStrings { get; } = [];
    public List<bool> EnsureAuthorizeFlags { get; } = [];
    public List<string> InspectConnectionStrings { get; } = [];

    public Task<TenantRuntimeCatalogReport> EnsureAsync(
        string connectionString,
        bool authorizeChartRemap = false,
        CancellationToken cancellationToken = default)
    {
        EnsureConnectionStrings.Add(connectionString);
        EnsureAuthorizeFlags.Add(authorizeChartRemap);

        if (_failure is not null)
            return Task.FromException<TenantRuntimeCatalogReport>(_failure);

        return Task.FromResult(Report(_verdict));
    }

    public Task<TenantRuntimeCatalogReport> InspectAsync(
        string connectionString,
        CancellationToken cancellationToken = default)
    {
        InspectConnectionStrings.Add(connectionString);
        return Task.FromResult(Report(_verdict));
    }

    /// <summary>Construit un rapport dont le <c>Verdict</c> calculé vaut <paramref name="verdict"/>.</summary>
    private static TenantRuntimeCatalogReport Report(string verdict) => verdict switch
    {
        "nct01" => new TenantRuntimeCatalogReport
        {
            ChartOutcome = ChartCatalogOutcome.Applied,
            HasChart = true,
            AccountCount = 626,
            AccountingLineCount = 0,
            AppliedMapVersion = "nct01-v1",
            AppliedCatalogHash = "abc123",
            CurrentCatalogHash = "abc123"
        },
        "legacy" => new TenantRuntimeCatalogReport
        {
            ChartOutcome = ChartCatalogOutcome.NotApplied,
            HasChart = true,
            AccountCount = 211,
            AccountingLineCount = 0,
            AppliedMapVersion = null,
            AppliedCatalogHash = null,
            CurrentCatalogHash = "abc123"
        },
        "deferred" => new TenantRuntimeCatalogReport
        {
            ChartOutcome = ChartCatalogOutcome.DeferredHasAccountingData,
            HasChart = true,
            AccountCount = 211,
            AccountingLineCount = 4213,
            AppliedMapVersion = null,
            AppliedCatalogHash = null,
            CurrentCatalogHash = "abc123"
        },
        _ => throw new ArgumentOutOfRangeException(nameof(verdict), verdict, "Verdict de test inconnu.")
    };
}
