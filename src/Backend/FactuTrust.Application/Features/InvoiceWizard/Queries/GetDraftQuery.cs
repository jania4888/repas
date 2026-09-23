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
using FactuTrust.Domain.Services;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.InvoiceWizard.Queries;

/// <summary>
/// Query to get a draft by ID.
/// </summary>
public sealed record GetDraftQuery(Guid DraftId) : IRequest<Result<DraftResponseDto>>;

/// <summary>
/// Handler for GetDraftQuery.
/// </summary>
public sealed class GetDraftQueryHandler : IRequestHandler<GetDraftQuery, Result<DraftResponseDto>>
{
    private readonly IInvoiceDraftRepository _draftRepository;
    private readonly ICompanyRepository _companyRepository;
    private readonly IClientRepository _clientRepository;
    private readonly IFiscalStampResolver _fiscalStampResolver;
    private readonly AccountingSettings _accountingSettings;

    public GetDraftQueryHandler(
        IInvoiceDraftRepository draftRepository,
        ICompanyRepository companyRepository,
        IClientRepository clientRepository,
        IFiscalStampResolver fiscalStampResolver,
        IOptions<AccountingSettings> accountingSettings)
    {
        _draftRepository = draftRepository;
        _companyRepository = companyRepository;
        _clientRepository = clientRepository;
        _fiscalStampResolver = fiscalStampResolver;
        _accountingSettings = accountingSettings.Value;
    }

    public async Task<Result<DraftResponseDto>> Handle(
        GetDraftQuery query, 
        CancellationToken cancellationToken)
    {
        var draft = await _draftRepository.GetByIdAsync(query.DraftId, cancellationToken);

        if (draft is null)
            return Result.Failure<DraftResponseDto>(
                Error.NotFound("Draft", query.DraftId));

        var response = await BuildDraftResponseAsync(draft, cancellationToken);
        return Result.Success(response);
    }

    private async Task<DraftResponseDto> BuildDraftResponseAsync(
        InvoiceDraft draft, 
        CancellationToken cancellationToken)
    {
        // Load seller
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

        // Load client
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

        // Calculate lines and totals
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

/// <summary>
/// Query to get next invoice number preview.
/// </summary>
public sealed record GetNextInvoiceNumberQuery(
    string Prefix = "FAC",
    int? Year = null) : IRequest<Result<NextInvoiceNumberDto>>;

/// <summary>
/// Handler for GetNextInvoiceNumberQuery.
/// </summary>
public sealed class GetNextInvoiceNumberQueryHandler 
    : IRequestHandler<GetNextInvoiceNumberQuery, Result<NextInvoiceNumberDto>>
{
    private readonly IInvoiceNumberGenerator _numberGenerator;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<GetNextInvoiceNumberQueryHandler> _logger;

    public GetNextInvoiceNumberQueryHandler(
        IInvoiceNumberGenerator numberGenerator,
        ICurrentUser currentUser,
        ILogger<GetNextInvoiceNumberQueryHandler> logger)
    {
        _numberGenerator = numberGenerator;
        _currentUser = currentUser;
        _logger = logger;
    }

    public async Task<Result<NextInvoiceNumberDto>> Handle(
        GetNextInvoiceNumberQuery query, 
        CancellationToken cancellationToken)
    {
        try
        {
            var tenantId = _currentUser.TenantId;
            if (!tenantId.HasValue || tenantId.Value == Guid.Empty)
            {
                _logger.LogWarning("Attempt to get next invoice number without valid tenant context");
                return Result.Failure<NextInvoiceNumberDto>(
                    Error.Unauthorized("Aucun contexte d'entreprise disponible"));
            }

            var year = query.Year ?? DateTime.UtcNow.Year;
            var prefix = query.Prefix?.ToUpperInvariant() ?? "FAC";

            if (string.IsNullOrWhiteSpace(prefix) || prefix.Length < 2 || prefix.Length > 4)
            {
                return Result.Failure<NextInvoiceNumberDto>(
                    Error.Validation("Prefix", "Le préfixe doit contenir entre 2 et 4 caractères"));
            }

            if (year < 2000 || year > 2100)
            {
                return Result.Failure<NextInvoiceNumberDto>(
                    Error.Validation("Year", "L'année doit être entre 2000 et 2100"));
            }

            var nextNumber = await _numberGenerator.PreviewNextNumberAsync(
                tenantId.Value, prefix, year, cancellationToken);

            if (string.IsNullOrWhiteSpace(nextNumber))
            {
                _logger.LogError(
                    "Failed to generate invoice number for Tenant {TenantId}, Prefix {Prefix}, Year {Year}",
                    tenantId.Value, prefix, year);
                return Result.Failure<NextInvoiceNumberDto>(
                    new Error("InvoiceNumberGeneration.Failed", "Impossible de générer le numéro séquentiel de facture"));
            }

            // Parse the number to extract components
            var parts = nextNumber.Split('-');
            var sequence = 1;
            if (parts.Length >= 3 && int.TryParse(parts[2], out var parsedSeq))
            {
                sequence = parsedSeq;
            }

            return Result.Success(new NextInvoiceNumberDto
            {
                Number = nextNumber,
                Prefix = prefix,
                Year = year,
                Sequence = sequence
            });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex,
                "Invalid operation while generating invoice number for Prefix {Prefix}, Year {Year}",
                query.Prefix, query.Year);
            
            // Check if it's a database connection error
            if (ex.Message.Contains("connexion") || ex.Message.Contains("base de données") || ex.Message.Contains("database"))
            {
                return Result.Failure<NextInvoiceNumberDto>(
                    new Error("Database.ConnectionError", "Erreur de connexion à la base de données. Veuillez réessayer."));
            }
            
            return Result.Failure<NextInvoiceNumberDto>(
                new Error("InvoiceNumberGeneration.ConnectionError", "Impossible de générer le numéro séquentiel de facture. Vérifiez votre connexion."));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Unexpected error while generating invoice number for Prefix {Prefix}, Year {Year}",
                query.Prefix, query.Year);
            return Result.Failure<NextInvoiceNumberDto>(
                new Error("InvoiceNumberGeneration.UnexpectedError", "Une erreur inattendue s'est produite lors de la génération du numéro de facture."));
        }
    }
}

