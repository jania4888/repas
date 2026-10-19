using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Application.Features.Products.Queries;
using FactuTrust.Application.Features.PurchaseReceipts.DocumentImport;
using FactuTrust.Application.Features.Suppliers.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PurchaseReceipts.DocumentImport;

public sealed class ImportPurchaseReceiptFromDocumentHandlerTests
{
    private const string OurNif = "1772793W/A/M/000";
    private const string SupplierNif = "9876543X/A/M/000";

    private sealed class Harness
    {
        public Mock<IAccountingDocumentExtractor> Extractor { get; } = new(MockBehavior.Strict);
        public Mock<ICompanyRepository> Companies { get; } = new();
        public Mock<IPurchaseReceiptRepository> PurchaseReceipts { get; } = new();
        public Mock<IWarehouseRepository> Warehouses { get; } = new();
        public Mock<ISupplierRepository> Suppliers { get; } = new();
        public Mock<IProductRepository> Products { get; } = new();
        public Mock<IMediator> Mediator { get; } = new();
        public Mock<ICurrentUser> CurrentUser { get; } = new();
        public Mock<IAuditService> AuditService { get; } = new();
        public Mock<IDocumentExtractionProvider> ExternalExtraction { get; } = new();

        public Harness()
        {
            Companies.Setup(x => x.GetAllAsync(It.IsAny<CancellationToken>()))
                .ReturnsAsync(Array.Empty<Company>());
            Warehouses.Setup(x => x.GetDefaultAsync(It.IsAny<CancellationToken>()))
                .ReturnsAsync((Warehouse?)null);
            Suppliers.Setup(x => x.GetByNifAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Supplier?)null);
            Mediator.Setup(x => x.Send(It.IsAny<GetSuppliersQuery>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new PagedResult<SupplierListDto> { Items = Array.Empty<SupplierListDto>() });
            Mediator.Setup(x => x.Send(It.IsAny<GetProductsQuery>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Result.Success(new PagedResult<ProductListDto> { Items = Array.Empty<ProductListDto>() }));
            Products.Setup(x => x.GetByCodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Product?)null);
            Products.Setup(x => x.GetByBarcodeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((Product?)null);
            PurchaseReceipts.Setup(x => x.ExistsActiveForSupplierDeliveryNoteAsync(
                    It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(false);
            CurrentUser.SetupGet(x => x.TenantId).Returns(Guid.NewGuid());
            CurrentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(true);
            AuditService.Setup(x => x.LogAsync(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(),
                    It.IsAny<CancellationToken>()))
                .Returns(Task.CompletedTask);
            ExternalExtraction.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(false);
        }

        public ImportPurchaseReceiptFromDocumentHandler Build(bool withExternalExtraction = true)
        {
            var supplierMatcher = new SupplierDocumentMatcher(Suppliers.Object, Mediator.Object, NullLogger<SupplierDocumentMatcher>.Instance);
            var productMatcher = new ProductLineMatcher(Products.Object, Mediator.Object);

            return new ImportPurchaseReceiptFromDocumentHandler(
                Extractor.Object,
                Companies.Object,
                PurchaseReceipts.Object,
                Warehouses.Object,
                supplierMatcher,
                productMatcher,
                CurrentUser.Object,
                AuditService.Object,
                NullLogger<ImportPurchaseReceiptFromDocumentHandler>.Instance,
                withExternalExtraction ? ExternalExtraction.Object : null);
        }

        public void SetupExtraction(AccountingDocumentExtractionDto doc) =>
            Extractor
                .Setup(x => x.ExtractAsync(It.IsAny<AccountingDocumentExtractionRequest>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Result.Success(doc));

        public void SetupExtractionFailure(Error error) =>
            Extractor
                .Setup(x => x.ExtractAsync(It.IsAny<AccountingDocumentExtractionRequest>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Result.Failure<AccountingDocumentExtractionDto>(error));
    }

    private static ImportPurchaseReceiptFromDocumentCommand NewCommand() =>
        new(new MemoryStream(new byte[] { 1, 2, 3 }), "bon.pdf", "application/pdf");

    private static ExtractedLineDto NewLine(
        string designation = "Produit Test", string? reference = "PROD-1", int vatRatePercent = 19,
        decimal unitPriceHt = 100m, decimal quantity = 1m, decimal? discountPercent = null, decimal? lineTotalHt = null) =>
        new()
        {
            Designation = designation,
            Reference = reference,
            Quantity = quantity,
            UnitPriceHt = unitPriceHt,
            DiscountPercent = discountPercent,
            VatRatePercent = vatRatePercent,
            LineTotalHt = lineTotalHt
        };

    private static AccountingDocumentExtractionDto NewDoc(
        string documentType = "INVOICE",
        string? documentNumber = "BL-2026-001",
        ExtractedPartyDto? seller = null,
        ExtractedPartyDto? buyer = null,
        IReadOnlyList<ExtractedLineDto>? lines = null,
        string extractionMethod = "native-pdf",
        string currency = "TND",
        DateOnly? issueDate = null,
        decimal? totalHt = null,
        decimal? totalVat = null,
        decimal? totalTtc = null,
        decimal? fiscalStampAmount = null,
        decimal? fodecAmount = null) =>
        new()
        {
            DocumentType = documentType,
            DocumentNumber = documentNumber,
            IssueDate = issueDate ?? new DateOnly(2026, 10, 1),
            Currency = currency,
            Seller = seller ?? new ExtractedPartyDto { Name = "Fournisseur Test", Nif = SupplierNif },
            Buyer = buyer,
            Lines = lines ?? new[] { NewLine() },
            ExtractionMethod = extractionMethod,
            TotalHt = totalHt,
            TotalVat = totalVat,
            TotalTtc = totalTtc,
            FiscalStampAmount = fiscalStampAmount,
            FodecAmount = fodecAmount
        };

    private static Company NewCompany(string name = "Ma Societe", string nif = OurNif)
    {
        var address = FactuTrust.Domain.ValueObjects.Address.Create("Avenue Habib Bourguiba", "Tunis", "Tunis").Value;
        return Company.Create(name, address, NIF.Create(nif).Value, Email.Create("contact@example.com").Value).Value;
    }

    // ---------- Fournisseur d'extraction ----------

    [Fact]
    public async Task External_extraction_reports_the_external_provider_name()
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc(extractionMethod: AccountingDocumentExtractionMethods.ExternalExtraction));
        harness.ExternalExtraction.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(true);
        harness.ExternalExtraction.SetupGet(x => x.Name).Returns("docstrange");
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("docstrange", result.Value.ExtractionProvider);
    }

    [Theory]
    [InlineData("native-pdf")]
    [InlineData("llm-text")]
    [InlineData("llm-vision")]
    public async Task Non_external_extraction_methods_pass_through_unchanged(string method)
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc(extractionMethod: method));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Equal(method, result.Value.ExtractionProvider);
    }

