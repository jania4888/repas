using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Entities;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.Studio.Relations;

/// <summary>Relation kinds exposed by <see cref="EntityRelationDto.Kind"/> (wire contract, snake_case).</summary>
public static class EntityRelationKinds
{
    public const string ManyToOne = "many_to_one";
    public const string OneToMany = "one_to_many";
    public const string ManyToMany = "many_to_many";
}

// ---- Create many-to-many (junction entity + two RelationCustom fields) ----

/// <summary>
/// Crée une relation plusieurs‑à‑plusieurs entre <see cref="SourceEntityId"/> et
/// <c>Request.TargetEntityId</c> : une table de jonction <see cref="CustomEntityKind.Junction"/> portant
/// deux champs <see cref="CustomFieldType.RelationCustom"/> requis (source, cible), plus un champ
/// attribut <see cref="CustomFieldType.Number"/> optionnel quand <c>JunctionAttributeLabel</c> est fourni.
/// Réutilise <see cref="CreateCustomEntityCommand"/> et <see cref="CreateCustomFieldCommand"/> via
/// MediatR (chemin unique IA / manuel : quotas, audit, index JSON).
/// </summary>
public sealed record CreateManyToManyRelationCommand(Guid SourceEntityId, CreateManyToManyRelationRequest Request)
    : IRequest<Result<ManyToManyRelationDto>>;

