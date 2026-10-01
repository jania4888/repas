using System.Text;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.Json;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using Hangfire;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>Disponibilité du modèle d'import et planification de la lecture IA (tâche Hangfire).</summary>
public sealed class BankStatementAiExtraction : IBankStatementAiExtraction
{
    private readonly IAiStructuredExtractionPipeline _pipeline;
    private readonly IOllamaClient _ollama;
    private readonly IBackgroundJobClient _jobs;
    private readonly ILogger<BankStatementAiExtraction> _logger;

    public BankStatementAiExtraction(
        IAiStructuredExtractionPipeline pipeline,
        IOllamaClient ollama,
        IBackgroundJobClient jobs,
        ILogger<BankStatementAiExtraction> logger)
    {
        _pipeline = pipeline;
        _ollama = ollama;
        _jobs = jobs;
        _logger = logger;
    }

    public async Task<BankStatementAiAvailability> CheckAvailabilityAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var model = await _pipeline.ResolveModelRefAsync(null, cancellationToken);
            if (string.IsNullOrWhiteSpace(model.ProviderModelId))
                return BankStatementAiAvailability.Unavailable("aucun modèle d'import IA n'est configuré.");

            if (model.Kind == LlmProviderKind.Ollama)
            {
                if (!await _ollama.IsAvailableAsync(cancellationToken))
                    return BankStatementAiAvailability.Unavailable("le moteur IA local est indisponible.");
                return new BankStatementAiAvailability(true, "local", model.CanonicalModelRef, null);
            }

            return new BankStatementAiAvailability(true, "external", model.CanonicalModelRef, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Import relevé : disponibilité de l'IA indéterminée.");
            return BankStatementAiAvailability.Unavailable("le moteur IA ne répond pas.");
        }
    }

    public void Schedule(Guid tenantId, Guid sessionId) =>
        _jobs.Enqueue<BankStatementAiExtractionJob>(job => job.ExecuteAsync(tenantId, sessionId, CancellationToken.None));
}

/// <summary>
/// Lecture IA des pages scannées d'un relevé, une page à la fois : un appel par page (la porte de
/// génération Ollama est relâchée entre deux pages, le chat et les autres imports s'intercalent),
/// budget de temps global, annulation coopérative entre les pages. Aucun libellé n'est journalisé.
/// </summary>
public sealed class BankStatementAiExtractionJob
{
    private static readonly TimeSpan Budget = TimeSpan.FromMinutes(20);

    private readonly ITenantService _tenantService;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<BankStatementAiExtractionJob> _logger;

