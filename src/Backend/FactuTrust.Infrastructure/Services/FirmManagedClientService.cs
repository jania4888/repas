using System.Diagnostics;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.FirmGovernance;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services.Payroll;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using EmailAddress = FactuTrust.Domain.ValueObjects.Email;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Création d'un dossier client géré par le cabinet : tenant société sans compte utilisateur,
/// base dédiée provisionnée (plan comptable + journaux seedés par les migrations tenant),
/// affectation cabinet directement active et dossier permanent pré-rempli.
/// </summary>
public sealed class FirmManagedClientService : IFirmManagedClientService
{
    private readonly MasterDbContext _masterContext;
    private readonly ITenantService _tenantService;
    private readonly IFirmGovernanceService _governance;
    private readonly ILogger<FirmManagedClientService> _logger;

    public FirmManagedClientService(
        MasterDbContext masterContext,
        ITenantService tenantService,
        IFirmGovernanceService governance,
        ILogger<FirmManagedClientService> logger)
    {
        _masterContext = masterContext;
        _tenantService = tenantService;
        _governance = governance;
        _logger = logger;
    }

    public async Task<Result<FirmManagedClientCreatedDto>> CreateManagedClientAsync(
        Guid firmTenantId,
        Guid firmUserId,
        CreateFirmManagedClientDto dto,
        CancellationToken cancellationToken = default)
    {
        // ── Validation du cabinet ────────────────────────────────────────────────
        var firm = await _masterContext.Tenants.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == firmTenantId, cancellationToken);
        if (firm is null || !firm.IsActive || firm.Kind != TenantKind.AccountingFirm)
            return Result.Failure<FirmManagedClientCreatedDto>(
                Error.Validation("Firm", "Cabinet comptable invalide"));

        // ── Validation des value objects ─────────────────────────────────────────
        var nifResult = NIF.Create(dto.Nif);
        if (nifResult.IsFailure)
            return Result.Failure<FirmManagedClientCreatedDto>(nifResult.Error);

        var addressResult = Address.Create(dto.Street, dto.City, dto.Governorate, dto.StreetLine2, dto.PostalCode);
        if (addressResult.IsFailure)
            return Result.Failure<FirmManagedClientCreatedDto>(addressResult.Error);

        var emailResult = EmailAddress.CreateOptional(dto.Email);
        if (emailResult.IsFailure)
            return Result.Failure<FirmManagedClientCreatedDto>(emailResult.Error);

        var phoneResult = PhoneNumber.Create(dto.Phone);
        if (phoneResult.IsFailure)
            return Result.Failure<FirmManagedClientCreatedDto>(phoneResult.Error);

        if (dto.FiscalYearStartMonth is < 1 or > 12 || dto.FiscalYearEndMonth is < 1 or > 12)
            return Result.Failure<FirmManagedClientCreatedDto>(
                Error.Validation("FiscalYear", "Les mois d'exercice doivent être compris entre 1 et 12"));

        // ── Unicité du NIF parmi les tenants actifs ──────────────────────────────
        var nifValue = nifResult.Value.Value;
        var nifLegacy = nifResult.Value.LegacySpelling;
        var nifExists = await _masterContext.Tenants.AsNoTracking()
            .AnyAsync(t => t.IsActive && (t.NIF.Value == nifValue || t.NIF.Value == nifLegacy), cancellationToken);
        if (nifExists)
            return Result.Failure<FirmManagedClientCreatedDto>(
                Error.Validation("NIF", "Une société avec ce matricule fiscal existe déjà sur la plateforme"));

        var tenantResult = Tenant.CreateFirmManaged(
            firmTenantId,
            dto.CompanyName,
            nifResult.Value,
            addressResult.Value,
            emailResult.Value,
            phoneResult.Value,
            dto.TaxRegime,
            dto.Website);
        if (tenantResult.IsFailure)
            return Result.Failure<FirmManagedClientCreatedDto>(tenantResult.Error);

        var tenant = tenantResult.Value;

        var assignmentResult = FirmClientAssignment.CreateByFirm(tenant.Id, firmTenantId, firmUserId, dto.Notes);
        if (assignmentResult.IsFailure)
            return Result.Failure<FirmManagedClientCreatedDto>(assignmentResult.Error);

        var assignment = assignmentResult.Value;

        _logger.LogInformation(
            "Provisioning dossier géré « {CompanyName} » pour le cabinet {FirmTenantId} (phase: validating)",
            tenant.CompanyName, firmTenantId);

