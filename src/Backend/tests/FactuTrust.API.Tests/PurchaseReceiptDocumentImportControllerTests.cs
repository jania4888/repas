using System.Text;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Application.Features.Products.Queries;
using FactuTrust.Application.Features.PurchaseReceipts.DocumentImport;
using FactuTrust.Application.Features.Suppliers.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// <see cref="PurchaseReceiptDocumentImportController"/> est lu à chaque ouverture de la modale
/// d'import ; elle ne doit jamais toucher la base (voir le plan, section 2) et doit rester
/// indépendante de <c>AccountingSettings.DocumentImportEnabled</c>, qui ne concerne que la
/// comptabilité.
/// </summary>
public sealed class PurchaseReceiptDocumentImportControllerTests
{
    private readonly Mock<IAccountingDocumentExtractor> _extractor = new();
    private readonly Mock<ICompanyRepository> _companies = new();
    private readonly Mock<IPurchaseReceiptRepository> _purchaseReceipts = new();
    private readonly Mock<IWarehouseRepository> _warehouses = new();
    private readonly Mock<ISupplierRepository> _suppliers = new();
    private readonly Mock<IProductRepository> _products = new();
    private readonly Mock<IMediator> _mediator = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<IAuditService> _auditService = new();
    private readonly Mock<IDocumentExtractionProvider> _externalExtraction = new();
    private readonly Mock<IHostEnvironment> _environment = new();

