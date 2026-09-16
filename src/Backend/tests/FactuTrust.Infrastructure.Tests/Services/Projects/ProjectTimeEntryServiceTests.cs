using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.Projects;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Services;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.Projects;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.Projects;

public sealed class ProjectTimeEntryServiceTests
{
    private sealed class InMemoryTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly DbContextOptions<TenantDbContext> _options;

        public InMemoryTenantDbContextFactory(string databaseName)
        {
            _options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName)
                .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
        }

        public TenantDbContext CreateContext() => new(_options);
        public TenantDbContext CreateIsolatedContext() => new(_options);
    }

    private static ProjectService CreateService(
        InMemoryTenantDbContextFactory factory,
        Client client,
        Guid? userId = null,
        bool canSubmit = true,
        bool canValidate = true)
    {
        var masterOptions = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ITenantContext>();
        tenant.SetupGet(t => t.TenantId).Returns(tenantId);

        var clients = new Mock<IClientRepository>();
        clients.Setup(c => c.GetByIdAsync(client.Id, It.IsAny<CancellationToken>())).ReturnsAsync(client);

        var currentUser = new Mock<ICurrentUser>();
        var actorId = userId ?? Guid.NewGuid();
        currentUser.SetupGet(u => u.UserId).Returns(actorId);
        currentUser.Setup(u => u.HasPermission(Permissions.ProjectTime.Submit)).Returns(canSubmit);
        currentUser.Setup(u => u.HasPermission(Permissions.ProjectTime.Validate)).Returns(canValidate);

        return new ProjectService(
            factory,
            new MasterDbContext(masterOptions),
            clients.Object,
            Mock.Of<IPurchaseOrderRepository>(),
            Mock.Of<ISupplierRepository>(),
            Mock.Of<IProductRepository>(),
            Mock.Of<IInvoiceNumberGenerator>(),
            currentUser.Object,
            tenant.Object,
            Mock.Of<IMediator>(),
            Mock.Of<IConfiguration>());
    }

    private static async Task<(Project Project, Client Client, Guid UserId)> SeedActiveProjectAsync(
        InMemoryTenantDbContextFactory factory,
        bool timesheetsEnabled = true)
    {
        var address = Address.Create("1 rue Test", "Tunis", "Tunis").Value;
        var email = Email.Create("client@example.com").Value;
        var client = Client.Create("Client test", ClientType.Individual, address, email).Value;
        var userId = Guid.NewGuid();

        var project = Project.Create(
            client.Id, "Mission", ProjectKind.Esn, ProjectBillingMode.TimeAndMaterials,
            null, null, null, 5000m, isBillable: true, timesheetsEnabled: timesheetsEnabled).Value;
        Assert.True(project.Activate().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.Clients.Add(client);
            ctx.Projects.Add(project);
            await ctx.SaveChangesAsync();
        }

        return (project, client, userId);
    }

    private static async Task<Guid> SeedTaskAsync(InMemoryTenantDbContextFactory factory, Project project)
    {
        var phase = ProjectPhase.Create(project.Id, "Phase", 0).Value;
        var task = ProjectTask.Create(project.Id, phase.Id, "Tâche test", null, ProjectTaskPriority.Normal, null, null, null, 0m).Value;
        await using (var ctx = factory.CreateContext())
        {
            ctx.ProjectPhases.Add(phase);
            ctx.ProjectTasks.Add(task);
            await ctx.SaveChangesAsync();
        }
        return task.Id;
    }

    [Theory]
    [InlineData(ProjectStatus.Draft)]
    [InlineData(ProjectStatus.OnHold)]
    [InlineData(ProjectStatus.Completed)]
    [InlineData(ProjectStatus.Cancelled)]
    public async Task CreateTimeEntry_BlocksWhenProjectCannotReceiveTime(ProjectStatus status)
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var address = Address.Create("1 rue Test", "Tunis", "Tunis").Value;
        var email = Email.Create("client@example.com").Value;
        var client = Client.Create("Client test", ClientType.Individual, address, email).Value;
        var userId = Guid.NewGuid();

        var project = Project.Create(client.Id, "Mission", ProjectKind.Esn, ProjectBillingMode.TimeAndMaterials, null, null, null, 5000m).Value;
        if (status == ProjectStatus.Active)
            Assert.True(project.Activate().IsSuccess);
        else if (status == ProjectStatus.OnHold)
        {
            Assert.True(project.Activate().IsSuccess);
            Assert.True(project.Hold().IsSuccess);
        }
        else if (status == ProjectStatus.Completed)
        {
            Assert.True(project.Activate().IsSuccess);
            Assert.True(project.Complete(hasOpenTimeEntries: false).IsSuccess);
        }
        else if (status == ProjectStatus.Cancelled)
        {
            Assert.True(project.Activate().IsSuccess);
            Assert.True(project.Cancel().IsSuccess);
        }

        await using (var ctx = factory.CreateContext())
        {
            ctx.Clients.Add(client);
            ctx.Projects.Add(project);
            await ctx.SaveChangesAsync();
        }

        var taskId = await SeedTaskAsync(factory, project);
        await using var sut = CreateService(factory, client, userId);
        var result = await sut.CreateTimeEntryAsync(new UpsertProjectTimeEntryDto
        {
            ProjectId = project.Id,
            UserId = userId,
            WorkDate = new DateTime(2026, 8, 1),
            Hours = 4m,
            IsBillable = true,
            TaskId = taskId
        });

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task CreateTimeEntry_BlocksWhenTimesheetsDisabled()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedActiveProjectAsync(factory, timesheetsEnabled: false);
        var taskId = await SeedTaskAsync(factory, project);

        await using var sut = CreateService(factory, client, userId);
        var result = await sut.CreateTimeEntryAsync(new UpsertProjectTimeEntryDto
        {
            ProjectId = project.Id,
            UserId = userId,
            WorkDate = new DateTime(2026, 8, 1),
            Hours = 4m,
            IsBillable = true,
            TaskId = taskId
        });

        Assert.True(result.IsFailure);
        Assert.Contains("désactivée", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CreateTimeEntry_RequiresTask()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedActiveProjectAsync(factory);

        await using var sut = CreateService(factory, client, userId);
        var result = await sut.CreateTimeEntryAsync(new UpsertProjectTimeEntryDto
        {
            ProjectId = project.Id,
            UserId = userId,
            WorkDate = new DateTime(2026, 8, 1),
            Hours = 4m,
            IsBillable = true
        });

        Assert.True(result.IsFailure);
        Assert.Contains("tâche", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CreateTimeEntry_SucceedsOnActiveProjectWithTimesheetsEnabled()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedActiveProjectAsync(factory);
        var taskId = await SeedTaskAsync(factory, project);

        await using var sut = CreateService(factory, client, userId);
        var result = await sut.CreateTimeEntryAsync(new UpsertProjectTimeEntryDto
        {
            ProjectId = project.Id,
            UserId = userId,
            WorkDate = new DateTime(2026, 8, 1),
            Hours = 4m,
            IsBillable = true,
            TaskId = taskId
        });

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task ValidateTimeEntry_BlocksWhenTimesheetsDisabled()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedActiveProjectAsync(factory, timesheetsEnabled: false);
        var taskId = await SeedTaskAsync(factory, project);
        var entry = ProjectTimeEntry.Create(project.Id, userId, new DateTime(2026, 8, 1), 4m, true, null, taskId).Value;
        Assert.True(entry.Submit().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.ProjectTimeEntries.Add(entry);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client, userId);
        var result = await sut.ValidateTimeEntryAsync(entry.Id);

        Assert.True(result.IsFailure);
        Assert.Contains("désactivée", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ValidateTimeEntry_SucceedsOnOnHoldProject()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedActiveProjectAsync(factory);
        var taskId = await SeedTaskAsync(factory, project);
        var entry = ProjectTimeEntry.Create(project.Id, userId, new DateTime(2026, 8, 1), 4m, true, null, taskId).Value;
        Assert.True(entry.Submit().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            var tracked = await ctx.Projects.FirstAsync(p => p.Id == project.Id);
            Assert.True(tracked.Hold().IsSuccess);
            ctx.ProjectTimeEntries.Add(entry);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client, userId);
        var result = await sut.ValidateTimeEntryAsync(entry.Id);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task SubmitTimeEntry_SucceedsOnCompletedProject()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedCompletedProjectWithDraftTimeAsync(factory);
        Guid entryId;

        await using (var ctx = factory.CreateContext())
        {
            entryId = await ctx.ProjectTimeEntries.Where(e => e.ProjectId == project.Id).Select(e => e.Id).FirstAsync();
        }

        await using var sut = CreateService(factory, client, userId);
        var result = await sut.SubmitTimeEntryAsync(entryId);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task ValidateTimeEntry_SucceedsOnCompletedProject()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedCompletedProjectWithDraftTimeAsync(factory);
        Guid entryId;

        await using (var ctx = factory.CreateContext())
        {
            var entry = await ctx.ProjectTimeEntries.FirstAsync(e => e.ProjectId == project.Id);
            entryId = entry.Id;
            Assert.True(entry.Submit().IsSuccess);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client, userId);
        var result = await sut.ValidateTimeEntryAsync(entryId);

        Assert.True(result.IsSuccess);
    }

    private static async Task<(Project Project, Client Client, Guid UserId)> SeedCompletedProjectWithDraftTimeAsync(
        InMemoryTenantDbContextFactory factory)
    {
        var address = Address.Create("1 rue Test", "Tunis", "Tunis").Value;
        var email = Email.Create("client@example.com").Value;
        var client = Client.Create("Client test", ClientType.Individual, address, email).Value;
        var userId = Guid.NewGuid();

        var project = Project.Create(
            client.Id, "Mission", ProjectKind.Esn, ProjectBillingMode.TimeAndMaterials,
            null, null, null, 5000m, isBillable: true, timesheetsEnabled: true).Value;
        Assert.True(project.Activate().IsSuccess);
        Assert.True(project.Complete(hasOpenTimeEntries: false).IsSuccess);
        var phase = ProjectPhase.Create(project.Id, "Phase", 0).Value;
        var task = ProjectTask.Create(project.Id, phase.Id, "Tâche test", null, ProjectTaskPriority.Normal, null, null, null, 0m).Value;
        var entry = ProjectTimeEntry.Create(project.Id, userId, new DateTime(2026, 8, 1), 4m, true, null, task.Id).Value;

        await using (var ctx = factory.CreateContext())
        {
            ctx.Clients.Add(client);
            ctx.Projects.Add(project);
            ctx.ProjectPhases.Add(phase);
            ctx.ProjectTasks.Add(task);
            ctx.ProjectTimeEntries.Add(entry);
            await ctx.SaveChangesAsync();
        }

        return (project, client, userId);
    }

    [Fact]
    public async Task DeleteTimeEntry_AllowsDraftOnly()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedActiveProjectAsync(factory);
        var taskId = await SeedTaskAsync(factory, project);
        var draft = ProjectTimeEntry.Create(project.Id, userId, new DateTime(2026, 8, 1), 4m, true, null, taskId).Value;
        var submitted = ProjectTimeEntry.Create(project.Id, userId, new DateTime(2026, 8, 2), 2m, true, null, taskId).Value;
        Assert.True(submitted.Submit().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.ProjectTimeEntries.AddRange(draft, submitted);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client, userId);
        Assert.True((await sut.DeleteTimeEntryAsync(draft.Id)).IsSuccess);
        Assert.True((await sut.DeleteTimeEntryAsync(submitted.Id)).IsFailure);
    }

    [Fact]
    public async Task ValidateTimeEntry_UsesHourlyCostOnly_NotSalesRate()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedActiveProjectAsync(factory);
        var taskId = await SeedTaskAsync(factory, project);
        var member = ProjectMember.Create(project.Id, userId, ProjectMemberRole.Member, 320m, 100m, 40m).Value;
        var entry = ProjectTimeEntry.Create(project.Id, userId, new DateTime(2026, 8, 1), 2m, true, null, taskId).Value;
        Assert.True(entry.Submit().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.ProjectMembers.Add(member);
            ctx.ProjectTimeEntries.Add(entry);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client, userId);
        Assert.True((await sut.ValidateTimeEntryAsync(entry.Id)).IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            var costLine = await ctx.ProjectCostLines.FirstAsync(c => c.TimeEntryId == entry.Id);
            Assert.Equal(200m, costLine.AmountHt);
        }
    }

    [Fact]
    public async Task ValidateTimeEntry_NoCostLineWhenHourlyCostMissing()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedActiveProjectAsync(factory);
        var taskId = await SeedTaskAsync(factory, project);
        var member = ProjectMember.Create(project.Id, userId, ProjectMemberRole.Member, 320m, null, 40m).Value;
        var entry = ProjectTimeEntry.Create(project.Id, userId, new DateTime(2026, 8, 1), 2m, true, null, taskId).Value;
        Assert.True(entry.Submit().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.ProjectMembers.Add(member);
            ctx.ProjectTimeEntries.Add(entry);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client, userId);
        Assert.True((await sut.ValidateTimeEntryAsync(entry.Id)).IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            Assert.False(await ctx.ProjectCostLines.AnyAsync(c => c.TimeEntryId == entry.Id));
        }
    }

    [Fact]
    public async Task ReopenTimeEntry_RemovesCostLineWhenValidated()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedActiveProjectAsync(factory);
        var taskId = await SeedTaskAsync(factory, project);
        var member = ProjectMember.Create(project.Id, userId, ProjectMemberRole.Member, 640m, 80m, 40m).Value;
        var entry = ProjectTimeEntry.Create(project.Id, userId, new DateTime(2026, 8, 1), 4m, true, null, taskId).Value;
        Assert.True(entry.Submit().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.ProjectMembers.Add(member);
            ctx.ProjectTimeEntries.Add(entry);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client, userId);
        Assert.True((await sut.ValidateTimeEntryAsync(entry.Id)).IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            Assert.True(await ctx.ProjectCostLines.AnyAsync(c => c.TimeEntryId == entry.Id));
        }

        Assert.True((await sut.ReopenTimeEntryAsync(entry.Id)).IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            var reopened = await ctx.ProjectTimeEntries.FirstAsync(e => e.Id == entry.Id);
            Assert.Equal(ProjectTimeEntryStatus.Draft, reopened.Status);
            Assert.False(await ctx.ProjectCostLines.AnyAsync(c => c.TimeEntryId == entry.Id));
        }
    }

    [Fact]
    public async Task ReopenTimeEntry_BlocksInvoicedEntry()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedActiveProjectAsync(factory);
        var taskId = await SeedTaskAsync(factory, project);
        var entry = ProjectTimeEntry.Create(project.Id, userId, new DateTime(2026, 8, 1), 4m, true, null, taskId).Value;
        Assert.True(entry.Submit().IsSuccess);
        Assert.True(entry.Validate().IsSuccess);
        Assert.True(entry.MarkInvoiced(Guid.NewGuid()).IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.ProjectTimeEntries.Add(entry);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client, userId);
        var result = await sut.ReopenTimeEntryAsync(entry.Id);
        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task ReopenTimeEntry_RequiresSubmitPermissionForSubmitted()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedActiveProjectAsync(factory);
        var taskId = await SeedTaskAsync(factory, project);
        var entry = ProjectTimeEntry.Create(project.Id, userId, new DateTime(2026, 8, 1), 4m, true, null, taskId).Value;
        Assert.True(entry.Submit().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.ProjectTimeEntries.Add(entry);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client, userId, canSubmit: false, canValidate: true);
        Assert.True((await sut.ReopenTimeEntryAsync(entry.Id)).IsFailure);
    }

    [Fact]
    public async Task ReopenTimeEntry_RequiresValidatePermissionForValidated()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var (project, client, userId) = await SeedActiveProjectAsync(factory);
        var taskId = await SeedTaskAsync(factory, project);
        var entry = ProjectTimeEntry.Create(project.Id, userId, new DateTime(2026, 8, 1), 4m, true, null, taskId).Value;
        Assert.True(entry.Submit().IsSuccess);
        Assert.True(entry.Validate().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.ProjectTimeEntries.Add(entry);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client, userId, canSubmit: true, canValidate: false);
        Assert.True((await sut.ReopenTimeEntryAsync(entry.Id)).IsFailure);
    }
}
