using System.Text.Json;
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
/// D4 — relevé lu entièrement par l'IA : l'écart de solde est un avertissement qui exige l'accusé
/// explicite à la confirmation ; l'écart et l'accusé sont conservés avec le relevé. Corrections de
/// relecture : exclusion d'une ligne (renumérotation), plafonds, ligne sans montant refusée. Le chemin
/// historique (lignes lues directement, drapeau absent) reste strictement bloquant.
/// </summary>
public sealed class BankStatementImportServiceConfirmBalanceGapTests
{
    private static readonly DateOnly Jan2 = new(2026, 1, 2);
    private static readonly DateOnly Jan5 = new(2026, 1, 5);

    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly Mock<IBankStatementAiExtraction> _ai = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly InMemoryFactory _factory;

    public BankStatementImportServiceConfirmBalanceGapTests()
    {
        _factory = new InMemoryFactory($"BankStatementImportGap_{Guid.NewGuid():N}");
    }

    private sealed class InMemoryFactory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() => new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }

    private BankStatementImportService Service(bool aiOnly = true, bool gapAsWarning = true)
    {
        var settings = new AccountingSettings
        {
            BankStatementAiPostingEnabled = true,
            BankStatementAiForAllDocumentsEnabled = true
        };
        settings.BankStatementImport.StorageBasePath = Path.Combine(Path.GetTempPath(), "ft-bqgap-tests", Guid.NewGuid().ToString("N"));
        settings.BankStatementImport.AiOnlyReadingEnabled = aiOnly;
        settings.BankStatementImport.AiBalanceMismatchAsWarning = gapAsWarning;
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

    private Guid SeedBankAccount(string rib)
    {
        var account = BankAccount.Create(Guid.NewGuid(), "STB", "Société Tunisienne de Banque", rib, TunisianIban.FromRib(rib)!).Value;
        Assert.True(account.SetChartOfAccountNumber("53210001").IsSuccess);
        using var ctx = _factory.CreateContext();
        ctx.BankAccounts.Add(account);
        ctx.SaveChanges();
        return account.Id;
    }

    private static ExtractedStatementLine Line(int index, DateOnly date, string label, decimal amount, bool isDebit, StatementLineSource source = StatementLineSource.Ai) =>
        new() { Index = index, PageNumber = 1, TransactionDate = date, Label = label, Amount = amount, IsDebit = isDebit, Source = source };

    /// <summary>
    /// Relevé « tout IA » : ouverture 1 000,000, deux opérations (+2 149,079 ; −1,500) ⇒ 3 147,579 attendu,
    /// solde final lu 3 147,079 : écart +0,500 (une opération de 0,500 lue en trop ou un solde mal lu).
    /// </summary>
    private static ExtractedBankStatement AiOnlyStatement(
        string rib,
        decimal? closing = 3_147.079m,
        decimal? opening = 1_000.000m,
        IReadOnlyList<ExtractedStatementLine>? lines = null,
        IReadOnlyList<StatementExtractionIssue>? issues = null) => new()
    {
        Header = new ExtractedStatementHeader
        {
            Rib = rib,
            BankCode = rib[..2],
            Currency = "TND",
            PeriodStart = new DateOnly(2026, 1, 1),
            PeriodEnd = new DateOnly(2026, 1, 31),
            PeriodPrinted = true,
            OpeningBalance = opening is { } o ? new StatementAmount(o, 3) : null,
            ClosingBalance = closing is { } c ? new StatementAmount(c, 3) : null
        },
        Lines = lines ?? new[]
        {
            Line(0, Jan2, "VIREMENT REÇU SOCIETE ALPHA", 2_149.079m, isDebit: false),
            Line(1, Jan5, "COMMISSION VIREMENT", 1.500m, isDebit: true)
        },
        Issues = issues ?? Array.Empty<StatementExtractionIssue>(),
        ProfileId = BankStatementProfileRegistry.GenericProfileId,
        PageCount = 1,
        AiPlan = new BankStatementAiPlan
        {
            TextPages = new[] { 1 },
            Reason = BankStatementAiReadingReasons.AllDocuments,
            Mode = BankStatementAiReadingModes.AiOnly,
            Engine = BankStatementAiEngines.Vision,
            EstimatedCalls = 1,
            EstimatedSeconds = 180,
            PageReadings = new[] { new BankStatementPageReading(1, BankStatementPageReadingEngines.GlmOcr, "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0", 1, 12_000, 2, null) }
        }
    };

    private async Task<Guid> SeedAwaitingReview(Guid accountId, ExtractedBankStatement extraction, string method = BankStatementImportExtractionMethods.AiVision)
    {
        var session = BankStatementImportSession.Create(accountId, "JB", "releve.pdf", Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N"),
            1_024, "application/pdf", DateTime.UtcNow.AddHours(24));
        session.CompleteExtraction(JsonSerializer.Serialize(extraction, BankStatementImportService.JsonOptions), method, extraction.ProfileId, extraction.PageCount);
        await using var ctx = _factory.CreateContext();
        ctx.BankStatementImportSessions.Add(session);
        await ctx.SaveChangesAsync();
        return session.Id;
    }

    private async Task<BankStatement> LoadStatement(Guid id)
    {
        await using var ctx = _factory.CreateContext();
        return await ctx.BankStatements.AsNoTracking().Include(s => s.Lines).SingleAsync(s => s.Id == id);
    }

    private async Task<BankStatementImportSessionStatus> StatusOf(Guid sessionId)
    {
        await using var ctx = _factory.CreateContext();
        return (await ctx.BankStatementImportSessions.AsNoTracking().SingleAsync(s => s.Id == sessionId)).Status;
    }

    [Fact]
    public async Task Balance_gap_of_an_ai_only_statement_is_a_warning_that_requires_an_explicit_acknowledgement()
    {
        var rib = RibFor("10");
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), AiOnlyStatement(rib));

        var dto = (await Service().GetAsync(sessionId)).Value;

        Assert.True(dto.CanConfirm);
        Assert.True(dto.RequiresBalanceAcknowledgement);
        var gap = Assert.Single(dto.Extraction!.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch);
        Assert.Equal(StatementIssueSeverity.Warning, gap.Severity);
        Assert.EndsWith(BankStatementBalanceCheck.AiOnlyAdvice, gap.Message, StringComparison.Ordinal);
        Assert.False(dto.BalanceCheck!.IsBalanced);
        Assert.Equal(0.500m, dto.BalanceCheck.Difference);
    }

    [Fact]
    public async Task Confirming_without_the_acknowledgement_is_refused_and_nothing_is_saved()
    {
        var rib = RibFor("10");
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), AiOnlyStatement(rib));

        var result = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest());

        Assert.Equal(BankStatementImportErrorCodes.BalanceWarningNotAcknowledged, result.Error.Code);
        Assert.Equal(BankStatementImportSessionStatus.AwaitingReview, await StatusOf(sessionId));
        await using var ctx = _factory.CreateContext();
        Assert.Empty(ctx.BankStatements);
    }

    [Fact]
    public async Task Confirming_with_the_acknowledgement_saves_the_statement_and_records_the_gap()
    {
        var rib = RibFor("10");
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), AiOnlyStatement(rib));

        var result = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest { AcknowledgeBalanceWarning = true });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(2, result.Value.LineCount);
        var statement = await LoadStatement(result.Value.StatementId);
        Assert.Equal(0.500m, statement.BalanceDifference);
        Assert.True(statement.BalanceAcknowledged);
        Assert.Equal(BankStatementImportMethod.PdfLlm, statement.ImportMethod);
        Assert.Equal(1_000.000m, statement.OpeningBalance.Amount);
        Assert.Equal(3_147.079m, statement.ClosingBalance.Amount);
        Assert.Equal(BankStatementImportSessionStatus.Confirmed, await StatusOf(sessionId));
        _audit.Verify(a => a.LogAsync(AuditActions.Accounting.BankStatementImported, nameof(BankStatement), statement.Id,
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Without_the_flag_the_gap_stays_blocking_even_when_acknowledged()
    {
        var rib = RibFor("10");
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), AiOnlyStatement(rib));

        var dto = (await Service(gapAsWarning: false).GetAsync(sessionId)).Value;
        var confirm = await Service(gapAsWarning: false).ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest { AcknowledgeBalanceWarning = true });

        Assert.False(dto.CanConfirm);
        Assert.False(dto.RequiresBalanceAcknowledgement);
        Assert.Contains(dto.Extraction!.Issues, i => i.Code == StatementIssueCodes.BalanceMismatch && i.Severity == StatementIssueSeverity.Blocking);
        Assert.Equal(BankStatementImportErrorCodes.BlockingIssues, confirm.Error.Code);
    }

    [Fact]
    public async Task Lines_read_directly_keep_the_historical_blocking_behaviour_even_with_the_flag()
    {
        var rib = RibFor("10");
        var layout = AiOnlyStatement(rib, lines: new[]
        {
            Line(0, Jan2, "VIREMENT REÇU SOCIETE ALPHA", 2_149.079m, isDebit: false, StatementLineSource.Layout),
            Line(1, Jan5, "COMMISSION VIREMENT", 1.500m, isDebit: true, StatementLineSource.Layout)
        }) with { AiPlan = null };
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), layout, BankStatementImportExtractionMethods.Layout);

        var dto = (await Service().GetAsync(sessionId)).Value;
        var confirm = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest { AcknowledgeBalanceWarning = true });

        Assert.False(dto.CanConfirm);
        Assert.False(dto.RequiresBalanceAcknowledgement);
        Assert.Equal(BankStatementImportErrorCodes.BlockingIssues, confirm.Error.Code);
    }

    [Fact]
    public async Task A_statement_without_any_balance_is_not_confirmable_and_never_surfaces_a_dead_end()
    {
        var rib = RibFor("10");
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), AiOnlyStatement(rib, closing: null, opening: null));

        var dto = (await Service().GetAsync(sessionId)).Value;
        var confirm = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest { AcknowledgeBalanceWarning = true });

        Assert.False(dto.CanConfirm);
        Assert.False(dto.RequiresBalanceAcknowledgement);
        Assert.Equal(BankStatementImportErrorCodes.BlockingIssues, confirm.Error.Code);
        Assert.Contains("solde", confirm.Error.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_refused_confirm_writes_no_correction_audit_and_a_successful_one_writes_it_once()
    {
        var rib = RibFor("10");
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), AiOnlyStatement(rib));
        var corrections = new[]
        {
            new StatementLineCorrection { LineIndex = 0, Label = "VIREMENT REÇU SOCIETE ALPHA (corrigé)" }
        };

        // Sans l'accusé : refus, et aucune trace de correction ne doit être consignée.
        var refused = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest { Corrections = corrections });
        Assert.Equal(BankStatementImportErrorCodes.BalanceWarningNotAcknowledged, refused.Error.Code);
        _audit.Verify(a => a.LogAsync(AuditActions.Accounting.BankStatementExtractionCorrected, It.IsAny<string>(), It.IsAny<Guid>(),
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Never);

        // Avec l'accusé : succès, et la correction est auditée une seule fois.
        var confirmed = await Service().ConfirmAsync(sessionId,
            new ConfirmBankStatementImportRequest { Corrections = corrections, AcknowledgeBalanceWarning = true });
        Assert.True(confirmed.IsSuccess, confirmed.IsFailure ? confirmed.Error.Description : null);
        _audit.Verify(a => a.LogAsync(AuditActions.Accounting.BankStatementExtractionCorrected, nameof(BankStatementImportSession), sessionId,
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_balanced_ai_only_statement_needs_no_acknowledgement_and_records_a_zero_gap()
    {
        var rib = RibFor("10");
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), AiOnlyStatement(rib, closing: 3_147.579m));

        var dto = (await Service().GetAsync(sessionId)).Value;
        var result = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest());

        Assert.True(dto.CanConfirm);
        Assert.False(dto.RequiresBalanceAcknowledgement);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var statement = await LoadStatement(result.Value.StatementId);
        Assert.Equal(0m, statement.BalanceDifference);
        Assert.False(statement.BalanceAcknowledged);
    }

    [Fact]
    public async Task Excluding_a_line_removes_it_renumbers_the_rest_and_can_balance_the_statement()
    {
        var rib = RibFor("10");
        var extraction = AiOnlyStatement(rib, closing: 3_147.579m, lines: new[]
        {
            Line(0, Jan2, "VIREMENT REÇU SOCIETE ALPHA", 2_149.079m, isDebit: false),
            Line(1, Jan2, "LIGNE DE TOTAUX LUE PAR ERREUR", 0.500m, isDebit: false),
            Line(2, Jan5, "COMMISSION VIREMENT", 1.500m, isDebit: true)
        }, issues: new[]
        {
            new StatementExtractionIssue(StatementIssueCodes.AiPossibleDuplicate, StatementIssueSeverity.Warning, "Ligne 2 : doublon possible.", 1, 1),
            new StatementExtractionIssue(StatementIssueCodes.AiPossibleDuplicate, StatementIssueSeverity.Warning, "Ligne 3 : doublon possible.", 1, 2)
        });
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), extraction);

        var result = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest
        {
            Corrections = new[] { new StatementLineCorrection { LineIndex = 1, Exclude = true } }
        });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(2, result.Value.LineCount);
        var statement = await LoadStatement(result.Value.StatementId);
        Assert.Equal(0m, statement.BalanceDifference);
        Assert.False(statement.BalanceAcknowledged);
        Assert.DoesNotContain(statement.Lines, l => l.Description.Contains("TOTAUX", StringComparison.Ordinal));

        await using var ctx = _factory.CreateContext();
        var session = await ctx.BankStatementImportSessions.AsNoTracking().SingleAsync(s => s.Id == sessionId);
        var kept = BankStatementImportService.Deserialize(session.ResultJson!)!;
        Assert.Equal(new[] { 0, 1 }, kept.Lines.Select(l => l.Index));
        var duplicate = Assert.Single(kept.Issues, i => i.Code == StatementIssueCodes.AiPossibleDuplicate);
        Assert.Equal(1, duplicate.LineIndex);
        _audit.Verify(a => a.LogAsync(AuditActions.Accounting.BankStatementExtractionCorrected, nameof(BankStatementImportSession), sessionId,
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Excluding_every_line_is_refused()
    {
        var rib = RibFor("10");
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), AiOnlyStatement(rib));

        var result = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest
        {
            Corrections = new[]
            {
                new StatementLineCorrection { LineIndex = 0, Exclude = true },
                new StatementLineCorrection { LineIndex = 1, Exclude = true }
            }
        });

        Assert.Equal(BankStatementImportErrorCodes.BlockingIssues, result.Error.Code);
        Assert.Equal(BankStatementImportSessionStatus.AwaitingReview, await StatusOf(sessionId));
    }

    [Fact]
    public async Task More_corrections_than_lines_are_refused()
    {
        var rib = RibFor("10");
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), AiOnlyStatement(rib));

        var result = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest
        {
            Corrections = Enumerable.Range(0, 3).Select(_ => new StatementLineCorrection { LineIndex = 0, Label = "X" }).ToList()
        });

        Assert.Equal(BankStatementImportErrorCodes.CorrectionNotAllowed, result.Error.Code);
    }

    [Fact]
    public async Task A_line_left_without_amount_is_refused_until_corrected_or_excluded()
    {
        var rib = RibFor("10");
        var extraction = AiOnlyStatement(rib, closing: 3_147.579m, lines: new[]
        {
            Line(0, Jan2, "VIREMENT REÇU SOCIETE ALPHA", 2_149.079m, isDebit: false),
            Line(1, Jan5, "COMMISSION VIREMENT", 1.500m, isDebit: true),
            Line(2, Jan5, "MONTANT ILLISIBLE", 0m, isDebit: true)
        }, issues: new[]
        {
            new StatementExtractionIssue(StatementIssueCodes.AiLineNeedsReview, StatementIssueSeverity.Blocking, "Ligne 3 : montant illisible.", 1, 2)
        });
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), extraction);

        var labelOnly = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest
        {
            Corrections = new[] { new StatementLineCorrection { LineIndex = 2, Label = "FRAIS DE TENUE DE COMPTE" } }
        });
        Assert.Equal(BankStatementImportErrorCodes.CorrectionNotAllowed, labelOnly.Error.Code);
        Assert.Contains("Ligne 3 sans montant", labelOnly.Error.Description, StringComparison.Ordinal);

        var excluded = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest
        {
            Corrections = new[] { new StatementLineCorrection { LineIndex = 2, Exclude = true } }
        });
        Assert.True(excluded.IsSuccess, excluded.IsFailure ? excluded.Error.Description : null);
        Assert.Equal(2, excluded.Value.LineCount);
    }

    [Fact]
    public async Task A_corrected_amount_lifts_the_review_issues_of_the_line()
    {
        var rib = RibFor("10");
        var extraction = AiOnlyStatement(rib, closing: 3_137.579m, lines: new[]
        {
            Line(0, Jan2, "VIREMENT REÇU SOCIETE ALPHA", 2_149.079m, isDebit: false),
            Line(1, Jan5, "COMMISSION VIREMENT", 1.500m, isDebit: true),
            Line(2, Jan5, "FRAIS DIVERS", 0m, isDebit: true)
        }, issues: new[]
        {
            new StatementExtractionIssue(StatementIssueCodes.AiLineNeedsReview, StatementIssueSeverity.Blocking, "Ligne 3 : montant illisible.", 1, 2),
            new StatementExtractionIssue(StatementIssueCodes.AiAmountNotGrounded, StatementIssueSeverity.Warning, "Ligne 3 : montant non retrouvé.", 1, 2)
        });
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), extraction);

        var result = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest
        {
            Corrections = new[] { new StatementLineCorrection { LineIndex = 2, Amount = 10.000m } }
        });

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        Assert.Equal(3, result.Value.LineCount);
        var statement = await LoadStatement(result.Value.StatementId);
        Assert.Equal(0m, statement.BalanceDifference);
        Assert.Contains(statement.Lines, l => l.Amount.Amount == 10.000m && l.IsDebit);
    }

    [Fact]
    public async Task A_closing_balance_not_read_is_acknowledged_then_derived_from_the_operations()
    {
        var rib = RibFor("10");
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), AiOnlyStatement(rib, closing: null));

        var dto = (await Service().GetAsync(sessionId)).Value;
        var refused = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest());
        var result = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest { AcknowledgeBalanceWarning = true });

        Assert.True(dto.CanConfirm);
        Assert.True(dto.RequiresBalanceAcknowledgement);
        Assert.Contains(dto.Extraction!.Issues, i => i.Code == StatementIssueCodes.ClosingNotFound && i.Severity == StatementIssueSeverity.Warning);
        Assert.Equal(BankStatementImportErrorCodes.BalanceWarningNotAcknowledged, refused.Error.Code);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var statement = await LoadStatement(result.Value.StatementId);
        Assert.Equal(3_147.579m, statement.ClosingBalance.Amount);
        Assert.Null(statement.BalanceDifference);
        Assert.True(statement.BalanceAcknowledged);
    }

    [Fact]
    public async Task A_statement_without_any_balance_read_cannot_be_saved()
    {
        var rib = RibFor("10");
        var sessionId = await SeedAwaitingReview(SeedBankAccount(rib), AiOnlyStatement(rib, closing: null, opening: null));

        var result = await Service().ConfirmAsync(sessionId, new ConfirmBankStatementImportRequest { AcknowledgeBalanceWarning = true });

        Assert.Equal(BankStatementImportErrorCodes.BlockingIssues, result.Error.Code);
        Assert.Contains("solde", result.Error.Description, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(BankStatementImportSessionStatus.AwaitingReview, await StatusOf(sessionId));
    }
}
