using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers.Studio;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.RecordViews;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests.Studio;

/// <summary>
/// Contrat du contrôleur des vues enregistrées (PR 2.3) : route
/// <c>api/studio/records/{entityKey}/views</c>, policies lecture <c>custom_records:read</c> / conception
/// <c>studio:design_forms</c>, garde du drapeau <c>Ollama:EnableStudioRecordViews</c> (404 sans AUCUN
/// appel MediatR tant qu'il est coupé) et mappage Result → HTTP (400 validation, 404 introuvable,
/// 409 RowVersion périmée / clé prise).
/// </summary>
/// <remarks>
/// <see cref="FactuTrust.API.Controllers.ApiResponse{T}"/> masque le type Application homonyme dans le
/// namespace des contrôleurs : il est qualifié en entier ici pour lever l'ambiguïté.
/// </remarks>
public sealed class StudioRecordViewsControllerContractTests
{
    private const string EntityKey = "chantiers";
    private static readonly Guid ViewId = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");

    private static readonly RecordViewDefinition ListDefinition = new(
        new[] { new RecordViewColumn("nom") },
        Array.Empty<RecordViewFilter>(), Array.Empty<RecordViewSort>(), null, null);

    private static readonly CustomRecordViewDto ViewDto = new(
        ViewId, "encours", "En cours", CustomRecordViewMode.List, ListDefinition, IsDefault: true, IsActive: true,
        Convert.ToBase64String(new byte[] { 0, 0, 0, 0, 0, 0, 0, 1 }), DateTime.UtcNow);

    [Fact]
    public void Controller_is_routed_under_record_views_with_the_expected_policies()
    {
        var route = typeof(StudioRecordViewsController).GetCustomAttributes(typeof(RouteAttribute), true)
            .Cast<RouteAttribute>().Single();
        Assert.Equal("api/studio/records/{entityKey}/views", route.Template);

        static string? PolicyOf(string method) => typeof(StudioRecordViewsController).GetMethod(method)!
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Select(a => a.Policy)
            .Single();

        Assert.Equal(PermissionPolicies.CustomRecordsRead, PolicyOf(nameof(StudioRecordViewsController.List)));
        Assert.Equal(PermissionPolicies.CustomRecordsRead, PolicyOf(nameof(StudioRecordViewsController.Get)));
        Assert.Equal(PermissionPolicies.CustomRecordsRead, PolicyOf(nameof(StudioRecordViewsController.Run)));
        Assert.Equal(PermissionPolicies.StudioDesignForms, PolicyOf(nameof(StudioRecordViewsController.Create)));
        Assert.Equal(PermissionPolicies.StudioDesignForms, PolicyOf(nameof(StudioRecordViewsController.Update)));
        Assert.Equal(PermissionPolicies.StudioDesignForms, PolicyOf(nameof(StudioRecordViewsController.Delete)));
        Assert.Equal(PermissionPolicies.StudioDesignForms, PolicyOf(nameof(StudioRecordViewsController.SetDefault)));
        Assert.Equal(PermissionPolicies.StudioDesignForms, PolicyOf(nameof(StudioRecordViewsController.Preview)));

        // Routes
        Assert.Null(typeof(StudioRecordViewsController).GetMethod(nameof(StudioRecordViewsController.List))!
            .GetCustomAttributes(typeof(HttpGetAttribute), true).Cast<HttpGetAttribute>().Single().Template);
        Assert.Equal("{id:guid}", typeof(StudioRecordViewsController).GetMethod(nameof(StudioRecordViewsController.Get))!
            .GetCustomAttributes(typeof(HttpGetAttribute), true).Cast<HttpGetAttribute>().Single().Template);
        Assert.Equal("{id:guid}/default", typeof(StudioRecordViewsController).GetMethod(nameof(StudioRecordViewsController.SetDefault))!
            .GetCustomAttributes(typeof(HttpPostAttribute), true).Cast<HttpPostAttribute>().Single().Template);
        Assert.Equal("{id:guid}/run", typeof(StudioRecordViewsController).GetMethod(nameof(StudioRecordViewsController.Run))!
            .GetCustomAttributes(typeof(HttpPostAttribute), true).Cast<HttpPostAttribute>().Single().Template);
        Assert.Equal("preview", typeof(StudioRecordViewsController).GetMethod(nameof(StudioRecordViewsController.Preview))!
            .GetCustomAttributes(typeof(HttpPostAttribute), true).Cast<HttpPostAttribute>().Single().Template);
    }

    [Fact]
    public async Task Every_route_returns_404_and_calls_nothing_when_the_flag_is_off()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = CreateController(mediator, recordViewsEnabled: false);

