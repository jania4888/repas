using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services;

/// <inheritdoc />
public sealed class TenantProvisioningRetryService : ITenantProvisioningRetryService
{
    private const string GenericFailureMessage =
        "La reprise du provisionnement a échoué. Consultez les journaux avec la référence fournie.";

    private readonly MasterDbContext _masterContext;
    private readonly ITenantService _tenantService;
    private readonly ILogger<TenantProvisioningRetryService> _logger;

    public TenantProvisioningRetryService(
        MasterDbContext masterContext,
        ITenantService tenantService,
        ILogger<TenantProvisioningRetryService> logger)
    {
        _masterContext = masterContext;
        _tenantService = tenantService;
        _logger = logger;
    }

    public async Task<TenantProvisioningRetryResult> RetryAsync(
        Guid tenantId,
        Guid actorUserId,
        CancellationToken cancellationToken = default)
    {
        var correlationId = Guid.NewGuid().ToString("N");

        var tenant = await _masterContext.Tenants.FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken);
        if (tenant is null)
        {
            return TenantProvisioningRetryResult.Failure(
                TenantProvisioningRetryFailureKind.NotFound,
                "Entreprise introuvable.");
        }

        // Garde dure : un tenant Ready a une base vivante, potentiellement pleine de données.
        // La reprise commence par supprimer la base — la rejouer ici détruirait de la production.
        if (tenant.ProvisioningStatus == TenantProvisioningStatus.Ready)
        {
            return TenantProvisioningRetryResult.Failure(
                TenantProvisioningRetryFailureKind.AlreadyReady,
                "Cette entreprise est déjà provisionnée : la reprise est réservée aux dossiers en attente ou en échec.");
        }

        _logger.LogInformation(
            "Tenant provisioning retry started: actor={ActorId} tenant={TenantId} status={Status} CorrelationId={CorrelationId}",
            actorUserId,
            tenant.Id,
            tenant.ProvisioningStatus,
            correlationId);

        // GARDE ANTI-DESTRUCTION — même critère que OrphanTenantDatabaseCleanupJob.
        //
        // Le statut seul ne dit pas si la base existe : la phase 2 écrit la chaîne de connexion
        // puis bascule le statut. Si le processus meurt entre les deux, le dossier reste `Pending`
        // alors que sa base est complète et déjà peuplée. Rejouer la suppression détruirait des
        // données réelles. La présence d'une TenantConnectionString fait donc foi : on rectifie le
        // statut sans jamais toucher à la base.
        var hasProvisionedDatabase = await _masterContext.TenantConnectionStrings
            .AsNoTracking()
            .AnyAsync(c => c.TenantId == tenant.Id, cancellationToken);

        if (hasProvisionedDatabase)
        {
            tenant.MarkProvisioningReady();
            await _masterContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Tenant provisioning repaired without touching the database: actor={ActorId} tenant={TenantId} CorrelationId={CorrelationId}",
                actorUserId,
                tenant.Id,
                correlationId);

            return TenantProvisioningRetryResult.Ok(tenant.Id, tenant.CompanyName, correlationId, repaired: true);
        }

        try
        {
            // Aucune chaîne de connexion : la phase 2 n'est jamais allée à son terme. Il ne peut
            // donc rester qu'une base absente ou à demi créée, sans données métier. La supprimer
            // avant de recréer rend l'opération idempotente.
            //
            // Réserve assumée : le nom d'entrepôt choisi à l'inscription n'est stocké nulle part
            // (ni sur Tenant, ni ailleurs en base maître). La recréation retombe donc sur le nom
            // par défaut de TenantService. Sans conséquence ici — rien n'avait été semé.
            await _tenantService.TryDropDatabaseAsync(tenant.DatabaseName, cancellationToken);

            if (tenant.Kind == TenantKind.AccountingFirm)
            {
                await _tenantService.CreateAccountingFirmDatabaseAsync(tenant.Id, tenant.DatabaseName, cancellationToken);
            }
            else
            {
                await _tenantService.CreateTenantDatabaseAsync(tenant.Id, tenant.DatabaseName, null, cancellationToken);
            }

            tenant.MarkProvisioningReady();
            await _masterContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Tenant provisioning retry succeeded: actor={ActorId} tenant={TenantId} CorrelationId={CorrelationId}",
                actorUserId,
                tenant.Id,
                correlationId);

            return TenantProvisioningRetryResult.Ok(tenant.Id, tenant.CompanyName, correlationId);
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Tenant provisioning retry failed: actor={ActorId} tenant={TenantId} CorrelationId={CorrelationId}",
                actorUserId,
                tenant.Id,
                correlationId);

            try
            {
                tenant.MarkProvisioningFailed();
                await _masterContext.SaveChangesAsync(cancellationToken);
            }
            catch (Exception markFailedEx)
            {
                _logger.LogError(
                    markFailedEx,
                    "Could not mark tenant {TenantId} as provisioning-failed after a retry. CorrelationId={CorrelationId}",
                    tenant.Id,
                    correlationId);
            }

            return TenantProvisioningRetryResult.Failure(
                TenantProvisioningRetryFailureKind.ProvisioningFailed,
                GenericFailureMessage,
                correlationId);
        }
    }
}
