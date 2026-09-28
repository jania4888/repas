using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Tests;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Centre de notifications in-app (base master) : ciblage tenant + rôle,
/// compteur non-lues, marquage lu fail-closed sur le tenant/rôle.
/// </summary>
public sealed class NotificationServiceTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    private static MasterDbContext BuildMaster()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new MasterDbContext(options);
    }

    [Fact]
    public async Task Create_then_unread_count_scopes_by_tenant_and_role()
    {
        await using var db = BuildMaster();
        var service = new NotificationService(db, new PassthroughMessageLocalizer());

        await service.CreateAsync(TenantA, "FirmManager", NotificationType.FirmAssignmentRequested, "Titre", "Corps", "/firm/invitations");
        await service.CreateAsync(TenantA, null, NotificationType.FirmAssignmentAccepted, "Générale", "Corps");
        await service.CreateAsync(TenantB, "FirmManager", NotificationType.FirmAssignmentRequested, "Autre tenant", "Corps");

        // FirmManager du tenant A : la ciblée rôle + la générale.
        Assert.Equal(2, await service.GetUnreadCountAsync(TenantA, "FirmManager"));
        // FirmAccountant du tenant A : seulement la générale (rôle non ciblé).
        Assert.Equal(1, await service.GetUnreadCountAsync(TenantA, "FirmAccountant"));
        // Tenant B isolé.
        Assert.Equal(1, await service.GetUnreadCountAsync(TenantB, "FirmManager"));
    }

    [Fact]
    public async Task GetList_orders_desc_and_filters_unread_only()
    {
        await using var db = BuildMaster();
        var service = new NotificationService(db, new PassthroughMessageLocalizer());

        await service.CreateAsync(TenantA, null, NotificationType.FirmAssignmentRequested, "Première", "Corps");
        await service.CreateAsync(TenantA, null, NotificationType.FirmAssignmentAccepted, "Seconde", "Corps");

        var all = await service.GetListAsync(TenantA, "Administrator", unreadOnly: false, page: 1, pageSize: 10);
        Assert.Equal(2, all.TotalCount);
        Assert.Equal(2, all.UnreadCount);

        var first = all.Items[0].Id;
        await service.MarkReadAsync(TenantA, "Administrator", first);

        var unread = await service.GetListAsync(TenantA, "Administrator", unreadOnly: true, page: 1, pageSize: 10);
        Assert.Single(unread.Items);
        Assert.Equal(1, unread.UnreadCount);
    }

    [Fact]
    public async Task MarkRead_is_fail_closed_on_tenant_and_role()
    {
        await using var db = BuildMaster();
        var service = new NotificationService(db, new PassthroughMessageLocalizer());

        await service.CreateAsync(TenantA, "FirmManager", NotificationType.FirmAssignmentRequested, "Titre", "Corps");
        var id = (await service.GetListAsync(TenantA, "FirmManager", false, 1, 10)).Items[0].Id;

        // Autre tenant : refus.
        Assert.True((await service.MarkReadAsync(TenantB, "FirmManager", id)).IsFailure);
        // Bon tenant mais rôle non ciblé : refus.
        Assert.True((await service.MarkReadAsync(TenantA, "FirmAccountant", id)).IsFailure);
        // Bon tenant + bon rôle : succès.
        Assert.True((await service.MarkReadAsync(TenantA, "FirmManager", id)).IsSuccess);
        Assert.Equal(0, await service.GetUnreadCountAsync(TenantA, "FirmManager"));
    }

    [Fact]
    public async Task MarkAllRead_only_marks_visible_notifications()
    {
        await using var db = BuildMaster();
        var service = new NotificationService(db, new PassthroughMessageLocalizer());

        await service.CreateAsync(TenantA, "FirmManager", NotificationType.FirmAssignmentRequested, "Ciblée manager", "Corps");
        await service.CreateAsync(TenantA, "FirmAccountant", NotificationType.FirmAssignmentRequested, "Ciblée accountant", "Corps");
        await service.CreateAsync(TenantB, null, NotificationType.FirmAssignmentRequested, "Autre tenant", "Corps");

        await service.MarkAllReadAsync(TenantA, "FirmManager");

        Assert.Equal(0, await service.GetUnreadCountAsync(TenantA, "FirmManager"));
        Assert.Equal(1, await service.GetUnreadCountAsync(TenantA, "FirmAccountant"));
        Assert.Equal(1, await service.GetUnreadCountAsync(TenantB, "Administrator"));
    }

    [Fact]
    public async Task User_targeted_notification_is_visible_only_to_that_user()
    {
        await using var db = BuildMaster();
        var service = new NotificationService(db, new PassthroughMessageLocalizer());
        var collabA = Guid.Parse("aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa");
        var collabB = Guid.Parse("bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb");

        await service.CreateAsync(
            TenantA, null, NotificationType.ExchangeRequestCreated, "Demande", "Corps",
            "/firm/exchanges/x?tab=demandes", collabA, CancellationToken.None);

        Assert.Equal(1, await service.GetUnreadCountAsync(TenantA, "FirmAccountant", collabA));
        Assert.Equal(0, await service.GetUnreadCountAsync(TenantA, "FirmAccountant", collabB));
        Assert.Equal(0, await service.GetUnreadCountAsync(TenantA, "FirmManager", currentUserId: null));
        Assert.Equal(0, await service.GetUnreadCountAsync(TenantA, "FirmManager", collabB));

        var listA = await service.GetListAsync(TenantA, "FirmAccountant", false, 1, 10, collabA);
        Assert.Single(listA.Items);
        var listB = await service.GetListAsync(TenantA, "FirmAccountant", false, 1, 10, collabB);
        Assert.Empty(listB.Items);
    }

    [Fact]
    public async Task MarkRead_of_user_targeted_notification_is_fail_closed_for_other_user()
    {
        await using var db = BuildMaster();
        var service = new NotificationService(db, new PassthroughMessageLocalizer());
        var collabA = Guid.Parse("aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa");
        var collabB = Guid.Parse("bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb");

        await service.CreateAsync(
            TenantA, null, NotificationType.ExchangeDocumentShared, "Doc", "fichier.pdf",
            "/firm/exchanges/x?tab=documents", collabA, CancellationToken.None);
        var id = (await service.GetListAsync(TenantA, "FirmAccountant", false, 1, 10, collabA)).Items[0].Id;

        Assert.True((await service.MarkReadAsync(TenantA, "FirmAccountant", id, collabB)).IsFailure);
        Assert.True((await service.MarkReadAsync(TenantA, "FirmAccountant", id, currentUserId: null)).IsFailure);
        Assert.True((await service.MarkReadAsync(TenantA, "FirmAccountant", id, collabA)).IsSuccess);
        Assert.Equal(0, await service.GetUnreadCountAsync(TenantA, "FirmAccountant", collabA));
    }

    [Fact]
    public async Task MarkAllRead_does_not_mark_another_users_targeted_notification()
    {
        await using var db = BuildMaster();
        var service = new NotificationService(db, new PassthroughMessageLocalizer());
        var collabA = Guid.Parse("aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa");
        var collabB = Guid.Parse("bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb");

        await service.CreateAsync(
            TenantA, null, NotificationType.ExchangeTaskCreated, "Tâche", "Corps",
            "/firm/exchanges/x?tab=taches", collabA, CancellationToken.None);
        await service.CreateAsync(
            TenantA, "FirmAccountant", NotificationType.FirmAssignmentRequested, "Rôle accountant", "Corps");

        await service.MarkAllReadAsync(TenantA, "FirmAccountant", collabB);

        Assert.Equal(1, await service.GetUnreadCountAsync(TenantA, "FirmAccountant", collabA));
        Assert.Equal(0, await service.GetUnreadCountAsync(TenantA, "FirmAccountant", collabB));
    }

    [Fact]
    public async Task Role_targeted_notification_without_user_id_still_scopes_by_role()
    {
        await using var db = BuildMaster();
        var service = new NotificationService(db, new PassthroughMessageLocalizer());
        var managerId = Guid.Parse("cccccccc-1111-1111-1111-cccccccccccc");

        await service.CreateAsync(TenantA, "FirmManager", NotificationType.FirmAssignmentRequested, "Liaison", "Corps");

        Assert.Equal(1, await service.GetUnreadCountAsync(TenantA, "FirmManager", managerId));
        Assert.Equal(0, await service.GetUnreadCountAsync(TenantA, "FirmAccountant", managerId));
    }
}
