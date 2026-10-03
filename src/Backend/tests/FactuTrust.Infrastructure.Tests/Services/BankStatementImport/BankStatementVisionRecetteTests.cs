using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.Json;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Xunit;
using Xunit.Abstractions;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Recette GLM-OCR (modèle vision) sur les relevés privés : une page par appel, schéma verbatim,
/// durées et comptes de tokens uniquement en sortie (pas de montant, libellé ni RIB).
/// </summary>
[Trait("Category", "PrivateBankFixtures")]
public sealed class BankStatementVisionRecetteTests(ITestOutputHelper output)
{
    private const string FixturesVariable = "FACTUTRUST_PRIVATE_BANK_FIXTURES";
    private const string OllamaUrlVariable = "FACTUTRUST_RECETTE_OLLAMA_URL";
    private const string VisionModelVariable = "FACTUTRUST_RECETTE_VISION_MODEL";
    private const string DefaultVisionModel = "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString
    };

    public static IEnumerable<object[]> Statements()
    {
        var directory = Environment.GetEnvironmentVariable(FixturesVariable);
        var path = string.IsNullOrWhiteSpace(directory) ? null : Path.Combine(directory, "expected.json");
        var count = path is not null && File.Exists(path)
            ? JsonSerializer.Deserialize<ExpectedFile>(File.ReadAllText(path), JsonOptions)!.Statements.Count
            : 1;
        return Enumerable.Range(0, Math.Max(1, count)).Select(i => new object[] { i });
    }

    [SkippableTheory]
    [MemberData(nameof(Statements))]
    public async Task Vision_model_returns_parseable_json_for_the_densest_page(int index)
    {
        var directory = Environment.GetEnvironmentVariable(FixturesVariable);
        var ollama = Environment.GetEnvironmentVariable(OllamaUrlVariable);
        Skip.If(string.IsNullOrWhiteSpace(directory) || string.IsNullOrWhiteSpace(ollama),
            $"{FixturesVariable} et {OllamaUrlVariable} requis : recette vision ignorée.");
        var expectedPath = Path.Combine(directory!, "expected.json");
        Skip.IfNot(File.Exists(expectedPath), "expected.json absent : recette vision ignorée.");
        var file = JsonSerializer.Deserialize<ExpectedFile>(File.ReadAllText(expectedPath), JsonOptions)!.Statements[index].File;
        var pdf = await File.ReadAllBytesAsync(Path.Combine(directory!, file));

        var extractor = new BankStatementLayoutExtractor();
        var direct = extractor.Extract(pdf);
        var page = direct.Lines.Count > 0
            ? direct.Lines.GroupBy(l => l.PageNumber).OrderByDescending(g => g.Count()).First().Key
            : 1;

        var pageBytes = BankStatementAiExtractionJob.ExtractSinglePage(pdf, page);
        using var http = new HttpClient { BaseAddress = new Uri(ollama!), Timeout = TimeSpan.FromMinutes(10) };
        var model = Environment.GetEnvironmentVariable(VisionModelVariable) is { Length: > 0 } m ? m : DefaultVisionModel;

        var watch = Stopwatch.StartNew();
        var raw = await ChatVisionAsync(http, model, pageBytes);
        watch.Stop();
        output.WriteLine($"{file} page {page} : vision en {watch.Elapsed.TotalSeconds:F0} s, {raw.Length} caractères bruts");

        var json = InvoiceImportParsing.ExtractFirstJsonObject(raw);
        Skip.If(string.IsNullOrWhiteSpace(json), "Réponse vision sans JSON exploitable (recette manuelle).");

        var normalized = BankStatementVisionPageNormalizer.Normalize(json, page);
        var reading = BankStatementAiPageReader.Read(normalized, page, ocrText: null, acceptDayFirstDates: true);
        Assert.DoesNotContain(reading.Issues, i => i.Code == StatementIssueCodes.AiPageFailed);
    }

    private static async Task<string> ChatVisionAsync(HttpClient http, string model, byte[] pagePdf)
    {
        var imageBase64 = await RenderPageBase64Async(pagePdf);
        var body = new
        {
            model,
            stream = false,
            format = LlmOutputSchemas.BankStatementPageVerbatim,
            options = new { temperature = 0, num_predict = 4096, num_ctx = 16384 },
            messages = new object[]
            {
                new { role = "system", content = BankStatementVisionPrompt.System },
                new
                {
                    role = "user",
                    content = AiStructuredExtractionPipeline.BuildUserPrompt(
                        string.Empty,
                        hasImages: true,
                        BankStatementVisionPrompt.UserInstruction),
                    images = new[] { imageBase64 }
                }
            }
        };
        using var response = await http.PostAsJsonAsync("/api/chat", body);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.GetProperty("message").GetProperty("content").GetString() ?? string.Empty;
    }

    private static async Task<string> RenderPageBase64Async(byte[] pagePdf)
    {
        var renderer = new FactuTrust.Infrastructure.Services.AI.PdfToImagePdfRenderer(
            Microsoft.Extensions.Logging.Abstractions.NullLogger<FactuTrust.Infrastructure.Services.AI.PdfToImagePdfRenderer>.Instance);
        var rendered = await renderer.RenderPageAsync(pagePdf, 0, 200);
        return Convert.ToBase64String(rendered!.PngBytes);
    }

    private sealed record ExpectedFile(List<ExpectedStatement> Statements);

    private sealed record ExpectedStatement(string File);
}
