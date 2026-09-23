using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.Background;

/// <summary>
/// Lot C — purge quotidienne des demandes de contact publiques dont la rétention est échue
/// (<c>RetentionUntilUtc &lt; UtcNow</c> : 365 j par défaut, 30 j pour le spam). Suppression
/// physique : une demande commerciale non traitée après un an n'a plus de finalité.
///
/// <b>Conservatif</b> : au plus <see cref="MaxRowsPerRun"/> lignes par exécution (le reste part à
/// la prochaine), sélection par identifiants puis <c>ExecuteDeleteAsync</c>. Les journaux ne
/// contiennent que des comptages — jamais de donnée personnelle.
/// Enregistré dans <c>HangfireRecurringJobsRegistrationService</c> (<c>purge-public-contact-requests</c>).
/// </summary>
public sealed class PublicContactRequestsPurgeJob
{
    public const int MaxRowsPerRun = 10_000;

    private readonly MasterDbContext _db;
    private readonly ILogger<PublicContactRequestsPurgeJob> _logger;

    public PublicContactRequestsPurgeJob(MasterDbContext db, ILogger<PublicContactRequestsPurgeJob> logger)
    {
        _db = db;
        _logger = logger;
    }

    public Task<int> ExecuteAsync(CancellationToken cancellationToken = default)
        => ExecuteAsync(DateTime.UtcNow, cancellationToken);

    /// <summary>Testable overload: <paramref name="nowUtc"/> is the retention cut-off.</summary>
    public async Task<int> ExecuteAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        var idsToDelete = await _db.PublicContactRequests
            .Where(r => r.RetentionUntilUtc < nowUtc)
            .OrderBy(r => r.RetentionUntilUtc)
            .Take(MaxRowsPerRun)
            .Select(r => r.Id)
            .ToListAsync(cancellationToken);

        if (idsToDelete.Count == 0)
        {
            _logger.LogInformation("PublicContact.Purge nothing to delete (cutoff={Cutoff})", nowUtc);
            return 0;
        }

        var deleted = await _db.PublicContactRequests
            .Where(r => idsToDelete.Contains(r.Id))
            .ExecuteDeleteAsync(cancellationToken);

        _logger.LogInformation(
            "PublicContact.Purge removed {Count} expired requests (cutoff={Cutoff}, max per run={Max})",
            deleted, nowUtc, MaxRowsPerRun);
        return deleted;
    }
}
