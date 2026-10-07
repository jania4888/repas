using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Banking;
using FactuTrust.Domain.Entities;
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
/// Drapeau « tout document par l'IA » : une lecture prouvée n'appelle pas l'IA ; un relevé texte
/// non vérifié est confié à l'IA (si l'utilisateur y a droit et qu'elle répond), sinon bloqué avec un
/// message clair ; fournisseur externe, plafonds, verrou du dossier et doublons sont contrôlés.
/// </summary>
public sealed class BankStatementImportServiceAiForAllDocumentsTests : IDisposable
{
    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly string _dbName = $"BankStatementImportAll_{Guid.NewGuid():N}";
    private readonly string _storage = Path.Combine(Path.GetTempPath(), "ft-bqall-tests", Guid.NewGuid().ToString("N"));
    private readonly Mock<IBankStatementAiExtraction> _ai = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly InMemoryFactory _factory;

    public BankStatementImportServiceAiForAllDocumentsTests()
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

    private BankStatementImportService Service(bool allDocuments = true, Action<BankStatementImportLimits>? limits = null, bool aiOnly = false, bool userHasAiRight = true)
    {
        var settings = new AccountingSettings
        {
            BankStatementAiPostingEnabled = true,
            BankStatementAiForAllDocumentsEnabled = allDocuments
        };
        settings.BankStatementImport.StorageBasePath = _storage;
        settings.BankStatementImport.AiOnlyReadingEnabled = aiOnly;
        limits?.Invoke(settings.BankStatementImport);
        var options = Options.Create(settings);
        var tenant = new Mock<ITenantContext>();
        tenant.SetupGet(t => t.TenantId).Returns(_tenantId);
        var user = new Mock<ICurrentUser>();
        user.SetupGet(u => u.Email).Returns("comptable@test.tn");
        user.SetupGet(u => u.TenantId).Returns(_tenantId);
        user.Setup(u => u.HasPermission(It.IsAny<string>())).Returns(userHasAiRight);
        return new BankStatementImportService(_factory, tenant.Object, user.Object, _audit.Object, _ai.Object,
            new BankStatementFileStore(options), new BankStatementLayoutExtractor(), options,
            NullLogger<BankStatementImportService>.Instance);
    }

    /// <summary>Mode « IA seule » (D1) avec lecture vision autorisée par la configuration.</summary>
    private BankStatementImportService AiOnlyService(Action<BankStatementImportLimits>? limits = null, bool userHasAiRight = true) =>
        Service(aiOnly: true, userHasAiRight: userHasAiRight, limits: l =>
        {
            l.VisionReadingEnabled = true;
            limits?.Invoke(l);
        });

    private static BankStatementAiAvailability GlmOcrReady() =>
        new(true, "local", "ollama:qwen2.5:7b-instruct", null, Engine: BankStatementAiEngines.Vision, VisionModelRef: "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0");

    private static BankStatementAiAvailability GlmOcrMissing() =>
        new(true, "local", "ollama:qwen2.5:7b-instruct", null, Engine: BankStatementAiEngines.Text,
            VisionUnavailableReason: "modèle GLM-OCR non installé sur le serveur");

    private async Task<BankStatementImportSession> LoadSession(Guid id)
    {
        await using var ctx = _factory.CreateContext();
        return await ctx.BankStatementImportSessions.AsNoTracking().SingleAsync(s => s.Id == id);
    }

    private Guid SeedBankAccount(string rib)
    {
        var account = BankAccount.Create(Guid.NewGuid(), "STB", "Société Tunisienne de Banque", rib, TunisianIban.FromRib(rib)!).Value;
        Assert.True(account.SetChartOfAccountNumber("53210001").IsSuccess);
        using var ctx = _factory.CreateContext();
        ctx.BankAccounts.Add(account);
        ctx.SaveChanges();
        return account.Id;
    }

