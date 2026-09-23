using FactuTrust.Application.Common;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Pricing;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Stock.Services;
using FactuTrust.Application.Features.CashRegister;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Constants;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.InvoiceWizard.Commands;

/// <summary>
/// Command to submit a draft and create the final invoice.
/// Uses idempotency key to prevent double submissions.
/// </summary>
public sealed record SubmitInvoiceCommand(
    Guid DraftId,
    string IdempotencyKey) : IRequest<Result<InvoiceCreatedResultDto>>;

/// <summary>
/// Handler for SubmitInvoiceCommand.
/// </summary>
public sealed class SubmitInvoiceCommandHandler 
    : IRequestHandler<SubmitInvoiceCommand, Result<InvoiceCreatedResultDto>>
{
    private readonly IInvoiceDraftRepository _draftRepository;
    private readonly IInvoiceRepository _invoiceRepository;
    private readonly IClientRepository _clientRepository;
    private readonly ICompanyRepository _companyRepository;
    private readonly IProductRepository _productRepository;
    private readonly IInvoiceNumberGenerator _numberGenerator;
    private readonly IInvoiceComplianceValidator _complianceValidator;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;
    private readonly IWarehouseRepository _warehouseRepository;
    private readonly IFiscalStampResolver _fiscalStampResolver;
    private readonly ILinePricingOrchestrator _linePricingOrchestrator;
    private readonly IAccountingService _accountingService;
    private readonly AccountingSettings _accountingSettings;
    private readonly ILogger<SubmitInvoiceCommandHandler> _logger;
    private readonly ICashRegisterSessionRepository _cashRegisterSessions;
    private readonly ITrackedDocumentStockService _trackedStock;
    private readonly IRecurringContractInvoiceLinker _recurringContractLinker;
    private readonly IStockMovementRepository _stockMovementRepository;
    private readonly IStockItemRepository _stockItemRepository;

    public SubmitInvoiceCommandHandler(
        IInvoiceDraftRepository draftRepository,
        IInvoiceRepository invoiceRepository,
        IClientRepository clientRepository,
        ICompanyRepository companyRepository,
        IProductRepository productRepository,
        IInvoiceNumberGenerator numberGenerator,
        IInvoiceComplianceValidator complianceValidator,
        IUnitOfWork unitOfWork,
        ICurrentUser currentUser,
        IAuditService auditService,
        IWarehouseRepository warehouseRepository,
        IFiscalStampResolver fiscalStampResolver,
        ILinePricingOrchestrator linePricingOrchestrator,
        IAccountingService accountingService,
        IOptions<AccountingSettings> accountingSettings,
        ILogger<SubmitInvoiceCommandHandler> logger,
        ICashRegisterSessionRepository cashRegisterSessions,
        ITrackedDocumentStockService trackedStock,
        IRecurringContractInvoiceLinker recurringContractLinker,
        IStockMovementRepository stockMovementRepository,
        IStockItemRepository stockItemRepository)
    {
        _draftRepository = draftRepository;
        _invoiceRepository = invoiceRepository;
        _clientRepository = clientRepository;
        _companyRepository = companyRepository;
        _productRepository = productRepository;
        _numberGenerator = numberGenerator;
        _complianceValidator = complianceValidator;
        _unitOfWork = unitOfWork;
        _currentUser = currentUser;
        _auditService = auditService;
        _warehouseRepository = warehouseRepository;
        _fiscalStampResolver = fiscalStampResolver;
        _linePricingOrchestrator = linePricingOrchestrator;
        _accountingService = accountingService;
        _accountingSettings = accountingSettings.Value;
        _logger = logger;
        _cashRegisterSessions = cashRegisterSessions;
        _trackedStock = trackedStock;
        _recurringContractLinker = recurringContractLinker;
        _stockMovementRepository = stockMovementRepository;
        _stockItemRepository = stockItemRepository;
    }

    public async Task<Result<InvoiceCreatedResultDto>> Handle(
        SubmitInvoiceCommand command,
        CancellationToken cancellationToken)
    {
        // 1. Load and validate draft
        var draft = await _draftRepository.GetByIdAsync(command.DraftId, cancellationToken);
        
        if (draft is null)
            return Result.Failure<InvoiceCreatedResultDto>(
                Error.NotFound("Draft", command.DraftId));

        if (draft.IsExpired)
            return Result.Failure<InvoiceCreatedResultDto>(
                Error.Validation("Draft", "Ce brouillon a expiré"));

        // 2. Check for double submission
        var startResult = draft.StartSubmission(command.IdempotencyKey);
        if (startResult.IsFailure)
        {
            // If already converted, return the existing invoice
            if (draft.IsConverted && draft.ConvertedInvoiceId.HasValue)
            {
                var existingInvoice = await _invoiceRepository.GetByIdAsync(
                    draft.ConvertedInvoiceId.Value, cancellationToken);
                
                if (existingInvoice != null)
                {
                    return Result.Success(new InvoiceCreatedResultDto
                    {
                        InvoiceId = existingInvoice.Id,
                        InvoiceNumber = existingInvoice.Number.Value,
                        Status = existingInvoice.Status.ToDisplayString(),
                        CreatedAt = existingInvoice.CreatedAt
                    });
                }
            }
            
            return Result.Failure<InvoiceCreatedResultDto>(startResult.Error);
        }

        try
        {
            await _draftRepository.UpdateAsync(draft, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            // 3. Validate completeness
            if (!draft.IsComplete)
                return await FailSubmissionAsync(draft, 
                    Error.Validation("Draft", "Le brouillon est incomplet"));

            // 4. Run compliance validation
            var validation = await _complianceValidator.ValidateAsync(draft, cancellationToken);
            if (!validation.CanProceed)
            {
                var errors = string.Join(", ",
                    validation.Checks
                        .Where(c => c.Status == "ERROR" && c.IsBlocking)
                        .Select(c => string.IsNullOrWhiteSpace(c.Description)
                            ? c.Label
                            : $"{c.Label} : {c.Description}"));

                return await FailSubmissionAsync(draft,
                    Error.Validation("Compliance", $"Erreurs de conformité: {errors}"));
            }



            // 6. Get or create client
            var client = await GetOrCreateClientAsync(draft, cancellationToken);
            if (client is null)
                return await FailSubmissionAsync(draft, 
                    Error.NotFound("Client", draft.ClientId ?? Guid.Empty));


            // 8. Reserve invoice number (atomic operation)
            var tenantId = _currentUser.TenantId ?? Guid.Empty;
            var metadata = draft.GetMetadata()!;
            var prefix = draft.Type == InvoiceType.CreditNote ? "AVO" : "FAC";

            if (metadata.WarehouseId is { } warehouseId)
            {
                var warehouse = await _warehouseRepository.GetByIdAsync(warehouseId, cancellationToken);
                if (warehouse is null)
                    return await FailSubmissionAsync(draft, Error.NotFound("Warehouse", warehouseId));
                if (!warehouse.IsActive)
                    return await FailSubmissionAsync(draft,
                        Error.Validation("Warehouse", "Cet entrepôt est désactivé"));
            }

            var invoiceNumber = await _numberGenerator.ReserveNextNumberAsync(
                tenantId, prefix, metadata.IssueDate.Year, cancellationToken);

            _logger.LogInformation(
                "Reserved invoice number {Number} for draft {DraftId}",
                invoiceNumber.Value, draft.Id);

            // 9. Create invoice — un avoir porte le lien vers la facture rectifiée, jusqu'ici
            //    présent dans les métadonnées du brouillon mais jamais reporté sur l'agrégat.
            Result<Invoice> invoiceResult;
            if (draft.Type == InvoiceType.CreditNote)
            {
                if (metadata.LinkedInvoiceId is not { } linkedInvoiceId || linkedInvoiceId == Guid.Empty)
                    return await FailSubmissionAsync(draft,
                        Error.Validation("LinkedInvoiceId", "La facture d'origine est obligatoire pour un avoir"));

                invoiceResult = Invoice.CreateCreditNote(
                    invoiceNumber,
                    client,
                    metadata.IssueDate,
                    linkedInvoiceId,
                    metadata.DueDate,
                    metadata.InternalReference,
                    notes: null,
                    paymentTerms: draft.GetPaymentLegal()?.PaymentTerms,
                    warehouseId: metadata.WarehouseId);
            }
            else
            {
                invoiceResult = Invoice.Create(
                    invoiceNumber,
                    client,
                    metadata.IssueDate,
                    metadata.DueDate,
                    metadata.InternalReference,
                    notes: null,
                    paymentTerms: draft.GetPaymentLegal()?.PaymentTerms,
                    warehouseId: metadata.WarehouseId,
                    type: draft.Type);
            }

            if (invoiceResult.IsFailure)
                return await FailSubmissionAsync(draft, invoiceResult.Error);

            var invoice = invoiceResult.Value;

            invoice.SetIssuerCompanyId(draft.SellerId);

            if (metadata.CashRegisterSessionId is { } posSessionId && posSessionId != Guid.Empty)
            {
                var sessionStamp = await CashRegisterSessionGuard.ResolveOpenIdAsync(
                    _cashRegisterSessions, posSessionId, null, cancellationToken);
                if (sessionStamp.IsFailure)
                    return await FailSubmissionAsync(draft, sessionStamp.Error);
                if (sessionStamp.Value is { } openSessionId)
                    invoice.AssignCashRegisterSession(openSessionId);
            }

            // 10. Add invoice lines
            foreach (var line in draft.GetLines())
            {
                Product? product = null;
                Guid productId = Guid.Empty;
                var hasCatalogProductId = !string.IsNullOrEmpty(line.ProductId)
                    && Guid.TryParse(line.ProductId, out productId)
                    && productId != Guid.Empty;
                if (hasCatalogProductId)
                {
                    product = await _productRepository.GetByIdAsync(productId, cancellationToken);

                    // The line references a real catalog product but it could not be resolved
                    // (deleted, or not visible in this tenant context). Falling through to a custom
                    // line would set InvoiceLine.ProductId = null (custom line) and skip stock;
                    // a missing catalog product must fail fast with an actionable message instead
                    // (mirrors CreateInvoiceCommand's product validation).
                    if (product is null)
                        return await FailSubmissionAsync(draft, Error.NotFound("Produit", productId), cancellationToken);
                }

                var manualDiscountPercent = ResolveDraftDiscountPercent(line);
                var fodecRate = _accountingSettings.FodecRatePercent;
                Result addResult;
                if (draft.Type == InvoiceType.CreditNote)
                {
                    var unitPrice = Money.Create(line.UnitPriceHT, metadata.Currency);
                    addResult = invoice.AddSnapshotLine(
                        product,
                        line.Designation,
                        line.Description,
                        line.Quantity,
                        line.Unit ?? "Unité",
                        unitPrice,
                        MapDraftVatRate(line.VatRate),
                        manualDiscountPercent,
                        line.FodecApplicable,
                        fodecRate);
                }
                else if (product != null)
                {
                    Money? priceOverride = line.PriceOverridden
                        ? Money.Create(line.UnitPriceHT, metadata.Currency)
                        : null;

                    var pricing = await _linePricingOrchestrator.ResolveAsync(
                        client.Id,
                        product,
                        line.Quantity,
                        metadata.IssueDate,
                        manualDiscountPercent,
                        priceOverride,
                        cancellationToken);

                    if (pricing.IsFailure)
                        return await FailSubmissionAsync(draft, pricing.Error, cancellationToken);

                    addResult = invoice.AddLine(
                        product,
                        line.Quantity,
                        pricing.Value.UnitPriceHT,
                        pricing.Value.DiscountPercent,
                        fodecRate,
                        pricing.Value.AppliedPromotion?.PromotionId,
                        pricing.Value.AppliedPromotion?.PromotionName);
                }
                else
                {
                    var unitPrice = Money.Create(line.UnitPriceHT, metadata.Currency);
                    addResult = invoice.AddCustomLine(
                        line.Designation,
                        line.Description,
                        line.Quantity,
                        line.Unit ?? "Unité",
                        unitPrice,
                        MapDraftVatRate(line.VatRate),
                        manualDiscountPercent,
                        line.FodecApplicable,
                        fodecRate);
                }

                if (addResult.IsFailure)
                    return await FailSubmissionAsync(draft, addResult.Error, cancellationToken);
            }

            var stampMoney = await _fiscalStampResolver.ResolveSignedStampAsync(
                draft.Type == InvoiceType.CreditNote,
                cancellationToken);
            var stampResult = invoice.SetFiscalStampAmount(stampMoney);
            if (stampResult.IsFailure)
                return await FailSubmissionAsync(draft, stampResult.Error);

            // 11. Set payment info
            var paymentLegal = draft.GetPaymentLegal();
            if (paymentLegal != null)
            {
                invoice.SetPaymentInfo(
                    method: paymentLegal.PaymentMethod,
                    bankName: paymentLegal.BankName,
                    iban: paymentLegal.Iban,
                    rib: paymentLegal.Rib);

                if (!string.IsNullOrEmpty(paymentLegal.CustomMention))
                {
                    invoice.AddLegalMention(paymentLegal.CustomMention);
                }
            }

            // 10. Déduction / restauration stock articles suivis (FEFO auto — pas d'allocations au checkout POS/wizard)
            if (draft.Type == InvoiceType.CreditNote)
            {
                var restoreResult = await CreditNoteStockRestore.RestoreAsync(
                    invoice,
                    _invoiceRepository,
                    _productRepository,
                    _warehouseRepository,
                    _stockMovementRepository,
                    _stockItemRepository,
                    _trackedStock,
                    cancellationToken);
                if (restoreResult.IsFailure)
                    return await FailSubmissionAsync(draft, restoreResult.Error);
            }
            else
            {
                var stockResult = await DeductTrackedStockAsync(invoice, cancellationToken);
                if (stockResult.IsFailure)
                    return await FailSubmissionAsync(draft, stockResult.Error);
            }

            await _recurringContractLinker.LinkIfRecurringDraftAsync(draft.Id, invoice, cancellationToken);

            // 10. Validate the invoice (changes status from Draft to Validated)
            var validateResult = invoice.Validate();
            if (validateResult.IsFailure)
                return await FailSubmissionAsync(draft, validateResult.Error);

            invoice.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system");

            // 11. Save invoice
            await _invoiceRepository.AddAsync(invoice, cancellationToken);
            
            // 12. Mark draft as converted
            draft.MarkAsConverted(invoice.Id);
            await _draftRepository.UpdateAsync(draft, cancellationToken);

            // 12b. Écriture comptable — même routage que ValidateInvoiceCommand : avoir
            //      (miroir de la vente) ou écriture de vente. Générée AVANT le commit pour
            //      être persistée dans la même unité de travail que la facture. Idempotente
            //      par source (Invoice / InvoiceCreditNote) et non applicable (succès) si le
            //      tenant n'a pas de plan comptable initialisé.
            var entryResult = invoice.Type == InvoiceType.CreditNote
                ? await _accountingService.GenerateInvoiceCreditNoteEntryAsync(invoice, cancellationToken)
                : await _accountingService.GenerateInvoiceSaleEntryAsync(invoice, cancellationToken);

            if (entryResult.IsFailure)
                return await FailSubmissionAsync(draft, entryResult.Error);

            // 13. Commit transaction
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            // 14. Audit log
            await _auditService.LogAsync(
                AuditActions.Invoice.Created,
                "Invoice",
                invoice.Id,
                newValues: new 
                { 
                    invoice.Number.Value, 
                    invoice.TotalAmount.Amount,
                    FromDraft = draft.Id
                },
                cancellationToken: cancellationToken);

            _logger.LogInformation(
                "Successfully created invoice {InvoiceNumber} (ID: {InvoiceId}) from draft {DraftId}",
                invoice.Number.Value, invoice.Id, draft.Id);

            return Result.Success(new InvoiceCreatedResultDto
            {
                InvoiceId = invoice.Id,
                InvoiceNumber = invoice.Number.Value,
                Status = invoice.Status.ToDisplayString(),
                CreatedAt = invoice.CreatedAt
            });
        }
        catch (Exception ex)
        {
            if (SqlExceptionHelper.IsSchemaDrift(ex))
            {
                var sqlEx = SqlExceptionHelper.FindSqlException(ex)!;
                _logger.LogError(ex,
                    "Schema drift on invoice submit for draft {DraftId} (SqlError {Number}): {Detail}",
                    command.DraftId, sqlEx.Number, sqlEx.Message);

                return await FailSubmissionAsync(draft, Error.Validation(
                    "Submission",
                    "Le schéma de base de données n'est pas à jour pour cette entreprise. Lancez la migration."));
            }

            var detail = ex.InnerException?.Message ?? ex.Message;
            if (ex is DbUpdateException dbEx)
            {
                _logger.LogError(dbEx,
                    "Database error submitting invoice from draft {DraftId}: {Detail}. See inner exception for SQL details.",
                    command.DraftId, detail);

                // Keep the raw SQL detail in the logs only; surface a stable, non-leaky message.
                return await FailSubmissionAsync(draft,
                    Error.Validation("Submission", "Erreur lors de l'enregistrement de la facture en base de données."));
            }

            _logger.LogError(ex,
                "Failed to submit invoice from draft {DraftId}: {Detail}",
                command.DraftId, detail);

            // Surface the real (already French) domain/infrastructure message instead of an opaque
            // generic string, so the wizard and the POS can show an actionable error to the user
            // (e.g. an invalid numbering format). Aligns with the standard CreateInvoiceCommand path.
            return await FailSubmissionAsync(draft,
                Error.Validation("Submission", detail));
        }
    }

    private async Task<Client?> GetOrCreateClientAsync(
        InvoiceDraft draft, 
        CancellationToken cancellationToken)
    {
        if (draft.ClientId.HasValue)
        {
            return await _clientRepository.GetByIdAsync(
                draft.ClientId.Value, cancellationToken);
        }

        var newClientData = draft.GetNewClient();
        if (newClientData is null)
            return null;

        // Réutiliser l'unique "Client passager" seedé par tenant au lieu d'en créer un
        // nouveau à chaque vente POS sans client. Ciblé sur l'email passager pour ne PAS
        // modifier le comportement des autres "nouveaux clients" du wizard. Cohérent avec
        // l'invariant d'unicité d'email déjà appliqué par CreateClientCommand.
        if (!string.IsNullOrWhiteSpace(newClientData.Email) &&
            string.Equals(newClientData.Email.Trim(), DefaultPassengerClient.Email,
                StringComparison.OrdinalIgnoreCase))
        {
            var existingPassenger = await _clientRepository.GetByEmailAsync(
                newClientData.Email, cancellationToken);
            if (existingPassenger is not null)
                return existingPassenger;
            // Si introuvable (tenant ancien jamais seedé) : on laisse le code ci-dessous
            // créer UNE fois le passager ; les ventes suivantes le réutiliseront.
        }

        // Create new client
        var clientType = newClientData.TaxType switch
        {
            "TAX_SUBJECT" => ClientType.Business,
            "TAX_EXEMPT" => ClientType.Individual,
            _ => ClientType.Individual
        };

        NIF? nif = null;
        if (!string.IsNullOrEmpty(newClientData.Nif))
        {
            var nifResult = NIF.Create(newClientData.Nif);
            if (nifResult.IsSuccess)
                nif = nifResult.Value;
        }

        var addressResult = Address.Create(
            newClientData.Street ?? string.Empty,
            newClientData.City ?? string.Empty,
            newClientData.Governorate ?? string.Empty,
            newClientData.StreetLine2,
            newClientData.PostalCode,
            "Tunisie");

        if (addressResult.IsFailure)
            return null;

        var emailResult = Email.CreateOptional(newClientData.Email);
        if (emailResult.IsFailure)
            return null;

        PhoneNumber? phone = null;
        if (!string.IsNullOrEmpty(newClientData.Phone))
        {
            var phoneResult = PhoneNumber.Create(newClientData.Phone);
            if (phoneResult.IsSuccess)
                phone = phoneResult.Value;
        }

        var clientResult = Client.Create(
            newClientData.Name,
            clientType,
            addressResult.Value,
            emailResult.Value,
            nif,
            phone,
            newClientData.ContactPerson);

        if (clientResult.IsFailure)
            return null;

        var client = clientResult.Value;
        client.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system");

        await _clientRepository.AddAsync(client, cancellationToken);

        _logger.LogInformation(
            "Created new client {ClientName} (ID: {ClientId}) during invoice submission",
            client.Name, client.Id);

        return client;
    }

    private static decimal? ResolveDraftDiscountPercent(DraftInvoiceLine line)
    {
        if (!line.DiscountValue.HasValue || line.DiscountValue.Value <= 0)
            return null;

        if (line.DiscountType == "PERCENT")
            return line.DiscountValue;

        var gross = line.Quantity * line.UnitPriceHT;
        return gross > 0 ? (line.DiscountValue / gross) * 100 : null;
    }

    private static Domain.Enums.VatRate MapDraftVatRate(int vatRate) => vatRate switch
    {
        0 => Domain.Enums.VatRate.Exempt,
        7 => Domain.Enums.VatRate.Reduced,
        13 => Domain.Enums.VatRate.Intermediate,
        19 => Domain.Enums.VatRate.Standard,
        _ => Domain.Enums.VatRate.Standard
    };

    private async Task<Result<InvoiceCreatedResultDto>> FailSubmissionAsync(
        InvoiceDraft draft,
        Error error,
        CancellationToken cancellationToken = default)
    {
        draft.CancelSubmission();
        try
        {
            await _draftRepository.UpdateAsync(draft, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Failed to persist submission cancellation for draft {DraftId}",
                draft.Id);
        }

        _logger.LogWarning(
            "Invoice submission failed for draft {DraftId}: {ErrorCode} - {ErrorMessage}",
            draft.Id, error.Code, error.Description);

        return Result.Failure<InvoiceCreatedResultDto>(error);
    }

    private async Task<Result> DeductTrackedStockAsync(Invoice invoice, CancellationToken cancellationToken)
    {
        var lines = new List<TrackedDocumentLine>();
        var anyTracked = false;
        foreach (var line in invoice.Lines)
        {
            if (!line.ProductId.HasValue)
                continue;

            var product = await _productRepository.GetByIdAsync(line.ProductId.Value, cancellationToken);
            if (product is null || !product.IsStockManaged)
                continue;

            if (_trackedStock.IsLiveTracked(product))
                anyTracked = true;

            lines.Add(new TrackedDocumentLine(
                line.ProductId.Value,
                line.Quantity,
                line.Id,
                StockDocumentKind.Invoice));
        }

        if (!anyTracked)
            return Result.Success();

        Warehouse? warehouse = null;
        if (invoice.WarehouseId.HasValue)
            warehouse = await _warehouseRepository.GetByIdAsync(invoice.WarehouseId.Value, cancellationToken);
        warehouse ??= await _warehouseRepository.GetDefaultAsync(cancellationToken);
        if (warehouse is null)
            return Result.Failure(Error.Validation("Warehouse",
                "Un entrepôt est obligatoire pour valider une facture contenant des articles suivis."));

        return await _trackedStock.ApplyExitsAsync(
            warehouse.Id,
            $"Facture {invoice.Number.Value}",
            MovementReason.Sale,
            lines,
            cancellationToken,
            includeUntracked: true);
    }
}

