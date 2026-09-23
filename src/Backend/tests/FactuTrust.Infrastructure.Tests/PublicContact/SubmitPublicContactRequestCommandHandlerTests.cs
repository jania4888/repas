using System.Net;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.PublicContact.Commands;
using FactuTrust.Domain.Entities.PublicContact;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PublicContact;

/// <summary>
/// Lot C — TC4 : ordre des contrôles du handler (flag → honeypot → captcha → time-trap → doublon →
/// garde anti-inondation → persistance → notification) et modèle d'e-mail encodé. Mocks stricts :
/// toute interaction non prévue (ex. un e-mail envoyé pour un bot) fait échouer le test.
/// </summary>
public sealed class SubmitPublicContactRequestCommandHandlerTests
{
    private const string IpHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private readonly Mock<IPublicContactRequestRepository> _repository = new(MockBehavior.Strict);
    private readonly Mock<IPublicContactCaptchaValidator> _captcha = new(MockBehavior.Strict);
    private readonly Mock<IIpAddressHasher> _ipHasher = new(MockBehavior.Strict);
    private readonly Mock<IEmailService> _email = new(MockBehavior.Strict);

    private readonly PublicContactOptions _options = new()
    {
        Enabled = true,
        RecipientEmails = new[] { "contact@instafact.test" }
    };

    public SubmitPublicContactRequestCommandHandlerTests()
    {
        _ipHasher.Setup(h => h.Hash("203.0.113.7")).Returns(IpHash);
        _ipHasher.Setup(h => h.Hash(null)).Returns((string?)null);
    }

    private SubmitPublicContactRequestCommandHandler CreateHandler()
        => new(_repository.Object, _captcha.Object, _ipHasher.Object, _email.Object, Options.Create(_options),
            NullLogger<SubmitPublicContactRequestCommandHandler>.Instance);

    private static SubmitPublicContactRequestCommand Command(
        string? honeypot = null,
        long? elapsedMs = 8000,
        string? turnstileToken = null,
        string? remoteIp = "203.0.113.7",
        string message = "Nous souhaitons une démo.")
        => new("demo-cabinet", "  Amina Ben Salah ", " Cabinet Ben Salah", " Amina@Cabinet.TN ", "+216 71 123 456",
            "dossiers:6-20", message, true, "fr", honeypot, elapsedMs, turnstileToken, remoteIp, "Mozilla/5.0");

