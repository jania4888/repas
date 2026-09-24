using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.Entities.CompanySupport;

/// <summary>Per-user read position. Unread is personal, not shared by role.</summary>
public sealed class CompanySupportReadCursor : Entity
{
    public Guid ConversationId { get; private set; }
    public Guid UserId { get; private set; }
    public DateTime LastReadAt { get; private set; }

    private CompanySupportReadCursor() { }

    public static Result<CompanySupportReadCursor> Create(Guid conversationId, Guid userId, DateTime lastReadAt)
    {
        if (conversationId == Guid.Empty || userId == Guid.Empty)
            return Result.Failure<CompanySupportReadCursor>(Error.Validation("Cursor", "Curseur invalide"));

        return Result.Success(new CompanySupportReadCursor
        {
            ConversationId = conversationId,
            UserId = userId,
            LastReadAt = lastReadAt
        });
    }

    /// <summary>Moves the cursor forward only.</summary>
    public void Advance(DateTime readAt)
    {
        if (readAt > LastReadAt)
        {
            LastReadAt = readAt;
            UpdatedAt = DateTime.UtcNow;
        }
    }
}
