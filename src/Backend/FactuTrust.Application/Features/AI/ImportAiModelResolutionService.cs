using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.AI;

public sealed class ImportAiModelResolutionService : IImportAiModelResolutionService
{
    private readonly IPlatformAiSettingsService _platformAiSettings;
    private readonly OllamaSettings _ollamaSettings;
    private readonly ILogger<ImportAiModelResolutionService> _logger;

    public ImportAiModelResolutionService(
        IPlatformAiSettingsService platformAiSettings,
        IOptions<OllamaSettings> ollamaSettings,
        ILogger<ImportAiModelResolutionService> logger)
    {
        _platformAiSettings = platformAiSettings;
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
            return Build(explicitRef, DocumentImportModelSource.RequestOverride, usesLegacyVision: false);
        }

        try
        {
            var platformImport = await _platformAiSettings.GetInvoiceImportModelRefAsync(cancellationToken);
            if (ImportAiModelResolver.TryResolvePlatformImportModel(platformImport, _logger, out var platformModel))
                return Build(platformModel, DocumentImportModelSource.Platform, usesLegacyVision: false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Import IA : lecture du modèle d'import plateforme impossible ; utilisation de la configuration serveur.");
        }

        var server = ImportAiModelResolver.ResolveServerImportModel(_ollamaSettings);
        return Build(server, DocumentImportModelSource.ServerFallback, usesLegacyVision: false);
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

    private DocumentImportModelResolution Build(
        ParsedModelRef model,
        DocumentImportModelSource source,
        bool usesLegacyVision)
    {
        var visionCapable = AiModelCapabilityDetector.DetectVisionSupport(model);
        var strategy = ImportAiModelResolver.ResolveVisionStrategy(model);
        if (!visionCapable)
            strategy = ImportVisionStrategy.None;

        return new DocumentImportModelResolution(
            model,
            source,
            visionCapable,
            usesLegacyVision,
            strategy);
    }
}
