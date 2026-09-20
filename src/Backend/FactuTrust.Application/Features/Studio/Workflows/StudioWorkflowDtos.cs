using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;

namespace FactuTrust.Application.Features.Studio.Workflows;

/// <summary>
/// DTO de l'API de conception des workflows Studio (4.1k). Partiel : complété en 4.1j
/// (<c>WorkflowDefinitionDto</c>, <c>WorkflowInstanceDto</c>…).
/// </summary>
public sealed record SaveWorkflowRequest(
    string Key,
    string Name,
    string? Description,
    string Trigger,
    JsonObject? TriggerConfig,
    JsonObject Steps,
    bool IsActive,
    string? RowVersion);

/// <summary>Résultat de <c>POST entities/{entityId}/workflows/validate</c> (200 même invalide).</summary>
public sealed record WorkflowValidationResultDto(
    bool IsValid,
    IReadOnlyList<WorkflowValidationIssueDto> Errors,
    IReadOnlyList<WorkflowValidationIssueDto> Warnings,
    int StepCount);

/// <summary>Un problème de validation localisé (miroir de <c>WorkflowValidationIssue</c>).</summary>
public sealed record WorkflowValidationIssueDto(string Path, string Message);

/// <summary>Catalogue des types d'étapes (<c>GET workflows/step-catalog</c>).</summary>
public sealed record WorkflowStepCatalogDto(IReadOnlyList<StepCatalogEntryDto> Entries);

/// <summary>Une entrée du catalogue des types d'étapes.</summary>
public sealed record StepCatalogEntryDto(
    string Type,
    string Label,
    string Description,
    IReadOnlyList<StepCatalogPropertyDto> Properties);

/// <summary>Une propriété typée d'un type d'étape.</summary>
public sealed record StepCatalogPropertyDto(
    string Name,
    string Kind,
    bool Required,
    string Help,
    IReadOnlyList<string>? AllowedValues,
    int? Min,
    int? Max);

/// <summary>
/// Définition de workflow exposée par l'API (4.1j). <c>Trigger</c> en snake_case
/// (<c>StudioWorkflowEnumNames.TriggerName</c>) ; <c>TriggerConfig</c> / <c>Steps</c> reparsés depuis
/// les colonnes JSON ; <c>RowVersion</c> en base64 pour la concurrence optimiste des mises à jour.
/// </summary>
public sealed record WorkflowDefinitionDto(
    Guid Id,
    Guid EntityDefinitionId,
    string Key,
    string Name,
    string? Description,
    string Trigger,
    JsonObject TriggerConfig,
    JsonObject Steps,
    int StepCount,
    int Version,
    bool IsActive,
    int OpenInstances,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string RowVersion);

/// <summary>
/// Instance de workflow (résumé) ; <c>WorkflowKey</c> / <c>WorkflowName</c> sont null si la définition a été supprimée.
/// <c>StartedByName</c> (4.6b1 / D-46-B01, en fin de contrat, optionnel) : nom lisible du lanceur résolu par page
/// (<see cref="IStudioUserNameResolver"/>, même motif que l'inbox 4.5a2) ; null si le lanceur est inconnu (D-45-02)
/// ou si le handler ne le résout pas (réponses ponctuelles cancel / remind / start).
/// </summary>
public sealed record WorkflowInstanceDto(
    Guid Id,
    Guid WorkflowDefinitionId,
    string? WorkflowKey,
    string? WorkflowName,
    int DefinitionVersion,
    Guid EntityDefinitionId,
    Guid RecordId,
    string Trigger,
    string Status,
    int CurrentStepIndex,
    string? CurrentStepKey,
    DateTime? DueAt,
    Guid? StartedBy,
    DateTime StartedAt,
    DateTime? CompletedAt,
    int Depth,
    Guid? OriginInstanceId,
    string? Error,
    string? StartedByName = null);

/// <summary>Exécution d'une étape (journal append-only) ; <c>Result</c> est null si le JSON est absent ou n'est pas un objet.</summary>
public sealed record WorkflowStepRunDto(
    int StepIndex,
    string StepKey,
    string StepType,
    string Status,
    string? Outcome,
    JsonObject? Result,
    string? Error,
    DateTime StartedAt,
    DateTime FinishedAt);

