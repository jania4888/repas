using System.Text.Json.Nodes;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers.Studio;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Records;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests.Studio;

/// <summary>
/// Contrat de <see cref="StudioRecordsController"/> après la PR 2.1 : <c>List</c> transmet le filtre serveur
/// <c>filterField/filterValue</c> et borne <c>pageSize</c> à 1..200 AVANT MediatR ; <c>Create</c>/<c>Update</c>
/// mappent <c>record.duplicate_link</c> → 409 et conservent le 400 historique pour tous les autres codes.
/// </summary>
/// <remarks>
/// <see cref="FactuTrust.API.Controllers.ApiResponse{T}"/> masque le type Application homonyme dans le
/// namespace des contrôleurs : il est qualifié en entier ici pour lever l'ambiguïté.
/// </remarks>
public sealed class StudioRecordsControllerContractTests
{
    private const string EntityKey = "employes_projets";

    [Fact]
    public void Routes_and_policies_are_unchanged()
    {
        var route = typeof(StudioRecordsController).GetCustomAttributes(typeof(RouteAttribute), true)
            .Cast<RouteAttribute>().Single();
        Assert.Equal("api/studio/records/{entityKey}", route.Template);

        static string? PolicyOf(string method) => typeof(StudioRecordsController).GetMethod(method)!
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Select(a => a.Policy)
            .Single();

        Assert.Equal(PermissionPolicies.CustomRecordsRead, PolicyOf(nameof(StudioRecordsController.List)));
        Assert.Equal(PermissionPolicies.CustomRecordsRead, PolicyOf(nameof(StudioRecordsController.Schema)));
        Assert.Equal(PermissionPolicies.CustomRecordsWrite, PolicyOf(nameof(StudioRecordsController.Create)));
        Assert.Equal(PermissionPolicies.CustomRecordsWrite, PolicyOf(nameof(StudioRecordsController.Update)));
        Assert.Equal(PermissionPolicies.CustomRecordsRead, PolicyOf(nameof(StudioRecordsController.History)));

        static string? GetTemplateOf(string method) => typeof(StudioRecordsController).GetMethod(method)!
            .GetCustomAttributes(typeof(HttpGetAttribute), true)
            .Cast<HttpGetAttribute>()
            .Single(a => a.Template is not null)
            .Template;
        Assert.Equal("{id:guid}/history", GetTemplateOf(nameof(StudioRecordsController.History)));
    }

    /// <summary>
    /// 4.7★2 (S1) : surface d'autorisation figée — exactement 8 actions HTTP, chacune avec sa policy explicite
    /// (lecture / écriture), gabarits inchangés ; seule <c>Patch</c> lit le drapeau <c>EnableStudioRecordViews</c>,
    /// <c>History</c> (4.7h2) est servie sans drapeau (complète <c>History_forwards_paging_and_maps_success_without_any_flag</c>).
    /// </summary>
    [Fact]
    public void Action_surface_is_frozen_with_an_explicit_policy_per_action_and_history_reads_no_flag()
    {
        var actions = typeof(StudioRecordsController)
            .GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.DeclaredOnly)
            .Select(m => (Method: m, Http: m.GetCustomAttributes(typeof(HttpMethodAttribute), true).Cast<HttpMethodAttribute>().SingleOrDefault()))
            .Where(x => x.Http is not null)
            .ToDictionary(x => x.Method.Name, x => x);

        var expected = new Dictionary<string, (string Verb, string? Template, string Policy)>
        {
            [nameof(StudioRecordsController.Schema)] = ("GET", "schema", PermissionPolicies.CustomRecordsRead),
            [nameof(StudioRecordsController.List)] = ("GET", null, PermissionPolicies.CustomRecordsRead),
            [nameof(StudioRecordsController.Get)] = ("GET", "{id:guid}", PermissionPolicies.CustomRecordsRead),
            [nameof(StudioRecordsController.Create)] = ("POST", null, PermissionPolicies.CustomRecordsWrite),
            [nameof(StudioRecordsController.Update)] = ("PUT", "{id:guid}", PermissionPolicies.CustomRecordsWrite),
            [nameof(StudioRecordsController.Patch)] = ("PATCH", "{id:guid}", PermissionPolicies.CustomRecordsWrite),
            [nameof(StudioRecordsController.History)] = ("GET", "{id:guid}/history", PermissionPolicies.CustomRecordsRead),
            [nameof(StudioRecordsController.Delete)] = ("DELETE", "{id:guid}", PermissionPolicies.CustomRecordsWrite)
        };

