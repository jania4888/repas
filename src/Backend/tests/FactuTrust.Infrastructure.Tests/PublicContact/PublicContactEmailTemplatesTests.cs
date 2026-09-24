using System.Text.RegularExpressions;
using FactuTrust.Application.Features.PublicContact.Commands;
using FactuTrust.Domain.Entities.PublicContact;
using FactuTrust.Infrastructure.Services.Email;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PublicContact;

/// <summary>
/// Lot C — the two catalogued templates must exist and the HTML part must only ever reference
/// the <c>*Html</c> (encoded) variant of user-entered fields; the subject must contain no user value.
/// </summary>
public sealed class PublicContactEmailTemplatesTests
{
    private static readonly string[] UserFields = { "fullName", "organization", "email", "phone", "size", "message" };
    private static readonly Regex Placeholder = new(@"\{\{\s*([\w\.\-]+)\s*\}\}", RegexOptions.Compiled);

    [Theory]
    [InlineData(SubmitPublicContactRequestCommandHandler.InternalTemplateCode)]
    [InlineData(SubmitPublicContactRequestCommandHandler.AcknowledgementTemplateCode)]
    public void Templates_are_catalogued(string code)
    {
        Assert.Contains(code, EmailTemplates.AllCodes);
        var template = EmailTemplates.Get(code);
        Assert.NotNull(template);
        Assert.Equal(code, template!.Code);
        Assert.False(string.IsNullOrWhiteSpace(template.TextBodyTemplate));
    }

    [Fact]
    public void Internal_template_html_uses_only_encoded_keys_and_text_only_raw_keys()
    {
        var template = EmailTemplates.Get(SubmitPublicContactRequestCommandHandler.InternalTemplateCode)!;
        var htmlKeys = Keys(template.HtmlBodyTemplate);
        var textKeys = Keys(template.TextBodyTemplate);

        foreach (var field in UserFields)
        {
            Assert.Contains(field + "Html", htmlKeys);
            Assert.DoesNotContain(field, htmlKeys);
            Assert.DoesNotContain(field + "Text", htmlKeys);

            Assert.Contains(field + "Text", textKeys);
            Assert.DoesNotContain(field, textKeys);
            Assert.DoesNotContain(field + "Html", textKeys);
        }

        Assert.Equal(new[] { "reference", "subjectLabel" }, Keys(template.SubjectTemplate).OrderBy(k => k));
        Assert.DoesNotContain("mailto:", template.HtmlBodyTemplate);
    }

    [Fact]
    public void Internal_template_keys_all_exist_in_handler_model()
    {
        var entity = PublicContactRequest.Create("CR-ABCDEF", PublicContactSubject.DemoCabinet, "Amina <b>", "Cabinet & Co",
            "amina@cabinet.tn", "+21671123456", "dossiers:6-20", "Ligne 1\nLigne 2 <script>", "fr", "2026-09-v1",
            "hash", "UA", true, new DateTime(2026, 9, 23, 12, 0, 0, DateTimeKind.Utc), 365, false, 30);
        var model = SubmitPublicContactRequestCommandHandler.BuildInternalModel(entity, "hash");
        var template = EmailTemplates.Get(SubmitPublicContactRequestCommandHandler.InternalTemplateCode)!;

        foreach (var key in Keys(template.SubjectTemplate).Concat(Keys(template.HtmlBodyTemplate)).Concat(Keys(template.TextBodyTemplate)))
            Assert.True(model.ContainsKey(key), $"clé manquante dans le modèle : {key}");

        var html = SimpleTemplateRenderer.Render(template.HtmlBodyTemplate, model);
        Assert.DoesNotContain("<script>", html);
        Assert.Contains("&lt;script&gt;", html);
        Assert.Contains("Ligne 1<br>Ligne 2", html);
        Assert.Contains("Cabinet &amp; Co", html);
    }

    [Fact]
    public void Acknowledgement_template_never_echoes_user_fields()
    {
        var template = EmailTemplates.Get(SubmitPublicContactRequestCommandHandler.AcknowledgementTemplateCode)!;
        var keys = Keys(template.SubjectTemplate).Concat(Keys(template.HtmlBodyTemplate)).Concat(Keys(template.TextBodyTemplate)).ToHashSet();

        foreach (var field in UserFields)
        {
            Assert.DoesNotContain(field, keys);
            Assert.DoesNotContain(field + "Html", keys);
            Assert.DoesNotContain(field + "Text", keys);
        }
        Assert.Subset(new HashSet<string> { "reference", "locale", "title", "body", "referenceLabel" }, keys);
    }

    private static List<string> Keys(string template)
        => Placeholder.Matches(template).Select(m => m.Groups[1].Value).Distinct().ToList();
}
