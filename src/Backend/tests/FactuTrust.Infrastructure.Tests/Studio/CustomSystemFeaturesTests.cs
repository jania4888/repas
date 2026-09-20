using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Systems;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// <see cref="CreateCustomSystemCommandHandler"/> : une clé réservée (littéral de route, PR 3.3) est
/// refusée en validation AVANT toute lecture du dépôt.
/// </summary>
public sealed class CustomSystemFeaturesTests
{
    private static readonly Guid Tid = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Uid = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public async Task Create_with_reserved_key_import_returns_validation_error()
    {
        var systems = new Mock<ICustomSystemRepository>(MockBehavior.Strict);
        var audit = new Mock<IAuditService>(MockBehavior.Strict);
        var currentUser = new Mock<ICurrentUser>(MockBehavior.Strict);
        currentUser.SetupGet(u => u.TenantId).Returns(Tid);
        currentUser.SetupGet(u => u.UserId).Returns(Uid);
        var handler = new CreateCustomSystemCommandHandler(systems.Object, audit.Object, currentUser.Object);

        var result = await handler.Handle(new CreateCustomSystemCommand(
            new CreateCustomSystemRequest("Import", "Import", null, null, null)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.key", result.Error.Code);
        Assert.Equal("Clé système réservée.", result.Error.Description);
        systems.Verify(s => s.KeyExistsAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        systems.VerifyNoOtherCalls();
        audit.VerifyNoOtherCalls();
    }
}
