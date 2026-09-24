using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.FirmGovernance.Validation;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.FirmGovernance;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class FirmCollaboratorServiceTests
{
    private static readonly Guid FirmId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid ManagerId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    private sealed class TestContext
    {
        public required MasterDbContext Db { get; init; }
        public required UserManager<ApplicationUser> UserManager { get; init; }
        public required FirmCollaboratorService Service { get; init; }
        public required Mock<IEmailService> Email { get; init; }
        public required Mock<IFirmInternalPayrollProvisioningService> Provisioning { get; init; }
        public required Mock<ITenantService> TenantService { get; init; }
        public required string StorageRoot { get; init; }
    }

    private static async Task<TestContext> CreateContextAsync(
        FirmGovernanceOptions? governanceOptions = null,
        Action<Mock<IFirmInternalPayrollProvisioningService>, MasterDbContext>? configureProvisioning = null,
        IInterceptor? interceptor = null)
    {
        var dbName = Guid.NewGuid().ToString();
        var optionsBuilder = new DbContextOptionsBuilder<MasterDbContext>()
            .UseInMemoryDatabase(dbName);
        if (interceptor is not null)
            optionsBuilder.AddInterceptors(interceptor);
        var options = optionsBuilder.Options;
        var db = new MasterDbContext(options);

        var nif = NIF.Create("1234567/A/B/C/000").Value;
        var address = Address.Create("12 rue Test", "Tunis", "Tunis", postalCode: "1000", country: "Tunisie").Value;
        var emailVo = Email.Create("cabinet@test.tn").Value;
        var phone = PhoneNumber.Create("20123456").Value;
        var firm = Tenant.CreateAccountingFirm("Cabinet Test", nif, address, emailVo, phone).Value;
        typeof(Tenant).GetProperty(nameof(Tenant.Id))!.SetValue(firm, FirmId);
        db.Tenants.Add(firm);

        db.Roles.Add(new ApplicationRole
        {
            Id = Guid.NewGuid(),
            Name = UserRole.FirmAccountant.ToString(),
            NormalizedName = UserRole.FirmAccountant.ToString().ToUpperInvariant()
        });
        db.Roles.Add(new ApplicationRole
        {
            Id = Guid.NewGuid(),
            Name = UserRole.FirmManager.ToString(),
            NormalizedName = UserRole.FirmManager.ToString().ToUpperInvariant()
        });
        await db.SaveChangesAsync();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(options);
        services.AddScoped(_ => db);
        services.AddIdentityCore<ApplicationUser>(o =>
            {
                o.Password.RequireDigit = false;
                o.Password.RequireLowercase = false;
                o.Password.RequireUppercase = false;
                o.Password.RequireNonAlphanumeric = false;
                o.Password.RequiredLength = 6;
            })
            .AddRoles<ApplicationRole>()
            .AddEntityFrameworkStores<MasterDbContext>();

        var sp = services.BuildServiceProvider();
        var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();

        var manager = new ApplicationUser
        {
            Id = ManagerId,
            UserName = "manager@test.tn",
            Email = "manager@test.tn",
            FirstName = "Manager",
            LastName = "Test",
            TenantId = FirmId,
            EmailConfirmed = true,
            IsActive = true
        };
        await userManager.CreateAsync(manager, "Password1!");
        await userManager.AddToRoleAsync(manager, UserRole.FirmManager.ToString());

        var email = new Mock<IEmailService>();
        email.Setup(e => e.EnqueueTemplatedAsync(
                It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string>(),
                It.IsAny<IReadOnlyDictionary<string, object?>?>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Guid.NewGuid());

        var provisioning = new Mock<IFirmInternalPayrollProvisioningService>();
        configureProvisioning?.Invoke(provisioning, db);

        var tenantService = new Mock<ITenantService>();
        tenantService
            .Setup(t => t.GetConnectionStringAsync(FirmId, It.IsAny<CancellationToken>()))
            .ReturnsAsync("Server=(localdb)\\mssqllocaldb;Database=PayrollTest;");

        var storageRoot = Path.Combine(Path.GetTempPath(), "ft-collab-tests", Guid.NewGuid().ToString("N"));
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["App:FrontendBaseUrl"] = "http://localhost:4200"
        }).Build();

        var governance = governanceOptions ?? new FirmGovernanceOptions();

        var service = new FirmCollaboratorService(
            db,
            userManager,
            email.Object,
            config,
            Options.Create(new FirmCollaboratorStorageOptions { BasePath = storageRoot }),
            provisioning.Object,
            tenantService.Object,
            new FirmCollaboratorPayrollOnboardingValidator(),
            Options.Create(governance),
            NullLogger<FirmCollaboratorService>.Instance);

        return new TestContext
        {
            Db = db,
            UserManager = userManager,
            Service = service,
            Email = email,
            Provisioning = provisioning,
            TenantService = tenantService,
            StorageRoot = storageRoot
        };
    }

    private static CreateFirmUserDto DefaultCreateDto(string email) => new()
    {
        Email = email,
        FirstName = "Ada",
        LastName = "Lovelace",
        Password = "Password1!",
        Role = UserRole.FirmAccountant,
        Qualification = "Comptable",
        UseFirmAddress = true
    };

    private static FirmCollaboratorPayrollOnboardingDto DefaultPayrollOnboarding() => new()
    {
        EmployeeNumber = "CAB-TEST-001",
        HireDate = new DateTime(2025, 6, 1),
        Contract = new CreateContractDto
        {
            Type = "Cdi",
            Regime = "Rsna",
            WeeklyRegime = "FortyEightHours",
            StartDate = new DateTime(2025, 6, 1),
            BaseSalary = 1500m,
            WorkAccidentRate = 0.4m,
            JobTitle = "Collaborateur cabinet"
        }
    };

    private static CreateFirmUserDto CreateDtoWithPayroll(string email) =>
        DefaultCreateDto(email) with { Payroll = DefaultPayrollOnboarding() };

    [Fact]
    public async Task Create_WithPassword_KeepsEmailConfirmed_AndSkipsInvite()
    {
        var ctx = await CreateContextAsync();
        await using var db = ctx.Db;

        var result = await ctx.Service.CreateAsync(FirmId, DefaultCreateDto("collab@test.tn"), null, null, null);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : "");
        Assert.True(result.Value.EmailConfirmed);
        var created = await db.Users.SingleAsync(u => u.Email == "collab@test.tn");
        Assert.Equal(ProductOnboardingStatus.NotStarted, created.ProductOnboardingStatus);
        Assert.Contains("12 rue Test", result.Value.AddressLine);
        ctx.Email.Verify(e => e.EnqueueTemplatedAsync(
            It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string>(),
            It.IsAny<IReadOnlyDictionary<string, object?>?>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
        ctx.Provisioning.Verify(
            p => p.ProvisionCollaboratorAsync(
                It.IsAny<Guid>(), It.IsAny<bool>(), It.IsAny<Guid>(),
                It.IsAny<FirmCollaboratorPayrollOnboardingDto?>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Create_WhenAutoProvisionFlagOn_WithoutPayroll_FailsBeforeUserCreation()
    {
        var ctx = await CreateContextAsync(new FirmGovernanceOptions
        {
            Enabled = true,
            EnableFirmInternalPayroll = true,
            AutoProvisionPayrollOnCollaboratorCreate = true
        });

        var result = await ctx.Service.CreateAsync(FirmId, DefaultCreateDto("no-payroll@test.tn"), null, null, null);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.PayrollProvision", result.Error.Code);
        Assert.Contains("dossier paie est obligatoire", result.Error.Description);
        Assert.False(await ctx.Db.Users.AnyAsync(u => u.Email == "no-payroll@test.tn"));
        ctx.Provisioning.Verify(
            p => p.ProvisionCollaboratorAsync(
                It.IsAny<Guid>(), It.IsAny<bool>(), It.IsAny<Guid>(),
                It.IsAny<FirmCollaboratorPayrollOnboardingDto?>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Create_WhenAutoProvisionFlagOn_AndProvisionSucceeds_SetsPayrollEmployeeId()
    {
        var payrollEmployeeId = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
        var ctx = await CreateContextAsync(
            new FirmGovernanceOptions
            {
                Enabled = true,
                EnableFirmInternalPayroll = true,
                AutoProvisionPayrollOnCollaboratorCreate = true
            },
            (mock, db) =>
            {
                mock.Setup(p => p.ProvisionCollaboratorAsync(
                        FirmId,
                        true,
                        It.IsAny<Guid>(),
                        It.IsAny<FirmCollaboratorPayrollOnboardingDto?>(),
                        It.IsAny<CancellationToken>()))
                    .Returns<Guid, bool, Guid, FirmCollaboratorPayrollOnboardingDto?, CancellationToken>((_, _, userId, _, _) =>
                    {
                        var profile = db.FirmCollaboratorProfiles.First(p => p.UserId == userId);
                        profile.PayrollEmployeeId = payrollEmployeeId;
                        profile.PayrollLinkSource = FirmPayrollLinkSource.ProvisionedFromCollaborator;
                        db.SaveChanges();
                        return Task.FromResult(Result.Success(new FirmPayrollProvisionResultDto { Created = 1 }));
                    });
            });

        var payroll = DefaultPayrollOnboarding();
        var result = await ctx.Service.CreateAsync(
            FirmId, CreateDtoWithPayroll("payroll-ok@test.tn"), null, null, null);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : "");
        Assert.Equal(payrollEmployeeId, result.Value.PayrollEmployeeId);
        Assert.Equal("Provisionné", result.Value.PayrollLinkSourceDisplay);
        ctx.Provisioning.Verify(
            p => p.ProvisionCollaboratorAsync(
                FirmId,
                true,
                result.Value.Id,
                It.Is<FirmCollaboratorPayrollOnboardingDto?>(o =>
                    o != null && o.EmployeeNumber == payroll.EmployeeNumber),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task Create_WhenAutoProvisionFlagOn_AndProvisionFails_RollsBackCollaborator()
    {
        var ctx = await CreateContextAsync(
            new FirmGovernanceOptions
            {
                Enabled = true,
                EnableFirmInternalPayroll = true,
                AutoProvisionPayrollOnCollaboratorCreate = true
            },
            (mock, _) =>
            {
                mock.Setup(p => p.ProvisionCollaboratorAsync(
                        FirmId,
                        true,
                        It.IsAny<Guid>(),
                        It.IsAny<FirmCollaboratorPayrollOnboardingDto?>(),
                        It.IsAny<CancellationToken>()))
                    .ReturnsAsync(Result.Failure<FirmPayrollProvisionResultDto>(
                        Error.Validation("Provision", "Base paie indisponible")));
            });

        var result = await ctx.Service.CreateAsync(
            FirmId, CreateDtoWithPayroll("payroll-ko@test.tn"), null, null, null);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.PayrollProvision", result.Error.Code);
        Assert.Contains("Impossible de créer le salarié paie", result.Error.Description);
        Assert.False(await ctx.Db.Users.AnyAsync(u => u.Email == "payroll-ko@test.tn"));
    }

    [Fact]
    public async Task Create_WhenAutoProvisionThrows_RollsBackCollaborator()
    {
        var ctx = await CreateContextAsync(
            new FirmGovernanceOptions
            {
                Enabled = true,
                EnableFirmInternalPayroll = true,
                AutoProvisionPayrollOnCollaboratorCreate = true
            },
            (mock, _) =>
            {
                mock.Setup(p => p.ProvisionCollaboratorAsync(
                        FirmId,
                        true,
                        It.IsAny<Guid>(),
                        It.IsAny<FirmCollaboratorPayrollOnboardingDto?>(),
                        It.IsAny<CancellationToken>()))
                    .ThrowsAsync(new InvalidOperationException("Sequence contains no elements."));
            });

        var result = await ctx.Service.CreateAsync(
            FirmId, CreateDtoWithPayroll("payroll-ex@test.tn"), null, null, null);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.PayrollProvision", result.Error.Code);
        // Le message d'exception reste dans les journaux : le client ne reçoit qu'une référence.
        Assert.DoesNotContain("Sequence contains no elements", result.Error.Description);
        Assert.StartsWith("Impossible de créer le salarié paie", result.Error.Description);
        Assert.Contains("réf.", result.Error.Description);
        Assert.False(await ctx.Db.Users.AnyAsync(u => u.Email == "payroll-ex@test.tn"));
    }

    [Fact]
    public async Task Create_WhenAutoProvisionFlagOn_AndNoTenantConnection_FailsBeforeUserCreation()
    {
        var ctx = await CreateContextAsync(new FirmGovernanceOptions
        {
            Enabled = true,
            EnableFirmInternalPayroll = true,
            AutoProvisionPayrollOnCollaboratorCreate = true
        });
        ctx.TenantService
            .Setup(t => t.GetConnectionStringAsync(FirmId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);

        var result = await ctx.Service.CreateAsync(FirmId, DefaultCreateDto("preflight@test.tn"), null, null, null);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.PayrollProvision", result.Error.Code);
        Assert.False(await ctx.Db.Users.AnyAsync(u => u.Email == "preflight@test.tn"));
        ctx.Provisioning.Verify(
            p => p.ProvisionCollaboratorAsync(
                It.IsAny<Guid>(), It.IsAny<bool>(), It.IsAny<Guid>(),
                It.IsAny<FirmCollaboratorPayrollOnboardingDto?>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Update_DoesNotChangeEmailConfirmed()
    {
        var ctx = await CreateContextAsync();
        await using var db = ctx.Db;

        var created = await ctx.Service.CreateAsync(FirmId, new CreateFirmUserDto
        {
            Email = "unconfirmed@test.tn",
            FirstName = "Jean",
            LastName = "Dupont",
            Role = UserRole.FirmAccountant,
            SendInvite = true,
            Qualification = "Expert"
        }, null, null, null);

        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Description : "");
        Assert.False(created.Value.EmailConfirmed);

        var updated = await ctx.Service.UpdateAsync(FirmId, created.Value.Id, ManagerId, new UpdateFirmUserDto
        {
            FirstName = "Jean-Pierre",
            Qualification = "Expert comptable"
        });

        Assert.True(updated.IsSuccess);
        Assert.False(updated.Value.EmailConfirmed);
        Assert.Equal("Jean-Pierre", updated.Value.FirstName);
    }

    [Fact]
    public async Task UseFirmAddress_Off_DoesNotMutateTenantAddress()
    {
        var ctx = await CreateContextAsync();
        await using var db = ctx.Db;

        var created = await ctx.Service.CreateAsync(FirmId, new CreateFirmUserDto
        {
            Email = "addr@test.tn",
            FirstName = "Ali",
            LastName = "Ben",
            Password = "Password1!",
            Role = UserRole.FirmAccountant,
            Qualification = "Aide",
            UseFirmAddress = true
        }, null, null, null);

        Assert.True(created.IsSuccess);

        await ctx.Service.UpdateAsync(FirmId, created.Value.Id, ManagerId, new UpdateFirmUserDto
        {
            UseFirmAddress = false,
            AddressLine = "99 rue Perso",
            City = "Sfax",
            PostalCode = "3000",
            Country = "Tunisie"
        });

        var tenant = await db.Tenants.AsNoTracking().FirstAsync(t => t.Id == FirmId);
        Assert.Equal("12 rue Test", tenant.Address.Street);
        Assert.Equal("Tunis", tenant.Address.City);

        var detail = await ctx.Service.GetByIdAsync(FirmId, created.Value.Id);
        Assert.Equal("99 rue Perso", detail.Value.AddressLine);
        Assert.Equal("Sfax", detail.Value.City);
    }

    [Fact]
    public async Task SetActive_RejectsSelfDeactivation()
    {
        var ctx = await CreateContextAsync();
        await using var db = ctx.Db;

        var result = await ctx.Service.SetActiveAsync(FirmId, ManagerId, ManagerId, isActive: false);
        Assert.True(result.IsFailure);
        Assert.Contains("propre compte", result.Error.Description);
    }

    [Fact]
    public async Task UploadCni_PersistsFileNameOnProfile()
    {
        var ctx = await CreateContextAsync();
        await using var db = ctx.Db;

        var created = await ctx.Service.CreateAsync(FirmId, new CreateFirmUserDto
        {
            Email = "cni@test.tn",
            FirstName = "Cni",
            LastName = "User",
            Password = "Password1!",
            Role = UserRole.FirmAccountant,
            Qualification = "Comptable"
        }, null, null, null);
        Assert.True(created.IsSuccess);

        await using var pdf = new MemoryStream("%PDF-1.4 test"u8.ToArray());
        var upload = await ctx.Service.UploadCniAsync(
            FirmId, created.Value.Id, pdf, "carte.pdf", "application/pdf", pdf.Length);

        Assert.True(upload.IsSuccess, upload.IsFailure ? upload.Error.Description : "");
        Assert.True(upload.Value.HasCni);

        var profile = await db.FirmCollaboratorProfiles.AsNoTracking()
            .FirstAsync(p => p.UserId == created.Value.Id);
        Assert.False(string.IsNullOrWhiteSpace(profile.CniFileName));
        Assert.EndsWith(".pdf", profile.CniFileName);
    }

    [Fact]
    public async Task Create_WithTooShortPassword_ReturnsPasswordCode_AndCreatesNoAccount()
    {
        var ctx = await CreateContextAsync();
        await using var db = ctx.Db;

        var result = await ctx.Service.CreateAsync(
            FirmId, DefaultCreateDto("weak@test.tn") with { Password = "abc" }, null, null, null);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Password", result.Error.Code);
        Assert.Equal("Le mot de passe doit contenir au moins 6 caractères.", result.Error.Description);
        Assert.False(await db.Users.AnyAsync(u => u.Email == "weak@test.tn"));
    }

    [Fact]
    public async Task Create_WithEmailOutsideIdentityCharset_FailsBeforeAnyWrite()
    {
        var ctx = await CreateContextAsync(new FirmGovernanceOptions
        {
            Enabled = true,
            EnableFirmInternalPayroll = true,
            AutoProvisionPayrollOnCollaboratorCreate = true
        });
        await using var db = ctx.Db;

        var result = await ctx.Service.CreateAsync(
            FirmId, CreateDtoWithPayroll("o'brien@test.tn"), null, null, null);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Email", result.Error.Code);
        Assert.Contains("caractères non autorisés", result.Error.Description);
        Assert.False(await db.Users.AnyAsync(u => u.Email == "o'brien@test.tn"));
        ctx.Provisioning.Verify(
            p => p.ProvisionCollaboratorAsync(
                It.IsAny<Guid>(), It.IsAny<bool>(), It.IsAny<Guid>(),
                It.IsAny<FirmCollaboratorPayrollOnboardingDto?>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Create_WithEmailAlreadyUsed_ReturnsEmailCode()
    {
        var ctx = await CreateContextAsync();
        await using var db = ctx.Db;

        var result = await ctx.Service.CreateAsync(FirmId, DefaultCreateDto("manager@test.tn"), null, null, null);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Email", result.Error.Code);
        Assert.Contains("déjà utilisé", result.Error.Description);
        Assert.Equal(1, await db.Users.CountAsync(u => u.Email == "manager@test.tn"));
    }

    [Fact]
    public async Task Create_WhenRoleIsMissing_FailsBeforeAccountCreation()
    {
        var ctx = await CreateContextAsync();
        await using var db = ctx.Db;
        db.Roles.Remove(await db.Roles.SingleAsync(r => r.Name == UserRole.FirmAccountant.ToString()));
        await db.SaveChangesAsync();

        var result = await ctx.Service.CreateAsync(FirmId, DefaultCreateDto("no-role@test.tn"), null, null, null);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Role", result.Error.Code);
        Assert.False(await db.Users.AnyAsync(u => u.Email == "no-role@test.tn"));
    }

    [Fact]
    public async Task Create_WhenProfileSaveThrows_RemovesAccount_AndRethrows()
    {
        var ctx = await CreateContextAsync(interceptor: new FailProfileInsertInterceptor());
        await using var db = ctx.Db;

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            ctx.Service.CreateAsync(FirmId, DefaultCreateDto("profile-ko@test.tn"), null, null, null));

        // Sans compensation, l'e-mail resterait pris et chaque nouvelle tentative échouerait en doublon.
        Assert.False(await db.Users.AnyAsync(u => u.Email == "profile-ko@test.tn"));
    }

    [Fact]
    public async Task Create_WhenCniStreamFails_RemovesAccountAndPartialFile_AndRethrows()
    {
        var ctx = await CreateContextAsync();
        await using var db = ctx.Db;
        await using var cni = new FailingReadStream();

        await Assert.ThrowsAsync<IOException>(() =>
            ctx.Service.CreateAsync(FirmId, DefaultCreateDto("cni-ko@test.tn"), cni, "carte.pdf", "application/pdf"));

        Assert.False(await db.Users.AnyAsync(u => u.Email == "cni-ko@test.tn"));
        var leftovers = Directory.Exists(ctx.StorageRoot)
            ? Directory.GetFiles(ctx.StorageRoot, "*", SearchOption.AllDirectories)
            : Array.Empty<string>();
        Assert.Empty(leftovers);
    }

    /// <summary>Fait échouer l'insertion du profil, comme une troncature SQL en production.</summary>
    private sealed class FailProfileInsertInterceptor : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<FirmCollaboratorProfile>().Any(e => e.State == EntityState.Added))
                throw new DbUpdateException("String or binary data would be truncated.");

            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    /// <summary>Flux dont la lecture casse en cours de copie (connexion coupée pendant l'envoi).</summary>
    private sealed class FailingReadStream : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => 1024;
        public override long Position { get; set; }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new IOException("Connexion interrompue.");
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
            throw new IOException("Connexion interrompue.");
        public override long Seek(long offset, SeekOrigin origin) => 0;
        public override void SetLength(long value) { }
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
