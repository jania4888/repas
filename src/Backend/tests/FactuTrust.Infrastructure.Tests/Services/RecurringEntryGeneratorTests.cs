using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Lot E : écritures récurrentes — calcul des échéances, génération en contexte (période,
/// numérotation, statut brouillard) et idempotence (NextRunDate avancé avec l'écriture).
/// </summary>
public sealed class RecurringEntryGeneratorTests
{
    private readonly string _dbName = $"RecurDb_{Guid.NewGuid()}";
    private readonly TestTenantDbContextFactory _factory;

    public RecurringEntryGeneratorTests()
    {
        _factory = new TestTenantDbContextFactory(_dbName);
        SeedAccounts();
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

    private void SeedAccounts()
    {
        using var ctx = _factory.CreateContext();
        ctx.ChartOfAccounts.Add(ChartOfAccount.Create("6132", "Loyers", 6, null, AccountNatureType.Debit).Value);
        ctx.ChartOfAccounts.Add(ChartOfAccount.Create("532", "Banque", 5, null, AccountNatureType.Debit).Value);
        ctx.SaveChanges();
    }

    private Guid SeedRecurringTemplate(decimal amount = 800m, DateTime? start = null)
    {
        var template = JournalEntryTemplate.Create("Loyer bureau", "JOD", labelTemplate: "Loyer mensuel bureau").Value;
        template.AddLine(JournalEntryTemplateLine.Create(template, 1, "6132", "Loyer", fixedDebit: amount).Value);
        template.AddLine(JournalEntryTemplateLine.Create(template, 2, "532", "Banque", fixedCredit: amount).Value);
        var config = template.ConfigureRecurrence(
            RecurrenceFrequency.Monthly, 5, start ?? new DateTime(2026, 5, 1), null);
        Assert.True(config.IsSuccess, config.IsFailure ? config.Error.Description : "");
        template.SetAuditInfo("test", false);

        using var ctx = _factory.CreateContext();
        ctx.JournalEntryTemplates.Add(template);
        ctx.SaveChanges();
        return template.Id;
    }

    private RecurringEntryGenerator BuildGenerator() => new(NullLogger<RecurringEntryGenerator>.Instance);

    // ── Calcul des échéances (domaine, pur) ─────────────────────────────────────

    [Fact]
    public void ComputeFirstRunDate_OnOrAfterStart()
    {
        Assert.Equal(new DateTime(2026, 5, 5), JournalEntryTemplate.ComputeFirstRunDate(new DateTime(2026, 5, 1), 5));
        Assert.Equal(new DateTime(2026, 6, 5), JournalEntryTemplate.ComputeFirstRunDate(new DateTime(2026, 5, 10), 5));
        Assert.Equal(new DateTime(2026, 5, 10), JournalEntryTemplate.ComputeFirstRunDate(new DateTime(2026, 5, 10), 10));
    }

    [Theory]
    [InlineData(RecurrenceFrequency.Monthly, "2026-05-05", "2026-06-05")]
    [InlineData(RecurrenceFrequency.Quarterly, "2026-05-05", "2026-08-05")]
    [InlineData(RecurrenceFrequency.Yearly, "2026-05-05", "2027-05-05")]
    [InlineData(RecurrenceFrequency.Monthly, "2026-01-28", "2026-02-28")] // février géré (jour ≤ 28)
    public void ComputeNextRunDate_AdvancesByFrequency(RecurrenceFrequency freq, string from, string expected)
    {
        var fromDate = DateTime.Parse(from);
        var day = fromDate.Day;

        var next = JournalEntryTemplate.ComputeNextRunDate(fromDate, freq, day);

        Assert.Equal(DateTime.Parse(expected), next);
    }

    [Fact]
    public void ConfigureRecurrence_RequiresFullyFixedBalancedLines()
    {
        var template = JournalEntryTemplate.Create("Incomplet", "JOD").Value;
        template.AddLine(JournalEntryTemplateLine.Create(template, 1, "6132", "Loyer", fixedDebit: 800m).Value);
        template.AddLine(JournalEntryTemplateLine.Create(template, 2, "532", "Banque").Value); // sans montant

        var result = template.ConfigureRecurrence(RecurrenceFrequency.Monthly, 5, new DateTime(2026, 5, 1), null);

        Assert.True(result.IsFailure);
        Assert.Contains("montant fixe", result.Error.Description);
    }

    [Fact]
    public void MarkRun_StopsAfterEndDate()
    {
        var template = JournalEntryTemplate.Create("Borné", "JOD").Value;
        template.AddLine(JournalEntryTemplateLine.Create(template, 1, "6132", "Loyer", fixedDebit: 100m).Value);
        template.AddLine(JournalEntryTemplateLine.Create(template, 2, "532", "Banque", fixedCredit: 100m).Value);
        Assert.True(template.ConfigureRecurrence(RecurrenceFrequency.Monthly, 5,
            new DateTime(2026, 5, 1), new DateTime(2026, 6, 30)).IsSuccess);

        template.MarkRun(new DateTime(2026, 5, 5));
        Assert.Equal(new DateTime(2026, 6, 5), template.NextRunDate);

        template.MarkRun(new DateTime(2026, 6, 5));
        Assert.Null(template.NextRunDate); // 05/07 > fin ⇒ récurrence épuisée
    }

    // ── Génération en contexte ──────────────────────────────────────────────────

    [Fact]
    public async Task GenerateDueEntries_CreatesEntryAndAdvancesNextRun()
    {
        var templateId = SeedRecurringTemplate();
        var settings = new AccountingSettings { BrouillardEnabled = true };

        await using var ctx = _factory.CreateContext();
        var generated = await BuildGenerator().GenerateDueEntriesAsync(ctx, settings, new DateTime(2026, 5, 6));

        Assert.Equal(1, generated);
        await using var check = _factory.CreateContext();
        var entry = check.JournalEntries.AsNoTracking().Include(e => e.Lines).Single();
        Assert.Equal("JOD", entry.JournalCode);
        Assert.Equal(new DateTime(2026, 5, 5), entry.EntryDate);
        Assert.Equal(JournalEntryStatus.Validee, entry.Status); // pièce automatique : le brouillard ne s'applique pas
        Assert.Null(entry.ValidatedBy);
        Assert.Null(entry.ValidatedAt);
        Assert.Contains("05/2026", entry.Label);
        Assert.Equal(RecurringEntryGenerator.SourceRecurringTemplate, entry.SourceEntityType);
        Assert.Equal(templateId, entry.SourceEntityId);
        Assert.Equal(2, entry.Lines.Count);

        var template = check.JournalEntryTemplates.AsNoTracking().Single();
        Assert.Equal(new DateTime(2026, 6, 5), template.NextRunDate);
        Assert.NotNull(template.LastRunAt);
    }

    [Fact]
    public async Task GenerateDueEntries_NotDue_GeneratesNothing()
    {
        SeedRecurringTemplate();
        var settings = new AccountingSettings();

        await using var ctx = _factory.CreateContext();
        var generated = await BuildGenerator().GenerateDueEntriesAsync(ctx, settings, new DateTime(2026, 5, 4));

        Assert.Equal(0, generated);
        await using var check = _factory.CreateContext();
        Assert.Empty(check.JournalEntries.AsNoTracking().ToList());
    }

    [Fact]
    public async Task GenerateDueEntries_CatchesUpLateOccurrences()
    {
        // Deux échéances en retard (05/05 et 05/06) : rattrapées dans le même passage.
        SeedRecurringTemplate();
        var settings = new AccountingSettings();

        await using var ctx = _factory.CreateContext();
        var generated = await BuildGenerator().GenerateDueEntriesAsync(ctx, settings, new DateTime(2026, 6, 10));

        Assert.Equal(2, generated);
        await using var check = _factory.CreateContext();
        var dates = check.JournalEntries.AsNoTracking().Select(e => e.EntryDate).OrderBy(d => d).ToList();
        Assert.Equal(new[] { new DateTime(2026, 5, 5), new DateTime(2026, 6, 5) }, dates);
        Assert.Equal(new DateTime(2026, 7, 5), check.JournalEntryTemplates.AsNoTracking().Single().NextRunDate);
    }

    [Fact]
    public async Task GenerateDueEntries_BrouillardOff_CreatesValidatedEntry()
    {
        SeedRecurringTemplate();
        var settings = new AccountingSettings { BrouillardEnabled = false };

        await using var ctx = _factory.CreateContext();
        await BuildGenerator().GenerateDueEntriesAsync(ctx, settings, new DateTime(2026, 5, 6));

        await using var check = _factory.CreateContext();
        Assert.Equal(JournalEntryStatus.Validee, check.JournalEntries.AsNoTracking().Single().Status);
    }

    [Fact]
    public async Task GenerateOccurrence_ClosedPeriod_FallsBackToToday()
    {
        var templateId = SeedRecurringTemplate();
        using (var seed = _factory.CreateContext())
        {
            var may = AccountingPeriod.Create(2026, 5, new DateTime(2026, 5, 1), new DateTime(2026, 5, 31));
            may.Close("test");
            may.SetAuditInfo("test", false);
            seed.AccountingPeriods.Add(may);
            seed.SaveChanges();
        }

        var settings = new AccountingSettings();
        await using var ctx = _factory.CreateContext();
        var template = await ctx.JournalEntryTemplates.Include(t => t.Lines).SingleAsync(t => t.Id == templateId);

        var result = await BuildGenerator().GenerateOccurrenceAsync(ctx, settings, template, new DateTime(2026, 5, 5));

        Assert.True(result.IsSuccess);
        await using var check = _factory.CreateContext();
        var entry = check.JournalEntries.AsNoTracking().Single();
        Assert.Equal(DateTime.UtcNow.Date, entry.EntryDate); // repli : période de mai close
        Assert.Contains("05/2026", entry.Label);             // mais le libellé garde l'échéance
    }

    [Fact]
    public async Task GenerateOccurrence_InactiveAccount_FailsWithoutAdvancing()
    {
        var templateId = SeedRecurringTemplate();
        using (var seed = _factory.CreateContext())
        {
            var account = seed.ChartOfAccounts.Single(c => c.AccountNumber == "6132");
            account.ToggleActive(); // désactivé
            seed.SaveChanges();
        }

        var settings = new AccountingSettings();
        await using var ctx = _factory.CreateContext();
        var generated = await BuildGenerator().GenerateDueEntriesAsync(ctx, settings, new DateTime(2026, 5, 6));

        Assert.Equal(0, generated);
        await using var check = _factory.CreateContext();
        Assert.Empty(check.JournalEntries.AsNoTracking().ToList());
        // Échéance NON avancée : sera retentée une fois le compte réactivé.
        Assert.Equal(new DateTime(2026, 5, 5), check.JournalEntryTemplates.AsNoTracking().Single().NextRunDate);
    }
}
