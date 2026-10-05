using System.Text;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Services.Migration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Migration;

/// <summary>
/// Migration assistée (N1) — orchestration : analyse, mapping de colonnes (synonymes → catalogue
/// → LLM borné), mapping comptable (identité → préfixe → LLM restreint au plan local), doublons.
/// Le LLM est stubbé : les tests vérifient le contrôle programmatique des sorties (ensemble fermé,
/// abstention, repli gracieux) — jamais le modèle lui-même.
/// </summary>
public sealed class MigrationAssistantServiceTests
{
    private readonly string _dbName = $"MigrationDb_{Guid.NewGuid()}";
    private readonly TestTenantDbContextFactory _factory;
    private readonly StubExtractionPipeline _pipeline = new();

    public MigrationAssistantServiceTests()
    {
        _factory = new TestTenantDbContextFactory(_dbName);
    }

    // ── Doubles de test ─────────────────────────────────────────────────────

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

    /// <summary>Pipeline LLM stubbé : répond un JSON prédéfini (ou échoue si la réponse est null).</summary>
    private sealed class StubExtractionPipeline : IAiStructuredExtractionPipeline
    {
        private readonly Func<string, string?> _responder;

        /// <summary>Dernier payload texte envoyé au « modèle » (null si jamais appelé).</summary>
        public string? LastPayload { get; private set; }

        public int CallCount { get; private set; }

        public StubExtractionPipeline(Func<string, string?>? responder = null)
            => _responder = responder ?? (_ => null);

        public Task<Result<AiStructuredExtractionOutcome>> RunAsync(
            AiStructuredExtractionRequest request, CancellationToken cancellationToken)
        {
            CallCount++;
            using var reader = new StreamReader(request.FileStream, Encoding.UTF8);
            LastPayload = reader.ReadToEnd();
            var raw = _responder(LastPayload);
            if (raw is null)
            {
                return Task.FromResult(Result.Failure<AiStructuredExtractionOutcome>(
                    Error.Validation("MigrationAssistant", "Modèle indisponible (stub).")));
            }
            return Task.FromResult(Result.Success(new AiStructuredExtractionOutcome(
                raw,
                new AiDocumentExtractionResult { Success = true, Format = "txt", Text = LastPayload },
                false, "stub-model", false, 0, null)));
        }

        public Task<ParsedModelRef> ResolveModelRefAsync(string? explicitModel, CancellationToken cancellationToken)
            => Task.FromResult(new ParsedModelRef(LlmProviderKind.Ollama, "stub", "ollama:stub"));

        public string? ResolveVisionModelId() => null;

        public Task<string?> ResolveEffectiveVisionModelIdAsync(string? modelOverride, CancellationToken cancellationToken = default)
            => Task.FromResult<string?>(null);

        public Task<InvoiceImportWarmUpResult> WarmUpAsync(CancellationToken cancellationToken)
            => Task.FromResult(new InvoiceImportWarmUpResult(true, true, "stub", null, null, null));
    }

    private MigrationAssistantService BuildService(Func<string, string?>? responder = null)
        => new(_factory,
            responder is null ? _pipeline : new StubExtractionPipeline(responder),
            Options.Create(new MigrationAiSettings { Enabled = true }),
            NullLogger<MigrationAssistantService>.Instance);

    private static byte[] Csv(string content) => Encoding.UTF8.GetBytes(content);

    private void SeedChart(params string[] accounts)
    {
        using var ctx = _factory.CreateContext();
        foreach (var a in accounts)
            ctx.ChartOfAccounts.Add(ChartOfAccount.Create(a, $"Compte {a}", int.Parse(a[..1]), null, AccountNatureType.Debit).Value);
        ctx.SaveChanges();
    }

    private void SeedClient(string name, string? nif = null)
    {
        using var ctx = _factory.CreateContext();
        var address = Address.Create("1 rue de Test", "Tunis", "Tunis").Value;
        var email = Email.Create($"contact-{Guid.NewGuid():N}@test.tn").Value;
        // NIF obligatoire pour un client professionnel : généré si non fourni (format TN valide).
        var nifVo = NIF.Create(nif ?? $"{Random.Shared.Next(1000000, 9999999)}/A/M/P/000").Value;
        ctx.Clients.Add(Client.Create(name, ClientType.Business, address, email, nifVo).Value);
        ctx.SaveChanges();
    }

