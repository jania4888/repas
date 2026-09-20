using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Records;
using FactuTrust.Application.Features.Studio.Workflows;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.Studio.Automations;

// ---- DTOs ----

public sealed record AutomationDto(
    Guid Id, string Name, StudioAutomationTrigger Trigger, string ActionKey,
    IReadOnlyList<BridgeParamMapping> Mapping, bool RunOnce, bool IsActive);

public sealed record SaveAutomationRequest(
    string Name, StudioAutomationTrigger Trigger, string ActionKey,
    IReadOnlyList<BridgeParamMapping>? Mapping, bool RunOnce, bool IsActive);

/// <summary>An ERP action the bridge can run, with its parameters — drives the mapping UI.</summary>
public sealed record AutomationActionParamDto(string Name, string Description, bool Required, IReadOnlyList<string>? AllowedValues);
public sealed record AutomationActionDto(string Name, string Description, IReadOnlyList<AutomationActionParamDto> Parameters);

public sealed record AutomationRunDto(Guid Id, Guid AutomationId, string Status, string? ResultJson, string? Error, DateTime RunAt);

internal static class AutomationMapper
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static AutomationDto ToDto(CustomEntityAutomation a) =>
        new(a.Id, a.Name, a.Trigger, a.ActionKey, StudioBridgeMapper.ParseMappings(a.MappingJson), a.RunOnce, a.IsActive);

    public static string SerializeMapping(IReadOnlyList<BridgeParamMapping>? mapping) =>
        JsonSerializer.Serialize(mapping ?? Array.Empty<BridgeParamMapping>(), Json);

    public static AutomationRunDto ToDto(CustomAutomationRun r) =>
        new(r.Id, r.AutomationId, r.Status.ToString(), r.ResultJson, r.Error, r.RunAt);
}

// ---- List actions catalog : actions pontables (mutantes, hors studio_*) — même catalogue que les workflows ----

public sealed record ListAutomationActionsQuery : IRequest<Result<IReadOnlyList<AutomationActionDto>>>;

public sealed class ListAutomationActionsQueryHandler : IRequestHandler<ListAutomationActionsQuery, Result<IReadOnlyList<AutomationActionDto>>>
{
    public Task<Result<IReadOnlyList<AutomationActionDto>>> Handle(ListAutomationActionsQuery request, CancellationToken cancellationToken)
    {
        var actions = StudioBridgeActionCatalog.List()
            .Select(t => new AutomationActionDto(
                t.Name, t.Description,
                t.Parameters.Select(p => new AutomationActionParamDto(
                    p.Key, p.Value.Description, t.RequiredParameters.Contains(p.Key), p.Value.AllowedValues)).ToList()))
            .ToList();
        return Task.FromResult(Result.Success<IReadOnlyList<AutomationActionDto>>(actions));
    }
}

// ---- List automations of an entity ----

public sealed record ListAutomationsQuery(Guid EntityId) : IRequest<Result<IReadOnlyList<AutomationDto>>>;

public sealed class ListAutomationsQueryHandler : IRequestHandler<ListAutomationsQuery, Result<IReadOnlyList<AutomationDto>>>
{
    private readonly ICustomAutomationRepository _repo;
    private readonly ICurrentUser _currentUser;
    public ListAutomationsQueryHandler(ICustomAutomationRepository repo, ICurrentUser currentUser) { _repo = repo; _currentUser = currentUser; }

    public async Task<Result<IReadOnlyList<AutomationDto>>> Handle(ListAutomationsQuery request, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<IReadOnlyList<AutomationDto>>(err);
        var list = await _repo.ListByEntityAsync(tenantId, request.EntityId, includeInactive: true, cancellationToken);
        return Result.Success<IReadOnlyList<AutomationDto>>(list.Select(AutomationMapper.ToDto).ToList());
    }
}

// ---- Upsert ----

public sealed record UpsertAutomationCommand(Guid EntityId, Guid? Id, SaveAutomationRequest Request) : IRequest<Result<AutomationDto>>;

public sealed class UpsertAutomationCommandHandler : IRequestHandler<UpsertAutomationCommand, Result<AutomationDto>>
{
    private readonly ICustomAutomationRepository _repo;
    private readonly ICustomEntityRepository _entities;
    private readonly ICurrentUser _currentUser;

    public UpsertAutomationCommandHandler(ICustomAutomationRepository repo, ICustomEntityRepository entities, ICurrentUser currentUser)
    { _repo = repo; _entities = entities; _currentUser = currentUser; }

