using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.PublicContact;
using FactuTrust.Application.Features.PublicContact.Commands;
using FluentValidation.TestHelper;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PublicContact;

/// <summary>
/// Lot C — TC3 : contrat de validation figé (§4.5) et normalisation du téléphone.
/// </summary>
public sealed class SubmitPublicContactRequestCommandValidatorTests
{
    private static SubmitPublicContactRequestCommandValidator CreateValidator(int maxMessageLength = 2000)
        => new(Options.Create(new PublicContactOptions { MaxMessageLength = maxMessageLength }));

    private static SubmitPublicContactRequestCommand Valid(
        string? subject = "demo-cabinet",
        string? fullName = "Amina Ben Salah",
        string? organization = "Cabinet Ben Salah",
        string? email = "amina@cabinet.tn",
        string? phone = "+216 71 123 456",
        string? size = "dossiers:6-20",
        string? message = "Nous souhaitons une démo de la version cabinet.",
        bool? consent = true,
        string? locale = "fr",
        string? honeypot = null,
        long? elapsedMs = 8000,
        string? turnstileToken = null)
        => new(subject, fullName, organization, email, phone, size, message, consent, locale, honeypot, elapsedMs, turnstileToken, "203.0.113.7", "UA");

    [Fact]
    public void Valid_command_passes()
    {
        var result = CreateValidator().TestValidate(Valid());
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Fact]
    public void Field_errors_use_camel_case_property_names()
    {
        var result = CreateValidator().TestValidate(new SubmitPublicContactRequestCommand(
            null, null, null, null, null, "x", null, null, null, new string('h', 257), null, new string('t', 2049), null, null));

        var names = result.Errors.Select(e => e.PropertyName).Distinct().OrderBy(n => n, StringComparer.Ordinal).ToArray();
        Assert.Equal(
            new[] { "consent", "elapsedMs", "email", "fullName", "honeypot", "locale", "message", "organization", "phone", "size", "subject", "turnstileToken" },
            names);
    }

    [Theory]
    [InlineData("acces-entreprise")]
    [InlineData("demo-cabinet")]
    [InlineData("entreprise")]
    [InlineData("autre")]
    public void Subject_accepts_frozen_codes(string subject)
    {
        CreateValidator().TestValidate(Valid(subject: subject)).ShouldNotHaveValidationErrorFor("subject");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("ACCES-ENTREPRISE")]
    [InlineData("cabinet")]
    public void Subject_rejects_unknown_codes(string? subject)
    {
        CreateValidator().TestValidate(Valid(subject: subject)).ShouldHaveValidationErrorFor("subject");
    }

    [Theory]
    [InlineData("A")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("Line1\nLine2")]
    [InlineData("Tab\tName")]
    [InlineData("Name\u0007")]
    [InlineData("Name\u2028")]
    public void FullName_and_Organization_are_single_line_2_to_120(string? value)
    {
        var result = CreateValidator().TestValidate(Valid(fullName: value, organization: value));
        result.ShouldHaveValidationErrorFor("fullName");
        result.ShouldHaveValidationErrorFor("organization");
    }

