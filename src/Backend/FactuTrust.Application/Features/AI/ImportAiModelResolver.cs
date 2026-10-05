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

    /// <summary>Modèle vision facture (legacy appsettings). Obsolète si HonorLegacyImportVisionModels=false.</summary>
    public static string? ResolveLegacyInvoiceVisionModelId(OllamaSettings settings)
    {
        var model = settings.InvoiceImportVisionModel?.Trim();
        return string.IsNullOrWhiteSpace(model) ? null : model;
    }

    /// <summary>Modèle vision relevé : BankStatementImportVisionModel → InvoiceImportVisionModel, ou null.</summary>
    public static string? ResolveBankStatementVisionModelId(OllamaSettings settings)
    {
        var model = !string.IsNullOrWhiteSpace(settings.BankStatementImportVisionModel)
            ? settings.BankStatementImportVisionModel.Trim()
            : settings.InvoiceImportVisionModel?.Trim();
        return string.IsNullOrWhiteSpace(model) ? null : model;
    }

    /// <summary>Chaîne relevé bancaire : alignée sur InvoiceImportModel (même modèle que les factures).</summary>
    public static string ResolveServerBankStatementImportModelName(OllamaSettings settings) =>
        ResolveServerImportModel(settings).ProviderModelId ?? settings.DefaultModel.Trim();

    /// <summary>Détermine la stratégie de lecture vision relevé pour le modèle effectif.</summary>
    public static ImportVisionStrategy ResolveVisionStrategy(ParsedModelRef model)
    {
        if (!AiModelCapabilityDetector.DetectVisionSupport(model))
            return ImportVisionStrategy.None;

        var id = model.ProviderModelId ?? model.CanonicalModelRef ?? string.Empty;
        return DetectGlmOcrModel(id) ? ImportVisionStrategy.GlmOcrOptimized : ImportVisionStrategy.GenericMultimodal;
    }

    public static bool DetectGlmOcrModel(string? modelId)
    {
        if (string.IsNullOrWhiteSpace(modelId))
            return false;
        var name = modelId.ToLowerInvariant();
        return name.Contains("glm-ocr", StringComparison.Ordinal)
               || name.Contains("glm_ocr", StringComparison.Ordinal)
               || name.Contains("glmocr", StringComparison.Ordinal);
    }

    public static ParsedModelRef NormalizeModelRefPublic(string model) => NormalizeModelRef(model);

    private static ParsedModelRef NormalizeModelRef(string model)
    {
        var modelRef = ModelRef.Parse(model);
        if (string.IsNullOrEmpty(modelRef.CanonicalModelRef))
            modelRef = ModelRef.Parse($"{ModelRef.OllamaPrefix}{model}");
        return modelRef;
    }
}
