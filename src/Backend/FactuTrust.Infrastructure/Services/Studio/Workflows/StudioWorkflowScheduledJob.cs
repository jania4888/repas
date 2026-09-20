using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using Hangfire;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.Studio.Workflows;

/// <summary>
/// Job Hangfire d'une définition de workflow planifiée (4.7b3 / D-47-B04) : à chaque occurrence du cron,
/// <b>balayage filtré</b> de la table (<see cref="ICustomRecordRepository.QueryAsync"/>, mêmes opérateurs
/// que les vues) et démarrage d'<b>une instance par enregistrement correspondant</b>, en système
/// (<c>StartedBy = null</c> — la reprise sans impersonation est gérée par le runner, 4.2c2). Garde-fous
/// repris du déclencheur par événement (4.1i) : anti-doublon
/// <see cref="IStudioWorkflowRepository.HasOpenInstanceInChainAsync"/> + quota par enregistrement,
/// isolation par enregistrement (un échec n'arrête pas le lot). Lot borné par
/// <c>Ollama:StudioWorkflowScheduledBatchSize</c> (défaut 100, clamp 10..500 — D-47-B05) ; total au-delà ⇒
/// avertissement, la suite au prochain tick. Un enregistrement dont l'instance précédente est terminée
/// est à nouveau éligible : le filtre doit exprimer l'éligibilité (documenté utilisateur). Auto-guérison :
/// définition supprimée / inactive / non planifiée ⇒ le job se retire via
/// <see cref="IStudioWorkflowScheduleService"/>. Aucun contenu d'enregistrement n'est journalisé
/// (identifiants et volumes uniquement).
/// </summary>
public sealed class StudioWorkflowScheduledJob
{
    private readonly ITenantService _tenantService;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly OllamaSettings _options;
    private readonly ILogger<StudioWorkflowScheduledJob> _logger;

