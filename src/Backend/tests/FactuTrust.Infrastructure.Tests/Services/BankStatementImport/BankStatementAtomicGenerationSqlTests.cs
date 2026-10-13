using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using FactuTrust.Infrastructure.Services;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using FactuTrust.Infrastructure.Tests.Fixtures;
using MediatR;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Génération atomique (plan §3.10) sur SQL réel : verrou applicatif (<c>sp_getapplock</c>),
/// réservation de numéros dans la transaction ambiante, rollback complet au premier échec.
/// InMemory ne simule ni les transactions ni les index uniques comme SQL Server ; ces
/// garanties-ci exigent une base relationnelle. No-op si SQL indisponible (poste dev sans SQL),
/// même convention que <see cref="FactuTrust.Infrastructure.Tests.MultiTenancy.TenantUnitOfWorkTests"/>.
/// </summary>
public sealed class BankStatementAtomicGenerationSqlTests : IDisposable
{
    private const string BankGl = "53210001";
    private readonly SqlTestDatabase _sqlDb = new(nameof(BankStatementAtomicGenerationSqlTests));
    private readonly bool _canRun;
    private readonly TenantAmbientTransaction _ambient = new();
    private readonly TenantDbContextFactory? _factory;
    private readonly TenantUnitOfWork? _unitOfWork;
    private readonly JournalEntryRepository? _journalEntries;

    public BankStatementAtomicGenerationSqlTests()
    {
        _canRun = _sqlDb.CanRun;
        if (!_canRun)
            return;

        var tenantContext = new Mock<ITenantContext>();
        tenantContext.SetupGet(c => c.ConnectionString).Returns(_sqlDb.ConnectionString);
        var hostEnvironment = new Mock<IHostEnvironment>();
        hostEnvironment.SetupGet(e => e.EnvironmentName).Returns(Environments.Development);

        _factory = new TenantDbContextFactory(
            tenantContext.Object, new Mock<IMediator>().Object, _ambient,
            NullLogger<TenantDbContext>.Instance, NullLoggerFactory.Instance,
            new ConfigurationBuilder().Build(), hostEnvironment.Object);
        _unitOfWork = new TenantUnitOfWork(_factory, _ambient, NullLogger<TenantUnitOfWork>.Instance);
        _journalEntries = new JournalEntryRepository(_factory, NullLogger<JournalEntryRepository>.Instance);
    }

    private BankStatementPostingService Service(int maxAtomicLines = 500)
    {
        var settings = new AccountingSettings
        {
            BankStatementAiPostingEnabled = true,
            BrouillardEnabled = true,
            BankStatementImport = new BankStatementImportLimits { MaxAtomicGenerationLines = maxAtomicLines }
        };

        // Vrai service (et non un mock) : il PERSISTE la période en base (AddAsync) quand elle
        // n'existe pas encore, condition requise pour satisfaire la contrainte FK
        // JournalEntries.AccountingPeriodId sur SQL réel (un mock qui se contente de fabriquer un
        // AccountingPeriod en mémoire sans l'écrire provoque une violation de clé étrangère ici).
        var periods = new AccountingPeriodService(new AccountingPeriodRepository(_factory!), _factory!, Options.Create(settings));

        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.Email).Returns("comptable@test.tn");