    [Fact]
    public async Task Handler_constructor_has_no_dependency_on_the_ai_structured_extraction_pipeline()
    {
        var ctor = typeof(ImportPurchaseReceiptFromDocumentHandler).GetConstructors().Single();
        Assert.DoesNotContain(ctor.GetParameters(), p => p.ParameterType.Name.Contains("AiStructuredExtractionPipeline"));
    }

    [Fact]
    public async Task Extraction_failure_propagates_the_error_without_writing_any_audit()
    {
        var harness = new Harness();
        harness.SetupExtractionFailure(Error.Validation("Extraction", "Document illisible."));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Extraction", result.Error.Code);
        harness.AuditService.Verify(x => x.LogAsync(
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Tenant_absent_fails_before_calling_the_extractor()
    {
        var harness = new Harness();
        harness.CurrentUser.SetupGet(x => x.TenantId).Returns((Guid?)null);
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.True(result.IsFailure);
        harness.Extractor.Verify(
            x => x.ExtractAsync(It.IsAny<AccountingDocumentExtractionRequest>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---------- Partie fournisseur ----------

    [Fact]
    public async Task No_company_registered_takes_the_seller_without_exception()
    {
        var harness = new Harness();
        var seller = new ExtractedPartyDto { Name = "Fournisseur Sans Societe", Nif = SupplierNif };
        harness.SetupExtraction(NewDoc(seller: seller));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Fournisseur Sans Societe", result.Value.Supplier.ExtractedName);
        Assert.DoesNotContain(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.PartiesSwapped);
    }

    [Fact]
    public async Task Seller_matching_the_company_nif_swaps_to_the_buyer()
    {
        var harness = new Harness();
        harness.Companies.Setup(x => x.GetAllAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new[] { NewCompany() });
        var seller = new ExtractedPartyDto { Name = "Ma Societe", Nif = OurNif };
        var buyer = new ExtractedPartyDto { Name = "Fournisseur Reel", Nif = SupplierNif };
        harness.SetupExtraction(NewDoc(seller: seller, buyer: buyer));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Equal("Fournisseur Reel", result.Value.Supplier.ExtractedName);
        Assert.Contains(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.PartiesSwapped);
    }

    [Fact]
    public async Task Seller_matching_the_company_by_name_only_also_swaps_to_the_buyer()
    {
        var harness = new Harness();
        harness.Companies.Setup(x => x.GetAllAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new[] { NewCompany("Ma Societe SARL") });
        var seller = new ExtractedPartyDto { Name = "Ma Societe SARL" }; // pas de NIF imprimé
        var buyer = new ExtractedPartyDto { Name = "Fournisseur Reel", Nif = SupplierNif };
        harness.SetupExtraction(NewDoc(seller: seller, buyer: buyer));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Equal("Fournisseur Reel", result.Value.Supplier.ExtractedName);
        Assert.Contains(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.PartiesSwapped);
    }

    [Fact]
    public async Task Both_parties_matching_the_company_results_in_missing_supplier_without_proposing_the_company()
    {
        var harness = new Harness();
        harness.Companies.Setup(x => x.GetAllAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new[] { NewCompany() });
        var seller = new ExtractedPartyDto { Name = "Ma Societe", Nif = OurNif };
        var buyer = new ExtractedPartyDto { Name = "Ma Societe", Nif = OurNif };
        harness.SetupExtraction(NewDoc(seller: seller, buyer: buyer));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Equal(SupplierMatchOutcome.Missing.ToString(), result.Value.Supplier.MatchOutcome);
        Assert.Null(result.Value.Supplier.ExtractedName);
        Assert.Contains(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.SupplierNotFoundInDocument);
    }

    // ---------- Lignes ----------

    [Fact]
    public async Task More_than_fifty_lines_marks_the_overflow_as_skipped_with_a_single_warning()
    {
        var harness = new Harness();
        var lines = Enumerable.Range(1, 55).Select(i => NewLine(reference: $"PROD-{i}")).ToArray();
        harness.SetupExtraction(NewDoc(lines: lines));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Equal(55, result.Value.Lines.Count);
        Assert.All(result.Value.Lines.Skip(50), l => Assert.Equal("skipped", l.MatchMethod));
        Assert.Single(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.TooManyLines);
    }

    // ---------- Totaux ----------

    [Fact]
    public async Task Total_ht_discrepancy_above_one_percent_raises_a_warning()
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc(lines: new[] { NewLine(unitPriceHt: 100m, quantity: 1m) }, totalHt: 150m));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Contains(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.TotalHtMismatch);
    }

    [Fact]
    public async Task Total_ht_discrepancy_within_one_percent_raises_no_warning()
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc(lines: new[] { NewLine(unitPriceHt: 100m, quantity: 1m) }, totalHt: 100.5m));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.DoesNotContain(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.TotalHtMismatch);
    }

    [Fact]
    public async Task Fiscal_stamp_is_signalled_and_excluded_from_the_expected_totals()
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc(
            lines: new[] { NewLine(unitPriceHt: 100m, quantity: 1m) },
            fiscalStampAmount: 1.000m));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Contains(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.FiscalStampNotApplied);
        Assert.Contains("Timbre fiscal", result.Value.Header.SuggestedNotes);
        // 100 HT + 19% TVA = 119, sans le timbre.
        Assert.Equal(119.000m, result.Value.ExpectedReceiptTotals.TotalAmount);
    }

