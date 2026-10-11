using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using FactuTrust.Infrastructure.Tests.Fixtures;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Couvre <see cref="LetteringService.AutoLetterPayrollPaymentAsync"/>, le maillon qui bloquait
/// « Régler la paie » : un groupe de lettrage porte un compte unique, donc l'appariement doit être
/// indexé par numéro de compte — et un rapprochement impossible ne doit JAMAIS faire échouer le
/// règlement (sinon la transaction du paiement est annulée en entier).
/// SQL Server requis (LocalDB éphémère) : InMemory ignore les transactions.
/// </summary>
public sealed class PayrollPaymentLetteringTests : IDisposable
{
    private const string Bank = "5321";

    private readonly SqlTestDatabase _sqlDb = new(nameof(PayrollPaymentLetteringTests));
    private readonly string? _connectionString;
    private readonly bool _canRun;
    private readonly TenantAmbientTransaction _ambient = new();
    private readonly TenantDbContextFactory? _factory;
    private readonly LetteringService? _lettering;

    public PayrollPaymentLetteringTests()
    {
        _connectionString = _sqlDb.ConnectionString;
        _canRun = _sqlDb.CanRun;
        if (!_canRun)
            return;

        var tenantContext = new Mock<ITenantContext>();
        tenantContext.SetupGet(c => c.ConnectionString).Returns(_connectionString);

        var hostEnvironment = new Mock<IHostEnvironment>();
        hostEnvironment.SetupGet(e => e.EnvironmentName).Returns(Environments.Development);

        _factory = new TenantDbContextFactory(
            tenantContext.Object,
            new Mock<IMediator>().Object,
            _ambient,
            NullLogger<TenantDbContext>.Instance,
            NullLoggerFactory.Instance,
            new ConfigurationBuilder().Build(),
            hostEnvironment.Object);
        _lettering = new LetteringService(_factory, _ambient);
    }

    /// <summary>
    /// Le cas signalé : cycle validé avant les comptes auxiliaires (crédit 421 agrégé). Depuis le
    /// correctif, le paiement débite le même 421 — le lettrage doit aboutir.
    /// </summary>
    [Fact]
    public async Task AggregatedRunEntry_LettersAgainstAggregatedPaymentDebit()
    {
        if (!_canRun) return;

        var runId = Guid.NewGuid();
        var paymentId = Guid.NewGuid();

        await SeedAsync(
            runId,
            paymentId,
            runCredits: new[] { ("425", 926.341m, (Guid?)null, ThirdPartyKind.None) },
            paymentDebits: new[] { ("425", 926.341m, (Guid?)null, ThirdPartyKind.None) });

        var result = await _lettering!.AutoLetterPayrollPaymentAsync(paymentId, runId);
        Assert.True(result.IsSuccess);

        var codes = await LetteringCodesAsync("425");
        Assert.Equal(2, codes.Count);
        Assert.Single(codes.Distinct());
        Assert.StartsWith("L", codes[0]);
    }

    /// <summary>Format auxiliaire (cycles récents) : un groupe de lettrage par salarié.</summary>
    [Fact]
    public async Task AuxiliaryRunEntry_LettersPerEmployee()
    {
        if (!_canRun) return;

        var runId = Guid.NewGuid();
        var paymentId = Guid.NewGuid();
        var alice = Guid.NewGuid();
        var bob = Guid.NewGuid();

        await SeedAsync(
            runId,
            paymentId,
            runCredits: new[]
            {
                ("4250001", 600m, (Guid?)alice, ThirdPartyKind.Employee),
                ("4250002", 400m, (Guid?)bob, ThirdPartyKind.Employee)
            },
            paymentDebits: new[]
            {
                ("4250001", 600m, (Guid?)alice, ThirdPartyKind.Employee),
                ("4250002", 400m, (Guid?)bob, ThirdPartyKind.Employee)
            });

        var result = await _lettering!.AutoLetterPayrollPaymentAsync(paymentId, runId);
        Assert.True(result.IsSuccess);

        var first = await LetteringCodesAsync("4250001");
        var second = await LetteringCodesAsync("4250002");

        Assert.Equal(2, first.Count);
        Assert.Single(first.Distinct());
        Assert.Equal(2, second.Count);
        Assert.Single(second.Distinct());
        Assert.NotEqual(first[0], second[0]);   // deux groupes distincts, un par compte
    }

