using FactuTrust.Domain.Entities.PublicContact;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PublicContact;

/// <summary>
/// Lot C — TC1 : contrat du domaine (codes d'objet figés, référence publique, entité).
/// </summary>
public sealed class PublicContactDomainTests
{
    private static readonly DateTime Now = new(2026, 9, 23, 12, 0, 0, DateTimeKind.Utc);

    [Theory]
    [InlineData("acces-entreprise", PublicContactSubject.AccesEntreprise)]
    [InlineData("demo-cabinet", PublicContactSubject.DemoCabinet)]
    [InlineData("entreprise", PublicContactSubject.Entreprise)]
    [InlineData("autre", PublicContactSubject.Autre)]
    public void SubjectCodes_TryParse_accepts_the_frozen_codes(string code, PublicContactSubject expected)
    {
        Assert.True(PublicContactSubjectCodes.TryParse(code, out var subject));
        Assert.Equal(expected, subject);
        Assert.Equal(code, PublicContactSubjectCodes.ToCode(subject));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("ACCES-ENTREPRISE")]
    [InlineData("Demo-Cabinet")]
    [InlineData("acces-entreprise ")]
    [InlineData("cabinet")]
    public void SubjectCodes_TryParse_rejects_unknown_or_differently_cased_codes(string? code)
    {
        Assert.False(PublicContactSubjectCodes.TryParse(code, out _));
    }

    [Fact]
    public void SubjectCodes_expose_exactly_four_codes_with_french_labels()
    {
        Assert.Equal(new[] { "acces-entreprise", "demo-cabinet", "entreprise", "autre" }, PublicContactSubjectCodes.All);
        Assert.Equal("Demande d'accès entreprise", PublicContactSubjectCodes.ToLabelFr(PublicContactSubject.AccesEntreprise));
        Assert.Equal("Démo cabinet comptable", PublicContactSubjectCodes.ToLabelFr(PublicContactSubject.DemoCabinet));
        Assert.Equal("Plan Entreprise", PublicContactSubjectCodes.ToLabelFr(PublicContactSubject.Entreprise));
        Assert.Equal("Autre demande", PublicContactSubjectCodes.ToLabelFr(PublicContactSubject.Autre));
        Assert.Throws<ArgumentOutOfRangeException>(() => PublicContactSubjectCodes.ToLabelFr((PublicContactSubject)99));
    }

    [Fact]
    public void Enum_values_are_frozen_for_persistence()
    {
        Assert.Equal(1, (int)PublicContactSubject.AccesEntreprise);
        Assert.Equal(2, (int)PublicContactSubject.DemoCabinet);
        Assert.Equal(3, (int)PublicContactSubject.Entreprise);
        Assert.Equal(4, (int)PublicContactSubject.Autre);
        Assert.Equal(0, (int)PublicContactRequestStatus.New);
        Assert.Equal(1, (int)PublicContactRequestStatus.Contacted);
        Assert.Equal(2, (int)PublicContactRequestStatus.Closed);
        Assert.Equal(3, (int)PublicContactRequestStatus.Spam);
    }

    [Fact]
    public void Reference_Generate_produces_well_formed_unambiguous_values()
    {
        for (var i = 0; i < 500; i++)
        {
            var reference = PublicContactReference.Generate();
            Assert.Equal(9, reference.Length);
            Assert.StartsWith("CR-", reference, StringComparison.Ordinal);
            Assert.True(PublicContactReference.IsWellFormed(reference), reference);
            Assert.DoesNotContain(reference[3..], c => c is '0' or 'O' or '1' or 'I');
        }
    }

    [Fact]
    public void Reference_Generate_is_not_constant()
    {
        var distinct = Enumerable.Range(0, 50).Select(_ => PublicContactReference.Generate()).Distinct().Count();
        Assert.True(distinct > 45, $"Only {distinct} distinct references out of 50.");
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("CR-7F3K9Q", true)]
    [InlineData("cr-7F3K9Q", false)]
    [InlineData("CR-7F3K9", false)]
    [InlineData("CR-7F3K9QA", false)]
    [InlineData("CR-7F3K0Q", false)]
    [InlineData("CR-7F3KOQ", false)]
    [InlineData("CR-7F3K1Q", false)]
    [InlineData("CR-7F3KIQ", false)]
    [InlineData("XX-7F3K9Q", false)]
    [InlineData("CR-7F3K9Q\n", false)]
    public void Reference_IsWellFormed_matches_the_public_format(string? value, bool expected)
    {
        Assert.Equal(expected, PublicContactReference.IsWellFormed(value));
    }

