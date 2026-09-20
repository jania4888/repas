using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers.Studio;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Systems;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests.Studio;

/// <summary>
/// Contrat des routes export / duplication / import de <see cref="StudioSystemsController"/> (PR 3.3,
/// tranche 3.3d) : gardes de drapeau (404 à message fixe AVANT tout appel au médiateur), politique de
/// classe inchangée, 201 + Location vers le plan créé, téléchargement JSON, borne de taille du corps.
/// </summary>
/// <remarks>
/// <see cref="FactuTrust.API.Controllers.ApiResponse{T}"/> masque le type Application homonyme
/// dans le namespace des contrôleurs : il est qualifié en entier ici pour lever l'ambiguïté.
/// </remarks>
public sealed class StudioSystemsControllerContractTests
{
    private const string ExportOffMessage = "L'export de systèmes Studio n'est pas activé.";
    private const string PlanPreviewOffMessage = "Le flux d'aperçu Studio n'est pas activé.";

    [Fact]
    public void Controller_route_and_policy_are_unchanged()
    {
        var route = typeof(StudioSystemsController).GetCustomAttributes(typeof(RouteAttribute), true)
            .Cast<RouteAttribute>().Single();
        Assert.Equal("api/studio/systems", route.Template);

        var policies = typeof(StudioSystemsController)
            .GetCustomAttributes(typeof(AuthorizeAttribute), true)
            .Cast<AuthorizeAttribute>()
            .Select(a => a.Policy);
        Assert.Contains(PermissionPolicies.StudioDesignEntities, policies);
    }

    [Fact]
    public void Export_duplicate_and_import_carry_no_weaker_authorize_attribute()
    {
        foreach (var name in new[] { nameof(StudioSystemsController.Export), nameof(StudioSystemsController.Duplicate), nameof(StudioSystemsController.Import) })
        {
            var method = typeof(StudioSystemsController).GetMethod(name, BindingFlags.Public | BindingFlags.Instance);
            Assert.NotNull(method);
            Assert.Empty(method!.GetCustomAttributes<AuthorizeAttribute>(inherit: true));
            Assert.Empty(method.GetCustomAttributes<AllowAnonymousAttribute>(inherit: true));
        }
    }

    // ---- Export ----

    [Fact]
    public async Task Export_when_flag_off_is_not_found_and_touches_nothing()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = CreateController(mediator, exportEnabled: false);

        var result = await controller.Export("k", false, false, CancellationToken.None);

        var notFound = Assert.IsType<NotFoundObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(notFound.Value);
        Assert.Equal(ExportOffMessage, body.Error);
        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Export_returns_200_with_dto_envelope()
    {
        var dto = ExportDto("k");
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(
                It.Is<ExportCustomSystemQuery>(q => q.Key == "k" && q.IncludeSeed == false),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(dto));
        var controller = CreateController(mediator);

        var result = await controller.Export("k", false, false, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<StudioSystemExportDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Same(dto, body.Data);
        mediator.Verify(m => m.Send(It.IsAny<ExportCustomSystemQuery>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Export_passes_include_seed_query_to_mediator()
    {
        ExportCustomSystemQuery? captured = null;
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<ExportCustomSystemQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<StudioSystemExportDto>>, CancellationToken>((q, _) => captured = (ExportCustomSystemQuery)q)
            .ReturnsAsync(Result.Success(ExportDto("k")));
        var controller = CreateController(mediator);

        await controller.Export("k", includeSeed: true, download: false, CancellationToken.None);

        Assert.NotNull(captured);
        Assert.Equal("k", captured!.Key);
        Assert.True(captured.IncludeSeed);
    }

    [Fact]
    public async Task Export_download_returns_json_file_with_system_key_in_name()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<ExportCustomSystemQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(ExportDto("k")));
        var controller = CreateController(mediator);

        var result = await controller.Export("k", false, download: true, CancellationToken.None);

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("application/json", file.ContentType);
        Assert.Equal("studio-system-k.json", file.FileDownloadName);
        var text = Encoding.UTF8.GetString(file.FileContents);
        var parsed = JsonNode.Parse(text);
        Assert.NotNull(parsed);
        Assert.Equal(1, parsed!["specVersion"]!.GetValue<int>());
        Assert.Contains("\"specVersion\": 1", text);
        // Spec seule : pas d'enveloppe ApiResponse.
        Assert.Null(parsed["success"]);
        Assert.Null(parsed["data"]);
    }

    [Fact]
    public async Task Export_maps_custom_system_not_found_to_404()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<ExportCustomSystemQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<StudioSystemExportDto>(
                new Error("CustomSystem.NotFound", "Système introuvable.")));
        var controller = CreateController(mediator);

        var result = await controller.Export("k", false, false, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result);
    }

    // ---- Duplicate ----

    [Fact]
    public async Task Duplicate_when_export_flag_off_is_not_found_and_touches_nothing()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = CreateController(mediator, exportEnabled: false, planPreviewEnabled: true);

        var result = await controller.Duplicate("k", null, CancellationToken.None);

        var notFound = Assert.IsType<NotFoundObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(notFound.Value);
        Assert.Equal(ExportOffMessage, body.Error);
        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Duplicate_when_plan_preview_flag_off_is_not_found_and_touches_nothing()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var controller = CreateController(mediator, exportEnabled: true, planPreviewEnabled: false);

        var result = await controller.Duplicate("k", null, CancellationToken.None);

        var notFound = Assert.IsType<NotFoundObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(notFound.Value);
        Assert.Equal(PlanPreviewOffMessage, body.Error);
        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Duplicate_success_returns_201_with_plan_location()
    {
        var planId = Guid.NewGuid();
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<DuplicateCustomSystemCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(PlanResponse(planId)));
        var controller = CreateController(mediator);

