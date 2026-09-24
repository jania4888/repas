using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities.CompanySupport;

public sealed class CompanySupportMessage : Entity
{
    public const int BodyMaxLength = 4000;
    public const int AuthorDisplayNameMaxLength = 200;

    public Guid ConversationId { get; private set; }
    public Guid AuthorUserId { get; private set; }
    public CompanySupportAuthorSide AuthorSide { get; private set; }
    public string AuthorDisplayName { get; private set; } = null!;
    public CompanySupportCategory Category { get; private set; }
    public string Body { get; private set; } = null!;
    public DateTime SentAt { get; private set; }
    public Guid? ClientRequestId { get; private set; }

    private CompanySupportMessage() { }

    public static Result<CompanySupportMessage> Create(
        Guid conversationId,
        Guid authorUserId,
        CompanySupportAuthorSide authorSide,
        string authorDisplayName,
        CompanySupportCategory category,
        string? body,
        Guid? clientRequestId,
        bool hasAttachments = false)
    {
        if (conversationId == Guid.Empty)
            return Result.Failure<CompanySupportMessage>(Error.Validation("Conversation", "Conversation invalide"));
        if (authorUserId == Guid.Empty)
            return Result.Failure<CompanySupportMessage>(Error.Validation("Author", "Auteur invalide"));

        var categoryError = ValidateCategory(authorSide, category);
        if (categoryError is not null)
            return Result.Failure<CompanySupportMessage>(categoryError);

        var trimmed = body?.Trim() ?? string.Empty;
        if (trimmed.Length == 0 && !hasAttachments)
            return Result.Failure<CompanySupportMessage>(Error.Validation("Body", "Le message ne peut pas être vide"));
        if (trimmed.Length > BodyMaxLength)
            return Result.Failure<CompanySupportMessage>(Error.Validation("Body", $"Le message dépasse {BodyMaxLength} caractères"));

        if (clientRequestId is { } requestId && requestId == Guid.Empty)
            return Result.Failure<CompanySupportMessage>(Error.Validation("ClientRequestId", "Identifiant de requête invalide"));

        var name = string.IsNullOrWhiteSpace(authorDisplayName) ? "Utilisateur" : authorDisplayName.Trim();

        return Result.Success(new CompanySupportMessage
        {
            ConversationId = conversationId,
            AuthorUserId = authorUserId,
            AuthorSide = authorSide,
            AuthorDisplayName = Truncate(name, AuthorDisplayNameMaxLength),
            Category = category,
            Body = trimmed,
            SentAt = DateTime.UtcNow,
            ClientRequestId = clientRequestId
        });
    }

    private static Error? ValidateCategory(CompanySupportAuthorSide side, CompanySupportCategory category)
    {
        if (side == CompanySupportAuthorSide.Company)
        {
            if (category is CompanySupportCategory.Question or CompanySupportCategory.Proposal or CompanySupportCategory.Complaint)
                return null;
            return Error.Validation("Category", "Une société doit choisir Question, Proposition ou Réclamation");
        }

        if (category != CompanySupportCategory.Reply)
            return Error.Validation("Category", "Une réponse opérateur est de type Réponse");
        return null;
    }

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];
}
