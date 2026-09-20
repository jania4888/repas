using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities.Studio.Workflows;

/// <summary>
/// Demande d'approbation émise par une étape « approval » d'un workflow : destinataire (un utilisateur
/// ou un rôle, jamais les deux), décision éventuelle et échéance. Une fois décidée, annulée ou
/// expirée, l'approbation est figée (<see cref="Decide"/> exige le statut Pending).
/// </summary>
public sealed class StudioWorkflowApproval
{
    public const int TitleMaxLength = 200;
    public const int MessageMaxLength = 1000;
    public const int CommentMaxLength = 2000;

    public Guid Id { get; private set; }
    public Guid TenantId { get; private set; }
    public Guid InstanceId { get; private set; }

    /// <summary>Clé de l'étape « approval » à l'origine de la demande.</summary>
    public string StepKey { get; private set; } = null!;

    /// <summary>Utilisateur assigné (exclusif avec <see cref="AssigneeRole"/>).</summary>
    public Guid? AssigneeUserId { get; private set; }

    /// <summary>Rôle assigné (nom de rôle, exclusif avec <see cref="AssigneeUserId"/>).</summary>
    public string? AssigneeRole { get; private set; }

    public string Title { get; private set; } = null!;
    public string? Message { get; private set; }

    public StudioWorkflowApprovalStatus Status { get; private set; }

    public Guid? DecidedBy { get; private set; }
    public DateTime? DecidedAt { get; private set; }
    public string? Comment { get; private set; }

    public DateTime? DueAt { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public byte[] RowVersion { get; private set; } = null!;

    private StudioWorkflowApproval() { }

    public static StudioWorkflowApproval Create(
        Guid tenantId,
        Guid instanceId,
        string stepKey,
        Guid? assigneeUserId,
        string? assigneeRole,
        string title,
        string? message,
        DateTime? dueAt)
    {
        return new StudioWorkflowApproval
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            InstanceId = instanceId,
            StepKey = stepKey,
            AssigneeUserId = assigneeUserId,
            AssigneeRole = assigneeRole,
            Title = title,
            Message = message,
            Status = StudioWorkflowApprovalStatus.Pending,
            DueAt = dueAt,
            CreatedAt = DateTime.UtcNow
        };
    }

    /// <summary>Enregistre la décision (Approved ou Rejected) ; exige le statut Pending.</summary>
    public void Decide(StudioWorkflowApprovalStatus decision, Guid decidedBy, string? comment, DateTime nowUtc)
    {
        if (decision is not (StudioWorkflowApprovalStatus.Approved or StudioWorkflowApprovalStatus.Rejected))
            throw new ArgumentOutOfRangeException(nameof(decision), decision, "La décision doit être Approved ou Rejected.");
        if (Status != StudioWorkflowApprovalStatus.Pending)
            throw new InvalidOperationException("Seule une approbation en attente peut être décidée.");

        Status = decision;
        DecidedBy = decidedBy;
        DecidedAt = nowUtc;
        Comment = Truncate(comment, CommentMaxLength);
    }

    public void Cancel(DateTime nowUtc)
    {
        if (Status == StudioWorkflowApprovalStatus.Cancelled)
            return;
        if (Status != StudioWorkflowApprovalStatus.Pending)
            throw new InvalidOperationException("Seule une approbation en attente peut être annulée.");

        Status = StudioWorkflowApprovalStatus.Cancelled;
        DecidedAt = nowUtc;
    }

    /// <summary>Marque l'approbation comme expirée (idempotent : sans effet si elle n'est plus en attente).</summary>
    public void Expire(DateTime nowUtc)
    {
        if (Status != StudioWorkflowApprovalStatus.Pending)
            return;

        Status = StudioWorkflowApprovalStatus.Expired;
        DecidedAt = nowUtc;
    }

    /// <summary>Vrai si l'utilisateur (directement ou via son rôle) est le destinataire de la demande.</summary>
    public bool CanBeDecidedBy(Guid userId, string? role)
    {
        if (AssigneeUserId.HasValue)
            return AssigneeUserId.Value == userId;
        if (!string.IsNullOrEmpty(AssigneeRole))
            return string.Equals(AssigneeRole, role, StringComparison.OrdinalIgnoreCase);
        return false;
    }

    private static string? Truncate(string? value, int maxLength) =>
        value is not null && value.Length > maxLength ? value[..maxLength] : value;
}