        Assert.Equal(expected.Keys.OrderBy(k => k, StringComparer.Ordinal), actions.Keys.OrderBy(k => k, StringComparer.Ordinal));
        foreach (var (name, (verb, template, policy)) in expected)
        {
            var (method, http) = actions[name];
            Assert.Equal(verb, Assert.Single(http!.HttpMethods));
            Assert.Equal(template, http.Template);
            var authorize = Assert.Single(method.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
                .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>());
            Assert.Equal(policy, authorize.Policy);
            Assert.Empty(method.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AllowAnonymousAttribute), true));
        }

        // Classe : [Authorize] sans policy (authentification), la policy fine est portée par chaque action.
        var classAuthorize = Assert.Single(typeof(StudioRecordsController)
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), false)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>());
        Assert.Null(classAuthorize.Policy);

        // Drapeau : seule Patch dépend d'EnableStudioRecordViews (off ⇒ 404 sans MediatR) ; History n'en lit aucun —
        // preuve comportementale : un contrôleur « tous drapeaux à false » sert quand même l'historique.
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<ListCustomRecordHistoryQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(PagedResult<RecordHistoryEntryDto>.Create(Array.Empty<RecordHistoryEntryDto>(), 1, 20, 0)));
        var controller = CreateController(mediator); // EnableStudioRecordViews = false
        Assert.IsType<OkObjectResult>(controller.History(EntityKey, Guid.NewGuid(), 1, 20, CancellationToken.None).GetAwaiter().GetResult());
        Assert.IsType<NotFoundObjectResult>(controller.Patch(EntityKey, Guid.NewGuid(), new PatchCustomRecordRequest(new Dictionary<string, JsonNode?>(), "AAAAAAAAB9E="), CancellationToken.None).GetAwaiter().GetResult());
        mediator.VerifyAll();
    }

    [Fact]
    public async Task List_forwards_the_server_side_filter_to_the_query()
    {
        ListCustomRecordsQuery? captured = null;
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<ListCustomRecordsQuery>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result<PagedResult<CustomRecordDto>>> q, CancellationToken _) => captured = (ListCustomRecordsQuery)q)
            .ReturnsAsync(Result.Success(PagedResult<CustomRecordDto>.Create(Array.Empty<CustomRecordDto>(), 1, 50, 0)));
        var controller = CreateController(mediator);

        var result = await controller.List(EntityKey, "dupont", 2, 50, "employes", "0f8fad5b-d9cb-469f-a165-70867728950e", CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        Assert.NotNull(captured);
        Assert.Equal(EntityKey, captured!.EntityKey);
        Assert.Equal("dupont", captured.Search);
        Assert.Equal(2, captured.Page);
        Assert.Equal(50, captured.PageSize);
        Assert.Equal("employes", captured.FilterField);
        Assert.Equal("0f8fad5b-d9cb-469f-a165-70867728950e", captured.FilterValue);
        mediator.VerifyAll();
    }

    [Fact]
    public async Task List_without_filter_keeps_the_legacy_shape()
    {
        ListCustomRecordsQuery? captured = null;
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<ListCustomRecordsQuery>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result<PagedResult<CustomRecordDto>>> q, CancellationToken _) => captured = (ListCustomRecordsQuery)q)
            .ReturnsAsync(Result.Success(PagedResult<CustomRecordDto>.Create(Array.Empty<CustomRecordDto>(), 1, 25, 0)));

        await CreateController(mediator).List(EntityKey, null, 1, 25, null, null, CancellationToken.None);

        Assert.NotNull(captured);
        Assert.Null(captured!.FilterField);
        Assert.Null(captured.FilterValue);
        Assert.Equal(25, captured.PageSize);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(-5, 1)]
    [InlineData(200, 200)]
    [InlineData(201, 200)]
    [InlineData(10_000, 200)]
    [InlineData(25, 25)]
    public async Task List_clamps_page_size_to_1_200_before_reaching_the_handler(int requested, int expected)
    {
        ListCustomRecordsQuery? captured = null;
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<ListCustomRecordsQuery>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result<PagedResult<CustomRecordDto>>> q, CancellationToken _) => captured = (ListCustomRecordsQuery)q)
            .ReturnsAsync(Result.Success(PagedResult<CustomRecordDto>.Create(Array.Empty<CustomRecordDto>(), 1, expected, 0)));

        await CreateController(mediator).List(EntityKey, null, 1, requested, null, null, CancellationToken.None);

        Assert.Equal(expected, captured!.PageSize);
    }

    [Fact]
    public async Task List_returns_400_for_an_invalid_filter_field()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<ListCustomRecordsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<PagedResult<CustomRecordDto>>(Error.Validation("filterField", "Champ de filtre inconnu : « nope ».")));

        var result = await CreateController(mediator)
            .List(EntityKey, null, 1, 25, "nope", "x", CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(bad.Value);
        Assert.False(body.Success);
        Assert.Contains("nope", body.Error);
    }

    [Fact]
    public async Task Create_maps_duplicate_link_to_409()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<CreateCustomRecordCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomRecordDto>(new Error(StudioErrorCodes.RecordDuplicateLink, "Ce lien existe déjà entre ces deux enregistrements.")));

        var result = await CreateController(mediator).Create(EntityKey, Payload(), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result);
        Assert.Equal(409, conflict.StatusCode);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<string>>(conflict.Value);
        Assert.False(body.Success);
        Assert.Equal("Ce lien existe déjà entre ces deux enregistrements.", body.Error);
    }

    [Fact]
    public async Task Update_maps_duplicate_link_to_409()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<UpdateCustomRecordCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomRecordDto>(new Error(StudioErrorCodes.RecordDuplicateLink, "Ce lien existe déjà entre ces deux enregistrements.")));

        var result = await CreateController(mediator).Update(EntityKey, Guid.NewGuid(), Payload(), CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result);
    }

    [Theory]
    [InlineData("Validation.employes", "« Employé » est obligatoire.")]
    [InlineData("Validation.entityKey", "Table « employes_projets » introuvable ou inactive.")]
    [InlineData("Validation.quota", "Quota d'enregistrements atteint.")]
    [InlineData("CustomRecord.NotFound", "CustomRecord with ID '…' was not found.")]
    [InlineData("Conflict", "L'enregistrement a été modifié entre-temps.")]
    public async Task Create_and_update_keep_400_for_every_other_error_code(string code, string message)
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<CreateCustomRecordCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomRecordDto>(new Error(code, message)));
        mediator.Setup(m => m.Send(It.IsAny<UpdateCustomRecordCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<CustomRecordDto>(new Error(code, message)));
        var controller = CreateController(mediator);

        var created = Assert.IsType<BadRequestObjectResult>(await controller.Create(EntityKey, Payload(), CancellationToken.None));
        var updated = Assert.IsType<BadRequestObjectResult>(await controller.Update(EntityKey, Guid.NewGuid(), Payload(), CancellationToken.None));

        foreach (var bad in new[] { created, updated })
        {
            var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(bad.Value);
            Assert.False(body.Success);
            Assert.Equal(message, body.Error);
        }
    }

    [Fact]
    public async Task Create_success_returns_the_record_in_the_envelope()
    {
        var dto = new CustomRecordDto(Guid.NewGuid(), JsonNode.Parse("""{"employes":"a","projets":"b"}"""), DateTime.UtcNow, DateTime.UtcNow, null);
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<CreateCustomRecordCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(dto));

        var result = await CreateController(mediator).Create(EntityKey, Payload(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<CustomRecordDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(dto.Id, body.Data!.Id);
    }

    [Fact]
    public async Task History_forwards_paging_and_maps_success_without_any_flag()
    {
        ListCustomRecordHistoryQuery? captured = null;
        var entry = new RecordHistoryEntryDto(Guid.NewGuid(), "Studio.Record.Created",
            new DateTime(2026, 9, 18, 12, 0, 0, DateTimeKind.Utc), "Alice Martin",
            new[] { new RecordHistoryChangeDto("nom", null, "Alpha") });
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<ListCustomRecordHistoryQuery>(), It.IsAny<CancellationToken>()))
            .Callback((IRequest<Result<PagedResult<RecordHistoryEntryDto>>> q, CancellationToken _) => captured = (ListCustomRecordHistoryQuery)q)
            .ReturnsAsync(Result.Success(PagedResult<RecordHistoryEntryDto>.Create(new[] { entry }, 2, 5, 11)));
        var recordId = Guid.NewGuid();

        // Pas de drapeau : le contrôleur par défaut (recordViewsEnabled: false) sert l'historique.
        var result = await CreateController(mediator).History(EntityKey, recordId, 2, 5, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        Assert.NotNull(captured);
        Assert.Equal(EntityKey, captured!.EntityKey);
        Assert.Equal(recordId, captured.RecordId);
        Assert.Equal(2, captured.Page);
        Assert.Equal(5, captured.PageSize);
        mediator.VerifyAll();
    }

    [Fact]
    public async Task History_maps_notfound_to_404_and_validation_to_400()
    {
        var notFound = new Mock<IMediator>();
        notFound.Setup(m => m.Send(It.IsAny<ListCustomRecordHistoryQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<PagedResult<RecordHistoryEntryDto>>(Error.NotFound("CustomRecord", Guid.NewGuid())));
        Assert.IsType<NotFoundObjectResult>(
            await CreateController(notFound).History(EntityKey, Guid.NewGuid(), 1, 20, CancellationToken.None));

        var invalid = new Mock<IMediator>();
        invalid.Setup(m => m.Send(It.IsAny<ListCustomRecordHistoryQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<PagedResult<RecordHistoryEntryDto>>(Error.Validation("entityKey", "Table inconnue.")));
        Assert.IsType<BadRequestObjectResult>(
            await CreateController(invalid).History(EntityKey, Guid.NewGuid(), 1, 20, CancellationToken.None));
    }

    private static StudioRecordsController CreateController(Mock<IMediator> mediator, bool recordViewsEnabled = false) =>
        new(mediator.Object, Microsoft.Extensions.Options.Options.Create(new OllamaSettings { EnableStudioRecordViews = recordViewsEnabled }));

    private static SaveCustomRecordRequest Payload() => new(new Dictionary<string, JsonNode?>
    {
        ["employes"] = JsonValue.Create("0f8fad5b-d9cb-469f-a165-70867728950e"),
        ["projets"] = JsonValue.Create("7c9e6679-7425-40de-944b-e07fc1f90ae7")
    });
}
