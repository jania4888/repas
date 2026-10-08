using System.Text.Json;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Domain.Common;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.AI;

/// <summary>
/// Branche Docstrange (Nanonets) sur la couture <see cref="IDocumentExtractionProvider"/>.
///
/// <para>Résout les credentials à chaque appel — la clé n'est jamais retenue en mémoire entre
/// deux extractions — et ne lève jamais : un échec rend un <see cref="Result"/> en erreur, à
/// charge de l'appelant de reprendre son chemin habituel.</para>
/// </summary>
public sealed class DocStrangeDocumentExtractionProvider : IDocumentExtractionProvider
{
    private readonly IPlatformAiSettingsService _platformAiSettings;
    private readonly IDocStrangeClient _client;
    private readonly ILogger<DocStrangeDocumentExtractionProvider> _logger;

    public DocStrangeDocumentExtractionProvider(
        IPlatformAiSettingsService platformAiSettings,
        IDocStrangeClient client,
        ILogger<DocStrangeDocumentExtractionProvider> logger)
    {
        _platformAiSettings = platformAiSettings;
        _client = client;
        _logger = logger;
    }

    /// <summary>Repris tel quel dans la traçabilité des pages et l'audit. Jamais un secret.</summary>
    public string Name => "docstrange";

    public async Task<bool> IsAvailableAsync(CancellationToken cancellationToken)
    {
        try
        {
            var credentials = await _platformAiSettings.GetDocStrangeCredentialsAsync(cancellationToken);
            return credentials.IsEnabled && !string.IsNullOrWhiteSpace(credentials.ApiKey);
        }
        catch (Exception ex)
        {
            // Disponibilité seulement : une base injoignable ne doit pas casser l'import, elle
            // doit le laisser sur son chemin actuel.
            _logger.LogWarning(ex, "Impossible de déterminer la disponibilité de Docstrange ; considéré indisponible.");
            return false;
        }
    }

    public Task<Result<string>> ExtractStructuredAsync(
        Stream file,
        string fileName,
        string contentType,
        JsonElement jsonSchema,
        CancellationToken cancellationToken) =>
        RunAsync(file, fileName, contentType, DocStrangeOutput.Json, jsonSchema.GetRawText(), cancellationToken);

    public Task<Result<string>> ExtractTextAsync(
        Stream file,
        string fileName,
        string contentType,
        CancellationToken cancellationToken) =>
        RunAsync(file, fileName, contentType, DocStrangeOutput.Markdown, null, cancellationToken);

    private async Task<Result<string>> RunAsync(
        Stream file,
        string fileName,
        string contentType,
        DocStrangeOutput output,
        string? jsonSchema,
        CancellationToken cancellationToken)
    {
        var credentials = await _platformAiSettings.GetDocStrangeCredentialsAsync(cancellationToken);
        if (!credentials.IsEnabled || string.IsNullOrWhiteSpace(credentials.ApiKey))
            return Result.Failure<string>(Error.Validation("DocStrange", "Docstrange n'est pas configuré."));

        var result = await _client.ExtractAsync(
            new DocStrangeExtractRequest(
                credentials.BaseUrl,
                credentials.ApiKey!,
                file,
                fileName,
                contentType,
                output,
                jsonSchema),
            cancellationToken);

        return result.IsFailure
            ? Result.Failure<string>(result.Error)
            : Result.Success(result.Value.Content);
    }
}
