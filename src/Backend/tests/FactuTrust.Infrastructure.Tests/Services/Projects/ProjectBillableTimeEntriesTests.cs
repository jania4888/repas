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

public sealed class ProjectBillableTimeEntriesTests
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

    private sealed record Fixture(Guid ProjectId, Guid Entry1Id, Guid Entry2Id, Guid TaskHourlyId, Client Client);

    private static ProjectService CreateService(InMemoryTenantDbContextFactory factory, Client client)
    {
        var masterOptions = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ITenantContext>();
        tenant.SetupGet(t => t.TenantId).Returns(tenantId);

        var clients = new Mock<IClientRepository>();
        clients.Setup(c => c.GetByIdAsync(client.Id, It.IsAny<CancellationToken>())).ReturnsAsync(client);

        var numbers = new Mock<IInvoiceNumberGenerator>();
        numbers.Setup(n => n.ReserveNextNumberAsync(tenantId, "FAC", It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(InvoiceNumber.Create("FAC", 2026, 100));

        return new ProjectService(
            factory,
            new MasterDbContext(masterOptions),
            clients.Object,
            Mock.Of<IPurchaseOrderRepository>(),
            Mock.Of<ISupplierRepository>(),
            Mock.Of<IProductRepository>(),
            numbers.Object,
            Mock.Of<ICurrentUser>(),
            tenant.Object,
            Mock.Of<IMediator>(),
            Mock.Of<IConfiguration>());
    }

    private static async Task<Fixture> SeedTwoEntriesAsync(InMemoryTenantDbContextFactory factory)
    {
        var address = Address.Create("1 rue Test", "Tunis", "Tunis").Value;
        var email = Email.Create("client@example.com").Value;
        var client = Client.Create("Client test", ClientType.Individual, address, email).Value;

        var project = Project.Create(client.Id, "Mission", ProjectKind.Esn, ProjectBillingMode.TimeAndMaterials, null, null, null, 5000m).Value;
        Assert.True(project.Activate().IsSuccess);

        var phase = ProjectPhase.Create(project.Id, "À faire", 0).Value;
        var taskHourly = ProjectTask.Create(project.Id, phase.Id, "Tâche horaire", null, ProjectTaskPriority.Normal, null, null, null, 8m).Value;
        var taskHourly2 = ProjectTask.Create(project.Id, phase.Id, "Tâche horaire 2", null, ProjectTaskPriority.Normal, null, null, null, 8m).Value;

        var aliceId = Guid.NewGuid();
        var bobId = Guid.NewGuid();
        var alice = ProjectMember.Create(project.Id, aliceId, ProjectMemberRole.Member, 640m, 80m, 40m).Value;
        var bob = ProjectMember.Create(project.Id, bobId, ProjectMemberRole.Member, 320m, 100m, 40m).Value;

        var entry1 = ProjectTimeEntry.Create(project.Id, aliceId, new DateTime(2026, 8, 1), 5m, true, null, taskHourly.Id).Value;
        Assert.True(entry1.Submit().IsSuccess);
        Assert.True(entry1.Validate().IsSuccess);

        var entry2 = ProjectTimeEntry.Create(project.Id, bobId, new DateTime(2026, 8, 2), 3m, true, null, taskHourly2.Id).Value;
        Assert.True(entry2.Submit().IsSuccess);
        Assert.True(entry2.Validate().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.Clients.Add(client);
            ctx.Projects.Add(project);
            ctx.ProjectPhases.Add(phase);
            ctx.ProjectTasks.AddRange(taskHourly, taskHourly2);
            ctx.ProjectMembers.AddRange(alice, bob);
            ctx.ProjectTimeEntries.AddRange(entry1, entry2);
            await ctx.SaveChangesAsync();
        }

        return new Fixture(project.Id, entry1.Id, entry2.Id, taskHourly.Id, client);
    }

    private static async Task<Guid> SeedDraftProjectInvoiceAsync(
        InMemoryTenantDbContextFactory factory,
        Guid projectId,
        Client client,
        int invoiceSequence)
    {
        await using var ctx = factory.CreateContext();
        var trackedClient = await ctx.Clients.FirstAsync(c => c.Id == client.Id);
        var issueDate = new DateTime(2026, 8, 1);
        var invoice = Invoice.Create(
            InvoiceNumber.Create("FAC", issueDate.Year, invoiceSequence),
            trackedClient,
            issueDate,
            issueDate.AddDays(30),
            "PRJ-test",
            "Brouillon projet").Value;
        Assert.True(invoice.AddCustomLine("Ligne initiale", null, 1m, "h", Money.Create(100m), VatRate.Standard).IsSuccess);

        var billing = ProjectBilling.Create(projectId, ProjectBillingKind.TimeAndMaterials, invoice.Id, 100m, null);
        Assert.True(billing.IsSuccess);
        invoice.SetProjectBillingSource(projectId, billing.Value.Id);

        ctx.Invoices.Add(invoice);
        ctx.ProjectBillings.Add(billing.Value);
        await ctx.SaveChangesAsync();
        return invoice.Id;
    }

    [Fact]
    public async Task GetBillableTimeEntries_NoValidatedTime_ReturnsEmpty()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var address = Address.Create("1 rue Test", "Tunis", "Tunis").Value;
        var email = Email.Create("client@example.com").Value;
        var client = Client.Create("Client test", ClientType.Individual, address, email).Value;
        var project = Project.Create(client.Id, "Mission", ProjectKind.Esn, ProjectBillingMode.TimeAndMaterials, null, null, null, 5000m).Value;
        Assert.True(project.Activate().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.Clients.Add(client);
            ctx.Projects.Add(project);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client);
        var items = await sut.GetBillableTimeEntriesAsync(project.Id);

        Assert.Empty(items);
    }

    [Fact]
    public async Task GetBillableTimeEntries_ReturnsEligibleEntriesWithPreview()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var fx = await SeedTwoEntriesAsync(factory);
        await using var sut = CreateService(factory, fx.Client);

        var items = await sut.GetBillableTimeEntriesAsync(fx.ProjectId);

        Assert.Equal(2, items.Count);
        var latest = items[0];
        Assert.Equal(fx.Entry2Id, latest.Id);
        Assert.True(latest.IsEligible);
        Assert.Equal(3m, latest.Hours);
        Assert.Equal(40m, latest.HourlyRate);
        Assert.Equal(120m, latest.PreviewAmountHt);
    }

    [Fact]
    public async Task GetBillableTimeEntries_WhenSalesRateAndCostBothSet_UsesSalesRateForClientBilling()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var address = Address.Create("1 rue Test", "Tunis", "Tunis").Value;
        var email = Email.Create("client@example.com").Value;
        var client = Client.Create("Client test", ClientType.Individual, address, email).Value;

        var project = Project.Create(client.Id, "Mission", ProjectKind.Esn, ProjectBillingMode.TimeAndMaterials, null, null, null, 5000m).Value;
        Assert.True(project.Activate().IsSuccess);

        var memberId = Guid.NewGuid();
        var member = ProjectMember.Create(project.Id, memberId, ProjectMemberRole.Member, 320m, 100m, 40m).Value;
        var entry = ProjectTimeEntry.Create(project.Id, memberId, new DateTime(2026, 8, 3), 2m, true, null, Guid.NewGuid()).Value;
        Assert.True(entry.Submit().IsSuccess);
        Assert.True(entry.Validate().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.Clients.Add(client);
            ctx.Projects.Add(project);
            ctx.ProjectMembers.Add(member);
            ctx.ProjectTimeEntries.Add(entry);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client);
        var items = await sut.GetBillableTimeEntriesAsync(project.Id);

        Assert.Single(items);
        Assert.Equal(40m, items[0].HourlyRate);
        Assert.Equal(80m, items[0].PreviewAmountHt);
    }

    [Fact]
    public async Task GetBillableTimeEntries_ExcludesInvoicedEntries()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var fx = await SeedTwoEntriesAsync(factory);

        await using (var ctx = factory.CreateContext())
        {
            var entry = await ctx.ProjectTimeEntries.FirstAsync(e => e.Id == fx.Entry1Id);
            entry.MarkInvoiced(Guid.NewGuid());
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, fx.Client);
        var items = await sut.GetBillableTimeEntriesAsync(fx.ProjectId);

        Assert.Single(items);
        Assert.Equal(fx.Entry2Id, items[0].Id);
    }

    [Fact]
    public async Task GetBillableTimeEntries_ExcludesNonBillableEntries()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var address = Address.Create("1 rue Test", "Tunis", "Tunis").Value;
        var email = Email.Create("client@example.com").Value;
        var client = Client.Create("Client test", ClientType.Individual, address, email).Value;

        var project = Project.Create(client.Id, "Mission", ProjectKind.Esn, ProjectBillingMode.TimeAndMaterials, null, null, null, 5000m).Value;
        Assert.True(project.Activate().IsSuccess);

        var memberId = Guid.NewGuid();
        var member = ProjectMember.Create(project.Id, memberId, ProjectMemberRole.Member, 640m, 80m, 40m).Value;
        var billable = ProjectTimeEntry.Create(project.Id, memberId, new DateTime(2026, 8, 1), 4m, true, null, Guid.NewGuid()).Value;
        var nonBillable = ProjectTimeEntry.Create(project.Id, memberId, new DateTime(2026, 8, 2), 2m, false, null, Guid.NewGuid()).Value;
        Assert.True(billable.Submit().IsSuccess);
        Assert.True(billable.Validate().IsSuccess);
        Assert.True(nonBillable.Submit().IsSuccess);
        Assert.True(nonBillable.Validate().IsSuccess);

        await using (var ctx = factory.CreateContext())
        {
            ctx.Clients.Add(client);
            ctx.Projects.Add(project);
            ctx.ProjectMembers.Add(member);
            ctx.ProjectTimeEntries.AddRange(billable, nonBillable);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, client);
        var items = await sut.GetBillableTimeEntriesAsync(project.Id);

        Assert.Single(items);
        Assert.Equal(billable.Id, items[0].Id);
    }

    [Fact]
    public async Task GetBillableTimeEntries_ExcludesEntriesOnForfaitInvoicedTask()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var fx = await SeedTwoEntriesAsync(factory);

        await using (var ctx = factory.CreateContext())
        {
            var task = await ctx.ProjectTasks.FirstAsync(t => t.Id == fx.TaskHourlyId);
            task.MarkInvoiced(Guid.NewGuid(), ProjectTaskBillingMethod.Fixed);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, fx.Client);
        var items = await sut.GetBillableTimeEntriesAsync(fx.ProjectId);

        Assert.Single(items);
        Assert.Equal(fx.Entry2Id, items[0].Id);
    }

    [Fact]
    public async Task GetBillableTimeEntries_MemberWithoutRate_IsIneligible()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var fx = await SeedTwoEntriesAsync(factory);

        await using (var ctx = factory.CreateContext())
        {
            var member = await ctx.ProjectMembers.FirstAsync();
            member.Update(ProjectMemberRole.Member, null, member.HourlyCost, member.WeeklyCapacityHours);
            await ctx.SaveChangesAsync();
        }

        await using var sut = CreateService(factory, fx.Client);
        var items = await sut.GetBillableTimeEntriesAsync(fx.ProjectId);

        Assert.Contains(items, i => !i.IsEligible && i.BlockReason != null);
    }

    [Fact]
    public async Task InvoiceTime_WithSelectedIds_OnlyMarksSelectedEntries()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var fx = await SeedTwoEntriesAsync(factory);
        await using var sut = CreateService(factory, fx.Client);

        var result = await sut.InvoiceTimeAsync(fx.ProjectId, new InvoiceTimeDto
        {
            GroupBy = "member",
            TimeEntryIds = new[] { fx.Entry1Id }
        });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : "");

        await using var verify = factory.CreateContext();
        var entry1 = await verify.ProjectTimeEntries.FirstAsync(e => e.Id == fx.Entry1Id);
        var entry2 = await verify.ProjectTimeEntries.FirstAsync(e => e.Id == fx.Entry2Id);
        Assert.NotNull(entry1.InvoicedInvoiceId);
        Assert.Null(entry2.InvoicedInvoiceId);
    }

    [Fact]
    public async Task InvoiceTime_WithInvalidId_Fails()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var fx = await SeedTwoEntriesAsync(factory);
        await using var sut = CreateService(factory, fx.Client);

        var result = await sut.InvoiceTimeAsync(fx.ProjectId, new InvoiceTimeDto
        {
            GroupBy = "member",
            TimeEntryIds = new[] { Guid.NewGuid() }
        });

        Assert.True(result.IsFailure);
        Assert.Contains("facturables", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task InvoiceTime_WithEmptyIds_LegacyInvoicesAllEligible()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var fx = await SeedTwoEntriesAsync(factory);
        await using var sut = CreateService(factory, fx.Client);

        var result = await sut.InvoiceTimeAsync(fx.ProjectId, new InvoiceTimeDto { GroupBy = "member" });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : "");

        await using var verify = factory.CreateContext();
        var entries = await verify.ProjectTimeEntries.Where(e => e.ProjectId == fx.ProjectId).ToListAsync();
        Assert.All(entries, e => Assert.NotNull(e.InvoicedInvoiceId));
    }

    [Fact]
    public async Task InvoiceTime_PartialMultiMember_CreatesMultipleInvoiceLines()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var fx = await SeedTwoEntriesAsync(factory);
        await using var sut = CreateService(factory, fx.Client);

        var result = await sut.InvoiceTimeAsync(fx.ProjectId, new InvoiceTimeDto
        {
            GroupBy = "member",
            TimeEntryIds = new[] { fx.Entry1Id, fx.Entry2Id }
        });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : "");

        await using var verify = factory.CreateContext();
        var invoice = await verify.Invoices.Include(i => i.Lines).FirstAsync(i => i.Id == result.Value.InvoiceId);
        Assert.Equal(2, invoice.Lines.Count);
    }

    [Fact]
    public async Task GetCompatibleDraftInvoices_ReturnsOnlyDraftSameClientProject()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var fx = await SeedTwoEntriesAsync(factory);
        await using var sut = CreateService(factory, fx.Client);

        var first = await sut.InvoiceTimeAsync(fx.ProjectId, new InvoiceTimeDto
        {
            GroupBy = "member",
            TimeEntryIds = new[] { fx.Entry1Id }
        });
        Assert.True(first.IsSuccess, first.IsFailure ? first.Error.Description : "");

        var drafts = await sut.GetCompatibleDraftInvoicesAsync(fx.ProjectId);
        Assert.Single(drafts);
        Assert.Equal(first.Value.InvoiceId, drafts[0].InvoiceId);

        await using var verify = factory.CreateContext();
        var status = await verify.Invoices.Where(i => i.Id == drafts[0].InvoiceId).Select(i => i.Status).FirstAsync();
        Assert.Equal(InvoiceStatus.Draft, status);
    }

    [Fact]
    public async Task InvoiceTime_WithTargetInvoiceId_AppendsToExisting_DoesNotCreateSecondInvoice()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var fx = await SeedTwoEntriesAsync(factory);
        await using var sut = CreateService(factory, fx.Client);

        var first = await sut.InvoiceTimeAsync(fx.ProjectId, new InvoiceTimeDto
        {
            GroupBy = "member",
            TimeEntryIds = new[] { fx.Entry1Id }
        });
        Assert.True(first.IsSuccess, first.IsFailure ? first.Error.Description : "");

        var second = await sut.InvoiceTimeAsync(fx.ProjectId, new InvoiceTimeDto
        {
            GroupBy = "member",
            TimeEntryIds = new[] { fx.Entry2Id },
            TargetInvoiceId = first.Value.InvoiceId
        });
        Assert.True(second.IsSuccess, second.IsFailure ? second.Error.Description : "");
        Assert.Equal(first.Value.InvoiceId, second.Value.InvoiceId);

        await using var verify = factory.CreateContext();
        var projectInvoices = await verify.Invoices
            .Where(i => i.SourceProjectId == fx.ProjectId && i.Type == InvoiceType.Standard)
            .ToListAsync();
        Assert.Single(projectInvoices);

        var invoice = await verify.Invoices.Include(i => i.Lines).FirstAsync(i => i.Id == first.Value.InvoiceId);
        Assert.Equal(2, invoice.Lines.Count);

        var entry2 = await verify.ProjectTimeEntries.FirstAsync(e => e.Id == fx.Entry2Id);
        Assert.Equal(first.Value.InvoiceId, entry2.InvoicedInvoiceId);
    }

    [Fact]
    public async Task InvoiceTime_WithTargetInvoiceId_WrongProject_Fails_NoMarking()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var fx = await SeedTwoEntriesAsync(factory);

        var otherProject = Project.Create(fx.Client.Id, "Autre mission", ProjectKind.Esn, ProjectBillingMode.TimeAndMaterials, null, null, null, 3000m).Value;
        Assert.True(otherProject.Activate().IsSuccess);
        await using (var ctx = factory.CreateContext())
        {
            ctx.Projects.Add(otherProject);
            await ctx.SaveChangesAsync();
        }

        var foreignDraftId = await SeedDraftProjectInvoiceAsync(factory, otherProject.Id, fx.Client, 200);
        await using var sut = CreateService(factory, fx.Client);

        var result = await sut.InvoiceTimeAsync(fx.ProjectId, new InvoiceTimeDto
        {
            GroupBy = "member",
            TimeEntryIds = new[] { fx.Entry2Id },
            TargetInvoiceId = foreignDraftId
        });

        Assert.True(result.IsFailure);
        Assert.Contains("projet", result.Error.Description, StringComparison.OrdinalIgnoreCase);

        await using var verify = factory.CreateContext();
        var entry2 = await verify.ProjectTimeEntries.FirstAsync(e => e.Id == fx.Entry2Id);
        Assert.Null(entry2.InvoicedInvoiceId);
    }

    [Fact]
    public async Task InvoiceTime_AlreadyInvoicedEntry_Fails()
    {
        var factory = new InMemoryTenantDbContextFactory(Guid.NewGuid().ToString());
        var fx = await SeedTwoEntriesAsync(factory);
        await using var sut = CreateService(factory, fx.Client);

        var first = await sut.InvoiceTimeAsync(fx.ProjectId, new InvoiceTimeDto
        {
            GroupBy = "member",
            TimeEntryIds = new[] { fx.Entry1Id }
        });
        Assert.True(first.IsSuccess, first.IsFailure ? first.Error.Description : "");

        var retry = await sut.InvoiceTimeAsync(fx.ProjectId, new InvoiceTimeDto
        {
            GroupBy = "member",
            TimeEntryIds = new[] { fx.Entry1Id },
            TargetInvoiceId = first.Value.InvoiceId
        });

        Assert.True(retry.IsFailure);
        Assert.Contains("facturables", retry.Error.Description, StringComparison.OrdinalIgnoreCase);
    }
}
