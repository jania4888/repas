using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using MediatR;

namespace FactuTrust.Application.Features.Accounting.Commands;

/// <summary>
/// Lettrage en masse de propositions confirmées (plan v2, Phase 3, annexe C §4). Une transaction
/// par groupe, succès partiel rapporté groupe par groupe. Le handler arrive dans la PR suivante
/// (p3-13) : rien n'envoie encore cette commande.
/// </summary>
/// <param name="RequestId">Guid généré par le client à l'ouverture de la confirmation (idempotence).</param>
/// <param name="Groups">Groupes à lettrer, traités séquentiellement dans l'ordre reçu.</param>
/// <remarks>
/// Aucun champ d'origine, de partiel ni d'écart de change : le handler force
/// <c>Origin = Bulk</c>, <c>AllowPartial = false</c> et <c>RequireNoExchangeDifference = true</c>.
/// </remarks>
public sealed record BulkLetterCommand(
    Guid RequestId,
    IReadOnlyList<BulkLetterGroup> Groups) : IRequest<Result<BulkLetteringResultDto>>;

/// <summary>Un groupe d'un lot : la clé de la proposition et ses lignes.</summary>
public sealed record BulkLetterGroup(string ClientKey, IReadOnlyList<Guid> JournalEntryLineIds);
