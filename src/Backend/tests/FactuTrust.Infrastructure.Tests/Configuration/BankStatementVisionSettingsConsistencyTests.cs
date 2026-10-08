using System.Text.Json;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Configuration;

/// <summary>
/// Import de relevés bancaires par GLM-OCR (plan v1 §4.2–4.4, §7.1) : cohérence des réglages
/// embarqués dans <c>appsettings.Production.json</c> (avec héritage de <c>appsettings.json</c>).
/// Un retour accidentel (modèle vision des relevés différent de celui de la facture, délai Ollama
/// trop court pour un appel GLM-OCR, plus d'ouvriers que de créneaux de génération, budget de tâche
/// insuffisant pour 20 pages, envoi de la couche texte, IA externe) devient un test rouge.
/// Le repli opérationnel passe par variable d'environnement (<c>Accounting__BankStatementImport__…</c>),
/// qui prime sur le fichier, pas par le dépôt. Motif <c>RepoRelativePath</c> repris de
/// <see cref="ProductionStudioFlagsTests"/>.
/// </summary>
public sealed class BankStatementVisionSettingsConsistencyTests
{
    private const string GlmOcr = "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0";

    private static string RepoRelativePath(params string[] segments) => Path.GetFullPath(Path.Combine(
        new[] { AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", ".." }
            .Concat(segments)
            .ToArray()));

    private static JsonElement ReadRoot(string fileName)
    {
        var path = RepoRelativePath("src", "Backend", "FactuTrust.API", fileName);
        Assert.True(File.Exists(path), $"Settings file not found: {path}");

        using var document = JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions
        {
            CommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true,
        });

        return document.RootElement.Clone();
    }

    /// <summary>Lit <c>Section:Key</c> dans le fichier d'environnement, sinon dans le fichier de base (héritage ASP.NET Core).</summary>
    private static JsonElement? Resolve(JsonElement environment, JsonElement baseFile, params string[] path)
    {
        var fromEnvironment = TryGet(environment, path);
        return fromEnvironment ?? TryGet(baseFile, path);
    }

