namespace FactuTrust.Application.Features.AI;

/// <summary>Origine du modèle d'import documentaire effectivement retenu.</summary>
public enum DocumentImportModelSource
{
    RequestOverride = 0,
    Platform = 1,
    ServerFallback = 2,
}

/// <summary>Stratégie de lecture vision pour les relevés bancaires page par page.</summary>
public enum ImportVisionStrategy
{
    /// <summary>Aucune lecture vision (modèle texte seul ou non vision-capable).</summary>
    None = 0,

    /// <summary>Étages GLM-OCR natifs (JSON + Table Recognition).</summary>
    GlmOcrOptimized = 1,

    /// <summary>Une passe vision multimodale générique (prompt relevé + schéma JSON).</summary>
    GenericMultimodal = 2,
}

/// <summary>Résultat de la résolution du modèle d'import factures / relevés / pièces comptables.</summary>
public sealed record DocumentImportModelResolution(
    ParsedModelRef Model,
    DocumentImportModelSource Source,
    bool IsVisionCapable,
    bool UsesLegacyVisionAppsettings,
    ImportVisionStrategy VisionStrategy)
{
    /// <summary>Identifiant vision effectif pour Ollama/OpenRouter, ou null.</summary>
    public string? EffectiveVisionModelId =>
        IsVisionCapable && !string.IsNullOrWhiteSpace(Model.ProviderModelId)
            ? Model.ProviderModelId
            : null;
}
