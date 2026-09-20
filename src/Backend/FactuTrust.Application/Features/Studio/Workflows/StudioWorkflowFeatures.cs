using System.Text;
using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.Studio.Workflows.Spec;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Studio.Workflows;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Application.Features.Studio.Workflows;

// ---------------------------------------------------------------------------------------------
// Studio IA 4.1j1 — requêtes / commandes de conception des workflows (sans contrôleur : 4.1k).
// Une seule normalisation partagée (StudioWorkflowSaveSupport) ; StudioWorkflowStepsSpec reste
// l'unique source de vérité pour le contenu des étapes.
// ---------------------------------------------------------------------------------------------

/// <summary>Projection des entités workflow vers les DTO de l'API.</summary>
internal static class StudioWorkflowMapping
{
    public static WorkflowDefinitionDto ToDto(StudioWorkflowDefinition d, int openInstances)
    {
        var steps = ParseObject(d.StepsJson);
        return new WorkflowDefinitionDto(
            d.Id,
            d.EntityDefinitionId,
            d.Key,
            d.Name,
            d.Description,
            StudioWorkflowEnumNames.TriggerName(d.Trigger),
            ParseObject(d.TriggerConfigJson),
            steps,
            (steps["steps"] as JsonArray)?.Count ?? 0,
            d.Version,
            d.IsActive,
            openInstances,
            d.CreatedAt,
            d.UpdatedAt,
            RowVersionOf(d.RowVersion));
    }

    public static WorkflowInstanceDto ToDto(StudioWorkflowInstance i, StudioWorkflowDefinition? d) =>
        new(
            i.Id,
            i.WorkflowDefinitionId,
            d?.Key,
            d?.Name,
            i.DefinitionVersion,
            i.EntityDefinitionId,
            i.RecordId,
            StudioWorkflowEnumNames.TriggerName(i.TriggerKind),
            StudioWorkflowEnumNames.InstanceStatusName(i.Status),
            i.CurrentStepIndex,
            i.CurrentStepKey,
            i.DueAt,
            i.StartedBy,
            i.StartedAt,
            i.CompletedAt,
            i.Depth,
            i.OriginInstanceId,
            i.Error);

    public static WorkflowStepRunDto ToDto(StudioWorkflowStepRun r) =>
        new(
            r.StepIndex,
            r.StepKey,
            r.StepType,
            StudioWorkflowEnumNames.StepRunStatusName(r.Status),
            r.Outcome,
            TryParseObject(r.ResultJson),
            r.Error,
            r.StartedAt,
            r.FinishedAt);

    public static WorkflowApprovalDto ToDto(StudioWorkflowApproval a) =>
        new(
            a.Id,
            a.InstanceId,
            a.StepKey,
            a.AssigneeUserId,
            a.AssigneeRole,
            a.Title,
            a.Message,
            StudioWorkflowEnumNames.ApprovalStatusName(a.Status),
            a.DecidedBy,
            a.DecidedAt,
            a.Comment,
            a.DueAt,
            a.CreatedAt,
            RowVersionOf(a.RowVersion));

    /// <summary>Reparse une colonne JSON en objet ; objet vide si absente, illisible ou d'une autre forme.</summary>
    public static JsonObject ParseObject(string? json) => TryParseObject(json) ?? new JsonObject();

    private static JsonObject? TryParseObject(string? json)
        => StudioWorkflowJson.TryParseObject(json, out var obj) ? obj : null;

    private static string RowVersionOf(byte[]? rowVersion) => Convert.ToBase64String(rowVersion ?? []);
}

/// <summary>Corps d'enregistrement normalisé (clé / nom / description nettoyés, déclencheur parsé, JSON sérialisés).</summary>
internal sealed record NormalizedWorkflowSave(
    string Key,
    string Name,
    string? Description,
    StudioWorkflowTriggerKind Trigger,
    string TriggerConfigJson,
    string StepsJson,
    bool IsActive);

/// <summary>
/// Aide commune à Create / Update / Validate : normalisation d'un <see cref="SaveWorkflowRequest"/>,
/// validation des étapes via <see cref="StudioWorkflowStepsSpec"/>, conversion en <see cref="Error"/>
/// et lecture du jeton de concurrence.
/// </summary>
internal static class StudioWorkflowSaveSupport
{
    public const string KeyShapeMessage =
        "La clé doit commencer par une lettre minuscule et ne contenir que des minuscules, chiffres et « _ » (2 à 64 caractères).";

    public const string RowVersionRequiredMessage = "Le jeton de concurrence (rowVersion) est obligatoire pour mettre à jour un workflow.";
    public const string RowVersionMalformedMessage = "Le jeton de concurrence (rowVersion) est mal formé.";
    public const string ConcurrencyConflictMessage = "Le workflow a été modifié entre-temps. Rechargez-le avant de réessayer.";
    public const string KeyImmutableMessage = "La clé d'un workflow ne peut pas être modifiée.";

    /// <summary>Normalisation (§1.4-A) : première erreur renvoyée, ordre fixe.</summary>
    public static Result<NormalizedWorkflowSave> Normalize(SaveWorkflowRequest request)
    {
        var issues = NormalizeAsIssues(request, out var normalized);
        if (normalized is null)
        {
            var first = issues[0];
            return Result.Failure<NormalizedWorkflowSave>(Error.Validation(first.Path, first.Message));
        }
        return Result.Success(normalized);
    }

