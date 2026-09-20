using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Application.Features.Studio.Relations;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.Studio;
using MediatR;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// PR 2.4 — exécution d'un plan <c>RecordView</c> confirmé : la définition est RERÉSOLUE contre le
/// schéma réel à l'exécution (le schéma a pu changer depuis l'aperçu), les dégradations restent des
/// avertissements, l'échec « table introuvable » est explicite.
/// </summary>
public sealed class StudioAiPlanExecutorTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private readonly Mock<IMediator> _mediator = new();
    private readonly Mock<ICurrentUser> _currentUser = new();

    public StudioAiPlanExecutorTests()
    {
        _currentUser.Setup(x => x.TenantId).Returns(TenantId);
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(true);
    }

    private const string KanbanSpec = """
        { "entity": "interventions", "name": "Kanban par statut", "mode": "kanban",
          "columns": [ "Titre", "statut" ], "groupBy": "Statut",
          "filters": [ { "field": "bidon", "op": "eq", "value": 1 } ] }
        """;

    [Fact]
    public async Task Record_view_plan_creates_the_view_with_resolved_keys()
    {
        SetupInterventionsSchema();
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomRecordViewCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((CreateCustomRecordViewCommand c, CancellationToken _) =>
                Result.Success(new CustomRecordViewDto(Guid.NewGuid(), c.Request.Key, c.Request.DisplayName,
                    c.Request.Mode, c.Request.Definition, c.Request.IsDefault, true, "AAAA", DateTime.UtcNow)));

        var executor = new StudioAiPlanExecutor(_mediator.Object, _currentUser.Object);
        var (success, error, payload) = await executor.ExecuteAsync(Plan(KanbanSpec), null, CancellationToken.None);

        Assert.True(success, error);
        // Clés libellé résolues (« Titre » → titre, « Statut » → statut) ; filtre inconnu retiré + averti.
        _mediator.Verify(m => m.Send(It.Is<CreateCustomRecordViewCommand>(c =>
            c.EntityKey == "interventions"
            && c.Request.Key == "vue_kanban_par_statut"
            && c.Request.Mode == CustomRecordViewMode.Kanban
            && c.Request.Definition.Kanban!.GroupByFieldKey == "statut"
            && c.Request.Definition.Columns.Select(x => x.FieldKey).SequenceEqual(new[] { "titre", "statut" })
            && c.Request.Definition.Filters.Count == 0),
            It.IsAny<CancellationToken>()), Times.Once);

        // Le payload est un objet anonyme : assertions via JsonDocument (JsonSerializer échappe
        // les caractères non-ASCII — les « » du message ne sont pas cherchables en clair).
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(payload));
        var root = doc.RootElement;
        Assert.True(root.GetProperty("success").GetBoolean());
        Assert.Equal("vue_kanban_par_statut", root.GetProperty("viewKey").GetString());
        Assert.Equal("interventions", root.GetProperty("entityKey").GetString());
        Assert.Equal("Kanban", root.GetProperty("mode").GetString());
        Assert.StartsWith("/studio/d/interventions?view=", root.GetProperty("openUrl").GetString());
        Assert.Equal("Vue « Kanban par statut » créée.", root.GetProperty("message").GetString());
        Assert.Contains(
            root.GetProperty("warnings").EnumerateArray().Select(w => w.GetString()),
            w => w!.Contains("bidon"));
    }

    [Fact]
    public async Task Record_view_plan_fails_clearly_when_the_table_is_missing()
    {
        _mediator.Setup(m => m.Send(It.IsAny<GetCustomEntitySchemaQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomEntitySchemaDto>(
                Error.Validation("entityKey", "Table « interventions » introuvable.")));

        var executor = new StudioAiPlanExecutor(_mediator.Object, _currentUser.Object);
        var (success, error, _) = await executor.ExecuteAsync(Plan(KanbanSpec), null, CancellationToken.None);

        Assert.False(success);
        Assert.Contains("introuvable", error);
        _mediator.Verify(m => m.Send(It.IsAny<CreateCustomRecordViewCommand>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Record_view_plan_with_invalid_spec_fails_without_touching_the_schema()
    {
        var executor = new StudioAiPlanExecutor(_mediator.Object, _currentUser.Object);
        var (success, error, _) = await executor.ExecuteAsync(Plan("{ pas du json"), null, CancellationToken.None);

        Assert.False(success);
        Assert.NotNull(error);
        _mediator.Verify(m => m.Send(It.IsAny<GetCustomEntitySchemaQuery>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Record_view_plan_without_entity_key_fails()
    {
        var executor = new StudioAiPlanExecutor(_mediator.Object, _currentUser.Object);
        var (success, error, _) = await executor.ExecuteAsync(
            Plan("""{ "name": "Vue orpheline", "mode": "list" }"""), null, CancellationToken.None);

        Assert.False(success);
        Assert.Contains("table cible", error);
    }

    [Fact]
    public async Task Unknown_plan_kind_is_rejected_with_a_clear_message()
    {
        // Non-régression : l'aiguillage par nature refuse proprement une nature inconnue
        // (valeur hors énumération ; depuis la PR 4.3f, Workflow est routé vers StudioAiWorkflowExecutor).
        var executor = new StudioAiPlanExecutor(_mediator.Object, _currentUser.Object);
        var plan = StudioAiBuildPlan.Create(TenantId, (StudioAiPlanKind)99, "{}", "{}", UserId,
            StudioAiPlanDefaults.Lifetime);

        var (success, error, _) = await executor.ExecuteAsync(plan, null, CancellationToken.None);

        Assert.False(success);
        Assert.Contains("non pris en charge", error);
    }

    // ---- PR 3.1c : aiguillage d'un plan Amendment vers StudioAiAmendmentExecutor ----

    [Fact]
    public async Task Amendment_plan_is_routed_to_the_amendment_executor()
    {
        SetupInterventionsSchema();
        _mediator.Setup(m => m.Send(It.IsAny<ReorderCustomFieldsCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());

        var executor = new StudioAiPlanExecutor(_mediator.Object, _currentUser.Object);
        var plan = StudioAiBuildPlan.Create(TenantId, StudioAiPlanKind.Amendment, """
            { "target": { "entityKey": "interventions" }, "operations": [ { "op": "reorder_fields", "fields": [ "Statut" ] } ] }
            """, "{}", UserId, StudioAiPlanDefaults.Lifetime);

        var (success, error, _) = await executor.ExecuteAsync(plan, null, CancellationToken.None);

        Assert.True(success, error);
        _mediator.Verify(m => m.Send(It.Is<ReorderCustomFieldsCommand>(c => c.Request.OrderedFieldIds.Count == 2),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    // ---- PR 3.1d : le case Amendment transmet les drapeaux et le dépôt à l'exécuteur ----

    [Fact]
    public async Task Amendment_plan_forwards_the_flags_and_the_repository_to_the_amendment_executor()
    {
        // Sans transmission, add_relation N-N et set_view seraient « skipped » (fail-closed) et le
        // plan échouerait faute de modification applicable : le succès prouve le câblage.
        SetupInterventionsSchema();
        var entities = new Mock<ICustomEntityRepository>();
        var target = CustomEntityDefinition.Create(TenantId, "clients", "Client", "Clients", null, null, UserId);
        entities.Setup(r => r.GetByKeyAsync(TenantId, "clients", It.IsAny<CancellationToken>()))
            .ReturnsAsync(target);
        _mediator.Setup(m => m.Send(It.IsAny<CreateManyToManyRelationCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new ManyToManyRelationDto(
                new CustomEntityDto(Guid.NewGuid(), "interventions_clients", "Intervention – Client",
                    "Intervention – Client", "link", null, true, 2, null, DateTime.UtcNow, DateTime.UtcNow,
                    CustomEntityKind.Junction),
                new CustomFieldDto(Guid.NewGuid(), "interventions", "Interventions",
                    CustomFieldType.RelationCustom, true, false, 0, null, null, null, true),
                new CustomFieldDto(Guid.NewGuid(), "clients", "Clients",
                    CustomFieldType.RelationCustom, true, false, 1, null, null, null, true))));
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomRecordViewCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((CreateCustomRecordViewCommand c, CancellationToken _) =>
                Result.Success(new CustomRecordViewDto(Guid.NewGuid(), c.Request.Key, c.Request.DisplayName,
                    c.Request.Mode, c.Request.Definition, c.Request.IsDefault, true, "AAAA", DateTime.UtcNow)));

        var executor = new StudioAiPlanExecutor(_mediator.Object, _currentUser.Object,
            settings: Options.Create(new OllamaSettings
            {
                EnableStudioManyToMany = true,
                EnableStudioRecordViews = true
            }),
            entities: entities.Object);
        var plan = StudioAiBuildPlan.Create(TenantId, StudioAiPlanKind.Amendment, """
            { "target": { "entityKey": "interventions" }, "operations": [
              { "op": "add_relation", "kind": "many_to_many", "target": "clients" },
              { "op": "set_view", "mode": "list", "displayName": "Toutes", "columns": [ "titre" ] } ] }
            """, "{}", UserId, StudioAiPlanDefaults.Lifetime);

        var (success, error, _) = await executor.ExecuteAsync(plan, null, CancellationToken.None);

        Assert.True(success, error);
        _mediator.Verify(m => m.Send(It.Is<CreateManyToManyRelationCommand>(c =>
                c.Request.TargetEntityId == target.Id),
            It.IsAny<CancellationToken>()), Times.Once);
        _mediator.Verify(m => m.Send(It.Is<CreateCustomRecordViewCommand>(c =>
                c.EntityKey == "interventions" && c.Request.Key == "vue_toutes"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    // ---- PR 4.3f2 : aiguillage d'un plan Workflow vers StudioAiWorkflowExecutor (garde fail-closed) ----

    private const string WorkflowSpec = """
        { "workflows": [
            { "entityKey": "interventions", "name": "Relance", "trigger": "manual",
              "steps": [ { "type": "notify", "to": { "kind": "startedBy" }, "title": "Relance" } ] } ] }
        """;

    private static StudioAiBuildPlan WorkflowPlan(string specJson) =>
        StudioAiBuildPlan.Create(TenantId, StudioAiPlanKind.Workflow, specJson, "{}", UserId, StudioAiPlanDefaults.Lifetime);

    /// <summary>Exécuteur avec les TROIS drapeaux de la règle unique <c>WorkflowToolsEnabled</c> (chacun débrayable).</summary>
    private static StudioAiPlanExecutor WithWorkflows(Mock<IMediator> mediator, Mock<ICurrentUser> currentUser,
        bool workflows = true, bool aiTools = true, bool planPreview = true) =>
        new(mediator.Object, currentUser.Object, settings: Options.Create(new OllamaSettings
        {
            EnableStudioWorkflows = workflows,
            EnableStudioAiWorkflowTools = aiTools,
            EnableStudioAiPlanPreview = planPreview
        }));

    [Theory]
    [InlineData("settings_null")]
    [InlineData("workflows_off")]
    [InlineData("ai_tools_off")]
    [InlineData("plan_preview_off")]
    public async Task Workflow_plan_is_refused_when_the_workflows_flag_is_off(string scenario)
    {
        // Fail-closed (D-43-22, D-43-29) : réglages absents OU l'un des trois drapeaux à false ⇒ refus net,
        // aucune commande envoyée — l'outil IA reste un coupe-circuit effectif même via le rejeu d'un plan.
        var executor = scenario switch
        {
            "settings_null" => new StudioAiPlanExecutor(_mediator.Object, _currentUser.Object),
            "workflows_off" => WithWorkflows(_mediator, _currentUser, workflows: false),
            "ai_tools_off" => WithWorkflows(_mediator, _currentUser, aiTools: false),
            _ => WithWorkflows(_mediator, _currentUser, planPreview: false)
        };

        var (success, error, payload) = await executor.ExecuteAsync(WorkflowPlan(WorkflowSpec), null, CancellationToken.None);

        Assert.False(success);
        Assert.Null(payload);
        Assert.Equal("Les workflows Studio ne sont pas activés.", error);
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Workflow_plan_with_invalid_spec_fails_before_any_command()
    {
        var executor = WithWorkflows(_mediator, _currentUser);

        var (success, error, payload) = await executor.ExecuteAsync(WorkflowPlan("{}"), null, CancellationToken.None);

        Assert.False(success);
        Assert.Null(payload);
        Assert.False(string.IsNullOrWhiteSpace(error));
        Assert.Contains("workflows", error);            // message FR de StudioAiWorkflowSpec.TryParse
        Assert.DoesNotContain("Exception", error);
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Workflow_plan_delegates_to_the_workflow_executor_and_returns_its_payload()
    {
        SetupInterventionsSchema();
        IReadOnlyList<WorkflowDefinitionDto> none = Array.Empty<WorkflowDefinitionDto>();
        _mediator.Setup(m => m.Send(It.IsAny<ListWorkflowsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(none));
        var createdId = Guid.NewGuid();
        _mediator.Setup(m => m.Send(It.IsAny<CreateWorkflowCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((CreateWorkflowCommand c, CancellationToken _) => Result.Success(new WorkflowDefinitionDto(
                createdId, c.EntityId, c.Request.Key, c.Request.Name, c.Request.Description, c.Request.Trigger,
                c.Request.TriggerConfig ?? new System.Text.Json.Nodes.JsonObject(), c.Request.Steps, 1, 1,
                c.Request.IsActive, 0, DateTime.UtcNow, DateTime.UtcNow, "AAAA")));
        var steps = new List<StudioBuildStep>();
        var progress = new Mock<IStudioBuildProgress>();
        progress.Setup(p => p.Report(It.IsAny<StudioBuildStep>())).Callback((StudioBuildStep s) => steps.Add(s));

        var executor = WithWorkflows(_mediator, _currentUser);
        var (success, error, payload) = await executor.ExecuteAsync(WorkflowPlan(WorkflowSpec), progress.Object, CancellationToken.None);

        Assert.True(success, error);
        var json = JsonSerializer.Serialize(payload);
        Assert.Contains($"\"workflows\":[{{\"id\":\"{createdId}\"", json);
        Assert.Contains("\"openUrl\":\"/studio/workflows\"", json);
        Assert.Contains(steps, s => s.Phase == "completed" && s.Status == "done");
        // Le workflow est créé INACTIF par la commande existante (jamais d'accès direct).
        _mediator.Verify(m => m.Send(It.Is<CreateWorkflowCommand>(c => !c.Request.IsActive && c.Request.Key == "relance"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    private static StudioAiBuildPlan Plan(string specJson) =>
        StudioAiBuildPlan.Create(TenantId, StudioAiPlanKind.RecordView, specJson, "{}", UserId,
            StudioAiPlanDefaults.Lifetime);

    private void SetupInterventionsSchema()
    {
        var fields = new List<CustomFieldDto>
        {
            new(Guid.NewGuid(), "titre", "Titre", CustomFieldType.Text, false, false, 1, null, null, null, true),
            new(Guid.NewGuid(), "statut", "Statut", CustomFieldType.Select, false, false, 2, null,
                new List<SelectOptionDto> { new("planifiee", "Planifiée"), new("terminee", "Terminée") }, null, true)
        };
        _mediator.Setup(m => m.Send(
                It.Is<GetCustomEntitySchemaQuery>(q => q.EntityKey == "interventions"), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new CustomEntitySchemaDto(
                new CustomEntityDto(Guid.NewGuid(), "interventions", "Interventions", "Interventions",
                    null, null, true, 2, null, DateTime.UtcNow, DateTime.UtcNow),
                fields, new FormLayout())));
    }
}
