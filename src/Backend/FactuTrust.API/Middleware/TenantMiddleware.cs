using System.Security.Claims;
using System.Text.Json;
using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Auth;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services;

namespace FactuTrust.API.Middleware;

/// <summary>
/// Middleware that resolves the current tenant from the JWT token
/// and sets up the tenant context for the request.
/// Ensures tenant migrations are applied before any tenant-scoped operation.
/// </summary>
public sealed class TenantMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<TenantMiddleware> _logger;

    public TenantMiddleware(RequestDelegate next, ILogger<TenantMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(
        HttpContext context,
        ITenantContext tenantContext,
        ITenantService tenantService,
        ITenantMigrationGuard migrationGuard,
        IFirmAssignmentService firmAssignmentService,
        IFirmDossierAccessService firmDossierAccessService)
    {
        var path = context.Request.Path.Value ?? "";
        if (path.StartsWith("/api/public/", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        // Skip tenant resolution for unauthenticated endpoints
        if (!context.User.Identity?.IsAuthenticated ?? true)
        {
            await _next(context);
            return;
        }

        if (path.StartsWith("/api/platform", StringComparison.OrdinalIgnoreCase))
        {
            if (context.User.IsInRole(PlatformRoles.PlatformAdmin))
            {
                await _next(context);
                return;
            }

            await WriteForbiddenAsync(context, "Accès plateforme refusé.");
            return;
        }

        // Get tenant ID from claims — use delegated client context when active
        var homeTenantIdClaim = context.User.FindFirst("tenant_id")?.Value;
        var accessMode = context.User.FindFirst(AuthClaimTypes.AccessMode)?.Value;
        var contextTenantIdClaim = context.User.FindFirst(AuthClaimTypes.ContextTenantId)?.Value;

        var tenantIdClaim = homeTenantIdClaim;
        if (string.Equals(accessMode, "delegated", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrEmpty(contextTenantIdClaim))
        {
            if (!Guid.TryParse(homeTenantIdClaim, out var homeTenantId)
                || !Guid.TryParse(contextTenantIdClaim, out var contextTenantId))
            {
                await WriteForbiddenAsync(context, "Contexte dossier client invalide.", ValidationErrorCodes.DelegatedContextInvalid);
                return;
            }

            var hasActive = await firmAssignmentService.HasActiveAssignmentAsync(homeTenantId, contextTenantId, context.RequestAborted);
            if (!hasActive)
            {
                await WriteForbiddenAsync(context, FirmDossierAccessService.InactiveAssignmentMessage);
                return;
            }

            var userIdClaim = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
            var roleClaim = context.User.FindFirstValue(ClaimTypes.Role);
            if (Guid.TryParse(userIdClaim, out var userId) && !string.IsNullOrWhiteSpace(roleClaim))
            {
                var scope = FirmDossierAccessScope.ForUser(userId, roleClaim);
                var canAccess = await firmDossierAccessService.CanAccessClientDossierAsync(
                    homeTenantId, scope, contextTenantId, context.RequestAborted);
                if (!canAccess)
                {
                    var message = scope.IsFirmAccountant
                        ? FirmDossierAccessService.NotAssignedMessage
                        : FirmDossierAccessService.InactiveAssignmentMessage;
                    await WriteForbiddenAsync(context, message);
                    return;
                }
            }
            else if (context.User.IsInRole(nameof(UserRole.FirmAccountant)))
            {
                await WriteForbiddenAsync(context, FirmDossierAccessService.NotAssignedMessage);
                return;
            }

            tenantIdClaim = contextTenantIdClaim;
        }

        if (string.IsNullOrEmpty(tenantIdClaim) || !Guid.TryParse(tenantIdClaim, out var tenantId))
        {
            _logger.LogWarning("No valid tenant ID found in claims for user {UserId}",
                context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value);

            await WriteForbiddenAsync(context, "Contexte entreprise invalide. Veuillez vous reconnecter.", ValidationErrorCodes.TenantContextInvalid);
            return;
        }

        if (tenantId == Guid.Empty)
        {
            _logger.LogWarning("Tenant ID is Guid.Empty for user {UserId}",
                context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value);

            await WriteForbiddenAsync(context, "Contexte entreprise invalide. Veuillez vous reconnecter.", ValidationErrorCodes.TenantContextInvalid);
            return;
        }

        // Get connection string for tenant
        var connectionString = await tenantService.GetConnectionStringAsync(tenantId, context.RequestAborted);
        
        if (string.IsNullOrEmpty(connectionString))
        {
            var tenantKind = context.User.FindFirst(AuthClaimTypes.TenantKind)?.Value;
            if (AccountingFirmMasterOnlyRoutes.IsMatch(path, tenantKind))
            {
                _logger.LogDebug(
                    "Skipping tenant DB resolution for accounting firm master-only route {Path}",
                    path);
                await _next(context);
                return;
            }

            _logger.LogError("Connection string not found for tenant {TenantId}", tenantId);
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/json; charset=utf-8";
            var errorResponse = ApiResponse<object>.Fail("Configuration du tenant introuvable");
            await context.Response.WriteAsync(JsonSerializer.Serialize(errorResponse, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
            return;
        }

        // Set tenant context
        tenantContext.SetTenant(tenantId, connectionString);
        
        _logger.LogDebug("Tenant context set for {TenantId}", tenantId);

        // Ensure migrations are applied before any tenant-scoped operation
        var migrationResult = await migrationGuard.EnsureMigrationsAppliedAsync(tenantId, context.RequestAborted);
        if (migrationResult.IsFailure)
        {
            _logger.LogWarning("Migration check failed for tenant {TenantId}: {Error}", tenantId, migrationResult.Error.Description);
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            context.Response.ContentType = "application/json; charset=utf-8";
            await context.Response.WriteAsync(JsonSerializer.Serialize(
                ApiResponse<object>.Fail(migrationResult.Error.Description, ValidationErrorCodes.TenantMigrationFailed),
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
            return;
        }

        try
        {
            await _next(context);
        }
        finally
        {
            tenantContext.Clear();
        }
    }

    private static async Task WriteForbiddenAsync(HttpContext context, string message, string? code = null)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        context.Response.ContentType = "application/json; charset=utf-8";
        var response = string.IsNullOrEmpty(code)
            ? ApiResponse<object>.Fail(message)
            : ApiResponse<object>.Fail(message, code);
        await context.Response.WriteAsync(JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
    }
}