public sealed class CreateManyToManyRelationCommandHandler
    : IRequestHandler<CreateManyToManyRelationCommand, Result<ManyToManyRelationDto>>
{
    /// <summary>Nom d'action d'audit (plan maître B‑1 / PR 2.1).</summary>
    public const string AuditAction = "Studio.Relation.ManyToManyCreated";

    /// <summary>Icône PrimeIcons de la jonction (masquée dans la nav, visible dans les designers).</summary>
    public const string JunctionIcon = "link";

    /// <summary>Nombre maximal de suffixes essayés quand la clé par défaut <c>{a}_{b}</c> est déjà prise.</summary>
    private const int MaxDefaultKeySuffix = 9;

    private readonly ICustomEntityRepository _entities;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;
    private readonly IMediator _mediator;
    private readonly IJsonIndexManager _jsonIndex;

    public CreateManyToManyRelationCommandHandler(
        ICustomEntityRepository entities,
        IAuditService audit,
        ICurrentUser currentUser,
        IMediator mediator,
        IJsonIndexManager jsonIndex)
    {
        _entities = entities;
        _audit = audit;
        _currentUser = currentUser;
        _mediator = mediator;
        _jsonIndex = jsonIndex;
    }

    public async Task<Result<ManyToManyRelationDto>> Handle(CreateManyToManyRelationCommand command, CancellationToken cancellationToken)
    {
        // (1) Tenant context.
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<ManyToManyRelationDto>(err);

        var req = command.Request;

        // (2) Source and target: both active, both Standard, distinct. TenantId is enforced by the
        // repository (an entity of another tenant is simply not found).
        var source = await _entities.GetByIdAsync(tenantId, command.SourceEntityId, cancellationToken);
        if (source is null)
            return Result.Failure<ManyToManyRelationDto>(Error.NotFound("CustomEntity", command.SourceEntityId));
        if (!source.IsActive || source.Kind != CustomEntityKind.Standard)
            return Result.Failure<ManyToManyRelationDto>(Error.Validation("source",
                "La table source doit être une table standard active."));

        if (req.TargetEntityId == command.SourceEntityId)
            return Result.Failure<ManyToManyRelationDto>(Error.Validation("target",
                "La table cible doit être différente de la table source."));

        var target = await _entities.GetByIdAsync(tenantId, req.TargetEntityId, cancellationToken);
        if (target is null)
            return Result.Failure<ManyToManyRelationDto>(Error.Validation("target",
                $"Table cible « {req.TargetEntityId} » introuvable."));
        if (!target.IsActive || target.Kind != CustomEntityKind.Standard)
            return Result.Failure<ManyToManyRelationDto>(Error.Validation("target",
                "La table cible doit être une table standard active (une table de jonction ne peut pas être reliée)."));

        // (3) Junction key: explicit key → exact (409 if taken); default `{a}_{b}` → `_2`..`_9` fallback.
        var junctionKeyResult = await ResolveJunctionKeyAsync(tenantId, source, target, req.JunctionKey, cancellationToken);
        if (junctionKeyResult.IsFailure)
            return Result.Failure<ManyToManyRelationDto>(junctionKeyResult.Error);
        var junctionKey = junctionKeyResult.Value;

        // (3bis) Junction attribute (v1.1 / D-47-40, R4): optional 3rd Number field. The key is derived
        // from the label and validated BEFORE any write — a validation failure creates nothing at all.
        var (sourceFieldKey, targetFieldKey) = ResolveFieldKeys(source.Key, target.Key);
        string? attributeKey = null;
        string? attributeLabel = null;
        if (!string.IsNullOrWhiteSpace(req.JunctionAttributeLabel))
        {
            attributeLabel = req.JunctionAttributeLabel.Trim();
            attributeKey = StudioKey.Slugify(attributeLabel);
            if (attributeKey.Length == 0
                || !StudioKey.IsValidShape(attributeKey)
                || StudioKey.IsReservedFieldKey(attributeKey)
                || string.Equals(attributeKey, sourceFieldKey, StringComparison.OrdinalIgnoreCase)
                || string.Equals(attributeKey, targetFieldKey, StringComparison.OrdinalIgnoreCase))
                return Result.Failure<ManyToManyRelationDto>(Error.Validation("junctionAttributeLabel",
                    "Le libellé de l'attribut de liaison ne produit pas une clé de champ valide (ou entre en collision avec un champ de liaison)."));
        }

        // (4) Junction entity (Kind = Junction), inheriting the source's system. CreateCustomEntityCommand
        // applies the custom-entity quota (a junction IS a table) before any write.
        var displayName = string.IsNullOrWhiteSpace(req.JunctionDisplayName)
            ? $"{source.DisplayName} – {target.DisplayName}"
            : req.JunctionDisplayName.Trim();
        var label = string.IsNullOrWhiteSpace(req.Label) ? null : req.Label.Trim();

        var entityResult = await _mediator.Send(new CreateCustomEntityCommand(new CreateCustomEntityRequest(
            junctionKey,
            displayName,
            displayName,
            JunctionIcon,
            label is null
                ? $"Table de jonction {source.Key} ↔ {target.Key} (relation plusieurs-à-plusieurs)."
                : $"{label} — table de jonction {source.Key} ↔ {target.Key}.",
            source.SystemId,
            CustomEntityKind.Junction),
            AllowJunction: true), cancellationToken);
        if (entityResult.IsFailure)
            return Result.Failure<ManyToManyRelationDto>(entityResult.Error);

        var junction = entityResult.Value;

        // (5) Two required RelationCustom fields, strictly sequential; compensate on failure (7) —
        // on a failed Result AND on an exception (timeout SQL, DbUpdateException, cancellation):
        // otherwise the junction would stay active with 0 or 1 field (hidden from the nav, unprotected
        // by the pair check). Field keys resolved at (3bis).
        Result<CustomFieldDto> sourceFieldResult;
        Result<CustomFieldDto> targetFieldResult;
        Result<CustomFieldDto>? attributeFieldResult = null;
        try
        {
            sourceFieldResult = await _mediator.Send(new CreateCustomFieldCommand(junction.Id, new CreateCustomFieldRequest(
                sourceFieldKey, source.DisplayName, CustomFieldType.RelationCustom,
                IsRequired: true, IsUnique: false, Rules: null, Options: null,
                Relation: new RelationRefDto("custom", source.Key))), cancellationToken);
            if (sourceFieldResult.IsFailure)
                return await CompensateAsync(junction.Id, sourceFieldResult.Error, cancellationToken);

            targetFieldResult = await _mediator.Send(new CreateCustomFieldCommand(junction.Id, new CreateCustomFieldRequest(
                targetFieldKey, target.DisplayName, CustomFieldType.RelationCustom,
                IsRequired: true, IsUnique: false, Rules: null, Options: null,
                Relation: new RelationRefDto("custom", target.Key))), cancellationToken);
            if (targetFieldResult.IsFailure)
                return await CompensateAsync(junction.Id, targetFieldResult.Error, cancellationToken);

            // Junction attribute: created AFTER the two link fields (SortOrder = max + 1, so the pair
            // check is never displaced); inside the same try ⇒ covered by the same compensation.
            if (attributeKey is not null)
            {
                attributeFieldResult = await _mediator.Send(new CreateCustomFieldCommand(junction.Id, new CreateCustomFieldRequest(
                    attributeKey, attributeLabel!, CustomFieldType.Number,
                    IsRequired: false, IsUnique: false, Rules: null, Options: null,
                    Relation: null)), cancellationToken);
                if (attributeFieldResult.IsFailure)
                    return await CompensateAsync(junction.Id, attributeFieldResult.Error, cancellationToken);
            }
        }
        catch
        {
            // Compensate with CancellationToken.None so an aborted request still cleans up, then rethrow.
            await CompensateSafelyAsync(junction.Id);
            throw;
        }

        // R10: non-unique jx_ indexes so the « Liés » filter and the pair check seek instead of scan (best-effort).
        await _jsonIndex.EnsureFieldIndexAsync(tenantId, sourceFieldKey, cancellationToken);
        await _jsonIndex.EnsureFieldIndexAsync(tenantId, targetFieldKey, cancellationToken);

        // (6) Audit.
        await StudioAudit.SafeLogAsync(_audit, AuditAction, "CustomEntity", junction.Id,
            null, new { sourceKey = source.Key, targetKey = target.Key, junctionKey, junctionAttributeKey = attributeKey }, cancellationToken);

        var junctionDto = junction with { FieldCount = attributeFieldResult is null ? 2 : 3 };
        return Result.Success(new ManyToManyRelationDto(
            junctionDto, sourceFieldResult.Value, targetFieldResult.Value, attributeFieldResult?.Value));
    }

    /// <summary>
    /// Clé de jonction : explicite (validée, 409 si prise) ou par défaut <c>{source}_{target}</c> tronquée à
    /// <see cref="StudioKey.MaxLength"/> avec repli <c>_2</c>..<c>_9</c> en cas de collision (parade du plan).
    /// </summary>
    private async Task<Result<string>> ResolveJunctionKeyAsync(
        Guid tenantId, CustomEntityDefinition source, CustomEntityDefinition target, string? explicitKey, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(explicitKey))
        {
            var key = explicitKey.Trim().ToLowerInvariant();
            if (!StudioKey.IsValidShape(key))
                return Result.Failure<string>(Error.Validation("junctionKey",
                    "La clé doit commencer par une lettre et ne contenir que minuscules, chiffres et « _ » (2 à 64 caractères)."));
            // includeDeleted: the unique index IX_CustomEntityDefinitions_TenantId_Key is NOT filtered on
            // IsDeleted — a soft-deleted key can never be re-inserted (designer deleted a junction, or a
            // compensated retry), so it must count as taken.
            if (await _entities.KeyExistsAsync(tenantId, key, includeDeleted: true, ct))
                return Result.Failure<string>(Error.Conflict($"Une table avec la clé « {key} » existe déjà."));
            return Result.Success(key);
        }

        var baseKey = Truncate($"{source.Key}_{target.Key}", StudioKey.MaxLength);
        if (!StudioKey.IsValidShape(baseKey))
            return Result.Failure<string>(Error.Validation("junctionKey", "Impossible de dériver une clé de jonction valide ; fournissez junctionKey."));

        if (!await _entities.KeyExistsAsync(tenantId, baseKey, includeDeleted: true, ct))
            return Result.Success(baseKey);

        for (var i = 2; i <= MaxDefaultKeySuffix; i++)
        {
            var suffix = "_" + i;
            var candidate = Truncate(baseKey, StudioKey.MaxLength - suffix.Length) + suffix;
            if (!await _entities.KeyExistsAsync(tenantId, candidate, includeDeleted: true, ct))
                return Result.Success(candidate);
        }

        return Result.Failure<string>(Error.Conflict($"Une table avec la clé « {baseKey} » existe déjà ; fournissez junctionKey."));
    }

    /// <summary>
    /// Clés des deux champs de liaison : <c>{source.Key}</c> / <c>{target.Key}</c>, suffixées <c>_a</c>/<c>_b</c>
    /// si identiques, et <c>_ref</c> si la clé d'entité est un nom de champ réservé (<c>id</c>, …).
    /// </summary>
    internal static (string SourceFieldKey, string TargetFieldKey) ResolveFieldKeys(string sourceKey, string targetKey)
    {
        if (string.Equals(sourceKey, targetKey, StringComparison.Ordinal))
            return (Truncate(sourceKey, StudioKey.MaxLength - 2) + "_a", Truncate(targetKey, StudioKey.MaxLength - 2) + "_b");

        return (SafeFieldKey(sourceKey), SafeFieldKey(targetKey));
    }

    private static string SafeFieldKey(string entityKey) =>
        StudioKey.IsReservedFieldKey(entityKey) ? Truncate(entityKey, StudioKey.MaxLength - 4) + "_ref" : entityKey;

    private static string Truncate(string value, int max) => value.Length > max ? value[..max].TrimEnd('_') : value;

    /// <summary>(7) Échec après la création de la jonction ⇒ soft delete compensatoire, puis l'erreur d'origine.</summary>
    private async Task<Result<ManyToManyRelationDto>> CompensateAsync(Guid junctionId, Error error, CancellationToken ct)
    {
        try
        {
            await _mediator.Send(new DeleteCustomEntityCommand(junctionId), ct);
        }
        catch
        {
            // Best-effort compensation: the original error is what the caller needs to see.
        }
        return Result.Failure<ManyToManyRelationDto>(error);
    }

    /// <summary>Compensation après une exception : jamais annulée, jamais masquante pour l'exception d'origine.</summary>
    private async Task CompensateSafelyAsync(Guid junctionId)
    {
        try
        {
            await _mediator.Send(new DeleteCustomEntityCommand(junctionId), CancellationToken.None);
        }
        catch
        {
            // Best-effort compensation: the original exception is what the caller needs to see.
        }
    }
}

