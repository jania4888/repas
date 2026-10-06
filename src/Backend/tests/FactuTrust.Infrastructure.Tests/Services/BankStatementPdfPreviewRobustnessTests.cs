using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Domain.Common;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;
using static FactuTrust.Infrastructure.Tests.Services.BankStatementImport.SyntheticBankStatementPdf;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Aperçu PDF de l'assistant de rapprochement (incident du 02/10/2026 : relevé BIAT mensuel non lu
/// par le parseur historique → IA sur CPU dans la requête → 504 du proxy après 300 s) :
/// lecture par profils sous drapeau, découpage des fichiers à plusieurs relevés, budget OCR + IA
/// borné, erreurs du moteur IA restituées par un code stable au lieu d'une 500.
/// </summary>
public sealed class BankStatementPdfPreviewRobustnessTests
{
    private readonly Mock<IAiDocumentTextExtractor> _ocr = new();

    private static Monthly July(decimal opening = 6_000.000m) => new(new DateOnly(2026, 7, 1), new DateOnly(2026, 7, 31), new Spec("08", opening, new[]
    {
        new Op("02/07/2026", "01/07/2026", new[] { "COM TVA VIREMENT REF : 00070000000001" }, 2.380m, null),
        new Op("02/07/2026", "03/07/2026", new[] { "VIREMENT TUNISIE AUTRE BANQUE 00070000000001" }, null, 345.678m),
        new Op("14/07/2026", "13/07/2026", new[] { "REGLEMENT CHEQUE NO 0000101 F/ STE EXEMPLE" }, 199.000m, null)
    }));

    private static Monthly August(decimal opening) => new(new DateOnly(2026, 8, 1), new DateOnly(2026, 8, 31), new Spec("08", opening, new[]
    {
        new Op("03/08/2026", "31/07/2026", new[] { "REGLEMENT CHEQUE NO 0000102 F/ STE EXEMPLE" }, 120.250m, null),
        new Op("04/08/2026", "05/08/2026", new[] { "VIREMENT TUNISIE AUTRE BANQUE 00080000000001" }, null, 1_400.900m)
    }));

    private BankStatementPdfImportService Service(bool layoutParser, int timeoutSeconds = 240)
    {
        var matcher = new BankAccountMatcher(new InMemoryFactory($"BankPdfPreview_{Guid.NewGuid()}"));
        var platform = new Mock<IPlatformAiSettingsService>().Object;
        var importResolver = new ImportAiModelResolutionService(
            platform,
            NullAiModelVisionProbe.Instance,
            Options.Create(new OllamaSettings()),
            NullLogger<ImportAiModelResolutionService>.Instance);
        var llm = new ImportBankStatementFromFileHandler(
            new Mock<IOllamaClient>().Object,
            new Mock<IOpenAiChatCompletionsClient>().Object,
            new Mock<IOllamaModelReadinessChecker>().Object,
            platform,
            importResolver,
            new Mock<IOllamaInferenceProfileResolver>().Object,
            NullLogger<ImportBankStatementFromFileHandler>.Instance,
            Options.Create(new OllamaSettings()));
        return new BankStatementPdfImportService(
            _ocr.Object,
            llm,
            matcher,
            Options.Create(new AccountingSettings
            {
                BankStatementPdfImportEnabled = true,
                BankStatementLayoutParserEnabled = layoutParser,
                BankStatementPreviewTimeoutSeconds = timeoutSeconds
            }),
            NullLogger<BankStatementPdfImportService>.Instance);
    }

    private static Task<Result<BankStatementFilePreviewDto>> Preview(BankStatementPdfImportService service, byte[] pdf, CancellationToken ct = default) =>
        service.PreviewAsync(pdf, "releve.pdf", "application/pdf", BankStatementFileFormat.Pdf, ct);

    // ── Lecture par profils (drapeau) ────────────────────────────────────────────────────────

