using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers.Studio;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Relations;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests.Studio;

/// <summary>
/// Contrat des endpoints « relations » d'une table Studio (PR 2.1) : route
/// <c>api/studio/entities/{id:guid}/relations</c>, politique <c>studio:design_entities</c>, garde du flag
/// <c>Ollama:EnableStudioManyToMany</c> (404 sans AUCUN appel MediatR tant qu'il est coupé) et mappage
/// des erreurs Result → HTTP (404 table introuvable, 400 cible invalide / quota, 409 clé de jonction prise).
/// </summary>
/// <remarks>
/// <see cref="FactuTrust.API.Controllers.ApiResponse{T}"/> masque le type Application homonyme dans le
/// namespace des contrôleurs : il est qualifié en entier ici pour lever l'ambiguïté.
/// </remarks>
public sealed class StudioEntityRelationsControllerContractTests
{
    private static readonly Guid EntityId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid TargetId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    [Fact]
    public void Controller_is_routed_under_entity_relations_with_design_policy()
    {
        var route = typeof(StudioEntityRelationsController).GetCustomAttributes(typeof(RouteAttribute), true)
            .Cast<RouteAttribute>().Single();
        Assert.Equal("api/studio/entities/{id:guid}/relations", route.Template);

        var policies = typeof(StudioEntityRelationsController)
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Select(a => a.Policy);
        Assert.Contains(PermissionPolicies.StudioDesignEntities, policies);

        var post = typeof(StudioEntityRelationsController).GetMethod(nameof(StudioEntityRelationsController.CreateManyToMany))!
            .GetCustomAttributes(typeof(HttpPostAttribute), true).Cast<HttpPostAttribute>().Single();
        Assert.Equal("many-to-many", post.Template);

        var get = typeof(StudioEntityRelationsController).GetMethod(nameof(StudioEntityRelationsController.List))!
            .GetCustomAttributes(typeof(HttpGetAttribute), true).Cast<HttpGetAttribute>().Single();
        Assert.Null(get.Template);
    }

    [Fact]
    public async Task Both_endpoints_return_404_and_call_nothing_when_the_flag_is_off()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = CreateController(mediator, manyToManyEnabled: false);

