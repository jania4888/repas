using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Repositories;

/// <summary>
/// Agrégation des mouvements par compte consommée par la déclaration mensuelle paramétrable.
/// Ce qui est vérifié ici n'est pas une somme — c'est la politique : brouillons exclus, extournes
/// exclues, fenêtre stricte, et une seule requête quel que soit le nombre de comptes.
/// </summary>
public sealed class JournalEntrySumMovementsTests
{
    private readonly TestTenantDbContextFactory _factory;
    private readonly JournalEntryRepository _repository;
    private readonly Guid _periodId = Guid.NewGuid();
    private int _entryNumber;

    public JournalEntrySumMovementsTests()
    {
        _factory = new TestTenantDbContextFactory($"SumMovementsDb_{Guid.NewGuid()}");
        _repository = new JournalEntryRepository(_factory);
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

    private async Task<JournalEntry> SeedAsync(
        string debitAccount,
        string creditAccount,
        decimal amount,
        DateTime date,
        JournalEntryStatus status = JournalEntryStatus.Validee,
        bool reversed = false)
    {
        var entry = JournalEntry.Create(
            ++_entryNumber, "JV", date, "Écriture de test", _periodId, false, "Manual", null,
            new[]
            {
                new JournalLineInput(debitAccount, "Débit", amount, 0m, null, ThirdPartyKind.None),
                new JournalLineInput(creditAccount, "Crédit", 0m, amount, null, ThirdPartyKind.None)
            },
            initialStatus: status).Value;

        if (reversed)
            entry.MarkReversedBy(Guid.NewGuid());

        entry.SetAuditInfo("test");

        await using var context = _factory.CreateContext();
        context.JournalEntries.Add(entry);
        await context.SaveChangesAsync();
        return entry;
    }

    private static readonly DateTime From = new(2026, 9, 1);
    private static readonly DateTime To = new(2026, 9, 30);

    private Task<IReadOnlyDictionary<string, AccountPeriodMovement>> SumAsync(
        string[]? exact = null, string[]? prefixes = null) =>
        _repository.SumMovementsByAccountsAsync(
            exact ?? Array.Empty<string>(), prefixes ?? Array.Empty<string>(), From, To);

    [Fact]
    public async Task Sans_aucun_compte_demande_rien_n_est_interroge()
    {
        await SeedAsync("4111", "707", 1_000m, new DateTime(2026, 9, 10));

        var movements = await SumAsync();

        Assert.Empty(movements);
    }

    [Fact]
    public async Task Les_deux_sens_sont_rendus_sans_compensation()
    {
        await SeedAsync("4111", "707", 1_000m, new DateTime(2026, 9, 10));
        await SeedAsync("707", "4111", 250m, new DateTime(2026, 9, 12));

        var movements = await SumAsync(exact: new[] { "707" });

        var sales = movements["707"];
        Assert.Equal(250m, sales.Debit);
        Assert.Equal(1_000m, sales.Credit);
    }

    [Fact]
    public async Task Une_racine_agrege_toute_sa_descendance()
    {
        await SeedAsync("4111", "7071", 4_000m, new DateTime(2026, 9, 3));
        await SeedAsync("4111", "7072", 6_000m, new DateTime(2026, 9, 4));
        await SeedAsync("4111", "706", 999m, new DateTime(2026, 9, 5));

        var movements = await SumAsync(prefixes: new[] { "707" });

        Assert.Equal(new[] { "7071", "7072" }, movements.Keys.OrderBy(k => k));
        Assert.Equal(10_000m, movements.Values.Sum(m => m.Credit));
    }

    [Fact]
    public async Task Comptes_exacts_et_racines_se_combinent_dans_la_meme_requete()
    {
        await SeedAsync("4111", "7071", 4_000m, new DateTime(2026, 9, 3));
        await SeedAsync("4111", "706", 999m, new DateTime(2026, 9, 5));

        var movements = await SumAsync(exact: new[] { "706" }, prefixes: new[] { "707" });

        Assert.Equal(2, movements.Count);
        Assert.Equal(4_000m, movements["7071"].Credit);
        Assert.Equal(999m, movements["706"].Credit);
    }

    /// <summary>
    /// Un compte couvert à la fois par une racine et demandé en exact ne doit pas être compté deux
    /// fois, quel que soit le découpage en lots de la requête.
    /// </summary>
    [Fact]
    public async Task Un_compte_couvert_deux_fois_n_est_pas_compte_deux_fois()
    {
        await SeedAsync("4111", "7071", 4_000m, new DateTime(2026, 9, 3));

        var movements = await SumAsync(exact: new[] { "7071" }, prefixes: new[] { "707" });

        Assert.Equal(4_000m, Assert.Single(movements).Value.Credit);
    }

    /// <summary>
    /// La déclaration est une sortie légale : elle ne voit jamais le brouillard, quelle que soit la
    /// politique d'affichage des états de consultation.
    /// </summary>
    [Fact]
    public async Task Les_brouillons_sont_exclus()
    {
        await SeedAsync("4111", "707", 1_000m, new DateTime(2026, 9, 10));
        await SeedAsync("4111", "707", 500m, new DateTime(2026, 9, 11),
            status: JournalEntryStatus.Brouillon);

        var movements = await SumAsync(exact: new[] { "707" });

        Assert.Equal(1_000m, movements["707"].Credit);
    }

    [Fact]
    public async Task Les_ecritures_extournees_sont_exclues()
    {
        await SeedAsync("4111", "707", 1_000m, new DateTime(2026, 9, 10));
        await SeedAsync("4111", "707", 500m, new DateTime(2026, 9, 11), reversed: true);

        var movements = await SumAsync(exact: new[] { "707" });

        Assert.Equal(1_000m, movements["707"].Credit);
    }

    [Fact]
    public async Task La_fenetre_de_periode_est_stricte_aux_deux_bornes()
    {
        await SeedAsync("4111", "707", 100m, new DateTime(2026, 8, 31));
        await SeedAsync("4111", "707", 200m, new DateTime(2026, 9, 1));
        await SeedAsync("4111", "707", 300m, new DateTime(2026, 9, 30));
        await SeedAsync("4111", "707", 400m, new DateTime(2026, 10, 1));

        var movements = await SumAsync(exact: new[] { "707" });

        Assert.Equal(500m, movements["707"].Credit);
    }

    /// <summary>
    /// Un compte demandé mais sans mouvement est absent du dictionnaire : c'est à l'appelant de
    /// distinguer « pas de mouvement » de « compte inexistant », distinction qu'un zéro par défaut
    /// effacerait.
    /// </summary>
    [Fact]
    public async Task Un_compte_sans_mouvement_est_absent_et_non_a_zero()
    {
        await SeedAsync("4111", "707", 1_000m, new DateTime(2026, 9, 10));

        var movements = await SumAsync(exact: new[] { "707", "705" });

        Assert.True(movements.ContainsKey("707"));
        Assert.False(movements.ContainsKey("705"));
    }

    [Fact]
    public async Task Les_doublons_et_les_espaces_dans_la_demande_sont_normalises()
    {
        await SeedAsync("4111", "707", 1_000m, new DateTime(2026, 9, 10));

        var movements = await SumAsync(exact: new[] { " 707 ", "707", "", "   " });

        Assert.Equal(1_000m, Assert.Single(movements).Value.Credit);
    }

    /// <summary>
    /// Au-delà du plafond de paramètres d'une requête, la demande est découpée — en lots, jamais en
    /// une requête par compte.
    /// </summary>
    [Fact]
    public async Task Une_demande_de_plus_de_mille_comptes_est_decoupee_sans_perdre_de_montant()
    {
        await SeedAsync("4111", "7071", 4_000m, new DateTime(2026, 9, 3));
        await SeedAsync("4111", "7072", 6_000m, new DateTime(2026, 9, 4));

        var many = Enumerable.Range(1, 1_200).Select(i => $"6{i:D6}").ToList();
        many.Add("7071");
        many.Add("7072");

        var movements = await SumAsync(exact: many.ToArray());

        Assert.Equal(2, movements.Count);
        Assert.Equal(10_000m, movements.Values.Sum(m => m.Credit));
    }
}
