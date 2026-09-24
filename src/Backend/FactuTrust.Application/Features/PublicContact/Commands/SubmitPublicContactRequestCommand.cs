using System.Globalization;
using System.Net;
using System.Net.Mail;
using System.Text.RegularExpressions;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.PublicContact;
using FluentValidation;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.PublicContact.Commands;

/// <summary>
/// Anonymous contact / demo request coming from the public landing page. <see cref="RemoteIp"/> and
/// <see cref="UserAgent"/> are filled by the controller, never by the client body.
/// </summary>
public sealed record SubmitPublicContactRequestCommand(
    string? Subject,
    string? FullName,
    string? Organization,
    string? Email,
    string? Phone,
    string? Size,
    string? Message,
    bool? Consent,
    string? Locale,
    string? Honeypot,
    long? ElapsedMs,
    string? TurnstileToken,
    string? RemoteIp,
    string? UserAgent) : IRequest<Result<SubmitPublicContactRequestResponse>>;

/// <summary>
/// Form validation (→ 400 through <c>ValidationBehavior</c>). Anti-abuse decisions (honeypot, time-trap,
/// duplicates) are deliberately NOT validated here: they are taken by the handler and answered 202.
/// Property names are overridden to camelCase so <c>fieldErrors</c> keys match the JSON contract.
/// </summary>
public sealed partial class SubmitPublicContactRequestCommandValidator : AbstractValidator<SubmitPublicContactRequestCommand>
{
    public const int MinMessageLength = 10;
    public const int HoneypotMaxLength = 256;
    public const int TurnstileTokenMaxLength = 2048;

    /// <summary>Accepted <c>size</c> values (frozen contract, aligned with the landing page).</summary>
    public static readonly IReadOnlyList<string> AllowedSizes = new[]
    {
        "dossiers:1-5", "dossiers:6-20", "dossiers:21-50", "dossiers:50+",
        "employes:1-5", "employes:6-20", "employes:21-100", "employes:100+"
    };

    public static readonly IReadOnlyList<string> AllowedLocales = new[] { "fr", "ar" };

    public SubmitPublicContactRequestCommandValidator(IOptions<PublicContactOptions> options)
    {
        var maxMessage = Math.Clamp(options.Value.MaxMessageLength, MinMessageLength, PublicContactRequest.MessageMaxLength);

        RuleFor(x => x.Subject)
            .NotEmpty().WithMessage("L'objet est requis.")
            .Must(s => PublicContactSubjectCodes.TryParse(s, out _)).WithMessage("Objet invalide.")
            .OverridePropertyName("subject");

        RuleFor(x => x.FullName)
            .NotEmpty().WithMessage("Le nom est requis.")
            .Length(2, PublicContactRequest.FullNameMaxLength)
            .Must(BeSingleLine).WithMessage("Le nom contient des caractères non autorisés.")
            .OverridePropertyName("fullName");

        RuleFor(x => x.Organization)
            .NotEmpty().WithMessage("L'organisation est requise.")
            .Length(2, PublicContactRequest.OrganizationMaxLength)
            .Must(BeSingleLine).WithMessage("L'organisation contient des caractères non autorisés.")
            .OverridePropertyName("organization");

        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("L'e-mail est requis.")
            .MaximumLength(PublicContactRequest.EmailMaxLength)
            .Must(e => e is null || (BeSingleLine(e) && !e.Any(char.IsWhiteSpace))).WithMessage("L'e-mail contient des caractères non autorisés.")
            .EmailAddress().WithMessage("Adresse e-mail invalide.")
            .OverridePropertyName("email");

        RuleFor(x => x.Phone)
            .NotEmpty().WithMessage("Le téléphone est requis.")
            .MaximumLength(PublicContactRequest.PhoneMaxLength)
            .Must(p => TunisianPhoneRegex().IsMatch(PhoneNormalizer.Normalize(p))).WithMessage("Numéro de téléphone invalide.")
            .OverridePropertyName("phone");

        RuleFor(x => x.Size)
            .Must(s => s is null || AllowedSizes.Contains(s, StringComparer.Ordinal)).WithMessage("Taille invalide.")
            .OverridePropertyName("size");

        RuleFor(x => x.Message)
            .NotEmpty().WithMessage("Le message est requis.")
            .Length(MinMessageLength, maxMessage)
            .Must(BeMultiLine).WithMessage("Le message contient des caractères non autorisés.")
            .OverridePropertyName("message");

        RuleFor(x => x.Consent)
            .Equal(true).WithMessage("Le consentement est requis.")
            .OverridePropertyName("consent");

        RuleFor(x => x.Locale)
            .NotEmpty().WithMessage("La langue est requise.")
            .Must(l => AllowedLocales.Contains(l, StringComparer.Ordinal)).WithMessage("Langue invalide.")
            .OverridePropertyName("locale");

        // Never NotEmpty / Empty: a filled honeypot is answered 202 by the handler (do not tip off bots).
        RuleFor(x => x.Honeypot)
            .MaximumLength(HoneypotMaxLength)
            .OverridePropertyName("honeypot");

        RuleFor(x => x.ElapsedMs)
            .NotNull().WithMessage("Le champ elapsedMs est requis.")
            .GreaterThanOrEqualTo(0)
            .OverridePropertyName("elapsedMs");

        RuleFor(x => x.TurnstileToken)
            .MaximumLength(TurnstileTokenMaxLength)
            .OverridePropertyName("turnstileToken");
    }