    private ImportPurchaseReceiptFromDocumentHandler BuildHandler()
    {
        _companies.Setup(x => x.GetAllAsync(It.IsAny<CancellationToken>())).ReturnsAsync(Array.Empty<Company>());
        _warehouses.Setup(x => x.GetDefaultAsync(It.IsAny<CancellationToken>())).ReturnsAsync((Warehouse?)null);
        _suppliers.Setup(x => x.GetByNifAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((Supplier?)null);
        _mediator.Setup(x => x.Send(It.IsAny<GetSuppliersQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PagedResult<SupplierListDto> { Items = Array.Empty<SupplierListDto>() });
        _mediator.Setup(x => x.Send(It.IsAny<GetProductsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new PagedResult<ProductListDto> { Items = Array.Empty<ProductListDto>() }));
        _products.Setup(x => x.GetByCodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((Product?)null);
        _products.Setup(x => x.GetByBarcodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((Product?)null);
        _purchaseReceipts.Setup(x => x.ExistsActiveForSupplierDeliveryNoteAsync(
                It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);
        _currentUser.SetupGet(x => x.TenantId).Returns(Guid.NewGuid());
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(true);
        _auditService.Setup(x => x.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(),
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var supplierMatcher = new SupplierDocumentMatcher(_suppliers.Object, _mediator.Object, NullLogger<SupplierDocumentMatcher>.Instance);
        var productMatcher = new ProductLineMatcher(_products.Object, _mediator.Object);

        return new ImportPurchaseReceiptFromDocumentHandler(
            _extractor.Object, _companies.Object, _purchaseReceipts.Object, _warehouses.Object,
            supplierMatcher, productMatcher, _currentUser.Object, _auditService.Object,
            NullLogger<ImportPurchaseReceiptFromDocumentHandler>.Instance, _externalExtraction.Object);
    }

    private PurchaseReceiptDocumentImportController BuildController(bool isDevelopment = false)
    {
        _currentUser.Setup(x => x.IsAccountingFirmDelegatedContext).Returns(false);
        _environment.Setup(x => x.EnvironmentName).Returns(isDevelopment ? "Development" : "Production");
        return new PurchaseReceiptDocumentImportController(
            BuildHandler(), _currentUser.Object, NullLogger<PurchaseReceiptDocumentImportController>.Instance,
            _environment.Object, _externalExtraction.Object);
    }

    private static IFormFile PdfFile(long length = 0)
    {
        var content = Encoding.ASCII.GetBytes("%PDF-1.7\n%âãÏÓ\n1 0 obj");
        if (length > 0)
        {
            var padded = new byte[length];
            Array.Copy(content, padded, Math.Min(content.Length, (int)length));
            content = padded;
        }
        return new FormFile(new MemoryStream(content), 0, content.Length, "file", "bon.pdf")
        {
            Headers = new HeaderDictionary(),
            ContentType = "application/pdf"
        };
    }

    private static IFormFile FileWithContent(byte[] content, string fileName, string contentType) =>
        new FormFile(new MemoryStream(content), 0, content.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType
        };

    private static FactuTrust.API.Controllers.ApiResponse<T> Body<T>(IActionResult result)
    {
        var casted = result switch
        {
            OkObjectResult ok => ok.Value,
            BadRequestObjectResult bad => bad.Value,
            ObjectResult obj => obj.Value,
            _ => throw new InvalidOperationException($"Unexpected result type {result.GetType()}")
        };
        return Assert.IsType<FactuTrust.API.Controllers.ApiResponse<T>>(casted);
    }

    // ---------- Reflection : politiques et limites ----------

    [Fact]
    public void Controller_requires_both_purchase_receipts_create_and_ai_chat_policies()
    {
        var attrs = typeof(PurchaseReceiptDocumentImportController)
            .GetCustomAttributes(typeof(AuthorizeAttribute), inherit: false)
            .Cast<AuthorizeAttribute>()
            .ToList();

        Assert.Contains(attrs, a => a.Policy == PermissionPolicies.PurchaseReceiptsCreate);
        Assert.Contains(attrs, a => a.Policy == PermissionPolicies.AiChat);
    }

    [Fact]
    public void Propose_action_is_rate_limited_and_bounded_in_size()
    {
        var method = typeof(PurchaseReceiptDocumentImportController).GetMethod("Propose")!;

        var rateLimit = method.GetCustomAttributes(typeof(EnableRateLimitingAttribute), inherit: false)
            .Cast<EnableRateLimitingAttribute>().Single();
        Assert.Equal("ai", rateLimit.PolicyName);

        var sizeLimit = method.GetCustomAttributes(typeof(RequestSizeLimitAttribute), inherit: false)
            .Cast<Microsoft.AspNetCore.Http.Metadata.IRequestSizeLimitMetadata>().Single();
        Assert.Equal(PurchaseReceiptDocumentImportController.ImportMaxBytes + 256_000, sizeLimit.MaxRequestBodySize);
    }

    [Fact]
    public void Constructor_has_no_dependency_on_accounting_settings()
    {
        var ctor = typeof(PurchaseReceiptDocumentImportController).GetConstructors().Single();
        Assert.DoesNotContain(ctor.GetParameters(), p => p.ParameterType.Name.Contains("AccountingSettings"));
    }

    // ---------- Propose ----------

    [Fact]
    public async Task Delegated_accounting_firm_context_is_refused_with_403()
    {
        var controller = BuildController();
        _currentUser.Setup(x => x.IsAccountingFirmDelegatedContext).Returns(true);

        var result = await controller.Propose(PdfFile(), CancellationToken.None);

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, obj.StatusCode);
    }

    [Fact]
    public async Task Empty_file_is_rejected()
    {
        var controller = BuildController();

        var result = await controller.Propose(FileWithContent(Array.Empty<byte>(), "bon.pdf", "application/pdf"), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Oversized_file_is_rejected_without_reading_it()
    {
        var controller = BuildController();
        var tooLarge = new Mock<IFormFile>();
        tooLarge.SetupGet(f => f.Length).Returns(PurchaseReceiptDocumentImportController.ImportMaxBytes + 1);

        var result = await controller.Propose(tooLarge.Object, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
        tooLarge.Verify(f => f.OpenReadStream(), Times.Never);
    }

    [Fact]
    public async Task Pdf_extension_with_executable_content_is_rejected_on_magic_bytes()
    {
        var controller = BuildController();
        var exeContent = Encoding.ASCII.GetBytes("MZ-this-is-not-a-pdf-file-content");

        var result = await controller.Propose(FileWithContent(exeContent, "bon.pdf", "application/pdf"), CancellationToken.None);

        var body = Body<object>(result);
        Assert.False(body.Success);
    }

    [Fact]
    public async Task Webp_is_refused_even_though_the_general_upload_validator_would_allow_it()
    {
        var controller = BuildController();
        var webp = Encoding.ASCII.GetBytes("RIFF....WEBPVP8 ...................");

        var result = await controller.Propose(FileWithContent(webp, "image.webp", "image/webp"), CancellationToken.None);

        var body = Body<object>(result);
        Assert.False(body.Success);
        Assert.Contains("PDF, JPEG ou PNG", body.Error);
    }

    [Fact]
    public async Task Double_extension_is_rejected()
    {
        var controller = BuildController();

        var result = await controller.Propose(PdfFile(), CancellationToken.None);
        // La double extension est testée via UploadValidator directement ; ici on confirme qu'un
        // nom suspect est bien refusé par le même mécanisme que l'upload de pièce jointe.
        var suspicious = FileWithContent(Encoding.ASCII.GetBytes("%PDF-1.7 header padding 1234567"), "facture.pdf.exe", "application/pdf");

        var suspiciousResult = await controller.Propose(suspicious, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(suspiciousResult);
    }

    [Fact]
    public async Task Valid_pdf_calls_the_handler_once_and_returns_200()
    {
        var controller = BuildController();
        _extractor.Setup(x => x.ExtractAsync(It.IsAny<AccountingDocumentExtractionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new AccountingDocumentExtractionDto
            {
                Seller = new ExtractedPartyDto { Name = "Fournisseur Test" },
                Lines = Array.Empty<ExtractedLineDto>()
            }));

        var result = await controller.Propose(PdfFile(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<PurchaseReceiptImportProposalDto>>(ok.Value);
        Assert.True(body.Success);
        _extractor.Verify(
            x => x.ExtractAsync(It.IsAny<AccountingDocumentExtractionRequest>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Ollama_exception_surfaces_its_user_message()
    {
        var controller = BuildController();
        _extractor.Setup(x => x.ExtractAsync(It.IsAny<AccountingDocumentExtractionRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new OllamaRequestException("Le moteur IA local est indisponible."));

        var result = await controller.Propose(PdfFile(), CancellationToken.None);

        var body = Body<object>(result);
        Assert.Equal("Le moteur IA local est indisponible.", body.Error);
    }

    [Fact]
    public async Task Generic_exception_outside_development_never_leaks_the_raw_message()
    {
        var controller = BuildController(isDevelopment: false);
        _extractor.Setup(x => x.ExtractAsync(It.IsAny<AccountingDocumentExtractionRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("Secret internal detail: connection string xyz"));

        var result = await controller.Propose(PdfFile(), CancellationToken.None);

        var body = Body<object>(result);
        Assert.DoesNotContain("Secret internal detail", body.Error);
        Assert.DoesNotContain("connection string", body.Error);
    }

    [Fact]
    public async Task Generic_exception_in_development_surfaces_the_raw_message()
    {
        var controller = BuildController(isDevelopment: true);
        _extractor.Setup(x => x.ExtractAsync(It.IsAny<AccountingDocumentExtractionRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("Detail utile en dev"));

        var result = await controller.Propose(PdfFile(), CancellationToken.None);

        var body = Body<object>(result);
        Assert.Equal("Detail utile en dev", body.Error);
    }

    // ---------- Capabilities ----------

    [Fact]
    public async Task Capabilities_never_exposes_urls_keys_or_secrets()
    {
        var controller = BuildController();
        _externalExtraction.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(false);

        var result = await controller.GetCapabilities(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<PurchaseReceiptImportCapabilitiesDto>>(ok.Value);
        var props = typeof(PurchaseReceiptImportCapabilitiesDto).GetProperties();
        Assert.DoesNotContain(props, p =>
            p.Name.EndsWith("Url", StringComparison.OrdinalIgnoreCase) ||
            p.Name.EndsWith("Key", StringComparison.OrdinalIgnoreCase) ||
            p.Name.EndsWith("Secret", StringComparison.OrdinalIgnoreCase));
        Assert.Equal("llm", body.Data!.ExtractionProvider);
    }

    [Fact]
    public async Task Capabilities_reports_docstrange_when_the_external_provider_is_available()
    {
        var controller = BuildController();
        _externalExtraction.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);

        var result = await controller.GetCapabilities(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<PurchaseReceiptImportCapabilitiesDto>>(ok.Value);
        Assert.Equal("docstrange", body.Data!.ExtractionProvider);
    }
}
