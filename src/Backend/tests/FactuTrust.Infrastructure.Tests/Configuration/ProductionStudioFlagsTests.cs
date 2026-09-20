using System.Text.Json;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Configuration;

/// <summary>
/// Studio IA v1.1 — lot 4.7 P1 (U3, D-47-90) : les drapeaux <c>Ollama:EnableStudioWorkflows</c> et
/// <c>Ollama:EnableStudioAiWorkflowTools</c> sont <c>true</c> dans <c>appsettings.Production.json</c> depuis la PR #180.
/// Un retour accidentel à <c>false</c> dans le fichier devient un test rouge : le repli opérationnel passe par
/// variable d'environnement (<c>Ollama__EnableStudioWorkflows=false</c>), qui prime sur le fichier, pas par le dépôt.
/// Le fichier de développement (<c>appsettings.json</c>) reste à <c>false</c> (activation par variable, D-41-13 pour le dev).
/// Motif <c>RepoRelativePath</c> repris de <c>AddStudioRecordViewsMigrationTests</c>.
/// </summary>
public sealed class ProductionStudioFlagsTests
{
    private static string RepoRelativePath(params string[] segments) => Path.GetFullPath(Path.Combine(
        new[] { AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", ".." }
            .Concat(segments)
            .ToArray()));

    private static JsonElement ReadOllamaSection(string fileName)
    {
        var path = RepoRelativePath("src", "Backend", "FactuTrust.API", fileName);
        Assert.True(File.Exists(path), $"Settings file not found: {path}");

        using var document = JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions
        {
            CommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true,
        });

        return document.RootElement.GetProperty("Ollama").Clone();
    }

    [Theory]
    [InlineData("EnableStudioWorkflows")]
    [InlineData("EnableStudioAiWorkflowTools")]
    public void Production_settings_enable_the_studio_workflow_flags(string flag)
    {
        var ollama = ReadOllamaSection("appsettings.Production.json");

        Assert.Equal(JsonValueKind.True, ollama.GetProperty(flag).ValueKind);
    }

    [Fact]
    public void Production_settings_keep_the_ai_plan_preview_enabled_so_the_workflow_tool_is_effective()
    {
        // StudioAiPlanCreationFeatures : outil studio_plan_workflow effectif seulement si les trois drapeaux sont vrais.
        var ollama = ReadOllamaSection("appsettings.Production.json");

        Assert.Equal(JsonValueKind.True, ollama.GetProperty("EnableStudioAiPlanPreview").ValueKind);
    }

    [Theory]
    [InlineData("_commentStudioWorkflows")]
    [InlineData("_commentStudioAiWorkflowTools")]
    public void Production_comments_no_longer_announce_a_deferred_activation(string commentKey)
    {
        var comment = ReadOllamaSection("appsettings.Production.json").GetProperty(commentKey).GetString();

        Assert.NotNull(comment);
        Assert.DoesNotContain("false tant que", comment, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("false jusqu'à", comment, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("D-47-90", comment);
        Assert.Contains("Repli", comment);
    }

    [Theory]
    [InlineData("EnableStudioWorkflows")]
    [InlineData("EnableStudioAiWorkflowTools")]
    public void Development_settings_keep_the_studio_workflow_flags_off(string flag)
    {
        var ollama = ReadOllamaSection("appsettings.json");

        Assert.Equal(JsonValueKind.False, ollama.GetProperty(flag).ValueKind);
    }
}
