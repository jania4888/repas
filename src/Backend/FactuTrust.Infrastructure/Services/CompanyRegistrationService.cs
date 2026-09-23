using System.Diagnostics;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Common.Logging;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.SectorConfiguration;
using FactuTrust.Domain.ValueObjects;
using DomainEmail = FactuTrust.Domain.ValueObjects.Email;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services;

public sealed class CompanyRegistrationService : ICompanyRegistrationService
{
    private const string DuplicateNifMessage =
        "Une société avec ce matricule fiscal existe déjà. Contactez le support si vous pensez qu'il s'agit d'une erreur.";

    private const string ProvisioningUserMessage =
        "L'inscription n'a pas pu être finalisée. Réessayez plus tard ou contactez le support.";

    private readonly UserManager<ApplicationUser> _userManager;
    private readonly MasterDbContext _masterContext;
    private readonly ITenantService _tenantService;
    private readonly ITenantAuthTokenService _tokenService;
    private readonly IRegistrationSectorService _registrationSectorService;
    private readonly ISectorCatalogProvider _sectorCatalogProvider;
    private readonly RegistrationSectorOptions _registrationSectorOptions;
    private readonly EmailVerificationOptions _emailVerificationOptions;
    private readonly IEmailService _emailService;
    private readonly ISubscriptionAdminService _subscriptionAdminService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CompanyRegistrationService> _logger;

