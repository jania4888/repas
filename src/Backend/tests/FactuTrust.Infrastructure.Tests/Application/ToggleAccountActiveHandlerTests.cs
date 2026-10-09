using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// C6 : le « toggle » d'activation doit réellement basculer l'état (l'ancien handler ne faisait
/// que désactiver — un compte désactivé était irrécupérable depuis l'application).
/// </summary>
public sealed class ToggleAccountActiveHandlerTests
{
    private static (ToggleAccountActiveCommandHandler Handler, Mock<IChartOfAccountRepository> Repo) Build(ChartOfAccount? account)
    {
        var repo = new Mock<IChartOfAccountRepository>();
        repo.Setup(r => r.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(account);

        var audit = new Mock<IAuditService>();
        audit.Setup(a => a.LogAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var projection = new Mock<IBankGlTreasuryProjectionService>();
        projection.Setup(p => p.SyncActiveFlagAsync(It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());

        return (new ToggleAccountActiveCommandHandler(repo.Object, audit.Object, projection.Object), repo);
    }

    [Fact]
    public async Task Toggle_ActiveAccount_Deactivates()
    {
        var account = ChartOfAccount.Create("4111", "Clients", 4, "411", AccountNatureType.Debit).Value;
        var (handler, repo) = Build(account);

        var result = await handler.Handle(new ToggleAccountActiveCommand(Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(account.IsActive);
        repo.Verify(r => r.UpdateAsync(account, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Toggle_InactiveAccount_Reactivates()
    {
        var account = ChartOfAccount.Create("4111", "Clients", 4, "411", AccountNatureType.Debit).Value;
        account.ToggleActive(); // désactivé
        Assert.False(account.IsActive);
        var (handler, _) = Build(account);

        var result = await handler.Handle(new ToggleAccountActiveCommand(Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(account.IsActive);
    }

    [Fact]
    public async Task Toggle_SystemAccount_Fails()
    {
        var account = ChartOfAccount.Create("411", "Clients", 4, null, AccountNatureType.Debit, isSystem: true).Value;
        var (handler, repo) = Build(account);

        var result = await handler.Handle(new ToggleAccountActiveCommand(Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.True(account.IsActive);
        repo.Verify(r => r.UpdateAsync(It.IsAny<ChartOfAccount>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Toggle_UnknownAccount_ReturnsNotFound()
    {
        var (handler, _) = Build(null);

        var result = await handler.Handle(new ToggleAccountActiveCommand(Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsFailure);
    }
}
