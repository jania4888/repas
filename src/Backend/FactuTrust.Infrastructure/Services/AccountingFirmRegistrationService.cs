using System.Diagnostics;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Logging;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using DomainEmail = FactuTrust.Domain.ValueObjects.Email;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services;

public sealed class AccountingFirmRegistrationService : IAccountingFirmRegistrationService
{
    private const string DuplicateNifMessage =
        "Une société avec ce matricule fiscal existe déjà. Contactez le support si vous pensez qu'il s'agit d'une erreur.";

    private readonly UserManager<ApplicationUser> _userManager;
    private readonly MasterDbContext _masterContext;
    private readonly ITenantService _tenantService;
    private readonly ITenantAuthTokenService _tokenService;
    private readonly ISubscriptionAdminService _subscriptionAdminService;
    private readonly ILogger<AccountingFirmRegistrationService> _logger;

    public AccountingFirmRegistrationService(
        UserManager<ApplicationUser> userManager,
        MasterDbContext masterContext,
        ITenantService tenantService,
        ITenantAuthTokenService tokenService,
        ISubscriptionAdminService subscriptionAdminService,
        ILogger<AccountingFirmRegistrationService> logger)
    {
        _userManager = userManager;
        _masterContext = masterContext;
        _tenantService = tenantService;
        _tokenService = tokenService;
        _subscriptionAdminService = subscriptionAdminService;
        _logger = logger;
    }

