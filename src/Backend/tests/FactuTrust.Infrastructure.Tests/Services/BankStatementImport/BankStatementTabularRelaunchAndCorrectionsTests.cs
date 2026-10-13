using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Banking;
using FactuTrust.Domain.Entities;
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
/// Fiches de relecture révisées (round 2) qui s'appuient sur <see cref="BankStatementImportService"/>
/// plutôt que sur le service tabulaire lui-même : relance (retarget/retry) refusée pour une session
/// CSV/XLSX avant toute mutation (#7), levée des signalements d'ambiguïté de sens exigeant une
/// correction du sens (#8), résolution du compte d'attente 471 tolérante aux pannes (#12).
/// </summary>
public sealed class BankStatementTabularRelaunchAndCorrectionsTests : IDisposable
{
    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly string _dbName = $"BankStatementTabularRelaunch_{Guid.NewGuid():N}";
    private readonly string _storage = Path.Combine(Path.GetTempPath(), "ft-bqtr-tests", Guid.NewGuid().ToString("N"));
    private readonly Mock<IAuditService> _audit = new();
    private readonly InMemoryFactory _factory;

    public BankStatementTabularRelaunchAndCorrectionsTests() => _factory = new InMemoryFactory(_dbName);

    public void Dispose()
    {
        try { if (Directory.Exists(_storage)) Directory.Delete(_storage, recursive: true); }
        catch (IOException) { }
    }

