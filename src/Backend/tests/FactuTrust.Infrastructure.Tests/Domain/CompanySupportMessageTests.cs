using FactuTrust.Domain.Entities.CompanySupport;
using FactuTrust.Domain.Enums;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Domain;

public sealed class CompanySupportMessageTests
{
    [Fact]
    public void Company_message_requires_a_body_or_an_attachment()
    {
        var result = CompanySupportMessage.Create(
            Guid.NewGuid(), Guid.NewGuid(), CompanySupportAuthorSide.Company, "Ada",
            CompanySupportCategory.Question, "  ", Guid.NewGuid(), hasAttachments: false);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void Company_message_rejects_a_platform_reply_category()
    {
        var result = CompanySupportMessage.Create(
            Guid.NewGuid(), Guid.NewGuid(), CompanySupportAuthorSide.Company, "Ada",
            CompanySupportCategory.Reply, "Bonjour", Guid.NewGuid());

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void Platform_message_must_be_a_reply()
    {
        var result = CompanySupportMessage.Create(
            Guid.NewGuid(), Guid.NewGuid(), CompanySupportAuthorSide.Platform, "Sam",
            CompanySupportCategory.Complaint, "Bonjour", Guid.NewGuid());

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void Message_rejects_a_body_over_4000_characters()
    {
        var result = CompanySupportMessage.Create(
            Guid.NewGuid(), Guid.NewGuid(), CompanySupportAuthorSide.Company, "Ada",
            CompanySupportCategory.Proposal, new string('a', 4001), Guid.NewGuid());

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void Attachment_rejects_an_empty_file()
    {
        var result = CompanySupportAttachment.Create(
            Guid.NewGuid(), "note.pdf", "abc/file.pdf", "application/pdf", 0, Guid.NewGuid());

        Assert.True(result.IsFailure);
    }

    [Fact]
    public void Read_cursor_does_not_move_backward()
    {
        var cursor = CompanySupportReadCursor.Create(Guid.NewGuid(), Guid.NewGuid(), new DateTime(2026, 9, 24, 12, 0, 0, DateTimeKind.Utc)).Value;
        cursor.Advance(new DateTime(2026, 9, 24, 11, 0, 0, DateTimeKind.Utc));
        Assert.Equal(new DateTime(2026, 9, 24, 12, 0, 0, DateTimeKind.Utc), cursor.LastReadAt);
    }
}
