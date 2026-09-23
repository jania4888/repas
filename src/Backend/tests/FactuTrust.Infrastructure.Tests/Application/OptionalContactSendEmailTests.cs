using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Invoices.Commands;
using FactuTrust.Application.Features.PurchaseOrders.Commands;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Configuration;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class OptionalContactSendEmailTests
{
    [Fact]
    public async Task SendInvoice_WithoutClientEmail_FailsAndDoesNotCallSmtp()
    {
        var client = Client.Create(
            "Client sans mail",
            ClientType.Individual,
            Address.Create("1 rue Test", "Tunis", "Tunis").Value,
            email: null).Value;
        var invoice = Invoice.Create(InvoiceNumber.Create("FAC", 2026, 1), client, new DateTime(2026, 9, 1)).Value;

        var invoices = new Mock<IInvoiceRepository>();
        invoices.Setup(x => x.GetByIdWithLinesAsync(invoice.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(invoice);
        var email = new Mock<IEmailService>();

        var handler = new SendInvoiceEmailCommandHandler(
            invoices.Object,
            new Mock<IPdfService>().Object,
            new Mock<IInvoicePdfContextLoader>().Object,
            email.Object,
            new Mock<IUnitOfWork>().Object,
            new Mock<ICurrentUser>().Object,
            new Mock<IAuditService>().Object,
            new Mock<IClientPortalService>().Object,
            new Mock<ICompanyRepository>().Object,
            new ConfigurationBuilder().Build());

        var result = await handler.Handle(new SendInvoiceEmailCommand(invoice.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("adresse email", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        email.Verify(x => x.SendEmailAsync(
            It.IsAny<string>(),
            It.IsAny<string>(),
            It.IsAny<string>(),
            It.IsAny<IEnumerable<EmailAttachment>?>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task SendPurchaseOrder_WithoutSupplierEmail_FailsAndDoesNotCallSmtp()
    {
        var supplier = Supplier.Create(
            "Fournisseur sans mail",
            SupplierType.Individual,
            Address.Create("1 rue Test", "Tunis", "Tunis").Value,
            email: null).Value;
        var order = PurchaseOrder.Create(
            PurchaseOrderNumber.Create("BC", 2026, 1),
            supplier,
            new DateTime(2026, 9, 1)).Value;

        var orders = new Mock<IPurchaseOrderRepository>();
        orders.Setup(x => x.GetByIdWithLinesAsync(order.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(order);
        var email = new Mock<IEmailService>();

        var handler = new SendPurchaseOrderEmailCommandHandler(
            orders.Object,
            new Mock<IPdfService>().Object,
            email.Object,
            new Mock<IAuditService>().Object);

        var result = await handler.Handle(new SendPurchaseOrderEmailCommand(order.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("adresse email", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        email.Verify(x => x.SendEmailAsync(
            It.IsAny<string>(),
            It.IsAny<string>(),
            It.IsAny<string>(),
            It.IsAny<IEnumerable<EmailAttachment>?>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }
}
