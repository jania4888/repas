using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Domain.Common;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Contrôle serveur d'existence du tiers (plan hors périmètre import de facture) :
/// un ThirdPartyId inconnu doit refuser l'écriture ; un tiers existant, une ligne sans tiers
/// ou un kind invalide (refusé ailleurs par le mapper) passent ici sans erreur.
/// </summary>
public sealed class ManualJournalThirdPartyValidatorTests
{
    private static ManualJournalLineRequest Line(Guid? thirdPartyId, int? kind) => new()
    {
        AccountNumber = "411000",
        LineLabel = "Ligne",
        Debit = 100m,
        ThirdPartyId = thirdPartyId,
        ThirdPartyKind = kind
    };

    private static (Mock<IClientRepository> Clients, Mock<ISupplierRepository> Suppliers) Repos(
        bool clientExists = true, bool supplierExists = true)
    {
        var clients = new Mock<IClientRepository>();
        clients.Setup(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(clientExists);
        var suppliers = new Mock<ISupplierRepository>();
        suppliers.Setup(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(supplierExists);
        return (clients, suppliers);
    }

    [Fact]
    public async Task EnsureExistAsync_passes_without_third_party()
    {
        var (clients, suppliers) = Repos(clientExists: false, supplierExists: false);
        var r = await ManualJournalThirdPartyValidator.EnsureExistAsync(
            clients.Object, suppliers.Object, new[] { Line(null, null), Line(Guid.Empty, null) }, default);
        Assert.True(r.IsSuccess);
        clients.Verify(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
        suppliers.Verify(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task EnsureExistAsync_passes_with_existing_client_and_supplier()
    {
        var (clients, suppliers) = Repos();
        var r = await ManualJournalThirdPartyValidator.EnsureExistAsync(
            clients.Object, suppliers.Object,
            new[] { Line(Guid.NewGuid(), 1), Line(Guid.NewGuid(), 2) }, default);
        Assert.True(r.IsSuccess);
    }

    [Fact]
    public async Task EnsureExistAsync_rejects_unknown_client()
    {
        var id = Guid.NewGuid();
        var (clients, suppliers) = Repos(clientExists: false);
        var r = await ManualJournalThirdPartyValidator.EnsureExistAsync(
            clients.Object, suppliers.Object, new[] { Line(id, 1) }, default);
        Assert.True(r.IsFailure);
        Assert.Equal("Validation.ThirdPartyId", r.Error.Code);
        Assert.Contains("client", r.Error.Description, StringComparison.OrdinalIgnoreCase);
        suppliers.Verify(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task EnsureExistAsync_rejects_unknown_supplier()
    {
        var id = Guid.NewGuid();
        var (clients, suppliers) = Repos(supplierExists: false);
        var r = await ManualJournalThirdPartyValidator.EnsureExistAsync(
            clients.Object, suppliers.Object, new[] { Line(id, 2) }, default);
        Assert.True(r.IsFailure);
        Assert.Equal("Validation.ThirdPartyId", r.Error.Code);
        Assert.Contains("fournisseur", r.Error.Description, StringComparison.OrdinalIgnoreCase);
        clients.Verify(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task EnsureExistAsync_checks_each_distinct_id_once()
    {
        var id = Guid.NewGuid();
        var (clients, suppliers) = Repos();
        var r = await ManualJournalThirdPartyValidator.EnsureExistAsync(
            clients.Object, suppliers.Object,
            new[] { Line(id, 1), Line(id, 1), Line(Guid.NewGuid(), 1) }, default);
        Assert.True(r.IsSuccess);
        clients.Verify(x => x.ExistsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task EnsureExistAsync_ignores_invalid_kind_mapper_rejects_it()
    {
        var (clients, suppliers) = Repos(clientExists: false, supplierExists: false);
        var r = await ManualJournalThirdPartyValidator.EnsureExistAsync(
            clients.Object, suppliers.Object, new[] { Line(Guid.NewGuid(), 7) }, default);
        Assert.True(r.IsSuccess);
    }
}
