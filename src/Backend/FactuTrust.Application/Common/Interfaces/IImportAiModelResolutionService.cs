using FactuTrust.Application.Features.AI;

namespace FactuTrust.Application.Common.Interfaces;

/// <summary>
/// Source unique pour le modèle d'import documentaire (plateforme admin prioritaire).
/// </summary>
public interface IImportAiModelResolutionService
{
    /// <summary>
    /// Résout le modèle texte/vision d'import : override requête (si autorisé) → plateforme → appsettings.
    /// </summary>
    Task<DocumentImportModelResolution> ResolveAsync(
        string? modelOverride,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Identifiant du modèle vision à utiliser pour un flux (relevé, repli facture photo).
    /// Null si lecture vision impossible avec la configuration actuelle.
    /// </summary>
    Task<string?> ResolveEffectiveVisionModelIdAsync(
        string? modelOverride,
        bool forBankStatement,
        CancellationToken cancellationToken = default);
}
