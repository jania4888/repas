namespace FactuTrust.Domain.Entities.PublicContact;

/// <summary>
/// Demande de contact / démo déposée anonymement depuis la landing publique (formulaire
/// « demande d'accès / démo »). Persistée dans la base maître, table <c>PublicContactRequests</c>.
/// Aucune IP brute n'est stockée : uniquement un hachage salé (<c>ClientIpHash</c>).
/// </summary>
public sealed class PublicContactRequest
{
    public const int ReferenceMaxLength = 16;
    public const int FullNameMaxLength = 120;
    public const int OrganizationMaxLength = 120;
    public const int EmailMaxLength = 254;
    public const int PhoneMaxLength = 32;
    public const int SizeMaxLength = 32;
    public const int MessageMaxLength = 2000;
    public const int LocaleMaxLength = 5;
    public const int ConsentTextVersionMaxLength = 32;
    public const int IpHashMaxLength = 64;
    public const int UserAgentMaxLength = 500;

    public Guid Id { get; private set; }

    /// <summary>Référence communiquée au prospect (« CR-7F3K9Q »), index unique.</summary>
    public string PublicReference { get; private set; } = null!;

    public PublicContactSubject Subject { get; private set; }
    public string FullName { get; private set; } = null!;
    public string Organization { get; private set; } = null!;

    /// <summary>E-mail normalisé : trim + minuscules (clé de détection des doublons).</summary>
    public string Email { get; private set; } = null!;

    /// <summary>Téléphone normalisé : chiffres ASCII, préfixe « +216 » optionnel.</summary>
    public string Phone { get; private set; } = null!;

    public string? Size { get; private set; }
    public string Message { get; private set; } = null!;

    /// <summary>« fr » ou « ar ».</summary>
    public string Locale { get; private set; } = null!;

    public bool Consent { get; private set; }
    public string ConsentTextVersion { get; private set; } = null!;
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Hachage salé de l'IP cliente (jamais l'IP brute).</summary>
    public string? ClientIpHash { get; private set; }

    /// <summary>User-Agent tronqué à <see cref="UserAgentMaxLength"/>.</summary>
    public string? UserAgent { get; private set; }

    public bool CaptchaVerified { get; private set; }
    public PublicContactRequestStatus Status { get; private set; }
    public DateTime? ProcessedAtUtc { get; private set; }
    public bool NotificationEnqueued { get; private set; }

    /// <summary>Date de purge automatique (job Hangfire).</summary>
    public DateTime RetentionUntilUtc { get; private set; }

    private PublicContactRequest()
    {
    }

    public static PublicContactRequest Create(
        string publicReference,
        PublicContactSubject subject,
        string fullName,
        string organization,
        string email,
        string phone,
        string? size,
        string message,
        string locale,
        string consentTextVersion,
        string? clientIpHash,
        string? userAgent,
        bool captchaVerified,
        DateTime nowUtc,
        int retentionDays,
        bool suspectedSpam,
        int spamRetentionDays)
    {
        // Défense en profondeur : le validateur applicatif a déjà tout vérifié.
        RequireLength(publicReference, ReferenceMaxLength, nameof(publicReference));
        if (!Enum.IsDefined(subject))
        {
            throw new ArgumentOutOfRangeException(nameof(subject), subject, "Unknown public contact subject.");
        }

        RequireLength(fullName, FullNameMaxLength, nameof(fullName));
        RequireLength(organization, OrganizationMaxLength, nameof(organization));
        RequireLength(email, EmailMaxLength, nameof(email));
        RequireLength(phone, PhoneMaxLength, nameof(phone));
        RequireLength(message, MessageMaxLength, nameof(message));
        RequireLength(locale, LocaleMaxLength, nameof(locale));
        RequireLength(consentTextVersion, ConsentTextVersionMaxLength, nameof(consentTextVersion));

        if (size is not null && (size.Length == 0 || size.Length > SizeMaxLength))
        {
            throw new ArgumentException($"Size must be null or between 1 and {SizeMaxLength} characters.", nameof(size));
        }

        if (clientIpHash is not null && (clientIpHash.Length == 0 || clientIpHash.Length > IpHashMaxLength))
        {
            throw new ArgumentException($"ClientIpHash must be null or between 1 and {IpHashMaxLength} characters.", nameof(clientIpHash));
        }

        if (retentionDays <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(retentionDays), retentionDays, "Retention must be positive.");
        }

        if (spamRetentionDays <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(spamRetentionDays), spamRetentionDays, "Spam retention must be positive.");
        }

        var normalizedUserAgent = string.IsNullOrWhiteSpace(userAgent)
            ? null
            : userAgent.Length > UserAgentMaxLength ? userAgent[..UserAgentMaxLength] : userAgent;

        return new PublicContactRequest
        {
            Id = Guid.NewGuid(),
            PublicReference = publicReference,
            Subject = subject,
            FullName = fullName,
            Organization = organization,
            Email = email.Trim().ToLowerInvariant(),
            Phone = phone,
            Size = size,
            Message = message,
            Locale = locale,
            Consent = true,
            ConsentTextVersion = consentTextVersion,
            CreatedAtUtc = nowUtc,
            ClientIpHash = clientIpHash,
            UserAgent = normalizedUserAgent,
            CaptchaVerified = captchaVerified,
            Status = suspectedSpam ? PublicContactRequestStatus.Spam : PublicContactRequestStatus.New,
            ProcessedAtUtc = null,
            NotificationEnqueued = false,
            RetentionUntilUtc = nowUtc.AddDays(suspectedSpam ? spamRetentionDays : retentionDays)
        };
    }

    public void MarkNotificationEnqueued() => NotificationEnqueued = true;

    /// <summary>
    /// Change le statut de traitement. Le passage en <see cref="PublicContactRequestStatus.Spam"/>
    /// raccourcit la rétention ; le retour à <see cref="PublicContactRequestStatus.New"/> efface la
    /// date de traitement.
    /// </summary>
    public void ChangeStatus(PublicContactRequestStatus status, DateTime nowUtc, int spamRetentionDays)
    {
        if (!Enum.IsDefined(status))
        {
            throw new ArgumentOutOfRangeException(nameof(status), status, "Unknown public contact status.");
        }

        Status = status;
        ProcessedAtUtc = status == PublicContactRequestStatus.New ? null : nowUtc;
        if (status == PublicContactRequestStatus.Spam)
        {
            if (spamRetentionDays <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(spamRetentionDays), spamRetentionDays, "Spam retention must be positive.");
            }

            RetentionUntilUtc = nowUtc.AddDays(spamRetentionDays);
        }
    }

    private static void RequireLength(string value, int maxLength, string paramName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("Value is required.", paramName);
        }

        if (value.Length > maxLength)
        {
            throw new ArgumentException($"Value exceeds {maxLength} characters.", paramName);
        }
    }
}