    private static JsonElement? TryGet(JsonElement root, params string[] path)
    {
        var current = root;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out var next))
                return null;
            current = next;
        }

        return current;
    }

    private static int Int(JsonElement? element, string what)
    {
        Assert.True(element.HasValue, $"{what} must be set");
        return element!.Value.GetInt32();
    }

    private static bool Bool(JsonElement? element, string what)
    {
        Assert.True(element.HasValue, $"{what} must be set");
        Assert.True(element!.Value.ValueKind is JsonValueKind.True or JsonValueKind.False, $"{what} must be a boolean");
        return element.Value.GetBoolean();
    }

    private static string Str(JsonElement? element, string what)
    {
        Assert.True(element.HasValue, $"{what} must be set");
        return element!.Value.GetString() ?? string.Empty;
    }

    private readonly JsonElement _production = ReadRoot("appsettings.Production.json");
    private readonly JsonElement _development = ReadRoot("appsettings.Development.json");
    private readonly JsonElement _base = ReadRoot("appsettings.json");

    private JsonElement? Prod(params string[] path) => Resolve(_production, _base, path);
    private JsonElement? Dev(params string[] path) => Resolve(_development, _base, path);

    [Fact]
    public void Production_disables_legacy_import_vision_appsettings_by_default()
    {
        var honorLegacy = Bool(Prod("Ollama", "HonorLegacyImportVisionModels"), "Ollama:HonorLegacyImportVisionModels");
        Assert.False(honorLegacy, "Production must use the platform admin import model (HonorLegacyImportVisionModels=false).");
    }

    [Fact]
    public void Production_statement_vision_model_is_glm_ocr_and_equals_the_invoice_vision_model()
    {
        var honorLegacy = TryGet(_production, "Ollama", "HonorLegacyImportVisionModels");
        if (honorLegacy is { ValueKind: JsonValueKind.True })
        {
            var statement = Str(Prod("Ollama", "BankStatementImportVisionModel"), "Ollama:BankStatementImportVisionModel");
            var invoice = Str(Prod("Ollama", "InvoiceImportVisionModel"), "Ollama:InvoiceImportVisionModel");

            Assert.Equal(GlmOcr, statement);
            Assert.Equal(invoice, statement);
            Assert.True(
                TryGet(_production, "Ollama", "BankStatementImportVisionModel").HasValue,
                "Production must name the statement vision model explicitly (no silent inheritance from InvoiceImportVisionModel).");
        }
    }

    [Fact]
    public void Development_names_the_statement_vision_model_even_when_the_invoice_model_differs()
    {
        var statement = Str(Dev("Ollama", "BankStatementImportVisionModel"), "Ollama:BankStatementImportVisionModel");

        Assert.False(string.IsNullOrWhiteSpace(statement));
        Assert.Equal(GlmOcr, statement);
    }

    [Fact]
    public void Ollama_http_timeout_covers_a_vision_call_plus_one_minute()
    {
        var ollamaTimeout = Int(Prod("Ollama", "TimeoutSeconds"), "Ollama:TimeoutSeconds");
        var visionCall = Int(Prod("Accounting", "BankStatementImport", "VisionCallTimeoutSeconds"), "VisionCallTimeoutSeconds");

        Assert.True(
            ollamaTimeout >= visionCall + 60,
            $"Ollama:TimeoutSeconds ({ollamaTimeout}) must be >= VisionCallTimeoutSeconds ({visionCall}) + 60, otherwise the HTTP client gives up before the GLM-OCR call does.");
        Assert.Equal(360, Int(Dev("Ollama", "TimeoutSeconds"), "Ollama:TimeoutSeconds (Development)"));
    }

    [Fact]
    public void Ai_workers_never_exceed_the_engine_generation_slots()
    {
        var workers = Int(Prod("Accounting", "BankStatementImport", "AiWorkerCount"), "AiWorkerCount");
        var slots = Int(Prod("Ollama", "MaxConcurrentGenerations"), "Ollama:MaxConcurrentGenerations");

        Assert.True(workers >= 1);
        Assert.True(
            workers <= slots,
            $"AiWorkerCount ({workers}) must be <= Ollama:MaxConcurrentGenerations ({slots}); extra workers only wait behind the gate while their budget runs out.");
    }

    [Theory]
    [InlineData("AiOnlyReadingEnabled")]
    [InlineData("AiBalanceMismatchAsWarning")]
    [InlineData("VisionReadingEnabled")]
    public void Production_enables_vision_reading_of_every_statement(string flag)
    {
        Assert.True(Bool(Prod("Accounting", "BankStatementImport", flag), $"Accounting:BankStatementImport:{flag}"), $"{flag} must be true in production");
        Assert.True(Bool(Prod("Accounting", "BankStatementAiForAllDocumentsEnabled"), "Accounting:BankStatementAiForAllDocumentsEnabled"));
        Assert.True(Bool(Prod("Accounting", "BankStatementAiPostingEnabled"), "Accounting:BankStatementAiPostingEnabled"));
    }

    /// <summary>
    /// Le repli « modèle texte » (même modèle, SANS l'image) est un interrupteur de dépannage : éteint
    /// partout. Une page que la vision ne lit pas est signalée non lue, et le relevé est bloqué — plutôt
    /// qu'enregistré amputé à partir d'une lecture dégradée.
    /// </summary>
    [Theory]
    [InlineData("appsettings.json")]
    [InlineData("appsettings.Development.json")]
    [InlineData("appsettings.Production.json")]
    public void The_text_fallback_is_off_everywhere(string file)
    {
        var value = TryGet(ReadRoot(file), "Accounting", "BankStatementImport", "VisionTextFallbackEnabled");
        Assert.False(Bool(value, $"{file} → Accounting:BankStatementImport:VisionTextFallbackEnabled"),
            $"{file}: VisionTextFallbackEnabled must stay off; turning it on re-enables reading pages without their image.");
    }

    [Fact]
    public void Production_sends_only_the_page_image_and_never_reaches_an_external_provider()
    {
        Assert.False(Bool(Prod("Accounting", "BankStatementImport", "VisionSendTextLayer"), "VisionSendTextLayer"), "The text layer must not be sent with the page image (GLM-OCR reads the image alone).");

        var external = Prod("Accounting", "BankStatementImport", "AiComplementAllowExternal");
        Assert.True(
            external is null || external.Value.ValueKind == JsonValueKind.False,
            "AiComplementAllowExternal must be absent or false: no statement page may leave the local engine.");

        // Docstrange est un SECOND chemin de sortie, independant du precedent : il ne passe pas
        // par LlmProviderKind, donc AiComplementAllowExternal ne le couvre pas. Les deux doivent
        // etre epingles separement, sans quoi fermer l'un laisserait l'autre ouvert.
        var docStrange = Prod("Accounting", "BankStatementImport", "DocStrangeEnabled");
        Assert.True(
            docStrange is null || docStrange.Value.ValueKind == JsonValueKind.False,
            "DocStrangeEnabled must be absent or false: no statement page may be sent to Nanonets.");
    }

    [Theory]
    [InlineData("appsettings.json")]
    [InlineData("appsettings.Development.json")]
    [InlineData("appsettings.Production.json")]
    public void The_docstrange_statement_switch_is_off_everywhere(string file)
    {
        // Absent partout aujourd'hui : la valeur par defaut du code (false) fait foi. Le jour ou
        // quelqu'un l'ecrit dans un appsettings, ce test exige qu'il l'ecrive a false.
        var value = TryGet(ReadRoot(file), "Accounting", "BankStatementImport", "DocStrangeEnabled");
        Assert.True(
            value is null || value.Value.ValueKind == JsonValueKind.False,
            $"{file}: DocStrangeEnabled must stay absent or false; turning it on sends bank statement pages to a third party.");
    }

    [Fact]
    public void Job_budget_covers_the_maximum_number_of_ai_pages_with_margin()
    {
        var maxAiPages = Int(Prod("Accounting", "BankStatementImport", "MaxAiPages"), "MaxAiPages");
        var visionCall = Int(Prod("Accounting", "BankStatementImport", "VisionCallTimeoutSeconds"), "VisionCallTimeoutSeconds");
        var budgetMinutes = Int(Prod("Accounting", "BankStatementImport", "AiJobBudgetMinutes"), "AiJobBudgetMinutes");

        // Pire cas : chaque page épuise l'appel vision puis se replie sur le texte (+60 s), marge 1,5.
        var worstCaseSeconds = maxAiPages * (visionCall + 60) * 1.5;
        Assert.True(
            worstCaseSeconds <= budgetMinutes * 60,
            $"AiJobBudgetMinutes ({budgetMinutes}) must cover MaxAiPages ({maxAiPages}) × (VisionCallTimeoutSeconds + 60) × 1.5 = {worstCaseSeconds / 60:0} min.");
        Assert.Equal(20, maxAiPages);
        Assert.Equal(50, Int(Prod("Accounting", "BankStatementImport", "MaxPages"), "MaxPages"));
        Assert.InRange(budgetMinutes, 20, 240);
    }

    [Fact]
    public void Production_vision_rendering_values_match_the_documented_limits()
    {
        Assert.Equal(200, Int(Prod("Accounting", "BankStatementImport", "VisionRenderDpi"), "VisionRenderDpi"));
        Assert.Equal(4096, Int(Prod("Accounting", "BankStatementImport", "VisionMaxOutputTokens"), "VisionMaxOutputTokens"));
        Assert.Equal(300, Int(Prod("Accounting", "BankStatementImport", "VisionCallTimeoutSeconds"), "VisionCallTimeoutSeconds"));
        Assert.Equal(180, Int(Prod("Accounting", "BankStatementImport", "VisionEstimatedSecondsPerPage"), "VisionEstimatedSecondsPerPage"));
    }

    [Fact]
    public void Development_mirrors_the_production_reading_flags()
    {
        Assert.True(Bool(Dev("Accounting", "BankStatementAiForAllDocumentsEnabled"), "BankStatementAiForAllDocumentsEnabled (Development)"));
        Assert.True(Bool(Dev("Accounting", "BankStatementImport", "AiOnlyReadingEnabled"), "AiOnlyReadingEnabled (Development)"));
        Assert.True(Bool(Dev("Accounting", "BankStatementImport", "VisionReadingEnabled"), "VisionReadingEnabled (Development)"));
        Assert.False(Bool(Dev("Accounting", "BankStatementImport", "VisionSendTextLayer"), "VisionSendTextLayer (Development)"));
        Assert.Equal(1, Int(Dev("Accounting", "BankStatementImport", "AiWorkerCount"), "AiWorkerCount (Development)"));
    }
}