    /// <summary>
    /// Mêmes règles que <see cref="Normalize"/>, exprimées en liste d'issues (pour la validation à blanc).
    /// <paramref name="normalized"/> est null dès qu'une règle bloquante échoue.
    /// </summary>
    public static IReadOnlyList<WorkflowValidationIssue> NormalizeAsIssues(SaveWorkflowRequest request, out NormalizedWorkflowSave? normalized)
    {
        normalized = null;
        var issues = new List<WorkflowValidationIssue>();
        if (request is null)
        {
            issues.Add(new WorkflowValidationIssue("request", "Le corps de la requête est obligatoire."));
            return issues;
        }

        var key = request.Key?.Trim() ?? string.Empty;
        if (!StudioKey.IsValidShape(key))
            issues.Add(new WorkflowValidationIssue("key", KeyShapeMessage));

        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length == 0)
            issues.Add(new WorkflowValidationIssue("name", "Le nom du workflow est obligatoire."));
        else if (name.Length > StudioWorkflowDefinition.NameMaxLength)
            issues.Add(new WorkflowValidationIssue("name", $"Le nom du workflow ne peut pas dépasser {StudioWorkflowDefinition.NameMaxLength} caractères."));

        var description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        if (description is not null && description.Length > StudioWorkflowDefinition.DescriptionMaxLength)
            issues.Add(new WorkflowValidationIssue("description", $"La description ne peut pas dépasser {StudioWorkflowDefinition.DescriptionMaxLength} caractères."));

        if (!StudioWorkflowEnumNames.TryParseTrigger(request.Trigger?.Trim(), out var trigger))
            issues.Add(new WorkflowValidationIssue("trigger",
                $"Déclencheur inconnu : « {request.Trigger} ». Valeurs acceptées : on_create, on_update, field_changed, manual."));

        var triggerConfigJson = (request.TriggerConfig ?? new JsonObject()).ToJsonString();
        if (Encoding.UTF8.GetByteCount(triggerConfigJson) > StudioWorkflowStepsSpec.MaxTriggerConfigBytes)
            issues.Add(new WorkflowValidationIssue("triggerConfig", "La configuration du déclencheur dépasse 2 Ko."));

        if (request.Steps is null)
            issues.Add(new WorkflowValidationIssue("steps", "Le corps « steps » est obligatoire."));

        if (issues.Count > 0)
            return issues;

        normalized = new NormalizedWorkflowSave(key, name, description, trigger, triggerConfigJson, request.Steps!.ToJsonString(), request.IsActive);
        return issues;
    }

    /// <summary>
    /// Validation des étapes (§1.4-B) : charge les champs actifs de la table, résout les tables cibles des
    /// étapes <c>create_record</c> (inconnue, inactive ou jonction ⇒ null) puis délègue à
    /// <see cref="StudioWorkflowStepsSpec.Validate"/>.
    /// </summary>
    public static async Task<WorkflowValidationOutcome> ValidateAsync(
        NormalizedWorkflowSave save,
        CustomEntityDefinition entity,
        ICustomEntityRepository entities,
        ICustomFieldRepository fieldsRepo,
        Guid tenantId,
        CancellationToken ct)
    {
        var fields = await fieldsRepo.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, ct);
        var resolved = new Dictionary<string, IReadOnlyList<CustomFieldDefinition>?>(StringComparer.Ordinal);

        var parsed = StudioWorkflowStepsSpec.Parse(save.StepsJson);
        if (parsed.IsSuccess)
        {
            foreach (var key in StudioWorkflowStepsSpec.ReferencedEntityKeys(parsed.Value))
            {
                var target = await entities.GetByKeyAsync(tenantId, key, ct);
                if (target is null || !target.IsActive || target.Kind == CustomEntityKind.Junction)
                    resolved[key] = null;
                else
                    resolved[key] = await fieldsRepo.ListByEntityAsync(tenantId, target.Id, includeInactive: false, ct);
            }
        }

        return StudioWorkflowStepsSpec.Validate(
            save.StepsJson,
            save.Trigger,
            save.TriggerConfigJson,
            entity,
            fields,
            StudioBridgeActionCatalog.Resolve,
            key => resolved.TryGetValue(key, out var f) ? f : null);
    }

    /// <summary>Première issue ⇒ <c>Validation.&lt;chemin&gt;</c> ; suffixe si d'autres erreurs existent (D-41-03).</summary>
    public static Error ToError(WorkflowValidationOutcome outcome)
    {
        var first = outcome.Errors[0];
        var n = outcome.Errors.Count;
        return Error.Validation(
            first.Path,
            n == 1 ? first.Message : $"{first.Message} (+{n - 1} autre(s) erreur(s) — utilisez la validation pour la liste complète.)");
    }

    /// <summary>Jeton de concurrence (§1.4-D) : obligatoire et décodable en base64.</summary>
    public static Result<byte[]> ParseRowVersion(string? rowVersion)
    {
        if (string.IsNullOrWhiteSpace(rowVersion))
            return Result.Failure<byte[]>(Error.Validation("rowVersion", RowVersionRequiredMessage));
        try
        {
            return Result.Success(Convert.FromBase64String(rowVersion));
        }
        catch (FormatException)
        {
            return Result.Failure<byte[]>(Error.Validation("rowVersion", RowVersionMalformedMessage));
        }
    }
}

// ---- List ----

public sealed record ListWorkflowsQuery(Guid EntityId) : IRequest<Result<IReadOnlyList<WorkflowDefinitionDto>>>;

