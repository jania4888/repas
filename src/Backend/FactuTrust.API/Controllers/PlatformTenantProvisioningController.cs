using System.Security.Claims;
using FactuTrust.API.Authorization;
using FactuTrust.API.Validation;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace FactuTrust.API.Controllers;

[ApiController]
[Route("api/platform/tenants")]
[Authorize(Policy = PlatformPolicies.PlatformAdmin)]
public sealed class PlatformTenantProvisioningController : ControllerBase
{
    private readonly ICompanyRegistrationService _companyRegistrationService;
    private readonly IAccountingFirmRegistrationService _accountingFirmRegistrationService;
    private readonly IAccountingFirmsFeature _accountingFirmsFeature;
    private readonly ITenantProvisioningRetryService _provisioningRetryService;
    private readonly IPlatformActionAuditWriter _auditWriter;
    private readonly ILogger<PlatformTenantProvisioningController> _logger;

    public PlatformTenantProvisioningController(
        ICompanyRegistrationService companyRegistrationService,
        IAccountingFirmRegistrationService accountingFirmRegistrationService,
        IAccountingFirmsFeature accountingFirmsFeature,
        ITenantProvisioningRetryService provisioningRetryService,
        IPlatformActionAuditWriter auditWriter,
        ILogger<PlatformTenantProvisioningController> logger)
    {
        _companyRegistrationService = companyRegistrationService;
        _accountingFirmRegistrationService = accountingFirmRegistrationService;
        _accountingFirmsFeature = accountingFirmsFeature;
        _provisioningRetryService = provisioningRetryService;
        _auditWriter = auditWriter;
        _logger = logger;
    }