    public CompanyRegistrationService(
        UserManager<ApplicationUser> userManager,
        MasterDbContext masterContext,
        ITenantService tenantService,
        ITenantAuthTokenService tokenService,
        IRegistrationSectorService registrationSectorService,
        ISectorCatalogProvider sectorCatalogProvider,
        IOptions<RegistrationSectorOptions> registrationSectorOptions,
        IOptions<EmailVerificationOptions> emailVerificationOptions,
        IEmailService emailService,
        ISubscriptionAdminService subscriptionAdminService,
        IConfiguration configuration,
        ILogger<CompanyRegistrationService> logger)
    {
        _userManager = userManager;
        _masterContext = masterContext;
        _tenantService = tenantService;
        _tokenService = tokenService;
        _registrationSectorService = registrationSectorService;
        _sectorCatalogProvider = sectorCatalogProvider;
        _registrationSectorOptions = registrationSectorOptions.Value;
        _emailVerificationOptions = emailVerificationOptions.Value;
        _emailService = emailService;
        _subscriptionAdminService = subscriptionAdminService;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<CompanyRegistrationResult> RegisterAsync(
        RegisterDto dto,
        CompanyRegistrationContext context,
        CancellationToken cancellationToken = default)
    {
        var correlationId = Guid.NewGuid().ToString("N");
        var totalSw = Stopwatch.StartNew();

        var validationSw = Stopwatch.StartNew();

        // Le chemin cabinet applique cette regle depuis toujours ; le chemin entreprise ne la
        // verifiait que cote client. Un couple divergent creait donc un compte dont le mot de
        // passe n'etait pas celui que l'utilisateur croyait avoir choisi.
        if (dto.Password != dto.ConfirmPassword)
        {
            _logger.LogWarning(
                "Registration rejected: password confirmation mismatch. Source={Source} CorrelationId={CorrelationId}",
                context.Source,
                correlationId);
            return CompanyRegistrationResult.ValidationFailure("Les mots de passe ne correspondent pas");
        }

        var nifResult = NIF.Create(dto.Nif);
        if (nifResult.IsFailure)
            return CompanyRegistrationResult.ValidationFailure(nifResult.Error.Description);

        var addressResult = Address.Create(dto.Street, dto.City, dto.Governorate, dto.StreetLine2, dto.PostalCode);
        if (addressResult.IsFailure)
            return CompanyRegistrationResult.ValidationFailure(addressResult.Error.Description);

        var emailResult = DomainEmail.Create(dto.CompanyEmail);
        if (emailResult.IsFailure)
            return CompanyRegistrationResult.ValidationFailure(emailResult.Error.Description);

        var phoneResult = PhoneNumber.Create(dto.Phone);
        if (phoneResult.IsFailure)
            return CompanyRegistrationResult.ValidationFailure(phoneResult.Error.Description);

        if (dto.EnabledModules is { Count: > 0 })
        {
            var invalidModuleIds = dto.EnabledModules
                .Where(id => !Enum.IsDefined(typeof(AppModule), id))
                .Distinct()
                .ToList();
            if (invalidModuleIds.Count > 0)
            {
                return CompanyRegistrationResult.ValidationFailure(
                    $"Modules invalides : {string.Join(", ", invalidModuleIds)}. Veuillez sélectionner des modules valides.");
            }
        }

        var sectorProfileResult = _registrationSectorService.ResolveProfile(dto.CompanySegment, dto.BusinessDomain);
        if (sectorProfileResult.IsFailure)
            return CompanyRegistrationResult.ValidationFailure(sectorProfileResult.Error.Description);
        var sectorProfile = sectorProfileResult.Value;

        var warnings = new List<RegistrationWarningDto>();
        if (!_registrationSectorOptions.Enabled
            && (!string.IsNullOrWhiteSpace(dto.CompanySegment) || !string.IsNullOrWhiteSpace(dto.BusinessDomain)))
        {
            warnings.Add(RegistrationWarningDto.Info(
                RegistrationWarningCodes.SectorSelectionIgnored,
                "La sélection du type de société/domaine d'activité n'a pas été appliquée (fonctionnalité désactivée) ; la configuration par défaut est active."));
        }

        if (_registrationSectorOptions.NifSegmentCoherenceWarningEnabled)
        {
            var nifCoherenceWarning = NifCategorySegmentCoherenceChecker.CheckCoherence(nifResult.Value, dto.CompanySegment);
            if (nifCoherenceWarning is not null)
            {
                warnings.Add(RegistrationWarningDto.Warning(
                    RegistrationWarningCodes.NifSegmentMismatch,
                    nifCoherenceWarning));
            }
        }

        LogStep("Validation", validationSw.ElapsedMilliseconds, null, correlationId, context);

        var emailCheckSw = Stopwatch.StartNew();
        var existingUser = await _userManager.FindByEmailAsync(dto.Email);
        LogStep("EmailPrecheck", emailCheckSw.ElapsedMilliseconds, null, correlationId, context);
        if (existingUser is not null)
            return CompanyRegistrationResult.DuplicateEmailFailure();

        var nifCheckSw = Stopwatch.StartNew();
        var nifValue = nifResult.Value.Value;
        var nifLegacy = nifResult.Value.LegacySpelling;
        var nifExists = await _masterContext.Tenants.AsNoTracking()
            .AnyAsync(t => t.IsActive && (t.NIF.Value == nifValue || t.NIF.Value == nifLegacy), cancellationToken);
        LogStep("NifPrecheck", nifCheckSw.ElapsedMilliseconds, null, correlationId, context);
        if (nifExists)
            return CompanyRegistrationResult.ConflictNifFailure(DuplicateNifMessage);

        Guid? tenantId = null;

        await using var transaction = await _masterContext.Database.BeginTransactionAsync(cancellationToken);

        Tenant tenant;
        ApplicationUser user;

        try
        {
            var tenantResult = Tenant.Create(
                dto.CompanyName,
                nifResult.Value,
                addressResult.Value,
                emailResult.Value,
                phoneResult.Value,
                dto.TaxRegime,
                dto.Website);

            if (tenantResult.IsFailure)
            {
                await transaction.RollbackAsync(cancellationToken);
                return CompanyRegistrationResult.ValidationFailure(tenantResult.Error.Description);
            }

            tenant = tenantResult.Value;
            if (tenant.Id == Guid.Empty)
            {
                await transaction.RollbackAsync(cancellationToken);
                return CompanyRegistrationResult.ValidationFailure("Erreur interne : identifiant entreprise invalide.");
            }

            tenantId = tenant.Id;
            tenant.SetSectorClassification(sectorProfile?.SegmentCode, sectorProfile?.DomainCode);

            if (sectorProfile is not null)
            {
                var catalogSnapshot = _sectorCatalogProvider.GetSnapshot();
                tenant.SetSectorCatalogVersion(catalogSnapshot.CatalogVersionTag);
            }

            tenant.SetRegistrationProfile(
                dto.ProfileAnswers?.HasPhysicalStock,
                dto.ProfileAnswers?.SellsToConsumers,
                dto.ProfileAnswers?.HeadcountBand,
                dto.ProfileAnswers?.AccountingDelegatedToFirm);

            var masterSw = Stopwatch.StartNew();
            _masterContext.Tenants.Add(tenant);

            var subscription = Subscription.CreateFree(tenant.Id);
            _masterContext.Subscriptions.Add(subscription);
            await _masterContext.SaveChangesAsync(cancellationToken);
            LogStep("MasterEntities", masterSw.ElapsedMilliseconds, tenant.Id, correlationId, context);

            var emailConfirmed = context.ForceEmailConfirmed || !_emailVerificationOptions.Enabled;

            user = new ApplicationUser
            {
                UserName = dto.Email,
                Email = dto.Email,
                FirstName = dto.FirstName,
                LastName = dto.LastName,
                TenantId = tenant.Id,
                EmailConfirmed = emailConfirmed
            };
            user.ApplyNewInteractiveProductOnboarding();

            var identitySw = Stopwatch.StartNew();
            var createResult = await _userManager.CreateAsync(user, dto.Password);
            if (!createResult.Succeeded)
            {
                await transaction.RollbackAsync(cancellationToken);
                return CompanyRegistrationResult.ValidationFailure(IdentityErrorTranslator.TranslateToFrench(createResult.Errors));
            }

            var addToRoleResult = await _userManager.AddToRoleAsync(user, UserRole.Administrator.ToString());
            if (!addToRoleResult.Succeeded)
            {
                await transaction.RollbackAsync(cancellationToken);
                _logger.LogError(
                    "Registration failed: could not assign the {Role} role to {Email}. Source={Source} CorrelationId={CorrelationId} Errors={Errors}",
                    UserRole.Administrator,
                    LogSanitizer.MaskEmail(dto.Email),
                    context.Source,
                    correlationId,
                    string.Join(" | ", addToRoleResult.Errors.Select(e => e.Code)));

                var roleErrors = IdentityErrorTranslator.TranslateToFrench(addToRoleResult.Errors);
                return CompanyRegistrationResult.ValidationFailure(roleErrors);
            }

            LogStep("IdentityCreate", identitySw.ElapsedMilliseconds, tenant.Id, correlationId, context);

            // Le forfait pilote le plafond de modules accordables. Le chemin public passe
            // toujours Free (impose par CompanyRegistrationContext.Public()).
            var moduleOutcome = await _registrationSectorService.ApplyModuleSelectionAsync(
                user.Id,
                sectorProfile,
                dto.EnabledModules,
                context.Plan,
                cancellationToken);

            await _masterContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            AppendModuleSelectionWarnings(warnings, moduleOutcome, tenant.Id, correlationId);
        }
        catch (DbUpdateException ex) when (IsNifUniqueViolation(ex))
        {
            await transaction.RollbackAsync(cancellationToken);
            _logger.LogWarning(
                "Registration rejected: concurrent duplicate NIF for {Email}. Source={Source} CorrelationId={CorrelationId}",
                LogSanitizer.MaskEmail(dto.Email),
                context.Source,
                correlationId);
            return CompanyRegistrationResult.ConflictNifFailure(DuplicateNifMessage);
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(cancellationToken);

            // Pas de TryDropDatabaseAsync ici : sur le chemin entreprise la base physique n'est
            // creee qu'APRES le commit (plus bas), donc aucune base ne peut exister a ce stade.
            // Le nettoyage post-commit est gere par le catch de la phase 2.
            // (Le chemin cabinet, lui, cree sa base DANS la transaction : son drop y est necessaire.)
            _logger.LogError(
                ex,
                "Registration failed for {Email}. Source={Source} CorrelationId={CorrelationId} TenantId={TenantId}",
                LogSanitizer.MaskEmail(dto.Email),
                context.Source,
                correlationId,
                tenantId);

            return CompanyRegistrationResult.InternalFailure(ProvisioningUserMessage, correlationId);
        }

        try
        {
            var provisionSw = Stopwatch.StartNew();
            var effectiveWarehouseName = !string.IsNullOrWhiteSpace(dto.WarehouseName)
                ? dto.WarehouseName
                : sectorProfile?.DefaultWarehouseName;
            await _tenantService.CreateTenantDatabaseAsync(tenant.Id, tenant.DatabaseName, effectiveWarehouseName, cancellationToken);
            LogStep("DatabaseProvision", provisionSw.ElapsedMilliseconds, tenant.Id, correlationId, context);

            tenant.MarkProvisioningReady();
            await _masterContext.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Tenant database provisioning failed after master commit for {Email}. Source={Source} CorrelationId={CorrelationId} TenantId={TenantId}",
                LogSanitizer.MaskEmail(dto.Email),
                context.Source,
                correlationId,
                tenant.Id);

            try
            {
                tenant.MarkProvisioningFailed();
                await _masterContext.SaveChangesAsync(cancellationToken);
            }
            catch (Exception markFailedEx)
            {
                _logger.LogError(
                    markFailedEx,
                    "Failed to mark tenant {TenantId} as provisioning-failed. CorrelationId={CorrelationId}",
                    tenant.Id,
                    correlationId);
            }

            await _tenantService.TryDropDatabaseAsync(tenant.DatabaseName, cancellationToken);
            return CompanyRegistrationResult.ProvisioningFailed(ProvisioningUserMessage, correlationId);
        }

        // Phase 3 : le forfait est applique APRES le commit et le provisionnement, via le service
        // d'administration deja utilise par PlatformTenantsController. Un echec ici ne remet jamais
        // en cause un dossier deja cree : il devient un avertissement, le forfait restant
        // ajustable depuis la fiche entreprise.
        await ApplySubscriptionPlanAsync(tenant.Id, context, warnings, correlationId, cancellationToken);

        if (_emailVerificationOptions.Enabled && !context.ForceEmailConfirmed)
            await SendVerificationEmailAsync(user, cancellationToken);

        AuthResponseDto? tokens = null;
        if (context.IssueAuthTokens)
        {
            var tokenSw = Stopwatch.StartNew();
            tokens = await _tokenService.GenerateTokensAsync(user.Id, tenant.Id, cancellationToken: cancellationToken);
            LogStep("TokenGeneration", tokenSw.ElapsedMilliseconds, tenant.Id, correlationId, context);

            if (warnings.Count > 0)
            {
                tokens = tokens with
                {
                    Warnings = warnings.Select(w => w.Message).ToList(),
                    WarningDetails = warnings
                };
            }
        }

        totalSw.Stop();
        LogStep("Total", totalSw.ElapsedMilliseconds, tenant.Id, correlationId, context);

        if (context.PlatformActorUserId is not null)
        {
            _logger.LogInformation(
                "Platform tenant provision: actor={ActorId} tenant={TenantId} kind=Company source={Source} CorrelationId={CorrelationId} DurationMs={DurationMs}",
                context.PlatformActorUserId,
                tenant.Id,
                context.Source,
                correlationId,
                totalSw.ElapsedMilliseconds);
        }
        else
        {
            _logger.LogInformation(
                "User {Email} registered with tenant {TenantId}. CorrelationId={CorrelationId} DurationMs={DurationMs}",
                LogSanitizer.MaskEmail(dto.Email),
                tenant.Id,
                correlationId,
                totalSw.ElapsedMilliseconds);
        }

        var provision = new PlatformProvisionTenantResultDto
        {
            TenantId = tenant.Id,
            TenantKind = TenantKind.Company,
            DisplayName = tenant.CompanyName,
            ProvisioningStatus = tenant.ProvisioningStatus,
            ManagerUserId = user.Id,
            ManagerEmail = user.Email!,
            RegistrationWarnings = warnings,
            CorrelationId = correlationId
        };

        return new CompanyRegistrationResult
        {
            Success = true,
            Tokens = tokens,
            Provision = provision,
            CorrelationId = correlationId
        };
    }

