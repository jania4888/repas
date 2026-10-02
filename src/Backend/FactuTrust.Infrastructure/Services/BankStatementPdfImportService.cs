using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Application.Features.AI;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Import PDF/image de relevé bancaire : extraction texte → parser BIAT → (drapeau) lecture par
/// profils bancaires → fallback OCR/LLM, ce dernier borné dans le temps (budget inférieur au proxy).
/// </summary>
public sealed class BankStatementPdfImportService : IBankStatementPdfImportService
{
    private readonly IAiDocumentTextExtractor _documentExtractor;
    private readonly ImportBankStatementFromFileHandler _llmHandler;
    private readonly BankAccountMatcher _bankMatcher;
    private readonly AccountingSettings _settings;
    private readonly ILogger<BankStatementPdfImportService> _logger;
    private readonly BankStatementLayoutExtractor _layoutExtractor;
    private readonly TunisianBankStatementTextParser _textParser = new();

    public BankStatementPdfImportService(
        IAiDocumentTextExtractor documentExtractor,
        ImportBankStatementFromFileHandler llmHandler,
        BankAccountMatcher bankMatcher,
        IOptions<AccountingSettings> settings,
        ILogger<BankStatementPdfImportService> logger,
        BankStatementLayoutExtractor? layoutExtractor = null)
    {
        _documentExtractor = documentExtractor;
        _llmHandler = llmHandler;
        _bankMatcher = bankMatcher;
        _settings = settings.Value;
        _logger = logger;
        _layoutExtractor = layoutExtractor ?? new BankStatementLayoutExtractor();
    }