public sealed class ListWorkflowsQueryHandler : IRequestHandler<ListWorkflowsQuery, Result<IReadOnlyList<WorkflowDefinitionDto>>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICustomEntityRepository _entities;
    private readonly ICurrentUser _currentUser;

    public ListWorkflowsQueryHandler(IStudioWorkflowRepository workflows, ICustomEntityRepository entities, ICurrentUser currentUser)
    {
        _workflows = workflows;
        _entities = entities;
        _currentUser = currentUser;
    }

    public async Task<Result<IReadOnlyList<WorkflowDefinitionDto>>> Handle(ListWorkflowsQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<IReadOnlyList<WorkflowDefinitionDto>>(err);

        var entity = await _entities.GetByIdAsync(tenantId, query.EntityId, cancellationToken);
        if (entity is null)
            return Result.Failure<IReadOnlyList<WorkflowDefinitionDto>>(Error.NotFound("CustomEntity", query.EntityId));

        var definitions = await _workflows.ListByEntityAsync(tenantId, entity.Id, includeInactive: true, cancellationToken);
        var result = new List<WorkflowDefinitionDto>(definitions.Count);
        foreach (var definition in definitions)
        {
            // Borné par le quota de workflows par table (≤ 20 requêtes).
            var open = await _workflows.CountOpenInstancesForDefinitionAsync(tenantId, definition.Id, cancellationToken);
            result.Add(StudioWorkflowMapping.ToDto(definition, open));
        }

        return Result.Success<IReadOnlyList<WorkflowDefinitionDto>>(result);
    }
}

// ---- List (catalogue tenant, 4.5c2 / D-44-20) ----

/// <summary>Catalogue tenant paginé ; <c>Page</c> ≥ 1, <c>PageSize</c> borné 1..200 au handler (défense) comme au contrôleur.</summary>
public sealed record ListTenantWorkflowsQuery(string? Search, int Page = 1, int PageSize = 50)
    : IRequest<Result<PagedResult<WorkflowDefinitionListItemDto>>>;

public sealed class ListTenantWorkflowsQueryHandler
    : IRequestHandler<ListTenantWorkflowsQuery, Result<PagedResult<WorkflowDefinitionListItemDto>>>
{
    public const int MaxPageSize = 200;
    public const int MaxSearchLength = 128;

    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICurrentUser _currentUser;

    public ListTenantWorkflowsQueryHandler(IStudioWorkflowRepository workflows, ICurrentUser currentUser)
    {
        _workflows = workflows;
        _currentUser = currentUser;
    }

    public async Task<Result<PagedResult<WorkflowDefinitionListItemDto>>> Handle(ListTenantWorkflowsQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<PagedResult<WorkflowDefinitionListItemDto>>(err);
        // Le contrôleur porte déjà la policy ; le handler la reprend (motif StudioAiPlanWorkbenchFeatures, S-base).
        if (!_currentUser.HasPermission(Permissions.Studio.DesignEntities))
            return Result.Failure<PagedResult<WorkflowDefinitionListItemDto>>(Error.Unauthorized("Permission de conception Studio requise."));

        // `page` borné pour que `(page - 1) * pageSize` ne déborde jamais (revue 4.5i★, D-45-28).
        var page = Math.Clamp(query.Page, 1, int.MaxValue / MaxPageSize);
        var pageSize = Math.Clamp(query.PageSize, 1, MaxPageSize);
        var search = string.IsNullOrWhiteSpace(query.Search) ? null : query.Search.Trim();
        if (search is { Length: > MaxSearchLength })
            search = search[..MaxSearchLength];

        // 3 requêtes au plus, quelle que soit la taille du tenant : total, page, instances ouvertes groupées.
        var total = await _workflows.CountByTenantAsync(tenantId, search, cancellationToken);
        var rows = total == 0
            ? Array.Empty<StudioWorkflowCatalogRow>()
            : await _workflows.ListByTenantAsync(tenantId, search, (page - 1) * pageSize, pageSize, cancellationToken);
        var open = await _workflows.CountOpenInstancesForDefinitionsAsync(
            tenantId, rows.Select(r => r.Definition.Id).ToList(), cancellationToken);

        var items = rows
            .Select(r => new WorkflowDefinitionListItemDto(
                StudioWorkflowMapping.ToDto(r.Definition, open.GetValueOrDefault(r.Definition.Id)),
                r.EntityKey,
                r.EntityDisplayName))
            .ToList();

        return Result.Success(PagedResult<WorkflowDefinitionListItemDto>.Create(items, page, pageSize, total));
    }
}

// ---- Get ----

public sealed record GetWorkflowQuery(Guid Id) : IRequest<Result<WorkflowDefinitionDto>>;

public sealed class GetWorkflowQueryHandler : IRequestHandler<GetWorkflowQuery, Result<WorkflowDefinitionDto>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICurrentUser _currentUser;

    public GetWorkflowQueryHandler(IStudioWorkflowRepository workflows, ICurrentUser currentUser)
    {
        _workflows = workflows;
        _currentUser = currentUser;
    }

    public async Task<Result<WorkflowDefinitionDto>> Handle(GetWorkflowQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<WorkflowDefinitionDto>(err);

        var definition = await _workflows.GetDefinitionAsync(tenantId, query.Id, cancellationToken);
        if (definition is null)
            return Result.Failure<WorkflowDefinitionDto>(Error.NotFound("StudioWorkflowDefinition", query.Id));

        var open = await _workflows.CountOpenInstancesForDefinitionAsync(tenantId, definition.Id, cancellationToken);
        return Result.Success(StudioWorkflowMapping.ToDto(definition, open));
    }
}

// ---- Create ----

public sealed record CreateWorkflowCommand(Guid EntityId, SaveWorkflowRequest Request) : IRequest<Result<WorkflowDefinitionDto>>;

