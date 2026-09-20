using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Workflows;

/// <summary>
/// Pipeline d'enrichissement des éléments d'approbation (extrait de <c>ListMyApprovalsQueryHandler</c>
/// en 4.7 « v1.1 », D‑47‑60) : instance, définition (« — » si supprimée), entité, libellé
/// d'enregistrement (premier champ texte) et nom du lanceur résolu en un lot. Caches par identifiant
/// (revue 4.2e : N+1). Paramètre <paramref name="skipTerminalInstances"/> : boîte de réception
/// (<see langword="true"/> — l'élément n'est plus actionnable) vs historique de mes décisions
/// (<see langword="false"/> — une instance terminée reste une décision passée) ; une instance
/// **purgée** (nulle) est toujours sautée : elle est la seule source du <c>RecordId</c> (la purge
/// supprime aussi l'approbation — le cas ne couvre que la course purge-entre-deux-lectures).
/// </summary>
internal static class StudioApprovalInboxEnrichment
{
    internal static async Task<List<WorkflowApprovalInboxItemDto>> EnrichAsync(
        IStudioWorkflowRepository workflows,
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        ICustomRecordRepository records,
        IStudioUserNameResolver userNames,
        Guid tenantId,
        IReadOnlyList<StudioWorkflowApproval> approvals,
        bool skipTerminalInstances,
        CancellationToken cancellationToken)
    {
        var definitions = new Dictionary<Guid, StudioWorkflowDefinition?>();
        var entitiesById = new Dictionary<Guid, CustomEntityDefinition?>();
        var labelKeys = new Dictionary<Guid, string?>();
        var items = new List<WorkflowApprovalInboxItemDto>(approvals.Count);
        foreach (var approval in approvals)
        {
            var instance = await workflows.GetInstanceAsync(tenantId, approval.InstanceId, cancellationToken);
            if (instance is null || (skipTerminalInstances && instance.IsTerminal))
                continue; // instance purgée (course) ; en mode inbox, instance refermée ⇒ plus actionnable

            // Définition possiblement supprimée : clé et nom « — » plutôt qu'un 500.
            if (!definitions.TryGetValue(instance.WorkflowDefinitionId, out var definition))
            {
                definition = await workflows.GetDefinitionAsync(tenantId, instance.WorkflowDefinitionId, cancellationToken);
                definitions[instance.WorkflowDefinitionId] = definition;
            }
            if (!entitiesById.TryGetValue(instance.EntityDefinitionId, out var entity))
            {
                entity = await entities.GetByIdAsync(tenantId, instance.EntityDefinitionId, cancellationToken);
                entitiesById[instance.EntityDefinitionId] = entity;
            }

            string? recordLabel = null;
            if (entity is not null)
            {
                var record = await records.GetAsync(tenantId, entity.Id, instance.RecordId, cancellationToken);
                if (record is not null)
                {
                    // Libellé = premier champ texte (motif des options de relation, CustomFieldFeatures).
                    if (!labelKeys.TryGetValue(entity.Id, out var labelKey))
                    {
                        var entityFields = await fields.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, cancellationToken);
                        labelKey = entityFields
                            .FirstOrDefault(f => f.FieldType is CustomFieldType.Text or CustomFieldType.MultilineText)?.Key;
                        labelKeys[entity.Id] = labelKey;
                    }
                    recordLabel = ExtractDisplay(record.DataJson, labelKey);
                }
            }

            items.Add(new WorkflowApprovalInboxItemDto(
                StudioWorkflowMapping.ToDto(approval),
                instance.Id,
                definition?.Key ?? "—",
                definition?.Name ?? "—",
                entity?.Key ?? "—",
                entity?.DisplayName ?? "—",
                instance.RecordId,
                recordLabel,
                instance.StartedBy,
                instance.StartedAt));
        }

        // 4.5a2 — « Demandé par » (D-44-79) : une seule requête master pour les lanceurs distincts ; absent ⇒ null (D-45-02).
        var starterIds = items.Where(i => i.StartedBy is not null).Select(i => i.StartedBy!.Value).Distinct().ToList();
        if (starterIds.Count > 0)
        {
            var names = await userNames.GetDisplayNamesAsync(tenantId, starterIds, cancellationToken);
            for (var k = 0; k < items.Count; k++)
            {
                if (items[k].StartedBy is { } starter && names.TryGetValue(starter, out var starterName))
                    items[k] = items[k] with { StartedByName = starterName };
            }
        }

        return items;
    }

    private static string? ExtractDisplay(string dataJson, string? key)
    {
        if (string.IsNullOrEmpty(key))
            return null;
        try
        {
            var node = System.Text.Json.Nodes.JsonNode.Parse(dataJson);
            var value = node?[key];
            return value is null ? null : value.ToString();
        }
        catch (Exception)
        {
            // JsonException (JSON illisible) ou InvalidOperationException (nœud non-objet) : pas de libellé.
            return null;
        }
    }
}
