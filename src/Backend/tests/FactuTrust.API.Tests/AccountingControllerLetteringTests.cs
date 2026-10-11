using FactuTrust.API.Controllers;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Domain.Common;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Plan de refonte du lettrage (Phase 1, Annexe A §4.6) : vérifie le mappage des codes d'erreur
/// stables de <see cref="LetteringErrorCodes"/> vers les statuts HTTP attendus par
/// <c>AccountingController.LetteringFailure</c>, ainsi que le chemin de succès des nouveaux
/// points d'entrée de lecture (<c>GetLetteringLines</c>, <c>GetLetteringGroup</c>) et d'action
/// (<c>CompletePartialLettering</c>). Contrôleur construit directement (pas de WebApplicationFactory,
/// pas de SQL Server dans ce bac à sable) avec un <see cref="IMediator"/> simulé.
/// </summary>
public sealed class AccountingControllerLetteringTests
{
    private static AccountingController NewController(IMediator mediator) =>
        new(mediator, Mock.Of<ICurrentUser>());

    // ---- Mappage LetteringFailure (plan §4.6) ----

    [Theory]
    [InlineData(LetteringErrorCodes.AlreadyLettered, 409)]
    [InlineData(LetteringErrorCodes.PeriodLocked, 409)]
    [InlineData(LetteringErrorCodes.GroupNotFound, 404)]
    [InlineData(LetteringErrorCodes.Validation, 400)]
    [InlineData(LetteringErrorCodes.Unbalanced, 400)]
    [InlineData(LetteringErrorCodes.AccountMismatch, 400)]
    public async Task Letter_MapsErrorCode_ToExpectedStatus(string code, int expectedStatus)
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<LetterAccountEntriesCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<LetteringResultDto>(new Error(code, "message de test")));
        var controller = NewController(mediator.Object);

        var result = await controller.Letter(
            new LetterEntriesRequest { JournalEntryLineIds = new[] { Guid.NewGuid() } }, CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(expectedStatus, objectResult.StatusCode);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(objectResult.Value);
        Assert.False(body.Success);
        Assert.Equal(code, body.Code);
    }

    [Fact]
    public async Task Letter_Success_ReturnsOk_WithResultDto()
    {
        var dto = new LetteringResultDto("L00001", Guid.NewGuid(), false, 2, null);
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<LetterAccountEntriesCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(dto));
        var controller = NewController(mediator.Object);

        var result = await controller.Letter(
            new LetterEntriesRequest { JournalEntryLineIds = new[] { Guid.NewGuid(), Guid.NewGuid() } },
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<LetteringResultDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(dto, body.Data);
    }

    // ---- GetLetteringLines (plan §4.1) ----

    [Fact]
    public async Task GetLetteringLines_Success_ReturnsOk_WithPageDto()
    {
        var page = new LetteringLinesPageDto(
            Array.Empty<LetteringLineDto>(), 1, 500, 0, false,
            new LetteringTotalsDto(0, 0, 0, 0m, 0m, 0m, 0m, 0m, 0m, null, null, null));
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<GetLetteringLinesQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(page));
        var controller = NewController(mediator.Object);

        var result = await controller.GetLetteringLines(
            account: "411000", cancellationToken: CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<LetteringLinesPageDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(page, body.Data);
    }

    [Fact]
    public async Task GetLetteringLines_Failure_IsMappedByLetteringFailure()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<GetLetteringLinesQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<LetteringLinesPageDto>(
                new Error(LetteringErrorCodes.Validation, "Compte requis")));
        var controller = NewController(mediator.Object);

        var result = await controller.GetLetteringLines(
            account: "", cancellationToken: CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(400, objectResult.StatusCode);
    }

    // ---- GetLetteringGroup (plan §4.2) ----

    [Fact]
    public async Task GetLetteringGroup_Success_ReturnsOk_WithGroupDto()
    {
        var group = new LetteringGroupDto(
            Guid.NewGuid(), "L00001", "411000", 100m, "TND", false,
            DateTime.UtcNow, "Jean Test", Array.Empty<LetteringLineDto>(), true, null, false);
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.Is<GetLetteringGroupQuery>(q => q.Code == "L00001"), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(group));
        var controller = NewController(mediator.Object);

        var result = await controller.GetLetteringGroup("L00001", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<LetteringGroupDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(group, body.Data);
    }

    [Fact]
    public async Task GetLetteringGroup_NotFound_Returns404()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<GetLetteringGroupQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<LetteringGroupDto>(
                new Error(LetteringErrorCodes.GroupNotFound, "Groupe introuvable")));
        var controller = NewController(mediator.Object);

        var result = await controller.GetLetteringGroup("INCONNU", CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(404, objectResult.StatusCode);
    }

    // ---- CompletePartialLettering (plan §4.4, D7) ----

    [Fact]
    public async Task CompletePartialLettering_Success_ReturnsOk_WithResultDto()
    {
        var dto = new LetteringResultDto("L00002", Guid.NewGuid(), false, 3, "P00001");
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(
                It.Is<CompletePartialLetteringCommand>(c => c.Code == "P00001"), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(dto));
        var controller = NewController(mediator.Object);

        var result = await controller.CompletePartialLettering(
            "P00001", new CompletePartialLetteringRequest { JournalEntryLineIds = new[] { Guid.NewGuid() } },
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<LetteringResultDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(dto, body.Data);
    }

    [Fact]
    public async Task CompletePartialLettering_GroupNotPartial_Returns400()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<CompletePartialLetteringCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<LetteringResultDto>(
                new Error(LetteringErrorCodes.GroupNotPartial, "Le groupe n'est pas partiel")));
        var controller = NewController(mediator.Object);

        var result = await controller.CompletePartialLettering(
            "L00001", new CompletePartialLetteringRequest { JournalEntryLineIds = new[] { Guid.NewGuid() } },
            CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(400, objectResult.StatusCode);
    }

    [Fact]
    public async Task CompletePartialLettering_PeriodLocked_Returns409()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<CompletePartialLetteringCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<LetteringResultDto>(
                new Error(LetteringErrorCodes.PeriodLocked, "Période clôturée")));
        var controller = NewController(mediator.Object);

        var result = await controller.CompletePartialLettering(
            "P00001", new CompletePartialLetteringRequest { JournalEntryLineIds = new[] { Guid.NewGuid() } },
            CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(409, objectResult.StatusCode);
    }

    // ---- Unletter (policy accounting:unletter, plan §4.5) ----

    [Fact]
    public async Task Unletter_Success_ReturnsOk_True()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.Is<UnletterAccountEntriesCommand>(c => c.Code == "L00001"), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        var controller = NewController(mediator.Object);

        var result = await controller.Unletter(new UnletterEntriesRequest { Code = "L00001" }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<bool>>(ok.Value);
        Assert.True(body.Success);
        Assert.True(body.Data);
    }

    [Fact]
    public async Task Unletter_AlreadyLettered_Returns409()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<UnletterAccountEntriesCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure(new Error(LetteringErrorCodes.AlreadyLettered, "Déjà lettré")));
        var controller = NewController(mediator.Object);

        var result = await controller.Unletter(new UnletterEntriesRequest { Code = "L00001" }, CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(409, objectResult.StatusCode);
    }
}
