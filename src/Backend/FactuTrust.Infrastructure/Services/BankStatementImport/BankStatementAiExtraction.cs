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
    private readonly IOllamaModelReadinessChecker _readiness;
    private readonly IBackgroundJobClient _jobs;
    private readonly ILogger<BankStatementAiExtraction> _logger;
    private readonly IImportAiModelResolutionService _importModelResolver;
    private readonly OllamaSettings _ollamaSettings;
    private readonly BankStatementImportLimits _limits;

    public BankStatementAiExtraction(
        IAiStructuredExtractionPipeline pipeline,
        IOllamaClient ollama,
        IOllamaModelReadinessChecker readiness,
        IBackgroundJobClient jobs,
        ILogger<BankStatementAiExtraction> logger,
        IImportAiModelResolutionService importModelResolver,
        IOptions<OllamaSettings> ollamaSettings,
        IOptions<AccountingSettings> accountingSettings)
    {
        _pipeline = pipeline;
        _ollama = ollama;
        _readiness = readiness;
        _jobs = jobs;
        _logger = logger;
        _importModelResolver = importModelResolver;
        _ollamaSettings = ollamaSettings.Value;
        _limits = accountingSettings.Value.BankStatementImport;
    }

    /// <summary>
    /// Disponibilité AVANT lancement (décision D2) : le moteur vision retenu est le modèle GLM-OCR
    /// Ollama local ; un modèle vision externe n'est jamais utilisé pour des relevés réels
    /// (<see cref="BankStatementAiAvailabilityReasons.ExternalNotAllowed"/>). Si le modèle vision
    /// n'est pas prêt, le modèle texte est proposé avec la raison exposée
    /// (<see cref="BankStatementAiAvailability.VisionUnavailableReason"/>) ; si le moteur local est
    /// arrêté ou qu'aucun modèle texte n'est utilisable, l'import est indisponible avec un code de raison.
    /// </summary>
    public async Task<BankStatementAiAvailability> CheckAvailabilityAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var textModel = await _pipeline.ResolveModelRefAsync(null, cancellationToken);
            if (string.IsNullOrWhiteSpace(textModel.ProviderModelId))
            {
                return BankStatementAiAvailability.Unavailable(
                    "aucun modèle d'import IA n'est configuré.", BankStatementAiAvailabilityReasons.TextModelUnavailable);
            }

            string? visionUnavailableReason = null;
            string? visionReasonCode = null;
            var visionId = await _importModelResolver.ResolveEffectiveVisionModelIdAsync(null, forBankStatement: true, cancellationToken);
            if (_limits.VisionReadingEnabled && !string.IsNullOrWhiteSpace(visionId))
            {
                var visionRef = ModelRef.Parse(visionId);
                if (visionRef.Kind == LlmProviderKind.Ollama)
                {
                    if (!await _ollama.IsAvailableAsync(cancellationToken))
                    {
                        return BankStatementAiAvailability.Unavailable(
                            "le moteur IA local est indisponible.", BankStatementAiAvailabilityReasons.EngineUnavailable);
                    }

                    var readiness = await _readiness.CheckAsync(visionRef.ProviderModelId!, cancellationToken);
                    if (readiness.IsReady)
                    {
                        return new BankStatementAiAvailability(
                            true, "local", textModel.CanonicalModelRef, null, BankStatementAiEngines.Vision, visionRef.CanonicalModelRef);
                    }

                    visionUnavailableReason = readiness.UserMessage ?? "le modèle d'import multimodal n'est pas prêt.";
                    visionReasonCode = BankStatementAiAvailabilityReasons.VisionModelUnavailable;
                }
                else if (!_limits.AiComplementAllowExternal)
                {
                    return BankStatementAiAvailability.Unavailable(
                        "IA externe non autorisée pour les relevés bancaires.", BankStatementAiAvailabilityReasons.ExternalNotAllowed);
                }
                else
                {
                    return new BankStatementAiAvailability(
                        true, "external", textModel.CanonicalModelRef, null, BankStatementAiEngines.Vision, visionRef.CanonicalModelRef);
                }
            }
            else
            {
                visionUnavailableReason = _limits.VisionReadingEnabled
                    ? "aucun modèle d'import multimodal n'est configuré dans l'administration plateforme."
                    : "la lecture vision des relevés est désactivée.";
                visionReasonCode = BankStatementAiAvailabilityReasons.VisionModelUnavailable;
            }

            if (textModel.Kind == LlmProviderKind.Ollama)
            {
                if (!await _ollama.IsAvailableAsync(cancellationToken))
                {
                    return BankStatementAiAvailability.Unavailable(
                        "le moteur IA local est indisponible.", BankStatementAiAvailabilityReasons.EngineUnavailable);
                }

                var textReadiness = await _readiness.CheckAsync(textModel.ProviderModelId!, cancellationToken);
                if (!textReadiness.IsReady)
                {
                    // Ni vision ni texte : les deux raisons remontent (l'opérateur voit pourquoi GLM-OCR
                    // n'est pas proposé ET pourquoi le repli texte est impossible).
                    return new BankStatementAiAvailability(
                        false, null, null,
                        textReadiness.UserMessage ?? "le modèle texte d'import IA n'est pas prêt.",
                        null, null, visionUnavailableReason, BankStatementAiAvailabilityReasons.TextModelUnavailable);
                }

                return new BankStatementAiAvailability(
                    true, "local", textModel.CanonicalModelRef, null, BankStatementAiEngines.Text,
                    null, visionUnavailableReason, visionReasonCode);
            }

            if (!_limits.AiComplementAllowExternal)
            {
                return BankStatementAiAvailability.Unavailable(
                    "IA externe non autorisée pour les relevés bancaires.", BankStatementAiAvailabilityReasons.ExternalNotAllowed);
            }

            return new BankStatementAiAvailability(
                true, "external", textModel.CanonicalModelRef, null, BankStatementAiEngines.Text,
                null, visionUnavailableReason, visionReasonCode);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Import relevé : disponibilité de l'IA indéterminée.");
            return BankStatementAiAvailability.Unavailable("le moteur IA ne répond pas.", BankStatementAiAvailabilityReasons.EngineUnavailable);
        }
    }

    public void Schedule(Guid tenantId, Guid sessionId) =>
        _jobs.Enqueue<BankStatementAiExtractionJob>(job => job.ExecuteAsync(tenantId, sessionId, CancellationToken.None));

    public void ScheduleMany(Guid tenantId, IReadOnlyList<Guid> sessionIds)
    {
        if (sessionIds.Count == 0)
            return;
        if (sessionIds.Count == 1)
        {
            Schedule(tenantId, sessionIds[0]);
            return;
        }

        _jobs.Enqueue<BankStatementAiExtractionJob>(job => job.ExecuteManyAsync(tenantId, sessionIds, CancellationToken.None));
    }
}

