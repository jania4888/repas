using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.Commands;

/// <summary>
/// Contrôle serveur des tiers des lignes de saisie manuelle : un ThirdPartyId fourni doit
/// exister dans le dossier courant (client ou fournisseur selon le kind). Sans ce contrôle,
/// une ligne peut pointer vers un auxiliaire orphelin. Les dépôts sont tenant-scopés, donc
/// l'isolation entre dossiers est préservée.
/// </summary>
public static class ManualJournalThirdPartyValidator
{
    public static async Task<Result> EnsureExistAsync(
        IClientRepository clients,
        ISupplierRepository suppliers,
        IReadOnlyList<ManualJournalLineRequest> lines,
        CancellationToken cancellationToken)
    {
        var checkedClients = new HashSet<Guid>();
        var checkedSuppliers = new HashSet<Guid>();

        foreach (var l in lines)
        {
            if (l.ThirdPartyId is not { } id || id == Guid.Empty)
                continue;

            if (l.ThirdPartyKind == (int)ThirdPartyKind.Client)
            {
                if (!checkedClients.Add(id))
                    continue;
                if (!await clients.ExistsAsync(id, cancellationToken))
                    return Result.Failure(Error.Validation("ThirdPartyId",
                        $"Le client {id} n'existe pas dans ce dossier."));
            }
            else if (l.ThirdPartyKind == (int)ThirdPartyKind.Supplier)
            {
                if (!checkedSuppliers.Add(id))
                    continue;
                if (!await suppliers.ExistsAsync(id, cancellationToken))
                    return Result.Failure(Error.Validation("ThirdPartyId",
                        $"Le fournisseur {id} n'existe pas dans ce dossier."));
            }
            // Kind absent ou invalide : ManualJournalLineMapper.Map le refuse déjà.
        }

        return Result.Success();
    }
}
