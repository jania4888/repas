using System.Diagnostics;
using System.Text;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.Json;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Banking;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using Hangfire;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

public sealed partial class BankStatementAiExtractionJob
{
    [Queue("bank_statement_ai")]
    [AutomaticRetry(Attempts = 0)]
    public async Task ExecuteManyAsync(Guid tenantId, IReadOnlyList<Guid> sessionIds, CancellationToken cancellationToken)
    {
        foreach (var sessionId in sessionIds)
        {
            await ExecuteAsync(tenantId, sessionId, cancellationToken);
        }
    }

    /// <summary>Raisons d'échec courtes (sans donnée du relevé) tracées par page.</summary>
    internal static class PageFailureReasons
    {
        public const string JsonInvalid = "json_invalid";
        public const string JsonEmpty = "json_empty";
        public const string Truncated = "truncated";
        public const string TableNotRecognized = "table_not_recognized";
        public const string TableEmpty = "table_empty";
        public const string VisionUnavailable = "vision_unavailable";
        public const string VisionNotUsed = "vision_not_used";
        public const string CircuitOpen = "circuit_open";
        public const string RenderGuard = "page trop grande pour la lecture vision";
        public const string PageNotExtracted = "page non extraite du PDF";
    }

    /// <summary>Nombre d'opérations au-delà duquel une page vision est tenue pour tronquée (= maxItems du schéma).</summary>
    internal const int VisionMaxLinesPerPage = 120;

    private sealed record StageResult(
        BankStatementAiPageReader.PageReading? Reading,
        string? FailureReason,
        string Outcome,
        long DurationMs,
        long? FirstTokenMs,
        int StreamChunkCount,
        int RawChars,
        string? GroundingText,
        bool Truncated,
        bool ProviderUnavailable)
    {
        public bool Succeeded => Reading is not null && FailureReason is null;
    }