    private void ExpectNoDuplicateAndLowTraffic(int acceptedLastHour = 0)
    {
        _repository
            .Setup(r => r.FindRecentReferenceAsync("amina@cabinet.tn", PublicContactSubject.DemoCabinet, It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);
        _repository
            .Setup(r => r.CountCreatedSinceAsync(It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(acceptedLastHour);
    }

    private List<PublicContactRequest> ExpectAdd(bool firstAttemptFails = false)
    {
        var added = new List<PublicContactRequest>();
        var calls = 0;
        _repository
            .Setup(r => r.TryAddAsync(It.IsAny<PublicContactRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((PublicContactRequest e, CancellationToken _) =>
            {
                calls++;
                if (firstAttemptFails && calls == 1)
                {
                    return false;
                }

                added.Add(e);
                return true;
            });
        return added;
    }

    [Fact]
    public async Task Disabled_flag_returns_forbidden_without_touching_anything()
    {
        _options.Enabled = false;

        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Forbidden", result.Error.Code);
    }

    [Fact]
    public async Task Honeypot_filled_returns_a_fake_reference_without_persisting_or_notifying()
    {
        var result = await CreateHandler().Handle(Command(honeypot: "http://spam.example"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(PublicContactReference.IsWellFormed(result.Value.Reference));
        _repository.VerifyNoOtherCalls();
        _email.VerifyNoOtherCalls();
        _captcha.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Captcha_required_and_invalid_returns_validation_error_before_any_persistence()
    {
        _options.RequireCaptcha = true;
        _captcha.Setup(c => c.IsValidAsync("bad-token", "203.0.113.7", It.IsAny<CancellationToken>())).ReturnsAsync(false);

        var result = await CreateHandler().Handle(Command(turnstileToken: "bad-token"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.turnstileToken", result.Error.Code);
        Assert.Equal("Vérification anti-bot invalide.", result.Error.Description);
        _repository.VerifyNoOtherCalls();
        _email.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Captcha_required_and_valid_marks_the_row_as_verified()
    {
        _options.RequireCaptcha = true;
        _captcha.Setup(c => c.IsValidAsync("good-token", "203.0.113.7", It.IsAny<CancellationToken>())).ReturnsAsync(true);
        ExpectNoDuplicateAndLowTraffic();
        var added = ExpectAdd();
        _email.Setup(e => e.EnqueueTemplatedAsync("contact@instafact.test", "Équipe InstaFact", "contact-request-received",
                It.IsAny<IReadOnlyDictionary<string, object?>>(), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Guid.NewGuid());
        _repository.Setup(r => r.SaveChangesAsync(It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var result = await CreateHandler().Handle(Command(turnstileToken: "good-token"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var entity = Assert.Single(added);
        Assert.True(entity.CaptchaVerified);
        Assert.True(entity.NotificationEnqueued);
    }

    [Fact]
    public async Task Captcha_not_required_skips_the_validator_entirely()
    {
        ExpectNoDuplicateAndLowTraffic();
        ExpectAdd();
        _email.Setup(e => e.EnqueueTemplatedAsync(It.IsAny<string>(), It.IsAny<string?>(), "contact-request-received",
                It.IsAny<IReadOnlyDictionary<string, object?>>(), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Guid.NewGuid());
        _repository.Setup(r => r.SaveChangesAsync(It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var result = await CreateHandler().Handle(Command(turnstileToken: "ignored"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        _captcha.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Fast_submission_is_persisted_as_spam_and_never_notified()
    {
        ExpectNoDuplicateAndLowTraffic();
        var added = ExpectAdd();

        var result = await CreateHandler().Handle(Command(elapsedMs: 500), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var entity = Assert.Single(added);
        Assert.Equal(PublicContactRequestStatus.Spam, entity.Status);
        Assert.Equal(entity.CreatedAtUtc.AddDays(_options.SpamRetentionDays), entity.RetentionUntilUtc);
        Assert.False(entity.NotificationEnqueued);
        Assert.Equal(entity.PublicReference, result.Value.Reference);
        _email.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Duplicate_within_window_returns_the_existing_reference_without_a_new_row()
    {
        _repository
            .Setup(r => r.FindRecentReferenceAsync("amina@cabinet.tn", PublicContactSubject.DemoCabinet, It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("CR-EXIST7");

        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("CR-EXIST7", result.Value.Reference);
        _repository.Verify(r => r.TryAddAsync(It.IsAny<PublicContactRequest>(), It.IsAny<CancellationToken>()), Times.Never);
        _email.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Duplicate_lookup_uses_the_configured_window()
    {
        _options.DuplicateWindowMinutes = 10;
        DateTime? since = null;
        _repository
            .Setup(r => r.FindRecentReferenceAsync("amina@cabinet.tn", PublicContactSubject.DemoCabinet, It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .Callback((string _, PublicContactSubject _, DateTime s, CancellationToken _) => since = s)
            .ReturnsAsync("CR-EXIST7");

        var before = DateTime.UtcNow;
        await CreateHandler().Handle(Command(), CancellationToken.None);

        Assert.NotNull(since);
        Assert.InRange(since!.Value, before.AddMinutes(-10).AddSeconds(-5), DateTime.UtcNow.AddMinutes(-10).AddSeconds(5));
    }

    [Fact]
    public async Task Flood_guard_persists_but_suppresses_notification()
    {
        _options.MaxAcceptedPerHour = 60;
        ExpectNoDuplicateAndLowTraffic(acceptedLastHour: 60);
        var added = ExpectAdd();

        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var entity = Assert.Single(added);
        Assert.Equal(PublicContactRequestStatus.New, entity.Status);
        Assert.False(entity.NotificationEnqueued);
        _email.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Accepted_request_is_normalized_persisted_and_notified()
    {
        ExpectNoDuplicateAndLowTraffic();
        var added = ExpectAdd();
        IReadOnlyDictionary<string, object?>? model = null;
        _email.Setup(e => e.EnqueueTemplatedAsync("contact@instafact.test", "Équipe InstaFact", "contact-request-received",
                It.IsAny<IReadOnlyDictionary<string, object?>>(), null, It.IsAny<CancellationToken>()))
            .Callback((string _, string? _, string _, IReadOnlyDictionary<string, object?>? m, Guid? _, CancellationToken _) => model = m)
            .ReturnsAsync(Guid.NewGuid());
        _repository.Setup(r => r.SaveChangesAsync(It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var result = await CreateHandler().Handle(Command(message: "Bonjour <b>équipe</b>,\nune démo ?"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var entity = Assert.Single(added);
        Assert.Equal(entity.PublicReference, result.Value.Reference);
        Assert.True(PublicContactReference.IsWellFormed(entity.PublicReference));
        Assert.Equal("Amina Ben Salah", entity.FullName);
        Assert.Equal("Cabinet Ben Salah", entity.Organization);
        Assert.Equal("amina@cabinet.tn", entity.Email);
        Assert.Equal("+21671123456", entity.Phone);
        Assert.Equal("dossiers:6-20", entity.Size);
        Assert.Equal("fr", entity.Locale);
        Assert.Equal("2026-09-v1", entity.ConsentTextVersion);
        Assert.Equal(IpHash, entity.ClientIpHash);
        Assert.Equal("Mozilla/5.0", entity.UserAgent);
        Assert.False(entity.CaptchaVerified);
        Assert.Equal(PublicContactRequestStatus.New, entity.Status);
        Assert.True(entity.NotificationEnqueued);
        Assert.Equal(entity.CreatedAtUtc.AddDays(365), entity.RetentionUntilUtc);

        Assert.NotNull(model);
        Assert.Equal(entity.PublicReference, model!["reference"]);
        Assert.Equal("Démo cabinet comptable", model["subjectLabel"]);
        Assert.Equal(WebUtility.HtmlEncode("Bonjour <b>équipe</b>,") + "<br>" + WebUtility.HtmlEncode("une démo ?"), model["messageHtml"]);
        Assert.Equal("Bonjour <b>équipe</b>,\nune démo ?", model["messageText"]);
        Assert.Equal("non requis", model["captcha"]);
        Assert.Equal("01234567", model["ipHashPrefix"]);
        Assert.Equal("2026-09-v1", model["consentVersion"]);
        _repository.Verify(r => r.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
        _email.Verify(e => e.EnqueueTemplatedAsync(It.IsAny<string>(), It.IsAny<string?>(), "contact-request-ack",
            It.IsAny<IReadOnlyDictionary<string, object?>>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Reference_collision_is_retried_with_a_new_reference()
    {
        ExpectNoDuplicateAndLowTraffic();
        var added = ExpectAdd(firstAttemptFails: true);
        _email.Setup(e => e.EnqueueTemplatedAsync(It.IsAny<string>(), It.IsAny<string?>(), "contact-request-received",
                It.IsAny<IReadOnlyDictionary<string, object?>>(), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Guid.NewGuid());
        _repository.Setup(r => r.SaveChangesAsync(It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Single(added);
        _repository.Verify(r => r.TryAddAsync(It.IsAny<PublicContactRequest>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task Three_reference_collisions_return_conflict()
    {
        ExpectNoDuplicateAndLowTraffic();
        _repository
            .Setup(r => r.TryAddAsync(It.IsAny<PublicContactRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        _repository.Verify(r => r.TryAddAsync(It.IsAny<PublicContactRequest>(), It.IsAny<CancellationToken>()), Times.Exactly(3));
        _email.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Notification_failure_does_not_fail_the_request_and_leaves_the_flag_unset()
    {
        ExpectNoDuplicateAndLowTraffic();
        var added = ExpectAdd();
        _email.Setup(e => e.EnqueueTemplatedAsync(It.IsAny<string>(), It.IsAny<string?>(), "contact-request-received",
                It.IsAny<IReadOnlyDictionary<string, object?>>(), null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("smtp queue down"));

        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(Assert.Single(added).NotificationEnqueued);
        _repository.Verify(r => r.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Acknowledgement_is_sent_only_when_enabled_and_captcha_verified()
    {
        _options.SendAcknowledgement = true;
        _options.RequireCaptcha = true;
        _captcha.Setup(c => c.IsValidAsync("good-token", "203.0.113.7", It.IsAny<CancellationToken>())).ReturnsAsync(true);
        ExpectNoDuplicateAndLowTraffic();
        ExpectAdd();
        IReadOnlyDictionary<string, object?>? ackModel = null;
        _email.Setup(e => e.EnqueueTemplatedAsync("contact@instafact.test", "Équipe InstaFact", "contact-request-received",
                It.IsAny<IReadOnlyDictionary<string, object?>>(), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Guid.NewGuid());
        _email.Setup(e => e.EnqueueTemplatedAsync("amina@cabinet.tn", null, "contact-request-ack",
                It.IsAny<IReadOnlyDictionary<string, object?>>(), null, It.IsAny<CancellationToken>()))
            .Callback((string _, string? _, string _, IReadOnlyDictionary<string, object?>? m, Guid? _, CancellationToken _) => ackModel = m)
            .ReturnsAsync(Guid.NewGuid());
        _repository.Setup(r => r.SaveChangesAsync(It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var result = await CreateHandler().Handle(Command(turnstileToken: "good-token"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(ackModel);
        // No user text ever reaches the acknowledgement (anti-backscatter).
        Assert.DoesNotContain(ackModel!.Keys, k => k.Contains("message", StringComparison.OrdinalIgnoreCase) || k.Contains("name", StringComparison.OrdinalIgnoreCase));
        _email.VerifyAll();
    }

    [Fact]
    public async Task Acknowledgement_is_never_sent_without_captcha_verification()
    {
        _options.SendAcknowledgement = true;
        _options.RequireCaptcha = false;
        ExpectNoDuplicateAndLowTraffic();
        ExpectAdd();
        _email.Setup(e => e.EnqueueTemplatedAsync("contact@instafact.test", "Équipe InstaFact", "contact-request-received",
                It.IsAny<IReadOnlyDictionary<string, object?>>(), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Guid.NewGuid());
        _repository.Setup(r => r.SaveChangesAsync(It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var result = await CreateHandler().Handle(Command(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        _email.Verify(e => e.EnqueueTemplatedAsync(It.IsAny<string>(), It.IsAny<string?>(), "contact-request-ack",
            It.IsAny<IReadOnlyDictionary<string, object?>>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Unknown_remote_ip_stores_a_null_hash()
    {
        ExpectNoDuplicateAndLowTraffic();
        var added = ExpectAdd();
        _email.Setup(e => e.EnqueueTemplatedAsync(It.IsAny<string>(), It.IsAny<string?>(), "contact-request-received",
                It.IsAny<IReadOnlyDictionary<string, object?>>(), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Guid.NewGuid());
        _repository.Setup(r => r.SaveChangesAsync(It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var result = await CreateHandler().Handle(Command(remoteIp: null), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Null(Assert.Single(added).ClientIpHash);
    }

    [Fact]
    public void Internal_model_html_encodes_every_user_value()
    {
        var entity = PublicContactRequest.Create("CR-7F3K9Q", PublicContactSubject.Autre, "<img src=x onerror=alert(1)>", "O'Reilly & Co",
            "a@b.tn", "71123456", null, "line1\r\nline2", "ar", "2026-09-v1", null, null, false,
            new DateTime(2026, 9, 23, 14, 5, 0, DateTimeKind.Utc), 365, false, 30);

        var model = SubmitPublicContactRequestCommandHandler.BuildInternalModel(entity, "-");

        Assert.Equal("&lt;img src=x onerror=alert(1)&gt;", model["fullNameHtml"]);
        Assert.Equal("O&#39;Reilly &amp; Co", model["organizationHtml"]);
        Assert.Equal("O'Reilly & Co", model["organizationText"]);
        Assert.Equal("line1<br>line2", model["messageHtml"]);
        Assert.Equal("-", model["sizeText"]);
        Assert.Equal("2026-09-23 14:05", model["createdAt"]);
        Assert.Equal("Autre demande", model["subjectLabel"]);
        Assert.DoesNotContain(model.Values.OfType<string>(), v => v.Contains("{{", StringComparison.Ordinal));
    }
}