    private sealed class InMemoryFactory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() => new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }

    private BankStatementImportService Service(bool userHasAiRight = true, ITenantDbContextFactory? factory = null)
    {
        var settings = new AccountingSettings { BankStatementAiPostingEnabled = true };
        settings.BankStatementImport.StorageBasePath = _storage;
        var options = Options.Create(settings);
        var tenant = new Mock<ITenantContext>();
        tenant.SetupGet(t => t.TenantId).Returns(_tenantId);
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.Email).Returns("comptable@test.tn");
        user.SetupGet(u => u.TenantId).Returns(_tenantId);
        user.Setup(u => u.HasPermission(It.IsAny<string>())).Returns(userHasAiRight);
        var ai = new Mock<IBankStatementAiExtraction>();
        ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BankStatementAiAvailability(true, "local", "ollama:test", null));
        return new BankStatementImportService(factory ?? _factory, tenant.Object, user.Object, _audit.Object, ai.Object,
            new BankStatementFileStore(options), new BankStatementLayoutExtractor(), options,
            NullLogger<BankStatementImportService>.Instance);
    }

    private const string Rib = "10001000123456789018";

    private Guid SeedBankAccount(string glAccount = "53210001")
    {
        var account = BankAccount.Create(Guid.NewGuid(), "STB", "Société Tunisienne de Banque", Rib, TunisianIban.FromRib(Rib)!).Value;
        Assert.True(account.SetChartOfAccountNumber(glAccount).IsSuccess);
        using var ctx = _factory.CreateContext();
        ctx.BankAccounts.Add(account);
        ctx.SaveChanges();
        return account.Id;
    }

    private static readonly BankStatementTabularMappingDto Mapping = new()
    {
        HeaderRowIndex = 0,
        DateFormat = "dd/MM/yyyy",
        DecimalSeparator = ",",
        AmountMode = "debitCredit",
        DateColumn = 0,
        LabelColumns = new[] { 1 },
        DebitColumn = 2,
        CreditColumn = 3
    };

    /// <summary>
    /// Insère directement une session CSV « AwaitingReview » dont l'unique ligne porte le
    /// signalement <paramref name="issueCode"/> (bâtie via le même pipeline de lecture que le
    /// service réel, pas un JSON écrit à la main) et renvoie son identifiant.
    /// </summary>
    private async Task<Guid> SeedTabularSession(Guid accountId, string csvBody, BankStatementTabularMappingDto? mapping = null)
    {
        var content = System.Text.Encoding.UTF8.GetBytes(csvBody);
        var limits = new BankStatementImportLimits();
        var table = BankStatementTabularReader.LoadRawTable(content, ".csv", limits).Value;
        var extraction = BankStatementTabularReader.BuildExtraction(table, mapping ?? Mapping, limits, Rib).Value;
        var json = JsonSerializer.Serialize(extraction, BankStatementImportService.JsonOptions);

        var session = BankStatementImportSession.Create(accountId, "JB", "releve.csv",
            Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(content)), content.Length, "text/csv",
            DateTime.UtcNow.AddHours(24));
        session.AttachFile("releve.csv");
        session.CompleteExtraction(json, BankStatementImportExtractionMethods.Csv, BankStatementImportExtractionMethods.TabularProfileId, pageCount: 1);

        await using var ctx = _factory.CreateContext();
        ctx.BankStatementImportSessions.Add(session);
        await ctx.SaveChangesAsync();
        return session.Id;
    }

    private async Task<BankStatementImportSession> LoadSession(Guid id)
    {
        await using var ctx = _factory.CreateContext();
        return await ctx.BankStatementImportSessions.AsNoTracking().SingleAsync(s => s.Id == id);
    }

    // ── §7 : relance (retarget/retry) refusée pour une session CSV/XLSX, avant toute mutation ──

    [Fact]
    public async Task Retry_on_a_tabular_session_is_rejected_and_leaves_it_untouched()
    {
        var accountId = SeedBankAccount();
        var sessionId = await SeedTabularSession(accountId, "Date;Libelle;Debit;Credit\n01/01/2026;OP;;100,000\n");

        var result = await Service().RetryAsync(sessionId);

        Assert.Equal(BankStatementImportErrorCodes.TabularRelaunchNotSupported, result.Error.Code);
        var reloaded = await LoadSession(sessionId);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), reloaded.Status.ToString());
        Assert.NotNull(reloaded.ResultJson);
    }

    [Fact]
    public async Task Retarget_on_a_tabular_session_is_rejected_and_leaves_it_untouched()
    {
        var accountId = SeedBankAccount();
        var otherAccountId = SeedBankAccount("53210002");
        var sessionId = await SeedTabularSession(accountId, "Date;Libelle;Debit;Credit\n01/01/2026;OP;;100,000\n");

        var result = await Service().RetargetAsync(sessionId, otherAccountId);

        Assert.Equal(BankStatementImportErrorCodes.TabularRelaunchNotSupported, result.Error.Code);
        var reloaded = await LoadSession(sessionId);
        Assert.Equal(accountId, reloaded.BankAccountId);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), reloaded.Status.ToString());
    }

    // ── §8 : TabularBothSides / TabularAmountInvalid exigent une correction du SENS pour se lever ──

    [Fact]
    public async Task Correcting_only_the_amount_does_not_clear_a_both_sides_issue()
    {
        var accountId = SeedBankAccount();
        // Débit ET crédit renseignés sur la même ligne : BuildExtraction lève TabularBothSides,
        // Amount=0, IsDebit=false (valeur par défaut quand le sens n'a pas pu être déterminé).
        var sessionId = await SeedTabularSession(accountId, "Date;Libelle;Debit;Credit\n01/01/2026;OP;50,000;60,000\n");

        var confirm = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest
        {
            Corrections = new[] { new StatementLineCorrection { LineIndex = 0, Amount = 55m } }
        });

        Assert.Equal(BankStatementImportErrorCodes.BlockingIssues, confirm.Error.Code);
    }

    [Fact]
    public async Task Correcting_the_amount_and_the_side_together_clears_a_both_sides_issue()
    {
        var accountId = SeedBankAccount();
        // Soldes cohérents avec la ligne UNE FOIS corrigée (débit de 55) pour que seul le
        // signalement d'ambiguïté de sens soit en jeu, pas un écart de solde recalculé.
        var mapping = Mapping with { OpeningBalance = 1000m, ClosingBalance = 945m };
        var sessionId = await SeedTabularSession(accountId, "Date;Libelle;Debit;Credit\n01/01/2026;OP;50,000;60,000\n", mapping);

        var confirm = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest
        {
            Corrections = new[] { new StatementLineCorrection { LineIndex = 0, Amount = 55m, IsDebit = true } }
        });

        Assert.True(confirm.IsSuccess, confirm.IsFailure ? confirm.Error.Description : null);
    }

    [Fact]
    public async Task Correcting_only_the_amount_does_not_clear_an_unreadable_amount_issue()
    {
        var accountId = SeedBankAccount();
        // Ni débit ni crédit renseignés : BuildExtraction lève TabularAmountInvalid.
        var sessionId = await SeedTabularSession(accountId, "Date;Libelle;Debit;Credit\n01/01/2026;OP;;\n");

        var confirm = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest
        {
            Corrections = new[] { new StatementLineCorrection { LineIndex = 0, Amount = 30m } }
        });

        Assert.Equal(BankStatementImportErrorCodes.BlockingIssues, confirm.Error.Code);
    }

    [Fact]
    public async Task Correcting_the_amount_and_the_side_together_clears_an_unreadable_amount_issue()
    {
        var accountId = SeedBankAccount();
        var mapping = Mapping with { OpeningBalance = 1000m, ClosingBalance = 1030m };
        var sessionId = await SeedTabularSession(accountId, "Date;Libelle;Debit;Credit\n01/01/2026;OP;;\n", mapping);

        var confirm = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest
        {
            Corrections = new[] { new StatementLineCorrection { LineIndex = 0, Amount = 30m, IsDebit = false } }
        });

        Assert.True(confirm.IsSuccess, confirm.IsFailure ? confirm.Error.Description : null);
    }

    // ── §12 : résolution du compte d'attente 471 tolérante aux pannes ────────────────────────

    [Fact]
    public async Task Suspense_account_lookup_returns_null_instead_of_throwing_when_the_context_factory_fails()
    {
        var brokenFactory = new Mock<ITenantDbContextFactory>();
        brokenFactory.Setup(f => f.CreateContext()).Throws(new InvalidOperationException("Connexion indisponible."));

        var result = await Service(factory: brokenFactory.Object).GetSuspenseAccountNumberAsync();

        Assert.Null(result);
    }
}