    public StudioWorkflowScheduledJob(
        ITenantService tenantService,
        IServiceScopeFactory scopeFactory,
        IOptions<OllamaSettings> options,
        ILogger<StudioWorkflowScheduledJob> logger)
    {
        _tenantService = tenantService;
        _scopeFactory = scopeFactory;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>Compteurs d'un passage (aucun contenu, seulement des volumes).</summary>
    public sealed record StudioWorkflowScheduledReport(int Scanned, int Started, int Skipped, int Failed);

    // Les deux attributs sont sur la MÉTHODE (motif StudioWorkflowResumeJob, D-14) ; le verrou Hangfire
    // étant par (type, méthode, args), deux workflows planifiés ne se bloquent pas entre eux.
    [DisableConcurrentExecution(timeoutInSeconds: 540)]
    [AutomaticRetry(Attempts = 0)]
    public async Task FireAsync(Guid tenantId, Guid definitionId, CancellationToken cancellationToken = default)
    {
        if (!_options.EnableStudioWorkflows)
        {
            _logger.LogInformation("StudioWorkflowScheduledJob skipped (EnableStudioWorkflows = false).");
            return;
        }

        var connectionString = await _tenantService.GetConnectionStringAsync(tenantId, cancellationToken);
        if (string.IsNullOrEmpty(connectionString))
        {
            _logger.LogWarning("StudioWorkflowScheduledJob : tenant {TenantId} sans chaîne de connexion — tick ignoré.", tenantId);
            return;
        }

        using var scope = _scopeFactory.CreateScope();
        scope.ServiceProvider.GetRequiredService<ITenantContext>().SetTenant(tenantId, connectionString);
        var report = await FireInScopeAsync(scope.ServiceProvider, tenantId, definitionId, cancellationToken);
        _logger.LogInformation(
            "Studio workflow planifié {WorkflowId} (tenant {TenantId}) : {Scanned} enregistrement(s) balayé(s), {Started} instance(s) démarrée(s), {Skipped} ignorée(s), {Failed} échec(s).",
            definitionId, tenantId, report.Scanned, report.Started, report.Skipped, report.Failed);
    }

    /// <summary>Corps du tick, dans le scope tenant (séparé de l'enveloppe Hangfire pour les tests).</summary>
    internal async Task<StudioWorkflowScheduledReport> FireInScopeAsync(
        IServiceProvider services, Guid tenantId, Guid definitionId, CancellationToken cancellationToken)
    {
        var workflows = services.GetRequiredService<IStudioWorkflowRepository>();
        var fields = services.GetRequiredService<ICustomFieldRepository>();
        var records = services.GetRequiredService<ICustomRecordRepository>();
        var engine = services.GetRequiredService<IStudioWorkflowEngine>();
        var quota = services.GetRequiredService<IStudioQuotaService>();
        var schedule = services.GetRequiredService<IStudioWorkflowScheduleService>();

        var definition = await workflows.GetDefinitionAsync(tenantId, definitionId, cancellationToken);
        if (definition is null || !definition.IsActive || definition.Trigger != StudioWorkflowTriggerKind.Scheduled)
        {
            // Auto-guérison : la définition a été supprimée / désactivée / retypée depuis l'enregistrement.
            await schedule.RemoveDefinitionAsync(tenantId, definitionId, cancellationToken);
            _logger.LogInformation("Studio workflow planifié {WorkflowId} : définition absente ou non planifiée — job retiré.", definitionId);
            return new StudioWorkflowScheduledReport(0, 0, 0, 0);
        }

        if (!TryReadFilters(definition.TriggerConfigJson, out var filters))
        {
            // Défense en profondeur : la validation 4.7b1 rejette ce cas à l'écriture — on conserve le job
            // (une prochaine écriture corrigera la configuration) et on ne balaie rien.
            _logger.LogWarning("Studio workflow planifié {WorkflowId} : filtres illisibles dans TriggerConfigJson — tick ignoré.", definitionId);
            return new StudioWorkflowScheduledReport(0, 0, 0, 0);
        }

        var activeFields = await fields.ListByEntityAsync(tenantId, definition.EntityDefinitionId, false, cancellationToken);
        var fieldTypes = activeFields.ToDictionary(f => f.Key, f => f.FieldType, StringComparer.Ordinal);
        var take = Math.Clamp(_options.StudioWorkflowScheduledBatchSize, 10, 500);
        // Les clés indexées partent vides : résolues par le dépôt au plus près du SQL (motif des vues).
        var spec = new RecordQuerySpec(
            tenantId, definition.EntityDefinitionId, filters, Array.Empty<RecordViewSort>(),
            null, Array.Empty<string>(), 0, take, new HashSet<string>(StringComparer.Ordinal));
        var (matching, total) = await records.QueryAsync(spec, fieldTypes, cancellationToken);
        if (total > take)
        {
            _logger.LogWarning(
                "Studio workflow planifié {WorkflowId} : lot de {Take} atteint sur {Total} enregistrement(s) correspondant(s) — la suite au prochain tick.",
                definitionId, take, total);
        }

        var started = 0;
        var skipped = 0;
        var failed = 0;
        foreach (var record in matching)
        {
            try
            {
                if (await workflows.HasOpenInstanceInChainAsync(tenantId, definition.Id, record.Id, null, cancellationToken))
                {
                    skipped++;
                    continue;
                }

                var openCount = await workflows.CountInstancesForRecordAsync(tenantId, record.Id, openOnly: true, cancellationToken);
                var limit = await quota.EnsureUnderLimitAsync(
                    tenantId, StudioQuotas.MaxWorkflowInstancesPerRecordKey, openCount,
                    StudioQuotas.MaxWorkflowInstancesPerRecordFallback,
                    "instances de workflow actives par enregistrement", cancellationToken);
                if (limit.IsFailure)
                {
                    skipped++;
                    continue;
                }

                // Démarrage système : StartedBy null (la reprise sans impersonation est gérée, 4.2c2).
                await engine.StartAsync(
                    definition, record.Id, StudioWorkflowTriggerKind.Scheduled,
                    startedBy: null, startedByEmail: null, previousDataJson: null,
                    depth: 0, originInstanceId: null, cancellationToken);
                started++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Isolation par enregistrement : ids uniquement, jamais de données.
                failed++;
                _logger.LogWarning(ex, "Studio workflow planifié : démarrage impossible {DefinitionId} {RecordId}", definition.Id, record.Id);
            }
        }

        return new StudioWorkflowScheduledReport(matching.Count, started, skipped, failed);
    }

    /// <summary>
    /// Relit <c>triggerConfig.filters</c> (schéma b1) en <see cref="RecordViewFilter"/> :
    /// <c>value2</c> (between) est replié en tableau <c>[value, value2]</c>, motif du constructeur de
    /// filtres frontend. <c>false</c> = JSON ou forme illisible (ne devrait pas arriver après b1).
    /// </summary>
    internal static bool TryReadFilters(string? triggerConfigJson, out IReadOnlyList<RecordViewFilter> filters)
    {
        filters = Array.Empty<RecordViewFilter>();
        if (!StudioWorkflowJson.TryParseObject(triggerConfigJson, out var config))
            return false;
        if (config["filters"] is null)
            return true; // filtres absents : balayage de toute la table

        if (config["filters"] is not JsonArray array)
            return false;

        var list = new List<RecordViewFilter>(array.Count);
        foreach (var item in array)
        {
            if (item is not JsonObject filter
                || filter["field"] is not JsonValue fieldValue || !fieldValue.TryGetValue<string>(out var field) || string.IsNullOrWhiteSpace(field)
                || filter["op"] is not JsonValue opValue || !opValue.TryGetValue<string>(out var op) || string.IsNullOrWhiteSpace(op))
                return false;

            var value = filter["value2"] is { } value2
                ? (JsonNode?)new JsonArray(filter["value"]?.DeepClone(), value2.DeepClone())
                : filter["value"]?.DeepClone();
            list.Add(new RecordViewFilter(field, op, value));
        }

        filters = list;
        return true;
    }
}
