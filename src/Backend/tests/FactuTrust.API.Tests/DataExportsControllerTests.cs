using System.Net;
using System.Reflection;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers;
using FactuTrust.Application.Features.DataExports;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests;

public sealed class DataExportsControllerTests
{
    [Fact]
    public void Endpoint_RequiresAuthentication_AndTheDataExportLimiter()
    {
        var authorize = typeof(DataExportsController).GetCustomAttribute<AuthorizeAttribute>();
        var limiter = typeof(DataExportsController).GetCustomAttribute<EnableRateLimitingAttribute>();
        var clients = typeof(DataExportsController).GetMethod(nameof(DataExportsController.ExportClients))!;

        Assert.NotNull(authorize);
        Assert.Equal("data-export", limiter!.PolicyName);
        Assert.Equal(
            PermissionPolicies.ClientsRead,
            clients.GetCustomAttribute<AuthorizeAttribute>()!.Policy);
    }

    [Fact]
    public async Task ExportClients_ReturnsXlsxAttachment_WhenTheHandlerSucceeds()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<ExportBusinessDatasetQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new BusinessExportFile(new byte[] { 1, 2, 3 }, "Clients_20261016_1430.xlsx")));
        var controller = new DataExportsController(mediator.Object);

        var result = await controller.ExportClients(null, null, null, null, CancellationToken.None);

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal(BusinessExportFile.ExcelContentType, file.ContentType);
        Assert.Equal("Clients_20261016_1430.xlsx", file.FileDownloadName);

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IActionResultExecutor<FileContentResult>, FileContentResultExecutor>();
        var http = new Microsoft.AspNetCore.Http.DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider()
        };
        await file.ExecuteResultAsync(new ActionContext(http, new RouteData(), new Microsoft.AspNetCore.Mvc.Abstractions.ActionDescriptor()));

        var disposition = http.Response.Headers.ContentDisposition.ToString();
        Assert.Contains("attachment", disposition, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Clients_20261016_1430.xlsx", disposition);
    }

    [Fact]
    public async Task ExportClients_Returns400_WithTooManyRowsCode()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(m => m.Send(It.IsAny<ExportBusinessDatasetQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<BusinessExportFile>(new Error(
                BusinessDataExportErrors.TooManyRows,
                "La feuille « Clients » contient 20001 lignes, au-delà du plafond de 20000. Affinez la période ou les filtres.")));
        var controller = new DataExportsController(mediator.Object);

        var result = await controller.ExportClients(null, null, null, null, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        var body = Assert.IsType<ApiResponse<object>>(badRequest.Value);
        Assert.Equal(BusinessDataExportErrors.TooManyRows, body.Code);
        Assert.Contains("20001", body.Error);
    }
}

[Collection("SqlServerIntegration")]
public sealed class DataExportsAuthenticationTests : IClassFixture<ChannelsDisabledWebApplicationFactory>
{
    private readonly ChannelsDisabledWebApplicationFactory _factory;

    public DataExportsAuthenticationTests(ChannelsDisabledWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task ClientsExport_RequiresAToken()
    {
        var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false
        });

        var response = await client.GetAsync("/api/data-exports/clients");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
