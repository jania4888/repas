using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class BankStatementPdfImportServiceTests
{
    private static string FixturePath =>
        Path.Combine(AppContext.BaseDirectory, "Fixtures", "bank-statements", "biat-janvier-2026.pdf");

    [Fact]
    public async Task GoldenPdf_PreviewAsync_ExtractsOperationsViaRawText()
    {
        var path = ResolveFixture();
        var content = await File.ReadAllBytesAsync(path);
        var service = BuildService();

        var result = await service.PreviewAsync(
            content,
            "biat-janvier-2026.pdf",
            "application/pdf",
            BankStatementFileFormat.Pdf);

        Assert.True(result.IsSuccess, result.Error?.Description);
        var preview = result.Value!;
        Assert.Equal("08503000231001399743", preview.DetectedRib);
        Assert.Equal(BankStatementExtractionMethod.TextParser, preview.ExtractionMethod);
        Assert.True(preview.ValidLines > 350, $"Expected >350 lines, got {preview.ValidLines}");
        Assert.True(preview.CanImport);
        Assert.Equal(18732.846m, preview.SuggestedClosingBalance);
        Assert.Equal(new DateTime(2026, 1, 31), preview.PeriodEnd?.Date);
        Assert.InRange(preview.TotalDebit, 198500m, 200000m);
        Assert.InRange(preview.TotalCredit, 162000m, 163000m);
        Assert.InRange(preview.TotalCredit + preview.SuggestedOpeningBalance!.Value, 180000m, 181000m);
        Assert.DoesNotContain(preview.Issues, i => i.Ref == "coherence" && i.Message.Contains("Écart de solde"));
        Assert.DoesNotContain(preview.Issues, i => i.Ref == "fichier" && i.IsBlocking);
    }

    [Fact]
    public async Task GoldenPdf_RawExtractor_MatchesParserLineCount()
    {
        var path = ResolveFixture();
        var content = await File.ReadAllBytesAsync(path);
        var raw = BankStatementPdfRawTextExtractor.Extract(content);

        Assert.True(raw.Success);
        var parser = new TunisianBankStatementTextParser();
        var (_, lines, _) = parser.Parse(raw.Text);
        Assert.True(lines.Count > 350);
    }

    private static BankStatementPdfImportService BuildService()
    {
        var dbName = $"BankPdfImport_{Guid.NewGuid()}";
        ITenantDbContextFactory factory = new TestTenantDbContextFactory(dbName);
        var matcher = new BankAccountMatcher(factory);

        var documentExtractor = new Mock<IAiDocumentTextExtractor>();
        var platform = new Mock<IPlatformAiSettingsService>().Object;
        var importResolver = new ImportAiModelResolutionService(
            platform,
            NullAiModelVisionProbe.Instance,
            Options.Create(new OllamaSettings()),
            NullLogger<ImportAiModelResolutionService>.Instance);
        var llmHandler = new ImportBankStatementFromFileHandler(
            new Mock<IOllamaClient>().Object,
            new Mock<IOpenAiChatCompletionsClient>().Object,
            new Mock<IOllamaModelReadinessChecker>().Object,
            platform,
            importResolver,
            new Mock<IOllamaInferenceProfileResolver>().Object,
            NullLogger<ImportBankStatementFromFileHandler>.Instance,
            Options.Create(new OllamaSettings()));

        return new BankStatementPdfImportService(
            documentExtractor.Object,
            llmHandler,
            matcher,
            Options.Create(new AccountingSettings { BankStatementPdfImportEnabled = true }),
            NullLogger<BankStatementPdfImportService>.Instance);
    }

    private static string ResolveFixture()
    {
        if (File.Exists(FixturePath))
            return FixturePath;

        var fromSource = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..",
            "Fixtures", "bank-statements", "biat-janvier-2026.pdf"));
        if (File.Exists(fromSource))
            return fromSource;

        var fromArchive = @"c:\Solution\archive\JANVIER 26.pdf";
        if (File.Exists(fromArchive))
            return fromArchive;

        throw new FileNotFoundException("Fixture biat-janvier-2026.pdf introuvable.");
    }

    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _databaseName;
        public TestTenantDbContextFactory(string databaseName) => _databaseName = databaseName;
        public TenantDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName: _databaseName)
                .Options;
            return new TenantDbContext(options);
        }
    }
}
