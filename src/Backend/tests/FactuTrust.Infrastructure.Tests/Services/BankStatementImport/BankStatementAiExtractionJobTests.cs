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

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>Tâche de lecture IA : page lue ⇒ relevé complété et contrôlé ; IA en échec ⇒ page bloquante, jamais devinée.</summary>
public sealed class BankStatementAiExtractionJobTests : IDisposable
{
    private readonly string _dbName = $"BankStatementAiJob_{Guid.NewGuid():N}";
    private readonly string _storage = Path.Combine(Path.GetTempPath(), "ft-bqia-job-tests", Guid.NewGuid().ToString("N"));
    private readonly Mock<IAiStructuredExtractionPipeline> _pipeline = new();

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
        var settings = new AccountingSettings { BankStatementAiPostingEnabled = true };
        settings.BankStatementImport.StorageBasePath = _storage;
        var services = new ServiceCollection();
        services.AddSingleton<ITenantDbContextFactory>(new InMemoryFactory(_dbName));
        services.AddSingleton(_pipeline.Object);
        services.AddSingleton(Options.Create(settings));
        services.AddSingleton<BankStatementFileStore>();
        return services.BuildServiceProvider();
    }

    private async Task<Guid> SeedExtractingSessionAsync(IServiceProvider services)
    {
        var tenantId = Guid.NewGuid();
        var session = BankStatementImportSession.Create(Guid.NewGuid(), "JB", "releve.png", "AB12", 10, "image/png", DateTime.UtcNow.AddHours(1));
        var interim = new ExtractedBankStatement
        {
            Header = new ExtractedStatementHeader(),
            Lines = Array.Empty<ExtractedStatementLine>(),
            Issues = new[] { new StatementExtractionIssue(StatementIssueCodes.NoTextLayer, StatementIssueSeverity.Blocking, "scan", 1) },
            ProfileId = "generic",
            PageCount = 1,
            UnresolvedPages = new[] { 1 }
        };
        session.AttachFile(await services.GetRequiredService<BankStatementFileStore>()
            .SaveSessionFileAsync(tenantId, session.Id, ".png", new byte[] { 0x89, 0x50, 0x4E, 0x47 }, CancellationToken.None));
        session.StartAiExtraction("local", JsonSerializer.Serialize(interim, BankStatementImportService.JsonOptions), "generic", 1);

        await using var ctx = services.GetRequiredService<ITenantDbContextFactory>().CreateContext();
        ctx.BankStatementImportSessions.Add(session);
        await ctx.SaveChangesAsync();
        return session.Id;
    }

    private void PipelineReturns(string raw, string ocr) =>
        _pipeline.Setup(p => p.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new AiStructuredExtractionOutcome(raw,
                new AiDocumentExtractionResult { Success = true, Text = ocr, Format = "image", OcrApplied = true, PageCount = 1 },
                false, "ollama:test", false, 1, 10)));

    [Fact]
    public async Task Read_page_completes_a_reconciled_statement()
    {
        var services = Services();
        var sessionId = await SeedExtractingSessionAsync(services);
        PipelineReturns("""
            {"openingBalance":50.250,"closingBalance":1150.250,"lines":[
              {"date":"2026-01-09","label":"VERSEMENT ESPECES","credit":18100},
              {"date":"2026-01-10","label":"PAIEMENT PRINCIPAL","debit":17000.000}]}
            """, "SOLDE DEBUT 50,250 VERSEMENT ESPECES 18100,000 PAIEMENT PRINCIPAL -17000,000 1150,250");

        await new BankStatementAiExtractionJob(Mock.Of<FactuTrust.Application.Common.Interfaces.ITenantService>(),
                Mock.Of<IServiceScopeFactory>(), NullLogger<BankStatementAiExtractionJob>.Instance)
            .RunAsync(services, sessionId, CancellationToken.None);

        await using var ctx = services.GetRequiredService<ITenantDbContextFactory>().CreateContext();
        var session = await ctx.BankStatementImportSessions.SingleAsync(s => s.Id == sessionId);
        Assert.Equal(BankStatementImportSessionStatus.AwaitingReview, session.Status);
        Assert.Equal("ai", session.ExtractionMethod);
        var dto = BankStatementImportService.ToDto(session);
        Assert.True(dto.CanConfirm);
        Assert.Equal(2, dto.Extraction!.Lines.Count);
        Assert.All(dto.Extraction.Lines, l => Assert.Equal(StatementLineSource.Ai, l.Source));

        _pipeline.Verify(p => p.RunAsync(It.Is<AiStructuredExtractionRequest>(r =>
            r.SystemPrompt == BankStatementAiPrompt.System
            && r.UserInstruction == BankStatementAiPrompt.UserInstruction
            && r.ModelOverride == null), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Ai_failure_leaves_the_page_blocking_instead_of_guessing()
    {
        var services = Services();
        var sessionId = await SeedExtractingSessionAsync(services);
        _pipeline.Setup(p => p.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<AiStructuredExtractionOutcome>(Error.Validation("BankStatementImport", "Moteur IA indisponible.")));

        await new BankStatementAiExtractionJob(Mock.Of<FactuTrust.Application.Common.Interfaces.ITenantService>(),
                Mock.Of<IServiceScopeFactory>(), NullLogger<BankStatementAiExtractionJob>.Instance)
            .RunAsync(services, sessionId, CancellationToken.None);

        await using var ctx = services.GetRequiredService<ITenantDbContextFactory>().CreateContext();
        var dto = BankStatementImportService.ToDto(await ctx.BankStatementImportSessions.SingleAsync(s => s.Id == sessionId));
        Assert.False(dto.CanConfirm);
        Assert.Contains(dto.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiPageFailed);
        Assert.Equal(new[] { 1 }, dto.Extraction.UnresolvedPages);
    }
}