/// <summary>
/// Query to list user's drafts.
/// </summary>
public sealed record ListDraftsQuery(
    int Page = 1,
    int PageSize = 20,
    bool IncludeExpired = false) : IRequest<PagedResult<DraftSummaryDto>>;

/// <summary>
/// Summary DTO for draft listing.
/// </summary>
public sealed record DraftSummaryDto
{
    public Guid Id { get; init; }
    public int CurrentStep { get; init; }
    public string StepLabel { get; init; } = null!;
    public bool IsComplete { get; init; }
    public string Type { get; init; } = null!;
    public string? ClientName { get; init; }
    public decimal? TotalTTC { get; init; }
    public string Currency { get; init; } = "TND";
    public DateTime LastModifiedAt { get; init; }
    public DateTime ExpiresAt { get; init; }
    public bool IsExpired { get; init; }
}

/// <summary>
/// Handler for ListDraftsQuery.
/// </summary>
public sealed class ListDraftsQueryHandler 
    : IRequestHandler<ListDraftsQuery, PagedResult<DraftSummaryDto>>
{
    private readonly IInvoiceDraftRepository _draftRepository;
    private readonly ICurrentUser _currentUser;

    private static readonly string[] StepLabels = 
    {
        "Type & Date",
        "Émetteur",
        "Client",
        "Articles",
        "Paiement",
        "Validation"
    };

    public ListDraftsQueryHandler(
        IInvoiceDraftRepository draftRepository,
        ICurrentUser currentUser)
    {
        _draftRepository = draftRepository;
        _currentUser = currentUser;
    }

    public async Task<PagedResult<DraftSummaryDto>> Handle(
        ListDraftsQuery query, 
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId ?? Guid.Empty;

        var (drafts, totalCount) = await _draftRepository.GetUserDraftsAsync(
            userId, 
            query.Page, 
            query.PageSize,
            query.IncludeExpired,
            cancellationToken);

        var items = drafts.Select(d =>
        {
            var metadata = d.GetMetadata();
            var newClient = d.GetNewClient();
            var lines = d.GetLines();
            var totals = lines.Any() 
                ? lines.Sum(l => (l.Quantity * l.UnitPriceHT) * (1 + l.VatRate / 100m))
                : (decimal?)null;

            return new DraftSummaryDto
            {
                Id = d.Id,
                CurrentStep = d.CurrentStep,
                StepLabel = d.CurrentStep < StepLabels.Length 
                    ? StepLabels[d.CurrentStep] 
                    : "Inconnu",
                IsComplete = d.IsComplete,
                Type = d.Type == InvoiceType.CreditNote ? "Avoir" : "Facture",
                ClientName = newClient?.Name,
                TotalTTC = totals,
                Currency = metadata?.Currency ?? "TND",
                LastModifiedAt = d.LastModifiedAt,
                ExpiresAt = d.ExpiresAt,
                IsExpired = d.IsExpired
            };
        }).ToList();

        return PagedResult<DraftSummaryDto>.Create(
            items,
            query.Page,
            query.PageSize,
            totalCount);
    }
}