    // ── M0 : analyse ────────────────────────────────────────────────────────

    [Fact]
    public async Task Analyze_SageChart_DetectedByCatalog()
    {
        var content = Csv("CG_NUM;CG_INTITC;CG_CLASSE\n411000;Clients;4\n");

        var r = await BuildService().AnalyzeAsync("plan.csv", content, default);

        Assert.True(r.IsSuccess);
        Assert.Equal(MigrationSourceSystem.SageLigne100, r.Value.DetectedSource);
        Assert.Equal(ReferenceImportTarget.ChartOfAccounts, r.Value.SuggestedTarget);
        Assert.True(r.Value.KnownFormatMatched);
        Assert.Equal(1, r.Value.SampleRowCount);
        Assert.Equal(0, _pipeline.CallCount); // fingerprint = 100 % déterministe
    }

    [Fact]
    public async Task Analyze_EmptyFile_Fails()
    {
        var r = await BuildService().AnalyzeAsync("vide.csv", Array.Empty<byte>(), default);
        Assert.True(r.IsFailure);
    }

    // ── M1 : mapping de colonnes ────────────────────────────────────────────

    [Fact]
    public async Task ColumnMapping_CanonicalHeaders_ResolvedBySynonyms_WithoutModel()
    {
        var content = Csv("compte;libelle;classe;nature\n6132;Loyer;6;debit\n");

        var r = await BuildService().SuggestColumnMappingAsync(content, JournalImportFormat.Csv, ReferenceImportTarget.ChartOfAccounts, default);

        Assert.True(r.IsSuccess);
        Assert.True(r.Value.Complete);
        Assert.All(r.Value.Items, i => Assert.Equal(MigrationSuggestionOrigin.Synonyme, i.Origin));
        Assert.Equal(0, _pipeline.CallCount); // jamais de LLM quand le déterministe suffit
    }

    [Fact]
    public async Task ColumnMapping_SageHeaders_ResolvedByCatalog_WithoutModel()
    {
        var content = Csv("CG_NUM;CG_INTITC;CG_CLASSE\n411000;Clients;4\n");

        var r = await BuildService().SuggestColumnMappingAsync(content, JournalImportFormat.Csv, ReferenceImportTarget.ChartOfAccounts, default);

        Assert.True(r.IsSuccess);
        Assert.True(r.Value.Complete);
        Assert.Contains(r.Value.Items, i => i.SourceColumn == "CG_NUM" && i.CanonicalColumn == "compte" && i.Origin == MigrationSuggestionOrigin.Catalogue);
        Assert.Equal(0, _pipeline.CallCount);
    }

    [Fact]
    public async Task ColumnMapping_UnknownHeader_UsesModel_WithinClosedSet()
    {
        var service = BuildService(_ => """{"mappings":[{"source":"SENS_COMPTE","target":"nature","confidence":0.9}]}""");
        var content = Csv("compte;libelle;classe;SENS_COMPTE\n6132;Loyer;6;D\n");

        var r = await service.SuggestColumnMappingAsync(content, JournalImportFormat.Csv, ReferenceImportTarget.ChartOfAccounts, default);

        Assert.True(r.IsSuccess);
        Assert.True(r.Value.Complete);
        var ia = Assert.Single(r.Value.Items, i => i.SourceColumn == "SENS_COMPTE");
        Assert.Equal("nature", ia.CanonicalColumn);
        Assert.Equal(MigrationSuggestionOrigin.Ia, ia.Origin);
    }

    [Fact]
    public async Task ColumnMapping_ModelProposingTargetOutsideClosedSet_IsRejected()
    {
        var service = BuildService(_ => """{"mappings":[{"source":"BIZARRE","target":"colonne_inventee","confidence":0.99}]}""");
        var content = Csv("compte;libelle;classe;BIZARRE\n6132;Loyer;6;x\n");

        var r = await service.SuggestColumnMappingAsync(content, JournalImportFormat.Csv, ReferenceImportTarget.ChartOfAccounts, default);

        Assert.True(r.IsSuccess);
        var item = Assert.Single(r.Value.Items, i => i.SourceColumn == "BIZARRE");
        Assert.Null(item.CanonicalColumn); // rejet programmatique — aucune invention possible
        Assert.True(r.Value.Complete);     // les obligatoires restent couvertes par le déterministe
    }

