using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio.Workflows;
using MediatR;

namespace FactuTrust.Infrastructure.Services.Studio;

/// <summary>
/// PR 4.3f — création TOUT-OU-RIEN des workflows d'un plan IA confirmé. Chaque workflow passe par
/// <see cref="CreateWorkflowCommand"/> (normalisation, conflit de clé, quota, validation complète contre
/// le schéma réel, audit <c>Studio.Workflow.Created</c>) et est créé INACTIF (D-08, figé par
/// <see cref="StudioAiWorkflowSpec.ToSaveRequest"/>). Un échec à l'étape k supprime les k-1 workflows
/// déjà créés (<see cref="DeleteWorkflowCommand"/>, <see cref="CancellationToken.None"/>) puis remonte
/// l'erreur en français. Dépendance unique : <see cref="IMediator"/> — jamais de DbContext ni de dépôt.
/// </summary>
public sealed class StudioAiWorkflowExecutor
{
    /// <summary>Nombre maximal de variantes de clé essayées : la clé demandée puis <c>_2</c> … <c>_9</c>.</summary>
    public const int MaxKeyAttempts = 9;

    /// <summary>Longueur maximale du message d'erreur renvoyé (colonne <c>ErrorMessage</c> = 2048, marge comprise).</summary>
    public const int MaxErrorLength = 2000;

    /// <summary>Message générique d'une exception échappée après au moins une création (jamais <c>ex.Message</c> : il peut porter du SQL).</summary>
    public const string UnexpectedErrorMessage = "Erreur inattendue lors de la création des workflows.";

    /// <summary>Un workflow créé par ce plan (shape du contrat §D, repris tel quel dans le payload).</summary>
    public sealed record CreatedWorkflow(Guid Id, string Key, string EntityKey, string Name, int StepCount);

    private readonly IMediator _mediator;

    public StudioAiWorkflowExecutor(IMediator mediator) => _mediator = mediator;

    public async Task<(bool Success, string? Error, object? Payload)> ExecuteAsync(
        ParsedWorkflowPlanSpec spec, IStudioBuildProgress? progress, CancellationToken ct)
    {
        void Report(string phase, string label, string status, string? entityRef = null, string? detail = null) =>
            progress?.Report(new StudioBuildStep(phase, label, status, entityRef, detail));

        var created = new List<CreatedWorkflow>();
        var entities = new Dictionary<string, Guid>(StringComparer.Ordinal);          // entityKey → Id
        var takenKeys = new Dictionary<Guid, HashSet<string>>();                     // entityId → clés existantes

        try
        {
            foreach (var item in spec.Workflows)
            {
                var stepCount = item.Steps["steps"] is JsonArray a ? a.Count : 0;
                Report("creating_workflows", $"Workflow « {item.Name} »", "running", item.EntityKey, $"{stepCount} étape(s)");

                // 1. Table cible relue (schéma réel) — inactive ⇒ échec.
                if (!entities.TryGetValue(item.EntityKey, out var entityId))
                {
                    Report("reading_schema", $"Lecture de « {item.EntityKey} »", "running");
                    var schema = await _mediator.Send(new GetCustomEntitySchemaQuery(item.EntityKey), ct);
                    if (!schema.IsSuccess || !schema.Value.Entity.IsActive)
                        return await RollbackAsync($"Table « {item.EntityKey} » introuvable ou inactive.", created, Report);
                    entityId = schema.Value.Entity.Id;
                    entities[item.EntityKey] = entityId;
                    Report("reading_schema", $"Lecture de « {item.EntityKey} »", "done");
                }

                // 2. Clé libre : clés existantes lues UNE fois par table, puis _2 … _9.
                if (!takenKeys.TryGetValue(entityId, out var taken))
                {
                    var list = await _mediator.Send(new ListWorkflowsQuery(entityId), ct);
                    if (!list.IsSuccess)
                        return await RollbackAsync(Describe(list.Error, $"Table « {item.EntityKey} » introuvable."), created, Report);
                    taken = list.Value.Select(d => d.Key).ToHashSet(StringComparer.Ordinal);
                    takenKeys[entityId] = taken;
                }
                var key = FreeKey(item.Key, taken);
                if (key is null)
                    return await RollbackAsync($"Workflow « {item.Name} » : clé « {item.Key} » indisponible ({MaxKeyAttempts} variantes essayées).", created, Report);

                // 3. Création INACTIVE par la commande existante (IsActive: false figé par ToSaveRequest).
                var request = StudioAiWorkflowSpec.ToSaveRequest(item) with { Key = key };
                var result = await _mediator.Send(new CreateWorkflowCommand(entityId, request), ct);
                if (!result.IsSuccess)
                {
                    var why = Describe(result.Error, $"Table « {item.EntityKey} » introuvable.");
                    Report("creating_workflows", $"Workflow « {item.Name} »", "error", item.EntityKey, why);
                    return await RollbackAsync($"Workflow « {item.Name} » : {why}", created, Report);
                }
                taken.Add(key);
                created.Add(new CreatedWorkflow(result.Value.Id, result.Value.Key, item.EntityKey, result.Value.Name, result.Value.StepCount));
                Report("creating_workflows", $"Workflow « {item.Name} »", "done", item.EntityKey, $"clé « {key} » · inactif");
            }
        }
        catch (Exception) when (created.Count > 0)
        {
            // Défaut bruyant (SQL, course sur l'index unique, annulation…) APRÈS une création : l'invariant
            // tout-ou-rien prime — rollback puis message générique. Sans création préalable, rien à défaire :
            // l'exception remonte au handler de confirmation (plan marqué en échec, exception journalisée).
            return await RollbackAsync(UnexpectedErrorMessage, created, Report);
        }

        Report("completed", $"{created.Count} workflow(s) créé(s)", "done");
        var n = created.Count;
        return (true, null, new
        {
            success = true,
            workflows = created.Select(c => new { id = c.Id, key = c.Key, entityKey = c.EntityKey, name = c.Name, stepCount = c.StepCount }).ToList(),
            openUrl = "/studio/workflows",
            warnings = spec.Warnings,
            message = n == 1
                ? "1 workflow créé — inactif : activez-le depuis le hub après relecture."
                : $"{n} workflows créés — inactifs : activez-les depuis le hub après relecture."
        });
    }

