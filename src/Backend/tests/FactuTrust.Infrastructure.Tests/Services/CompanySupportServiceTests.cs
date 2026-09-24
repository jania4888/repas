using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.CompanySupport;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class CompanySupportServiceTests : IDisposable
{
    private readonly string _storageRoot;
    private readonly MasterDbContext _db;
    private readonly CompanySupportService _service;
    private readonly Mock<INotificationService> _notifications = new();
    private readonly Mock<IPlatformActionAuditWriter> _audit = new();

    public CompanySupportServiceTests()
    {
        _storageRoot = Path.Combine(Path.GetTempPath(), "ft-support-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_storageRoot);
        _db = new MasterDbContext(new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);
        _notifications
            .Setup(n => n.CreateAsync(
                It.IsAny<Guid>(), It.IsAny<string?>(), It.IsAny<NotificationType>(),
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(),
                It.IsAny<Guid?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        _audit
            .Setup(a => a.WriteAsync(It.IsAny<PlatformActionAuditRecord>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _service = new CompanySupportService(
            _db,
            _notifications.Object,
            _audit.Object,
            Options.Create(new CompanySupportAttachmentsOptions { BasePath = _storageRoot }),
            NullLogger<CompanySupportService>.Instance);
    }

    [Fact]
    public async Task Post_is_idempotent_for_the_same_client_request()
    {
        var tenant = await SeedCompanyAsync("Société A");
        var user = Guid.NewGuid();
        var requestId = Guid.NewGuid();

        var first = await _service.PostCompanyMessageAsync(
            tenant.Id, user, "Ada", CompanySupportCategory.Question, "Bonjour", requestId, Array.Empty<CompanySupportUpload>());
        var second = await _service.PostCompanyMessageAsync(
            tenant.Id, user, "Ada", CompanySupportCategory.Question, "Bonjour encore", requestId, Array.Empty<CompanySupportUpload>());

        Assert.True(first.IsSuccess);
        Assert.True(second.IsSuccess);
        Assert.Equal(first.Value.Id, second.Value.Id);
        Assert.Equal(1, await _db.CompanySupportMessages.CountAsync());
    }

    [Fact]
    public async Task Download_of_another_company_attachment_is_not_found()
    {
        var companyA = await SeedCompanyAsync("Société A");
        var companyB = await SeedCompanyAsync("Société B");
        var posted = await _service.PostCompanyMessageAsync(
            companyA.Id, Guid.NewGuid(), "Ada", CompanySupportCategory.Complaint, "Pièce",
            Guid.NewGuid(),
            new[] { new CompanySupportUpload("note.pdf", "application/pdf", "%PDF-1.4\n"u8.ToArray()) });

        Assert.True(posted.IsSuccess);
        var attachmentId = posted.Value.Attachments[0].Id;

        var download = await _service.DownloadForCompanyAsync(companyB.Id, Guid.NewGuid(), attachmentId);

        Assert.True(download.IsFailure);
        Assert.Contains("NotFound", download.Error.Code, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Download_rejects_a_storage_path_that_escapes_the_root()
    {
        var company = await SeedCompanyAsync("Société A");
        var conversation = CompanySupportConversation.Create(company.Id).Value;
        var message = CompanySupportMessage.Create(
            conversation.Id, Guid.NewGuid(), CompanySupportAuthorSide.Company, "Ada",
            CompanySupportCategory.Question, "x", Guid.NewGuid()).Value;
        var attachment = CompanySupportAttachment.Create(
            message.Id, "secret.txt", "../secret.txt", "text/plain", 4, Guid.NewGuid()).Value;
        _db.AddRange(conversation, message, attachment);
        await _db.SaveChangesAsync();

        var download = await _service.DownloadForCompanyAsync(company.Id, Guid.NewGuid(), attachment.Id);

        Assert.True(download.IsFailure);
    }

    [Fact]
    public async Task Post_rejects_a_double_extension()
    {
        var tenant = await SeedCompanyAsync("Société A");
        var result = await _service.PostCompanyMessageAsync(
            tenant.Id, Guid.NewGuid(), "Ada", CompanySupportCategory.Question, "voir fichier",
            Guid.NewGuid(),
            new[] { new CompanySupportUpload("note.pdf.exe", "application/pdf", "%PDF-1.4\n"u8.ToArray()) });

        Assert.True(result.IsFailure);
        Assert.Empty(Directory.EnumerateFiles(_storageRoot, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Post_rejects_a_pdf_whose_signature_does_not_match()
    {
        var tenant = await SeedCompanyAsync("Société A");
        var result = await _service.PostCompanyMessageAsync(
            tenant.Id, Guid.NewGuid(), "Ada", CompanySupportCategory.Question, "voir fichier",
            Guid.NewGuid(),
            new[] { new CompanySupportUpload("note.pdf", "application/pdf", "not-a-pdf"u8.ToArray()) });

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Platform_reply_notifies_company_admin_and_supervisor_except_the_author()
    {
        var tenant = await SeedCompanyAsync("Société A");
        var admin = NewUser(tenant.Id, nameof(UserRole.Administrator));
        var supervisor = NewUser(tenant.Id, nameof(UserRole.Supervisor));
        var accountant = NewUser(tenant.Id, nameof(UserRole.Accountant));
        _db.Users.AddRange(admin, supervisor, accountant);
        await _db.SaveChangesAsync();
        await GrantRoleAsync(admin.Id, nameof(UserRole.Administrator));
        await GrantRoleAsync(supervisor.Id, nameof(UserRole.Supervisor));
        await GrantRoleAsync(accountant.Id, nameof(UserRole.Accountant));

        var result = await _service.PostPlatformReplyAsync(
            tenant.Id, Guid.NewGuid(), "Sam · Support", "hidden@example.com",
            "Nous revenons vers vous", Guid.NewGuid(), Array.Empty<CompanySupportUpload>());

        Assert.True(result.IsSuccess);
        Assert.DoesNotContain("@", result.Value.AuthorDisplayName);
        _notifications.Verify(n => n.CreateAsync(
            tenant.Id, null, NotificationType.CompanySupportReplyReceived,
            It.IsAny<string>(), It.IsAny<string>(), "/assistance", admin.Id, It.IsAny<CancellationToken>()), Times.Once);
        _notifications.Verify(n => n.CreateAsync(
            tenant.Id, null, NotificationType.CompanySupportReplyReceived,
            It.IsAny<string>(), It.IsAny<string>(), "/assistance", supervisor.Id, It.IsAny<CancellationToken>()), Times.Once);
        _notifications.Verify(n => n.CreateAsync(
            tenant.Id, null, NotificationType.CompanySupportReplyReceived,
            It.IsAny<string>(), It.IsAny<string>(), "/assistance", accountant.Id, It.IsAny<CancellationToken>()), Times.Never);
    }

    public void Dispose()
    {
        _db.Dispose();
        if (Directory.Exists(_storageRoot))
            Directory.Delete(_storageRoot, recursive: true);
    }

    private async Task<Tenant> SeedCompanyAsync(string name)
    {
        var nif = NIF.Create($"{Random.Shared.Next(1000000, 9999999)}/A/B/C/000").Value;
        var tenant = Tenant.Create(
            name, nif, Address.Create("1 rue", "Tunis", "Tunis").Value,
            Email.Create($"{Guid.NewGuid():N}@example.com").Value,
            PhoneNumber.Create("70123456").Value,
            TaxRegime.RealRegime).Value;
        _db.Tenants.Add(tenant);
        await _db.SaveChangesAsync();
        return tenant;
    }

    private static ApplicationUser NewUser(Guid tenantId, string role) => new()
    {
        Id = Guid.NewGuid(),
        UserName = Guid.NewGuid().ToString("N"),
        Email = Guid.NewGuid().ToString("N") + "@example.com",
        FirstName = role,
        LastName = "Test",
        TenantId = tenantId,
        IsActive = true
    };

    private async Task GrantRoleAsync(Guid userId, string roleName)
    {
        var role = await _db.Roles.FirstOrDefaultAsync(r => r.Name == roleName);
        if (role is null)
        {
            role = new ApplicationRole { Id = Guid.NewGuid(), Name = roleName, NormalizedName = roleName.ToUpperInvariant() };
            _db.Roles.Add(role);
            await _db.SaveChangesAsync();
        }
        _db.UserRoles.Add(new Microsoft.AspNetCore.Identity.IdentityUserRole<Guid> { UserId = userId, RoleId = role.Id });
        await _db.SaveChangesAsync();
    }
}
