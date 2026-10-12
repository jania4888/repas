using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Invoices.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Tests for <see cref="GetInvoicesQueryHandler"/>, notably that <see cref="InvoiceListDto.SubTotal"/>
/// (HT signé) is copied from the domain entity and stays negative for a credit note (AVO).
/// </summary>
public sealed class GetInvoicesQueryHandlerTests
{
    private static Client CreateClient(string name = "Client Test")
    {
        var address = Address.Create("1 Rue Test", "Tunis", "1000", "Tunisie").Value;
        var email = Email.Create("client@test.com").Value;
        var nif = NIF.Create("1234567/A/B/C/000").Value;

        return Client.Create(
            name: name,
            type: ClientType.Business,
            address: address,
            email: email,
            nif: nif).Value;
    }

    private static Product CreateProduct(decimal unitPrice)
    {
        var category = ProductCategory.Create("Services", "Catégorie de test").Value;

        return Product.Create(
            code: "PRODHANDLER",
            name: "Produit Test",
            type: ProductType.Service,
            unitPrice: Money.Create(unitPrice, "TND"),
            vatRate: VatRate.Standard,
            categoryId: category.Id).Value;
    }

    private static Invoice CreateInvoiceWithLine(Client client, Product product, int sequence)
    {
        var invoice = Invoice.Create(
            number: InvoiceNumber.Create("FAC", 2026, sequence),
            client: client,
            issueDate: DateTime.UtcNow.Date,
            dueDate: DateTime.UtcNow.Date.AddDays(30)).Value;

        Assert.True(invoice.AddLine(product, quantity: 1).IsSuccess);
        return invoice;
    }

    private static Invoice CreateCreditNoteWithLine(Client client, Product product, int sequence, Guid linkedInvoiceId)
    {
        var creditNote = Invoice.CreateCreditNote(
            number: InvoiceNumber.Create("AVO", 2026, sequence),
            client: client,
            issueDate: DateTime.UtcNow.Date,
            linkedInvoiceId: linkedInvoiceId,
            dueDate: DateTime.UtcNow.Date.AddDays(30)).Value;

        Assert.True(creditNote.AddLine(product, quantity: 1).IsSuccess);
        return creditNote;
    }

    [Fact]
    public async Task Handle_MapsSubTotal_PositiveForInvoiceNegativeForCreditNote()
    {
        var client = CreateClient();
        var product = CreateProduct(100.000m);

        var invoice = CreateInvoiceWithLine(client, product, sequence: 1);
        var creditNote = CreateCreditNoteWithLine(client, product, sequence: 2, linkedInvoiceId: invoice.Id);

        var invoiceRepository = new Mock<IInvoiceRepository>();
        invoiceRepository
            .Setup(r => r.SearchAsync(
                null, null, null, null, null, 1, 20, false, null, false, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new List<Invoice> { invoice, creditNote }, 2));

        var paymentRepository = new Mock<IPaymentRepository>();
        paymentRepository
            .Setup(r => r.GetTotalPaidByInvoiceIdsAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, decimal>());

        var handler = new GetInvoicesQueryHandler(invoiceRepository.Object, paymentRepository.Object);

        var result = await handler.Handle(new GetInvoicesQuery(), CancellationToken.None);

        Assert.Equal(2, result.Items.Count);

        var invoiceDto = Assert.Single(result.Items, i => i.Id == invoice.Id);
        var creditNoteDto = Assert.Single(result.Items, i => i.Id == creditNote.Id);

        Assert.Equal(invoice.SubTotal.Amount, invoiceDto.SubTotal);
        Assert.True(invoiceDto.SubTotal > 0);

        Assert.Equal(creditNote.SubTotal.Amount, creditNoteDto.SubTotal);
        Assert.True(creditNoteDto.SubTotal < 0, "Le HT signé d'un avoir doit être négatif");
    }

    [Fact]
    public async Task Handle_PassesRealizedRevenueOnlyToRepository()
    {
        var invoiceRepository = new Mock<IInvoiceRepository>();
        invoiceRepository
            .Setup(r => r.SearchAsync(
                null, null, null, null, null, 1, 20, false, null, true, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new List<Invoice>(), 0));

        var paymentRepository = new Mock<IPaymentRepository>();
        paymentRepository
            .Setup(r => r.GetTotalPaidByInvoiceIdsAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, decimal>());

        var handler = new GetInvoicesQueryHandler(invoiceRepository.Object, paymentRepository.Object);

        await handler.Handle(new GetInvoicesQuery(RealizedRevenueOnly: true), CancellationToken.None);

        invoiceRepository.Verify(r => r.SearchAsync(
            null, null, null, null, null, 1, 20, false, null, true, It.IsAny<CancellationToken>()), Times.Once);
    }
}
