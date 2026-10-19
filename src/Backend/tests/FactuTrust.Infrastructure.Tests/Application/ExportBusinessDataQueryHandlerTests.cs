using System.Text.Json;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class ExportBusinessDataQueryHandlerTests
{
    private const string HostileSearch = "../facture;evil";

    [Fact]
    public async Task Handle_ReturnsTooManyRows_WithoutBuildingOrAuditing()
    {
        var clients = new Mock<IClientRepository>();
        clients.Setup(c => c.ListForExportAsync(
                It.IsAny<string?>(), It.IsAny<ClientType?>(), It.IsAny<bool?>(), It.IsAny<string?>(),
                It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(CountedRows<ClientExportRow>.Over(20_001));
        var invoices = new Mock<IInvoiceRepository>();
        var workbook = new Mock<IBusinessExcelWorkbookBuilder>();
        var audit = new Mock<IAuditService>();
        var handler = CreateDatasetHandler(clients.Object, invoices.Object, workbook.Object, audit);

        var result = await handler.Handle(
            new ExportBusinessDatasetQuery(BusinessDataset.Clients, new BusinessExportCriteria { Search = HostileSearch }),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(BusinessDataExportErrors.TooManyRows, result.Error.Code);
        Assert.Contains("Clients", result.Error.Description);
        Assert.Contains("20001", result.Error.Description);
        workbook.Verify(w => w.Build(It.IsAny<BusinessWorkbookModel>()), Times.Never);
        audit.Verify(a => a.LogAsync(
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(),
            It.IsAny<CancellationToken>()), Times.Never);
        invoices.Verify(i => i.ListForExportAsync(
            It.IsAny<string?>(), It.IsAny<InvoiceStatus?>(), It.IsAny<DateTime?>(), It.IsAny<DateTime?>(),
            It.IsAny<Guid?>(), It.IsAny<bool>(), It.IsAny<InvoiceType?>(), It.IsAny<bool>(),
            It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_EmptyClients_WritesHeaders_AndKeepsSearchOutOfTheFile()
    {
        var clients = new Mock<IClientRepository>();
        clients.Setup(c => c.ListForExportAsync(
                HostileSearch, null, null, null, BusinessDataExportLimits.Masters, It.IsAny<CancellationToken>()))
            .ReturnsAsync(CountedRows<ClientExportRow>.Ready(Array.Empty<ClientExportRow>()));
        var invoices = new Mock<IInvoiceRepository>();
        object? audited = null;
        var audit = AuditCapturing(value => audited = value);
        var handler = CreateDatasetHandler(clients.Object, invoices.Object, new BusinessExcelWorkbookBuilder(), audit);

        var result = await handler.Handle(
            new ExportBusinessDatasetQuery(BusinessDataset.Clients, new BusinessExportCriteria { Search = HostileSearch }),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Matches(@"^Clients_\d{8}_\d{4}\.xlsx$", result.Value.FileName);
        Assert.DoesNotContain("evil", result.Value.FileName, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("facture", result.Value.FileName, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("..", result.Value.FileName);

        using var workbook = Open(result.Value.Content);
        var sheet = workbook.Worksheet("Clients");
        Assert.Equal("Code", sheet.Cell(1, 1).GetString());
        Assert.Equal("Identifiant", sheet.Row(1).LastCellUsed()!.GetString());
        Assert.Equal(1, sheet.LastRowUsed()!.RowNumber());
        Assert.NotNull(workbook.Worksheet("Sommaire"));

        var json = JsonSerializer.Serialize(audited);
        Assert.DoesNotContain("evil", json, StringComparison.OrdinalIgnoreCase);
        clients.Verify(c => c.ListForExportAsync(
            HostileSearch, null, null, null, BusinessDataExportLimits.Masters, It.IsAny<CancellationToken>()), Times.Once);
        invoices.Verify(i => i.ListForExportAsync(
            It.IsAny<string?>(), It.IsAny<InvoiceStatus?>(), It.IsAny<DateTime?>(), It.IsAny<DateTime?>(),
            It.IsAny<Guid?>(), It.IsAny<bool>(), It.IsAny<InvoiceType?>(), It.IsAny<bool>(),
            It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_CreditNote_WritesNegativeAmount_AndLinkedInvoice()
    {
        var id = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        var row = new InvoiceExportRow(
            id, "AVO-1", InvoiceType.CreditNote, new DateTime(2026, 10, 1), null, InvoiceStatus.Validated,
            "Client", -100m, -19m, -119m, 0m, null, null, null, null, "FAC-2026-0001", null);
        var invoices = new Mock<IInvoiceRepository>();
        invoices.Setup(i => i.ListForExportAsync(
                It.IsAny<string?>(), It.IsAny<InvoiceStatus?>(), It.IsAny<DateTime?>(), It.IsAny<DateTime?>(),
                It.IsAny<Guid?>(), true, InvoiceType.CreditNote, false,
                BusinessDataExportLimits.Documents, BusinessDataExportLimits.Lines, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HeaderLinesPaymentsExportData<InvoiceExportRow, InvoiceLineExportRow, InvoicePaymentExportRow>(
                1, 0, 0, new[] { row }, Array.Empty<InvoiceLineExportRow>(), Array.Empty<InvoicePaymentExportRow>()));
        var handler = CreateDatasetHandler(
            Mock.Of<IClientRepository>(), invoices.Object, new BusinessExcelWorkbookBuilder(), new Mock<IAuditService>(),
            BusinessDatasetCatalog.Permission(BusinessDataset.Invoices));

        var result = await handler.Handle(
            new ExportBusinessDatasetQuery(
                BusinessDataset.CreditNotes,
                new BusinessExportCriteria { UnpaidOnly = true, DocumentType = InvoiceType.CreditNote }),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.StartsWith("Avoirs_", result.Value.FileName);
        using var workbook = Open(result.Value.Content);
        var sheet = workbook.Worksheet("Avoirs");
        Assert.Equal("Avoir", Text(sheet, "Type", 2));
        Assert.Equal(-119m, sheet.Cell(2, Column(sheet, "Total TTC")).GetValue<decimal>());
        Assert.Equal("FAC-2026-0001", Text(sheet, "Facture liée", 2));
        invoices.Verify(i => i.ListForExportAsync(
            It.IsAny<string?>(), It.IsAny<InvoiceStatus?>(), It.IsAny<DateTime?>(), It.IsAny<DateTime?>(),
            It.IsAny<Guid?>(), true, InvoiceType.CreditNote, false,
            BusinessDataExportLimits.Documents, BusinessDataExportLimits.Lines, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Bundle_OmitsInvoices_WithoutPermission_AndIncludesThemWithPermission()
    {
        var clients = ReadyClients();
        var invoices = ReadyInvoices();
        var denied = CreateBundleHandler(clients.Object, invoices.Object, new BusinessExcelWorkbookBuilder(), new Mock<IAuditService>(),
            BusinessDatasetCatalog.Permission(BusinessDataset.Clients));

        var hidden = await denied.Handle(BundleRequest(), CancellationToken.None);

        Assert.True(hidden.IsSuccess);
        using (var workbook = Open(hidden.Value.Content))
        {
            Assert.Null(workbook.Worksheets.FirstOrDefault(sheet => sheet.Name == "Factures"));
            Assert.NotNull(workbook.Worksheet("Clients"));
        }
        invoices.Verify(i => i.ListForExportAsync(
            It.IsAny<string?>(), It.IsAny<InvoiceStatus?>(), It.IsAny<DateTime?>(), It.IsAny<DateTime?>(),
            It.IsAny<Guid?>(), It.IsAny<bool>(), It.IsAny<InvoiceType?>(), It.IsAny<bool>(),
            It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);

        var allowedInvoices = ReadyInvoices();
        var allowed = CreateBundleHandler(ReadyClients().Object, allowedInvoices.Object, new BusinessExcelWorkbookBuilder(), new Mock<IAuditService>(),
            BusinessDatasetCatalog.Permission(BusinessDataset.Clients),
            BusinessDatasetCatalog.Permission(BusinessDataset.Invoices));
        var shown = await allowed.Handle(BundleRequest(), CancellationToken.None);

        Assert.True(shown.IsSuccess);
        using var granted = Open(shown.Value.Content);
        Assert.NotNull(granted.Worksheet("Factures"));
        allowedInvoices.Verify(i => i.ListForExportAsync(
            It.IsAny<string?>(), It.IsAny<InvoiceStatus?>(), It.IsAny<DateTime?>(), It.IsAny<DateTime?>(),
            It.IsAny<Guid?>(), false, InvoiceType.Standard, false,
            BusinessDataExportLimits.Documents, BusinessDataExportLimits.Lines, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData("=cmd")]
    [InlineData("+cmd")]
    [InlineData("-cmd")]
    [InlineData("@cmd")]
    [InlineData("\tcmd")]
    public void FormulaGuard_PrefixesDangerousText_AndWorkbookNeverStoresAFormula(string value)
    {
        Assert.Equal("'" + value, ExcelFormulaGuard.Apply(value));

        var bytes = new BusinessExcelWorkbookBuilder().Build(new BusinessWorkbookModel(
            "Export_20261016_1430.xlsx",
            "Entreprise",
            "ada@example.com",
            new DateTime(2026, 10, 16, 14, 30, 0),
            "Aucun filtre de période ou de statut",
            new[]
            {
                new ExcelSheetModel(
                    "Notes",
                    new[] { new ExcelColumn("Texte", ExcelColumnFormat.Text) },
                    new[] { (IReadOnlyList<ExcelValue>)new[] { ExcelValue.FromText(value) } })
            }));

        using var workbook = Open(bytes);
        var cell = workbook.Worksheet("Notes").Cell(2, 1);
        Assert.False(cell.HasFormula);
        Assert.Equal(value, cell.GetString());
        Assert.True(cell.Style.IncludeQuotePrefix);
    }

    [Fact]
    public void FileName_DropsPathCharacters()
    {
        var name = BusinessExportFileName.Build("../Clients;evil", new DateTime(2026, 10, 16, 14, 30, 0));
        Assert.Equal("Clientsevil_20261016_1430.xlsx", name);
        Assert.DoesNotMatch(new Regex(@"[\\/]"), name);
    }

    private static readonly string PurchaseReceiptsRead = BusinessDatasetCatalog.Permission(BusinessDataset.PurchaseReceipts);

    [Fact]
    public async Task PurchaseReceipts_Empty_WritesBothSheetsWithExactHeaders_AndKeepsSearchPrivate()
    {
        var supplierId = Guid.NewGuid();
        var purchaseOrderId = Guid.NewGuid();
        var from = new DateTime(2026, 1, 1);
        var to = new DateTime(2026, 3, 31);
        var receipts = ReadyReceipts(Array.Empty<PurchaseReceiptExportRow>(), Array.Empty<PurchaseReceiptLineExportRow>());
        object? audited = null;
        var handler = ReceiptDatasetHandler(receipts.Object, new BusinessExcelWorkbookBuilder(), AuditCapturing(value => audited = value));

        var result = await handler.Handle(
            new ExportBusinessDatasetQuery(BusinessDataset.PurchaseReceipts, new BusinessExportCriteria
            {
                Search = HostileSearch,
                PurchaseReceiptStatus = PurchaseReceiptStatus.Draft,
                SupplierId = supplierId,
                PurchaseOrderId = purchaseOrderId,
                FromDate = from,
                ToDate = to
            }),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Matches(@"^Bons_de_reception_\d{8}_\d{4}\.xlsx$", result.Value.FileName);
        Assert.DoesNotContain("evil", result.Value.FileName, StringComparison.OrdinalIgnoreCase);

        using var workbook = Open(result.Value.Content);
        Assert.NotNull(workbook.Worksheet("Sommaire"));
        AssertHeaders(workbook.Worksheet("Bons de réception"),
            "Numéro", "Date", "Statut", "Fournisseur", "Bon de commande", "Entrepôt", "Réf. fournisseur",
            "N° BL fournisseur", "Transporteur", "Nb lignes", "Total HT", "TVA", "Total TTC", "Validé le",
            "Annulé le", "Motif d'annulation", "Notes", "Identifiant");
        AssertHeaders(workbook.Worksheet("Lignes BR"),
            "Numéro", "N° ligne", "Code", "Désignation", "Unité", "Qté commandée", "Qté reçue", "Qté facturée",
            "Reste à facturer", "PU HT", "Remise %", "TVA", "Total HT", "Montant TVA", "Total TTC", "Identifiant");
        Assert.Equal(1, workbook.Worksheet("Bons de réception").LastRowUsed()!.RowNumber());
        Assert.Equal(1, workbook.Worksheet("Lignes BR").LastRowUsed()!.RowNumber());

        Assert.DoesNotContain("evil", JsonSerializer.Serialize(audited), StringComparison.OrdinalIgnoreCase);
        receipts.Verify(r => r.ListForExportAsync(
            HostileSearch, PurchaseReceiptStatus.Draft, supplierId, purchaseOrderId, from, to,
            BusinessDataExportLimits.Documents, BusinessDataExportLimits.Lines, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task PurchaseReceipts_WritesValues_RemainingQuantity_AndNeutralizesFormulas()
    {
        var receiptId = Guid.NewGuid();
        var header = new PurchaseReceiptExportRow(
            receiptId, "BR-2026-0001", new DateTime(2026, 10, 1), PurchaseReceiptStatus.PartiallyInvoiced,
            "Fournisseur A", null, "Dépôt central", "REF-1", "BL-9", "Transports X", 2,
            100m, 19m, 119m, new DateTime(2026, 10, 1, 9, 30, 0), null, null, "=HYPERLINK(\"http://x\")");
        var lines = new[]
        {
            new PurchaseReceiptLineExportRow("BR-2026-0001", 1, "P1", "Produit 1", "u", 10m, 10m, 4m, 5m, 10m,
                VatRate.Standard, 50m, 9.5m, 59.5m, Guid.NewGuid()),
            new PurchaseReceiptLineExportRow("BR-2026-0001", 2, "P2", "Produit 2", null, 0m, 5m, 7m, 10m, null,
                VatRate.Standard, 50m, 9.5m, 59.5m, Guid.NewGuid())
        };
        var handler = ReceiptDatasetHandler(ReadyReceipts(new[] { header }, lines).Object, new BusinessExcelWorkbookBuilder(), new Mock<IAuditService>());

        var result = await handler.Handle(
            new ExportBusinessDatasetQuery(BusinessDataset.PurchaseReceipts, new BusinessExportCriteria()),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        using var workbook = Open(result.Value.Content);
        var receipts = workbook.Worksheet("Bons de réception");
        Assert.Equal("BR-2026-0001", Text(receipts, "Numéro", 2));
        Assert.Equal("Partiellement facturé", Text(receipts, "Statut", 2));
        Assert.Equal(string.Empty, Text(receipts, "Bon de commande", 2));
        Assert.Equal(119m, receipts.Cell(2, Column(receipts, "Total TTC")).GetValue<decimal>());
        Assert.Equal(receiptId.ToString("D"), Text(receipts, "Identifiant", 2));
        var notes = receipts.Cell(2, Column(receipts, "Notes"));
        Assert.False(notes.HasFormula);
        Assert.True(notes.Style.IncludeQuotePrefix);

        var sheet = workbook.Worksheet("Lignes BR");
        Assert.Equal(6m, sheet.Cell(2, Column(sheet, "Reste à facturer")).GetValue<decimal>());
        Assert.Equal(0m, sheet.Cell(3, Column(sheet, "Reste à facturer")).GetValue<decimal>());
        Assert.Equal(VatRate.Standard.ToShortString(), Text(sheet, "TVA", 2));
        Assert.Equal(10m, sheet.Cell(2, Column(sheet, "Remise %")).GetValue<decimal>());
        Assert.True(sheet.Cell(3, Column(sheet, "Remise %")).IsEmpty());
    }

    [Theory]
    [InlineData(8_001, 0, "Bons de réception")]
    [InlineData(1, 25_001, "Lignes BR")]
    public async Task PurchaseReceipts_OverLimit_ReturnsTooManyRows_WithoutBuildingOrAuditing(int documents, int lines, string sheet)
    {
        var receipts = new Mock<IPurchaseReceiptRepository>();
        receipts.Setup(r => r.ListForExportAsync(
                It.IsAny<string?>(), It.IsAny<PurchaseReceiptStatus?>(), It.IsAny<Guid?>(), It.IsAny<Guid?>(),
                It.IsAny<DateTime?>(), It.IsAny<DateTime?>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(HeaderLinesExportData<PurchaseReceiptExportRow, PurchaseReceiptLineExportRow>.Blocked(documents, lines));
        var workbook = new Mock<IBusinessExcelWorkbookBuilder>();
        var audit = new Mock<IAuditService>();
        var handler = ReceiptDatasetHandler(receipts.Object, workbook.Object, audit);

        var result = await handler.Handle(
            new ExportBusinessDatasetQuery(BusinessDataset.PurchaseReceipts, new BusinessExportCriteria()),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(BusinessDataExportErrors.TooManyRows, result.Error.Code);
        Assert.Contains(sheet, result.Error.Description);
        workbook.Verify(w => w.Build(It.IsAny<BusinessWorkbookModel>()), Times.Never);
        audit.Verify(a => a.LogAsync(
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task PurchaseReceipts_WithoutPermission_IsForbidden_AndNeverQueriesTheRepository()
    {
        var receipts = new Mock<IPurchaseReceiptRepository>();
        var handler = new ExportBusinessDatasetQueryHandler(
            Coordinator(Mock.Of<IClientRepository>(), Mock.Of<IInvoiceRepository>(),
                new[] { BusinessDatasetCatalog.Permission(BusinessDataset.Clients) }, receipts.Object),
            Finalizer(new BusinessExcelWorkbookBuilder(), new Mock<IAuditService>()));

        var result = await handler.Handle(
            new ExportBusinessDatasetQuery(BusinessDataset.PurchaseReceipts, new BusinessExportCriteria()),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(BusinessDataExportErrors.Forbidden, result.Error.Code);
        receipts.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Bundle_IncludesPurchaseReceipts_OnlyWithPermission_AndIgnoresScreenFilters()
    {
        var denied = new Mock<IPurchaseReceiptRepository>();
        var hiddenHandler = new ExportBusinessDataBundleQueryHandler(
            Coordinator(ReadyClients().Object, Mock.Of<IInvoiceRepository>(),
                new[] { BusinessDatasetCatalog.Permission(BusinessDataset.Clients) }, denied.Object),
            Finalizer(new BusinessExcelWorkbookBuilder(), new Mock<IAuditService>()));

        var hidden = await hiddenHandler.Handle(
            new ExportBusinessDataBundleQuery(Array.Empty<BusinessDataset>(), new BusinessExportCriteria()),
            CancellationToken.None);

        Assert.True(hidden.IsSuccess);
        using (var workbook = Open(hidden.Value.Content))
        {
            Assert.Null(workbook.Worksheets.FirstOrDefault(sheet => sheet.Name == "Bons de réception"));
            Assert.NotNull(workbook.Worksheet("Clients"));
        }
        denied.VerifyNoOtherCalls();

        var from = new DateTime(2026, 1, 1);
        var to = new DateTime(2026, 12, 31);
        var allowed = ReadyReceipts(Array.Empty<PurchaseReceiptExportRow>(), Array.Empty<PurchaseReceiptLineExportRow>());
        var shownHandler = new ExportBusinessDataBundleQueryHandler(
            Coordinator(ReadyClients().Object, Mock.Of<IInvoiceRepository>(),
                new[] { BusinessDatasetCatalog.Permission(BusinessDataset.Clients), PurchaseReceiptsRead }, allowed.Object),
            Finalizer(new BusinessExcelWorkbookBuilder(), new Mock<IAuditService>()));

        var shown = await shownHandler.Handle(
            new ExportBusinessDataBundleQuery(Array.Empty<BusinessDataset>(), new BusinessExportCriteria { FromDate = from, ToDate = to }),
            CancellationToken.None);

        Assert.True(shown.IsSuccess);
        using var granted = Open(shown.Value.Content);
        Assert.NotNull(granted.Worksheet("Bons de réception"));
        Assert.NotNull(granted.Worksheet("Lignes BR"));
        allowed.Verify(r => r.ListForExportAsync(
            null, null, null, null, from, to,
            BusinessDataExportLimits.Documents, BusinessDataExportLimits.Lines, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public void Catalog_CoversEveryDataset_SoTheDefaultBundleNeverThrows()
    {
        foreach (var dataset in BusinessDatasetCatalog.All)
        {
            Assert.False(string.IsNullOrWhiteSpace(BusinessDatasetCatalog.Permission(dataset)));
            Assert.NotEqual("Export", BusinessDatasetCatalog.FilePrefix(dataset));
        }

        Assert.True(BusinessDatasetCatalog.TryParse("purchase-receipts", out var parsed));
        Assert.Equal(BusinessDataset.PurchaseReceipts, parsed);
        Assert.True(BusinessDatasetCatalog.TryParse(" Purchase-Receipts ", out var trimmed));
        Assert.Equal(BusinessDataset.PurchaseReceipts, trimmed);
        Assert.Equal(Permissions.PurchaseReceipts.Read, BusinessDatasetCatalog.Permission(BusinessDataset.PurchaseReceipts));
        Assert.Equal("Bons_de_reception", BusinessDatasetCatalog.FilePrefix(BusinessDataset.PurchaseReceipts));
    }

    [Fact]
    public void Criteria_DescribesPurchaseReceiptStatus_AndToleratesUnknownValues()
    {
        Assert.Contains("Validé", new BusinessExportCriteria { PurchaseReceiptStatus = PurchaseReceiptStatus.Validated }.Describe());
        Assert.Contains("Statut", new BusinessExportCriteria { PurchaseReceiptStatus = (PurchaseReceiptStatus)99 }.Describe());
    }

    [Fact]
    public void Validator_RejectsUnknownPurchaseReceiptStatus()
    {
        var validator = new ExportBusinessDatasetQueryValidator();
        ExportBusinessDatasetQuery Query(PurchaseReceiptStatus? status) =>
            new(BusinessDataset.PurchaseReceipts, new BusinessExportCriteria { PurchaseReceiptStatus = status });

        Assert.False(validator.Validate(Query((PurchaseReceiptStatus)99)).IsValid);
        Assert.True(validator.Validate(Query(null)).IsValid);
        Assert.True(validator.Validate(Query(PurchaseReceiptStatus.Draft)).IsValid);
        Assert.True(validator.Validate(Query(PurchaseReceiptStatus.Invoiced)).IsValid);
    }

    private static Mock<IPurchaseReceiptRepository> ReadyReceipts(
        IReadOnlyList<PurchaseReceiptExportRow> headers,
        IReadOnlyList<PurchaseReceiptLineExportRow> lines)
    {
        var receipts = new Mock<IPurchaseReceiptRepository>();
        receipts.Setup(r => r.ListForExportAsync(
                It.IsAny<string?>(), It.IsAny<PurchaseReceiptStatus?>(), It.IsAny<Guid?>(), It.IsAny<Guid?>(),
                It.IsAny<DateTime?>(), It.IsAny<DateTime?>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HeaderLinesExportData<PurchaseReceiptExportRow, PurchaseReceiptLineExportRow>(
                headers.Count, lines.Count, headers, lines));
        return receipts;
    }

    private static ExportBusinessDatasetQueryHandler ReceiptDatasetHandler(
        IPurchaseReceiptRepository receipts,
        IBusinessExcelWorkbookBuilder workbook,
        Mock<IAuditService> audit) =>
        new(
            Coordinator(Mock.Of<IClientRepository>(), Mock.Of<IInvoiceRepository>(), new[] { PurchaseReceiptsRead }, receipts),
            Finalizer(workbook, audit));

    private static void AssertHeaders(IXLWorksheet sheet, params string[] expected)
    {
        var actual = Enumerable.Range(1, sheet.Row(1).LastCellUsed()!.Address.ColumnNumber)
            .Select(column => sheet.Cell(1, column).GetString())
            .ToArray();
        Assert.Equal(expected, actual);
    }

    private static ExportBusinessDataBundleQuery BundleRequest() =>
        new(new[] { BusinessDataset.Clients, BusinessDataset.Invoices }, new BusinessExportCriteria());

    private static Mock<IClientRepository> ReadyClients()
    {
        var clients = new Mock<IClientRepository>();
        clients.Setup(c => c.ListForExportAsync(
                It.IsAny<string?>(), It.IsAny<ClientType?>(), It.IsAny<bool?>(), It.IsAny<string?>(),
                It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(CountedRows<ClientExportRow>.Ready(Array.Empty<ClientExportRow>()));
        return clients;
    }

    private static Mock<IInvoiceRepository> ReadyInvoices()
    {
        var invoices = new Mock<IInvoiceRepository>();
        invoices.Setup(i => i.ListForExportAsync(
                It.IsAny<string?>(), It.IsAny<InvoiceStatus?>(), It.IsAny<DateTime?>(), It.IsAny<DateTime?>(),
                It.IsAny<Guid?>(), It.IsAny<bool>(), It.IsAny<InvoiceType?>(), It.IsAny<bool>(),
                It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HeaderLinesPaymentsExportData<InvoiceExportRow, InvoiceLineExportRow, InvoicePaymentExportRow>(
                0, 0, 0, Array.Empty<InvoiceExportRow>(), Array.Empty<InvoiceLineExportRow>(), Array.Empty<InvoicePaymentExportRow>()));
        return invoices;
    }

    private static ExportBusinessDatasetQueryHandler CreateDatasetHandler(
        IClientRepository clients,
        IInvoiceRepository invoices,
        IBusinessExcelWorkbookBuilder workbook,
        Mock<IAuditService> audit,
        params string[] permissions)
    {
        if (permissions.Length == 0)
            permissions = new[] { BusinessDatasetCatalog.Permission(BusinessDataset.Clients) };
        return new ExportBusinessDatasetQueryHandler(
            Coordinator(clients, invoices, permissions),
            Finalizer(workbook, audit));
    }

    private static ExportBusinessDataBundleQueryHandler CreateBundleHandler(
        IClientRepository clients,
        IInvoiceRepository invoices,
        IBusinessExcelWorkbookBuilder workbook,
        Mock<IAuditService> audit,
        params string[] permissions) =>
        new(
            Coordinator(clients, invoices, permissions),
            Finalizer(workbook, audit));

    private static BusinessDataExportCoordinator Coordinator(
        IClientRepository clients,
        IInvoiceRepository invoices,
        string[] permissions,
        IPurchaseReceiptRepository? purchaseReceipts = null)
    {
        var user = new Mock<ICurrentUser>();
        user.Setup(u => u.Email).Returns("ada@example.com");
        user.Setup(u => u.HasPermission(It.IsAny<string>()))
            .Returns((string permission) => permissions.Contains(permission));
        var companies = new Mock<ICompanyRepository>();
        companies.Setup(c => c.GetDefaultAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((Company?)null);

        return new BusinessDataExportCoordinator(
            clients,
            Mock.Of<IProductRepository>(),
            Mock.Of<ISupplierRepository>(),
            invoices,
            Mock.Of<ISupplierInvoiceRepository>(),
            Mock.Of<IQuoteRepository>(),
            Mock.Of<IDeliveryNoteRepository>(),
            Mock.Of<IPurchaseOrderRepository>(),
            purchaseReceipts ?? Mock.Of<IPurchaseReceiptRepository>(),
            Mock.Of<IWarehouseRepository>(),
            Mock.Of<IStockItemRepository>(),
            Mock.Of<IStockMovementRepository>(),
            companies.Object,
            user.Object);
    }

    private static BusinessExportFinalizer Finalizer(IBusinessExcelWorkbookBuilder workbook, Mock<IAuditService> audit)
    {
        audit.Setup(a => a.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(),
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(Guid.Parse("11111111-1111-1111-1111-111111111111"));
        return new BusinessExportFinalizer(workbook, audit.Object, tenant.Object);
    }

    private static Mock<IAuditService> AuditCapturing(Action<object?> capture)
    {
        var audit = new Mock<IAuditService>();
        audit.Setup(a => a.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(),
                It.IsAny<CancellationToken>()))
            .Callback<string, string, Guid?, object?, object?, CancellationToken>((_, _, _, _, values, _) => capture(values))
            .Returns(Task.CompletedTask);
        return audit;
    }

    private static XLWorkbook Open(byte[] bytes) => new(new MemoryStream(bytes));

    private static int Column(IXLWorksheet sheet, string header)
    {
        var last = sheet.Row(1).LastCellUsed()!.Address.ColumnNumber;
        for (var column = 1; column <= last; column++)
        {
            if (sheet.Cell(1, column).GetString() == header)
                return column;
        }

        throw new InvalidOperationException(header);
    }

    private static string Text(IXLWorksheet sheet, string header, int row) =>
        sheet.Cell(row, Column(sheet, header)).GetString();
}
