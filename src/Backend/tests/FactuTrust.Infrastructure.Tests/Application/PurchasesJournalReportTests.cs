using FactuTrust.Application.Features.Reports;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class PurchasesJournalReportTests : IDisposable
{
    private readonly string _databaseName = $"PurchasesJournal_{Guid.NewGuid()}";
    private readonly TestTenantDbContextFactory _contextFactory;
    private readonly SupplierInvoiceRepository _invoiceRepository;

    public PurchasesJournalReportTests()
    {
        _contextFactory = new TestTenantDbContextFactory(_databaseName);
        _invoiceRepository = new SupplierInvoiceRepository(_contextFactory);
    }

    [Fact]
    public async Task GetPurchasesJournalDetail_ExcludesCancelledInvoices()
    {
        var supplier = await PersistSupplierAsync();
        var product = await PersistProductAsync();
        var day = new DateTime(2026, 5, 12);

        await PersistStandaloneInvoiceAsync(supplier, product, day, "FS-2026-000101", cancel: false);
        await PersistStandaloneInvoiceAsync(supplier, product, day, "FS-2026-000102", cancel: true);

        var rows = await _invoiceRepository.GetPurchasesJournalDetailAllAsync(day, day, null, 100, CancellationToken.None);

        Assert.Single(rows);
        Assert.Equal("FS-2026-000101", rows[0].DocumentNumber);
    }

    [Fact]
    public async Task GetPurchasesJournalAggregated_ByDay_GroupsSupplierAndProduct()
    {
        var supplier = await PersistSupplierAsync();
        var product = await PersistProductAsync();
        var day = new DateTime(2026, 6, 1);

        await PersistStandaloneInvoiceAsync(supplier, product, day, "FS-2026-000201", cancel: false);
        await PersistStandaloneInvoiceAsync(supplier, product, day, "FS-2026-000202", cancel: false);

        var rows = await _invoiceRepository.GetPurchasesJournalAggregatedAsync(
            day, day, null, SalesJournalViewMode.Day, CancellationToken.None);

        var row = Assert.Single(rows);
        Assert.Equal("2026-06-01", row.PeriodKey);
        Assert.Equal(2m, row.Quantity);
    }

    [Fact]
    public void ValidatePeriod_DetailMode_RejectsLongRange()
    {
        var from = new DateTime(2026, 1, 1);
        var to = from.AddDays(PurchasesJournalReportConstants.MaxDetailPeriodDays);
        var result = PurchasesJournalReportAssembler.ValidatePeriod(from, to, SalesJournalViewMode.Detail);
        Assert.True(result.IsFailure);
    }

    private async Task<Supplier> PersistSupplierAsync()
    {
        var address = Address.Create("1 rue", "Tunis", "1000", "TN").Value;
        var email = Email.Create($"{Guid.NewGuid():N}@test.com").Value;
        var nif = NIF.Create("1234567/A/B/C/099").Value;
        var supplier = Supplier.Create("Fournisseur JV", SupplierType.Business, address, email, nif: nif).Value;
        await using var ctx = _contextFactory.CreateContext();
        ctx.Suppliers.Add(supplier);
        await ctx.SaveChangesAsync();
        return supplier;
    }

    private async Task<Product> PersistProductAsync()
    {
        await using var ctx = _contextFactory.CreateContext();
        var cat = ProductCategory.Create("Cat", "c").Value;
        ctx.ProductCategories.Add(cat);
        await ctx.SaveChangesAsync();
        var product = Product.Create("ART-A", "Article A", ProductType.Service,
            Money.Create(100m, "TND"), VatRate.Standard, cat.Id).Value;
        ctx.Products.Add(product);
        await ctx.SaveChangesAsync();
        return product;
    }

    private async Task PersistStandaloneInvoiceAsync(
        Supplier supplier, Product product, DateTime invoiceDate, string number, bool cancel)
    {
        var result = SupplierInvoice.CreateStandalone(
            supplier,
            number,
            invoiceDate,
            [
                new StandaloneSupplierInvoiceLineInput(
                    product.Id,
                    product.Code,
                    product.Name,
                    null,
                    1m,
                    product.Unit,
                    product.GetPurchasePrice(),
                    product.VatRate)
            ]);
        Assert.True(result.IsSuccess);
        var invoice = result.Value;
        if (cancel)
            Assert.True(invoice.Cancel("test").IsSuccess);

        await _invoiceRepository.AddAsync(invoice);
    }

    public void Dispose() { }

    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _databaseName;
        public TestTenantDbContextFactory(string databaseName) => _databaseName = databaseName;
        public TenantDbContext CreateContext() =>
            new(new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(_databaseName)
                .Options);
    }
}
