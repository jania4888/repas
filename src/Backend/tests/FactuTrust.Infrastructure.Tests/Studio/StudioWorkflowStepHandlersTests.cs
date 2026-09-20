using System.Globalization;
using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.Studio.Automations;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Common;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.Studio.Workflows.Steps;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// PR 4.1g — handlers d'étapes 1/2 : <c>condition</c>, <c>update_field</c>, <c>erp_action</c>.
/// PR 4.1h — handlers 2/2 : <c>notify</c>, <c>approval</c>, <c>wait</c>, <c>create_record</c>.
/// La fixture (construction du <see cref="StepExecutionContext"/>) est factorisée pour être
/// réutilisée par les handlers 2/2 en 4.1h.
/// </summary>
public sealed class StudioWorkflowStepHandlersTests
{
    private static readonly Guid Tid = Guid.NewGuid();
    private static readonly Guid StartedBy = Guid.NewGuid();
    private static readonly DateTime NowUtc = new(2026, 9, 16, 12, 0, 0, DateTimeKind.Utc);

    // ---------- Fixture partagée (réutilisée en 4.1h) ----------

    private sealed record Fixture(
        CustomEntityDefinition Entity,
        StudioWorkflowDefinition Definition,
        StudioWorkflowInstance Instance,
        CustomRecord Record,
        StudioWorkflowContext Context);

    private static Fixture NewFixture(string dataJson, JsonObject? previous = null)
    {
        var entity = CustomEntityDefinition.Create(Tid, "clients", "Client", "Clients", null, null, null);
        var record = CustomRecord.Create(Tid, entity.Id, dataJson, StartedBy);
        var context = StudioWorkflowContext.Create(record.Id, entity.Key, StartedBy, null, previous);
        var definition = StudioWorkflowDefinition.Create(Tid, entity.Id, "wf_test", "WF test", null,
            StudioWorkflowTriggerKind.OnUpdate, "{}", "{}", true, StartedBy);
        var instance = StudioWorkflowInstance.Start(Tid, definition, record.Id,
            StudioWorkflowTriggerKind.OnUpdate, StartedBy, context.Serialize().Value, 0, null);
        return new Fixture(entity, definition, instance, record, context);
    }

    private static StepExecutionContext StepCtx(
        Fixture f, string stepKey, string stepType, JsonObject raw, IReadOnlyList<CustomFieldDefinition> fields,
        bool isResume = false)
    {
        var recordData = JsonNode.Parse(f.Record.DataJson) as JsonObject ?? new JsonObject();
        return new StepExecutionContext(Tid, f.Definition, f.Instance, f.Entity, fields, f.Record,
            recordData, f.Context, new WorkflowStepSpec(stepKey, stepType, null, raw), 0, isResume, NowUtc);
    }

    private static CustomFieldDefinition Field(
        Guid entityId, string key, CustomFieldType type = CustomFieldType.Text, bool isUnique = false) =>
        CustomFieldDefinition.Create(Tid, entityId, key, key, type, false, isUnique, 0, null, null, null, null);

    private static JsonObject StepRaw(string json) => JsonNode.Parse(json)!.AsObject();

    private sealed record UpdateFieldMocks(
        Mock<ICustomRecordRepository> Records,
        Mock<IStudioComputedFieldWriter> ComputedWriter,
        Mock<IPublisher> Publisher,
        UpdateFieldStepHandler Handler);

