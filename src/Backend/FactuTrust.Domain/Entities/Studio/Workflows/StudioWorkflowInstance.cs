using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities.Studio.Workflows;

/// <summary>
/// Exécution d'un workflow (<see cref="StudioWorkflowDefinition"/>) sur un enregistrement :
/// pointeur d'étape courant, contexte JSON, échéance éventuelle (<see cref="DueAt"/>) et bail de
/// reprise (<see cref="LeasedAt"/>) utilisé par le job différé. <see cref="Depth"/> et
/// <see cref="OriginInstanceId"/> bornent le chaînage (une étape peut démarrer un autre workflow).
/// </summary>
public sealed class StudioWorkflowInstance
{
    public const int ErrorMaxLength = 2000;

    public Guid Id { get; private set; }
    public Guid TenantId { get; private set; }
    public Guid WorkflowDefinitionId { get; private set; }

    /// <summary>Version de la définition au démarrage (les modifications ultérieures ne s'appliquent pas).</summary>
    public int DefinitionVersion { get; private set; }

    public Guid EntityDefinitionId { get; private set; }
    public Guid RecordId { get; private set; }

    public StudioWorkflowTriggerKind TriggerKind { get; private set; }
    public StudioWorkflowInstanceStatus Status { get; private set; }

    public int CurrentStepIndex { get; private set; }
    public string? CurrentStepKey { get; private set; }

    /// <summary>Contexte d'exécution (valeurs du record, résultats intermédiaires), sérialisé en JSON.</summary>
    public string ContextJson { get; private set; } = null!;

    /// <summary>Échéance de reprise (étapes wait/approval) — le job différé reprend l'instance passée ce délai.</summary>
    public DateTime? DueAt { get; private set; }

    /// <summary>Bail posé par le moteur pendant l'exécution d'un segment (anti double-reprise).</summary>
    public DateTime? LeasedAt { get; private set; }

    /// <summary>Dernier rappel envoyé à l'approbateur (D3).</summary>
    public DateTime? LastRemindedAt { get; private set; }

    public Guid? StartedBy { get; private set; }
    public DateTime StartedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }
    public DateTime? CompletedAt { get; private set; }

    /// <summary>Profondeur de chaînage (0 = démarrée directement par le déclencheur).</summary>
    public int Depth { get; private set; }

    /// <summary>Instance à l'origine de celle-ci, le cas échéant (chaînage).</summary>
    public Guid? OriginInstanceId { get; private set; }

    public string? Error { get; private set; }
    public byte[] RowVersion { get; private set; } = null!;

    private StudioWorkflowInstance() { }

    /// <summary>Vrai si l'instance a atteint un état final (Completed, Failed ou Cancelled).</summary>
    public bool IsTerminal => Status is StudioWorkflowInstanceStatus.Completed
        or StudioWorkflowInstanceStatus.Failed
        or StudioWorkflowInstanceStatus.Cancelled;

    public static StudioWorkflowInstance Start(
        Guid tenantId,
        StudioWorkflowDefinition definition,
        Guid recordId,
        StudioWorkflowTriggerKind triggerKind,
        Guid? startedBy,
        string contextJson,
        int depth,
        Guid? originInstanceId)
    {
        var now = DateTime.UtcNow;
        return new StudioWorkflowInstance
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            WorkflowDefinitionId = definition.Id,
            DefinitionVersion = definition.Version,
            EntityDefinitionId = definition.EntityDefinitionId,
            RecordId = recordId,
            TriggerKind = triggerKind,
            Status = StudioWorkflowInstanceStatus.Running,
            CurrentStepIndex = 0,
            ContextJson = contextJson,
            Depth = depth,
            OriginInstanceId = originInstanceId,
            StartedBy = startedBy,
            StartedAt = now,
            UpdatedAt = now
        };
    }

    /// <summary>Avance le pointeur d'étape et repasse l'instance en cours (reprise d'une attente).</summary>
    public void Advance(int nextStepIndex, string? nextStepKey, string contextJson)
    {
        if (IsTerminal)
            throw new InvalidOperationException("Une instance de workflow terminale ne peut plus avancer.");

        Status = StudioWorkflowInstanceStatus.Running;
        CurrentStepIndex = nextStepIndex;
        CurrentStepKey = nextStepKey;
        ContextJson = contextJson;
        DueAt = null;
        Touch();
    }

    /// <summary>Suspend l'instance (attente du job différé ou d'une approbation).</summary>
    public void Suspend(StudioWorkflowInstanceStatus status, DateTime? dueAt, string contextJson)
    {
        if (status is not (StudioWorkflowInstanceStatus.Waiting or StudioWorkflowInstanceStatus.WaitingApproval))
            throw new ArgumentOutOfRangeException(nameof(status), status, "Seuls les statuts Waiting et WaitingApproval sont autorisés.");
        if (IsTerminal)
            throw new InvalidOperationException("Une instance de workflow terminale ne peut pas être suspendue.");

        Status = status;
        DueAt = dueAt;
        ContextJson = contextJson;
        Touch();
    }

    /// <summary>Pose le bail s'il est absent ou expiré ; retourne false si un bail encore frais existe.</summary>
    public bool TryLease(DateTime nowUtc, TimeSpan leaseDuration)
    {
        if (LeasedAt is { } leasedAt && leasedAt >= nowUtc - leaseDuration)
            return false;

        LeasedAt = nowUtc;
        return true;
    }

    public void ReleaseLease() => LeasedAt = null;

    /// <summary>D20 : marque l'instance comme échue sans changer son statut (utilisé par le job de reprise).</summary>
    public void MarkDue(DateTime nowUtc)
    {
        if (IsTerminal)
            throw new InvalidOperationException("Une instance de workflow terminale ne peut pas être marquée échue.");

        DueAt = nowUtc;
        Touch();
    }

    public void MarkReminded(DateTime nowUtc)
    {
        LastRemindedAt = nowUtc;
        Touch();
    }

    public void Complete(string contextJson)
    {
        Status = StudioWorkflowInstanceStatus.Completed;
        ContextJson = contextJson;
        CompletedAt = DateTime.UtcNow;
        Touch();
    }

    public void Fail(string? error)
    {
        Status = StudioWorkflowInstanceStatus.Failed;
        Error = Truncate(error, ErrorMaxLength);
        CompletedAt = DateTime.UtcNow;
        Touch();
    }

    public void Cancel(string? reason)
    {
        Status = StudioWorkflowInstanceStatus.Cancelled;
        Error = Truncate(reason, ErrorMaxLength);
        CompletedAt = DateTime.UtcNow;
        Touch();
    }

    private void Touch() => UpdatedAt = DateTime.UtcNow;

    private static string? Truncate(string? value, int maxLength) =>
        value is not null && value.Length > maxLength ? value[..maxLength] : value;
}