// ---- List relations of an entity ----

/// <summary>
/// Toutes les relations dans lesquelles <see cref="EntityId"/> intervient (entités et champs actifs
/// uniquement) : <c>many_to_one</c> (champ porté par l'entité), <c>one_to_many</c> (champ d'une autre table
/// standard vers elle), <c>many_to_many</c> (jonction). Lectures strictement séquentielles.
/// </summary>
public sealed record ListEntityRelationsQuery(Guid EntityId) : IRequest<Result<IReadOnlyList<EntityRelationDto>>>;

public sealed class ListEntityRelationsQueryHandler
    : IRequestHandler<ListEntityRelationsQuery, Result<IReadOnlyList<EntityRelationDto>>>
{
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICurrentUser _currentUser;

    public ListEntityRelationsQueryHandler(ICustomEntityRepository entities, ICustomFieldRepository fields, ICurrentUser currentUser)
    {
        _entities = entities;
        _fields = fields;
        _currentUser = currentUser;
    }

    public async Task<Result<IReadOnlyList<EntityRelationDto>>> Handle(ListEntityRelationsQuery request, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<IReadOnlyList<EntityRelationDto>>(err);

        var entity = await _entities.GetByIdAsync(tenantId, request.EntityId, cancellationToken);
        if (entity is null)
            return Result.Failure<IReadOnlyList<EntityRelationDto>>(Error.NotFound("CustomEntity", request.EntityId));

        var relations = await EntityRelationResolver.ResolveAsync(_entities, _fields, tenantId, entity, cancellationToken);
        return Result.Success(relations);
    }
}

