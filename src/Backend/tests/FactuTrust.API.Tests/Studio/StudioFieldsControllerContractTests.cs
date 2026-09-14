using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers.Studio;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests.Studio;

/// <summary>
/// Contrat des endpoints « changement de type de champ » (PR 3.1) :
/// <c>GET api/studio/entities/{entityId:guid}/fields/{fieldId:guid}/type-check</c> et
/// <c>PATCH api/studio/entities/{entityId:guid}/fields/{fieldId:guid}/type</c>. Aucun flag (ils
/// prolongent le CRUD existant sous <c>studio:design_entities</c>) ; <c>to</c> est analysé par NOM
/// d'énumération exact (jamais numérique) ; les erreurs Result sont mappées via
/// <see cref="StudioErrorMapping"/> (404 sur <c>*.NotFound</c>, 400 sur le reste dont
/// <c>Validation.*</c>, message serveur intact).
/// </summary>
/// <remarks>
/// <see cref="FactuTrust.API.Controllers.ApiResponse{T}"/> masque le type Application homonyme dans le
/// namespace des contrôleurs : il est qualifié en entier ici pour lever l'ambiguïté.
/// </remarks>
public sealed class StudioFieldsControllerContractTests
{
    private static readonly Guid EntityId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid FieldId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    [Fact]
    public void Controller_is_routed_under_entity_fields_with_design_policy()
    {
        var route = typeof(StudioFieldsController).GetCustomAttributes(typeof(RouteAttribute), true)
            .Cast<RouteAttribute>().Single();
        Assert.Equal("api/studio/entities/{entityId:guid}/fields", route.Template);

        var policies = typeof(StudioFieldsController)
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Select(a => a.Policy);
        Assert.Contains(PermissionPolicies.StudioDesignEntities, policies);

        var typeCheck = typeof(StudioFieldsController).GetMethod(nameof(StudioFieldsController.TypeCheck))!
            .GetCustomAttributes(typeof(HttpGetAttribute), true).Cast<HttpGetAttribute>().Single();
        Assert.Equal("{fieldId:guid}/type-check", typeCheck.Template);

        var changeType = typeof(StudioFieldsController).GetMethod(nameof(StudioFieldsController.ChangeType))!
            .GetCustomAttributes(typeof(HttpPatchAttribute), true).Cast<HttpPatchAttribute>().Single();
        Assert.Equal("{fieldId:guid}/type", changeType.Template);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("42")]
    [InlineData("0")]
    [InlineData("3")]
    [InlineData("-1")]
    [InlineData("NotAType")]
    public async Task TypeCheck_returns_400_Validation_to_for_missing_or_unparseable_to(string? to)
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = new StudioFieldsController(mediator.Object);

        var result = await controller.TypeCheck(EntityId, FieldId, to, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(bad.Value);
        Assert.False(body.Success);
        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task TypeCheck_returns_200_with_the_check_payload()
    {
        var dto = new FieldTypeChangeCheckDto("Text", "Number", "requires_empty_table", 12, "Ce changement exige une table vide.", false);
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.Is<CheckCustomFieldTypeChangeQuery>(q =>
                q.EntityId == EntityId && q.FieldId == FieldId && q.To == CustomFieldType.Number),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(dto));
        var controller = new StudioFieldsController(mediator.Object);

        var result = await controller.TypeCheck(EntityId, FieldId, "number", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<FieldTypeChangeCheckDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("Text", body.Data!.From);
        Assert.Equal("Number", body.Data.To);
        Assert.Equal("requires_empty_table", body.Data.Policy);
        Assert.Equal(12, body.Data.RecordCount);
        Assert.False(body.Data.Allowed);
    }

    [Fact]
    public async Task TypeCheck_returns_404_when_the_field_is_unknown()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<CheckCustomFieldTypeChangeQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<FieldTypeChangeCheckDto>(Error.NotFound("CustomField", FieldId)));
        var controller = new StudioFieldsController(mediator.Object);

        var result = await controller.TypeCheck(EntityId, FieldId, "Number", CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task ChangeType_returns_200_with_the_updated_field_on_success()
    {
        var dto = new CustomFieldDto(FieldId, "champ", "Champ", CustomFieldType.Decimal, false, false, 0, null, null, null, true);
        var request = new ChangeCustomFieldTypeRequest(CustomFieldType.Decimal);
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(
                It.Is<ChangeCustomFieldTypeCommand>(c => c.EntityId == EntityId && c.FieldId == FieldId && ReferenceEquals(c.Request, request)),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(dto));
        var controller = new StudioFieldsController(mediator.Object);

        var result = await controller.ChangeType(EntityId, FieldId, request, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<CustomFieldDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(CustomFieldType.Decimal, body.Data!.FieldType);
    }

    [Fact]
    public async Task ChangeType_returns_400_with_the_server_message_intact_on_Validation_fieldType()
    {
        const string message = "Ce changement exige une table vide (3 enregistrement(s)). Videz-la ou créez un nouveau champ.";
        var result = await ChangeTypeFailingWith(Error.Validation("fieldType", message));

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(bad.Value);
        Assert.False(body.Success);
        Assert.Equal(message, body.Error);
    }

    [Fact]
    public async Task ChangeType_returns_404_when_the_field_belongs_to_another_entity()
    {
        var result = await ChangeTypeFailingWith(Error.NotFound("CustomField", FieldId));

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task ChangeType_returns_401_when_the_tenant_context_is_missing()
    {
        var result = await ChangeTypeFailingWith(Error.Unauthorized("Aucun tenant authentifié."));

        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(401, status.StatusCode);
    }

    [Fact]
    public async Task ChangeType_returns_403_when_forbidden()
    {
        var result = await ChangeTypeFailingWith(Error.Forbidden("Accès refusé."));

        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(403, status.StatusCode);
    }

    // ---- helpers ----

    private static async Task<IActionResult> ChangeTypeFailingWith(Error error)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<ChangeCustomFieldTypeCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomFieldDto>(error));
        var controller = new StudioFieldsController(mediator.Object);
        return await controller.ChangeType(EntityId, FieldId, new ChangeCustomFieldTypeRequest(CustomFieldType.Decimal), CancellationToken.None);
    }
}
