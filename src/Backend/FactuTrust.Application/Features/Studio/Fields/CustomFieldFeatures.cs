using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Studio.Fields;

// ---- List fields of an entity ----

public sealed record ListCustomFieldsQuery(Guid EntityId, bool IncludeInactive = false)
    : IRequest<Result<IReadOnlyList<CustomFieldDto>>>;

public sealed class ListCustomFieldsQueryHandler
    : IRequestHandler<ListCustomFieldsQuery, Result<IReadOnlyList<CustomFieldDto>>>
{
    private readonly ICustomFieldRepository _fields;
    private readonly ICurrentUser _currentUser;

    public ListCustomFieldsQueryHandler(ICustomFieldRepository fields, ICurrentUser currentUser)
    {
        _fields = fields;
        _currentUser = currentUser;
    }

    public async Task<Result<IReadOnlyList<CustomFieldDto>>> Handle(ListCustomFieldsQuery request, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<IReadOnlyList<CustomFieldDto>>(err);

        var list = await _fields.ListByEntityAsync(tenantId, request.EntityId, request.IncludeInactive, cancellationToken);
        return Result.Success<IReadOnlyList<CustomFieldDto>>(list.Select(StudioMappers.ToDto).ToList());
    }
}

// ---- Schema (entity + active fields) for the runtime renderer, resolved by entity KEY ----

public sealed record GetCustomEntitySchemaQuery(string EntityKey) : IRequest<Result<CustomEntitySchemaDto>>;

public sealed class GetCustomEntitySchemaQueryHandler
    : IRequestHandler<GetCustomEntitySchemaQuery, Result<CustomEntitySchemaDto>>
{
    private const int MaxRelationOptions = 500;

    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomFormRepository _forms;
    private readonly ICustomRecordRepository _records;
    private readonly ICustomRecordViewRepository _recordViews;
    private readonly IExistingDataSourceProvider _existing;
    private readonly ICurrentUser _currentUser;
    private readonly OllamaSettings _settings;

    public GetCustomEntitySchemaQueryHandler(
        ICustomEntityRepository entities, ICustomFieldRepository fields, ICustomFormRepository forms,
        ICustomRecordRepository records, ICustomRecordViewRepository recordViews,
        IExistingDataSourceProvider existing, ICurrentUser currentUser,
        IOptions<OllamaSettings> settings)
    {
        _entities = entities;
        _fields = fields;
        _forms = forms;
        _records = records;
        _recordViews = recordViews;
        _existing = existing;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    public async Task<Result<CustomEntitySchemaDto>> Handle(GetCustomEntitySchemaQuery request, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<CustomEntitySchemaDto>(err);

        var entity = await _entities.GetByKeyAsync(tenantId, request.EntityKey, cancellationToken);
        if (entity is null)
            return Result.Failure<CustomEntitySchemaDto>(Error.Validation("entityKey", $"Table « {request.EntityKey} » introuvable."));

        var fields = await _fields.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, cancellationToken);
        var form = await _forms.GetDefaultByEntityAsync(tenantId, entity.Id, cancellationToken);
        var layout = form is null
            ? FormLayoutJson.BuildDefault(fields)
            : FormLayoutJson.SanitizeAgainstFields(FormLayoutJson.Parse(form.LayoutJson), fields);

        var fieldDtos = new List<CustomFieldDto>(fields.Count);
        foreach (var f in fields)
        {
            var dto = StudioMappers.ToDto(f);
            if (f.FieldType is CustomFieldType.RelationCustom or CustomFieldType.RelationExisting)
            {
                var options = await ResolveRelationOptionsAsync(tenantId, f, cancellationToken);
                dto = dto with { Options = options };
            }
            fieldDtos.Add(dto);
        }

        // R2 (PR 2.1): relations exposed on the runtime schema so the record page (« Liés » tab) can
        // discover many-to-many links without studio:design_entities. Empty when the flag is off.
        IReadOnlyList<EntityRelationDto> relations = _settings.EnableStudioManyToMany
            ? await Relations.EntityRelationResolver.ResolveAsync(_entities, _fields, tenantId, entity, cancellationToken)
            : Array.Empty<EntityRelationDto>();

        // PR 2.3 (vues enregistrées) : vues actives exposées sur le schéma runtime, par défaut d'abord ;
        // vide tant que le drapeau Ollama:EnableStudioRecordViews est coupé.
        IReadOnlyList<RecordViews.CustomRecordViewDto> views = _settings.EnableStudioRecordViews
            ? (await _recordViews.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, cancellationToken))
                .OrderByDescending(v => v.IsDefault)
                .ThenBy(v => v.DisplayName, StringComparer.OrdinalIgnoreCase)
                .Select(RecordViews.RecordViewMapper.ToDto)
                .ToList()
            : Array.Empty<RecordViews.CustomRecordViewDto>();

        var dtoResult = new CustomEntitySchemaDto(StudioMappers.ToDto(entity, fields.Count), fieldDtos, layout, relations, views);
        return Result.Success(dtoResult);
    }

    /// <summary>Resolves a relation field into selectable id+label options (capped).</summary>
    private async Task<IReadOnlyList<SelectOptionDto>?> ResolveRelationOptionsAsync(
        Guid tenantId, Domain.Entities.Studio.CustomFieldDefinition field, CancellationToken ct)
    {
        var rel = StudioFieldJson.ParseRelation(field.OptionsJson);
        if (rel is null) return null;

        if (field.FieldType == CustomFieldType.RelationExisting)
            return await _existing.GetRelationOptionsAsync(tenantId, rel.Ref, MaxRelationOptions, ct);

        // RelationCustom: list records of the target custom entity, labeled by its first text field.
        var target = await _entities.GetByKeyAsync(tenantId, rel.Ref, ct);
        if (target is null) return null;

        var targetFields = await _fields.ListByEntityAsync(tenantId, target.Id, includeInactive: false, ct);
        var displayKey = targetFields
            .FirstOrDefault(x => x.FieldType is CustomFieldType.Text or CustomFieldType.MultilineText)?.Key;

        var records = await _records.GetAllForReportAsync(tenantId, target.Id, MaxRelationOptions, ct);
        return records
            .Select(r => new SelectOptionDto(r.Id.ToString(), ExtractDisplay(r.DataJson, displayKey) ?? r.Id.ToString()))
            .ToList();
    }

    private static string? ExtractDisplay(string dataJson, string? key)
    {
        if (string.IsNullOrEmpty(key)) return null;
        try
        {
            var node = System.Text.Json.Nodes.JsonNode.Parse(dataJson);
            var val = node?[key];
            return val is null ? null : val.ToString();
        }
        catch (System.Text.Json.JsonException) { return null; }
    }
}