    public async Task<Result<BankStatementFilePreviewDto>> PreviewAsync(
        byte[] content,
        string fileName,
        string contentType,
        BankStatementFileFormat format,
        CancellationToken cancellationToken = default)
    {
        if (!_settings.BankStatementPdfImportEnabled)
            return Result.Failure<BankStatementFilePreviewDto>(Error.Validation("BankStatementImport",
                "L'import PDF de relevés bancaires est désactivé pour ce dossier."));

        if (content is null || content.Length == 0)
            return Result.Failure<BankStatementFilePreviewDto>(Error.Validation("File", "Fichier vide."));

        if (format == BankStatementFileFormat.Pdf)
        {
            var rawResult = BankStatementPdfRawTextExtractor.Extract(content);
            if (rawResult.Success &&
                BankStatementTextQuality.IsSufficient(rawResult.Text) &&
                TryParseDeterministic(rawResult.Text, rawResult.PageCount, ocrApplied: false, out var rawPreview))
            {
                return Result.Success(await BuildPreviewDtoAsync(
                    rawPreview.Lines, rawPreview.Issues, rawPreview.Rib, rawPreview.BankCode, rawPreview.BankName,
                    rawPreview.PeriodStart, rawPreview.PeriodEnd, rawPreview.Opening, rawPreview.Closing,
                    rawPreview.FooterTotalDebits, rawPreview.FooterTotalCredits,
                    BankStatementExtractionMethod.TextParser, rawPreview.PageCount, content, fileName, cancellationToken));
            }

            _logger.LogInformation(
                "Relevé PDF : extraction brute insuffisante ou 0 opération ({LineCount} lignes), bascule extracteur layout/OCR.",
                rawResult.Success ? CountParsedLines(rawResult.Text) : 0);

            if (_settings.BankStatementLayoutParserEnabled)
            {
                var layout = await TryLayoutPreviewAsync(content, cancellationToken);
                if (layout is not null)
                    return Result.Success(layout);
            }
        }

        // OCR et IA s'exécutent dans la requête HTTP : budget total inférieur au délai du proxy (nginx
        // 300 s), attente de la file IA comprise. L'annulation du client (RequestAborted) reste propagée.
        var budget = TimeSpan.FromSeconds(Math.Clamp(_settings.BankStatementPreviewTimeoutSeconds, 1, 280));
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(budget);
        var started = DateTime.UtcNow;
        var stage = "ocr";
        try
        {
            await using var stream = new MemoryStream(content);
            var extract = await _documentExtractor.ExtractAsync(stream, fileName, contentType, deadline.Token);
            if (!extract.Success || string.IsNullOrWhiteSpace(extract.Text))
            {
                stage = "llm";
                var llmOnly = await _llmHandler.ExtractAsync(content, fileName, contentType, extract, deadline.Token);
                if (llmOnly.IsFailure)
                    return Result.Failure<BankStatementFilePreviewDto>(llmOnly.Error);
                return await FinalizePreviewAsync(llmOnly.Value, content, fileName, BankStatementExtractionMethod.OcrLlm, extract.PageCount, cancellationToken);
            }

            if (BankStatementTextQuality.IsSufficient(extract.Text) || BankStatementImportOcrQuality.IsSufficient(extract.Text))
            {
                if (TryParseDeterministic(extract.Text, extract.PageCount, extract.OcrApplied, out var parsed))
                {
                    var method = extract.OcrApplied
                        ? BankStatementExtractionMethod.OcrTextParser
                        : BankStatementExtractionMethod.TextParser;
                    var preview = await BuildPreviewDtoAsync(
                        parsed.Lines, parsed.Issues, parsed.Rib, parsed.BankCode, parsed.BankName,
                        parsed.PeriodStart, parsed.PeriodEnd, parsed.Opening, parsed.Closing,
                        parsed.FooterTotalDebits, parsed.FooterTotalCredits,
                        method, parsed.PageCount, content, fileName, cancellationToken);
                    return Result.Success(preview);
                }
            }

            _logger.LogInformation("Relevé bancaire : texte insuffisant pour parser déterministe, bascule LLM.");
            stage = "llm";
            var llm = await _llmHandler.ExtractAsync(content, fileName, contentType, extract, deadline.Token);
            if (llm.IsFailure)
                return Result.Failure<BankStatementFilePreviewDto>(llm.Error);
            return await FinalizePreviewAsync(llm.Value, content, fileName, BankStatementExtractionMethod.OcrLlm, extract.PageCount, cancellationToken);
        }
        catch (OperationCanceledException) when (deadline.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(
                "Relevé bancaire : lecture {Stage} interrompue après {Elapsed:F0} s (budget {Budget:F0} s).",
                stage, (DateTime.UtcNow - started).TotalSeconds, budget.TotalSeconds);
            return Result.Failure<BankStatementFilePreviewDto>(new Error(BankStatementPreviewErrorCodes.PreviewTimeout,
                "La lecture de ce relevé par l'IA dépasse le délai autorisé. Utilisez de préférence un relevé PDF " +
                "téléchargé depuis votre banque en ligne (texte lisible), ou un export CSV/OFX."));
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested
                                   && ex is OllamaRequestException or HttpRequestException or TimeoutException
                                       or TaskCanceledException { InnerException: TimeoutException })
        {
            _logger.LogWarning(
                "Relevé bancaire : moteur IA en erreur ({ErrorType}) à l'étape {Stage} après {Elapsed:F0} s.",
                ex.GetType().Name, stage, (DateTime.UtcNow - started).TotalSeconds);
            return Result.Failure<BankStatementFilePreviewDto>(new Error(BankStatementPreviewErrorCodes.AiUnavailable,
                "Le moteur IA n'a pas pu lire ce relevé pour le moment. Réessayez plus tard, ou utilisez un relevé " +
                "PDF téléchargé depuis votre banque en ligne, ou un export CSV/OFX."));
        }
    }

    /// <summary>
    /// Lecture déterministe par profils bancaires (gabarits que le parseur historique ne lit pas, fichiers
    /// à plusieurs relevés). Retenue SEULEMENT si chaque relevé a des lignes et aucune anomalie bloquante
    /// (soldes vérifiés au millime) ; sinon null et le chemin historique (OCR, IA) s'applique tel quel.
    /// </summary>
    private async Task<BankStatementFilePreviewDto?> TryLayoutPreviewAsync(byte[] content, CancellationToken cancellationToken)
    {
        IReadOnlyList<ExtractedBankStatement> statements;
        try
        {
            statements = _layoutExtractor.ExtractAll(content);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            _logger.LogWarning(ex, "Relevé PDF : lecture par profils impossible, chemin historique conservé.");
            return null;
        }

        if (statements.Count == 0 || statements.Any(s => s.Lines.Count == 0 || s.HasBlockingIssue))
        {
            _logger.LogInformation(
                "Relevé PDF : lecture par profils non retenue ({Count} relevé(s), profil {Profile}), chemin historique conservé.",
                statements.Count, statements.FirstOrDefault()?.ProfileId);
            return null;
        }

        var previews = new List<BankStatementFilePreviewDto>();
        foreach (var statement in statements)
            previews.Add(await BuildLayoutPreviewAsync(statement, cancellationToken));

        _logger.LogInformation(
            "Relevé PDF : lu par profil {Profile} sans IA, {Count} relevé(s), {Lines} ligne(s).",
            statements[0].ProfileId, statements.Count, statements.Sum(s => s.Lines.Count));

        if (previews.Count == 1)
            return previews[0];

        var periods = string.Join(", ", previews.Select(p => $"{p.PeriodStart:dd/MM/yyyy}–{p.PeriodEnd:dd/MM/yyyy}"));
        return previews[0] with
        {
            CanImport = false,
            Issues = previews[0].Issues.Append(new ImportIssueDto
            {
                Ref = "fichier",
                Message = $"Le fichier contient {previews.Count} relevés ({periods}) : ils sont importés l'un après l'autre.",
                IsBlocking = false
            }).ToList(),
            Statements = previews
        };
    }

