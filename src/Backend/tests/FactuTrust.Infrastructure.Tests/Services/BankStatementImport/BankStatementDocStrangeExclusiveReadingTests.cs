using System.Globalization;
using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Application.Features.AI.Json;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;
using static FactuTrust.Infrastructure.Tests.Services.BankStatementImport.SyntheticBankStatementPdf;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Carte Docstrange activée ⇒ le service d'extraction documentaire lit les relevés, et <b>lui seul</b>.
///
/// <para>Ce que ces tests épinglent, et pourquoi chacun compte :</para>
/// <list type="number">
/// <item>Le pipeline LLM n'est <b>jamais</b> appelé : ni étage vision, ni étage texte. C'est l'objet
/// même de la demande — l'ancien comportement rattrapait silencieusement tout échec par le modèle
/// local, en faisant attendre l'utilisateur deux fois sans qu'aucun écran ne le dise.</item>
/// <item>Le modèle vision local n'est ni <b>résolu</b> ni <b>préchauffé</b> : le préchauffage charge
/// plusieurs gigaoctets en mémoire et prend des dizaines de secondes, pour un modèle qui ne lira pas
/// une seule page.</item>
/// <item>Une page en échec bloque <b>cette page seule</b> : les suivantes sont tentées, et aucun
/// coupe-circuit ne ferme la lecture. Ce coupe-circuit protège d'un modèle local qui s'effondre,
/// pas d'un service HTTP dont les pages sont indépendantes.</item>
/// <item>Le réglage <c>VisionReadingEnabled</c>, qui gouverne le modèle vision <b>local</b>, ne
/// gouverne pas ce service : l'y soumettre renverrait le relevé au modèle texte local, c'est-à-dire
/// à l'IA que l'activation de la carte écarte.</item>
/// </list>
/// </summary>
public sealed class BankStatementDocStrangeExclusiveReadingTests : IDisposable
{
    private const string ImportModel = "hf.co/Qwen/Qwen3-VL-2B-Instruct-GGUF:Q4_K_M";

    private readonly string _dbName = $"BankStatementDocStrangeExclusive_{Guid.NewGuid():N}";
    private readonly string _storage = Path.Combine(Path.GetTempPath(), "ft-bqds-tests", Guid.NewGuid().ToString("N"));

    /// <summary>Mock STRICT : tout appel au pipeline LLM non explicitement autorisé fait échouer le test.</summary>
    private readonly Mock<IAiStructuredExtractionPipeline> _pipeline = new(MockBehavior.Strict);
    private readonly Mock<IImportAiModelResolutionService> _resolver = new();
    private readonly Mock<IDocumentExtractionProvider> _provider = new();

    /// <summary>Pages demandées au service externe, dans l'ordre (lues depuis le nom de fichier).</summary>
    private readonly List<int> _pagesSentOut = new();

    /// <summary>Schemas reellement transmis : la garde contre un retour aux nombres.</summary>
    private readonly List<JsonElement> _schemasSentOut = new();

    public void Dispose()
    {
        try { if (Directory.Exists(_storage)) Directory.Delete(_storage, recursive: true); }
        catch (IOException) { }
    }

