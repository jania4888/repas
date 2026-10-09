using System.Text;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Table de correspondance appliquée à l'import de référentiels (balance d'ouverture).
/// Le contrôle structurant est le TEST DE GEL : sans table fournie, l'aperçu est rigoureusement
/// identique à celui produit avant l'ajout de la fonctionnalité.
/// </summary>
public sealed class ReferenceImportAccountMappingTests
{
    private readonly string _dbName = $"RefMapDb_{Guid.NewGuid()}";
    private readonly TestTenantDbContextFactory _factory;

    public ReferenceImportAccountMappingTests()
    {
        _factory = new TestTenantDbContextFactory(_dbName);
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

    private ReferenceDataImportService BuildService()
    {
        var periodService = new Mock<IAccountingPeriodService>();
        periodService.Setup(x => x.EnsureOpenPeriodAsync(It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((DateTime d, CancellationToken _) =>
            {
                var p = AccountingPeriod.Create(d.Year, d.Month, new DateTime(d.Year, d.Month, 1), new DateTime(d.Year, d.Month, 28));
                p.SetAuditInfo("test", false);
                return Result.Success(p);
            });
        var projection = new Mock<IBankGlTreasuryProjectionService>();
        projection.Setup(p => p.EnsureMissingAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new BankGlProjectionEnsureResult(0, 0)));
        return new ReferenceDataImportService(_factory, periodService.Object,
            Options.Create(new AccountingSettings { DossierImportEnabled = true }),
            projection.Object,
            NullLogger<ReferenceDataImportService>.Instance);
    }

    private void SeedChart(params string[] accounts)
    {
        using var ctx = _factory.CreateContext();
        foreach (var a in accounts)
            ctx.ChartOfAccounts.Add(ChartOfAccount.Create(a, $"Compte {a}", int.Parse(a[..1]), null, AccountNatureType.Debit).Value);
        ctx.SaveChanges();
    }

    private static byte[] Csv(string content) => Encoding.UTF8.GetBytes(content);

    /// <summary>Balance équilibrée exprimée avec les comptes de l'ANCIEN progiciel.</summary>
    private static byte[] ForeignBalance() => Csv("compte;debit;credit\n411000;1000;0\n101000;0;1000\n");

    // ── Test de gel ────────────────────────────────────────────────────────────

    [Fact]
    public async Task WithoutMapping_BehaviourIsUnchanged()
    {
        SeedChart("4111", "101");

        var preview = await BuildService().PreviewAsync(
            ForeignBalance(), ReferenceImportTarget.OpeningBalance, JournalImportFormat.Csv, 2026);

        Assert.True(preview.IsSuccess);
        // Comptes étrangers non traduits ⇒ refus, exactement comme avant la fonctionnalité.
        Assert.False(preview.Value.CanCommit);
        Assert.Contains(preview.Value.Issues, i => i.Message.Contains("absent du plan comptable"));
        Assert.Equal(0, preview.Value.MappedAccountCount);
        Assert.Empty(preview.Value.UnusedMappings);
    }

    // ── Traduction effective ───────────────────────────────────────────────────

    [Fact]
    public async Task WithMapping_ForeignAccountsAreAccepted()
    {
        SeedChart("4111", "101");
        var mapping = Csv("source;cible\n411000;4111\n101000;101\n");

        var preview = await BuildService().PreviewAsync(
            ForeignBalance(), ReferenceImportTarget.OpeningBalance, JournalImportFormat.Csv, 2026, mapping);

        Assert.True(preview.IsSuccess);
        Assert.True(preview.Value.CanCommit);          // accepté là où il échouait
        Assert.Equal(2, preview.Value.MappedAccountCount);
    }

    [Fact]
    public async Task WithMapping_CommitCreatesEntryOnTargetAccounts()
    {
        SeedChart("4111", "101");
        var mapping = Csv("source;cible\n411000;4111\n101000;101\n");

        var commit = await BuildService().CommitAsync(
            ForeignBalance(), ReferenceImportTarget.OpeningBalance, JournalImportFormat.Csv, 2026, mapping);

        Assert.True(commit.IsSuccess);

        using var ctx = _factory.CreateContext();
        var entry = await ctx.JournalEntries.Include(e => e.Lines).SingleAsync();
        // Les écritures portent les comptes CIBLES, pas ceux du fichier source.
        Assert.Contains(entry.Lines, l => l.AccountNumber == "4111");
        Assert.Contains(entry.Lines, l => l.AccountNumber == "101");
        Assert.DoesNotContain(entry.Lines, l => l.AccountNumber == "411000");
    }

    // ── Table incohérente ──────────────────────────────────────────────────────

    [Fact]
    public async Task MappingTargetAbsentFromChart_IsBlocking()
    {
        SeedChart("4111", "101");
        // 999 n'existe pas au plan : c'est une erreur de TABLE, pas de données.
        var mapping = Csv("source;cible\n411000;999\n101000;101\n");

        var preview = await BuildService().PreviewAsync(
            ForeignBalance(), ReferenceImportTarget.OpeningBalance, JournalImportFormat.Csv, 2026, mapping);

        Assert.True(preview.IsSuccess);
        Assert.False(preview.Value.CanCommit);
        Assert.Contains(preview.Value.Issues,
            i => i.IsBlocking && i.Ref == "correspondance" && i.Message.Contains("999"));
    }

    [Fact]
    public async Task UnusedMapping_IsReportedWithoutBlocking()
    {
        SeedChart("4111", "101", "607");
        var mapping = Csv("source;cible\n411000;4111\n101000;101\n888888;607\n");

        var preview = await BuildService().PreviewAsync(
            ForeignBalance(), ReferenceImportTarget.OpeningBalance, JournalImportFormat.Csv, 2026, mapping);

        Assert.True(preview.IsSuccess);
        Assert.True(preview.Value.CanCommit);                       // non bloquant
        Assert.Equal(new[] { "888888" }, preview.Value.UnusedMappings);
    }

    [Fact]
    public async Task Mapping_OnThirdPartiesTarget_IsRejected()
    {
        // Le plan tiers ne porte pas de numéros de compte : la table n'a pas de sens ici.
        var mapping = Csv("source;cible\n411000;4111\n");
        var csv = Csv("type;nom;email;rue;ville;gouvernorat\nclient;Alpha;a@x.tn;Rue A;Tunis;Tunis\n");

        var preview = await BuildService().PreviewAsync(
            csv, ReferenceImportTarget.ThirdParties, JournalImportFormat.Csv, null, mapping);

        Assert.True(preview.IsSuccess);
        Assert.False(preview.Value.CanCommit);
        Assert.Contains(preview.Value.Issues, i => i.IsBlocking && i.Message.Contains("plan tiers"));
    }
}
