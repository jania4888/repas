using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
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
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Génération des brouillons : une écriture par ligne, montants relus en base, tiers obligatoire
/// sur un collectif, TVA bornée, idempotence, refus des lignes déjà comptabilisées, brouillard
/// obligatoire, « Mémoriser » réutilisé à la proposition suivante.
/// </summary>
public sealed class BankStatementPostingServiceTests
{
    private const string BankGl = "53210001";
    private readonly string _dbName = $"BankStatementPosting_{Guid.NewGuid():N}";
    private readonly InMemoryFactory _factory;
    private int _nextNumber = 100;

    public BankStatementPostingServiceTests() => _factory = new InMemoryFactory(_dbName);

    private sealed class InMemoryFactory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() => new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }

    private sealed class DirectUnitOfWork : ITenantUnitOfWork
    {
        public async Task<Result> ExecuteAsync(Func<CancellationToken, Task<Result>> action, CancellationToken cancellationToken = default) =>
            await action(cancellationToken);

        public async Task<Result<T>> ExecuteAsync<T>(Func<CancellationToken, Task<Result<T>>> action, CancellationToken cancellationToken = default) =>
            await action(cancellationToken);
    }

    private BankStatementPostingService Service(bool brouillard = true)
    {
        var settings = new AccountingSettings { BankStatementAiPostingEnabled = true, BrouillardEnabled = brouillard };

        var repository = new Mock<IJournalEntryRepository>();
        repository.Setup(r => r.ReserveNextEntryNumberAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => ++_nextNumber);
        repository.Setup(r => r.AddAsync(It.IsAny<JournalEntry>(), It.IsAny<CancellationToken>()))
            .Returns(async (JournalEntry entry, CancellationToken ct) =>
            {
                await using var ctx = _factory.CreateContext();
                ctx.JournalEntries.Add(entry);
                await ctx.SaveChangesAsync(ct);
                return entry;
            });

        var periods = new Mock<IAccountingPeriodService>();
        periods.Setup(p => p.EnsureOpenPeriodAsync(It.IsAny<DateTime>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((DateTime d, CancellationToken _) =>
                Result.Success(AccountingPeriod.Create(d.Year, d.Month, new DateTime(d.Year, d.Month, 1), new DateTime(d.Year, d.Month, 1).AddMonths(1).AddDays(-1))));

        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.Email).Returns("comptable@test.tn");

        return new BankStatementPostingService(_factory, new DirectUnitOfWork(), repository.Object, periods.Object,
            Mock.Of<IAuditService>(), user.Object, Mock.Of<IAiNarrativeCompletionService>(), Options.Create(settings),
            NullLogger<BankStatementPostingService>.Instance);
    }

    private (Guid StatementId, Dictionary<string, Guid> Lines, Guid SupplierId) Seed()
    {
        using var ctx = _factory.CreateContext();
        foreach (var (number, nature) in new[] { (BankGl, AccountNatureType.Debit), ("6278", AccountNatureType.Debit), ("43666", AccountNatureType.Debit), ("4011", AccountNatureType.Credit), ("4111", AccountNatureType.Debit) })
            ctx.ChartOfAccounts.Add(ChartOfAccount.Create(number, $"Compte {number}", int.Parse(number[..1]), null, nature).Value);

        var supplier = Supplier.Create("Omega Leasing Services", SupplierType.Business, Address.Create("Rue 1", "Tunis", "Tunis").Value,
            Email.Create("ols@test.tn").Value, nif: NIF.Create("1234567/A/B/C/000").Value).Value;
        ctx.Suppliers.Add(supplier);

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

        Add("fee", "VIR IBQ A DISTANCE COMMISSION VIR AUT BQ 004242 DONT TVA: 0,285", 1.785m, true, 2);
        Add("swift", "SWIFT", 10.000m, true, 6);
        Add("atl", "PRÉLÈVEMENT OLS", 1_607.673m, true, 5);
        Add("receipt", "VIREMENT REÇU INCONNU SARL", 2_000.000m, false, 9);
        ctx.BankStatements.Add(statement);
        ctx.SaveChanges();
        return (statement.Id, lines, supplier.Id);
    }

    [Fact]
    public async Task Drafts_are_generated_one_per_line_with_amounts_read_from_the_statement()
    {
        var (statementId, lines, _) = Seed();

        var result = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Items = new[]
            {
                new GenerateBankStatementEntryItem { LineId = lines["swift"], AccountNumber = "6278" },
                new GenerateBankStatementEntryItem { LineId = lines["fee"], AccountNumber = "6278", VatAmount = 0.285m, VatAccountNumber = "43666" }
            }
        });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(2, result.Value.Created);

        await using var ctx = _factory.CreateContext();
        var entries = await ctx.JournalEntries.Include(e => e.Lines).ToListAsync();
        Assert.All(entries, e =>
        {
            Assert.Equal(JournalEntryStatus.Brouillon, e.Status);
            Assert.Equal("JB", e.JournalCode);
            Assert.Equal(TenantDbContext.BankStatementLineSourceType, e.SourceEntityType);
            Assert.Equal(e.Lines.Sum(l => l.DebitAmount.Amount), e.Lines.Sum(l => l.CreditAmount.Amount));
        });

        var swift = entries.Single(e => e.SourceEntityId == lines["swift"]);
        Assert.Equal(10.000m, swift.Lines.Single(l => l.AccountNumber == "6278").DebitAmount.Amount);
        Assert.Equal(10.000m, swift.Lines.Single(l => l.AccountNumber == BankGl).CreditAmount.Amount);

        var fee = entries.Single(e => e.SourceEntityId == lines["fee"]);
        Assert.Equal(3, fee.Lines.Count);
        Assert.Equal(1.500m, fee.Lines.Single(l => l.AccountNumber == "6278").DebitAmount.Amount);
        Assert.Equal(0.285m, fee.Lines.Single(l => l.AccountNumber == "43666").DebitAmount.Amount);
        Assert.Equal(1.785m, fee.Lines.Single(l => l.AccountNumber == BankGl).CreditAmount.Amount);
    }

    [Fact]
    public async Task Generating_twice_never_duplicates_an_entry()
    {
        var (statementId, lines, _) = Seed();
        var request = new GenerateBankStatementEntriesRequest
        {
            Items = new[] { new GenerateBankStatementEntryItem { LineId = lines["swift"], AccountNumber = "6278" } }
        };

        await Service().GenerateAsync(statementId, request);
        var second = await Service().GenerateAsync(statementId, request);

        Assert.Equal(0, second.Value.Created);
        Assert.Equal("already_posted", Assert.Single(second.Value.Outcomes).Outcome);
        await using var ctx = _factory.CreateContext();
        Assert.Equal(1, await ctx.JournalEntries.CountAsync());

        var proposals = await Service().GetProposalsAsync(statementId);
        Assert.Equal(BankLineStatuses.Generated, proposals.Value.Lines.Single(l => l.LineId == lines["swift"]).Status);
    }

    [Fact]
    public async Task Collective_account_requires_a_matching_third_party()
    {
        var (statementId, lines, supplierId) = Seed();

        var missing = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Items = new[] { new GenerateBankStatementEntryItem { LineId = lines["atl"], AccountNumber = "4011" } }
        });
        Assert.Equal(BankStatementPostingErrorCodes.ThirdPartyRequired, Assert.Single(missing.Value.Outcomes).Code);

        var wrongKind = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Items = new[] { new GenerateBankStatementEntryItem { LineId = lines["atl"], AccountNumber = "4011", ThirdPartyId = supplierId, ThirdPartyKind = ThirdPartyKind.Client } }
        });
        Assert.Equal(BankStatementPostingErrorCodes.ThirdPartyInvalid, Assert.Single(wrongKind.Value.Outcomes).Code);

        var ok = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Items = new[] { new GenerateBankStatementEntryItem { LineId = lines["atl"], AccountNumber = "4011", ThirdPartyId = supplierId, ThirdPartyKind = ThirdPartyKind.Supplier } }
        });
        Assert.Equal(1, ok.Value.Created);
        await using var ctx = _factory.CreateContext();
        var supplierLine = await ctx.JournalEntryLines.SingleAsync(l => l.AccountNumber == "4011");
        Assert.Equal(supplierId, supplierLine.ThirdPartyId);
        Assert.Equal(ThirdPartyKind.Supplier, supplierLine.ThirdPartyKind);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1.785)]
    [InlineData(2)]
    [InlineData(0.2855)]
    public async Task Vat_split_is_bounded(double vat)
    {
        var (statementId, lines, _) = Seed();
        var result = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Items = new[] { new GenerateBankStatementEntryItem { LineId = lines["fee"], AccountNumber = "6278", VatAmount = (decimal)vat, VatAccountNumber = "43666" } }
        });
        Assert.Equal(BankStatementPostingErrorCodes.VatInvalid, Assert.Single(result.Value.Outcomes).Code);
    }

    [Fact]
    public async Task Unknown_or_bank_account_counterpart_is_refused()
    {
        var (statementId, lines, _) = Seed();
        var result = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Items = new[]
            {
                new GenerateBankStatementEntryItem { LineId = lines["swift"], AccountNumber = "999999" },
                new GenerateBankStatementEntryItem { LineId = lines["fee"], AccountNumber = BankGl }
            }
        });
        Assert.All(result.Value.Outcomes, o => Assert.Equal(BankStatementPostingErrorCodes.AccountInvalid, o.Code));
        Assert.Equal(0, result.Value.Created);
    }

    [Fact]
    public async Task Line_already_recorded_elsewhere_is_refused()
    {
        var (statementId, lines, _) = Seed();
        // Encaissement saisi dans InstaFact (paiement client) : D 5321 / C 4111 de 2 000,000.
        await using (var ctx = _factory.CreateContext())
        {
            var period = AccountingPeriod.Create(2026, 1, new DateTime(2026, 1, 1), new DateTime(2026, 1, 31));
            var entry = JournalEntry.Create(1, "JB", new DateTime(2026, 1, 8), "Encaissement facture", period.Id, true, "Payment", Guid.NewGuid(),
                new[]
                {
                    new JournalLineInput("5321", "Encaissement", 2_000m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("4111", "Encaissement", 0m, 2_000m, null, ThirdPartyKind.None)
                }).Value;
            ctx.JournalEntries.Add(entry);
            await ctx.SaveChangesAsync();
        }

        var proposals = await Service().GetProposalsAsync(statementId);
        Assert.Equal(BankLineStatuses.AlreadyPosted, proposals.Value.Lines.Single(l => l.LineId == lines["receipt"]).Status);

        var result = await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Items = new[] { new GenerateBankStatementEntryItem { LineId = lines["receipt"], AccountNumber = "6278" } }
        });
        Assert.Equal("already_posted", Assert.Single(result.Value.Outcomes).Outcome);
    }

    [Fact]
    public async Task Without_drafts_nothing_is_generated()
    {
        var (statementId, lines, _) = Seed();
        var result = await Service(brouillard: false).GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Items = new[] { new GenerateBankStatementEntryItem { LineId = lines["swift"], AccountNumber = "6278" } }
        });
        Assert.Equal(BankStatementPostingErrorCodes.DraftsDisabled, result.Error.Code);
    }

    [Fact]
    public async Task Remembered_rule_drives_the_next_proposals()
    {
        var (statementId, lines, supplierId) = Seed();
        await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Items = new[]
            {
                new GenerateBankStatementEntryItem
                {
                    LineId = lines["atl"], AccountNumber = "4011", ThirdPartyId = supplierId, ThirdPartyKind = ThirdPartyKind.Supplier, RememberRule = true
                }
            }
        });

        await using (var ctx = _factory.CreateContext())
        {
            var rule = await ctx.BankPostingRules.SingleAsync();
            Assert.Equal("PRELEVEMENT OLS", rule.Pattern);
            Assert.Equal(supplierId, rule.ThirdPartyId);
        }

        // Nouveau relevé du mois suivant : la même opération est proposée par la règle, tiers compris.
        Guid nextLine;
        Guid nextStatement;
        await using (var ctx = _factory.CreateContext())
        {
            var statement = BankStatement.Create("STB", "10100000000123456792", new DateTime(2026, 2, 28), new DateTime(2026, 2, 1),
                new DateTime(2026, 2, 28), Money.Create(1_000m), Money.Create(1_000m));
            statement.SetProvenance(null, BankGl, "fevrier.pdf", "HASH2", BankStatementImportMethod.PdfText);
            var line = BankStatementLine.Create(statement.Id, new DateTime(2026, 2, 5), string.Empty, "PRÉLÈVEMENT OLS", Money.Create(1_607.673m), true);
            statement.Lines.Add(line);
            ctx.BankStatements.Add(statement);
            await ctx.SaveChangesAsync();
            nextLine = line.Id;
            nextStatement = statement.Id;
        }

        var proposal = (await Service().GetProposalsAsync(nextStatement)).Value.Lines.Single(l => l.LineId == nextLine);
        Assert.Equal(BankLineSources.DossierRule, proposal.Source);
        Assert.Equal(supplierId, proposal.ThirdPartyId);
        Assert.True(proposal.SelectedByDefault);
    }

    // --- GET statements (historique, plan §3.8) ---

    private Guid SeedHistoryStatement(Guid bankAccountId, string rib, DateTime periodStart, DateTime periodEnd,
        BankStatementImportMethod method, int lineCount = 1)
    {
        using var ctx = _factory.CreateContext();
        if (ctx.BankAccounts.Find(bankAccountId) is null)
        {
            var account = BankAccount.Create(Guid.NewGuid(), "STB", "STB", rib, $"TN59{rib}").Value;
            typeof(BankAccount).GetProperty("Id")!.SetValue(account, bankAccountId);
            ctx.BankAccounts.Add(account);
        }
        if (!ctx.ChartOfAccounts.Any(a => a.AccountNumber == BankGl))
            ctx.ChartOfAccounts.Add(ChartOfAccount.Create(BankGl, $"Compte {BankGl}", int.Parse(BankGl[..1]), null, AccountNatureType.Debit).Value);
        if (!ctx.ChartOfAccounts.Any(a => a.AccountNumber == "6278"))
            ctx.ChartOfAccounts.Add(ChartOfAccount.Create("6278", "Compte 6278", 6, null, AccountNatureType.Debit).Value);

        var statement = BankStatement.Create("STB", rib, periodEnd, periodStart, periodEnd, Money.Create(1_000m), Money.Create(1_000m));
        statement.SetProvenance(bankAccountId, BankGl, "releve.pdf", $"HASH-{Guid.NewGuid():N}", method);
        for (var i = 0; i < lineCount; i++)
            statement.Lines.Add(BankStatementLine.Create(statement.Id, periodStart.AddDays(i), string.Empty, $"ligne {i}", Money.Create(10m), true));
        ctx.BankStatements.Add(statement);
        ctx.SaveChanges();
        return statement.Id;
    }

    [Fact]
    public async Task History_lists_only_statements_with_a_bank_account_and_a_recognized_import_method()
    {
        var bankAccountId = Guid.NewGuid();
        SeedHistoryStatement(bankAccountId, "10100000000123456792", new DateTime(2026, 1, 1), new DateTime(2026, 1, 31), BankStatementImportMethod.PdfText);

        // Jamais listé ici : import par rapprochement (hors périmètre du plan §3.8) et relevé sans
        // compte bancaire identifié (saisie historique antérieure, aucun BankAccountId renseigné).
        using (var ctx = _factory.CreateContext())
        {
            var reconciliation = BankStatement.Create("STB", "10100000000123456793", new DateTime(2026, 1, 31), new DateTime(2026, 1, 1),
                new DateTime(2026, 1, 31), Money.Create(1_000m), Money.Create(1_000m));
            reconciliation.SetProvenance(bankAccountId, BankGl, null, null, BankStatementImportMethod.Manual);
            ctx.BankStatements.Add(reconciliation);

            var withoutAccount = BankStatement.Create("STB", "10100000000123456794", new DateTime(2026, 1, 31), new DateTime(2026, 1, 1),
                new DateTime(2026, 1, 31), Money.Create(1_000m), Money.Create(1_000m));
            withoutAccount.SetProvenance(null, BankGl, "releve.pdf", "HASHX", BankStatementImportMethod.PdfText);
            ctx.BankStatements.Add(withoutAccount);
            ctx.SaveChanges();
        }

        var result = await Service().GetHistoryAsync(page: 1, pageSize: 20, bankAccountId: null);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.TotalCount);
        var item = result.Value.Items.Single();
        Assert.Equal("STB", item.BankName);
        Assert.Equal(BankStatementImportMethod.PdfText, item.ImportMethod);
        Assert.Equal("6792", item.MaskedRib); // derniers 4 chiffres du RIB uniquement (plan §3.8)
    }

    [Fact]
    public async Task History_filters_by_bank_account_when_requested()
    {
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        SeedHistoryStatement(first, "10100000000123456792", new DateTime(2026, 1, 1), new DateTime(2026, 1, 31), BankStatementImportMethod.PdfText);
        SeedHistoryStatement(second, "10100000000123456795", new DateTime(2026, 1, 1), new DateTime(2026, 1, 31), BankStatementImportMethod.Csv);

        var result = await Service().GetHistoryAsync(page: 1, pageSize: 20, bankAccountId: second);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.TotalCount);
        Assert.Equal(BankStatementImportMethod.Csv, result.Value.Items.Single().ImportMethod);
    }

    [Fact]
    public async Task History_pagination_clamps_page_size_to_the_configured_maximum()
    {
        var bankAccountId = Guid.NewGuid();
        for (var i = 0; i < 3; i++)
            SeedHistoryStatement(bankAccountId, "10100000000123456792", new DateTime(2026, 1, 1).AddMonths(i),
                new DateTime(2026, 1, 31).AddMonths(i), BankStatementImportMethod.PdfText);

        // 500 demandé > 100 (MaxHistoryPageSize) : la page retournée doit refléter la limite
        // appliquée côté service, pas la valeur brute envoyée par le client (plan §3.8).
        var result = await Service().GetHistoryAsync(page: 1, pageSize: 500, bankAccountId: null);

        Assert.True(result.IsSuccess);
        Assert.Equal(100, result.Value.PageSize);
        Assert.Equal(3, result.Value.Items.Count);
    }

    [Fact]
    public async Task History_counts_posted_lines_without_ever_reconciling_them()
    {
        var bankAccountId = Guid.NewGuid();
        var statementId = SeedHistoryStatement(bankAccountId, "10100000000123456792", new DateTime(2026, 1, 1), new DateTime(2026, 1, 31),
            BankStatementImportMethod.PdfText, lineCount: 2);

        Guid lineId;
        using (var ctx = _factory.CreateContext())
            lineId = ctx.BankStatements.Where(s => s.Id == statementId).SelectMany(s => s.Lines).Select(l => l.Id).First();

        await Service().GenerateAsync(statementId, new GenerateBankStatementEntriesRequest
        {
            Items = new[] { new GenerateBankStatementEntryItem { LineId = lineId, AccountNumber = "6278" } }
        });

        var result = await Service().GetHistoryAsync(page: 1, pageSize: 20, bankAccountId: null);

        Assert.True(result.IsSuccess);
        var item = result.Value.Items.Single(i => i.Id == statementId);
        Assert.Equal(1, item.PostedCount);
        Assert.Equal(2, item.LineCount);

        // Garantie du plan §3.11 : la génération de brouillons n'a jamais rapproché la ligne.
        using var verify = _factory.CreateContext();
        var line = verify.BankStatements.Where(s => s.Id == statementId).SelectMany(s => s.Lines).Single(l => l.Id == lineId);
        Assert.False(line.IsReconciled);
        Assert.Null(line.ReconciledJournalEntryLineId);
    }
}
