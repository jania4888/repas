using FactuTrust.Application.Common.Interfaces.Repositories;
using Moq;

namespace FactuTrust.Infrastructure.Tests.Fakes;

/// <summary>
/// Doubles des dépôts client/fournisseur où tout identifiant « existe » :
/// préserve le comportement des tests d'écriture créés avant le contrôle d'existence du tiers.
/// </summary>
public static class ExistingThirdParties
{
    public static Mock<IClientRepository> Clients()
    {
        var m = new Mock<IClientRepository>();
        m.Setup(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync(true);
        return m;
    }

    public static Mock<ISupplierRepository> Suppliers()
    {
        var m = new Mock<ISupplierRepository>();
        m.Setup(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync(true);
        return m;
    }
}
