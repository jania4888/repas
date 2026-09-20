using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.SectorConfiguration;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.InMemory.Diagnostics.Internal;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;
using DomainEmail = FactuTrust.Domain.ValueObjects.Email;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Couverture de <see cref="CompanyRegistrationService"/>, en particulier des <b>différences</b>
/// entre le contexte public (inscription self-service) et le contexte plateforme (création par un
/// opérateur). Le chemin public est le chemin de revenu : plusieurs tests ici existent uniquement
/// pour épingler son comportement actuel.
///
/// <para>
/// Contrainte technique : le fournisseur EF InMemory lève sur <c>BeginTransactionAsync</c>, que
/// <c>RegisterAsync</c> ouvre après les pré-contrôles. Les tests restent donc volontairement dans
/// la zone <b>pré-transaction</b> (validation, doublon d'email, conflit de NIF) — ce qui est aussi
/// là que vivent les régressions qui touchent réellement l'opérateur.
/// </para>
/// </summary>
public sealed class CompanyRegistrationServiceTests
{
    [Fact]
    public async Task RegisterAsync_confirmPassword_mismatch_is_rejected_before_any_provisioning()
    {
        var harness = new Harness();
        var dto = ValidDto() with { ConfirmPassword = "UnAutreMotDePasse1!" };

        var result = await harness.Service.RegisterAsync(dto, CompanyRegistrationContext.Public());

        Assert.False(result.Success);
        Assert.Equal(CompanyRegistrationFailureKind.Validation, result.FailureKind);
        Assert.Equal("Les mots de passe ne correspondent pas", result.ErrorMessage);
        harness.VerifyNoDatabaseProvisioned();
    }

    [Fact]
    public async Task RegisterAsync_platform_context_also_rejects_confirmPassword_mismatch()
    {
        var harness = new Harness();
        var dto = ValidDto() with { ConfirmPassword = string.Empty };

        var result = await harness.Service.RegisterAsync(dto, CompanyRegistrationContext.Platform(Guid.NewGuid()));

        Assert.False(result.Success);
        Assert.Equal(CompanyRegistrationFailureKind.Validation, result.FailureKind);
        harness.VerifyNoDatabaseProvisioned();
    }

    [Fact]
    public async Task RegisterAsync_invalid_nif_returns_validation_failure()
    {
        var harness = new Harness();

        var result = await harness.Service.RegisterAsync(
            ValidDto() with { Nif = "pas-un-nif" },
            CompanyRegistrationContext.Public());

        Assert.False(result.Success);
        Assert.Equal(CompanyRegistrationFailureKind.Validation, result.FailureKind);
        harness.VerifyNoDatabaseProvisioned();
    }

    /// <summary>
    /// Épingle anti-régression : <c>Address.Create</c> ne valide pas le gouvernorat (15 flux
    /// l'utilisent avec des valeurs historiques libres). Le durcissement introduit pour le
    /// provisionnement plateforme doit rester dans le validateur de l'API, jamais dans le domaine.
    /// </summary>
    [Fact]
    public async Task RegisterAsync_public_context_accepts_a_free_text_governorate()
    {
        var harness = new Harness();

        var result = await harness.Service.RegisterAsync(
            ValidDto() with { Governorate = "Paris" },
            CompanyRegistrationContext.Public());

        Assert.NotEqual("Gouvernorat invalide.", result.ErrorMessage);
    }

    [Fact]
    public async Task RegisterAsync_unknown_module_id_returns_validation_failure()
    {
        var harness = new Harness();

        var result = await harness.Service.RegisterAsync(
            ValidDto() with { EnabledModules = new[] { 999 } },
            CompanyRegistrationContext.Public());

        Assert.False(result.Success);
        Assert.Equal(CompanyRegistrationFailureKind.Validation, result.FailureKind);
        Assert.Contains("999", result.ErrorMessage);
        harness.VerifyNoDatabaseProvisioned();
    }

    /// <summary>
    /// Honoraires (15) est une valeur d'énumération parfaitement définie : elle ne doit pas être
    /// rejetée comme « module invalide ». Elle est écartée plus loin, sous forme d'avertissement.
    /// </summary>
    [Fact]
    public async Task RegisterAsync_honoraires_module_is_not_reported_as_invalid()
    {
        var harness = new Harness();

        var result = await harness.Service.RegisterAsync(
            ValidDto() with { EnabledModules = new[] { (int)AppModule.Honoraires } },
            CompanyRegistrationContext.Public());

        Assert.DoesNotContain("Modules invalides", result.ErrorMessage ?? string.Empty);
    }