    [Fact]
    public async Task ColumnMapping_DuplicateCanonical_IsDemotedWithWarning()
    {
        var content = Csv("compte;numero;libelle;classe\n6132;6132;Loyer;6\n");

        var r = await BuildService().SuggestColumnMappingAsync(content, JournalImportFormat.Csv, ReferenceImportTarget.ChartOfAccounts, default);

        Assert.True(r.IsSuccess);
        var mapped = r.Value.Items.Where(i => i.CanonicalColumn == "compte").ToList();
        Assert.Single(mapped);
        Assert.Contains(r.Value.Warnings, w => w.Contains("déjà couverte"));
    }

    [Fact]
    public async Task ColumnMapping_ModelFailure_DegradesGracefully()
    {
        var service = BuildService(_ => null); // modèle indisponible
        var content = Csv("compte;libelle;classe;INCONNUE\n6132;Loyer;6;x\n");

        var r = await service.SuggestColumnMappingAsync(content, JournalImportFormat.Csv, ReferenceImportTarget.ChartOfAccounts, default);

        Assert.True(r.IsSuccess); // pas d'erreur : dégradation gracieuse, mapping manuel possible
        Assert.True(r.Value.Complete);
        Assert.Contains(r.Value.Warnings, w => w.Contains("manuel"));
    }

    // ── M2 : mapping comptable ──────────────────────────────────────────────

    [Fact]
    public async Task AccountMapping_ExistingAccount_ResolvedByIdentity()
    {
        SeedChart("6132", "4111");
        var content = Csv("compte;libelle;classe\n6132;Loyers;6\n4111;Clients;4\n");

        var r = await BuildService().SuggestAccountMappingAsync(content, JournalImportFormat.Csv, null, default);

        Assert.True(r.IsSuccess);
        Assert.Equal(2, r.Value.ResolvedWithoutModel);
        Assert.All(r.Value.Items, i =>
        {
            Assert.Equal(MigrationSuggestionOrigin.Identite, i.Origin);
            Assert.Equal(i.SourceAccount, i.TargetAccount);
        });
        Assert.Equal(0, _pipeline.CallCount);
    }

    [Fact]
    public async Task AccountMapping_SubAccount_ResolvedByPrefix()
    {
        SeedChart("6132");
        var content = Csv("compte;libelle;classe\n613200;Loyers bureaux;6\n");

        var r = await BuildService().SuggestAccountMappingAsync(content, JournalImportFormat.Csv, null, default);

        Assert.True(r.IsSuccess);
        var item = Assert.Single(r.Value.Items);
        Assert.Equal("6132", item.TargetAccount);
        Assert.Equal(MigrationSuggestionOrigin.Prefixe, item.Origin);
        Assert.Equal(1, r.Value.ResolvedWithoutModel);
        Assert.Equal(0, _pipeline.CallCount);
    }

    [Fact]
    public async Task AccountMapping_Prefix_RequiresSameClass()
    {
        SeedChart("4132"); // classe 4 ≠ source classe 6 : aucun préfixe valide
        var content = Csv("compte;libelle;classe\n613200;Loyers bureaux;6\n");

        var r = await BuildService(_ => """{"mappings":[]}""").SuggestAccountMappingAsync(content, JournalImportFormat.Csv, null, default);

        Assert.True(r.IsSuccess);
        var item = Assert.Single(r.Value.Items);
        Assert.Null(item.TargetAccount); // abstention — pas de rattachement cross-classe déterministe
    }

    [Fact]
    public async Task AccountMapping_Model_IsRestrictedToLocalPlan()
    {
        SeedChart("6132");
        var service = BuildService(_ => """{"mappings":[{"source":"617100","target":"6132","confidence":0.8,"justification":"Charges locatives"},{"source":"617100","target":"9999","confidence":0.9},{"source":"999999","target":"6132","confidence":0.9}]}""");
        var content = Csv("compte;libelle;classe\n617100;Locations diverses;6\n");

        var r = await service.SuggestAccountMappingAsync(content, JournalImportFormat.Csv, null, default);

        Assert.True(r.IsSuccess);
        var item = Assert.Single(r.Value.Items, i => i.SourceAccount == "617100");
        Assert.Equal("6132", item.TargetAccount);
        Assert.Equal(MigrationSuggestionOrigin.Ia, item.Origin);
        // « 9999 » (hors plan) et « 999999 » (source inventée) sont écartés par le contrôle programmatique.
    }