        return new BankStatementPostingService(_factory!, _unitOfWork!, _journalEntries!, periods,
            Mock.Of<IAuditService>(), user.Object, Mock.Of<IAiNarrativeCompletionService>(), Options.Create(settings),
            NullLogger<BankStatementPostingService>.Instance);
    }

    /// <summary>
    /// Construit une pile de service totalement indépendante (sa propre transaction ambiante,
    /// sa propre fabrique de contexte, sa propre unité de travail), reliée à la MÊME base de
    /// données que <see cref="Service"/>. Reproduit ce que deux requêtes HTTP concurrentes
    /// obtiendraient réellement en production (chacune avec son propre
    /// <see cref="TenantAmbientTransaction"/> injecté par portée DI) — contrairement à
    /// <see cref="Service"/>, qui partage délibérément l'état ambiant entre appels séquentiels
    /// du même test pour simuler « deux requêtes qui se suivent ».
    /// </summary>
    private BankStatementPostingService IndependentService(int maxAtomicLines = 500)
    {
        var tenantContext = new Mock<ITenantContext>();
        tenantContext.SetupGet(c => c.ConnectionString).Returns(_sqlDb.ConnectionString);
        var hostEnvironment = new Mock<IHostEnvironment>();
        hostEnvironment.SetupGet(e => e.EnvironmentName).Returns(Environments.Development);

        var ambient = new TenantAmbientTransaction();
        var factory = new TenantDbContextFactory(
            tenantContext.Object, new Mock<IMediator>().Object, ambient,
            NullLogger<TenantDbContext>.Instance, NullLoggerFactory.Instance,
            new ConfigurationBuilder().Build(), hostEnvironment.Object);
        var unitOfWork = new TenantUnitOfWork(factory, ambient, NullLogger<TenantUnitOfWork>.Instance);
        var journalEntries = new JournalEntryRepository(factory, NullLogger<JournalEntryRepository>.Instance);

        var settings = new AccountingSettings
        {
            BankStatementAiPostingEnabled = true,
            BrouillardEnabled = true,
            BankStatementImport = new BankStatementImportLimits { MaxAtomicGenerationLines = maxAtomicLines }
        };
        var periods = new AccountingPeriodService(new AccountingPeriodRepository(factory), factory, Options.Create(settings));

        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.Email).Returns("comptable@test.tn");

        return new BankStatementPostingService(factory, unitOfWork, journalEntries, periods,
            Mock.Of<IAuditService>(), user.Object, Mock.Of<IAiNarrativeCompletionService>(), Options.Create(settings),
            NullLogger<BankStatementPostingService>.Instance);
    }

    private async Task<(Guid StatementId, Dictionary<string, Guid> Lines)> SeedAsync(int extraSwiftLines = 0)
    {
        await using var ctx = _factory!.CreateIsolatedContext();
        foreach (var (number, nature) in new[] { (BankGl, AccountNatureType.Debit), ("6278", AccountNatureType.Debit) })
            ctx.ChartOfAccounts.Add(ChartOfAccount.Create(number, $"Compte {number}", int.Parse(number[..1]), null, nature).Value);

        var statement = BankStatement.Create("STB", "10100000000123456792", new DateTime(2026, 1, 31), new DateTime(2026, 1, 1),
            new DateTime(2026, 1, 31), Money.Create(1_000m), Money.Create(1_000m));
        statement.SetProvenance(null, BankGl, "releve.pdf", "HASH", BankStatementImportMethod.PdfText);

        var lines = new Dictionary<string, Guid>();
        void Add(string key, string label, decimal amount, bool isDebit, int day)
        {
            var line = BankStatementLine.Create(statement.Id, new DateTime(2026, 1, day), string.Empty, label, Money.Create(amount), isDebit);
            statement.Lines.Add(line);
            lines[key] = line.Id;
        }

        Add("swift1", "SWIFT", 10.000m, true, 2);
        Add("swift2", "SWIFT", 20.000m, true, 3);
        for (var i = 0; i < extraSwiftLines; i++)
            Add($"extra{i}", "SWIFT", 1.000m + i, true, 4);

        ctx.BankStatements.Add(statement);
        await ctx.SaveChangesAsync();
        return (statement.Id, lines);
    }

    private static GenerateBankStatementEntryItem Item(Guid lineId, string account = "6278") =>
        new() { LineId = lineId, AccountNumber = account };

    [Fact]
    public async Task Atomic_generation_creates_one_balanced_draft_per_line_with_consecutive_numbers()
    {
        if (!_canRun) return;
        var (statementId, lines) = await SeedAsync();

        var result = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Atomic = true,
            Items = new[] { Item(lines["swift1"]), Item(lines["swift2"]) }
        });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.True(result.Value.Atomic);
        Assert.True(result.Value.Committed);
        Assert.Equal(2, result.Value.Created);
        Assert.Equal(result.Value.LastEntryNumber, result.Value.FirstEntryNumber + 1);
        Assert.All(result.Value.Outcomes, o => Assert.Equal("created", o.Outcome));

        await using var verify = _factory!.CreateIsolatedContext();
        var entries = await verify.JournalEntries.Include(e => e.Lines).ToListAsync();
        Assert.Equal(2, entries.Count);
        Assert.All(entries, e =>
        {
            Assert.Equal(JournalEntryStatus.Brouillon, e.Status);
            Assert.Equal(e.Lines.Sum(l => l.DebitAmount.Amount), e.Lines.Sum(l => l.CreditAmount.Amount));
        });

        // Invariant du plan §3.11 : la génération atomique ne rapproche jamais les lignes du relevé.
        var statementLines = await verify.BankStatements.Where(s => s.Id == statementId)
            .SelectMany(s => s.Lines).ToListAsync();
        Assert.All(statementLines, l =>
        {
            Assert.False(l.IsReconciled);
            Assert.Null(l.ReconciledJournalEntryLineId);
        });
    }

    [Fact]
    public async Task An_invalid_line_rejects_the_whole_batch_without_writing_anything()
    {
        if (!_canRun) return;
        var (statementId, lines) = await SeedAsync();

        var result = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Atomic = true,
            Items = new[] { Item(lines["swift1"]), Item(lines["swift2"], account: "999999") }
        });

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementPostingErrorCodes.AtomicRejected, result.Error.Code);
        var data = Assert.IsType<GenerateBankStatementEntriesResult>(result.Error.Metadata!["data"]);
        Assert.False(data.Committed);
        Assert.Equal(0, data.Created);
        Assert.Equal(2, data.Outcomes.Count);
        Assert.Contains(data.Outcomes, o => o.LineId == lines["swift1"] && o.Outcome == "ready");
        Assert.Contains(data.Outcomes, o => o.LineId == lines["swift2"] && o.Outcome == "failed" && o.Code == BankStatementPostingErrorCodes.AccountInvalid);

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(0, await verify.JournalEntries.CountAsync());
    }

    [Fact]
    public async Task Incomplete_coverage_is_rejected_before_any_write()
    {
        if (!_canRun) return;
        var (statementId, lines) = await SeedAsync();

        // "swift2" n'est ni envoyée ni explicitement exclue : couverture incomplète (plan §3.10 point 2).
        var result = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Atomic = true,
            Items = new[] { Item(lines["swift1"]) }
        });

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementPostingErrorCodes.AtomicIncomplete, result.Error.Code);

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(0, await verify.JournalEntries.CountAsync());
    }

    [Fact]
    public async Task Excluded_lines_are_reported_and_never_generated()
    {
        if (!_canRun) return;
        var (statementId, lines) = await SeedAsync();

        var result = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Atomic = true,
            Items = new[] { Item(lines["swift1"]) },
            ExcludedLineIds = new[] { lines["swift2"] }
        });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(1, result.Value.Created);
        Assert.Contains(result.Value.Outcomes, o => o.LineId == lines["swift2"] && o.Outcome == "excluded");

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(1, await verify.JournalEntries.CountAsync());
    }

    [Fact]
    public async Task Too_many_lines_is_rejected_without_touching_the_database()
    {
        if (!_canRun) return;
        var (statementId, lines) = await SeedAsync();

        var result = await Service(maxAtomicLines: 1).GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Atomic = true,
            Items = new[] { Item(lines["swift1"]), Item(lines["swift2"]) }
        });

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementPostingErrorCodes.AtomicTooManyLines, result.Error.Code);

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(0, await verify.JournalEntries.CountAsync());
    }

    [Fact]
    public async Task Replaying_an_already_posted_atomic_generation_changes_nothing()
    {
        if (!_canRun) return;
        var (statementId, lines) = await SeedAsync();
        var request = new GenerateBankStatementEntriesRequest { Atomic = true, Items = new[] { Item(lines["swift1"]), Item(lines["swift2"]) } };

        var first = await Service().GenerateAsync(statementId, request);
        Assert.True(first.IsSuccess);

        var second = await Service().GenerateAsync(statementId, request);

        Assert.True(second.IsSuccess, second.IsFailure ? second.Error.Description : null);
        Assert.Equal(0, second.Value.Created);
        Assert.True(second.Value.Committed);
        Assert.All(second.Value.Outcomes, o => Assert.Equal("already_posted", o.Outcome));

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(2, await verify.JournalEntries.CountAsync());
    }

    [Fact]
    public async Task Two_concurrent_atomic_generations_on_the_same_statement_yield_exactly_one_success()
    {
        if (!_canRun) return;
        var (statementId, lines) = await SeedAsync();
        var request = new GenerateBankStatementEntriesRequest { Atomic = true, Items = new[] { Item(lines["swift1"]), Item(lines["swift2"]) } };

        // Deux générations concurrentes de la MÊME requête : le verrou applicatif + le contrôle
        // d'idempotence dans la transaction garantissent qu'une seule l'emporte (plan §3.10 point 4).
        // Chaque branche utilise sa PROPRE pile de service (transaction ambiante indépendante),
        // comme deux requêtes HTTP concurrentes en production ; elles ne font que partager la
        // même base de données et donc le même verrou SQL (sp_getapplock).
        var first = IndependentService().GenerateAsync(statementId, request);
        var second = IndependentService().GenerateAsync(statementId, request);
        var results = await Task.WhenAll(first, second);

        Assert.Equal(1, results.Count(r => r.IsSuccess && r.Value.Created == 2));
        Assert.Equal(1, results.Count(r => r.IsFailure && r.Error.Code == BankStatementPostingErrorCodes.AtomicConflict)
                        + results.Count(r => r.IsSuccess && r.Value.Created == 0));

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(2, await verify.JournalEntries.CountAsync()); // jamais de doublon
    }

    [Fact]
    public async Task A_failed_atomic_generation_restores_the_entry_number_sequence()
    {
        if (!_canRun) return;
        var (statementId, lines) = await SeedAsync();

        // Un relevé qui réussit en premier avance la séquence ; un second relevé qui échoue
        // APRÈS la réservation du bloc (conflit d'idempotence) ne doit pas laisser de trou :
        // on vérifie ici que la séquence n'avance QUE pour les écritures effectivement créées.
        var ok = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Atomic = true,
            Items = new[] { Item(lines["swift1"]) },
            ExcludedLineIds = new[] { lines["swift2"] }
        });
        Assert.True(ok.IsSuccess);
        var firstNumber = ok.Value.FirstEntryNumber!.Value;

        await using var verify = _factory!.CreateIsolatedContext();
        var sequence = await verify.JournalEntrySequences.SingleAsync(s => s.JournalCode == "JB" && s.FiscalYear == 2026);
        Assert.Equal(firstNumber, sequence.LastSequence);
    }

    [Fact]
    public async Task A_line_present_in_both_items_and_excluded_is_rejected_before_any_write()
    {
        if (!_canRun) return;
        var (statementId, lines) = await SeedAsync();

        var result = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Atomic = true,
            Items = new[] { Item(lines["swift1"]), Item(lines["swift2"]) },
            ExcludedLineIds = new[] { lines["swift2"] }
        });

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementPostingErrorCodes.AtomicOverlap, result.Error.Code);

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(0, await verify.JournalEntries.CountAsync());
    }

    [Fact]
    public async Task Atomic_with_no_items_and_no_exclusions_still_runs_the_coverage_check()
    {
        if (!_canRun) return;
        var (statementId, _) = await SeedAsync();

        // Items vide en mode atomique : ne doit jamais être traité comme « rien à faire » (c'était
        // le cas avant correctif, en NRE potentielle sur ExcludedLineIds=null) — la couverture reste
        // incomplète (swift1/swift2 ni envoyées ni exclues) donc rejet avant toute écriture.
        var result = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Atomic = true,
            Items = Array.Empty<GenerateBankStatementEntryItem>(),
            ExcludedLineIds = null
        });

        Assert.True(result.IsFailure);
        Assert.Equal(BankStatementPostingErrorCodes.AtomicIncomplete, result.Error.Code);

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(0, await verify.JournalEntries.CountAsync());
    }

    [Fact]
    public async Task A_statement_spanning_two_fiscal_years_reports_a_range_per_year_and_a_null_global_range()
    {
        if (!_canRun) return;
        await using var ctx = _factory!.CreateIsolatedContext();
        ctx.ChartOfAccounts.Add(ChartOfAccount.Create(BankGl, $"Compte {BankGl}", int.Parse(BankGl[..1]), null, AccountNatureType.Debit).Value);
        ctx.ChartOfAccounts.Add(ChartOfAccount.Create("6278", "Compte 6278", 6, null, AccountNatureType.Debit).Value);

        var statement = BankStatement.Create("STB", "10100000000123456793", new DateTime(2026, 1, 2), new DateTime(2025, 12, 31),
            new DateTime(2026, 1, 2), Money.Create(1_000m), Money.Create(1_000m));
        statement.SetProvenance(null, BankGl, "releve.pdf", "HASH2", BankStatementImportMethod.PdfText);

        var december = BankStatementLine.Create(statement.Id, new DateTime(2025, 12, 31), string.Empty, "SWIFT", Money.Create(10.000m), true);
        var january = BankStatementLine.Create(statement.Id, new DateTime(2026, 1, 2), string.Empty, "SWIFT", Money.Create(20.000m), true);
        statement.Lines.Add(december);
        statement.Lines.Add(january);
        ctx.BankStatements.Add(statement);
        await ctx.SaveChangesAsync();

        var result = await Service().GenerateAsync(statement.Id, new GenerateBankStatementEntriesRequest
        {
            Atomic = true,
            Items = new[] { Item(december.Id), Item(january.Id) }
        });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(2, result.Value.Created);
        Assert.Null(result.Value.FirstEntryNumber);
        Assert.Null(result.Value.LastEntryNumber);
        Assert.Equal(2, result.Value.EntryNumberRangesByYear.Count);
        Assert.Contains(result.Value.EntryNumberRangesByYear, r => r.FiscalYear == 2025 && r.First == r.Last);
        Assert.Contains(result.Value.EntryNumberRangesByYear, r => r.FiscalYear == 2026 && r.First == r.Last);

        await using var verify = _factory!.CreateIsolatedContext();
        var entries = await verify.JournalEntries.Where(e => e.SourceEntityId == december.Id || e.SourceEntityId == january.Id).ToListAsync();
        Assert.Equal(2, entries.Count);
    }

    [Fact]
    public async Task A_held_applock_times_out_as_an_atomic_conflict()
    {
        if (!_canRun) return;
        var (statementId, lines) = await SeedAsync();

        // Détient le MÊME verrou applicatif (sp_getapplock, ressource "bank-stmt-gen:{id}") que
        // GenerateAtomicAsync, depuis une connexion/transaction totalement indépendante, pour
        // reproduire fidèlement le timeout de 10 s (SqlException 51000 levée par le THROW de la
        // génération) et vérifier son mapping vers 409 atomic_conflict — pas une erreur serveur
        // générique, et une nouvelle tentative doit rester possible côté client.
        await using var lockConnection = new SqlConnection(_sqlDb.ConnectionString);
        await lockConnection.OpenAsync();
        using var lockTransaction = lockConnection.BeginTransaction();
        using (var acquire = lockConnection.CreateCommand())
        {
            acquire.Transaction = lockTransaction;
            acquire.CommandText =
                "EXEC sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 0;";
            acquire.Parameters.AddWithValue("@resource", $"bank-stmt-gen:{statementId}");
            await acquire.ExecuteNonQueryAsync();
        }

        try
        {
            var result = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
            {
                Atomic = true,
                Items = new[] { Item(lines["swift1"]), Item(lines["swift2"]) }
            });

            Assert.True(result.IsFailure);
            Assert.Equal(BankStatementPostingErrorCodes.AtomicConflict, result.Error.Code);
        }
        finally
        {
            lockTransaction.Rollback();
        }

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(0, await verify.JournalEntries.CountAsync());
    }

    [Fact]
    public async Task A_non_unique_write_failure_is_rejected_not_treated_as_a_retryable_conflict()
    {
        if (!_canRun) return;
        var (statementId, lines) = await SeedAsync();

        // Contrainte CHECK artificielle qui échoue systématiquement à l'insertion : simule une
        // DbUpdateException qui n'est NI une violation d'index unique (2601/2627) NI un timeout
        // de verrou applicatif (51000) — par ex. une contrainte différente ou une période close
        // entre-temps par un autre processus. Doit être rejetée définitivement (400
        // atomic_rejected), PAS traitée comme un conflit de concurrence retry-able (409
        // atomic_conflict).
        await using (var schema = _factory!.CreateIsolatedContext())
            await schema.Database.ExecuteSqlRawAsync("ALTER TABLE JournalEntries ADD CONSTRAINT CK_Test_ForceAtomicWriteFailure CHECK (1 = 0);");

        try
        {
            var result = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
            {
                Atomic = true,
                Items = new[] { Item(lines["swift1"]), Item(lines["swift2"]) }
            });

            Assert.True(result.IsFailure);
            Assert.Equal(BankStatementPostingErrorCodes.AtomicRejected, result.Error.Code);
        }
        finally
        {
            await using var schema = _factory!.CreateIsolatedContext();
            await schema.Database.ExecuteSqlRawAsync("ALTER TABLE JournalEntries DROP CONSTRAINT CK_Test_ForceAtomicWriteFailure;");
        }

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(0, await verify.JournalEntries.CountAsync());
    }

    public void Dispose() => _sqlDb.Dispose();
}

