using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Banking;
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
/// Import CSV/XLSX (plan §3.2/3.6/3.7) : aperçu sans effet de bord, démarrage de session (même
/// cycle de vie que le chemin PDF/IA), remplacement de résultat pour le même fichier avec un
/// nouveau mappage, mémorisation du mappage sans soldes ni lignes ignorées, drapeau éteint.
/// </summary>
public sealed class BankStatementTabularImportServiceTests : IDisposable
{
    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly string _dbName = $"BankStatementTabular_{Guid.NewGuid():N}";
    private readonly string _storage = Path.Combine(Path.GetTempPath(), "ft-bqta-tests", Guid.NewGuid().ToString("N"));
    private readonly Mock<IAuditService> _audit = new();
    private readonly InMemoryFactory _factory;

    public BankStatementTabularImportServiceTests() => _factory = new InMemoryFactory(_dbName);

    public void Dispose()
    {
        try { if (Directory.Exists(_storage)) Directory.Delete(_storage, recursive: true); }
        catch (IOException) { }
    }

    private sealed class InMemoryFactory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() => new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }

    private BankStatementTabularImportService Service(bool aiPostingEnabled = true, bool tabularEnabled = true)
    {
        var settings = new AccountingSettings { BankStatementAiPostingEnabled = aiPostingEnabled, BankStatementTabularImportEnabled = tabularEnabled };
        settings.BankStatementImport.StorageBasePath = _storage;
        var options = Options.Create(settings);
        var tenant = new Mock<ITenantContext>();
        tenant.SetupGet(t => t.TenantId).Returns(_tenantId);
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.Email).Returns("comptable@test.tn");
        user.SetupGet(u => u.TenantId).Returns(_tenantId);
        return new BankStatementTabularImportService(_factory, tenant.Object, user.Object, _audit.Object,
            new BankStatementFileStore(options), options, NullLogger<BankStatementTabularImportService>.Instance);
    }

    private Guid SeedBankAccount(string rib, string glAccount = "53210001")
    {
        var account = BankAccount.Create(Guid.NewGuid(), "STB", "Société Tunisienne de Banque", rib, TunisianIban.FromRib(rib)!).Value;
        Assert.True(account.SetChartOfAccountNumber(glAccount).IsSuccess);
        using var ctx = _factory.CreateContext();
        ctx.BankAccounts.Add(account);
        ctx.SaveChanges();
        return account.Id;
    }

    private const string Rib = "10001000123456789018";

    private static byte[] Csv(string content) => System.Text.Encoding.UTF8.GetBytes(content);

    private static readonly string SimpleCsv =
        "Date;Libelle;Debit;Credit\n01/01/2026;VIREMENT RECU;;100,000\n02/01/2026;COMMISSION;5,000;\n";

    private static BankStatementTabularMappingDto Mapping(bool remember = false) => new()
    {
        HeaderRowIndex = 0,
        DateFormat = "dd/MM/yyyy",
        DecimalSeparator = ",",
        AmountMode = "debitCredit",
        DateColumn = 0,
        LabelColumns = new[] { 1 },
        DebitColumn = 2,
        CreditColumn = 3,
        RememberMapping = remember
    };

    private static BankStatementTabularPreviewRequest PreviewRequest(byte[] content, Guid? bankAccountId = null, BankStatementTabularMappingDto? mapping = null) => new()
    {
        Content = new MemoryStream(content),
        FileName = "releve.csv",
        Length = content.Length,
        Mapping = mapping,
        BankAccountId = bankAccountId
    };

    private static StartBankStatementImportRequest StartRequest(byte[] content, Guid accountId, string fileName = "releve.csv") => new()
    {
        Content = new MemoryStream(content),
        FileName = fileName,
        ContentType = "text/csv",
        Length = content.Length,
        BankAccountId = accountId,
        JournalCode = "JB"
    };

    [Fact]
    public async Task Disabled_flag_refuses_preview_and_start()
    {
        var preview = await Service(tabularEnabled: false).PreviewAsync(PreviewRequest(Csv(SimpleCsv)));
        Assert.Equal(BankStatementTabularErrorCodes.TabularDisabled, preview.Error.Code);

        var start = await Service(tabularEnabled: false).StartAsync(StartRequest(Csv(SimpleCsv), Guid.NewGuid()), Mapping());
        Assert.Equal(BankStatementTabularErrorCodes.TabularDisabled, start.Error.Code);
    }

    [Fact]
    public async Task Preview_has_no_side_effect_no_session_no_file_no_audit()
    {
        var accountId = SeedBankAccount(Rib);

        var preview = await Service().PreviewAsync(PreviewRequest(Csv(SimpleCsv), accountId));

        Assert.True(preview.IsSuccess, preview.IsFailure ? preview.Error.Description : null);
        Assert.Equal(2, preview.Value.OperationRowCount);
        await using var ctx = _factory.CreateContext();
        Assert.Equal(0, await ctx.BankStatementImportSessions.CountAsync());
        Assert.False(Directory.Exists(_storage) && Directory.GetFiles(_storage, "*", SearchOption.AllDirectories).Length > 0);
        _audit.Verify(a => a.LogAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Start_opens_a_session_awaiting_review_with_tabular_lines()
    {
        var accountId = SeedBankAccount(Rib);

        var result = await Service().StartAsync(StartRequest(Csv(SimpleCsv), accountId), Mapping());

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var session = result.Value;
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), session.Status);
        Assert.Equal(BankStatementImportExtractionMethods.Csv, session.ExtractionMethod);
        Assert.Equal(BankStatementImportExtractionMethods.TabularProfileId, session.ProfileId);
        Assert.Equal(2, session.Extraction!.Lines.Count);
        Assert.All(session.Extraction.Lines, l => Assert.Equal(StatementLineSource.Tabular, l.Source));
        Assert.Single(Directory.GetFiles(_storage, "*.csv", SearchOption.AllDirectories));
        _audit.Verify(a => a.LogAsync(FactuTrust.Domain.Entities.AuditActions.Accounting.BankStatementAnalyzed,
            nameof(BankStatementImportSession), session.Id, null, It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Invalid_mapping_is_rejected_before_any_write()
    {
        var accountId = SeedBankAccount(Rib);
        var badMapping = Mapping() with { DateColumn = 99 };

        var result = await Service().StartAsync(StartRequest(Csv(SimpleCsv), accountId), badMapping);

        Assert.Equal(BankStatementTabularErrorCodes.TabularMappingInvalid, result.Error.Code);
        await using var ctx = _factory.CreateContext();
        Assert.Equal(0, await ctx.BankStatementImportSessions.CountAsync());
    }

    [Fact]
    public async Task Same_file_with_a_different_mapping_replaces_the_existing_session_result()
    {
        var accountId = SeedBankAccount(Rib);
        var content = Csv(SimpleCsv);

        var first = await Service().StartAsync(StartRequest(content, accountId), Mapping());
        Assert.True(first.IsSuccess, first.IsFailure ? first.Error.Description : null);

        var secondMapping = Mapping() with { LabelColumns = new[] { 1 }, DecimalSeparator = "," };
        var second = await Service().StartAsync(StartRequest(content, accountId), secondMapping);

        Assert.True(second.IsSuccess, second.IsFailure ? second.Error.Description : null);
        Assert.Equal(first.Value.Id, second.Value.Id);
        await using var ctx = _factory.CreateContext();
        Assert.Equal(1, await ctx.BankStatementImportSessions.CountAsync());
    }

    [Fact]
    public async Task Remember_mapping_persists_a_reusable_entry_without_balances_or_ignored_rows()
    {
        var accountId = SeedBankAccount(Rib);
        var mapping = Mapping(remember: true) with { OpeningBalance = 1000m, ClosingBalance = 2000m, IgnoredRows = new[] { 5 } };

        var result = await Service().StartAsync(StartRequest(Csv(SimpleCsv), accountId), mapping);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        await using var ctx = _factory.CreateContext();
        var saved = await ctx.BankStatementTabularMappings.SingleAsync(m => m.BankAccountId == accountId);
        var persisted = System.Text.Json.JsonSerializer.Deserialize<BankStatementTabularMappingDto>(
            saved.MappingJson, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        Assert.Null(persisted!.OpeningBalance);
        Assert.Null(persisted.ClosingBalance);
        Assert.Null(persisted.IgnoredRows);
        _audit.Verify(a => a.LogAsync(FactuTrust.Domain.Entities.AuditActions.Accounting.BankStatementTabularMappingSaved,
            nameof(FactuTrust.Domain.Entities.BankStatementTabularMapping), It.IsAny<Guid?>(), null, It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_saved_mapping_whose_columns_no_longer_fit_the_file_is_not_proposed_in_preview()
    {
        var accountId = SeedBankAccount(Rib);
        await Service().StartAsync(StartRequest(Csv(SimpleCsv), accountId), Mapping(remember: true));

        // Fichier plus étroit que le mappage mémorisé (2 colonnes au lieu de 4).
        var narrowerCsv = Csv("Date;Libelle\n01/01/2026;OP\n");
        var preview = await Service().PreviewAsync(PreviewRequest(narrowerCsv, accountId));

        Assert.True(preview.IsSuccess, preview.IsFailure ? preview.Error.Description : null);
        Assert.Null(preview.Value.SavedMapping);
    }

    [Fact]
    public async Task Already_imported_file_for_the_same_account_is_refused()
    {
        var accountId = SeedBankAccount(Rib);
        var content = Csv(SimpleCsv);
        var session = (await Service().StartAsync(StartRequest(content, accountId), Mapping())).Value;

        await using (var ctx = _factory.CreateContext())
        {
            var entity = await ctx.BankStatementImportSessions.SingleAsync(s => s.Id == session.Id);
            var statement = FactuTrust.Domain.Entities.BankStatement.Create(
                "STB", "53210001", DateTime.UtcNow, DateTime.UtcNow.AddDays(-30), DateTime.UtcNow,
                Money.Create(1000m), Money.Create(1095m));
            statement.SetProvenance(accountId, "53210001", "releve.csv", entity.FileHash, BankStatementImportMethod.PdfText);
            ctx.BankStatements.Add(statement);
            await ctx.SaveChangesAsync();
        }

        var again = await Service().StartAsync(StartRequest(content, accountId), Mapping());

        Assert.Equal(BankStatementImportErrorCodes.AlreadyImported, again.Error.Code);
    }
}