    public async Task<AccountingFirmRegistrationResult> RegisterAsync(
        RegisterAccountingFirmDto dto,
        AccountingFirmRegistrationContext context,
        CancellationToken cancellationToken = default)
    {
        var correlationId = Guid.NewGuid().ToString("N");
        var totalSw = Stopwatch.StartNew();

        if (dto.Password != dto.ConfirmPassword)
            return AccountingFirmRegistrationResult.ValidationFailure("Les mots de passe ne correspondent pas");

        var nifResult = NIF.Create(dto.Nif);
        if (nifResult.IsFailure)
            return AccountingFirmRegistrationResult.ValidationFailure(nifResult.Error.Description);

        var addressResult = Address.Create(dto.Street, dto.City, dto.Governorate, dto.StreetLine2, dto.PostalCode);
        if (addressResult.IsFailure)
            return AccountingFirmRegistrationResult.ValidationFailure(addressResult.Error.Description);

        var emailResult = DomainEmail.Create(dto.FirmEmail);
        if (emailResult.IsFailure)
            return AccountingFirmRegistrationResult.ValidationFailure(emailResult.Error.Description);

        var phoneResult = PhoneNumber.Create(dto.Phone);
        if (phoneResult.IsFailure)
            return AccountingFirmRegistrationResult.ValidationFailure(phoneResult.Error.Description);

        var emailCheckSw = Stopwatch.StartNew();
        var existingUser = await _userManager.FindByEmailAsync(dto.Email);
        LogStep("EmailPrecheck", emailCheckSw.ElapsedMilliseconds, null, correlationId, context);
        if (existingUser is not null)
            return AccountingFirmRegistrationResult.DuplicateEmailFailure();

        var nifValue = nifResult.Value.Value;
        var nifExists = await _masterContext.Tenants.AsNoTracking()
            .AnyAsync(t => t.IsActive && t.NIF.Value == nifValue, cancellationToken);
        if (nifExists)
            return AccountingFirmRegistrationResult.ConflictNifFailure(DuplicateNifMessage);

        string? provisionedDatabaseName = null;
        Guid? tenantId = null;

        await using var transaction = await _masterContext.Database.BeginTransactionAsync(cancellationToken);

        Tenant tenant;
        ApplicationUser user;

        try
        {
            var tenantResult = Tenant.CreateAccountingFirm(
                dto.FirmName,
                nifResult.Value,
                addressResult.Value,
                emailResult.Value,
                phoneResult.Value,
                dto.Website);

            if (tenantResult.IsFailure)
            {
                await transaction.RollbackAsync(cancellationToken);
                return AccountingFirmRegistrationResult.ValidationFailure(tenantResult.Error.Description);
            }

            tenant = tenantResult.Value;
            tenantId = tenant.Id;
            provisionedDatabaseName = tenant.DatabaseName;

            var masterSw = Stopwatch.StartNew();
            _masterContext.Tenants.Add(tenant);

            var subscription = Subscription.CreateFree(tenant.Id);
            _masterContext.Subscriptions.Add(subscription);

            var profileResult = AccountingFirmProfile.Create(
                tenant.Id,
                dto.FirmName,
                dto.City,
                dto.Governorate,
                emailResult.Value,
                phoneResult.Value,
                dto.Description,
                dto.ProfessionalRegistrationNumber,
                dto.IsPublicInDirectory);

            if (profileResult.IsFailure)
            {
                await transaction.RollbackAsync(cancellationToken);
                return AccountingFirmRegistrationResult.ValidationFailure(profileResult.Error.Description);
            }

            _masterContext.AccountingFirmProfiles.Add(profileResult.Value);
            await _masterContext.SaveChangesAsync(cancellationToken);
            LogStep("MasterEntities", masterSw.ElapsedMilliseconds, tenant.Id, correlationId, context);

            user = new ApplicationUser
            {
                UserName = dto.Email,
                Email = dto.Email,
                FirstName = dto.FirstName,
                LastName = dto.LastName,
                TenantId = tenant.Id,
                EmailConfirmed = context.ForceEmailConfirmed
            };
            user.ApplyNewInteractiveProductOnboarding();

            var identitySw = Stopwatch.StartNew();
            var createResult = await _userManager.CreateAsync(user, dto.Password);
            if (!createResult.Succeeded)
            {
                await transaction.RollbackAsync(cancellationToken);
                var errorMessage = IdentityErrorTranslator.TranslateToFrench(createResult.Errors);
                return AccountingFirmRegistrationResult.ValidationFailure(errorMessage);
            }

            // Aligne sur le chemin entreprise : un gerant sans role ne peut pas utiliser son
            // espace cabinet. Echouer ici est sans risque de base orpheline, la creation de la
            // base intervient quelques lignes plus bas.
            var addToRoleResult = await _userManager.AddToRoleAsync(user, UserRole.FirmManager.ToString());
            if (!addToRoleResult.Succeeded)
            {
                await transaction.RollbackAsync(cancellationToken);
                _logger.LogError(
                    "Firm registration failed: could not assign the {Role} role to {Email}. Source={Source} CorrelationId={CorrelationId} Errors={Errors}",
                    UserRole.FirmManager,
                    LogSanitizer.MaskEmail(dto.Email),
                    context.Source,
                    correlationId,
                    string.Join(" | ", addToRoleResult.Errors.Select(e => e.Code)));

                return AccountingFirmRegistrationResult.ValidationFailure(
                    IdentityErrorTranslator.TranslateToFrench(addToRoleResult.Errors));
            }

            LogStep("IdentityCreate", identitySw.ElapsedMilliseconds, tenant.Id, correlationId, context);

            var provisionSw = Stopwatch.StartNew();
            await _tenantService.CreateAccountingFirmDatabaseAsync(tenant.Id, tenant.DatabaseName, cancellationToken);
            LogStep("DatabaseProvision", provisionSw.ElapsedMilliseconds, tenant.Id, correlationId, context);

            await _masterContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsNifUniqueViolation(ex))
        {
            await transaction.RollbackAsync(cancellationToken);
            _logger.LogWarning(
                "Firm registration rejected: duplicate NIF for {Email}. Source={Source} CorrelationId={CorrelationId}",
                LogSanitizer.MaskEmail(dto.Email),
                context.Source,
                correlationId);
            return AccountingFirmRegistrationResult.ConflictNifFailure(DuplicateNifMessage);
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(cancellationToken);

            if (!string.IsNullOrEmpty(provisionedDatabaseName))
                await _tenantService.TryDropDatabaseAsync(provisionedDatabaseName, cancellationToken);

            _logger.LogError(
                ex,
                "Firm registration failed for {Email}. Source={Source} CorrelationId={CorrelationId}",
                LogSanitizer.MaskEmail(dto.Email),
                context.Source,
                correlationId);

            return AccountingFirmRegistrationResult.InternalFailure(correlationId);
        }

        var warnings = new List<RegistrationWarningDto>();

        // Phase 3 : forfait applique APRES le commit, via le service d'administration existant.
        // Un echec n'invalide jamais un cabinet deja cree.
        await ApplySubscriptionPlanAsync(tenant.Id, context, warnings, correlationId, cancellationToken);

        AuthResponseDto? tokens = null;
        if (context.IssueAuthTokens)
        {
            var tokenSw = Stopwatch.StartNew();
            tokens = await _tokenService.GenerateTokensAsync(user.Id, tenant.Id, cancellationToken: cancellationToken);
            LogStep("TokenGeneration", tokenSw.ElapsedMilliseconds, tenant.Id, correlationId, context);
        }

        totalSw.Stop();
        LogStep("Total", totalSw.ElapsedMilliseconds, tenant.Id, correlationId, context);

        if (context.PlatformActorUserId is not null)
        {
            _logger.LogInformation(
                "Platform tenant provision: actor={ActorId} tenant={TenantId} kind=AccountingFirm source={Source} CorrelationId={CorrelationId} DurationMs={DurationMs}",
                context.PlatformActorUserId,
                tenant.Id,
                context.Source,
                correlationId,
                totalSw.ElapsedMilliseconds);
        }
        else
        {
            _logger.LogInformation(
                "Accounting firm {FirmName} registered by {Email}. CorrelationId={CorrelationId} DurationMs={DurationMs}",
                dto.FirmName,
                LogSanitizer.MaskEmail(dto.Email),
                correlationId,
                totalSw.ElapsedMilliseconds);
        }

        var provision = new PlatformProvisionTenantResultDto
        {
            TenantId = tenant.Id,
            TenantKind = TenantKind.AccountingFirm,
            DisplayName = dto.FirmName,
            ProvisioningStatus = tenant.ProvisioningStatus,
            ManagerUserId = user.Id,
            ManagerEmail = user.Email!,
            RegistrationWarnings = warnings,
            CorrelationId = correlationId
        };

        return AccountingFirmRegistrationResult.Ok(tokens, provision, totalSw.ElapsedMilliseconds);
    }

