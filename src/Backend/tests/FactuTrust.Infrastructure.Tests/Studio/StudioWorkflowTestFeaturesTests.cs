using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories.Studio;
using FactuTrust.Infrastructure.Services.Studio.Workflows;
using FactuTrust.Infrastructure.Tests.Fixtures;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA — PR 4.7c1 : <see cref="TestWorkflowQueryHandler"/> contre un SQL Server RÉEL
/// (<see cref="SqlTestDatabase"/>, motif <c>StudioWorkflowEngineTests</c>). Vérifie la trace pas à pas
/// (condition vraie/fausse, <c>skip</c>/<c>goto</c>/<c>stop</c>, <c>update_field</c> enchaîné vu par la
/// condition suivante, suspensions <c>approval</c>/<c>wait</c>), les 400/404 et l'<b>invariant clé :
/// zéro écriture</b> (comptes instances / journaux d'étapes / approbations / audits inchangés).
/// </summary>
public sealed class StudioWorkflowTestFeaturesTests : IClassFixture<StudioWorkflowTestFeaturesTests.SqlFixture>
{
    private const string SkipMessage = "SQL Server/LocalDB indisponible dans ce bac à sable.";
    private static readonly DateTime Now = new(2026, 9, 18, 8, 0, 0, DateTimeKind.Utc);

    private readonly SqlFixture _sql;

    public StudioWorkflowTestFeaturesTests(SqlFixture sql) => _sql = sql;

