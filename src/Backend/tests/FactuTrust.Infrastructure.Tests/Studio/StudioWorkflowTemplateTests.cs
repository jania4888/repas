using System.Globalization;
using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

public sealed class StudioWorkflowTemplateTests
{
    private static readonly DateTime Now = new(2026, 9, 16, 10, 30, 0, DateTimeKind.Utc);
    private static readonly Guid RecordId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private static JsonObject Record() => new()
    {
        ["montant"] = 150.5m,
        ["client"] = "Dupont",
        ["vide"] = null
    };

    private static StudioWorkflowContext Context()
    {
        var context = StudioWorkflowContext.Create(
            RecordId, "commandes", UserId, "agent@exemple.fr",
            new JsonObject { ["statut"] = "Brouillon" });
        context.SetApproval("validation", "approved", "RAS", UserId, Now);
        context.SetResult("calcul", new JsonObject { ["total"] = 42 });
        return context;
    }

    [Fact]
    public void Record_fields_and_now_are_rendered()
    {
        var nowText = Now.ToString("o", CultureInfo.InvariantCulture);
        var (value, warnings) = StudioTemplateRenderer.Render(
            "Facture de {{montant}} EUR pour {{ client }} le {{_now}}", Record(), Context(), Now);

        Assert.Equal($"Facture de 150.5 EUR pour Dupont le {nowText}", value);
        Assert.Empty(warnings);
    }

    [Fact]
    public void Unknown_variable_renders_empty_and_warns()
    {
        var (value, warnings) = StudioTemplateRenderer.Render(
            "{{inconnu}}|{{_fantome.x}}", Record(), Context(), Now);

        Assert.Equal("|", value);
        Assert.Equal(
            new[] { "Variable « inconnu » inconnue.", "Variable « _fantome.x » inconnue." },
            warnings);
    }

    [Fact]
    public void Context_paths_resolve_previous_approval_results_and_started_by()
    {
        var (value, warnings) = StudioTemplateRenderer.Render(
            "{{_previous.statut}}|{{_approval.validation.status}}|{{_approval.validation.comment}}"
            + "|{{_results.calcul.total}}|{{_startedBy.email}}|{{_record.id}}|{{_record.entityKey}}",
            Record(), Context(), Now);

        Assert.Equal($"Brouillon|approved|RAS|42|agent@exemple.fr|{RecordId}|commandes", value);
        Assert.Empty(warnings);
    }

    [Fact]
    public void Rendered_value_is_truncated_to_4000()
    {
        var record = Record();
        record["gros"] = new string('z', 5000);

        var (value, _) = StudioTemplateRenderer.Render("{{gros}} {{gros}}", record, Context(), Now);

        Assert.Equal(StudioTemplateRenderer.MaxRenderedLength, value.Length);
    }

    [Fact]
    public void Single_placeholder_keeps_the_json_type()
    {
        var node = StudioTemplateRenderer.RenderValue(JsonValue.Create("{{montant}}"), Record(), Context(), Now);

        var jsonValue = Assert.IsAssignableFrom<JsonValue>(node);
        Assert.True(jsonValue.TryGetValue<decimal>(out var montant));
        Assert.Equal(150.5m, montant);
    }

    [Fact]
    public void Non_template_strings_are_returned_unchanged()
    {
        var texte = StudioTemplateRenderer.RenderValue(JsonValue.Create("Texte libre"), Record(), Context(), Now);
        Assert.Equal("Texte libre", texte!.GetValue<string>());

        // several placeholders => rendered string, not a typed value
        var mixte = StudioTemplateRenderer.RenderValue(
            JsonValue.Create("{{client}} / {{montant}}"), Record(), Context(), Now);
        Assert.Equal("Dupont / 150.5", mixte!.GetValue<string>());

        // non-string values are returned untouched
        var nombre = JsonValue.Create(42);
        Assert.Same(nombre, StudioTemplateRenderer.RenderValue(nombre, Record(), Context(), Now));
    }

    [Fact]
    public void Is_template_detects_braces_only()
    {
        Assert.True(StudioTemplateRenderer.IsTemplate("{{montant}}"));
        Assert.True(StudioTemplateRenderer.IsTemplate("Total : {{ montant }} EUR"));
        Assert.False(StudioTemplateRenderer.IsTemplate("Texte libre"));
        Assert.False(StudioTemplateRenderer.IsTemplate("{{}}"));
        Assert.False(StudioTemplateRenderer.IsTemplate("{{ 9invalide }}"));
        Assert.False(StudioTemplateRenderer.IsTemplate(null));
    }

    [Fact]
    public void Placeholder_regex_rejects_paths_longer_than_81_chars()
    {
        var path81 = new string('a', 81);
        var path82 = new string('a', 82);

        Assert.True(StudioTemplateRenderer.IsTemplate("{{" + path81 + "}}"));
        Assert.False(StudioTemplateRenderer.IsTemplate("{{" + path82 + "}}"));

        // an over-long path is not a placeholder: it renders as literal text
        var (value, _) = StudioTemplateRenderer.Render("{{" + path82 + "}}", Record(), Context(), Now);
        Assert.Equal("{{" + path82 + "}}", value);
    }
}