    [Fact]
    public void Create_normalizes_email_truncates_user_agent_and_stamps_retention()
    {
        var longUserAgent = new string('U', 600);

        var request = Create(email: "  Contact@Example.COM ", userAgent: longUserAgent);

        Assert.NotEqual(Guid.Empty, request.Id);
        Assert.Equal("CR-7F3K9Q", request.PublicReference);
        Assert.Equal(PublicContactSubject.DemoCabinet, request.Subject);
        Assert.Equal("contact@example.com", request.Email);
        Assert.Equal(PublicContactRequest.UserAgentMaxLength, request.UserAgent!.Length);
        Assert.True(request.Consent);
        Assert.Equal("2026-09-v1", request.ConsentTextVersion);
        Assert.Equal(Now, request.CreatedAtUtc);
        Assert.Equal(PublicContactRequestStatus.New, request.Status);
        Assert.Null(request.ProcessedAtUtc);
        Assert.False(request.NotificationEnqueued);
        Assert.Equal(Now.AddDays(365), request.RetentionUntilUtc);
    }

    [Fact]
    public void Create_with_suspected_spam_uses_spam_status_and_short_retention()
    {
        var request = Create(suspectedSpam: true);

        Assert.Equal(PublicContactRequestStatus.Spam, request.Status);
        Assert.Equal(Now.AddDays(30), request.RetentionUntilUtc);
    }

    [Fact]
    public void Create_blank_user_agent_is_stored_as_null()
    {
        Assert.Null(Create(userAgent: "  ").UserAgent);
        Assert.Null(Create(userAgent: null).UserAgent);
    }

    [Fact]
    public void Create_rejects_out_of_range_values()
    {
        Assert.Throws<ArgumentException>(() => Create(fullName: ""));
        Assert.Throws<ArgumentException>(() => Create(fullName: new string('a', 121)));
        Assert.Throws<ArgumentException>(() => Create(message: new string('m', 2001)));
        Assert.Throws<ArgumentException>(() => Create(size: ""));
        Assert.Throws<ArgumentException>(() => Create(size: new string('s', 33)));
        Assert.Throws<ArgumentException>(() => Create(clientIpHash: new string('f', 65)));
        Assert.Throws<ArgumentOutOfRangeException>(() => Create(retentionDays: 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => Create(spamRetentionDays: 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => Create(subject: (PublicContactSubject)42));
    }

    [Fact]
    public void MarkNotificationEnqueued_flips_the_flag()
    {
        var request = Create();
        request.MarkNotificationEnqueued();
        Assert.True(request.NotificationEnqueued);
    }

    [Fact]
    public void ChangeStatus_stamps_processing_date_and_shortens_retention_for_spam()
    {
        var request = Create();
        var later = Now.AddHours(2);

        request.ChangeStatus(PublicContactRequestStatus.Contacted, later, 30);
        Assert.Equal(PublicContactRequestStatus.Contacted, request.Status);
        Assert.Equal(later, request.ProcessedAtUtc);
        Assert.Equal(Now.AddDays(365), request.RetentionUntilUtc);

        request.ChangeStatus(PublicContactRequestStatus.Spam, later, 30);
        Assert.Equal(PublicContactRequestStatus.Spam, request.Status);
        Assert.Equal(later.AddDays(30), request.RetentionUntilUtc);

        request.ChangeStatus(PublicContactRequestStatus.New, later, 30);
        Assert.Null(request.ProcessedAtUtc);

        Assert.Throws<ArgumentOutOfRangeException>(() => request.ChangeStatus((PublicContactRequestStatus)9, later, 30));
    }

    private static PublicContactRequest Create(
        PublicContactSubject subject = PublicContactSubject.DemoCabinet,
        string fullName = "Amina Ben Salah",
        string email = "amina@cabinet.tn",
        string? size = "dossiers:6-20",
        string message = "Nous souhaitons une démo.",
        string? clientIpHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        string? userAgent = "Mozilla/5.0",
        bool suspectedSpam = false,
        int retentionDays = 365,
        int spamRetentionDays = 30)
    {
        return PublicContactRequest.Create(
            "CR-7F3K9Q", subject, fullName, "Cabinet Ben Salah", email, "+21671123456", size, message, "fr",
            "2026-09-v1", clientIpHash, userAgent, captchaVerified: false, Now, retentionDays, suspectedSpam, spamRetentionDays);
    }
}
