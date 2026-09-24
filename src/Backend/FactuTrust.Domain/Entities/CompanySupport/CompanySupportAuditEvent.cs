using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities.CompanySupport;

/// <summary>Append-only audit of company-side support actions. Never stores message body.</summary>
public sealed class CompanySupportAuditEvent : Entity
{
    public const int ActionMaxLength = 80;

    public Guid ConversationId { get; private set; }
    public Guid? MessageId { get; private set; }
    public Guid? AttachmentId { get; private set; }
    public Guid ActorUserId { get; private set; }
    public CompanySupportAuthorSide ActorSide { get; private set; }
    public string Action { get; private set; } = null!;
    public DateTime OccurredAt { get; private set; }

    private CompanySupportAuditEvent() { }

    public static CompanySupportAuditEvent Create(
        Guid conversationId,
        Guid actorUserId,
        CompanySupportAuthorSide actorSide,
        string action,
        Guid? messageId = null,
        Guid? attachmentId = null)
    {
        if (string.IsNullOrWhiteSpace(action))
            throw new ArgumentException("Action is required.", nameof(action));

        var trimmed = action.Trim();
        return new CompanySupportAuditEvent
        {
            ConversationId = conversationId,
            ActorUserId = actorUserId,
            ActorSide = actorSide,
            Action = trimmed.Length <= ActionMaxLength ? trimmed : trimmed[..ActionMaxLength],
            MessageId = messageId,
            AttachmentId = attachmentId,
            OccurredAt = DateTime.UtcNow
        };
    }
}