    private static UpdateFieldMocks NewUpdateFieldHandler()
    {
        var records = new Mock<ICustomRecordRepository>();
        var computedWriter = new Mock<IStudioComputedFieldWriter>();
        computedWriter
            .Setup(w => w.ApplyOnUpdateAsync(It.IsAny<Guid>(), It.IsAny<Guid>(),
                It.IsAny<IReadOnlyList<CustomFieldDefinition>>(), It.IsAny<string>(), It.IsAny<string>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid _, Guid _, IReadOnlyList<CustomFieldDefinition> _, string canonical, string _, CancellationToken _) => canonical);
        var publisher = new Mock<IPublisher>();
        publisher
            .Setup(p => p.Publish(It.IsAny<CustomRecordLifecycleNotification>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        var handler = new UpdateFieldStepHandler(
            records.Object, computedWriter.Object, publisher.Object, NullLogger<UpdateFieldStepHandler>.Instance);
        return new UpdateFieldMocks(records, computedWriter, publisher, handler);
    }

    // ---------- condition ----------

    [Fact]
    public async Task Condition_true_continues_with_passed_result()
    {
        var f = NewFixture("""{"montant":150}""");
        var fields = new[] { Field(f.Entity.Id, "montant", CustomFieldType.Decimal) };
        var raw = StepRaw("""{"filters":[{"field":"montant","op":"gte","value":100}],"match":"all"}""");

        var outcome = await new ConditionStepHandler().ExecuteAsync(StepCtx(f, "check", "condition", raw, fields), CancellationToken.None);

        var cont = Assert.IsType<StepOutcome.Continue>(outcome);
        Assert.True(cont.Result!["passed"]!.GetValue<bool>());
        Assert.Equal("all", cont.Result!["match"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("stop")]
    [InlineData("skip")]
    [InlineData("goto")]
    public async Task Condition_false_stop_skip_and_goto_follow_on_false(string onFalse)
    {
        var f = NewFixture("""{"montant":10}""");
        var fields = new[] { Field(f.Entity.Id, "montant", CustomFieldType.Decimal) };
        var raw = StepRaw($$"""{"filters":[{"field":"montant","op":"gte","value":100}],"onFalse":"{{onFalse}}","gotoKey":"later"}""");

        var outcome = await new ConditionStepHandler().ExecuteAsync(StepCtx(f, "check", "condition", raw, fields), CancellationToken.None);

        switch (onFalse)
        {
            case "stop":
                Assert.Equal("Condition non remplie", Assert.IsType<StepOutcome.Stop>(outcome).Reason);
                break;
            case "skip":
                Assert.Equal("Condition non remplie", Assert.IsType<StepOutcome.Skip>(outcome).Reason);
                break;
            default:
                Assert.Equal("later", Assert.IsType<StepOutcome.Goto>(outcome).TargetKey);
                break;
        }
    }

    [Fact]
    public async Task Condition_reads_previous_and_approval_variables()
    {
        var previous = new JsonObject { ["montant"] = 100 };
        var f = NewFixture("""{"montant":150}""", previous);
        f.Context.SetApproval("rev", "approved", null, null, null);
        var fields = new[] { Field(f.Entity.Id, "montant", CustomFieldType.Decimal) };
        var raw = StepRaw("""
            {"filters":[
                {"field":"_previous.montant","op":"eq","value":100},
                {"field":"_approval.rev.status","op":"eq","value":"approved"}]}
            """);

        var outcome = await new ConditionStepHandler().ExecuteAsync(StepCtx(f, "check", "condition", raw, fields), CancellationToken.None);

        var cont = Assert.IsType<StepOutcome.Continue>(outcome);
        Assert.True(cont.Result!["passed"]!.GetValue<bool>());
    }

    // ---------- update_field ----------

    [Fact]
    public async Task Update_field_renders_templates_merges_and_publishes_legacy_on_update()
    {
        var f = NewFixture("""{"nom":"ACME","ville":"Tunis","note":null}""");
        var fields = new[]
        {
            Field(f.Entity.Id, "nom"), Field(f.Entity.Id, "ville"), Field(f.Entity.Id, "note")
        };
        var raw = StepRaw("""{"set":{"note":"Client {{nom}} de {{ville}}"}}""");
        var mocks = NewUpdateFieldHandler();

        var outcome = await mocks.Handler.ExecuteAsync(StepCtx(f, "maj", "update_field", raw, fields), CancellationToken.None);

        var cont = Assert.IsType<StepOutcome.Continue>(outcome);
        var set = Assert.IsType<JsonArray>(cont.Result!["set"]);
        Assert.Equal("note", set[0]!.GetValue<string>());
        Assert.Empty(Assert.IsType<JsonArray>(cont.Result!["warnings"]));
        Assert.Contains("Client ACME de Tunis", f.Record.DataJson);
        mocks.Records.Verify(r => r.UpdateWithConcurrencyAsync(f.Record, It.IsAny<byte[]?>(), It.IsAny<CancellationToken>()), Times.Once);
        mocks.Publisher.Verify(p => p.Publish(
            It.Is<CustomRecordLifecycleNotification>(n =>
                n.Trigger == StudioAutomationTrigger.OnUpdate && n.RecordId == f.Record.Id),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Update_field_rejects_computed_field_via_merge_patch()
    {
        var f = NewFixture("""{"nom":"ACME"}""");
        var fields = new[] { Field(f.Entity.Id, "nom"), Field(f.Entity.Id, "num", CustomFieldType.AutoNumber) };
        var raw = StepRaw("""{"set":{"num":"A-0001"}}""");
        var mocks = NewUpdateFieldHandler();

        var outcome = await mocks.Handler.ExecuteAsync(StepCtx(f, "maj", "update_field", raw, fields), CancellationToken.None);

        var fail = Assert.IsType<StepOutcome.Fail>(outcome);
        Assert.Equal("Le champ calculé « num » n'est pas modifiable.", fail.Error);
        mocks.Records.Verify(r => r.UpdateWithConcurrencyAsync(It.IsAny<CustomRecord>(), It.IsAny<byte[]?>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Update_field_concurrency_conflict_fails_with_the_frozen_message()
    {
        var f = NewFixture("""{"nom":"ACME"}""");
        var fields = new[] { Field(f.Entity.Id, "nom") };
        var raw = StepRaw("""{"set":{"nom":"ACME 2"}}""");
        var mocks = NewUpdateFieldHandler();
        mocks.Records
            .Setup(r => r.UpdateWithConcurrencyAsync(It.IsAny<CustomRecord>(), It.IsAny<byte[]?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new DbUpdateConcurrencyException("boom"));

        var outcome = await mocks.Handler.ExecuteAsync(StepCtx(f, "maj", "update_field", raw, fields), CancellationToken.None);

        var fail = Assert.IsType<StepOutcome.Fail>(outcome);
        Assert.Equal("Enregistrement modifié entre-temps.", fail.Error);
        Assert.False(fail.ContinueAnyway);
        mocks.Publisher.Verify(p => p.Publish(It.IsAny<CustomRecordLifecycleNotification>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---------- erp_action ----------

    private sealed record ErpMocks(Mock<IStudioBridgeExecutor> Bridge, ErpActionStepHandler Handler);

    private static ErpMocks NewErpHandler(StudioBridgeOutcome outcome)
    {
        var bridge = new Mock<IStudioBridgeExecutor>();
        bridge
            .Setup(b => b.ExecuteActionAsync(It.IsAny<string>(), It.IsAny<IReadOnlyDictionary<string, object?>>(),
                It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(outcome);
        return new ErpMocks(bridge, new ErpActionStepHandler(bridge.Object, NullLogger<ErpActionStepHandler>.Instance));
    }

    private static JsonObject ErpRaw(string mapping, string? extra = null) => StepRaw($$"""
        {"action":"generate_invoice","mapping":{{mapping}}{{extra}}}
        """);

    private const string FullMapping = """
        [{"param":"client_id","source":"field","value":"client"},
         {"param":"product_id","source":"const","value":"p-9"},
         {"param":"quantity","source":"template","value":"{{quantite}}"}]
        """;

    [Fact]
    public async Task Erp_action_maps_field_const_and_template_sources()
    {
        var f = NewFixture("""{"client":"c-42","quantite":3}""");
        var mocks = NewErpHandler(new StudioBridgeOutcome(true, null, "{}"));
        var raw = ErpRaw(FullMapping);

        var outcome = await mocks.Handler.ExecuteAsync(StepCtx(f, "gen", "erp_action", raw, Array.Empty<CustomFieldDefinition>()), CancellationToken.None);

        Assert.IsType<StepOutcome.Continue>(outcome);
        mocks.Bridge.Verify(b => b.ExecuteActionAsync(
            "generate_invoice",
            It.Is<IReadOnlyDictionary<string, object?>>(a =>
                (string?)a["client_id"] == "c-42" &&
                (string?)a["product_id"] == "p-9" &&
                (string?)a["quantity"] == "3"),
            It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Erp_action_failure_continues_when_on_failure_is_continue()
    {
        var f = NewFixture("""{"client":"c-42","quantite":3}""");
        var mocks = NewErpHandler(new StudioBridgeOutcome(false, "Stock insuffisant.", null));
        var raw = ErpRaw(FullMapping, ",\"onFailure\":\"continue\"");

        var outcome = await mocks.Handler.ExecuteAsync(StepCtx(f, "gen", "erp_action", raw, Array.Empty<CustomFieldDefinition>()), CancellationToken.None);

        var fail = Assert.IsType<StepOutcome.Fail>(outcome);
        Assert.Equal("Stock insuffisant.", fail.Error);
        Assert.True(fail.ContinueAnyway);
    }

    [Fact]
    public async Task Erp_action_saves_result_under_save_result_as()
    {
        var f = NewFixture("""{"client":"c-42","quantite":3}""");
        var mocks = NewErpHandler(new StudioBridgeOutcome(true, null, """{"invoiceId":"abc"}"""));
        var raw = ErpRaw(FullMapping, ",\"saveResultAs\":\"facture\"");
        var ctx = StepCtx(f, "gen", "erp_action", raw, Array.Empty<CustomFieldDefinition>());

        var outcome = await mocks.Handler.ExecuteAsync(ctx, CancellationToken.None);

        Assert.IsType<StepOutcome.Continue>(outcome);
        var saved = Assert.IsType<JsonObject>(ctx.Context.Results["facture"]);
        Assert.Equal("abc", saved["invoiceId"]!.GetValue<string>());
    }

    [Fact]
    public async Task Erp_action_uses_the_workflow_correlation_id()
    {
        var f = NewFixture("""{"client":"c-42","quantite":3}""");
        var mocks = NewErpHandler(new StudioBridgeOutcome(true, null, "{}"));
        var raw = ErpRaw(FullMapping);

        await mocks.Handler.ExecuteAsync(StepCtx(f, "gen", "erp_action", raw, Array.Empty<CustomFieldDefinition>()), CancellationToken.None);

        mocks.Bridge.Verify(b => b.ExecuteActionAsync(
            "generate_invoice",
            It.IsAny<IReadOnlyDictionary<string, object?>>(),
            $"studio-workflow:{f.Instance.Id:N}:gen",
            It.IsAny<CancellationToken>()), Times.Once);
    }

    // ---------- notify ----------

    private sealed record NotifyMocks(Mock<INotificationService> Notifications, NotifyStepHandler Handler);

    private static NotifyMocks NewNotifyHandler()
    {
        var notifications = new Mock<INotificationService>();
        notifications
            .Setup(n => n.CreateAsync(It.IsAny<Guid>(), It.IsAny<string?>(), It.IsAny<NotificationType>(),
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<Guid?>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        return new NotifyMocks(notifications,
            new NotifyStepHandler(notifications.Object, NullLogger<NotifyStepHandler>.Instance));
    }

    [Theory]
    [InlineData("user")]
    [InlineData("role")]
    [InlineData("startedBy")]
    public async Task Notify_sends_a_message_notification_to_user_role_or_started_by(string kind)
    {
        var f = NewFixture("""{"nom":"ACME"}""");
        var userId = Guid.NewGuid();
        var toJson = kind switch
        {
            "user" => $"{{\"kind\":\"user\",\"value\":\"{userId}\"}}",
            "role" => "{\"kind\":\"role\",\"value\":\"Manager\"}",
            _ => "{\"kind\":\"startedBy\"}"
        };
        var raw = StepRaw("{\"to\":" + toJson + ",\"title\":\"Titre {{nom}}\",\"body\":\"Corps\"}");
        var mocks = NewNotifyHandler();

        var outcome = await mocks.Handler.ExecuteAsync(
            StepCtx(f, "notif", "notify", raw, Array.Empty<CustomFieldDefinition>()), CancellationToken.None);

        var cont = Assert.IsType<StepOutcome.Continue>(outcome);
        Assert.Equal(kind, cont.Result!["to"]!.GetValue<string>());
        Assert.Equal("Titre ACME", cont.Result!["title"]!.GetValue<string>());
        mocks.Notifications.Verify(n => n.CreateAsync(
            Tid,
            kind == "role" ? "Manager" : null,
            NotificationType.StudioWorkflowMessage,
            "Titre ACME",
            "Corps",
            null,
            kind == "user" ? userId : kind == "startedBy" ? StartedBy : (Guid?)null,
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Notify_skips_when_started_by_is_unknown()
    {
        var f = NewFixture("""{"nom":"ACME"}""");
        var anonymous = StudioWorkflowInstance.Start(Tid, f.Definition, f.Record.Id,
            StudioWorkflowTriggerKind.Manual, null, f.Instance.ContextJson, 0, null);
        f = f with { Instance = anonymous };
        var raw = StepRaw("{\"to\":{\"kind\":\"startedBy\"},\"title\":\"T\"}");
        var mocks = NewNotifyHandler();

        var outcome = await mocks.Handler.ExecuteAsync(
            StepCtx(f, "notif", "notify", raw, Array.Empty<CustomFieldDefinition>()), CancellationToken.None);

        Assert.Equal("Lanceur inconnu", Assert.IsType<StepOutcome.Skip>(outcome).Reason);
        mocks.Notifications.Verify(n => n.CreateAsync(It.IsAny<Guid>(), It.IsAny<string?>(),
            It.IsAny<NotificationType>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(),
            It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Notify_failure_never_blocks_the_workflow()
    {
        var f = NewFixture("""{"nom":"ACME"}""");
        var mocks = NewNotifyHandler();
        mocks.Notifications
            .Setup(n => n.CreateAsync(It.IsAny<Guid>(), It.IsAny<string?>(), It.IsAny<NotificationType>(),
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<Guid?>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("Service indisponible."));
        var raw = StepRaw("{\"to\":{\"kind\":\"role\",\"value\":\"Manager\"},\"title\":\"T\"}");

        var outcome = await mocks.Handler.ExecuteAsync(
            StepCtx(f, "notif", "notify", raw, Array.Empty<CustomFieldDefinition>()), CancellationToken.None);

        var fail = Assert.IsType<StepOutcome.Fail>(outcome);
        Assert.Equal("Service indisponible.", fail.Error);
        Assert.True(fail.ContinueAnyway);
    }

    [Fact]
    public async Task Notify_drops_absolute_links_and_truncates_title()
    {
        var f = NewFixture("""{"nom":"ACME"}""");
        var mocks = NewNotifyHandler();
        var longTitle = new string('t', 250);
        var raw = StepRaw("{\"to\":{\"kind\":\"role\",\"value\":\"Manager\"},\"title\":\"" + longTitle
            + "\",\"body\":\"B\",\"link\":\"https://example.com/x\"}");

        var outcome = await mocks.Handler.ExecuteAsync(
            StepCtx(f, "notif", "notify", raw, Array.Empty<CustomFieldDefinition>()), CancellationToken.None);

        var cont = Assert.IsType<StepOutcome.Continue>(outcome);
        Assert.Equal(200, cont.Result!["title"]!.GetValue<string>().Length);
        mocks.Notifications.Verify(n => n.CreateAsync(
            Tid, "Manager", NotificationType.StudioWorkflowMessage,
            It.Is<string>(t => t.Length == 200), "B", null, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    // ---------- approval ----------

    private sealed record ApprovalMocks(
        Mock<IStudioWorkflowRepository> Workflows,
        Mock<INotificationService> Notifications,
        ApprovalStepHandler Handler);

    private static ApprovalMocks NewApprovalHandler()
    {
        var workflows = new Mock<IStudioWorkflowRepository>();
        workflows
            .Setup(w => w.AddApprovalAsync(It.IsAny<StudioWorkflowApproval>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        var notifications = new Mock<INotificationService>();
        notifications
            .Setup(n => n.CreateAsync(It.IsAny<Guid>(), It.IsAny<string?>(), It.IsAny<NotificationType>(),
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<Guid?>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        return new ApprovalMocks(workflows, notifications,
            new ApprovalStepHandler(workflows.Object, notifications.Object, NullLogger<ApprovalStepHandler>.Instance));
    }

    [Fact]
    public async Task Approval_creates_a_pending_approval_and_suspends_with_due_at()
    {
        var f = NewFixture("""{"nom":"ACME"}""");
        var mocks = NewApprovalHandler();
        var raw = StepRaw("""{"assignee":{"kind":"role","value":"Manager"},"title":"Valider {{nom}}","message":"SVP","dueInHours":24}""");

        var outcome = await mocks.Handler.ExecuteAsync(
            StepCtx(f, "appr", "approval", raw, Array.Empty<CustomFieldDefinition>()), CancellationToken.None);

        var suspend = Assert.IsType<StepOutcome.Suspend>(outcome);
        Assert.Equal(StudioWorkflowInstanceStatus.WaitingApproval, suspend.Status);
        Assert.Equal(NowUtc.AddHours(24), suspend.DueAt);
        Assert.Equal("pending", suspend.Result!["status"]!.GetValue<string>());
        Assert.NotEqual(Guid.Empty, suspend.Result!["approvalId"]!.GetValue<Guid>());
        mocks.Workflows.Verify(w => w.AddApprovalAsync(It.Is<StudioWorkflowApproval>(a =>
                a.TenantId == Tid && a.InstanceId == f.Instance.Id && a.StepKey == "appr"
                && a.AssigneeRole == "Manager" && a.Title == "Valider ACME"
                && a.Status == StudioWorkflowApprovalStatus.Pending && a.DueAt == NowUtc.AddHours(24)),
            It.IsAny<CancellationToken>()), Times.Once);
        mocks.Notifications.Verify(n => n.CreateAsync(
            Tid, "Manager", NotificationType.StudioWorkflowApprovalRequested,
            "Valider ACME", "SVP", "/studio/approvals", null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData("approved", "stop", "reject", "continue")]
    [InlineData("rejected", "stop", "reject", "stop")]
    [InlineData("rejected", "goto", "reject", "goto")]
    [InlineData("expired", "stop", "approve", "continue")]
    [InlineData("expired", "stop", "fail", "fail-expired")]
    [InlineData(null, "stop", "reject", "fail-missing")]
    public async Task Approval_resume_follows_the_recorded_decision(
        string? status, string onReject, string onTimeout, string expected)
    {
        var f = NewFixture("""{"nom":"ACME"}""");
        if (status is not null)
            f.Context.SetApproval("appr", status, null, null, null);
        var mocks = NewApprovalHandler();
        var raw = StepRaw("{\"assignee\":{\"kind\":\"role\",\"value\":\"Manager\"},\"title\":\"Valider\",\"onReject\":\""
            + onReject + "\",\"gotoKey\":\"later\",\"onTimeout\":\"" + onTimeout + "\"}");

        var outcome = await mocks.Handler.ExecuteAsync(
            StepCtx(f, "appr", "approval", raw, Array.Empty<CustomFieldDefinition>(), isResume: true),
            CancellationToken.None);

        switch (expected)
        {
            case "continue":
                Assert.IsType<StepOutcome.Continue>(outcome);
                break;
            case "stop":
                Assert.Equal("Approbation refusée", Assert.IsType<StepOutcome.Stop>(outcome).Reason);
                break;
            case "goto":
                Assert.Equal("later", Assert.IsType<StepOutcome.Goto>(outcome).TargetKey);
                break;
            case "fail-expired":
                Assert.Equal("Approbation expirée.", Assert.IsType<StepOutcome.Fail>(outcome).Error);
                break;
            default:
                Assert.Equal("Décision d'approbation introuvable.", Assert.IsType<StepOutcome.Fail>(outcome).Error);
                break;
        }
        mocks.Workflows.Verify(w => w.AddApprovalAsync(It.IsAny<StudioWorkflowApproval>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---------- wait ----------

    [Fact]
    public async Task Wait_suspends_until_hours_or_until_and_caps_to_max_hours()
    {
        var f = NewFixture("""{"nom":"ACME"}""");
        var handler = new WaitStepHandler();

        // « hours » : échéance relative.
        var outcome = await handler.ExecuteAsync(
            StepCtx(f, "attente", "wait", StepRaw("""{"hours":5}"""), Array.Empty<CustomFieldDefinition>()),
            CancellationToken.None);
        var suspend = Assert.IsType<StepOutcome.Suspend>(outcome);
        Assert.Equal(StudioWorkflowInstanceStatus.Waiting, suspend.Status);
        Assert.Equal(NowUtc.AddHours(5), suspend.DueAt);
        Assert.Equal(NowUtc.AddHours(5).ToString("o", CultureInfo.InvariantCulture),
            suspend.Result!["dueAt"]!.GetValue<string>());

        // « until » : date absolue (UTC).
        outcome = await handler.ExecuteAsync(
            StepCtx(f, "attente", "wait", StepRaw("""{"until":"2026-09-20T00:00:00Z"}"""), Array.Empty<CustomFieldDefinition>()),
            CancellationToken.None);
        suspend = Assert.IsType<StepOutcome.Suspend>(outcome);
        Assert.Equal(new DateTime(2026, 9, 20, 0, 0, 0, DateTimeKind.Utc), suspend.DueAt);

        // Plafond : 720 h par défaut.
        outcome = await handler.ExecuteAsync(
            StepCtx(f, "attente", "wait", StepRaw("""{"hours":1000}"""), Array.Empty<CustomFieldDefinition>()),
            CancellationToken.None);
        suspend = Assert.IsType<StepOutcome.Suspend>(outcome);
        Assert.Equal(NowUtc.AddHours(720), suspend.DueAt);

        // Échéance déjà passée ⇒ poursuite immédiate.
        outcome = await handler.ExecuteAsync(
            StepCtx(f, "attente", "wait", StepRaw("""{"until":"2020-01-01T00:00:00Z"}"""), Array.Empty<CustomFieldDefinition>()),
            CancellationToken.None);
        Assert.IsType<StepOutcome.Continue>(outcome);

        // Date illisible ⇒ échec figé.
        outcome = await handler.ExecuteAsync(
            StepCtx(f, "attente", "wait", StepRaw("""{"until":"pas une date"}"""), Array.Empty<CustomFieldDefinition>()),
            CancellationToken.None);
        Assert.Equal("Date d'attente invalide.", Assert.IsType<StepOutcome.Fail>(outcome).Error);
    }

    [Fact]
    public async Task Wait_resume_continues()
    {
        var f = NewFixture("""{"nom":"ACME"}""");

        var outcome = await new WaitStepHandler().ExecuteAsync(
            StepCtx(f, "attente", "wait", StepRaw("""{"hours":5}"""), Array.Empty<CustomFieldDefinition>(), isResume: true),
            CancellationToken.None);

        Assert.IsType<StepOutcome.Continue>(outcome);
    }

    // ---------- create_record ----------

    private sealed record CreateRecordMocks(
        Mock<ICustomEntityRepository> Entities,
        Mock<ICustomRecordRepository> Records,
        Mock<IStudioQuotaService> Quota,
        Mock<IPublisher> Publisher,
        CreateRecordStepHandler Handler);

    private static CreateRecordMocks NewCreateRecordHandler(
        CustomEntityDefinition target, IReadOnlyList<CustomFieldDefinition> targetFields)
    {
        var entities = new Mock<ICustomEntityRepository>();
        entities
            .Setup(e => e.GetByKeyAsync(Tid, target.Key, It.IsAny<CancellationToken>()))
            .ReturnsAsync(target);
        var fields = new Mock<ICustomFieldRepository>();
        fields
            .Setup(repo => repo.ListByEntityAsync(Tid, target.Id, false, It.IsAny<CancellationToken>()))
            .ReturnsAsync(targetFields);
        var records = new Mock<ICustomRecordRepository>();
        records
            .Setup(r => r.CountAsync(Tid, target.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(0);
        var quota = new Mock<IStudioQuotaService>();
        quota
            .Setup(q => q.EnsureUnderLimitAsync(Tid, StudioQuotas.MaxRecordsKey, 0,
                StudioQuotas.MaxRecordsFallback, "enregistrements par table", It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        var computedWriter = new Mock<IStudioComputedFieldWriter>();
        computedWriter
            .Setup(w => w.ApplyOnCreateAsync(It.IsAny<Guid>(), It.IsAny<Guid>(),
                It.IsAny<IReadOnlyList<CustomFieldDefinition>>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid _, Guid _, IReadOnlyList<CustomFieldDefinition> _, string canonical, CancellationToken _) => canonical);
        var publisher = new Mock<IPublisher>();
        publisher
            .Setup(p => p.Publish(It.IsAny<CustomRecordLifecycleNotification>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        var handler = new CreateRecordStepHandler(
            entities.Object, fields.Object, records.Object, quota.Object, computedWriter.Object,
            publisher.Object, NullLogger<CreateRecordStepHandler>.Instance);
        return new CreateRecordMocks(entities, records, quota, publisher, handler);
    }

    [Fact]
    public async Task Create_record_creates_a_record_in_the_target_table_and_saves_its_id()
    {
        var f = NewFixture("""{"nom":"ACME"}""");
        var target = CustomEntityDefinition.Create(Tid, "contacts", "Contact", "Contacts", null, null, null);
        var targetFields = new[] { Field(target.Id, "nom"), Field(target.Id, "ville") };
        var mocks = NewCreateRecordHandler(target, targetFields);
        var raw = StepRaw("""{"entity":"contacts","set":{"nom":"{{nom}}","ville":"Tunis"},"saveResultAs":"created"}""");
        var ctx = StepCtx(f, "creer", "create_record", raw, Array.Empty<CustomFieldDefinition>());

        var outcome = await mocks.Handler.ExecuteAsync(ctx, CancellationToken.None);

        var cont = Assert.IsType<StepOutcome.Continue>(outcome);
        var recordId = cont.Result!["recordId"]!.GetValue<Guid>();
        Assert.NotEqual(Guid.Empty, recordId);
        Assert.Equal("contacts", cont.Result!["entityKey"]!.GetValue<string>());
        mocks.Records.Verify(r => r.AddAsync(It.Is<CustomRecord>(rec =>
                rec.Id == recordId && rec.TenantId == Tid && rec.EntityDefinitionId == target.Id
                && rec.DataJson.Contains("ACME") && rec.CreatedBy == StartedBy),
            It.IsAny<CancellationToken>()), Times.Once);
        mocks.Publisher.Verify(p => p.Publish(
            It.Is<CustomRecordLifecycleNotification>(n =>
                n.Trigger == StudioAutomationTrigger.OnCreate && n.RecordId == recordId
                && n.EntityDefinitionId == target.Id),
            It.IsAny<CancellationToken>()), Times.Once);
        var saved = Assert.IsType<JsonObject>(ctx.Context.Results["created"]);
        Assert.Equal(recordId, saved["recordId"]!.GetValue<Guid>());
        Assert.Equal("contacts", saved["entityKey"]!.GetValue<string>());
    }

    [Fact]
    public async Task Create_record_refuses_junction_or_unknown_entity_and_quota_overflow()
    {
        var f = NewFixture("""{"nom":"ACME"}""");

        // 1) Entité jonction ⇒ refus figé, aucune écriture.
        var junction = CustomEntityDefinition.Create(
            Tid, "liens", "Lien", "Liens", null, null, null, null, CustomEntityKind.Junction);
        var mocks = NewCreateRecordHandler(junction, Array.Empty<CustomFieldDefinition>());

        var outcome = await mocks.Handler.ExecuteAsync(
            StepCtx(f, "creer", "create_record", StepRaw("""{"entity":"liens","set":{"nom":"x"}}"""),
                Array.Empty<CustomFieldDefinition>()), CancellationToken.None);

        Assert.Equal("Table cible « liens » introuvable ou non autorisée.",
            Assert.IsType<StepOutcome.Fail>(outcome).Error);
        mocks.Records.Verify(r => r.AddAsync(It.IsAny<CustomRecord>(), It.IsAny<CancellationToken>()), Times.Never);

        // 2) Entité inconnue ⇒ même refus.
        mocks.Entities
            .Setup(e => e.GetByKeyAsync(Tid, "inconnue", It.IsAny<CancellationToken>()))
            .ReturnsAsync((CustomEntityDefinition?)null);

        outcome = await mocks.Handler.ExecuteAsync(
            StepCtx(f, "creer", "create_record", StepRaw("""{"entity":"inconnue","set":{"nom":"x"}}"""),
                Array.Empty<CustomFieldDefinition>()), CancellationToken.None);

        Assert.Equal("Table cible « inconnue » introuvable ou non autorisée.",
            Assert.IsType<StepOutcome.Fail>(outcome).Error);
        mocks.Records.Verify(r => r.AddAsync(It.IsAny<CustomRecord>(), It.IsAny<CancellationToken>()), Times.Never);

        // 3) Quota atteint ⇒ échec sans écriture.
        var target = CustomEntityDefinition.Create(Tid, "contacts", "Contact", "Contacts", null, null, null);
        var mocksQuota = NewCreateRecordHandler(target, new[] { Field(target.Id, "nom") });
        mocksQuota.Quota
            .Setup(q => q.EnsureUnderLimitAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<int>(),
                It.IsAny<int>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure(Error.Validation("records", "Quota atteint.")));

        outcome = await mocksQuota.Handler.ExecuteAsync(
            StepCtx(f, "creer", "create_record", StepRaw("""{"entity":"contacts","set":{"nom":"x"}}"""),
                Array.Empty<CustomFieldDefinition>()), CancellationToken.None);

        Assert.Equal("Quota atteint.", Assert.IsType<StepOutcome.Fail>(outcome).Error);
        mocksQuota.Records.Verify(r => r.AddAsync(It.IsAny<CustomRecord>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