    public async Task<Result<AutomationDto>> Handle(UpsertAutomationCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<AutomationDto>(err);

        var req = command.Request;
        if (string.IsNullOrWhiteSpace(req.Name))
            return Result.Failure<AutomationDto>(Error.Validation("name", "Le nom de l'automatisation est obligatoire."));

        if (StudioBridgeActionCatalog.Resolve(req.ActionKey) is null)
            return Result.Failure<AutomationDto>(Error.Validation("action", "Action ERP inconnue ou non autorisée."));

        var entity = await _entities.GetByIdAsync(tenantId, command.EntityId, cancellationToken);
        if (entity is null)
            return Result.Failure<AutomationDto>(Error.NotFound("CustomEntity", command.EntityId));

        var mappingJson = AutomationMapper.SerializeMapping(req.Mapping);

        CustomEntityAutomation automation;
        if (command.Id is { } id)
        {
            var existing = await _repo.GetAsync(tenantId, id, cancellationToken);
            if (existing is null)
                return Result.Failure<AutomationDto>(Error.NotFound("Automation", id));
            existing.Update(req.Name.Trim(), req.Trigger, req.ActionKey, mappingJson, null, req.RunOnce, null, req.IsActive, userId);
            await _repo.UpdateAsync(existing, cancellationToken);
            automation = existing;
        }
        else
        {
            automation = CustomEntityAutomation.Create(
                tenantId, command.EntityId, req.Name.Trim(), req.Trigger, req.ActionKey, mappingJson, null, req.RunOnce, null, userId);
            await _repo.AddAsync(automation, cancellationToken);
        }

        return Result.Success(AutomationMapper.ToDto(automation));
    }
}

// ---- Delete ----

public sealed record DeleteAutomationCommand(Guid Id) : IRequest<Result>;

public sealed class DeleteAutomationCommandHandler : IRequestHandler<DeleteAutomationCommand, Result>
{
    private readonly ICustomAutomationRepository _repo;
    private readonly ICurrentUser _currentUser;
    public DeleteAutomationCommandHandler(ICustomAutomationRepository repo, ICurrentUser currentUser) { _repo = repo; _currentUser = currentUser; }

    public async Task<Result> Handle(DeleteAutomationCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure(err);
        var automation = await _repo.GetAsync(tenantId, command.Id, cancellationToken);
        if (automation is null)
            return Result.Failure(Error.NotFound("Automation", command.Id));
        await _repo.DeleteAsync(automation, cancellationToken);
        return Result.Success();
    }
}

// ---- Run on demand (manual) ----

public sealed record RunAutomationCommand(string EntityKey, Guid RecordId, Guid AutomationId) : IRequest<Result<AutomationRunDto>>;

public sealed class RunAutomationCommandHandler : IRequestHandler<RunAutomationCommand, Result<AutomationRunDto>>
{
    private readonly ICustomAutomationRepository _repo;
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomRecordRepository _records;
    private readonly IStudioBridgeExecutor _executor;
    private readonly ICurrentUser _currentUser;

    public RunAutomationCommandHandler(
        ICustomAutomationRepository repo, ICustomEntityRepository entities, ICustomRecordRepository records,
        IStudioBridgeExecutor executor, ICurrentUser currentUser)
    { _repo = repo; _entities = entities; _records = records; _executor = executor; _currentUser = currentUser; }

    public async Task<Result<AutomationRunDto>> Handle(RunAutomationCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<AutomationRunDto>(err);

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(_entities, tenantId, command.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<AutomationRunDto>(resolveError);

        var automation = await _repo.GetAsync(tenantId, command.AutomationId, cancellationToken);
        if (automation is null || automation.EntityDefinitionId != entity.Id)
            return Result.Failure<AutomationRunDto>(Error.NotFound("Automation", command.AutomationId));

        var record = await _records.GetAsync(tenantId, entity.Id, command.RecordId, cancellationToken);
        if (record is null)
            return Result.Failure<AutomationRunDto>(Error.NotFound("CustomRecord", command.RecordId));

        var data = TryParse(record.DataJson);
        var run = await _executor.ExecuteAsync(automation, tenantId, record.Id, data, userId, cancellationToken);
        return Result.Success(AutomationMapper.ToDto(run));
    }

    private static System.Text.Json.Nodes.JsonObject? TryParse(string json)
    {
        try { return System.Text.Json.Nodes.JsonNode.Parse(json) as System.Text.Json.Nodes.JsonObject; }
        catch (JsonException) { return null; }
    }
}

// ---- Runs for a record (status / link-back) ----

public sealed record ListRecordAutomationRunsQuery(string EntityKey, Guid RecordId) : IRequest<Result<IReadOnlyList<AutomationRunDto>>>;

public sealed class ListRecordAutomationRunsQueryHandler : IRequestHandler<ListRecordAutomationRunsQuery, Result<IReadOnlyList<AutomationRunDto>>>
{
    private readonly ICustomAutomationRepository _repo;
    private readonly ICustomEntityRepository _entities;
    private readonly ICurrentUser _currentUser;

    public ListRecordAutomationRunsQueryHandler(ICustomAutomationRepository repo, ICustomEntityRepository entities, ICurrentUser currentUser)
    { _repo = repo; _entities = entities; _currentUser = currentUser; }

    public async Task<Result<IReadOnlyList<AutomationRunDto>>> Handle(ListRecordAutomationRunsQuery request, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<IReadOnlyList<AutomationRunDto>>(err);
        var runs = await _repo.ListRunsForRecordAsync(tenantId, request.RecordId, 20, cancellationToken);
        return Result.Success<IReadOnlyList<AutomationRunDto>>(runs.Select(AutomationMapper.ToDto).ToList());
    }
}
