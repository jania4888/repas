namespace FactuTrust.Application.Features.PublicContact.Commands;

/// <summary>
/// Request body of <c>POST /api/public/contact-requests</c>. Every property is nullable on purpose:
/// the implicit <c>[Required]</c> validation of non-nullable reference types on <c>[ApiController]</c>
/// must not short-circuit FluentValidation, so that clients see a single shape of 400.
/// </summary>
public sealed record SubmitPublicContactRequestDto
{
    public string? Subject { get; init; }
    public string? FullName { get; init; }
    public string? Organization { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? Size { get; init; }
    public string? Message { get; init; }
    public bool? Consent { get; init; }
    public string? Locale { get; init; }

    /// <summary>Honeypot field (rendered hidden on the landing page). Must stay empty for humans.</summary>
    public string? Honeypot { get; init; }

    /// <summary>Milliseconds between form display and submission (time-trap).</summary>
    public long? ElapsedMs { get; init; }

    public string? TurnstileToken { get; init; }
}

public sealed record SubmitPublicContactRequestResponse(string Reference);
