using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using FactuTrust.Infrastructure.Services.Lettering;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.Lettering;

/// <summary>
/// Phase 3 du lettrage (p3-8) : le chargeur des candidats contre SQL Server réel. Vérifie que la
/// requête (filtre de verrou avec liste d'exercices, exclusions, tri, plafond) se traduit sans
/// exception, que le plafond s'applique après les exclusions, et que les liens règlement → facture
/// passent par paquets au-delà de 1 000 identifiants. Sauté si aucun SQL Server n'est disponible.
/// </summary>
[Collection(SqlServerSerialCollection.Name)]
public sealed class LetteringCandidateLoaderSqlTests : IDisposable
{
    private readonly SqlTestDatabase _sqlDb = new(nameof(LetteringCandidateLoaderSqlTests));

    public void Dispose() => _sqlDb.Dispose();

    private TenantDbContext NewContext() =>
        new(new DbContextOptionsBuilder<TenantDbContext>().UseSqlServer(_sqlDb.ConnectionString!).Options);

    private static GetLetteringLinesQuery Filter() =>
        new("4111", LetteringAccountMatch.Exact, new DateTime(2025, 1, 1), new DateTime(2026, 12, 31),
            LetteringStateFilter.All, null, null, null, null, LetteringSideFilter.All, null, null, null);

    private static JournalEntry Entry(int number, Guid periodId, DateTime date, decimal debit, decimal credit,
        string? sourceType, Guid? sourceId, JournalEntryStatus status = JournalEntryStatus.Validee)
    {
        var entry = JournalEntry.Create(
            number, "JV", date, $"Écriture {number}", periodId, false, sourceType, sourceId,
            new[]
            {
                new JournalLineInput("4111", $"Ligne {number}", debit, credit, null, ThirdPartyKind.None),
                new JournalLineInput("707", "Contrepartie", credit, debit, null, ThirdPartyKind.None),
            },
            initialStatus: status).Value;
        entry.SetAuditInfo("test", false);
        return entry;
    }

    [Fact]
    public async Task FiveThousandLines_WithManyPaymentSources_LoadsWithinCapAndChunksLinks()
    {
        if (!_sqlDb.CanRun) return;

        Guid periodId;
        Guid lockedPeriodId;
        await using (var ctx = NewContext())
        {
            var period = AccountingPeriod.Create(2026, 5, new DateTime(2026, 5, 1), new DateTime(2026, 5, 31));
            var locked = AccountingPeriod.Create(2025, 6, new DateTime(2025, 6, 1), new DateTime(2025, 6, 30));
            ctx.AccountingPeriods.AddRange(period, locked);
            ctx.AccountingYearLocks.Add(AccountingYearLock.Create(2025, "test"));
            await ctx.SaveChangesAsync();
            periodId = period.Id;
            lockedPeriodId = locked.Id;
        }

        // 300 lignes inutilisables placées EN TÊTE de l'ordre de lecture : si les exclusions
        // venaient après le plafond, elles le consommeraient.
        var number = 1;
        var unusable = new List<JournalEntry>();
        for (var i = 0; i < 100; i++)
            unusable.Add(Entry(number++, lockedPeriodId, new DateTime(2025, 6, 1), 1m, 0m, null, null));
        for (var i = 0; i < 100; i++)
            unusable.Add(Entry(number++, periodId, new DateTime(2026, 5, 1), 1m, 0m, null, null, JournalEntryStatus.Brouillon));
        for (var i = 0; i < 100; i++)
            unusable.Add(Entry(number++, periodId, new DateTime(2026, 5, 1), 1m, 0m, null, null, JournalEntryStatus.Cloturee));

        // 5 000 lignes utilisables, dont 1 500 de règlement (identifiants sans paiement réel :
        // seule compte la traduction des paquets ; les liens réels sont couverts en mémoire).
        var usable = new List<JournalEntry>();
        for (var i = 0; i < 5000; i++)
        {
            var isPayment = i % 10 < 3;
            usable.Add(Entry(number++, periodId, new DateTime(2026, 5, 2).AddDays(i % 25),
                isPayment ? 0m : 10m + i, isPayment ? 10m + i : 0m,
                isPayment ? AccountingService.SourcePayment : AccountingService.SourceInvoice, Guid.NewGuid()));
        }

        await using (var ctx = NewContext())
        {
            ctx.ChangeTracker.AutoDetectChangesEnabled = false;
            ctx.JournalEntries.AddRange(unusable);
            ctx.JournalEntries.AddRange(usable);
            await ctx.SaveChangesAsync();
        }

        LoadedCandidates full;
        LoadedCandidates capped;
        await using (var ctx = NewContext())
        {
            full = await LetteringCandidateLoader.LoadAsync(ctx, Filter(), 5000, CancellationToken.None);
            capped = await LetteringCandidateLoader.LoadAsync(ctx, Filter(), 4000, CancellationToken.None);
        }

        Assert.Equal(5000, full.Candidates.Count);
        Assert.False(full.Truncated);
        Assert.Equal(1500, full.Candidates.Count(c => c.SourceEntityType == AccountingService.SourcePayment));
        Assert.Empty(full.Links.PaymentToInvoice);
        Assert.Equal(Enumerable.Range(0, 5000), full.Candidates.Select(c => c.OrderRank));

        var expectedIds = usable.Select(e => e.Lines.Single(l => l.AccountNumber == "4111").Id).ToHashSet();
        Assert.True(expectedIds.SetEquals(full.Candidates.Select(c => c.LineId)));

        Assert.True(capped.Truncated);
        Assert.Equal(4000, capped.Candidates.Count);
        Assert.Equal(full.Candidates.Take(4000).Select(c => c.LineId), capped.Candidates.Select(c => c.LineId));

        // Ordre stable : date, journal, numéro, ligne, identifiant.
        for (var i = 1; i < full.Candidates.Count; i++)
        {
            var (a, b) = (full.Candidates[i - 1], full.Candidates[i]);
            Assert.True(a.EntryDate < b.EntryDate || (a.EntryDate == b.EntryDate && a.EntryNumber < b.EntryNumber),
                $"Ordre rompu à l'index {i}.");
        }
    }

    [Fact]
    public async Task RealPaymentLink_IsLoaded()
    {
        if (!_sqlDb.CanRun) return;

        var payment = LetteringCandidateLoaderTests.ClientPayment();
        Guid periodId;
        await using (var ctx = NewContext())
        {
            var period = AccountingPeriod.Create(2026, 5, new DateTime(2026, 5, 1), new DateTime(2026, 5, 31));
            ctx.AccountingPeriods.Add(period);
            ctx.Payments.Add(payment);
            await ctx.SaveChangesAsync();
            periodId = period.Id;
        }

        await using (var ctx = NewContext())
        {
            ctx.JournalEntries.Add(Entry(1, periodId, new DateTime(2026, 5, 10), 50m, 0m, AccountingService.SourceInvoice, payment.InvoiceId));
            ctx.JournalEntries.Add(Entry(2, periodId, new DateTime(2026, 5, 11), 0m, 50m, AccountingService.SourcePayment, payment.Id));
            await ctx.SaveChangesAsync();
        }

        await using (var ctx = NewContext())
        {
            var loaded = await LetteringCandidateLoader.LoadAsync(ctx, Filter(), 5000, CancellationToken.None);
            Assert.Equal(2, loaded.Candidates.Count);
            Assert.Equal(payment.InvoiceId, loaded.Links.PaymentToInvoice[payment.Id]);
        }
    }
}