    [Fact]
    public async Task AccountMapping_ModelAbstains_AccountLeftUnmapped()
    {
        SeedChart("6132");
        var service = BuildService(_ => """{"mappings":[{"source":"617100","target":null,"confidence":0.2}]}""");
        var content = Csv("compte;libelle;classe\n617100;Locations diverses;6\n");

        var r = await service.SuggestAccountMappingAsync(content, JournalImportFormat.Csv, null, default);

        Assert.True(r.IsSuccess);
        Assert.Equal(1, r.Value.Abstained);
        Assert.All(r.Value.Items, i => Assert.Null(i.TargetAccount));
    }

    [Fact]
    public async Task AccountMapping_ModelFailure_AllUnresolvedAbstainWithWarning()
    {
        SeedChart("6132");
        var service = BuildService(_ => null);
        var content = Csv("compte;libelle;classe\n617100;Locations diverses;6\n");

        var r = await service.SuggestAccountMappingAsync(content, JournalImportFormat.Csv, null, default);

        Assert.True(r.IsSuccess);
        Assert.Equal(1, r.Value.Abstained);
        Assert.Contains(r.Value.Warnings, w => w.Contains("manuel"));
    }

    [Fact]
    public async Task AccountMapping_ChainsValidatedColumnMapping()
    {
        SeedChart("6132");
        // Fichier Sage brut + mapping de colonnes validé par l'utilisateur (étape M1).
        var content = Csv("CG_NUM;CG_INTITC\n6132;Loyers\n");
        var columnMapping = new Dictionary<string, string> { ["CG_NUM"] = "compte", ["CG_INTITC"] = "libelle" };

        var r = await BuildService().SuggestAccountMappingAsync(content, JournalImportFormat.Csv, columnMapping, default);

        Assert.True(r.IsSuccess);
        var item = Assert.Single(r.Value.Items);
        Assert.Equal("6132", item.TargetAccount);
        Assert.Equal(MigrationSuggestionOrigin.Identite, item.Origin);
    }

    [Fact]
    public async Task AccountMapping_UnreadableFile_Fails()
    {
        var content = Csv("colonne_x;colonne_y\n1;2\n");

        var r = await BuildService().SuggestAccountMappingAsync(content, JournalImportFormat.Csv, null, default);

        Assert.True(r.IsFailure);
    }

    // ── M3 : doublons de tiers ──────────────────────────────────────────────

    [Fact]
    public async Task Duplicates_DetectsAgainstExistingClient_ByNif()
    {
        SeedClient("STE Alpha SARL", nif: "1234567/A/M/P/000");
        var content = Csv("type;nom;email;rue;ville;gouvernorat;nif\nclient;Alpha;alpha@test.tn;1 rue A;Tunis;Tunis;1234567/A/M/P/000\n");

        var r = await BuildService().DetectThirdPartyDuplicatesAsync(content, JournalImportFormat.Csv, default);

        Assert.True(r.IsSuccess);
        Assert.Equal(1, r.Value.ImportedCount);
        var pair = Assert.Single(r.Value.Pairs);
        Assert.Equal(1.0, pair.Score);
        Assert.Equal("client", pair.ExistingOrigin);
        Assert.Equal("STE Alpha SARL", pair.ExistingName);
    }

    [Fact]
    public async Task Duplicates_InternalToFile_AreFlagged()
    {
        var content = Csv("type;nom;email;rue;ville;gouvernorat\nclient;STE Beta;beta@test.tn;1 rue B;Tunis;Tunis\nfournisseur;Beta;beta2@test.tn;2 rue B;Tunis;Tunis\n");

        var r = await BuildService().DetectThirdPartyDuplicatesAsync(content, JournalImportFormat.Csv, default);

        Assert.True(r.IsSuccess);
        Assert.Single(r.Value.Pairs);
        Assert.Equal("fichier", r.Value.Pairs[0].ExistingOrigin);
    }