        Assert.IsType<NotFoundObjectResult>(await controller.List(EntityId, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.CreateManyToMany(
            EntityId, new CreateManyToManyRelationRequest(TargetId, null, null, null), CancellationToken.None));

        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task List_returns_the_relations_in_the_envelope()
    {
        var relations = new List<EntityRelationDto>
        {
            new(EntityRelationKinds.ManyToMany, EntityId, "employes", "Employé", TargetId, "projets", "Projet",
                Guid.NewGuid(), "employes", true, false, Guid.NewGuid(), "employes_projets", Guid.NewGuid())
        };
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.Is<ListEntityRelationsQuery>(q => q.EntityId == EntityId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<EntityRelationDto>>(relations));
        var controller = CreateController(mediator, manyToManyEnabled: true);

        var result = await controller.List(EntityId, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<IReadOnlyList<EntityRelationDto>>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("many_to_many", Assert.Single(body.Data!).Kind);
    }

    [Fact]
    public async Task List_returns_404_for_an_unknown_entity()
    {
        var result = await ListFailingWith(Error.NotFound("CustomEntity", EntityId));

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task Create_returns_the_junction_and_both_fields_on_success()
    {
        var junction = new CustomEntityDto(Guid.NewGuid(), "employes_projets", "Employé – Projet", "Employé – Projet", "link", null,
            true, 2, null, DateTime.UtcNow, DateTime.UtcNow, CustomEntityKind.Junction);
        var source = new CustomFieldDto(Guid.NewGuid(), "employes", "Employé", CustomFieldType.RelationCustom, true, false, 0, null, null, new RelationRefDto("custom", "employes"), true);
        var target = new CustomFieldDto(Guid.NewGuid(), "projets", "Projet", CustomFieldType.RelationCustom, true, false, 1, null, null, new RelationRefDto("custom", "projets"), true);
        var request = new CreateManyToManyRelationRequest(TargetId, "Affectations", null, null);

        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(
                It.Is<CreateManyToManyRelationCommand>(c => c.SourceEntityId == EntityId && ReferenceEquals(c.Request, request)),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new ManyToManyRelationDto(junction, source, target)));
        var controller = CreateController(mediator, manyToManyEnabled: true);

        var result = await controller.CreateManyToMany(EntityId, request, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<ManyToManyRelationDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(CustomEntityKind.Junction, body.Data!.Junction.Kind);
        Assert.Equal("employes", body.Data.SourceField.Key);
        Assert.Equal("projets", body.Data.TargetField.Key);
    }

    [Fact]
    public async Task Create_accepts_junction_attribute_label_and_returns_the_attribute_field()
    {
        // v1.1 / D-47-40 : le corps accepte `junctionAttributeLabel` (5ᵉ membre optionnel) et la
        // réponse expose `attributeField` (null par défaut quand l'attribut n'est pas demandé).
        var junction = new CustomEntityDto(Guid.NewGuid(), "employes_projets", "Employé – Projet", "Employé – Projet", "link", null,
            true, 3, null, DateTime.UtcNow, DateTime.UtcNow, CustomEntityKind.Junction);
        var source = new CustomFieldDto(Guid.NewGuid(), "employes", "Employé", CustomFieldType.RelationCustom, true, false, 0, null, null, new RelationRefDto("custom", "employes"), true);
        var target = new CustomFieldDto(Guid.NewGuid(), "projets", "Projet", CustomFieldType.RelationCustom, true, false, 1, null, null, new RelationRefDto("custom", "projets"), true);
        var attribute = new CustomFieldDto(Guid.NewGuid(), "quantit", "Quantité", CustomFieldType.Number, false, false, 2, null, null, null, true);
        var request = new CreateManyToManyRelationRequest(TargetId, "Affectations", null, null, "Quantité");

        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(
                It.Is<CreateManyToManyRelationCommand>(c => c.SourceEntityId == EntityId && ReferenceEquals(c.Request, request)),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new ManyToManyRelationDto(junction, source, target, attribute)));
        var controller = CreateController(mediator, manyToManyEnabled: true);

        var result = await controller.CreateManyToMany(EntityId, request, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<ManyToManyRelationDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(3, body.Data!.Junction.FieldCount);
        Assert.NotNull(body.Data.AttributeField);
        Assert.Equal("quantit", body.Data.AttributeField!.Key);
        Assert.Equal(CustomFieldType.Number, body.Data.AttributeField.FieldType);

        // Sans attribut : AttributeField reste null (contrat v1 inchangé, membre optionnel en fin).
        var legacy = new ManyToManyRelationDto(junction, source, target);
        Assert.Null(legacy.AttributeField);
    }

    [Fact]
    public async Task Create_returns_404_when_the_source_entity_is_unknown()
    {
        var result = await CreateFailingWith(Error.NotFound("CustomEntity", EntityId));

        var notFound = Assert.IsType<NotFoundObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(notFound.Value);
        Assert.False(body.Success);
    }

    [Theory]
    [InlineData("target", "La table cible doit être différente de la table source.")]
    [InlineData("source", "La table source doit être une table standard active.")]
    [InlineData("junctionKey", "La clé doit commencer par une lettre…")]
    [InlineData("quota", "Quota de tables atteint.")]
    public async Task Create_returns_400_with_a_displayable_message_for_validation_errors(string field, string message)
    {
        var result = await CreateFailingWith(Error.Validation(field, message));

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(bad.Value);
        Assert.False(body.Success);
        Assert.Equal(message, body.Error);
    }

    [Fact]
    public async Task Create_returns_409_when_the_junction_key_is_already_taken()
    {
        var result = await CreateFailingWith(Error.Conflict("Une table avec la clé « employes_projets » existe déjà."));

        var conflict = Assert.IsType<ConflictObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(conflict.Value);
        Assert.False(body.Success);
        Assert.Contains("employes_projets", body.Error);
    }

    [Fact]
    public async Task Create_returns_401_when_the_tenant_context_is_missing()
    {
        var result = await CreateFailingWith(Error.Unauthorized("Aucun tenant authentifié."));

        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(401, status.StatusCode);
    }

    // ---- helpers ----

    private static async Task<IActionResult> ListFailingWith(Error error)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<ListEntityRelationsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<IReadOnlyList<EntityRelationDto>>(error));
        return await CreateController(mediator, manyToManyEnabled: true).List(EntityId, CancellationToken.None);
    }

    private static async Task<IActionResult> CreateFailingWith(Error error)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<CreateManyToManyRelationCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<ManyToManyRelationDto>(error));
        return await CreateController(mediator, manyToManyEnabled: true)
            .CreateManyToMany(EntityId, new CreateManyToManyRelationRequest(TargetId, null, null, null), CancellationToken.None);
    }

    private static StudioEntityRelationsController CreateController(Mock<IMediator> mediator, bool manyToManyEnabled) =>
        new(mediator.Object, Options.Create(new OllamaSettings { EnableStudioManyToMany = manyToManyEnabled }));
}
