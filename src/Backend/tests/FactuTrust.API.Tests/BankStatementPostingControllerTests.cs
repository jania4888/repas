using FactuTrust.API.Controllers;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Mappage HTTP de la génération atomique (plan §3.10) et de l'historique paginé (plan §3.8) :
/// seul le contrôleur traduit les codes d'erreur stables en statuts HTTP, jamais le texte libre.
/// </summary>
public sealed class BankStatementPostingControllerTests
{
    private readonly Mock<IBankStatementPostingService> _posting = new();

    private BankStatementImportController Controller()
    {
        var user = new Mock<ICurrentUser>();
        user.Setup(u => u.HasPermission(It.IsAny<string>())).Returns(true);
        var tenant = new Mock<ITenantContext>();
        tenant.Setup(t => t.TenantId).Returns(Guid.NewGuid());

        return new BankStatementImportController(
            Mock.Of<IBankStatementImportService>(),
            Mock.Of<IBankStatementTabularImportService>(),
            _posting.Object,
            Mock.Of<IBankStatementAiExtraction>(),
            BankStatementProfileRegistry.Default,
            user.Object,
            tenant.Object,
            Options.Create(new AccountingSettings { BankStatementAiPostingEnabled = true }));
    }

    private static ObjectResult AsObjectResult(IActionResult result) => Assert.IsAssignableFrom<ObjectResult>(result);

    [Theory]
    [InlineData(BankStatementPostingErrorCodes.AtomicRejected, 400)]
    [InlineData(BankStatementPostingErrorCodes.AtomicIncomplete, 400)]
    [InlineData(BankStatementPostingErrorCodes.AtomicTooManyLines, 400)]
    [InlineData(BankStatementPostingErrorCodes.AtomicConflict, 409)]
    public async Task Atomic_error_codes_map_to_the_expected_http_status(string code, int expectedStatus)
    {
        _posting.Setup(p => p.GenerateAsync(It.IsAny<Guid>(), It.IsAny<GenerateBankStatementEntriesRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<GenerateBankStatementEntriesResult>(new Error(code, "Échec de la génération atomique.")));

        var result = AsObjectResult(await Controller().Generate(Guid.NewGuid(),
            new GenerateBankStatementEntriesRequest { Atomic = true }, CancellationToken.None));

        Assert.Equal(expectedStatus, result.StatusCode);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(result.Value);
        Assert.False(body.Success);
        Assert.Equal(code, body.Code);
    }

    [Fact]
    public async Task Atomic_rejected_carries_the_full_outcome_list_as_data_without_leaking_raw_exception_text()
    {
        var rejected = new GenerateBankStatementEntriesResult
        {
            Created = 0,
            Outcomes = new[] { new GenerateBankStatementLineOutcome(Guid.NewGuid(), "rejected", null, null, null, null) }
        };
        var error = new Error(BankStatementPostingErrorCodes.AtomicRejected, "La génération atomique a été refusée.")
        {
            Metadata = new Dictionary<string, object?> { ["data"] = rejected }
        };
        _posting.Setup(p => p.GenerateAsync(It.IsAny<Guid>(), It.IsAny<GenerateBankStatementEntriesRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<GenerateBankStatementEntriesResult>(error));

        var result = AsObjectResult(await Controller().Generate(Guid.NewGuid(),
            new GenerateBankStatementEntriesRequest { Atomic = true }, CancellationToken.None));

        Assert.Equal(400, result.StatusCode);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(result.Value);
        Assert.Same(rejected, body.Data);
    }

    [Fact]
    public async Task Successful_atomic_generation_is_returned_as_is()
    {
        var success = new GenerateBankStatementEntriesResult { Created = 2, Committed = true, Atomic = true };
        _posting.Setup(p => p.GenerateAsync(It.IsAny<Guid>(), It.IsAny<GenerateBankStatementEntriesRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(success));

        var result = Assert.IsType<OkObjectResult>(await Controller().Generate(Guid.NewGuid(),
            new GenerateBankStatementEntriesRequest { Atomic = true }, CancellationToken.None));

        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<GenerateBankStatementEntriesResult>>(result.Value);
        Assert.True(body.Success);
        Assert.Same(success, body.Data);
    }

    [Fact]
    public async Task History_passes_the_raw_query_through_and_wraps_the_paged_result()
    {
        var bankAccountId = Guid.NewGuid();
        var page = PagedResult<BankStatementImportHistoryItemDto>.Create(
            new[] { new BankStatementImportHistoryItemDto { Id = Guid.NewGuid(), BankName = "STB" } }, 1, 20, 1);
        _posting.Setup(p => p.GetHistoryAsync(1, 500, bankAccountId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(page));

        var result = Assert.IsType<OkObjectResult>(await Controller().GetHistory(1, 500, bankAccountId, CancellationToken.None));

        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<PagedResult<BankStatementImportHistoryItemDto>>>(result.Value);
        Assert.True(body.Success);
        Assert.Same(page, body.Data);
        // Le contrôleur transmet la valeur brute du client : c'est le SERVICE qui borne
        // pageSize à 100 (BankStatementPostingService.GetHistoryAsync, couvert par
        // BankStatementPostingServiceTests.History_pagination_clamps_page_size_to_the_configured_maximum).
        _posting.Verify(p => p.GetHistoryAsync(1, 500, bankAccountId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task History_is_hidden_when_the_feature_is_disabled()
    {
        var user = new Mock<ICurrentUser>();
        var tenant = new Mock<ITenantContext>();
        var controller = new BankStatementImportController(
            Mock.Of<IBankStatementImportService>(), Mock.Of<IBankStatementTabularImportService>(), _posting.Object,
            Mock.Of<IBankStatementAiExtraction>(), BankStatementProfileRegistry.Default, user.Object, tenant.Object,
            Options.Create(new AccountingSettings { BankStatementAiPostingEnabled = false }));

        Assert.IsType<NotFoundResult>(await controller.GetHistory(1, 20, null, CancellationToken.None));
        _posting.Verify(p => p.GetHistoryAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