    private async Task<BankStatementFilePreviewDto> BuildLayoutPreviewAsync(ExtractedBankStatement statement, CancellationToken cancellationToken)
    {
        var header = statement.Header;
        var lines = statement.Lines.Select(l => new ImportBankStatementLineRequest
        {
            TransactionDate = l.TransactionDate.ToDateTime(TimeOnly.MinValue),
            ValueDate = l.ValueDate?.ToDateTime(TimeOnly.MinValue),
            Reference = BankLabelReferences.Extract(l.Label)?.Number ?? string.Empty,
            Description = l.Label,
            Amount = l.Amount,
            IsDebit = l.IsDebit
        }).ToList();

        var issues = statement.Issues
            .Where(i => i.Severity != StatementIssueSeverity.Info)
            .Select(i => new ImportIssueDto
            {
                Ref = i.PageNumber is { } page ? $"page {page}" : "fichier",
                Message = i.Message,
                IsBlocking = i.Severity == StatementIssueSeverity.Blocking
            })
            .ToList();

        var (match, matchIssues) = await _bankMatcher.MatchByRibAsync(header.Rib, cancellationToken);
        issues.AddRange(matchIssues);

        // L'enregistrement de l'assistant (POST statements) ne sait pas stocker un solde débiteur.
        if (header.OpeningBalance?.Value < 0 || header.ClosingBalance?.Value < 0)
        {
            issues.Add(new ImportIssueDto
            {
                Ref = "fichier",
                Message = "Ce relevé présente un solde débiteur, que l'assistant de rapprochement ne sait pas enregistrer : " +
                          "importez-le depuis la saisie manuelle (Import › Importer un relevé bancaire).",
                IsBlocking = true
            });
        }

        var check = BankStatementBalanceCheck.Evaluate(header, statement.Lines);
        var bankName = BankStatementProfileRegistry.Default.Profiles.FirstOrDefault(p => p.Id == statement.ProfileId)?.BankName;
        return new BankStatementFilePreviewDto
        {
            TotalLines = lines.Count,
            ValidLines = lines.Count,
            TotalDebit = lines.Where(l => l.IsDebit).Sum(l => l.Amount),
            TotalCredit = lines.Where(l => !l.IsDebit).Sum(l => l.Amount),
            PeriodStart = header.PeriodStart?.ToDateTime(TimeOnly.MinValue),
            PeriodEnd = header.PeriodEnd?.ToDateTime(TimeOnly.MinValue),
            CanImport = !issues.Any(i => i.IsBlocking) && lines.Count > 0,
            Issues = issues,
            Lines = lines,
            DetectedBankCode = header.BankCode,
            DetectedRib = header.Rib,
            MatchedBankAccountId = match.BankAccountId,
            MatchedChartOfAccountNumber = match.ChartOfAccountNumber,
            SuggestedBankName = match.BankName ?? bankName,
            SuggestedOpeningBalance = header.OpeningBalance?.Value,
            SuggestedClosingBalance = header.ClosingBalance?.Value,
            ExtractionMethod = BankStatementExtractionMethod.TextParser,
            ConfidenceScore = 95,
            SourcePageCount = statement.PageCount,
            BalanceDiscrepancy = check.Difference is { } difference ? Math.Abs(difference) : null
        };
    }

    private sealed record DeterministicParseResult(
        IReadOnlyList<ImportBankStatementLineRequest> Lines,
        IReadOnlyList<ImportIssueDto> Issues,
        string? Rib,
        string? BankCode,
        string? BankName,
        DateTime? PeriodStart,
        DateTime? PeriodEnd,
        decimal? Opening,
        decimal? Closing,
        decimal? FooterTotalDebits,
        decimal? FooterTotalCredits,
        int PageCount);

