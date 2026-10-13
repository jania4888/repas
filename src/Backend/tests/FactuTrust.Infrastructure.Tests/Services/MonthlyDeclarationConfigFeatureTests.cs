using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Accounting;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Configuration DM — CRUD des rubriques, inclusion des familles, changement de régime, et les
/// deux verrous qui gardent l'écriture : le drapeau et le contexte cabinet délégué.
/// </summary>
public sealed class MonthlyDeclarationConfigFeatureTests
{
    private readonly TestTenantDbContextFactory _factory;
    private readonly MonthlyDeclarationConfigRepository _repository;

    public MonthlyDeclarationConfigFeatureTests()
    {
        _factory = new TestTenantDbContextFactory($"MonthlyDeclarationDb_{Guid.NewGuid()}");
        _repository = new MonthlyDeclarationConfigRepository(_factory);

        // Tout dossier porte son catalogue : sans son marqueur, les écritures de configuration sont
        // refusées — c'est la garde qui empêche d'écrire par-dessus une pose en échec.
        using var context = _factory.CreateContext();
        context.MonthlyDeclarationRubricSeedLogs.Add(
            MonthlyDeclarationRubricSeedLog.Create(MonthlyDeclarationCatalogReset.ResetVersion).Value);
        context.SaveChanges();
    }

    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _databaseName;
        public TestTenantDbContextFactory(string databaseName) => _databaseName = databaseName;
        public TenantDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName: _databaseName)
                .Options;
            return new TenantDbContext(options);
        }
    }

    /// <summary>
    /// Le drapeau n'est actif qu'en conjonction avec la déclaration mensuelle unique : les scalaires
    /// que le moteur alimente n'existent que sous V2.
    /// </summary>
    private static IOptions<AccountingSettings> Settings(bool enabled = true) =>
        Options.Create(new AccountingSettings
        {
            MonthlyDeclarationV2Enabled = enabled,
            MonthlyDeclarationConfigurableLinesEnabled = enabled
        });

    private static ICurrentUser User(bool delegatedFirm = true)
    {
        var mock = new Mock<ICurrentUser>();
        mock.SetupGet(u => u.Email).Returns("comptable@cabinet.tn");
        mock.SetupGet(u => u.IsAccountingFirmDelegatedContext).Returns(delegatedFirm);
        return mock.Object;
    }

    private static IAuditService Audit() => new Mock<IAuditService>().Object;

    private static CreateMonthlyDeclarationRubricRequest CreateRequest(
        string code = "F9_3_1",
        MonthlyDeclarationFamily family = MonthlyDeclarationFamily.Tcl,
        RubricGrossKind grossKind = RubricGrossKind.Account,
        RubricWithheldKind withheldKind = RubricWithheldKind.GrossTimesRate,
        decimal rate = 0.2m,
        IReadOnlyList<MonthlyDeclarationRubricAccountDto>? accounts = null) => new()
        {
            Family = (int)family,
            Code = code,
            Label = "Le chiffre d'affaires brut local",
            ReportCode = "3.1",
            GrossKind = (int)grossKind,
            WithheldKind = (int)withheldKind,
            GrossSide = (int)AccountBalanceSide.Credit,
            WithheldSide = (int)AccountBalanceSide.Credit,
            RatePercent = rate,
            Accounts = accounts ?? new[]
            {
                new MonthlyDeclarationRubricAccountDto
                {
                    Role = (int)RubricAccountRole.Gross,
                    AccountNumber = "707",
                    MatchMode = (int)RubricAccountMatchMode.Prefix
                }
            }
        };

    private CreateMonthlyDeclarationRubricCommandHandler CreateHandler(
        bool enabled = true, bool delegatedFirm = true) =>
        new(_repository, Audit(), User(delegatedFirm), Settings(enabled));

    private async Task<Guid> SeedRubricAsync(string code = "F9_3_1")
    {
        var result = await CreateHandler().Handle(
            new CreateMonthlyDeclarationRubricCommand(CreateRequest(code)), CancellationToken.None);
        Assert.True(result.IsSuccess);
        return result.Value;
    }

    // ── Verrous d'écriture ────────────────────────────────────────────────────

    [Fact]
    public async Task Drapeau_eteint_toute_ecriture_est_refusee()
    {
        var result = await CreateHandler(enabled: false).Handle(
            new CreateMonthlyDeclarationRubricCommand(CreateRequest()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.MonthlyDeclaration", result.Error.Code);
    }

    /// <summary>
    /// Le drapeau propre à la fonctionnalité ne suffit pas : sans la déclaration mensuelle unique,
    /// aucun des scalaires alimentés par le moteur n'est calculé ni persisté.
    /// </summary>
    [Fact]
    public async Task Sans_la_declaration_mensuelle_unique_le_drapeau_reste_inerte()
    {
        var settings = Options.Create(new AccountingSettings
        {
            MonthlyDeclarationV2Enabled = false,
            MonthlyDeclarationConfigurableLinesEnabled = true
        });
        var handler = new CreateMonthlyDeclarationRubricCommandHandler(
            _repository, Audit(), User(), settings);

        var result = await handler.Handle(
            new CreateMonthlyDeclarationRubricCommand(CreateRequest()), CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    /// <summary>
    /// Même verrou que l'enregistrement de la déclaration elle-même : une société ne modifie pas la
    /// configuration fiscale de son propre dossier.
    /// </summary>
    [Fact]
    public async Task Hors_contexte_cabinet_delegue_l_ecriture_est_refusee()
    {
        var result = await CreateHandler(delegatedFirm: false).Handle(
            new CreateMonthlyDeclarationRubricCommand(CreateRequest()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("cabinet comptable", result.Error.Description);
    }

    /// <summary>
    /// La lecture, elle, reste ouverte : l'écran doit pouvoir expliquer l'inactivité plutôt que
    /// tomber en erreur, et la configuration amorcée n'est que de la donnée de référence.
    /// </summary>
    [Fact]
    public async Task Drapeau_eteint_la_lecture_reussit_et_signale_l_inactivite()
    {
        var handler = new GetMonthlyDeclarationConfigurationQueryHandler(_repository, Settings(enabled: false));

        var result = await handler.Handle(
            new GetMonthlyDeclarationConfigurationQuery(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Settings.ConfigurableLinesEnabled);
        Assert.Equal((int)MonthlyDeclarationMode.Legacy, result.Value.Settings.Mode);
    }

    // ── Lecture ───────────────────────────────────────────────────────────────

    /// <summary>
    /// L'écran affiche onze onglets qu'une ligne existe en base ou non : les familles jamais
    /// amorcées sont rendues explicitement à « non incluse ».
    /// </summary>
    [Fact]
    public async Task La_lecture_rend_les_onze_familles_meme_sans_amorcage()
    {
        var handler = new GetMonthlyDeclarationConfigurationQueryHandler(_repository, Settings());

        var result = await handler.Handle(
            new GetMonthlyDeclarationConfigurationQuery(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(Enum.GetValues<MonthlyDeclarationFamily>().Length, result.Value.Families.Count);
        Assert.All(result.Value.Families, f => Assert.False(f.IsIncluded));
    }

    [Fact]
    public async Task La_lecture_restitue_la_rubrique_et_ses_comptes()
    {
        await SeedRubricAsync();

        var handler = new GetMonthlyDeclarationConfigurationQueryHandler(_repository, Settings());
        var result = await handler.Handle(
            new GetMonthlyDeclarationConfigurationQuery(), CancellationToken.None);

        var rubric = Assert.Single(result.Value.Rubrics);
        Assert.Equal("F9_3_1", rubric.Code);
        Assert.Equal((int)MonthlyDeclarationFamily.Tcl, rubric.Family);
        Assert.Equal("3.1", rubric.ReportCode);
        var account = Assert.Single(rubric.Accounts);
        Assert.Equal("707", account.AccountNumber);
        Assert.Equal((int)RubricAccountMatchMode.Prefix, account.MatchMode);
    }

    // ── Écriture ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Un_code_deja_pris_est_refuse_par_un_conflit_lisible()
    {
        await SeedRubricAsync("F9_3_1");

        var result = await CreateHandler().Handle(
            new CreateMonthlyDeclarationRubricCommand(CreateRequest("f9_3_1")), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("existe déjà", result.Error.Description);
    }

    /// <summary>
    /// Une valeur d'énumération arbitraire venue de la requête est refusée avant d'atteindre le
    /// domaine : un cast direct produirait une valeur que plus rien ne détecterait ensuite.
    /// </summary>
    [Theory]
    [InlineData(42, 0, 0)]
    [InlineData(5, 99, 0)]
    [InlineData(5, 0, 77)]
    public async Task Une_enumeration_hors_bornes_est_refusee(int family, int grossKind, int withheldKind)
    {
        var request = CreateRequest() with
        {
            Family = family,
            GrossKind = grossKind,
            WithheldKind = withheldKind,
            RatePercent = 1m
        };

        var result = await CreateHandler().Handle(
            new CreateMonthlyDeclarationRubricCommand(request), CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Un_role_de_compte_hors_bornes_est_refuse()
    {
        var request = CreateRequest(accounts: new[]
        {
            new MonthlyDeclarationRubricAccountDto { Role = 9, AccountNumber = "707", MatchMode = 0 }
        });

        var result = await CreateHandler().Handle(
            new CreateMonthlyDeclarationRubricCommand(request), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("Rôle de compte inconnu", result.Error.Description);
    }

    [Fact]
    public async Task La_mise_a_jour_remplace_la_selection_de_comptes_en_base()
    {
        var id = await SeedRubricAsync();

        var handler = new UpdateMonthlyDeclarationRubricCommandHandler(
            _repository, Audit(), User(), Settings());

        var result = await handler.Handle(new UpdateMonthlyDeclarationRubricCommand(id, new()
        {
            Label = "CA brut local (révisé)",
            ReportCode = "3.1",
            GrossKind = (int)RubricGrossKind.Account,
            WithheldKind = (int)RubricWithheldKind.GrossTimesRate,
            GrossSide = (int)AccountBalanceSide.Credit,
            WithheldSide = (int)AccountBalanceSide.Credit,
            RatePercent = 0.1m,
            Accounts = new[]
            {
                new MonthlyDeclarationRubricAccountDto
                {
                    Role = (int)RubricAccountRole.Gross, AccountNumber = "705",
                    MatchMode = (int)RubricAccountMatchMode.Prefix
                }
            }
        }), CancellationToken.None);

        Assert.True(result.IsSuccess);

        var reloaded = await _repository.GetRubricByIdAsync(id);
        Assert.NotNull(reloaded);
        Assert.Equal("CA brut local (révisé)", reloaded!.Label);
        Assert.Equal(0.1m, reloaded.RatePercent);
        var account = Assert.Single(reloaded.Accounts);
        Assert.Equal("705", account.AccountNumber);
    }

    [Fact]
    public async Task La_bascule_d_activite_est_persistee()
    {
        var id = await SeedRubricAsync();
        var handler = new ToggleMonthlyDeclarationRubricCommandHandler(
            _repository, Audit(), User(), Settings());

        Assert.True((await handler.Handle(
            new ToggleMonthlyDeclarationRubricCommand(id), CancellationToken.None)).IsSuccess);

        var reloaded = await _repository.GetRubricByIdAsync(id);
        Assert.False(reloaded!.IsActive);
    }

    [Fact]
    public async Task La_suppression_retire_la_rubrique_et_ses_comptes()
    {
        var id = await SeedRubricAsync();
        var handler = new DeleteMonthlyDeclarationRubricCommandHandler(
            _repository, Audit(), User(), Settings());

        Assert.True((await handler.Handle(
            new DeleteMonthlyDeclarationRubricCommand(id), CancellationToken.None)).IsSuccess);

        Assert.Null(await _repository.GetRubricByIdAsync(id));
        await using var context = _factory.CreateContext();
        Assert.Empty(context.MonthlyDeclarationRubricAccounts.Where(a => a.RubricId == id));
    }

    // ── Familles et régime ────────────────────────────────────────────────────

    [Fact]
    public async Task L_inclusion_d_une_famille_est_creee_puis_mise_a_jour_sur_la_meme_ligne()
    {
        var handler = new SetMonthlyDeclarationFamilyCommandHandler(
            _repository, Audit(), User(), Settings());

        await handler.Handle(new SetMonthlyDeclarationFamilyCommand(
            new() { Family = (int)MonthlyDeclarationFamily.Tcl, IsIncluded = true }), CancellationToken.None);
        await handler.Handle(new SetMonthlyDeclarationFamilyCommand(
            new() { Family = (int)MonthlyDeclarationFamily.Tcl, IsIncluded = false }), CancellationToken.None);

        var families = await _repository.GetFamilySettingsAsync();
        var tcl = Assert.Single(families, f => f.Family == MonthlyDeclarationFamily.Tcl);
        Assert.False(tcl.IsIncluded);
    }

    [Fact]
    public async Task Une_famille_inconnue_est_refusee()
    {
        var handler = new SetMonthlyDeclarationFamilyCommandHandler(
            _repository, Audit(), User(), Settings());

        var result = await handler.Handle(new SetMonthlyDeclarationFamilyCommand(
            new() { Family = 1234, IsIncluded = true }), CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    /// <summary>
    /// La bascule directe vers le mode configuré est refusée par le domaine ; la commande doit la
    /// relayer telle quelle, sans écrire de réglage.
    /// </summary>
    [Fact]
    public async Task Le_passage_direct_en_mode_configure_est_refuse_et_n_ecrit_rien()
    {
        var handler = new SetMonthlyDeclarationModeCommandHandler(
            _repository, Audit(), User(), Settings());

        var result = await handler.Handle(new SetMonthlyDeclarationModeCommand(new()
        {
            Mode = (int)MonthlyDeclarationMode.Configured,
            ConfiguredSince = new DateTime(2026, 10, 1),
            OverrideReason = "bascule immédiate"
        }), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Null(await _repository.GetSettingsAsync());
    }

    [Fact]
    public async Task Le_passage_en_controle_de_parite_est_persiste()
    {
        var handler = new SetMonthlyDeclarationModeCommandHandler(
            _repository, Audit(), User(), Settings());

        var result = await handler.Handle(new SetMonthlyDeclarationModeCommand(
            new() { Mode = (int)MonthlyDeclarationMode.Parity }), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var settings = await _repository.GetSettingsAsync();
        Assert.NotNull(settings);
        Assert.Equal(MonthlyDeclarationMode.Parity, settings!.Mode);
    }

    [Fact]
    public async Task Un_regime_inconnu_est_refuse()
    {
        var handler = new SetMonthlyDeclarationModeCommandHandler(
            _repository, Audit(), User(), Settings());

        var result = await handler.Handle(new SetMonthlyDeclarationModeCommand(
            new() { Mode = 77 }), CancellationToken.None);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Le_changement_de_regime_exige_le_contexte_cabinet_delegue()
    {
        var handler = new SetMonthlyDeclarationModeCommandHandler(
            _repository, Audit(), User(delegatedFirm: false), Settings());

        var result = await handler.Handle(new SetMonthlyDeclarationModeCommand(
            new() { Mode = (int)MonthlyDeclarationMode.Parity }), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Null(await _repository.GetSettingsAsync());
    }
}