// ---- Create field ----

public sealed record CreateCustomFieldCommand(Guid EntityId, CreateCustomFieldRequest Request) : IRequest<Result<CustomFieldDto>>;

public sealed class CreateCustomFieldCommandHandler
    : IRequestHandler<CreateCustomFieldCommand, Result<CustomFieldDto>>
{
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly IStudioQuotaService _quota;
    private readonly IAuditService _audit;
    private readonly IJsonIndexManager _jsonIndex;
    private readonly ICurrentUser _currentUser;

    public CreateCustomFieldCommandHandler(ICustomEntityRepository entities, ICustomFieldRepository fields, IStudioQuotaService quota, IAuditService audit, IJsonIndexManager jsonIndex, ICurrentUser currentUser)
    {
        _entities = entities;
        _fields = fields;
        _quota = quota;
        _audit = audit;
        _jsonIndex = jsonIndex;
        _currentUser = currentUser;
    }

    public async Task<Result<CustomFieldDto>> Handle(CreateCustomFieldCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<CustomFieldDto>(err);

        var entity = await _entities.GetByIdAsync(tenantId, command.EntityId, cancellationToken);
        if (entity is null)
            return Result.Failure<CustomFieldDto>(Error.NotFound("CustomEntity", command.EntityId));

        var req = command.Request;
        var key = req.Key?.Trim().ToLowerInvariant() ?? string.Empty;

        var validation = ValidateFieldKeyAndShape(key, req.Label);
        if (validation is not null)
            return Result.Failure<CustomFieldDto>(validation);

        if (await _fields.KeyExistsAsync(tenantId, command.EntityId, key, cancellationToken))
            return Result.Failure<CustomFieldDto>(Error.Conflict($"Un champ avec la clé « {key} » existe déjà dans cette table."));

        var fieldCount = await _fields.CountByEntityAsync(tenantId, command.EntityId, cancellationToken);
        var quota = await _quota.EnsureUnderLimitAsync(tenantId, StudioQuotas.MaxFieldsKey, fieldCount, StudioQuotas.MaxFieldsFallback, "champs par table", cancellationToken);
        if (quota.IsFailure)
            return Result.Failure<CustomFieldDto>(quota.Error);

        var optionsJson = BuildOptionsJson(req.FieldType, req.Options, req.Relation, req.Config, out var optionError);
        if (optionError is not null)
            return Result.Failure<CustomFieldDto>(optionError);

        if (req.FieldType == CustomFieldType.Formula)
        {
            var siblings = await _fields.ListByEntityAsync(tenantId, command.EntityId, includeInactive: true, cancellationToken);
            var formulaError = StudioFormula.Validate(key, StudioFormula.GetExpression(optionsJson), siblings);
            if (formulaError is not null)
                return Result.Failure<CustomFieldDto>(formulaError);
        }
        else if (req.FieldType == CustomFieldType.Lookup)
        {
            var siblings = await _fields.ListByEntityAsync(tenantId, command.EntityId, includeInactive: true, cancellationToken);
            var lookup = StudioLookupRollup.ParseLookup(optionsJson);
            var lookupError = StudioLookupRollup.ValidateLookup(lookup?.Via, lookup?.Target, siblings);
            if (lookupError is not null)
                return Result.Failure<CustomFieldDto>(lookupError);
        }

        var nextSort = await _fields.MaxSortOrderAsync(tenantId, command.EntityId, cancellationToken) + 1;

        var field = CustomFieldDefinition.Create(
            tenantId, command.EntityId, key, req.Label.Trim(), req.FieldType,
            req.IsRequired, req.IsUnique, nextSort,
            StudioFieldJson.SerializeRules(req.Rules), optionsJson, defaultValueJson: null, userId);

        await _fields.AddAsync(field, cancellationToken);
        await StudioAudit.SafeLogAsync(_audit, "Studio.Field.Created", "CustomField", field.Id,
            null, new { EntityId = command.EntityId, field.Key, field.Label, FieldType = field.FieldType.ToString() }, cancellationToken);
        if (field.IsUnique)
            await _jsonIndex.EnsureUniqueFieldIndexAsync(tenantId, field.Key, cancellationToken);
        return Result.Success(StudioMappers.ToDto(field));
    }

    internal static Error? ValidateFieldKeyAndShape(string key, string? label)
    {
        if (!StudioKey.IsValidShape(key))
            return Error.Validation("key",
                "La clé doit commencer par une lettre et ne contenir que minuscules, chiffres et « _ » (2 à 64 caractères).");
        if (StudioKey.IsReservedFieldKey(key))
            return Error.Validation("key", $"« {key} » est un nom réservé.");
        if (string.IsNullOrWhiteSpace(label))
            return Error.Validation("label", "Le libellé est obligatoire.");
        return null;
    }

    internal static string? BuildOptionsJson(
        CustomFieldType type,
        IReadOnlyList<SelectOptionDto>? options,
        RelationRefDto? relation,
        IReadOnlyDictionary<string, System.Text.Json.Nodes.JsonNode?>? config,
        out Error? error)
    {
        error = null;
        switch (type)
        {
            case CustomFieldType.Select:
            case CustomFieldType.MultiSelect:
                if (options is null || options.Count == 0)
                {
                    error = Error.Validation("options", "Au moins une option est requise pour un champ de type liste.");
                    return null;
                }
                return StudioFieldJson.SerializeOptions(options);

            case CustomFieldType.RelationCustom:
            case CustomFieldType.RelationExisting:
                if (relation is null || string.IsNullOrWhiteSpace(relation.Ref))
                {
                    error = Error.Validation("relation", "La cible de la relation est requise.");
                    return null;
                }
                return StudioFieldJson.SerializeRelation(relation);

            case CustomFieldType.Money:
            {
                var currency = (ConfigString(config, "currency") ?? "TND").Trim().ToUpperInvariant();
                if (currency.Length is < 1 or > 8) currency = "TND";
                return new System.Text.Json.Nodes.JsonObject
                {
                    ["money"] = new System.Text.Json.Nodes.JsonObject { ["currency"] = currency }
                }.ToJsonString();
            }

            case CustomFieldType.Rating:
            {
                var max = ConfigInt(config, "max") ?? 5;
                max = Math.Clamp(max, 1, 10);
                return new System.Text.Json.Nodes.JsonObject
                {
                    ["rating"] = new System.Text.Json.Nodes.JsonObject { ["max"] = max }
                }.ToJsonString();
            }

            case CustomFieldType.QrCode:
            case CustomFieldType.Barcode:
            {
                var defaultFormat = type == CustomFieldType.QrCode ? "qr" : "code128";
                var format = (ConfigString(config, "format") ?? defaultFormat).Trim().ToLowerInvariant();
                if (format is not ("qr" or "code128" or "ean13")) format = defaultFormat;
                var render = new System.Text.Json.Nodes.JsonObject { ["format"] = format };
                var source = ConfigString(config, "source");
                if (!string.IsNullOrWhiteSpace(source)) render["source"] = source.Trim().ToLowerInvariant();
                return new System.Text.Json.Nodes.JsonObject { ["render"] = render }.ToJsonString();
            }

            case CustomFieldType.AutoNumber:
            {
                var prefix = (ConfigString(config, "prefix") ?? string.Empty).Trim();
                if (prefix.Length > StudioAutoNumber.MaxAffixLength) prefix = prefix[..StudioAutoNumber.MaxAffixLength];
                var suffix = (ConfigString(config, "suffix") ?? string.Empty).Trim();
                if (suffix.Length > StudioAutoNumber.MaxAffixLength) suffix = suffix[..StudioAutoNumber.MaxAffixLength];
                var padding = Math.Clamp(ConfigInt(config, "padding") ?? 4, 0, StudioAutoNumber.MaxPadding);
                return new System.Text.Json.Nodes.JsonObject
                {
                    ["number"] = new System.Text.Json.Nodes.JsonObject
                    {
                        ["prefix"] = prefix,
                        ["padding"] = padding,
                        ["suffix"] = suffix
                    }
                }.ToJsonString();
            }

            case CustomFieldType.Formula:
            {
                var expr = ConfigString(config, "expr")?.Trim();
                if (string.IsNullOrWhiteSpace(expr))
                {
                    error = Error.Validation("formula", "L'expression de la formule est obligatoire.");
                    return null;
                }
                return StudioFormula.Serialize(expr);
            }

            case CustomFieldType.Lookup:
            {
                var via = ConfigString(config, "via");
                var target = ConfigString(config, "target");
                if (string.IsNullOrWhiteSpace(via) || string.IsNullOrWhiteSpace(target))
                {
                    error = Error.Validation("lookup", "Le champ relation et le champ cible sont obligatoires.");
                    return null;
                }
                return StudioLookupRollup.SerializeLookup(via, target);
            }

            case CustomFieldType.Rollup:
            {
                var entity = ConfigString(config, "entity");
                var relationField = ConfigString(config, "relationField");
                var agg = ConfigString(config, "agg");
                var rollupField = ConfigString(config, "field");
                if (string.IsNullOrWhiteSpace(entity) || string.IsNullOrWhiteSpace(relationField) || string.IsNullOrWhiteSpace(agg))
                {
                    error = Error.Validation("rollup", "Entité enfant, champ relation et agrégat sont obligatoires.");
                    return null;
                }
                var rollupValidation = StudioLookupRollup.ValidateRollup(new RollupConfig(entity, relationField, agg, rollupField));
                if (rollupValidation is not null) { error = rollupValidation; return null; }
                return StudioLookupRollup.SerializeRollup(entity, relationField, agg, rollupField);
            }

            default:
                return null;
        }
    }

    private static string? ConfigString(IReadOnlyDictionary<string, System.Text.Json.Nodes.JsonNode?>? config, string key)
    {
        if (config is null || !config.TryGetValue(key, out var node) || node is null) return null;
        if (node is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<string>(out var s)) return s;
        return node.ToString();
    }

    private static int? ConfigInt(IReadOnlyDictionary<string, System.Text.Json.Nodes.JsonNode?>? config, string key)
    {
        if (config is null || !config.TryGetValue(key, out var node) || node is null) return null;
        if (node is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<int>(out var i)) return i;
        return int.TryParse(ConfigString(config, key), out var p) ? p : null;
    }
}

