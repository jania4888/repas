using System.Text.Json;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;
using static FactuTrust.Infrastructure.Tests.Services.BankStatementImport.SyntheticBankStatementPdf;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Tâche IA avec un plan de lecture (« tout document par l'IA ») : les pages texte partent en extraits
/// texte (jamais le PDF découpé en blocs), un appel par extrait, la ligne manquée par la lecture directe
/// est complétée si son montant est imprimé, un extrait en échec laisse la page bloquante.
/// </summary>
public sealed class BankStatementAiExtractionJobTextPagesTests : IDisposable
{
    private readonly string _dbName = $"BankStatementAiJobText_{Guid.NewGuid():N}";
    private readonly string _storage = Path.Combine(Path.GetTempPath(), "ft-bqall-job-tests", Guid.NewGuid().ToString("N"));
    private readonly Mock<IAiStructuredExtractionPipeline> _pipeline = new();
    private readonly List<(AiStructuredExtractionRequest Request, string Content)> _calls = new();

    public void Dispose()
    {
        try { if (Directory.Exists(_storage)) Directory.Delete(_storage, recursive: true); }
        catch (IOException) { }
    }

    private sealed class InMemoryFactory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() => new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }

    private IServiceProvider Services()
    {
        var settings = new AccountingSettings { BankStatementAiPostingEnabled = true, BankStatementAiForAllDocumentsEnabled = true };
        settings.BankStatementImport.StorageBasePath = _storage;
        var services = new ServiceCollection();
        services.AddSingleton<ITenantDbContextFactory>(new InMemoryFactory(_dbName));
        services.AddSingleton(_pipeline.Object);
        services.AddSingleton(Options.Create(settings));
        services.AddSingleton<BankStatementFileStore>();
        return services.BuildServiceProvider();
    }

    private static Spec ThreeOperations() => new("10", 1_000.000m, new[]
    {
        new Op("02/01/2026", "05/01/2026", new[] { "VIREMENT REÇU SOCIETE ALPHA" }, null, 2_149.079m),
        new Op("02/01/2026", "31/12/2025", new[] { "COMMISSION VIREMENT" }, 1.500m, null),
        new Op("05/01/2026", "02/01/2026", new[] { "RÈG CHÈQUE N° 0001234" }, 2_400.000m, null)
    });

    /// <summary>Session « en cours » dont la lecture directe a manqué l'opération de 1,500 (montant isolé).</summary>
    private async Task<Guid> SeedSessionMissingOneLineAsync(IServiceProvider services, byte[] pdf, decimal missing)
    {
        var direct = new BankStatementLayoutExtractor().Extract(pdf);
        Assert.False(direct.HasBlockingIssue, string.Join(" | ", direct.Issues.Select(i => i.Code + ":" + i.Message)));
        var interim = direct with
        {
            Lines = direct.Lines.Where(l => l.Amount != missing).Select((l, i) => l with { Index = i }).ToList(),
            Issues = new[] { new StatementExtractionIssue(StatementIssueCodes.OrphanAmount, StatementIssueSeverity.Blocking, "isolé", 1) },
            AiPlan = new BankStatementAiPlan { TextPages = new[] { 1 }, Reason = BankStatementAiReadingReasons.LineIssues, EstimatedCalls = 1 }
        };

        var session = BankStatementImportSession.Create(Guid.NewGuid(), "JB", "releve.pdf", "CD34", pdf.Length, "application/pdf", DateTime.UtcNow.AddHours(1));
        session.AttachFile(await services.GetRequiredService<BankStatementFileStore>()
            .SaveSessionFileAsync(Guid.NewGuid(), session.Id, ".pdf", pdf, CancellationToken.None));
        session.StartAiExtraction("local", JsonSerializer.Serialize(interim, BankStatementImportService.JsonOptions), direct.ProfileId, direct.PageCount);

        await using var ctx = services.GetRequiredService<ITenantDbContextFactory>().CreateContext();
        ctx.BankStatementImportSessions.Add(session);
        await ctx.SaveChangesAsync();
        return session.Id;
    }

    private void PipelineReturns(Func<int, Result<AiStructuredExtractionOutcome>> answer) =>
        _pipeline.Setup(p => p.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()))
            .Returns<AiStructuredExtractionRequest, CancellationToken>((request, _) =>
            {
                using var reader = new StreamReader(request.FileStream);
                _calls.Add((request, reader.ReadToEnd()));
                return Task.FromResult(answer(_calls.Count));
            });

    private static Result<AiStructuredExtractionOutcome> Answer(string raw) =>
        Result.Success(new AiStructuredExtractionOutcome(raw,
            new AiDocumentExtractionResult { Success = true, Text = "texte", Format = "txt", PageCount = 1 },
            false, "ollama:test", false, 1, 10));

    private static Task RunAsync(IServiceProvider services, Guid sessionId) =>
        new BankStatementAiExtractionJob(Mock.Of<FactuTrust.Application.Common.Interfaces.ITenantService>(),
                Mock.Of<IServiceScopeFactory>(), NullLogger<BankStatementAiExtractionJob>.Instance)
            .RunAsync(services, sessionId, CancellationToken.None);

    private static async Task<BankStatementImportSessionDto> SessionAsync(IServiceProvider services, Guid sessionId)
    {
        await using var ctx = services.GetRequiredService<ITenantDbContextFactory>().CreateContext();
        return BankStatementImportService.ToDto(await ctx.BankStatementImportSessions.SingleAsync(s => s.Id == sessionId));
    }

    [Fact]
    public async Task Missed_line_is_completed_from_a_text_extract_and_the_statement_balances()
    {
        var services = Services();
        var pdf = StbLike(ThreeOperations());
        var sessionId = await SeedSessionMissingOneLineAsync(services, pdf, missing: 1.500m);
        PipelineReturns(_ => Answer("""
            {"openingBalance":1000.000,"closingBalance":null,"lines":[
              {"date":"2026-01-02","valueDate":"2026-01-05","label":"VIREMENT REÇU SOCIETE ALPHA","debit":null,"credit":2149.079},
              {"date":"2026-01-02","valueDate":"2025-12-31","label":"COMMISSION VIREMENT","debit":1.500,"credit":null},
              {"date":"2026-01-05","valueDate":"2026-01-02","label":"RÈG CHÈQUE N° 0001234","debit":2400.000,"credit":null}]}
            """));

        await RunAsync(services, sessionId);

        var dto = await SessionAsync(services, sessionId);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), dto.Status);
        Assert.Equal("layout+ai", dto.ExtractionMethod);
        Assert.True(dto.CanConfirm, string.Join(" | ", dto.Extraction!.Issues.Select(i => i.Message)));
        Assert.Equal(3, dto.Extraction!.Lines.Count);
        Assert.Equal(StatementLineSource.Ai, dto.Extraction.Lines.Single(l => l.Amount == 1.500m).Source);
        Assert.Equal(2, dto.Extraction.Lines.Count(l => l.Source == StatementLineSource.Layout));

        var call = Assert.Single(_calls);
        Assert.Equal("text/plain", call.Request.ContentType);
        Assert.EndsWith(".txt", call.Request.FileName, StringComparison.Ordinal);
        Assert.Equal(BankStatementAiPrompt.System, call.Request.SystemPrompt);
        Assert.Equal(BankStatementAiPrompt.TextExtractInstruction, call.Request.UserInstruction);
        Assert.Contains("COMMISSION VIREMENT", call.Content, StringComparison.Ordinal);
        Assert.DoesNotContain(ThreeOperations().Rib, call.Content, StringComparison.Ordinal);
    }

    [Fact]
    public async Task One_call_is_made_per_extract_and_progress_reaches_100()
    {
        var services = Services();
        var ops = Enumerable.Range(1, 20)
            .Select(i => new Op($"{i:D2}/01/2026", $"{i:D2}/01/2026", new[] { $"OPERATION {i:D2}" }, 10m + i, null))
            .ToList();
        var pdf = StbLike(new Spec("10", 5_000.000m, ops));
        var sessionId = await SeedSessionMissingOneLineAsync(services, pdf, missing: 11m);
        PipelineReturns(_ => Answer("""{"lines":[]}"""));

        await RunAsync(services, sessionId);

        Assert.Equal(4, _calls.Count);
        var dto = await SessionAsync(services, sessionId);
        Assert.Equal(100, dto.ProgressPercent);
        // L'IA n'a rien trouvé : la ligne manquante manque toujours, le relevé reste bloqué (rien d'inventé).
        Assert.False(dto.CanConfirm);
        Assert.Equal(19, dto.Extraction!.Lines.Count);
    }

    [Fact]
    public async Task Failed_extract_keeps_the_page_blocking_with_the_direct_reading()
    {
        var services = Services();
        var pdf = StbLike(ThreeOperations());
        var sessionId = await SeedSessionMissingOneLineAsync(services, pdf, missing: 1.500m);
        PipelineReturns(_ => Result.Failure<AiStructuredExtractionOutcome>(Error.Validation("BankStatementImport", "Moteur IA indisponible.")));

        await RunAsync(services, sessionId);

        var dto = await SessionAsync(services, sessionId);
        Assert.False(dto.CanConfirm);
        Assert.Contains(dto.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiPageFailed);
        Assert.Contains(dto.Extraction.Issues, i => i.Code == StatementIssueCodes.OrphanAmount);
        Assert.Equal(2, dto.Extraction.Lines.Count);
    }

    [Theory]
    [InlineData(1, 180, 120, 20)]
    [InlineData(10, 180, 120, 40)]
    [InlineData(30, 180, 120, 120)]
    [InlineData(60, 180, 120, 120)]
    [InlineData(30, 180, 240, 120)]
    public void Budget_grows_with_the_number_of_calls_within_bounds(int calls, int llmSeconds, int maxMinutes, int expectedMinutes) =>
        Assert.Equal(TimeSpan.FromMinutes(expectedMinutes), BankStatementAiExtractionJob.ComputeBudget(calls, llmSeconds, maxMinutes));
}