    [Fact]
    public async Task Duplicates_NoMatch_ReturnsEmptyPairs()
    {
        SeedClient("Gamma Unique");
        var content = Csv("type;nom;email;rue;ville;gouvernorat\nclient;Zeta Autre;zeta@test.tn;1 rue Z;Sfax;Sfax\n");

        var r = await BuildService().DetectThirdPartyDuplicatesAsync(content, JournalImportFormat.Csv, default);

        Assert.True(r.IsSuccess);
        Assert.Empty(r.Value.Pairs);
    }

    // ── Transformation : fichier source → CSV canonique ─────────────────────

    [Fact]
    public async Task Transform_SageFile_ProducesCanonicalCsv()
    {
        var content = Csv("CG_NUM;CG_INTITC;CG_CLASSE;IGNORED\n411000;Clients;4;x\n613200;Loyers;6;y\n");
        var mapping = new Dictionary<string, string>
        {
            ["CG_NUM"] = "compte", ["CG_INTITC"] = "libelle", ["CG_CLASSE"] = "classe"
        };

        var r = await BuildService().ApplyColumnMappingAsync(
            content, JournalImportFormat.Csv, ReferenceImportTarget.ChartOfAccounts, mapping, default);

        Assert.True(r.IsSuccess);
        var csv = Encoding.UTF8.GetString(r.Value);
        Assert.StartsWith("compte;libelle;classe", csv.TrimStart('\uFEFF'));
        Assert.Contains("411000;Clients;4", csv);
        Assert.Contains("613200;Loyers;6", csv);
        Assert.DoesNotContain("IGNORED", csv); // colonne non mappée écartée
    }

    [Fact]
    public async Task Transform_MissingRequiredCanonical_Fails()
    {
        var content = Csv("CG_NUM;CG_INTITC\n411000;Clients\n");
        var mapping = new Dictionary<string, string> { ["CG_NUM"] = "compte", ["CG_INTITC"] = "libelle" };
        // « classe » obligatoire non mappée.

        var r = await BuildService().ApplyColumnMappingAsync(
            content, JournalImportFormat.Csv, ReferenceImportTarget.ChartOfAccounts, mapping, default);

        Assert.True(r.IsFailure);
        Assert.Contains("classe", r.Error.Description);
    }

    [Fact]
    public async Task Transform_UnknownCanonical_Fails()
    {
        var content = Csv("CG_NUM;CG_INTITC\n411000;Clients\n");
        var mapping = new Dictionary<string, string> { ["CG_NUM"] = "compte_invente" };

        var r = await BuildService().ApplyColumnMappingAsync(
            content, JournalImportFormat.Csv, ReferenceImportTarget.ChartOfAccounts, mapping, default);

        Assert.True(r.IsFailure);
        Assert.Contains("inconnue", r.Error.Description);
    }

    /// <summary>
    /// Garde-fou de non-régression : le CSV canonique produit par la transformation DOIT être
    /// accepté tel quel par le pipeline d'import existant (preview), sans aucune retouche.
    /// </summary>
    [Fact]
    public async Task Transform_Output_IsAcceptedByExistingImportPipeline()
    {
        var content = Csv("CG_NUM;CG_INTITC;CG_CLASSE\n411000;Clients;4\n");
        var mapping = new Dictionary<string, string>
        {
            ["CG_NUM"] = "compte", ["CG_INTITC"] = "libelle", ["CG_CLASSE"] = "classe"
        };
        var service = BuildService();

        var transformed = await service.ApplyColumnMappingAsync(
            content, JournalImportFormat.Csv, ReferenceImportTarget.ChartOfAccounts, mapping, default);
        Assert.True(transformed.IsSuccess);

        // Pipeline existant, INCHANGÉ (même fabrique InMemory que ReferenceDataImportServiceTests).
        var periodService = new Mock<FactuTrust.Application.Common.Interfaces.Services.IAccountingPeriodService>();
        var importService = new FactuTrust.Infrastructure.Services.ReferenceDataImportService(
            _factory, periodService.Object,
            Options.Create(new AccountingSettings { DossierImportEnabled = true }));
        var preview = await importService.PreviewAsync(
            transformed.Value, ReferenceImportTarget.ChartOfAccounts, JournalImportFormat.Csv);

        Assert.True(preview.IsSuccess);
        Assert.True(preview.Value.CanCommit);
        Assert.Equal(1, preview.Value.ValidRows);
    }
}
