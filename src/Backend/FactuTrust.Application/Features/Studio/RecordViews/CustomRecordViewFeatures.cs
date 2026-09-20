using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Records;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Studio.RecordViews;

/// <summary>
/// Vue enregistrée (PR 2.3) exposée par l'API : définition typée re-parsée depuis
/// <c>DefinitionJson</c> (camelCase) ; <see cref="RowVersion"/> en base64 pour la concurrence
/// optimiste des mises à jour.
/// </summary>
public sealed record CustomRecordViewDto(
    Guid Id,
    string Key,
    string DisplayName,
    CustomRecordViewMode Mode,
    RecordViewDefinition Definition,
    bool IsDefault,
    bool IsActive,
    string RowVersion,
    DateTime UpdatedAt);

/// <summary>Corps d'enregistrement d'une vue. <see cref="RowVersion"/> est exigé par la mise à jour (409 si périmé).</summary>
public sealed record SaveCustomRecordViewRequest(
    string Key,
    string DisplayName,
    CustomRecordViewMode Mode,
    RecordViewDefinition Definition,
    bool IsDefault = false,
    string? RowVersion = null);

/// <summary>
/// Paramètres d'exécution d'une vue : pagination (défaut <c>Definition.PageSize</c>, ≤ 200), recherche,
/// filtres additionnels (≤ 5) et fenêtre calendrier obligatoire en mode Calendar.
/// </summary>
public sealed record RunRecordViewRequest(
    int Page = 1,
    int? PageSize = null,
    string? Search = null,
    IReadOnlyList<RecordViewFilter>? ExtraFilters = null,
    DateOnly? RangeStart = null,
    DateOnly? RangeEnd = null);

/// <summary>
/// Aperçu du concepteur (R3, 4.7v1) : définition NON enregistrée à exécuter telle quelle.
/// Ni <c>Search</c> ni <c>ExtraFilters</c> (le concepteur édite les filtres de la définition) ;
/// mêmes bornes page/pageSize que <see cref="RunRecordViewRequest"/> (D-47-20).
/// </summary>
public sealed record PreviewRecordViewRequest(
    CustomRecordViewMode Mode,
    RecordViewDefinition Definition,
    int Page = 1,
    int? PageSize = null,
    DateOnly? RangeStart = null,
    DateOnly? RangeEnd = null);

/// <summary>
/// Résultat d'exécution : <see cref="Items"/> pour la liste ; <see cref="Groups"/> (kanban) ou
/// <see cref="Events"/> (calendrier) selon le mode ; <see cref="Truncated"/> signale une coupe à la borne.
/// </summary>
public sealed record RecordViewRunResultDto(
    CustomRecordViewMode Mode,
    IReadOnlyList<CustomRecordDto> Items,
    int Total,
    int Page,
    int PageSize,
    IReadOnlyList<RecordViewKanbanGroupDto>? Groups,
    IReadOnlyList<RecordViewCalendarEventDto>? Events,
    bool Truncated);

/// <summary>Un groupe kanban ; <see cref="Value"/> null = groupe « Sans valeur ».</summary>
public sealed record RecordViewKanbanGroupDto(string? Value, string Label, int Count, IReadOnlyList<CustomRecordDto> Items);

/// <summary>Un événement calendrier projeté depuis un enregistrement.</summary>
public sealed record RecordViewCalendarEventDto(Guid RecordId, string Title, DateTime Start, DateTime? End, string? ColorValue);

// ---- List ----

public sealed record ListCustomRecordViewsQuery(string EntityKey) : IRequest<Result<IReadOnlyList<CustomRecordViewDto>>>;

