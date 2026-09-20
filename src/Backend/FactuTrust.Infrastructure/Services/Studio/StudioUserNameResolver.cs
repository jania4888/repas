using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Services.Studio;

/// <summary>
/// Résolution en lot des noms d'utilisateurs (même motif que <c>ExchangeService</c>). Le filtre
/// <c>TenantId</c> est posé sur la requête (S-base) : un lanceur d'un autre tenant (mode délégué
/// cabinet) n'est pas résolu et l'UI affiche « — » (D-45-02).
/// </summary>
public sealed class StudioUserNameResolver : IStudioUserNameResolver
{
    private readonly MasterDbContext _db;

    public StudioUserNameResolver(MasterDbContext db) => _db = db;

    public async Task<IReadOnlyDictionary<Guid, string>> GetDisplayNamesAsync(
        Guid tenantId, IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default)
    {
        if (userIds.Count == 0)
            return new Dictionary<Guid, string>();

        var ids = userIds.Distinct().ToList();
        var rows = await _db.Users.AsNoTracking()
            .Where(u => u.TenantId == tenantId && ids.Contains(u.Id))
            .Select(u => new { u.Id, u.FirstName, u.LastName })
            .ToListAsync(cancellationToken);

        var names = new Dictionary<Guid, string>(rows.Count);
        foreach (var row in rows)
        {
            var name = $"{row.FirstName} {row.LastName}".Trim();
            if (name.Length > 0)
                names[row.Id] = name; // jamais de repli email (PII) : absent ⇒ « — » côté UI
        }

        return names;
    }
}
