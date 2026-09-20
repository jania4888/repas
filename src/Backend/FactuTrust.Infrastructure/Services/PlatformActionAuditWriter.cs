using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services;

/// <inheritdoc />
public sealed class PlatformActionAuditWriter : IPlatformActionAuditWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false
    };

    private readonly MasterDbContext _masterContext;
    private readonly ILogger<PlatformActionAuditWriter> _logger;

    public PlatformActionAuditWriter(MasterDbContext masterContext, ILogger<PlatformActionAuditWriter> logger)
    {
        _masterContext = masterContext;
        _logger = logger;
    }

    public async Task WriteAsync(PlatformActionAuditRecord record, CancellationToken cancellationToken = default)
    {
        // `cancellationToken` est volontairement ignoré. L'audit est écrit APRÈS une action déjà
        // validée en base : si le client HTTP raccroche entre les deux, propager l'annulation
        // perdrait la trace d'un changement réel et irréversible. On écrit toujours.
        _ = cancellationToken;

        PlatformActionAuditEntry? entry = null;
        try
        {
            var detailsJson = record.Details is { Count: > 0 }
                ? JsonSerializer.Serialize(record.Details, JsonOptions)
                : "{}";

            entry = PlatformActionAuditEntry.Create(
                record.ActorUserId,
                record.ActorEmail,
                record.Action,
                record.Outcome,
                record.TargetTenantId,
                record.CorrelationId,
                detailsJson);

            _masterContext.PlatformActionAuditEntries.Add(entry);
            await _masterContext.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            // Le contexte maître est partagé (scoped) avec l'appelant : laisser l'entrée en échec
            // dans le change tracker la ferait ressurgir au prochain SaveChanges, hors de tout
            // contexte. On la détache.
            if (entry is not null)
            {
                try
                {
                    _masterContext.Entry(entry).State = EntityState.Detached;
                }
                catch (Exception detachEx)
                {
                    _logger.LogWarning(detachEx, "Could not detach the failed platform audit entry.");
                }
            }

            // Volontairement avalé : l'audit ne doit jamais transformer une création réussie en
            // échec côté opérateur. La perte de trace est signalée en LogError pour être détectée.
            _logger.LogError(
                ex,
                "Could not write platform audit entry. Action={Action} Outcome={Outcome} Tenant={TenantId} CorrelationId={CorrelationId}",
                record.Action,
                record.Outcome,
                record.TargetTenantId,
                record.CorrelationId);
        }
    }
}