    private bool TryParseDeterministic(string text, int pageCount, bool ocrApplied, out DeterministicParseResult result)
    {
        var parsed = _textParser.Parse(text);
        result = new DeterministicParseResult(
            parsed.Lines,
            parsed.Issues,
            parsed.Header.RibDigits,
            parsed.Header.BankCode,
            parsed.Header.HolderName,
            parsed.Header.OpeningBalanceDate?.AddDays(1)
                ?? (parsed.Lines.Count > 0 ? parsed.Lines.Min(l => l.TransactionDate) : null),
            parsed.Header.StatementDate,
            parsed.Header.OpeningBalance,
            parsed.Header.ClosingBalance,
            parsed.Header.TotalDebits,
            parsed.Header.TotalCredits,
            Math.Max(parsed.Header.PageCount, pageCount));

        return parsed.Lines.Count > 0;
    }

    private int CountParsedLines(string text) => _textParser.Parse(text).Lines.Count;

    internal async Task<BankStatementFilePreviewDto> BuildPreviewDtoAsync(
        IReadOnlyList<ImportBankStatementLineRequest> lines,
        IReadOnlyList<ImportIssueDto> issues,
        string? rib,
        string? bankCode,
        string? bankName,
        DateTime? periodStart,
        DateTime? periodEnd,
        decimal? opening,
        decimal? closing,
        decimal? footerTotalDebits,
        decimal? footerTotalCredits,
        BankStatementExtractionMethod method,
        int pageCount,
        byte[] content,
        string fileName,
        CancellationToken cancellationToken)
    {
        var allIssues = issues.ToList();
        var (match, matchIssues) = await _bankMatcher.MatchByRibAsync(rib, cancellationToken);
        allIssues.AddRange(matchIssues);

        if (closing is > 1_000_000_000m)
        {
            allIssues.Add(new ImportIssueDto
            {
                Ref = "fichier",
                Message = "Solde final aberrant détecté — vérifiez le format du relevé.",
                IsBlocking = true
            });
            closing = null;
        }

        var totalDebit = lines.Where(l => l.IsDebit).Sum(l => l.Amount);
        var totalCredit = lines.Where(l => !l.IsDebit).Sum(l => l.Amount);
        decimal? discrepancy = null;

        if (footerTotalDebits.HasValue && footerTotalDebits > 0)
        {
            var debitDelta = Math.Abs(totalDebit - footerTotalDebits.Value);
            var debitTolerance = Math.Max(1m, footerTotalDebits.Value * 0.001m);
            if (debitDelta > debitTolerance)
            {
                allIssues.Add(new ImportIssueDto
                {
                    Ref = "coherence",
                    Message = $"Total débits lignes {totalDebit:N3} vs relevé {footerTotalDebits:N3} (Δ {debitDelta:N3}).",
                    IsBlocking = false
                });
            }
        }

        if (footerTotalCredits.HasValue && footerTotalCredits > 0)
        {
            // BIAT : le total crédits du pied de page inclut le solde d'ouverture.
            var creditComparable = opening.HasValue ? opening.Value + totalCredit : totalCredit;
            var creditDelta = Math.Abs(creditComparable - footerTotalCredits.Value);
            var creditTolerance = Math.Max(1m, footerTotalCredits.Value * 0.001m);
            if (creditDelta > creditTolerance)
            {
                allIssues.Add(new ImportIssueDto
                {
                    Ref = "coherence",
                    Message = $"Total crédits lignes {totalCredit:N3} (+ solde initial {opening:N3}) vs relevé {footerTotalCredits:N3} (Δ {creditDelta:N3}).",
                    IsBlocking = false
                });
            }
        }

        if (opening.HasValue && closing.HasValue)
        {
            var computed = totalDebit - totalCredit - opening.Value;
            discrepancy = Math.Abs(computed - closing.Value);
            if (discrepancy > 1m)
            {
                allIssues.Add(new ImportIssueDto
                {
                    Ref = "coherence",
                    Message = $"Écart de solde : calculé {computed:N3} vs relevé {closing.Value:N3} (Δ {discrepancy:N3}).",
                    IsBlocking = false
                });
            }
        }

        if (periodStart is { } start && periodEnd is { } end && end < start)
        {
            allIssues.Add(new ImportIssueDto
            {
                Ref = "periode",
                Message = $"Période déduite incohérente : fin {end:dd/MM/yyyy} avant début {start:dd/MM/yyyy}. Corrigez la période avant d'importer.",
                IsBlocking = false
            });
        }

        var hasBlocking = allIssues.Any(i => i.IsBlocking);
        var confidence = method switch
        {
            BankStatementExtractionMethod.TextParser => 95,
            BankStatementExtractionMethod.OcrTextParser => 80,
            BankStatementExtractionMethod.OcrLlm => 65,
            _ => 50
        };

        return new BankStatementFilePreviewDto
        {
            TotalLines = lines.Count + allIssues.Count(i => i.Ref.StartsWith("ligne", StringComparison.OrdinalIgnoreCase)),
            ValidLines = lines.Count,
            TotalDebit = totalDebit,
            TotalCredit = totalCredit,
            PeriodStart = periodStart,
            PeriodEnd = periodEnd,
            CanImport = !hasBlocking && lines.Count > 0,
            Issues = allIssues,
            Lines = lines,
            DetectedBankCode = bankCode,
            DetectedRib = rib,
            MatchedBankAccountId = match.BankAccountId,
            MatchedChartOfAccountNumber = match.ChartOfAccountNumber,
            SuggestedBankName = match.BankName ?? bankName,
            SuggestedOpeningBalance = opening,
            SuggestedClosingBalance = closing,
            ExtractionMethod = method,
            ConfidenceScore = confidence,
            SourcePageCount = pageCount,
            BalanceDiscrepancy = discrepancy
        };
    }

