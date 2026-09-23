using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.FirmGovernance;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class FirmGovernanceServiceTests
{
    private static readonly Guid FirmId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid CompanyId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid AssignmentId = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid UserId = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static MasterDbContext BuildMaster()
    {
        var options = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new MasterDbContext(options);
    }

    /// <summary>
    /// Horloge figée au 21/07/2026 : les scénarios de temps utilisent des dates de juillet 2026,
    /// et les contrôles d'antériorité et de date future ne doivent pas dépendre du jour d'exécution.
    /// </summary>
    private sealed class FakeTimeProvider : TimeProvider
    {
        private readonly DateTimeOffset _utcNow;
        public FakeTimeProvider(DateTimeOffset utcNow) => _utcNow = utcNow;
        public override DateTimeOffset GetUtcNow() => _utcNow;
    }

    private static readonly DateTimeOffset FixedNow = new(2026, 7, 21, 10, 0, 0, TimeSpan.Zero);

    private static FirmGovernanceService BuildService(
        MasterDbContext db,
        ICompanyProfileSnapshotProvider? snapshotProvider = null,
        INotificationService? notifications = null)
    {
        var fiscalOps = new Mock<IFirmFiscalOpsAggregator>();
        fiscalOps
            .Setup(f => f.AggregateAsync(It.IsAny<IReadOnlyList<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new FirmFiscalOpsSummaryDto());

        var tenantService = new Mock<ITenantService>();
        var profileSnapshot = snapshotProvider ?? CreateDefaultSnapshotProvider();
        var userManager = CreateUserManagerMock(db);
        var dossierAccess = new FirmDossierAccessService(db);
        var currentUser = new Mock<ICurrentUser>();
        currentUser.SetupGet(u => u.IsAuthenticated).Returns(false);
        return new FirmGovernanceService(
            db,
            userManager.Object,
            tenantService.Object,
            fiscalOps.Object,
            profileSnapshot,
            dossierAccess,
            currentUser.Object,
            new FakeTimeProvider(FixedNow),
            NullLogger<FirmGovernanceService>.Instance,
            notifications ?? Mock.Of<INotificationService>());
    }

    private static Mock<UserManager<ApplicationUser>> CreateUserManagerMock(MasterDbContext db)
    {
        var store = new Mock<IUserStore<ApplicationUser>>();
        var mgr = new Mock<UserManager<ApplicationUser>>(
            store.Object, null!, null!, null!, null!, null!, null!, null!, null!);
        mgr.Setup(m => m.GetRolesAsync(It.IsAny<ApplicationUser>()))
            .ReturnsAsync((ApplicationUser u) =>
            {
                // Prefer FirmAccountant for seeded accountants; default Manager for others.
                if (u.Email?.Contains("accountant", StringComparison.OrdinalIgnoreCase) == true
                    || u.LastName?.Contains("Accountant", StringComparison.OrdinalIgnoreCase) == true)
                    return new List<string> { UserRole.FirmAccountant.ToString() };
                return new List<string> { UserRole.FirmManager.ToString() };
            });
        mgr.Setup(m => m.FindByEmailAsync(It.IsAny<string>()))
            .ReturnsAsync((string email) => db.Users.FirstOrDefault(u => u.Email == email));
        return mgr;
    }

    private static ICompanyProfileSnapshotProvider CreateDefaultSnapshotProvider()
    {
        var mock = new Mock<ICompanyProfileSnapshotProvider>();
        mock.Setup(p => p.TryDeserialize(It.IsAny<string?>())).Returns((string? json) =>
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            return new CompanyProfileSnapshotDto
            {
                SchemaVersion = 1,
                CapturedAtUtc = DateTime.UtcNow,
                CompanyName = "Ste Test",
                Nif = "1234567/A/B/C/000",
                TaxRegime = 0,
                Street = "12 rue Test",
                City = "Tunis",
                Governorate = "Tunis",
                Email = "test@example.com"
            };
        });
        mock.Setup(p => p.CaptureForCompanyTenantAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CompanyProfileSnapshotDto
            {
                SchemaVersion = 1,
                CapturedAtUtc = DateTime.UtcNow,
                CompanyName = "Ste Test",
                Nif = "1234567/A/B/C/000",
                TaxRegime = 0,
                Street = "12 rue Test",
                City = "Tunis",
                Governorate = "Tunis",
                Email = "test@example.com"
            });
        return mock.Object;
    }

    private static async Task AttachSnapshotAsync(MasterDbContext db, FirmClientAssignment assignment)
    {
        var snapshot = new CompanyProfileSnapshotDto
        {
            SchemaVersion = 1,
            CapturedAtUtc = DateTime.UtcNow,
            CompanyName = "Ste Test",
            Nif = "1234567/A/B/C/000",
            TaxRegime = 0,
            Street = "12 rue Test",
            City = "Tunis",
            Governorate = "Tunis",
            Email = "test@example.com"
        };
        assignment.AttachCompanyProfileSnapshot(
            System.Text.Json.JsonSerializer.Serialize(snapshot, new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase }),
            snapshot.CapturedAtUtc);
        await db.SaveChangesAsync();
    }

    private static async Task<FirmClientAssignment> SeedActiveAssignmentAsync(MasterDbContext db)
    {
        if (!await db.Tenants.AnyAsync(t => t.Id == CompanyId))
        {
            var nif = NIF.Create("1234567/A/B/C/000").Value;
            var address = Address.Create("1 rue Test", "Tunis", "Tunis").Value;
            var email = Email.Create("co@example.com").Value;
            var phone = PhoneNumber.Create("20123456").Value;
            var company = Tenant.Create("Ste Test", nif, address, email, phone, TaxRegime.RealRegime).Value;
            typeof(Tenant).GetProperty(nameof(Tenant.Id))!.SetValue(company, CompanyId);
            db.Tenants.Add(company);
            await db.SaveChangesAsync();
        }

        var assignment = FirmClientAssignment.Request(CompanyId, FirmId, UserId).Value;
        assignment.Accept(UserId);
        db.FirmClientAssignments.Add(assignment);
        await db.SaveChangesAsync();
        return assignment;
    }

    private static async Task<FirmExpenseNote> SeedDraftExpenseNoteAsync(MasterDbContext db, Guid assignmentId)
    {
        var note = FirmExpenseNote.Create(FirmId, assignmentId, "Ste Test", 2026, 7).Value;
        db.FirmExpenseNotes.Add(note);
        await db.SaveChangesAsync();
        return note;
    }

    [Fact]
    public async Task SubmitExpenseNote_transitions_draft_to_submitted()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var note = await SeedDraftExpenseNoteAsync(db, assignment.Id);
        var service = BuildService(db);

        var result = await service.SubmitExpenseNoteAsync(FirmId, note.Id);

        Assert.True(result.IsSuccess);
        var updated = await db.FirmExpenseNotes.SingleAsync(n => n.Id == note.Id);
        Assert.Equal(FirmExpenseNoteStatus.Submitted, updated.Status);
    }

    [Fact]
    public async Task ProcessExpenseNote_approve_fails_without_submit()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var note = await SeedDraftExpenseNoteAsync(db, assignment.Id);
        var service = BuildService(db);

        var result = await service.ProcessExpenseNoteAsync(FirmId, note.Id, approve: true);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task GetGovernanceDashboard_counts_submitted_expense_notes()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var note = await SeedDraftExpenseNoteAsync(db, assignment.Id);
        var service = BuildService(db);
        await service.SubmitExpenseNoteAsync(FirmId, note.Id);

        var dashboard = await service.GetGovernanceDashboardAsync(FirmId);

        Assert.Equal(1, dashboard.PendingExpenseNotesCount);
    }

    [Fact]
    public async Task MarkExpenseNoteReimbursed_succeeds_after_approval()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var note = await SeedDraftExpenseNoteAsync(db, assignment.Id);
        var service = BuildService(db);
        await service.SubmitExpenseNoteAsync(FirmId, note.Id);
        await service.ProcessExpenseNoteAsync(FirmId, note.Id, approve: true);

        var result = await service.MarkExpenseNoteReimbursedAsync(FirmId, note.Id);

        Assert.True(result.IsSuccess);
        var updated = await db.FirmExpenseNotes.SingleAsync(n => n.Id == note.Id);
        Assert.Equal(FirmExpenseNoteStatus.Reimbursed, updated.Status);
    }

    [Fact]
    public async Task UpsertPermanentFile_creates_on_first_put()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        var result = await service.UpsertPermanentFileAsync(
            FirmId,
            assignment.Id,
            new UpsertPermanentFileDto { WizardStep = 1, CompanyName = "Ste Test" },
            "test@example.com");

        Assert.True(result.IsSuccess);
        Assert.Equal(1, await db.PermanentFiles.CountAsync());
        Assert.Equal(PermanentFileStatus.InProgress, (await db.PermanentFiles.SingleAsync()).Status);
    }

    [Fact]
    public async Task UpsertPermanentFile_step6_without_nif_fails()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto { WizardStep = 1, CompanyName = "Ste Test", LegalForm = 0 },
            "test@example.com");

        var result = await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto
            {
                WizardStep = 6,
                LabCompleted = true,
                MissionAccepted = true,
                RequestCompletion = true,
                AssignedAccountantName = "Jean"
            },
            "test@example.com");

        Assert.True(result.IsFailure);
        Assert.NotEqual(PermanentFileStatus.Complete, (await db.PermanentFiles.SingleAsync()).Status);
    }

    [Fact]
    public async Task UpsertPermanentFile_step1_does_not_wipe_office_fields()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto
            {
                WizardStep = 3,
                Street = "12 rue Test",
                City = "Tunis",
                FiscalYearStartMonth = 1,
                FiscalYearEndMonth = 12
            },
            "test@example.com");

        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto
            {
                WizardStep = 1,
                CompanyName = "Ste Test",
                Nif = "1234567/A/B/C/000",
                LegalForm = 0
            },
            "test@example.com");

        var file = await db.PermanentFiles.SingleAsync();
        Assert.Equal("12 rue Test", file.Street);
        Assert.Equal("Tunis", file.City);
        Assert.Equal("1234567A/B/C/000", file.Nif);
    }

    [Fact]
    public async Task UpsertPermanentFile_step5_persists_billing_and_step1_does_not_wipe()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto
            {
                WizardStep = 5,
                AnnualFeeAmount = 1200m,
                BillingFrequency = 2,
                Currency = "TND",
                BillingNotes = "Forfait annuel"
            },
            "test@example.com");

        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto
            {
                WizardStep = 1,
                CompanyName = "Ste Test",
                Nif = "1234567/A/B/C/000",
                LegalForm = 0
            },
            "test@example.com");

        var file = await db.PermanentFiles.SingleAsync();
        Assert.Equal(1200m, file.AnnualFeeAmount);
        Assert.Equal(BillingFrequency.Annual, file.BillingFrequency);
        Assert.Equal("Forfait annuel", file.BillingNotes);
        Assert.Equal("TND", file.Currency);
    }

    [Fact]
    public async Task UpdateRepresentative_changes_email_and_deactivate_then_update_fails()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto { WizardStep = 1, CompanyName = "Ste Test" },
            "test@example.com");

        var created = await service.AddRepresentativeAsync(
            FirmId, assignment.Id,
            new LegalRepresentativeDto
            {
                LastName = "Hadad",
                FirstName = "Ali",
                Role = "Gérant",
                Email = "old@example.com"
            });
        Assert.True(created.IsSuccess);

        var updated = await service.UpdateRepresentativeAsync(
            FirmId, assignment.Id, created.Value.Id,
            new LegalRepresentativeDto
            {
                LastName = "Hadad",
                FirstName = "Ali",
                Role = "Gérant",
                Email = "new@example.com"
            });
        Assert.True(updated.IsSuccess);
        Assert.Equal("new@example.com", updated.Value.Email);

        await service.DeactivateRepresentativeAsync(FirmId, assignment.Id, created.Value.Id);
        var afterDeactivate = await service.UpdateRepresentativeAsync(
            FirmId, assignment.Id, created.Value.Id,
            new LegalRepresentativeDto
            {
                LastName = "Hadad",
                FirstName = "Ali",
                Role = "Gérant",
                Email = "again@example.com"
            });
        Assert.True(afterDeactivate.IsFailure);
    }

    [Fact]
    public async Task ArchivePermanentFile_sets_archived_status()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto { WizardStep = 1, CompanyName = "Ste Test" },
            "test@example.com");

        var result = await service.ArchivePermanentFileAsync(FirmId, assignment.Id, "test@example.com");
        Assert.True(result.IsSuccess);
        Assert.Equal(PermanentFileStatus.Archived, (await db.PermanentFiles.SingleAsync()).Status);
    }

    private static async Task SeedCompletePermanentFileAsync(MasterDbContext db, Guid assignmentId)
    {
        var service = BuildService(db);
        await service.UpsertPermanentFileAsync(
            FirmId, assignmentId,
            new UpsertPermanentFileDto
            {
                WizardStep = 1,
                CompanyName = "Ste Test",
                Nif = "1234567/A/B/C/000",
                LegalForm = 0
            },
            "test@example.com");
        await service.AddRepresentativeAsync(
            FirmId, assignmentId,
            new LegalRepresentativeDto { LastName = "Dupont", FirstName = "Jean", Role = "Gérant" });
        await service.UpsertPermanentFileAsync(
            FirmId, assignmentId,
            new UpsertPermanentFileDto
            {
                WizardStep = 6,
                LabCompleted = true,
                MissionAccepted = true,
                RequestCompletion = true
            },
            "test@example.com");
    }

    [Fact]
    public async Task Upsert_on_archived_fails()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto { WizardStep = 1, CompanyName = "Ste Test" },
            "test@example.com");
        await service.ArchivePermanentFileAsync(FirmId, assignment.Id, "test@example.com");

        var result = await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto { WizardStep = 1, CompanyName = "Ste Modifiée" },
            "test@example.com");

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task SyncPermanentFile_fails_when_not_complete()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto { WizardStep = 1, CompanyName = "Ste Test" },
            "test@example.com");

        var result = await service.SyncPermanentFileToTenantAsync(FirmId, assignment.Id, "test@example.com");

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task DeactivateRepresentative_reopens_complete_when_last()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await SeedCompletePermanentFileAsync(db, assignment.Id);

        var rep = await db.LegalRepresentatives.SingleAsync();
        var deactivate = await service.DeactivateRepresentativeAsync(FirmId, assignment.Id, rep.Id);
        Assert.True(deactivate.IsSuccess);

        var file = await db.PermanentFiles.SingleAsync();
        Assert.Equal(PermanentFileStatus.InProgress, file.Status);
    }

    [Fact]
    public async Task UpsertPermanentFile_step1_does_not_wipe_resignation()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto
            {
                WizardStep = 4,
                LabCompleted = true,
                MissionAccepted = true,
                MissionResigned = true,
                ResignationFiscalYear = 2025,
                ResignationNotes = "Client parti"
            },
            "test@example.com");

        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto
            {
                WizardStep = 1,
                CompanyName = "Ste Test",
                Nif = "1234567/A/B/C/000",
                LegalForm = 0
            },
            "test@example.com");

        var file = await db.PermanentFiles.SingleAsync();
        Assert.True(file.MissionResigned);
        Assert.Equal(2025, file.ResignationFiscalYear);
        Assert.Equal("Client parti", file.ResignationNotes);
    }

    [Fact]
    public async Task UpsertPermanentFile_requestCompletion_marks_complete_when_valid()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await SeedCompletePermanentFileAsync(db, assignment.Id);

        var file = await db.PermanentFiles.SingleAsync();
        Assert.Equal(PermanentFileStatus.Complete, file.Status);
    }

    [Fact]
    public async Task ListPermanentFiles_includes_quality_fields()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto
            {
                WizardStep = 1,
                CompanyName = "Ste Test",
                Nif = "1234567/A/B/C/000",
                LegalForm = 0
            },
            "test@example.com");

        var list = await service.ListPermanentFilesAsync(FirmId);
        var row = Assert.Single(list);
        Assert.True(row.NextRecommendedStep.HasValue);
        Assert.NotNull(row.NextActionLabel);
        Assert.True(row.CompletionPercent >= 0);
    }

    [Fact]
    public async Task ListPermanentFiles_maps_mission_date_fields()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto
            {
                WizardStep = 4,
                LabCompleted = true,
                MissionAccepted = true
            },
            "test@example.com");

        var list = await service.ListPermanentFilesAsync(FirmId);
        var row = Assert.Single(list);
        Assert.NotNull(row.LabCompletedAt);
        Assert.NotNull(row.MissionAcceptedAt);
    }

    [Fact]
    public async Task UpsertPermanentFile_minimal_init_preserves_nif_from_snapshot()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        await AttachSnapshotAsync(db, assignment);
        var service = BuildService(db);

        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto { WizardStep = 1, CompanyName = "Ste Test" },
            "test@example.com");

        var file = await db.PermanentFiles.SingleAsync();
        Assert.Equal("1234567A/B/C/000", file.Nif);
        Assert.Equal(TaxRegime.RealRegime, file.TaxRegime);
    }

    [Fact]
    public async Task UpsertPermanentFile_minimal_init_prefills_address()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        await AttachSnapshotAsync(db, assignment);
        var service = BuildService(db);

        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto { WizardStep = 1, CompanyName = "Ste Test" },
            "test@example.com");

        var file = await db.PermanentFiles.SingleAsync();
        Assert.Equal("12 rue Test", file.Street);
        Assert.Equal("Tunis", file.City);
    }

    [Fact]
    public async Task UpsertPermanentFile_step1_minimal_does_not_wipe_nif_after_snapshot_init()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        await AttachSnapshotAsync(db, assignment);
        var service = BuildService(db);

        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto { WizardStep = 1, CompanyName = "Ste Test" },
            "test@example.com");

        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto { WizardStep = 1, CompanyName = "Ste Test Renommée" },
            "test@example.com");

        var file = await db.PermanentFiles.SingleAsync();
        Assert.Equal("Ste Test Renommée", file.CompanyName);
        Assert.Equal("1234567A/B/C/000", file.Nif);
    }

    [Fact]
    public async Task UpsertPermanentFile_legacy_assignment_without_snapshot_uses_live_tenant()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);

        var snapshotProvider = new Mock<ICompanyProfileSnapshotProvider>();
        snapshotProvider.Setup(p => p.TryDeserialize(It.IsAny<string?>())).Returns((CompanyProfileSnapshotDto?)null);
        snapshotProvider
            .Setup(p => p.CaptureForCompanyTenantAsync(CompanyId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CompanyProfileSnapshotDto
            {
                SchemaVersion = 1,
                CapturedAtUtc = DateTime.UtcNow,
                CompanyName = "Legacy Co",
                Nif = "7654321/A/B/C/000",
                TaxRegime = 1,
                Street = "Legacy street",
                City = "Sfax",
                Governorate = "Sfax",
                Email = "legacy@example.com"
            });

        var service = BuildService(db, snapshotProvider.Object);

        await service.UpsertPermanentFileAsync(
            FirmId, assignment.Id,
            new UpsertPermanentFileDto { WizardStep = 1, CompanyName = "Legacy Co" },
            "test@example.com");

        var file = await db.PermanentFiles.SingleAsync();
        Assert.Equal("7654321A/B/C/000", file.Nif);
        Assert.Equal("Legacy street", file.Street);
    }

    private static async Task<ApplicationUser> SeedAccountantAsync(MasterDbContext db)
    {
        var accountantId = Guid.Parse("55555555-5555-5555-5555-555555555555");
        var user = new ApplicationUser
        {
            Id = accountantId,
            UserName = "accountant@test.tn",
            Email = "accountant@test.tn",
            FirstName = "Ali",
            LastName = "Accountant",
            TenantId = FirmId,
            IsActive = true,
            EmailConfirmed = true
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    [Fact]
    public async Task AssignDossierManager_accepts_firm_accountant_and_writes_history()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var accountant = await SeedAccountantAsync(db);
        var service = BuildService(db);

        var result = await service.AssignDossierManagerAsync(
            FirmId, UserId,
            new AssignDossierManagerDto { AssignmentId = assignment.Id, AccountantUserId = accountant.Id });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : "");
        var file = await db.PermanentFiles.SingleAsync();
        Assert.Equal(accountant.Id, file.AssignedAccountantUserId);
        Assert.Equal("Ali Accountant", file.AssignedAccountantName);
        Assert.Equal(1, await db.FirmDossierAssignmentHistories.CountAsync(h => h.EndedAt == null));
    }

    [Fact]
    public async Task AssignDossierManager_rejects_firm_manager_as_target()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        db.Users.Add(new ApplicationUser
        {
            Id = Guid.Parse("66666666-6666-6666-6666-666666666666"),
            UserName = "manager@test.tn",
            Email = "manager@test.tn",
            FirstName = "Mgr",
            LastName = "Boss",
            TenantId = FirmId,
            IsActive = true
        });
        await db.SaveChangesAsync();
        var service = BuildService(db);

        var result = await service.AssignDossierManagerAsync(
            FirmId, UserId,
            new AssignDossierManagerDto
            {
                AssignmentId = assignment.Id,
                AccountantUserId = Guid.Parse("66666666-6666-6666-6666-666666666666")
            });

        Assert.True(result.IsFailure);
        Assert.Contains("comptables", result.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task AssignDossierManager_rejects_cross_tenant_user()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        db.Users.Add(new ApplicationUser
        {
            Id = Guid.Parse("77777777-7777-7777-7777-777777777777"),
            UserName = "accountant@other.tn",
            Email = "accountant@other.tn",
            FirstName = "Other",
            LastName = "Accountant",
            TenantId = Guid.NewGuid(),
            IsActive = true
        });
        await db.SaveChangesAsync();
        var service = BuildService(db);

        var result = await service.AssignDossierManagerAsync(
            FirmId, UserId,
            new AssignDossierManagerDto
            {
                AssignmentId = assignment.Id,
                AccountantUserId = Guid.Parse("77777777-7777-7777-7777-777777777777")
            });

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task AssignDossierManager_clear_and_idempotent()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var accountant = await SeedAccountantAsync(db);
        var service = BuildService(db);

        await service.AssignDossierManagerAsync(
            FirmId, UserId,
            new AssignDossierManagerDto { AssignmentId = assignment.Id, AccountantUserId = accountant.Id });

        var again = await service.AssignDossierManagerAsync(
            FirmId, UserId,
            new AssignDossierManagerDto { AssignmentId = assignment.Id, AccountantUserId = accountant.Id });
        Assert.True(again.IsSuccess);
        Assert.Equal(1, await db.FirmDossierAssignmentHistories.CountAsync());

        var clear = await service.AssignDossierManagerAsync(
            FirmId, UserId,
            new AssignDossierManagerDto { AssignmentId = assignment.Id, AccountantUserId = null });
        Assert.True(clear.IsSuccess);
        Assert.Null((await db.PermanentFiles.SingleAsync()).AssignedAccountantUserId);
        Assert.Equal(0, await db.FirmDossierAssignmentHistories.CountAsync(h => h.EndedAt == null));
    }

    [Fact]
    public async Task ListDossierAssignments_filter_awaiting()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        var awaiting = await service.ListDossierAssignmentsAsync(FirmId, assignmentFilter: 1, name: null);
        Assert.Single(awaiting);
        Assert.True(awaiting[0].IsAwaitingAccountantAssignment);

        var accountant = await SeedAccountantAsync(db);
        await service.AssignDossierManagerAsync(
            FirmId, UserId,
            new AssignDossierManagerDto { AssignmentId = assignment.Id, AccountantUserId = accountant.Id });

        Assert.Empty(await service.ListDossierAssignmentsAsync(FirmId, 1, null));
        Assert.Single(await service.ListDossierAssignmentsAsync(FirmId, 2, null));
    }

    [Fact]
    public async Task AssignDossierManagerBulk_reports_partial_failures()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var accountant = await SeedAccountantAsync(db);
        var service = BuildService(db);
        var missingId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

        var result = await service.AssignDossierManagerBulkAsync(
            FirmId, UserId,
            new AssignDossierManagerBulkDto
            {
                AssignmentIds = new[] { assignment.Id, missingId },
                AccountantUserId = accountant.Id
            });

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.Succeeded);
        Assert.Single(result.Value.Failed);
        Assert.Equal(missingId, result.Value.Failed[0].AssignmentId);
        Assert.Equal(accountant.Id, (await db.PermanentFiles.SingleAsync()).AssignedAccountantUserId);
    }

    [Fact]
    public async Task TimeSheet_create_update_validate_delete_flow()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        var created = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new CreateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 15),
                Hours = 4m,
                FirmClientAssignmentId = assignment.Id,
                ActivityCode = "COMPTA",
                IsBillable = true
            });
        Assert.True(created.IsSuccess);
        Assert.False(created.Value.IsValidated);

        var listed = await service.ListTimeSheetsAsync(FirmId, 2026, 7, UserId, assignment.Id);
        Assert.Single(listed);

        var updated = await service.UpdateTimeSheetAsync(
            FirmId, UserId, isManager: true, created.Value.Id,
            new UpdateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 16),
                Hours = 5m,
                FirmClientAssignmentId = assignment.Id,
                ActivityCode = "REVUE",
                IsBillable = true
            });
        Assert.True(updated.IsSuccess);
        Assert.Equal(5m, updated.Value.Hours);

        var submitted = await service.SubmitTimeSheetAsync(FirmId, UserId, isManager: true, created.Value.Id);
        Assert.True(submitted.IsSuccess);

        var validated = await service.ValidateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, created.Value.Id);
        Assert.True(validated.IsSuccess);
        Assert.True(validated.Value.IsValidated);
        Assert.Equal("Manager Test", validated.Value.ValidatedByDisplayName);
        Assert.NotNull(validated.Value.ValidatedAt);

        var blocked = await service.UpdateTimeSheetAsync(
            FirmId, UserId, isManager: true, created.Value.Id,
            new UpdateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 16),
                Hours = 6m,
                FirmClientAssignmentId = assignment.Id,
                IsBillable = true
            });
        Assert.True(blocked.IsFailure);

        // Une ligne validée ne se supprime plus directement : il faut la dévalider, ce qui laisse une trace.
        var deleteRefused = await service.DeleteTimeSheetAsync(FirmId, UserId, isManager: true, created.Value.Id);
        Assert.True(deleteRefused.IsFailure);

        var unvalidated = await service.UnvalidateTimeSheetAsync(FirmId, isManager: true, created.Value.Id);
        Assert.True(unvalidated.IsSuccess);
        Assert.False(unvalidated.Value.IsValidated);
        Assert.Null(unvalidated.Value.ValidatedAt);

        var deleted = await service.DeleteTimeSheetAsync(FirmId, UserId, isManager: true, created.Value.Id);
        Assert.True(deleted.IsSuccess);
        Assert.Empty(await service.ListTimeSheetsAsync(FirmId, 2026, 7));
    }

    [Fact]
    public async Task TimeSheet_accountant_cannot_validate_or_edit_others()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var accountant = await SeedAccountantAsync(db);
        var service = BuildService(db);

        var created = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new CreateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 10),
                Hours = 2m,
                FirmClientAssignmentId = assignment.Id,
                IsBillable = true
            });
        Assert.True(created.IsSuccess);

        var forbiddenValidate = await service.ValidateTimeSheetAsync(
            FirmId, accountant.Id, "Comptable Test", isManager: false, created.Value.Id);
        Assert.True(forbiddenValidate.IsFailure);

        var forbiddenUpdate = await service.UpdateTimeSheetAsync(
            FirmId, accountant.Id, isManager: false, created.Value.Id,
            new UpdateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 10),
                Hours = 3m,
                FirmClientAssignmentId = assignment.Id,
                IsBillable = true
            });
        Assert.True(forbiddenUpdate.IsFailure);
    }

    // ============================================
    // CONTRÔLES LÉGAUX DE SAISIE
    // ============================================

    private static CreateTimeSheetEntryDto Entry(DateTime date, decimal hours, Guid? assignmentId = null) => new()
    {
        WorkDate = date,
        Hours = hours,
        FirmClientAssignmentId = assignmentId,
        IsBillable = true
    };

    [Fact]
    public async Task TimeSheet_refuses_a_daily_total_above_the_cap()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        var first = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 20), 8m, assignment.Id));
        Assert.True(first.IsSuccess);

        // 8 h + 3 h = 11 h sur la journée, au-delà du plafond de 10 h.
        var second = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 20), 3m, assignment.Id));

        Assert.True(second.IsFailure);
        Assert.Contains("plafond journalier", second.Error.Description);
    }

    [Fact]
    public async Task TimeSheet_refuses_a_future_date()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        // Horloge figée au 21/07/2026 : le 22 est dans le futur.
        var result = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 22), 2m, assignment.Id));

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task TimeSheet_refuses_a_date_beyond_the_backdating_window()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        // Fenêtre de 45 jours à compter du 21/07/2026 : janvier est hors limite.
        var result = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 1, 15), 2m, assignment.Id));

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task TimeSheet_weekly_cap_spans_two_months()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        // Semaine ISO du lundi 29/06 au dimanche 05/07 : le cumul doit traverser le changement de mois.
        foreach (var day in new[] { 29, 30 })
        {
            var seeded = await service.CreateTimeSheetAsync(
                FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 6, day), 10m, assignment.Id));
            Assert.True(seeded.IsSuccess);
        }
        foreach (var day in new[] { 1, 2, 3 })
        {
            var seeded = await service.CreateTimeSheetAsync(
                FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, day), 9m, assignment.Id));
            Assert.True(seeded.IsSuccess);
        }

        // 20 h en juin + 27 h en juillet = 47 h ; une ligne de 2 h porterait la semaine à 49 h.
        var overflow = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 4), 2m, assignment.Id));

        Assert.True(overflow.IsFailure);
        Assert.Contains("semaine", overflow.Error.Description);
    }

    [Fact]
    public async Task TimeSheet_limits_only_warn_when_enforcement_is_disabled()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        var relaxed = await service.SaveTimeSheetYearSettingsAsync(FirmId, 2026, new SaveFirmTimeSheetYearSettingsDto
        {
            WeeklyRegime = (int)WeeklyWorkRegime.FortyEightHours,
            MaxDailyHours = 10m,
            MaxWeeklyHours = 48m,
            AllowFutureEntryDays = 0,
            MaxBackdatingDays = 45,
            EnforceHardLimits = false,
            PaidLeaveDaysPerYear = 12m,
            PublicHolidayDaysPerYear = 12m,
            ProductivityRatePercent = 80m,
            CnssEmployerRate = 16.57m,
            TfpRate = 2m,
            FoprolosRate = 1m,
            WorkAccidentRate = 0m
        });
        Assert.True(relaxed.IsSuccess);

        await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 20), 8m, assignment.Id));

        var overflow = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 20), 5m, assignment.Id));

        // La saisie passe, mais l'anomalie est restituée à l'utilisateur.
        Assert.True(overflow.IsSuccess);
        Assert.NotEmpty(overflow.Value.Warnings);
    }

    // ============================================
    // CLÔTURE MENSUELLE
    // ============================================

    [Fact]
    public async Task Locked_period_refuses_every_write()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        var existing = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 10), 4m, assignment.Id));
        Assert.True(existing.IsSuccess);

        var locked = await service.LockTimeSheetPeriodAsync(
            FirmId, UserId, "Manager Test", isManager: true, 2026, 7, "Clôture mensuelle");
        Assert.True(locked.IsSuccess);
        Assert.True(locked.Value.IsLocked);

        var created = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 15), 2m, assignment.Id));
        Assert.True(created.IsFailure);

        var updated = await service.UpdateTimeSheetAsync(
            FirmId, UserId, isManager: true, existing.Value.Id,
            new UpdateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 10),
                Hours = 6m,
                FirmClientAssignmentId = assignment.Id,
                IsBillable = true
            });
        Assert.True(updated.IsFailure);

        var deleted = await service.DeleteTimeSheetAsync(FirmId, UserId, isManager: true, existing.Value.Id);
        Assert.True(deleted.IsFailure);

        var validated = await service.ValidateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, existing.Value.Id);
        Assert.True(validated.IsFailure);
    }

    [Fact]
    public async Task Unlocking_a_period_requires_a_reason_and_restores_writes()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        await service.LockTimeSheetPeriodAsync(FirmId, UserId, "Manager Test", isManager: true, 2026, 7, null);

        var withoutReason = await service.UnlockTimeSheetPeriodAsync(
            FirmId, UserId, "Manager Test", isManager: true, 2026, 7, "   ");
        Assert.True(withoutReason.IsFailure);

        var unlocked = await service.UnlockTimeSheetPeriodAsync(
            FirmId, UserId, "Manager Test", isManager: true, 2026, 7, "Régularisation d'une omission");
        Assert.True(unlocked.IsSuccess);
        Assert.False(unlocked.Value.IsLocked);
        Assert.Equal("Régularisation d'une omission", unlocked.Value.UnlockReason);
        Assert.Equal("Manager Test", unlocked.Value.UnlockedByDisplayName);

        var created = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 15), 2m, assignment.Id));
        Assert.True(created.IsSuccess);
    }

    [Fact]
    public async Task An_accountant_cannot_lock_a_period()
    {
        await using var db = BuildMaster();
        var accountant = await SeedAccountantAsync(db);
        var service = BuildService(db);

        var result = await service.LockTimeSheetPeriodAsync(
            FirmId, accountant.Id, "Comptable Test", isManager: false, 2026, 7, null);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Periods_of_a_year_are_all_returned_even_when_never_locked()
    {
        await using var db = BuildMaster();
        var service = BuildService(db);

        await service.LockTimeSheetPeriodAsync(FirmId, UserId, "Manager Test", isManager: true, 2026, 3, null);

        var periods = await service.ListTimeSheetPeriodsAsync(FirmId, 2026);

        Assert.Equal(12, periods.Count);
        Assert.True(periods.Single(p => p.Month == 3).IsLocked);
        Assert.False(periods.Single(p => p.Month == 4).IsLocked);
    }

    // ============================================
    // VALIDATION EN LOT
    // ============================================

    [Fact]
    public async Task Bulk_validation_reports_what_it_could_not_validate()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        var first = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 10), 3m, assignment.Id));
        var second = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 11), 3m, assignment.Id));

        await service.SubmitTimeSheetAsync(FirmId, UserId, isManager: true, first.Value.Id);
        await service.SubmitTimeSheetAsync(FirmId, UserId, isManager: true, second.Value.Id);
        // La seconde est déjà validée ; un identifiant inconnu complète le lot.
        await service.ValidateTimeSheetAsync(FirmId, UserId, "Manager Test", isManager: true, second.Value.Id);
        var unknownId = Guid.NewGuid();

        var result = await service.ValidateTimeSheetsBulkAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new[] { first.Value.Id, second.Value.Id, unknownId });

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.Validated);
        Assert.Equal(2, result.Value.Skipped);
        Assert.Contains(result.Value.Failures, f => f.EntryId == unknownId);
    }

    [Fact]
    public async Task Bulk_validate_skips_draft_entries()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        var draft = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 12), 2m, assignment.Id));
        Assert.True(draft.IsSuccess);

        var result = await service.ValidateTimeSheetsBulkAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new[] { draft.Value.Id });

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.Validated);
        Assert.Equal(1, result.Value.Skipped);
        Assert.Contains(result.Value.Failures, f =>
            f.EntryId == draft.Value.Id &&
            f.Error.Contains("soumises", StringComparison.OrdinalIgnoreCase));
    }

    // ============================================
    // RÉFÉRENTIEL DES CODES ACTIVITÉ
    // ============================================

    [Fact]
    public async Task Activity_codes_are_not_enforced_while_the_catalog_is_empty()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        // Sans référentiel, imposer une appartenance bloquerait toute saisie.
        var created = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new CreateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 10),
                Hours = 2m,
                FirmClientAssignmentId = assignment.Id,
                ActivityCode = "N-IMPORTE-QUOI",
                IsBillable = true
            });

        Assert.True(created.IsSuccess);
    }

    [Fact]
    public async Task Activity_code_outside_the_catalog_is_refused_once_seeded()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await service.SeedDefaultActivityCodesAsync(FirmId);

        var refused = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new CreateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 10),
                Hours = 2m,
                FirmClientAssignmentId = assignment.Id,
                ActivityCode = "INCONNU",
                IsBillable = true
            });
        Assert.True(refused.IsFailure);

        // La casse ne doit pas faire échouer une saisie valide.
        var accepted = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new CreateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 10),
                Hours = 2m,
                FirmClientAssignmentId = assignment.Id,
                ActivityCode = "tenue",
                IsBillable = true
            });
        Assert.True(accepted.IsSuccess);
    }

    [Fact]
    public async Task An_empty_activity_code_stays_allowed()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await service.SeedDefaultActivityCodesAsync(FirmId);

        var created = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new CreateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 10),
                Hours = 2m,
                FirmClientAssignmentId = assignment.Id,
                ActivityCode = null,
                IsBillable = true
            });

        Assert.True(created.IsSuccess);
    }

    [Fact]
    public async Task Create_with_start_end_derives_hours_and_maps_status()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        var created = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new CreateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 15),
                Hours = 0,
                StartTime = "09:00",
                EndTime = "12:30",
                FirmClientAssignmentId = assignment.Id,
                IsBillable = true
            });

        Assert.True(created.IsSuccess);
        Assert.Equal(3.5m, created.Value.Hours);
        Assert.Equal("09:00", created.Value.StartTime);
        Assert.Equal("12:30", created.Value.EndTime);
        Assert.Equal(0, created.Value.Status);
        Assert.Equal("Brouillon", created.Value.StatusDisplay);
    }

    [Fact]
    public async Task Submit_then_validate_advances_status()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        var created = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            Entry(new DateTime(2026, 7, 16), 2m, assignment.Id));
        Assert.True(created.IsSuccess);

        var submitted = await service.SubmitTimeSheetAsync(FirmId, UserId, isManager: true, created.Value.Id);
        Assert.True(submitted.IsSuccess);
        Assert.Equal(1, submitted.Value.Status);
        Assert.False(submitted.Value.IsValidated);

        var validated = await service.ValidateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, created.Value.Id);
        Assert.True(validated.IsSuccess);
        Assert.Equal(2, validated.Value.Status);
        Assert.True(validated.Value.IsValidated);
    }

    [Fact]
    public async Task Timer_start_and_stop_materialize_entry()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        var started = await service.StartTimeSheetTimerAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new StartTimeSheetTimerDto
            {
                WorkDate = new DateTime(2026, 7, 17),
                FirmClientAssignmentId = assignment.Id,
                IsBillable = true
            });
        Assert.True(started.IsSuccess);
        Assert.NotNull(started.Value.TimerStartedAtUtc);

        // Simule une durée minimale en forçant le stop immédiat (domaine floor à 0.25h).
        var stopped = await service.StopTimeSheetTimerAsync(
            FirmId, UserId, isManager: true, new StopTimeSheetTimerDto { EntryId = started.Value.Id });
        Assert.True(stopped.IsSuccess);
        Assert.Null(stopped.Value.TimerStartedAtUtc);
        Assert.True(stopped.Value.Hours >= 0.25m);
        Assert.NotNull(stopped.Value.StartTime);
        Assert.NotNull(stopped.Value.EndTime);
    }

    [Fact]
    public async Task Duplicate_week_creates_drafts_on_target_week()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);

        // Lundi 13/07/2026
        var sourceMonday = new DateTime(2026, 7, 13);
        await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            Entry(sourceMonday, 2m, assignment.Id));
        await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            Entry(sourceMonday.AddDays(1), 3m, assignment.Id));

        var duplicated = await service.DuplicateTimeSheetWeekAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new DuplicateTimeSheetWeekDto
            {
                SourceWeekStart = sourceMonday,
                TargetWeekStart = sourceMonday.AddDays(7)
            });

        Assert.True(duplicated.IsSuccess);
        Assert.Equal(2, duplicated.Value.Count);
        Assert.All(duplicated.Value, e => Assert.Equal(0, e.Status));
        Assert.Contains(duplicated.Value, e => e.WorkDate.Date == sourceMonday.AddDays(7));
        Assert.Contains(duplicated.Value, e => e.WorkDate.Date == sourceMonday.AddDays(8));
    }

    [Fact]
    public async Task Overlapping_slots_are_blocked_when_hard_limits_enforced()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        var service = BuildService(db);
        await service.SaveTimeSheetYearSettingsAsync(
            FirmId, 2026,
            new SaveFirmTimeSheetYearSettingsDto
            {
                WeeklyRegime = (int)WeeklyWorkRegime.FortyHours,
                MaxDailyHours = 10m,
                MaxWeeklyHours = 40m,
                AllowFutureEntryDays = 30,
                MaxBackdatingDays = 365,
                EnforceHardLimits = true,
                PaidLeaveDaysPerYear = 30,
                PublicHolidayDaysPerYear = 10,
                ProductivityRatePercent = 80,
                CnssEmployerRate = 16.57m,
                TfpRate = 2m,
                FoprolosRate = 1m,
                WorkAccidentRate = 0.5m
            });

        var first = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new CreateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 20),
                Hours = 0,
                StartTime = "09:00",
                EndTime = "12:00",
                FirmClientAssignmentId = assignment.Id,
                IsBillable = true
            });
        Assert.True(first.IsSuccess);

        var overlap = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true,
            new CreateTimeSheetEntryDto
            {
                WorkDate = new DateTime(2026, 7, 20),
                Hours = 0,
                StartTime = "11:00",
                EndTime = "13:00",
                FirmClientAssignmentId = assignment.Id,
                IsBillable = true
            });
        Assert.True(overlap.IsFailure);
    }

    [Fact]
    public async Task Seeding_defaults_twice_does_not_duplicate_or_resurrect_codes()
    {
        await using var db = BuildMaster();
        var service = BuildService(db);

        var first = await service.SeedDefaultActivityCodesAsync(FirmId);
        Assert.Equal(FirmActivityCode.DefaultCatalog.Count, first.Count);

        // Un cabinet qui désactive un code ne doit pas le voir revenir au prochain passage.
        var toDisable = first.First(c => c.Code == "FORM");
        await service.SetActivityCodeActiveAsync(FirmId, isManager: true, toDisable.Id, isActive: false);

        var second = await service.SeedDefaultActivityCodesAsync(FirmId);

        Assert.Equal(first.Count - 1, second.Count);
        Assert.DoesNotContain(second, c => c.Code == "FORM");
    }

    [Fact]
    public async Task Internal_activity_codes_default_to_non_billable()
    {
        await using var db = BuildMaster();
        var service = BuildService(db);

        var codes = await service.SeedDefaultActivityCodesAsync(FirmId);

        Assert.False(codes.Single(c => c.Code == "ADMIN").IsBillableByDefault);
        Assert.False(codes.Single(c => c.Code == "FORM").IsBillableByDefault);
        Assert.True(codes.Single(c => c.Code == "TENUE").IsBillableByDefault);
    }

    [Fact]
    public async Task Duplicate_activity_code_is_refused()
    {
        await using var db = BuildMaster();
        var service = BuildService(db);
        await service.SeedDefaultActivityCodesAsync(FirmId);

        var duplicate = await service.CreateActivityCodeAsync(
            FirmId, isManager: true,
            new SaveFirmActivityCodeDto { Code = "tenue", Label = "Doublon", Category = 1 });

        Assert.True(duplicate.IsFailure);
    }

    [Fact]
    public async Task An_accountant_cannot_edit_the_activity_catalog()
    {
        await using var db = BuildMaster();
        var service = BuildService(db);

        var result = await service.CreateActivityCodeAsync(
            FirmId, isManager: false,
            new SaveFirmActivityCodeDto { Code = "TEST", Label = "Test", Category = 1 });

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Create_activity_code_persists_default_unit_price()
    {
        await using var db = BuildMaster();
        var service = BuildService(db);

        var created = await service.CreateActivityCodeAsync(
            FirmId, isManager: true,
            new SaveFirmActivityCodeDto
            {
                Code = "CONSEIL",
                Label = "Conseil",
                Category = 5,
                IsBillableByDefault = true,
                DefaultUnitPrice = 200.5m,
                SortOrder = 10
            });

        Assert.True(created.IsSuccess);
        Assert.Equal(200.5m, created.Value.DefaultUnitPrice);

        var listed = await service.ListActivityCodesAsync(FirmId, includeInactive: false, billableOnly: false);
        Assert.Equal(200.5m, listed.Single(c => c.Code == "CONSEIL").DefaultUnitPrice);
    }

    [Fact]
    public async Task Update_activity_code_updates_default_unit_price()
    {
        await using var db = BuildMaster();
        var service = BuildService(db);

        var created = await service.CreateActivityCodeAsync(
            FirmId, isManager: true,
            new SaveFirmActivityCodeDto
            {
                Code = "CAC",
                Label = "Audit",
                Category = 4,
                DefaultUnitPrice = 150m,
                SortOrder = 10
            });

        var updated = await service.UpdateActivityCodeAsync(
            FirmId, isManager: true, created.Value.Id,
            new SaveFirmActivityCodeDto
            {
                Code = "CAC",
                Label = "Audit légal",
                Category = 4,
                DefaultUnitPrice = 300m,
                SortOrder = 10
            });

        Assert.True(updated.IsSuccess);
        Assert.Equal(300m, updated.Value.DefaultUnitPrice);
        Assert.Equal("Audit légal", updated.Value.Label);
    }

    [Fact]
    public async Task Seeded_activity_codes_have_null_default_unit_price()
    {
        await using var db = BuildMaster();
        var service = BuildService(db);

        var codes = await service.SeedDefaultActivityCodesAsync(FirmId);

        Assert.All(codes, c => Assert.Null(c.DefaultUnitPrice));
    }

    // ============================================
    // COHÉRENCE DES LIBELLÉS CLIENT
    // ============================================

    [Fact]
    public async Task TimeSheet_client_label_comes_from_the_permanent_file()
    {
        await using var db = BuildMaster();
        var assignment = await SeedActiveAssignmentAsync(db);
        await SeedCompletePermanentFileAsync(db, assignment.Id);
        var service = BuildService(db);

        var expected = await db.PermanentFiles.AsNoTracking()
            .Where(p => p.FirmClientAssignmentId == assignment.Id)
            .Select(p => p.CompanyName)
            .FirstAsync();

        var created = await service.CreateTimeSheetAsync(
            FirmId, UserId, "Manager Test", isManager: true, Entry(new DateTime(2026, 7, 10), 2m, assignment.Id));

        // L'analyse de rentabilité lit le dossier permanent : les deux écrans doivent afficher le même libellé.
        Assert.True(created.IsSuccess);
        Assert.Equal(expected, created.Value.ClientCompanyName);
    }
}
