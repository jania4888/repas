using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Entities.PublicContact;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Repositories;

/// <summary>
/// Lot C — master-database persistence of landing-page contact requests.
/// </summary>
public sealed class PublicContactRequestRepository : IPublicContactRequestRepository
{
    /// <summary>SQL Server error numbers for a unique index / constraint violation.</summary>
    private const int UniqueIndexViolation = 2601;
    private const int UniqueConstraintViolation = 2627;

    private readonly MasterDbContext _db;

    public PublicContactRequestRepository(MasterDbContext db)
    {
        _db = db;
    }

    public async Task<bool> TryAddAsync(PublicContactRequest request, CancellationToken cancellationToken = default)
    {
        _db.PublicContactRequests.Add(request);
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Public reference collision: forget the entity so the caller can retry with a new one.
            _db.Entry(request).State = EntityState.Detached;
            return false;
        }
    }

    public Task<string?> FindRecentReferenceAsync(string normalizedEmail, PublicContactSubject subject, DateTime sinceUtc, CancellationToken cancellationToken = default)
    {
        return _db.PublicContactRequests
            .AsNoTracking()
            .Where(r => r.Email == normalizedEmail
                        && r.Subject == subject
                        && r.CreatedAtUtc >= sinceUtc
                        && r.Status != PublicContactRequestStatus.Spam)
            .OrderByDescending(r => r.CreatedAtUtc)
            .Select(r => r.PublicReference)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public Task<int> CountCreatedSinceAsync(DateTime sinceUtc, CancellationToken cancellationToken = default)
    {
        return _db.PublicContactRequests
            .AsNoTracking()
            .CountAsync(r => r.CreatedAtUtc >= sinceUtc, cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default)
        => _db.SaveChangesAsync(cancellationToken);

    internal static bool IsUniqueViolation(DbUpdateException exception)
        => SqlExceptionHelper.FindSqlException(exception) is { Number: UniqueIndexViolation or UniqueConstraintViolation };
}
