using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Aperçu structuré et rejeu d'un plan Studio IA (PR 3.2c) : gardes en ordre (flag 404 →
/// tenant/propriétaire 404 → permission 401 → statut 409 → validation 400), schéma d'amendement
/// relu via MediatR avec repli dégradé (200 + warning), propagation des flags au constructeur pur,
/// et re-création d'un plan NEUF portant <c>replayedFromPlanId</c> (E1 : repli sur le summary
/// persisté pour les natures sans résumé recalculé). Mocks Moq <b>Strict</b> : seuls les appels
/// attendus sont configurés.
/// </summary>
public sealed class StudioAiPlanPreviewFeaturesTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private readonly Mock<IStudioAiBuildPlanRepository> _plans = new(MockBehavior.Strict);
    private readonly Mock<ICurrentUser> _currentUser = new(MockBehavior.Strict);
    private readonly Mock<IMediator> _mediator = new(MockBehavior.Strict);

    private const string SystemSpec = """
        { "system": { "displayName": "RH" }, "entities": [
          { "ref": "employes", "displayName": "Employés", "fields": [
            { "label": "Nom", "type": "text", "required": true } ] },
          { "ref": "formations", "displayName": "Formations", "fields": [
            { "label": "Libellé", "type": "text" } ] } ],
          "relations": [ { "kind": "many_to_many", "from": "employes", "to": "formations",
            "label": "Formations suivies" } ] }
        """;

    private const string AmendmentSpec = """
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_field", "label": "Motif de refus", "type": "multilinetext" },
          { "op": "add_relation", "kind": "many_to_many", "target": "Compétences", "label": "Compétences requises" } ] }
        """;

    public StudioAiPlanPreviewFeaturesTests()
    {
        _currentUser.Setup(x => x.TenantId).Returns(TenantId);
        _currentUser.Setup(x => x.UserId).Returns(UserId);
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(true);
    }

    // ---- Preview : gardes ----

    [Fact]
    public async Task Preview_when_flag_off_is_not_found_and_touches_nothing()
    {
        var result = await PreviewHandler(Settings(planPreview: false))
            .Handle(new GetStudioAiPlanPreviewQuery(Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
        Assert.Equal("Fonctionnalité non disponible.", result.Error.Description);
        _plans.VerifyNoOtherCalls();
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Preview_of_another_tenant_is_not_found()
    {
        // Le dépôt filtre par tenant : un plan d'un autre tenant est indistinguable d'un absent.
        var planId = Guid.NewGuid();
        _plans.Setup(p => p.GetByIdAsync(TenantId, planId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((StudioAiBuildPlan?)null);

        var result = await PreviewHandler().Handle(new GetStudioAiPlanPreviewQuery(planId), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("StudioAiBuildPlan.NotFound", result.Error.Code);
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Preview_of_another_owner_is_not_found()
    {
        var plan = Plan(StudioAiPlanKind.CreateSystem, SystemSpec, "{}", owner: Guid.NewGuid());
        SetupGet(plan);

        var result = await PreviewHandler().Handle(new GetStudioAiPlanPreviewQuery(plan.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("StudioAiBuildPlan.NotFound", result.Error.Code);
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Preview_without_permission_is_unauthorized()
    {
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(false);
        var plan = Plan(StudioAiPlanKind.CreateSystem, SystemSpec, "{}");
        SetupGet(plan);

        var result = await PreviewHandler().Handle(new GetStudioAiPlanPreviewQuery(plan.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Unauthorized", result.Error.Code);
        Assert.Equal("Permission de conception Studio requise.", result.Error.Description);
        _mediator.VerifyNoOtherCalls();
    }

    // ---- Preview : lecture ----

    [Fact]
    public async Task Preview_system_plan_returns_entities_and_empty_workflows()
    {
        var plan = Plan(StudioAiPlanKind.CreateSystem, SystemSpec, "{ \"title\": \"Gestion RH\" }");
        SetupGet(plan);

        var result = await PreviewHandler().Handle(new GetStudioAiPlanPreviewQuery(plan.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        var dto = result.Value;
        Assert.Equal(plan.Id, dto.PlanId);
        Assert.Equal("CreateSystem", dto.Kind);
        Assert.Equal("Pending", dto.Status);
        Assert.Equal("Gestion RH", dto.Title); // titre relu du summary persisté
        Assert.Equal(2, dto.Entities.Count);
        Assert.Equal("employes", dto.Entities[0].Ref);
        Assert.Equal("Nom", Assert.Single(dto.Entities[0].Fields).Label);
        Assert.Equal("Libellé", Assert.Single(dto.Entities[1].Fields).Label);
        var relation = Assert.Single(dto.Relations);
        Assert.Equal(new PreviewRelation("many_to_many", "employes", "formations", "Formations suivies", null), relation);
        Assert.Null(dto.Amendment);
        Assert.Empty(dto.Workflows); // contrat §12 : toujours [] en 3.x
        // Aucun schéma n'est chargé pour une création : MediatR n'est jamais sollicité.
        _mediator.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Preview_amendment_loads_schema_via_mediator_and_degrades_on_failure(bool schemaFound)
    {
        var plan = Plan(StudioAiPlanKind.Amendment, AmendmentSpec, "{ \"title\": \"Évolution contrats\" }");
        SetupGet(plan);
        _mediator.Setup(m => m.Send(
                It.Is<GetCustomEntitySchemaQuery>(q => q.EntityKey == "contrats"), It.IsAny<CancellationToken>()))
            .ReturnsAsync(schemaFound
                ? Result.Success(Schema())
                : Result.Failure<CustomEntitySchemaDto>(Error.NotFound("CustomEntity", Guid.NewGuid())));

        var result = await PreviewHandler().Handle(new GetStudioAiPlanPreviewQuery(plan.Id), CancellationToken.None);

        // Dégradé = succès (200 + avertissement), jamais une erreur (B-Q4).
        Assert.True(result.IsSuccess, result.Error.Description);
        var amendment = result.Value.Amendment;
        Assert.NotNull(amendment);
        Assert.Equal("contrats", amendment!.TargetEntityRef);
        Assert.Equal(!schemaFound, amendment.Degraded);
        if (schemaFound)
        {
            Assert.Equal("contrats", amendment.EntityKey);
            Assert.Equal("Contrat", amendment.EntityDisplayName);
            Assert.Equal(2, amendment.Items.Count); // add_field + add_relation résolus contre le schéma
        }
        else
        {
            Assert.Null(amendment.EntityKey);
            Assert.All(amendment.Items,
                item => Assert.Equal(StudioAiPlanPreviewBuilder.DegradedAmendmentWarning, item.Warning));
        }
        _mediator.Verify(m => m.Send(It.IsAny<GetCustomEntitySchemaQuery>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Preview_amendment_propagates_builder_flags(bool manyToMany)
    {
        var plan = Plan(StudioAiPlanKind.Amendment, AmendmentSpec, "{}");
        SetupGet(plan);
        _mediator.Setup(m => m.Send(It.IsAny<GetCustomEntitySchemaQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(Schema()));

        var result = await PreviewHandler(Settings(manyToMany: manyToMany))
            .Handle(new GetStudioAiPlanPreviewQuery(plan.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        var amendment = result.Value.Amendment!;
        if (manyToMany)
        {
            Assert.Contains(amendment.Items, item => item.Op == "add_relation");
            Assert.DoesNotContain(result.Value.Warnings,
                w => w.Contains("plusieurs-à-plusieurs", StringComparison.Ordinal));
        }
        else
        {
            // Flag N-N coupé côté settings ⇒ le planificateur écarte l'opération avec avertissement :
            // la preuve que le flag du handler atteint bien le constructeur pur.
            Assert.DoesNotContain(amendment.Items, item => item.Op == "add_relation");
            Assert.Contains(result.Value.Warnings,
                w => w.Contains("les relations plusieurs-à-plusieurs ne sont pas activées", StringComparison.Ordinal));
        }
    }

    [Fact]
    public async Task Preview_invalid_spec_is_validation_error_on_spec()
    {
        var plan = Plan(StudioAiPlanKind.CreateSystem, "{ pas du json", "{}");
        SetupGet(plan);

        var result = await PreviewHandler().Handle(new GetStudioAiPlanPreviewQuery(plan.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.spec", result.Error.Code);
        _mediator.VerifyNoOtherCalls();
    }

    /// <summary>
    /// PR 4.3c — un plan Workflow est une « feuille » de l'aperçu : titre et avertissements relus du
    /// summary (<c>StudioAiPlanSummary.ForWorkflow</c>), aucune entité ni relation, et
    /// <c>Workflows</c> du DTO reste vide (contrat §12) — le détail est dans <c>summary.workflows</c>.
    /// </summary>
    [Fact]
    public void Preview_of_a_workflow_plan_is_a_leaf_with_title_from_summary_and_empty_workflows_dto()
    {
        const string specJson = """
            { "workflows": [ { "entityKey": "factures", "name": "Relance", "trigger": "manual",
              "steps": [ { "type": "notify", "to": { "kind": "startedBy" }, "title": "Relance" } ] } ] }
            """;
        Assert.True(StudioAiWorkflowSpec.TryParse(specJson, out var spec, out var parseError), parseError);
        var schemas = new Dictionary<string, CustomEntitySchemaDto>
        {
            ["factures"] = new(
                new CustomEntityDto(Guid.NewGuid(), "factures", "Factures", "Factures", null, null, true, 2, null,
                    DateTime.UtcNow, DateTime.UtcNow),
                new[] { Field("numero", "Numéro", CustomFieldType.Text), Field("montant", "Montant", CustomFieldType.Number) },
                new FormLayout())
        };
        var summaryJson = StudioAiPlanSummary.ForWorkflow(spec!, schemas, new[] { "Avertissement du résumé" });
        var id = Guid.NewGuid();

        var result = StudioAiPlanPreviewBuilder.Build(id, StudioAiPlanKind.Workflow, "Pending", specJson, summaryJson,
            schema: null, manyToManyEnabled: false, recordViewsEnabled: false);

        Assert.True(result.IsSuccess, result.Error.Description);
        var dto = result.Value;
        Assert.Equal(id, dto.PlanId);
        Assert.Equal("Workflow", dto.Kind);
        Assert.Equal("Pending", dto.Status);
        Assert.Equal("1 workflow sur Factures", dto.Title); // titre relu du summary
        Assert.Empty(dto.Entities);
        Assert.Empty(dto.Relations);
        Assert.Null(dto.Amendment);
        Assert.Empty(dto.Workflows); // contrat §12 : le frontend lit summary.workflows
        Assert.Equal(new[] { "Avertissement du résumé" }, dto.Warnings);
        Assert.Empty(dto.Duplicates);
    }

    // ---- Replay : gardes ----

    [Fact]
    public async Task Replay_when_flag_off_is_not_found()
    {
        var result = await ReplayHandler(Settings(planPreview: false))
            .Handle(new ReplayStudioAiPlanCommand(Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
        Assert.Equal("Fonctionnalité non disponible.", result.Error.Description);
        _plans.VerifyNoOtherCalls();
        _mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Replay_pending_not_expired_is_conflict()
    {
        var plan = Plan(StudioAiPlanKind.CreateSystem, SystemSpec, "{ \"title\": \"RH\" }"); // Pending, 60 min
        SetupGet(plan);

        var result = await ReplayHandler().Handle(new ReplayStudioAiPlanCommand(plan.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        Assert.Equal("Seul un plan terminé, échoué, annulé ou expiré peut être rejoué.", result.Error.Description);
        _mediator.VerifyNoOtherCalls();
        _plans.Verify(p => p.AddAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Replay_executing_is_conflict()
    {
        var plan = Plan(StudioAiPlanKind.CreateSystem, SystemSpec, "{ \"title\": \"RH\" }");
        plan.MarkExecuting();
        SetupGet(plan);

        var result = await ReplayHandler().Handle(new ReplayStudioAiPlanCommand(plan.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        Assert.Equal("Seul un plan terminé, échoué, annulé ou expiré peut être rejoué.", result.Error.Description);
        _mediator.VerifyNoOtherCalls();
    }

    // ---- Replay : re-création ----

    [Fact]
    public async Task Replay_failed_plan_creates_new_pending_plan_with_replayed_from_id()
    {
        var plan = Plan(StudioAiPlanKind.CreateSystem, SystemSpec, "{ \"title\": \"RH\" }");
        plan.MarkFailed("Échec de création de la colonne.");
        SetupGet(plan);
        SetupRealCreate();

        var result = await ReplayHandler().Handle(new ReplayStudioAiPlanCommand(plan.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        // Un plan NEUF Pending est créé (jamais de mutation du plan d'origine).
        var added = Assert.IsType<StudioAiBuildPlan>(_addedPlan);
        Assert.NotEqual(plan.Id, added.Id);
        Assert.Equal(StudioAiPlanStatus.Pending, added.Status);
        Assert.Equal(StudioAiPlanKind.CreateSystem, added.Kind);
        Assert.Equal(result.Value.Plan.Id, added.Id);
        // Spec persistée = forme canonique RE-CALCULÉE de la spec d'origine.
        var canonical = StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.CreateSystem, SystemSpec, out _);
        Assert.Equal(canonical, added.SpecJson);
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(canonical!), result.Value.Spec.Spec));
        // Traçabilité : replayedFromPlanId à la RACINE du résumé recalculé, autres clés intactes.
        var summary = JsonNode.Parse(added.SummaryJson)!.AsObject();
        Assert.Equal(plan.Id, summary["replayedFromPlanId"]!.GetValue<Guid>());
        Assert.Equal("RH", summary["title"]!.GetValue<string>());
        // L'audit de création est émis par le handler délégué (même événement que le flux LLM).
        _audit.Verify(a => a.LogAsync("Studio.AiPlan.Created", "StudioAiBuildPlan", added.Id,
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Replay_amendment_falls_back_to_original_summary()
    {
        // E1 : un amendement n'a pas de résumé recalculé ⇒ le summary persisté sert de repli.
        var plan = Plan(StudioAiPlanKind.Amendment, AmendmentSpec, "{ \"title\": \"Évolution contrats\" }");
        plan.MarkCancelled();
        SetupGet(plan);
        SetupRealCreate();

        var result = await ReplayHandler().Handle(new ReplayStudioAiPlanCommand(plan.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        var summary = JsonNode.Parse(_addedPlan!.SummaryJson)!.AsObject();
        Assert.Equal("Évolution contrats", summary["title"]!.GetValue<string>()); // clé d'origine conservée
        Assert.Equal(plan.Id, summary["replayedFromPlanId"]!.GetValue<Guid>());
        Assert.Equal(StudioAiPlanKind.Amendment, _addedPlan.Kind);
    }

    [Fact]
    public async Task Replay_invalid_spec_is_validation_error_on_spec()
    {
        var plan = Plan(StudioAiPlanKind.CreateSystem, "{ pas du json", "{}");
        plan.MarkFailed("Échec de création.");
        SetupGet(plan);

        var result = await ReplayHandler().Handle(new ReplayStudioAiPlanCommand(plan.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.spec", result.Error.Code);
        _mediator.VerifyNoOtherCalls();
        _plans.Verify(p => p.AddAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Replay_never_mutates_source_plan()
    {
        var plan = Plan(StudioAiPlanKind.CreateSystem, SystemSpec, "{ \"title\": \"RH\" }");
        plan.MarkFailed("Échec de création.");
        var originalSpec = plan.SpecJson;
        var originalSummary = plan.SummaryJson;
        SetupGet(plan);
        SetupRealCreate();

        var result = await ReplayHandler().Handle(new ReplayStudioAiPlanCommand(plan.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        // La seule écriture est l'AJOUT du nouveau plan ; le plan d'origine n'est jamais persisté
        // (pas de TryUpdateAsync — la méthode de mutation du dépôt) ni modifié en mémoire.
        _plans.Verify(p => p.AddAsync(It.Is<StudioAiBuildPlan>(x => x.Id != plan.Id), It.IsAny<CancellationToken>()), Times.Once);
        _plans.Verify(p => p.TryUpdateAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>(), It.IsAny<byte[]?>()), Times.Never);
        Assert.Equal(StudioAiPlanStatus.Failed, plan.Status);
        Assert.Equal(originalSpec, plan.SpecJson);
        Assert.Equal(originalSummary, plan.SummaryJson);
    }

    // ---- Helpers ----

    private static StudioAiBuildPlan Plan(StudioAiPlanKind kind, string specJson, string summaryJson, Guid? owner = null) =>
        StudioAiBuildPlan.Create(TenantId, kind, specJson, summaryJson, owner ?? UserId, StudioAiPlanDefaults.Lifetime);

    private void SetupGet(StudioAiBuildPlan plan) =>
        _plans.Setup(p => p.GetByIdAsync(TenantId, plan.Id, It.IsAny<CancellationToken>())).ReturnsAsync(plan);

    private GetStudioAiPlanPreviewQueryHandler PreviewHandler(IOptions<OllamaSettings>? settings = null) =>
        new(_plans.Object, _currentUser.Object, _mediator.Object, settings ?? Settings());

    private ReplayStudioAiPlanCommandHandler ReplayHandler(IOptions<OllamaSettings>? settings = null) =>
        new(_plans.Object, _currentUser.Object, _mediator.Object, settings ?? Settings());

    // ---- Rejeu : le mediator exécute le VRAI handler de création (permission + audit réels) ----

    private readonly Mock<IAuditService> _audit = new(MockBehavior.Strict);
    private StudioAiBuildPlan? _addedPlan;

    private void SetupRealCreate()
    {
        var inner = new CreateStudioAiPlanCommandHandler(_plans.Object, _audit.Object, _currentUser.Object);
        _mediator.Setup(m => m.Send(It.IsAny<CreateStudioAiPlanCommand>(), It.IsAny<CancellationToken>()))
            .Returns((CreateStudioAiPlanCommand c, CancellationToken ct) => inner.Handle(c, ct));
        _plans.Setup(p => p.AddAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>()))
            .Callback((StudioAiBuildPlan plan, CancellationToken _) => _addedPlan = plan)
            .Returns(Task.CompletedTask);
        _audit.Setup(a => a.LogAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
    }

    private static IOptions<OllamaSettings> Settings(bool planPreview = true, bool manyToMany = true, bool recordViews = true) =>
        Options.Create(new OllamaSettings
        {
            EnableStudioAiPlanPreview = planPreview,
            EnableStudioManyToMany = manyToMany,
            EnableStudioRecordViews = recordViews
        });

    private static CustomEntitySchemaDto Schema() => new(
        new CustomEntityDto(Guid.NewGuid(), "contrats", "Contrat", "Contrats", null, null, true, 3, null,
            DateTime.UtcNow, DateTime.UtcNow),
        new[] { Field("nom", "Nom", CustomFieldType.Text), Field("statut", "Statut", CustomFieldType.Text) },
        new FormLayout
        {
            Sections = new[] { new FormSection { Fields = new[] { new FormFieldRef { Key = "nom", Width = "full" } } } }
        });

    private static CustomFieldDto Field(string key, string label, CustomFieldType type) =>
        new(Guid.NewGuid(), key, label, type, false, false, 0, null, null, null, true);
}
