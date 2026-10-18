using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Repositories;

/// <summary>
/// Isolation entre dossiers du rapprochement par matricule fiscal (plan « Matricule fiscal sur les
/// comptes auxiliaires »).
///
/// <para>
/// Même principe que <see cref="ProductBarcodeTenantIsolationTests"/> : l'isolation est
/// <b>physique</b> (une base par dossier). Le cas qui compte le plus est celui du <b>même
/// matricule fiscal chez deux dossiers</b> — deux cabinets comptables qui suivent le même
/// client final auraient chacun un compte auxiliaire portant ce matricule, et le rapprochement
/// à l'import d'un dossier ne doit jamais traverser vers le compte de l'autre.
/// </para>
/// </summary>
public sealed class ChartOfAccountFiscalIdTenantIsolationTests : IDisposable
{
    private const string SharedFiscalId = "1525071P/B/M/000";
    private const string SharedFiscalIdNormalized = "1525071PBM000";

    private readonly SwitchableTenantDbContextFactory _factory;
    private readonly ChartOfAccountRepository _repository;

    public ChartOfAccountFiscalIdTenantIsolationTests()
    {
        var suffix = Guid.NewGuid().ToString("N");
        _factory = new SwitchableTenantDbContextFactory(
            $"TestDb_FiscalIdIsoTenantA_{suffix}",
            $"TestDb_FiscalIdIsoTenantB_{suffix}");

        var tenantContext = new Mock<FactuTrust.Application.Common.Interfaces.ITenantContext>().Object;
        var cache = new Mock<IMemoryCache>().Object;
        _repository = new ChartOfAccountRepository(_factory, tenantContext, new TenantAmbientTransaction(), cache);
    }

    /// <summary>Une base par dossier, comme en production. La bascule imite le middleware.</summary>
    private sealed class SwitchableTenantDbContextFactory : ITenantDbContextFactory
    {
        public string TenantA { get; }
        public string TenantB { get; }

        private string _current;

        public SwitchableTenantDbContextFactory(string tenantA, string tenantB)
        {
            TenantA = tenantA;
            TenantB = tenantB;
            _current = tenantA;
        }

        public void SwitchTo(string database) => _current = database;

        public TenantDbContext CreateContext() => Create(_current);

        public static TenantDbContext Create(string database)
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName: database)
                .Options;
            return new TenantDbContext(options);
        }
    }

    private static Guid SeedAuxiliaryAccount(
        string database, string accountNumber, string label, AccountType accountType, string? fiscalId)
    {
        var account = ChartOfAccount.Create(
            accountNumber, label, int.Parse(accountNumber[..1].ToString()), null, AccountNatureType.Debit,
            accountType: accountType, isAuxiliary: true, fiscalId: fiscalId).Value;

        using var context = SwitchableTenantDbContextFactory.Create(database);
        context.ChartOfAccounts.Add(account);
        context.SaveChanges();
        return account.Id;
    }

    public void Dispose()
    {
        using (var a = SwitchableTenantDbContextFactory.Create(_factory.TenantA)) a.Database.EnsureDeleted();
        using (var b = SwitchableTenantDbContextFactory.Create(_factory.TenantB)) b.Database.EnsureDeleted();
    }

    [Fact]
    public async Task FindByFiscalId_NeverCrossesTheTenantBoundary()
    {
        SeedAuxiliaryAccount(_factory.TenantA, "41105", "Ste Slimen", AccountType.Client, SharedFiscalId);

        _factory.SwitchTo(_factory.TenantB);
        var fromB = await _repository.FindAuxiliaryByFiscalIdAsync(AccountType.Client, SharedFiscalIdNormalized, CancellationToken.None);

        Assert.Null(fromB);

        _factory.SwitchTo(_factory.TenantA);
        Assert.NotNull(await _repository.FindAuxiliaryByFiscalIdAsync(AccountType.Client, SharedFiscalIdNormalized, CancellationToken.None));
    }

    [Fact]
    public async Task TheSameFiscalIdMayLiveInTwoTenantsAndResolveToEachOnesAccount()
    {
        // Deux dossiers peuvent parfaitement suivre le même client final : le matricule fiscal
        // est unique PAR DOSSIER, jamais globalement.
        var idA = SeedAuxiliaryAccount(_factory.TenantA, "41105", "Ste Slimen A", AccountType.Client, SharedFiscalId);
        var idB = SeedAuxiliaryAccount(_factory.TenantB, "41106", "Ste Slimen B", AccountType.Client, SharedFiscalId);

        _factory.SwitchTo(_factory.TenantA);
        var fromA = await _repository.FindAuxiliaryByFiscalIdAsync(AccountType.Client, SharedFiscalIdNormalized, CancellationToken.None);

        _factory.SwitchTo(_factory.TenantB);
        var fromB = await _repository.FindAuxiliaryByFiscalIdAsync(AccountType.Client, SharedFiscalIdNormalized, CancellationToken.None);

        Assert.Equal(idA, fromA!.Id);
        Assert.Equal(idB, fromB!.Id);
        Assert.NotEqual(fromA.Id, fromB.Id);
    }

    [Fact]
    public async Task ListActiveAuxiliaryAccounts_NeverReturnsAnotherTenantsAccount()
    {
        SeedAuxiliaryAccount(_factory.TenantA, "41105", "Ste Slimen", AccountType.Client, SharedFiscalId);

        _factory.SwitchTo(_factory.TenantB);

        var candidates = await _repository.ListActiveAuxiliaryAccountsAsync(AccountType.Client, "41", 5000, CancellationToken.None);

        Assert.Empty(candidates);
    }

    [Fact]
    public async Task TheDetectionItselfWorks()
    {
        // Contrôle positif : sans lui, les tests précédents passeraient tout aussi bien avec un
        // repository qui ne renvoie jamais rien.
        SeedAuxiliaryAccount(_factory.TenantB, "41105", "Ste Slimen", AccountType.Client, SharedFiscalId);

        _factory.SwitchTo(_factory.TenantB);

        Assert.NotNull(await _repository.FindAuxiliaryByFiscalIdAsync(AccountType.Client, SharedFiscalIdNormalized, CancellationToken.None));
        Assert.NotEmpty(await _repository.ListActiveAuxiliaryAccountsAsync(AccountType.Client, "41", 5000, CancellationToken.None));
    }
}
