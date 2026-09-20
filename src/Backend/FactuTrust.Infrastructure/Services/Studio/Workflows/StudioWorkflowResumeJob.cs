using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using Hangfire;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.Studio.Workflows;

/// <summary>
/// Job Hangfire des workflows Studio (plan 4.2d), toutes les 10 minutes, pour chaque tenant actif :
/// (1) reaper des baux périmés, (2) expiration des approbations échues (l'instance devient due sans
/// changer d'étape, D-05), (3) reprise des instances dues via <see cref="IStudioWorkflowRunner"/> (bail +
/// impersonation), (4) purge des instances terminales anciennes.
/// <see cref="DisableConcurrentExecutionAttribute"/> (première utilisation du dépôt, D-14) garantit une
/// seule exécution à la fois ; <see cref="AutomaticRetryAttribute"/> à 0 évite les doubles reprises
/// (le prochain tick reprend). Aucun contenu d'instance (<c>ContextJson</c>) n'est logué.
/// </summary>
public sealed class StudioWorkflowResumeJob
{
    /// <summary>Cron du descripteur Hangfire (toutes les 10 minutes) — partagé avec le registre, vérifié par les tests API.</summary>
    public const string StudioWorkflowResumeCron = "*/10 * * * *";

    private readonly MasterDbContext _master;
    private readonly ITenantService _tenantService;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly OllamaSettings _options;
    private readonly ILogger<StudioWorkflowResumeJob> _logger;
    private readonly TimeProvider _time;

    public StudioWorkflowResumeJob(
        MasterDbContext master,
        ITenantService tenantService,
        IServiceScopeFactory scopeFactory,
        IOptions<OllamaSettings> options,
        ILogger<StudioWorkflowResumeJob> logger,
        TimeProvider? time = null)
    {
        _master = master;
        _tenantService = tenantService;
        _scopeFactory = scopeFactory;
        _options = options.Value;
        _logger = logger;
        _time = time ?? TimeProvider.System;
    }

    /// <summary>Compteurs d'un passage sur un tenant (aucun contenu, seulement des volumes).</summary>
    public sealed record StudioWorkflowResumeReport(
        int LeasesReleased, int ApprovalsExpired, int Resumed, int LeaseBusy, int StarterUnavailable, int Purged);