    [Fact]
    public void FullName_longer_than_120_is_rejected_and_120_accepted()
    {
        CreateValidator().TestValidate(Valid(fullName: new string('a', 121))).ShouldHaveValidationErrorFor("fullName");
        CreateValidator().TestValidate(Valid(fullName: new string('a', 120))).ShouldNotHaveValidationErrorFor("fullName");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-an-email")]
    [InlineData("a b@example.com")]
    [InlineData("a@example.com\r\nBcc: x@y.z")]
    public void Email_rejects_invalid_whitespace_and_control_characters(string? email)
    {
        CreateValidator().TestValidate(Valid(email: email)).ShouldHaveValidationErrorFor("email");
    }

    [Fact]
    public void Email_longer_than_254_is_rejected()
    {
        var email = new string('a', 250) + "@x.tn";
        CreateValidator().TestValidate(Valid(email: email)).ShouldHaveValidationErrorFor("email");
    }

    [Theory]
    [InlineData("71123456")]
    [InlineData("+21671123456")]
    [InlineData("+216 71 123 456")]
    [InlineData("00216 71-123-456")]
    [InlineData("(71) 123.456")]
    [InlineData("٧١١٢٣٤٥٦")]
    [InlineData("+٢١٦٧١١٢٣٤٥٦")]
    public void Phone_accepts_tunisian_numbers_in_common_notations(string phone)
    {
        CreateValidator().TestValidate(Valid(phone: phone)).ShouldNotHaveValidationErrorFor("phone");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("1234567")]
    [InlineData("01234567")]
    [InlineData("711234567")]
    [InlineData("+33612345678")]
    [InlineData("7112345a")]
    [InlineData("+216 71 123 456 ext 12345678901234")]
    public void Phone_rejects_non_tunisian_or_malformed_numbers(string? phone)
    {
        CreateValidator().TestValidate(Valid(phone: phone)).ShouldHaveValidationErrorFor("phone");
    }

    [Theory]
    [InlineData("dossiers:1-5")]
    [InlineData("dossiers:6-20")]
    [InlineData("dossiers:21-50")]
    [InlineData("dossiers:50+")]
    [InlineData("employes:1-5")]
    [InlineData("employes:6-20")]
    [InlineData("employes:21-100")]
    [InlineData("employes:100+")]
    [InlineData(null)]
    public void Size_accepts_the_whitelist_or_null(string? size)
    {
        CreateValidator().TestValidate(Valid(size: size)).ShouldNotHaveValidationErrorFor("size");
    }

    [Theory]
    [InlineData("")]
    [InlineData("1-5")]
    [InlineData("Dossiers:1-5")]
    [InlineData("employes:200+")]
    public void Size_rejects_values_outside_the_whitelist(string size)
    {
        CreateValidator().TestValidate(Valid(size: size)).ShouldHaveValidationErrorFor("size");
    }

    [Fact]
    public void Message_is_required_between_10_and_2000_and_allows_newlines()
    {
        var validator = CreateValidator();
        validator.TestValidate(Valid(message: null)).ShouldHaveValidationErrorFor("message");
        validator.TestValidate(Valid(message: "Trop court")).ShouldNotHaveValidationErrorFor("message");
        validator.TestValidate(Valid(message: "123456789")).ShouldHaveValidationErrorFor("message");
        validator.TestValidate(Valid(message: new string('m', 2001))).ShouldHaveValidationErrorFor("message");
        validator.TestValidate(Valid(message: new string('m', 2000))).ShouldNotHaveValidationErrorFor("message");
        validator.TestValidate(Valid(message: "Ligne 1\r\nLigne 2\n\tLigne 3")).ShouldNotHaveValidationErrorFor("message");
        validator.TestValidate(Valid(message: "Message avec \u0000 nul")).ShouldHaveValidationErrorFor("message");
        validator.TestValidate(Valid(message: "Message avec \u001B[31m escape")).ShouldHaveValidationErrorFor("message");
        validator.TestValidate(Valid(message: "Message avec \u2028 separateur")).ShouldHaveValidationErrorFor("message");
    }

    [Fact]
    public void MaxMessageLength_option_is_capped_by_the_column_size()
    {
        CreateValidator(maxMessageLength: 5000).TestValidate(Valid(message: new string('m', 2001))).ShouldHaveValidationErrorFor("message");
        CreateValidator(maxMessageLength: 500).TestValidate(Valid(message: new string('m', 501))).ShouldHaveValidationErrorFor("message");
        CreateValidator(maxMessageLength: 500).TestValidate(Valid(message: new string('m', 500))).ShouldNotHaveValidationErrorFor("message");
    }

    [Theory]
    [InlineData(null)]
    [InlineData(false)]
    public void Consent_must_be_true(bool? consent)
    {
        CreateValidator().TestValidate(Valid(consent: consent)).ShouldHaveValidationErrorFor("consent");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("en")]
    [InlineData("FR")]
    public void Locale_must_be_fr_or_ar(string? locale)
    {
        CreateValidator().TestValidate(Valid(locale: locale)).ShouldHaveValidationErrorFor("locale");
        CreateValidator().TestValidate(Valid(locale: "ar")).ShouldNotHaveValidationErrorFor("locale");
    }

    [Fact]
    public void Honeypot_filled_is_not_a_validation_error_but_too_long_is()
    {
        CreateValidator().TestValidate(Valid(honeypot: "http://spam.example")).ShouldNotHaveValidationErrorFor("honeypot");
        CreateValidator().TestValidate(Valid(honeypot: new string('h', 257))).ShouldHaveValidationErrorFor("honeypot");
    }

    [Fact]
    public void ElapsedMs_is_required_and_non_negative_but_a_fast_submission_is_not_a_validation_error()
    {
        CreateValidator().TestValidate(Valid(elapsedMs: null)).ShouldHaveValidationErrorFor("elapsedMs");
        CreateValidator().TestValidate(Valid(elapsedMs: -1)).ShouldHaveValidationErrorFor("elapsedMs");
        CreateValidator().TestValidate(Valid(elapsedMs: 0)).ShouldNotHaveValidationErrorFor("elapsedMs");
    }

    [Fact]
    public void TurnstileToken_is_optional_and_bounded()
    {
        CreateValidator().TestValidate(Valid(turnstileToken: null)).ShouldNotHaveValidationErrorFor("turnstileToken");
        CreateValidator().TestValidate(Valid(turnstileToken: new string('t', 2048))).ShouldNotHaveValidationErrorFor("turnstileToken");
        CreateValidator().TestValidate(Valid(turnstileToken: new string('t', 2049))).ShouldHaveValidationErrorFor("turnstileToken");
    }

    [Theory]
    [InlineData("+216 71 123 456", "+21671123456")]
    [InlineData("00216-71-123-456", "+21671123456")]
    [InlineData("(71) 123.456", "71123456")]
    [InlineData("٧١١٢٣٤٥٦", "71123456")]
    [InlineData("+٢١٦ ٧١ ١٢٣ ٤٥٦", "+21671123456")]
    [InlineData("71\u00A0123\u2013456", "71123456")]
    [InlineData("", "")]
    [InlineData(null, "")]
    [InlineData("abc", "abc")]
    public void PhoneNormalizer_normalizes_digits_and_separators(string? raw, string expected)
    {
        Assert.Equal(expected, PhoneNormalizer.Normalize(raw));
    }
}
