using System.Security.Claims;

using FactuTrust.API.Authorization;
using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Scripts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.API.Controllers;

/// <summary>Platform-only endpoints for tenant database migrations.</summary>
[ApiController]
[Route("api/platform/migrations")]
[Authorize(Policy = PlatformPolicies.PlatformAdmin)]
public sealed class PlatformMigrationsController : ControllerBase
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<PlatformMigrationsController> _logger;

    public PlatformMigrationsController(IServiceProvider serviceProvider, ILogger<PlatformMigrationsController> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    [HttpPost("tenants/apply-migrations")]
    [ProducesResponseType(typeof(ApiResponse<MigrationResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> ApplyMigrationsToAllTenants(CancellationToken cancellationToken)
    {
        try
        {
            _logger.LogInformation("Platform admin requested migration of all tenant databases");

            var successCount = await TenantMigrationHelper.ApplyMigrationsToAllTenantsAsync(
                _serviceProvider,
                cancellationToken);

            await using var scope = _serviceProvider.CreateAsyncScope();
            var masterContext = scope.ServiceProvider.GetRequiredService<MasterDbContext>();
            var totalTenants = await masterContext.Tenants.CountAsync(t => t.IsActive, cancellationToken);

            var result = new MigrationResultDto
            {
                TotalTenants = totalTenants,
                SuccessCount = successCount,
                FailureCount = totalTenants - successCount
            };

            _logger.LogInformation(
                "Migration completed. Total: {Total}, Success: {Success}, Failures: {Failures}",
                result.TotalTenants, result.SuccessCount, result.FailureCount);

            return Ok(ApiResponse<MigrationResultDto>.Ok(result,
                $"Migrations appliquées avec succès pour {successCount} tenant(s) sur {totalTenants}."));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during tenant migration");
            return StatusCode(500, ApiResponse<MigrationResultDto>.Fail(
                $"Erreur lors de l'application des migrations : {ex.Message}"));
        }
    }

    [HttpPost("tenants/{tenantId:guid}/apply-migrations")]
    [ProducesResponseType(typeof(ApiResponse<object>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> ApplyMigrationsToTenant(Guid tenantId, CancellationToken cancellationToken)
    {
        try
        {
            _logger.LogInformation("Platform admin requested migration for tenant {TenantId}", tenantId);

            await using var scope = _serviceProvider.CreateAsyncScope();
            var tenantService = scope.ServiceProvider.GetRequiredService<ITenantService>();
            var masterContext = scope.ServiceProvider.GetRequiredService<MasterDbContext>();

            var tenant = await masterContext.Tenants
                .FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken);

            if (tenant == null)
            {
                return NotFound(ApiResponse<object>.Fail($"Tenant {tenantId} introuvable."));
            }

            await tenantService.ApplyMigrationsAsync(tenantId, cancellationToken);

            _logger.LogInformation("Migrations applied successfully for tenant {TenantId}", tenantId);

            return Ok(ApiResponse<object>.Ok(null!,
                $"Migrations appliquées avec succès pour le tenant {tenant.CompanyName}."));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error applying migrations for tenant {TenantId}", tenantId);
            return StatusCode(500, ApiResponse<object>.Fail(
                $"Erreur lors de l'application des migrations : {ex.Message}"));
        }
    }

    [HttpGet("tenants/{tenantId:guid}/migrations-status")]
    [ProducesResponseType(typeof(ApiResponse<MigrationStatusResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetTenantMigrationStatus(Guid tenantId, CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = _serviceProvider.CreateAsyncScope();
            var masterContext = scope.ServiceProvider.GetRequiredService<MasterDbContext>();

            var row = await (
                    from t in masterContext.Tenants.AsNoTracking()
                    where t.Id == tenantId
                    join s in masterContext.Subscriptions.AsNoTracking() on t.Id equals s.TenantId into sj
                    from sub in sj.DefaultIfEmpty()
                    select new { Tenant = t, Sub = sub })
                .FirstOrDefaultAsync(cancellationToken);

            if (row is null)
            {
                return NotFound(ApiResponse<MigrationStatusResultDto>.Fail($"Tenant {tenantId} introuvable."));
            }

            var hasMigrations = await TenantMigrationHelper.HasMigrationsAppliedAsync(
                _serviceProvider,
                tenantId,
                cancellationToken);

            var subscription = row.Sub;
            var result = new MigrationStatusResultDto
            {
                TenantId = tenantId,
                TenantName = row.Tenant.CompanyName,
                HasMigrationsApplied = hasMigrations,
                SubscriptionPlan = subscription?.Plan,
                SubscriptionPlanDisplay = subscription is null ? null : subscription.Plan.ToDisplayString(),
                SubscriptionStatus = subscription?.Status,
                SubscriptionStatusDisplay = subscription is null ? null : subscription.Status.ToDisplayString(),
                IsPayingSubscriber = PlatformSubscriptionSegmentHelper.IsPayingSubscriber(subscription?.Plan, subscription?.Status)
            };

            return Ok(ApiResponse<MigrationStatusResultDto>.Ok(result));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking migration status for tenant {TenantId}", tenantId);
            return StatusCode(500, ApiResponse<MigrationStatusResultDto>.Fail(
                $"Erreur lors de la vérification : {ex.Message}"));
        }
    }

    /// <summary>
    /// KPIs agrégés pour la page Migrations (Lot A3).
    /// Les échecs 24h sont retournés à 0 tant que le tracking persistant n'est pas en place (Lot D4).
    /// </summary>
    [HttpGet("stats")]
    [ProducesResponseType(typeof(ApiResponse<MigrationStatsDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetStats(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = _serviceProvider.CreateAsyncScope();
            var masterContext = scope.ServiceProvider.GetRequiredService<MasterDbContext>();

            var activeTenantIds = await masterContext.Tenants
                .Where(t => t.IsActive)
                .Select(t => t.Id)
                .ToListAsync(cancellationToken);

            var upToDate = 0;
            foreach (var tenantId in activeTenantIds)
            {
                try
                {
                    var hasMigrations = await TenantMigrationHelper.HasMigrationsAppliedAsync(
                        _serviceProvider, tenantId, cancellationToken);
                    if (hasMigrations) upToDate++;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Could not read migration status for tenant {TenantId}", tenantId);
                    // tenant compte comme "pending" (non up-to-date)
                }
            }

            var stats = new MigrationStatsDto
            {
                TotalTenants = activeTenantIds.Count,
                UpToDate = upToDate,
                Pending = activeTenantIds.Count - upToDate,
                Failures24h = 0 // Lot D4 : à remplir depuis MigrationRunItems
            };

            return Ok(ApiResponse<MigrationStatsDto>.Ok(stats));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error computing migration stats");
            return StatusCode(500, ApiResponse<MigrationStatsDto>.Fail(
                $"Erreur lors du calcul des statistiques : {ex.Message}"));
        }
    }

    /// <summary>
    /// Balayage d'unicité des numéros de facture de vente (Invoices.Number) sur tous
    /// les tenants actifs. Préalable OBLIGATOIRE avant de livrer la migration ajoutant
    /// l'index UNIQUE fiscal : tant que <c>IsUniqueIndexSafe</c> est faux (doublons ou
    /// tenant injoignable — fail-closed), la migration ne doit PAS être déployée, sinon
    /// elle échouerait au boot du tenant et le bloquerait via TenantMigrationGuard.
    /// </summary>
    [HttpGet("tenants/invoice-number-integrity")]
    [ProducesResponseType(typeof(ApiResponse<InvoiceNumberIntegrityReportDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> ScanInvoiceNumberIntegrity(CancellationToken cancellationToken)
    {
        try
        {
            _logger.LogInformation("Platform admin requested invoice number integrity scan for all tenants");

            var report = await InvoiceNumberIntegrityHelper.ScanAllTenantsAsync(_serviceProvider, cancellationToken);

            var message = report.IsUniqueIndexSafe
                ? $"Aucun doublon détecté sur {report.CleanTenants} tenant(s) : l'index unique peut être déployé."
                : $"Index unique NON déployable : {report.TenantsWithDuplicates} tenant(s) avec doublons, " +
                  $"{report.UnreachableTenants} injoignable(s) sur {report.TotalTenants}.";

            return Ok(ApiResponse<InvoiceNumberIntegrityReportDto>.Ok(report, message));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during invoice number integrity scan");
            return StatusCode(500, ApiResponse<InvoiceNumberIntegrityReportDto>.Fail(
                $"Erreur lors du balayage d'unicité : {ex.Message}"));
        }
    }

    [HttpGet("tenants/migrations-status")]
    [ProducesResponseType(typeof(ApiResponse<List<MigrationStatusResultDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAllTenantsMigrationStatus(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = _serviceProvider.CreateAsyncScope();
            var masterContext = scope.ServiceProvider.GetRequiredService<MasterDbContext>();

            var rows = await (
                    from t in masterContext.Tenants.AsNoTracking()
                    where t.IsActive
                    join s in masterContext.Subscriptions.AsNoTracking() on t.Id equals s.TenantId into sj
                    from sub in sj.DefaultIfEmpty()
                    select new { Tenant = t, Sub = sub })
                .ToListAsync(cancellationToken);

            var results = new List<MigrationStatusResultDto>();

            foreach (var row in rows)
            {
                var hasMigrations = await TenantMigrationHelper.HasMigrationsAppliedAsync(
                    _serviceProvider,
                    row.Tenant.Id,
                    cancellationToken);

                var sub = row.Sub;
                results.Add(new MigrationStatusResultDto
                {
                    TenantId = row.Tenant.Id,
                    TenantName = row.Tenant.CompanyName,
                    HasMigrationsApplied = hasMigrations,
                    SubscriptionPlan = sub?.Plan,
                    SubscriptionPlanDisplay = sub is null ? null : sub.Plan.ToDisplayString(),
                    SubscriptionStatus = sub?.Status,
                    SubscriptionStatusDisplay = sub is null ? null : sub.Status.ToDisplayString(),
                    IsPayingSubscriber = PlatformSubscriptionSegmentHelper.IsPayingSubscriber(sub?.Plan, sub?.Status)
                });
            }

            return Ok(ApiResponse<List<MigrationStatusResultDto>>.Ok(results));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking migration status for all tenants");
            return StatusCode(500, ApiResponse<List<MigrationStatusResultDto>>.Fail(
                $"Erreur lors de la vérification : {ex.Message}"));
        }
    }

    /// <summary>
    /// Diagnostic du plan comptable de chaque dossier actif : conforme NCT 01, resté sur le plan
    /// hybride hérité, ou bascule différée faute de sauvegarde. <b>Lecture seule.</b>
    /// </summary>
    [HttpGet("tenants/chart-of-accounts-status")]
    [ProducesResponseType(typeof(ApiResponse<List<TenantChartOfAccountsStatusDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetChartOfAccountsStatus(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = _serviceProvider.CreateAsyncScope();
            var masterContext = scope.ServiceProvider.GetRequiredService<MasterDbContext>();
            var tenantService = scope.ServiceProvider.GetRequiredService<ITenantService>();
            var seeder = scope.ServiceProvider.GetRequiredService<ITenantRuntimeCatalogSeeder>();

            var tenants = await masterContext.Tenants.AsNoTracking()
                .Where(t => t.IsActive)
                .OrderBy(t => t.CompanyName)
                .Select(t => new { t.Id, t.CompanyName, t.Kind })
                .ToListAsync(cancellationToken);

            var results = new List<TenantChartOfAccountsStatusDto>(tenants.Count);

            foreach (var tenant in tenants)
            {
                var connectionString = await tenantService.GetConnectionStringAsync(tenant.Id, cancellationToken);
                if (string.IsNullOrEmpty(connectionString))
                {
                    results.Add(new TenantChartOfAccountsStatusDto
                    {
                        TenantId = tenant.Id,
                        TenantName = tenant.CompanyName,
                        TenantKind = tenant.Kind.ToString(),
                        Verdict = "no-database"
                    });
                    continue;
                }

                try
                {
                    var report = await seeder.InspectAsync(connectionString, cancellationToken);
                    results.Add(MapChartStatus(tenant.Id, tenant.CompanyName, tenant.Kind.ToString(), report));
                }
                catch (Exception ex)
                {
                    // Un dossier injoignable ne doit pas priver l'exploitation du diagnostic des autres.
                    _logger.LogWarning(ex, "Chart-of-accounts diagnostic failed for tenant {TenantId}", tenant.Id);
                    results.Add(new TenantChartOfAccountsStatusDto
                    {
                        TenantId = tenant.Id,
                        TenantName = tenant.CompanyName,
                        TenantKind = tenant.Kind.ToString(),
                        Verdict = "unreachable",
                        Error = ex.Message
                    });
                }
            }

            return Ok(ApiResponse<List<TenantChartOfAccountsStatusDto>>.Ok(results));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error building chart-of-accounts diagnostic");
            return StatusCode(500, ApiResponse<List<TenantChartOfAccountsStatusDto>>.Fail(
                $"Erreur lors du diagnostic du plan comptable : {ex.Message}"));
        }
    }

    /// <summary>
    /// Bascule le plan comptable d'un dossier vers la NCT 01 (remap des numéros + catalogue).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Irréversible hors restauration de sauvegarde</b> : le remap réécrit les numéros de compte
    /// dans les écritures, y compris sur des périodes clôturées, et ses cycles (<c>421↔425</c>,
    /// <c>231↔232</c>) interdisent tout second passage. D'où le <c>dryRun</c> par défaut, et une
    /// action délibérée, tracée dans l'audit plateforme, plutôt qu'un effet de bord du premier appel
    /// du dossier. Procédure complète : <c>docs/runbooks/coa-nct01-migration.md</c>.
    /// </para>
    /// </remarks>
    [HttpPost("tenants/{tenantId:guid}/chart-of-accounts/apply")]
    [ProducesResponseType(typeof(ApiResponse<ChartOfAccountsApplyResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> ApplyChartOfAccountsNct01(
        Guid tenantId,
        [FromQuery] bool dryRun = true,
        CancellationToken cancellationToken = default)
    {
        await using var scope = _serviceProvider.CreateAsyncScope();
        var masterContext = scope.ServiceProvider.GetRequiredService<MasterDbContext>();
        var tenantService = scope.ServiceProvider.GetRequiredService<ITenantService>();
        var seeder = scope.ServiceProvider.GetRequiredService<ITenantRuntimeCatalogSeeder>();
        var auditWriter = scope.ServiceProvider.GetRequiredService<IPlatformActionAuditWriter>();
        var migrationGuard = scope.ServiceProvider.GetRequiredService<ITenantMigrationGuard>();

        var tenant = await masterContext.Tenants.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken);

        if (tenant is null)
            return NotFound(ApiResponse<ChartOfAccountsApplyResultDto>.Fail($"Tenant {tenantId} introuvable."));

        var connectionString = await tenantService.GetConnectionStringAsync(tenantId, cancellationToken);
        if (string.IsNullOrEmpty(connectionString))
        {
            return NotFound(ApiResponse<ChartOfAccountsApplyResultDto>.Fail(
                "Base de données introuvable pour ce dossier."));
        }

        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var actorId);
        var correlationId = Guid.NewGuid().ToString("N");

        try
        {
            var before = await seeder.InspectAsync(connectionString, cancellationToken);

            if (dryRun)
            {
                await WriteChartAuditAsync(
                    auditWriter, actorId, PlatformAuditOutcomes.Success, tenantId, correlationId,
                    new Dictionary<string, object?>
                    {
                        ["dryRun"] = true,
                        ["verdict"] = before.Verdict,
                        ["accounts"] = before.AccountCount,
                        ["journalLines"] = before.AccountingLineCount
                    },
                    cancellationToken);

                return Ok(ApiResponse<ChartOfAccountsApplyResultDto>.Ok(new ChartOfAccountsApplyResultDto
                {
                    TenantId = tenantId,
                    TenantName = tenant.CompanyName,
                    DryRun = true,
                    Outcome = before.ChartOutcome.ToString(),
                    Verdict = before.Verdict,
                    AccountCountBefore = before.AccountCount,
                    AccountCountAfter = before.AccountCount,
                    AccountingLineCount = before.AccountingLineCount,
                    Preview = before.Preview,
                    Message = BuildChartDryRunMessage(before)
                }));
            }

            _logger.LogInformation(
                "Platform admin {ActorId} applies the NCT 01 chart migration on tenant {TenantId} "
                + "(verdict before: {Verdict}, {Lines} journal line(s)). CorrelationId={CorrelationId}",
                actorId, tenantId, before.Verdict, before.AccountingLineCount, correlationId);

            var after = await seeder.EnsureAsync(connectionString, authorizeChartRemap: true, cancellationToken);

            // Le garde a pu mettre ce dossier en cache « à jour » : sans invalidation, la
            // resynchronisation suivante attendrait l'expiration du cache.
            migrationGuard.Invalidate(tenantId);

            await WriteChartAuditAsync(
                auditWriter, actorId, PlatformAuditOutcomes.Success, tenantId, correlationId,
                new Dictionary<string, object?>
                {
                    ["dryRun"] = false,
                    ["verdictBefore"] = before.Verdict,
                    ["verdictAfter"] = after.Verdict,
                    ["outcome"] = after.ChartOutcome.ToString(),
                    ["accountsBefore"] = before.AccountCount,
                    ["accountsAfter"] = after.AccountCount,
                    ["journalLines"] = before.AccountingLineCount,
                    ["catalogHash"] = after.CurrentCatalogHash
                },
                cancellationToken);

            return Ok(ApiResponse<ChartOfAccountsApplyResultDto>.Ok(new ChartOfAccountsApplyResultDto
            {
                TenantId = tenantId,
                TenantName = tenant.CompanyName,
                DryRun = false,
                Outcome = after.ChartOutcome.ToString(),
                Verdict = after.Verdict,
                AccountCountBefore = before.AccountCount,
                AccountCountAfter = after.AccountCount,
                AccountingLineCount = after.AccountingLineCount,
                Message = $"Plan comptable : {before.AccountCount} → {after.AccountCount} comptes "
                    + $"(verdict {after.Verdict}). Contrôles post-bascule : docs/runbooks/coa-nct01-migration.md."
            }));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "NCT 01 chart migration failed for tenant {TenantId}", tenantId);

            await WriteChartAuditAsync(
                auditWriter, actorId, PlatformAuditOutcomes.Failed, tenantId, correlationId,
                new Dictionary<string, object?> { ["dryRun"] = dryRun, ["error"] = ex.Message },
                cancellationToken);

            return StatusCode(500, ApiResponse<ChartOfAccountsApplyResultDto>.Fail(
                $"Erreur lors de la bascule du plan comptable : {ex.Message}"));
        }
    }

    private static TenantChartOfAccountsStatusDto MapChartStatus(
        Guid tenantId, string tenantName, string tenantKind, TenantRuntimeCatalogReport report) =>
        new()
        {
            TenantId = tenantId,
            TenantName = tenantName,
            TenantKind = tenantKind,
            Verdict = report.Verdict,
            AccountCount = report.AccountCount,
            AccountingLineCount = report.AccountingLineCount,
            AppliedMapVersion = report.AppliedMapVersion,
            AppliedCatalogHash = report.AppliedCatalogHash,
            CurrentCatalogHash = report.CurrentCatalogHash,
            Preview = report.Preview
        };

    private static string BuildChartDryRunMessage(TenantRuntimeCatalogReport report) => report.Verdict switch
    {
        "nct01" => "Dossier déjà conforme NCT 01 : la bascule ne ferait rien.",
        "catalog-drift" => "Remap déjà posé : seuls les libellés et comptes manquants du catalogue "
            + "seraient synchronisés, sans réécriture de numéro.",
        "no-chart" => "Base sans plan comptable (migrations non appliquées) : appliquer les migrations d'abord.",
        _ when report.Preview is null => "Aucun différentiel calculable.",
        _ => $"Bascule NCT 01 : {report.Preview.AccountsToCreate} compte(s) à créer, "
            + $"{report.Preview.AccountsToRenumber} à renuméroter (dont {report.Preview.AccountsToMerge} fusion(s)), "
            + $"{report.Preview.AccountsToRelabel} libellé(s) alignés, "
            + $"{report.Preview.AccountsToDeactivate} désactivation(s), "
            + $"{report.Preview.JournalLinesToRewrite} ligne(s) d'écriture réécrite(s). "
            + "Sauvegarder la base avant d'appliquer."
    };

    /// <summary>
    /// Consigne la bascule, en simulation comme en réel, en succès comme en échec. Jamais bloquant :
    /// une trace perdue ne doit pas transformer une bascule réussie en erreur HTTP.
    /// </summary>
    private Task WriteChartAuditAsync(
        IPlatformActionAuditWriter auditWriter,
        Guid actorId,
        string outcome,
        Guid targetTenantId,
        string correlationId,
        IReadOnlyDictionary<string, object?> details,
        CancellationToken cancellationToken) =>
        auditWriter.WriteAsync(
            new PlatformActionAuditRecord(
                actorId,
                User.FindFirstValue(ClaimTypes.Email),
                PlatformAuditActions.ChartOfAccountsNct01Apply,
                outcome,
                targetTenantId,
                correlationId,
                details),
            cancellationToken);
}