// ---- Update field ----

public sealed record UpdateCustomFieldCommand(Guid Id, UpdateCustomFieldRequest Request) : IRequest<Result<CustomFieldDto>>;

public sealed class UpdateCustomFieldCommandHandler
    : IRequestHandler<UpdateCustomFieldCommand, Result<CustomFieldDto>>
{
    private readonly ICustomFieldRepository _fields;
    private readonly IJsonIndexManager _jsonIndex;
    private readonly ICurrentUser _currentUser;

    public UpdateCustomFieldCommandHandler(ICustomFieldRepository fields, IJsonIndexManager jsonIndex, ICurrentUser currentUser)
    {
        _fields = fields;
        _jsonIndex = jsonIndex;
        _currentUser = currentUser;
    }

    public async Task<Result<CustomFieldDto>> Handle(UpdateCustomFieldCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<CustomFieldDto>(err);

        var field = await _fields.GetByIdAsync(tenantId, command.Id, cancellationToken);
        if (field is null)
            return Result.Failure<CustomFieldDto>(Error.NotFound("CustomField", command.Id));

        var req = command.Request;
        if (string.IsNullOrWhiteSpace(req.Label))
            return Result.Failure<CustomFieldDto>(Error.Validation("label", "Le libellé est obligatoire."));

        // FieldType is immutable after creation; options/relation reuse the existing field type.
        var optionsJson = CreateCustomFieldCommandHandler.BuildOptionsJson(field.FieldType, req.Options, req.Relation, req.Config, out var optionError);
        if (optionError is not null)
            return Result.Failure<CustomFieldDto>(optionError);

        if (field.FieldType == CustomFieldType.Formula)
        {
            var siblings = await _fields.ListByEntityAsync(tenantId, field.EntityDefinitionId, includeInactive: true, cancellationToken);
            var formulaError = StudioFormula.Validate(field.Key, StudioFormula.GetExpression(optionsJson), siblings);
            if (formulaError is not null)
                return Result.Failure<CustomFieldDto>(formulaError);
        }
        else if (field.FieldType == CustomFieldType.Lookup)
        {
            var siblings = await _fields.ListByEntityAsync(tenantId, field.EntityDefinitionId, includeInactive: true, cancellationToken);
            var lookup = StudioLookupRollup.ParseLookup(optionsJson);
            var lookupError = StudioLookupRollup.ValidateLookup(lookup?.Via, lookup?.Target, siblings);
            if (lookupError is not null)
                return Result.Failure<CustomFieldDto>(lookupError);
        }

        field.Update(req.Label.Trim(), req.IsRequired, req.IsUnique,
            StudioFieldJson.SerializeRules(req.Rules), optionsJson, defaultValueJson: null, req.IsActive, userId);

        await _fields.UpdateAsync(field, cancellationToken);
        if (field.IsUnique && field.IsActive)
            await _jsonIndex.EnsureUniqueFieldIndexAsync(tenantId, field.Key, cancellationToken);
        return Result.Success(StudioMappers.ToDto(field));
    }
}

