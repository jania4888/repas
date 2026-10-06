using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.AI;

public sealed class ImportAiModelResolutionService : IImportAiModelResolutionService
{
    private readonly IPlatformAiSettingsService _platformAiSettings;
    private readonly IAiModelVisionProbe _visionProbe;
    private readonly OllamaSettings _ollamaSettings;
    private readonly ILogger<ImportAiModelResolutionService> _logger;

    public ImportAiModelResolutionService(
        IPlatformAiSettingsService platformAiSettings,
        IAiModelVisionProbe visionProbe,
        IOptions<OllamaSettings> ollamaSettings,
        ILogger<ImportAiModelResolutionService> logger)
    {
        _platformAiSettings = platformAiSettings;
        _visionProbe = visionProbe;
        _ollamaSettings = ollamaSettings.Value;
        _logger = logger;
    }

    public async Task<DocumentImportModelResolution> ResolveAsync(
        string? modelOverride,
        CancellationToken cancellationToken = default)
    {
        if (!string.IsNullOrWhiteSpace(modelOverride))
        {
            var explicitRef = ImportAiModelResolver.NormalizeModelRefPublic(modelOverride.Trim());
            return await BuildAsync(explicitRef, DocumentImportModelSource.RequestOverride, usesLegacyVision: false, cancellationToken);
        }

        try
        {
            var platformImport = await _platformAiSettings.GetInvoiceImportModelRefAsync(cancellationToken);
            if (ImportAiModelResolver.TryResolvePlatformImportModel(platformImport, _logger, out var platformModel))
                return await BuildAsync(platformModel, DocumentImportModelSource.Platform, usesLegacyVision: false, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Import IA : lecture du modèle d'import plateforme impossible ; utilisation de la configuration serveur.");
        }

        var server = ImportAiModelResolver.ResolveServerImportModel(_ollamaSettings);
        return await BuildAsync(server, DocumentImportModelSource.ServerFallback, usesLegacyVision: false, cancellationToken);
    }

    public async Task<string?> ResolveEffectiveVisionModelIdAsync(
        string? modelOverride,
        bool forBankStatement,
        CancellationToken cancellationToken = default)
    {
        var resolution = await ResolveAsync(modelOverride, cancellationToken);

        if (_ollamaSettings.HonorLegacyImportVisionModels)
        {
            _logger.LogWarning(
                "Import IA : HonorLegacyImportVisionModels=true — utilisation des clés appsettings vision (obsolète).");
            var legacy = forBankStatement
                ? ImportAiModelResolver.ResolveBankStatementVisionModelId(_ollamaSettings)
                : ImportAiModelResolver.ResolveLegacyInvoiceVisionModelId(_ollamaSettings);
            return string.IsNullOrWhiteSpace(legacy) ? null : legacy.Trim();
        }

        if (resolution.IsVisionCapable)
            return resolution.EffectiveVisionModelId;

        return null;
    }

    private async Task<DocumentImportModelResolution> BuildAsync(
        ParsedModelRef model,
        DocumentImportModelSource source,
        bool usesLegacyVision,
        CancellationToken cancellationToken)
    {
        // Le moteur fait foi ; l'heuristique de nom ne sert qu'à défaut de réponse.
        var declared = await _visionProbe.TryDetectVisionAsync(model, cancellationToken);
        var visionCapable = AiModelCapabilityDetector.ResolveVisionSupport(declared, model);

        if (declared is null && visionCapable)
        {
            _logger.LogDebug(
                "Import IA : capacité vision de {Model} déduite du nom (le moteur ne l'a pas déclarée).",
                model.ProviderModelId);
        }

        var strategy = ImportAiModelResolver.ResolveVisionStrategy(model, visionCapable);

        return new DocumentImportModelResolution(
            model,
            source,
            visionCapable,
            usesLegacyVision,
            strategy);
    }
}
