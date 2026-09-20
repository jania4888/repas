using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Studio.Automations;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using System.Text.Json.Nodes;

namespace FactuTrust.Application.Features.Studio.Records;

/// <summary>
/// Corps d'un PATCH partiel (PR 2.3, R5) : seules les clés fournies sont appliquées
/// (<c>null</c> = effacement). <see cref="RowVersion"/> est OBLIGATOIRE (base64) : sans lui le
/// PATCH répond 400 <c>Validation.rowVersion</c> ; un jeton périmé répond 409.
/// </summary>
public sealed record PatchCustomRecordRequest(Dictionary<string, JsonNode?> Data, string RowVersion);

public sealed record PatchCustomRecordCommand(string EntityKey, Guid Id, PatchCustomRecordRequest Request)
    : IRequest<Result<CustomRecordDto>>;

/// <summary>
/// PATCH partiel (déplacement kanban, édition en ligne) : fusion des clés fournies sur le JSON existant
/// (<see cref="CustomRecordPatchMerger.MergePatch"/>), puis réutilisation des étapes de
/// <c>UpdateCustomRecordCommandHandler</c> (calcul AutoNumber, unicité de champ et de paire, concurrence
/// RowVersion, événement <c>OnUpdate</c>). Contrairement au PUT, le PATCH exige le RowVersion et mappe
/// <c>Conflict</c> → 409 (via <c>StudioErrorMapping</c> côté contrôleur).
/// </summary>
public sealed class PatchCustomRecordCommandHandler : IRequestHandler<PatchCustomRecordCommand, Result<CustomRecordDto>>
{
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomRecordRepository _records;
    private readonly IStudioComputedFieldWriter _computedWriter;
    private readonly IPublisher _publisher;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<PatchCustomRecordCommandHandler>? _logger;
    private readonly IAuditService? _audit;

    public PatchCustomRecordCommandHandler(
        ICustomEntityRepository entities, ICustomFieldRepository fields, ICustomRecordRepository records,
        IStudioComputedFieldWriter computedWriter, IPublisher publisher, ICurrentUser currentUser,
        IAuditService? audit = null, ILogger<PatchCustomRecordCommandHandler>? logger = null)
    {
        _entities = entities;
        _fields = fields;
        _records = records;
        _computedWriter = computedWriter;
        _publisher = publisher;
        _currentUser = currentUser;
        _logger = logger;
        _audit = audit;
    }

    public async Task<Result<CustomRecordDto>> Handle(PatchCustomRecordCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<CustomRecordDto>(err);

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(_entities, tenantId, command.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<CustomRecordDto>(resolveError);

        var record = await _records.GetAsync(tenantId, entity.Id, command.Id, cancellationToken);
        if (record is null)
            return Result.Failure<CustomRecordDto>(Error.NotFound("CustomRecord", command.Id));

        // RowVersion obligatoire et décodable.
        if (string.IsNullOrWhiteSpace(command.Request.RowVersion))
            return Result.Failure<CustomRecordDto>(Error.Validation("rowVersion", "Le jeton de concurrence (rowVersion) est obligatoire pour un PATCH."));

        byte[] expectedRowVersion;
        try
        {
            expectedRowVersion = Convert.FromBase64String(command.Request.RowVersion);
        }
        catch (FormatException)
        {
            return Result.Failure<CustomRecordDto>(Error.Validation("rowVersion", "Le jeton de concurrence (rowVersion) est mal formé."));
        }

        // Pré-contrôle déterministe (testable) : le jeton fourni doit correspondre à la version courante.
        if (record.RowVersion is { Length: > 0 } current && !current.AsSpan().SequenceEqual(expectedRowVersion))
            return Result.Failure<CustomRecordDto>(Error.Conflict("L'enregistrement a été modifié entre-temps. Rechargez-le avant de réessayer."));

        var fields = await _fields.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, cancellationToken);

        // Fusion partielle (clés fournies, null = effacement ; refus clés inconnues/réservées/calculées),
        // puis validation + canonicalisation du document complet.
        var validation = CustomRecordPatchMerger.MergePatch(record.DataJson, command.Request.Data, fields);
        if (validation.IsFailure)
            return Result.Failure<CustomRecordDto>(validation.Error);

        // Compute-on-write : AutoNumber immuable (préserve la référence existante).
        var canonicalJson = await _computedWriter.ApplyOnUpdateAsync(
            tenantId, entity.Id, fields, validation.Value, record.DataJson, cancellationToken);

        var uniqueError = await UniqueFieldChecker.CheckAsync(
            _records, tenantId, entity.Id, fields, canonicalJson, excludeId: command.Id, cancellationToken);
        if (uniqueError is not null)
            return Result.Failure<CustomRecordDto>(uniqueError);

        // PR 2.1 : unicité de paire sur les tables de jonction, hors enregistrement en cours.
        var pairError = await JunctionPairChecker.CheckAsync(
            _records, entity, fields, canonicalJson, excludeId: command.Id, cancellationToken);
        if (pairError is not null)
            return Result.Failure<CustomRecordDto>(pairError);

        // PR 4.1i : capture AVANT SetData pour le déclencheur « field_changed » des workflows.
        var previousDataJson = record.DataJson;

        record.SetData(canonicalJson, userId);

        try
        {
            await _records.UpdateWithConcurrencyAsync(record, expectedRowVersion, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Course entre le pré-contrôle et l'écriture : la ligne a changé entre-temps.
            return Result.Failure<CustomRecordDto>(Error.Conflict("L'enregistrement a été modifié entre-temps. Rechargez-le avant de réessayer."));
        }

        // 4.7 « v1.1 » (D-47-63) : audit des seules clés modifiées — aucune ligne si le PATCH est sans effet.
        await StudioRecordAudit.LogUpdatedAsync(_audit, record.Id, previousDataJson, canonicalJson, cancellationToken);

        // Pont ERP : déclenche OnUpdate (best-effort, l'enregistrement est déjà persisté).
        await StudioRecordLifecycle.PublishAsync(
            _publisher, tenantId, entity.Id, record.Id, canonicalJson, StudioAutomationTrigger.OnUpdate, userId, cancellationToken);

        // Workflows Studio (PR 4.1i) : notification séparée (D5) avec l'état précédent, best-effort journalisée (P15).
        await StudioWorkflowLifecycle.PublishAsync(
            _publisher, tenantId, entity.Id, record.Id, canonicalJson, previousDataJson, StudioAutomationTrigger.OnUpdate, userId, _logger, cancellationToken);

        return Result.Success(StudioMappers.ToDto(record));
    }
}