/// <summary>Demande d'approbation d'une instance ; <c>Status</c> en snake_case.</summary>
public sealed record WorkflowApprovalDto(
    Guid Id,
    Guid InstanceId,
    string StepKey,
    Guid? AssigneeUserId,
    string? AssigneeRole,
    string Title,
    string? Message,
    string Status,
    Guid? DecidedBy,
    DateTime? DecidedAt,
    string? Comment,
    DateTime? DueAt,
    DateTime CreatedAt,
    string RowVersion);

/// <summary>Détail d'une instance : résumé, exécutions d'étapes, approbations et contexte (« previous » masqué).</summary>
public sealed record WorkflowInstanceDetailDto(
    WorkflowInstanceDto Instance,
    IReadOnlyList<WorkflowStepRunDto> Steps,
    IReadOnlyList<WorkflowApprovalDto> Approvals,
    JsonObject Context);

/// <summary>Corps de <c>POST workflows/{id}/toggle</c>.</summary>
public sealed record ToggleWorkflowRequest(bool IsActive);

// ---- Simulation « Tester sur un enregistrement » (4.7c1 / D-47-B07) ----

/// <summary>Corps de <c>POST workflows/{id}/test</c> : l'enregistrement réel sur lequel simuler.</summary>
public sealed record WorkflowTestRequest(Guid RecordId);

/// <summary>Verdicts d'une étape simulée (figés — consommés par le concepteur 4.7c2).</summary>
public static class WorkflowTestVerdicts
{
    /// <summary>L'étape serait exécutée (ou évaluée, pour une condition).</summary>
    public const string WouldRun = "would_run";

    /// <summary>L'étape serait sautée (condition non remplie avec <c>onFalse = skip</c>, ou sautée par un <c>goto</c>).</summary>
    public const string Skipped = "skipped";

    /// <summary>L'étape suspendrait l'instance (<c>approval</c> / <c>wait</c>) — fin du segment simulé.</summary>
    public const string WouldSuspend = "would_suspend";

    /// <summary>L'étape mettrait l'instance en échec (défaut manifeste, gabarit invalide…).</summary>
    public const string WouldFail = "would_fail";
}

/// <summary>
/// Une ligne de trace : l'étape, son verdict, un détail lisible (branche, échéance calculée…)
/// et les valeurs rendues (<c>set</c> appliqué, gabarits de <c>title</c>/<c>body</c>/<c>mapping</c>…).
/// </summary>
public sealed record WorkflowTestStepTraceDto(
    string Key, string Type, string? Label, string Verdict, string? Detail, JsonObject? Rendered);

/// <summary>
/// Résultat de la simulation : <c>EvaluatedSteps</c> = étapes visitées (hors lignes « sautée par
/// un branchement ») ; <c>Suspended</c> = le segment se serait interrompu (suspension ou épuisement) ;
/// <c>Warnings</c> = limites de fidélité (sorties <c>_results.*</c> fictives, segment épuisé).
/// Simulation PURE : aucune écriture (ni instance, ni journal, ni notification, ni audit).
/// </summary>
public sealed record WorkflowTestResultDto(
    Guid RecordId,
    string EntityKey,
    int EvaluatedSteps,
    bool Suspended,
    IReadOnlyList<WorkflowTestStepTraceDto> Steps,
    IReadOnlyList<string> Warnings);

/// <summary>Résultat de <c>DELETE workflows/{id}</c> : nombre d'instances ouvertes annulées.</summary>
public sealed record WorkflowDeletionResultDto(int CancelledInstances);

/// <summary>
/// Élément du catalogue tenant (<c>GET api/studio/workflows</c>, 4.5c2 / D-44-20) : la définition telle que servie par
/// <c>GET entities/{entityId}/workflows</c>, enveloppée avec l'identité de sa table (motif <c>summary.workflows[]</c> : <c>entityKey</c> / <c>entityDisplayName</c>).
/// </summary>
public sealed record WorkflowDefinitionListItemDto(WorkflowDefinitionDto Workflow, string EntityKey, string EntityDisplayName);