    private static Spec StbSpec(decimal opening = 1_000.000m) => new("10", opening, new[]
    {
        new Op("02/01/2026", "05/01/2026", new[] { "VIREMENT REÇU SOCIETE ALPHA" }, null, 2_149.079m),
        new Op("02/01/2026", "31/12/2025", new[] { "COMMISSION VIREMENT REÇU EN DINARS AUTRE BANQUE" }, 1.500m, null),
        new Op("05/01/2026", "02/01/2026", new[] { "RÈG CHÈQUE N° 0001234" }, 2_400.000m, null)
    });

    /// <summary>Solde final imprimé faux : la lecture directe ne peut pas être prouvée.</summary>
    private static Spec Unverified() => StbSpec() with { ClosingOverride = 9_999.999m };

    private static StartBankStatementImportRequest Request(byte[] content, Guid accountId, bool allowAi = true) => new()
    {
        Content = new MemoryStream(content),
        FileName = "releve.pdf",
        ContentType = "application/pdf",
        Length = content.Length,
        BankAccountId = accountId,
        JournalCode = "JB",
        AllowAi = allowAi
    };

    [Fact]
    public async Task Proven_statement_is_not_sent_to_the_ai_and_reads_as_before()
    {
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);

        var result = await Service().StartAsync(Request(StbLike(spec), accountId));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), result.Value.Status);
        Assert.Equal("layout", result.Value.ExtractionMethod);
        Assert.True(result.Value.CanConfirm);
        Assert.Equal(3, result.Value.Extraction!.Lines.Count);
        Assert.True(result.Value.Extraction.AiPlan!.IsEmpty);
        _ai.Verify(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()), Times.Never);
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Without_the_flag_an_unverified_text_statement_is_blocked_without_ai_as_before()
    {
        var spec = Unverified();
        var accountId = SeedBankAccount(spec.Rib);

        var result = await Service(allDocuments: false).StartAsync(Request(StbLike(spec), accountId));

        Assert.True(result.IsSuccess);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), result.Value.Status);
        Assert.False(result.Value.CanConfirm);
        Assert.Null(result.Value.Extraction!.AiPlan);
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Unverified_text_statement_is_read_by_the_ai_in_the_background()
    {
        var spec = Unverified();
        var accountId = SeedBankAccount(spec.Rib);

        var result = await Service().StartAsync(Request(StbLike(spec), accountId));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(nameof(BankStatementImportSessionStatus.Extracting), result.Value.Status);
        var plan = result.Value.Extraction!.AiPlan!;
        Assert.Equal(new[] { 1 }, plan.TextPages);
        Assert.Equal(BankStatementAiReadingReasons.Unverified, plan.Reason);
        Assert.True(plan.EstimatedCalls >= 1);
        Assert.Equal(plan.EstimatedCalls * 120, plan.EstimatedSeconds);
        _ai.Verify(a => a.Schedule(_tenantId, result.Value.Id), Times.Once);
    }

    [Fact]
    public async Task User_without_ai_right_gets_a_clear_blocking_message()
    {
        var spec = Unverified();
        var accountId = SeedBankAccount(spec.Rib);

        var result = await Service().StartAsync(Request(StbLike(spec), accountId, allowAi: false));

        Assert.True(result.IsSuccess);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), result.Value.Status);
        Assert.False(result.Value.CanConfirm);
        var issue = Assert.Single(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiUnavailable);
        Assert.Equal(StatementIssueSeverity.Blocking, issue.Severity);
        Assert.StartsWith("Relevé non lu avec certitude", issue.Message, StringComparison.Ordinal);
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Ai_engine_down_blocks_an_unverified_statement()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(BankStatementAiAvailability.Unavailable("le moteur IA ne répond pas"));
        var spec = Unverified();
        var accountId = SeedBankAccount(spec.Rib);

        var result = await Service().StartAsync(Request(StbLike(spec), accountId));

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.CanConfirm);
        Assert.Contains(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiUnavailable && i.Message.Contains("ne répond pas", StringComparison.Ordinal));
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task External_ai_does_not_receive_text_pages_unless_allowed()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BankStatementAiAvailability(true, "external", "openrouter:test", null));
        var spec = Unverified();
        var accountId = SeedBankAccount(spec.Rib);

        var refused = await Service().StartAsync(Request(StbLike(spec), accountId));

        Assert.True(refused.IsSuccess);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), refused.Value.Status);
        Assert.Contains(refused.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiUnavailable && i.Message.Contains("IA externe", StringComparison.Ordinal));
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);

        await Service().CancelAsync(refused.Value.Id);
        var allowed = await Service(limits: l => l.AiComplementAllowExternal = true).StartAsync(Request(StbLike(spec), accountId));

        Assert.True(allowed.IsSuccess, allowed.IsFailure ? allowed.Error.Description : null);
        Assert.Equal(nameof(BankStatementImportSessionStatus.Extracting), allowed.Value.Status);
        _ai.Verify(a => a.Schedule(_tenantId, allowed.Value.Id), Times.Once);
    }

    [Fact]
    public async Task Statement_needing_too_many_ai_calls_is_blocked()
    {
        var spec = Unverified();
        var accountId = SeedBankAccount(spec.Rib);

        var result = await Service(limits: l => { l.MaxAiCalls = 1; l.AiTextOperationsPerCall = 3; })
            .StartAsync(Request(StbLike(spec with { Ops = spec.Ops.Concat(spec.Ops).ToList() }), accountId));

        Assert.True(result.IsSuccess);
        Assert.Contains(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiUnavailable && i.Message.Contains("trop long", StringComparison.Ordinal));
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Another_ai_reading_in_progress_is_refused_but_a_stale_one_is_ignored()
    {
        var spec = Unverified();
        var accountId = SeedBankAccount(spec.Rib);
        Guid runningId;
        await using (var ctx = _factory.CreateContext())
        {
            var running = BankStatementImportSession.Create(accountId, "JB", "autre.pdf", new string('A', 64), 10, "application/pdf", DateTime.UtcNow.AddHours(24));
            running.StartAiExtraction("local", "{}", "generic", 1);
            ctx.BankStatementImportSessions.Add(running);
            await ctx.SaveChangesAsync();
            runningId = running.Id;
        }

        var refused = await Service().StartAsync(Request(StbLike(spec), accountId));
        Assert.Equal(BankStatementImportErrorCodes.AnalysisInProgress, refused.Error.Code);

        await using (var ctx = _factory.CreateContext())
        {
            var running = await ctx.BankStatementImportSessions.SingleAsync(s => s.Id == runningId);
            ctx.Entry(running).Property(s => s.CreatedAt).CurrentValue = DateTime.UtcNow.AddHours(-5);
            await ctx.SaveChangesAsync();
        }

        var accepted = await Service().StartAsync(Request(StbLike(spec), accountId));
        Assert.True(accepted.IsSuccess, accepted.IsFailure ? accepted.Error.Description : null);
        Assert.Equal(nameof(BankStatementImportSessionStatus.Extracting), accepted.Value.Status);
    }

    [Fact]
    public async Task Statement_whose_operations_were_all_imported_already_is_refused()
    {
        var accountId = SeedBankAccount(StbSpec().Rib);
        var first = await Service().StartAsync(Request(StbLike(StbSpec()), accountId));
        Assert.True((await Service().ConfirmAsync(first.Value.Id, new ConfirmBankStatementImportRequest())).IsSuccess);

        // Autre fichier (solde d'ouverture différent), mêmes opérations.
        var again = await Service().StartAsync(Request(StbLike(StbSpec(opening: 2_000.000m)), accountId));
        Assert.True(again.Value.CanConfirm);

        var confirm = await Service().ConfirmAsync(again.Value.Id, new ConfirmBankStatementImportRequest());

        Assert.Equal(BankStatementImportErrorCodes.AlreadyImported, confirm.Error.Code);
    }

    [Fact]
    public async Task Without_the_flag_a_statement_of_already_imported_operations_is_still_saved()
    {
        var accountId = SeedBankAccount(StbSpec().Rib);
        var first = await Service(allDocuments: false).StartAsync(Request(StbLike(StbSpec()), accountId));
        Assert.True((await Service(allDocuments: false).ConfirmAsync(first.Value.Id, new ConfirmBankStatementImportRequest())).IsSuccess);

        var again = await Service(allDocuments: false).StartAsync(Request(StbLike(StbSpec(opening: 2_000.000m)), accountId));
        var confirm = await Service(allDocuments: false).ConfirmAsync(again.Value.Id, new ConfirmBankStatementImportRequest());

        Assert.True(confirm.IsSuccess);
        Assert.Equal(3, confirm.Value.AlreadyImportedCount);
    }

    // ── Mode « IA seule » (D1/D2) : pré-vol ─────────────────────────────────────────────────

    [Fact]
    public async Task Ai_only_mode_sends_every_page_to_glm_ocr_even_when_the_direct_reading_is_proven()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>())).ReturnsAsync(GlmOcrReady());
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);

        var result = await AiOnlyService().StartAsync(Request(StbLike(spec), accountId));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(nameof(BankStatementImportSessionStatus.Extracting), result.Value.Status);
        var plan = result.Value.Extraction!.AiPlan!;
        Assert.True(plan.IsAiOnly);
        Assert.Equal(BankStatementAiReadingModes.AiOnly, plan.Mode);
        Assert.Equal(BankStatementAiReadingReasons.AllDocuments, plan.Reason);
        Assert.Equal(BankStatementAiEngines.Vision, plan.Engine);
        Assert.Equal(new[] { 1 }, plan.PlannedPages);
        Assert.Equal(1, plan.EstimatedCalls);
        Assert.Equal(180, plan.EstimatedSeconds);
        Assert.DoesNotContain(result.Value.Extraction.Issues, i => i.Code == StatementIssueCodes.AiUnavailable || i.Code == StatementIssueCodes.AiTextFallback);
        _ai.Verify(a => a.Schedule(_tenantId, result.Value.Id), Times.Once);
    }

    [Fact]
    public async Task Ai_only_mode_falls_back_to_the_text_model_and_says_so_when_glm_ocr_is_not_ready()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>())).ReturnsAsync(GlmOcrMissing());
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);

        // Chemin de dépannage : il faut l'allumer explicitement, il est éteint par défaut.
        var result = await AiOnlyService(l => l.VisionTextFallbackEnabled = true).StartAsync(Request(StbLike(spec), accountId));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(nameof(BankStatementImportSessionStatus.Extracting), result.Value.Status);
        var plan = result.Value.Extraction!.AiPlan!;
        Assert.Equal(BankStatementAiEngines.Text, plan.Engine);
        Assert.True(plan.IsAiOnly);
        var global = Assert.Single(result.Value.Extraction.Issues, i => i.Code == StatementIssueCodes.AiUnavailable);
        Assert.Equal(StatementIssueSeverity.Warning, global.Severity);
        Assert.Contains("Lecture des images indisponible", global.Message, StringComparison.Ordinal);
        // Le motif de diagnostic (« modèle … non installé ») est repris tel quel : il est destiné à
        // l'administrateur. Ce sont les LIBELLÉS de méthode qui ne nomment plus de modèle.
        Assert.Contains("non installé", global.Message, StringComparison.Ordinal);
        var page = Assert.Single(result.Value.Extraction.Issues, i => i.Code == StatementIssueCodes.AiTextFallback);
        Assert.Equal(StatementIssueSeverity.Warning, page.Severity);
        Assert.Equal(1, page.PageNumber);
        _ai.Verify(a => a.Schedule(_tenantId, result.Value.Id), Times.Once);
    }

    [Fact]
    public async Task Ai_only_mode_blocks_explicitly_when_glm_ocr_is_not_ready_and_the_text_fallback_is_disabled()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>())).ReturnsAsync(GlmOcrMissing());
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);

        var result = await AiOnlyService(l => l.VisionTextFallbackEnabled = false).StartAsync(Request(StbLike(spec), accountId));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), result.Value.Status);
        Assert.Equal(BankStatementImportExtractionMethods.None, result.Value.ExtractionMethod);
        Assert.False(result.Value.CanConfirm);
        var issue = Assert.Single(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiUnavailable);
        Assert.Equal(StatementIssueSeverity.Blocking, issue.Severity);
        Assert.StartsWith("Lecture IA impossible", issue.Message, StringComparison.Ordinal);
        Assert.Contains("non installé", issue.Message, StringComparison.Ordinal);
        Assert.True(result.Value.Extraction.AiPlan!.IsAiOnly);
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Ai_only_mode_blocks_explicitly_when_no_engine_answers()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(BankStatementAiAvailability.Unavailable("le moteur IA ne répond pas", BankStatementAiAvailabilityReasons.EngineUnavailable));
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);

        var result = await AiOnlyService().StartAsync(Request(StbLike(spec), accountId));

        Assert.True(result.IsSuccess);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), result.Value.Status);
        Assert.Equal(BankStatementImportExtractionMethods.None, result.Value.ExtractionMethod);
        Assert.False(result.Value.CanConfirm);
        var issue = Assert.Single(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiUnavailable);
        Assert.Equal(StatementIssueSeverity.Blocking, issue.Severity);
        Assert.Equal("Lecture IA impossible : le moteur IA ne répond pas. Réessayez plus tard ou contactez l'administrateur.", issue.Message);
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Ai_only_mode_never_sends_a_statement_to_an_external_provider_unless_allowed()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new BankStatementAiAvailability(true, "external", "openrouter:test", null, Engine: BankStatementAiEngines.Vision));
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);

        var result = await AiOnlyService().StartAsync(Request(StbLike(spec), accountId));

        Assert.True(result.IsSuccess);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), result.Value.Status);
        var issue = Assert.Single(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiUnavailable);
        Assert.Equal(StatementIssueSeverity.Blocking, issue.Severity);
        Assert.Contains("IA externe", issue.Message, StringComparison.Ordinal);
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Ai_only_mode_refuses_a_statement_above_the_ai_page_cap_before_sending_anything()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>())).ReturnsAsync(GlmOcrReady());
        var accountId = SeedBankAccount(StbSpec().Rib);

        var result = await AiOnlyService(l => l.MaxAiPages = 2).StartAsync(Request(ManyPages(3), accountId));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), result.Value.Status);
        Assert.Equal(BankStatementImportExtractionMethods.None, result.Value.ExtractionMethod);
        // Refus déterministe : code dédié (non relançable), distinct de ai_unavailable.
        var issue = Assert.Single(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.TooManyPages);
        Assert.Equal(StatementIssueSeverity.Blocking, issue.Severity);
        Assert.DoesNotContain(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiUnavailable);
        Assert.Equal("Trop de pages à lire (3, maximum 2). Scindez le PDF par relevé ou par mois.", issue.Message);
        Assert.Equal(new[] { 1, 2, 3 }, result.Value.Extraction.AiPlan!.PlannedPages);
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Ai_only_mode_user_without_ai_right_is_blocked_explicitly()
    {
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);

        var result = await AiOnlyService().StartAsync(Request(StbLike(spec), accountId, allowAi: false));

        Assert.True(result.IsSuccess);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), result.Value.Status);
        Assert.Equal(BankStatementImportExtractionMethods.None, result.Value.ExtractionMethod);
        var issue = Assert.Single(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiUnavailable);
        Assert.Equal(StatementIssueSeverity.Blocking, issue.Severity);
        Assert.StartsWith("Lecture IA impossible", issue.Message, StringComparison.Ordinal);
        _ai.Verify(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()), Times.Never);
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    // ── D3 : RIB différent, relance ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Ai_only_mode_reads_a_statement_whose_rib_differs_from_the_chosen_account()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>())).ReturnsAsync(GlmOcrReady());
        var spec = StbSpec();
        var accountId = SeedBankAccount(RibFor("14"));

        var result = await AiOnlyService().StartAsync(Request(StbLike(spec), accountId));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(nameof(BankStatementImportSessionStatus.Extracting), result.Value.Status);
        Assert.Contains(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.RibMismatch && i.Severity == StatementIssueSeverity.Blocking);
        Assert.DoesNotContain(result.Value.Extraction.Issues, i => i.Code == StatementIssueCodes.AiNotStarted);
        Assert.False(result.Value.Extraction.AiPlan!.IsEmpty);
        _ai.Verify(a => a.Schedule(_tenantId, result.Value.Id), Times.Once);
    }

    [Fact]
    public async Task Without_the_ai_only_flag_a_rib_mismatch_still_stops_the_reading_as_before()
    {
        var spec = StbSpec();
        var accountId = SeedBankAccount(RibFor("14"));

        var result = await Service().StartAsync(Request(StbLike(spec), accountId));

        Assert.True(result.IsSuccess);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), result.Value.Status);
        Assert.Contains(result.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiNotStarted && i.Message.Contains("autre compte bancaire", StringComparison.Ordinal));
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Retarget_to_the_same_account_is_refused_and_the_session_is_kept()
    {
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);
        var started = await Service().StartAsync(Request(StbLike(spec), accountId));

        var result = await Service().RetargetAsync(started.Value.Id, accountId);

        Assert.Equal(BankStatementImportErrorCodes.SameBankAccount, result.Error.Code);
        Assert.Equal(BankStatementImportSessionStatus.AwaitingReview, (await LoadSession(started.Value.Id)).Status);
    }

    [Fact]
    public async Task Retarget_of_a_running_analysis_is_refused_and_leaves_it_intact()
    {
        var spec = Unverified();
        var accountId = SeedBankAccount(spec.Rib);
        var otherAccountId = SeedBankAccount(RibFor("14"));
        var started = await Service().StartAsync(Request(StbLike(spec), accountId));
        Assert.Equal(nameof(BankStatementImportSessionStatus.Extracting), started.Value.Status);

        var result = await Service().RetargetAsync(started.Value.Id, otherAccountId);

        Assert.Equal(BankStatementImportErrorCodes.SessionNotReviewable, result.Error.Code);
        var session = await LoadSession(started.Value.Id);
        Assert.Equal(BankStatementImportSessionStatus.Extracting, session.Status);
        Assert.NotNull(session.StoragePath);
    }

    [Fact]
    public async Task Relaunch_is_refused_before_cancelling_when_another_reading_is_in_progress()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(BankStatementAiAvailability.Unavailable("le moteur IA ne répond pas", BankStatementAiAvailabilityReasons.EngineUnavailable));
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);
        var blocked = await AiOnlyService().StartAsync(Request(StbLike(spec), accountId));
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), blocked.Value.Status);

        await using (var ctx = _factory.CreateContext())
        {
            var running = BankStatementImportSession.Create(accountId, "JB", "autre.pdf", new string('B', 64), 10, "application/pdf", DateTime.UtcNow.AddHours(24));
            running.StartAiExtraction("local", "{}", "generic", 1);
            ctx.BankStatementImportSessions.Add(running);
            await ctx.SaveChangesAsync();
        }

        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>())).ReturnsAsync(GlmOcrReady());
        var result = await AiOnlyService().RetryAsync(blocked.Value.Id);

        Assert.Equal(BankStatementImportErrorCodes.AnalysisInProgress, result.Error.Code);
        var origin = await LoadSession(blocked.Value.Id);
        Assert.Equal(BankStatementImportSessionStatus.AwaitingReview, origin.Status);
        Assert.NotNull(origin.StoragePath);
        Assert.True(File.Exists(Path.Combine(_storage, origin.StoragePath!)), "le fichier d'origine doit être conservé : rien n'a été annulé");
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task Retry_relaunches_a_session_blocked_by_an_unavailable_ai_once_it_answers()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(BankStatementAiAvailability.Unavailable("le moteur IA ne répond pas", BankStatementAiAvailabilityReasons.EngineUnavailable));
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);
        var blocked = await AiOnlyService().StartAsync(Request(StbLike(spec), accountId));

        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>())).ReturnsAsync(GlmOcrReady());
        var result = await AiOnlyService().RetryAsync(blocked.Value.Id);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.NotEqual(blocked.Value.Id, result.Value.Id);
        Assert.Equal(nameof(BankStatementImportSessionStatus.Extracting), result.Value.Status);
        Assert.Equal(accountId, result.Value.BankAccountId);
        Assert.Equal(BankStatementAiEngines.Vision, result.Value.Extraction!.AiPlan!.Engine);
        Assert.Equal(BankStatementImportSessionStatus.Cancelled, (await LoadSession(blocked.Value.Id)).Status);
        _ai.Verify(a => a.Schedule(_tenantId, result.Value.Id), Times.Once);
    }

    [Fact]
    public async Task Retry_is_refused_when_the_reading_did_happen()
    {
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);
        var proven = await Service().StartAsync(Request(StbLike(spec), accountId));
        Assert.True(proven.Value.CanConfirm);

        var result = await Service().RetryAsync(proven.Value.Id);

        Assert.Equal(BankStatementImportErrorCodes.SessionNotReviewable, result.Error.Code);
        Assert.Equal(BankStatementImportSessionStatus.AwaitingReview, (await LoadSession(proven.Value.Id)).Status);
    }

    [Fact]
    public async Task Retry_without_the_ai_permission_is_refused_before_any_cancellation()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(BankStatementAiAvailability.Unavailable("le moteur IA ne répond pas", BankStatementAiAvailabilityReasons.EngineUnavailable));
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);
        var blocked = await AiOnlyService().StartAsync(Request(StbLike(spec), accountId));
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), blocked.Value.Status);

        var result = await AiOnlyService(userHasAiRight: false).RetryAsync(blocked.Value.Id);

        Assert.Equal("Forbidden", result.Error.Code);
        var origin = await LoadSession(blocked.Value.Id);
        Assert.Equal(BankStatementImportSessionStatus.AwaitingReview, origin.Status);
        Assert.NotNull(origin.StoragePath);
        Assert.True(File.Exists(Path.Combine(_storage, origin.StoragePath!)), "la session d'origine ne doit pas être annulée sans le droit IA");
        _ai.Verify(a => a.Schedule(It.IsAny<Guid>(), It.IsAny<Guid>()), Times.Never);
    }

    [Fact]
    public async Task The_too_many_pages_refusal_is_deterministic_and_not_retryable()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>())).ReturnsAsync(GlmOcrReady());
        var accountId = SeedBankAccount(StbSpec().Rib);
        var refused = await AiOnlyService(l => l.MaxAiPages = 1).StartAsync(Request(ManyPages(2), accountId));

        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), refused.Value.Status);
        Assert.Contains(refused.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.TooManyPages && i.Severity == StatementIssueSeverity.Blocking);
        Assert.DoesNotContain(refused.Value.Extraction!.Issues, i => i.Code == StatementIssueCodes.AiUnavailable && i.Severity == StatementIssueSeverity.Blocking);

        var retry = await AiOnlyService(l => l.MaxAiPages = 1).RetryAsync(refused.Value.Id);
        Assert.Equal(BankStatementImportErrorCodes.SessionNotReviewable, retry.Error.Code);
        Assert.Equal(BankStatementImportSessionStatus.AwaitingReview, (await LoadSession(refused.Value.Id)).Status);
    }

    [Fact]
    public async Task Retry_relaunches_a_failed_reading()
    {
        _ai.Setup(a => a.CheckAvailabilityAsync(It.IsAny<CancellationToken>())).ReturnsAsync(GlmOcrReady());
        var spec = StbSpec();
        var accountId = SeedBankAccount(spec.Rib);
        var started = await AiOnlyService().StartAsync(Request(StbLike(spec), accountId));
        await using (var ctx = _factory.CreateContext())
        {
            var session = await ctx.BankStatementImportSessions.SingleAsync(s => s.Id == started.Value.Id);
            session.Fail(BankStatementImportSessionErrorCodes.AiUnavailable);
            await ctx.SaveChangesAsync();
        }

        var result = await AiOnlyService().RetryAsync(started.Value.Id);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(nameof(BankStatementImportSessionStatus.Extracting), result.Value.Status);
        Assert.Equal(BankStatementImportSessionStatus.Cancelled, (await LoadSession(started.Value.Id)).Status);
    }
}