    /// <summary>
    /// Régression directe du bug : crédit agrégé « 421 » face à des débits auxiliaires « 421xxxx ».
    /// Avant correctif, un groupe multi-comptes était soumis et rendait « Toutes les lignes doivent
    /// être sur le même compte. », ce qui annulait tout le paiement. Désormais : succès, sans lettrage.
    /// </summary>
    [Fact]
    public async Task MismatchedAccounts_DoesNotFailAndLettersNothing()
    {
        if (!_canRun) return;

        var runId = Guid.NewGuid();
        var paymentId = Guid.NewGuid();
        var employeeId = Guid.NewGuid();

        await SeedAsync(
            runId,
            paymentId,
            runCredits: new[] { ("425", 926.341m, (Guid?)null, ThirdPartyKind.None) },
            paymentDebits: new[] { ("4250001", 926.341m, (Guid?)employeeId, ThirdPartyKind.Employee) });

        var result = await _lettering!.AutoLetterPayrollPaymentAsync(paymentId, runId);

        Assert.True(result.IsSuccess);   // le règlement ne doit jamais être bloqué par le lettrage

        await using var verify = _factory!.CreateIsolatedContext();
        Assert.Equal(0, await verify.LetteringGroups.CountAsync());
        Assert.False(await verify.JournalEntryLines.AsNoTracking()
            .AnyAsync(l => l.LetteringCode != null && l.LetteringCode != ""));
    }

    /// <summary>Règlement partiel : lettrage partiel (code « P »), pas d'échec sur le déséquilibre.</summary>
    [Fact]
    public async Task PartialPayment_UsesPartialLetteringCode()
    {
        if (!_canRun) return;

        var runId = Guid.NewGuid();
        var paymentId = Guid.NewGuid();

        await SeedAsync(
            runId,
            paymentId,
            runCredits: new[] { ("425", 1000m, (Guid?)null, ThirdPartyKind.None) },
            paymentDebits: new[] { ("425", 400m, (Guid?)null, ThirdPartyKind.None) });

        var result = await _lettering!.AutoLetterPayrollPaymentAsync(paymentId, runId);
        Assert.True(result.IsSuccess);

        var codes = await LetteringCodesAsync("425");
        Assert.Equal(2, codes.Count);
        Assert.StartsWith("P", codes[0]);
    }

