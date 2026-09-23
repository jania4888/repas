using FactuTrust.Application.Configuration;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Common.Validation;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.InvoiceWizard.Validators;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.InvoiceWizard.Commands;

/// <summary>
/// Command to save or update a draft invoice.
/// Supports partial saves for progressive wizard completion.
/// </summary>
public sealed record SaveDraftCommand(SaveDraftRequest Request) : IRequest<Result<DraftResponseDto>>;

/// <summary>
/// Handler for SaveDraftCommand.
/// </summary>
public sealed class SaveDraftCommandHandler : IRequestHandler<SaveDraftCommand, Result<DraftResponseDto>>
{
    private readonly IInvoiceDraftRepository _draftRepository;
    private readonly ICompanyRepository _companyRepository;
    private readonly IClientRepository _clientRepository;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ICurrentUser _currentUser;
    private readonly IFiscalStampResolver _fiscalStampResolver;
    private readonly AccountingSettings _accountingSettings;

    public SaveDraftCommandHandler(
        IInvoiceDraftRepository draftRepository,
        ICompanyRepository companyRepository,
        IClientRepository clientRepository,
        IUnitOfWork unitOfWork,
        ICurrentUser currentUser,
        IFiscalStampResolver fiscalStampResolver,
        IOptions<AccountingSettings> accountingSettings)
    {
        _draftRepository = draftRepository;
        _companyRepository = companyRepository;
        _clientRepository = clientRepository;
        _unitOfWork = unitOfWork;
        _currentUser = currentUser;
        _fiscalStampResolver = fiscalStampResolver;
        _accountingSettings = accountingSettings.Value;
    }

