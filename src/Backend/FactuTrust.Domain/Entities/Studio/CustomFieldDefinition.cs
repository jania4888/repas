using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities.Studio;

/// <summary>
/// A typed field belonging to a <see cref="CustomEntityDefinition"/>. Validation rules, option
/// lists, and relation targets are stored as JSON to avoid schema churn as capabilities grow.
/// </summary>
public sealed class CustomFieldDefinition
{
    public Guid Id { get; private set; }
    public Guid TenantId { get; private set; }
    public Guid EntityDefinitionId { get; private set; }

    /// <summary>Machine name, sanitized and unique per (tenant, entity). Reserved names are blocked at the application layer.</summary>
    public string Key { get; private set; } = null!;

    public string Label { get; private set; } = null!;
    public CustomFieldType FieldType { get; private set; }

    public bool IsRequired { get; private set; }
    public bool IsUnique { get; private set; }
    public int SortOrder { get; private set; }

    /// <summary>Serialized <c>FieldValidationRules</c> (minLength/maxLength/min/max/regex/decimals); null = none.</summary>
    public string? ValidationRulesJson { get; private set; }

    /// <summary>Serialized choices for Select/MultiSelect, or relation target for Relation* fields; null = none.</summary>
    public string? OptionsJson { get; private set; }

    /// <summary>Serialized default value; null = none.</summary>
    public string? DefaultValueJson { get; private set; }

    public bool IsActive { get; private set; }

    public Guid? CreatedBy { get; private set; }
    public Guid? UpdatedBy { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }
    public byte[] RowVersion { get; private set; } = null!;

    private CustomFieldDefinition() { }

    public static CustomFieldDefinition Create(
        Guid tenantId,
        Guid entityDefinitionId,
        string key,
        string label,
        CustomFieldType fieldType,
        bool isRequired,
        bool isUnique,
        int sortOrder,
        string? validationRulesJson,
        string? optionsJson,
        string? defaultValueJson,
        Guid? createdBy)
    {
        return new CustomFieldDefinition
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            EntityDefinitionId = entityDefinitionId,
            Key = key,
            Label = label,
            FieldType = fieldType,
            IsRequired = isRequired,
            IsUnique = isUnique,
            SortOrder = sortOrder,
            ValidationRulesJson = validationRulesJson,
            OptionsJson = optionsJson,
            DefaultValueJson = defaultValueJson,
            IsActive = true,
            CreatedBy = createdBy,
            UpdatedBy = createdBy,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
    }

    public void Update(
        string label,
        bool isRequired,
        bool isUnique,
        string? validationRulesJson,
        string? optionsJson,
        string? defaultValueJson,
        bool isActive,
        Guid? updatedBy)
    {
        Label = label;
        IsRequired = isRequired;
        IsUnique = isUnique;
        ValidationRulesJson = validationRulesJson;
        OptionsJson = optionsJson;
        DefaultValueJson = defaultValueJson;
        IsActive = isActive;
        Touch(updatedBy);
    }

    public void SetSortOrder(int sortOrder, Guid? updatedBy)
    {
        SortOrder = sortOrder;
        Touch(updatedBy);
    }

    /// <summary>
    /// PR 3.1 : change le type du champ (sous la politique <c>FieldTypeConversionPolicy</c>, appliquée
    /// par l'appelant AVANT d'invoquer cette méthode). <see cref="DefaultValueJson"/> est toujours
    /// réinitialisé : une valeur par défaut sérialisée pour l'ancien type n'a aucun sens dans le nouveau.
    /// L'appelant est responsable de remettre <see cref="IsUnique"/> à false (via <see cref="Update"/>)
    /// quand le nouveau type ne supporte pas l'unicité.
    /// </summary>
    public void ChangeType(CustomFieldType newType, string? optionsJson, string? validationRulesJson, Guid? updatedBy)
    {
        FieldType = newType;
        OptionsJson = optionsJson;
        ValidationRulesJson = validationRulesJson;
        DefaultValueJson = null;
        Touch(updatedBy);
    }

    private void Touch(Guid? updatedBy)
    {
        UpdatedBy = updatedBy;
        UpdatedAt = DateTime.UtcNow;
    }
}