    [Fact]
    public async Task Total_ttc_mismatch_accounts_for_the_stamp_and_fodec()
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc(
            lines: new[] { NewLine(unitPriceHt: 100m, quantity: 1m) },
            totalHt: 100m, totalVat: 19m, fodecAmount: 1m, fiscalStampAmount: 1m, totalTtc: 999m));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Contains(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.TotalTtcMismatch);
    }

    // ---------- TVA ----------

    [Fact]
    public async Task Product_vat_rate_overrides_the_extracted_rate_and_feeds_the_expected_totals()
    {
        var harness = new Harness();
        var product = Product.Create(
            "PROD-1", "Produit Standard", ProductType.Product, Money.Create(100m), VatRate.Standard, Guid.NewGuid(),
            isStockManaged: true).Value;
        harness.Products.Setup(x => x.GetByCodeAsync("PROD-1", It.IsAny<CancellationToken>())).ReturnsAsync(product);
        harness.SetupExtraction(NewDoc(lines: new[] { NewLine(reference: "PROD-1", vatRatePercent: 7, unitPriceHt: 100m, quantity: 1m) }));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        var line = Assert.Single(result.Value.Lines);
        Assert.True(line.VatMismatch);
        Assert.Equal(19m, line.ProductVatRatePercent);
        Assert.Equal(119.000m, result.Value.ExpectedReceiptTotals.TotalAmount);
    }

    // ---------- Bornes ----------

    [Fact]
    public async Task Discount_out_of_range_is_dropped_and_signalled()
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc(lines: new[] { NewLine(discountPercent: 120m) }));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        var line = Assert.Single(result.Value.Lines);
        Assert.Null(line.DiscountPercent);
        Assert.Contains(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.DiscountOutOfRange);
    }

    [Fact]
    public async Task Zero_quantity_is_signalled()
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc(lines: new[] { NewLine(quantity: 0m) }));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Contains(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.QuantityInvalid);
    }

    [Fact]
    public async Task Currency_other_than_tnd_is_signalled()
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc(currency: "EUR"));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Contains(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.CurrencyNotTnd);
    }

    // ---------- En-tête ----------

    [Fact]
    public async Task Delivery_note_document_type_fills_the_delivery_note_number()
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc(documentType: DocumentTypes.DeliveryNote, documentNumber: "BL-42"));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Equal("BL-42", result.Value.Header.DeliveryNoteNumber);
        Assert.Null(result.Value.Header.SupplierReference);
    }

    [Fact]
    public async Task Invoice_document_type_fills_the_supplier_reference()
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc(documentType: DocumentTypes.Invoice, documentNumber: "FA-42"));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Equal("FA-42", result.Value.Header.SupplierReference);
        Assert.Null(result.Value.Header.DeliveryNoteNumber);
    }

    [Fact]
    public async Task Long_document_number_is_truncated_to_one_hundred_characters()
    {
        var harness = new Harness();
        var longNumber = new string('9', 150);
        harness.SetupExtraction(NewDoc(documentNumber: longNumber));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Equal(100, result.Value.Header.SupplierReference!.Length);
    }

    [Fact]
    public async Task Future_issue_date_more_than_one_day_ahead_is_dropped_with_a_warning()
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc(issueDate: DateOnly.FromDateTime(DateTime.UtcNow.AddDays(10))));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Null(result.Value.Header.ReceiptDate);
        Assert.Contains(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.Extraction && w.Message.Contains("futur"));
    }

    // ---------- Doublon ----------

    [Fact]
    public async Task Matched_supplier_with_existing_delivery_note_raises_a_possible_duplicate_warning()
    {
        var harness = new Harness();
        var supplier = Supplier.Create(
            "Fournisseur Doublon", SupplierType.Business,
            FactuTrust.Domain.ValueObjects.Address.Create("Rue X", "Tunis", "Tunis").Value,
            Email.Create("f@example.com").Value, NIF.Create(SupplierNif).Value).Value;
        harness.Suppliers.Setup(x => x.GetByNifAsync(SupplierNif, It.IsAny<CancellationToken>())).ReturnsAsync(supplier);
        harness.PurchaseReceipts.Setup(x => x.ExistsActiveForSupplierDeliveryNoteAsync(
                supplier.Id, "BL-2026-001", It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        harness.SetupExtraction(NewDoc(documentType: DocumentTypes.DeliveryNote, documentNumber: "BL-2026-001"));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Contains(result.Value.Warnings, w => w.Code == PurchaseReceiptImportWarningCodes.PossibleDuplicate);
    }

    [Fact]
    public async Task Without_a_matched_supplier_the_duplicate_check_is_never_called()
    {
        var harness = new Harness();
        // Aucun fournisseur rapproché : GetByNifAsync et la recherche par nom renvoient tous les deux vide.
        harness.SetupExtraction(NewDoc(documentType: DocumentTypes.DeliveryNote, documentNumber: "BL-2026-001"));
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Null(result.Value.Supplier.SupplierId);
        harness.PurchaseReceipts.Verify(x => x.ExistsActiveForSupplierDeliveryNoteAsync(
            It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---------- Permissions ----------

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public async Task Permissions_reflect_the_current_user(bool canCreate, bool expected)
    {
        var harness = new Harness();
        harness.CurrentUser.Setup(x => x.HasPermission(Permissions.Suppliers.Create)).Returns(canCreate);
        harness.CurrentUser.Setup(x => x.HasPermission(Permissions.Products.Create)).Returns(canCreate);
        harness.CurrentUser.Setup(x => x.HasPermission(Permissions.AI.Chat)).Returns(true);
        harness.SetupExtraction(NewDoc());
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.Equal(expected, result.Value.CanCreateSupplier);
        Assert.Equal(expected, result.Value.CanCreateProduct);
    }

    // ---------- Audit ----------

    [Fact]
    public async Task Audit_is_written_with_the_document_analyzed_action()
    {
        var harness = new Harness();
        harness.SetupExtraction(NewDoc());
        var handler = harness.Build();

        await handler.HandleAsync(NewCommand(), CancellationToken.None);

        harness.AuditService.Verify(x => x.LogAsync(
            "PurchaseReceipt.DocumentAnalyzed", "PurchaseReceipt", null, null, It.IsAny<object?>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Audit_exception_does_not_fail_the_result()
    {
        var harness = new Harness();
        harness.AuditService.Setup(x => x.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("boom"));
        harness.SetupExtraction(NewDoc());
        var handler = harness.Build();

        var result = await handler.HandleAsync(NewCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess);
    }
}