    private async Task ApplySubscriptionPlanAsync(
        Guid tenantId,
        CompanyRegistrationContext context,
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
                "Subscription plan {Plan} could not be applied to tenant {TenantId}: {Reason}. Source={Source} CorrelationId={CorrelationId}",
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
                "Subscription plan {Plan} could not be applied to tenant {TenantId}. Source={Source} CorrelationId={CorrelationId}",
                context.Plan,
                tenantId,
                context.Source,
                correlationId);
        }

        warnings.Add(RegistrationWarningDto.Warning(
            RegistrationWarningCodes.SubscriptionPlanNotApplied,
            $"Le dossier a bien été créé mais le forfait « {context.Plan} » n'a pas pu être appliqué. Ajustez-le depuis la fiche entreprise."));
    }

    private void AppendModuleSelectionWarnings(List<RegistrationWarningDto> warnings, ModuleSelectionOutcome outcome, Guid tenantId, string correlationId)
    {
        if (outcome.Ignored)
        {
            warnings.Add(RegistrationWarningDto.Info(
                RegistrationWarningCodes.ModulesSelectionIgnored,
                "La sélection de modules n'a pas été appliquée (fonctionnalité désactivée) ; les modules par défaut sont actifs."));
            _logger.LogWarning(
                "Register: module selection ignored (kill-switch off) for tenant {TenantId}. CorrelationId={CorrelationId}",
                tenantId,
                correlationId);
        }

        if (outcome.DeniedByPlan.Count > 0)
        {
            var premiumDenied = outcome.DeniedByPlan.Where(m => m.IsPaidPlanOnly()).ToList();
            var misconfiguredDenied = outcome.DeniedByPlan.Where(m => !m.IsPaidPlanOnly()).ToList();

            if (premiumDenied.Count > 0)
            {
                var premiumNames = string.Join(", ", premiumDenied.Select(m => m.ToDisplayString()));
                warnings.Add(RegistrationWarningDto.Info(
                    RegistrationWarningCodes.ModulesDeniedByPlan,
                    $"Certains modules choisis nécessitent une offre supérieure et n'ont pas été activés : {premiumNames}."));
            }

            if (misconfiguredDenied.Count > 0)
            {
                var misconfiguredNames = string.Join(", ", misconfiguredDenied.Select(m => m.ToDisplayString()));
                warnings.Add(RegistrationWarningDto.Warning(
                    RegistrationWarningCodes.ModulesActivationFailed,
                    $"Certains modules choisis n'ont pas pu être activés et le seront prochainement : {misconfiguredNames}. Nos équipes en sont informées."));
                _logger.LogError(
                    "Register: plan misconfiguration for tenant {TenantId}: {Modules}. CorrelationId={CorrelationId}",
                    tenantId,
                    misconfiguredNames,
                    correlationId);
            }
        }

        if (outcome.DroppedInvalidIds.Count > 0)
        {
            warnings.Add(RegistrationWarningDto.Info(
                RegistrationWarningCodes.ModulesIgnoredAtRegistration,
                "Certains modules sélectionnés ne sont pas disponibles à l'inscription et ont été ignorés."));
        }
    }

    private static bool IsNifUniqueViolation(DbUpdateException ex)
    {
        if (ex.InnerException is not Microsoft.Data.SqlClient.SqlException sqlEx)
            return false;

        return (sqlEx.Number is 2601 or 2627) && sqlEx.Message.Contains("IX_Tenants_NIF", StringComparison.OrdinalIgnoreCase);
    }

    private async Task SendVerificationEmailAsync(ApplicationUser user, CancellationToken cancellationToken)
    {
        try
        {
            var token = await _userManager.GenerateEmailConfirmationTokenAsync(user);
            var frontendBase = _configuration["App:FrontendBaseUrl"]?.TrimEnd('/') ?? "http://localhost:4200";
            var verifyUrl =
                $"{frontendBase}/auth/verify-email?email={Uri.EscapeDataString(user.Email!)}&token={Uri.EscapeDataString(token)}";

            var recipientName = $"{user.FirstName} {user.LastName}".Trim();
            if (string.IsNullOrWhiteSpace(recipientName))
                recipientName = user.Email!;

            var htmlBody = $"""
                <p>Bonjour <strong>{System.Net.WebUtility.HtmlEncode(recipientName)}</strong>,</p>
                <p>Merci de vous être inscrit sur InstaFact. Confirmez votre adresse email pour finaliser votre inscription.</p>
                <p><a href="{verifyUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;">Vérifier mon adresse email</a></p>
                <p style="color:#666;font-size:12px;">Si vous n'êtes pas à l'origine de cette inscription, ignorez cet email. Ce lien expire après 24 heures.</p>
                """;

            await _emailService.SendEmailAsync(
                user.Email!,
                "Vérifiez votre adresse email InstaFact",
                htmlBody,
                cancellationToken: cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send verification email for {Email}", LogSanitizer.MaskEmail(user.Email ?? "<null>"));
        }
    }

    private void LogStep(string step, long durationMs, Guid? tenantId, string correlationId, CompanyRegistrationContext context)
    {
        _logger.LogInformation(
            "CompanyRegistration.Step={Step} DurationMs={DurationMs} TenantId={TenantId} CorrelationId={CorrelationId} Source={Source}",
            step,
            durationMs,
            tenantId,
            correlationId,
            context.Source);
    }
}