    [SkippableFact]
    public async Task A_true_condition_runs_the_whole_segment_and_renders_templates()
    {
        Skip.If(!_sql.CanRun, SkipMessage);
        var h = NewHarness();
        var (entity, record) = await h.SeedAsync("cond_true");
        var definition = await h.NewDefinitionAsync(entity, """
        { "version": 1, "steps": [
            { "key": "si", "type": "condition", "label": "Montant élevé",
              "filters": [ { "field": "montant", "op": "gt", "value": 100 } ], "match": "all", "onFalse": "stop" },
            { "key": "notifie", "type": "notify", "to": { "kind": "role", "value": "Admin" },
              "title": "Facture {{numero}}", "body": "Montant élevé" }
        ] }
        """);

        var result = await h.Handler.Handle(new TestWorkflowQuery(definition.Id, record.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var trace = result.Value;
        Assert.Equal(record.Id, trace.RecordId);
        Assert.Equal(entity.Key, trace.EntityKey);
        Assert.False(trace.Suspended);
        Assert.Equal(2, trace.EvaluatedSteps);
        Assert.Empty(trace.Warnings);
        Assert.Equal(new[] { "si", "notifie" }, trace.Steps.Select(s => s.Key).ToArray());
        Assert.Equal(WorkflowTestVerdicts.WouldRun, trace.Steps[0].Verdict);
        Assert.Contains("remplie", trace.Steps[0].Detail);
        Assert.Equal(WorkflowTestVerdicts.WouldRun, trace.Steps[1].Verdict);
        // Gabarit rendu contre l'enregistrement réel.
        Assert.Equal("Facture F-2026-001", trace.Steps[1].Rendered!["title"]!.GetValue<string>());
        await h.AssertNoWriteAsync();
    }

    [SkippableFact]
    public async Task A_false_condition_stops_or_skips_or_jumps_like_the_engine()
    {
        Skip.If(!_sql.CanRun, SkipMessage);
        var h = NewHarness();
        var (entity, record) = await h.SeedAsync("cond_false", montant: 50);
        var definition = await h.NewDefinitionAsync(entity, """
        { "version": 1, "steps": [
            { "key": "si", "type": "condition",
              "filters": [ { "field": "montant", "op": "gt", "value": 100 } ], "onFalse": "skip" },
            { "key": "sautee", "type": "notify", "to": { "kind": "role", "value": "Admin" }, "title": "x" },
            { "key": "fin", "type": "condition",
              "filters": [ { "field": "montant", "op": "gt", "value": 1000 } ], "onFalse": "stop" },
            { "key": "jamais", "type": "notify", "to": { "kind": "role", "value": "Admin" }, "title": "y" }
        ] }
        """);

        var result = await h.Handler.Handle(new TestWorkflowQuery(definition.Id, record.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var trace = result.Value;
        Assert.Equal(new[] { "si", "sautee", "fin" }, trace.Steps.Select(s => s.Key).ToArray());
        Assert.Equal(WorkflowTestVerdicts.Skipped, trace.Steps[0].Verdict);       // onFalse = skip
        Assert.Equal(WorkflowTestVerdicts.WouldRun, trace.Steps[1].Verdict);
        Assert.Equal(WorkflowTestVerdicts.WouldRun, trace.Steps[2].Verdict);      // stop : l'étape a évalué
        Assert.Contains("s'arrêterait ici", trace.Steps[2].Detail);
        Assert.Equal(3, trace.EvaluatedSteps);                                    // « jamais » non atteinte, non tracée
        Assert.False(trace.Suspended);
        await h.AssertNoWriteAsync();
    }

    [SkippableFact]
    public async Task A_goto_marks_the_jumped_steps_as_skipped()
    {
        Skip.If(!_sql.CanRun, SkipMessage);
        var h = NewHarness();
        var (entity, record) = await h.SeedAsync("goto", montant: 50);
        var definition = await h.NewDefinitionAsync(entity, """
        { "version": 1, "steps": [
            { "key": "si", "type": "condition",
              "filters": [ { "field": "montant", "op": "gt", "value": 100 } ], "onFalse": "goto", "gotoKey": "fin" },
            { "key": "milieu", "type": "notify", "to": { "kind": "role", "value": "Admin" }, "title": "x" },
            { "key": "fin", "type": "notify", "to": { "kind": "role", "value": "Admin" }, "title": "fin" }
        ] }
        """);

        var result = await h.Handler.Handle(new TestWorkflowQuery(definition.Id, record.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var trace = result.Value;
        Assert.Equal(new[] { "si", "milieu", "fin" }, trace.Steps.Select(s => s.Key).ToArray());
        Assert.Equal(WorkflowTestVerdicts.WouldRun, trace.Steps[0].Verdict);
        Assert.Contains("saut à « fin »", trace.Steps[0].Detail);
        Assert.Equal(WorkflowTestVerdicts.Skipped, trace.Steps[1].Verdict);       // sautée par le branchement
        Assert.Contains("Sautée", trace.Steps[1].Detail);
        Assert.Equal(WorkflowTestVerdicts.WouldRun, trace.Steps[2].Verdict);
        Assert.Equal(2, trace.EvaluatedSteps);                                    // les lignes « sautée » ne comptent pas
        await h.AssertNoWriteAsync();
    }

    [SkippableFact]
    public async Task An_update_field_is_seen_by_the_following_condition()
    {
        Skip.If(!_sql.CanRun, SkipMessage);
        var h = NewHarness();
        var (entity, record) = await h.SeedAsync("update_chain", montant: 50);
        var definition = await h.NewDefinitionAsync(entity, """
        { "version": 1, "steps": [
            { "key": "maj", "type": "update_field", "set": { "montant": 5000, "statut": "{{numero}}-maj" } },
            { "key": "si", "type": "condition",
              "filters": [ { "field": "montant", "op": "gt", "value": 100 } ], "onFalse": "stop" },
            { "key": "notifie", "type": "notify", "to": { "kind": "role", "value": "Admin" }, "title": "{{statut}}" }
        ] }
        """);

        var result = await h.Handler.Handle(new TestWorkflowQuery(definition.Id, record.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var trace = result.Value;
        Assert.Equal(3, trace.EvaluatedSteps);
        // Le « set » rendu est exposé…
        Assert.Equal(5000, trace.Steps[0].Rendered!["montant"]!.GetValue<int>());
        // …appliqué à la copie : la condition suivante (montant > 100) est remplie malgré la valeur réelle 50,
        Assert.Contains("remplie", trace.Steps[1].Detail);
        // et les gabarits en aval voient la valeur mise à jour.
        Assert.Equal("F-2026-001-maj", trace.Steps[2].Rendered!["title"]!.GetValue<string>());
        await h.AssertNoWriteAsync();
        // L'enregistrement réel n'a PAS été modifié.
        var persisted = await h.Records.GetAsync(h.TenantId, entity.Id, record.Id);
        Assert.Equal(50, System.Text.Json.Nodes.JsonNode.Parse(persisted!.DataJson)!["montant"]!.GetValue<int>());
    }

    [SkippableFact]
    public async Task An_approval_suspends_the_trace_with_assignee_and_computed_due_date()
    {
        Skip.If(!_sql.CanRun, SkipMessage);
        var h = NewHarness();
        var (entity, record) = await h.SeedAsync("approval");
        var definition = await h.NewDefinitionAsync(entity, """
        { "version": 1, "steps": [
            { "key": "valide", "type": "approval", "assignee": { "kind": "role", "value": "Admin" },
              "title": "Valider {{numero}}", "dueInHours": 24 },
            { "key": "apres", "type": "notify", "to": { "kind": "role", "value": "Admin" }, "title": "x" }
        ] }
        """);

        var result = await h.Handler.Handle(new TestWorkflowQuery(definition.Id, record.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var trace = result.Value;
        Assert.True(trace.Suspended);
        var step = Assert.Single(trace.Steps);
        Assert.Equal(WorkflowTestVerdicts.WouldSuspend, step.Verdict);
        Assert.Contains("au rôle « Admin »", step.Detail);
        Assert.Contains(Now.AddHours(24).ToString("o"), step.Detail);   // horloge fixe
        Assert.Equal("Valider F-2026-001", step.Rendered!["title"]!.GetValue<string>());
        await h.AssertNoWriteAsync();
    }

    [SkippableFact]
    public async Task A_wait_suspends_with_the_capped_due_date_and_a_past_date_runs_through()
    {
        Skip.If(!_sql.CanRun, SkipMessage);
        var h = NewHarness();
        var (entity, record) = await h.SeedAsync("wait");
        var definition = await h.NewDefinitionAsync(entity, """
        { "version": 1, "steps": [
            { "key": "passe", "type": "wait", "until": "2020-01-01T00:00:00Z" },
            { "key": "longue", "type": "wait", "hours": 5000, "maxHours": 48 },
            { "key": "apres", "type": "notify", "to": { "kind": "role", "value": "Admin" }, "title": "x" }
        ] }
        """);

        var result = await h.Handler.Handle(new TestWorkflowQuery(definition.Id, record.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var trace = result.Value;
        Assert.True(trace.Suspended);
        Assert.Equal(new[] { "passe", "longue" }, trace.Steps.Select(s => s.Key).ToArray());
        Assert.Equal(WorkflowTestVerdicts.WouldRun, trace.Steps[0].Verdict);      // échéance passée ⇒ aucune attente
        Assert.Equal(WorkflowTestVerdicts.WouldSuspend, trace.Steps[1].Verdict);
        Assert.Contains(Now.AddHours(48).ToString("o"), trace.Steps[1].Detail);   // plafond maxHours appliqué
        await h.AssertNoWriteAsync();
    }

    [SkippableFact]
    public async Task A_condition_on_results_warns_that_outputs_are_fictitious()
    {
        Skip.If(!_sql.CanRun, SkipMessage);
        var h = NewHarness();
        var (entity, record) = await h.SeedAsync("results");
        var definition = await h.NewDefinitionAsync(entity, """
        { "version": 1, "steps": [
            { "key": "cree", "type": "create_record", "set": { "numero": "X" }, "saveResultAs": "fact" },
            { "key": "si", "type": "condition",
              "filters": [ { "field": "_results.fact.recordId", "op": "isNotEmpty" } ], "onFalse": "stop" }
        ] }
        """);

        var result = await h.Handler.Handle(new TestWorkflowQuery(definition.Id, record.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Description : null);
        var trace = result.Value;
        Assert.Equal(WorkflowTestVerdicts.WouldRun, trace.Steps[0].Verdict);
        // D-47-B08 : l'avertissement « sorties fictives » est émis à l'étape productrice ET à la condition.
        Assert.Contains(trace.Warnings, w => w.Contains("_results.fact") && w.Contains("cree"));
        Assert.Contains(trace.Warnings, w => w.Contains("_results.fact.recordId"));
        await h.AssertNoWriteAsync();
    }

    [SkippableFact]
    public async Task Unknown_record_or_other_tenant_maps_to_the_same_404()
    {
        Skip.If(!_sql.CanRun, SkipMessage);
        var h = NewHarness();
        var (entity, record) = await h.SeedAsync("notfound");
        var definition = await h.NewDefinitionAsync(entity, """
        { "version": 1, "steps": [ { "key": "a", "type": "wait", "hours": 1 } ] }
        """);

        var unknown = await h.Handler.Handle(new TestWorkflowQuery(definition.Id, Guid.NewGuid()), CancellationToken.None);
        Assert.True(unknown.IsFailure);
        Assert.EndsWith(".NotFound", unknown.Error.Code);

        // Workflow d'un autre tenant : 404 non révélateur (motif existant).
        var other = await h.Handler.Handle(new TestWorkflowQuery(Guid.NewGuid(), record.Id), CancellationToken.None);
        Assert.True(other.IsFailure);
        Assert.EndsWith(".NotFound", other.Error.Code);
        await h.AssertNoWriteAsync();
    }

    [SkippableFact]
    public async Task An_unparseable_definition_maps_to_a_400_on_steps()
    {
        Skip.If(!_sql.CanRun, SkipMessage);
        var h = NewHarness();
        var (entity, record) = await h.SeedAsync("invalid");
        var definition = await h.NewDefinitionAsync(entity, "{");

        var result = await h.Handler.Handle(new TestWorkflowQuery(definition.Id, record.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.StartsWith("Validation.", result.Error.Code);
        await h.AssertNoWriteAsync();
    }

    [SkippableFact]
    public async Task Without_the_design_permission_the_query_is_unauthorized()
    {
        Skip.If(!_sql.CanRun, SkipMessage);
        var h = NewHarness(granted: false);

        var result = await h.Handler.Handle(new TestWorkflowQuery(Guid.NewGuid(), Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("Unauthorized", result.Error.Code);
    }

    /// <summary>4.7★1 (D-47-74, U6) : concepteur sans <c>custom_records:read</c> ⇒ refus avant toute lecture de fiche.</summary>
    [SkippableFact]
    public async Task Without_records_read_the_test_is_unauthorized()
    {
        Skip.If(!_sql.CanRun, SkipMessage);
        var h = NewHarness(granted: true, recordsRead: false);
        var (entity, record) = await h.SeedAsync("noread");
        var definition = await h.NewDefinitionAsync(entity, """
        { "version": 1, "steps": [
            { "key": "notifie", "type": "notify", "to": { "kind": "role", "value": "Admin" },
              "title": "Facture {{numero}}", "body": "Montant {{montant}}" }
        ] }
        """);

        var result = await h.Handler.Handle(new TestWorkflowQuery(definition.Id, record.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Contains("Unauthorized", result.Error.Code);
        Assert.Contains("lecture des enregistrements", result.Error.Description);
        await h.AssertNoWriteAsync();
    }

    /// <summary>4.7★3 (D-47-80) : la seule constante encore miroir de la simulation — la borne du premier segment —
    /// reste égale à celle du moteur réel (les délais par défaut `approval` / `wait` sont désormais partagés via
    /// <c>StudioWorkflowStepsSpec</c>, plus de miroir possible).</summary>
    [Fact]
    public void Simulated_segment_bound_matches_the_real_engine_segment_bound()
        => Assert.Equal(StudioWorkflowEngine.MaxStepsPerSegment, TestWorkflowQueryHandler.MaxSimulatedSteps);

    /// <summary>4.7★2 (S2) : invariant D-47-B07 par construction — le handler de simulation ne reçoit aucun service
    /// d'écriture (moteur, notifications, audit, e-mail, médiateur, unité de travail) ; il ne peut donc rien persister.</summary>
    [Fact]
    public void TestWorkflowQueryHandler_depends_on_no_writing_service()
    {
        var ctor = Assert.Single(typeof(TestWorkflowQueryHandler).GetConstructors());
        var parameterTypes = ctor.GetParameters().Select(p => p.ParameterType.Name).ToArray();

        Assert.Equal(
            new[] { "IStudioWorkflowRepository", "ICustomEntityRepository", "ICustomFieldRepository", "ICustomRecordRepository", "ICurrentUser", "TimeProvider" },
            parameterTypes);

        var forbidden = new[] { "Engine", "Runner", "Notification", "Audit", "Email", "Sender", "Mediator", "Publisher", "UnitOfWork", "DbContext", "Writer", "Schedule", "Quota" };
        foreach (var name in parameterTypes)
            Assert.DoesNotContain(forbidden, f => name.Contains(f, StringComparison.Ordinal));
    }

    // ---------------------------------------------------------------- harness

    private Harness NewHarness(bool granted = true, bool recordsRead = true) => new(_sql, granted, recordsRead);

    private sealed class Harness
    {
        private readonly SqlFixture _sql;

        public Harness(SqlFixture sql, bool granted, bool recordsRead = true)
        {
            _sql = sql;
            TenantId = Guid.NewGuid();
            Workflows = sql.NewWorkflowRepository();
            Records = sql.NewRecordRepository();
            Entities = sql.NewEntityRepository();
            Fields = sql.NewFieldRepository();
            var currentUser = new Mock<ICurrentUser>();
            currentUser.Setup(u => u.TenantId).Returns(TenantId);
            currentUser.Setup(u => u.UserId).Returns(Guid.NewGuid());
            currentUser.Setup(u => u.HasPermission(Permissions.Studio.DesignEntities)).Returns(granted);
            // 4.7★1 (D-47-74, U6) : le handler exige aussi la lecture des enregistrements ; accordée par défaut.
            currentUser.Setup(u => u.HasPermission(Permissions.CustomData.RecordsRead)).Returns(recordsRead);
            Handler = new TestWorkflowQueryHandler(
                Workflows, Entities, Fields, Records, currentUser.Object, new FakeTimeProvider());
        }

        public Guid TenantId { get; }
        public TestWorkflowQueryHandler Handler { get; }
        public StudioWorkflowRepository Workflows { get; }
        public CustomRecordRepository Records { get; }
        public CustomEntityRepository Entities { get; }
        public CustomFieldRepository Fields { get; }

        public async Task<(CustomEntityDefinition Entity, CustomRecord Record)> SeedAsync(string label, int montant = 150)
        {
            var entity = CustomEntityDefinition.Create(
                TenantId, $"matters_{label}", "Matter", "Matters", null, null, null);
            await Entities.AddAsync(entity);
            await Fields.AddAsync(CustomFieldDefinition.Create(
                TenantId, entity.Id, "numero", "Numéro", CustomFieldType.Text, false, false, 1, null, null, null, null));
            await Fields.AddAsync(CustomFieldDefinition.Create(
                TenantId, entity.Id, "montant", "Montant", CustomFieldType.Number, false, false, 2, null, null, null, null));
            await Fields.AddAsync(CustomFieldDefinition.Create(
                TenantId, entity.Id, "statut", "Statut", CustomFieldType.Text, false, false, 3, null, null, null, null));
            var record = CustomRecord.Create(
                TenantId, entity.Id,
                $"{{\"numero\":\"F-2026-001\",\"montant\":{montant},\"statut\":\"brouillon\"}}", null);
            await Records.AddAsync(record);
            return (entity, record);
        }

        public async Task<StudioWorkflowDefinition> NewDefinitionAsync(CustomEntityDefinition entity, string stepsJson)
        {
            var definition = StudioWorkflowDefinition.Create(
                TenantId, entity.Id, $"wf_{Guid.NewGuid():N}", "Workflow de test", null,
                StudioWorkflowTriggerKind.Manual, "{}", stepsJson, isActive: true, null);
            await Workflows.AddDefinitionAsync(definition);
            return definition;
        }

        /// <summary>Invariant D-47-B07 : la simulation n'écrit rien (instances, journaux, approbations, audits).</summary>
        public async Task AssertNoWriteAsync()
        {
            await using var context = _sql.Factory.CreateContext();
            Assert.Equal(0, await context.StudioWorkflowInstances.CountAsync());
            Assert.Equal(0, await context.StudioWorkflowStepRuns.CountAsync());
            Assert.Equal(0, await context.StudioWorkflowApprovals.CountAsync());
            Assert.Equal(0, await context.AuditLogs.CountAsync());
            // Notifications : hors champ tenant (base maître) — couvert par construction :
            // le handler ne dépend ni de INotificationService ni de IAuditService.
        }
    }

    /// <summary>Horloge figée (échéances calculées exactes).</summary>
    private sealed class FakeTimeProvider : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }

    /// <summary>Base SQL par classe de tests (repli silencieux si absente).</summary>
    public sealed class SqlFixture : IDisposable
    {
        private readonly SqlTestDatabase _db = new(nameof(StudioWorkflowTestFeaturesTests));

        public SqlFixture()
        {
            if (!_db.CanRun)
                return;

            Options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseSqlServer(_db.ConnectionString!)
                .Options;
            Factory = new SingleConnectionTenantDbContextFactory(Options);
        }

        public bool CanRun => _db.CanRun;
        public DbContextOptions<TenantDbContext> Options { get; } = null!;
        public ITenantDbContextFactory Factory { get; } = null!;

        public StudioWorkflowRepository NewWorkflowRepository() => new(Factory);
        public CustomEntityRepository NewEntityRepository() => new(Factory);
        public CustomFieldRepository NewFieldRepository() => new(Factory);
        public CustomRecordRepository NewRecordRepository() => new(Factory, new Mock<IJsonIndexManager>().Object);

        public void Dispose() => _db.Dispose();

        private sealed class SingleConnectionTenantDbContextFactory : ITenantDbContextFactory
        {
            private readonly DbContextOptions<TenantDbContext> _options;
            public SingleConnectionTenantDbContextFactory(DbContextOptions<TenantDbContext> options) => _options = options;
            public TenantDbContext CreateContext() => new(_options);
        }
    }
}