    public BankStatementAiExtractionJob(
        ITenantService tenantService,
        IServiceScopeFactory scopeFactory,
        ILogger<BankStatementAiExtractionJob> logger)
    {
        _tenantService = tenantService;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    [AutomaticRetry(Attempts = 0)]
    public async Task ExecuteAsync(Guid tenantId, Guid sessionId, CancellationToken cancellationToken)
    {
        var connectionString = await _tenantService.GetConnectionStringAsync(tenantId, cancellationToken);
        if (string.IsNullOrEmpty(connectionString))
        {
            _logger.LogWarning("Lecture IA de relevé : tenant {TenantId} introuvable.", tenantId);
            return;
        }

        using var scope = _scopeFactory.CreateScope();
        scope.ServiceProvider.GetRequiredService<ITenantContext>().SetTenant(tenantId, connectionString);
        await RunAsync(scope.ServiceProvider, sessionId, cancellationToken);
    }

    internal async Task RunAsync(IServiceProvider services, Guid sessionId, CancellationToken cancellationToken)
    {
        var factory = services.GetRequiredService<ITenantDbContextFactory>();
        var pipeline = services.GetRequiredService<IAiStructuredExtractionPipeline>();
        var files = services.GetRequiredService<BankStatementFileStore>();
        var limits = services.GetRequiredService<IOptions<AccountingSettings>>().Value.BankStatementImport;

        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(Budget);

        await using var ctx = factory.CreateContext();
        var session = await ctx.BankStatementImportSessions.FirstOrDefaultAsync(s => s.Id == sessionId, budget.Token);
        if (session is null || session.Status != BankStatementImportSessionStatus.Extracting || session.ResultJson is null)
            return;

        try
        {
            var layout = BankStatementImportService.Deserialize(session.ResultJson)
                         ?? throw new InvalidOperationException("Résultat intermédiaire illisible.");
            var content = await files.ReadAsync(session.StoragePath, budget.Token)
                          ?? throw new InvalidOperationException("Fichier du relevé introuvable.");
            var isPdf = session.ContentType.Contains("pdf", StringComparison.OrdinalIgnoreCase)
                        || session.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase);

            var pages = layout.UnresolvedPages.Take(Math.Max(1, limits.MaxAiPages)).ToList();
            var readings = new Dictionary<int, BankStatementAiPageReader.PageReading>();
            var failed = new List<int>();

            for (var i = 0; i < pages.Count; i++)
            {
                var pageNumber = pages[i];
                if (await IsCancelledAsync(ctx, sessionId, budget.Token))
                    return;

                var pageBytes = isPdf ? ExtractSinglePage(content, pageNumber) : content;
                await using var stream = new MemoryStream(pageBytes);
                var outcome = await pipeline.RunAsync(new AiStructuredExtractionRequest
                {
                    FileStream = stream,
                    FileName = isPdf ? $"releve-page-{pageNumber}.pdf" : session.FileName,
                    ContentType = isPdf ? "application/pdf" : session.ContentType,
                    SystemPrompt = BankStatementAiPrompt.System,
                    UserInstruction = BankStatementAiPrompt.UserInstruction,
                    OutputSchema = LlmOutputSchemas.BankStatementPage,
                    ErrorCode = "BankStatementImport",
                    MaxImages = 1
                }, budget.Token);

                BankStatementAiPageReader.PageReading reading;
                if (outcome.IsFailure)
                {
                    reading = new BankStatementAiPageReader.PageReading(
                        Array.Empty<ExtractedStatementLine>(), null, null,
                        new[]
                        {
                            new StatementExtractionIssue(StatementIssueCodes.AiPageFailed, StatementIssueSeverity.Blocking,
                                $"Page {pageNumber} non lue par l'IA : {outcome.Error.Description}", pageNumber)
                        });
                }
                else
                {
                    reading = BankStatementAiPageReader.Read(outcome.Value.RawContent, pageNumber, outcome.Value.Extraction.Text);
                }

                readings[pageNumber] = reading;
                if (reading.Issues.Any(x => x.Code == StatementIssueCodes.AiPageFailed))
                    failed.Add(pageNumber);

                session.ReportProgress((i + 1) * 100 / pages.Count);
                await ctx.SaveChangesAsync(budget.Token);
            }

            var merged = BankStatementAiPageReader.Merge(layout, readings, failed);
            var method = layout.Lines.Count > 0 ? "layout+ai" : "ai";
            session.CompleteExtraction(JsonSerializer.Serialize(merged, BankStatementImportService.JsonOptions), method, layout.ProfileId, layout.PageCount);
            await ctx.SaveChangesAsync(budget.Token);

            _logger.LogInformation(
                "Lecture IA de relevé : session {SessionId}, {Pages} page(s) lue(s), {Failed} en échec, {Lines} ligne(s) au total.",
                sessionId, readings.Count, failed.Count, merged.Lines.Count);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Session annulée par l'utilisateur pendant la lecture : rien à faire.
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            await FailAsync(ctx, session, "ai_timeout");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Lecture IA de relevé : échec de la session {SessionId}.", sessionId);
            await FailAsync(ctx, session, "ai_failed");
        }
    }

    private static async Task<bool> IsCancelledAsync(Persistence.TenantDbContext ctx, Guid sessionId, CancellationToken cancellationToken) =>
        await ctx.BankStatementImportSessions.AsNoTracking()
            .AnyAsync(s => s.Id == sessionId && s.Status == BankStatementImportSessionStatus.Cancelled, cancellationToken);

    private static async Task FailAsync(Persistence.TenantDbContext ctx, BankStatementImportSession session, string code)
    {
        try
        {
            session.Fail(code);
            await ctx.SaveChangesAsync(CancellationToken.None);
        }
        catch (DbUpdateException)
        {
            // Best-effort : la session expirera et sera purgée.
        }
    }

    /// <summary>PDF d'une seule page (1-based), pour un appel IA par page.</summary>
    internal static byte[] ExtractSinglePage(byte[] pdf, int pageNumber)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        using var input = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        if (pageNumber < 1 || pageNumber > input.PageCount)
            throw new ArgumentOutOfRangeException(nameof(pageNumber));

        using var output = new PdfDocument();
        output.AddPage(input.Pages[pageNumber - 1]);
        using var buffer = new MemoryStream();
        output.Save(buffer, closeStream: false);
        return buffer.ToArray();
    }
}
