using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Application.Features.Studio.Systems;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Handler d'export d'un système Studio (PR 3.3, tranche 3.3c1) : gardes fail-closed (drapeau, tenant,
/// permission, forme de clé, système introuvable), chargement sans appel superflu (seed uniquement à la
/// demande et bornée), DTO miroir de l'exporteur, audit et logs sans contenu métier.
/// </summary>
public sealed class CustomSystemExportFeaturesTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private readonly Mock<ICustomSystemRepository> _systems = new(MockBehavior.Strict);
    private readonly Mock<ICustomEntityRepository> _entities = new(MockBehavior.Strict);
    private readonly Mock<ICustomFieldRepository> _fields = new(MockBehavior.Strict);
    private readonly Mock<ICustomFormRepository> _forms = new(MockBehavior.Strict);
    private readonly Mock<ICustomReportRepository> _reports = new(MockBehavior.Strict);
    private readonly Mock<ICustomRecordViewRepository> _views = new(MockBehavior.Strict);
    private readonly Mock<ICustomRecordRepository> _records = new(MockBehavior.Strict);
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<ILogger<ExportCustomSystemQueryHandler>> _logger = new();

    private readonly OllamaSettings _settings = new() { EnableStudioSystemExport = true, StudioExportMaxSeedRows = 200 };

    public CustomSystemExportFeaturesTests()
    {
        _currentUser.Setup(x => x.TenantId).Returns(TenantId);
        _currentUser.Setup(x => x.UserId).Returns(UserId);
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(true);
        _audit.Setup(a => a.LogAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
    }

    private ExportCustomSystemQueryHandler Handler() => new(
        _systems.Object, _entities.Object, _fields.Object, _forms.Object, _reports.Object, _views.Object, _records.Object,
        _currentUser.Object, _audit.Object, Options.Create(_settings), _logger.Object);

    private void VerifyNoRepositoryCalls()
    {
        _systems.VerifyNoOtherCalls();
        _entities.VerifyNoOtherCalls();
        _fields.VerifyNoOtherCalls();
        _forms.VerifyNoOtherCalls();
        _reports.VerifyNoOtherCalls();
        _views.VerifyNoOtherCalls();
        _records.VerifyNoOtherCalls();
    }

    // ---- Fixture : système « gestion_conges » (employes, conges + jonction) --------------------

    private sealed class Fixture
    {
        public CustomSystemDefinition System { get; } = CustomSystemDefinition.Create(
            TenantId, "gestion_conges", "Gestion des congés", "pi pi-calendar", "Suivi des congés.", null, null);

        public List<CustomEntityDefinition> Entities { get; } = new();
        public Dictionary<Guid, List<CustomFieldDefinition>> Fields { get; } = new();
        public Dictionary<Guid, List<CustomReportDefinition>> Reports { get; } = new();
        public Dictionary<Guid, List<CustomRecordViewDefinition>> Views { get; } = new();
        public Dictionary<Guid, List<CustomRecord>> Seed { get; } = new();

        public CustomEntityDefinition Employes { get; }
        public CustomEntityDefinition Conges { get; }
        public CustomEntityDefinition Junction { get; }

        public Fixture()
        {
            Employes = AddEntity("employes", "Employé", "Employés");
            AddField(Employes, "nom", "Nom", CustomFieldType.Text, required: true, sortOrder: 1);
            AddField(Employes, "service", "Service", CustomFieldType.RelationCustom, sortOrder: 2,
                optionsJson: StudioFieldJson.SerializeRelation(new RelationRefDto("custom", "services")));

            Conges = AddEntity("conges", "Congé", "Congés");
            AddField(Conges, "employe", "Employé", CustomFieldType.RelationCustom, required: true, sortOrder: 1,
                optionsJson: StudioFieldJson.SerializeRelation(new RelationRefDto("custom", "employes")));
            AddField(Conges, "debut", "Début", CustomFieldType.Date, sortOrder: 2);

            AddView(Conges, "Tous", CustomRecordViewMode.List, new RecordViewDefinition(
                new[] { new RecordViewColumn("employe"), new RecordViewColumn("debut") },
                Array.Empty<RecordViewFilter>(), Array.Empty<RecordViewSort>(), null, null), isDefault: true);

            Junction = AddEntity("employes_conges", "Participations", "Participations",
                description: "Participants — table de jonction employes ↔ conges.", kind: CustomEntityKind.Junction);
            AddField(Junction, "employe", "Employé", CustomFieldType.RelationCustom, required: true, sortOrder: 1,
                optionsJson: StudioFieldJson.SerializeRelation(new RelationRefDto("custom", "employes")));
            AddField(Junction, "conge", "Congé", CustomFieldType.RelationCustom, required: true, sortOrder: 2,
                optionsJson: StudioFieldJson.SerializeRelation(new RelationRefDto("custom", "conges")));

            Seed[Employes.Id] = new List<CustomRecord> { CustomRecord.Create(TenantId, Employes.Id, """{"nom":"Dupont"}""", null) };
            Seed[Conges.Id] = new List<CustomRecord>();
        }

        public CustomEntityDefinition AddEntity(string key, string name, string plural, string? description = null,
            CustomEntityKind kind = CustomEntityKind.Standard)
        {
            var entity = CustomEntityDefinition.Create(TenantId, key, name, plural, "pi pi-table", description, null, System.Id, kind);
            Entities.Add(entity);
            Fields[entity.Id] = new List<CustomFieldDefinition>();
            Reports[entity.Id] = new List<CustomReportDefinition>();
            Views[entity.Id] = new List<CustomRecordViewDefinition>();
            return entity;
        }

        public CustomFieldDefinition AddField(CustomEntityDefinition entity, string key, string label, CustomFieldType type,
            bool required = false, int sortOrder = 0, string? optionsJson = null)
        {
            var field = CustomFieldDefinition.Create(TenantId, entity.Id, key, label, type, required, false, sortOrder, null, optionsJson, null, null);
            Fields[entity.Id].Add(field);
            return field;
        }

        public CustomReportDefinition AddReport(CustomEntityDefinition entity, string key, string name, CustomReportDataSourceKind kind)
        {
            var report = CustomReportDefinition.Create(TenantId, key, name, kind, entity.Key,
                ReportDefinitionJson.Serialize(new ReportDefinition { Grouping = new[] { "debut" } }), null);
            Reports[entity.Id].Add(report);
            return report;
        }

        public void AddView(CustomEntityDefinition entity, string name, CustomRecordViewMode mode, RecordViewDefinition definition, bool isDefault = false)
        {
            Views[entity.Id].Add(CustomRecordViewDefinition.Create(TenantId, entity.Id, $"v_{Views[entity.Id].Count}", name, mode,
                RecordViewDefinitionJson.Serialize(definition), isDefault, null));
        }
    }

    /// <summary>Câble les dépôts Strict pour un export complet de la fixture (seed câblée séparément).</summary>
    private Fixture SetupLoadedSystem()
    {
        var f = new Fixture();
        _systems.Setup(s => s.GetByKeyAsync(TenantId, f.System.Key, It.IsAny<CancellationToken>())).ReturnsAsync(f.System);
        _entities.Setup(e => e.ListBySystemIdAsync(TenantId, f.System.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync((IReadOnlyList<CustomEntityDefinition>)f.Entities);

        foreach (var entity in f.Entities)
        {
            _fields.Setup(r => r.ListByEntityAsync(TenantId, entity.Id, false, It.IsAny<CancellationToken>()))
                .ReturnsAsync((IReadOnlyList<CustomFieldDefinition>)f.Fields[entity.Id]);
            if (entity.Kind != CustomEntityKind.Standard) continue;

            _forms.Setup(r => r.GetDefaultByEntityAsync(TenantId, entity.Id, It.IsAny<CancellationToken>()))
                .ReturnsAsync((CustomFormDefinition?)null);
            _reports.Setup(r => r.ListAsync(TenantId, entity.Key, It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => (IReadOnlyList<CustomReportDefinition>)f.Reports[entity.Id]);
            _views.Setup(r => r.ListByEntityAsync(TenantId, entity.Id, false, It.IsAny<CancellationToken>()))
                .ReturnsAsync((IReadOnlyList<CustomRecordViewDefinition>)f.Views[entity.Id]);
        }
        return f;
    }

    private void SetupSeed(Fixture f, int expectedMax)
    {
        foreach (var entity in f.Entities.Where(e => e.Kind == CustomEntityKind.Standard))
            _records.Setup(r => r.GetAllForReportAsync(TenantId, entity.Id, expectedMax, It.IsAny<CancellationToken>()))
                .ReturnsAsync((IReadOnlyList<CustomRecord>)f.Seed[entity.Id]);
    }

    // ---- Gardes --------------------------------------------------------------------------------

    [Fact]
    public async Task Export_when_flag_off_returns_not_found_and_touches_no_repository()
    {
        _settings.EnableStudioSystemExport = false;

        var result = await Handler().Handle(new ExportCustomSystemQuery("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
        VerifyNoRepositoryCalls();
    }

    [Fact]
    public async Task Export_without_tenant_returns_unauthorized()
    {
        _currentUser.Setup(x => x.TenantId).Returns((Guid?)null);

        var result = await Handler().Handle(new ExportCustomSystemQuery("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Unauthorized", result.Error.Code);
        VerifyNoRepositoryCalls();
    }

    [Fact]
    public async Task Export_without_design_permission_returns_unauthorized()
    {
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(false);

        var result = await Handler().Handle(new ExportCustomSystemQuery("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Unauthorized", result.Error.Code);
        _currentUser.Verify(x => x.HasPermission(Permissions.Studio.DesignEntities), Times.Once);
        VerifyNoRepositoryCalls();
    }

    [Fact]
    public async Task Export_invalid_key_shape_returns_validation_error()
    {
        var result = await Handler().Handle(new ExportCustomSystemQuery("Bad Key!"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.key", result.Error.Code);
        VerifyNoRepositoryCalls();
    }

    [Fact]
    public async Task Export_unknown_key_returns_custom_system_not_found()
    {
        _systems.Setup(s => s.GetByKeyAsync(TenantId, "monsys", It.IsAny<CancellationToken>()))
            .ReturnsAsync((CustomSystemDefinition?)null);

        var result = await Handler().Handle(new ExportCustomSystemQuery("  MonSys "), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("CustomSystem.NotFound", result.Error.Code);
        _systems.Verify(s => s.GetByKeyAsync(TenantId, "monsys", It.IsAny<CancellationToken>()), Times.Once);
        _entities.VerifyNoOtherCalls();
    }

    // ---- Chargement et seed --------------------------------------------------------------------

    [Fact]
    public async Task Export_without_seed_never_calls_record_repository()
    {
        var f = SetupLoadedSystem();

        var result = await Handler().Handle(new ExportCustomSystemQuery(f.System.Key), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.IncludesSeed);
        Assert.Null(result.Value.Spec["seed"]);
        _records.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Export_with_seed_uses_clamped_max_rows_setting()
    {
        var f = SetupLoadedSystem();
        _settings.StudioExportMaxSeedRows = 5000;
        SetupSeed(f, expectedMax: 200);

        var result = await Handler().Handle(new ExportCustomSystemQuery(f.System.Key, IncludeSeed: true), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.IncludesSeed);
        _records.Verify(r => r.GetAllForReportAsync(TenantId, f.Employes.Id, 200, It.IsAny<CancellationToken>()), Times.Once);
        _records.Verify(r => r.GetAllForReportAsync(TenantId, f.Conges.Id, 200, It.IsAny<CancellationToken>()), Times.Once);
        _records.Verify(r => r.GetAllForReportAsync(TenantId, f.Junction.Id, It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Never);

        // Borne à zéro : la seed est demandée mais aucun dépôt d'enregistrements n'est sollicité.
        _records.Reset();
        _settings.StudioExportMaxSeedRows = 0;

        var zero = await Handler().Handle(new ExportCustomSystemQuery(f.System.Key, IncludeSeed: true), CancellationToken.None);

        Assert.True(zero.IsSuccess);
        Assert.False(zero.Value.IncludesSeed);
        _records.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Export_dto_mirrors_exporter_counts_and_warnings()
    {
        var f = SetupLoadedSystem();

        var result = await Handler().Handle(new ExportCustomSystemQuery(f.System.Key), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var dto = result.Value;
        Assert.Equal(StudioSystemSpecExporter.SpecVersion, dto.SpecVersion);
        Assert.Equal(1, dto.SpecVersion);
        Assert.Equal("gestion_conges", dto.SystemKey);
        Assert.Equal("Gestion des congés", dto.SystemDisplayName);
        Assert.Equal(2, dto.EntityCount);
        Assert.Equal(1, dto.RelationCount);
        Assert.Equal(1, dto.ViewCount);
        Assert.False(dto.IncludesSeed);
        // Relation « services » hors système ⇒ avertissement propagé par l'exporteur.
        Assert.Contains(dto.Warnings, w => w.Contains("services", StringComparison.Ordinal));
        Assert.Equal(1, dto.Spec["specVersion"]!.GetValue<int>());
        Assert.Equal("gestion_conges", dto.Spec["exportedFrom"]!["tenantSystemKey"]!.GetValue<string>());
        Assert.Equal(2, dto.Spec["entities"]!.AsArray().Count);
        Assert.Equal(1, dto.Spec["relations"]!.AsArray().Count);
    }

    [Fact]
    public async Task Export_filters_reports_to_custom_entity_kind()
    {
        var f = SetupLoadedSystem();
        f.AddReport(f.Conges, "r_existing", "Rapport ERP", CustomReportDataSourceKind.ExistingSource);
        f.AddReport(f.Conges, "r_custom", "Congés par date", CustomReportDataSourceKind.CustomEntity);

        var result = await Handler().Handle(new ExportCustomSystemQuery(f.System.Key), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var conges = result.Value.Spec["entities"]!.AsArray().Select(e => e!.AsObject())
            .Single(e => e["ref"]!.GetValue<string>() == "conges");
        Assert.Equal("Congés par date", conges["report"]!["displayName"]!.GetValue<string>());
        // Un seul rapport CustomEntity retenu ⇒ aucun avertissement « rapport(s) supplémentaire(s) ».
        Assert.DoesNotContain(result.Value.Warnings, w => w.Contains("supplémentaire", StringComparison.Ordinal));
    }

    // ---- Audit et logs -------------------------------------------------------------------------

    [Fact]
    public async Task Export_writes_audit_with_key_include_seed_and_entity_count_only()
    {
        var f = SetupLoadedSystem();
        object? captured = null;
        _audit.Setup(a => a.LogAsync("Studio.System.Exported", "CustomSystem", f.System.Id, null, It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Callback((string _, string _, Guid? _, object? _, object? newValues, CancellationToken _) => captured = newValues)
            .Returns(Task.CompletedTask);

        var result = await Handler().Handle(new ExportCustomSystemQuery(f.System.Key), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(captured);
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(captured));
        var keys = doc.RootElement.EnumerateObject().Select(p => p.Name).OrderBy(k => k, StringComparer.Ordinal).ToArray();
        Assert.Equal(new[] { "entityCount", "includeSeed", "systemKey" }, keys);
        Assert.Equal("gestion_conges", doc.RootElement.GetProperty("systemKey").GetString());
        Assert.False(doc.RootElement.GetProperty("includeSeed").GetBoolean());
        Assert.Equal(2, doc.RootElement.GetProperty("entityCount").GetInt32());
    }

    [Fact]
    public async Task Export_log_never_contains_spec_content()
    {
        var f = SetupLoadedSystem();
        SetupSeed(f, expectedMax: 200);
        var messages = new List<string>();
        _logger.Setup(l => l.IsEnabled(It.IsAny<LogLevel>())).Returns(true);
        _logger.Setup(l => l.Log(It.IsAny<LogLevel>(), It.IsAny<EventId>(), It.IsAny<It.IsAnyType>(), It.IsAny<Exception?>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()))
            .Callback(new InvocationAction(inv => messages.Add(inv.Arguments[2].ToString() ?? string.Empty)));

        var result = await Handler().Handle(new ExportCustomSystemQuery(f.System.Key, IncludeSeed: true), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.IncludesSeed);
        Assert.NotEmpty(messages);
        Assert.All(messages, m => Assert.DoesNotContain("Dupont", m, StringComparison.Ordinal));
        Assert.All(messages, m => Assert.DoesNotContain("specVersion", m, StringComparison.Ordinal));
        Assert.Contains(messages, m => m.Contains("gestion_conges", StringComparison.Ordinal));
    }

    // ============================================================================================
    // Tranche 3.3c2 — Duplication « (copie) » + Import : deux drapeaux fail-closed, délégation au
    // VRAI chemin de création de plan (CreateStudioAiPlanCommand capturé, jamais from-spec), nom
    // borné, avertissements d'export fusionnés, audit avec clés exactes.
    // ============================================================================================

    private readonly Mock<IMediator> _mediator = new(MockBehavior.Strict);
    private ExportCustomSystemQuery? _capturedExport;
    private CreateStudioAiPlanCommand? _capturedCreate;
    private StudioAiPlanDto? _createdPlan;
    private object? _capturedAudit;

    private OllamaSettings PlanSettings()
    {
        _settings.EnableStudioAiPlanPreview = true;
        return _settings;
    }

    private DuplicateCustomSystemCommandHandler DuplicateHandler() => new(
        _mediator.Object, _currentUser.Object, Options.Create(PlanSettings()), _audit.Object, customEntities: null);

    private ImportCustomSystemCommandHandler ImportHandler() => new(
        _mediator.Object, _currentUser.Object, Options.Create(PlanSettings()), _audit.Object, customEntities: null);

    /// <summary>Export de la fixture par l'exporteur pur (sans dépôt), sous forme de DTO d'export.</summary>
    private static StudioSystemExportDto ExportDtoOf(Fixture f)
    {
        var fields = f.Fields.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<CustomFieldDefinition>)kv.Value);
        var forms = f.Entities.ToDictionary(e => e.Id, _ => (CustomFormDefinition?)null);
        var reports = f.Reports.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<CustomReportDefinition>)kv.Value);
        var views = f.Views.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<CustomRecordViewDefinition>)kv.Value);
        var exportedAt = new DateTime(2026, 9, 15, 12, 0, 0, DateTimeKind.Utc);
        var result = StudioSystemSpecExporter.Export(
            new StudioSystemExportInput(f.System, f.Entities, fields, forms, reports, views), 200, exportedAt);
        return new StudioSystemExportDto(StudioSystemSpecExporter.SpecVersion, f.System.Key, f.System.DisplayName, exportedAt,
            result.EntityCount, result.RelationCount, result.ViewCount, result.IncludesSeed, result.Warnings, result.Spec);
    }

    private void SetupExportSend(Result<StudioSystemExportDto> reply)
    {
        _mediator.Setup(m => m.Send(It.IsAny<ExportCustomSystemQuery>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result<StudioSystemExportDto>> q, CancellationToken _) => _capturedExport = (ExportCustomSystemQuery)q)
            .ReturnsAsync(reply);
    }

    private void SetupCreateSend()
    {
        _mediator.Setup(m => m.Send(It.IsAny<CreateStudioAiPlanCommand>(), It.IsAny<CancellationToken>()))
            .Returns((IRequest<Result<StudioAiPlanDto>> c, CancellationToken _) =>
            {
                _capturedCreate = (CreateStudioAiPlanCommand)c;
                var now = DateTime.UtcNow;
                _createdPlan = new StudioAiPlanDto(Guid.NewGuid(), _capturedCreate.Kind.ToString(), StudioAiPlanStatus.Pending.ToString(),
                    _capturedCreate.SummaryJson, null, null, now, now.AddMinutes(60), null);
                return Task.FromResult(Result.Success(_createdPlan));
            });
    }

    private Fixture SetupDuplicate()
    {
        var f = new Fixture();
        SetupExportSend(Result.Success(ExportDtoOf(f)));
        SetupCreateSend();
        return f;
    }

    private static JsonObject SpecJson(CreateStudioAiPlanCommand cmd) => JsonNode.Parse(cmd.SpecJson)!.AsObject();

    /// <summary>Capture les <c>newValues</c> de l'audit <paramref name="action"/> dans <see cref="_capturedAudit"/>.</summary>
    private void CaptureAudit(string action) =>
        _audit.Setup(a => a.LogAsync(action, "CustomSystem", null, null, It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Callback((string _, string _, Guid? _, object? _, object? newValues, CancellationToken _) => _capturedAudit = newValues)
            .Returns(Task.CompletedTask);

    private static string[] Keys(JsonElement obj) =>
        obj.EnumerateObject().Select(p => p.Name).OrderBy(k => k, StringComparer.Ordinal).ToArray();

    // ---- Duplication : gardes ------------------------------------------------------------------

    [Fact]
    public async Task Duplicate_when_export_flag_off_is_not_found_and_sends_nothing()
    {
        _settings.EnableStudioSystemExport = false;

        var result = await DuplicateHandler().Handle(new DuplicateCustomSystemCommand("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Duplicate_when_plan_preview_flag_off_is_not_found()
    {
        var handler = DuplicateHandler();
        _settings.EnableStudioAiPlanPreview = false;

        var result = await handler.Handle(new DuplicateCustomSystemCommand("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Duplicate_without_design_permission_is_unauthorized()
    {
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(false);

        var result = await DuplicateHandler().Handle(new DuplicateCustomSystemCommand("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Unauthorized", result.Error.Code);
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Duplicate_propagates_custom_system_not_found_from_export()
    {
        SetupExportSend(Result.Failure<StudioSystemExportDto>(new Error("CustomSystem.NotFound", "CustomSystem with key 'x' was not found.")));

        var result = await DuplicateHandler().Handle(new DuplicateCustomSystemCommand("x"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("CustomSystem.NotFound", result.Error.Code);
        _mediator.Verify(m => m.Send(It.IsAny<CreateStudioAiPlanCommand>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Duplicate_requests_export_without_seed()
    {
        SetupDuplicate();

        var result = await DuplicateHandler().Handle(new DuplicateCustomSystemCommand("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(_capturedExport);
        Assert.Equal("gestion_conges", _capturedExport!.Key);
        Assert.False(_capturedExport.IncludeSeed);
    }

    // ---- Duplication : nom, résumé, réponse, audit --------------------------------------------

    [Fact]
    public async Task Duplicate_default_name_is_display_name_plus_copie_suffix()
    {
        SetupDuplicate();

        var result = await DuplicateHandler().Handle(new DuplicateCustomSystemCommand("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(_capturedCreate);
        Assert.Equal(StudioAiPlanKind.CreateSystem, _capturedCreate!.Kind);
        Assert.Equal("Gestion des congés (copie)", SpecJson(_capturedCreate)["system"]!["displayName"]!.GetValue<string>());
    }

    [Fact]
    public async Task Duplicate_copy_name_is_truncated_to_128_characters()
    {
        var f = new Fixture();
        var longName = new string('N', StudioAiPlanCreation.MaxDisplayNameOverrideLength);
        SetupExportSend(Result.Success(ExportDtoOf(f) with { SystemDisplayName = longName }));
        SetupCreateSend();

        var result = await DuplicateHandler().Handle(new DuplicateCustomSystemCommand("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var name = SpecJson(_capturedCreate!)["system"]!["displayName"]!.GetValue<string>();
        Assert.Equal(128, name.Length);
        Assert.EndsWith(StudioSystemCopyNaming.CopySuffix, name, StringComparison.Ordinal);
        Assert.Equal(128, StudioSystemCopyNaming.CopyName(longName).Length);
    }

    [Fact]
    public async Task Duplicate_override_replaces_copy_name_and_is_bounded()
    {
        SetupDuplicate();

        var tooLong = await DuplicateHandler().Handle(
            new DuplicateCustomSystemCommand("gestion_conges", new string('x', 129)), CancellationToken.None);

        Assert.True(tooLong.IsFailure);
        Assert.Equal("Validation.displayNameOverride", tooLong.Error.Code);
        _mediator.Verify(m => m.Send(It.IsAny<CreateStudioAiPlanCommand>(), It.IsAny<CancellationToken>()), Times.Never);

        var ok = await DuplicateHandler().Handle(
            new DuplicateCustomSystemCommand("gestion_conges", "  Congés 2027  "), CancellationToken.None);

        Assert.True(ok.IsSuccess);
        Assert.Equal("Congés 2027", SpecJson(_capturedCreate!)["system"]!["displayName"]!.GetValue<string>());
    }

    [Fact]
    public async Task Duplicate_merges_export_warnings_into_plan_summary()
    {
        var f = SetupDuplicate();
        var exportWarnings = ExportDtoOf(f).Warnings;
        Assert.NotEmpty(exportWarnings);

        var result = await DuplicateHandler().Handle(new DuplicateCustomSystemCommand("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var warnings = JsonNode.Parse(_capturedCreate!.SummaryJson)!["warnings"]!.AsArray().Select(w => w!.GetValue<string>()).ToList();
        Assert.Contains(exportWarnings[0], warnings);
    }

    [Fact]
    public async Task Duplicate_returns_plan_creation_response_with_fresh_spec()
    {
        SetupDuplicate();

        var result = await DuplicateHandler().Handle(new DuplicateCustomSystemCommand("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(_createdPlan!.Id, result.Value.Plan.Id);
        Assert.Equal(StudioAiPlanStatus.Pending.ToString(), result.Value.Plan.Status);
        Assert.Equal(_createdPlan.Id, result.Value.Spec.Id);
        Assert.Equal(_capturedCreate!.SpecJson, StudioAiSpecCanonical.Serialize(result.Value.Spec.Spec));
        Assert.Null(result.Value.Spec.Spec["exportedFrom"]);
    }

    [Fact]
    public async Task Duplicate_writes_audit_with_source_key_and_plan_id()
    {
        SetupDuplicate();
        CaptureAudit("Studio.System.DuplicateRequested");

        var result = await DuplicateHandler().Handle(new DuplicateCustomSystemCommand("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(_capturedAudit);
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(_capturedAudit));
        Assert.Equal(new[] { "planId", "sourceKey" }, Keys(doc.RootElement));
        Assert.Equal("gestion_conges", doc.RootElement.GetProperty("sourceKey").GetString());
        Assert.Equal(result.Value.Plan.Id, doc.RootElement.GetProperty("planId").GetGuid());
    }

    [Fact]
    public async Task Duplicate_when_exported_spec_exceeds_import_bounds_returns_validation_spec()
    {
        var f = new Fixture();
        for (var i = 0; i < 7; i++)
            AddTextEntity(f, $"table_{i}");
        var dto = ExportDtoOf(f);
        Assert.Equal(9, dto.EntityCount);
        SetupExportSend(Result.Success(dto));

        var result = await DuplicateHandler().Handle(new DuplicateCustomSystemCommand("gestion_conges"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.spec", result.Error.Code);
        Assert.DoesNotContain("specVersion", result.Error.Description, StringComparison.Ordinal);
        _mediator.Verify(m => m.Send(It.IsAny<CreateStudioAiPlanCommand>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private static void AddTextEntity(Fixture f, string key)
    {
        var e = f.AddEntity(key, $"Table {key}", $"Tables {key}");
        f.AddField(e, "libelle", "Libellé", CustomFieldType.Text, required: true, sortOrder: 1);
    }

    // ---- Import --------------------------------------------------------------------------------

    private static JsonObject ImportSpec() => ExportDtoOf(new Fixture()).Spec;

    [Fact]
    public async Task Import_when_flags_off_is_not_found()
    {
        var handler = ImportHandler();
        var spec = ImportSpec();

        _settings.EnableStudioSystemExport = false;
        _settings.EnableStudioAiPlanPreview = true;
        var exportOff = await handler.Handle(new ImportCustomSystemCommand(new ImportCustomSystemRequest(spec)), CancellationToken.None);
        Assert.True(exportOff.IsFailure);
        Assert.Equal("NotFound", exportOff.Error.Code);

        _settings.EnableStudioSystemExport = true;
        _settings.EnableStudioAiPlanPreview = false;
        var previewOff = await handler.Handle(new ImportCustomSystemCommand(new ImportCustomSystemRequest(spec)), CancellationToken.None);
        Assert.True(previewOff.IsFailure);
        Assert.Equal("NotFound", previewOff.Error.Code);

        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Import_null_or_non_object_spec_returns_validation_spec()
    {
        var handler = ImportHandler();

        var nullSpec = await handler.Handle(new ImportCustomSystemCommand(new ImportCustomSystemRequest(null)), CancellationToken.None);
        Assert.Equal("Validation.spec", nullSpec.Error.Code);
        Assert.Equal("La spécification est vide.", nullSpec.Error.Description);

        var number = await handler.Handle(new ImportCustomSystemCommand(new ImportCustomSystemRequest(JsonValue.Create(42))), CancellationToken.None);
        Assert.Equal("Validation.spec", number.Error.Code);
        Assert.Equal("La spécification doit être un objet JSON.", number.Error.Description);

        var broken = await handler.Handle(new ImportCustomSystemCommand(new ImportCustomSystemRequest(JsonValue.Create("["))), CancellationToken.None);
        Assert.Equal("Validation.spec", broken.Error.Code);
        Assert.Equal("La spécification n'est pas un JSON valide.", broken.Error.Description);

        var array = await handler.Handle(new ImportCustomSystemCommand(new ImportCustomSystemRequest(JsonValue.Create("[1]"))), CancellationToken.None);
        Assert.Equal("Validation.spec", array.Error.Code);
        Assert.Equal("La spécification doit être un objet JSON.", array.Error.Description);

        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Import_with_overlong_system_display_name_and_no_override_returns_validation_spec()
    {
        var spec = ImportSpec();
        spec["system"]!["displayName"] = new string('N', StudioAiPlanCreation.MaxDisplayNameOverrideLength + 1);

        var result = await ImportHandler().Handle(new ImportCustomSystemCommand(new ImportCustomSystemRequest(spec)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.spec", result.Error.Code);
        Assert.Equal("system.displayName dépasse 128 caractères.", result.Error.Description);
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Import_without_include_seed_does_not_mutate_the_caller_spec()
    {
        SetupCreateSend();
        var spec = ImportSpec();
        spec["seed"] = new JsonObject { ["conges"] = new JsonArray(new JsonObject { ["libelle"] = "x" }) };

        var result = await ImportHandler().Handle(
            new ImportCustomSystemCommand(new ImportCustomSystemRequest(spec, IncludeSeed: false)), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(spec.ContainsKey("seed"));
        Assert.False(SpecJson(_capturedCreate!).ContainsKey("seed"));
    }

    [Fact]
    public void Copy_name_never_splits_a_surrogate_pair()
    {
        var maxBase = StudioAiPlanCreation.MaxDisplayNameOverrideLength - StudioSystemCopyNaming.CopySuffix.Length;
        var name = new string('N', maxBase - 1) + "\U0001F600" + "tail"; // l'emoji (2 chars) chevauche la coupe

        var copy = StudioSystemCopyNaming.CopyName(name);

        Assert.True(copy.Length <= StudioAiPlanCreation.MaxDisplayNameOverrideLength);
        Assert.DoesNotContain(copy, c => char.IsSurrogate(c));
        Assert.EndsWith(StudioSystemCopyNaming.CopySuffix, copy, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Import_accepts_spec_given_as_json_string()
    {
        SetupCreateSend();
        var asString = JsonValue.Create(ImportSpec().ToJsonString());

        var result = await ImportHandler().Handle(new ImportCustomSystemCommand(new ImportCustomSystemRequest(asString)), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(_capturedCreate);
        Assert.Equal(StudioAiPlanKind.CreateSystem, _capturedCreate!.Kind);
        Assert.Equal("Gestion des congés", SpecJson(_capturedCreate)["system"]!["displayName"]!.GetValue<string>());
    }

    [Fact]
    public async Task Import_spec_over_256_kb_returns_validation_spec()
    {
        var spec = ImportSpec();
        spec["system"]!["description"] = new string('d', 300_000);

        var result = await ImportHandler().Handle(new ImportCustomSystemCommand(new ImportCustomSystemRequest(spec)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.spec", result.Error.Code);
        Assert.Equal("La spec dépasse 256 Ko.", result.Error.Description);
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Import_spec_version_2_returns_validation_spec_with_unsupported_message()
    {
        var spec = ImportSpec();
        spec["specVersion"] = 2;

        var result = await ImportHandler().Handle(new ImportCustomSystemCommand(new ImportCustomSystemRequest(spec)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.spec", result.Error.Code);
        Assert.Equal(string.Format(StudioAiSystemSpec.UnsupportedSpecVersionMessage, 2), result.Error.Description);
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Import_of_an_export_round_trips_to_a_pending_create_system_plan()
    {
        // Export RÉEL (handler c1 sur dépôts Strict) puis import du DTO obtenu.
        var f = SetupLoadedSystem();
        var export = await Handler().Handle(new ExportCustomSystemQuery(f.System.Key), CancellationToken.None);
        Assert.True(export.IsSuccess);
        SetupCreateSend();

        var result = await ImportHandler().Handle(
            new ImportCustomSystemCommand(new ImportCustomSystemRequest(export.Value.Spec)), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(StudioAiPlanStatus.Pending.ToString(), result.Value.Plan.Status);
        Assert.True(StudioAiSystemSpec.TryParse(export.Value.Spec.ToJsonString(), out var parsed, out _));
        Assert.Equal(StudioAiSpecCanonical.CanonicalSystem(parsed!), _capturedCreate!.SpecJson);
        var canonical = SpecJson(_capturedCreate);
        Assert.Null(canonical["exportedFrom"]);
        Assert.Null(canonical["specVersion"]);
        Assert.Equal(2, canonical["entities"]!.AsArray().Count);
    }

    [Fact]
    public async Task Import_without_include_seed_strips_seed_before_parsing()
    {
        SetupCreateSend();
        var spec = ImportSpec();
        spec["seed"] = new JsonArray(new JsonObject
        {
            ["entityRef"] = "employes",
            ["records"] = new JsonArray(new JsonObject { ["nom"] = "Dupont" })
        });

        var withSeed = await ImportHandler().Handle(
            new ImportCustomSystemCommand(new ImportCustomSystemRequest(spec.DeepClone().AsObject(), IncludeSeed: true)), CancellationToken.None);
        Assert.True(withSeed.IsSuccess);
        Assert.NotNull(SpecJson(_capturedCreate!)["seed"]);

        var withoutSeed = await ImportHandler().Handle(
            new ImportCustomSystemCommand(new ImportCustomSystemRequest(spec, IncludeSeed: false)), CancellationToken.None);
        Assert.True(withoutSeed.IsSuccess);
        Assert.Null(SpecJson(_capturedCreate!)["seed"]);
        Assert.DoesNotContain("Dupont", _capturedCreate!.SpecJson, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Import_writes_audit_with_spec_version_entity_count_include_seed_and_plan_id()
    {
        SetupCreateSend();
        CaptureAudit("Studio.System.ImportRequested");

        var result = await ImportHandler().Handle(
            new ImportCustomSystemCommand(new ImportCustomSystemRequest(ImportSpec(), IncludeSeed: false)), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(_capturedAudit);
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(_capturedAudit));
        Assert.Equal(new[] { "entityCount", "includeSeed", "planId", "specVersion" }, Keys(doc.RootElement));
        Assert.Equal(1, doc.RootElement.GetProperty("specVersion").GetInt32());
        Assert.Equal(2, doc.RootElement.GetProperty("entityCount").GetInt32());
        Assert.False(doc.RootElement.GetProperty("includeSeed").GetBoolean());
        Assert.Equal(result.Value.Plan.Id, doc.RootElement.GetProperty("planId").GetGuid());
    }
}
