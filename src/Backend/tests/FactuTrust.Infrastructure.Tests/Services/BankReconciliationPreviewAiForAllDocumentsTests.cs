using System.Text;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Drapeau « tout document par l'IA » : l'aperçu historique du rapprochement refuse les PDF et images
/// (format déclaré OU signature du contenu) avec un code stable, sans jamais appeler l'IA synchrone ;
/// CSV / OFX restent inchangés, et sans le drapeau (ou sans l'import IA) rien ne change.
/// </summary>
public sealed class BankReconciliationPreviewAiForAllDocumentsTests
{
    private readonly string _dbName = $"BankRecoAll_{Guid.NewGuid()}";
    private readonly Mock<IBankStatementPdfImportService> _pdfImport = new();

    private sealed class Factory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() => new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }

    private BankReconciliationService Service(bool aiPosting = true, bool allDocuments = true)
    {
        var settings = new AccountingSettings
        {
            BankStatementAiPostingEnabled = aiPosting,
            BankStatementAiForAllDocumentsEnabled = allDocuments
        };
        var factory = new Factory(_dbName);
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.Email).Returns("comptable@test.tn");
        _pdfImport.Setup(p => p.PreviewAsync(It.IsAny<byte[]>(), It.IsAny<string>(), It.IsAny<string>(),
                It.IsAny<BankStatementFileFormat>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new BankStatementFilePreviewDto()));
        return new BankReconciliationService(factory, new Mock<IAuditService>().Object, user.Object, _pdfImport.Object,
            new AccountingReportingService(factory, Options.Create(new AccountingSettings())), Options.Create(settings));
    }

    private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n");
    private static readonly byte[] Png = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00 };
    private static readonly byte[] Csv = Encoding.UTF8.GetBytes("date,libelle,montant\n2026-05-03,Virement reçu,1500\n");

    private void AssertPdfPreviewNeverCalled() =>
        _pdfImport.Verify(p => p.PreviewAsync(It.IsAny<byte[]>(), It.IsAny<string>(), It.IsAny<string>(),
            It.IsAny<BankStatementFileFormat>(), It.IsAny<CancellationToken>()), Times.Never);

    [Theory]
    [InlineData(BankStatementFileFormat.Pdf)]
    [InlineData(BankStatementFileFormat.Image)]
    public async Task Pdf_or_image_format_is_sent_to_the_ai_import(BankStatementFileFormat format)
    {
        var result = await Service().PreviewStatementFileAsync(format == BankStatementFileFormat.Pdf ? Pdf : Png, format, "releve", "application/octet-stream");

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementPreviewErrorCodes.AiImportRequired, result.Error.Code);
        AssertPdfPreviewNeverCalled();
    }

    [Fact]
    public async Task Pdf_declared_as_csv_is_recognised_by_its_signature()
    {
        var result = await Service().PreviewStatementFileAsync(Pdf, BankStatementFileFormat.Csv, "releve.csv", "text/csv");

        Assert.Equal(BankStatementPreviewErrorCodes.AiImportRequired, result.Error.Code);
        AssertPdfPreviewNeverCalled();
    }

    [Fact]
    public async Task Csv_is_still_previewed()
    {
        var result = await Service().PreviewStatementFileAsync(Csv, BankStatementFileFormat.Csv, "releve.csv", "text/csv");

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.CanImport);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task Without_both_flags_the_historical_pdf_preview_is_used(bool aiPosting, bool allDocuments)
    {
        var result = await Service(aiPosting, allDocuments).PreviewStatementFileAsync(Pdf, BankStatementFileFormat.Pdf, "releve.pdf", "application/pdf");

        Assert.True(result.IsSuccess);
        _pdfImport.Verify(p => p.PreviewAsync(Pdf, "releve.pdf", "application/pdf", BankStatementFileFormat.Pdf, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData(new byte[] { 0x25, 0x50, 0x44, 0x46, 0x2D }, true)]
    [InlineData(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D }, true)]
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 0x00 }, true)]
    [InlineData(new byte[] { 0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50 }, true)]
    [InlineData(new byte[] { 0x64, 0x61, 0x74, 0x65, 0x2C }, false)]
    [InlineData(new byte[] { 0x50, 0x4B, 0x03, 0x04, 0x14 }, false)]
    public void Signature_detection(byte[] content, bool expected) =>
        Assert.Equal(expected, BankReconciliationService.LooksLikePdfOrImage(content));
}
