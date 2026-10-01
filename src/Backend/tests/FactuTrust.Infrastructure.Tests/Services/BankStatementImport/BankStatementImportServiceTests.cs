using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Banking;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;
using static FactuTrust.Infrastructure.Tests.Services.BankStatementImport.SyntheticBankStatementPdf;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Session d'analyse → relecture → confirmation : fichiers refusés, compte bancaire et journal
/// contrôlés, RIB du relevé ≠ compte choisi bloquant, relevé débiteur enregistré signé,
/// ré-import du même fichier refusé, IA planifiée seulement si autorisée et disponible.
/// </summary>
public sealed class BankStatementImportServiceTests : IDisposable
{
    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly string _dbName = $"BankStatementImport_{Guid.NewGuid():N}";
    private readonly string _storage = Path.Combine(Path.GetTempPath(), "ft-bqia-tests", Guid.NewGuid().ToString("N"));
    private readonly Mock<IBankStatementAiExtraction> _ai = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly InMemoryFactory _factory;

    public BankStatementImportServiceTests()
    {
        _factory = new InMemoryFactory(_dbName);
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BankStatementAiAvailability(true, "local", "ollama:test", null));
    }

    public void Dispose()
    {
        try { if (Directory.Exists(_storage)) Directory.Delete(_storage, recursive: true); }
        catch (IOException) { }
    }

    private sealed class InMemoryFactory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() => new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }

    private BankStatementImportService Service(bool enabled = true)
    {
        var settings = new AccountingSettings { BankStatementAiPostingEnabled = enabled };
        settings.BankStatementImport.StorageBasePath = _storage;
        var options = Options.Create(settings);
        var tenant = new Mock<ITenantContext>();
        tenant.SetupGet(t => t.TenantId).Returns(_tenantId);
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.Email).Returns("comptable@test.tn");
        user.SetupGet(u => u.TenantId).Returns(_tenantId);
        return new BankStatementImportService(_factory, tenant.Object, user.Object, _audit.Object, _ai.Object,
            new BankStatementFileStore(options), new BankStatementLayoutExtractor(), options,
            NullLogger<BankStatementImportService>.Instance);
    }

    private Guid SeedBankAccount(string rib, string? glAccount = "53210001", bool active = true)
    {
        var account = BankAccount.Create(Guid.NewGuid(), "STB", "Société Tunisienne de Banque", rib, TunisianIban.FromRib(rib)!).Value;
        if (glAccount is not null)
            Assert.True(account.SetChartOfAccountNumber(glAccount).IsSuccess);
        if (!active)
            account.Deactivate();
        using var ctx = _factory.CreateContext();
        ctx.BankAccounts.Add(account);
        ctx.SaveChanges();
        return account.Id;
    }

    private static Spec StbSpec() => new("10", 1_000.000m, new[]
    {
        new Op("02/01/2026", "05/01/2026", new[] { "VIREMENT REÇU SOCIETE ALPHA" }, null, 2_149.079m),
        new Op("02/01/2026", "31/12/2025", new[] { "COMMISSION VIREMENT REÇU EN DINARS AUTRE BANQUE" }, 1.500m, null),
        new Op("05/01/2026", "02/01/2026", new[] { "RÈG CHÈQUE N° 0001234" }, 2_400.000m, null)
    });

    private static StartBankStatementImportRequest Request(byte[] content, Guid accountId, string fileName = "releve.pdf",
        string contentType = "application/pdf", string journal = "JB", bool allowAi = true) => new()
    {
        Content = new MemoryStream(content),
        FileName = fileName,
        ContentType = contentType,
        Length = content.Length,
        BankAccountId = accountId,
        JournalCode = journal,
        AllowAi = allowAi
    };

    [Fact]
    public async Task Disabled_flag_refuses_everything()
    {
        var result = await Service(enabled: false).StartAsync(Request(StbLike(StbSpec()), Guid.NewGuid()));
        Assert.Equal(BankStatementImportErrorCodes.Disabled, result.Error.Code);
    }

    [Fact]
    public async Task Text_pdf_is_read_immediately_and_awaits_review()
    {
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);

        var result = await Service().StartAsync(Request(StbLike(spec), accountId));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var session = result.Value;
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), session.Status);
        Assert.Equal("layout", session.ExtractionMethod);
        Assert.Equal("stb-historique", session.ProfileId);
        Assert.True(session.CanConfirm);
        Assert.True(session.BalanceCheck!.IsBalanced);
        Assert.Equal(3, session.Extraction!.Lines.Count);
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
        Assert.Single(Directory.GetFiles(_storage, "*.pdf", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Spoofed_binary_named_pdf_is_rejected()
    {
        var accountId = SeedBankAccount(StbSpec().Rib);
        var exe = new byte[] { 0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0xB8 };

        var result = await Service().StartAsync(Request(exe, accountId));

        Assert.Equal(BankStatementImportErrorCodes.FileRejected, result.Error.Code);
        Assert.False(Directory.Exists(_storage) && Directory.GetFiles(_storage, "*", SearchOption.AllDirectories).Length > 0);
    }

    [Theory]
    [InlineData("releve.exe", "application/octet-stream")]
    [InlineData("releve.pdf.exe", "application/pdf")]
    [InlineData("releve.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")]
    public async Task Non_statement_formats_are_rejected(string fileName, string contentType)
    {
        var accountId = SeedBankAccount(StbSpec().Rib);
        var result = await Service().StartAsync(Request(StbLike(StbSpec()), accountId, fileName, contentType));
        Assert.Equal(BankStatementImportErrorCodes.FileRejected, result.Error.Code);
    }

    [Fact]
    public async Task Statement_of_another_account_is_blocked()
    {
        var accountId = SeedBankAccount(RibFor("14")); // compte BH, relevé STB
        var result = await Service().StartAsync(Request(StbLike(StbSpec()), accountId));

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.CanConfirm);
        Assert.Contains(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.RibMismatch && i.Severity == StatementIssueSeverity.Blocking);

        var confirm = await Service().ConfirmAsync(result.Value.Id, new ConfirmBankStatementImportRequest());
        Assert.Equal(BankStatementImportErrorCodes.BlockingIssues, confirm.Error.Code);
    }

    [Fact]
    public async Task Bank_account_without_532_account_or_inactive_is_refused()
    {
        var withoutGl = SeedBankAccount(StbSpec().Rib, glAccount: null);
        Assert.Equal(BankStatementImportErrorCodes.BankAccountWithoutGlAccount,
            (await Service().StartAsync(Request(StbLike(StbSpec()), withoutGl))).Error.Code);

        var inactive = SeedBankAccount(StbSpec().Rib, active: false);
        Assert.Equal(BankStatementImportErrorCodes.BankAccountInactive,
            (await Service().StartAsync(Request(StbLike(StbSpec()), inactive))).Error.Code);

        Assert.Equal(BankStatementImportErrorCodes.BankAccountNotFound,
            (await Service().StartAsync(Request(StbLike(StbSpec()), Guid.NewGuid()))).Error.Code);
    }

    [Fact]
    public async Task Cash_journal_is_not_a_bank_journal()
    {
        var accountId = SeedBankAccount(StbSpec().Rib);
        var result = await Service().StartAsync(Request(StbLike(StbSpec()), accountId, journal: "JC"));
        Assert.Equal(BankStatementImportErrorCodes.JournalInvalid, result.Error.Code);
    }

    [Fact]
    public async Task Same_file_twice_reopens_the_same_analysis()
    {
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);
        var pdf = StbLike(spec);

        var first = await Service().StartAsync(Request(pdf, accountId));
        var second = await Service().StartAsync(Request(pdf, accountId));

        Assert.Equal(first.Value.Id, second.Value.Id);
    }

    [Fact]
    public async Task Confirm_persists_the_statement_and_forbids_a_reimport()
    {
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);
        var pdf = StbLike(spec);
        var session = (await Service().StartAsync(Request(pdf, accountId))).Value;

        var confirm = await Service().ConfirmAsync(session.Id, new ConfirmBankStatementImportRequest());

        Assert.True(confirm.IsSuccess, confirm.IsFailure ? confirm.Error.Description : null);
        Assert.Equal(3, confirm.Value.LineCount);
        await using (var ctx = _factory.CreateContext())
        {
            var statement = await ctx.BankStatements.Include(s => s.Lines).SingleAsync();
            Assert.Equal(accountId, statement.BankAccountId);
            Assert.Equal("53210001", statement.ChartOfAccountNumber);
            Assert.Equal(BankStatementImportMethod.PdfText, statement.ImportMethod);
            Assert.Equal(spec.Opening, statement.OpeningBalance.Amount);
            Assert.Equal(spec.Closing, statement.ClosingBalance.Amount);
            Assert.NotNull(statement.SourceFileHash);
            var cheque = statement.Lines.Single(l => l.Description.Contains("CHÈQUE", StringComparison.Ordinal));
            Assert.Equal("0001234", cheque.Reference);
            Assert.True(cheque.IsDebit);
            Assert.All(statement.Lines, l => Assert.NotNull(l.Fingerprint));

            var stored = await ctx.BankStatementImportSessions.SingleAsync();
            Assert.Equal(BankStatementImportSessionStatus.Confirmed, stored.Status);
            Assert.Equal(statement.Id, stored.StatementId);
            Assert.Contains("statements", stored.StoragePath, StringComparison.Ordinal);
        }

        var again = await Service().StartAsync(Request(pdf, accountId));
        Assert.Equal(BankStatementImportErrorCodes.AlreadyImported, again.Error.Code);

        var reconfirm = await Service().ConfirmAsync(session.Id, new ConfirmBankStatementImportRequest());
        Assert.Equal(BankStatementImportErrorCodes.SessionNotReviewable, reconfirm.Error.Code);
    }

    [Fact]
    public async Task Debtor_statement_is_stored_with_a_signed_closing_balance()
    {
        // Relevé BIAT de référence : compte devenu débiteur (−18 732,846). Le chemin historique
        // (Money.Create) le refuserait ; ici le solde est stocké signé.
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "bank-statements", "biat-janvier-2026.pdf");
        var accountId = SeedBankAccount("08503000231001399743");
        var session = (await Service().StartAsync(Request(File.ReadAllBytes(path), accountId))).Value;
        Assert.True(session.CanConfirm);

        var confirm = await Service().ConfirmAsync(session.Id, new ConfirmBankStatementImportRequest());

        Assert.True(confirm.IsSuccess, confirm.IsFailure ? confirm.Error.Description : null);
        await using var ctx = _factory.CreateContext();
        var statement = await ctx.BankStatements.SingleAsync();
        Assert.Equal(-18_732.846m, statement.ClosingBalance.Amount);
        Assert.Equal(367, confirm.Value.LineCount);
    }

    [Fact]
    public async Task Lines_read_from_the_pdf_text_cannot_be_hand_corrected()
    {
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);
        var session = (await Service().StartAsync(Request(StbLike(spec), accountId))).Value;

        var confirm = await Service().ConfirmAsync(session.Id, new ConfirmBankStatementImportRequest
        {
            Corrections = new[] { new StatementLineCorrection { LineIndex = 0, Amount = 1m } }
        });

        Assert.Equal(BankStatementImportErrorCodes.CorrectionNotAllowed, confirm.Error.Code);
    }

    [Fact]
    public async Task Scanned_image_without_ai_permission_cannot_be_confirmed()
    {
        var accountId = SeedBankAccount(StbSpec().Rib);
        var png = PngBytes();

        var result = await Service().StartAsync(Request(png, accountId, "releve.png", "image/png", allowAi: false));

        Assert.True(result.IsSuccess);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), result.Value.Status);
        Assert.False(result.Value.CanConfirm);
        Assert.Contains(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiUnavailable);
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Scanned_image_with_ai_is_scheduled_in_background()
    {
        var accountId = SeedBankAccount(StbSpec().Rib);

        var result = await Service().StartAsync(Request(PngBytes(), accountId, "releve.png", "image/png"));

        Assert.True(result.IsSuccess);
        Assert.Equal(nameof(BankStatementImportSessionStatus.Extracting), result.Value.Status);
        Assert.Equal("local", result.Value.AiProviderKind);
        _ai.Verify(a => a.Schedule(_tenantId, result.Value.Id), Times.Once);
    }

    [Fact]
    public async Task Cancel_removes_the_stored_file()
    {
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);
        var session = (await Service().StartAsync(Request(StbLike(spec), accountId))).Value;

        Assert.True((await Service().CancelAsync(session.Id)).IsSuccess);

        Assert.Empty(Directory.GetFiles(_storage, "*", SearchOption.AllDirectories));
        Assert.Equal(nameof(BankStatementImportSessionStatus.Cancelled), (await Service().GetAsync(session.Id)).Value.Status);
    }

    [Fact]
    public async Task Source_file_of_a_confirmed_statement_is_downloadable()
    {
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);
        var pdf = StbLike(spec);
        var session = (await Service().StartAsync(Request(pdf, accountId))).Value;
        var statementId = (await Service().ConfirmAsync(session.Id, new ConfirmBankStatementImportRequest())).Value.StatementId;

        var file = await Service().GetSourceFileAsync(statementId);

        Assert.True(file.IsSuccess, file.IsFailure ? file.Error.Description : null);
        Assert.Equal(pdf, file.Value.Content);
        Assert.Equal("application/pdf", file.Value.ContentType);
        Assert.EndsWith(".pdf", file.Value.FileName, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Source_file_is_not_found_for_an_unconfirmed_session_or_another_statement()
    {
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);
        await Service().StartAsync(Request(StbLike(spec), accountId));

        var unknown = await Service().GetSourceFileAsync(Guid.NewGuid());

        Assert.Equal(BankStatementImportErrorCodes.SourceFileNotFound, unknown.Error.Code);
    }

    [Fact]
    public async Task Source_file_endpoint_is_closed_when_the_flag_is_off()
    {
        var result = await Service(enabled: false).GetSourceFileAsync(Guid.NewGuid());

        Assert.Equal(BankStatementImportErrorCodes.Disabled, result.Error.Code);
    }

    [Theory]
    [InlineData("releve mars.pdf", ".pdf", "releve mars.pdf")]
    [InlineData(@"C:\Users\x\Desktop\STB 03.PDF", ".pdf", "STB 03.pdf")]
    [InlineData("../../etc/passwd", ".pdf", "passwd.pdf")]
    [InlineData("a<b>:c\"|?*.png", ".png", "a_b__c____.png")]
    [InlineData("", ".jpg", "releve.jpg")]
    [InlineData("...", ".pdf", "releve.pdf")]
    public void Download_name_never_carries_a_path_or_a_forbidden_character(string original, string extension, string expected)
    {
        Assert.Equal(expected, BankStatementImportService.DownloadName(original, extension));
    }

    /// <summary>PNG minimal valide (signature + IHDR) : suffit au contrôle de signature.</summary>
    private static byte[] PngBytes() => Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
}