    /// <summary>
    /// Lecture 100 % IA d'un relevé, page par page, en trois étages : (1) GLM-OCR + consigne native
    /// d'extraction JSON, (2) GLM-OCR « Table Recognition: » analysé côté serveur, (3) modèle texte.
    /// Chaque page est tracée (<see cref="BankStatementPageReading"/>) et persistée au fil de l'eau ;
    /// les lignes du relevé viennent uniquement de ces lectures (décision D1).
    /// </summary>
    internal async Task RunVisionAsync(
        IServiceProvider services,
        Persistence.TenantDbContext ctx,
        BankStatementImportSession session,
        ExtractedBankStatement layout,
        byte[] content,
        bool isPdf,
        BankStatementImportLimits limits,
        CancellationToken cancellationToken)
    {
        var jobSw = Stopwatch.StartNew();
        var pipeline = services.GetRequiredService<IAiStructuredExtractionPipeline>();
        var ollamaSettings = services.GetRequiredService<IOptions<OllamaSettings>>().Value;
        var accountingSettings = services.GetService<IOptions<AccountingSettings>>()?.Value;
        var tenantId = services.GetService<ITenantContext>()?.TenantId;
        var pdfRenderer = services.GetService<IAiPdfRenderer>();
        var extractor = services.GetService<BankStatementLayoutExtractor>() ?? new BankStatementLayoutExtractor();
        var plan = layout.AiPlan ?? throw new InvalidOperationException("Plan IA absent.");
        var aiOnly = plan.IsAiOnly;
        var visionPlanned = string.Equals(plan.Engine, BankStatementAiEngines.Vision, StringComparison.Ordinal);
        var visionModel = visionPlanned && limits.VisionReadingEnabled
            ? ImportAiModelResolver.ResolveBankStatementVisionModelId(ollamaSettings)
            : null;
        var visionModelLabel = string.IsNullOrWhiteSpace(visionModel) ? null : ModelRef.Parse(visionModel).ProviderModelId;
        var textModelLabel = await ResolveTextModelLabelAsync(pipeline, cancellationToken);
        var pages = plan.PlannedPages.Take(limits.EffectiveMaxAiPages).ToList();
        var totalPages = Math.Max(1, pages.Count);

        _logger.LogInformation(
            "Lecture IA relevé : session {SessionId}, dossier {TenantId}, moteur {Engine}, modèle {Model}, pages {Pages}, budget {BudgetMinutes} min",
            session.Id, tenantId, plan.Engine, visionModelLabel ?? textModelLabel, pages.Count,
            (int)ComputeBudget(pages.Count, limits.EffectiveVisionCallTimeoutSeconds, limits.EffectiveAiJobBudgetMinutes).TotalMinutes);

        if (visionModel is not null)
            await WarmUpBestEffortAsync(pipeline, visionModel, cancellationToken);

        var readings = new Dictionary<int, BankStatementAiPageReader.PageReading>();
        var textReadings = new Dictionary<int, BankStatementAiPageReader.TextPageReading>();
        var pageReadings = new List<BankStatementPageReading>();
        var consecutiveVisionFailures = 0;
        var circuitOpen = visionModel is null;
        var circuitReason = visionModel is null ? PageFailureReasons.VisionUnavailable : PageFailureReasons.CircuitOpen;
        var done = 0;
        var textModelMissing = false;

        foreach (var pageNumber in pages)
        {
            if (await IsCancelledAsync(ctx, session.Id, cancellationToken))
                return;

            var pageSw = Stopwatch.StartNew();
            var isScanned = plan.ScannedPages.Contains(pageNumber);
            var acceptDayFirst = aiOnly || !isScanned;
            var readOptions = aiOnly
                ? isScanned ? BankStatementAiReadOptions.AiOnlyScanned(layout.Header.PeriodStart) : BankStatementAiReadOptions.AiOnlyText(layout.Header.PeriodStart)
                : BankStatementAiReadOptions.Legacy(acceptDayFirst);

            // ---- Page isolée (PDF) : PdfSharp, sinon rendu PNG, sinon échec de page.
            byte[] pageBytes;
            var pageContentType = isPdf ? "application/pdf" : session.ContentType;
            var pageFileName = isPdf ? $"releve-page-{pageNumber}.pdf" : session.FileName;
            string? extractionFailure = null;
            if (isPdf)
            {
                (pageBytes, pageContentType, pageFileName, extractionFailure) =
                    await ExtractPageBytesAsync(content, pageNumber, pdfRenderer, limits, cancellationToken);
            }
            else
            {
                pageBytes = content;
            }

            if (extractionFailure is not null)
            {
                RecordPage(pageNumber, FailedReading(pageNumber, extractionFailure), BankStatementPageReadingEngines.Failed, null, 0, pageSw.ElapsedMilliseconds, 0, extractionFailure, "failed");
                await PersistProgressAsync(ctx, session, layout, plan, pageReadings, ++done, totalPages, cancellationToken);
                continue;
            }

            if (isPdf && pageContentType == "application/pdf" && ExceedsRenderGuard(pageBytes, limits))
            {
                var reason = PageFailureReasons.RenderGuard;
                var fallback = await RunStage3Async(pipeline, extractor, content, isPdf, session, pageNumber, plan, limits, readOptions, null, cancellationToken);
                RecordStage3(pageNumber, fallback, reason, isScanned, pageSw);
                if (fallback.ProviderUnavailable) textModelMissing = true;
                await PersistProgressAsync(ctx, session, layout, plan, pageReadings, ++done, totalPages, cancellationToken);
                continue;
            }

            var attempts = 0;
            string? lastFailure = null;
            string? groundingText = null;
            var truncated = false;
            StageResult? stage1 = null;
            StageResult? stage2 = null;

            if (!circuitOpen)
            {
                // ---- Étage 1 : GLM-OCR, consigne native d'extraction JSON.
                attempts++;
                stage1 = await RunVisionJsonStageAsync(pipeline, pageBytes, pageFileName, pageContentType, visionModel!, pageNumber, limits, readOptions, cancellationToken);
                LogPage(session.Id, pageNumber, BankStatementPageReadingEngines.GlmOcr, visionModelLabel, attempts, stage1);
                truncated |= stage1.Truncated;
                groundingText ??= stage1.GroundingText;
                if (stage1.ProviderUnavailable)
                {
                    circuitOpen = true;
                    circuitReason = PageFailureReasons.VisionUnavailable;
                }

                if (stage1.Succeeded)
                {
                    consecutiveVisionFailures = 0;
                    RecordPage(pageNumber, stage1.Reading!, BankStatementPageReadingEngines.GlmOcr, visionModelLabel, attempts, pageSw.ElapsedMilliseconds, stage1.Reading!.Lines.Count, null, stage1.Outcome, truncated);
                    await PersistProgressAsync(ctx, session, layout, plan, pageReadings, ++done, totalPages, cancellationToken);
                    continue;
                }

                lastFailure = stage1.FailureReason;
                if (await IsCancelledAsync(ctx, session.Id, cancellationToken))
                    return;

                // ---- Étage 2 : GLM-OCR « Table Recognition: », tableau analysé côté serveur.
                if (!circuitOpen)
                {
                    attempts++;
                    stage2 = await RunVisionTableStageAsync(pipeline, pageBytes, pageFileName, pageContentType, visionModel!, pageNumber, limits, readOptions, cancellationToken);
                    LogPage(session.Id, pageNumber, BankStatementPageReadingEngines.GlmOcrTable, visionModelLabel, attempts, stage2);
                    groundingText = stage2.GroundingText ?? groundingText;
                    if (stage2.ProviderUnavailable)
                    {
                        circuitOpen = true;
                        circuitReason = PageFailureReasons.VisionUnavailable;
                    }

                    if (stage2.Succeeded)
                    {
                        consecutiveVisionFailures = 0;
                        RecordPage(pageNumber, stage2.Reading!, BankStatementPageReadingEngines.GlmOcrTable, visionModelLabel, attempts, pageSw.ElapsedMilliseconds, stage2.Reading!.Lines.Count, null, stage2.Outcome, truncated);
                        await PersistProgressAsync(ctx, session, layout, plan, pageReadings, ++done, totalPages, cancellationToken);
                        continue;
                    }

                    lastFailure = stage2.FailureReason ?? lastFailure;
                }

                consecutiveVisionFailures++;
                if (consecutiveVisionFailures >= 2 && !circuitOpen)
                {
                    circuitOpen = true;
                    circuitReason = PageFailureReasons.CircuitOpen;
                    _logger.LogWarning(
                        "Lecture IA relevé : session {SessionId}, coupe-circuit vision ouvert après la page {Page} ({Failures} pages consécutives en échec) ; pages restantes relues par le modèle texte.",
                        session.Id, pageNumber, consecutiveVisionFailures);
                }

                if (await IsCancelledAsync(ctx, session.Id, cancellationToken))
                    return;
            }
            else
            {
                lastFailure = circuitReason;
            }

            // ---- Étage 3 : modèle texte (repli), marqué visiblement.
            if (!limits.VisionTextFallbackEnabled && visionModel is not null)
            {
                var reason = lastFailure ?? PageFailureReasons.VisionNotUsed;
                RecordPage(pageNumber, FailedReading(pageNumber, reason), BankStatementPageReadingEngines.Failed, visionModelLabel, attempts, pageSw.ElapsedMilliseconds, 0, reason, "failed", truncated);
                await PersistProgressAsync(ctx, session, layout, plan, pageReadings, ++done, totalPages, cancellationToken);
                continue;
            }

            attempts++;
            var stage3 = await RunStage3Async(pipeline, extractor, content, isPdf, session, pageNumber, plan, limits, readOptions, groundingText, cancellationToken);
            LogPage(session.Id, pageNumber, BankStatementPageReadingEngines.TextModel, textModelLabel, attempts, stage3);
            if (stage3.ProviderUnavailable)
                textModelMissing = true;
            RecordStage3(pageNumber, stage3, lastFailure ?? PageFailureReasons.VisionNotUsed, isScanned, pageSw, attempts);
            await PersistProgressAsync(ctx, session, layout, plan, pageReadings, ++done, totalPages, cancellationToken);

            if (textModelMissing && circuitOpen)
            {
                // Plus aucun moteur (vision coupée, modèle texte absent) : inutile d'insister page après page.
                break;
            }
        }

        if (textModelMissing && readings.Values.All(r => r.Issues.Any(i => i.Code == StatementIssueCodes.AiPageFailed)))
        {
            _logger.LogWarning("Lecture IA relevé : session {SessionId}, aucun moteur IA disponible (vision et texte) ; session en échec {Code}.",
                session.Id, BankStatementImportSessionErrorCodes.AiUnavailable);
            await FailAsync(ctx, session, BankStatementImportSessionErrorCodes.AiUnavailable);
            return;
        }

        // ---- Fusion.
        ExtractedBankStatement merged;
        string method;
        if (aiOnly)
        {
            merged = BankStatementAiOnlyMerge.Merge(layout, pages, readings, pageReadings);
            var mismatchAsWarning = accountingSettings is not null && tenantId is { } tid
                ? accountingSettings.IsAiBalanceMismatchAsWarningFor(tid)
                : limits.AiBalanceMismatchAsWarning;
            merged = BankStatementBalanceCheck.Reevaluate(merged, mismatchAsWarning);
            merged = await AppendAccountChecksAsync(ctx, session, merged, cancellationToken);
            method = visionPlanned ? BankStatementImportExtractionMethods.AiVision : BankStatementImportExtractionMethods.AiText;
        }
        else
        {
            var scannedReadings = readings.Where(kv => plan.ScannedPages.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value);
            var failedScanned = scannedReadings.Where(kv => kv.Value.Issues.Any(i => i.Code == StatementIssueCodes.AiPageFailed)).Select(kv => kv.Key).ToList();
            merged = BankStatementAiPageReader.Merge(layout, scannedReadings, failedScanned, textReadings.Count > 0 ? textReadings : null);
            merged = merged with
            {
                AiPlan = plan with
                {
                    PageReadings = pageReadings,
                    FallbackPages = BankStatementAiReadingPlanner.FallbackPagesOf(pageReadings)
                }
            };
            merged = await AppendAiRibMismatchWarningAsync(ctx, session, merged, cancellationToken);
            method = layout.Lines.Count > 0 ? BankStatementImportExtractionMethods.LayoutAndAi : BankStatementImportExtractionMethods.Ai;
        }

        session.CompleteExtraction(JsonSerializer.Serialize(merged, BankStatementImportService.JsonOptions), method, layout.ProfileId, layout.PageCount);
        await ctx.SaveChangesAsync(cancellationToken);

        var visionPages = pageReadings.Count(r => r.Engine == BankStatementPageReadingEngines.GlmOcr);
        var tablePages = pageReadings.Count(r => r.Engine == BankStatementPageReadingEngines.GlmOcrTable);
        var textFallbackPages = pageReadings.Count(r => r.IsTextFallback);
        var failedPages = pageReadings.Count(r => r.IsFailed);
        _logger.LogInformation(
            "Lecture IA relevé terminée : session {SessionId}, pages {Pages}, vision {VisionPages}, tableau {TablePages}, repli texte {TextFallbackPages}, échecs {FailedPages}, lignes {Lines}, durée {DurationSeconds} s, expiré {TimedOut}",
            session.Id, pages.Count, visionPages, tablePages, textFallbackPages, failedPages, merged.Lines.Count,
            (int)jobSw.Elapsed.TotalSeconds, cancellationToken.IsCancellationRequested);

        await AuditBestEffortAsync(services, session.Id, new
        {
            SessionId = session.Id,
            Pages = pages.Count,
            VisionPages = visionPages,
            TablePages = tablePages,
            TextFallbackPages = textFallbackPages,
            FailedPages = failedPages,
            DurationMs = jobSw.ElapsedMilliseconds,
            VisionModel = visionModelLabel,
            FallbackModel = textModelLabel
        }, cancellationToken);

        // ------------------------------------------------------------------ fonctions locales
        void RecordPage(int page, BankStatementAiPageReader.PageReading reading, string engine, string? model, int attemptCount, long durationMs, int lineCount, string? failureReason, string outcome, bool wasTruncated = false)
        {
            if (wasTruncated && engine != BankStatementPageReadingEngines.Failed)
            {
                reading = reading with
                {
                    Issues = reading.Issues.Append(new StatementExtractionIssue(StatementIssueCodes.AiPageTruncated, StatementIssueSeverity.Warning,
                        $"Page {page} : la lecture semble incomplète (limite de {VisionMaxLinesPerPage} opérations atteinte). Comparez avec le PDF.", page)).ToList()
                };
            }

            readings[page] = reading;
            if (!aiOnly && !plan.ScannedPages.Contains(page))
            {
                var chunks = isPdf
                    ? extractor.BuildAiTextChunks(content, new[] { page }, limits.EffectiveAiTextOperationsPerCall)
                    : Array.Empty<BankStatementAiTextChunk>();
                textReadings[page] = BankStatementAiPageReader.ForWholePage(reading, chunks);
            }

            pageReadings.RemoveAll(r => r.Page == page);
            pageReadings.Add(new BankStatementPageReading(page, engine, model, attemptCount, durationMs, lineCount, failureReason));
            _ = outcome;
        }

        void RecordStage3(int page, StageResult stage, string reason, bool scanned, Stopwatch sw, int attemptCount = 1)
        {
            _ = scanned;
            if (stage.Succeeded)
            {
                RecordPage(page, stage.Reading!, BankStatementPageReadingEngines.TextModel, textModelLabel, attemptCount, sw.ElapsedMilliseconds, stage.Reading!.Lines.Count, reason, stage.Outcome);
                return;
            }

            var failure = stage.FailureReason ?? reason;
            RecordPage(page, stage.Reading ?? FailedReading(page, failure), BankStatementPageReadingEngines.Failed, textModelLabel, attemptCount, sw.ElapsedMilliseconds, 0, failure, "failed");
        }
    }