    [Fact]
    public async Task RegisterAsync_duplicate_email_is_rejected_before_any_provisioning()
    {
        var existing = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            Email = "admin@societe.test",
            UserName = "admin@societe.test"
        };
        var harness = new Harness(existingUser: existing);

        var result = await harness.Service.RegisterAsync(ValidDto(), CompanyRegistrationContext.Public());

        Assert.False(result.Success);
        Assert.Equal(CompanyRegistrationFailureKind.DuplicateEmail, result.FailureKind);
        harness.VerifyNoDatabaseProvisioned();
    }

    [Fact]
    public async Task RegisterAsync_duplicate_nif_on_an_active_tenant_returns_conflict()
    {
        var harness = new Harness();
        harness.SeedActiveTenantWithNif("1234567/A/B/C/000");

        var result = await harness.Service.RegisterAsync(ValidDto(), CompanyRegistrationContext.Public());

        Assert.False(result.Success);
        Assert.Equal(CompanyRegistrationFailureKind.ConflictNif, result.FailureKind);
        harness.VerifyNoDatabaseProvisioned();
    }

    /// <summary>
    /// Épingle la clause <c>t.IsActive</c> du pré-contrôle : un dossier désactivé ne doit pas
    /// bloquer la réutilisation de son matricule fiscal.
    /// </summary>
    [Fact]
    public async Task RegisterAsync_duplicate_nif_on_an_inactive_tenant_does_not_conflict()
    {
        var harness = new Harness();
        harness.SeedActiveTenantWithNif("1234567/A/B/C/000", active: false);

        var result = await harness.Service.RegisterAsync(ValidDto(), CompanyRegistrationContext.Public());

        Assert.NotEqual(CompanyRegistrationFailureKind.ConflictNif, result.FailureKind);
    }

    /// <summary>
    /// Garde centrale du chantier : une même requête invalide doit produire exactement les mêmes
    /// erreurs sur les deux chemins. C'est ce qui empêche le durcissement du chemin plateforme de
    /// dériver silencieusement du chemin public.
    /// </summary>
    [Fact]
    public async Task RegisterAsync_platform_and_public_produce_identical_validation_errors()
    {
        var invalid = ValidDto() with { Nif = "invalide" };

        var publicResult = await new Harness().Service.RegisterAsync(invalid, CompanyRegistrationContext.Public());
        var platformResult = await new Harness().Service.RegisterAsync(
            invalid,
            CompanyRegistrationContext.Platform(Guid.NewGuid()));

        Assert.Equal(publicResult.FailureKind, platformResult.FailureKind);
        Assert.Equal(publicResult.Errors, platformResult.Errors);
    }

    [Fact]
    public void Public_context_never_forces_email_confirmation_nor_skips_tokens()
    {
        var context = CompanyRegistrationContext.Public();

        Assert.True(context.IssueAuthTokens);
        Assert.False(context.ForceEmailConfirmed);
        Assert.Null(context.PlatformActorUserId);
        Assert.Equal("public", context.Source);
        // Le forfait ne doit jamais pouvoir venir d'une requête anonyme.
        Assert.Equal(SubscriptionPlan.Free, context.Plan);
    }

    [Fact]
    public void Platform_context_issues_no_tokens_and_pre_confirms_the_account()
    {
        var actorId = Guid.NewGuid();
        var context = CompanyRegistrationContext.Platform(actorId, SubscriptionPlan.Annual);

        Assert.False(context.IssueAuthTokens);
        Assert.True(context.ForceEmailConfirmed);
        Assert.Equal(actorId, context.PlatformActorUserId);
        Assert.Equal("platform", context.Source);
        Assert.Equal(SubscriptionPlan.Annual, context.Plan);
    }

    [Fact]
    public void Platform_context_defaults_to_the_free_plan()
    {
        Assert.Equal(SubscriptionPlan.Free, CompanyRegistrationContext.Platform(Guid.NewGuid()).Plan);
    }

    private static RegisterDto ValidDto() => new()
    {
        Email = "admin@societe.test",
        Password = "MotDePasseSolide1!",
        ConfirmPassword = "MotDePasseSolide1!",
        FirstName = "Sabri",
        LastName = "Kouraichi",
        CompanyName = "Société Test",
        Nif = "1234567/A/B/C/000",
        TaxRegime = TaxRegime.RealRegime,
        Street = "1 rue Test",
        City = "Tunis",
        PostalCode = "1000",
        Governorate = "Tunis",
        CompanyEmail = "contact@societe.test",
        Phone = "71123456"
    };

    /// <summary>Monte le service avec ses onze dépendances doublées.</summary>
    private sealed class Harness
    {
        public Harness(ApplicationUser? existingUser = null)
        {
            Db = BuildMasterDb();
            UserManager = BuildUserManager(existingUser);
            TenantService = new Mock<ITenantService>();
            TokenService = new Mock<ITenantAuthTokenService>();
            EmailService = new Mock<IEmailService>();

            var sectorService = new Mock<IRegistrationSectorService>();
            sectorService
                .Setup(s => s.ResolveProfile(It.IsAny<string?>(), It.IsAny<string?>()))
                .Returns(Result.Success<SectorProfile>(null!));

            Service = new CompanyRegistrationService(
                UserManager.Object,
                Db,
                TenantService.Object,
                TokenService.Object,
                sectorService.Object,
                Mock.Of<ISectorCatalogProvider>(),
                Options.Create(new RegistrationSectorOptions()),
                Options.Create(new EmailVerificationOptions()),
                EmailService.Object,
                Mock.Of<ISubscriptionAdminService>(),
                Mock.Of<IConfiguration>(),
                Mock.Of<ILogger<CompanyRegistrationService>>());
        }

        public MasterDbContext Db { get; }
        public Mock<UserManager<ApplicationUser>> UserManager { get; }
        public Mock<ITenantService> TenantService { get; }
        public Mock<ITenantAuthTokenService> TokenService { get; }
        public Mock<IEmailService> EmailService { get; }
        public CompanyRegistrationService Service { get; }

        public void SeedActiveTenantWithNif(string nif, bool active = true)
        {
            var tenant = Tenant.Create(
                "Société existante",
                NIF.Create(nif).Value,
                Address.Create("1 rue", "Tunis", "Tunis").Value,
                DomainEmail.Create("existant@societe.test").Value,
                PhoneNumber.Create("71123456").Value,
                TaxRegime.RealRegime).Value;

            if (!active)
                tenant.Deactivate();

            Db.Tenants.Add(tenant);
            Db.SaveChanges();
        }

        public void VerifyNoDatabaseProvisioned() =>
            TenantService.Verify(
                s => s.CreateTenantDatabaseAsync(
                    It.IsAny<Guid>(),
                    It.IsAny<string>(),
                    It.IsAny<string?>(),
                    It.IsAny<CancellationToken>()),
                Times.Never);

        private static MasterDbContext BuildMasterDb()
        {
            // Le fournisseur InMemory ne gere pas les transactions. On neutralise l'avertissement
            // pour que `BeginTransactionAsync` soit un no-op : les tests peuvent alors verifier que
            // tel rejet n'a PAS lieu, sans exploser des l'ouverture de la transaction.
            var options = new DbContextOptionsBuilder<MasterDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            return new MasterDbContext(options);
        }

        private static Mock<UserManager<ApplicationUser>> BuildUserManager(ApplicationUser? existing)
        {
            var store = new Mock<IUserStore<ApplicationUser>>();
            var userManager = new Mock<UserManager<ApplicationUser>>(
                store.Object, null!, null!, null!, null!, null!, null!, null!, null!);
            userManager
                .Setup(m => m.FindByEmailAsync(It.IsAny<string>()))
                .ReturnsAsync(existing);
            // Rejet deterministe apres l'ouverture de la transaction : les tests qui traversent la
            // validation s'arretent ici, sur une erreur identifiable et sans effet de bord.
            userManager
                .Setup(m => m.CreateAsync(It.IsAny<ApplicationUser>(), It.IsAny<string>()))
                .ReturnsAsync(IdentityResult.Failed(new IdentityError
                {
                    Code = "TestDoubleStopsHere",
                    Description = "Creation d'utilisateur neutralisee dans les tests."
                }));
            return userManager;
        }
    }
}