public sealed class CreateWorkflowCommandHandler : IRequestHandler<CreateWorkflowCommand, Result<WorkflowDefinitionDto>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly IStudioQuotaService _quota;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;
    private readonly IStudioWorkflowScheduleService _schedule;

    public CreateWorkflowCommandHandler(
        IStudioWorkflowRepository workflows,
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        IStudioQuotaService quota,
        IAuditService audit,
        ICurrentUser currentUser,
        IStudioWorkflowScheduleService schedule)
    {
        _workflows = workflows;
        _entities = entities;
        _fields = fields;
        _quota = quota;
        _audit = audit;
        _currentUser = currentUser;
        _schedule = schedule;
    }

    public async Task<Result<WorkflowDefinitionDto>> Handle(CreateWorkflowCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<WorkflowDefinitionDto>(err);

        var normalized = StudioWorkflowSaveSupport.Normalize(command.Request);
        if (normalized.IsFailure)
            return Result.Failure<WorkflowDefinitionDto>(normalized.Error);
        var save = normalized.Value;

        var entity = await _entities.GetByIdAsync(tenantId, command.EntityId, cancellationToken);
        if (entity is null)
            return Result.Failure<WorkflowDefinitionDto>(Error.NotFound("CustomEntity", command.EntityId));

        if (await _workflows.GetDefinitionByKeyAsync(tenantId, entity.Id, save.Key, cancellationToken) is not null)
            return Result.Failure<WorkflowDefinitionDto>(
                Error.Conflict($"Un workflow avec la clé « {save.Key} » existe déjà pour cette table."));

        var count = await _workflows.CountByEntityAsync(tenantId, entity.Id, cancellationToken);
        var quota = await _quota.EnsureUnderLimitAsync(
            tenantId, StudioQuotas.MaxWorkflowsKey, count, StudioQuotas.MaxWorkflowsFallback, "workflows par table", cancellationToken);
        if (quota.IsFailure)
            return Result.Failure<WorkflowDefinitionDto>(quota.Error);

        var outcome = await StudioWorkflowSaveSupport.ValidateAsync(save, entity, _entities, _fields, tenantId, cancellationToken);
        if (!outcome.IsValid)
            return Result.Failure<WorkflowDefinitionDto>(StudioWorkflowSaveSupport.ToError(outcome));

        var definition = StudioWorkflowDefinition.Create(
            tenantId, entity.Id, save.Key, save.Name, save.Description, save.Trigger, save.TriggerConfigJson, save.StepsJson, save.IsActive, userId);
        await _workflows.AddDefinitionAsync(definition, cancellationToken);

        await StudioAudit.SafeLogAsync(
            _audit, "Studio.Workflow.Created", "StudioWorkflowDefinition", definition.Id,
            null,
            new
            {
                definition.Key,
                definition.Name,
                Trigger = StudioWorkflowEnumNames.TriggerName(definition.Trigger),
                definition.IsActive,
                definition.Version,
                StepCount = outcome.Spec?.Steps.Count ?? 0
            },
            cancellationToken);

        // 4.7b2 / D-47-B03 : ordonnancement synchronisé à l'écriture (best-effort — jamais de 500 métier).
        await _schedule.SyncDefinitionAsync(definition, cancellationToken);

        return Result.Success(StudioWorkflowMapping.ToDto(definition, 0));
    }
}

// ---- Update ----

public sealed record UpdateWorkflowCommand(Guid Id, SaveWorkflowRequest Request) : IRequest<Result<WorkflowDefinitionDto>>;

public sealed class UpdateWorkflowCommandHandler : IRequestHandler<UpdateWorkflowCommand, Result<WorkflowDefinitionDto>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;
    private readonly IStudioWorkflowScheduleService _schedule;

    public UpdateWorkflowCommandHandler(
        IStudioWorkflowRepository workflows,
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        IAuditService audit,
        ICurrentUser currentUser,
        IStudioWorkflowScheduleService schedule)
    {
        _workflows = workflows;
        _entities = entities;
        _fields = fields;
        _audit = audit;
        _currentUser = currentUser;
        _schedule = schedule;
    }

    public async Task<Result<WorkflowDefinitionDto>> Handle(UpdateWorkflowCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<WorkflowDefinitionDto>(err);

        var definition = await _workflows.GetDefinitionAsync(tenantId, command.Id, cancellationToken);
        if (definition is null)
            return Result.Failure<WorkflowDefinitionDto>(Error.NotFound("StudioWorkflowDefinition", command.Id));

        // Concurrence optimiste : jeton obligatoire, pré-contrôle déterministe puis contrôle EF à l'écriture.
        var rowVersion = StudioWorkflowSaveSupport.ParseRowVersion(command.Request?.RowVersion);
        if (rowVersion.IsFailure)
            return Result.Failure<WorkflowDefinitionDto>(rowVersion.Error);
        var expected = rowVersion.Value;
        if (definition.RowVersion is { Length: > 0 } current && !current.AsSpan().SequenceEqual(expected))
            return Result.Failure<WorkflowDefinitionDto>(Error.Conflict(StudioWorkflowSaveSupport.ConcurrencyConflictMessage));

        var normalized = StudioWorkflowSaveSupport.Normalize(command.Request!);
        if (normalized.IsFailure)
            return Result.Failure<WorkflowDefinitionDto>(normalized.Error);
        var save = normalized.Value;

        if (!string.Equals(save.Key, definition.Key, StringComparison.Ordinal))
            return Result.Failure<WorkflowDefinitionDto>(Error.Validation("key", StudioWorkflowSaveSupport.KeyImmutableMessage));

        var entity = await _entities.GetByIdAsync(tenantId, definition.EntityDefinitionId, cancellationToken);
        if (entity is null)
            return Result.Failure<WorkflowDefinitionDto>(Error.NotFound("CustomEntity", definition.EntityDefinitionId));

        var outcome = await StudioWorkflowSaveSupport.ValidateAsync(save, entity, _entities, _fields, tenantId, cancellationToken);
        if (!outcome.IsValid)
            return Result.Failure<WorkflowDefinitionDto>(StudioWorkflowSaveSupport.ToError(outcome));

        var old = new
        {
            definition.Version,
            Trigger = StudioWorkflowEnumNames.TriggerName(definition.Trigger),
            definition.IsActive,
            definition.Name
        };

        definition.Update(save.Name, save.Description, save.Trigger, save.TriggerConfigJson, save.StepsJson, userId);
        if (definition.IsActive != save.IsActive)
            definition.SetActive(save.IsActive, userId);

        try
        {
            await _workflows.UpdateDefinitionWithConcurrencyAsync(definition, expected, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Result.Failure<WorkflowDefinitionDto>(Error.Conflict(StudioWorkflowSaveSupport.ConcurrencyConflictMessage));
        }

        await StudioAudit.SafeLogAsync(
            _audit, "Studio.Workflow.Updated", "StudioWorkflowDefinition", definition.Id,
            old,
            new
            {
                definition.Version,
                Trigger = StudioWorkflowEnumNames.TriggerName(definition.Trigger),
                definition.IsActive,
                definition.Name,
                StepCount = outcome.Spec?.Steps.Count ?? 0
            },
            cancellationToken);

        // 4.7b2 / D-47-B03 : cron / actif / déclencheur ont pu changer ⇒ synchronisation systématique.
        await _schedule.SyncDefinitionAsync(definition, cancellationToken);

        var open = await _workflows.CountOpenInstancesForDefinitionAsync(tenantId, definition.Id, cancellationToken);
        return Result.Success(StudioWorkflowMapping.ToDto(definition, open));
    }
}

