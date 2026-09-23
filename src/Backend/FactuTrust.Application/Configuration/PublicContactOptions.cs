namespace FactuTrust.Application.Configuration;

/// <summary>
/// Runtime flags for the anonymous landing-page contact form (<c>POST /api/public/contact-requests</c>).
/// Bound to the <c>Features:PublicContact</c> section. Secrets (Turnstile) come from the deployment
/// secret store / environment, never from appsettings.
/// </summary>
public sealed class PublicContactOptions
{
    public const string SectionName = "Features:PublicContact";

    /// <summary>Kill-switch. When <c>false</c> the endpoint answers 503.</summary>
    public bool Enabled { get; set; }

    /// <summary>Internal mailbox(es) notified for each accepted request.</summary>
    public string[] RecipientEmails { get; set; } = Array.Empty<string>();

    /// <summary>Send an acknowledgement e-mail to the requester (only when the captcha was verified). Off by default.</summary>
    public bool SendAcknowledgement { get; set; }

    /// <summary>When <c>true</c> a server-verified Cloudflare Turnstile token is mandatory.</summary>
    public bool RequireCaptcha { get; set; }

    /// <summary>Server-only Turnstile secret for the contact widget.</summary>
    public string TurnstileSecretKey { get; set; } = string.Empty;

    /// <summary>Exact permitted widget DNS hostnames (no schemes, ports, paths or wildcards).</summary>
    public string[] TurnstileAllowedHostnames { get; set; } = Array.Empty<string>();

    /// <summary>Expected widget action. Empty disables action checking, not hostname checking.</summary>
    public string? TurnstileExpectedAction { get; set; } = "contact";

    /// <summary>Time-trap: submissions faster than this are stored as spam and never notified.</summary>
    public int MinElapsedMs { get; set; } = 3000;

    /// <summary>Maximum message length; always capped by the column size (2000).</summary>
    public int MaxMessageLength { get; set; } = 2000;

    public int RetentionDays { get; set; } = 365;

    public int SpamRetentionDays { get; set; } = 30;

    /// <summary>Same normalized e-mail + subject within this window returns the previous reference.</summary>
    public int DuplicateWindowMinutes { get; set; } = 10;

    /// <summary>Global flood guard: above this many accepted requests per hour, notifications are suppressed.</summary>
    public int MaxAcceptedPerHour { get; set; } = 60;

    /// <summary>Version of the consent text displayed by the landing page (stamped on each row).</summary>
    public string ConsentTextVersion { get; set; } = "2026-09-v1";
}
