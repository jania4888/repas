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
/// Association automatique « v2 » (drapeau BankReconciliationMatchingV2Enabled) : compte banque
/// cherché aussi sur ses parents 532…, lien source prioritaire. Drapeau éteint ⇒ historique inchangé.
/// </summary>
public sealed class BankAutoAssociationV2Tests
{
    private const string BankGl = "53210001";
    private readonly string _dbName = $"BankAutoV2_{Guid.NewGuid():N}";
    private readonly Factory _factory;

    public BankAutoAssociationV2Tests() => _factory = new Factory(_dbName);

    private sealed class Factory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() => new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }

    private BankReconciliationService Service(bool v2)
    {
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.Email).Returns("compta@test.tn");
        var settings = Options.Create(new AccountingSettings { BankMatchWindowDays = 10, BankReconciliationMatchingV2Enabled = v2 });
        return new BankReconciliationService(_factory, Mock.Of<IAuditService>(), user.Object, Mock.Of<IBankStatementPdfImportService>(),
            new AccountingReportingService(_factory, settings), settings);
    }

    private async Task<(Guid StatementId, List<Guid> LineIds)> StatementAsync(params (decimal Amount, bool IsDebit)[] lines)
    {
        var result = await Service(v2: false).ImportStatementAsync(new ImportBankStatementRequest
        {
            BankName = "STB",
            AccountNumber = "10100000000123456792",
            ChartOfAccountNumber = BankGl,
            StatementDate = new DateTime(2026, 4, 30),
            PeriodStart = new DateTime(2026, 4, 1),
            PeriodEnd = new DateTime(2026, 4, 30),
            Lines = lines.Select(l => new ImportBankStatementLineRequest
            {
                TransactionDate = new DateTime(2026, 4, 7), Reference = "R", Description = "COMMISSION DE DOMICILIATION", Amount = l.Amount, IsDebit = l.IsDebit
            }).ToList()
        });
        await using var ctx = _factory.CreateContext();
        return (result.Value.Id, ctx.BankStatementLines.Where(l => l.BankStatementId == result.Value.Id).Select(l => l.Id).ToList());
    }

    private Guid Entry(int number, string bankAccount, decimal amount, bool bankDebit, string? sourceType = null, Guid? sourceId = null)
    {
        using var ctx = _factory.CreateContext();
        var period = AccountingPeriod.Create(2026, 4, new DateTime(2026, 4, 1), new DateTime(2026, 4, 30));
        ctx.AccountingPeriods.Add(period);
        var lines = bankDebit
            ? new[] { new JournalLineInput(bankAccount, "B", amount, 0m, null, ThirdPartyKind.None), new JournalLineInput("4111", "C", 0m, amount, null, ThirdPartyKind.None) }
            : new[] { new JournalLineInput("6278", "F", amount, 0m, null, ThirdPartyKind.None), new JournalLineInput(bankAccount, "B", 0m, amount, null, ThirdPartyKind.None) };
        var entry = JournalEntry.Create(number, "JB", new DateTime(2026, 4, 7), "E", period.Id, false, sourceType, sourceId, lines).Value;
        ctx.JournalEntries.Add(entry);
        ctx.SaveChanges();
        return entry.Lines.Single(l => l.AccountNumber == bankAccount).Id;
    }

    [Fact]
    public async Task Payment_posted_on_the_parent_5321_is_found_only_with_v2()
    {
        var (statementId, _) = await StatementAsync((500m, false));
        Entry(1, "5321", 500m, bankDebit: true);

        var legacy = await Service(v2: false).AutoAssociateAsync(statementId);
        Assert.Equal((int)BankLineAssociationStatus.NotAssociated, Assert.Single(legacy.Value.Associations).Status);

        var v2 = await Service(v2: true).AutoAssociateAsync(statementId);
        Assert.Equal((int)BankLineAssociationStatus.Associated, Assert.Single(v2.Value.Associations).Status);
    }

    [Fact]
    public async Task Identical_operations_are_each_associated_with_their_own_generated_entry()
    {
        var (statementId, lineIds) = await StatementAsync((10m, true), (10m, true), (10m, true));
        var expected = lineIds.ToDictionary(id => id, id => Entry(lineIds.IndexOf(id) + 1, BankGl, 10m, bankDebit: false, "BankStatementLine", id));

        var legacy = await Service(v2: false).AutoAssociateAsync(statementId);
        Assert.All(legacy.Value.Associations, a => Assert.Equal((int)BankLineAssociationStatus.ToReconcile, a.Status));

        var v2 = await Service(v2: true).AutoAssociateAsync(statementId);
        Assert.All(v2.Value.Associations, a =>
        {
            Assert.Equal((int)BankLineAssociationStatus.Associated, a.Status);
            Assert.Equal(expected[a.BankStatementLineId], a.ProposedJournalEntryLineId);
        });
    }
}
