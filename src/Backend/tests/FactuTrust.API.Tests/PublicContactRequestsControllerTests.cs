using System.Net;
using FactuTrust.API.Controllers;
using ApiResponseOfT = FactuTrust.API.Controllers.ApiResponse<object>;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.PublicContact.Commands;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Lot C — mapping contrôleur : 503 quand désactivé (sans appeler le handler), 202 + message de
/// succès, 400 VALIDATION_FAILED sur Validation.*, 400 générique ailleurs, RemoteIp/UserAgent
/// passés à la commande. Le pipeline HTTP complet (429 + Retry-After, 413, 415) reste à
/// couvrir par des tests d'intégration — reliquat TC9, suivi dans le plan lot C.
/// </summary>
public sealed class PublicContactRequestsControllerTests
{
    private static readonly SubmitPublicContactRequestDto ValidDto = new()
    {
        Subject = "demo-cabinet",
        FullName = "Amina Ben Salah",
        Organization = "Cabinet ABC",
        Email = "amina@cabinet.tn",
        Phone = "+21671123456",
        Size = "dossiers:6-20",
        Message = "Nous souhaitons une démonstration de la plateforme.",
        Consent = true,
        Locale = "fr",
        ElapsedMs = 5000,
        TurnstileToken = "token"
    };

    [Fact]
    public async Task Disabled_returns_503_without_calling_the_handler()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        var sut = NewController(mediator, Enabled(false));

        var result = await sut.Submit(ValidDto, CancellationToken.None);

        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(503, objectResult.StatusCode);
        var response = Assert.IsType<ApiResponseOfT>(objectResult.Value);
        Assert.False(response.Success);
        Assert.Equal("Le formulaire de contact est temporairement indisponible.", response.Error);
        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Success_returns_202_and_forwards_transport_metadata()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        SubmitPublicContactRequestCommand? captured = null;
        mediator.Setup(m => m.Send(It.IsAny<SubmitPublicContactRequestCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<SubmitPublicContactRequestResponse>>, CancellationToken>((command, _) => captured = (SubmitPublicContactRequestCommand)command)
            .ReturnsAsync(Result.Success(new SubmitPublicContactRequestResponse("CR-ABCDEF")));
        var sut = NewController(mediator, Enabled(true), remoteIp: "203.0.113.7", userAgent: "Mozilla/5.0");

        var result = await sut.Submit(ValidDto, CancellationToken.None);

        var accepted = Assert.IsType<AcceptedResult>(result);
        var response = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<SubmitPublicContactRequestResponse>>(accepted.Value);
        Assert.True(response.Success);
        Assert.Equal("Demande enregistrée.", response.Message);
        Assert.Equal("CR-ABCDEF", response.Data!.Reference);
        Assert.NotNull(captured);
        Assert.Equal("203.0.113.7", captured!.RemoteIp);
        Assert.Equal("Mozilla/5.0", captured.UserAgent);
        Assert.Equal("demo-cabinet", captured.Subject);
        mediator.Verify(m => m.Send(It.IsAny<SubmitPublicContactRequestCommand>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Forbidden_failure_maps_to_503_with_generic_message()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<SubmitPublicContactRequestCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<SubmitPublicContactRequestResponse>(Error.Forbidden("interne")));
        var sut = NewController(mediator, Enabled(true));

        var result = await sut.Submit(ValidDto, CancellationToken.None);

        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(503, objectResult.StatusCode);
        Assert.Equal("Le formulaire de contact est temporairement indisponible.",
            Assert.IsType<ApiResponseOfT>(objectResult.Value).Error);
    }

    [Fact]
    public async Task Validation_failure_maps_to_400_with_the_message()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<SubmitPublicContactRequestCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<SubmitPublicContactRequestResponse>(Error.Validation("email", "Adresse e-mail invalide.")));
        var sut = NewController(mediator, Enabled(true));

        var result = await sut.Submit(ValidDto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal("Adresse e-mail invalide.", Assert.IsType<ApiResponseOfT>(badRequest.Value).Error);
    }

    [Fact]
    public async Task Other_failure_maps_to_400_generic()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<SubmitPublicContactRequestCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<SubmitPublicContactRequestResponse>(Error.Conflict("interne")));
        var sut = NewController(mediator, Enabled(true));

        var result = await sut.Submit(ValidDto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal("Demande invalide.", Assert.IsType<ApiResponseOfT>(badRequest.Value).Error);
    }

    private static PublicContactRequestsController NewController(
        Mock<IMediator> mediator, IOptions<PublicContactOptions> options, string? remoteIp = null, string? userAgent = null)
    {
        var httpContext = new DefaultHttpContext();
        if (remoteIp is not null)
            httpContext.Connection.RemoteIpAddress = IPAddress.Parse(remoteIp);
        if (userAgent is not null)
            httpContext.Request.Headers.UserAgent = userAgent;
        return new PublicContactRequestsController(mediator.Object, options)
        {
            ControllerContext = new ControllerContext { HttpContext = httpContext }
        };
    }

    private static IOptions<PublicContactOptions> Enabled(bool enabled)
        => Options.Create(new PublicContactOptions { Enabled = enabled });
}
