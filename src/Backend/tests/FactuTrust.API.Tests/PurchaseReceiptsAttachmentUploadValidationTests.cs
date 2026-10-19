using FactuTrust.API.Controllers;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// <see cref="PurchaseReceiptsController.UploadAttachment"/> doit refuser un fichier dont le
/// contenu ne correspond pas à son extension déclarée (double extension, octets magiques) avant
/// toute écriture disque — voir le plan, section « hardening » (réutilise <c>UploadValidator</c>,
/// comme <c>PurchaseReceiptDocumentImportController</c>).
/// </summary>
public sealed class PurchaseReceiptsAttachmentUploadValidationTests : IDisposable
{
    private readonly string _basePath = Path.Combine(Path.GetTempPath(), "factutrust-tests", Guid.NewGuid().ToString("N"));
    private readonly Mock<IMediator> _mediator = new();
    private readonly Mock<IPurchaseReceiptRepository> _purchaseReceipts = new();
    private readonly Mock<IAuditService> _auditService = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<IWebHostEnvironment> _environment = new();

    public void Dispose()
    {
        if (Directory.Exists(_basePath))
            Directory.Delete(_basePath, recursive: true);
    }

    private PurchaseReceiptsController BuildController()
    {
        var configValues = new Dictionary<string, string?> { ["AccountingAttachments:BasePath"] = _basePath };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(configValues).Build();
        _currentUser.SetupGet(x => x.Email).Returns("test@example.com");
        _auditService.Setup(x => x.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(),
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        return new PurchaseReceiptsController(
            _mediator.Object, _purchaseReceipts.Object, _auditService.Object, _currentUser.Object,
            configuration, _environment.Object, NullLogger<PurchaseReceiptsController>.Instance);
    }

    private static PurchaseReceipt NewReceipt()
    {
        var address = FactuTrust.Domain.ValueObjects.Address.Create("Rue X", "Tunis", "Tunis").Value;
        var supplier = Supplier.Create(
            "Fournisseur Test", SupplierType.Business, address,
            Email.Create("f@example.com").Value, NIF.Create("1772793W/A/M/000").Value).Value;
        var warehouse = Warehouse.Create("WH-1", "Entrepot Principal").Value;
        var number = PurchaseReceiptNumber.Create("BR", 2026, 1);
        return PurchaseReceipt.Create(number, supplier, warehouse, DateTime.UtcNow).Value;
    }

    private static IFormFile FileWithContent(byte[] content, string fileName, string contentType) =>
        new FormFile(new MemoryStream(content), 0, content.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType
        };

    [Fact]
    public async Task Png_extension_with_pdf_content_is_rejected_without_writing_to_disk()
    {
        var receipt = NewReceipt();
        _purchaseReceipts.Setup(x => x.GetByIdWithDetailsAsync(receipt.Id, It.IsAny<CancellationToken>())).ReturnsAsync(receipt);
        var controller = BuildController();
        var pdfBytes = System.Text.Encoding.ASCII.GetBytes("%PDF-1.7 header padding padding12");

        var result = await controller.UploadAttachment(
            receipt.Id, FileWithContent(pdfBytes, "image.png", "image/png"), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.False(Directory.Exists(_basePath) && Directory.EnumerateFiles(_basePath, "*", SearchOption.AllDirectories).Any());
        _purchaseReceipts.Verify(x => x.UpdateAsync(It.IsAny<PurchaseReceipt>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Valid_png_is_accepted_stored_and_audited()
    {
        var receipt = NewReceipt();
        _purchaseReceipts.Setup(x => x.GetByIdWithDetailsAsync(receipt.Id, It.IsAny<CancellationToken>())).ReturnsAsync(receipt);
        _purchaseReceipts.Setup(x => x.UpdateAsync(It.IsAny<PurchaseReceipt>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        var controller = BuildController();
        // Signature PNG minimale (8 octets) suivie de remplissage pour atteindre RequiredHeaderBytes.
        var pngBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0 };

        var result = await controller.UploadAttachment(
            receipt.Id, FileWithContent(pngBytes, "photo.png", "image/png"), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.IsType<FactuTrust.API.Controllers.ApiResponse<Guid>>(ok.Value);
        Assert.True(Directory.Exists(_basePath));
        Assert.Single(Directory.EnumerateFiles(_basePath, "*", SearchOption.AllDirectories));
        _auditService.Verify(x => x.LogAsync(
            It.Is<string>(a => a.Contains("Attachment")), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }
}
