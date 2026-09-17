using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Duplication de la configuration DM entre deux dossiers du cabinet. Le test central n'est pas la
/// copie — c'est le refus : un identifiant de dossier reçu de la requête ne doit jamais suffire à
/// lire la base d'un autre tenant.
/// </summary>
public sealed class MonthlyDeclarationConfigDuplicatorTests
{
    private const string SourceConnection = "Server=source";

    private readonly Guid _firmTenantId = Guid.NewGuid();
    private readonly Guid _sourceTenantId = Guid.NewGuid();
    private readonly string _sourceDb = $"DupSource_{Guid.NewGuid()}";
    private readonly string _destinationDb = $"DupDestination_{Guid.NewGuid()}";

    /// <summary>
    /// Deux bases distinctes derrière une seule fabrique : la chaîne de connexion sélectionne la
    /// source, son absence la destination — exactement le partage qu'opère la vraie fabrique.
    /// </summary>
    private sealed class TwoTenantContextFactory : ITenantDbContextFactory
    {
        private readonly string _destination;
        private readonly string _source;

        public TwoTenantContextFactory(string destination, string source)
        {
            _destination = destination;
            _source = source;
        }

        public TenantDbContext CreateContext() => Build(_destination);

        public TenantDbContext CreateIsolatedContext() => Build(_destination);

        public TenantDbContext CreateIsolatedContext(string connectionString) =>
            Build(connectionString == SourceConnection ? _source : _destination);

