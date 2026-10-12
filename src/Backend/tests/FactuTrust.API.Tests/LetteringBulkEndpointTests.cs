using System.Reflection;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Moq;
using Xunit;
using ApiResponse = FactuTrust.API.Controllers.ApiResponse<object>;

namespace FactuTrust.API.Tests;

/// <summary>
/// Plan v2, Phase 3 (p3-14) : contrat de <c>POST api/accounting/lettering/bulk</c>. Verbe et route,
/// droit de création comptable, limite de débit et taille de corps dédiées, mappage des codes
/// stables, et commande envoyée sans aucun champ d'origine, de partiel ni d'écart.
/// </summary>
public sealed class LetteringBulkEndpointTests
{
    private static MethodInfo Action =>
        typeof(AccountingController).GetMethod(nameof(AccountingController.BulkLetter))!;

    private static AccountingController NewController(IMediator mediator) => new(mediator, Mock.Of<ICurrentUser>());

    [Fact]
    public void Endpoint_IsAPost_OnLetteringBulk()
    {
        var post = Action.GetCustomAttribute<HttpPostAttribute>();
        Assert.NotNull(post);
        Assert.Equal("lettering/bulk", post!.Template);
        Assert.Null(Action.GetCustomAttribute<HttpGetAttribute>());
    }

    [Fact]
    public void Endpoint_RequiresAccountingCreate()
    {
        var authorize = Action.GetCustomAttribute<AuthorizeAttribute>();
        Assert.NotNull(authorize);
        Assert.Equal(PermissionPolicies.AccountingCreate, authorize!.Policy);
        Assert.Null(Action.GetCustomAttribute<AllowAnonymousAttribute>());
    }

    [Fact]
    public void Endpoint_UsesTheBulkRateLimit_AndABoundedBody()
    {
        Assert.Equal("accounting-bulk", Action.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
        var size = Action.GetCustomAttribute<RequestSizeLimitAttribute>();
        Assert.NotNull(size);
        Assert.Equal(256 * 1024, AccountingController.BulkLetterMaxBodyBytes);
        // 2 000 Guid sérialisés (≈ 40 octets chacun) tiennent largement dans la limite.
        Assert.True(2000 * 40 < AccountingController.BulkLetterMaxBodyBytes);
    }

    [Fact]
    public void Request_CarriesNoOriginPartialOrExchangeField()
    {
        var names = typeof(BulkLetterRequest).GetProperties().Select(p => p.Name)
            .Concat(typeof(BulkLetterRequestGroup).GetProperties().Select(p => p.Name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        Assert.Equal(new[] { "RequestId", "Groups", "ClientKey", "JournalEntryLineIds" }.ToHashSet(StringComparer.OrdinalIgnoreCase), names);
    }

    private static BulkLetteringResultDto PartialReport(Guid requestId) => new(
        requestId, 2, 1, 0, 1, 0, new[]
        {
            new BulkLetteringGroupResultDto("a", BulkLetteringStatuses.Lettered, "L00001", null, null),
            new BulkLetteringGroupResultDto("b", BulkLetteringStatuses.Rejected, null, LetteringErrorCodes.Unbalanced, "Déséquilibré.")
        });

    [Fact]
    public async Task BulkLetter_PartialSuccess_Returns200_AndSendsOnlyRequestIdAndGroups()
    {
        var requestId = Guid.NewGuid();
        var a = new[] { Guid.NewGuid(), Guid.NewGuid() };
        var b = new[] { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() };
        BulkLetterCommand? sent = null;
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<BulkLetterCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<BulkLetteringResultDto>>, CancellationToken>((c, _) => sent = (BulkLetterCommand)c)
            .ReturnsAsync(Result.Success(PartialReport(requestId)));

        var result = await NewController(mediator.Object).BulkLetter(new BulkLetterRequest
        {
            RequestId = requestId,
            Groups = new[]
            {
                new BulkLetterRequestGroup { ClientKey = "a", JournalEntryLineIds = a },
                new BulkLetterRequestGroup { ClientKey = "b", JournalEntryLineIds = b }
            }
        }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<BulkLetteringResultDto>>(ok.Value);
        Assert.Equal(1, body.Data!.Rejected);
        Assert.Equal(requestId, sent!.RequestId);
        Assert.Equal(new[] { "a", "b" }, sent.Groups.Select(g => g.ClientKey));
        Assert.Equal(a, sent.Groups[0].JournalEntryLineIds);
        Assert.Equal(b, sent.Groups[1].JournalEntryLineIds);
    }

    [Theory]
    [InlineData(LetteringErrorCodes.BulkInProgress, 409)]
    [InlineData(LetteringErrorCodes.FeatureDisabled, 400)]
    [InlineData(LetteringErrorCodes.Validation, 400)]
    public async Task BulkLetter_Failure_MapsTheStableCode(string code, int status)
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<BulkLetterCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<BulkLetteringResultDto>(new Error(code, "Refus.")));

        var result = await NewController(mediator.Object).BulkLetter(
            new BulkLetterRequest { RequestId = Guid.NewGuid(), Groups = Array.Empty<BulkLetterRequestGroup>() },
            CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(status, objectResult.StatusCode);
        Assert.Equal(code, Assert.IsType<ApiResponse>(objectResult.Value).Code);
    }

    [Fact]
    public async Task BulkLetter_ValidationException_Returns400_WithLetteringValidationCode()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<BulkLetterCommand>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new FluentValidation.ValidationException(new[]
            {
                new FluentValidation.Results.ValidationFailure("Groups", "Au moins un groupe est requis.")
            }));

        var result = await NewController(mediator.Object).BulkLetter(new BulkLetterRequest(), CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(400, objectResult.StatusCode);
        var body = Assert.IsType<ApiResponse>(objectResult.Value);
        Assert.Equal(LetteringErrorCodes.Validation, body.Code);
        Assert.Equal("Au moins un groupe est requis.", body.Message);
    }

    [Fact]
    public async Task BulkLetter_NullGroupsAndNullElements_ReachTheValidator()
    {
        BulkLetterCommand? sent = null;
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<BulkLetterCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<BulkLetteringResultDto>>, CancellationToken>((c, _) => sent = (BulkLetterCommand)c)
            .ReturnsAsync(Result.Failure<BulkLetteringResultDto>(LetteringErrors.Validation("Refus.")));
        var controller = NewController(mediator.Object);

        await controller.BulkLetter(new BulkLetterRequest { RequestId = Guid.NewGuid(), Groups = null }, CancellationToken.None);
        Assert.Empty(sent!.Groups);

        await controller.BulkLetter(new BulkLetterRequest
        {
            RequestId = Guid.NewGuid(),
            Groups = new BulkLetterRequestGroup[] { null! }
        }, CancellationToken.None);
        Assert.Null(Assert.Single(sent!.Groups));
    }
}