// ---- Change field type (PR 3.1) : point de vérité unique FieldTypeConversionPolicy ----

/// <summary>Vérifie SANS RIEN MODIFIER si un changement de type serait accepté (utilisé par le bouton « Changer de type » et l'IA avant proposition).</summary>
public sealed record CheckCustomFieldTypeChangeQuery(Guid EntityId, Guid FieldId, CustomFieldType To)
    : IRequest<Result<FieldTypeChangeCheckDto>>;

public sealed class CheckCustomFieldTypeChangeQueryHandler
    : IRequestHandler<CheckCustomFieldTypeChangeQuery, Result<FieldTypeChangeCheckDto>>
{
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomRecordRepository _records;
    private readonly ICurrentUser _currentUser;

    public CheckCustomFieldTypeChangeQueryHandler(ICustomFieldRepository fields, ICustomRecordRepository records, ICurrentUser currentUser)
    {
        _fields = fields;
        _records = records;
        _currentUser = currentUser;
    }

    public async Task<Result<FieldTypeChangeCheckDto>> Handle(CheckCustomFieldTypeChangeQuery request, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<FieldTypeChangeCheckDto>(err);

        var field = await _fields.GetByIdAsync(tenantId, request.FieldId, cancellationToken);
        if (field is null || field.EntityDefinitionId != request.EntityId)
            return Result.Failure<FieldTypeChangeCheckDto>(Error.NotFound("CustomField", request.FieldId));

        var policy = FieldTypeConversionPolicy.Classify(field.FieldType, request.To);
        var recordCount = policy == FieldTypeConversion.RequiresEmptyTable
            ? await _records.CountAsync(tenantId, request.EntityId, cancellationToken)
            : 0;

        var allowed = policy == FieldTypeConversion.Lossless
            || (policy == FieldTypeConversion.RequiresEmptyTable && recordCount == 0);

        return Result.Success(new FieldTypeChangeCheckDto(
            field.FieldType.ToString(),
            request.To.ToString(),
            FieldTypeConversionPolicy.PolicyCode(policy),
            recordCount,
            FieldTypeConversionPolicy.Describe(field.FieldType, request.To, recordCount),
            allowed));
    }
}