    // ---------------------------------------------------------------------- étages

    /// <summary>
    /// Appel du pipeline borné à la page : une exception du moteur (HTTP, flux interrompu) ou un
    /// dépassement du délai PAR APPEL devient un échec de page (étage suivant), jamais un échec de
    /// session. Seule l'annulation du budget global (jeton de la tâche) remonte.
    /// </summary>
    private static async Task<Result<AiStructuredExtractionOutcome>> RunPipelineForPageAsync(
        IAiStructuredExtractionPipeline pipeline,
        AiStructuredExtractionRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            return await pipeline.RunAsync(request, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation("BankStatementImport", "timeout"));
        }
        catch (OllamaRequestException)
        {
            return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation("BankStatementImport", "Le moteur IA local est indisponible."));
        }
        catch (HttpRequestException)
        {
            return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation("BankStatementImport", "Le moteur IA local est indisponible."));
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return Result.Failure<AiStructuredExtractionOutcome>(Error.Validation("BankStatementImport", "erreur du moteur IA"));
        }
    }

    private static async Task<StageResult> RunVisionJsonStageAsync(
        IAiStructuredExtractionPipeline pipeline,
        byte[] pageBytes,
        string fileName,
        string contentType,
        string visionModel,
        int pageNumber,
        BankStatementImportLimits limits,
        BankStatementAiReadOptions readOptions,
        CancellationToken cancellationToken)
    {
        var sw = Stopwatch.StartNew();
        await using var stream = new MemoryStream(pageBytes);
        var outcome = await RunPipelineForPageAsync(pipeline, new AiStructuredExtractionRequest
        {
            FileStream = stream,
            FileName = fileName,
            ContentType = contentType,
            SystemPrompt = BankStatementVisionPrompt.System,
            UserInstruction = BankStatementVisionPrompt.NativeExtractionInstruction,
            RawUserPrompt = true,
            OutputSchema = LlmOutputSchemas.BankStatementPageVerbatim,
            ErrorCode = "BankStatementImport",
            MaxImages = 1,
            ForceVision = true,
            RequireVision = true,
            VisionModelOverride = visionModel,
            IncludeExtractedTextWithImages = limits.VisionSendTextLayer,
            SkipOcrWhenRendering = true,
            MaxOutputTokens = limits.EffectiveVisionMaxOutputTokens,
            LlmTimeoutSeconds = limits.EffectiveVisionCallTimeoutSeconds,
            RenderDpi = limits.EffectiveVisionRenderDpi,
            MaxPages = 1
        }, cancellationToken);

        if (outcome.IsFailure)
            return FailedStage(outcome.Error.Description, sw.ElapsedMilliseconds);
        if (!outcome.Value.VisionUsed)
            return new StageResult(null, PageFailureReasons.VisionNotUsed, "failed", sw.ElapsedMilliseconds, outcome.Value.FirstTokenMs, outcome.Value.StreamChunkCount, outcome.Value.RawContent?.Length ?? 0, null, false, false);

        var raw = outcome.Value.RawContent ?? string.Empty;
        var grounding = limits.VisionSendTextLayer ? outcome.Value.Extraction.Text : null;
        var json = InvoiceImportParsing.ExtractFirstJsonObject(raw);
        var looksTruncated = !raw.TrimEnd().EndsWith('}');
        if (string.IsNullOrWhiteSpace(json))
            return new StageResult(null, looksTruncated ? PageFailureReasons.Truncated : PageFailureReasons.JsonInvalid, "invalid_json", sw.ElapsedMilliseconds, outcome.Value.FirstTokenMs, outcome.Value.StreamChunkCount, raw.Length, grounding, looksTruncated, false);

        LlmBankStatementPage typed;
        try
        {
            typed = BankStatementVisionPageNormalizer.Normalize(json, pageNumber);
        }
        catch (JsonException)
        {
            return new StageResult(null, looksTruncated ? PageFailureReasons.Truncated : PageFailureReasons.JsonInvalid, "invalid_json", sw.ElapsedMilliseconds, outcome.Value.FirstTokenMs, outcome.Value.StreamChunkCount, raw.Length, grounding, looksTruncated, false);
        }

        var reading = BankStatementAiPageReader.Read(typed, pageNumber, grounding, readOptions);
        var truncated = looksTruncated || typed.Lines.Count >= VisionMaxLinesPerPage;
        if (reading.Lines.Count == 0)
            return new StageResult(reading, PageFailureReasons.JsonEmpty, "empty", sw.ElapsedMilliseconds, outcome.Value.FirstTokenMs, outcome.Value.StreamChunkCount, raw.Length, grounding, truncated, false);

        return new StageResult(reading, null, "ok", sw.ElapsedMilliseconds, outcome.Value.FirstTokenMs, outcome.Value.StreamChunkCount, raw.Length, grounding, truncated, false);
    }

    private static async Task<StageResult> RunVisionTableStageAsync(
        IAiStructuredExtractionPipeline pipeline,
        byte[] pageBytes,
        string fileName,
        string contentType,
        string visionModel,
        int pageNumber,
        BankStatementImportLimits limits,
        BankStatementAiReadOptions readOptions,
        CancellationToken cancellationToken)
    {
        var sw = Stopwatch.StartNew();
        await using var stream = new MemoryStream(pageBytes);
        var outcome = await RunPipelineForPageAsync(pipeline, new AiStructuredExtractionRequest
        {
            FileStream = stream,
            FileName = fileName,
            ContentType = contentType,
            SystemPrompt = BankStatementVisionPrompt.System,
            UserInstruction = BankStatementVisionPrompt.TableRecognitionInstruction,
            RawUserPrompt = true,
            OutputSchema = null,
            ErrorCode = "BankStatementImport",
            MaxImages = 1,
            ForceVision = true,
            RequireVision = true,
            VisionModelOverride = visionModel,
            IncludeExtractedTextWithImages = false,
            SkipOcrWhenRendering = true,
            MaxOutputTokens = limits.EffectiveVisionMaxOutputTokens,
            LlmTimeoutSeconds = limits.EffectiveVisionCallTimeoutSeconds,
            RenderDpi = limits.EffectiveVisionRenderDpi,
            MaxPages = 1
        }, cancellationToken);

        if (outcome.IsFailure)
            return FailedStage(outcome.Error.Description, sw.ElapsedMilliseconds);
        if (!outcome.Value.VisionUsed)
            return new StageResult(null, PageFailureReasons.VisionNotUsed, "failed", sw.ElapsedMilliseconds, outcome.Value.FirstTokenMs, outcome.Value.StreamChunkCount, outcome.Value.RawContent?.Length ?? 0, null, false, false);

        var raw = outcome.Value.RawContent ?? string.Empty;
        var table = BankStatementTableTextParser.Parse(raw, pageNumber);
        if (table.Page is null)
            return new StageResult(null, PageFailureReasons.TableNotRecognized, "invalid_json", sw.ElapsedMilliseconds, outcome.Value.FirstTokenMs, outcome.Value.StreamChunkCount, raw.Length, null, false, false);

        var grounding = table.PlainText;
        if (table.IsConfirmedEmpty)
        {
            // Page sans opération confirmée : lecture vide réussie (signalée « page vide » à la fusion).
            var empty = BankStatementAiPageReader.Read(table.Page, pageNumber, null, readOptions);
            return new StageResult(empty, null, "empty", sw.ElapsedMilliseconds, outcome.Value.FirstTokenMs, outcome.Value.StreamChunkCount, raw.Length, grounding, false, false);
        }

        var reading = BankStatementAiPageReader.Read(table.Page, pageNumber, grounding, readOptions);
        if (reading.Lines.Count == 0)
            return new StageResult(reading, PageFailureReasons.TableEmpty, "empty", sw.ElapsedMilliseconds, outcome.Value.FirstTokenMs, outcome.Value.StreamChunkCount, raw.Length, grounding, false, false);

        return new StageResult(reading, null, "ok", sw.ElapsedMilliseconds, outcome.Value.FirstTokenMs, outcome.Value.StreamChunkCount, raw.Length, grounding, table.Page.Lines.Count >= VisionMaxLinesPerPage, false);
    }

    /// <summary>
    /// Étage 3 : modèle texte. Page à couche texte : texte de la page découpé en lots. Page scannée :
    /// texte du tableau GLM-OCR s'il existe, sinon OCR Tesseract via le pipeline (image/PDF).
    /// </summary>
    private static async Task<StageResult> RunStage3Async(
        IAiStructuredExtractionPipeline pipeline,
        BankStatementLayoutExtractor extractor,
        byte[] content,
        bool isPdf,
        BankStatementImportSession session,
        int pageNumber,
        BankStatementAiPlan plan,
        BankStatementImportLimits limits,
        BankStatementAiReadOptions readOptions,
        string? tableText,
        CancellationToken cancellationToken)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            var reading = await RunPageTextFallbackAsync(
                pipeline, extractor, content, isPdf, session, pageNumber, plan, limits, readOptions, tableText, cancellationToken);
            var failed = reading.Issues.FirstOrDefault(i => i.Code == StatementIssueCodes.AiPageFailed);
            if (failed is not null)
            {
                var description = failed.Message;
                return new StageResult(reading, ShortFailure(description), "failed", sw.ElapsedMilliseconds, null, 0, 0, tableText, false, IsProviderUnavailable(description));
            }

            return new StageResult(reading, null, reading.Lines.Count == 0 ? "empty" : "ok", sw.ElapsedMilliseconds, null, 0, 0, tableText, false, false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return new StageResult(FailedReading(pageNumber, "erreur du modèle texte"), "text_model_error", "failed", sw.ElapsedMilliseconds, null, 0, 0, tableText, false, false);
        }
    }

    private static async Task<BankStatementAiPageReader.PageReading> RunPageTextFallbackAsync(
        IAiStructuredExtractionPipeline pipeline,
        BankStatementLayoutExtractor extractor,
        byte[] content,
        bool isPdf,
        BankStatementImportSession session,
        int pageNumber,
        BankStatementAiPlan plan,
        BankStatementImportLimits limits,
        BankStatementAiReadOptions readOptions,
        string? tableText,
        CancellationToken cancellationToken)
    {
        var scanned = plan.ScannedPages.Contains(pageNumber) || !isPdf;
        if (scanned && !string.IsNullOrWhiteSpace(tableText))
        {
            // Tableau GLM-OCR déjà lu : le modèle texte travaille sur ce texte plutôt que sur un OCR Tesseract.
            await using var tableStream = new MemoryStream(Encoding.UTF8.GetBytes(tableText));
            var tableOutcome = await RunPipelineForPageAsync(pipeline, new AiStructuredExtractionRequest
            {
                FileStream = tableStream,
                FileName = $"releve-p{pageNumber}-tableau.txt",
                ContentType = "text/plain",
                SystemPrompt = BankStatementAiPrompt.System,
                UserInstruction = BankStatementAiPrompt.TextExtractInstruction,
                OutputSchema = LlmOutputSchemas.BankStatementPage,
                ErrorCode = "BankStatementImport",
                MaxImages = 1
            }, cancellationToken);
            return tableOutcome.IsFailure
                ? FailedReading(pageNumber, tableOutcome.Error.Description)
                : ReadRaw(tableOutcome.Value.RawContent, pageNumber, tableText, readOptions);
        }

        if (scanned)
        {
            var pageBytes = isPdf ? ExtractSinglePage(content, pageNumber) : content;
            await using var stream = new MemoryStream(pageBytes);
            var outcome = await RunPipelineForPageAsync(pipeline, new AiStructuredExtractionRequest
            {
                FileStream = stream,
                FileName = isPdf ? $"releve-page-{pageNumber}.pdf" : session.FileName,
                ContentType = isPdf ? "application/pdf" : session.ContentType,
                SystemPrompt = BankStatementAiPrompt.System,
                UserInstruction = BankStatementAiPrompt.UserInstruction,
                OutputSchema = LlmOutputSchemas.BankStatementPage,
                ErrorCode = "BankStatementImport",
                MaxImages = 1,
                MaxPages = 1
            }, cancellationToken);
            return outcome.IsFailure
                ? FailedReading(pageNumber, outcome.Error.Description)
                : ReadRaw(outcome.Value.RawContent, pageNumber, outcome.Value.Extraction.Text, readOptions);
        }

        var chunks = extractor.BuildAiTextChunks(content, new[] { pageNumber }, limits.EffectiveAiTextOperationsPerCall);
        var chunkReadings = new List<(BankStatementAiPageReader.PageReading Reading, BankStatementAiTextChunk Chunk)>();
        foreach (var chunk in chunks)
        {
            await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(chunk.Text));
            var outcome = await RunPipelineForPageAsync(pipeline, new AiStructuredExtractionRequest
            {
                FileStream = stream,
                FileName = $"releve-p{chunk.Page}-{chunk.Index + 1}.txt",
                ContentType = "text/plain",
                SystemPrompt = BankStatementAiPrompt.System,
                UserInstruction = BankStatementAiPrompt.TextExtractInstruction,
                OutputSchema = LlmOutputSchemas.BankStatementPage,
                ErrorCode = "BankStatementImport",
                MaxImages = 1
            }, cancellationToken);
            var reading = outcome.IsFailure
                ? FailedReading(chunk.Page, outcome.Error.Description)
                : ReadRaw(outcome.Value.RawContent, chunk.Page, null, readOptions with { AcceptDayFirstDates = true });
            chunkReadings.Add((reading, chunk));
        }

        return chunkReadings.Count > 0
            ? BankStatementAiPageReader.CombineChunks(chunkReadings).Reading
            : FailedReading(pageNumber, "aucun texte exploitable sur la page");
    }

    private static BankStatementAiPageReader.PageReading ReadRaw(string? raw, int pageNumber, string? groundingText, BankStatementAiReadOptions options)
    {
        var json = InvoiceImportParsing.ExtractFirstJsonObject(raw);
        LlmBankStatementPage? page = null;
        if (!string.IsNullOrWhiteSpace(json))
        {
            try
            {
                page = JsonSerializer.Deserialize<LlmBankStatementPage>(json, LlmJsonOptions.Tolerant);
            }
            catch (JsonException)
            {
                page = null;
            }
        }

        return BankStatementAiPageReader.Read(page, pageNumber, groundingText, options);
    }

    // ---------------------------------------------------------------------- pages PDF

    /// <summary>
    /// Isole une page : PdfSharp (mode import) ; en cas d'échec, rendu PNG par <see cref="IAiPdfRenderer"/> ;
    /// si les deux échouent, la page est en échec avec une raison courte (jamais le message d'exception brut).
    /// </summary>
    private static async Task<(byte[] Bytes, string ContentType, string FileName, string? Failure)> ExtractPageBytesAsync(
        byte[] pdf,
        int pageNumber,
        IAiPdfRenderer? renderer,
        BankStatementImportLimits limits,
        CancellationToken cancellationToken)
    {
        try
        {
            return (ExtractSinglePage(pdf, pageNumber), "application/pdf", $"releve-page-{pageNumber}.pdf", null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            if (renderer is { IsAvailable: true })
            {
                try
                {
                    var rendered = await renderer.RenderPageAsync(pdf, pageNumber - 1, limits.EffectiveVisionRenderDpi, cancellationToken);
                    if (rendered is not null && rendered.PngBytes.Length > 0)
                    {
                        if (BankStatementImageMegapixelGuard.ExceedsMegapixelLimit(rendered.PngBytes, limits.EffectiveMaxImageMegapixels))
                            return (Array.Empty<byte>(), "image/png", $"releve-page-{pageNumber}.png", PageFailureReasons.RenderGuard);
                        return (rendered.PngBytes, "image/png", $"releve-page-{pageNumber}.png", null);
                    }
                }
                catch (Exception renderEx) when (renderEx is not OperationCanceledException)
                {
                    return (Array.Empty<byte>(), "application/pdf", $"releve-page-{pageNumber}.pdf", $"{PageFailureReasons.PageNotExtracted} : {ShortExceptionKind(renderEx)}");
                }
            }

            return (Array.Empty<byte>(), "application/pdf", $"releve-page-{pageNumber}.pdf", $"{PageFailureReasons.PageNotExtracted} : {ShortExceptionKind(ex)}");
        }
    }

    private static string ShortExceptionKind(Exception ex) => ex switch
    {
        InvalidOperationException => "structure PDF invalide",
        ArgumentOutOfRangeException => "page hors du document",
        IndexOutOfRangeException => "page hors du document",
        _ => ex.GetType().Name.Replace("Exception", string.Empty, StringComparison.Ordinal).ToLowerInvariant()
    };

    /// <summary>
    /// Garde de rendu, fermée par défaut : une boîte de page illisible (exception PdfSharp) est traitée
    /// comme trop grande — on ne rend jamais une image dont on ne connaît pas la taille.
    /// </summary>
    internal static bool ExceedsRenderGuard(byte[] pagePdf, BankStatementImportLimits limits)
    {
        try
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            using var doc = PdfReader.Open(new MemoryStream(pagePdf), PdfDocumentOpenMode.Import);
            var page = doc.Pages[0];
            var w = page.Width.Point;
            var h = page.Height.Point;
            if (w <= 0 || h <= 0 || double.IsNaN(w) || double.IsNaN(h))
                return true;
            var maxSide = limits.EffectiveVisionMaxLongSidePx;
            if (Math.Max(w, h) * limits.EffectiveVisionRenderDpi / 72.0 > maxSide)
                return true;
            var mp = w * h * limits.EffectiveVisionRenderDpi * limits.EffectiveVisionRenderDpi / (72.0 * 72.0 * 1_000_000.0);
            return mp > limits.EffectiveMaxImageMegapixels;
        }
        catch
        {
            return true;
        }
    }

    // ---------------------------------------------------------------------- contrôles compte

    /// <summary>
    /// Lecture 100 % IA : RIB lu (clé valide) différent du compte choisi → bloquant (le relevé
    /// n'appartient pas à ce compte, voir D3) ; RIB absent → avertissement.
    /// </summary>
    private static async Task<ExtractedBankStatement> AppendAccountChecksAsync(
        Persistence.TenantDbContext ctx,
        BankStatementImportSession session,
        ExtractedBankStatement merged,
        CancellationToken cancellationToken)
    {
        var issues = merged.Issues.Where(i => i.Code != StatementIssueCodes.RibMismatch).ToList();

        if (merged.Header.Rib is not { } readRib || !TunisianIban.HasValidRibKey(readRib))
        {
            if (!issues.Any(i => i.Code == StatementIssueCodes.RibNotFound))
            {
                issues.Add(new StatementExtractionIssue(StatementIssueCodes.RibNotFound, StatementIssueSeverity.Warning,
                    "RIB non lu sur le relevé : vérifiez le compte sélectionné."));
            }
            return merged with { Issues = issues };
        }

        var account = await ctx.BankAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == session.BankAccountId, cancellationToken);
        if (account is null)
            return merged with { Issues = issues };

        var accountRib = TunisianIban.NormalizeRibDigits(account.Rib);
        var normalizedRead = TunisianIban.NormalizeRibDigits(readRib);
        if (accountRib.Length != 20 || normalizedRead == accountRib)
            return merged with { Issues = issues };

        issues.Add(new StatementExtractionIssue(
            StatementIssueCodes.RibMismatch,
            StatementIssueSeverity.Blocking,
            $"RIB lu sur le relevé (…{MaskRibTail(normalizedRead)}) différent du compte choisi (…{MaskRibTail(accountRib)}). Relancez l'analyse avec le bon compte."));
        return merged with { Issues = issues };
    }

    private static async Task<ExtractedBankStatement> AppendAiRibMismatchWarningAsync(
        Persistence.TenantDbContext ctx,
        BankStatementImportSession session,
        ExtractedBankStatement merged,
        CancellationToken cancellationToken)
    {
        if (merged.Issues.Any(i => i.Code is StatementIssueCodes.RibMismatch or StatementIssueCodes.AiRibMismatch))
            return merged;

        if (merged.Header.Rib is not { } readRib || !TunisianIban.IsValidRibDigits(readRib))
            return merged;

        var account = await ctx.BankAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == session.BankAccountId, cancellationToken);
        if (account is null)
            return merged;

        var accountRib = TunisianIban.NormalizeRibDigits(account.Rib);
        if (accountRib.Length != 20 || readRib == accountRib)
            return merged;

        var issue = new StatementExtractionIssue(
            StatementIssueCodes.AiRibMismatch,
            StatementIssueSeverity.Warning,
            $"RIB lu par l'IA (…{MaskRibTail(readRib)}) différent du compte choisi (…{MaskRibTail(accountRib)}).");
        return merged with { Issues = merged.Issues.Append(issue).ToList() };
    }

    private static string MaskRibTail(string rib) => rib.Length >= 4 ? rib[^4..] : "????";

    // ---------------------------------------------------------------------- persistance, journal, audit

    /// <summary>
    /// Persiste la traçabilité par page au fil de l'eau (plan + lectures) sans quitter l'état
    /// « Extracting » ; la progression reste ≤ 99 % jusqu'à <see cref="BankStatementImportSession.CompleteExtraction"/>.
    /// </summary>
    private static async Task PersistProgressAsync(
        Persistence.TenantDbContext ctx,
        BankStatementImportSession session,
        ExtractedBankStatement layout,
        BankStatementAiPlan plan,
        List<BankStatementPageReading> pageReadings,
        int done,
        int totalPages,
        CancellationToken cancellationToken)
    {
        var interim = layout with
        {
            AiPlan = plan with
            {
                PageReadings = pageReadings.OrderBy(r => r.Page).ToList(),
                FallbackPages = BankStatementAiReadingPlanner.FallbackPagesOf(pageReadings)
            }
        };
        session.StartAiExtraction(
            session.AiProviderKind ?? "local",
            JsonSerializer.Serialize(interim, BankStatementImportService.JsonOptions),
            session.ProfileId ?? layout.ProfileId,
            session.PageCount);
        session.ReportProgress(Math.Min(99, done * 100 / Math.Max(1, totalPages)));
        await ctx.SaveChangesAsync(cancellationToken);
    }

    private void LogPage(Guid sessionId, int page, string engine, string? model, int attempts, StageResult stage)
    {
        var issueCodes = stage.Reading is null
            ? string.Empty
            : string.Join(',', stage.Reading.Issues.Select(i => i.Code).Distinct());
        var lines = stage.Reading?.Lines.Count ?? 0;

        if (stage.Outcome is "empty" or "invalid_json")
        {
            _logger.LogWarning(
                "Lecture IA relevé : session {SessionId}, page {Page}, moteur {Engine}, modèle {Model}, essai {Attempts}, durée {DurationMs} ms, premier jeton {FirstTokenMs} ms, fragments {StreamChunkCount}, caractères {RawChars}, lignes {Lines}, codes {IssueCodes}, issue {Outcome}, raison {Reason}",
                sessionId, page, engine, model, attempts, stage.DurationMs, stage.FirstTokenMs, stage.StreamChunkCount, stage.RawChars, lines, issueCodes, stage.Outcome, stage.FailureReason);
            return;
        }

        _logger.LogInformation(
            "Lecture IA relevé : session {SessionId}, page {Page}, moteur {Engine}, modèle {Model}, essai {Attempts}, durée {DurationMs} ms, premier jeton {FirstTokenMs} ms, fragments {StreamChunkCount}, caractères {RawChars}, lignes {Lines}, codes {IssueCodes}, issue {Outcome}, raison {Reason}",
            sessionId, page, engine, model, attempts, stage.DurationMs, stage.FirstTokenMs, stage.StreamChunkCount, stage.RawChars, lines, issueCodes, stage.Outcome, stage.FailureReason);
    }

    private async Task WarmUpBestEffortAsync(IAiStructuredExtractionPipeline pipeline, string visionModel, CancellationToken cancellationToken)
    {
        try
        {
            var task = pipeline.WarmUpAsync(visionModel, cancellationToken);
            if (task is not null)
                await task;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Lecture IA relevé : préchauffage du modèle vision ignoré.");
        }
    }

    private static async Task<string?> ResolveTextModelLabelAsync(IAiStructuredExtractionPipeline pipeline, CancellationToken cancellationToken)
    {
        try
        {
            var task = pipeline.ResolveModelRefAsync(null, cancellationToken);
            if (task is null)
                return null;
            var modelRef = await task;
            return string.IsNullOrWhiteSpace(modelRef.ProviderModelId) ? null : modelRef.ProviderModelId;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private async Task AuditBestEffortAsync(IServiceProvider services, Guid sessionId, object payload, CancellationToken cancellationToken)
    {
        var audit = services.GetService<IAuditService>();
        if (audit is null)
            return;
        try
        {
            await audit.LogAsync(
                AuditActions.Accounting.BankStatementAiReadingCompleted,
                nameof(BankStatementImportSession),
                sessionId,
                newValues: payload,
                cancellationToken: cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Lecture IA relevé : audit {Action} ignoré.", AuditActions.Accounting.BankStatementAiReadingCompleted);
        }
    }

    private static StageResult FailedStage(string? description, long durationMs)
    {
        var isTimeout = string.Equals(description, "timeout", StringComparison.OrdinalIgnoreCase);
        return new StageResult(null, isTimeout ? "timeout" : ShortFailure(description), isTimeout ? "timeout" : "failed",
            durationMs, null, 0, 0, null, false, IsProviderUnavailable(description));
    }

    /// <summary>Raison courte et sans donnée du relevé, affichable à l'utilisateur.</summary>
    private static string ShortFailure(string? description)
    {
        if (string.IsNullOrWhiteSpace(description))
            return "échec de la lecture";
        var t = description.Trim();
        return t.Length <= 120 ? t : t[..120] + "…";
    }

    private static bool IsProviderUnavailable(string? description) =>
        !string.IsNullOrWhiteSpace(description)
        && (description.Contains("indisponible", StringComparison.OrdinalIgnoreCase)
            || description.Contains("n'est pas prêt", StringComparison.OrdinalIgnoreCase)
            || description.Contains("aucun modèle", StringComparison.OrdinalIgnoreCase)
            || description.Contains("n'a pas pu être utilisé", StringComparison.OrdinalIgnoreCase)
            || description.Contains("Aucune clé API", StringComparison.OrdinalIgnoreCase));
}