        Assert.IsType<NotFoundObjectResult>(await controller.List(EntityKey, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.Get(EntityKey, ViewId, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.Create(EntityKey, Save(), CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.Update(EntityKey, ViewId, Save(), CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.Delete(EntityKey, ViewId, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.SetDefault(EntityKey, ViewId, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.Run(EntityKey, ViewId, new RunRecordViewRequest(), CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await controller.Preview(EntityKey, Preview(), CancellationToken.None));

        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task List_returns_the_views_in_the_envelope()
    {
        var views = new List<CustomRecordViewDto> { ViewDto };
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.Is<ListCustomRecordViewsQuery>(q => q.EntityKey == EntityKey), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<CustomRecordViewDto>>(views));

        var result = await CreateController(mediator, recordViewsEnabled: true).List(EntityKey, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<IReadOnlyList<CustomRecordViewDto>>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal("encours", Assert.Single(body.Data!).Key);
    }

    [Fact]
    public async Task Create_returns_201_with_the_created_view()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<CreateCustomRecordViewCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(ViewDto));

        var result = await CreateController(mediator, recordViewsEnabled: true).Create(EntityKey, Save(), CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal(201, created.StatusCode);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<CustomRecordViewDto>>(created.Value);
        Assert.Equal(ViewId, body.Data!.Id);
    }

    [Fact]
    public async Task Create_returns_409_when_the_key_is_taken()
    {
        var result = await CreateFailingWith(Error.Conflict("Une vue avec la clé « encours » existe déjà pour cette table."));

        Assert.IsType<ConflictObjectResult>(result);
    }

    [Fact]
    public async Task Create_returns_400_for_a_validation_error()
    {
        var result = await CreateFailingWith(Error.Validation("key", "La clé est invalide."));

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(bad.Value);
        Assert.False(body.Success);
    }

    [Fact]
    public async Task Preview_returns_400_for_a_validation_error()
    {
        // Miroir de Create_returns_400 : le 400 du validateur (définition du brouillon refusée)
        // est mappé par StudioErrorMapping comme au run.
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<PreviewCustomRecordViewQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<RecordViewRunResultDto>(Error.Validation("pageSize", "La taille de page doit être comprise entre 1 et 200.")));

        var result = await CreateController(mediator, recordViewsEnabled: true)
            .Preview(EntityKey, Preview(), CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(bad.Value);
        Assert.False(body.Success);
        Assert.Equal("La taille de page doit être comprise entre 1 et 200.", body.Error);
    }

    [Fact]
    public async Task Update_returns_409_when_the_row_version_is_stale()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<UpdateCustomRecordViewCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomRecordViewDto>(Error.Conflict("La vue a été modifiée entre-temps.")));

        var result = await CreateController(mediator, recordViewsEnabled: true).Update(EntityKey, ViewId, Save(), CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result);
    }

    [Fact]
    public async Task Get_and_run_return_404_for_an_unknown_view()
    {
        var notFound = Error.NotFound("CustomRecordView", ViewId);

        var getMediator = new Mock<IMediator>();
        getMediator.Setup(m => m.Send(It.IsAny<GetCustomRecordViewQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomRecordViewDto>(notFound));
        Assert.IsType<NotFoundObjectResult>(await CreateController(getMediator, true).Get(EntityKey, ViewId, CancellationToken.None));

        var runMediator = new Mock<IMediator>();
        runMediator.Setup(m => m.Send(It.IsAny<RunCustomRecordViewQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<RecordViewRunResultDto>(notFound));
        Assert.IsType<NotFoundObjectResult>(await CreateController(runMediator, true).Run(EntityKey, ViewId, new RunRecordViewRequest(), CancellationToken.None));
    }

    [Fact]
    public async Task Delete_and_set_default_return_204_on_success()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<DeleteCustomRecordViewCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(true));
        mediator.Setup(m => m.Send(It.IsAny<SetDefaultCustomRecordViewCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(true));
        var controller = CreateController(mediator, recordViewsEnabled: true);

        Assert.IsType<NoContentResult>(await controller.Delete(EntityKey, ViewId, CancellationToken.None));
        Assert.IsType<NoContentResult>(await controller.SetDefault(EntityKey, ViewId, CancellationToken.None));
    }

    // ---- helpers ----

    private static async Task<IActionResult> CreateFailingWith(Error error)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<CreateCustomRecordViewCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomRecordViewDto>(error));
        return await CreateController(mediator, recordViewsEnabled: true).Create(EntityKey, Save(), CancellationToken.None);
    }

    private static PreviewRecordViewRequest Preview() =>
        new(CustomRecordViewMode.List, ListDefinition);

    private static SaveCustomRecordViewRequest Save() =>
        new("encours", "En cours", CustomRecordViewMode.List, ListDefinition);

    private static StudioRecordViewsController CreateController(Mock<IMediator> mediator, bool recordViewsEnabled) =>
        new(mediator.Object, Options.Create(new OllamaSettings { EnableStudioRecordViews = recordViewsEnabled }));
}