    /// <summary>No control character at all (single-line fields, also blocks CRLF header injection).</summary>
    public static bool BeSingleLine(string? value) => value is null || SingleLineRegex().IsMatch(value);

    /// <summary>Only <c>\t</c>, <c>\n</c> and <c>\r</c> are allowed among control characters.</summary>
    public static bool BeMultiLine(string? value) => value is null || MultiLineRegex().IsMatch(value);

    [GeneratedRegex(@"\A[^\p{Cc}\u2028\u2029]*\z", RegexOptions.CultureInvariant)]
    private static partial Regex SingleLineRegex();

    [GeneratedRegex(@"\A[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u2028\u2029]*\z", RegexOptions.CultureInvariant)]
    private static partial Regex MultiLineRegex();

    [GeneratedRegex(@"\A(\+216)?[2-9]\d{7}\z", RegexOptions.CultureInvariant)]
    internal static partial Regex TunisianPhoneRegex();
}

public sealed class SubmitPublicContactRequestCommandHandler
    : IRequestHandler<SubmitPublicContactRequestCommand, Result<SubmitPublicContactRequestResponse>>
{
    public const string InternalTemplateCode = "contact-request-received";
    public const string AcknowledgementTemplateCode = "contact-request-ack";
    public const string InternalRecipientName = "Équipe InstaFact";
    private const int MaxReferenceAttempts = 3;

    private readonly IPublicContactRequestRepository _repository;
    private readonly IPublicContactCaptchaValidator _captcha;
    private readonly IIpAddressHasher _ipHasher;
    private readonly IEmailService _email;
    private readonly IOptions<PublicContactOptions> _options;
    private readonly ILogger<SubmitPublicContactRequestCommandHandler> _logger;

    public SubmitPublicContactRequestCommandHandler(
        IPublicContactRequestRepository repository,
        IPublicContactCaptchaValidator captcha,
        IIpAddressHasher ipHasher,
        IEmailService email,
        IOptions<PublicContactOptions> options,
        ILogger<SubmitPublicContactRequestCommandHandler> logger)
    {
        _repository = repository;
        _captcha = captcha;
        _ipHasher = ipHasher;
        _email = email;
        _options = options;
        _logger = logger;
    }

    public async Task<Result<SubmitPublicContactRequestResponse>> Handle(
        SubmitPublicContactRequestCommand request,
        CancellationToken cancellationToken)
    {
        var options = _options.Value;

        // (1) Kill-switch — the controller already answers 503; defence in depth (mapped to 503 too).
        if (!options.Enabled)
        {
            return Result.Failure<SubmitPublicContactRequestResponse>(Error.Forbidden("Formulaire de contact désactivé."));
        }

        if (!PublicContactSubjectCodes.TryParse(request.Subject, out var subject))
        {
            return Result.Failure<SubmitPublicContactRequestResponse>(Error.Validation("subject", "Objet invalide."));
        }

        var ipHash = _ipHasher.Hash(request.RemoteIp);
        var ipPrefix = ipHash is { Length: >= 8 } ? ipHash[..8] : "-";

        // (2) Honeypot — fake 202, nothing persisted, nothing sent.
        if (!string.IsNullOrEmpty(request.Honeypot))
        {
            _logger.LogInformation(
                "PublicContact.BotSuspected Reason=honeypot Subject={Subject} IpHashPrefix={IpHashPrefix}",
                subject, ipPrefix);
            return Result.Success(new SubmitPublicContactRequestResponse(PublicContactReference.Generate()));
        }

        // (3) Turnstile — the only anti-abuse check that answers 400 (the widget must be redone).
        var captchaVerified = false;
        if (options.RequireCaptcha)
        {
            if (!await _captcha.IsValidAsync(request.TurnstileToken, request.RemoteIp, cancellationToken))
            {
                _logger.LogInformation(
                    "PublicContact.CaptchaRejected Subject={Subject} IpHashPrefix={IpHashPrefix}",
                    subject, ipPrefix);
                return Result.Failure<SubmitPublicContactRequestResponse>(
                    Error.Validation("turnstileToken", "Vérification anti-bot invalide."));
            }

            captchaVerified = true;
        }

        // (4) Time-trap — persisted as Spam (short retention), never notified.
        var suspectedSpam = (request.ElapsedMs ?? 0) < options.MinElapsedMs;
        var email = request.Email!.Trim().ToLowerInvariant();
        var now = DateTime.UtcNow;

        // (5) Duplicate — same normalized e-mail + subject within the window: same reference, no new row.
        if (options.DuplicateWindowMinutes > 0)
        {
            var existing = await _repository.FindRecentReferenceAsync(
                email, subject, now.AddMinutes(-options.DuplicateWindowMinutes), cancellationToken);
            if (existing is not null)
            {
                _logger.LogInformation(
                    "PublicContact.Duplicate Reference={Reference} Subject={Subject}",
                    existing, subject);
                return Result.Success(new SubmitPublicContactRequestResponse(existing));
            }
        }

        // (6) Flood guard — persisted, but the mailbox is protected.
        var acceptedLastHour = await _repository.CountCreatedSinceAsync(now.AddHours(-1), cancellationToken);
        var floodGuard = acceptedLastHour >= options.MaxAcceptedPerHour;

        // (7) Persist — retry on public reference collision (unique index).
        PublicContactRequest? entity = null;
        for (var attempt = 0; attempt < MaxReferenceAttempts && entity is null; attempt++)
        {
            var candidate = PublicContactRequest.Create(
                PublicContactReference.Generate(),
                subject,
                request.FullName!.Trim(),
                request.Organization!.Trim(),
                email,
                PhoneNormalizer.Normalize(request.Phone),
                request.Size,
                request.Message!.Trim(),
                request.Locale!,
                options.ConsentTextVersion,
                ipHash,
                request.UserAgent,
                captchaVerified,
                now,
                options.RetentionDays,
                suspectedSpam,
                options.SpamRetentionDays);

            if (await _repository.TryAddAsync(candidate, cancellationToken))
            {
                entity = candidate;
            }
        }

        if (entity is null)
        {
            _logger.LogWarning("PublicContact.ReferenceCollision Attempts={Attempts}", MaxReferenceAttempts);
            return Result.Failure<SubmitPublicContactRequestResponse>(
                Error.Conflict("Référence indisponible, veuillez réessayer."));
        }

        // (8) Notifications — never blocking: the row is already saved.
        if (!suspectedSpam && !floodGuard)
        {
            await NotifyAsync(entity, options, ipPrefix, cancellationToken);
        }
        else
        {
            _logger.LogWarning(
                "PublicContact.NotificationSuppressed Reference={Reference} Reason={Reason}",
                entity.PublicReference, suspectedSpam ? "time-trap" : "flood-guard");
        }

        // (9) 202
        _logger.LogInformation(
            "PublicContact.Accepted Reference={Reference} Subject={Subject} Locale={Locale} Captcha={Captcha} IpHashPrefix={IpHashPrefix}",
            entity.PublicReference, subject, entity.Locale, captchaVerified, ipPrefix);

        return Result.Success(new SubmitPublicContactRequestResponse(entity.PublicReference));
    }

    private async Task NotifyAsync(PublicContactRequest entity, PublicContactOptions options, string ipPrefix, CancellationToken cancellationToken)
    {
        var model = BuildInternalModel(entity, ipPrefix);
        var enqueued = 0;

        foreach (var recipient in options.RecipientEmails)
        {
            if (string.IsNullOrWhiteSpace(recipient))
            {
                continue;
            }

            try
            {
                await _email.EnqueueTemplatedAsync(recipient.Trim(), InternalRecipientName, InternalTemplateCode, model, relatedTenantId: null, cancellationToken);
                enqueued++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "PublicContact.NotificationFailed Reference={Reference} Template={Template}",
                    entity.PublicReference, InternalTemplateCode);
            }
        }

        if (enqueued == 0)
        {
            if (options.RecipientEmails.Length == 0)
            {
                _logger.LogWarning("PublicContact.NotificationSuppressed Reference={Reference} Reason=no-recipient", entity.PublicReference);
            }

            return;
        }

        try
        {
            entity.MarkNotificationEnqueued();
            await _repository.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "PublicContact.NotificationFailed Reference={Reference} Template=flag", entity.PublicReference);
        }

        // Acknowledgement: only for captcha-verified humans, fixed text, no user content (anti-backscatter).
        if (options.SendAcknowledgement && entity.CaptchaVerified && MailAddress.TryCreate(entity.Email, out _))
        {
            try
            {
                await _email.EnqueueTemplatedAsync(entity.Email, null, AcknowledgementTemplateCode, BuildAcknowledgementModel(entity), relatedTenantId: null, cancellationToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "PublicContact.NotificationFailed Reference={Reference} Template={Template}",
                    entity.PublicReference, AcknowledgementTemplateCode);
            }
        }
    }

    /// <summary>
    /// Template model for the internal notification. <c>SimpleTemplateRenderer</c> does not encode, so
    /// every user-supplied value is exposed twice: <c>*Html</c> (HTML-encoded, message newlines → <c>&lt;br&gt;</c>)
    /// and <c>*Text</c> (raw, for the plain-text part). Server-only values are exposed as-is.
    /// </summary>
    public static IReadOnlyDictionary<string, object?> BuildInternalModel(PublicContactRequest entity, string ipPrefix)
    {
        var size = entity.Size ?? "-";
        return new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["reference"] = entity.PublicReference,
            ["subjectLabel"] = PublicContactSubjectCodes.ToLabelFr(entity.Subject),
            ["locale"] = entity.Locale,
            ["fullNameHtml"] = WebUtility.HtmlEncode(entity.FullName),
            ["fullNameText"] = entity.FullName,
            ["organizationHtml"] = WebUtility.HtmlEncode(entity.Organization),
            ["organizationText"] = entity.Organization,
            ["emailHtml"] = WebUtility.HtmlEncode(entity.Email),
            ["emailText"] = entity.Email,
            ["phoneHtml"] = WebUtility.HtmlEncode(entity.Phone),
            ["phoneText"] = entity.Phone,
            ["sizeHtml"] = WebUtility.HtmlEncode(size),
            ["sizeText"] = size,
            ["messageHtml"] = WebUtility.HtmlEncode(entity.Message).Replace("\r\n", "\n", StringComparison.Ordinal).Replace("\n", "<br>", StringComparison.Ordinal),
            ["messageText"] = entity.Message,
            ["createdAt"] = entity.CreatedAtUtc.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
            ["captcha"] = entity.CaptchaVerified ? "vérifié" : "non requis",
            ["consentVersion"] = entity.ConsentTextVersion,
            ["ipHashPrefix"] = ipPrefix
        };
    }

    /// <summary>
    /// Acknowledgement model: fixed FR/AR sentences chosen server-side from the locale. No user text
    /// (name, message) is ever echoed back, so the mailbox cannot be used as a spam relay.
    /// </summary>
    public static IReadOnlyDictionary<string, object?> BuildAcknowledgementModel(PublicContactRequest entity)
    {
        var isArabic = string.Equals(entity.Locale, "ar", StringComparison.Ordinal);
        return new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["reference"] = entity.PublicReference,
            ["locale"] = entity.Locale,
            ["title"] = isArabic ? "تم استلام طلبكم" : "Votre demande a bien été reçue",
            ["body"] = isArabic
                ? "لقد استلمنا طلبكم. سيتصل بكم فريقنا في غضون يومي عمل."
                : "Nous avons bien reçu votre demande. Notre équipe vous recontacte sous 2 jours ouvrés.",
            ["referenceLabel"] = isArabic ? "المرجع" : "Référence"
        };
    }
}
