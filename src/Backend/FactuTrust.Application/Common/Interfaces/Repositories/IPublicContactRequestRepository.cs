using FactuTrust.Domain.Entities.PublicContact;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

/// <summary>Master-database persistence for anonymous landing-page contact requests.</summary>
public interface IPublicContactRequestRepository
{
    /// <summary>
    /// Inserts the request. Returns <c>false</c> (entity detached, nothing written) when the public
    /// reference already exists (unique index); any other failure propagates.
    /// </summary>
    Task<bool> TryAddAsync(PublicContactRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Public reference of the most recent non-spam request with the same normalized e-mail and subject
    /// created at or after <paramref name="sinceUtc"/>, or <c>null</c>.
    /// </summary>
    Task<string?> FindRecentReferenceAsync(string normalizedEmail, PublicContactSubject subject, DateTime sinceUtc, CancellationToken cancellationToken = default);

    /// <summary>Number of requests (any status) created at or after <paramref name="sinceUtc"/>.</summary>
    Task<int> CountCreatedSinceAsync(DateTime sinceUtc, CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
