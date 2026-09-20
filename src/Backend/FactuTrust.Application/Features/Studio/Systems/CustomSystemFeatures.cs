using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using MediatR;

namespace FactuTrust.Application.Features.Studio.Systems;

public sealed record ListCustomSystemsQuery(bool IncludeInactive = false)
    : IRequest<Result<IReadOnlyList<CustomSystemDto>>>;

public sealed class ListCustomSystemsQueryHandler
    : IRequestHandler<ListCustomSystemsQuery, Result<IReadOnlyList<CustomSystemDto>>>
{
    private readonly ICustomSystemRepository _systems;
    private readonly ICustomEntityRepository _entities;
    private readonly ICurrentUser _currentUser;

    public ListCustomSystemsQueryHandler(
        ICustomSystemRepository systems, ICustomEntityRepository entities, ICurrentUser currentUser)
    {
        _systems = systems;
        _entities = entities;
        _currentUser = currentUser;
    }

    public async Task<Result<IReadOnlyList<CustomSystemDto>>> Handle(ListCustomSystemsQuery request, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<IReadOnlyList<CustomSystemDto>>(err);

        var list = await _systems.ListAsync(tenantId, request.IncludeInactive, cancellationToken);
        var allEntities = await _entities.ListAsync(tenantId, includeInactive: false, cancellationToken);
        var dtos = list.Select(s =>
        {
            var count = allEntities.Count(e => e.SystemId == s.Id);
            return StudioMappers.ToSystemDto(s, count, ParseOnboarding(s.OnboardingJson));
        }).ToList();
        return Result.Success<IReadOnlyList<CustomSystemDto>>(dtos);
    }

    internal static IReadOnlyList<string>? ParseOnboarding(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var steps = JsonSerializer.Deserialize<List<string>>(json);
            return steps?.Count > 0 ? steps : null;
        }
        catch (JsonException) { return null; }
    }

    internal static string? SerializeOnboarding(IReadOnlyList<string>? steps) =>
        steps is null || steps.Count == 0 ? null : JsonSerializer.Serialize(steps);
}

public sealed record GetCustomSystemByKeyQuery(string Key) : IRequest<Result<CustomSystemDetailDto>>;

public sealed class GetCustomSystemByKeyQueryHandler
    : IRequestHandler<GetCustomSystemByKeyQuery, Result<CustomSystemDetailDto>>
{
    private readonly ICustomSystemRepository _systems;
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICurrentUser _currentUser;

    public GetCustomSystemByKeyQueryHandler(
        ICustomSystemRepository systems, ICustomEntityRepository entities, ICustomFieldRepository fields, ICurrentUser currentUser)
    {
        _systems = systems;
        _entities = entities;
        _fields = fields;
        _currentUser = currentUser;
    }

    public async Task<Result<CustomSystemDetailDto>> Handle(GetCustomSystemByKeyQuery request, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<CustomSystemDetailDto>(err);

        var system = await _systems.GetByKeyAsync(tenantId, request.Key.Trim().ToLowerInvariant(), cancellationToken);
        if (system is null)
            return Result.Failure<CustomSystemDetailDto>(new Error("CustomSystem.NotFound", $"CustomSystem with key '{request.Key}' was not found."));

        var entityList = await _entities.ListBySystemIdAsync(tenantId, system.Id, cancellationToken);
        var entityDtos = new List<CustomEntityDto>(entityList.Count);
        foreach (var e in entityList)
        {
            var fc = await _fields.CountByEntityAsync(tenantId, e.Id, cancellationToken);
            entityDtos.Add(StudioMappers.ToDto(e, fc));
        }

        var sysDto = StudioMappers.ToSystemDto(system, entityDtos.Count, ListCustomSystemsQueryHandler.ParseOnboarding(system.OnboardingJson));
        return Result.Success(new CustomSystemDetailDto(sysDto, entityDtos));
    }
}