    /// <summary>Clé libre : la clé demandée, sinon <c>{clé}_2</c> … <c>{clé}_9</c> (base tronquée pour rester ≤ KeyMaxLength = 64) ; null si tout est pris.</summary>
    internal static string? FreeKey(string baseKey, IReadOnlySet<string> taken)
    {
        if (!taken.Contains(baseKey)) return baseKey;
        for (var n = 2; n <= MaxKeyAttempts; n++)
        {
            var suffix = $"_{n}";
            var maxRoot = StudioWorkflowDefinition.KeyMaxLength - suffix.Length;
            // Base tronquée puis débarrassée des « _ » finaux (même règle que la duplication de workflow).
            var candidate = (baseKey.Length > maxRoot ? baseKey[..maxRoot].TrimEnd('_') : baseKey) + suffix;
            if (!taken.Contains(candidate)) return candidate;
        }
        return null;
    }

    private async Task<(bool Success, string? Error, object? Payload)> RollbackAsync(
        string error, List<CreatedWorkflow> created, Action<string, string, string, string?, string?> report)
    {
        report("failed", "Échec – annulation", "error", null, error);
        var leftovers = new List<string>();
        foreach (var c in created.AsEnumerable().Reverse())
        {
            // D-08 : le rollback va au bout même si la requête d'origine est annulée.
            var deleted = await _mediator.Send(new DeleteWorkflowCommand(c.Id), CancellationToken.None);
            if (!deleted.IsSuccess)
            {
                var why = Describe(deleted.Error, "workflow déjà supprimé");
                report("failed", $"Annulation de « {c.Name} » impossible", "error", c.EntityKey, why);
                leftovers.Add($"« {c.Name} » (clé « {c.Key} ») : {why}");
            }
        }
        // Jamais silencieux : un delete raté est aussi porté par le message persisté du plan (le flux de
        // progression est transitoire) — le workflow restant est inactif, donc sans effet.
        if (leftovers.Count > 0)
            error = $"{(error.EndsWith('.') ? error : error + ".")} Annulation incomplète — workflow(s) inactif(s) à supprimer depuis le hub : {string.Join(" ; ", leftovers)}.";
        // Le message est persisté dans ErrorMessage (2048) : borné pour ne jamais faire échouer la mise à jour du plan.
        if (error.Length > MaxErrorLength)
            error = error[..(MaxErrorLength - 1)] + "…";
        return (false, error, null);
    }

    /// <summary>
    /// Les commandes renvoient des « X with ID … was not found » techniques (course de suppression entre la lecture
    /// et l'écriture) : traduits pour l'utilisateur ; les autres descriptions sont déjà en français.
    /// </summary>
    private static string Describe(Error error, string frenchNotFound) =>
        error.Code.EndsWith(".NotFound", StringComparison.Ordinal) ? frenchNotFound : error.Description;
}
