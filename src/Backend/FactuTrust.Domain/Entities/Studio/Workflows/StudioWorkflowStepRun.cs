using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities.Studio.Workflows;

/// <summary>
/// Trace append-only de l'exécution d'une étape de workflow : statut, issue (<see cref="Outcome"/>,
/// nom snake_case de <see cref="StudioWorkflowStepOutcome"/> stocké en clair), entrées/résultat JSON
/// (≤ 8 Ko chacun, bornés par le moteur) et erreur éventuelle. Jamais modifiée après insertion.
/// </summary>
public sealed class StudioWorkflowStepRun
{
    public const int StepTypeMaxLength = 32;
    public const int OutcomeMaxLength = 16;
    public const int ErrorMaxLength = 2000;

    public Guid Id { get; private set; }
    public Guid TenantId { get; private set; }
    public Guid InstanceId { get; private set; }

    public int StepIndex { get; private set; }
    public string StepKey { get; private set; } = null!;
    public string StepType { get; private set; } = null!;

    public StudioWorkflowStepRunStatus Status { get; private set; }

    /// <summary>Nom snake_case de l'issue (<see cref="StudioWorkflowStepOutcome"/>), null si sans objet.</summary>
    public string? Outcome { get; private set; }

    public string? InputJson { get; private set; }
    public string? ResultJson { get; private set; }
    public string? Error { get; private set; }

    public DateTime StartedAt { get; private set; }
    public DateTime FinishedAt { get; private set; }
    public Guid? RunBy { get; private set; }

    private StudioWorkflowStepRun() { }

    public static StudioWorkflowStepRun Record(
        Guid tenantId,
        Guid instanceId,
        int stepIndex,
        string stepKey,
        string stepType,
        StudioWorkflowStepRunStatus status,
        StudioWorkflowStepOutcome? outcome,
        string? inputJson,
        string? resultJson,
        string? error,
        DateTime startedAt,
        DateTime finishedAt,
        Guid? runBy)
    {
        return new StudioWorkflowStepRun
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            InstanceId = instanceId,
            StepIndex = stepIndex,
            StepKey = stepKey,
            StepType = stepType,
            Status = status,
            Outcome = outcome.HasValue ? StudioWorkflowEnumNames.OutcomeName(outcome.Value) : null,
            InputJson = inputJson,
            ResultJson = resultJson,
            Error = Truncate(error, ErrorMaxLength),
            StartedAt = startedAt,
            FinishedAt = finishedAt,
            RunBy = runBy
        };
    }

    private static string? Truncate(string? value, int maxLength) =>
        value is not null && value.Length > maxLength ? value[..maxLength] : value;
}
