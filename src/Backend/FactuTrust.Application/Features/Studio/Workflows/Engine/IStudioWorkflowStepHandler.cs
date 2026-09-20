using System.Text.Json.Nodes;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;

namespace FactuTrust.Application.Features.Studio.Workflows.Engine;

/// <summary>Tout ce que le moteur fournit à un handler pour exécuter une étape.</summary>
public sealed record StepExecutionContext(
    Guid TenantId,
    StudioWorkflowDefinition Definition,
    StudioWorkflowInstance Instance,
    CustomEntityDefinition Entity,
    IReadOnlyList<CustomFieldDefinition> Fields,
    CustomRecord Record,
    JsonObject RecordData,
    StudioWorkflowContext Context,
    WorkflowStepSpec Step,
    int StepIndex,
    bool IsResume,
    DateTime NowUtc);

/// <summary>Exécute un type d'étape de workflow Studio (une implémentation par <see cref="StepType"/>).</summary>
public interface IStudioWorkflowStepHandler
{
    /// <summary>Type d'étape géré (<c>condition</c>, <c>update_field</c>, <c>erp_action</c>…).</summary>
    string StepType { get; }

    /// <summary>Exécute l'étape et retourne l'issue demandée au moteur.</summary>
    Task<StepOutcome> ExecuteAsync(StepExecutionContext ctx, CancellationToken cancellationToken);
}
