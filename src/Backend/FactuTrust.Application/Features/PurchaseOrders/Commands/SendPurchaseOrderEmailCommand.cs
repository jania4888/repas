using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using MediatR;

namespace FactuTrust.Application.Features.PurchaseOrders.Commands;

/// <summary>
/// Command to send a purchase order by email to the supplier.
/// Generates the PDF and sends it as an attachment.
/// </summary>
public sealed record SendPurchaseOrderEmailCommand(Guid PurchaseOrderId) : IRequest<Result>;

/// <summary>
/// Handler for SendPurchaseOrderEmailCommand.
/// </summary>
public sealed class SendPurchaseOrderEmailCommandHandler : IRequestHandler<SendPurchaseOrderEmailCommand, Result>
{
    private readonly IPurchaseOrderRepository _purchaseOrderRepository;
    private readonly IPdfService _pdfService;
    private readonly IEmailService _emailService;
    private readonly IAuditService _auditService;

    public SendPurchaseOrderEmailCommandHandler(
        IPurchaseOrderRepository purchaseOrderRepository,
        IPdfService pdfService,
        IEmailService emailService,
        IAuditService auditService)
    {
        _purchaseOrderRepository = purchaseOrderRepository;
        _pdfService = pdfService;
        _emailService = emailService;
        _auditService = auditService;
    }

    public async Task<Result> Handle(SendPurchaseOrderEmailCommand request, CancellationToken cancellationToken)
    {
        var po = await _purchaseOrderRepository.GetByIdWithLinesAsync(request.PurchaseOrderId, cancellationToken);
        if (po is null)
            return Result.Failure(Error.NotFound("PurchaseOrder", request.PurchaseOrderId));

        var recipientEmail = po.Supplier?.Email?.Value;
        if (string.IsNullOrWhiteSpace(recipientEmail))
            return Result.Failure(Error.Validation("Supplier", "Le fournisseur n'a pas d'adresse email."));

        // Generate PDF
        var pdfBytes = await _pdfService.GeneratePurchaseOrderPdfAsync(po, cancellationToken);
        var fileName = $"BC_{po.Number.Value}.pdf";

        // Compose email
        var subject = $"Bon de commande {po.Number.Value}";
        var supplierName = po.Supplier!.Name;
        var htmlBody = $@"
            <h2>Bon de commande {po.Number.Value}</h2>
            <p>Bonjour {supplierName},</p>
            <p>Veuillez trouver ci-joint notre bon de commande <strong>{po.Number.Value}</strong> 
               en date du {po.OrderDate:dd/MM/yyyy}.</p>
            <p>Montant total TTC : <strong>{po.TotalAmount.Amount:N3} TND</strong></p>
            {(po.ExpectedDeliveryDate.HasValue ? $"<p>Date de livraison souhaitée : <strong>{po.ExpectedDeliveryDate:dd/MM/yyyy}</strong></p>" : "")}
            <p>Nous vous remercions pour votre collaboration.</p>
            <p>Cordialement,</p>";

        var attachments = new[]
        {
            new EmailAttachment
            {
                FileName = fileName,
                Content = pdfBytes,
                ContentType = "application/pdf"
            }
        };

        await _emailService.SendEmailAsync(
            recipientEmail,
            subject,
            htmlBody,
            attachments,
            cancellationToken);

        await _auditService.LogAsync(
            AuditActions.PurchaseOrder.Sent,
            "PurchaseOrder",
            po.Id,
            newValues: new
            {
                Number = po.Number.Value,
                SupplierEmail = recipientEmail
            },
            cancellationToken: cancellationToken);

        return Result.Success();
    }
}
