using FactuTrust.Domain.Entities.Storefront;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain.Storefront;

public sealed class StorefrontVisualConsentTests
{
    // Consent is deliberately unattached. These tests exercise only its state and supplied
    // status guard; profile isolation requires the future aggregate/EF integration tests.
    private const string ProfileKey = "vp-c12";
    private const string Revision = "r1";
    private const string TermsVersion = "visual-1.0";
    private static readonly Guid OwnerId = Guid.Parse("f9d7e97a-734f-44ce-bc04-3a027c12bf8d");
    private static readonly DateTime AcceptedAt = new(2026, 9, 17, 12, 0, 0, DateTimeKind.Utc);

    [Theory]
    [InlineData(-1)]
    [InlineData(100)]
    public void Accept_ShouldRejectUnknownStorefrontStatus(int status)
    {
        var consent = new StorefrontVisualConsent();

        var result = consent.AcceptVisualConsent((StorefrontStatus)status, ProfileKey, Revision, TermsVersion, true, OwnerId, AcceptedAt);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Status", result.Error.Code);
        AssertAbsent(consent);
    }

    [Fact]
    public void NewConsent_ShouldHaveAllFiveFieldsAbsent()
    {
        var consent = new StorefrontVisualConsent();

        AssertAbsent(consent);
    }

