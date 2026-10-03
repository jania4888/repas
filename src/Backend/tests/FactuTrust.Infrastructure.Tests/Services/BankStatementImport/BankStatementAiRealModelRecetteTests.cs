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
/// Recette de la relecture IA des pages texte avec un VRAI modèle, sur les vrais relevés de la recette
/// privée (jamais commités) : pour chaque relevé, l'opération du milieu de la page la plus dense est
/// retirée de la lecture directe, la page est relue par le modèle (mêmes prompt, consigne, schéma et
/// extraits que la tâche de production), puis fusionnée. Attendu : l'opération est restaurée à
/// l'identique et le relevé boucle au millime, sans blocage.
///
/// Facultative : ignorée sans <c>FACTUTRUST_PRIVATE_BANK_FIXTURES</c> et <c>FACTUTRUST_RECETTE_OLLAMA_URL</c>
/// (ex. <c>http://localhost:11434</c>) ; modèle par <c>FACTUTRUST_RECETTE_OLLAMA_MODEL</c> (défaut : celui de
/// l'import en production). Les relevés étant réels, n'utiliser qu'une IA LOCALE. La sortie ne contient que
/// des noms de fichiers et des durées : ni montant, ni libellé, ni RIB.
/// </summary>
[Trait("Category", "PrivateBankFixtures")]
public sealed class BankStatementAiRealModelRecetteTests(ITestOutputHelper output)
{
    private const string FixturesVariable = "FACTUTRUST_PRIVATE_BANK_FIXTURES";
    private const string OllamaUrlVariable = "FACTUTRUST_RECETTE_OLLAMA_URL";
    private const string OllamaModelVariable = "FACTUTRUST_RECETTE_OLLAMA_MODEL";
    private const string DefaultModel = "qwen2.5:7b-instruct";

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
    public async Task Real_model_restores_an_operation_missed_by_the_direct_reading(int index)
    {
        var directory = Environment.GetEnvironmentVariable(FixturesVariable);
        var ollama = Environment.GetEnvironmentVariable(OllamaUrlVariable);
        Skip.If(string.IsNullOrWhiteSpace(directory) || string.IsNullOrWhiteSpace(ollama),
            $"{FixturesVariable} et {OllamaUrlVariable} requis : recette IA réelle ignorée.");
        var expectedPath = Path.Combine(directory!, "expected.json");
        Skip.IfNot(File.Exists(expectedPath), "expected.json absent : recette IA réelle ignorée.");
        var file = JsonSerializer.Deserialize<ExpectedFile>(File.ReadAllText(expectedPath), JsonOptions)!.Statements[index].File;
        var pdf = await File.ReadAllBytesAsync(Path.Combine(directory!, file));

        var extractor = new BankStatementLayoutExtractor();
        var direct = extractor.Extract(pdf);
        Assert.False(direct.HasBlockingIssue);
        var page = direct.Lines.GroupBy(l => l.PageNumber).OrderByDescending(g => g.Count()).First().Key;
        var pageLines = direct.Lines.Where(l => l.PageNumber == page).ToList();
        var removed = pageLines[pageLines.Count / 2];
        var layout = direct with
        {
            Lines = direct.Lines.Where(l => !ReferenceEquals(l, removed)).Select((l, i) => l with { Index = i }).ToList(),
            Issues = new[] { new StatementExtractionIssue(StatementIssueCodes.OrphanAmount, StatementIssueSeverity.Blocking, "retirée", page) }
        };
        Assert.Equal(new[] { page }, BankStatementAiReadingPlanner.Select(layout).TextPages);

        using var http = new HttpClient { BaseAddress = new Uri(ollama!), Timeout = TimeSpan.FromMinutes(10) };
        var model = Environment.GetEnvironmentVariable(OllamaModelVariable) is { Length: > 0 } m ? m : DefaultModel;
        var readings = new List<(BankStatementAiPageReader.PageReading, BankStatementAiTextChunk)>();
        foreach (var chunk in extractor.BuildAiTextChunks(pdf, new[] { page }, operationsPerChunk: 6))
        {
            var watch = Stopwatch.StartNew();
            var raw = await ChatAsync(http, model, chunk.Text);
            output.WriteLine($"{file} : extrait {chunk.Index + 1} lu en {watch.Elapsed.TotalSeconds:F0} s");
            readings.Add((BankStatementAiPageReader.Read(raw, chunk.Page, ocrText: null, acceptDayFirstDates: true), chunk));
        }

        var merged = BankStatementAiPageReader.Merge(layout, new Dictionary<int, BankStatementAiPageReader.PageReading>(), Array.Empty<int>(),
            new Dictionary<int, BankStatementAiPageReader.TextPageReading> { [page] = BankStatementAiPageReader.CombineChunks(readings) });

        Assert.False(merged.HasBlockingIssue, $"{file} : {string.Join(", ", merged.Issues.Where(i => i.Severity == StatementIssueSeverity.Blocking).Select(i => i.Code))}");
        Assert.Equal(direct.Lines.Count, merged.Lines.Count);
        var restored = Assert.Single(merged.Lines, l => l.Source == StatementLineSource.Ai);
        Assert.Equal(removed.Amount, restored.Amount);
        Assert.Equal(removed.IsDebit, restored.IsDebit);
        Assert.Equal(removed.TransactionDate, restored.TransactionDate);
    }

    private static async Task<string> ChatAsync(HttpClient http, string model, string text)
    {
        var body = new
        {
            model,
            stream = false,
            format = LlmOutputSchemas.BankStatementPage,
            options = new { temperature = 0, num_predict = 1536, num_ctx = 8192 },
            messages = new object[]
            {
                new { role = "system", content = BankStatementAiPrompt.System },
                new { role = "user", content = AiStructuredExtractionPipeline.BuildUserPrompt(text, false, BankStatementAiPrompt.TextExtractInstruction) }
            }
        };
        using var response = await http.PostAsJsonAsync("/api/chat", body);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.GetProperty("message").GetProperty("content").GetString() ?? string.Empty;
    }

    private sealed record ExpectedFile(List<ExpectedStatement> Statements);

    private sealed record ExpectedStatement(string File);
}