    private async Task ApplySubscriptionPlanAsync(
        Guid tenantId,
        AccountingFirmRegistrationContext context,
        List<RegistrationWarningDto> warnings,
        string correlationId,
        CancellationToken cancellationToken)
    {
        if (context.Plan == SubscriptionPlan.Free)
            return;

        try
        {
            var planResult = await _subscriptionAdminService.ChangePlanAsync(tenantId, context.Plan, cancellationToken);
            if (planResult.IsSuccess)
                return;

            _logger.LogError(
                "Subscription plan {Plan} could not be applied to firm tenant {TenantId}: {Reason}. Source={Source} CorrelationId={CorrelationId}",
                context.Plan,
                tenantId,
                planResult.Error.Description,
                context.Source,
                correlationId);
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Subscription plan {Plan} could not be applied to firm tenant {TenantId}. Source={Source} CorrelationId={CorrelationId}",
                context.Plan,
                tenantId,
                context.Source,
                correlationId);
        }

        warnings.Add(RegistrationWarningDto.Warning(
            RegistrationWarningCodes.SubscriptionPlanNotApplied,
            $"Le cabinet a bien été créé mais le forfait « {context.Plan} » n'a pas pu être appliqué. Ajustez-le depuis la fiche."));
    }

    private static bool IsNifUniqueViolation(DbUpdateException ex)
    {
        if (ex.InnerException is not Microsoft.Data.SqlClient.SqlException sqlEx)
            return false;

        return (sqlEx.Number is 2601 or 2627) && sqlEx.Message.Contains("IX_Tenants_NIF", StringComparison.OrdinalIgnoreCase);
    }

    private void LogStep(string step, long durationMs, Guid? tenantId, string correlationId, AccountingFirmRegistrationContext context)
    {
        _logger.LogInformation(
            "FirmRegistration.Step={Step} DurationMs={DurationMs} TenantId={TenantId} CorrelationId={CorrelationId} Source={Source}",
            step,
            durationMs,
            tenantId,
            correlationId,
            context.Source);
    }
}
