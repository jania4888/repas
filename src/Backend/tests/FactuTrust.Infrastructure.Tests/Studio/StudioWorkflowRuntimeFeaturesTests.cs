using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// 4.2f — runtime « onglet Workflows » d'une fiche : instances de l'enregistrement, workflows lançables,
/// lancement manuel (quota), annulation (moteur), relance des approbateurs (1 / 24 h).
/// </summary>
public class StudioWorkflowRuntimeFeaturesTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid Uid = Guid.NewGuid();
    private static readonly Guid StartedBy = Guid.NewGuid();

    private readonly Mock<IStudioWorkflowRepository> _workflows = new(MockBehavior.Strict);
    private readonly Mock<ICustomEntityRepository> _entities = new(MockBehavior.Strict);
    private readonly Mock<ICustomRecordRepository> _records = new(MockBehavior.Strict);
    private readonly Mock<IStudioWorkflowRunner> _runner = new(MockBehavior.Strict);
    private readonly Mock<IStudioWorkflowEngine> _engine = new(MockBehavior.Strict);
    private readonly Mock<IStudioQuotaService> _quota = new(MockBehavior.Strict);
    private readonly Mock<INotificationService> _notifications = new(MockBehavior.Strict);
    private readonly Mock<IAuditService> _audit = new(MockBehavior.Strict);
    private readonly Mock<ICurrentUser> _currentUser = new(MockBehavior.Strict);
    private readonly Mock<IStudioUserNameResolver> _userNames = new(MockBehavior.Strict);
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 9, 17, 10, 0, 0, TimeSpan.Zero));

    private readonly CustomEntityDefinition _entity =
        CustomEntityDefinition.Create(TenantId, "customer", "Client", "Clients", null, null, null);

    public StudioWorkflowRuntimeFeaturesTests()
    {
        _currentUser.Setup(c => c.TenantId).Returns(TenantId);
        _currentUser.Setup(c => c.UserId).Returns(Uid);
        _currentUser.Setup(c => c.Role).Returns(UserRole.SalesRep);
        // 4.6b1 : par défaut aucun lanceur n'est résolu (null) ; les tests « Demandé par » posent un nom.
        _userNames.Setup(r => r.GetDisplayNamesAsync(TenantId, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, string>());
    }

    private void SetupReadPermission(bool granted = true) =>
        _currentUser.Setup(c => c.HasPermission(Permissions.CustomData.RecordsRead)).Returns(granted);

    private void SetupWritePermission(bool granted = true) =>
        _currentUser.Setup(c => c.HasPermission(Permissions.CustomData.RecordsWrite)).Returns(granted);

    private void SetupEntityAndRecord(CustomRecord? record)
    {
        _entities.Setup(r => r.GetByKeyAsync(TenantId, "customer", It.IsAny<CancellationToken>())).ReturnsAsync(_entity);
        if (record is not null)
            _records.Setup(r => r.GetAsync(TenantId, _entity.Id, record.Id, It.IsAny<CancellationToken>()))
                .ReturnsAsync(record);
    }

    [Fact]
    public async Task ListRecordWorkflowInstances_returns_dtos_and_clamps_max()
    {
        var record = CustomRecord.Create(TenantId, _entity.Id, "{}", Uid);
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        var instance = NewInstance(definition, record.Id);
        SetupReadPermission();
        SetupEntityAndRecord(record);
        _workflows.Setup(r => r.ListInstancesForRecordAsync(TenantId, record.Id, 200, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<StudioWorkflowInstance> { instance });
        _workflows.Setup(r => r.GetDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(definition);

        var handler = new ListRecordWorkflowInstancesQueryHandler(
            _workflows.Object, _entities.Object, _records.Object, _currentUser.Object, _userNames.Object);
        var result = await handler.Handle(
            new ListRecordWorkflowInstancesQuery("customer", record.Id, Max: 10_000), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var dto = Assert.Single(result.Value);
        Assert.Equal(instance.Id, dto.Id);
        Assert.Equal(definition.Key, dto.WorkflowKey);
        Assert.Equal(definition.Name, dto.WorkflowName);
    }

    [Fact]
    public async Task ListRecordWorkflowInstances_returns_NotFound_for_record_of_another_tenant()
    {
        var recordId = Guid.NewGuid();
        SetupReadPermission();
        SetupEntityAndRecord(null);
        _records.Setup(r => r.GetAsync(TenantId, _entity.Id, recordId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((CustomRecord?)null);

        var handler = new ListRecordWorkflowInstancesQueryHandler(
            _workflows.Object, _entities.Object, _records.Object, _currentUser.Object, _userNames.Object);
        var result = await handler.Handle(
            new ListRecordWorkflowInstancesQuery("customer", recordId), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal("CustomRecord.NotFound", result.Error.Code);
    }

    // 4.5b1 / D11 — détail d'instance pour les lecteurs, borné à la fiche (D-45-04), même corps que la route de conception (D-45-05).
    private GetRecordWorkflowInstanceQueryHandler NewGetInstanceHandler() =>
        new(_workflows.Object, _entities.Object, _records.Object, _currentUser.Object, _userNames.Object);

    [Fact]
    public async Task GetRecordWorkflowInstance_returns_detail_with_sorted_steps_approvals_and_masked_previous()
    {
        var record = CustomRecord.Create(TenantId, _entity.Id, "{}", Uid);
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        var instance = StudioWorkflowInstance.Start(TenantId, definition, record.Id, StudioWorkflowTriggerKind.Manual, StartedBy,
            """
            { "record": { "a": 1 }, "previous": { "a": 0 },
              "startedBy": { "id": "u1", "email": "alice@exemple.fr" },
              "results": { "erp": { "raw": "confidentiel" } }, "vars": { "montant": 42 } }
            """, 0, null);
        var now = DateTime.UtcNow;
        var runIndex1 = StudioWorkflowStepRun.Record(TenantId, instance.Id, 1, "maj", "update_field", StudioWorkflowStepRunStatus.Succeeded,
            StudioWorkflowStepOutcome.Continue, null, """{ "erp": { "raw": "confidentiel-etape" } }""", null, now.AddSeconds(1), now.AddSeconds(2), Uid);
        var runIndex0 = StudioWorkflowStepRun.Record(TenantId, instance.Id, 0, "verif", "condition", StudioWorkflowStepRunStatus.Failed,
            null, null, null, "pile interne erp", now, now.AddSeconds(1), Uid);
        var pending = StudioWorkflowApproval.Create(TenantId, instance.Id, "validation", Uid, null, "Accord ?", null, null);

        SetupReadPermission();
        SetupEntityAndRecord(record);
        _workflows.Setup(r => r.GetInstanceAsync(TenantId, instance.Id, It.IsAny<CancellationToken>())).ReturnsAsync(instance);
        _workflows.Setup(r => r.GetDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>())).ReturnsAsync(definition);
        _workflows.Setup(r => r.ListStepRunsAsync(TenantId, instance.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { runIndex1, runIndex0 });
        _workflows.Setup(r => r.ListApprovalsForInstanceAsync(TenantId, instance.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { pending });

        var result = await NewGetInstanceHandler().Handle(
            new GetRecordWorkflowInstanceQuery("customer", record.Id, instance.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var detail = result.Value;
        Assert.Equal(instance.Id, detail.Instance.Id);
        Assert.Equal(definition.Key, detail.Instance.WorkflowKey);
        Assert.Equal(new[] { 0, 1 }, detail.Steps.Select(st => st.StepIndex).ToArray());
        // 4.6b2 / D-46-B02 : les sorties (même tronquées) et les erreurs internes des étapes ne sortent
        // pas en portée lecteur (le tiroir ne les rend pas).
        Assert.All(detail.Steps, st => { Assert.Null(st.Result); Assert.Null(st.Error); });
        Assert.Single(detail.Approvals);
        Assert.True(detail.Context.ContainsKey("previous"));
        Assert.Null(detail.Context["previous"]);
        Assert.Equal(1, detail.Context["record"]!["a"]!.GetValue<int>());

        // Portée lecteur (D-45-27) : e-mail du lanceur, results et vars expurgés ; clés conservées, id du lanceur intact.
        Assert.Equal("u1", detail.Context["startedBy"]!["id"]!.GetValue<string>());
        Assert.Null(detail.Context["startedBy"]!["email"]);
        Assert.Empty(detail.Context["results"]!.AsObject());
        Assert.Empty(detail.Context["vars"]!.AsObject());
        var json = detail.Context.ToJsonString();
        Assert.DoesNotContain("alice@exemple.fr", json, StringComparison.Ordinal);
        Assert.DoesNotContain("confidentiel", json, StringComparison.Ordinal);
    }

    // Revue ★ 4.6 / D-46-05 — l'erreur au niveau instance (texte interne possible) suit la même règle
    // que les erreurs des étapes : elle ne sort ni par le détail ni par la liste en portée lecteur.
    [Fact]
    public async Task GetRecordWorkflowInstance_masks_the_instance_level_error_in_reader_scope()
    {
        var record = CustomRecord.Create(TenantId, _entity.Id, "{}", Uid);
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        var instance = StudioWorkflowInstance.Start(TenantId, definition, record.Id, StudioWorkflowTriggerKind.Manual, StartedBy,
            "{ \"record\": { \"a\": 1 }, \"startedBy\": { \"id\": \"u1\", \"email\": \"alice@exemple.fr\" } }", 0, null);
        instance.Fail("pile interne erp confidentielle");

        SetupReadPermission();
        SetupEntityAndRecord(record);
        _workflows.Setup(r => r.GetInstanceAsync(TenantId, instance.Id, It.IsAny<CancellationToken>())).ReturnsAsync(instance);
        _workflows.Setup(r => r.GetDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>())).ReturnsAsync(definition);
        _workflows.Setup(r => r.ListStepRunsAsync(TenantId, instance.Id, It.IsAny<CancellationToken>())).ReturnsAsync(Array.Empty<StudioWorkflowStepRun>());
        _workflows.Setup(r => r.ListApprovalsForInstanceAsync(TenantId, instance.Id, It.IsAny<CancellationToken>())).ReturnsAsync(Array.Empty<StudioWorkflowApproval>());

        var result = await NewGetInstanceHandler().Handle(
            new GetRecordWorkflowInstanceQuery("customer", record.Id, instance.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("failed", result.Value.Instance.Status);
        Assert.Null(result.Value.Instance.Error);
    }

    [Fact]
    public async Task ListRecordWorkflowInstances_masks_the_instance_level_error_in_reader_scope()
    {
        var record = CustomRecord.Create(TenantId, _entity.Id, "{}", Uid);
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        var failed = StudioWorkflowInstance.Start(TenantId, definition, record.Id, StudioWorkflowTriggerKind.Manual, StartedBy, null, 0, null);
        failed.Fail("pile interne erp confidentielle");

        SetupReadPermission();
        SetupEntityAndRecord(record);
        _workflows.Setup(r => r.ListInstancesForRecordAsync(TenantId, record.Id, It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { failed });
        _workflows.Setup(r => r.GetDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>())).ReturnsAsync(definition);

        var handler = new ListRecordWorkflowInstancesQueryHandler(
            _workflows.Object, _entities.Object, _records.Object, _currentUser.Object, _userNames.Object);
        var result = await handler.Handle(
            new ListRecordWorkflowInstancesQuery("customer", record.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var item = Assert.Single(result.Value);
        Assert.Equal("failed", item.Status);
        Assert.Null(item.Error);
    }

    // 4.6b1 / D-46-B01 — le nom du lanceur est servi aussi en portée lecteur (colonne « Demandé par »
    // de l'inbox, 4.5e) ; seul l'e-mail du contexte reste masqué.
    [Fact]
    public async Task GetRecordWorkflowInstance_includes_started_by_name_while_context_email_stays_masked()
    {
        var record = CustomRecord.Create(TenantId, _entity.Id, "{}", Uid);
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        var instance = StudioWorkflowInstance.Start(TenantId, definition, record.Id, StudioWorkflowTriggerKind.Manual, StartedBy,
            """{ "record": { "a": 1 }, "startedBy": { "id": "u1", "email": "alice@exemple.fr" } }""", 0, null);

        SetupReadPermission();
        SetupEntityAndRecord(record);
        _workflows.Setup(r => r.GetInstanceAsync(TenantId, instance.Id, It.IsAny<CancellationToken>())).ReturnsAsync(instance);
        _workflows.Setup(r => r.GetDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>())).ReturnsAsync(definition);
        _workflows.Setup(r => r.ListStepRunsAsync(TenantId, instance.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<StudioWorkflowStepRun>());
        _workflows.Setup(r => r.ListApprovalsForInstanceAsync(TenantId, instance.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<StudioWorkflowApproval>());
        _userNames.Setup(r => r.GetDisplayNamesAsync(TenantId, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, string> { [StartedBy] = "Alice Martin" });

        var result = await NewGetInstanceHandler().Handle(
            new GetRecordWorkflowInstanceQuery("customer", record.Id, instance.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Alice Martin", result.Value.Instance.StartedByName);
        Assert.Null(result.Value.Context["startedBy"]!["email"]);
    }

    // 4.6b1 / D-46-B01 — « Demandé par » sur l'onglet Workflows de la fiche : une résolution en lot par page.
    [Fact]
    public async Task ListRecordWorkflowInstances_resolves_started_by_name_in_one_batch()
    {
        var record = CustomRecord.Create(TenantId, _entity.Id, "{}", Uid);
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        var named = NewInstance(definition, record.Id);
        var systemStarted = StudioWorkflowInstance.Start(TenantId, definition, record.Id, StudioWorkflowTriggerKind.OnCreate, null, "{}", 0, null);
        SetupReadPermission();
        SetupEntityAndRecord(record);
        _workflows.Setup(r => r.ListInstancesForRecordAsync(TenantId, record.Id, 10, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<StudioWorkflowInstance> { named, systemStarted });
        _workflows.Setup(r => r.GetDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(definition);
        _userNames.Setup(r => r.GetDisplayNamesAsync(TenantId, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, string> { [StartedBy] = "Alice Martin" });

        var handler = new ListRecordWorkflowInstancesQueryHandler(
            _workflows.Object, _entities.Object, _records.Object, _currentUser.Object, _userNames.Object);
        var result = await handler.Handle(
            new ListRecordWorkflowInstancesQuery("customer", record.Id, Max: 10), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Alice Martin", result.Value[0].StartedByName);
        Assert.Null(result.Value[1].StartedByName);   // lanceur null (déclencheur automatique) ⇒ jamais résolu
        _userNames.Verify(r => r.GetDisplayNamesAsync(TenantId,
            It.Is<IReadOnlyCollection<Guid>>(ids => ids.Count == 1 && ids.Contains(StartedBy)),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task GetRecordWorkflowInstance_returns_NotFound_when_instance_is_missing_or_belongs_to_another_record()
    {
        var record = CustomRecord.Create(TenantId, _entity.Id, "{}", Uid);
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        var missingId = Guid.NewGuid();
        var foreignInstance = NewInstance(definition, Guid.NewGuid()); // instance d'une AUTRE fiche de la même table

        SetupReadPermission();
        SetupEntityAndRecord(record);
        _workflows.Setup(r => r.GetInstanceAsync(TenantId, missingId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((StudioWorkflowInstance?)null);
        _workflows.Setup(r => r.GetInstanceAsync(TenantId, foreignInstance.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(foreignInstance);

        var missing = await NewGetInstanceHandler().Handle(
            new GetRecordWorkflowInstanceQuery("customer", record.Id, missingId), CancellationToken.None);
        var foreign = await NewGetInstanceHandler().Handle(
            new GetRecordWorkflowInstanceQuery("customer", record.Id, foreignInstance.Id), CancellationToken.None);

        Assert.False(missing.IsSuccess);
        Assert.Equal("StudioWorkflowInstance.NotFound", missing.Error.Code);
        Assert.False(foreign.IsSuccess);
        Assert.Equal("StudioWorkflowInstance.NotFound", foreign.Error.Code);
        _workflows.Verify(r => r.ListStepRunsAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task GetRecordWorkflowInstance_requires_records_read_and_returns_NotFound_for_unknown_record()
    {
        var recordId = Guid.NewGuid();
        var instanceId = Guid.NewGuid();

        SetupReadPermission(false);
        var denied = await NewGetInstanceHandler().Handle(
            new GetRecordWorkflowInstanceQuery("customer", recordId, instanceId), CancellationToken.None);
        Assert.False(denied.IsSuccess);
        Assert.Equal("Unauthorized", denied.Error.Code);

        SetupReadPermission();
        SetupEntityAndRecord(null);
        _records.Setup(r => r.GetAsync(TenantId, _entity.Id, recordId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((CustomRecord?)null);
        var result = await NewGetInstanceHandler().Handle(
            new GetRecordWorkflowInstanceQuery("customer", recordId, instanceId), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal("CustomRecord.NotFound", result.Error.Code);
        _workflows.Verify(r => r.GetInstanceAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task GetRecordWorkflows_returns_only_active_manual_definitions_with_step_count()
    {
        var twoSteps = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual,
            stepsJson: """{ "version": 1, "steps": [{ "key": "sa", "type": "wait", "hours": 1 }, { "key": "sb", "type": "wait", "hours": 2 }] }""");
        var oneStep = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual,
            key: "wf-second", name: "Second",
            stepsJson: """{ "version": 1, "steps": [{ "key": "sa", "type": "wait", "hours": 1 }] }""");
        SetupReadPermission();
        _entities.Setup(r => r.GetByKeyAsync(TenantId, "customer", It.IsAny<CancellationToken>())).ReturnsAsync(_entity);
        // Le dépôt filtre déjà (actives + Manual) : le handler mappe et compte les étapes.
        _workflows.Setup(r => r.ListActiveByTriggerAsync(TenantId, _entity.Id, StudioWorkflowTriggerKind.Manual,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<StudioWorkflowDefinition> { twoSteps, oneStep });

        var handler = new GetRecordWorkflowsQueryHandler(_workflows.Object, _entities.Object, _currentUser.Object);
        var result = await handler.Handle(new GetRecordWorkflowsQuery("customer"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.Count);
        Assert.Equal(2, result.Value[0].StepCount);
        Assert.Equal(1, result.Value[1].StepCount);
        Assert.Equal("wf-second", result.Value[1].Key);
    }

    [Fact]
    public async Task Run_starts_instance_under_current_user_and_returns_dto()
    {
        var record = CustomRecord.Create(TenantId, _entity.Id, "{}", Uid);
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        var started = NewInstance(definition, record.Id);
        SetupWritePermission();
        SetupEntityAndRecord(record);
        _workflows.Setup(r => r.GetDefinitionByKeyAsync(TenantId, _entity.Id, definition.Key,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(definition);
        _workflows.Setup(r => r.CountInstancesForRecordAsync(TenantId, record.Id, true, It.IsAny<CancellationToken>()))
            .ReturnsAsync(0);
        _quota.Setup(q => q.EnsureUnderLimitAsync(TenantId, StudioQuotas.MaxWorkflowInstancesPerRecordKey, 0,
                StudioQuotas.MaxWorkflowInstancesPerRecordFallback, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        _runner.Setup(r => r.StartUnderCurrentUserAsync(definition, record.Id, StudioWorkflowTriggerKind.Manual,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(started));

        var handler = NewRunHandler();
        var result = await handler.Handle(
            new RunWorkflowCommand("customer", record.Id, definition.Key), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(started.Id, result.Value.Id);
        Assert.Equal(definition.Key, result.Value.WorkflowKey);
    }

    [Fact]
    public async Task Run_returns_NotFound_when_definition_is_inactive_or_not_manual()
    {
        var record = CustomRecord.Create(TenantId, _entity.Id, "{}", Uid);
        var inactive = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual, isActive: false);
        var onCreate = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.OnCreate, key: "wf-auto");
        SetupWritePermission();
        SetupEntityAndRecord(record);
        _workflows.Setup(r => r.GetDefinitionByKeyAsync(TenantId, _entity.Id, inactive.Key, It.IsAny<CancellationToken>()))
            .ReturnsAsync(inactive);
        _workflows.Setup(r => r.GetDefinitionByKeyAsync(TenantId, _entity.Id, onCreate.Key, It.IsAny<CancellationToken>()))
            .ReturnsAsync(onCreate);
        _workflows.Setup(r => r.GetDefinitionByKeyAsync(TenantId, _entity.Id, "wf-inconnu", It.IsAny<CancellationToken>()))
            .ReturnsAsync((StudioWorkflowDefinition?)null);

        var handler = NewRunHandler();
        foreach (var key in new[] { inactive.Key, onCreate.Key, "wf-inconnu" })
        {
            var result = await handler.Handle(new RunWorkflowCommand("customer", record.Id, key), CancellationToken.None);
            Assert.False(result.IsSuccess);
            Assert.Equal("NotFound", result.Error.Code);
            Assert.Contains("non lançable à la main", result.Error.Description);
        }
        _runner.Verify(r => r.StartUnderCurrentUserAsync(It.IsAny<StudioWorkflowDefinition>(), It.IsAny<Guid>(),
            It.IsAny<StudioWorkflowTriggerKind>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Run_returns_Validation_Plan_when_open_instances_reach_quota()
    {
        var record = CustomRecord.Create(TenantId, _entity.Id, "{}", Uid);
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        SetupWritePermission();
        SetupEntityAndRecord(record);
        _workflows.Setup(r => r.GetDefinitionByKeyAsync(TenantId, _entity.Id, definition.Key,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(definition);
        _workflows.Setup(r => r.CountInstancesForRecordAsync(TenantId, record.Id, true, It.IsAny<CancellationToken>()))
            .ReturnsAsync(200);
        _quota.Setup(q => q.EnsureUnderLimitAsync(TenantId, StudioQuotas.MaxWorkflowInstancesPerRecordKey, 200,
                StudioQuotas.MaxWorkflowInstancesPerRecordFallback, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure(Error.Validation("Plan", "Quota atteint.")));

        var result = await NewRunHandler().Handle(
            new RunWorkflowCommand("customer", record.Id, definition.Key), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal("Validation.Plan", result.Error.Code);
        _runner.Verify(r => r.StartUnderCurrentUserAsync(It.IsAny<StudioWorkflowDefinition>(), It.IsAny<Guid>(),
            It.IsAny<StudioWorkflowTriggerKind>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Cancel_requires_records_write_and_cancels_open_instance_with_reason()
    {
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        var instance = NewInstance(definition, Guid.NewGuid());
        instance.Suspend(StudioWorkflowInstanceStatus.Waiting, DateTime.UtcNow.AddHours(1), "{}");

        // Sans la permission : Unauthorized, le moteur n'est jamais appelé.
        SetupWritePermission(granted: false);
        var handler = new CancelInstanceCommandHandler(_workflows.Object, _engine.Object, _currentUser.Object);
        var denied = await handler.Handle(new CancelInstanceCommand(instance.Id, "Plus utile"), CancellationToken.None);
        Assert.False(denied.IsSuccess);
        Assert.Equal("Unauthorized", denied.Error.Code);
        _engine.Verify(e => e.CancelAsync(It.IsAny<StudioWorkflowInstance>(), It.IsAny<string>(),
            It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);

        // Avec la permission : le moteur annule (raison tronquée à 500), le DTO est retourné.
        SetupWritePermission();
        _workflows.Setup(r => r.GetInstanceAsync(TenantId, instance.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(instance);
        _workflows.Setup(r => r.GetDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(definition);
        var longReason = new string('x', 600);
        _engine.Setup(e => e.CancelAsync(instance, It.Is<string>(s => s.Length == 500), Uid,
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var ok = await handler.Handle(new CancelInstanceCommand(instance.Id, longReason), CancellationToken.None);

        Assert.True(ok.IsSuccess);
        Assert.Equal(instance.Id, ok.Value.Id);
        _engine.Verify(e => e.CancelAsync(instance, It.IsAny<string>(), Uid, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Cancel_returns_Conflict_when_instance_is_terminal()
    {
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        var instance = NewInstance(definition, Guid.NewGuid());
        instance.Fail("boom");
        SetupWritePermission();
        _workflows.Setup(r => r.GetInstanceAsync(TenantId, instance.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(instance);

        var handler = new CancelInstanceCommandHandler(_workflows.Object, _engine.Object, _currentUser.Object);
        var result = await handler.Handle(new CancelInstanceCommand(instance.Id, null), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal("Conflict", result.Error.Code);
    }

    [Fact]
    public async Task Remind_reemits_pending_approval_notifications_and_marks_reminded()
    {
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        var instance = NewInstance(definition, Guid.NewGuid());
        instance.Suspend(StudioWorkflowInstanceStatus.WaitingApproval, DateTime.UtcNow.AddHours(-2), "{}");
        var toUser = StudioWorkflowApproval.Create(TenantId, instance.Id, "approve", Uid, null, "Accord ?", null, null);
        var toRole = StudioWorkflowApproval.Create(TenantId, instance.Id, "approve2", null, nameof(UserRole.Administrator), "Budget ?", "Message", null);
        var decided = StudioWorkflowApproval.Create(TenantId, instance.Id, "approve3", Uid, null, "Ancienne", null, null);
        decided.Decide(StudioWorkflowApprovalStatus.Approved, Uid, null, DateTime.UtcNow.AddHours(-3));

        SetupWritePermission();
        _workflows.Setup(r => r.GetInstanceAsync(TenantId, instance.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(instance);
        _workflows.Setup(r => r.ListApprovalsForInstanceAsync(TenantId, instance.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<StudioWorkflowApproval> { toUser, toRole, decided });
        _notifications.Setup(n => n.CreateAsync(TenantId, null, NotificationType.StudioWorkflowApprovalRequested,
                "Rappel : Accord ?", string.Empty, "/studio/approvals", Uid, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        _notifications.Setup(n => n.CreateAsync(TenantId, nameof(UserRole.Administrator),
                NotificationType.StudioWorkflowApprovalRequested, "Rappel : Budget ?", "Message", "/studio/approvals",
                null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        _workflows.Setup(r => r.UpdateInstanceAsync(instance, It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        _audit.Setup(a => a.LogAsync("Studio.Workflow.InstanceReminded", "StudioWorkflowInstance", instance.Id, null,
                It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _workflows.Setup(r => r.GetDefinitionAsync(TenantId, definition.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(definition);

        var handler = new RemindInstanceCommandHandler(
            _workflows.Object, _notifications.Object, _audit.Object, _currentUser.Object, _time);
        var result = await handler.Handle(new RemindInstanceCommand(instance.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(_time.GetUtcNow().UtcDateTime, instance.LastRemindedAt);
        // Seules les deux approbations Pending sont ré-émises (jamais la déjà décidée).
        _notifications.Verify(n => n.CreateAsync(It.IsAny<Guid>(), It.IsAny<string?>(),
            It.IsAny<NotificationType>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(),
            It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task Remind_returns_Conflict_within_24_hours_or_without_pending_approval()
    {
        var definition = NewDefinition(_entity.Id, StudioWorkflowTriggerKind.Manual);
        var remindedRecently = NewInstance(definition, Guid.NewGuid());
        remindedRecently.Suspend(StudioWorkflowInstanceStatus.WaitingApproval, DateTime.UtcNow.AddHours(-2), "{}");
        remindedRecently.MarkReminded(_time.GetUtcNow().UtcDateTime.AddHours(-1));
        var notWaiting = NewInstance(definition, Guid.NewGuid()); // Start ⇒ statut Running

        SetupWritePermission();
        foreach (var instance in new[] { remindedRecently, notWaiting })
            _workflows.Setup(r => r.GetInstanceAsync(TenantId, instance.Id, It.IsAny<CancellationToken>()))
                .ReturnsAsync(instance);

        var handler = new RemindInstanceCommandHandler(
            _workflows.Object, _notifications.Object, _audit.Object, _currentUser.Object, _time);
        var within24h = await handler.Handle(new RemindInstanceCommand(remindedRecently.Id), CancellationToken.None);
        var noPending = await handler.Handle(new RemindInstanceCommand(notWaiting.Id), CancellationToken.None);

        Assert.False(within24h.IsSuccess);
        Assert.Equal("Conflict", within24h.Error.Code);
        Assert.Contains("24 h", within24h.Error.Description);
        Assert.False(noPending.IsSuccess);
        Assert.Equal("Conflict", noPending.Error.Code);
        _notifications.Verify(n => n.CreateAsync(It.IsAny<Guid>(), It.IsAny<string?>(),
            It.IsAny<NotificationType>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(),
            It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private RunWorkflowCommandHandler NewRunHandler() =>
        new(_workflows.Object, _entities.Object, _records.Object, _runner.Object, _quota.Object, _currentUser.Object);

    private static StudioWorkflowDefinition NewDefinition(
        Guid entityId, StudioWorkflowTriggerKind trigger, string key = "wf-manuel", string name = "Relance manuelle",
        bool isActive = true, string stepsJson = "[]") =>
        StudioWorkflowDefinition.Create(TenantId, entityId, key, name, null, trigger, "{}", stepsJson, isActive, StartedBy);

    private static StudioWorkflowInstance NewInstance(StudioWorkflowDefinition definition, Guid recordId) =>
        StudioWorkflowInstance.Start(TenantId, definition, recordId, StudioWorkflowTriggerKind.Manual,
            StartedBy, "{}", 0, null);

    /// <summary>Horloge figée (pas de dépendance au package Microsoft.Extensions.TimeProvider.Testing).</summary>
    private sealed class FakeTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