    // Les deux attributs sont sur la MÉTHODE (DisableConcurrentExecution vise AttributeTargets.Method) :
    // écart à la fiche qui les plaçait sur la classe ; le registre et les tests lisent la méthode.
    [DisableConcurrentExecution(timeoutInSeconds: 540)]
    [AutomaticRetry(Attempts = 0)]
    public async Task ExecuteAsync(CancellationToken ct = default)
    {
        if (!_options.EnableStudioWorkflows)
        {
            _logger.LogInformation("StudioWorkflowResumeJob skipped (EnableStudioWorkflows = false).");
            return;
        }

        var tenantIds = await _master.Tenants
            .AsNoTracking()
            .Where(t => t.IsActive)
            .Select(t => t.Id)
            .ToListAsync(ct);

        foreach (var tenantId in tenantIds)
        {
            try
            {
                var connectionString = await _tenantService.GetConnectionStringAsync(tenantId, ct);
                if (string.IsNullOrEmpty(connectionString))
                    continue;

                using var scope = _scopeFactory.CreateScope();
                scope.ServiceProvider.GetRequiredService<ITenantContext>().SetTenant(tenantId, connectionString);
                var report = await ProcessTenantAsync(scope.ServiceProvider, tenantId, ct);
                _logger.LogInformation(
                    "Workflows Studio tenant {TenantId} : {LeasesReleased} bail(aux) relâché(s), {ApprovalsExpired} approbation(s) expirée(s), {Resumed} reprise(s), {LeaseBusy} bail(s) occupé(s), {StarterUnavailable} lanceur(s) indisponible(s), {Purged} instance(s) purgée(s).",
                    tenantId, report.LeasesReleased, report.ApprovalsExpired, report.Resumed,
                    report.LeaseBusy, report.StarterUnavailable, report.Purged);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "StudioWorkflowResumeJob failed for tenant {TenantId}", tenantId);
            }
        }
    }

    /// <summary>Traite un tenant (contexte déjà posé) : reaper → expirations → reprises → purge.</summary>
    internal async Task<StudioWorkflowResumeReport> ProcessTenantAsync(
        IServiceProvider sp, Guid tenantId, CancellationToken ct)
    {
        var repo = sp.GetRequiredService<IStudioWorkflowRepository>();
        var runner = sp.GetRequiredService<IStudioWorkflowRunner>();
        var notifications = sp.GetRequiredService<INotificationService>();

        var now = _time.GetUtcNow().UtcDateTime;
        var batch = Math.Clamp(_options.StudioWorkflowResumeBatchSize, 10, 500);
        var lease = _options.StudioWorkflowLeaseDuration;

        // 1. Reaper : relâcher les baux périmés (worker mort avant le finally du runner).
        var leasesReleased = 0;
        foreach (var stale in await repo.ListStaleLeasesAsync(tenantId, now - lease, batch, ct))
        {
            try
            {
                stale.ReleaseLease();
                await repo.UpdateInstanceAsync(stale, ct);
                leasesReleased++;
            }
            catch (DbUpdateConcurrencyException)
            {
                // Une reprise concurrente a gagné entre la lecture et l'écriture : rien à faire.
            }
        }

        // 2. Expirations : statut « expired » mémorisé dans le contexte, instance rendue due (D-05).
        // Une course (décision utilisateur, autre exécution) isole l'approbation, pas le tenant (revue 4.2d).
        var approvalsExpired = 0;
        foreach (var approval in await repo.ListExpiredApprovalsAsync(tenantId, now, batch, ct))
        {
            try
            {
                approval.Expire(now);
                await repo.UpdateApprovalAsync(approval, ct);

                var instance = await repo.GetInstanceAsync(tenantId, approval.InstanceId, ct);
                if (instance is not null && !instance.IsTerminal)
                {
                    if (!StudioWorkflowDecisionSync.Apply(
                            instance, approval.StepKey, StudioWorkflowEnumNames.ApprovalStatusName(approval.Status), null, null, now))
                        _logger.LogWarning(
                            "Contexte trop volumineux : statut « expired » perdu {ApprovalId}", approval.Id);
                    await repo.UpdateInstanceAsync(instance, ct);

                    if (instance.StartedBy is { } recipient)
                    {
                        await SafeNotifyExpiryAsync(notifications, tenantId, approval, recipient, instance.Id, ct);
                    }
                }

                approvalsExpired++;
            }
            catch (DbUpdateConcurrencyException)
            {
                // Décision concurrente gagnée entre lecture et écriture : rien à faire.
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Expiration de l'approbation {ApprovalId} tenant {TenantId} en échec",
                    approval.Id, tenantId);
            }
        }

        // 3. Reprises : le runner pose le bail et impersonne le lanceur ; une panne isole l'instance.
        var resumed = 0;
        var leaseBusy = 0;
        var starterUnavailable = 0;
        foreach (var due in await repo.ListDueAsync(tenantId, now, batch, ct))
        {
            try
            {
                switch (await runner.ResumeUnderStarterAsync(due, ct))
                {
                    case StudioWorkflowRunOutcome.Resumed:
                        resumed++;
                        break;
                    case StudioWorkflowRunOutcome.LeaseBusy:
                        leaseBusy++;
                        break;
                    case StudioWorkflowRunOutcome.StarterUnavailable:
                        starterUnavailable++;
                        break;
                    case StudioWorkflowRunOutcome.Skipped:
                        break; // terminale : déjà exclue par ListDueAsync, présent par exhaustivité
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Reprise {InstanceId} tenant {TenantId} en échec", due.Id, tenantId);
            }
        }

        // 4. Purge des instances terminales anciennes (rétention configurée, bornée 30..3650 jours).
        var purged = await repo.PurgeTerminalOlderThanAsync(
            tenantId,
            now - TimeSpan.FromDays(Math.Clamp(_options.StudioWorkflowRetentionDays, 30, 3650)),
            batch,
            ct);

        return new StudioWorkflowResumeReport(
            leasesReleased, approvalsExpired, resumed, leaseBusy, starterUnavailable, purged);
    }

    /// <summary>Notification 16 d'expiration au lanceur — best-effort, ne fait jamais échouer le job.</summary>
    private async Task SafeNotifyExpiryAsync(
        INotificationService notifications, Guid tenantId, StudioWorkflowApproval approval,
        Guid recipient, Guid instanceId, CancellationToken ct)
    {
        try
        {
            await notifications.CreateAsync(
                tenantId,
                null,
                NotificationType.StudioWorkflowApprovalDecided,
                $"Approbation « {approval.Title} » expirée",
                "L'approbation a dépassé son échéance ; le workflow reprend.",
                "/studio/approvals",
                recipient,
                ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Workflow expiry notification failed {InstanceId}", instanceId);
        }
    }
}
