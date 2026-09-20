using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.Tools;

namespace FactuTrust.Application.Features.Studio.Workflows;

/// <summary>
/// Catalogue des actions ERP « pont » utilisables dans une étape <c>erp_action</c> d'un workflow
/// Studio (D10) : outils <b>mutants</b> du registre IA, hors outils internes <c>studio_*</c>.
/// Pure ; aucune modification d'<see cref="AiToolDefinition"/>.
/// </summary>
public static class StudioBridgeActionCatalog
{
    /// <summary>Un outil est pontable s'il mute des données et n'est pas un outil interne Studio.</summary>
    public static bool IsBridgeable(AiToolDefinition tool) =>
        tool.IsMutating && !tool.Name.StartsWith("studio_", StringComparison.OrdinalIgnoreCase);

    /// <summary>Résout une clé d'action ; null si inconnue ou non pontable.</summary>
    public static AiToolDefinition? Resolve(string? actionKey)
    {
        if (string.IsNullOrWhiteSpace(actionKey)) return null;
        var tool = AiToolRegistry.GetToolDefinition(actionKey);
        return tool is not null && IsBridgeable(tool) ? tool : null;
    }

    /// <summary>Toutes les actions pontables, triées par nom (Ordinal).</summary>
    public static IReadOnlyList<AiToolDefinition> List() =>
        AiToolRegistry.All
            .Where(IsBridgeable)
            .OrderBy(t => t.Name, StringComparer.Ordinal)
            .ToList();
}