    public async Task<Result<DraftResponseDto>> Handle(
        SaveDraftCommand command, 
        CancellationToken cancellationToken)
    {
        var request = command.Request;
        InvoiceDraft draft;

        // Load or create draft
        if (request.DraftId.HasValue)
        {
            var existingDraft = await _draftRepository.GetByIdAsync(
                request.DraftId.Value, cancellationToken);

            if (existingDraft is null)
                return Result.Failure<DraftResponseDto>(
                    Error.NotFound("Draft", request.DraftId.Value));

            if (existingDraft.IsConverted)
                return Result.Failure<DraftResponseDto>(
                    Error.Conflict("Ce brouillon a déjà été converti en facture"));

            if (existingDraft.IsExpired)
                return Result.Failure<DraftResponseDto>(
                    Error.Validation("Draft", "Ce brouillon a expiré"));

            draft = existingDraft;
        }
        else
        {
            // Create new draft
            var type = request.Metadata?.Type == "CREDIT_NOTE" 
                ? InvoiceType.CreditNote 
                : InvoiceType.Standard;
            
            draft = InvoiceDraft.Create(type);
            draft.SetAuditInfo(_currentUser.UserId?.ToString() ?? "system");
        }

        // Update step data based on what's provided
        if (request.Metadata != null)
        {
            draft.UpdateMetadata(new DraftMetadata
            {
                Type = request.Metadata.Type == "CREDIT_NOTE" 
                    ? InvoiceType.CreditNote 
                    : InvoiceType.Standard,
                IssueDate = request.Metadata.IssueDate,
                DueDate = request.Metadata.DueDate,
                Currency = request.Metadata.Currency,
                InternalReference = request.Metadata.InternalReference,
                LinkedInvoiceId = request.Metadata.LinkedInvoiceId,
                WarehouseId = request.Metadata.WarehouseId,
                CashRegisterSessionId = request.Metadata.CashRegisterSessionId
            });
        }

        if (request.SellerId.HasValue)
        {
            // Validate seller exists
            var sellerExists = await _companyRepository.ExistsAsync(
                request.SellerId.Value, cancellationToken);
            
            if (!sellerExists)
                return Result.Failure<DraftResponseDto>(
                    Error.NotFound("Company", request.SellerId.Value));

            draft.UpdateSeller(request.SellerId.Value);
        }

        if (request.Client != null)
        {
            if (request.Client.IsNewClient && request.Client.NewClient != null)
            {
                draft.UpdateClient(null, new DraftNewClient
                {
                    Name = request.Client.NewClient.Name,
                    TaxType = request.Client.NewClient.TaxType,
                    Nif = request.Client.NewClient.Nif,
                    Street = request.Client.NewClient.Address.Street,
                    StreetLine2 = request.Client.NewClient.Address.StreetLine2,
                    PostalCode = request.Client.NewClient.Address.PostalCode,
                    City = request.Client.NewClient.Address.City,
                    Governorate = request.Client.NewClient.Address.Governorate,
                    Email = request.Client.NewClient.Email,
                    Phone = request.Client.NewClient.Phone,
                    ContactPerson = request.Client.NewClient.ContactPerson
                });
            }
            else if (request.Client.ClientId.HasValue)
            {
                // Validate client exists
                var clientExists = await _clientRepository.ExistsAsync(
                    request.Client.ClientId.Value, cancellationToken);
                
                if (!clientExists)
                    return Result.Failure<DraftResponseDto>(
                        Error.NotFound("Client", request.Client.ClientId.Value));

                draft.UpdateClient(request.Client.ClientId.Value, null);
            }
        }

        if (request.Lines != null && request.Lines.Count > 0)
        {
            draft.UpdateLines(request.Lines.Select(l => new DraftInvoiceLine
            {
                ProductId = l.ProductId,
                Designation = l.Designation,
                Description = l.Description,
                Quantity = l.Quantity,
                Unit = l.Unit,
                UnitPriceHT = l.UnitPriceHT,
                PriceOverridden = l.PriceOverridden,
                DiscountType = l.DiscountType,
                DiscountValue = l.DiscountValue,
                VatRate = l.VatRate,
                FodecApplicable = l.FodecApplicable
            }).ToList());
        }

        if (request.PaymentLegal != null)
        {
            draft.UpdatePaymentLegal(new DraftPaymentLegal
            {
                PaymentMethod = request.PaymentLegal.PaymentMethod,
                PaymentTerms = request.PaymentLegal.PaymentTerms,
                DaysUntilDue = request.PaymentLegal.DaysUntilDue,
                BankName = request.PaymentLegal.BankInfo?.BankName,
                Iban = request.PaymentLegal.BankInfo?.Iban,
                Rib = request.PaymentLegal.BankInfo?.Rib,
                PurchaseOrderRef = request.PaymentLegal.PurchaseOrderRef,
                VatMention = request.PaymentLegal.LegalMentions?.VatMention,
                ExemptionMention = request.PaymentLegal.LegalMentions?.ExemptionMention,
                CustomMention = request.PaymentLegal.LegalMentions?.CustomMention
            });
        }

        // Save
        if (!request.DraftId.HasValue)
        {
            await _draftRepository.AddAsync(draft, cancellationToken);
        }
        else
        {
            await _draftRepository.UpdateAsync(draft, cancellationToken);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // Build response
        var response = await BuildDraftResponseAsync(draft, cancellationToken);
        
        return Result.Success(response);
    }

    private async Task<DraftResponseDto> BuildDraftResponseAsync(
        InvoiceDraft draft, 
        CancellationToken cancellationToken)
    {
        SellerSummaryDto? seller = null;
        if (draft.SellerId.HasValue)
        {
            var company = await _companyRepository.GetByIdAsync(
                draft.SellerId.Value, cancellationToken);
            
            if (company != null)
            {
                seller = new SellerSummaryDto
                {
                    Id = company.Id,
                    CompanyName = company.Name,
                    TradeName = company.TradeName,
                    Nif = company.Nif?.Value ?? "",
                    Logo = company.LogoUrl,
                    Address = new WizardAddressDto
                    {
                        Street = company.Address.Street,
                        StreetLine2 = company.Address.StreetLine2,
                        PostalCode = company.Address.PostalCode,
                        City = company.Address.City,
                        Governorate = company.Address.Governorate
                    },
                    Email = company.Email?.Value,
                    Phone = company.Phone?.Value
                };
            }
        }

        WizardClientResponseDto? client = null;
        if (draft.ClientId.HasValue)
        {
            var clientEntity = await _clientRepository.GetByIdAsync(
                draft.ClientId.Value, cancellationToken);
            
            if (clientEntity != null)
            {
                client = new WizardClientResponseDto
                {
                    Id = clientEntity.Id,
                    IsNewClient = false,
                    Name = clientEntity.Name,
                    TaxType = clientEntity.Type.ToString().ToUpperInvariant(),
                    Nif = clientEntity.NIF?.Value,
                    Address = new WizardAddressDto
                    {
                        Street = clientEntity.Address.Street,
                        StreetLine2 = clientEntity.Address.StreetLine2,
                        PostalCode = clientEntity.Address.PostalCode,
                        City = clientEntity.Address.City,
                        Governorate = clientEntity.Address.Governorate
                    },
                    Email = clientEntity.Email?.Value,
                    Phone = clientEntity.Phone?.Value
                };
            }
        }
        else if (draft.GetNewClient() is { } newClient)
        {
            client = new WizardClientResponseDto
            {
                Id = null,
                IsNewClient = true,
                Name = newClient.Name,
                TaxType = newClient.TaxType,
                Nif = newClient.Nif,
                Address = new WizardAddressDto
                {
                    Street = newClient.Street,
                    StreetLine2 = newClient.StreetLine2,
                    PostalCode = newClient.PostalCode,
                    City = newClient.City,
                    Governorate = newClient.Governorate
                },
                Email = newClient.Email,
                Phone = newClient.Phone
            };
        }

        var fodecRate = _accountingSettings.FodecRatePercent;
        var lines = draft.GetLines();
        var lineResponses = lines.Select((l, index) => CalculateLine(l, index + 1, fodecRate)).ToList();
        var stampMoney = await _fiscalStampResolver.ResolveSignedStampAsync(
            draft.Type == InvoiceType.CreditNote,
            cancellationToken);
        var wizardLines = lines.Select(ToWizardLineDto).ToList();
        var totals = InvoiceCalculationService.CalculateTotals(
            wizardLines,
            draft.GetMetadata()?.Currency ?? "TND",
            stampMoney.Amount,
            fodecRate);

        var metadata = draft.GetMetadata();
        var paymentLegal = draft.GetPaymentLegal();

        return new DraftResponseDto
        {
            Id = draft.Id,
            CurrentStep = draft.CurrentStep,
            IsComplete = draft.IsComplete,
            IsConverted = draft.IsConverted,
            ConvertedInvoiceId = draft.ConvertedInvoiceId,
            LastModifiedAt = draft.LastModifiedAt,
            ExpiresAt = draft.ExpiresAt,
            Metadata = metadata != null ? new WizardStepMetadataDto
            {
                Type = metadata.Type == InvoiceType.CreditNote ? "CREDIT_NOTE" : "INVOICE",
                IssueDate = metadata.IssueDate,
                DueDate = metadata.DueDate,
                Currency = metadata.Currency,
                InternalReference = metadata.InternalReference,
                LinkedInvoiceId = metadata.LinkedInvoiceId,
                WarehouseId = metadata.WarehouseId,
                CashRegisterSessionId = metadata.CashRegisterSessionId
            } : null,
            Seller = seller,
            Client = client,
            Lines = lineResponses,
            PaymentLegal = paymentLegal != null ? new WizardStepPaymentLegalDto
            {
                PaymentMethod = paymentLegal.PaymentMethod,
                PaymentTerms = paymentLegal.PaymentTerms,
                DaysUntilDue = paymentLegal.DaysUntilDue,
                BankInfo = new WizardBankInfoDto
                {
                    BankName = paymentLegal.BankName,
                    Iban = paymentLegal.Iban,
                    Rib = paymentLegal.Rib
                },
                PurchaseOrderRef = paymentLegal.PurchaseOrderRef,
                LegalMentions = new WizardLegalMentionsDto
                {
                    VatMention = paymentLegal.VatMention ?? "TVA due par le vendeur",
                    ExemptionMention = paymentLegal.ExemptionMention,
                    CustomMention = paymentLegal.CustomMention
                }
            } : null,
            Totals = totals
        };
    }

    private static WizardStepLineDto ToWizardLineDto(DraftInvoiceLine line) => new()
    {
        ProductId = line.ProductId,
        Designation = line.Designation,
        Description = line.Description,
        Quantity = line.Quantity,
        Unit = line.Unit,
        UnitPriceHT = line.UnitPriceHT,
        PriceOverridden = line.PriceOverridden,
        DiscountType = line.DiscountType,
        DiscountValue = line.DiscountValue,
        VatRate = line.VatRate,
        FodecApplicable = line.FodecApplicable
    };

    private static WizardLineResponseDto CalculateLine(
        DraftInvoiceLine line,
        int lineNumber,
        decimal fodecRatePercent) =>
        InvoiceCalculationService.CalculateLine(ToWizardLineDto(line), lineNumber, fodecRatePercent);
}
