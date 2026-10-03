using FactuTrust.Application.Configuration;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Application.Features.AI;

/// <summary>
/// Résolution du modèle LLM pour les imports documentaires (factures, relevés bancaires).
/// </summary>
public static class ImportAiModelResolver
{
    /// <summary>
    /// Utilise le modèle plateforme s'il est chat-capable ; sinon journalise et renvoie false.
    /// </summary>
    public static bool TryResolvePlatformImportModel(
        string? platformImport,
        ILogger? logger,
        out ParsedModelRef modelRef)
    {
        modelRef = default!;
        if (string.IsNullOrWhiteSpace(platformImport))
            return false;

        var candidate = NormalizeModelRef(platformImport.Trim());
        if (AiModelCapabilityDetector.DetectChatCapable(candidate))
        {
            modelRef = candidate;
            return true;
        }

        logger?.LogWarning(
            "Import IA : modèle plateforme {Model} n'est pas chat-capable (embedding?) ; repli configuration serveur.",
            platformImport);
        return false;
    }

    /// <summary>Chaîne appsettings : InvoiceImportModel → DefaultModel → mistral.</summary>
    public static ParsedModelRef ResolveServerImportModel(OllamaSettings settings)
    {
        var model =
            !string.IsNullOrWhiteSpace(settings.InvoiceImportModel) ? settings.InvoiceImportModel.Trim()
            : !string.IsNullOrWhiteSpace(settings.DefaultModel) ? settings.DefaultModel.Trim()
            : "mistral";

        return NormalizeModelRef(model);
    }

    /// <summary>Modèle vision relevé : BankStatementImportVisionModel → InvoiceImportVisionModel, ou null.</summary>
    public static string? ResolveBankStatementVisionModelId(OllamaSettings settings)
    {
        var model = !string.IsNullOrWhiteSpace(settings.BankStatementImportVisionModel)
            ? settings.BankStatementImportVisionModel.Trim()
            : settings.InvoiceImportVisionModel?.Trim();
        return string.IsNullOrWhiteSpace(model) ? null : model;
    }

    /// <summary>Chaîne relevé bancaire : BankStatementImportModel → InvoiceImportModel → DefaultModel.</summary>
    public static string ResolveServerBankStatementImportModelName(OllamaSettings settings) =>
        !string.IsNullOrWhiteSpace(settings.BankStatementImportModel)
            ? settings.BankStatementImportModel.Trim()
            : !string.IsNullOrWhiteSpace(settings.InvoiceImportModel)
                ? settings.InvoiceImportModel.Trim()
                : settings.DefaultModel.Trim();

    private static ParsedModelRef NormalizeModelRef(string model)
    {
        var modelRef = ModelRef.Parse(model);
        if (string.IsNullOrEmpty(modelRef.CanonicalModelRef))
            modelRef = ModelRef.Parse($"{ModelRef.OllamaPrefix}{model}");
        return modelRef;
    }
}