    [HttpPost("companies")]
    [Authorize(Policy = "perm:" + PlatformPermissions.TenantsWrite)]
    [EnableRateLimiting("platform-tenant-create")]
    [ProducesResponseType(typeof(ApiResponse<PlatformProvisionTenantResultDto>), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> CreateCompany(
        [FromBody] PlatformCreateCompanyRequestDto dto,
        CancellationToken cancellationToken)
    {
        if (!TryGetPlatformActorId(out var actorId))
            return Forbid();

        var validationErrors = PlatformTenantProvisioningValidator.Validate(dto);
        if (validationErrors.Count > 0)
        {
            return BadRequest(ApiResponse<PlatformProvisionTenantResultDto>.Fail(
                string.Join(" ", validationErrors)));
        }

        var plan = ResolveRequestedPlan(dto.Plan);

        var result = await _companyRegistrationService.RegisterAsync(
            dto.ToRegisterDto(),
            CompanyRegistrationContext.Platform(actorId, plan),
            cancellationToken);

        await WriteAuditAsync(
            PlatformAuditActions.TenantCreateCompany,
            actorId,
            result.Success,
            result.Provision?.TenantId,
            result.CorrelationId ?? result.Provision?.CorrelationId,
            new Dictionary<string, object?>
            {
                ["companySegment"] = dto.CompanySegment,
                ["businessDomain"] = dto.BusinessDomain,
                ["enabledModules"] = dto.EnabledModules,
                ["plan"] = plan.ToString(),
                ["taxRegime"] = dto.TaxRegime.ToString(),
                ["failureKind"] = result.FailureKind?.ToString(),
                ["failureReason"] = result.Success ? null : result.ErrorMessage
            },
            cancellationToken);

        return MapCompanyResult(result);
    }

    [HttpPost("accounting-firms")]
    [Authorize(Policy = "perm:" + PlatformPermissions.TenantsWrite)]
    [EnableRateLimiting("platform-tenant-create")]
    [ProducesResponseType(typeof(ApiResponse<PlatformProvisionTenantResultDto>), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> CreateAccountingFirm(
        [FromBody] PlatformCreateFirmRequestDto dto,
        CancellationToken cancellationToken)
    {
        if (!_accountingFirmsFeature.IsEnabled)
            return NotFound();

        if (!TryGetPlatformActorId(out var actorId))
            return Forbid();

        var validationErrors = PlatformTenantProvisioningValidator.Validate(dto);
        if (validationErrors.Count > 0)
        {
            return BadRequest(ApiResponse<PlatformProvisionTenantResultDto>.Fail(
                string.Join(" ", validationErrors)));
        }

        var plan = ResolveRequestedPlan(dto.Plan);

        var result = await _accountingFirmRegistrationService.RegisterAsync(
            dto.ToRegisterDto(),
            AccountingFirmRegistrationContext.Platform(actorId, plan),
            cancellationToken);

        await WriteAuditAsync(
            PlatformAuditActions.TenantCreateFirm,
            actorId,
            result.Success,
            result.Provision?.TenantId,
            result.CorrelationId ?? result.Provision?.CorrelationId,
            new Dictionary<string, object?>
            {
                ["plan"] = plan.ToString(),
                ["isPublicInDirectory"] = dto.IsPublicInDirectory,
                ["failureKind"] = result.FailureKind?.ToString(),
                ["failureReason"] = result.Success ? null : result.Errors.FirstOrDefault()
            },
            cancellationToken);

        return MapFirmResult(result);
    }

    /// <summary>
    /// Rejoue la phase 2 du provisionnement (creation de la base du tenant) pour un dossier reste
    /// en attente ou en echec. Sans cette action, un tel dossier reste invisible et inutilisable :
    /// l'entreprise et l'utilisateur existent en base maitre mais aucune base ne leur repond.
    /// </summary>
    [HttpPost("{tenantId:guid}/provisioning/retry")]
    [Authorize(Policy = "perm:" + PlatformPermissions.TenantsWrite)]
    [EnableRateLimiting("platform-tenant-retry")]
    [ProducesResponseType(typeof(ApiResponse<PlatformProvisionTenantResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> RetryProvisioning(Guid tenantId, CancellationToken cancellationToken)
    {
        if (!TryGetPlatformActorId(out var actorId))
            return Forbid();

        var result = await _provisioningRetryService.RetryAsync(tenantId, actorId, cancellationToken);

        await WriteAuditAsync(
            PlatformAuditActions.TenantProvisioningRetry,
            actorId,
            result.Success,
            tenantId,
            result.CorrelationId,
            new Dictionary<string, object?>
            {
                ["failureKind"] = result.FailureKind?.ToString(),
                ["failureReason"] = result.Success ? null : result.ErrorMessage,
                // Trace d'audit essentielle : distingue une base recréée d'un simple
                // redressement de statut sur une base intacte.
                ["repairedWithoutRecreate"] = result.Success ? result.Repaired : null
            },
            cancellationToken);

        if (result.Success)
        {
            return Ok(ApiResponse<TenantProvisioningRetryResultDto>.Ok(
                new TenantProvisioningRetryResultDto
                {
                    TenantId = result.TenantId,
                    DisplayName = result.DisplayName ?? string.Empty,
                    CorrelationId = result.CorrelationId ?? string.Empty,
                    Repaired = result.Repaired
                },
                result.Repaired
                    ? "Dossier rétabli : sa base était déjà provisionnée, seul le statut était resté bloqué. Aucune donnée n'a été touchée."
                    : "Provisionnement relancé avec succès."));
        }

        return result.FailureKind switch
        {
            TenantProvisioningRetryFailureKind.NotFound =>
                NotFound(ApiResponse<TenantProvisioningRetryResultDto>.Fail(result.ErrorMessage ?? "Entreprise introuvable.")),
            TenantProvisioningRetryFailureKind.AlreadyReady =>
                Conflict(ApiResponse<TenantProvisioningRetryResultDto>.Fail(result.ErrorMessage ?? "Entreprise deja provisionnee.")),
            _ => StatusCode(
                StatusCodes.Status500InternalServerError,
                ApiResponse<TenantProvisioningRetryResultDto>.Fail(
                    WithReference(
                        result.ErrorMessage ?? "La reprise du provisionnement a echoue.",
                        "RETRY",
                        result.CorrelationId)))
        };
    }

    /// <summary>
    /// Un forfait payant ne peut être provisionné que par un opérateur détenant
    /// <c>platform.subscription:change-plan</c>. La garde est ici, côté serveur : masquer le
    /// sélecteur dans l'interface ne protège rien.
    /// </summary>
    private SubscriptionPlan ResolveRequestedPlan(SubscriptionPlan? requestedPlan)
    {
        if (requestedPlan is not { } plan || plan == SubscriptionPlan.Free)
            return SubscriptionPlan.Free;

        var canChangePlan = User.HasClaim(
            AuthClaimTypes.Permission,
            PlatformPermissions.SubscriptionChangePlan);

        if (canChangePlan)
            return plan;

        _logger.LogWarning(
            "Platform tenant provisioning: requested plan {Plan} downgraded to Free, actor lacks {Permission}",
            plan,
            PlatformPermissions.SubscriptionChangePlan);

        return SubscriptionPlan.Free;
    }

    /// <summary>
    /// Consigne l'action, en succes comme en echec. Jamais bloquant : l'ecrivain avale ses propres
    /// erreurs, une trace perdue ne doit pas transformer une creation reussie en echec.
    /// </summary>
    private Task WriteAuditAsync(
        string action,
        Guid actorId,
        bool success,
        Guid? targetTenantId,
        string? correlationId,
        IReadOnlyDictionary<string, object?> details,
        CancellationToken cancellationToken)
    {
        return _auditWriter.WriteAsync(
            new PlatformActionAuditRecord(
                actorId,
                User.FindFirstValue(ClaimTypes.Email),
                action,
                success ? PlatformAuditOutcomes.Success : PlatformAuditOutcomes.Failed,
                targetTenantId,
                correlationId,
                details),
            cancellationToken);
    }

    private bool TryGetPlatformActorId(out Guid actorId)
    {
        actorId = default;
        if (!Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out actorId))
            return false;

        var tenantClaim = User.FindFirstValue("tenant_id");
        if (!string.IsNullOrEmpty(tenantClaim)
            && Guid.TryParse(tenantClaim, out var tenantId)
            && tenantId != Guid.Empty)
        {
            _logger.LogWarning(
                "Rejected platform tenant provisioning: user {UserId} carries non-empty tenant_id {TenantId}",
                actorId,
                tenantId);
            return false;
        }

        return true;
    }

    private IActionResult MapCompanyResult(CompanyRegistrationResult result)
    {
        if (result.Success && result.Provision is not null)
        {
            return Created(
                $"/api/platform/tenants/{result.Provision.TenantId}",
                ApiResponse<PlatformProvisionTenantResultDto>.Ok(result.Provision, "Entreprise créée"));
        }

        return result.FailureKind switch
        {
            CompanyRegistrationFailureKind.Validation or CompanyRegistrationFailureKind.IdentityError or CompanyRegistrationFailureKind.DuplicateEmail =>
                BadRequest(ApiResponse<PlatformProvisionTenantResultDto>.Fail(FormatErrors(result.Errors))),
            CompanyRegistrationFailureKind.ConflictNif =>
                Conflict(ApiResponse<PlatformProvisionTenantResultDto>.Fail(result.ErrorMessage ?? "Conflit matricule fiscal.")),
            CompanyRegistrationFailureKind.ProvisioningFailed or CompanyRegistrationFailureKind.Internal =>
                StatusCode(
                    StatusCodes.Status500InternalServerError,
                    ApiResponse<PlatformProvisionTenantResultDto>.Fail(
                        WithReference(
                            result.ErrorMessage ?? "La création n'a pas pu être finalisée.",
                            "REG",
                            result.CorrelationId))),
            _ => StatusCode(StatusCodes.Status500InternalServerError, ApiResponse<PlatformProvisionTenantResultDto>.Fail("Erreur inattendue."))
        };
    }

    private IActionResult MapFirmResult(AccountingFirmRegistrationResult result)
    {
        if (result.Success && result.Provision is not null)
        {
            return Created(
                $"/api/platform/tenants/{result.Provision.TenantId}",
                ApiResponse<PlatformProvisionTenantResultDto>.Ok(result.Provision, "Cabinet créé"));
        }

        return result.FailureKind switch
        {
            AccountingFirmRegistrationFailureKind.Validation or AccountingFirmRegistrationFailureKind.DuplicateEmail =>
                BadRequest(ApiResponse<PlatformProvisionTenantResultDto>.Fail(FormatErrors(result.Errors))),
            AccountingFirmRegistrationFailureKind.ConflictNif =>
                Conflict(ApiResponse<PlatformProvisionTenantResultDto>.Fail(FormatErrors(result.Errors))),
            _ => StatusCode(
                StatusCodes.Status500InternalServerError,
                ApiResponse<PlatformProvisionTenantResultDto>.Fail(
                    WithReference(
                        result.Errors.FirstOrDefault() ?? "La création du cabinet n'a pas pu être finalisée.",
                        "FIRM",
                        result.CorrelationId)))
        };
    }

    /// <summary>
    /// Injecte la référence de corrélation dans le message lui-même.
    /// Le paramètre <c>code</c> de <see cref="ApiResponse{T}.Fail"/> n'est pas sérialisé
    /// (cf. la remarque sur ce type) : la seule façon de faire parvenir la référence à
    /// l'opérateur — et donc au support — est de l'inclure dans le texte.
    /// </summary>
    private static string WithReference(string message, string prefix, string? correlationId) =>
        string.IsNullOrEmpty(correlationId) ? message : $"{message} (réf. {prefix}-{correlationId})";

    private static string FormatErrors(IReadOnlyList<string> errors) =>
        errors.Count > 0 ? string.Join(", ", errors) : "Requête invalide.";
}