public sealed record CreateCustomSystemCommand(CreateCustomSystemRequest Request) : IRequest<Result<CustomSystemDto>>;

public sealed class CreateCustomSystemCommandHandler
    : IRequestHandler<CreateCustomSystemCommand, Result<CustomSystemDto>>
{
    private readonly ICustomSystemRepository _systems;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public CreateCustomSystemCommandHandler(ICustomSystemRepository systems, IAuditService audit, ICurrentUser currentUser)
    {
        _systems = systems;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result<CustomSystemDto>> Handle(CreateCustomSystemCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<CustomSystemDto>(err);

        var req = command.Request;
        var key = req.Key?.Trim().ToLowerInvariant() ?? string.Empty;
        if (!StudioKey.IsValidShape(key))
            return Result.Failure<CustomSystemDto>(Error.Validation("key", "Clé système invalide."));
        if (StudioKey.IsReservedSystemKey(key))
            return Result.Failure<CustomSystemDto>(Error.Validation("key", "Clé système réservée."));
        if (string.IsNullOrWhiteSpace(req.DisplayName))
            return Result.Failure<CustomSystemDto>(Error.Validation("displayName", "Le nom est obligatoire."));
        if (await _systems.KeyExistsAsync(tenantId, key, cancellationToken))
            return Result.Failure<CustomSystemDto>(Error.Conflict($"Un système avec la clé « {key} » existe déjà."));

        var onboardingJson = ListCustomSystemsQueryHandler.SerializeOnboarding(req.OnboardingSteps);
        var system = CustomSystemDefinition.Create(tenantId, key, req.DisplayName.Trim(),
            req.Icon?.Trim(), req.Description?.Trim(), onboardingJson, userId);

        await _systems.AddAsync(system, cancellationToken);
        await StudioAudit.SafeLogAsync(_audit, "Studio.System.Created", "CustomSystem", system.Id,
            null, new { system.Key, system.DisplayName }, cancellationToken);

        return Result.Success(StudioMappers.ToSystemDto(system, 0, req.OnboardingSteps));
    }
}

// ---- Delete (soft) ----

public sealed record DeleteCustomSystemCommand(Guid Id) : IRequest<Result>;

public sealed class DeleteCustomSystemCommandHandler : IRequestHandler<DeleteCustomSystemCommand, Result>
{
    private readonly ICustomSystemRepository _systems;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public DeleteCustomSystemCommandHandler(ICustomSystemRepository systems, IAuditService audit, ICurrentUser currentUser)
    {
        _systems = systems;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result> Handle(DeleteCustomSystemCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure(err);

        var system = await _systems.GetByIdAsync(tenantId, command.Id, cancellationToken);
        if (system is null)
            return Result.Failure(Error.NotFound("CustomSystem", command.Id));

        system.SoftDelete(userId);
        await _systems.UpdateAsync(system, cancellationToken);
        await StudioAudit.SafeLogAsync(_audit, "Studio.System.Deleted", "CustomSystem", system.Id,
            new { system.Key, system.DisplayName }, null, cancellationToken);
        return Result.Success();
    }
}

public sealed record AssignEntityToSystemCommand(Guid EntityId, Guid? SystemId) : IRequest<Result<CustomEntityDto>>;

public sealed class AssignEntityToSystemCommandHandler
    : IRequestHandler<AssignEntityToSystemCommand, Result<CustomEntityDto>>
{
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomSystemRepository _systems;
    private readonly ICustomFieldRepository _fields;
    private readonly ICurrentUser _currentUser;

    public AssignEntityToSystemCommandHandler(
        ICustomEntityRepository entities, ICustomSystemRepository systems, ICustomFieldRepository fields, ICurrentUser currentUser)
    {
        _entities = entities;
        _systems = systems;
        _fields = fields;
        _currentUser = currentUser;
    }

    public async Task<Result<CustomEntityDto>> Handle(AssignEntityToSystemCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<CustomEntityDto>(err);

        var entity = await _entities.GetByIdAsync(tenantId, command.EntityId, cancellationToken);
        if (entity is null)
            return Result.Failure<CustomEntityDto>(Error.NotFound("CustomEntity", command.EntityId));

        if (command.SystemId is Guid sid)
        {
            var system = await _systems.GetByIdAsync(tenantId, sid, cancellationToken);
            if (system is null)
                return Result.Failure<CustomEntityDto>(Error.NotFound("CustomSystem", sid));
        }

        entity.AssignToSystem(command.SystemId, userId);
        await _entities.UpdateAsync(entity, cancellationToken);
        var count = await _fields.CountByEntityAsync(tenantId, entity.Id, cancellationToken);
        return Result.Success(StudioMappers.ToDto(entity, count));
    }
}

public sealed record GetStudioNavQuery() : IRequest<Result<IReadOnlyList<StudioNavNodeDto>>>;

public sealed class GetStudioNavQueryHandler
    : IRequestHandler<GetStudioNavQuery, Result<IReadOnlyList<StudioNavNodeDto>>>
{
    private readonly ICustomSystemRepository _systems;
    private readonly ICustomEntityRepository _entities;
    private readonly ICurrentUser _currentUser;

    public GetStudioNavQueryHandler(
        ICustomSystemRepository systems, ICustomEntityRepository entities, ICurrentUser currentUser)
    {
        _systems = systems;
        _entities = entities;
        _currentUser = currentUser;
    }

    public async Task<Result<IReadOnlyList<StudioNavNodeDto>>> Handle(GetStudioNavQuery request, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<IReadOnlyList<StudioNavNodeDto>>(err);

        IReadOnlyList<CustomSystemDefinition> systems;
        IReadOnlyList<CustomEntityDefinition> entities;
        try
        {
            systems = await _systems.ListAsync(tenantId, includeInactive: false, cancellationToken);
            entities = await _entities.ListAsync(tenantId, includeInactive: false, cancellationToken);
        }
        catch (Exception ex) when (IsStudioSchemaMissing(ex))
        {
            return Result.Failure<IReadOnlyList<StudioNavNodeDto>>(
                Error.Validation("Studio.SchemaMissing", "Schéma Studio incomplet. Appliquez les migrations tenant."));
        }

        // PR 2.1: junction tables (many-to-many) are plumbing — never shown as sidebar entries.
        entities = entities.Where(e => e.Kind != Domain.Enums.CustomEntityKind.Junction).ToList();

        var nodes = new List<StudioNavNodeDto>();

        foreach (var s in systems)
        {
            var children = entities
                .Where(e => e.SystemId == s.Id)
                .Select(e => new StudioNavNodeDto(
                    "entity", e.Key, e.DisplayNamePlural, e.Icon, $"/studio/d/{e.Key}", null))
                .ToList();
            if (children.Count == 0) continue;
            nodes.Add(new StudioNavNodeDto(
                "system", s.Key, s.DisplayName, s.Icon, $"/studio/systems/{s.Key}", children));
        }

        foreach (var e in entities.Where(e => e.SystemId is null))
        {
            nodes.Add(new StudioNavNodeDto(
                "entity", e.Key, e.DisplayNamePlural, e.Icon, $"/studio/d/{e.Key}", null));
        }

        return Result.Success<IReadOnlyList<StudioNavNodeDto>>(nodes);
    }

    private static bool IsStudioSchemaMissing(Exception ex)
    {
        for (var current = ex; current is not null; current = current.InnerException)
        {
            var message = current.Message;
            if (message.Contains("CustomSystemDefinitions", StringComparison.OrdinalIgnoreCase)
                || message.Contains("Invalid column name 'SystemId'", StringComparison.OrdinalIgnoreCase)
                || message.Contains("Invalid column name 'Kind'", StringComparison.OrdinalIgnoreCase)) // PR 2.1 (AddStudioEntityKind_Tenant)
                return true;
        }

        return false;
    }
}