public sealed record ChangeCustomFieldTypeCommand(Guid EntityId, Guid FieldId, ChangeCustomFieldTypeRequest Request)
    : IRequest<Result<CustomFieldDto>>;

public sealed class ChangeCustomFieldTypeCommandHandler : IRequestHandler<ChangeCustomFieldTypeCommand, Result<CustomFieldDto>>
{
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomRecordRepository _records;
    private readonly IJsonIndexManager _jsonIndex;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public ChangeCustomFieldTypeCommandHandler(
        ICustomFieldRepository fields, ICustomRecordRepository records, IJsonIndexManager jsonIndex,
        IAuditService audit, ICurrentUser currentUser)
    {
        _fields = fields;
        _records = records;
        _jsonIndex = jsonIndex;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result<CustomFieldDto>> Handle(ChangeCustomFieldTypeCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure<CustomFieldDto>(err);

        var field = await _fields.GetByIdAsync(tenantId, command.FieldId, cancellationToken);
        if (field is null || field.EntityDefinitionId != command.EntityId)
            return Result.Failure<CustomFieldDto>(Error.NotFound("CustomField", command.FieldId));

        var req = command.Request;
        var policy = FieldTypeConversionPolicy.Classify(field.FieldType, req.FieldType);

        if (policy == FieldTypeConversion.Forbidden)
            return Result.Failure<CustomFieldDto>(Error.Validation("fieldType", FieldTypeConversionPolicy.Describe(field.FieldType, req.FieldType)));

        var recordCount = 0;
        if (policy == FieldTypeConversion.RequiresEmptyTable)
        {
            recordCount = await _records.CountAsync(tenantId, command.EntityId, cancellationToken);
            if (recordCount > 0)
                return Result.Failure<CustomFieldDto>(Error.Validation("fieldType", FieldTypeConversionPolicy.Describe(field.FieldType, req.FieldType, recordCount)));
        }

        var optionsJson = CreateCustomFieldCommandHandler.BuildOptionsJson(req.FieldType, req.Options, req.Relation, req.Config, out var optionError);
        if (optionError is not null)
            return Result.Failure<CustomFieldDto>(optionError);

        var oldType = field.FieldType;
        var wasUnique = field.IsUnique;
        var oldOptionsJson = field.OptionsJson;
        var oldRulesJson = field.ValidationRulesJson;
        var oldDefaultJson = field.DefaultValueJson;

        field.ChangeType(req.FieldType, optionsJson, StudioFieldJson.SerializeRules(req.Rules), userId);
        if (wasUnique && !FieldTypeConversionPolicy.UniqueCapable.Contains(req.FieldType))
        {
            field.Update(field.Label, field.IsRequired, isUnique: false,
                field.ValidationRulesJson, field.OptionsJson, field.DefaultValueJson, field.IsActive, userId);
        }

        await _fields.UpdateAsync(field, cancellationToken);

        // Fenêtre de course (table vide exigée) : aucune transaction n'englobe le comptage et la
        // mise à jour. On recompte APRÈS la persistance ; si des enregistrements sont apparus entre
        // les deux, le changement est annulé (retour à l'ancien type) et refusé.
        if (policy == FieldTypeConversion.RequiresEmptyTable)
        {
            var afterCount = await _records.CountAsync(tenantId, command.EntityId, cancellationToken);
            if (afterCount > 0)
            {
                field.ChangeType(oldType, oldOptionsJson, oldRulesJson, userId);
                field.Update(field.Label, field.IsRequired, wasUnique,
                    oldRulesJson, oldOptionsJson, oldDefaultJson, field.IsActive, userId);
                await _fields.UpdateAsync(field, cancellationToken);
                return Result.Failure<CustomFieldDto>(Error.Validation("fieldType", FieldTypeConversionPolicy.Describe(oldType, req.FieldType, afterCount)));
            }
        }

        // La colonne calculée jx_<clé> est un CAST(JSON_VALUE(...) AS nvarchar) indépendant du type
        // de champ et partagée par toutes les tables du tenant utilisant la même clé : elle n'est
        // jamais supprimée ici. Seul l'index d'unicité est (ré)assuré si le champ reste unique.
        if (field.IsUnique)
            await _jsonIndex.EnsureUniqueFieldIndexAsync(tenantId, field.Key, cancellationToken);

        await StudioAudit.SafeLogAsync(_audit, "Studio.Field.TypeChanged", "CustomField", field.Id,
            new { From = oldType.ToString() },
            new { To = req.FieldType.ToString(), Policy = FieldTypeConversionPolicy.PolicyCode(policy) },
            cancellationToken);

        return Result.Success(StudioMappers.ToDto(field));
    }
}

// ---- Delete field (hard delete of a definition row; records keep stale keys harmlessly) ----

public sealed record DeleteCustomFieldCommand(Guid Id) : IRequest<Result>;

public sealed class DeleteCustomFieldCommandHandler : IRequestHandler<DeleteCustomFieldCommand, Result>
{
    private readonly ICustomFieldRepository _fields;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public DeleteCustomFieldCommandHandler(ICustomFieldRepository fields, IAuditService audit, ICurrentUser currentUser)
    {
        _fields = fields;
        _audit = audit;
        _currentUser = currentUser;
    }