        var result = await controller.Duplicate("k", null, CancellationToken.None);

        var created = Assert.IsType<CreatedResult>(result);
        Assert.Equal($"/api/studio/ai/plans/{planId}", created.Location);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<StudioAiPlanCreationResponse>>(created.Value);
        Assert.True(body.Success);
        Assert.Equal(planId, body.Data!.Plan.Id);
        mediator.Verify(m => m.Send(
            It.Is<DuplicateCustomSystemCommand>(c => c.Key == "k"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Duplicate_forwards_optional_display_name()
    {
        var sent = new List<DuplicateCustomSystemCommand>();
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<DuplicateCustomSystemCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<StudioAiPlanCreationResponse>>, CancellationToken>((c, _) => sent.Add((DuplicateCustomSystemCommand)c))
            .ReturnsAsync(Result.Success(PlanResponse(Guid.NewGuid())));
        var controller = CreateController(mediator);

        await controller.Duplicate("k", null, CancellationToken.None);
        await controller.Duplicate("k", new DuplicateCustomSystemRequest("X"), CancellationToken.None);

        Assert.Equal(2, sent.Count);
        Assert.Null(sent[0].DisplayNameOverride);
        Assert.Equal("X", sent[1].DisplayNameOverride);
    }

    // ---- Import ----

    [Fact]
    public async Task Import_when_flags_off_is_not_found_and_touches_nothing()
    {
        var request = new ImportCustomSystemRequest(JsonNode.Parse("{}"));

        var exportOff = new Mock<IMediator>(MockBehavior.Strict);
        var r1 = await CreateController(exportOff, exportEnabled: false, planPreviewEnabled: true)
            .Import(request, CancellationToken.None);
        var nf1 = Assert.IsType<NotFoundObjectResult>(r1);
        Assert.Equal(ExportOffMessage, Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(nf1.Value).Error);
        exportOff.VerifyNoOtherCalls();

        var previewOff = new Mock<IMediator>(MockBehavior.Strict);
        var r2 = await CreateController(previewOff, exportEnabled: true, planPreviewEnabled: false)
            .Import(request, CancellationToken.None);
        var nf2 = Assert.IsType<NotFoundObjectResult>(r2);
        Assert.Equal(PlanPreviewOffMessage, Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(nf2.Value).Error);
        previewOff.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Import_success_returns_201_with_plan_location()
    {
        var planId = Guid.NewGuid();
        var request = new ImportCustomSystemRequest(JsonNode.Parse("""{ "specVersion": 1 }"""), "Copie", IncludeSeed: false);
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(
                It.Is<ImportCustomSystemCommand>(c => ReferenceEquals(c.Request, request)),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(PlanResponse(planId)));
        var controller = CreateController(mediator);

        var result = await controller.Import(request, CancellationToken.None);

        var created = Assert.IsType<CreatedResult>(result);
        Assert.Equal($"/api/studio/ai/plans/{planId}", created.Location);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<StudioAiPlanCreationResponse>>(created.Value);
        Assert.Equal(planId, body.Data!.Plan.Id);
        mediator.Verify(m => m.Send(It.IsAny<ImportCustomSystemCommand>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Import_validation_error_maps_to_400()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<ImportCustomSystemCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<StudioAiPlanCreationResponse>(
                Error.Validation("spec", "La spec est invalide.")));
        var controller = CreateController(mediator);

        var result = await controller.Import(new ImportCustomSystemRequest(null), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public void Import_has_request_size_limit_of_512_kb()
    {
        var method = typeof(StudioSystemsController).GetMethod(nameof(StudioSystemsController.Import));
        Assert.NotNull(method);
        var limit = method!.GetCustomAttribute<RequestSizeLimitAttribute>();
        Assert.NotNull(limit);
        // La borne n'est exposée que via l'implémentation explicite d'IRequestSizeLimitMetadata.
        var bytes = ((Microsoft.AspNetCore.Http.Metadata.IRequestSizeLimitMetadata)limit!).MaxRequestBodySize;
        Assert.Equal(512 * 1024, bytes);
    }

    // ---- Helpers ----

    private static StudioSystemExportDto ExportDto(string key) => new(
        SpecVersion: 1,
        SystemKey: key,
        SystemDisplayName: "Système",
        ExportedAt: DateTime.UtcNow,
        EntityCount: 1,
        RelationCount: 0,
        ViewCount: 0,
        IncludesSeed: false,
        Warnings: Array.Empty<string>(),
        Spec: (JsonObject)JsonNode.Parse("""{ "specVersion": 1, "system": { "displayName": "Système" } }""")!);

    private static StudioAiPlanCreationResponse PlanResponse(Guid planId)
    {
        var now = DateTime.UtcNow;
        return new StudioAiPlanCreationResponse(
            new StudioAiPlanDto(planId, "CreateSystem", "Pending", "{}", null, null, now, now.AddMinutes(60), null),
            new StudioAiPlanSpecDto(planId, "CreateSystem", "Pending", now.AddMinutes(60), "AAAA",
                JsonNode.Parse("""{ "system": { "displayName": "Copie" } }""")!));
    }

    private static StudioSystemsController CreateController(
        Mock<IMediator> mediator, bool exportEnabled = true, bool planPreviewEnabled = true) =>
        new(mediator.Object, Options.Create(new OllamaSettings
        {
            EnableStudioSystemExport = exportEnabled,
            EnableStudioAiPlanPreview = planPreviewEnabled
        }));
}
