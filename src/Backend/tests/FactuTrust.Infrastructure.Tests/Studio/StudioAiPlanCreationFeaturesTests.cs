using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Création déterministe de plans Studio IA (B-P0-05) : validation en direct (validate), création
/// depuis une spec (from-spec) et instanciation d'un modèle embarqué (from-template). AUCUN LLM :
/// les handlers n'ont ni <c>IStudioAiPlanExecutor</c> ni <c>IAiToolExecutor</c> en dépendance — la
/// création est déléguée à <c>CreateStudioAiPlanCommand</c> via <c>IMediator</c>, simulé ici par le
/// VRAI handler interne (même permission, même audit « Studio.AiPlan.Created » prouvés).
/// Style et helpers repris de <see cref="StudioAiPlanWorkbenchFeaturesTests"/>.
/// </summary>
public sealed class StudioAiPlanCreationFeaturesTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private readonly Mock<IStudioAiBuildPlanRepository> _plans = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<IMediator> _mediator = new();

    private StudioAiBuildPlan? _addedPlan;

    private const string SystemSpec = """
    {
      "system": { "displayName": "Gestion des absences" },
      "entities": [
        { "ref": "employes", "displayName": "Employés", "fields": [
          { "key": "nom", "label": "Nom", "type": "text", "required": true } ] },
        { "ref": "absences", "displayName": "Absences", "fields": [
          { "key": "employe", "label": "Employé", "type": "relation", "relationTo": "employes" } ] }
      ]
    }
    """;

    // Clé « summaryJson » parasite côté client : elle doit être ignorée ET éliminée de la spec persistée.
    private const string SystemSpecWithStraySummary = """
    { "system": { "displayName": "Gestion des absences" }, "summaryJson": "{\"title\":\"FAUX\"}",
      "entities": [ { "ref": "employes", "displayName": "Employés", "fields": [ { "label": "Nom" } ] } ] }
    """;

    private const string AmendmentSpec = """
    { "target": { "entityKey": "employes" }, "operations": [ { "op": "update_entity", "displayName": "Collaborateurs" } ] }
    """;

    public StudioAiPlanCreationFeaturesTests()
    {
        _currentUser.Setup(x => x.TenantId).Returns(TenantId);
        _currentUser.Setup(x => x.UserId).Returns(UserId);
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(true);
    }

    // ---- Validate (en direct, sans état) ----

    [Fact]
    public async Task Validate_returns_canonical_spec_and_recomputed_summary()
    {
        // Nature parsée par nom d'enum insensible à la casse.
        var result = await ValidateHandler().Handle(
            new ValidateStudioAiSpecCommand("createsystem", SystemSpec), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Valid);
        Assert.Empty(result.Value.Warnings);

        // Forme canonique : clé de champ explicite émise (alias absorbés, clés ordonnées).
        var fields = result.Value.CanonicalJson!["entities"]![0]!["fields"]!.AsArray();
        Assert.Equal("nom", fields[0]!["key"]!.GetValue<string>());

        // Résumé recalculé côté serveur (titre + deux tables).
        Assert.Equal("Gestion des absences", result.Value.Summary!["title"]!.GetValue<string>());
        Assert.Equal(2, result.Value.Summary["entities"]!.AsArray().Count);
    }

    [Fact]
    public async Task Validate_of_invalid_spec_is_validation_error_and_no_canonical()
    {
        // ÉCHEC Error.Validation (mappé 400) — jamais un succès { valid = false }.
        var result = await ValidateHandler().Handle(
            new ValidateStudioAiSpecCommand("CreateSystem", "{ pas du json"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.specJson", result.Error.Code);
    }

    [Fact]
    public async Task Validate_with_unknown_kind_is_validation_error()
    {
        var result = await ValidateHandler().Handle(
            new ValidateStudioAiSpecCommand("Sonde", SystemSpec), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.kind", result.Error.Code);
        Assert.Contains("Sonde", result.Error.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Validate_of_non_creation_kind_returns_canonical_without_summary()
    {
        // L'aperçu d'une modification/fenêtre/état dépend du schéma réel : validation seule, résumé null.
        var result = await ValidateHandler().Handle(
            new ValidateStudioAiSpecCommand("Amendment", AmendmentSpec), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Valid);
        Assert.Null(result.Value.Summary);
        Assert.Contains("update_entity", result.Value.CanonicalJson!.ToJsonString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Validate_rejects_spec_over_size_limit()
    {
        var tooBig = "{\"system\":\"" + new string('a', StudioAiPlanWorkbench.MaxSpecJsonLength) + "\"}";

        var result = await ValidateHandler().Handle(
            new ValidateStudioAiSpecCommand("CreateSystem", tooBig), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.specJson", result.Error.Code);
        Assert.Contains("256 Ko", result.Error.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Validate_when_flag_off_is_not_found()
    {
        var result = await ValidateHandler(enabled: false).Handle(
            new ValidateStudioAiSpecCommand("CreateSystem", SystemSpec), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
    }

    // ---- FromSpec ----

    [Fact]
    public async Task FromSpec_creates_pending_plan_with_canonical_spec_and_server_summary()
    {
        SetupRealCreate();

        var result = await FromSpecHandler().Handle(
            new CreateStudioAiPlanFromSpecCommand("CreateSystem", SystemSpecWithStraySummary), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(_addedPlan);
        var plan = _addedPlan!;
        // Plan Pending créé SANS LLM (aucun exécuteur en dépendance) et confirmable par le chemin existant.
        Assert.Equal(StudioAiPlanStatus.Pending, plan.Status);
        Assert.Equal(StudioAiPlanKind.CreateSystem, plan.Kind);
        Assert.Equal(TenantId, plan.TenantId);
        Assert.Equal(UserId, plan.CreatedBy);

        // Spec persistée = forme canonique ; le « summaryJson » client parasite est ignoré et éliminé.
        Assert.Equal(StudioAiSpecCanonical.CanonicalFor(StudioAiPlanKind.CreateSystem, SystemSpecWithStraySummary, out _), plan.SpecJson);
        Assert.DoesNotContain("summaryJson", plan.SpecJson, StringComparison.Ordinal);
        Assert.DoesNotContain("FAUX", plan.SpecJson, StringComparison.Ordinal);
        // Résumé RECALCULÉ côté serveur (jamais celui du client).
        Assert.Equal("Gestion des absences", JsonNode.Parse(plan.SummaryJson)?["title"]?.GetValue<string>());

        // Délégation au handler existant : même audit « Studio.AiPlan.Created ».
        _mediator.Verify(m => m.Send(It.IsAny<CreateStudioAiPlanCommand>(), It.IsAny<CancellationToken>()), Times.Once);
        _audit.Verify(a => a.LogAsync("Studio.AiPlan.Created", "StudioAiBuildPlan", plan.Id,
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);

        // Réponse : DTO du plan + DTO de la spec canonique (jeton RowVersion exposé via GET {id}/spec).
        Assert.Equal(plan.Id, result.Value.Plan.Id);
        Assert.Equal(plan.Id, result.Value.Spec.Id);
        Assert.Equal(StudioAiPlanStatus.Pending.ToString(), result.Value.Plan.Status);
        Assert.Equal(string.Empty, result.Value.Spec.RowVersion);
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(plan.SpecJson), result.Value.Spec.Spec));
    }

    [Fact]
    public async Task FromSpec_rejects_spec_over_size_limit()
    {
        var tooBig = "{\"system\":\"" + new string('a', StudioAiPlanWorkbench.MaxSpecJsonLength) + "\"}";

        var result = await FromSpecHandler().Handle(
            new CreateStudioAiPlanFromSpecCommand("CreateSystem", tooBig), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.specJson", result.Error.Code);
        Assert.Contains("256 Ko", result.Error.Description, StringComparison.Ordinal);
        VerifyNoCreation();
    }

    [Fact]
    public async Task FromSpec_invalid_json_is_validation_error_and_creates_nothing()
    {
        var result = await FromSpecHandler().Handle(
            new CreateStudioAiPlanFromSpecCommand("CreateSystem", "{ pas du json"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.specJson", result.Error.Code);
        VerifyNoCreation();
    }

    [Fact]
    public async Task FromSpec_with_unknown_kind_is_validation_error()
    {
        var result = await FromSpecHandler().Handle(
            new CreateStudioAiPlanFromSpecCommand("Sonde", SystemSpec), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.kind", result.Error.Code);
        VerifyNoCreation();
    }

    [Fact]
    public async Task FromSpec_with_non_creation_kind_is_validation_error()
    {
        // Les résumés Amendment/View/Report exigent le schéma réel : création directe refusée en P0.
        var result = await FromSpecHandler().Handle(
            new CreateStudioAiPlanFromSpecCommand("View", "{ \"title\": \"Factures\", \"table\": \"Invoices\" }"),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.kind", result.Error.Code);
        VerifyNoCreation();
    }

    /// <summary>
    /// PR 4.3 : la nature Workflow est connue de l'enum mais reste HORS de la création depuis une
    /// spec (ratifié) — même refus <c>Validation.kind</c> que les autres natures hors création.
    /// </summary>
    [Fact]
    public async Task Create_from_spec_refuses_kind_Workflow()
    {
        var result = await FromSpecHandler().Handle(
            new CreateStudioAiPlanFromSpecCommand("Workflow", "{ \"workflows\": [] }"),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.kind", result.Error.Code);
        VerifyNoCreation();
    }

    [Fact]
    public async Task FromSpec_without_design_permission_is_unauthorized()
    {
        // Même permission que le chemin LLM : le VRAI CreateStudioAiPlanCommand est exécuté et refuse.
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(false);
        SetupRealCreate();

        var result = await FromSpecHandler().Handle(
            new CreateStudioAiPlanFromSpecCommand("CreateSystem", SystemSpec), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Unauthorized", result.Error.Code);
        Assert.Null(_addedPlan);
        _audit.Verify(a => a.LogAsync("Studio.AiPlan.Created", It.IsAny<string>(), It.IsAny<Guid?>(),
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task FromSpec_when_flag_off_is_not_found()
    {
        var result = await FromSpecHandler(enabled: false).Handle(
            new CreateStudioAiPlanFromSpecCommand("CreateSystem", SystemSpec), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
        VerifyNoCreation();
    }

    // ---- FromTemplate ----

    [Fact]
    public async Task FromTemplate_gestion_conges_creates_pending_plan()
    {
        SetupRealCreate();

        var result = await FromTemplateHandler().Handle(
            new CreateStudioAiPlanFromTemplateCommand("gestion-conges", null, null), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(_addedPlan);
        var plan = _addedPlan!;
        Assert.Equal(StudioAiPlanStatus.Pending, plan.Status);
        // Nature toujours CreateSystem ; résumé recalculé depuis la spec du modèle.
        Assert.Equal(StudioAiPlanKind.CreateSystem, plan.Kind);
        Assert.Equal("Gestion des congés", JsonNode.Parse(plan.SummaryJson)?["title"]?.GetValue<string>());
        // Spec persistée = forme canonique (clés de champs explicites).
        Assert.Contains("\"key\": \"nom\"", plan.SpecJson, StringComparison.Ordinal);
        _audit.Verify(a => a.LogAsync("Studio.AiPlan.Created", "StudioAiBuildPlan", plan.Id,
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task FromTemplate_unknown_key_is_not_found()
    {
        var result = await FromTemplateHandler().Handle(
            new CreateStudioAiPlanFromTemplateCommand("cle-inconnue", null, null), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
        Assert.Equal("Modèle introuvable.", result.Error.Description);
        VerifyNoCreation();
    }

    [Fact]
    public async Task FromTemplate_with_template_id_is_not_found_before_p3()
    {
        // Le dépôt de modèles tenant arrive en P3 (B-P3-02) : introuvable d'ici là.
        var result = await FromTemplateHandler().Handle(
            new CreateStudioAiPlanFromTemplateCommand(null, Guid.NewGuid(), null), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
        Assert.Equal("Modèle introuvable.", result.Error.Description);
        VerifyNoCreation();
    }

    [Fact]
    public async Task FromTemplate_with_both_key_and_id_is_validation_error()
    {
        var result = await FromTemplateHandler().Handle(
            new CreateStudioAiPlanFromTemplateCommand("gestion-conges", Guid.NewGuid(), null), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.templateKey", result.Error.Code);
        Assert.Contains("pas les deux", result.Error.Description, StringComparison.Ordinal);
        VerifyNoCreation();
    }

    [Fact]
    public async Task FromTemplate_with_neither_key_nor_id_is_validation_error()
    {
        var result = await FromTemplateHandler().Handle(
            new CreateStudioAiPlanFromTemplateCommand(null, null, null), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.templateKey", result.Error.Code);
        Assert.Contains("requis", result.Error.Description, StringComparison.Ordinal);
        VerifyNoCreation();
    }

    [Fact]
    public async Task FromTemplate_display_name_override_is_applied_and_summary_recomputed()
    {
        SetupRealCreate();
        const string displayName = "Suivi des absences RH";

        var result = await FromTemplateHandler().Handle(
            new CreateStudioAiPlanFromTemplateCommand("gestion-conges", null, displayName), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(_addedPlan);
        var plan = _addedPlan!;
        // Override appliqué à system.displayName AVANT canonicalisation ; la clé système sera
        // re-slugifiée depuis ce nom à l'exécution (StudioKey.Slugify).
        var spec = JsonNode.Parse(plan.SpecJson)!;
        Assert.Equal(displayName, spec["system"]!["displayName"]!.GetValue<string>());
        // Résumé recalculé APRÈS l'override.
        Assert.Equal(displayName, JsonNode.Parse(plan.SummaryJson)?["title"]?.GetValue<string>());
    }

    [Fact]
    public async Task FromTemplate_display_name_override_over_limit_is_validation_error()
    {
        var result = await FromTemplateHandler().Handle(
            new CreateStudioAiPlanFromTemplateCommand(
                "gestion-conges", null, new string('x', StudioAiPlanCreation.MaxDisplayNameOverrideLength + 1)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.displayNameOverride", result.Error.Code);
        Assert.Contains("128", result.Error.Description, StringComparison.Ordinal);
        VerifyNoCreation();
    }

    [Fact]
    public async Task FromTemplate_when_flag_off_is_not_found()
    {
        var result = await FromTemplateHandler(enabled: false).Handle(
            new CreateStudioAiPlanFromTemplateCommand("gestion-conges", null, null), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("NotFound", result.Error.Code);
        VerifyNoCreation();
    }

    // ---- Doublons de tables existantes (PR 1.3) ----

    private static readonly IReadOnlyList<CustomEntityDefinition> ExistingEmployes = new[]
    {
        CustomEntityDefinition.Create(TenantId, "employes", "Employés", "Employés", null, null, UserId)
    };

    private Mock<ICustomEntityRepository> SetupExistingEntities()
    {
        var entities = new Mock<ICustomEntityRepository>();
        entities.Setup(r => r.ListAsync(TenantId, false, It.IsAny<CancellationToken>()))
            .ReturnsAsync(ExistingEmployes);
        return entities;
    }

    [Fact]
    public async Task Validate_summary_shape_has_duplicates_present_but_empty_without_repository()
    {
        var result = await ValidateHandler().Handle(
            new ValidateStudioAiSpecCommand("CreateSystem", SystemSpec), CancellationToken.None);

        Assert.True(result.IsSuccess);
        // Forme stable pour l'aperçu : « duplicates » TOUJOURS présent, vide sans lecture tenant.
        Assert.NotNull(result.Value.Summary!["duplicates"]);
        Assert.Empty(result.Value.Summary["duplicates"]!.AsArray());
    }

    [Fact]
    public async Task Validate_flags_duplicate_of_a_homonym_existing_table()
    {
        var entities = SetupExistingEntities();

        var result = await ValidateHandler(entities: entities.Object).Handle(
            new ValidateStudioAiSpecCommand("CreateSystem", SystemSpec), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var duplicates = result.Value.Summary!["duplicates"]!.AsArray();
        var hint = Assert.Single(duplicates); // « employes » signalé, « absences » sans doublon
        Assert.Equal("employes", hint!["specRef"]!.GetValue<string>());
        Assert.Equal("employes", hint["existingKey"]!.GetValue<string>());
        Assert.Equal("same_key", hint["reason"]!.GetValue<string>());
        Assert.Contains(result.Value.Summary["warnings"]!.AsArray(),
            w => w!.GetValue<string>().Contains("réutilisez-la", StringComparison.Ordinal));
    }

    [Fact]
    public async Task FromSpec_persists_a_summary_with_duplicate_hints_and_warnings()
    {
        SetupRealCreate();
        var entities = SetupExistingEntities();

        var result = await FromSpecHandler(entities: entities.Object).Handle(
            new CreateStudioAiPlanFromSpecCommand("CreateSystem", SystemSpec), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var summary = JsonNode.Parse(_addedPlan!.SummaryJson)!;
        Assert.Single(summary["duplicates"]!.AsArray());
        Assert.NotEmpty(summary["warnings"]!.AsArray());
    }

    [Fact]
    public async Task FromTemplate_summary_flags_template_tables_matching_tenant_tables()
    {
        SetupRealCreate();
        // Le modèle « gestion-conges » propose une table « employes » (clé identique au tenant).
        var entities = SetupExistingEntities();

        var result = await FromTemplateHandler(entities: entities.Object).Handle(
            new CreateStudioAiPlanFromTemplateCommand("gestion-conges", null, null), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var duplicates = JsonNode.Parse(_addedPlan!.SummaryJson)!["duplicates"]!.AsArray();
        Assert.Contains(duplicates, d => d!["existingKey"]!.GetValue<string>() == "employes");
    }

    // ---- Helpers ----

    /// <summary>Le mediator exécute le VRAI handler de création (permission + audit réels).</summary>
    private void SetupRealCreate()
    {
        var inner = new CreateStudioAiPlanCommandHandler(_plans.Object, _audit.Object, _currentUser.Object);
        _mediator.Setup(m => m.Send(It.IsAny<CreateStudioAiPlanCommand>(), It.IsAny<CancellationToken>()))
            .Returns((CreateStudioAiPlanCommand c, CancellationToken ct) => inner.Handle(c, ct));
        _plans.Setup(p => p.AddAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>()))
            .Callback((StudioAiBuildPlan plan, CancellationToken _) => _addedPlan = plan)
            .Returns(Task.CompletedTask);
    }

    // ---------- PR 2.4 — specs RecordView ----------

    private const string RecordViewSpec = """
        { "entity": "interventions", "name": "Kanban par statut", "mode": "kanban",
          "columns": [ "titre", "statut" ], "groupBy": "statut" }
        """;

    private static IOptions<OllamaSettings> RecordViewSettings(bool recordViewTools = true) =>
        Options.Create(new OllamaSettings
        {
            EnableStudioAiWorkbench = true,
            EnableStudioAiPlanPreview = true,
            EnableStudioRecordViews = true,
            EnableStudioAiRecordViewTools = recordViewTools
        });

    [Fact]
    public void TryCanonicalize_record_view_returns_canonical_and_summary()
    {
        var ok = StudioAiPlanCreation.TryCanonicalize(
            StudioAiPlanKind.RecordView, RecordViewSpec, out var canonical, out var summary, out var error);

        Assert.True(ok, error);
        Assert.NotNull(canonical);
        Assert.NotNull(summary);

        using var doc = System.Text.Json.JsonDocument.Parse(summary!);
        Assert.Equal("RecordView", doc.RootElement.GetProperty("kind").GetString());
        Assert.Equal("Vue « Kanban par statut » sur interventions", doc.RootElement.GetProperty("title").GetString());
        var steps = doc.RootElement.GetProperty("steps").EnumerateArray()
            .Select(s => (key: s.GetProperty("key").GetString(), detail: s.GetProperty("detail").GetString()))
            .ToList();
        Assert.Equal(("target", "interventions"), steps[0]);
        Assert.Equal(("mode", "Kanban"), steps[1]);
        Assert.Equal(("columns", "2"), steps[2]);

        // Le canonique est la forme persistée : re-parse stable.
        Assert.True(StudioAiRecordViewSpec.TryParse(canonical, out var reparsed, out _));
        Assert.Equal(StudioAiSpecCanonical.CanonicalRecordView(reparsed!), canonical);
    }

    [Fact]
    public async Task Validate_record_view_rejected_when_tools_flag_off()
    {
        var handler = new ValidateStudioAiSpecCommandHandler(RecordViewSettings(recordViewTools: false));

        var result = await handler.Handle(
            new ValidateStudioAiSpecCommand("RecordView", RecordViewSpec), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.kind", result.Error.Code);
        Assert.Contains("ne sont pas activées", result.Error.Description);
    }

    [Fact]
    public async Task Validate_record_view_without_schema_gives_reduced_summary()
    {
        // Dépôts absents : le résumé reflète la spec BRUTE (mode demandé, clé de table comme libellé).
        var handler = new ValidateStudioAiSpecCommandHandler(RecordViewSettings());

        var result = await handler.Handle(
            new ValidateStudioAiSpecCommand("RecordView", RecordViewSpec), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Valid);
        Assert.Equal("Vue « Kanban par statut » sur interventions", result.Value.Summary!["title"]!.GetValue<string>());
        Assert.Equal("kanban", result.Value.CanonicalJson!["mode"]!.GetValue<string>());
    }

    [Fact]
    public async Task Validate_record_view_resolves_against_the_real_schema()
    {
        // La table existe mais « statut » est un champ TEXTE : le kanban dégrade en Liste, et le
        // résumé le reflète (QA 61 — jamais un aperçu promettant un kanban impossible).
        var entity = CustomEntityDefinition.Create(TenantId, "interventions", "Interventions", "Interventions", null, null, UserId);
        var entities = new Mock<ICustomEntityRepository>();
        entities.Setup(r => r.GetByKeyAsync(TenantId, "interventions", It.IsAny<CancellationToken>())).ReturnsAsync(entity);
        var fields = new Mock<ICustomFieldRepository>();
        fields.Setup(r => r.ListByEntityAsync(TenantId, entity.Id, false, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<CustomFieldDefinition>
            {
                CustomFieldDefinition.Create(TenantId, entity.Id, "titre", "Titre", CustomFieldType.Text, false, false, 1, null, null, null, UserId),
                CustomFieldDefinition.Create(TenantId, entity.Id, "statut", "Statut", CustomFieldType.Text, false, false, 2, null, null, null, UserId)
            });

        var handler = new ValidateStudioAiSpecCommandHandler(
            RecordViewSettings(), entities.Object, _currentUser.Object, fields.Object);

        var result = await handler.Handle(
            new ValidateStudioAiSpecCommand("RecordView", RecordViewSpec), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var summary = result.Value.Summary!;
        Assert.Equal("Vue « Kanban par statut » sur Interventions", summary["title"]!.GetValue<string>());
        var steps = summary["steps"]!.AsArray()
            .Select(s => (key: s!["key"]!.GetValue<string>(), detail: s["detail"]!.GetValue<string>()))
            .ToList();
        Assert.Equal(("target", "Interventions"), steps[0]);
        Assert.Equal(("mode", "Liste"), steps[1]);
        Assert.Contains(summary["warnings"]!.AsArray().Select(w => w!.GetValue<string>()),
            w => w.Contains("Kanban impossible"));
    }

    [Fact]
    public async Task FromSpec_record_view_creates_pending_plan()
    {
        SetupRealCreate();
        var handler = new CreateStudioAiPlanFromSpecCommandHandler(_mediator.Object, RecordViewSettings());

        var result = await handler.Handle(
            new CreateStudioAiPlanFromSpecCommand("RecordView", RecordViewSpec), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(_addedPlan);
        Assert.Equal(StudioAiPlanKind.RecordView, _addedPlan!.Kind);
        // La spec persistée est la forme canonique ; le résumé est recalculé côté serveur.
        Assert.Equal("kanban", JsonNode.Parse(_addedPlan.SpecJson)!["mode"]!.GetValue<string>());
        Assert.Equal("RecordView", JsonNode.Parse(_addedPlan.SummaryJson)!["kind"]!.GetValue<string>());
    }

    [Fact]
    public async Task FromSpec_record_view_without_flag_creates_nothing()
    {
        SetupRealCreate();
        var handler = new CreateStudioAiPlanFromSpecCommandHandler(
            _mediator.Object, RecordViewSettings(recordViewTools: false));

        var result = await handler.Handle(
            new CreateStudioAiPlanFromSpecCommand("RecordView", RecordViewSpec), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.kind", result.Error.Code);
        Assert.Null(_addedPlan);
    }

    private void VerifyNoCreation()
    {
        _mediator.Verify(m => m.Send(It.IsAny<CreateStudioAiPlanCommand>(), It.IsAny<CancellationToken>()), Times.Never);
        _plans.Verify(p => p.AddAsync(It.IsAny<StudioAiBuildPlan>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private static IOptions<OllamaSettings> Settings(bool enabled) =>
        Microsoft.Extensions.Options.Options.Create(new OllamaSettings { EnableStudioAiWorkbench = enabled });

    private ValidateStudioAiSpecCommandHandler ValidateHandler(bool enabled = true, ICustomEntityRepository? entities = null) =>
        new(Settings(enabled), entities, entities is null ? null : _currentUser.Object);

    private CreateStudioAiPlanFromSpecCommandHandler FromSpecHandler(bool enabled = true, ICustomEntityRepository? entities = null) =>
        new(_mediator.Object, Settings(enabled), entities, entities is null ? null : _currentUser.Object);

    private CreateStudioAiPlanFromTemplateCommandHandler FromTemplateHandler(bool enabled = true, ICustomEntityRepository? entities = null) =>
        new(_mediator.Object, _currentUser.Object, Settings(enabled), entities);
}
