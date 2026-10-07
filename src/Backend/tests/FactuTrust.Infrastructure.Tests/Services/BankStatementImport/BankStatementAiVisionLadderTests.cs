using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
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
/// Échelle de lecture VISION du chemin de production (« IA seule »), jusqu'ici couverte par aucun test :
/// la condition de routage exige un plan <c>ai_only</c> + <c>engine=vision</c> et un
/// <see cref="IImportAiModelResolutionService"/> enregistré, ce que les anciennes fixtures ne fournissaient pas.
///
/// Invariants vérifiés : un modèle multimodal, GLM-OCR ou non, a DEUX essais vision avec le modèle d'import
/// configuré ; l'étage 1 n'emploie que la forme éprouvée (prompt système vide, consigne brute) ; l'étage 2 part
/// sans aucun schéma ; le repli « modèle texte » n'est plus emprunté ; une page non lue bloque l'enregistrement.
/// </summary>
public sealed class BankStatementAiVisionLadderTests : IDisposable
{
    private const string ImportModel = "hf.co/Qwen/Qwen3-VL-2B-Instruct-GGUF:Q4_K_M";

    private readonly string _dbName = $"BankStatementVisionLadder_{Guid.NewGuid():N}";
    private readonly string _storage = Path.Combine(Path.GetTempPath(), "ft-bqvis-tests", Guid.NewGuid().ToString("N"));
    private readonly Mock<IAiStructuredExtractionPipeline> _pipeline = new();
    private readonly List<AiStructuredExtractionRequest> _calls = new();

    public void Dispose()
    {
        try { if (Directory.Exists(_storage)) Directory.Delete(_storage, recursive: true); }
        catch (IOException) { }
    }

