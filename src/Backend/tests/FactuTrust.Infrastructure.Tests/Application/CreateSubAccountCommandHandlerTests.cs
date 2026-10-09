using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

public sealed class CreateSubAccountCommandHandlerTests
{
    private static (
        CreateSubAccountCommandHandler Handler,
        Mock<IChartOfAccountRepository> Repo,
        Mock<IBankGlTreasuryProjectionService> Projection) Build(ChartOfAccount? existing)
    {
        var repo = new Mock<IChartOfAccountRepository>();
        repo.Setup(r => r.GetByAccountNumberAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(existing);
        repo.Setup(r => r.AddAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((ChartOfAccount e, CancellationToken _) => e);

        var audit = new Mock<IAuditService>();
        audit.Setup(a => a.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var currentUser = new Mock<ICurrentUser>();
        currentUser.Setup(u => u.Email).Returns("tester@example.com");

        var projection = new Mock<IBankGlTreasuryProjectionService>();
        projection.Setup(p => p.EnsureForChartAccountAsync(
                It.IsAny<ChartOfAccount>(), It.IsAny<BankGlProjectionIdentity?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new BankGlProjectionEnsureResult(1, 0)));

        return (
            new CreateSubAccountCommandHandler(
                repo.Object, audit.Object, currentUser.Object, projection.Object,
                NullLogger<CreateSubAccountCommandHandler>.Instance),
            repo,
            projection);
    }

    private static CreateSubAccountCommand Command(
        string accountNumber,
        string label = "TVA 10%",
        string? parentAccountNumber = "43671") =>
        new(new CreateSubAccountRequest
        {
            AccountNumber = accountNumber,
            Label = label,
            AccountClass = 4,
            ParentAccountNumber = parentAccountNumber,
            NatureType = 2,
            AccountType = 3,
            IsAuxiliary = false
        });

    [Fact]
    public async Task Handle_DuplicateAccountNumber_FailsWithoutInsert()
    {
        var existing = ChartOfAccount.Create(
            "436712", "TVA collectée sur encaissements", 4, "43671", AccountNatureType.Credit).Value;
        var (handler, repo, _) = Build(existing);

        var result = await handler.Handle(Command("436712"), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        Assert.Contains("436712", result.Error.Description, StringComparison.Ordinal);
        Assert.Contains("TVA collectée sur encaissements", result.Error.Description, StringComparison.Ordinal);
        repo.Verify(r => r.AddAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_FreeAccountNumber_InsertsOnce()
    {
        var (handler, repo, projection) = Build(null);

        var result = await handler.Handle(Command("436713"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        repo.Verify(r => r.AddAsync(
            It.Is<ChartOfAccount>(a => a.AccountNumber == "436713" && a.Label == "TVA 10%"),
            It.IsAny<CancellationToken>()), Times.Once);
        projection.Verify(p => p.EnsureForChartAccountAsync(
            It.IsAny<ChartOfAccount>(), It.IsAny<BankGlProjectionIdentity?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_BankLeaf_ProjectsTreasuryAccount()
    {
        var (handler, repo, projection) = Build(null);

        var result = await handler.Handle(new CreateSubAccountCommand(new CreateSubAccountRequest
        {
            AccountNumber = "53211",
            Label = "Banque Biat",
            AccountClass = 5,
            ParentAccountNumber = "5321",
            NatureType = 2,
            AccountType = 3,
            IsAuxiliary = false
        }), CancellationToken.None);

        Assert.True(result.IsSuccess);
        repo.Verify(r => r.AddAsync(It.Is<ChartOfAccount>(a => a.AccountNumber == "53211"), It.IsAny<CancellationToken>()), Times.Once);
        projection.Verify(p => p.EnsureForChartAccountAsync(
            It.Is<ChartOfAccount>(a => a.AccountNumber == "53211"),
            It.IsAny<BankGlProjectionIdentity?>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_BankLeaf_RibWithoutIban_FailsBeforeInsert()
    {
        var (handler, repo, projection) = Build(null);

        var result = await handler.Handle(new CreateSubAccountCommand(new CreateSubAccountRequest
        {
            AccountNumber = "53211",
            Label = "Banque Biat",
            AccountClass = 5,
            ParentAccountNumber = "5321",
            NatureType = 2,
            AccountType = 3,
            Rib = "08001000123456789012"
        }), CancellationToken.None);

        Assert.True(result.IsFailure);
        repo.Verify(r => r.AddAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()), Times.Never);
        projection.Verify(p => p.EnsureForChartAccountAsync(
            It.IsAny<ChartOfAccount>(), It.IsAny<BankGlProjectionIdentity?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_DottedSceNumber_InsertsOnce()
    {
        var (handler, repo, _) = Build(null);

        var result = await handler.Handle(Command("428.3", "Personnel — mutuelle complémentaire", "42"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        repo.Verify(r => r.AddAsync(
            It.Is<ChartOfAccount>(a => a.AccountNumber == "428.3"),
            It.IsAny<CancellationToken>()), Times.Once);
    }
}