        // ── Provisioning transactionnel (même modèle que l'inscription société) ──
        string tenantConnectionString;
        try
        {
            await using var transaction = await _masterContext.Database.BeginTransactionAsync(cancellationToken);

            _masterContext.Tenants.Add(tenant);
            await _masterContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Création de la base tenant pour {TenantId} (phase: creating_database)", tenant.Id);
            var dbSw = Stopwatch.StartNew();
            // Crée la base dédiée : migrations tenant = plan comptable tunisien, journaux,
            // catalogue retenues à la source et paramètres IS déjà seedés.
            tenantConnectionString = await _tenantService.CreateTenantDatabaseAsync(
                tenant.Id, tenant.DatabaseName, warehouseName: null, cancellationToken);
            dbSw.Stop();
            _logger.LogInformation(
                "Base tenant {TenantId} provisionnée en {ElapsedMs} ms (phase: migrating_seeding)",
                tenant.Id, dbSw.ElapsedMilliseconds);

            _masterContext.Subscriptions.Add(Subscription.CreateFree(tenant.Id));
            _masterContext.FirmClientAssignments.Add(assignment);

            var permanentFileResult = BuildPermanentFile(firmTenantId, assignment, dto);
            if (permanentFileResult.IsFailure)
            {
                await transaction.RollbackAsync(cancellationToken);
                await _tenantService.TryDropDatabaseAsync(tenant.DatabaseName, cancellationToken);
                return Result.Failure<FirmManagedClientCreatedDto>(permanentFileResult.Error);
            }

            _masterContext.PermanentFiles.Add(permanentFileResult.Value);
            await _masterContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            _logger.LogInformation(
                "Commit Master terminé pour le dossier géré {TenantId} (phase: master_commit)", tenant.Id);
        }
        catch (Exception ex)
        {
            var correlationId = Guid.NewGuid().ToString("N");
            _logger.LogError(
                ex,
                "Échec du provisioning du dossier géré « {CompanyName} » pour le cabinet {FirmTenantId}. CorrelationId: {CorrelationId}. Detail: {Detail}",
                dto.CompanyName,
                firmTenantId,
                correlationId,
                ex.InnerException?.Message ?? ex.Message);

            try
            {
                // Best-effort : si une transaction ouverte existe encore sur le contexte.
                if (_masterContext.Database.CurrentTransaction is not null)
                    await _masterContext.Database.RollbackTransactionAsync(cancellationToken);
            }
            catch (Exception rollbackEx)
            {
                _logger.LogWarning(rollbackEx,
                    "Rollback Master impossible après échec provisioning (CorrelationId: {CorrelationId})",
                    correlationId);
            }

            await _tenantService.TryDropDatabaseAsync(tenant.DatabaseName, cancellationToken);

            // Retirer les entités trackées pour ne pas polluer les appels suivants du même scope.
            _masterContext.ChangeTracker.Clear();

            return Result.Failure<FirmManagedClientCreatedDto>(
                Error.Conflict(
                    $"Échec du provisioning de la base comptable. Réessayez plus tard ou contactez le support. (REF-{correlationId})"));
        }

        _logger.LogInformation(
            "Dossier client géré {CompanyName} ({TenantId}) créé par le cabinet {FirmTenantId}",
            tenant.CompanyName, tenant.Id, firmTenantId);

        // ── Post-provisioning (best-effort, le dossier est déjà créé) ────────────
        _logger.LogInformation(
            "Post-provisioning fiscal / gestionnaire pour {TenantId} (phase: post_fiscal)", tenant.Id);
        await TryApplyFiscalParametersAsync(tenant.Id, tenantConnectionString, dto, cancellationToken);
        await TryAssignAccountantAsync(firmTenantId, firmUserId, assignment.Id, dto.AssignedAccountantUserId, cancellationToken);