    private async Task<Result<BankStatementFilePreviewDto>> FinalizePreviewAsync(
        LlmBankStatementExtraction llm,
        byte[] content,
        string fileName,
        BankStatementExtractionMethod method,
        int pageCount,
        CancellationToken cancellationToken)
    {
        var lines = MapLlmLines(llm);
        var issues = llm.Warnings.Select(w => new ImportIssueDto
        {
            Ref = "llm",
            Message = w,
            IsBlocking = false
        }).ToList();

        if (lines.Count == 0)
            issues.Add(new ImportIssueDto { Ref = "fichier", Message = "Aucune ligne extraite par l'IA.", IsBlocking = true });

        DateTime? periodStart = ToDateTime(InvoiceImportParsing.ParseDate(llm.PeriodStart));
        DateTime? periodEnd = ToDateTime(InvoiceImportParsing.ParseDate(llm.PeriodEnd ?? llm.StatementDate));
        if (!periodStart.HasValue && lines.Count > 0)
            periodStart = lines.Min(l => l.TransactionDate);
        if (!periodEnd.HasValue && lines.Count > 0)
            periodEnd = lines.Max(l => l.TransactionDate);

        var rib = string.IsNullOrWhiteSpace(llm.Rib) ? null : new string(llm.Rib.Where(char.IsDigit).ToArray());
        var preview = await BuildPreviewDtoAsync(
            lines, issues, rib, rib?.Length >= 2 ? rib[..2] : null, llm.BankName ?? llm.HolderName,
            periodStart, periodEnd, llm.OpeningBalance, llm.ClosingBalance,
            null, null,
            method, pageCount, content, fileName, cancellationToken);
        return Result.Success(preview);
    }

    private static List<ImportBankStatementLineRequest> MapLlmLines(LlmBankStatementExtraction llm)
    {
        var result = new List<ImportBankStatementLineRequest>();
        foreach (var l in llm.Lines)
        {
            if (string.IsNullOrWhiteSpace(l.Description) || l.Amount is null or <= 0)
                continue;
            var txDate = ToDateTime(InvoiceImportParsing.ParseDate(l.TransactionDate)) ?? DateTime.UtcNow.Date;
            result.Add(new ImportBankStatementLineRequest
            {
                TransactionDate = txDate,
                ValueDate = ToDateTime(InvoiceImportParsing.ParseDate(l.ValueDate)),
                Reference = l.Reference?.Trim() ?? string.Empty,
                Description = l.Description.Trim(),
                Amount = l.Amount.Value,
                IsDebit = l.IsDebit ?? BankOperationClassifier.IsDebit(l.Description)
            });
        }
        return result;
    }

    public static string ComputeFileHash(byte[] content)
    {
        var hash = SHA256.HashData(content);
        return Convert.ToHexString(hash);
    }

    private static DateTime? ToDateTime(DateOnly? d) =>
        d.HasValue ? d.Value.ToDateTime(TimeOnly.MinValue) : null;
}
