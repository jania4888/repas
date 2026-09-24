using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities.CompanySupport;

/// <summary>
/// Single permanent conversation between one company tenant and platform operators.
/// </summary>
public sealed class CompanySupportConversation : AggregateRoot
{
    public const int PreviewMaxLength = 160;

    public Guid CompanyTenantId { get; private set; }
    public DateTime? LastMessageAt { get; private set; }
    public string? LastMessagePreview { get; private set; }
    public CompanySupportCategory? LastMessageCategory { get; private set; }
    public CompanySupportAuthorSide? LastAuthorSide { get; private set; }

    private CompanySupportConversation() { }

    public static Result<CompanySupportConversation> Create(Guid companyTenantId)
    {
        if (companyTenantId == Guid.Empty)
            return Result.Failure<CompanySupportConversation>(Error.Validation("Tenant", "Société invalide"));

        return Result.Success(new CompanySupportConversation
        {
            CompanyTenantId = companyTenantId
        });
    }

    public void Touch(CompanySupportCategory category, CompanySupportAuthorSide side, string? preview)
    {
        LastMessageAt = DateTime.UtcNow;
        LastMessageCategory = category;
        LastAuthorSide = side;
        LastMessagePreview = Truncate(preview?.Trim(), PreviewMaxLength);
        UpdatedAt = DateTime.UtcNow;
    }

    private static string? Truncate(string? value, int maxLength) =>
        value is null || value.Length <= maxLength ? value : value[..maxLength];
}