    private sealed class InMemoryFactory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() => new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }

    // ---- harnais ---------------------------------------------------------------------------

    private IServiceProvider Services(bool visionReadingEnabled = true, bool cardAvailable = true)
    {
        var settings = new AccountingSettings { BankStatementAiPostingEnabled = true, BankStatementAiForAllDocumentsEnabled = true };
        var limits = settings.BankStatementImport;
        limits.StorageBasePath = _storage;
        limits.AiOnlyReadingEnabled = true;
        limits.VisionReadingEnabled = visionReadingEnabled;
        limits.VisionTextFallbackEnabled = false;

        var parsed = ModelRef.Parse(ImportModel);
        _resolver.Setup(r => r.ResolveAsync(It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DocumentImportModelResolution(
                parsed,
                DocumentImportModelSource.Platform,
                IsVisionCapable: true,
                UsesLegacyVisionAppsettings: false,
                ImportAiModelResolver.ResolveVisionStrategy(parsed, true)));
        _resolver.Setup(r => r.ResolveEffectiveVisionModelIdAsync(It.IsAny<string?>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ImportModel);

        _provider.SetupGet(x => x.Name).Returns("docstrange");
        _provider.Setup(x => x.IsAvailableAsync(It.IsAny<CancellationToken>())).ReturnsAsync(cardAvailable);

        var services = new ServiceCollection();
        services.AddSingleton<ITenantDbContextFactory>(new InMemoryFactory(_dbName));
        services.AddSingleton(_pipeline.Object);
        services.AddSingleton(_resolver.Object);
        services.AddSingleton(_provider.Object);
        services.AddSingleton(Options.Create(settings));
        services.AddSingleton(Options.Create(new OllamaSettings()));
        services.AddSingleton(Options.Create(new DocStrangeSettings()));
        services.AddSingleton<BankStatementFileStore>();
        services.AddSingleton(new BankStatementLayoutExtractor());
        return services.BuildServiceProvider();
    }

    /// <summary>Le service rend un JSON verbatim par page ; <c>null</c> = la page échoue.</summary>
    private void ProviderAnswers(Func<int, string?> perPage)
    {
        _provider
            .Setup(x => x.ExtractStructuredAsync(
                It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<JsonElement>(), It.IsAny<CancellationToken>()))
            .Returns<Stream, string, string, JsonElement, CancellationToken>((_, fileName, _, schema, _) =>
            {
                var page = PageOf(fileName);
                _pagesSentOut.Add(page);
                _schemasSentOut.Add(schema);
                var json = perPage(page);
                return Task.FromResult(json is null
                    ? Result.Failure<string>(Error.Validation("DocStrange", "Service d'extraction injoignable."))
                    : Result.Success(json));
            });
    }

    /// <summary>« releve-page-7.pdf » ⇒ 7. Le job isole chaque page avant de l'envoyer.</summary>
    private static int PageOf(string fileName)
    {
        var digits = new string(fileName.Where(char.IsDigit).ToArray());
        return int.TryParse(digits, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 1;
    }

    private static Spec OnePageSpec() => new("10", 1_000.000m, new[]
    {
        new Op("02/01/2026", "05/01/2026", new[] { "VIREMENT REÇU SOCIETE ALPHA" }, null, 2_149.079m),
        new Op("05/01/2026", "02/01/2026", new[] { "RÈG CHÈQUE N° 0001234" }, 2_400.000m, null)
    });

    /// <summary>Assez d'opérations pour que le PDF tienne sur plusieurs pages.</summary>
    private static Spec ManyPagesSpec(int operations = 150)
    {
        var ops = new List<Op>(operations);
        for (var i = 0; i < operations; i++)
        {
            var day = (i % 27) + 1;
            ops.Add(new Op(
                $"{day:D2}/01/2026",
                $"{day:D2}/01/2026",
                new[] { $"VIREMENT DEMO {i:D3}" },
                i % 2 == 0 ? 10.000m : null,
                i % 2 == 0 ? null : 10.000m));
        }

        return new Spec("10", 1_000.000m, ops);
    }

    // Forme réelle de la réponse, relevée contre l'API le 2026-10-09 : montants et dates en
    // CHAÎNES, recopiés tels qu'imprimés, virgule tunisienne intacte. C'est ce qui rend le ×1000
    // impossible — demander un « number » ferait lire « 2 400,000 » comme 2 400 000.
    private const string TwoOperationsJson = """
        {"rib":null,"openingBalance":null,"closingBalance":null,"lines":[
          {"date":"02/01/2026","valueDate":"05/01/2026","label":"VIREMENT REÇU SOCIETE ALPHA","debit":null,"credit":"2 149,079"},
          {"date":"05/01/2026","valueDate":"02/01/2026","label":"RÈG CHÈQUE N° 0001234","debit":"2 400,000","credit":null}]}
        """;

    private static string OneOperationJson(int page) => $$"""
        {"lines":[{"date":"{{((page % 27) + 1):D2}}/01/2026","valueDate":null,"label":"VIREMENT DEMO PAGE {{page:D3}}","debit":null,"credit":"10,000"}]}
        """;

    private async Task<(Guid SessionId, int PageCount)> SeedAsync(IServiceProvider services, byte[] pdf)
    {
        var direct = new BankStatementLayoutExtractor().Extract(pdf);
        var planned = Enumerable.Range(1, Math.Max(1, direct.PageCount)).ToArray();
        var interim = direct with
        {
            AiPlan = new BankStatementAiPlan
            {
                ScannedPages = planned,
                Reason = BankStatementAiReadingReasons.AllDocuments,
                Engine = BankStatementAiEngines.Vision,
                Mode = BankStatementAiReadingModes.AiOnly,
                EstimatedCalls = planned.Length
            }
        };

        var session = BankStatementImportSession.Create(Guid.NewGuid(), "JB", "releve.pdf", "EF56", pdf.Length, "application/pdf", DateTime.UtcNow.AddHours(1));
        session.AttachFile(await services.GetRequiredService<BankStatementFileStore>()
            .SaveSessionFileAsync(Guid.NewGuid(), session.Id, ".pdf", pdf, CancellationToken.None));
        session.StartAiExtraction(BankStatementAiProviderKinds.DocStrange,
            JsonSerializer.Serialize(interim, BankStatementImportService.JsonOptions), direct.ProfileId, direct.PageCount);

        await using var ctx = services.GetRequiredService<ITenantDbContextFactory>().CreateContext();
        ctx.BankStatementImportSessions.Add(session);
        await ctx.SaveChangesAsync();
        return (session.Id, direct.PageCount);
    }

    private static Task RunAsync(IServiceProvider services, Guid sessionId) =>
        new BankStatementAiExtractionJob(Mock.Of<ITenantService>(), Mock.Of<IServiceScopeFactory>(),
                NullLogger<BankStatementAiExtractionJob>.Instance)
            .RunAsync(services, sessionId, CancellationToken.None);

    private static async Task<BankStatementImportSessionDto> SessionAsync(IServiceProvider services, Guid sessionId)
    {
        await using var ctx = services.GetRequiredService<ITenantDbContextFactory>().CreateContext();
        return BankStatementImportService.ToDto(await ctx.BankStatementImportSessions.SingleAsync(s => s.Id == sessionId));
    }

    /// <summary>Aucun modèle local n'a été ni nommé, ni chargé.</summary>
    private void AssertNoLocalModelTouched()
    {
        _pipeline.VerifyNoOtherCalls();
        _resolver.Verify(
            r => r.ResolveEffectiveVisionModelIdAsync(It.IsAny<string?>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()),
            Times.Never,
            "résoudre le modèle vision déclenche son préchauffage : des dizaines de secondes et plusieurs gigaoctets pour un modèle qui ne lira pas une page");
    }

    // ---- tests -----------------------------------------------------------------------------

    [Fact]
    public async Task The_card_reads_the_page_and_the_llm_pipeline_is_never_called()
    {
        var services = Services();
        var (sessionId, _) = await SeedAsync(services, StbLike(OnePageSpec()));
        ProviderAnswers(_ => TwoOperationsJson);

        await RunAsync(services, sessionId);

        var dto = await SessionAsync(services, sessionId);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), dto.Status);
        Assert.Equal(2, dto.Extraction!.Lines.Count);

        var reading = Assert.Single(dto.Extraction.AiPlan!.PageReadings!);
        Assert.Equal(BankStatementPageReadingEngines.DocStrange, reading.Engine);
        Assert.Null(reading.FailureReason);

        // Les montants transmis en chaînes (« 2 149,079 ») sont convertis côté serveur par la
        // convention tunisienne, et non par le fournisseur — c'est ce qui écarte le ×1000.
        Assert.Equal(2_149.079m, dto.Extraction.Lines[0].Amount);
        Assert.False(dto.Extraction.Lines[0].IsDebit);
        Assert.Equal(2_400.000m, dto.Extraction.Lines[1].Amount);
        Assert.True(dto.Extraction.Lines[1].IsDebit);

        // Le schéma réellement transmis ne demande aucun nombre. Le jour où il en demanderait,
        // les montants reviendraient multipliés par 1000 sans que rien ne le signale.
        var schema = Assert.Single(_schemasSentOut);
        Assert.Equal(LlmOutputSchemas.BankStatementPageVerbatim.GetRawText(), schema.GetRawText());
        Assert.DoesNotContain("\"number\"", schema.GetRawText(), StringComparison.Ordinal);

        AssertNoLocalModelTouched();
    }

    [Fact]
    public async Task A_failing_page_is_recorded_unread_and_no_local_model_takes_over()
    {
        var services = Services();
        var (sessionId, _) = await SeedAsync(services, StbLike(OnePageSpec()));
        ProviderAnswers(_ => null);

        await RunAsync(services, sessionId);

        var dto = await SessionAsync(services, sessionId);
        var reading = Assert.Single(dto.Extraction!.AiPlan!.PageReadings!);
        Assert.Equal(BankStatementPageReadingEngines.Failed, reading.Engine);
        Assert.False(string.IsNullOrWhiteSpace(reading.FailureReason));

        // La raison reste un message court et stable : jamais le corps d'erreur du fournisseur (CWE-209).
        Assert.DoesNotContain("<", reading.FailureReason!, StringComparison.Ordinal);

        // Aucune ligne inventée, et le relevé n'est pas enregistrable en silence.
        Assert.Contains(dto.Extraction.Issues, i => i.Code == StatementIssueCodes.AiPageFailed);

        AssertNoLocalModelTouched();
    }

    [Fact]
    public async Task An_unreadable_answer_is_a_page_failure_not_a_fallback_to_the_local_model()
    {
        var services = Services();
        var (sessionId, _) = await SeedAsync(services, StbLike(OnePageSpec()));
        // Réponse HTTP valide mais inexploitable : pas le moindre objet JSON.
        ProviderAnswers(_ => "Relevé de compte. Aucun JSON ici, seulement de la prose.");

        await RunAsync(services, sessionId);

        var dto = await SessionAsync(services, sessionId);
        var reading = Assert.Single(dto.Extraction!.AiPlan!.PageReadings!);
        Assert.Equal(BankStatementPageReadingEngines.Failed, reading.Engine);

        AssertNoLocalModelTouched();
    }

    [Fact]
    public async Task The_local_vision_reading_switch_does_not_govern_this_service()
    {
        // VisionReadingEnabled éteint : sans la règle qui distingue les deux lecteurs, le plan
        // retomberait sur le modèle texte local, c'est-à-dire sur l'IA que la carte écarte.
        var services = Services(visionReadingEnabled: false);
        var (sessionId, _) = await SeedAsync(services, StbLike(OnePageSpec()));
        ProviderAnswers(_ => TwoOperationsJson);

        await RunAsync(services, sessionId);

        var dto = await SessionAsync(services, sessionId);
        var reading = Assert.Single(dto.Extraction!.AiPlan!.PageReadings!);
        Assert.Equal(BankStatementPageReadingEngines.DocStrange, reading.Engine);

        AssertNoLocalModelTouched();
    }

    [Fact]
    public async Task A_page_in_failure_blocks_that_page_alone_and_never_opens_a_circuit_breaker()
    {
        var services = Services();
        var (sessionId, pageCount) = await SeedAsync(services, StbLike(ManyPagesSpec()));
        Assert.True(pageCount >= 3, $"ce test exige un relevé de 3 pages ou plus ; obtenu {pageCount}");

        // Les DEUX premières pages échouent : l'ancien coupe-circuit « deux échecs consécutifs »
        // aurait fermé la lecture ici et renvoyé tout le reste au modèle texte local.
        ProviderAnswers(page => page <= 2 ? null : OneOperationJson(page));

        await RunAsync(services, sessionId);

        var dto = await SessionAsync(services, sessionId);
        var readings = dto.Extraction!.AiPlan!.PageReadings!;

        Assert.Equal(pageCount, readings.Count);
        Assert.Equal(Enumerable.Range(1, pageCount), _pagesSentOut.Order());

        Assert.All(readings.Where(r => r.Page <= 2),
            r => Assert.Equal(BankStatementPageReadingEngines.Failed, r.Engine));
        Assert.All(readings.Where(r => r.Page > 2),
            r => Assert.Equal(BankStatementPageReadingEngines.DocStrange, r.Engine));

        // Aucune page relue en secours : le repli n'existe plus sur ce chemin.
        Assert.DoesNotContain(readings, r => r.Engine == BankStatementPageReadingEngines.TextModel);

        AssertNoLocalModelTouched();
    }

    [Fact]
    public async Task Resuming_an_extracting_session_with_persisted_pages_does_not_recall_docstrange()
    {
        var services = Services();
        var (sessionId, _) = await SeedAsync(services, StbLike(OnePageSpec()));
        ProviderAnswers(_ => TwoOperationsJson);

        await RunAsync(services, sessionId);

        var dto = await SessionAsync(services, sessionId);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), dto.Status);
        _pagesSentOut.Clear();

        await using (var ctx = services.GetRequiredService<ITenantDbContextFactory>().CreateContext())
        {
            var session = await ctx.BankStatementImportSessions.SingleAsync(s => s.Id == sessionId);
            session.StartAiExtraction(
                session.AiProviderKind ?? BankStatementAiProviderKinds.DocStrange,
                session.ResultJson!,
                session.ProfileId ?? dto.Extraction!.ProfileId,
                session.PageCount);
            await ctx.SaveChangesAsync();
        }

        await RunAsync(services, sessionId);

        Assert.Empty(_pagesSentOut);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), (await SessionAsync(services, sessionId)).Status);
        AssertNoLocalModelTouched();
    }

    [Fact]
    public void TrySkipAlreadyReadPage_skips_when_trace_and_lines_are_present()
    {
        var pageReadings = new List<BankStatementPageReading>
        {
            new(1, BankStatementPageReadingEngines.DocStrange, "docstrange", 1, 100, 2, null)
        };
        var lines = new List<ExtractedStatementLine>
        {
            new()
            {
                Index = 0,
                PageNumber = 1,
                TransactionDate = new DateOnly(2026, 1, 2),
                Label = "OP",
                Amount = 10m,
                IsDebit = true,
                Source = StatementLineSource.Ai
            }
        };
        var readings = new Dictionary<int, BankStatementAiPageReader.PageReading>
        {
            [1] = new(lines, null, null, Array.Empty<StatementExtractionIssue>())
        };

        Assert.True(BankStatementAiExtractionJob.TrySkipAlreadyReadPage(1, pageReadings, readings, out var skipped));
        Assert.NotNull(skipped);
        Assert.Single(skipped!.Lines);
    }

    [Fact]
    public async Task Without_an_available_card_the_local_ladder_is_the_one_that_runs()
    {
        // Garantie de non-régression : désactiver la carte rend exactement le comportement d'avant.
        var services = Services(cardAvailable: false);
        var (sessionId, _) = await SeedAsync(services, StbLike(OnePageSpec()));

        _pipeline.Setup(p => p.ResolveModelRefAsync(It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ModelRef.Parse(ImportModel));
        _pipeline.Setup(p => p.WarmUpAsync(It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new InvoiceImportWarmUpResult(true, true, ImportModel, null, null, null));
        _pipeline.Setup(p => p.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new AiStructuredExtractionOutcome(
                """{"lines":[{"date":"2026-01-02","valueDate":"2026-01-05","label":"VIREMENT REÇU SOCIETE ALPHA","debit":null,"credit":2149.079},{"date":"2026-01-05","valueDate":"2026-01-02","label":"RÈG CHÈQUE N° 0001234","debit":2400.000,"credit":null}]}""",
                new AiDocumentExtractionResult { Success = true, Text = "texte", Format = "pdf", PageCount = 1 },
                false, ImportModel, VisionUsed: true, 1, 10)));

        await RunAsync(services, sessionId);

        var dto = await SessionAsync(services, sessionId);
        var reading = Assert.Single(dto.Extraction!.AiPlan!.PageReadings!);
        Assert.NotEqual(BankStatementPageReadingEngines.DocStrange, reading.Engine);

        // Le service n'a même pas été sollicité pour une page.
        Assert.Empty(_pagesSentOut);
        _provider.Verify(
            x => x.ExtractStructuredAsync(
                It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<JsonElement>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }
}
