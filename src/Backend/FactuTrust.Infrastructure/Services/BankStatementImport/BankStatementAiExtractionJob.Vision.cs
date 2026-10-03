using System.Text;
using System.Text.Json;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.Json;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Banking;
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
        var pipeline = services.GetRequiredService<IAiStructuredExtractionPipeline>();
        var ollamaSettings = services.GetRequiredService<IOptions<OllamaSettings>>().Value;
        var visionModel = ImportAiModelResolver.ResolveBankStatementVisionModelId(ollamaSettings);
        var extractor = services.GetService<BankStatementLayoutExtractor>() ?? new BankStatementLayoutExtractor();
        var plan = layout.AiPlan ?? throw new InvalidOperationException("Plan IA absent.");
        var pages = plan.ScannedPages.Concat(plan.TextPages).Distinct().OrderBy(p => p).Take(limits.MaxAiPages).ToList();
        var totalCalls = Math.Max(1, pages.Count);
        var fallbackPages = new List<int>();
        var scannedReadings = new Dictionary<int, BankStatementAiPageReader.PageReading>();
        var failed = new List<int>();
        var textReadings = new Dictionary<int, BankStatementAiPageReader.TextPageReading>();
        var calls = 0;
        var visionFailures = 0;

        foreach (var pageNumber in pages)
        {
            if (await IsCancelledAsync(ctx, session.Id, cancellationToken))
                return;

            var pageBytes = isPdf ? ExtractSinglePage(content, pageNumber) : content;
            if (isPdf && ExceedsRenderGuard(pageBytes, limits))
            {
                if (plan.ScannedPages.Contains(pageNumber))
                {
                    scannedReadings[pageNumber] = FailedReading(pageNumber, "page trop grande pour la lecture vision");
                    failed.Add(pageNumber);
                }
                else
                {
                    textReadings[pageNumber] = new BankStatementAiPageReader.TextPageReading(
                        FailedReading(pageNumber, "page trop grande pour la lecture vision"),
                        Array.Empty<decimal>(), Array.Empty<decimal>(), true);
                }

                continue;
            }

            await using var stream = new MemoryStream(pageBytes);
            var outcome = await pipeline.RunAsync(new AiStructuredExtractionRequest
            {
                FileStream = stream,
                FileName = isPdf ? $"releve-page-{pageNumber}.pdf" : session.FileName,
                ContentType = isPdf ? "application/pdf" : session.ContentType,
                SystemPrompt = BankStatementVisionPrompt.System,
                UserInstruction = BankStatementVisionPrompt.UserInstruction,
                OutputSchema = LlmOutputSchemas.BankStatementPageVerbatim,
                ErrorCode = "BankStatementImport",
                MaxImages = 1,
                ForceVision = true,
                RequireVision = true,
                VisionModelOverride = visionModel,
                IncludeExtractedTextWithImages = limits.VisionSendTextLayer,
                MaxOutputTokens = limits.EffectiveVisionMaxOutputTokens,
                LlmTimeoutSeconds = limits.EffectiveVisionCallTimeoutSeconds,
                RenderDpi = limits.EffectiveVisionRenderDpi
            }, cancellationToken);

            BankStatementAiPageReader.PageReading reading;
            if (outcome.IsFailure || !outcome.Value.VisionUsed)
            {
                visionFailures++;
                if (limits.VisionTextFallbackEnabled)
                {
                    reading = await RunPageTextFallbackAsync(
                        pipeline, extractor, content, isPdf, session, pageNumber, plan, limits, cancellationToken);
                    fallbackPages.Add(pageNumber);
                }
                else
                {
                    reading = FailedReading(pageNumber, outcome.IsFailure ? outcome.Error.Description : "vision non utilisée");
                }
            }
            else
            {
                var json = InvoiceImportParsing.ExtractFirstJsonObject(outcome.Value.RawContent);
                var typed = string.IsNullOrWhiteSpace(json)
                    ? null
                    : BankStatementVisionPageNormalizer.Normalize(json, pageNumber);
                var acceptDayFirst = plan.TextPages.Contains(pageNumber);
                reading = BankStatementAiPageReader.Read(typed, pageNumber, outcome.Value.Extraction.Text, acceptDayFirst);
            }

            if (plan.ScannedPages.Contains(pageNumber))
            {
                scannedReadings[pageNumber] = reading;
                if (reading.Issues.Any(i => i.Code == StatementIssueCodes.AiPageFailed))
                    failed.Add(pageNumber);
            }
            else
            {
                var chunks = isPdf
                    ? extractor.BuildAiTextChunks(content, new[] { pageNumber }, limits.EffectiveAiTextOperationsPerCall)
                    : Array.Empty<BankStatementAiTextChunk>();
                textReadings[pageNumber] = BankStatementAiPageReader.ForWholePage(reading, chunks);
                if (reading.Issues.Any(i => i.Code == StatementIssueCodes.AiPageFailed))
                    failed.Add(pageNumber);
            }

            session.ReportProgress(++calls * 100 / totalCalls);
            await ctx.SaveChangesAsync(cancellationToken);

            if (visionFailures >= 2 && limits.VisionTextFallbackEnabled)
            {
                // Coupe-circuit : pages restantes en repli texte directement.
                break;
            }
        }

        // Pages non traitées (coupe-circuit) : repli texte.
        foreach (var pageNumber in pages.Where(p => !scannedReadings.ContainsKey(p) && !textReadings.ContainsKey(p)))
        {
            var reading = await RunPageTextFallbackAsync(
                pipeline, extractor, content, isPdf, session, pageNumber, plan, limits, cancellationToken);
            fallbackPages.Add(pageNumber);
            if (plan.ScannedPages.Contains(pageNumber))
                scannedReadings[pageNumber] = reading;
            else
            {
                var chunks = isPdf
                    ? extractor.BuildAiTextChunks(content, new[] { pageNumber }, limits.EffectiveAiTextOperationsPerCall)
                    : Array.Empty<BankStatementAiTextChunk>();
                textReadings[pageNumber] = BankStatementAiPageReader.ForWholePage(reading, chunks);
            }
        }

        var merged = BankStatementAiPageReader.Merge(
            layout,
            scannedReadings,
            failed.Where(f => plan.ScannedPages.Contains(f)).ToList(),
            textReadings.Count > 0 ? textReadings : null);

        var planCompleted = plan with { FallbackPages = fallbackPages.Distinct().OrderBy(p => p).ToList() };
        merged = merged with { AiPlan = planCompleted };
        merged = await AppendAiRibMismatchWarningAsync(ctx, session, merged, cancellationToken);
        var method = layout.Lines.Count > 0 ? "layout+ai" : "ai";
        session.CompleteExtraction(JsonSerializer.Serialize(merged, BankStatementImportService.JsonOptions), method, layout.ProfileId, layout.PageCount);
        await ctx.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Lecture vision de relevé : session {SessionId}, {Pages} page(s), {Fallback} repli(s), {Lines} ligne(s).",
            session.Id, pages.Count, fallbackPages.Count, merged.Lines.Count);
    }

    private static bool ExceedsRenderGuard(byte[] pagePdf, BankStatementImportLimits limits)
    {
        try
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            using var doc = PdfReader.Open(new MemoryStream(pagePdf), PdfDocumentOpenMode.Import);
            var page = doc.Pages[0];
            var w = page.Width.Point;
            var h = page.Height.Point;
            var maxSide = limits.EffectiveVisionMaxLongSidePx;
            if (Math.Max(w, h) * limits.EffectiveVisionRenderDpi / 72.0 > maxSide)
                return true;
            var mp = w * h * limits.EffectiveVisionRenderDpi * limits.EffectiveVisionRenderDpi / (72.0 * 72.0 * 1_000_000.0);
            return mp > limits.EffectiveMaxImageMegapixels;
        }
        catch
        {
            return false;
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
        CancellationToken cancellationToken)
    {
        if (plan.ScannedPages.Contains(pageNumber) || !isPdf)
        {
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
            }, cancellationToken);
            return outcome.IsFailure
                ? FailedReading(pageNumber, outcome.Error.Description)
                : BankStatementAiPageReader.Read(outcome.Value.RawContent, pageNumber, outcome.Value.Extraction.Text);
        }

        var chunks = extractor.BuildAiTextChunks(content, new[] { pageNumber }, limits.EffectiveAiTextOperationsPerCall);
        var chunkReadings = new List<(BankStatementAiPageReader.PageReading Reading, BankStatementAiTextChunk Chunk)>();
        foreach (var chunk in chunks)
        {
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
            }, cancellationToken);
            var reading = outcome.IsFailure
                ? FailedReading(chunk.Page, outcome.Error.Description)
                : BankStatementAiPageReader.Read(outcome.Value.RawContent, chunk.Page, ocrText: null, acceptDayFirstDates: true);
            chunkReadings.Add((reading, chunk));
        }

        return chunkReadings.Count > 0
            ? BankStatementAiPageReader.CombineChunks(chunkReadings).Reading
            : FailedReading(pageNumber, "aucun texte exploitable sur la page");
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

}