/// <summary>
/// Projection partagée entre <see cref="ListEntityRelationsQuery"/> et <c>CustomEntitySchemaDto.Relations</c>
/// (R2) : une seule définition de ce qu'est « une relation » vue depuis une entité.
/// </summary>
public static class EntityRelationResolver
{
    public static async Task<IReadOnlyList<EntityRelationDto>> ResolveAsync(
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        Guid tenantId,
        CustomEntityDefinition entity,
        CancellationToken cancellationToken)
    {
        var all = await entities.ListAsync(tenantId, includeInactive: false, cancellationToken);
        var byKey = all.ToDictionary(e => e.Key, StringComparer.Ordinal);
        if (!byKey.ContainsKey(entity.Key))
            byKey[entity.Key] = entity;

        var result = new List<EntityRelationDto>();

        // One read for every RelationCustom field of the tenant (N+1 avoided: the schema endpoint is
        // called at each runtime form/table open, and there are up to MaxEntities entities). The
        // repository returns them ordered by (entity, SortOrder, key); active only.
        var relationFields = await fields.ListByTypeAsync(tenantId, CustomFieldType.RelationCustom, includeInactive: false, cancellationToken);
        var fieldsByOwner = relationFields.GroupBy(f => f.EntityDefinitionId);

        foreach (var owner in all)
        {
            var links = fieldsByOwner
                .Where(g => g.Key == owner.Id)
                .SelectMany(g => g)
                .Where(f => f.IsActive)
                .Select(f => (Field: f, Target: ResolveTarget(f, byKey)))
                .Where(x => x.Target is not null)
                .Select(x => (x.Field, Target: x.Target!))
                .ToList();

            if (owner.Kind == CustomEntityKind.Junction)
            {
                // One many_to_many entry per (field towards the requested entity, other field) pair.
                foreach (var mine in links.Where(l => l.Target.Id == entity.Id))
                {
                    foreach (var other in links.Where(l => !ReferenceEquals(l.Field, mine.Field)))
                    {
                        result.Add(new EntityRelationDto(
                            EntityRelationKinds.ManyToMany,
                            entity.Id, entity.Key, entity.DisplayName,
                            other.Target.Id, other.Target.Key, other.Target.DisplayName,
                            mine.Field.Id, mine.Field.Key, mine.Field.IsRequired, mine.Field.IsUnique,
                            owner.Id, owner.Key, other.Field.Id, other.Field.Key));
                    }
                }
                continue;
            }

            foreach (var (field, target) in links)
            {
                if (owner.Id == entity.Id)
                {
                    result.Add(new EntityRelationDto(
                        EntityRelationKinds.ManyToOne,
                        entity.Id, entity.Key, entity.DisplayName,
                        target.Id, target.Key, target.DisplayName,
                        field.Id, field.Key, field.IsRequired, field.IsUnique,
                        null, null, null));
                }
                else if (target.Id == entity.Id)
                {
                    result.Add(new EntityRelationDto(
                        EntityRelationKinds.OneToMany,
                        entity.Id, entity.Key, entity.DisplayName,
                        owner.Id, owner.Key, owner.DisplayName,
                        field.Id, field.Key, field.IsRequired, field.IsUnique,
                        null, null, null));
                }
            }
        }

        return result;
    }

    private static CustomEntityDefinition? ResolveTarget(CustomFieldDefinition field, IReadOnlyDictionary<string, CustomEntityDefinition> byKey)
    {
        var rel = StudioFieldJson.ParseRelation(field.OptionsJson);
        if (rel is null || !string.Equals(rel.Kind, "custom", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(rel.Ref))
            return null;
        return byKey.GetValueOrDefault(rel.Ref);
    }
}