/// <summary>
/// Lecture IA des pages scannées d'un relevé, une page à la fois : un appel par page (la porte de
/// génération Ollama est relâchée entre deux pages, le chat et les autres imports s'intercalent),
/// budget de temps global, annulation coopérative entre les pages. Aucun libellé n'est journalisé.
/// </summary>
public sealed partial class BankStatementAiExtractionJob
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

    [Queue("bank_statement_ai")]
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

            // Plan vision (GLM-OCR page par page) ou plan « 100 % IA » (même boucle par page, étages
            // vision éventuellement sautés si le moteur vision n'est pas retenu) : lecture par page tracée.
            if (layout.AiPlan is { } pagePlan
                && (string.Equals(pagePlan.Engine, BankStatementAiEngines.Vision, StringComparison.Ordinal) || pagePlan.IsAiOnly))
            {
                budget.CancelAfter(ComputeBudget(
                    Math.Max(1, pagePlan.PlannedPages.Count),
                    limits.EffectiveVisionCallTimeoutSeconds,
                    limits.EffectiveAiJobBudgetMinutes));

                await RunVisionAsync(services, ctx, session, layout, content, isPdf, limits, budget.Token);
                return;
            }

            // Plan absent (analyse lancée sans le drapeau « tout document par l'IA », ou avant lui) :
            // pages scannées seulement, exactement comme avant. Plan présent : pages scannées du plan
            // puis pages texte relues par extraits de quelques opérations.
            var plan = layout.AiPlan;
            var pages = (plan?.ScannedPages ?? layout.UnresolvedPages).Take(Math.Max(1, limits.MaxAiPages)).ToList();
            var chunks = plan is { TextPages.Count: > 0 } && isPdf
                ? (services.GetService<BankStatementLayoutExtractor>() ?? new BankStatementLayoutExtractor())
                    .BuildAiTextChunks(content, plan.TextPages, limits.EffectiveAiTextOperationsPerCall)
                : Array.Empty<BankStatementAiTextChunk>();
            var totalCalls = Math.Max(1, pages.Count + chunks.Count);
            if (plan is not null)
            {
                var llmSeconds = services.GetService<IOptions<OllamaSettings>>()?.Value.ImportLlmTimeoutSeconds ?? 180;
                budget.CancelAfter(ComputeBudget(totalCalls, llmSeconds, limits.EffectiveAiJobBudgetMinutes));
            }

            var readings = new Dictionary<int, BankStatementAiPageReader.PageReading>();
            var failed = new List<int>();
            var calls = 0;

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
                    reading = FailedReading(pageNumber, outcome.Error.Description);
                }
                else
                {
                    reading = BankStatementAiPageReader.Read(outcome.Value.RawContent, pageNumber, outcome.Value.Extraction.Text);
                }

                readings[pageNumber] = reading;
                if (reading.Issues.Any(x => x.Code == StatementIssueCodes.AiPageFailed))
                    failed.Add(pageNumber);

                session.ReportProgress(++calls * 100 / totalCalls);
                await ctx.SaveChangesAsync(budget.Token);
            }

            var chunkReadings = new List<(BankStatementAiPageReader.PageReading Reading, BankStatementAiTextChunk Chunk)>();
            foreach (var chunk in chunks)
            {
                if (await IsCancelledAsync(ctx, sessionId, budget.Token))
                    return;

                await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(chunk.Text));
                var outcome = await pipeline.RunAsync(new AiStructuredExtractionRequest
                {
                    FileStream = stream,
                    FileName = $"releve-p{chunk.Page}-{chunk.Index + 1}.txt",
                    ContentType = "text/plain",
                    SystemPrompt = BankStatementAiPrompt.System,
                    UserInstruction = BankStatementAiPrompt.TextExtractInstruction,
                    OutputSchema = LlmOutputSchemas.BankStatementPage,
                    ErrorCode = "BankStatementImport",
                    MaxImages = 1
                }, budget.Token);

                // Pas d'ancrage OCR ici : la fusion vérifie chaque montant contre les montants imprimés de l'extrait.
                var reading = outcome.IsFailure
                    ? FailedReading(chunk.Page, outcome.Error.Description)
                    : BankStatementAiPageReader.Read(outcome.Value.RawContent, chunk.Page, ocrText: null, acceptDayFirstDates: true);
                chunkReadings.Add((reading, chunk));

                session.ReportProgress(++calls * 100 / totalCalls);
                await ctx.SaveChangesAsync(budget.Token);
            }

            Dictionary<int, BankStatementAiPageReader.TextPageReading>? textReadings = null;
            if (plan is { TextPages.Count: > 0 })
            {
                textReadings = new Dictionary<int, BankStatementAiPageReader.TextPageReading>();
                foreach (var page in plan.TextPages)
                {
                    var forPage = chunkReadings.Where(c => c.Chunk.Page == page).ToList();
                    textReadings[page] = forPage.Count > 0
                        ? BankStatementAiPageReader.CombineChunks(forPage)
                        : new BankStatementAiPageReader.TextPageReading(
                            FailedReading(page, "aucun texte exploitable sur la page."), Array.Empty<decimal>(), Array.Empty<decimal>(), Failed: true);
                }
            }

            var merged = BankStatementAiPageReader.Merge(layout, readings, failed, textReadings);
            var method = layout.Lines.Count > 0 ? "layout+ai" : "ai";
            session.CompleteExtraction(JsonSerializer.Serialize(merged, BankStatementImportService.JsonOptions), method, layout.ProfileId, layout.PageCount);
            await ctx.SaveChangesAsync(budget.Token);

            _logger.LogInformation(
                "Lecture IA de relevé : session {SessionId}, {Pages} page(s) lue(s), {Failed} en échec, {Lines} ligne(s) au total.",
                sessionId, readings.Count, failed.Count, merged.Lines.Count);
            if (textReadings is not null)
            {
                _logger.LogInformation(
                    "Lecture IA de relevé : session {SessionId}, {TextPages} page(s) texte relue(s) en {Chunks} extrait(s), {TextFailed} en échec.",
                    sessionId, textReadings.Count, chunks.Count, textReadings.Count(t => t.Value.Failed));
            }
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

    private static BankStatementAiPageReader.PageReading FailedReading(int pageNumber, string reason) =>
        new(Array.Empty<ExtractedStatementLine>(), null, null,
            new[]
            {
                // Message unique avec la fusion : le motif technique (json_empty, table_not_recognized…)
                // reste dans les journaux et dans la trace de page, jamais dans l'écran de relecture.
                new StatementExtractionIssue(StatementIssueCodes.AiPageFailed, StatementIssueSeverity.Blocking,
                    BankStatementAiOnlyMerge.PageNotReadMessage(pageNumber), pageNumber)
            });

    /// <summary>
    /// Budget d'une lecture planifiée : chaque page dispose du délai d'un appel plus une marge
    /// (attente de la file IA partagée), le tout majoré de 50 % pour les étages de repli
    /// (tableau, modèle texte), borné entre l'ancien budget (20 min) et le plafond réglé
    /// (<c>AiJobBudgetMinutes</c>).
    /// </summary>
    internal static TimeSpan ComputeBudget(int calls, int llmTimeoutSeconds, int maxMinutes)
    {
        var perCall = TimeSpan.FromSeconds(Math.Clamp(llmTimeoutSeconds, 30, 600) + 60);
        var wanted = TimeSpan.FromTicks((long)(perCall.Ticks * Math.Max(1, calls) * 1.5));
        var max = TimeSpan.FromMinutes(Math.Max(Budget.TotalMinutes, maxMinutes));
        return wanted < Budget ? Budget : wanted > max ? max : wanted;
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
