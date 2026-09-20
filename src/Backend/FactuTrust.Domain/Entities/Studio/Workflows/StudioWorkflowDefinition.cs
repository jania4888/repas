using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Entities.Studio.Workflows;

/// <summary>
/// Définition d'un workflow Studio attaché à une table (<see cref="CustomEntityDefinition"/>) :
/// déclencheur + liste ordonnée d'étapes sérialisée en JSON (<see cref="StepsJson"/>), re-validée
/// contre les champs actifs à chaque enregistrement. Toute modification du déclencheur, de sa
/// configuration ou des étapes incrémente <see cref="Version"/> (les instances en cours conservent
/// la version avec laquelle elles ont démarré). La suppression est logique (<see cref="IsDeleted"/>).
/// </summary>
public sealed class StudioWorkflowDefinition
{
    public const int KeyMaxLength = 64;
    public const int NameMaxLength = 128;
    public const int DescriptionMaxLength = 512;

    public Guid Id { get; private set; }
    public Guid TenantId { get; private set; }
    public Guid EntityDefinitionId { get; private set; }

    /// <summary>Clé machine, unique par (tenant, table) parmi les définitions non supprimées.</summary>
    public string Key { get; private set; } = null!;

    public string Name { get; private set; } = null!;
    public string? Description { get; private set; }

    public StudioWorkflowTriggerKind Trigger { get; private set; }

    /// <summary>Configuration du déclencheur, sérialisée en JSON (<c>{}</c> par défaut).</summary>
    public string TriggerConfigJson { get; private set; } = null!;

    /// <summary>Étapes ordonnées du workflow : <c>{ "version": 1, "steps": [ … ] }</c>.</summary>
    public string StepsJson { get; private set; } = null!;

    /// <summary>Version de la définition, incrémentée à chaque changement de déclencheur ou d'étapes.</summary>
    public int Version { get; private set; }

    public bool IsActive { get; private set; }
    public bool IsDeleted { get; private set; }
    public DateTime? DeletedAt { get; private set; }

    public Guid? CreatedBy { get; private set; }
    public Guid? UpdatedBy { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }
    public byte[] RowVersion { get; private set; } = null!;

    private StudioWorkflowDefinition() { }

    public static StudioWorkflowDefinition Create(
        Guid tenantId,
        Guid entityDefinitionId,
        string key,
        string name,
        string? description,
        StudioWorkflowTriggerKind trigger,
        string triggerConfigJson,
        string stepsJson,
        bool isActive,
        Guid? createdBy)
    {
        return new StudioWorkflowDefinition
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            EntityDefinitionId = entityDefinitionId,
            Key = key,
            Name = name,
            Description = description,
            Trigger = trigger,
            TriggerConfigJson = triggerConfigJson,
            StepsJson = stepsJson,
            Version = 1,
            IsActive = isActive,
            IsDeleted = false,
            CreatedBy = createdBy,
            UpdatedBy = createdBy,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
    }

    /// <summary>
    /// Met à jour la définition ; <see cref="Version"/> n'est incrémentée que si le déclencheur,
    /// sa configuration ou les étapes changent (comparaison ordinale).
    /// </summary>
    public void Update(string name, string? description, StudioWorkflowTriggerKind trigger, string triggerConfigJson, string stepsJson, Guid? updatedBy)
    {
        if (Trigger != trigger
            || !string.Equals(TriggerConfigJson, triggerConfigJson, StringComparison.Ordinal)
            || !string.Equals(StepsJson, stepsJson, StringComparison.Ordinal))
        {
            Version++;
        }

        Name = name;
        Description = description;
        Trigger = trigger;
        TriggerConfigJson = triggerConfigJson;
        StepsJson = stepsJson;
        Touch(updatedBy);
    }

    public void SetActive(bool isActive, Guid? updatedBy)
    {
        IsActive = isActive;
        Touch(updatedBy);
    }

    public void SoftDelete(Guid? deletedBy)
    {
        IsDeleted = true;
        DeletedAt = DateTime.UtcNow;
        // Une définition supprimée ne doit plus jamais se déclencher.
        IsActive = false;
        Touch(deletedBy);
    }

    private void Touch(Guid? updatedBy)
    {
        UpdatedBy = updatedBy;
        UpdatedAt = DateTime.UtcNow;
    }
}
