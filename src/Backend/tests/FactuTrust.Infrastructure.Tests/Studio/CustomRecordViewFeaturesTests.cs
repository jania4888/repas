using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA — PR 2.3 : handlers des vues enregistrées (dépôts mockés). CRUD + audit, clé dupliquée
/// ⇒ 409, quota plan ⇒ Validation.Plan, SetDefault exclusif, Run kanban (groupes ordonnés,
/// « Sans valeur », truncated à la borne) et calendrier (fenêtre obligatoire, &gt; 92 jours ⇒ 400).
/// </summary>
public sealed class CustomRecordViewFeaturesTests
{
    private static readonly Guid Tid = Guid.NewGuid();
    private static readonly Guid EntityId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private readonly Mock<ICustomEntityRepository> _entities = new();
    private readonly Mock<ICustomFieldRepository> _fields = new();
    private readonly Mock<ICustomRecordViewRepository> _views = new();
    private readonly Mock<ICustomRecordRepository> _records = new();
    private readonly Mock<IStudioQuotaService> _quota = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<ICurrentUser> _currentUser = new();

    public CustomRecordViewFeaturesTests()
    {
        _currentUser.Setup(u => u.TenantId).Returns(Tid);
        _currentUser.Setup(u => u.UserId).Returns(UserId);

        var entity = CustomEntityDefinition.Create(Tid, "chantiers", "Chantier", "Chantiers", null, null, UserId);
        SetId(entity, EntityId);
        _entities.Setup(e => e.GetByKeyAsync(Tid, "chantiers", It.IsAny<CancellationToken>())).ReturnsAsync(entity);

        _fields.Setup(f => f.ListByEntityAsync(Tid, EntityId, false, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Fields());

        _quota.Setup(q => q.EnsureUnderLimitAsync(
                It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
    }

    private static readonly string SelectOptions = """{"options":[{"value":"encours","label":"En cours"},{"value":"termine","label":"Terminé"}]}""";

    private static IReadOnlyList<CustomFieldDefinition> Fields() => new[]
    {
        Field("nom", CustomFieldType.Text),
        Field("statut", CustomFieldType.Select, SelectOptions),
        Field("debut", CustomFieldType.Date)
    };

    private static CustomFieldDefinition Field(string key, CustomFieldType type, string? optionsJson = null) =>
        CustomFieldDefinition.Create(Tid, EntityId, key, key, type, false, false, 0, null, optionsJson, null, null);

    private static RecordViewDefinition ListDef() =>
        new(new[] { new RecordViewColumn("nom") },
            new[] { new RecordViewFilter("statut", "eq", System.Text.Json.Nodes.JsonValue.Create("encours")) },
            new[] { new RecordViewSort("createdAt", Descending: true) },
            null, null, SearchEnabled: true, PageSize: 25);

    private static RecordViewDefinition KanbanDef() =>
        new(new[] { new RecordViewColumn("nom") }, Array.Empty<RecordViewFilter>(), Array.Empty<RecordViewSort>(),
            new RecordViewKanban("statut", "nom", new[] { "nom" }, null, ShowEmptyGroup: true), null);

    private static RecordViewDefinition CalendarDef() =>
        new(new[] { new RecordViewColumn("nom") }, Array.Empty<RecordViewFilter>(), Array.Empty<RecordViewSort>(),
            null, new RecordViewCalendar("debut", null, "nom", "statut"));

    private static void SetId(CustomEntityDefinition entity, Guid id) =>
        typeof(CustomEntityDefinition).GetProperty(nameof(CustomEntityDefinition.Id))!.SetValue(entity, id);

    private CustomRecordViewDefinition View(CustomRecordViewMode mode, RecordViewDefinition def, string key = "vue1", bool isDefault = false)
    {
        var v = CustomRecordViewDefinition.Create(Tid, EntityId, key, key, mode, RecordViewDefinitionJson.Serialize(def), isDefault, UserId);
        typeof(CustomRecordViewDefinition).GetProperty(nameof(CustomRecordViewDefinition.RowVersion))!.SetValue(v, new byte[] { 0, 0, 0, 0, 0, 0, 0, 1 });
        return v;
    }

    private OllamaSettings Settings(int kanban = 500, int calendar = 1000) =>
        new() { EnableStudioRecordViews = true, StudioRecordViewMaxKanbanCards = kanban, StudioRecordViewMaxCalendarEvents = calendar };

    private CreateCustomRecordViewCommandHandler CreateHandler() =>
        new(_entities.Object, _fields.Object, _views.Object, _quota.Object, _audit.Object, _currentUser.Object);

    private RunCustomRecordViewQueryHandler RunHandler(OllamaSettings? settings = null) =>
        new(_entities.Object, _fields.Object, _views.Object, _records.Object, _currentUser.Object,
            Options.Create(settings ?? Settings()));

    /// <summary>Fabrique de l'aperçu (4.7v1) : ni vues, ni quota, ni audit — lecture seule bornée (D-47-20).</summary>
    private PreviewCustomRecordViewQueryHandler PreviewHandler(OllamaSettings? settings = null) =>
        new(_entities.Object, _fields.Object, _records.Object, _currentUser.Object,
            Options.Create(settings ?? Settings()));

    // ---- CRUD ----

    [Fact]
    public async Task Create_persists_the_view_makes_first_view_default_and_audits()
    {
        _views.Setup(v => v.KeyExistsAsync(Tid, EntityId, "encours", null, It.IsAny<CancellationToken>())).ReturnsAsync(false);
        _views.Setup(v => v.CountByEntityAsync(Tid, EntityId, It.IsAny<CancellationToken>())).ReturnsAsync(0);
        _views.Setup(v => v.AddAsync(It.IsAny<CustomRecordViewDefinition>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var handler = CreateHandler();
        var result = await handler.Handle(
            new CreateCustomRecordViewCommand("chantiers", new SaveCustomRecordViewRequest("encours", "En cours", CustomRecordViewMode.List, ListDef())),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("encours", result.Value.Key);
        Assert.True(result.Value.IsDefault); // première vue ⇒ par défaut
        _views.Verify(v => v.AddAsync(It.Is<CustomRecordViewDefinition>(x => x.IsDefault && x.Key == "encours"), It.IsAny<CancellationToken>()), Times.Once);
        _audit.Verify(a => a.LogAsync("Studio.RecordView.Created", "CustomRecordViewDefinition", It.IsAny<Guid?>(), null, It.IsAny<object>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Create_returns_409_when_the_key_is_taken()
    {
        _views.Setup(v => v.KeyExistsAsync(Tid, EntityId, "encours", null, It.IsAny<CancellationToken>())).ReturnsAsync(true);

        var handler = CreateHandler();
        var result = await handler.Handle(
            new CreateCustomRecordViewCommand("chantiers", new SaveCustomRecordViewRequest("encours", "En cours", CustomRecordViewMode.List, ListDef())),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        _views.Verify(v => v.AddAsync(It.IsAny<CustomRecordViewDefinition>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_returns_a_quota_error_when_the_plan_limit_is_reached()
    {
        _views.Setup(v => v.KeyExistsAsync(Tid, EntityId, "vue_quota", null, It.IsAny<CancellationToken>())).ReturnsAsync(false);
        _views.Setup(v => v.CountByEntityAsync(Tid, EntityId, It.IsAny<CancellationToken>())).ReturnsAsync(20);
        _quota.Setup(q => q.EnsureUnderLimitAsync(
                It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure(Error.Validation("Plan", "Limite du plan atteinte : 20 vues par table maximum.")));

        var handler = CreateHandler();
        var result = await handler.Handle(
            new CreateCustomRecordViewCommand("chantiers", new SaveCustomRecordViewRequest("vue_quota", "Vue quota", CustomRecordViewMode.List, ListDef())),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.Plan", result.Error.Code);
    }

    [Fact]
    public async Task SetDefault_clears_then_sets_and_is_exclusive()
    {
        var view = View(CustomRecordViewMode.List, ListDef());
        _views.Setup(v => v.GetByIdAsync(Tid, EntityId, view.Id, It.IsAny<CancellationToken>())).ReturnsAsync(view);

        var handler = new SetDefaultCustomRecordViewCommandHandler(_entities.Object, _views.Object, _audit.Object, _currentUser.Object);
        var result = await handler.Handle(new SetDefaultCustomRecordViewCommand("chantiers", view.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        _views.Verify(v => v.ClearDefaultAsync(Tid, EntityId, It.IsAny<CancellationToken>()), Times.Once);
        _views.Verify(v => v.UpdateAsync(It.Is<CustomRecordViewDefinition>(x => x.IsDefault), It.IsAny<CancellationToken>()), Times.Once);
        _audit.Verify(a => a.LogAsync("Studio.RecordView.DefaultSet", "CustomRecordViewDefinition", view.Id, null, It.IsAny<object>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    // ---- Run kanban ----

    [Fact]
    public async Task Run_kanban_groups_in_column_order_with_sans_valeur_and_truncates_at_the_bound()
    {
        var view = View(CustomRecordViewMode.Kanban, KanbanDef());
        _views.Setup(v => v.GetByIdAsync(Tid, EntityId, view.Id, It.IsAny<CancellationToken>())).ReturnsAsync(view);

        // 501 lignes au total mais borne 500 ⇒ truncated ; groupes dans l'ordre des options puis « Sans valeur ».
        var rows = new List<CustomRecord>
        {
            Rec("""{"nom":"t1","statut":"termine"}"""),
            Rec("""{"nom":"t2","statut":"encours"}"""),
            Rec("""{"nom":"t3"}""") // sans statut
        };
        _records.Setup(r => r.QueryAsync(It.IsAny<RecordQuerySpec>(), It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((rows, Total: 501));

        var handler = RunHandler(Settings(kanban: 500));
        var result = await handler.Handle(
            new RunCustomRecordViewQuery("chantiers", view.Id, new RunRecordViewRequest()), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var run = result.Value;
        Assert.Equal(CustomRecordViewMode.Kanban, run.Mode);
        Assert.True(run.Truncated); // 501 > 500
        Assert.NotNull(run.Groups);
        // Ordre des options : encours, termine, puis « Sans valeur ».
        Assert.Equal(new[] { "encours", "termine", null }, run.Groups!.Select(g => g.Value).ToArray());
        Assert.Equal("Sans valeur", run.Groups[^1].Label);
        Assert.Equal("t2", System.Text.Json.Nodes.JsonNode.Parse(run.Groups[0].Items.Single().Data!.ToJsonString())!["nom"]!.GetValue<string>());
        Assert.Equal("t3", run.Groups[^1].Items.Single().Data!["nom"]!.GetValue<string>());
    }

    [Fact]
    public async Task Run_kanban_completes_a_partial_column_order_with_missing_options()
    {
        // ColumnOrder partiel (option ajoutée au champ après l'enregistrement de la vue) : les fiches
        // des options omises gardent leur propre colonne — jamais reléguées dans « Sans valeur ».
        var def = KanbanDef() with
        {
            Kanban = new RecordViewKanban("statut", "nom", new[] { "nom" },
                new List<string> { "termine" }, ShowEmptyGroup: true)
        };
        var view = View(CustomRecordViewMode.Kanban, def);
        _views.Setup(v => v.GetByIdAsync(Tid, EntityId, view.Id, It.IsAny<CancellationToken>())).ReturnsAsync(view);

        var rows = new List<CustomRecord>
        {
            Rec("""{"nom":"t1","statut":"encours"}"""), // option absente du ColumnOrder
            Rec("""{"nom":"t2","statut":"termine"}""")
        };
        _records.Setup(r => r.QueryAsync(It.IsAny<RecordQuerySpec>(), It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((rows, Total: 2));

        var handler = RunHandler();
        var result = await handler.Handle(
            new RunCustomRecordViewQuery("chantiers", view.Id, new RunRecordViewRequest()), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var run = result.Value;
        // « termine » d'abord (ordre demandé), « encours » complété ensuite, aucun « Sans valeur ».
        Assert.Equal(new[] { "termine", "encours" }, run.Groups!.Select(g => g.Value).ToArray());
        Assert.Equal("t1", run.Groups[1].Items.Single().Data!["nom"]!.GetValue<string>());
    }

    // ---- Run calendrier ----

    [Fact]
    public async Task Run_calendar_requires_a_date_range_and_bounds_it_to_92_days()
    {
        var view = View(CustomRecordViewMode.Calendar, CalendarDef());
        _views.Setup(v => v.GetByIdAsync(Tid, EntityId, view.Id, It.IsAny<CancellationToken>())).ReturnsAsync(view);

        var handler = RunHandler();

        // Fenêtre absente ⇒ 400 Validation.range
        var missing = await handler.Handle(
            new RunCustomRecordViewQuery("chantiers", view.Id, new RunRecordViewRequest()), CancellationToken.None);
        Assert.True(missing.IsFailure);
        Assert.Equal("Validation.range", missing.Error.Code);

        // Fenêtre > 92 jours ⇒ 400
        var tooWide = await handler.Handle(
            new RunCustomRecordViewQuery("chantiers", view.Id,
                new RunRecordViewRequest(RangeStart: new DateOnly(2026, 1, 1), RangeEnd: new DateOnly(2026, 6, 30))),
            CancellationToken.None);
        Assert.True(tooWide.IsFailure);
        Assert.Equal("Validation.range", tooWide.Error.Code);

        _records.Verify(r => r.QueryAsync(It.IsAny<RecordQuerySpec>(), It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Run_calendar_projects_events_within_the_range()
    {
        var view = View(CustomRecordViewMode.Calendar, CalendarDef());
        _views.Setup(v => v.GetByIdAsync(Tid, EntityId, view.Id, It.IsAny<CancellationToken>())).ReturnsAsync(view);

        var rows = new List<CustomRecord>
        {
            Rec("""{"nom":"Intervention A","debut":"2026-02-10","statut":"encours"}"""),
            Rec("""{"nom":"Intervention B","debut":"2026-02-12"}""")
        };
        _records.Setup(r => r.QueryAsync(It.IsAny<RecordQuerySpec>(), It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((rows, Total: 2));

        var handler = RunHandler();
        var result = await handler.Handle(
            new RunCustomRecordViewQuery("chantiers", view.Id,
                new RunRecordViewRequest(RangeStart: new DateOnly(2026, 2, 1), RangeEnd: new DateOnly(2026, 2, 28))),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        var run = result.Value;
        Assert.False(run.Truncated);
        Assert.NotNull(run.Events);
        Assert.Equal(2, run.Events!.Count);
        Assert.Equal("Intervention A", run.Events[0].Title);
        Assert.Equal("encours", run.Events[0].ColorValue);
        Assert.Null(run.Events[1].ColorValue);
    }

    [Fact]
    public async Task Run_calendar_uses_an_exclusive_upper_bound_so_the_last_day_is_included_for_datetime()
    {
        var view = View(CustomRecordViewMode.Calendar, CalendarDef());
        _views.Setup(v => v.GetByIdAsync(Tid, EntityId, view.Id, It.IsAny<CancellationToken>())).ReturnsAsync(view);
        _records.Setup(r => r.QueryAsync(It.IsAny<RecordQuerySpec>(), It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((new List<CustomRecord>(), 0));

        var handler = RunHandler();
        var result = await handler.Handle(
            new RunCustomRecordViewQuery("chantiers", view.Id,
                new RunRecordViewRequest(RangeStart: new DateOnly(2026, 2, 1), RangeEnd: new DateOnly(2026, 2, 28))),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        // Pas de `between '2026-02-01' AND '2026-02-28'` (couperait à minuit) : gte + lt exclusif.
        _records.Verify(r => r.QueryAsync(
            It.Is<RecordQuerySpec>(s =>
                s.Filters.Any(f => f.FieldKey == "debut" && f.Op == "gte"
                    && f.Value!.GetValue<string>() == "2026-02-01")
                && s.Filters.Any(f => f.FieldKey == "debut" && f.Op == "lt"
                    && f.Value!.GetValue<string>() == "2026-03-01")
                && !s.Filters.Any(f => f.Op == "between")),
            It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    // ---- Preview (4.7v1, R3 : exécution d'une définition NON enregistrée) ----

    [Fact]
    public async Task Preview_executes_the_draft_without_persisting_anything()
    {
        var rows = new List<CustomRecord> { Rec("""{"nom":"t1","statut":"encours"}""") };
        _records.Setup(r => r.QueryAsync(It.IsAny<RecordQuerySpec>(), It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((rows, Total: 1));

        var handler = PreviewHandler();
        var result = await handler.Handle(
            new PreviewCustomRecordViewQuery("chantiers", new PreviewRecordViewRequest(CustomRecordViewMode.List, ListDef())),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        var run = result.Value;
        Assert.Equal(CustomRecordViewMode.List, run.Mode);
        Assert.Single(run.Items);
        Assert.Equal(1, run.Total);

        // Invariant R3 : lecture seule — la définition n'est ni lue ni écrite, ni quota ni audit.
        _records.Verify(r => r.QueryAsync(It.IsAny<RecordQuerySpec>(), It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()), Times.Once);
        _views.VerifyNoOtherCalls();
        _quota.VerifyNoOtherCalls();
        _audit.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Preview_returns_400_when_the_definition_fails_the_save_time_validator()
    {
        // Colonne inconnue : même validateur qu'à l'enregistrement et au run (D-47-20).
        var def = ListDef() with { Columns = new[] { new RecordViewColumn("inconnu") } };

        var handler = PreviewHandler();
        var result = await handler.Handle(
            new PreviewCustomRecordViewQuery("chantiers", new PreviewRecordViewRequest(CustomRecordViewMode.List, def)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.StartsWith("Validation.", result.Error.Code);
        _records.Verify(r => r.QueryAsync(It.IsAny<RecordQuerySpec>(), It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Preview_bounds_page_size_like_run()
    {
        var handler = PreviewHandler();

        var zero = await handler.Handle(new PreviewCustomRecordViewQuery("chantiers",
            new PreviewRecordViewRequest(CustomRecordViewMode.List, ListDef(), PageSize: 0)), CancellationToken.None);
        Assert.True(zero.IsFailure);
        Assert.Equal("Validation.pageSize", zero.Error.Code);

        var tooBig = await handler.Handle(new PreviewCustomRecordViewQuery("chantiers",
            new PreviewRecordViewRequest(CustomRecordViewMode.List, ListDef(), PageSize: 201)), CancellationToken.None);
        Assert.True(tooBig.IsFailure);
        Assert.Equal("Validation.pageSize", tooBig.Error.Code);

        _records.Verify(r => r.QueryAsync(It.IsAny<RecordQuerySpec>(), It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()), Times.Never);

        // null ⇒ Definition.PageSize (25) ; page < 1 ⇒ 1 (skip 0).
        _records.Setup(r => r.QueryAsync(It.IsAny<RecordQuerySpec>(), It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((new List<CustomRecord>(), 0));
        var ok = await handler.Handle(new PreviewCustomRecordViewQuery("chantiers",
            new PreviewRecordViewRequest(CustomRecordViewMode.List, ListDef(), Page: 0)), CancellationToken.None);
        Assert.True(ok.IsSuccess);
        _records.Verify(r => r.QueryAsync(
            It.Is<RecordQuerySpec>(sp => sp.Skip == 0 && sp.Take == 25),
            It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Preview_kanban_groups_like_run()
    {
        // Miroir du fait run (ordre des options puis « Sans valeur », borne 500) — sans vue persistée.
        var rows = new List<CustomRecord>
        {
            Rec("""{"nom":"t1","statut":"termine"}"""),
            Rec("""{"nom":"t2","statut":"encours"}"""),
            Rec("""{"nom":"t3"}""")
        };
        _records.Setup(r => r.QueryAsync(It.IsAny<RecordQuerySpec>(), It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((rows, Total: 501));

        var handler = PreviewHandler(Settings(kanban: 500));
        var result = await handler.Handle(
            new PreviewCustomRecordViewQuery("chantiers", new PreviewRecordViewRequest(CustomRecordViewMode.Kanban, KanbanDef())),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Truncated);
        Assert.Equal(new[] { "encours", "termine", null }, result.Value.Groups!.Select(g => g.Value).ToArray());
    }

    [Fact]
    public async Task Preview_calendar_requires_a_date_range_and_bounds_it()
    {
        var handler = PreviewHandler();

        var missing = await handler.Handle(
            new PreviewCustomRecordViewQuery("chantiers", new PreviewRecordViewRequest(CustomRecordViewMode.Calendar, CalendarDef())),
            CancellationToken.None);
        Assert.True(missing.IsFailure);
        Assert.Equal("Validation.range", missing.Error.Code);

        var tooWide = await handler.Handle(
            new PreviewCustomRecordViewQuery("chantiers", new PreviewRecordViewRequest(CustomRecordViewMode.Calendar, CalendarDef(),
                RangeStart: new DateOnly(2026, 1, 1), RangeEnd: new DateOnly(2026, 6, 30))),
            CancellationToken.None);
        Assert.True(tooWide.IsFailure);
        Assert.Equal("Validation.range", tooWide.Error.Code);

        _records.Verify(r => r.QueryAsync(It.IsAny<RecordQuerySpec>(), It.IsAny<IReadOnlyDictionary<string, CustomFieldType>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Preview_returns_not_found_for_an_unknown_entity()
    {
        var handler = PreviewHandler();
        var result = await handler.Handle(
            new PreviewCustomRecordViewQuery("inconnue", new PreviewRecordViewRequest(CustomRecordViewMode.List, ListDef())),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.entityKey", result.Error.Code); // RecordEntityResolver : clé inconnue ⇒ 400
    }

    private static CustomRecord Rec(string json) => CustomRecord.Create(Tid, EntityId, json, UserId);
}
