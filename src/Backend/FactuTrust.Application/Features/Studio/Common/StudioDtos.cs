using System.Text.Json.Nodes;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Studio.Common;

// ---- Entities (custom "tables") ----

public sealed record CustomEntityDto(
    Guid Id,
    string Key,
    string DisplayName,
    string DisplayNamePlural,
    string? Icon,
    string? Description,
    bool IsActive,
    int FieldCount,
    Guid? SystemId,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    CustomEntityKind Kind = CustomEntityKind.Standard);

public sealed record CreateCustomEntityRequest(
    string Key,
    string DisplayName,
    string? DisplayNamePlural,
    string? Icon,
    string? Description,
    Guid? SystemId = null,
    CustomEntityKind Kind = CustomEntityKind.Standard);

public sealed record UpdateCustomEntityRequest(
    string DisplayName,
    string? DisplayNamePlural,
    string? Icon,
    string? Description,
    bool IsActive);

// ---- Fields ----

public sealed record CustomFieldDto(
    Guid Id,
    string Key,
    string Label,
    CustomFieldType FieldType,
    bool IsRequired,
    bool IsUnique,
    int SortOrder,
    FieldValidationRules? Rules,
    IReadOnlyList<SelectOptionDto>? Options,
    RelationRefDto? Relation,
    bool IsActive,
    JsonNode? Config = null);

public sealed record CreateCustomFieldRequest(
    string Key,
    string Label,
    CustomFieldType FieldType,
    bool IsRequired,
    bool IsUnique,
    FieldValidationRules? Rules,
    IReadOnlyList<SelectOptionDto>? Options,
    RelationRefDto? Relation,
    Dictionary<string, JsonNode?>? Config = null);

public sealed record UpdateCustomFieldRequest(
    string Label,
    bool IsRequired,
    bool IsUnique,
    FieldValidationRules? Rules,
    IReadOnlyList<SelectOptionDto>? Options,
    RelationRefDto? Relation,
    bool IsActive,
    Dictionary<string, JsonNode?>? Config = null);

public sealed record ReorderCustomFieldsRequest(IReadOnlyList<Guid> OrderedFieldIds);

// ---- Changement de type de champ (PR 3.1) ----

/// <summary>Corps de <c>PATCH api/studio/entities/{entityId}/fields/{fieldId}/type</c>.</summary>
public sealed record ChangeCustomFieldTypeRequest(
    CustomFieldType FieldType,
    IReadOnlyList<SelectOptionDto>? Options = null,
    FieldValidationRules? Rules = null,
    RelationRefDto? Relation = null,
    Dictionary<string, JsonNode?>? Config = null);

/// <summary>
/// Réponse de <c>GET …/fields/{fieldId}/type-check?to=</c> : la politique appliquée par
/// <see cref="FieldTypeConversionPolicy.Classify"/> sans rien modifier.
/// </summary>
public sealed record FieldTypeChangeCheckDto(
    string From,
    string To,
    string Policy,
    int RecordCount,
    string Message,
    bool Allowed);


/// <summary>
/// The entity, its active fields, the default form layout — used by the runtime form/table renderer —
/// and (R2, PR 2.1) the relations the entity takes part in (empty when
/// <c>Ollama:EnableStudioManyToMany</c> is off). <see cref="Relations"/> is the same projection as
/// <c>GET api/studio/entities/{id}/relations</c>, restricted to active entities/fields.
/// </summary>
public sealed record CustomEntitySchemaDto(
    CustomEntityDto Entity,
    IReadOnlyList<CustomFieldDto> Fields,
    FormLayout Form,
    IReadOnlyList<EntityRelationDto> Relations = null!,
    IReadOnlyList<RecordViews.CustomRecordViewDto>? Views = null)
{
    public IReadOnlyList<EntityRelationDto> Relations { get; init; } = Relations ?? Array.Empty<EntityRelationDto>();

    /// <summary>
    /// Vues enregistrées actives (PR 2.3, R2), par défaut d'abord ; vide tant que
    /// <c>Ollama:EnableStudioRecordViews</c> est coupé.
    /// </summary>
    public IReadOnlyList<FactuTrust.Application.Features.Studio.RecordViews.CustomRecordViewDto> Views { get; init; } = Views ?? Array.Empty<RecordViews.CustomRecordViewDto>();
}

