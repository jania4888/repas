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
        string[] permissions)
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