    [Theory]
    [InlineData(StorefrontStatus.Draft)]
    [InlineData(StorefrontStatus.PendingReview)]
    [InlineData(StorefrontStatus.Published)]
    public void Accept_ShouldSetCompleteConsent_ForAllowedStatus(StorefrontStatus status)
    {
        var consent = new StorefrontVisualConsent();

        var result = consent.AcceptVisualConsent(status, ProfileKey, Revision, TermsVersion, true, OwnerId, AcceptedAt);

        Assert.True(result.IsSuccess, result.Error.Description);
        Assert.True(result.Value);
        AssertAccepted(consent);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Accept_ShouldRequireExplicitAcceptance_WithoutMutation(bool hasConsent)
    {
        var consent = new StorefrontVisualConsent();
        if (hasConsent) Accept(consent, StorefrontStatus.Published);
        var before = VisualState(consent);

        var result = consent.AcceptVisualConsent(StorefrontStatus.Published, ProfileKey, Revision, TermsVersion, false, OwnerId, AcceptedAt);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.VisualConsent", result.Error.Code);
        Assert.Equal(before, VisualState(consent));
    }

    public static IEnumerable<object?[]> InvalidReferences()
    {
        foreach (var key in new[] { null, "", " ", "VP-C12", "vp_c12", "-vp-c12", "vp-c12-", "vp--c12", "vp/c12", "https://example.test", "vp-c12\n", new string('a', 65) })
            yield return new object?[] { key, Revision, TermsVersion, "PublicVisualProfileKey" };
        foreach (var revision in new[] { null, "", " ", "r0", "r01", "R1", "1", "r1.0", "r-1", "r1\n", "r" + new string('1', 64) })
            yield return new object?[] { ProfileKey, revision, TermsVersion, "PublicVisualProfileRevision" };
        foreach (var version in new[] { null, "", " ", "visual\n1", "visual\0v1", new string('a', 65) })
            yield return new object?[] { ProfileKey, Revision, version, "VisualConsentVersion" };
    }

    [Theory]
    [MemberData(nameof(InvalidReferences))]
    public void Accept_ShouldRejectInvalidReferenceAtomically(string? key, string? revision, string? version, string field)
    {
        // A rejected first acceptance stays all-null; a rejected replacement keeps all old fields.
        foreach (var hasConsent in new[] { false, true })
        {
            var consent = new StorefrontVisualConsent();
            if (hasConsent) Accept(consent, StorefrontStatus.Published);
            var before = VisualState(consent);

            var result = consent.AcceptVisualConsent(StorefrontStatus.Published, key!, revision!, version!, true, OwnerId, AcceptedAt.AddDays(1));

            Assert.True(result.IsFailure);
            Assert.Equal($"Validation.{field}", result.Error.Code);
            Assert.Equal(before, VisualState(consent));
        }
    }

    [Fact]
    public void Accept_ShouldAcceptBoundaries_AndTrimTermsVersionOnly()
    {
        var consent = new StorefrontVisualConsent();
        var key = new string('a', StorefrontVisualConsent.PublicVisualProfileKeyMaxLength);
        var revision = "r" + new string('9', StorefrontVisualConsent.PublicVisualProfileRevisionMaxLength - 1);
        var version = new string('v', StorefrontVisualConsent.VisualConsentVersionMaxLength - 2);

        var result = consent.AcceptVisualConsent(StorefrontStatus.Draft, key, revision, $" {version} ", true, OwnerId, AcceptedAt);

        Assert.True(result.IsSuccess, result.Error.Description);
        Assert.Equal(key, consent.PublicVisualProfileKey);
        Assert.Equal(revision, consent.PublicVisualProfileRevision);
        Assert.Equal(version, consent.VisualConsentVersion);
        Assert.Equal(AcceptedAt, consent.VisualConsentAcceptedAt);
        Assert.Equal(OwnerId, consent.VisualConsentAcceptedByUserId);
    }

    [Fact]
    public void Accept_ShouldRejectEmptyActor_WithoutReplacingProof()
    {
        var consent = new StorefrontVisualConsent();
        Accept(consent, StorefrontStatus.Published);
        var before = VisualState(consent);

        var result = consent.AcceptVisualConsent(StorefrontStatus.Published, ProfileKey, "r2", TermsVersion, true, Guid.Empty, AcceptedAt);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.VisualConsentAcceptedByUserId", result.Error.Code);
        Assert.Equal(before, VisualState(consent));
    }

    public static IEnumerable<object[]> InvalidDates()
    {
        yield return new object[] { default(DateTime) };
        yield return new object[] { DateTime.SpecifyKind(AcceptedAt, DateTimeKind.Unspecified) };
        yield return new object[] { DateTime.SpecifyKind(AcceptedAt, DateTimeKind.Local) };
    }

    [Theory]
    [MemberData(nameof(InvalidDates))]
    public void Accept_ShouldRejectMissingOrNonUtcDate_WithoutReplacingProof(DateTime timestamp)
    {
        var consent = new StorefrontVisualConsent();
        Accept(consent, StorefrontStatus.Published);
        var before = VisualState(consent);

        var result = consent.AcceptVisualConsent(StorefrontStatus.Published, ProfileKey, "r2", TermsVersion, true, OwnerId, timestamp);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.VisualConsentAcceptedAt", result.Error.Code);
        Assert.Equal(before, VisualState(consent));
    }

    [Fact]
    public void AcceptSameIdentityAndTerms_ShouldBeNoOp_AndPreserveOriginalActorAndDate()
    {
        var consent = new StorefrontVisualConsent();
        Accept(consent, StorefrontStatus.Published);

        var result = consent.AcceptVisualConsent(StorefrontStatus.Published, ProfileKey, Revision, $" {TermsVersion} ", true, Guid.NewGuid(), AcceptedAt.AddDays(1));

        Assert.True(result.IsSuccess, result.Error.Description);
        Assert.False(result.Value);
        AssertAccepted(consent);
    }

    [Theory]
    [InlineData("vp-c17", Revision, TermsVersion)]
    [InlineData(ProfileKey, "r2", TermsVersion)]
    [InlineData(ProfileKey, Revision, "visual-2.0")]
    public void AcceptDifferentIdentityOrTerms_ShouldReplaceCompleteProof(string key, string revision, string version)
    {
        var consent = new StorefrontVisualConsent();
        Accept(consent, StorefrontStatus.Published);
        var owner = Guid.NewGuid();
        var timestamp = AcceptedAt.AddDays(1);

        var result = consent.AcceptVisualConsent(StorefrontStatus.Published, key, revision, version, true, owner, timestamp);

        Assert.True(result.IsSuccess, result.Error.Description);
        Assert.True(result.Value);
        Assert.Equal(new object?[] { key, revision, version, timestamp, owner }, VisualState(consent));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void AcceptWhileSuspended_ShouldFail_EvenForAnOtherwiseIdempotentRepeat(bool hasConsent)
    {
        var consent = new StorefrontVisualConsent();
        if (hasConsent) Accept(consent, StorefrontStatus.Published);
        var before = VisualState(consent);

        foreach (var revision in new[] { Revision, "r2" })
        {
            var result = consent.AcceptVisualConsent(StorefrontStatus.Suspended, ProfileKey, revision, TermsVersion, true, OwnerId, AcceptedAt);
            Assert.True(result.IsFailure);
            Assert.Equal("Validation.Status", result.Error.Code);
            Assert.Equal(before, VisualState(consent));
        }
    }

    [Fact]
    public void Withdraw_ShouldClearAllFiveFields_AndBeIdempotent()
    {
        var consent = new StorefrontVisualConsent();
        Accept(consent, StorefrontStatus.Published);

        var first = consent.WithdrawVisualConsent();
        var repeat = consent.WithdrawVisualConsent();

        Assert.True(first.IsSuccess);
        Assert.True(first.Value);
        Assert.True(repeat.IsSuccess);
        Assert.False(repeat.Value);
        AssertAbsent(consent);
    }

    [Fact]
    public void WithdrawAbsentConsent_ShouldBeNoOp()
    {
        var consent = new StorefrontVisualConsent();

        var result = consent.WithdrawVisualConsent();

        Assert.True(result.IsSuccess);
        Assert.False(result.Value);
        AssertAbsent(consent);
    }

    [Fact]
    public void Withdraw_ShouldLeaveConsentAbsent_WhenSuspendedAcceptanceIsRejected()
    {
        var consent = new StorefrontVisualConsent();
        Accept(consent, StorefrontStatus.Published);
        Assert.True(consent.WithdrawVisualConsent().Value);

        var accept = consent.AcceptVisualConsent(StorefrontStatus.Suspended, ProfileKey, Revision, TermsVersion, true, OwnerId, AcceptedAt.AddDays(1));

        Assert.True(accept.IsFailure);
        Assert.Equal("Validation.Status", accept.Error.Code);
        AssertAbsent(consent);
    }

    private static void Accept(StorefrontVisualConsent consent, StorefrontStatus status)
    {
        var result = consent.AcceptVisualConsent(status, ProfileKey, Revision, TermsVersion, true, OwnerId, AcceptedAt);
        Assert.True(result.IsSuccess, result.Error.Description);
        Assert.True(result.Value);
    }

    private static void AssertAccepted(StorefrontVisualConsent consent) =>
        Assert.Equal(new object?[] { ProfileKey, Revision, TermsVersion, AcceptedAt, OwnerId }, VisualState(consent));

    private static void AssertAbsent(StorefrontVisualConsent consent) =>
        Assert.All(VisualState(consent), value => Assert.Null(value));

    private static object?[] VisualState(StorefrontVisualConsent consent) => new object?[]
    {
        consent.PublicVisualProfileKey, consent.PublicVisualProfileRevision, consent.VisualConsentVersion,
        consent.VisualConsentAcceptedAt, consent.VisualConsentAcceptedByUserId
    };
}