// ---- Toggle ----

public sealed record ToggleWorkflowCommand(Guid Id, bool IsActive) : IRequest<Result<WorkflowDefinitionDto>>;

public sealed class ToggleWorkflowCommandHandler : IRequestHandler<ToggleWorkflowCommand, Result<WorkflowDefinitionDto>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;
    private readonly IStudioWorkflowScheduleService _schedule;

    public ToggleWorkflowCommandHandler(IStudioWorkflowRepository workflows, IAuditService audit, ICurrentUser currentUser, IStudioWorkflowScheduleService schedule)
    {
        _workflows = workflows;
        _audit = audit;
        _currentUser = currentUser;
        _schedule = schedule;
    }

    public async Task<Result<WorkflowDefinitionDto>> Handle(ToggleWorkflowCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<WorkflowDefinitionDto>(err);

        var definition = await _workflows.GetDefinitionAsync(tenantId, command.Id, cancellationToken);
        if (definition is null)
            return Result.Failure<WorkflowDefinitionDto>(Error.NotFound("StudioWorkflowDefinition", command.Id));

        var open = await _workflows.CountOpenInstancesForDefinitionAsync(tenantId, definition.Id, cancellationToken);

        // Idempotent : même état ⇒ aucune écriture ni audit.
        if (definition.IsActive == command.IsActive)
            return Result.Success(StudioWorkflowMapping.ToDto(definition, open));

        definition.SetActive(command.IsActive, userId);
        // Sans jeton (D-41-05) : la bascule ne porte que sur IsActive. Une course perdue à l'écriture
        // (RowVersion chargé ≠ RowVersion en base) reste un 409 de l'enveloppe Studio (D-41-16).
        try
        {
            await _workflows.UpdateDefinitionWithConcurrencyAsync(definition, null, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Result.Failure<WorkflowDefinitionDto>(Error.Conflict(StudioWorkflowSaveSupport.ConcurrencyConflictMessage));
        }

        await StudioAudit.SafeLogAsync(
            _audit, "Studio.Workflow.Toggled", "StudioWorkflowDefinition", definition.Id,
            new { IsActive = !command.IsActive },
            new { definition.IsActive },
            cancellationToken);

        // 4.7b2 / D-47-B03 : active un workflow planifié (job enregistré) ou le suspend (job retiré).
        await _schedule.SyncDefinitionAsync(definition, cancellationToken);

        return Result.Success(StudioWorkflowMapping.ToDto(definition, open));
    }
}

// ---- Delete (soft) ----

public sealed record DeleteWorkflowCommand(Guid Id) : IRequest<Result<WorkflowDeletionResultDto>>;

public sealed class DeleteWorkflowCommandHandler : IRequestHandler<DeleteWorkflowCommand, Result<WorkflowDeletionResultDto>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly IStudioWorkflowEngine _engine;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<DeleteWorkflowCommandHandler> _logger;
    private readonly IStudioWorkflowScheduleService _schedule;

    public DeleteWorkflowCommandHandler(
        IStudioWorkflowRepository workflows,
        IStudioWorkflowEngine engine,
        IAuditService audit,
        ICurrentUser currentUser,
        ILogger<DeleteWorkflowCommandHandler> logger,
        IStudioWorkflowScheduleService schedule)
    {
        _workflows = workflows;
        _engine = engine;
        _audit = audit;
        _currentUser = currentUser;
        _logger = logger;
        _schedule = schedule;
    }

    public async Task<Result<WorkflowDeletionResultDto>> Handle(DeleteWorkflowCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<WorkflowDeletionResultDto>(err);

        // Le filtre IsDeleted du contexte fait qu'une seconde suppression répond 404.
        var definition = await _workflows.GetDefinitionAsync(tenantId, command.Id, cancellationToken);
        if (definition is null)
            return Result.Failure<WorkflowDeletionResultDto>(Error.NotFound("StudioWorkflowDefinition", command.Id));

        var old = new { definition.Key, definition.Name, definition.Version, definition.IsActive };

        var openInstances = await _workflows.ListOpenInstancesForDefinitionAsync(tenantId, definition.Id, cancellationToken);

        definition.SoftDelete(userId);
        try
        {
            await _workflows.UpdateDefinitionWithConcurrencyAsync(definition, null, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Rien n'est annulé si la définition a bougé entre-temps : le client recharge puis réessaie (D-41-16).
            return Result.Failure<WorkflowDeletionResultDto>(Error.Conflict(StudioWorkflowSaveSupport.ConcurrencyConflictMessage));
        }

        var cancelled = 0;
        foreach (var instance in openInstances)
        {
            try
            {
                await _engine.CancelAsync(instance, "Workflow supprimé", userId, cancellationToken);
                cancelled++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // La reprise différée annulera de toute façon une instance dont la définition a disparu.
                _logger.LogWarning(ex,
                    "Studio workflow {WorkflowId} : annulation de l'instance {InstanceId} impossible lors de la suppression",
                    definition.Id, instance.Id);
            }
        }

        await StudioAudit.SafeLogAsync(
            _audit, "Studio.Workflow.Deleted", "StudioWorkflowDefinition", definition.Id,
            old,
            new { CancelledInstances = cancelled },
            cancellationToken);

        // 4.7b2 / D-47-B03 : le job planifié est retiré avec la définition.
        await _schedule.RemoveDefinitionAsync(tenantId, definition.Id, cancellationToken);

        return Result.Success(new WorkflowDeletionResultDto(cancelled));
    }
}

