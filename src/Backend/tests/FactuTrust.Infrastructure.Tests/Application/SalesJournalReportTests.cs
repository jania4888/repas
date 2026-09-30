using FactuTrust.Application.Features.Reports;
using FactuTrust.Application.Features.Reports.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class SalesJournalReportTests : IDisposable
{
    private readonly string _databaseName = $"SalesJournal_{Guid.NewGuid()}";
    private readonly TestTenantDbContextFactory _contextFactory;
    private readonly InvoiceRepository _repository;

    public SalesJournalReportTests()
    {
        _contextFactory = new TestTenantDbContextFactory(_databaseName);
        _repository = new InvoiceRepository(_contextFactory);
    }

    [Fact]
    public async Task GetSalesJournalDetail_OnlyIncludesValidatedAndPaid_WithSignedCreditNotes()
    {
        var client = await CreateClientAsync("Client JV");
        var product = await CreateProductAsync("ART1", 100m);
        var day = new DateTime(2026, 7, 10);

        await AddValidatedInvoiceAsync(client, product, day, 1, InvoiceType.Standard);
        var fac = await AddValidatedInvoiceAsync(client, product, day, 2, InvoiceType.Standard);
        await AddValidatedInvoiceAsync(client, product, day, 3, InvoiceType.CreditNote, fac.Id);
        await AddDraftInvoiceAsync(client, product, day, 4);

        var rows = await _repository.GetSalesJournalDetailAllAsync(day, day, null, 100, CancellationToken.None);
        Assert.Equal(3, rows.Count);

        var facRows = rows.Where(r => r.DocumentType == "FAC").ToList();
        var avoRow = Assert.Single(rows.Where(r => r.DocumentType == "AVO"));
        Assert.Equal(2, facRows.Count);
        Assert.All(facRows, r => Assert.True(r.Quantity > 0));
        Assert.True(avoRow.Quantity < 0);
        Assert.True(avoRow.LineTotal < 0);
    }

    [Fact]
    public async Task GetSalesJournalAggregated_ByDay_GroupsClientAndProduct()
    {
        var client = await CreateClientAsync("Client Agr");
        var product = await CreateProductAsync("P1", 50m);
        var day = new DateTime(2026, 8, 1);

        await AddValidatedInvoiceAsync(client, product, day, 10, InvoiceType.Standard);
        await AddValidatedInvoiceAsync(client, product, day, 11, InvoiceType.Standard);

        var rows = await _repository.GetSalesJournalAggregatedAsync(
            day, day, null, SalesJournalViewMode.Day, CancellationToken.None);

        var row = Assert.Single(rows);
        Assert.Equal("2026-08-01", row.PeriodKey);
        Assert.Equal(2m, row.Quantity);
    }

    [Fact]
    public async Task ValidatePeriod_DetailMode_RejectsLongRange()
    {
        var from = new DateTime(2026, 1, 1);
        var to = from.AddDays(SalesJournalReportConstants.MaxDetailPeriodDays);
        var result = SalesJournalReportAssembler.ValidatePeriod(from, to, SalesJournalViewMode.Detail);
        Assert.True(result.IsFailure);
    }

    private async Task<Client> CreateClientAsync(string name)
    {
        var address = Address.Create("1 rue", "Tunis", "1000", "TN").Value;
        var email = Email.Create($"{Guid.NewGuid():N}@test.com").Value;
        var nif = NIF.Create("1234567/A/B/C/099").Value;
        var client = Client.Create(name, ClientType.Business, address, email, nif).Value;
        await using var ctx = _contextFactory.CreateContext();
        ctx.Clients.Add(client);
        await ctx.SaveChangesAsync();
        return client;
    }

    private async Task<Product> CreateProductAsync(string code, decimal price)
    {
        await using var ctx = _contextFactory.CreateContext();
        var cat = ProductCategory.Create("Cat", "c").Value;
        ctx.ProductCategories.Add(cat);
        await ctx.SaveChangesAsync();
        var product = Product.Create(code, "Produit", ProductType.Service,
            Money.Create(price, "TND"), VatRate.Standard, cat.Id).Value;
        ctx.Products.Add(product);
        await ctx.SaveChangesAsync();
        return product;
    }

    private async Task<Invoice> AddValidatedInvoiceAsync(
        Client client, Product product, DateTime issue, int seq, InvoiceType type, Guid? linkedId = null)
    {
        var number = type == InvoiceType.CreditNote
            ? InvoiceNumber.Create("AVO", issue.Year, seq)
            : InvoiceNumber.Create("FAC", issue.Year, seq);
        var invoice = type == InvoiceType.CreditNote
            ? Invoice.CreateCreditNote(number, client, issue, linkedId!.Value, issue.AddDays(30), "AVO").Value
            : Invoice.Create(number, client, issue, issue.AddDays(30), $"R{seq}").Value;
        Assert.True(invoice.AddLine(product, 1).IsSuccess);
        Assert.True(invoice.Validate().IsSuccess);
        return await _repository.AddAsync(invoice);
    }

    private async Task AddDraftInvoiceAsync(Client client, Product product, DateTime issue, int seq)
    {
        var invoice = Invoice.Create(
            InvoiceNumber.Create("FAC", issue.Year, seq), client, issue, issue.AddDays(30), $"D{seq}").Value;
        Assert.True(invoice.AddLine(product, 1).IsSuccess);
        await _repository.AddAsync(invoice);
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