        return Result.Success(new FirmManagedClientCreatedDto
        {
            CompanyTenantId = tenant.Id,
            AssignmentId = assignment.Id,
            CompanyName = tenant.CompanyName
        });
    }

    private static Result<PermanentFile> BuildPermanentFile(
        Guid firmTenantId,
        FirmClientAssignment assignment,
        CreateFirmManagedClientDto dto)
    {
        var fileResult = PermanentFile.Create(
            assignment.Id,
            firmTenantId,
            assignment.CompanyTenantId,
            dto.CompanyName,
            dto.Nif,
            dto.TaxRegime);
        if (fileResult.IsFailure)
            return fileResult;

        var file = fileResult.Value;
        file.UpdateIdentity(
            dto.CompanyName,
            dto.Nif,
            dto.RneIdentifier,
            dto.LegalForm,
            dto.IncorporationDate,
            dto.ShareCapital);
        file.UpdateRegisteredOffice(dto.Street, dto.City, dto.Governorate, dto.PostalCode);
        file.UpdateTaxAdministration(dto.TaxOffice, dto.TaxRegime, hasTaxCertificate: false);
        file.UpdateAccountingYear(dto.FiscalYearStartMonth, dto.FiscalYearEndMonth);

        if (dto.AnnualFeeAmount.HasValue || dto.BillingFrequency.HasValue || !string.IsNullOrWhiteSpace(dto.BillingNotes))
            file.UpdateBilling(dto.AnnualFeeAmount, dto.BillingFrequency, "TND", dto.BillingNotes);

        return Result.Success(file);
    }

    /// <summary>
    /// Applique les taux du wizard (IS, CNSS) dans la base tenant nouvellement créée.
    /// Best-effort : en cas d'échec le dossier reste utilisable, les paramètres restent
    /// sur les défauts légaux et sont modifiables depuis l'écran « Paramètres fiscaux ».
    /// </summary>
    private async Task TryApplyFiscalParametersAsync(
        Guid tenantId,
        string connectionString,
        CreateFirmManagedClientDto dto,
        CancellationToken cancellationToken)
    {
        if (dto.IsStandardRate is null && dto.CnssEmployeeRate is null && dto.CnssEmployerRate is null)
            return;

        try
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseSqlServer(connectionString)
                .Options;

            await using var context = new TenantDbContext(options);
            var fiscalYear = dto.FirstFiscalYear ?? DateTime.UtcNow.Year;

            if (dto.IsStandardRate.HasValue)
            {
                var incomeTax = await context.IncomeTaxYearParameters
                    .FirstOrDefaultAsync(p => p.FiscalYear == fiscalYear, cancellationToken);
                incomeTax?.Update(
                    dto.IsStandardRate.Value, incomeTax.IsReducedRate, incomeTax.IsSectorRate,
                    incomeTax.MinTaxRate, incomeTax.MinTaxReducedRate, incomeTax.MinTaxFloorTnd,
                    incomeTax.CssApplies, incomeTax.CssRate, incomeTax.CssFloorTnd,
                    incomeTax.AcompteRate, incomeTax.AcompteCount, incomeTax.DeficitCarryForwardYears,
                    incomeTax.IrppBracketsJson,
                    incomeTax.MinTaxFloorReducedTnd, incomeTax.RoundTaxableToDinar,
                    markUserModified: true);
            }

            if (dto.CnssEmployeeRate.HasValue || dto.CnssEmployerRate.HasValue)
            {
                var payroll = await context.PayrollYearParameters
                    .Include(p => p.IrppBrackets)
                    .FirstOrDefaultAsync(p => p.FiscalYear == fiscalYear, cancellationToken);

                if (payroll is null)
                {
                    var defaultsResult = PayrollParameterDefaults.CreateDefaults(fiscalYear);
                    if (defaultsResult.IsFailure)
                    {
                        _logger.LogWarning(
                            "Paramètres de paie par défaut indisponibles pour l'exercice {Year} : {Error}",
                            fiscalYear, defaultsResult.Error.Description);
                        await context.SaveChangesAsync(cancellationToken);
                        return;
                    }
                    payroll = defaultsResult.Value;
                    context.PayrollYearParameters.Add(payroll);
                }

                payroll.UpdateRates(
                    dto.CnssEmployeeRate ?? payroll.CnssEmployeeRate,
                    dto.CnssEmployerRate ?? payroll.CnssEmployerRate,
                    payroll.CssRate,
                    payroll.CssAnnualExemptionThreshold,
                    payroll.ProfessionalExpensesRate,
                    payroll.ProfessionalExpensesAnnualCap,
                    payroll.HeadOfFamilyAnnualDeduction,
                    payroll.ChildAnnualDeduction,
                    payroll.MaxDeductibleChildren,
                    payroll.TfpRateIndustry,
                    payroll.TfpRateOther,
                    payroll.FoprolosRate,
                    payroll.MonthlySmig,
                    dto.CnssEmployeeRate ?? payroll.CnssEmployeeRateRsa,
                    dto.CnssEmployerRate ?? payroll.CnssEmployerRateRsa,
                    payroll.EnforceSmigOnContracts,
                    payroll.EnableExtendedOvertimeRates,
                    payroll.EnableAllowanceQuadrantMatrix,
                    payroll.StudentChildAnnualDeduction,
                    payroll.DisabledChildAnnualDeduction,
                    payroll.ParentDeductionRatePercent,
                    payroll.ParentAnnualDeductionCap,
                    payroll.IsIndustrialSector);
            }

            await context.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Application des paramètres fiscaux du wizard ignorée pour le tenant {TenantId}", tenantId);
        }
    }

    /// <summary>Affectation du gestionnaire via la gouvernance (historique inclus) — best-effort.</summary>
    private async Task TryAssignAccountantAsync(
        Guid firmTenantId,
        Guid firmUserId,
        Guid assignmentId,
        Guid? accountantUserId,
        CancellationToken cancellationToken)
    {
        if (accountantUserId is null)
            return;

        try
        {
            var result = await _governance.AssignDossierManagerAsync(
                firmTenantId,
                firmUserId,
                new AssignDossierManagerDto { AssignmentId = assignmentId, AccountantUserId = accountantUserId },
                cancellationToken);

            if (result.IsFailure)
                _logger.LogWarning(
                    "Affectation du gestionnaire {AccountantUserId} au dossier {AssignmentId} refusée : {Error}",
                    accountantUserId, assignmentId, result.Error.Description);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Affectation du gestionnaire ignorée pour le dossier {AssignmentId}", assignmentId);
        }
    }
}
