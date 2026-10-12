using FactuTrust.Application.Features.Reports.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Repositories;

/// <summary>
/// Tests d'intégration pour InvoiceRepository, notamment pour valider la correction
/// du problème des owned entities Money dans InvoiceLine.
/// </summary>
public sealed class InvoiceRepositoryTests : IDisposable
{
    private readonly string _databaseName;
    private readonly TestTenantDbContextFactory _contextFactory;
    private readonly InvoiceRepository _repository;

    public InvoiceRepositoryTests()
    {
        // Créer un nom de base de données unique pour chaque test
        _databaseName = $"TestDb_{Guid.NewGuid()}";

        // Créer un TenantDbContextFactory de test qui utilise InMemory
        _contextFactory = new TestTenantDbContextFactory(_databaseName);
        
        // Créer un wrapper pour InvoiceRepository qui utilise notre factory de test
        _repository = new InvoiceRepository(_contextFactory);
    }

    /// <summary>
    /// Factory de test qui crée des contextes InMemory au lieu de SQL Server.
    /// Implémente ITenantDbContextFactory pour être utilisée avec InvoiceRepository.
    /// </summary>
    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _databaseName;

        public TestTenantDbContextFactory(string databaseName)
        {
            _databaseName = databaseName;
        }

        public TenantDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName: _databaseName)
                .Options;

            return new TenantDbContext(options);
        }
    }

    [Fact]
    public async Task AddAsync_WithProductFromDifferentContext_ShouldSaveOwnedEntitiesCorrectly()
    {
        // Arrange
        // 1. Créer un produit dans un contexte (simulant ProductRepository.GetByIdAsync)
        Product product;
        using (var productContext = _contextFactory.CreateContext())
        {
            var categoryResult = ProductCategory.Create("Services", "Catégorie de test");
            Assert.True(categoryResult.IsSuccess, categoryResult.Error?.Description);
            var category = categoryResult.Value;

            productContext.ProductCategories.Add(category);
            await productContext.SaveChangesAsync();

            var productResult = Product.Create(
                code: "PROD001",
                name: "Produit Test",
                type: ProductType.Service,
                unitPrice: Money.Create(100.000m, "TND"),
                vatRate: VatRate.Standard,
                categoryId: category.Id,
                description: "Description du produit",
                unit: "Unité");

            Assert.True(productResult.IsSuccess, $"Échec de création du produit: {productResult.Error?.Description}");
            product = productResult.Value;

            productContext.Products.Add(product);
            await productContext.SaveChangesAsync();
        }
        // Le contexte est maintenant détruit, le produit est "détaché"

        // 2. Créer un client
        var addressResult = Address.Create("123 Rue Test", "Tunis", "1000", "Tunisie");
        Assert.True(addressResult.IsSuccess, $"Échec de création de l'adresse: {addressResult.Error?.Description}");
        
        var emailResult = Email.Create("client@test.com");
        Assert.True(emailResult.IsSuccess, $"Échec de création de l'email: {emailResult.Error?.Description}");
        
        var nifResult = NIF.Create("1234567/A/B/C/000");
        Assert.True(nifResult.IsSuccess, $"Échec de création du NIF: {nifResult.Error?.Description}");
        
        var clientResult = Client.Create(
            name: "Client Test",
            type: ClientType.Business,
            address: addressResult.Value,
            email: emailResult.Value,
            nif: nifResult.Value);
        
        Assert.True(clientResult.IsSuccess, $"Échec de création du client: {clientResult.Error?.Description}");
        var client = clientResult.Value;

        using (var clientContext = _contextFactory.CreateContext())
        {
            clientContext.Clients.Add(client);
            await clientContext.SaveChangesAsync();
        }

        // 3. Créer une facture avec une ligne qui référence le produit détaché
        var invoiceNumber = InvoiceNumber.Create("FAC", 2026, 1);
        var invoiceResult = Invoice.Create(
            number: invoiceNumber,
            client: client,
            issueDate: DateTime.UtcNow.Date,
            dueDate: DateTime.UtcNow.Date.AddDays(30),
            reference: "REF001");
        
        Assert.True(invoiceResult.IsSuccess, $"Échec de création de la facture: {invoiceResult.Error?.Description}");
        var invoice = invoiceResult.Value;

        // Ajouter une ligne avec le produit détaché (simulant le comportement réel)
        var addLineResult = invoice.AddLine(
            product: product, // Produit détaché du contexte
            quantity: 2,
            customUnitPrice: null,
            discountPercent: 10);

        Assert.True(addLineResult.IsSuccess, "L'ajout de la ligne devrait réussir");
        Assert.NotSame(product.UnitPrice, invoice.Lines.Single().UnitPrice);

        // Act & Assert
        // Cette opération devrait maintenant fonctionner sans erreur "owned entity without owner"
        var savedInvoice = await _repository.AddAsync(invoice);

        // Vérifier que la facture a été sauvegardée
        Assert.NotNull(savedInvoice);
        Assert.NotEqual(Guid.Empty, savedInvoice.Id);

        // Vérifier que la ligne a été sauvegardée avec ses owned entities
        using (var verifyContext = _contextFactory.CreateContext())
        {
            var loadedInvoice = await verifyContext.Invoices
                .Include(i => i.Lines)
                .FirstOrDefaultAsync(i => i.Id == savedInvoice.Id);

            Assert.NotNull(loadedInvoice);
            Assert.Single(loadedInvoice.Lines);

            var line = loadedInvoice.Lines.First();
            
            // Vérifier que toutes les owned entities Money sont présentes
            Assert.NotNull(line.UnitPrice);
            Assert.Equal(100.000m, line.UnitPrice.Amount);
            Assert.Equal("TND", line.UnitPrice.Currency);

            Assert.NotNull(line.DiscountAmount);
            Assert.NotNull(line.SubTotal);
            Assert.NotNull(line.VatAmount);
            Assert.NotNull(line.Total);

            // Vérifier que les calculs sont corrects
            // UnitPrice: 100.000, Quantity: 2, Discount: 10%
            // Gross: 200.000, Discount: 20.000, SubTotal: 180.000
            // VAT (19%): 34.200, Total: 214.200
            Assert.Equal(180.000m, line.SubTotal.Amount);
            Assert.Equal(34.200m, line.VatAmount.Amount);
            Assert.Equal(214.200m, line.Total.Amount);
        }
    }

    [Fact]
    public async Task AddAsync_WithMultipleLinesAndProducts_ShouldSaveAllOwnedEntitiesCorrectly()
    {
        // Arrange
        // Créer plusieurs produits dans un contexte séparé
        Product product1, product2;
        using (var productContext = _contextFactory.CreateContext())
        {
            var categoryResult = ProductCategory.Create("Services", "Catégorie de test");
            Assert.True(categoryResult.IsSuccess, categoryResult.Error?.Description);
            var category = categoryResult.Value;

            productContext.ProductCategories.Add(category);
            await productContext.SaveChangesAsync();

            var product1Result = Product.Create(
                code: "PROD001",
                name: "Produit 1",
                type: ProductType.Service,
                unitPrice: Money.Create(50.000m, "TND"),
                vatRate: VatRate.Standard,
                categoryId: category.Id);
            Assert.True(product1Result.IsSuccess, $"Échec de création du produit 1: {product1Result.Error?.Description}");
            product1 = product1Result.Value;

            var product2Result = Product.Create(
                code: "PROD002",
                name: "Produit 2",
                type: ProductType.Service,
                unitPrice: Money.Create(75.000m, "TND"),
                vatRate: VatRate.Reduced,
                categoryId: category.Id);
            Assert.True(product2Result.IsSuccess, $"Échec de création du produit 2: {product2Result.Error?.Description}");
            product2 = product2Result.Value;

            productContext.Products.AddRange(product1, product2);
            await productContext.SaveChangesAsync();
        }

        // Créer un client
        var addressResult = Address.Create("123 Rue Test", "Tunis", "1000", "Tunisie");
        Assert.True(addressResult.IsSuccess);
        var emailResult = Email.Create("client@test.com");
        Assert.True(emailResult.IsSuccess);
        var nifResult = NIF.Create("1234567/A/B/C/000");
        Assert.True(nifResult.IsSuccess, $"Échec de création du NIF: {nifResult.Error?.Description}");
        
        var clientResult = Client.Create(
            name: "Client Test",
            type: ClientType.Business,
            address: addressResult.Value,
            email: emailResult.Value,
            nif: nifResult.Value);
        Assert.True(clientResult.IsSuccess, $"Échec de création du client: {clientResult.Error?.Description}");
        var client = clientResult.Value;

        using (var clientContext = _contextFactory.CreateContext())
        {
            clientContext.Clients.Add(client);
            await clientContext.SaveChangesAsync();
        }

        // Créer une facture avec plusieurs lignes
        var invoiceNumber = InvoiceNumber.Create("FAC", 2026, 1);
        var invoiceResult = Invoice.Create(
            number: invoiceNumber,
            client: client,
            issueDate: DateTime.UtcNow.Date,
            dueDate: DateTime.UtcNow.Date.AddDays(30),
            reference: "REF001");
        Assert.True(invoiceResult.IsSuccess, $"Échec de création de la facture: {invoiceResult.Error?.Description}");
        var invoice = invoiceResult.Value;

        invoice.AddLine(product1, quantity: 3);
        invoice.AddLine(product2, quantity: 2, discountPercent: 5);

        // Act
        var savedInvoice = await _repository.AddAsync(invoice);

        // Assert
        Assert.NotNull(savedInvoice);
        
        using (var verifyContext = _contextFactory.CreateContext())
        {
            var loadedInvoice = await verifyContext.Invoices
                .Include(i => i.Lines)
                .FirstOrDefaultAsync(i => i.Id == savedInvoice.Id);

            Assert.NotNull(loadedInvoice);
            Assert.Equal(2, loadedInvoice.Lines.Count);

            // Vérifier que toutes les owned entities sont présentes pour chaque ligne
            foreach (var line in loadedInvoice.Lines)
            {
                Assert.NotNull(line.UnitPrice);
                Assert.NotNull(line.DiscountAmount);
                Assert.NotNull(line.SubTotal);
                Assert.NotNull(line.VatAmount);
                Assert.NotNull(line.Total);
            }
        }
    }

    [Fact]
    public async Task GetForReportAsync_WhenDatesAreNull_ShouldReturnAllInvoices()
    {
        // Arrange
        var client1 = await CreateClientAsync(
            name: "Client Report 1",
            email: "report1@test.com",
            nifValue: "1234567/A/B/C/001");

        var client2 = await CreateClientAsync(
            name: "Client Report 2",
            email: "report2@test.com",
            nifValue: "1234567/A/B/C/002");

        await AddInvoiceAsync(client1, issueDate: new DateTime(2026, 1, 10), sequence: 1);
        await AddInvoiceAsync(client1, issueDate: new DateTime(2026, 1, 20), sequence: 2);
        await AddInvoiceAsync(client2, issueDate: new DateTime(2026, 2, 5), sequence: 3);

        // Act
        var invoices = await _repository.GetForReportAsync(fromDate: null, toDate: null, clientId: null);

        // Assert
        Assert.Equal(3, invoices.Count);
        Assert.Equal(new DateTime(2026, 2, 5), invoices[0].IssueDate);
        Assert.Equal(new DateTime(2026, 1, 20), invoices[1].IssueDate);
        Assert.Equal(new DateTime(2026, 1, 10), invoices[2].IssueDate);
    }

    [Fact]
    public async Task GetForReportAsync_WhenOnlyFromDateIsProvided_ShouldFilterByIssueDateInclusive()
    {
        // Arrange
        var client = await CreateClientAsync(
            name: "Client FromDate",
            email: "fromdate@test.com",
            nifValue: "1234567/A/B/C/010");

        await AddInvoiceAsync(client, issueDate: new DateTime(2026, 1, 10), sequence: 1);
        await AddInvoiceAsync(client, issueDate: new DateTime(2026, 1, 20), sequence: 2);
        await AddInvoiceAsync(client, issueDate: new DateTime(2026, 2, 5), sequence: 3);

        // Act
        var invoices = await _repository.GetForReportAsync(
            fromDate: new DateTime(2026, 1, 15),
            toDate: null,
            clientId: null);

        // Assert
        Assert.Equal(2, invoices.Count);
        Assert.All(invoices, i => Assert.True(i.IssueDate >= new DateTime(2026, 1, 15)));
    }

    [Fact]
    public async Task GetForReportAsync_WhenOnlyToDateIsProvided_ShouldFilterByIssueDateInclusive()
    {
        // Arrange
        var client = await CreateClientAsync(
            name: "Client ToDate",
            email: "todate@test.com",
            nifValue: "1234567/A/B/C/020");

        await AddInvoiceAsync(client, issueDate: new DateTime(2026, 1, 10), sequence: 1);
        await AddInvoiceAsync(client, issueDate: new DateTime(2026, 1, 20), sequence: 2);
        await AddInvoiceAsync(client, issueDate: new DateTime(2026, 2, 5), sequence: 3);

        // Act
        var invoices = await _repository.GetForReportAsync(
            fromDate: null,
            toDate: new DateTime(2026, 1, 20),
            clientId: null);

        // Assert
        Assert.Equal(2, invoices.Count);
        Assert.All(invoices, i => Assert.True(i.IssueDate <= new DateTime(2026, 1, 20)));
    }

    [Fact]
    public async Task GetForReportAsync_WhenClientIdIsProvided_ShouldFilterByClient()
    {
        // Arrange
        var client1 = await CreateClientAsync(
            name: "Client Filter 1",
            email: "filter1@test.com",
            nifValue: "1234567/A/B/C/030");

        var client2 = await CreateClientAsync(
            name: "Client Filter 2",
            email: "filter2@test.com",
            nifValue: "1234567/A/B/C/031");

        await AddInvoiceAsync(client1, issueDate: new DateTime(2026, 1, 10), sequence: 1);
        await AddInvoiceAsync(client2, issueDate: new DateTime(2026, 1, 15), sequence: 2);

        // Act
        var invoices = await _repository.GetForReportAsync(
            fromDate: null,
            toDate: null,
            clientId: client1.Id);

        // Assert
        Assert.Single(invoices);
        Assert.Equal(client1.Id, invoices[0].ClientId);
    }

    private async Task<Client> CreateClientAsync(string name, string email, string nifValue)
    {
        using var context = _contextFactory.CreateContext();

        var addressResult = Address.Create("123 Rue Test", "Tunis", "1000", "Tunisie");
        Assert.True(addressResult.IsSuccess, addressResult.Error?.Description);

        var emailResult = Email.Create(email);
        Assert.True(emailResult.IsSuccess, emailResult.Error?.Description);

        var nifResult = NIF.Create(nifValue);
        Assert.True(nifResult.IsSuccess, nifResult.Error?.Description);

        var clientResult = Client.Create(
            name: name,
            type: ClientType.Business,
            address: addressResult.Value,
            email: emailResult.Value,
            nif: nifResult.Value);

        Assert.True(clientResult.IsSuccess, clientResult.Error?.Description);

        context.Clients.Add(clientResult.Value);
        await context.SaveChangesAsync();

        return clientResult.Value;
    }

    private async Task AddInvoiceAsync(Client client, DateTime issueDate, int sequence)
    {
        var invoiceNumber = InvoiceNumber.Create("FAC", 2026, sequence);
        var invoiceResult = Invoice.Create(
            number: invoiceNumber,
            client: client,
            issueDate: issueDate,
            dueDate: issueDate.AddDays(30),
            reference: $"REF-{sequence:000}");

        Assert.True(invoiceResult.IsSuccess, invoiceResult.Error?.Description);

        await _repository.AddAsync(invoiceResult.Value);
    }

    [Fact]
    public async Task GetAchievedRevenueTndByUserMonthForYearAsync_EmptyDatabase_ReturnsEmpty()
    {
        var result = await _repository.GetAchievedRevenueTndByUserMonthForYearAsync(2026);
        Assert.NotNull(result);
        Assert.Empty(result);
    }

    [Fact]
    public async Task GetSummaryAsync_AggregatesTotalsRemainingAndOverdueOverFilteredSet()
    {
        // Arrange — un produit réutilisé, deux factures avec lignes.
        var client = await CreateClientAsync(
            name: "Client Summary",
            email: "summary@test.com",
            nifValue: "1234567/A/B/C/050");
        var product = await CreateProductAsync(code: "PRODSUM", unitPrice: 100.000m);

        var today = DateTime.UtcNow.Date;
        // Facture A : échue (dueDate passée) et impayée.
        var invA = await AddInvoiceWithLineAsync(client, product,
            issueDate: today.AddDays(-40), dueDate: today.AddDays(-10), sequence: 1, quantity: 1);
        // Facture B : non échue, partiellement payée.
        var invB = await AddInvoiceWithLineAsync(client, product,
            issueDate: today.AddDays(-5), dueDate: today.AddDays(20), sequence: 2, quantity: 2);
        await AddPaymentAsync(invB, 100.000m);

        var ttcA = invA.TotalAmount.Amount;
        var ttcB = invB.TotalAmount.Amount;

        // Act — aucun filtre : tout l'ensemble.
        var summary = await _repository.GetSummaryAsync(null, null, null, null, null, false);

        // Assert — comparé aux montants réellement calculés par le domaine (robuste au timbre/taux).
        Assert.Equal(2, summary.Count);
        Assert.Equal(Math.Round(invA.SubTotal.Amount + invB.SubTotal.Amount, 3), summary.TotalHt);
        Assert.Equal(Math.Round(invA.TotalVat.Amount + invB.TotalVat.Amount, 3), summary.TotalVat);
        Assert.Equal(Math.Round(ttcA + ttcB, 3), summary.TotalTtc);
        Assert.Equal(100.000m, summary.TotalPaid);
        // Reste = somme PAR facture de max(0, |TTC| - payé) : A non payée, B payée 100.
        Assert.Equal(
            Math.Round(Math.Max(0m, Math.Abs(ttcA)) + Math.Max(0m, Math.Abs(ttcB) - 100.000m), 3),
            summary.TotalRemaining);
        Assert.Equal(1, summary.OverdueCount);
        Assert.Equal("TND", summary.Currency);
    }

    [Fact]
    public async Task GetSummaryAsync_RespectsDateFilter()
    {
        var client = await CreateClientAsync(
            name: "Client Summary Filter",
            email: "summaryfilter@test.com",
            nifValue: "1234567/A/B/C/051");
        var product = await CreateProductAsync(code: "PRODSUMF", unitPrice: 100.000m);

        var today = DateTime.UtcNow.Date;
        await AddInvoiceWithLineAsync(client, product,
            issueDate: today.AddDays(-40), dueDate: today.AddDays(-10), sequence: 1, quantity: 1);
        var invB = await AddInvoiceWithLineAsync(client, product,
            issueDate: today.AddDays(-5), dueDate: today.AddDays(20), sequence: 2, quantity: 2);

        // fromDate exclut la facture la plus ancienne.
        var summary = await _repository.GetSummaryAsync(null, null, today.AddDays(-6), null, null, false);

        Assert.Equal(1, summary.Count);
        Assert.Equal(invB.TotalAmount.Amount, summary.TotalTtc);
    }

    private async Task<Product> CreateProductAsync(string code, decimal unitPrice)
    {
        using var context = _contextFactory.CreateContext();

        var category = ProductCategory.Create("Services", "Catégorie de test").Value;
        context.ProductCategories.Add(category);
        await context.SaveChangesAsync();

        var product = Product.Create(
            code: code,
            name: "Produit Test",
            type: ProductType.Service,
            unitPrice: Money.Create(unitPrice, "TND"),
            vatRate: VatRate.Standard,
            categoryId: category.Id).Value;

        context.Products.Add(product);
        await context.SaveChangesAsync();
        return product;
    }

    private async Task<Invoice> AddInvoiceWithLineAsync(
        Client client, Product product, DateTime issueDate, DateTime dueDate, int sequence, decimal quantity)
    {
        var invoice = Invoice.Create(
            number: InvoiceNumber.Create("FAC", 2026, sequence),
            client: client,
            issueDate: issueDate,
            dueDate: dueDate,
            reference: $"REF-{sequence:000}").Value;

        Assert.True(invoice.AddLine(product, quantity).IsSuccess);
        return await _repository.AddAsync(invoice);
    }

    private async Task<Invoice> AddTypedDocumentAsync(
        Client client,
        DateTime issueDate,
        int sequence,
        InvoiceType type,
        Guid? linkedInvoiceId = null)
    {
        var invoice = type == InvoiceType.CreditNote
            ? Invoice.CreateCreditNote(
                number: InvoiceNumber.Create("AVO", 2026, sequence),
                client: client,
                issueDate: issueDate,
                linkedInvoiceId: linkedInvoiceId ?? Guid.NewGuid(),
                dueDate: issueDate.AddDays(30),
                reference: $"AVO-REF-{sequence:000}").Value
            : Invoice.Create(
                number: InvoiceNumber.Create("FAC", 2026, sequence),
                client: client,
                issueDate: issueDate,
                dueDate: issueDate.AddDays(30),
                reference: $"REF-{sequence:000}").Value;

        return await _repository.AddAsync(invoice);
    }

    [Fact]
    public async Task SearchAsync_TypeNull_ReturnsInvoicesAndCreditNotes()
    {
        var client = await CreateClientAsync(
            name: "Client Type Mix",
            email: "typemix@test.com",
            nifValue: "1234567/A/B/C/070");
        var today = DateTime.UtcNow.Date;

        var fac = await AddTypedDocumentAsync(client, today, 1, InvoiceType.Standard);
        await AddTypedDocumentAsync(client, today, 1, InvoiceType.CreditNote, fac.Id);

        var (items, count) = await _repository.SearchAsync(
            null, null, null, null, null, 1, 20, unpaidOnly: false, type: null);

        Assert.Equal(2, count);
        Assert.Equal(2, items.Count);
        Assert.Contains(items, i => i.Type == InvoiceType.Standard);
        Assert.Contains(items, i => i.Type == InvoiceType.CreditNote);
    }

    [Fact]
    public async Task SearchAsync_TypeStandard_ExcludesCreditNotes()
    {
        var client = await CreateClientAsync(
            name: "Client Type Fac",
            email: "typefac@test.com",
            nifValue: "1234567/A/B/C/071");
        var today = DateTime.UtcNow.Date;

        var fac = await AddTypedDocumentAsync(client, today, 1, InvoiceType.Standard);
        await AddTypedDocumentAsync(client, today, 1, InvoiceType.CreditNote, fac.Id);

        var (items, count) = await _repository.SearchAsync(
            null, null, null, null, null, 1, 20, unpaidOnly: false, type: InvoiceType.Standard);

        Assert.Equal(1, count);
        var only = Assert.Single(items);
        Assert.Equal(InvoiceType.Standard, only.Type);
        Assert.Equal(fac.Id, only.Id);
    }

    [Fact]
    public async Task SearchAsync_TypeCreditNote_ExcludesStandardInvoices()
    {
        var client = await CreateClientAsync(
            name: "Client Type Avo",
            email: "typeavo@test.com",
            nifValue: "1234567/A/B/C/072");
        var today = DateTime.UtcNow.Date;

        var fac = await AddTypedDocumentAsync(client, today, 1, InvoiceType.Standard);
        var avo = await AddTypedDocumentAsync(client, today, 1, InvoiceType.CreditNote, fac.Id);

        var (items, count) = await _repository.SearchAsync(
            null, null, null, null, null, 1, 20, unpaidOnly: false, type: InvoiceType.CreditNote);

        Assert.Equal(1, count);
        var only = Assert.Single(items);
        Assert.Equal(InvoiceType.CreditNote, only.Type);
        Assert.Equal(avo.Id, only.Id);
    }

    [Fact]
    public async Task SearchAsync_UnpaidOnlyAndStandard_ExcludesUnpaidCreditNotes()
    {
        var client = await CreateClientAsync(
            name: "Client Type Unpaid",
            email: "typeunpaid@test.com",
            nifValue: "1234567/A/B/C/073");
        var today = DateTime.UtcNow.Date;

        var fac = await AddTypedDocumentAsync(client, today, 1, InvoiceType.Standard);
        await AddTypedDocumentAsync(client, today, 1, InvoiceType.CreditNote, fac.Id);

        var (items, count) = await _repository.SearchAsync(
            null, null, null, null, null, 1, 20, unpaidOnly: true, type: InvoiceType.Standard);

        Assert.Equal(1, count);
        var only = Assert.Single(items);
        Assert.Equal(InvoiceType.Standard, only.Type);
        Assert.Equal(fac.Id, only.Id);
    }

    [Fact]
    public async Task GetSummaryAsync_TypeFilter_CountsOnlyMatchingDocuments()
    {
        var client = await CreateClientAsync(
            name: "Client Summary Type",
            email: "summarytype@test.com",
            nifValue: "1234567/A/B/C/074");
        var today = DateTime.UtcNow.Date;

        var fac = await AddTypedDocumentAsync(client, today, 1, InvoiceType.Standard);
        await AddTypedDocumentAsync(client, today, 1, InvoiceType.CreditNote, fac.Id);

        var all = await _repository.GetSummaryAsync(null, null, null, null, null, false, type: null);
        var facOnly = await _repository.GetSummaryAsync(null, null, null, null, null, false, type: InvoiceType.Standard);
        var avoOnly = await _repository.GetSummaryAsync(null, null, null, null, null, false, type: InvoiceType.CreditNote);

        Assert.Equal(2, all.Count);
        Assert.Equal(1, facOnly.Count);
        Assert.Equal(1, avoOnly.Count);
    }

    [Fact]
    public async Task GetForReportAsync_TypeCreditNote_ReturnsOnlyCreditNotes()
    {
        var client = await CreateClientAsync(
            name: "Client Report Type",
            email: "reporttype@test.com",
            nifValue: "1234567/A/B/C/075");
        var today = new DateTime(2026, 3, 1);

        var fac = await AddTypedDocumentAsync(client, today, 1, InvoiceType.Standard);
        var avo = await AddTypedDocumentAsync(client, today, 1, InvoiceType.CreditNote, fac.Id);

        var all = await _repository.GetForReportAsync(fromDate: null, toDate: null, clientId: null, type: null);
        var facOnly = await _repository.GetForReportAsync(fromDate: null, toDate: null, clientId: null, type: InvoiceType.Standard);
        var avoOnly = await _repository.GetForReportAsync(fromDate: null, toDate: null, clientId: null, type: InvoiceType.CreditNote);

        Assert.Equal(2, all.Count);
        Assert.Single(facOnly);
        Assert.Equal(fac.Id, facOnly[0].Id);
        Assert.Single(avoOnly);
        Assert.Equal(avo.Id, avoOnly[0].Id);
    }

    [Fact]
    public async Task GetSalesRevenueAggregated_OnlyCountsPaidAndValidatedInvoices()
    {
        // Arrange — un produit réutilisé, 4 factures aux statuts différents, même jour.
        var client = await CreateClientAsync(
            name: "Client CA",
            email: "ca@test.com",
            nifValue: "1234567/A/B/C/060");
        var product = await CreateProductAsync(code: "PRODCA", unitPrice: 100.000m);
        var issue = new DateTime(2026, 6, 20);

        // Validée → comptée
        await AddInvoiceWithStatusAsync(client, product, issue, 1, inv => Assert.True(inv.Validate().IsSuccess));
        // Payée → comptée
        await AddInvoiceWithStatusAsync(client, product, issue, 2, inv =>
        {
            Assert.True(inv.Validate().IsSuccess);
            inv.ReconcilePaymentStatus(inv.TotalAmount.Amount, issue);
        });
        // Brouillon → exclue
        await AddInvoiceWithStatusAsync(client, product, issue, 3, _ => { });
        // Annulée → exclue
        await AddInvoiceWithStatusAsync(client, product, issue, 4, inv => Assert.True(inv.Cancel("test").IsSuccess));

        // Act
        var rows = await _repository.GetSalesRevenueAggregatedAsync(issue, issue, SalesRevenueGroupBy.Product);

        // Assert — seules Validée + Payée comptent : 2 × 119 (HT 100 + TVA 19 %).
        // Sans le filtre de statut, on obtiendrait 476 (Brouillon + Annulée inclus).
        var row = Assert.Single(rows);
        Assert.Equal("Produit Test", row.GroupKey);
        Assert.Equal(238.000m, row.Revenue);
    }

    private async Task<Invoice> AddInvoiceWithStatusAsync(
        Client client, Product product, DateTime issueDate, int sequence, Action<Invoice> mutate)
    {
        var invoice = Invoice.Create(
            number: InvoiceNumber.Create("FAC", 2026, sequence),
            client: client,
            issueDate: issueDate,
            dueDate: issueDate.AddDays(30),
            reference: $"REF-{sequence:000}").Value;

        Assert.True(invoice.AddLine(product, 1).IsSuccess);
        mutate(invoice);
        return await _repository.AddAsync(invoice);
    }

    private async Task AddPaymentAsync(Invoice invoice, decimal amount)
    {
        using var context = _contextFactory.CreateContext();
        var tracked = await context.Invoices.FirstAsync(i => i.Id == invoice.Id);
        var payment = Payment.Create(tracked, Money.Create(amount, "TND"), DateTime.UtcNow.Date, PaymentMethod.Cash).Value;
        context.Payments.Add(payment);
        await context.SaveChangesAsync();
    }

    private async Task<Invoice> AddTypedInvoiceWithLineAsync(
        Client client,
        Product product,
        DateTime issueDate,
        int sequence,
        InvoiceType type,
        Guid? linkedInvoiceId,
        Action<Invoice> mutate)
    {
        var invoice = type == InvoiceType.CreditNote
            ? Invoice.CreateCreditNote(
                number: InvoiceNumber.Create("AVO", 2026, sequence),
                client: client,
                issueDate: issueDate,
                linkedInvoiceId: linkedInvoiceId ?? Guid.NewGuid(),
                dueDate: issueDate.AddDays(30),
                reference: $"AVO-REF-{sequence:000}").Value
            : Invoice.Create(
                number: InvoiceNumber.Create("FAC", 2026, sequence),
                client: client,
                issueDate: issueDate,
                dueDate: issueDate.AddDays(30),
                reference: $"REF-{sequence:000}").Value;

        Assert.True(invoice.AddLine(product, 1).IsSuccess);
        mutate(invoice);
        return await _repository.AddAsync(invoice);
    }

    [Fact]
    public async Task SearchAsync_RealizedRevenueOnly_ReturnsOnlyPaidAndValidated()
    {
        // Arrange — un document par statut : Brouillon, Validée, Signée, Payée, Annulée.
        var client = await CreateClientAsync(
            name: "Client CA Statuts",
            email: "castatuts@test.com",
            nifValue: "1234567/A/B/C/080");
        var product = await CreateProductAsync(code: "PRODSTAT", unitPrice: 100.000m);
        var issue = new DateTime(2026, 6, 1);

        var draft = await AddInvoiceWithStatusAsync(client, product, issue, 1, _ => { });
        var validated = await AddInvoiceWithStatusAsync(client, product, issue, 2,
            inv => Assert.True(inv.Validate().IsSuccess));
        var signed = await AddInvoiceWithStatusAsync(client, product, issue, 3, inv =>
        {
            Assert.True(inv.Validate().IsSuccess);
            Assert.True(inv.Sign("hash", "tester").IsSuccess);
        });
        var paid = await AddInvoiceWithStatusAsync(client, product, issue, 4, inv =>
        {
            Assert.True(inv.Validate().IsSuccess);
            inv.ReconcilePaymentStatus(inv.TotalAmount.Amount, issue);
        });
        var cancelled = await AddInvoiceWithStatusAsync(client, product, issue, 5,
            inv => Assert.True(inv.Cancel("test").IsSuccess));

        // Act
        var (items, count) = await _repository.SearchAsync(
            null, null, null, null, null, 1, 20, unpaidOnly: false, type: null, realizedRevenueOnly: true);

        // Assert — seules Validée et Payée comptent (miroir de IsRealizedRevenue / REALIZED_REVENUE_STATUSES).
        Assert.Equal(2, count);
        Assert.Equal(2, items.Count);
        Assert.Contains(items, i => i.Id == validated.Id);
        Assert.Contains(items, i => i.Id == paid.Id);
        Assert.DoesNotContain(items, i => i.Id == draft.Id);
        Assert.DoesNotContain(items, i => i.Id == signed.Id);
        Assert.DoesNotContain(items, i => i.Id == cancelled.Id);
    }

    [Fact]
    public async Task SearchAsync_RealizedRevenueOnlyAndUnpaidOnly_ReturnsValidatedOnly()
    {
        // Arrange — realizedRevenueOnly ∧ unpaidOnly ne laisse que Validée (Payée est exclue par unpaidOnly).
        var client = await CreateClientAsync(
            name: "Client CA Unpaid",
            email: "caunpaid@test.com",
            nifValue: "1234567/A/B/C/081");
        var product = await CreateProductAsync(code: "PRODUNPAID", unitPrice: 100.000m);
        var issue = new DateTime(2026, 6, 1);

        var validated = await AddInvoiceWithStatusAsync(client, product, issue, 1,
            inv => Assert.True(inv.Validate().IsSuccess));
        await AddInvoiceWithStatusAsync(client, product, issue, 2, inv =>
        {
            Assert.True(inv.Validate().IsSuccess);
            inv.ReconcilePaymentStatus(inv.TotalAmount.Amount, issue);
        });

        // Act
        var (items, count) = await _repository.SearchAsync(
            null, null, null, null, null, 1, 20, unpaidOnly: true, type: null, realizedRevenueOnly: true);

        // Assert
        Assert.Equal(1, count);
        var only = Assert.Single(items);
        Assert.Equal(validated.Id, only.Id);
    }

    [Fact]
    public async Task GetSummaryAsync_RealizedRevenueOnly_SumsSignedHtOfInvoicesAndCreditNotes()
    {
        // Arrange — une FAC validée avec ligne, un AVO validé avec ligne (HT signé négatif).
        var client = await CreateClientAsync(
            name: "Client CA Mix",
            email: "camix@test.com",
            nifValue: "1234567/A/B/C/082");
        var product = await CreateProductAsync(code: "PRODMIX", unitPrice: 100.000m);
        var issue = new DateTime(2026, 6, 1);

        var fac = await AddTypedInvoiceWithLineAsync(client, product, issue, 1, InvoiceType.Standard, null,
            inv => Assert.True(inv.Validate().IsSuccess));
        var avo = await AddTypedInvoiceWithLineAsync(client, product, issue, 2, InvoiceType.CreditNote, fac.Id,
            inv => Assert.True(inv.Validate().IsSuccess));

        Assert.True(avo.SubTotal.Amount < 0, "Un avoir doit avoir un HT signé négatif");

        // Sanity : un AVO sans ligne vaut 0 (invariant utilisé par RealizedRevenueHt / CreditNotesHt).
        var emptyCreditNote = Invoice.CreateCreditNote(
            number: InvoiceNumber.Create("AVO", 2026, 99),
            client: client,
            issueDate: issue,
            linkedInvoiceId: fac.Id).Value;
        Assert.Equal(0m, emptyCreditNote.SubTotal.Amount);

        // Act — filtre actif : seuls FAC validée + AVO validé comptent (il n'y en a pas d'autres ici).
        var summary = await _repository.GetSummaryAsync(
            null, null, null, null, null, false, type: null, realizedRevenueOnly: true);

        // Assert
        var expectedHt = Math.Round(fac.SubTotal.Amount + avo.SubTotal.Amount, 3);
        Assert.Equal(2, summary.Count);
        Assert.Equal(expectedHt, summary.TotalHt);
        Assert.Equal(expectedHt, summary.RealizedRevenueHt);
        Assert.Equal(Math.Round(fac.SubTotal.Amount, 3), summary.InvoicesHt);
        Assert.Equal(Math.Round(avo.SubTotal.Amount, 3), summary.CreditNotesHt);
    }

    [Fact]
    public async Task GetSummaryAsync_WithoutFilter_RealizedRevenueHtIgnoresNonRealized()
    {
        // Arrange — une Validée (comptée) et une Signée (comptée dans TotalHt, pas dans RealizedRevenueHt).
        var client = await CreateClientAsync(
            name: "Client CA Signee",
            email: "casignee@test.com",
            nifValue: "1234567/A/B/C/083");
        var product = await CreateProductAsync(code: "PRODSIGNEE", unitPrice: 100.000m);
        var issue = new DateTime(2026, 6, 1);

        var validated = await AddInvoiceWithStatusAsync(client, product, issue, 1,
            inv => Assert.True(inv.Validate().IsSuccess));
        var signed = await AddInvoiceWithStatusAsync(client, product, issue, 2, inv =>
        {
            Assert.True(inv.Validate().IsSuccess);
            Assert.True(inv.Sign("hash", "tester").IsSuccess);
        });

        // Act — pas de filtre : TotalHt inclut tout, RealizedRevenueHt exclut la Signée.
        var summary = await _repository.GetSummaryAsync(
            null, null, null, null, null, false, type: null, realizedRevenueOnly: false);

        // Assert
        Assert.Equal(2, summary.Count);
        Assert.Equal(Math.Round(validated.SubTotal.Amount + signed.SubTotal.Amount, 3), summary.TotalHt);
        Assert.Equal(Math.Round(validated.SubTotal.Amount, 3), summary.RealizedRevenueHt);
    }

    public void Dispose()
    {
        // Nettoyer la base de données InMemory
        using var context = _contextFactory.CreateContext();
        context.Database.EnsureDeleted();
    }
}