        private static TenantDbContext Build(string databaseName) =>
            new(new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName)
                .Options);
    }

    private MasterDbContext CreateMaster(string name) =>
        new(new DbContextOptionsBuilder<MasterDbContext>().UseInMemoryDatabase(name).Options);

    private ICurrentUser User(bool delegatedFirm = true, Guid? tenantId = null)
    {
        var mock = new Mock<ICurrentUser>();
        mock.SetupGet(u => u.Email).Returns("comptable@cabinet.tn");
        mock.SetupGet(u => u.TenantId).Returns(tenantId ?? _firmTenantId);
        mock.SetupGet(u => u.UserId).Returns(Guid.NewGuid());
        mock.SetupGet(u => u.Role).Returns(UserRole.FirmManager);
        mock.SetupGet(u => u.IsAccountingFirmDelegatedContext).Returns(delegatedFirm);
        return mock.Object;
    }

    private ITenantService TenantService()
    {
        var mock = new Mock<ITenantService>();
        mock.Setup(s => s.GetConnectionStringAsync(_sourceTenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(SourceConnection);
        return mock.Object;
    }

    private async Task SeedSourceRubricAsync(TwoTenantContextFactory factory, string code = "F9_3_1")
    {
        await using var source = factory.CreateIsolatedContext(SourceConnection);
        var rubric = MonthlyDeclarationRubric.Create(
            MonthlyDeclarationFamily.Tcl, code, "Le chiffre d'affaires brut local", "3.1",
            RubricGrossKind.Account, RubricWithheldKind.GrossTimesRate,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0.2m, null, null, null, null, null, null,
            new[] { new RubricAccountInput(RubricAccountRole.Gross, "707", RubricAccountMatchMode.Prefix) }).Value;
        rubric.SetAuditInfo("source");
        source.MonthlyDeclarationRubrics.Add(rubric);
        await source.SaveChangesAsync();
    }

    private async Task LinkToPortfolioAsync(MasterDbContext master)
    {
        var assignment = FirmClientAssignment.CreateByFirm(
            _sourceTenantId, _firmTenantId, Guid.NewGuid()).Value;
        master.FirmClientAssignments.Add(assignment);
        await master.SaveChangesAsync();
    }

    /// <summary>
    /// <b>Le test qui compte.</b> Un dossier qui n'est pas au portefeuille du cabinet appelant n'est
    /// pas lisible, quoi que dise la requête.
    /// </summary>
    [Fact]
    public async Task Un_dossier_hors_portefeuille_est_refuse()
    {
        var factory = new TwoTenantContextFactory(_destinationDb, _sourceDb);
        await SeedSourceRubricAsync(factory);
        await using var master = CreateMaster($"DupMaster_{Guid.NewGuid()}");

        var duplicator = new MonthlyDeclarationConfigDuplicator(
            master, TenantService(), factory, User());

        var result = await duplicator.DuplicateAsync(_sourceTenantId, overwrite: false);

        Assert.True(result.IsFailure);
        Assert.Contains("portefeuille", result.Error.Description);

        await using var destination = factory.CreateContext();
        Assert.Empty(destination.MonthlyDeclarationRubrics);
    }

    [Fact]
    public async Task Un_dossier_du_portefeuille_est_copie_avec_de_nouveaux_identifiants()
    {
        var factory = new TwoTenantContextFactory(_destinationDb, _sourceDb);
        await SeedSourceRubricAsync(factory);
        await using var master = CreateMaster($"DupMaster_{Guid.NewGuid()}");
        await LinkToPortfolioAsync(master);

        var duplicator = new MonthlyDeclarationConfigDuplicator(
            master, TenantService(), factory, User());

        var result = await duplicator.DuplicateAsync(_sourceTenantId, overwrite: false);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.Inserted);

        await using var source = factory.CreateIsolatedContext(SourceConnection);
        await using var destination = factory.CreateContext();
        var copied = await destination.MonthlyDeclarationRubrics.Include(r => r.Accounts)
            .SingleAsync(r => r.Code == "F9_3_1");
        var original = await source.MonthlyDeclarationRubrics.AsNoTracking()
            .SingleAsync(r => r.Code == "F9_3_1");

        Assert.NotEqual(original.Id, copied.Id);
        Assert.Equal("Le chiffre d'affaires brut local", copied.Label);
        Assert.Equal(0.2m, copied.RatePercent);
        Assert.Equal("707", Assert.Single(copied.Accounts).AccountNumber);
    }

    private async Task SeedLocalRubricAsync(TwoTenantContextFactory factory)
    {
        await using var destination = factory.CreateContext();
        var local = MonthlyDeclarationRubric.Create(
            MonthlyDeclarationFamily.Tcl, "F9_3_1", "Libelle local", "3.1",
            RubricGrossKind.Fixed, RubricWithheldKind.Fixed,
            AccountBalanceSide.Credit, AccountBalanceSide.Credit,
            0m, null, null, null, null, null, null, Array.Empty<RubricAccountInput>()).Value;
        local.SetAuditInfo("destination");
        destination.MonthlyDeclarationRubrics.Add(local);
        await destination.SaveChangesAsync();
    }

    [Fact]
    public async Task Sans_remplacement_les_codes_deja_presents_sont_ignores_et_signales()
    {
        var factory = new TwoTenantContextFactory(_destinationDb, _sourceDb);
        await SeedSourceRubricAsync(factory);
        await SeedLocalRubricAsync(factory);
        await using var master = CreateMaster($"DupMaster_{Guid.NewGuid()}");
        await LinkToPortfolioAsync(master);

        var duplicator = new MonthlyDeclarationConfigDuplicator(
            master, TenantService(), factory, User());

        var result = await duplicator.DuplicateAsync(_sourceTenantId, overwrite: false);

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.Inserted);
        Assert.Equal("F9_3_1", Assert.Single(result.Value.SkippedCodes));

        await using var check = factory.CreateContext();
        Assert.Equal("Libelle local",
            (await check.MonthlyDeclarationRubrics.SingleAsync(r => r.Code == "F9_3_1")).Label);
    }

    [Fact]
    public async Task Avec_remplacement_les_codes_en_commun_sont_reecrits()
    {
        var factory = new TwoTenantContextFactory(_destinationDb, _sourceDb);
        await SeedSourceRubricAsync(factory);
        await SeedLocalRubricAsync(factory);
        await using var master = CreateMaster($"DupMaster_{Guid.NewGuid()}");
        await LinkToPortfolioAsync(master);

        var duplicator = new MonthlyDeclarationConfigDuplicator(
            master, TenantService(), factory, User());

        var result = await duplicator.DuplicateAsync(_sourceTenantId, overwrite: true);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.Replaced);

        await using var check = factory.CreateContext();
        var rubric = await check.MonthlyDeclarationRubrics.Include(r => r.Accounts)
            .SingleAsync(r => r.Code == "F9_3_1");
        Assert.Equal("Le chiffre d'affaires brut local", rubric.Label);
        Assert.Equal(0.2m, rubric.RatePercent);
        Assert.Single(rubric.Accounts);
    }

    [Fact]
    public async Task Un_cabinet_appelant_inconnu_est_refuse()
    {
        var factory = new TwoTenantContextFactory(_destinationDb, _sourceDb);
        await using var master = CreateMaster($"DupMaster_{Guid.NewGuid()}");

        var duplicator = new MonthlyDeclarationConfigDuplicator(
            master, TenantService(), factory, User(tenantId: Guid.Empty));

        var result = await duplicator.DuplicateAsync(_sourceTenantId, overwrite: false);

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Un_dossier_source_sans_rubrique_est_refuse_plutot_que_de_ne_rien_faire()
    {
        var factory = new TwoTenantContextFactory(_destinationDb, _sourceDb);
        await using var master = CreateMaster($"DupMaster_{Guid.NewGuid()}");
        await LinkToPortfolioAsync(master);

        var duplicator = new MonthlyDeclarationConfigDuplicator(
            master, TenantService(), factory, User());

        var result = await duplicator.DuplicateAsync(_sourceTenantId, overwrite: false);

        Assert.True(result.IsFailure);
        Assert.Contains("aucune rubrique", result.Error.Description);
    }
}