public sealed class ListCustomRecordViewsQueryHandler
    : IRequestHandler<ListCustomRecordViewsQuery, Result<IReadOnlyList<CustomRecordViewDto>>>
{
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomRecordViewRepository _views;
    private readonly ICurrentUser _currentUser;

    public ListCustomRecordViewsQueryHandler(
        ICustomEntityRepository entities, ICustomRecordViewRepository views, ICurrentUser currentUser)
    {
        _entities = entities;
        _views = views;
        _currentUser = currentUser;
    }

    public async Task<Result<IReadOnlyList<CustomRecordViewDto>>> Handle(ListCustomRecordViewsQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<IReadOnlyList<CustomRecordViewDto>>(err);

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(_entities, tenantId, query.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<IReadOnlyList<CustomRecordViewDto>>(resolveError);

        // Toutes les vues (actives ET inactives) : la conception (designer) liste aussi les désactivées.
        var views = await _views.ListByEntityAsync(tenantId, entity.Id, includeInactive: true, cancellationToken);
        // Vue par défaut en tête, puis par libellé.
        var dtos = views
            .OrderByDescending(v => v.IsDefault)
            .ThenBy(v => v.DisplayName, StringComparer.OrdinalIgnoreCase)
            .Select(RecordViewMapper.ToDto)
            .ToList();
        return Result.Success<IReadOnlyList<CustomRecordViewDto>>(dtos);
    }
}

// ---- Get ----

public sealed record GetCustomRecordViewQuery(string EntityKey, Guid Id) : IRequest<Result<CustomRecordViewDto>>;

public sealed class GetCustomRecordViewQueryHandler : IRequestHandler<GetCustomRecordViewQuery, Result<CustomRecordViewDto>>
{
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomRecordViewRepository _views;
    private readonly ICurrentUser _currentUser;

    public GetCustomRecordViewQueryHandler(
        ICustomEntityRepository entities, ICustomRecordViewRepository views, ICurrentUser currentUser)
    {
        _entities = entities;
        _views = views;
        _currentUser = currentUser;
    }

    public async Task<Result<CustomRecordViewDto>> Handle(GetCustomRecordViewQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<CustomRecordViewDto>(err);

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(_entities, tenantId, query.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<CustomRecordViewDto>(resolveError);

        var view = await _views.GetByIdAsync(tenantId, entity.Id, query.Id, cancellationToken);
        if (view is null)
            return Result.Failure<CustomRecordViewDto>(Error.NotFound("CustomRecordView", query.Id));

        return Result.Success(RecordViewMapper.ToDto(view));
    }
}

// ---- Create ----

public sealed record CreateCustomRecordViewCommand(string EntityKey, SaveCustomRecordViewRequest Request)
    : IRequest<Result<CustomRecordViewDto>>;

public sealed class CreateCustomRecordViewCommandHandler : IRequestHandler<CreateCustomRecordViewCommand, Result<CustomRecordViewDto>>
{
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomRecordViewRepository _views;
    private readonly IStudioQuotaService _quota;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public CreateCustomRecordViewCommandHandler(
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        ICustomRecordViewRepository views,
        IStudioQuotaService quota,
        IAuditService audit,
        ICurrentUser currentUser)
    {
        _entities = entities;
        _fields = fields;
        _views = views;
        _quota = quota;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result<CustomRecordViewDto>> Handle(CreateCustomRecordViewCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<CustomRecordViewDto>(err);

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(_entities, tenantId, command.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<CustomRecordViewDto>(resolveError);

        var request = command.Request;

        if (!StudioKey.IsValidShape(request.Key))
            return Result.Failure<CustomRecordViewDto>(
                Error.Validation("key", "La clé doit commencer par une lettre minuscule et ne contenir que des minuscules, chiffres et « _ » (2 à 64 caractères)."));
        if (string.IsNullOrWhiteSpace(request.DisplayName))
            return Result.Failure<CustomRecordViewDto>(Error.Validation("displayName", "Le libellé de la vue est obligatoire."));
        if (request.Definition is null)
            return Result.Failure<CustomRecordViewDto>(Error.Validation("definition", "La définition de la vue est obligatoire."));

        var fields = await _fields.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, cancellationToken);
        var validation = RecordViewDefinitionValidator.Validate(request.Definition, request.Mode, fields);
        if (validation.IsFailure)
            return Result.Failure<CustomRecordViewDto>(validation.Error);

        if (await _views.KeyExistsAsync(tenantId, entity.Id, request.Key, cancellationToken: cancellationToken))
            return Result.Failure<CustomRecordViewDto>(
                Error.Conflict($"Une vue avec la clé « {request.Key} » existe déjà pour cette table."));

        var count = await _views.CountByEntityAsync(tenantId, entity.Id, cancellationToken);
        var quotaError = await _quota.EnsureUnderLimitAsync(
            tenantId, StudioQuotas.MaxRecordViewsKey, count, StudioQuotas.MaxRecordViewsFallback, "vues par table", cancellationToken);
        if (quotaError.IsFailure)
            return Result.Failure<CustomRecordViewDto>(quotaError.Error);

        var isDefault = request.IsDefault;
        if (isDefault)
            await _views.ClearDefaultAsync(tenantId, entity.Id, cancellationToken);
        else if (count == 0)
            isDefault = true; // première vue d'une table : elle devient la vue par défaut.

        var view = CustomRecordViewDefinition.Create(
            tenantId, entity.Id, request.Key, request.DisplayName.Trim(), request.Mode,
            RecordViewDefinitionJson.Serialize(request.Definition), isDefault, userId);
        await _views.AddAsync(view, cancellationToken);

        await StudioAudit.SafeLogAsync(
            _audit, "Studio.RecordView.Created", "CustomRecordViewDefinition", view.Id,
            null,
            new { view.Key, view.DisplayName, Mode = view.Mode.ToString(), IsDefault = isDefault },
            cancellationToken);

        return Result.Success(RecordViewMapper.ToDto(view));
    }
}

// ---- Update ----

public sealed record UpdateCustomRecordViewCommand(string EntityKey, Guid Id, SaveCustomRecordViewRequest Request)
    : IRequest<Result<CustomRecordViewDto>>;

public sealed class UpdateCustomRecordViewCommandHandler : IRequestHandler<UpdateCustomRecordViewCommand, Result<CustomRecordViewDto>>
{
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomRecordViewRepository _views;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public UpdateCustomRecordViewCommandHandler(
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        ICustomRecordViewRepository views,
        IAuditService audit,
        ICurrentUser currentUser)
    {
        _entities = entities;
        _fields = fields;
        _views = views;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result<CustomRecordViewDto>> Handle(UpdateCustomRecordViewCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<CustomRecordViewDto>(err);

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(_entities, tenantId, command.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<CustomRecordViewDto>(resolveError);

        var view = await _views.GetByIdAsync(tenantId, entity.Id, command.Id, cancellationToken);
        if (view is null)
            return Result.Failure<CustomRecordViewDto>(Error.NotFound("CustomRecordView", command.Id));

        var request = command.Request;

        // Concurrence optimiste : RowVersion exigée sur la mise à jour, périmée ⇒ 409.
        if (string.IsNullOrWhiteSpace(request.RowVersion))
            return Result.Failure<CustomRecordViewDto>(Error.Validation("rowVersion", "Le jeton de concurrence (rowVersion) est obligatoire pour mettre à jour une vue."));
        var currentRowVersion = view.RowVersion is { Length: > 0 } ? Convert.ToBase64String(view.RowVersion) : null;
        if (!string.Equals(currentRowVersion, request.RowVersion, StringComparison.Ordinal))
            return Result.Failure<CustomRecordViewDto>(Error.Conflict("La vue a été modifiée entre-temps. Rechargez-la avant de réessayer."));

        if (string.IsNullOrWhiteSpace(request.DisplayName))
            return Result.Failure<CustomRecordViewDto>(Error.Validation("displayName", "Le libellé de la vue est obligatoire."));
        if (request.Definition is null)
            return Result.Failure<CustomRecordViewDto>(Error.Validation("definition", "La définition de la vue est obligatoire."));
        // La clé est immuable : une clé différente de l'existante est refusée (recréer une vue).
        if (!string.Equals(view.Key, request.Key, StringComparison.Ordinal))
            return Result.Failure<CustomRecordViewDto>(Error.Validation("key", "La clé d'une vue est immuable ; créez une nouvelle vue pour changer de clé."));

        var fields = await _fields.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, cancellationToken);
        var validation = RecordViewDefinitionValidator.Validate(request.Definition, request.Mode, fields);
        if (validation.IsFailure)
            return Result.Failure<CustomRecordViewDto>(validation.Error);

        var old = new { view.DisplayName, Mode = view.Mode.ToString(), view.IsActive };
        view.Update(request.DisplayName.Trim(), request.Mode, RecordViewDefinitionJson.Serialize(request.Definition), isActive: true, userId);
        if (request.IsDefault && !view.IsDefault)
        {
            await _views.ClearDefaultAsync(tenantId, entity.Id, cancellationToken);
            view.SetDefault(true, userId);
        }
        await _views.UpdateAsync(view, cancellationToken);

        await StudioAudit.SafeLogAsync(
            _audit, "Studio.RecordView.Updated", "CustomRecordViewDefinition", view.Id,
            old,
            new { view.DisplayName, Mode = view.Mode.ToString(), view.IsActive, view.IsDefault },
            cancellationToken);

        return Result.Success(RecordViewMapper.ToDto(view));
    }
}

// ---- Delete (soft) ----

public sealed record DeleteCustomRecordViewCommand(string EntityKey, Guid Id) : IRequest<Result<bool>>;

public sealed class DeleteCustomRecordViewCommandHandler : IRequestHandler<DeleteCustomRecordViewCommand, Result<bool>>
{
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomRecordViewRepository _views;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public DeleteCustomRecordViewCommandHandler(
        ICustomEntityRepository entities, ICustomRecordViewRepository views, IAuditService audit, ICurrentUser currentUser)
    {
        _entities = entities;
        _views = views;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result<bool>> Handle(DeleteCustomRecordViewCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<bool>(err);

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(_entities, tenantId, command.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<bool>(resolveError);

        var view = await _views.GetByIdAsync(tenantId, entity.Id, command.Id, cancellationToken);
        if (view is null)
            return Result.Failure<bool>(Error.NotFound("CustomRecordView", command.Id));

        view.SoftDelete(userId); // R12 : aucune promotion automatique d'une autre vue.
        await _views.UpdateAsync(view, cancellationToken);

        await StudioAudit.SafeLogAsync(
            _audit, "Studio.RecordView.Deleted", "CustomRecordViewDefinition", view.Id,
            new { view.Key, view.DisplayName, Mode = view.Mode.ToString(), view.IsDefault },
            null,
            cancellationToken);

        return Result.Success(true);
    }
}

// ---- Set default ----

public sealed record SetDefaultCustomRecordViewCommand(string EntityKey, Guid Id) : IRequest<Result<bool>>;

public sealed class SetDefaultCustomRecordViewCommandHandler : IRequestHandler<SetDefaultCustomRecordViewCommand, Result<bool>>
{
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomRecordViewRepository _views;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public SetDefaultCustomRecordViewCommandHandler(
        ICustomEntityRepository entities, ICustomRecordViewRepository views, IAuditService audit, ICurrentUser currentUser)
    {
        _entities = entities;
        _views = views;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result<bool>> Handle(SetDefaultCustomRecordViewCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<bool>(err);

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(_entities, tenantId, command.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<bool>(resolveError);

        var view = await _views.GetByIdAsync(tenantId, entity.Id, command.Id, cancellationToken);
        if (view is null || !view.IsActive)
            return Result.Failure<bool>(Error.NotFound("CustomRecordView", command.Id));

        await _views.ClearDefaultAsync(tenantId, entity.Id, cancellationToken);
        view.SetDefault(true, userId);
        await _views.UpdateAsync(view, cancellationToken);

        await StudioAudit.SafeLogAsync(
            _audit, "Studio.RecordView.DefaultSet", "CustomRecordViewDefinition", view.Id,
            null,
            new { view.Key, view.DisplayName },
            cancellationToken);

        return Result.Success(true);
    }
}

// ---- Run (exécution serveur) ----

public sealed record RunCustomRecordViewQuery(string EntityKey, Guid Id, RunRecordViewRequest Request)
    : IRequest<Result<RecordViewRunResultDto>>;

public sealed class RunCustomRecordViewQueryHandler : IRequestHandler<RunCustomRecordViewQuery, Result<RecordViewRunResultDto>>
{
    private const int MaxExtraFilters = 5;
    private const int MaxSearchableFields = 6;
    private const int MaxPageSize = 200;

    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomRecordViewRepository _views;
    private readonly ICustomRecordRepository _records;
    private readonly ICurrentUser _currentUser;
    private readonly OllamaSettings _settings;

    public RunCustomRecordViewQueryHandler(
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        ICustomRecordViewRepository views,
        ICustomRecordRepository records,
        ICurrentUser currentUser,
        IOptions<OllamaSettings> settings)
    {
        _entities = entities;
        _fields = fields;
        _views = views;
        _records = records;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result<RecordViewRunResultDto>> Handle(RunCustomRecordViewQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<RecordViewRunResultDto>(err);

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(_entities, tenantId, query.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<RecordViewRunResultDto>(resolveError);

        var view = await _views.GetByIdAsync(tenantId, entity.Id, query.Id, cancellationToken);
        if (view is null || !view.IsActive)
            return Result.Failure<RecordViewRunResultDto>(Error.NotFound("CustomRecordView", query.Id));

        var definition = RecordViewDefinitionJson.Parse(view.DefinitionJson);
        if (definition is null)
            return Result.Failure<RecordViewRunResultDto>(Error.Validation("definition", "La définition de la vue est illisible."));

        var fields = await _fields.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, cancellationToken);
        var fieldsByKey = fields.Where(f => f.IsActive).ToDictionary(f => f.Key, StringComparer.Ordinal);

        // Revalidation de la définition contre les champs actifs (ils ont pu changer depuis l'enregistrement).
        var validation = RecordViewDefinitionValidator.Validate(definition, view.Mode, fields);
        if (validation.IsFailure)
            return Result.Failure<RecordViewRunResultDto>(validation.Error);

        var request = query.Request;

        // Borne pageSize (liste) — 400 si > 200 (pas de clamp silencieux : le contrat run est explicite).
        var page = request.Page < 1 ? 1 : request.Page;
        var pageSize = request.PageSize ?? definition.PageSize;
        if (pageSize is < 1 or > MaxPageSize)
            return Result.Failure<RecordViewRunResultDto>(Error.Validation("pageSize", "La taille de page doit être comprise entre 1 et 200."));

        // Filtres additionnels : ≤ 5, validés contre les champs actifs (ceux de la définition
        // viennent d'être revalidés par RecordViewDefinitionValidator.Validate ci-dessus).
        var extraFilters = request.ExtraFilters ?? Array.Empty<RecordViewFilter>();
        if (extraFilters.Count > MaxExtraFilters)
            return Result.Failure<RecordViewRunResultDto>(
                Error.Validation("extraFilters", $"Au plus {MaxExtraFilters} filtres additionnels."));
        var filtersError = RecordViewDefinitionValidator.ValidateFilters(extraFilters, fieldsByKey);
        if (filtersError is not null)
            return Result.Failure<RecordViewRunResultDto>(filtersError);
        var filters = definition.Filters.Concat(extraFilters).ToList();

        // Champs recherchables (texte / multi-texte / select), ≤ 6, validés ; vide ⇒ recherche brute sur DataJson.
        var searchableKeys = definition.SearchEnabled
            ? fields.Where(f => f.FieldType is CustomFieldType.Text or CustomFieldType.MultilineText or CustomFieldType.Select)
                .Select(f => f.Key).Take(MaxSearchableFields).ToList()
            : new List<string>();
        if (!definition.SearchEnabled && !string.IsNullOrWhiteSpace(request.Search))
            return Result.Failure<RecordViewRunResultDto>(Error.Validation("search", "La recherche est désactivée pour cette vue."));

        var search = string.IsNullOrWhiteSpace(request.Search) ? null : request.Search;

        // Types par clé pour les expressions SQL. Les colonnes indexées jx_<clé> ne sont PAS résolues
        // ici : CustomRecordRepository.QueryAsync le fait côté Infrastructure, au plus près du SQL.
        var fieldTypes = fieldsByKey.ToDictionary(kv => kv.Key, kv => kv.Value.FieldType, StringComparer.Ordinal);

        return await RecordViewRunExecutor.ExecuteAsync(
            _records, _settings, tenantId, entity.Id, view.Mode, definition, filters, search, searchableKeys,
            fieldsByKey, fieldTypes, page, pageSize, request.RangeStart, request.RangeEnd, cancellationToken);
    }
}


// ---- Preview (aperçu du concepteur : exécution d'une définition NON enregistrée) ----

/// <summary>
/// Aperçu du concepteur (R3, 4.7v1 — D-47-20) : exécute la définition fournie telle quelle,
/// sans la rechercher en base. Rien n'est persisté, ni quota ni audit — mêmes bornes que le run.
/// </summary>
public sealed record PreviewCustomRecordViewQuery(string EntityKey, PreviewRecordViewRequest Request)
    : IRequest<Result<RecordViewRunResultDto>>;

public sealed class PreviewCustomRecordViewQueryHandler : IRequestHandler<PreviewCustomRecordViewQuery, Result<RecordViewRunResultDto>>
{
    private const int MaxPageSize = 200;

    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomRecordRepository _records;
    private readonly ICurrentUser _currentUser;
    private readonly OllamaSettings _settings;

    // Ni ICustomRecordViewRepository, ni IStudioQuotaService, ni IAuditService (D-47-20) :
    // l'aperçu n'est ni persisté, ni décompté, ni audité — lecture seule bornée, comme le run.
    public PreviewCustomRecordViewQueryHandler(
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        ICustomRecordRepository records,
        ICurrentUser currentUser,
        IOptions<OllamaSettings> settings)
    {
        _entities = entities;
        _fields = fields;
        _records = records;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result<RecordViewRunResultDto>> Handle(PreviewCustomRecordViewQuery query, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<RecordViewRunResultDto>(err);

        var (entity, resolveError) = await RecordEntityResolver.ResolveAsync(_entities, tenantId, query.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<RecordViewRunResultDto>(resolveError);

        var request = query.Request;

        // Pas de clé ni de libellé exigés : rien n'est enregistré, une définition prévisualisable
        // peut être innommable. La validation est celle de l'enregistrement et du run.
        if (request.Definition is null)
            return Result.Failure<RecordViewRunResultDto>(Error.Validation("definition", "La définition de la vue est illisible."));

        var fields = await _fields.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, cancellationToken);
        var fieldsByKey = fields.Where(f => f.IsActive).ToDictionary(f => f.Key, StringComparer.Ordinal);

        var validation = RecordViewDefinitionValidator.Validate(request.Definition, request.Mode, fields);
        if (validation.IsFailure)
            return Result.Failure<RecordViewRunResultDto>(validation.Error);

        // Bornes identiques au run : pageSize explicite 1..200 (400, pas de clamp silencieux).
        var page = request.Page < 1 ? 1 : request.Page;
        var pageSize = request.PageSize ?? request.Definition.PageSize;
        if (pageSize is < 1 or > MaxPageSize)
            return Result.Failure<RecordViewRunResultDto>(Error.Validation("pageSize", "La taille de page doit être comprise entre 1 et 200."));

        // Ni recherche ni filtres additionnels (D-47-20) : le concepteur édite les filtres de la définition.
        var filters = request.Definition.Filters;

        // Types par clé pour les expressions SQL (résolution des colonnes jx_ côté Infrastructure).
        var fieldTypes = fieldsByKey.ToDictionary(kv => kv.Key, kv => kv.Value.FieldType, StringComparer.Ordinal);

        return await RecordViewRunExecutor.ExecuteAsync(
            _records, _settings, tenantId, entity.Id, request.Mode, request.Definition, filters,
            search: null, Array.Empty<string>(), fieldsByKey, fieldTypes, page, pageSize,
            request.RangeStart, request.RangeEnd, cancellationToken);
    }
}

/// <summary>Projection entité → DTO d'une vue enregistrée (re-parse le JSON typé).</summary>
public static class RecordViewMapper
{
    public static CustomRecordViewDto ToDto(CustomRecordViewDefinition view)
    {
        var definition = RecordViewDefinitionJson.Parse(view.DefinitionJson)
            ?? new RecordViewDefinition(
                Array.Empty<RecordViewColumn>(), Array.Empty<RecordViewFilter>(), Array.Empty<RecordViewSort>(),
                null, null);
        var rowVersion = view.RowVersion is { Length: > 0 } ? Convert.ToBase64String(view.RowVersion) : string.Empty;
        return new CustomRecordViewDto(
            view.Id, view.Key, view.DisplayName, view.Mode, definition, view.IsDefault, view.IsActive, rowVersion, view.UpdatedAt);
    }
}
