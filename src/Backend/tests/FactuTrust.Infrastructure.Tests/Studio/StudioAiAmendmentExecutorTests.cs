using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Entities;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Application.Features.Studio.Forms;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Application.Features.Studio.Relations;
using FactuTrust.Application.Features.Studio.Reports;
using FactuTrust.Application.Features.Studio.Systems;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.Studio;
using MediatR;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Application d'une modification approuvée. Points sensibles couverts : le retrait d'un champ passe
/// par la commande de désactivation (données conservées), un échec partiel n'annule pas le reste, et
/// l'ajout d'options complète la liste existante au lieu de la remplacer.
/// </summary>
public sealed class StudioAiAmendmentExecutorTests
{
    private readonly Mock<IMediator> _mediator = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<ICustomEntityRepository> _entities = new();
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid EntityId = Guid.NewGuid();
    private static readonly Guid StatutFieldId = Guid.NewGuid();
    private static readonly Guid NomFieldId = Guid.NewGuid();

    public StudioAiAmendmentExecutorTests()
    {
        _currentUser.Setup(x => x.TenantId).Returns(TenantId);
        _currentUser.Setup(x => x.HasPermission(It.IsAny<string>())).Returns(true);
        _mediator.Setup(m => m.Send(It.IsAny<GetCustomEntitySchemaQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(Schema()));
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(Field("x", "X", CustomFieldType.Text)));
        _mediator.Setup(m => m.Send(It.IsAny<UpdateCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(Field("statut", "Statut", CustomFieldType.Select)));
        _mediator.Setup(m => m.Send(It.IsAny<DeleteCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        _mediator.Setup(m => m.Send(It.IsAny<UpdateCustomEntityCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(Schema().Entity));
        _mediator.Setup(m => m.Send(It.IsAny<UpsertDefaultFormCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new CustomFormDto(Guid.NewGuid(), "f", "F", true, new FormLayout())));
        _mediator.Setup(m => m.Send(It.IsAny<UpsertCustomReportCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new CustomReportDto(Guid.NewGuid(), "r", "R",
                CustomReportDataSourceKind.CustomEntity, "contrats", new ReportDefinition(), true)));
        _mediator.Setup(m => m.Send(It.IsAny<CreateManyToManyRelationCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new ManyToManyRelationDto(
                new CustomEntityDto(Guid.NewGuid(), "contrats_clients", "Contrat – Client", "Contrat – Client",
                    "link", null, true, 2, null, DateTime.UtcNow, DateTime.UtcNow, CustomEntityKind.Junction),
                Field("contrats", "Contrats", CustomFieldType.RelationCustom),
                Field("clients", "Clients", CustomFieldType.RelationCustom))));
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomRecordViewCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((CreateCustomRecordViewCommand c, CancellationToken _) => Result.Success(
                new CustomRecordViewDto(Guid.NewGuid(), c.Request.Key, c.Request.DisplayName, c.Request.Mode,
                    c.Request.Definition, c.Request.IsDefault, true, "AAAA", DateTime.UtcNow)));
    }

    [Fact]
    public async Task Adds_a_field_to_the_existing_table()
    {
        CreateCustomFieldRequest? sent = null;
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result<CustomFieldDto>> c, CancellationToken _) =>
                sent = ((CreateCustomFieldCommand)c).Request)
            .ReturnsAsync(Result.Success(Field("motif_de_refus", "Motif de refus", CustomFieldType.MultilineText)));

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_field", "label": "Motif de refus", "type": "multilinetext" } ] }
        """);

        Assert.True(success, error);
        Assert.Equal("motif_de_refus", sent!.Key);
        Assert.Equal(CustomFieldType.MultilineText, sent.FieldType);
    }

    [Fact]
    public async Task Added_field_key_never_collides_with_an_existing_one()
    {
        CreateCustomFieldRequest? sent = null;
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result<CustomFieldDto>> c, CancellationToken _) =>
                sent = ((CreateCustomFieldCommand)c).Request)
            .ReturnsAsync(Result.Success(Field("statut_2", "Statut", CustomFieldType.Text)));

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "add_field", "label": "Statut", "type": "text" } ] }
        """);

        Assert.True(success, error);
        Assert.Equal("statut_2", sent!.Key);
    }

    [Fact]
    public async Task Removing_a_field_deactivates_it_and_preserves_record_data()
    {
        var (success, error, payload) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "remove_field", "key": "statut" } ] }
        """);

        Assert.True(success, error);
        // La commande de suppression Studio désactive le champ : aucune donnée d'enregistrement n'est touchée.
        _mediator.Verify(m => m.Send(It.Is<DeleteCustomFieldCommand>(c => c.Id == StatutFieldId),
            It.IsAny<CancellationToken>()), Times.Once);
        // (la sérialisation échappe les accents : on compare sur le radical)
        Assert.Contains("conserv", System.Text.Json.JsonSerializer.Serialize(payload), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Added_options_extend_the_existing_list_instead_of_replacing_it()
    {
        UpdateCustomFieldRequest? sent = null;
        _mediator.Setup(m => m.Send(It.IsAny<UpdateCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result<CustomFieldDto>> c, CancellationToken _) =>
                sent = ((UpdateCustomFieldCommand)c).Request)
            .ReturnsAsync(Result.Success(Field("statut", "Statut", CustomFieldType.Select)));

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "update_field", "key": "statut", "addOptions": ["resilie"] } ] }
        """);

        Assert.True(success, error);
        Assert.Equal(new[] { "actif", "resilie" }, sent!.Options!.Select(o => o.Value));
    }

    [Fact]
    public async Task A_failing_operation_does_not_abort_the_remaining_ones()
    {
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomFieldDto>(Error.Validation("field", "quota atteint")));

        var (success, error, payload) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_field", "label": "Nouveau", "type": "text" },
          { "op": "remove_field", "key": "statut" } ] }
        """);

        Assert.True(success, error);
        // Aucune annulation globale : le retrait passe, l'ajout en échec est rapporté en avertissement.
        _mediator.Verify(m => m.Send(It.IsAny<DeleteCustomFieldCommand>(), It.IsAny<CancellationToken>()), Times.Once);
        Assert.Contains("quota atteint", System.Text.Json.JsonSerializer.Serialize(payload));
    }

    [Fact]
    public async Task Nothing_applicable_yields_a_failure_rather_than_a_false_success()
    {
        var (success, error, payload) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "remove_field", "key": "fantome" } ] }
        """);

        Assert.False(success);
        Assert.Null(payload);
        Assert.Contains("introuvable", error);
    }

    [Fact]
    public async Task Unknown_table_fails_without_touching_anything()
    {
        _mediator.Setup(m => m.Send(It.IsAny<GetCustomEntitySchemaQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomEntitySchemaDto>(Error.NotFound("CustomEntity", Guid.Empty)));

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "inconnue" }, "operations": [ { "op": "add_field", "label": "X", "type": "text" } ] }
        """);

        Assert.False(success);
        Assert.Contains("introuvable", error);
        _mediator.Verify(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Progress_is_reported_step_by_step()
    {
        var steps = new List<StudioBuildStep>();

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "add_field", "label": "Note", "type": "text" } ] }
        """, steps: steps);

        Assert.True(success, error);
        Assert.Contains(steps, s => s.Phase == "loading_schema" && s.Status == "done");
        Assert.Contains(steps, s => s.Phase == "adding_field" && s.Status == "running");
        Assert.Contains(steps, s => s.Phase == "completed");
    }

    // ---- PR 3.1b : garde anti-échec-silencieux pour l'automatisation (toujours non exécutable) ----

    [Fact]
    public async Task Set_automation_is_reported_skipped_with_a_warning()
    {
        var steps = new List<StudioBuildStep>();

        var (success, error, payload) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_field", "label": "Note", "type": "text" },
          { "op": "set_automation", "trigger": "on_create", "action": "notify" } ] }
        """, steps: steps);

        Assert.True(success, error); // l'ajout de champ est appliqué, l'automatisation est signalée
        Assert.Contains(steps, s => s.Phase == "skipped_automation" && s.Status == "skipped");
        var warnings = payload!.GetType().GetProperty("warnings")!.GetValue(payload) as IEnumerable<string>;
        Assert.Contains(warnings!, w => w.Contains("set_automation"));
    }

    [Fact]
    public async Task A_plan_with_only_not_yet_executable_operations_fails_loudly()
    {
        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "set_automation", "trigger": "on_create", "action": "notify" } ] }
        """);

        Assert.False(success);
        Assert.Contains("set_automation", error);
        _mediator.Verify(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task An_operation_without_executor_support_fails_loudly()
    {
        // Défensif : une op produite par la spec mais sans cas dans l'exécuteur est une erreur de
        // programmation — elle doit ÉCHOUER BRUYANTEMENT (exception), jamais sauter en silence.
        var spec = new ParsedAmendmentSpec("contrats",
            new ParsedAmendmentOp[] { new FutureOp() }, Array.Empty<string>());

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new StudioAiAmendmentExecutor(_mediator.Object, _currentUser.Object)
                .ExecuteAsync(spec, null, CancellationToken.None));

        Assert.Contains("future_op", ex.Message);
    }

    private sealed record FutureOp() : ParsedAmendmentOp("future_op");

    // ---- PR 3.1c : réorganisation, changement de type, rattachement à un système ----

    [Fact]
    public async Task Reorder_sends_the_complete_order_cited_fields_first_then_the_others()
    {
        ReorderCustomFieldsRequest? sent = null;
        _mediator.Setup(m => m.Send(It.IsAny<ReorderCustomFieldsCommand>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result> c, CancellationToken _) => sent = ((ReorderCustomFieldsCommand)c).Request)
            .ReturnsAsync(Result.Success());

        var steps = new List<StudioBuildStep>();

        var (success, error, payload) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "reorder_fields", "fields": [ "Statut", "fantome" ] } ] }
        """, steps: steps);

        Assert.True(success, error);
        // « Statut » (résolu par libellé) passe en tête ; « nom », non cité, garde sa place ensuite.
        Assert.Equal(new[] { StatutFieldId, NomFieldId }, sent!.OrderedFieldIds);
        Assert.Contains(steps, s => s.Phase == "reordering_fields" && s.Status == "done");
        Assert.Contains("fantome", System.Text.Json.JsonSerializer.Serialize(payload));
    }

    [Fact]
    public async Task Reorder_with_no_known_field_sends_nothing()
    {
        var (success, _, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "reorder_fields", "fields": [ "x", "y" ] } ] }
        """);

        Assert.False(success);
        _mediator.Verify(m => m.Send(It.IsAny<ReorderCustomFieldsCommand>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Change_field_type_targets_the_resolved_field_and_forwards_options()
    {
        ChangeCustomFieldTypeCommand? sent = null;
        _mediator.Setup(m => m.Send(It.IsAny<ChangeCustomFieldTypeCommand>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result<CustomFieldDto>> c, CancellationToken _) => sent = (ChangeCustomFieldTypeCommand)c)
            .ReturnsAsync(Result.Success(Field("nom", "Nom", CustomFieldType.Select)));

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "change_field_type", "key": "nom", "type": "select", "options": [ "A", "B" ] } ] }
        """);

        Assert.True(success, error);
        Assert.Equal(EntityId, sent!.EntityId);
        Assert.Equal(NomFieldId, sent.FieldId);
        Assert.Equal(CustomFieldType.Select, sent.Request.FieldType);
        Assert.Equal(2, sent.Request.Options!.Count);
        Assert.Null(sent.Request.Rules);
    }

    [Fact]
    public async Task Change_field_type_refused_by_the_policy_is_reported_and_does_not_abort()
    {
        _mediator.Setup(m => m.Send(It.IsAny<ChangeCustomFieldTypeCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomFieldDto>(Error.Validation("fieldType", "conversion interdite")));

        var steps = new List<StudioBuildStep>();

        var (success, error, payload) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "change_field_type", "key": "nom", "type": "number" },
          { "op": "remove_field", "key": "statut" } ] }
        """, steps: steps);

        Assert.True(success, error);
        Assert.Contains(steps, s => s.Phase == "changing_field_type" && s.Status == "error");
        Assert.Contains("conversion interdite", System.Text.Json.JsonSerializer.Serialize(payload));
        _mediator.Verify(m => m.Send(It.IsAny<DeleteCustomFieldCommand>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Assign_system_resolves_the_key_then_assigns_the_entity()
    {
        var systemId = Guid.NewGuid();
        _mediator.Setup(m => m.Send(It.Is<GetCustomSystemByKeyQuery>(q => q.Key == "rh"), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new CustomSystemDetailDto(
                new CustomSystemDto(systemId, "rh", "RH", null, null, null, true, 0, DateTime.UtcNow, DateTime.UtcNow),
                Array.Empty<CustomEntityDto>())));
        _mediator.Setup(m => m.Send(It.IsAny<AssignEntityToSystemCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(Schema().Entity));

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "assign_system", "system": "rh" } ] }
        """);

        Assert.True(success, error);
        _mediator.Verify(m => m.Send(It.Is<AssignEntityToSystemCommand>(c => c.EntityId == EntityId && c.SystemId == systemId),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Assign_system_none_detaches_without_looking_up_a_system()
    {
        _mediator.Setup(m => m.Send(It.IsAny<AssignEntityToSystemCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(Schema().Entity));

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "assign_system", "system": "none" } ] }
        """);

        Assert.True(success, error);
        _mediator.Verify(m => m.Send(It.IsAny<GetCustomSystemByKeyQuery>(), It.IsAny<CancellationToken>()), Times.Never);
        _mediator.Verify(m => m.Send(It.Is<AssignEntityToSystemCommand>(c => c.EntityId == EntityId && c.SystemId == null),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Assign_system_with_unknown_key_is_reported_and_assigns_nothing()
    {
        _mediator.Setup(m => m.Send(It.IsAny<GetCustomSystemByKeyQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomSystemDetailDto>(new Error("CustomSystem.NotFound", "introuvable")));

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [ { "op": "assign_system", "system": "inconnu" } ] }
        """);

        Assert.False(success);
        Assert.Contains("inconnu", error);
        _mediator.Verify(m => m.Send(It.IsAny<AssignEntityToSystemCommand>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---- PR 3.1d : add_relation, set_view exécutés ; drapeaux coupés ⇒ skipped SANS envoi ----

    private static readonly OllamaSettings FlagsOn =
        new() { EnableStudioManyToMany = true, EnableStudioRecordViews = true };

    [Fact]
    public async Task Many_to_many_relation_without_the_flag_is_skipped_and_sends_nothing()
    {
        var steps = new List<StudioBuildStep>();

        // Drapeau coupé explicitement ; le dépôt est prêt mais ne doit même pas être sollicité.
        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_relation", "kind": "many_to_many", "target": "clients" } ] }
        """, new OllamaSettings(), _entities.Object, steps: steps);

        Assert.False(success); // rien d'appliqué
        Assert.Contains(steps, s => s.Phase == "adding_relation" && s.Status == "skipped");
        Assert.Contains("plusieurs-à-plusieurs ne sont pas activées", error);
        _mediator.Verify(m => m.Send(It.IsAny<CreateManyToManyRelationCommand>(), It.IsAny<CancellationToken>()), Times.Never);
        _mediator.Verify(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()), Times.Never);
        // Seul envoi : la lecture du schéma.
        Assert.Single(_mediator.Invocations);
        _entities.Verify(r => r.GetByKeyAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Set_view_without_the_flag_is_skipped_and_sends_nothing()
    {
        var steps = new List<StudioBuildStep>();

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "set_view", "mode": "list", "displayName": "Toutes" } ] }
        """, new OllamaSettings(), _entities.Object, steps: steps);

        Assert.False(success);
        Assert.Contains(steps, s => s.Phase == "creating_record_view" && s.Status == "skipped");
        Assert.Contains("vues enregistrées ne sont pas activées", error);
        _mediator.Verify(m => m.Send(It.IsAny<CreateCustomRecordViewCommand>(), It.IsAny<CancellationToken>()), Times.Never);
        Assert.Single(_mediator.Invocations); // lecture du schéma uniquement
    }

    [Fact]
    public async Task Guarded_operations_execute_in_order_when_the_flags_are_on()
    {
        _entities.Setup(r => r.GetByKeyAsync(TenantId, "clients", It.IsAny<CancellationToken>()))
            .ReturnsAsync(TargetEntity());

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_relation", "kind": "many_to_one", "target": "clients" },
          { "op": "add_relation", "kind": "many_to_many", "target": "clients", "label": "Liés", "junctionName": "contrats_clients" },
          { "op": "set_view", "mode": "list", "displayName": "Toutes", "columns": [ "nom" ] } ] }
        """, FlagsOn, _entities.Object);

        Assert.True(success, error);
        var sent = _mediator.Invocations.Select(i => i.Arguments[0].GetType()).ToList();
        var field = sent.IndexOf(typeof(CreateCustomFieldCommand));
        var m2m = sent.IndexOf(typeof(CreateManyToManyRelationCommand));
        var view = sent.IndexOf(typeof(CreateCustomRecordViewCommand));
        Assert.True(field >= 0 && m2m > field && view > m2m,
            $"Ordre attendu champ N-1 → jonction N-N → vue ; reçu : {string.Join(", ", sent.Select(t => t.Name))}");
    }

    [Fact]
    public async Task Many_to_one_relation_creates_a_relation_field_towards_the_target()
    {
        var target = TargetEntity();
        _entities.Setup(r => r.GetByKeyAsync(TenantId, "clients", It.IsAny<CancellationToken>()))
            .ReturnsAsync(target);

        CreateCustomFieldRequest? sent = null;
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result<CustomFieldDto>> c, CancellationToken _) =>
                sent = ((CreateCustomFieldCommand)c).Request)
            .ReturnsAsync(Result.Success(Field("client", "Client", CustomFieldType.RelationCustom)));

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_relation", "kind": "many_to_one", "target": "clients" } ] }
        """, FlagsOn, _entities.Object);

        Assert.True(success, error);
        Assert.NotNull(sent);
        Assert.Equal(CustomFieldType.RelationCustom, sent!.FieldType);
        Assert.Equal("custom", sent.Relation!.Kind);
        Assert.Equal("clients", sent.Relation.Ref);
        // Sans libellé fourni, le champ prend le nom d'affichage de la cible.
        Assert.Equal("Client", sent.Label);
    }

    [Fact]
    public async Task Many_to_many_relation_uses_the_dedicated_command_with_the_resolved_target()
    {
        var target = TargetEntity();
        _entities.Setup(r => r.GetByKeyAsync(TenantId, "clients", It.IsAny<CancellationToken>()))
            .ReturnsAsync(target);

        CreateManyToManyRelationCommand? sent = null;
        _mediator.Setup(m => m.Send(It.IsAny<CreateManyToManyRelationCommand>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result<ManyToManyRelationDto>> c, CancellationToken _) =>
                sent = (CreateManyToManyRelationCommand)c)
            .ReturnsAsync(Result.Success(new ManyToManyRelationDto(
                new CustomEntityDto(Guid.NewGuid(), "contrats_clients", "Contrat – Client", "Contrat – Client",
                    "link", null, true, 2, null, DateTime.UtcNow, DateTime.UtcNow, CustomEntityKind.Junction),
                Field("contrats", "Contrats", CustomFieldType.RelationCustom),
                Field("clients", "Clients", CustomFieldType.RelationCustom))));

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_relation", "kind": "many_to_many", "target": "clients", "label": "Liés", "junctionName": "contrats_clients" } ] }
        """, FlagsOn, _entities.Object);

        Assert.True(success, error);
        Assert.NotNull(sent);
        Assert.Equal(EntityId, sent!.SourceEntityId);
        Assert.Equal(target.Id, sent.Request.TargetEntityId);
        Assert.Equal("Liés", sent.Request.Label);
        Assert.Equal("contrats_clients", sent.Request.JunctionKey);
    }

    [Fact]
    public async Task Set_view_creates_the_view_with_a_slugged_key_free_of_collisions()
    {
        // La table a déjà une vue « vue_toutes » : la clé proposée doit être suffixée.
        _mediator.Setup(m => m.Send(It.IsAny<GetCustomEntitySchemaQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(Schema(views: new[] { ExistingView("vue_toutes") })));

        CreateCustomRecordViewCommand? sent = null;
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomRecordViewCommand>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result<CustomRecordViewDto>> c, CancellationToken _) =>
                sent = (CreateCustomRecordViewCommand)c)
            .ReturnsAsync((CreateCustomRecordViewCommand c, CancellationToken _) => Result.Success(
                new CustomRecordViewDto(Guid.NewGuid(), c.Request.Key, c.Request.DisplayName, c.Request.Mode,
                    c.Request.Definition, c.Request.IsDefault, true, "AAAA", DateTime.UtcNow)));

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "set_view", "mode": "list", "displayName": "Toutes", "columns": [ "nom" ] } ] }
        """, FlagsOn, _entities.Object);

        Assert.True(success, error);
        Assert.NotNull(sent);
        Assert.Equal("contrats", sent!.EntityKey);
        Assert.Equal("vue_toutes_2", sent.Request.Key);
        Assert.Equal("Toutes", sent.Request.DisplayName);
        Assert.Equal(CustomRecordViewMode.List, sent.Request.Mode);
    }

    [Fact]
    public async Task Relation_to_an_unknown_target_is_skipped_with_a_warning()
    {
        _entities.Setup(r => r.GetByKeyAsync(TenantId, "inconnue", It.IsAny<CancellationToken>()))
            .ReturnsAsync((CustomEntityDefinition?)null);

        var steps = new List<StudioBuildStep>();

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_relation", "kind": "many_to_one", "target": "inconnue" } ] }
        """, FlagsOn, _entities.Object, steps: steps);

        Assert.False(success); // rien d'appliqué : la seule op a été sautée
        Assert.Contains(steps, s => s.Phase == "adding_relation" && s.Status == "skipped");
        Assert.Contains("inconnue", error);
        _mediator.Verify(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Relation_to_a_junction_target_is_refused_with_a_warning()
    {
        _entities.Setup(r => r.GetByKeyAsync(TenantId, "contrats_clients", It.IsAny<CancellationToken>()))
            .ReturnsAsync(TargetEntity("contrats_clients", CustomEntityKind.Junction));

        var steps = new List<StudioBuildStep>();

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_relation", "kind": "many_to_one", "target": "contrats_clients" } ] }
        """, FlagsOn, _entities.Object, steps: steps);

        Assert.False(success);
        Assert.Contains(steps, s => s.Phase == "adding_relation" && s.Status == "skipped");
        Assert.Contains("jonction", error);
        _mediator.Verify(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---- Revue 3.1 : garde design_forms sur set_view, échec du handler, dépôt absent ----

    [Fact]
    public async Task Set_view_without_the_design_forms_permission_is_ignored_without_a_step()
    {
        _currentUser.Setup(x => x.HasPermission(Permissions.Studio.DesignForms)).Returns(false);

        var steps = new List<StudioBuildStep>();

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "set_view", "mode": "list", "displayName": "Toutes" } ] }
        """, FlagsOn, _entities.Object, steps: steps);

        Assert.False(success);
        Assert.Contains("permission de conception des formulaires absente", error);
        // Aucune étape annoncée (même règle que set_form) et aucun envoi au-delà de la lecture du schéma.
        Assert.DoesNotContain(steps, st => st.Phase == "creating_record_view");
        _mediator.Verify(m => m.Send(It.IsAny<CreateCustomRecordViewCommand>(), It.IsAny<CancellationToken>()), Times.Never);
        Assert.Single(_mediator.Invocations);
    }

    [Fact]
    public async Task Set_view_refused_by_the_handler_is_reported_and_does_not_abort_the_following_ops()
    {
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomRecordViewCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomRecordViewDto>(Error.Conflict("Cette clé de vue est déjà utilisée.")));
        _mediator.Setup(m => m.Send(It.IsAny<ReorderCustomFieldsCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());

        var steps = new List<StudioBuildStep>();

        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "set_view", "mode": "list", "displayName": "Toutes", "columns": [ "nom" ] },
          { "op": "reorder_fields", "fields": [ "statut", "nom" ] } ] }
        """, FlagsOn, _entities.Object, steps: steps);

        Assert.True(success, error); // l'op suivante a abouti malgré le refus de la vue
        Assert.Contains(steps, st => st.Phase == "creating_record_view" && st.Status == "error");
        Assert.Contains(steps, st => st.Phase == "reordering_fields" && st.Status == "done");
        Assert.Contains(steps, st => st.Phase == "completed" && st.Status == "done");
    }

    [Fact]
    public async Task Relation_without_an_entity_repository_is_skipped_fail_closed()
    {
        var steps = new List<StudioBuildStep>();

        // Dépôt absent (câblage dégradé) : la relation est sautée plutôt que d'échouer ou d'envoyer.
        var (success, error, _) = await Execute("""
        { "target": { "entityKey": "contrats" }, "operations": [
          { "op": "add_relation", "kind": "many_to_one", "target": "clients" } ] }
        """, FlagsOn, entities: null, steps: steps);

        Assert.False(success);
        Assert.Contains(steps, st => st.Phase == "adding_relation" && st.Status == "skipped");
        _mediator.Verify(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private async Task<(bool Success, string? Error, object? Payload)> Execute(
        string json, OllamaSettings? settings = null, ICustomEntityRepository? entities = null,
        List<StudioBuildStep>? steps = null)
    {
        Assert.True(StudioAiAmendmentSpec.TryParse(json, out var spec, out var err), err);
        return await new StudioAiAmendmentExecutor(_mediator.Object, _currentUser.Object, settings, entities)
            .ExecuteAsync(spec!, CaptureSteps(steps), CancellationToken.None);
    }

    /// <summary>Progression factice alimentant <paramref name="steps"/> (null ⇒ pas de progression).</summary>
    private static IStudioBuildProgress? CaptureSteps(List<StudioBuildStep>? steps)
    {
        if (steps is null) return null;
        var progress = new Mock<IStudioBuildProgress>();
        progress.Setup(p => p.Report(It.IsAny<StudioBuildStep>())).Callback((StudioBuildStep s) => steps.Add(s));
        return progress.Object;
    }

    private static CustomEntityDefinition TargetEntity(
        string key = "clients", CustomEntityKind kind = CustomEntityKind.Standard) =>
        CustomEntityDefinition.Create(TenantId, key, "Client", "Clients", null, null, null, null, kind);

    private static CustomRecordViewDto ExistingView(string key) => new(
        Guid.NewGuid(), key, key, CustomRecordViewMode.List,
        new RecordViewDefinition(new[] { new RecordViewColumn("nom") }, Array.Empty<RecordViewFilter>(),
            Array.Empty<RecordViewSort>(), null, null),
        false, true, "AAAA", DateTime.UtcNow);

    private static CustomEntitySchemaDto Schema(IReadOnlyList<CustomRecordViewDto>? views = null) => new(
        new CustomEntityDto(EntityId, "contrats", "Contrat", "Contrats", null, null, true, 2, null,
            DateTime.UtcNow, DateTime.UtcNow),
        new[]
        {
            Field("nom", "Nom", CustomFieldType.Text, id: NomFieldId, sortOrder: 0),
            Field("statut", "Statut", CustomFieldType.Select,
                options: new[] { new SelectOptionDto("actif", "Actif") }, id: StatutFieldId, sortOrder: 1)
        },
        new FormLayout(),
        Views: views);

    private static CustomFieldDto Field(
        string key, string label, CustomFieldType type,
        IReadOnlyList<SelectOptionDto>? options = null, Guid? id = null, int sortOrder = 0) =>
        new(id ?? Guid.NewGuid(), key, label, type, false, false, sortOrder, null, options, null, true);
}