    public async Task<Result> Handle(DeleteCustomFieldCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure(err);

        var field = await _fields.GetByIdAsync(tenantId, command.Id, cancellationToken);
        if (field is null)
            return Result.Failure(Error.NotFound("CustomField", command.Id));

        // Soft-deactivate rather than physically remove, to preserve historical record data.
        field.Update(field.Label, field.IsRequired, field.IsUnique, field.ValidationRulesJson, field.OptionsJson, field.DefaultValueJson, isActive: false, userId);
        await _fields.UpdateAsync(field, cancellationToken);
        await StudioAudit.SafeLogAsync(_audit, "Studio.Field.Deleted", "CustomField", field.Id,
            new { field.Key, field.Label }, null, cancellationToken);
        return Result.Success();
    }
}

// ---- Reorder fields ----

public sealed record ReorderCustomFieldsCommand(Guid EntityId, ReorderCustomFieldsRequest Request) : IRequest<Result>;

public sealed class ReorderCustomFieldsCommandHandler : IRequestHandler<ReorderCustomFieldsCommand, Result>
{
    private readonly ICustomFieldRepository _fields;
    private readonly ICurrentUser _currentUser;

    public ReorderCustomFieldsCommandHandler(ICustomFieldRepository fields, ICurrentUser currentUser)
    {
        _fields = fields;
        _currentUser = currentUser;
    }

    public async Task<Result> Handle(ReorderCustomFieldsCommand command, CancellationToken cancellationToken)
    {
        if (!StudioContext.TryGet(_currentUser, out var tenantId, out var userId, out var err))
            return Result.Failure(err);

        var fields = await _fields.ListByEntityAsync(tenantId, command.EntityId, includeInactive: true, cancellationToken);
        var byId = fields.ToDictionary(f => f.Id);

        var order = command.Request.OrderedFieldIds;
        for (var i = 0; i < order.Count; i++)
        {
            if (byId.TryGetValue(order[i], out var field))
                field.SetSortOrder(i, userId);
        }

        await _fields.UpdateRangeAsync(fields, cancellationToken);
        return Result.Success();
    }
}