// ---- Relations (PR 2.1 — plusieurs-à-plusieurs) ----

/// <summary>
/// One relation seen from a given entity. <see cref="Kind"/> ∈ <c>many_to_one</c> (a
/// <c>RelationCustom</c> field carried by the entity itself), <c>one_to_many</c> (a field carried by
/// another standard entity pointing at it) or <c>many_to_many</c> (a <see cref="CustomEntityKind.Junction"/>
/// entity carrying one field towards the entity and one towards <see cref="TargetEntityId"/>).
/// For <c>many_to_many</c>, <see cref="FieldId"/>/<see cref="FieldKey"/> are the junction field pointing at
/// the SOURCE entity and <see cref="JunctionTargetFieldId"/> the junction field pointing at the target.
/// </summary>
public sealed record EntityRelationDto(
    string Kind,
    Guid SourceEntityId,
    string SourceEntityKey,
    string SourceLabel,
    Guid TargetEntityId,
    string TargetEntityKey,
    string TargetLabel,
    Guid FieldId,
    string FieldKey,
    bool IsRequired,
    bool IsUnique,
    Guid? JunctionEntityId,
    string? JunctionEntityKey,
    Guid? JunctionTargetFieldId,
    /// <summary>
    /// Clé du champ de jonction pointant vers <see cref="TargetEntityId"/> (PR 2.2, même nature que
    /// <see cref="JunctionTargetFieldId"/>). Null hors <c>many_to_many</c>.
    /// </summary>
    string? JunctionTargetFieldKey = null);

/// <summary>Request body of <c>POST api/studio/entities/{id}/relations/many-to-many</c>.</summary>
public sealed record CreateManyToManyRelationRequest(
    Guid TargetEntityId,
    string? Label,
    string? JunctionKey,
    string? JunctionDisplayName);

/// <summary>Result of a many-to-many creation: the junction entity and its two relation fields.</summary>
public sealed record ManyToManyRelationDto(
    CustomEntityDto Junction,
    CustomFieldDto SourceField,
    CustomFieldDto TargetField);

// ---- Records ----

public sealed record CustomRecordDto(
    Guid Id,
    JsonNode? Data,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string? RowVersion);

public sealed record SaveCustomRecordRequest(Dictionary<string, JsonNode?> Data, string? RowVersion = null);

// ---- Navigation ----

/// <summary>Hierarchical sidebar node: system group or standalone entity.</summary>
public sealed record StudioNavNodeDto(
    string Kind,
    string Key,
    string Label,
    string? Icon,
    string? Route,
    IReadOnlyList<StudioNavNodeDto>? Children);

/// <summary>A custom entity surfaced as a sidebar entry for end users (legacy flat shape).</summary>
public sealed record StudioNavItemDto(string Key, string Label, string? Icon);

// ---- Systems (multi-table apps) ----

public sealed record CustomSystemDto(
    Guid Id,
    string Key,
    string DisplayName,
    string? Icon,
    string? Description,
    IReadOnlyList<string>? OnboardingSteps,
    bool IsActive,
    int EntityCount,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record CustomSystemDetailDto(
    CustomSystemDto System,
    IReadOnlyList<CustomEntityDto> Entities);

public sealed record CreateCustomSystemRequest(
    string Key,
    string DisplayName,
    string? Icon,
    string? Description,
    IReadOnlyList<string>? OnboardingSteps);

public sealed record UpdateCustomSystemRequest(
    string DisplayName,
    string? Icon,
    string? Description,
    IReadOnlyList<string>? OnboardingSteps,
    bool IsActive);