    /// <summary>
    /// Une OD extournée (cycle rouvert puis revalidé) ne doit jamais être retenue à la place de
    /// l'écriture courante — sinon le lettrage viserait des montants périmés.
    /// </summary>
    [Fact]
    public async Task ReversedRunEntry_IsIgnoredInFavourOfActiveOne()
    {
        if (!_canRun) return;

        var runId = Guid.NewGuid();
        var paymentId = Guid.NewGuid();

        await using (var ctx = _factory!.CreateIsolatedContext())
        {
            var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
            ctx.AccountingPeriods.Add(period);

            // Ancienne OD, sur des montants périmés, marquée extournée.
            var stale = NewEntry(1, "JOD", new DateTime(2026, 8, 31), "Paie périmée", period.Id,
                AccountingService.SourcePayrollRun, runId,
                new[]
                {
                    new JournalLineInput("640", "Charges", 500m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("425", "Net", 0m, 500m, null, ThirdPartyKind.None)
                });
            stale.MarkReversedBy(Guid.NewGuid());

            var active = NewEntry(2, "JOD", new DateTime(2026, 8, 31), "Paie à jour", period.Id,
                AccountingService.SourcePayrollRun, runId,
                new[]
                {
                    new JournalLineInput("640", "Charges", 900m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput("425", "Net", 0m, 900m, null, ThirdPartyKind.None)
                });

            var payment = NewEntry(1, "JB", new DateTime(2026, 9, 3), "Paiement paie", period.Id,
                AccountingService.SourcePayrollPayment, paymentId,
                new[]
                {
                    new JournalLineInput("425", "Paiement", 900m, 0m, null, ThirdPartyKind.None),
                    new JournalLineInput(Bank, "Banque", 0m, 900m, null, ThirdPartyKind.None)
                });

            ctx.JournalEntries.AddRange(stale, active, payment);
            await ctx.SaveChangesAsync();
        }

        var result = await _lettering!.AutoLetterPayrollPaymentAsync(paymentId, runId);
        Assert.True(result.IsSuccess);

        await using var verify = _factory!.CreateIsolatedContext();
        var group = await verify.LetteringGroups.AsNoTracking().SingleAsync();
        Assert.Equal("L00001", group.Code);

        // La ligne lettrée côté cycle est celle de l'écriture ACTIVE (900), pas la périmée (500).
        var letteredRunLine = await verify.JournalEntryLines.AsNoTracking()
            .Where(l => l.AccountNumber == "425" && l.CreditAmount.Amount > 0 && l.LetteringCode != null)
            .SingleAsync();
        Assert.Equal(900m, letteredRunLine.CreditAmount.Amount);
    }

    /// <summary>
    /// Plan §11 PR1 : <see cref="LetteringService.UnletterPayrollPaymentAsync"/> est « best-effort »
    /// (D8) — si l'exercice a été verrouillé entre le lettrage et l'annulation du paiement, le
    /// délettrage échoue silencieusement (warning journalisé), mais l'annulation du paiement
    /// elle-même ne doit JAMAIS échouer à cause de ça, et le groupe de lettrage doit rester intact.
    /// </summary>
    [Fact]
    public async Task CancelPayment_RunInClosedPeriod_CancelsAndKeepsLettering()
    {
        if (!_canRun) return;

        var runId = Guid.NewGuid();
        var paymentId = Guid.NewGuid();
        var employeeId = Guid.NewGuid();

        await SeedAsync(
            runId,
            paymentId,
            runCredits: new[] { ("4250001", 400m, (Guid?)employeeId, ThirdPartyKind.Employee) },
            paymentDebits: new[] { ("4250001", 400m, (Guid?)employeeId, ThirdPartyKind.Employee) });

        var letterResult = await _lettering!.AutoLetterPayrollPaymentAsync(paymentId, runId);
        Assert.True(letterResult.IsSuccess);

        string? codeBefore;
        await using (var ctx = _factory!.CreateIsolatedContext())
        {
            codeBefore = await ctx.JournalEntryLines.AsNoTracking()
                .Where(l => l.AccountNumber == "4250001" && l.LetteringCode != null)
                .Select(l => l.LetteringCode)
                .FirstAsync();

            // Verrouille l'exercice 2026 APRÈS le lettrage, pour reproduire la fenêtre où
            // l'annulation du paiement intervient alors que la période a été clôturée depuis.
            ctx.AccountingYearLocks.Add(AccountingYearLock.Create(2026, "test"));
            await ctx.SaveChangesAsync();
        }

        var cancelResult = await _lettering!.UnletterPayrollPaymentAsync(paymentId);

        // L'annulation du paiement ne doit jamais échouer à cause d'un délettrage impossible.
        Assert.True(cancelResult.IsSuccess);

        await using var verify = _factory!.CreateIsolatedContext();
        var codeAfter = await verify.JournalEntryLines.AsNoTracking()
            .Where(l => l.AccountNumber == "4250001" && l.LetteringCode != null)
            .Select(l => l.LetteringCode)
            .FirstOrDefaultAsync();

        // Le groupe reste lettré : le délettrage interne a été refusé (période verrouillée) et
        // ignoré en best-effort, sans annuler ce qui précède.
        Assert.Equal(codeBefore, codeAfter);
        Assert.True(await verify.LetteringGroups.AsNoTracking().AnyAsync(g => g.Code == codeBefore));
    }

    // ── Helpers ──

    private async Task SeedAsync(
        Guid runId,
        Guid paymentId,
        (string Account, decimal Amount, Guid? ThirdPartyId, ThirdPartyKind Kind)[] runCredits,
        (string Account, decimal Amount, Guid? ThirdPartyId, ThirdPartyKind Kind)[] paymentDebits)
    {
        await using var ctx = _factory!.CreateIsolatedContext();
        var period = AccountingPeriod.Create(2026, 8, new DateTime(2026, 8, 1), new DateTime(2026, 8, 31));
        ctx.AccountingPeriods.Add(period);

        var runLines = new List<JournalLineInput>
        {
            new("640", "Charges de personnel", runCredits.Sum(c => c.Amount), 0m, null, ThirdPartyKind.None)
        };
        runLines.AddRange(runCredits.Select(c =>
            new JournalLineInput(c.Account, "Net à payer", 0m, c.Amount, c.ThirdPartyId, c.Kind)));

        var paymentLines = paymentDebits
            .Select(d => new JournalLineInput(d.Account, "Paiement paie", d.Amount, 0m, d.ThirdPartyId, d.Kind))
            .ToList();
        paymentLines.Add(new JournalLineInput(Bank, "Banque", 0m, paymentDebits.Sum(d => d.Amount), null, ThirdPartyKind.None));

        var runEntry = NewEntry(1, "JOD", new DateTime(2026, 8, 31), "Paie 08/2026", period.Id,
            AccountingService.SourcePayrollRun, runId, runLines);

        var paymentEntry = NewEntry(1, "JB", new DateTime(2026, 9, 3), "Paiement paie 08/2026", period.Id,
            AccountingService.SourcePayrollPayment, paymentId, paymentLines);

        ctx.JournalEntries.AddRange(runEntry, paymentEntry);
        await ctx.SaveChangesAsync();
    }

    private static JournalEntry NewEntry(
        int number,
        string journalCode,
        DateTime date,
        string label,
        Guid periodId,
        string sourceType,
        Guid sourceId,
        IEnumerable<JournalLineInput> lines)
    {
        var entry = JournalEntry.Create(
            number, journalCode, date, label, periodId, true, sourceType, sourceId, lines.ToList()).Value;
        entry.SetAuditInfo("test", false);
        return entry;
    }

    private async Task<List<string>> LetteringCodesAsync(string accountNumber)
    {
        await using var verify = _factory!.CreateIsolatedContext();
        return await verify.JournalEntryLines.AsNoTracking()
            .Where(l => l.AccountNumber == accountNumber && l.LetteringCode != null && l.LetteringCode != "")
            .Select(l => l.LetteringCode!)
            .ToListAsync();
    }

    public void Dispose() => _sqlDb.Dispose();
}
