using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using MediatR;
using Microsoft.Extensions.Configuration;

namespace FactuTrust.Application.Features.Invoices.Commands;

/// <summary>
/// Command to send an invoice by email to the client.
/// Generates the PDF and sends it as an attachment. Does not change the invoice status.
/// </summary>
public sealed record SendInvoiceEmailCommand(Guid InvoiceId) : IRequest<Result>;

/// <summary>
/// Handler for SendInvoiceEmailCommand.
/// </summary>
public sealed class SendInvoiceEmailCommandHandler : IRequestHandler<SendInvoiceEmailCommand, Result>
{
    private readonly IInvoiceRepository _invoiceRepository;
    private readonly IPdfService _pdfService;
    private readonly IInvoicePdfContextLoader _invoicePdfContextLoader;
    private readonly IEmailService _emailService;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;
    private readonly IClientPortalService _clientPortalService;
    private readonly ICompanyRepository _companyRepository;
    private readonly IConfiguration _configuration;

    public SendInvoiceEmailCommandHandler(
        IInvoiceRepository invoiceRepository,
        IPdfService pdfService,
        IInvoicePdfContextLoader invoicePdfContextLoader,
        IEmailService emailService,
        IUnitOfWork unitOfWork,
        ICurrentUser currentUser,
        IAuditService auditService,
        IClientPortalService clientPortalService,
        ICompanyRepository companyRepository,
        IConfiguration configuration)
    {
        _invoiceRepository = invoiceRepository;
        _pdfService = pdfService;
        _invoicePdfContextLoader = invoicePdfContextLoader;
        _emailService = emailService;
        _unitOfWork = unitOfWork;
        _currentUser = currentUser;
        _auditService = auditService;
        _clientPortalService = clientPortalService;
        _companyRepository = companyRepository;
        _configuration = configuration;
    }

    public async Task<Result> Handle(SendInvoiceEmailCommand request, CancellationToken cancellationToken)
    {
        var invoice = await _invoiceRepository.GetByIdWithLinesAsync(request.InvoiceId, cancellationToken);
        if (invoice is null)
            return Result.Failure(Error.NotFound("Facture", request.InvoiceId));

        var recipientEmail = invoice.Client?.Email?.Value;
        if (string.IsNullOrWhiteSpace(recipientEmail))
            return Result.Failure(Error.Validation("Client", "Le client n'a pas d'adresse email."));

        // Generate PDF
        var pdfContext = await _invoicePdfContextLoader.LoadAsync(invoice, cancellationToken);
        var pdfBytes = await _pdfService.GenerateInvoicePdfAsync(pdfContext, cancellationToken);
        var fileName = $"Facture_{invoice.Number.Value}.pdf";

        // Compose email
        var subject = $"Facture {invoice.Number.Value}";
        var clientName = invoice.Client!.Name;
        var htmlBody = $@"
            <h2>Facture {invoice.Number.Value}</h2>
            <p>Bonjour {clientName},</p>
            <p>Veuillez trouver ci-joint notre facture <strong>{invoice.Number.Value}</strong> 
               en date du {invoice.IssueDate:dd/MM/yyyy}.</p>
            <p>Montant total TTC : <strong>{invoice.TotalAmount.Amount:N3} TND</strong></p>
            {(invoice.DueDate.HasValue ? $"<p>Date d'échéance : <strong>{invoice.DueDate:dd/MM/yyyy}</strong></p>" : "")}
            {await BuildPortalCtaHtmlAsync(invoice.ClientId, invoice.Id, cancellationToken)}
            <p>Nous vous remercions pour votre confiance.</p>
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

        // Send Email
        await _emailService.SendEmailAsync(
            recipientEmail,
            subject,
            htmlBody,
            attachments,
            cancellationToken);

        // Record SentAt for audit trail (does not change status)
        invoice.SetSentAt(DateTime.UtcNow);
        invoice.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system", isUpdate: true);
        await _invoiceRepository.UpdateAsync(invoice, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        await _auditService.LogAsync(
            AuditActions.Invoice.Sent,
            "Invoice",
            invoice.Id,
            newValues: new
            {
                Number = invoice.Number.Value,
                ClientEmail = recipientEmail
            },
            cancellationToken: cancellationToken);

        return Result.Success();
    }

    private async Task<string> BuildPortalCtaHtmlAsync(
        Guid clientId,
        Guid invoiceId,
        CancellationToken cancellationToken)
    {
        var company = await _companyRepository.GetDefaultAsync(cancellationToken);
        if (company is null || !company.ClientPortalEnabled)
            return string.Empty;

        if (!await _clientPortalService.HasActiveContactAsync(clientId, cancellationToken))
            return string.Empty;

        var baseUrl = (_configuration["App:FrontendBaseUrl"] ?? "http://localhost:4200").TrimEnd('/');
        var portalUrl = $"{baseUrl}/portal/invoices/{invoiceId}";
        var safeUrl = System.Net.WebUtility.HtmlEncode(portalUrl);
        return $"""
            <p><a href="{safeUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;">Consulter dans l'espace client</a></p>
            """;
    }
}