    [Fact]
    public async Task Merged_monthly_statements_are_previewed_one_by_one_without_ocr_nor_ai()
    {
        var july = July();
        var pdf = BiatMonthlyLike(August(july.Spec.Closing), july);

        var result = await Preview(Service(layoutParser: true), pdf);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var preview = result.Value;
        Assert.False(preview.CanImport);
        Assert.NotNull(preview.Statements);
        Assert.Equal(2, preview.Statements!.Count);
        Assert.Equal(new DateTime(2026, 7, 1), preview.Statements[0].PeriodStart);
        Assert.Equal(new DateTime(2026, 8, 1), preview.Statements[1].PeriodStart);
        Assert.All(preview.Statements, s => Assert.True(s.CanImport, string.Join(" | ", s.Issues.Select(i => i.Message))));
        Assert.All(preview.Statements, s => Assert.Equal(BankStatementExtractionMethod.TextParser, s.ExtractionMethod));
        Assert.Equal(july.Spec.Opening, preview.Statements[0].SuggestedOpeningBalance);
        Assert.Equal(july.Spec.Closing, preview.Statements[1].SuggestedOpeningBalance);
        Assert.Equal(3, preview.Statements[0].Lines.Count);
        Assert.Equal(SyntheticBiatRib(), preview.Statements[0].DetectedRib);
        _ocr.Verify(o => o.ExtractAsync(It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Single_monthly_statement_is_importable_as_usual()
    {
        var result = await Preview(Service(layoutParser: true), BiatMonthlyLike(July()));

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value.Statements);
        Assert.True(result.Value.CanImport);
        Assert.Equal(3, result.Value.ValidLines);
        Assert.Equal("BIAT", result.Value.SuggestedBankName);
    }

    [Fact]
    public async Task Debtor_statement_is_shown_but_not_importable_by_the_wizard()
    {
        // Ouverture créditrice, clôture débitrice (les débits du mois dépassent le solde).
        var overdrawn = new Monthly(new DateOnly(2026, 7, 1), new DateOnly(2026, 7, 31), new Spec("08", 100.000m, new[]
        {
            new Op("02/07/2026", "02/07/2026", new[] { "REGLEMENT CHEQUE NO 0000103 F/ STE EXEMPLE" }, 1_000.000m, null),
            new Op("09/07/2026", "10/07/2026", new[] { "VIREMENT TUNISIE AUTRE BANQUE 00070000000002" }, null, 250.000m),
            new Op("15/07/2026", "15/07/2026", new[] { "COM TVA VIREMENT REF : 00070000000002" }, 2.380m, null)
        }));

        var result = await Preview(Service(layoutParser: true), BiatMonthlyLike(overdrawn));

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.CanImport);
        Assert.Contains(result.Value.Issues, i => i.IsBlocking && i.Message.Contains("solde débiteur", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Flag_off_keeps_the_historical_path()
    {
        _ocr.Setup(o => o.ExtractAsync(It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new OllamaRequestException("indisponible", httpStatusCode: 503));

        var result = await Preview(Service(layoutParser: false), BiatMonthlyLike(July()));

        Assert.True(result.IsFailure);
        _ocr.Verify(o => o.ExtractAsync(It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── Budget OCR + IA et erreurs du moteur ─────────────────────────────────────────────────

    [Fact]
    public async Task Slow_ocr_or_ai_ends_with_a_coded_timeout_before_the_proxy_gives_up()
    {
        _ocr.Setup(o => o.ExtractAsync(It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns<Stream, string, string, CancellationToken>(async (_, _, _, ct) =>
            {
                await Task.Delay(Timeout.Infinite, ct);
                throw new InvalidOperationException("inatteignable");
            });
        var watch = System.Diagnostics.Stopwatch.StartNew();

        var result = await Preview(Service(layoutParser: false, timeoutSeconds: 1), ManyPages(1));

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementPreviewErrorCodes.PreviewTimeout, result.Error.Code);
        // Le budget (1 s) a bien été attendu, et la réponse arrive avant le délai du proxy (300 s). La borne
        // haute n'est pas plus serrée : la suite complète sature le pool de threads et retarde les minuteries
        // (72 s observées), sans rapport avec le comportement testé.
        Assert.InRange(watch.Elapsed.TotalSeconds, 0.5, 280);
    }

    [Fact]
    public async Task Ai_engine_errors_become_a_coded_failure_instead_of_a_500()
    {
        _ocr.Setup(o => o.ExtractAsync(It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("connexion refusée"));

        var result = await Preview(Service(layoutParser: false), ManyPages(1));

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementPreviewErrorCodes.AiUnavailable, result.Error.Code);
    }

    [Fact]
    public async Task Http_client_timeout_of_the_ai_engine_is_reported_as_unavailable()
    {
        _ocr.Setup(o => o.ExtractAsync(It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new TaskCanceledException("délai du client HTTP", new TimeoutException()));

        var result = await Preview(Service(layoutParser: false), ManyPages(1));

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementPreviewErrorCodes.AiUnavailable, result.Error.Code);
    }

    [Fact]
    public async Task Client_cancellation_is_propagated_not_reported_as_a_timeout()
    {
        _ocr.Setup(o => o.ExtractAsync(It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns<Stream, string, string, CancellationToken>(async (_, _, _, ct) =>
            {
                await Task.Delay(Timeout.Infinite, ct);
                throw new InvalidOperationException("inatteignable");
            });
        using var client = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Preview(Service(layoutParser: false), ManyPages(1), client.Token));
    }

    // ── Période incohérente (chemin historique) ──────────────────────────────────────────────

    [Fact]
    public async Task Inconsistent_period_is_flagged_without_blocking_the_user_who_can_fix_it()
    {
        var preview = await Service(layoutParser: false).BuildPreviewDtoAsync(
            new[] { new ImportBankStatementLineRequest { TransactionDate = new DateTime(2026, 7, 2), Description = "COM", Amount = 1m, IsDebit = true } },
            Array.Empty<ImportIssueDto>(), null, null, null,
            new DateTime(2026, 7, 1), new DateTime(2026, 6, 30), null, null, null, null,
            BankStatementExtractionMethod.TextParser, 1, Array.Empty<byte>(), "releve.pdf", CancellationToken.None);

        var issue = Assert.Single(preview.Issues, i => i.Ref == "periode");
        Assert.False(issue.IsBlocking);
        Assert.True(preview.CanImport);
    }

    private static string SyntheticBiatRib() => RibFor("08");

    private sealed class InMemoryFactory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() =>
            new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }
}