    private sealed class InMemoryFactory(string name) : ITenantDbContextFactory
    {
        public TenantDbContext CreateContext() => new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(name).Options);
    }

    private IServiceProvider Services(bool glmOcr = false, bool textFallback = false, bool legacyGenericPrompt = false)
    {
        var settings = new AccountingSettings { BankStatementAiPostingEnabled = true, BankStatementAiForAllDocumentsEnabled = true };
        var limits = settings.BankStatementImport;
        limits.StorageBasePath = _storage;
        limits.AiOnlyReadingEnabled = true;
        limits.VisionReadingEnabled = true;
        limits.VisionTextFallbackEnabled = textFallback;
        limits.VisionLegacyGenericPromptEnabled = legacyGenericPrompt;

        var model = glmOcr ? "hf.co/ggml-org/GLM-OCR-GGUF:Q8_0" : ImportModel;
        var parsed = ModelRef.Parse(model);
        var resolver = new Mock<IImportAiModelResolutionService>();
        resolver.Setup(r => r.ResolveAsync(It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new DocumentImportModelResolution(
                parsed,
                DocumentImportModelSource.Platform,
                IsVisionCapable: true,
                UsesLegacyVisionAppsettings: false,
                ImportAiModelResolver.ResolveVisionStrategy(parsed, true)));
        resolver.Setup(r => r.ResolveEffectiveVisionModelIdAsync(It.IsAny<string?>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(model);

        var services = new ServiceCollection();
        services.AddSingleton<ITenantDbContextFactory>(new InMemoryFactory(_dbName));
        services.AddSingleton(_pipeline.Object);
        services.AddSingleton(resolver.Object);
        services.AddSingleton(Options.Create(settings));
        services.AddSingleton(Options.Create(new OllamaSettings()));
        services.AddSingleton<BankStatementFileStore>();
        services.AddSingleton(new BankStatementLayoutExtractor());
        return services.BuildServiceProvider();
    }

    /// <summary>Relevé d'une page, lu correctement par la lecture directe : seule l'IA décide du résultat final.</summary>
    private static Spec OnePageSpec() => new("10", 1_000.000m, new[]
    {
        new Op("02/01/2026", "05/01/2026", new[] { "VIREMENT REÇU SOCIETE ALPHA" }, null, 2_149.079m),
        new Op("05/01/2026", "02/01/2026", new[] { "RÈG CHÈQUE N° 0001234" }, 2_400.000m, null)
    });

    private async Task<Guid> SeedAsync(IServiceProvider services, byte[] pdf)
    {
        var direct = new BankStatementLayoutExtractor().Extract(pdf);
        var interim = direct with
        {
            AiPlan = new BankStatementAiPlan
            {
                ScannedPages = new[] { 1 },
                Reason = BankStatementAiReadingReasons.AllDocuments,
                Engine = BankStatementAiEngines.Vision,
                Mode = BankStatementAiReadingModes.AiOnly,
                EstimatedCalls = 1
            }
        };

        var session = BankStatementImportSession.Create(Guid.NewGuid(), "JB", "releve.pdf", "EF56", pdf.Length, "application/pdf", DateTime.UtcNow.AddHours(1));
        session.AttachFile(await services.GetRequiredService<BankStatementFileStore>()
            .SaveSessionFileAsync(Guid.NewGuid(), session.Id, ".pdf", pdf, CancellationToken.None));
        session.StartAiExtraction("local", JsonSerializer.Serialize(interim, BankStatementImportService.JsonOptions), direct.ProfileId, direct.PageCount);

        await using var ctx = services.GetRequiredService<ITenantDbContextFactory>().CreateContext();
        ctx.BankStatementImportSessions.Add(session);
        await ctx.SaveChangesAsync();
        return session.Id;
    }

    /// <summary>Réponses successives du moteur, dans l'ordre des appels.</summary>
    private void PipelineAnswers(params string?[] rawPerCall)
    {
        _pipeline.Setup(p => p.ResolveModelRefAsync(It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ModelRef.Parse(ImportModel));
        SetupRun(rawPerCall);
    }

    private void SetupRun(string?[] rawPerCall) =>
        _pipeline.Setup(p => p.RunAsync(It.IsAny<AiStructuredExtractionRequest>(), It.IsAny<CancellationToken>()))
            .Returns<AiStructuredExtractionRequest, CancellationToken>((request, _) =>
            {
                _calls.Add(request);
                var raw = _calls.Count <= rawPerCall.Length ? rawPerCall[_calls.Count - 1] : null;
                if (raw is null)
                    return Task.FromResult(Result.Failure<AiStructuredExtractionOutcome>(Error.Validation("BankStatementImport", "Moteur IA indisponible.")));
                return Task.FromResult(Result.Success(new AiStructuredExtractionOutcome(
                    raw,
                    new AiDocumentExtractionResult { Success = true, Text = "texte", Format = "pdf", PageCount = 1 },
                    false, ImportModel, VisionUsed: true, 1, 10)));
            });

    private static Task RunAsync(IServiceProvider services, Guid sessionId) =>
        new BankStatementAiExtractionJob(Mock.Of<ITenantService>(), Mock.Of<IServiceScopeFactory>(),
                NullLogger<BankStatementAiExtractionJob>.Instance)
            .RunAsync(services, sessionId, CancellationToken.None);

    private static async Task<BankStatementImportSessionDto> SessionAsync(IServiceProvider services, Guid sessionId)
    {
        await using var ctx = services.GetRequiredService<ITenantDbContextFactory>().CreateContext();
        return BankStatementImportService.ToDto(await ctx.BankStatementImportSessions.SingleAsync(s => s.Id == sessionId));
    }

    private const string TwoOperations = """
        {"lines":[
          {"date":"2026-01-02","valueDate":"2026-01-05","label":"VIREMENT REÇU SOCIETE ALPHA","debit":null,"credit":2149.079},
          {"date":"2026-01-05","valueDate":"2026-01-02","label":"RÈG CHÈQUE N° 0001234","debit":2400.000,"credit":null}]}
        """;

    private const string EmptyJson = """{"lines":[]}""";

    [Fact]
    public async Task A_generic_multimodal_model_reads_the_page_with_the_configured_import_model()
    {
        var services = Services();
        var sessionId = await SeedAsync(services, StbLike(OnePageSpec()));
        PipelineAnswers(TwoOperations);

        await RunAsync(services, sessionId);

        var call = Assert.Single(_calls);
        Assert.Equal(ImportModel, call.VisionModelOverride);
        Assert.True(call.ForceVision);
        Assert.True(call.RequireVision);
        Assert.Null(call.ModelOverride);
        // Forme éprouvée : prompt système vide, consigne brute. Un prompt français + schéma typé fait rendre
        // « un JSON valide mais vide » (voir BankStatementVisionPrompt).
        Assert.True(call.RawUserPrompt);
        Assert.Equal(BankStatementVisionPrompt.System, call.SystemPrompt);

        var dto = await SessionAsync(services, sessionId);
        Assert.Equal(nameof(BankStatementImportSessionStatus.AwaitingReview), dto.Status);
        Assert.Equal(2, dto.Extraction!.Lines.Count);
    }

    [Fact]
    public async Task An_empty_first_answer_is_retried_in_vision_without_any_schema()
    {
        var services = Services();
        var sessionId = await SeedAsync(services, StbLike(OnePageSpec()));
        // Étage 1 vide, puis étage 2 : un tableau en texte libre, analysé côté serveur.
        PipelineAnswers(EmptyJson, """
            | Date | Libellé | Débit | Crédit |
            | --- | --- | --- | --- |
            | 02/01/2026 | VIREMENT REÇU SOCIETE ALPHA |  | 2 149,079 |
            | 05/01/2026 | RÈG CHÈQUE N° 0001234 | 2 400,000 |  |
            """);

        await RunAsync(services, sessionId);

        Assert.Equal(2, _calls.Count);
        Assert.Equal(ImportModel, _calls[1].VisionModelOverride);
        Assert.True(_calls[1].ForceVision, "le second essai reste une lecture d'image, jamais un repli texte");
        Assert.Null(_calls[1].OutputSchema);

        var dto = await SessionAsync(services, sessionId);
        Assert.Equal(2, dto.Extraction!.Lines.Count);
        Assert.Equal(BankStatementPageReadingEngines.VisionImportTable, dto.Extraction.AiPlan!.PageReadings!.Single().Engine);
    }

    [Fact]
    public async Task Two_empty_answers_block_the_statement_without_ever_calling_the_text_model()
    {
        var services = Services();
        var sessionId = await SeedAsync(services, StbLike(OnePageSpec()));
        PipelineAnswers(EmptyJson, EmptyJson);

        await RunAsync(services, sessionId);

        Assert.Equal(2, _calls.Count);
        Assert.All(_calls, c => Assert.True(c.ForceVision, "aucun appel ne doit partir sans l'image"));

        var dto = await SessionAsync(services, sessionId);
        Assert.False(dto.CanConfirm);
        Assert.Empty(dto.Extraction!.Lines);
        // Les deux essais vision ayant échoué et le repli texte étant éteint, la page est « non lue ».
        var blocking = Assert.Single(dto.Extraction.Issues,
            i => i.Severity == StatementIssueSeverity.Blocking && i.Code == StatementIssueCodes.AiPageFailed);
        Assert.Contains("ne peut pas être enregistré", blocking.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("table_not_recognized", blocking.Message, StringComparison.OrdinalIgnoreCase);
        // Le motif technique reste dans les journaux, jamais dans le message montré à l'utilisateur.
        Assert.DoesNotContain("json_empty", blocking.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(ImportModel, blocking.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task The_text_fallback_runs_only_when_the_troubleshooting_switch_is_on()
    {
        var services = Services(textFallback: true);
        var sessionId = await SeedAsync(services, StbLike(OnePageSpec()));
        PipelineAnswers(EmptyJson, EmptyJson, TwoOperations);

        await RunAsync(services, sessionId);

        Assert.Equal(3, _calls.Count);
        Assert.False(_calls[2].ForceVision, "l'étage de dépannage est le seul appel sans image");

        var dto = await SessionAsync(services, sessionId);
        Assert.Equal(BankStatementPageReadingEngines.TextModel, dto.Extraction!.AiPlan!.PageReadings!.Single().Engine);
    }

    [Fact]
    public async Task The_legacy_french_prompt_stays_reachable_as_a_single_pass()
    {
        var services = Services(legacyGenericPrompt: true);
        var sessionId = await SeedAsync(services, StbLike(OnePageSpec()));
        PipelineAnswers(TwoOperations);

        await RunAsync(services, sessionId);

        var call = Assert.Single(_calls);
        Assert.Equal(BankStatementAiPrompt.System, call.SystemPrompt);
        Assert.NotNull(call.OutputSchema);
    }

    [Fact]
    public async Task A_glm_ocr_model_keeps_its_own_two_stage_ladder()
    {
        var services = Services(glmOcr: true);
        var sessionId = await SeedAsync(services, StbLike(OnePageSpec()));
        PipelineAnswers(TwoOperations);

        await RunAsync(services, sessionId);

        var dto = await SessionAsync(services, sessionId);
        Assert.Equal(BankStatementPageReadingEngines.GlmOcr, dto.Extraction!.AiPlan!.PageReadings!.Single().Engine);
        Assert.Equal(2, dto.Extraction.Lines.Count);
    }
}
