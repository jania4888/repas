using FactuTrust.API.Authorization;
using FactuTrust.API.Http;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Application.Features.Stock.Commands;
using FactuTrust.Application.Features.Stock.Queries;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class CompanyController : ControllerBase
{
    private readonly MasterDbContext _masterContext;
    private readonly ICompanyRepository _companyRepository;
    private readonly IEnsureDefaultCompanyService _ensureDefaultCompanyService;
    private readonly ITenantContext _tenantContext;
    private readonly ITenantService _tenantService;
    private readonly IMediator _mediator;
    private readonly IClientPortalService _clientPortalService;
    private readonly ILogger<CompanyController> _logger;

    public CompanyController(
        MasterDbContext masterContext,
        ICompanyRepository companyRepository,
        IEnsureDefaultCompanyService ensureDefaultCompanyService,
        ITenantContext tenantContext,
        ITenantService tenantService,
        IMediator mediator,
        IClientPortalService clientPortalService,
        ILogger<CompanyController> logger)
    {
        _masterContext = masterContext;
        _companyRepository = companyRepository;
        _ensureDefaultCompanyService = ensureDefaultCompanyService;
        _tenantContext = tenantContext;
        _tenantService = tenantService;
        _mediator = mediator;
        _clientPortalService = clientPortalService;
        _logger = logger;
    }

    /// <summary>
    /// Get current company information.
    /// </summary>
    [HttpGet]
    [Authorize(Policy = PermissionPolicies.SettingsRead)]
    [ProducesResponseType(typeof(ApiResponse<CompanyDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetCompany(CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
        {
            return Unauthorized(ApiResponse<CompanyDto>.Fail("Tenant context not found"));
        }

        var tenant = await _masterContext.Tenants
            .FirstOrDefaultAsync(t => t.Id == tenantId.Value, cancellationToken);

        if (tenant == null)
        {
            return NotFound(ApiResponse<CompanyDto>.Fail("Company not found"));
        }

        // Ensure default Company exists in tenant DB and get its ID (required for wizard/seller selection)
        var companyIdResult = await _ensureDefaultCompanyService.GetOrCreateDefaultCompanyIdAsync(cancellationToken);
        if (companyIdResult.IsFailure)
        {
            return BadRequest(ApiResponse<CompanyDto>.Fail(companyIdResult.Error.Description));
        }

        var company = await _companyRepository.GetByIdAsync(companyIdResult.Value, cancellationToken);
        if (company == null)
        {
            _logger.LogError("Company {CompanyId} not found after EnsureDefaultCompany", companyIdResult.Value);
            return BadRequest(ApiResponse<CompanyDto>.Fail("Impossible de charger les informations de l'entreprise"));
        }

        // Fetch default warehouse name
        string? warehouseName = null;
        try 
        {
            var warehouses = await _mediator.Send(new GetWarehousesQuery(ActiveOnly: true), cancellationToken);
            if (warehouses != null)
            {
                var defaultWarehouse = warehouses.FirstOrDefault(w => w.IsDefault);
                warehouseName = defaultWarehouse?.Name;
            }

        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to fetch default warehouse for company {CompanyId}", company.Id);
        }

        var dto = MapToDto(tenant, company, warehouseName);

        return Ok(ApiResponse<CompanyDto>.Ok(dto));
    }

    /// <summary>
    /// Update company information.
    /// </summary>
    [HttpPut]
    [Authorize(Policy = PermissionPolicies.SettingsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<CompanyDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> UpdateCompany(
        [FromBody] UpdateCompanyDto dto,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
        {
            return Unauthorized(ApiResponse<CompanyDto>.Fail("Tenant context not found"));
        }

        var tenant = await _masterContext.Tenants
            .FirstOrDefaultAsync(t => t.Id == tenantId.Value, cancellationToken);

        if (tenant == null)
        {
            return NotFound(ApiResponse<CompanyDto>.Fail("Company not found"));
        }

        // Validate NIF
        var nifResult = NIF.Create(dto.Nif);
        if (nifResult.IsFailure)
        {
            return BadRequest(ApiResponse<CompanyDto>.Fail(nifResult.Error.Description));
        }

        // Validate address
        var addressResult = Address.Create(dto.Street, dto.City, dto.Governorate, dto.StreetLine2, dto.PostalCode);
        if (addressResult.IsFailure)
        {
            return BadRequest(ApiResponse<CompanyDto>.Fail(addressResult.Error.Description));
        }

        // Validate email
        var emailResult = Email.Create(dto.Email);
        if (emailResult.IsFailure)
        {
            return BadRequest(ApiResponse<CompanyDto>.Fail(emailResult.Error.Description));
        }

        // Validate phone
        var phoneResult = PhoneNumber.Create(dto.Phone);
        if (phoneResult.IsFailure)
        {
            return BadRequest(ApiResponse<CompanyDto>.Fail(phoneResult.Error.Description));
        }

        // Validate tax regime
        if (!Enum.IsDefined(typeof(TaxRegime), dto.TaxRegime))
        {
            return BadRequest(ApiResponse<CompanyDto>.Fail("Régime fiscal invalide"));
        }

        var taxRegime = (TaxRegime)dto.TaxRegime;
        var previousTaxRegime = tenant.TaxRegime;
        var taxRegimeChanged = previousTaxRegime != taxRegime;

        await using var transaction = await _masterContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            // Update Tenant in master DB
            tenant.UpdateCompanyInfo(
                dto.CompanyName,
                addressResult.Value,
                phoneResult.Value,
                dto.Website,
                dto.LogoUrl);

            // Update TaxRegime
            tenant.UpdateTaxRegime(taxRegime);
            
            // Note: NIF is immutable in Tenant entity (legal requirement)
            // If NIF needs to be updated, it should be done through a separate process
            // For now, we only update it in Company entity if it differs

            await _masterContext.SaveChangesAsync(cancellationToken);

            // Update or create Company in tenant DB
            Company? company = null;
            try
            {
                company = await _companyRepository.GetDefaultAsync(cancellationToken);
                
                if (company == null)
                {
                    // Create default company with NIF from DTO
                    var companyResult = Company.Create(
                        dto.CompanyName,
                        addressResult.Value,
                        nifResult.Value,
                        emailResult.Value,
                        dto.TradeName,
                        dto.CommerceRegistry,
                        null, // VAT code
                        phoneResult.Value);

                    if (companyResult.IsFailure)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return BadRequest(ApiResponse<CompanyDto>.Fail(companyResult.Error.Description));
                    }

                    company = companyResult.Value;
                    company.SetAsDefault();
                    company = await _companyRepository.AddAsync(company, cancellationToken);
                }
                else
                {
                    // Update existing company
                    // Note: Company NIF can be updated if it differs from Tenant NIF
                    // This allows correction of NIF errors in Company while keeping Tenant NIF immutable
                    company.Update(
                        dto.CompanyName,
                        addressResult.Value,
                        emailResult.Value,
                        dto.TradeName,
                        dto.CommerceRegistry,
                        phoneResult.Value);
                    
                    // If NIF in Company differs from DTO, we'd need to recreate Company
                    // For now, we keep the existing NIF in Company
                }

                // Update bank info if provided
                if (!string.IsNullOrWhiteSpace(dto.BankName) || !string.IsNullOrWhiteSpace(dto.Rib) || !string.IsNullOrWhiteSpace(dto.Iban))
                {
                    company.SetBankInfo(dto.BankName, dto.Iban, dto.Rib);
                }

                // Update logo if provided
                if (!string.IsNullOrWhiteSpace(dto.LogoUrl))
                {
                    company.SetLogo(dto.LogoUrl);
                }

                company.SetCnssEmployerNumber(dto.CnssEmployerNumber);
                if (dto.ClientPortalEnabled.HasValue)
                    company.SetClientPortalEnabled(dto.ClientPortalEnabled.Value);

                await _companyRepository.UpdateAsync(company, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not update Company in tenant database, but Tenant was updated");
                // Continue - Tenant update is the primary update
            }

            // Update warehouse if name provided
            if (!string.IsNullOrWhiteSpace(dto.WarehouseName))
            {
                try 
                {
                    var warehouses = await _mediator.Send(new GetWarehousesQuery(ActiveOnly: true), cancellationToken);
                    if (warehouses != null)
                    {
                        var defaultWarehouse = warehouses.FirstOrDefault(w => w.IsDefault);
                        if (defaultWarehouse != null && defaultWarehouse.Name != dto.WarehouseName.Trim())
                        {
                            await _mediator.Send(new UpdateWarehouseCommand(
                                defaultWarehouse.Id, 
                                dto.WarehouseName.Trim(), 
                                defaultWarehouse.Address, 
                                true), cancellationToken);
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to update default warehouse name to '{Name}'", dto.WarehouseName);
                }
            }

            await transaction.CommitAsync(cancellationToken);

            // Plan §2.4 — additive re-seed of the tenant's fiscal catalogs on TaxRegime change.
            // Runs AFTER the master DB commit (fault-isolated, never rolls back the company update):
            // a re-seed failure is logged and surfaced as an empty updatedItems/no warning rather
            // than failing the whole request.
            FiscalReSeedResultDto? fiscalReSeedResult = null;
            if (taxRegimeChanged)
            {
                try
                {
                    fiscalReSeedResult = await _tenantService.ReSeedFiscalParametersAsync(
                        tenantId.Value,
                        previousTaxRegime,
                        taxRegime,
                        tenant.CompanySegment,
                        cancellationToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Fiscal re-seed failed for tenant {TenantId} after TaxRegime change {Old}->{New}", tenantId.Value, previousTaxRegime, taxRegime);
                }
            }

            // Reload tenant to get updated values
            await _masterContext.Entry(tenant).ReloadAsync(cancellationToken);
            var updatedDto = MapToDto(tenant, company, dto.WarehouseName, fiscalReSeedResult);

            _logger.LogInformation("Company information updated for tenant {TenantId}", tenantId.Value);

            var successMessage = fiscalReSeedResult is { UpdatedItems.Count: > 0 }
                ? "Informations de l'entreprise mises à jour. Paramètres de retenue à la source actualisés."
                : "Informations de l'entreprise mises à jour";

            return Ok(ApiResponse<CompanyDto>.Ok(updatedDto, successMessage));
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(cancellationToken);
            _logger.LogError(ex, "Error updating company for tenant {TenantId}", tenantId.Value);
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                ApiResponse<CompanyDto>.Fail("Une erreur est survenue lors de la mise à jour"));
        }
    }

    private static CompanyDto MapToDto(Tenant tenant, Company? company, string? warehouseName, FiscalReSeedResultDto? fiscalReSeedResult = null)
    {
        return new CompanyDto
        {
            Id = company?.Id ?? tenant.Id,
            CompanyName = tenant.CompanyName,
            TradeName = company?.TradeName,
            Nif = tenant.NIF.Value,
            CommerceRegistry = company?.CommerceRegistry,
            TaxRegime = (int)tenant.TaxRegime,
            TaxRegimeDisplay = tenant.TaxRegime.ToDisplayString(),
            Address = new AddressDto
            {
                Street = tenant.Address.Street,
                StreetLine2 = tenant.Address.StreetLine2,
                City = tenant.Address.City,
                PostalCode = tenant.Address.PostalCode,
                Governorate = tenant.Address.Governorate,
                Country = tenant.Address.Country,
                FullAddress = tenant.Address.ToSingleLine()
            },
            Email = tenant.Email?.Value ?? string.Empty,
            Phone = tenant.Phone?.Value ?? string.Empty,
            Website = tenant.Website,
            LogoUrl = tenant.LogoUrl ?? company?.LogoUrl,
            BankName = company?.BankName,
            Rib = company?.Rib,
            Iban = company?.Iban,
            // Invoice settings would come from a separate settings entity if needed
            InvoicePrefix = null,
            DefaultPaymentTerms = null,
            InvoiceFooter = null,
            WarehouseName = warehouseName,
            CnssEmployerNumber = company?.CnssEmployerNumber,
            ClientPortalEnabled = company?.ClientPortalEnabled ?? true,
            CompanySegment = tenant.CompanySegment,
            BusinessDomain = tenant.BusinessDomain,
            FiscalUpdateMessages = fiscalReSeedResult?.UpdatedItems.Count > 0 ? fiscalReSeedResult.UpdatedItems : null,
            TaxRegimeWarning = fiscalReSeedResult?.Warning
        };
    }

    [HttpPatch("client-portal")]
    [Authorize(Policy = PermissionPolicies.SettingsUpdate)]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    public async Task<IActionResult> PatchClientPortal(
        [FromBody] UpdateClientPortalSettingsRequest request,
        CancellationToken cancellationToken)
        => this.ToActionResult(await _clientPortalService.SetPortalEnabledAsync(request.Enabled, cancellationToken));
}
