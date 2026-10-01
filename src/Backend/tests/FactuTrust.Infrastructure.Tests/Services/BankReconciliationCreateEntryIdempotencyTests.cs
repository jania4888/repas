using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// « Créer écriture » du rapprochement (chemin historique) : en brouillard, la ligne n'est pas
/// rapprochée tout de suite ; un second clic — ou la comptabilisation assistée d'un relevé
/// importé — ne doit plus créer une deuxième écriture pour la même ligne.
/// </summary>
public sealed class BankReconciliationCreateEntryIdempotencyTests
{
    private const string BankAccount = "532";
    private readonly string _dbName = $"BankRecoIdem_{Guid.NewGuid():N}";
    private readonly Factory _factory;

    public BankReconciliationCreateEntryIdempotencyTests()
    {
        _factory = new Factory(_dbName);
        using var ctx = _factory.CreateContext();
        ctx.ChartOfAccounts.Add(ChartOfAccount.Create(BankAccount, "Banque", 5, null, AccountNatureType.Debit).Value);
        ctx.ChartOfAccounts.Add(ChartOfAccount.Create("658", "Charges bancaires", 6, null, AccountNatureType.Debit).Value);
        ctx.SaveChanges();
    }

    private sealed class Factory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() => new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }

    private BankReconciliationService Service()
    {
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.Email).Returns("compta@test.tn");
        var settings = Options.Create(new AccountingSettings { BrouillardEnabled = true });
        return new BankReconciliationService(_factory, Mock.Of<IAuditService>(), user.Object, Mock.Of<IBankStatementPdfImportService>(),
            new AccountingReportingService(_factory, settings), settings);
    }

    private async Task<Guid> LineAsync()
    {
        var result = await Service().ImportStatementAsync(new ImportBankStatementRequest
        {
            BankName = "BIAT",
            AccountNumber = "08 123 456789",
            ChartOfAccountNumber = BankAccount,
            StatementDate = new DateTime(2026, 5, 31),
            PeriodStart = new DateTime(2026, 5, 1),
            PeriodEnd = new DateTime(2026, 5, 31),
            Lines = new[]
            {
                new ImportBankStatementLineRequest
                {
                    TransactionDate = new DateTime(2026, 5, 10), Reference = "F", Description = "Frais", Amount = 20m, IsDebit = true
                }
            }
        });
        await using var ctx = _factory.CreateContext();
        return ctx.BankStatementLines.Single(l => l.BankStatementId == result.Value.Id).Id;
    }

    [Fact]
    public async Task Second_click_in_draft_mode_does_not_create_a_duplicate()
    {
        var lineId = await LineAsync();
        var request = new CreateEntryForLineRequest { JournalCode = "JB", CounterpartyAccount = "658" };

        Assert.True((await Service().CreateEntryForLineAsync(lineId, request)).IsSuccess);
        var second = await Service().CreateEntryForLineAsync(lineId, request);

        Assert.True(second.IsFailure);
        await using var ctx = _factory.CreateContext();
        Assert.Equal(1, await ctx.JournalEntries.CountAsync());
    }

    [Fact]
    public async Task Line_already_posted_by_the_assisted_import_is_refused()
    {
        var lineId = await LineAsync();
        await using (var ctx = _factory.CreateContext())
        {
            var period = AccountingPeriod.Create(2026, 5, new DateTime(2026, 5, 1), new DateTime(2026, 5, 31));
            ctx.AccountingPeriods.Add(period);
            ctx.JournalEntries.Add(JournalEntry.Create(1, "JB", new DateTime(2026, 5, 10), "Frais", period.Id, false,
                TenantDbContext.BankStatementLineSourceType, lineId,
                new[]
                {
                    new JournalLineInput("658", "Frais", 20m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput(BankAccount, "Frais", 0m, 20m, null, ThirdPartyKind.None)
                }, initialStatus: JournalEntryStatus.Brouillon).Value);
            await ctx.SaveChangesAsync();
        }

        var result = await Service().CreateEntryForLineAsync(lineId, new CreateEntryForLineRequest { JournalCode = "JB", CounterpartyAccount = "658" });

        Assert.True(result.IsFailure);
    }
}
