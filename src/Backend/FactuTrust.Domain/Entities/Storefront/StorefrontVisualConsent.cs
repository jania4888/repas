using System.Text.RegularExpressions;
using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.Entities.Storefront;

/// <summary>
/// Standalone in-memory visual-consent state. Not an EF entity and deliberately not
/// referenced by StorefrontProfile until the additive Master mapping/migration tranche.
/// </summary>
public sealed partial class StorefrontVisualConsent
{
    public const int PublicVisualProfileKeyMaxLength = 64;
    public const int PublicVisualProfileRevisionMaxLength = 64;
    public const int VisualConsentVersionMaxLength = 64;

    // All absent or all complete. Publication CGU and private tenant classification
    // must never initialize these fields. Persistence constraints belong to L1's next tranche.
    public string? PublicVisualProfileKey { get; private set; }
    public string? PublicVisualProfileRevision { get; private set; }
    public string? VisualConsentVersion { get; private set; }
    public DateTime? VisualConsentAcceptedAt { get; private set; }
    public Guid? VisualConsentAcceptedByUserId { get; private set; }

    /// <summary>
    /// Records explicit acceptance of an exact illustrative identity and terms version.
    /// Returns true only when the current consent changes; a repeat keeps the original proof.
    /// </summary>
    /// <remarks>
    /// This is an in-memory transition, not authorization or durable audit. The server must
    /// supply its actor/time and current storefront status, freshly validate owner permissions
    /// and the available proposal, enforce concurrency, and commit the change with an
    /// append-only Master audit event.
    /// A supplied status is not a fresh persistence check. A syntactically valid reference
    /// is not proof that its editorial revision is authorized.
    /// </remarks>
    public Result<bool> AcceptVisualConsent(
        StorefrontStatus storefrontStatus,
        string publicVisualProfileKey,
        string publicVisualProfileRevision,
        string visualConsentVersion,
        bool accepted,
        Guid acceptedByUserId,
        DateTime acceptedAt)
    {
        // Even an otherwise idempotent PUT is forbidden while suspended.
        if (storefrontStatus is not (StorefrontStatus.Draft or StorefrontStatus.PendingReview or StorefrontStatus.Published))
            return Result.Failure<bool>(Error.Validation("Status", "Seule une vitrine en brouillon, en attente ou publiée peut accepter une représentation visuelle."));

        if (!accepted)
            return Result.Failure<bool>(Error.Validation("VisualConsent", "L'acceptation explicite de la représentation visuelle est obligatoire."));

        if (string.IsNullOrWhiteSpace(publicVisualProfileKey)
            || publicVisualProfileKey.Length > PublicVisualProfileKeyMaxLength
            || !PublicVisualProfileKeyRegex().IsMatch(publicVisualProfileKey))
            return Result.Failure<bool>(Error.Validation("PublicVisualProfileKey", "La référence visuelle publique est invalide."));

        if (string.IsNullOrWhiteSpace(publicVisualProfileRevision)
            || publicVisualProfileRevision.Length > PublicVisualProfileRevisionMaxLength
            || !PublicVisualProfileRevisionRegex().IsMatch(publicVisualProfileRevision))
            return Result.Failure<bool>(Error.Validation("PublicVisualProfileRevision", "La révision visuelle doit être au format r1, r2, etc."));

        if (string.IsNullOrWhiteSpace(visualConsentVersion)
            || visualConsentVersion.Length > VisualConsentVersionMaxLength
            || visualConsentVersion.Any(char.IsControl))
            return Result.Failure<bool>(Error.Validation("VisualConsentVersion", "La version du consentement visuel est obligatoire et limitée à 64 caractères."));

        if (acceptedByUserId == Guid.Empty)
            return Result.Failure<bool>(Error.Validation("VisualConsentAcceptedByUserId", "L'utilisateur acceptant la représentation visuelle est obligatoire."));

        if (acceptedAt == default || acceptedAt.Kind != DateTimeKind.Utc)
            return Result.Failure<bool>(Error.Validation("VisualConsentAcceptedAt", "La date d'acceptation visuelle doit être une date UTC renseignée."));

        var consentVersion = visualConsentVersion.Trim();
        if (PublicVisualProfileKey == publicVisualProfileKey
            && PublicVisualProfileRevision == publicVisualProfileRevision
            && VisualConsentVersion == consentVersion)
            return Result.Success(false);

        // Validate the entire replacement before changing any part of the current proof.
        PublicVisualProfileKey = publicVisualProfileKey;
        PublicVisualProfileRevision = publicVisualProfileRevision;
        VisualConsentVersion = consentVersion;
        VisualConsentAcceptedAt = acceptedAt;
        VisualConsentAcceptedByUserId = acceptedByUserId;
        return Result.Success(true);
    }

    /// <summary>
    /// Clears visual consent only, including while suspended. Returns false if already absent.
    /// Never changes publication, moderation, street position, branding, checkout or CGU.
    /// </summary>
    /// <remarks>
    /// The server must freshly authorize the owner, enforce the concurrency precondition and
    /// atomically audit the previous identity and withdrawal actor/time in Master. This method
    /// neither validates permissions nor records that audit, and must not be called by branding PUT.
    /// </remarks>
    public Result<bool> WithdrawVisualConsent()
    {
        if (PublicVisualProfileKey is null
            && PublicVisualProfileRevision is null
            && VisualConsentVersion is null
            && VisualConsentAcceptedAt is null
            && VisualConsentAcceptedByUserId is null)
            return Result.Success(false);

        PublicVisualProfileKey = null;
        PublicVisualProfileRevision = null;
        VisualConsentVersion = null;
        VisualConsentAcceptedAt = null;
        VisualConsentAcceptedByUserId = null;
        return Result.Success(true);
    }

    [GeneratedRegex(@"\A[a-z0-9]+(-[a-z0-9]+)*\z", RegexOptions.CultureInvariant)]
    private static partial Regex PublicVisualProfileKeyRegex();

    [GeneratedRegex(@"\Ar[1-9][0-9]*\z", RegexOptions.CultureInvariant)]
    private static partial Regex PublicVisualProfileRevisionRegex();
}