// ---------------------------------------------------------------------------------------------
// Studio IA 4.1j2 — duplication, validation à blanc, catalogue des étapes, instances.
// ---------------------------------------------------------------------------------------------

// ---- Duplicate ----

public sealed record DuplicateWorkflowCommand(Guid Id) : IRequest<Result<WorkflowDefinitionDto>>;

public sealed class DuplicateWorkflowCommandHandler : IRequestHandler<DuplicateWorkflowCommand, Result<WorkflowDefinitionDto>>
{
    private const string CopySuffix = "_copie";
    private const int MaxCopies = 9;

    private readonly IStudioWorkflowRepository _workflows;
    private readonly IStudioQuotaService _quota;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public DuplicateWorkflowCommandHandler(
        IStudioWorkflowRepository workflows, IStudioQuotaService quota, IAuditService audit, ICurrentUser currentUser)
    {
        _workflows = workflows;
        _quota = quota;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result<WorkflowDefinitionDto>> Handle(DuplicateWorkflowCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<WorkflowDefinitionDto>(err);

        var source = await _workflows.GetDefinitionAsync(tenantId, command.Id, cancellationToken);
        if (source is null)
            return Result.Failure<WorkflowDefinitionDto>(Error.NotFound("StudioWorkflowDefinition", command.Id));

        var count = await _workflows.CountByEntityAsync(tenantId, source.EntityDefinitionId, cancellationToken);
        var quota = await _quota.EnsureUnderLimitAsync(
            tenantId, StudioQuotas.MaxWorkflowsKey, count, StudioQuotas.MaxWorkflowsFallback, "workflows par table", cancellationToken);
        if (quota.IsFailure)
            return Result.Failure<WorkflowDefinitionDto>(quota.Error);

        string? key = null;
        for (var n = 1; n <= MaxCopies && key is null; n++)
        {
            var candidate = Suffix(source.Key, n == 1 ? CopySuffix : $"{CopySuffix}_{n}");
            if (await _workflows.GetDefinitionByKeyAsync(tenantId, source.EntityDefinitionId, candidate, cancellationToken) is null)
                key = candidate;
        }
        if (key is null)
            return Result.Failure<WorkflowDefinitionDto>(Error.Conflict(
                $"Impossible de dupliquer : les clés « {source.Key}{CopySuffix} » à « {source.Key}{CopySuffix}_{MaxCopies} » sont déjà utilisées."));

        var name = Truncate($"{source.Name} (copie)", StudioWorkflowDefinition.NameMaxLength);

        // Pas de revalidation des étapes : la source a été validée à l'enregistrement ; la copie est inactive.
        var copy = StudioWorkflowDefinition.Create(
            tenantId, source.EntityDefinitionId, key, name, source.Description, source.Trigger,
            source.TriggerConfigJson, source.StepsJson, isActive: false, userId);
        await _workflows.AddDefinitionAsync(copy, cancellationToken);

        await StudioAudit.SafeLogAsync(
            _audit, "Studio.Workflow.Duplicated", "StudioWorkflowDefinition", copy.Id,
            null,
            new { SourceId = source.Id, SourceKey = source.Key, copy.Key },
            cancellationToken);

        return Result.Success(StudioWorkflowMapping.ToDto(copy, 0));
    }

    /// <summary>Ajoute <paramref name="suffix"/> en tronquant la base (sans « _ » final) pour tenir dans 64 caractères.</summary>
    internal static string Suffix(string baseKey, string suffix)
    {
        var max = StudioWorkflowDefinition.KeyMaxLength;
        var head = baseKey.Length + suffix.Length <= max ? baseKey : baseKey[..(max - suffix.Length)].TrimEnd('_');
        return head + suffix;
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
}

// ---- Validate (à blanc) ----

public sealed record ValidateWorkflowQuery(Guid EntityId, SaveWorkflowRequest Request) : IRequest<Result<WorkflowValidationResultDto>>;

public sealed class ValidateWorkflowQueryHandler : IRequestHandler<ValidateWorkflowQuery, Result<WorkflowValidationResultDto>>
{
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICurrentUser _currentUser;

    public ValidateWorkflowQueryHandler(ICustomEntityRepository entities, ICustomFieldRepository fields, ICurrentUser currentUser)
    {
        _entities = entities;
        _fields = fields;
        _currentUser = currentUser;
    }

    public async Task<Result<WorkflowValidationResultDto>> Handle(ValidateWorkflowQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<WorkflowValidationResultDto>(err);

        var entity = await _entities.GetByIdAsync(tenantId, query.EntityId, cancellationToken);
        if (entity is null)
            return Result.Failure<WorkflowValidationResultDto>(Error.NotFound("CustomEntity", query.EntityId));

        // Jamais de Result.Failure pour une définition invalide : 200 avec la liste des problèmes.
        var issues = StudioWorkflowSaveSupport.NormalizeAsIssues(query.Request, out var normalized);
        if (normalized is null)
            return Result.Success(new WorkflowValidationResultDto(false, ToDto(issues), Array.Empty<WorkflowValidationIssueDto>(), 0));

        var outcome = await StudioWorkflowSaveSupport.ValidateAsync(normalized, entity, _entities, _fields, tenantId, cancellationToken);

        // « normalized » non null ⇒ aucune issue de forme : seul le verdict des étapes compte.
        return Result.Success(new WorkflowValidationResultDto(
            outcome.IsValid,
            ToDto(outcome.Errors),
            ToDto(outcome.Warnings),
            outcome.Spec?.Steps.Count ?? 0));
    }

    private static IReadOnlyList<WorkflowValidationIssueDto> ToDto(IEnumerable<WorkflowValidationIssue> issues)
        => issues.Select(i => new WorkflowValidationIssueDto(i.Path, i.Message)).ToList();
}

// ---- Step catalog ----

public sealed record GetWorkflowStepCatalogQuery() : IRequest<Result<WorkflowStepCatalogDto>>;

public sealed class GetWorkflowStepCatalogQueryHandler : IRequestHandler<GetWorkflowStepCatalogQuery, Result<WorkflowStepCatalogDto>>
{
    // Pur et sans tenant : la policy du contrôleur protège l'accès (D-41-04 : Entries seul).
    public Task<Result<WorkflowStepCatalogDto>> Handle(GetWorkflowStepCatalogQuery query, CancellationToken cancellationToken)
    {
        var entries = StudioWorkflowStepTypes.Catalog()
            .Select(e => new StepCatalogEntryDto(
                e.Type,
                e.Label,
                e.Description,
                e.Properties.Select(p => new StepCatalogPropertyDto(p.Name, p.Kind, p.Required, p.Help, p.AllowedValues, p.Min, p.Max)).ToList()))
            .ToList();
        return Task.FromResult(Result.Success(new WorkflowStepCatalogDto(entries)));
    }
}

// ---- Instances ----

/// <summary>Instances d'un workflow paginées ; <c>Page</c> ≥ 1, <c>PageSize</c> borné 1..200 (4.7a1 / D-47-B01 : lève D-46-01).</summary>
public sealed record ListWorkflowInstancesQuery(Guid WorkflowId, int Page = 1, int PageSize = 50)
    : IRequest<Result<PagedResult<WorkflowInstanceDto>>>;

public sealed class ListWorkflowInstancesQueryHandler : IRequestHandler<ListWorkflowInstancesQuery, Result<PagedResult<WorkflowInstanceDto>>>
{
    public const int MaxPageSize = 200;

    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICurrentUser _currentUser;
    private readonly IStudioUserNameResolver _userNames;

    public ListWorkflowInstancesQueryHandler(IStudioWorkflowRepository workflows, ICurrentUser currentUser, IStudioUserNameResolver userNames)
    {
        _workflows = workflows;
        _currentUser = currentUser;
        _userNames = userNames;
    }

    public async Task<Result<PagedResult<WorkflowInstanceDto>>> Handle(ListWorkflowInstancesQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<PagedResult<WorkflowInstanceDto>>(err);

        var definition = await _workflows.GetDefinitionAsync(tenantId, query.WorkflowId, cancellationToken);
        if (definition is null)
            return Result.Failure<PagedResult<WorkflowInstanceDto>>(Error.NotFound("StudioWorkflowDefinition", query.WorkflowId));

        // `page` borné pour que `(page - 1) * pageSize` ne déborde jamais (motif D-45-28).
        var page = Math.Clamp(query.Page, 1, int.MaxValue / MaxPageSize);
        var pageSize = Math.Clamp(query.PageSize, 1, MaxPageSize);

        // 2 requêtes par appel : total, puis page (page vide si total nul).
        var total = await _workflows.CountInstancesForDefinitionAsync(tenantId, definition.Id, cancellationToken);
        var instances = total == 0
            ? (IReadOnlyList<StudioWorkflowInstance>)Array.Empty<StudioWorkflowInstance>()
            : await _workflows.ListInstancesForDefinitionAsync(
                tenantId, definition.Id, (page - 1) * pageSize, pageSize, cancellationToken);

        var items = instances.Select(i => StudioWorkflowMapping.ToDto(i, definition)).ToList();
        var resolved = await StudioWorkflowStartedByNameSupport.ResolveAsync(_userNames, tenantId, items, cancellationToken);
        return Result.Success(PagedResult<WorkflowInstanceDto>.Create(resolved, page, pageSize, total));
    }
}

/// <summary>
/// Détail d'une instance (résumé, étapes triées par index puis début, approbations, contexte sans « previous » — D-41-09),
/// partagé par la route de conception (<see cref="GetWorkflowInstanceQueryHandler"/>) et la route runtime lecteur (4.5b1, D-45-05).
/// En portée lecteur (<paramref name="readerScope"/>), le contexte est en outre expurgé de l'e-mail du lanceur et des sorties
/// brutes des étapes (<c>results</c>, <c>vars</c>) : un profil <c>custom_records:read</c> n'a pas à recevoir ces données
/// que le tiroir ne rend pas (D-45-27 ; 4.6b2 / D-46-B02 : <c>Steps[].Result</c> et <c>Steps[].Error</c> sont aussi nullés).
/// </summary>
internal static class StudioWorkflowInstanceDetailBuilder
{
    public static async Task<WorkflowInstanceDetailDto> BuildAsync(
        IStudioWorkflowRepository workflows, Guid tenantId, StudioWorkflowInstance instance, CancellationToken cancellationToken,
        bool readerScope = false, IStudioUserNameResolver? userNames = null)
    {
        // Définition possiblement supprimée (filtre IsDeleted) ⇒ WorkflowKey / WorkflowName null.
        var definition = await workflows.GetDefinitionAsync(tenantId, instance.WorkflowDefinitionId, cancellationToken);
        var stepRuns = await workflows.ListStepRunsAsync(tenantId, instance.Id, cancellationToken);
        var approvals = await workflows.ListApprovalsForInstanceAsync(tenantId, instance.Id, cancellationToken);

        // Les données « avant » de l'enregistrement ne sortent pas de l'API : clé conservée, valeur masquée (D-41-09).
        var context = StudioWorkflowMapping.ParseObject(instance.ContextJson);
        context["previous"] = null;
        if (readerScope)
        {
            if (context["startedBy"] is JsonObject startedBy)
                startedBy["email"] = null;
            context["results"] = new JsonObject();
            context["vars"] = new JsonObject();
        }

        var summary = StudioWorkflowMapping.ToDto(instance, definition);
        if (userNames is not null)
            summary = await StudioWorkflowStartedByNameSupport.ResolveOneAsync(userNames, tenantId, summary, cancellationToken);

        // Portée lecteur (revue ★ 4.6) : l'erreur au niveau instance (texte interne possible) suit la même
        // règle que les erreurs des étapes ci-dessous — elle ne sort pas de la route lecteur.
        if (readerScope)
            summary = summary with { Error = null };

        // Portée lecteur (D-46-B02, lève le résiduel de D-45-27) : les sorties (même tronquées) et les erreurs
        // internes des étapes ne sortent pas — le tiroir ne les rend pas.
        var steps = stepRuns.OrderBy(r => r.StepIndex).ThenBy(r => r.StartedAt)
            .Select(r =>
            {
                var dto = StudioWorkflowMapping.ToDto(r);
                return readerScope ? dto with { Result = null, Error = null } : dto;
            });

        return new WorkflowInstanceDetailDto(
            summary,
            steps.ToList(),
            approvals.Select(StudioWorkflowMapping.ToDto).ToList(),
            context);
    }
}

/// <summary>
/// 4.6b1 / D-46-B01 — « Demandé par » sur les instances : résolution du nom du lanceur en une requête
/// par page (même motif que l'inbox 4.5a2, <c>StudioWorkflowApprovalFeatures</c>) ; lanceur inconnu ⇒
/// <see langword="null"/> (D-45-02, jamais de repli sur l'e-mail). Appelée seulement par les handlers qui
/// servent des listes ou des détails d'instances ; les réponses ponctuelles (cancel / remind / start)
/// laissent <c>StartedByName</c> à null.
/// </summary>
internal static class StudioWorkflowStartedByNameSupport
{
    public static async Task<List<WorkflowInstanceDto>> ResolveAsync(
        IStudioUserNameResolver userNames, Guid tenantId, List<WorkflowInstanceDto> items, CancellationToken cancellationToken)
    {
        var starterIds = items.Where(i => i.StartedBy is not null).Select(i => i.StartedBy!.Value).Distinct().ToList();
        if (starterIds.Count == 0)
            return items;
        var names = await userNames.GetDisplayNamesAsync(tenantId, starterIds, cancellationToken);
        for (var k = 0; k < items.Count; k++)
        {
            if (items[k].StartedBy is { } starter && names.TryGetValue(starter, out var name))
                items[k] = items[k] with { StartedByName = name };
        }
        return items;
    }

    public static async Task<WorkflowInstanceDto> ResolveOneAsync(
        IStudioUserNameResolver userNames, Guid tenantId, WorkflowInstanceDto item, CancellationToken cancellationToken)
    {
        if (item.StartedBy is not { } starter)
            return item;
        var names = await userNames.GetDisplayNamesAsync(tenantId, new[] { starter }, cancellationToken);
        return names.TryGetValue(starter, out var name) ? item with { StartedByName = name } : item;
    }
}

public sealed record GetWorkflowInstanceQuery(Guid InstanceId) : IRequest<Result<WorkflowInstanceDetailDto>>;

public sealed class GetWorkflowInstanceQueryHandler : IRequestHandler<GetWorkflowInstanceQuery, Result<WorkflowInstanceDetailDto>>
{
    private readonly IStudioWorkflowRepository _workflows;
    private readonly ICurrentUser _currentUser;
    private readonly IStudioUserNameResolver _userNames;

    public GetWorkflowInstanceQueryHandler(IStudioWorkflowRepository workflows, ICurrentUser currentUser, IStudioUserNameResolver userNames)
    {
        _workflows = workflows;
        _currentUser = currentUser;
        _userNames = userNames;
    }

    public async Task<Result<WorkflowInstanceDetailDto>> Handle(GetWorkflowInstanceQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<WorkflowInstanceDetailDto>(err);

        var instance = await _workflows.GetInstanceAsync(tenantId, query.InstanceId, cancellationToken);
        if (instance is null)
            return Result.Failure<WorkflowInstanceDetailDto>(Error.NotFound("StudioWorkflowInstance", query.InstanceId));

        return Result.Success(await StudioWorkflowInstanceDetailBuilder.BuildAsync(
            _workflows, tenantId, instance, cancellationToken, userNames: _userNames));
    }
}
