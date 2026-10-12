using FactuTrust.API.Controllers;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Application.Features.Accounting.Validators;
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
    [InlineData(LetteringErrorCodes.GroupInconsistent, 409)]
    // Phase 3 : lot en cours → 409 ; drapeau éteint et écart de change → 400 (contrat §4.6).
    [InlineData(LetteringErrorCodes.BulkInProgress, 409)]
    [InlineData(LetteringErrorCodes.FeatureDisabled, 400)]
    [InlineData(LetteringErrorCodes.ExchangeDifference, 400)]
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

    /// <summary>
    /// p3-11 : le corps HTTP ne peut pas activer la voie de masse. Avec origin « Bulk », le
    /// contrôleur n'ajoute ni BulkRequestId ni RequireNoExchangeDifference : le validator refusera
    /// donc la commande (Bulk sans identifiant de lot).
    /// </summary>
    [Fact]
    public async Task Letter_BulkOriginFromHttp_NeverCarriesBulkRequestIdNorExchangeFlag()
    {
        LetterAccountEntriesCommand? sent = null;
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<LetterAccountEntriesCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<LetteringResultDto>>, CancellationToken>((c, _) => sent = (LetterAccountEntriesCommand)c)
            .ReturnsAsync(Result.Success(new LetteringResultDto("L00001", Guid.NewGuid(), false, 2, null)));
        var controller = NewController(mediator.Object);

        await controller.Letter(
            new LetterEntriesRequest { JournalEntryLineIds = new[] { Guid.NewGuid(), Guid.NewGuid() }, Origin = "Bulk" },
            CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Equal(LetteringOrigin.Bulk, sent!.Origin);
        Assert.Null(sent.BulkRequestId);
        Assert.False(sent.RequireNoExchangeDifference);
        Assert.False(new LetterAccountEntriesCommandValidator().Validate(sent).IsValid);
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

    // ---- Contrat §4.6 : échecs de validation FluentValidation → 400 LETTERING_VALIDATION ----
    // (revue PR 1, 2e passe : le pipeline MediatR lève ValidationException ; les endpoints de
    // lettrage la mappent sur le code stable, sans toucher au middleware global des autres routes).

    [Fact]
    public async Task Letter_ValidationException_Returns400_WithLetteringValidationCode()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<LetterAccountEntriesCommand>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new FluentValidation.ValidationException(new[]
            {
                new FluentValidation.Results.ValidationFailure(
                    "JournalEntryLineIds", "Au moins deux lignes d'écriture sont requises pour le lettrage.")
            }));
        var controller = NewController(mediator.Object);

        var result = await controller.Letter(
            new LetterEntriesRequest { JournalEntryLineIds = new[] { Guid.NewGuid() } }, CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(400, objectResult.StatusCode);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(objectResult.Value);
        Assert.False(body.Success);
        Assert.Equal(LetteringErrorCodes.Validation, body.Code);
        Assert.Contains("deux lignes", body.Message);
    }

    [Fact]
    public async Task Unletter_ValidationException_Returns400_WithLetteringValidationCode()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<UnletterAccountEntriesCommand>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new FluentValidation.ValidationException(new[]
            {
                new FluentValidation.Results.ValidationFailure("Code", "Le code de lettrage est obligatoire.")
            }));
        var controller = NewController(mediator.Object);

        var result = await controller.Unletter(new UnletterEntriesRequest { Code = "" }, CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(400, objectResult.StatusCode);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(objectResult.Value);
        Assert.Equal(LetteringErrorCodes.Validation, body.Code);
    }

    [Fact]
    public async Task GetLetteringLines_ValidationException_Returns400_WithLetteringValidationCode()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<GetLetteringLinesQuery>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new FluentValidation.ValidationException(new[]
            {
                new FluentValidation.Results.ValidationFailure("From", "La date de début est obligatoire.")
            }));
        var controller = NewController(mediator.Object);

        var result = await controller.GetLetteringLines(account: "411000", cancellationToken: CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(400, objectResult.StatusCode);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(objectResult.Value);
        Assert.Equal(LetteringErrorCodes.Validation, body.Code);
    }

    // ---- GetLetteringSuggestions (plan v2, Phase 3, annexe C §3) ----

    private static LetteringSuggestionsResultDto EmptySuggestions() =>
        new(Array.Empty<LetteringSuggestionDto>(), 0, 0, 0, false, null, new DateTime(2026, 10, 12, 0, 0, 0, DateTimeKind.Utc));

    [Fact]
    public async Task GetLetteringSuggestions_Success_ReturnsOk_AndSendsTheScreenFilter()
    {
        var dto = EmptySuggestions();
        GetLetteringSuggestionsQuery? sent = null;
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<GetLetteringSuggestionsQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<LetteringSuggestionsResultDto>>, CancellationToken>((q, _) => sent = (GetLetteringSuggestionsQuery)q)
            .ReturnsAsync(Result.Success(dto));
        var controller = NewController(mediator.Object);
        var thirdParty = Guid.NewGuid();

        var result = await controller.GetLetteringSuggestions(
            account: "411", accountMatch: LetteringAccountMatch.Prefix,
            from: new DateTime(2026, 1, 1), to: new DateTime(2026, 12, 31),
            journalCode: "VT", thirdPartyId: thirdParty, thirdPartyKind: Domain.Enums.ThirdPartyKind.Client,
            minAmount: 10m, maxAmount: 99m, search: "FAC", maxResults: 20,
            cancellationToken: CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<LetteringSuggestionsResultDto>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(dto, body.Data);

        Assert.NotNull(sent);
        Assert.Equal(20, sent!.MaxResults);
        var f = sent.Filter;
        Assert.Equal(("411", LetteringAccountMatch.Prefix), (f.Account, f.AccountMatch));
        Assert.Equal((new DateTime(2026, 1, 1), new DateTime(2026, 12, 31)), (f.From, f.To));
        Assert.Equal(("VT", thirdParty, (Domain.Enums.ThirdPartyKind?)Domain.Enums.ThirdPartyKind.Client), (f.JournalCode, f.ThirdPartyId, f.ThirdPartyKind));
        Assert.Equal((10m, 99m, "FAC"), (f.MinAmount, f.MaxAmount, f.Search));
        Assert.Equal((LetteringStateFilter.Unlettered, LetteringSideFilter.All), (f.State, f.Side));
    }

    [Fact]
    public async Task GetLetteringSuggestions_FeatureDisabled_Returns400_WithItsCode()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<GetLetteringSuggestionsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<LetteringSuggestionsResultDto>(
                LetteringErrors.FeatureDisabled("Les propositions de lettrage ne sont pas activées.")));
        var controller = NewController(mediator.Object);

        var result = await controller.GetLetteringSuggestions(account: "411000", cancellationToken: CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(400, objectResult.StatusCode);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(objectResult.Value);
        Assert.Equal(LetteringErrorCodes.FeatureDisabled, body.Code);
    }

    [Fact]
    public async Task GetLetteringSuggestions_ValidationException_Returns400_WithLetteringValidationCode()
    {
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.IsAny<GetLetteringSuggestionsQuery>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new FluentValidation.ValidationException(new[]
            {
                new FluentValidation.Results.ValidationFailure("MaxResults", "Le nombre de propositions doit être entre 1 et 200.")
            }));
        var controller = NewController(mediator.Object);

        var result = await controller.GetLetteringSuggestions(account: "411000", maxResults: 500, cancellationToken: CancellationToken.None);

        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(400, objectResult.StatusCode);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(objectResult.Value);
        Assert.Equal(LetteringErrorCodes.Validation, body.Code);
    }

    /// <summary>Le code de groupe est normalisé (trim + majuscules) AVANT l'envoi au pipeline.</summary>
    [Fact]
    public async Task GetLetteringGroup_LowercaseCode_IsNormalizedBeforeDispatch()
    {
        var group = new LetteringGroupDto(
            Guid.NewGuid(), "L00001", "411000", 100m, "TND", false,
            DateTime.UtcNow, "Jean Test", Array.Empty<LetteringLineDto>(), true, null, false);
        var mediator = new Mock<IMediator>(MockBehavior.Strict);
        mediator.Setup(m => m.Send(It.Is<GetLetteringGroupQuery>(q => q.Code == "L00001"), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(group));
        var controller = NewController(mediator.Object);

        var result = await controller.GetLetteringGroup("  l00001  ", CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
    }
}
