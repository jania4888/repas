using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.Commands;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Import d'une facture à partir d'un fichier (PDF, image, Word, Excel) analysé par l'IA.
/// Endpoint isolé du chat de l'assistant : aucune conversation, aucun flux SSE.
/// </summary>
[Route("api/ai")]
[ApiController]
[Authorize(Policy = PermissionPolicies.AiChat)]
public sealed class AiInvoiceImportController : ControllerBase
{
    /// <summary>Taille maximale du fichier importé (10 Mo), alignée sur /api/ai/document-extract.</summary>
    public const long ImportMaxBytes = 10 * 1024 * 1024;

    private readonly ImportInvoiceFromFileHandler _handler;
    private readonly IAiOcrService _ocr;
    private readonly IImportAiModelResolutionService _importModelResolver;
    private readonly ICurrentUser _currentUser;
    private readonly OllamaSettings _ollamaSettings;
    private readonly ILogger<AiInvoiceImportController> _logger;
    private readonly IHostEnvironment _environment;
    private readonly IDocumentExtractionProvider? _externalExtraction;

    public AiInvoiceImportController(
        ImportInvoiceFromFileHandler handler,
        IAiOcrService ocr,
        IImportAiModelResolutionService importModelResolver,
        ICurrentUser currentUser,
        IOptions<OllamaSettings> ollamaSettings,
        ILogger<AiInvoiceImportController> logger,
        IHostEnvironment environment,
        IDocumentExtractionProvider? externalExtraction = null)
    {
        _externalExtraction = externalExtraction;
        _handler = handler;
        _ocr = ocr;
        _importModelResolver = importModelResolver;
        _currentUser = currentUser;
        _ollamaSettings = ollamaSettings.Value;
        _logger = logger;
        _environment = environment;
    }

    /// <summary>Capacités d'import (OCR, modèles configurés) pour diagnostic support.</summary>
    [HttpGet("invoice-import/capabilities")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetCapabilities(CancellationToken cancellationToken)
    {
        // Nom du service d'extraction externe lorsqu'il est actif -- JAMAIS sa cle ni son URL.
        var externalProvider = _externalExtraction is not null
            && await _externalExtraction.IsAvailableAsync(cancellationToken)
                ? _externalExtraction.Name
                : null;

        var resolution = await _importModelResolver.ResolveAsync(null, cancellationToken);
        var visionModel = await _importModelResolver.ResolveEffectiveVisionModelIdAsync(null, forBankStatement: false, cancellationToken);
        return Ok(new
        {
            // Actif, ce service est le SEUL lecteur : le LLM n'est jamais appele.
            documentExtractionProvider = externalProvider,
            ocrAvailable = _ocr.IsAvailable,
            importModel = resolution.Model.ProviderModelId ?? resolution.Model.CanonicalModelRef,
            effectiveImportModelSource = resolution.Source.ToString(),
            visionCapable = resolution.IsVisionCapable,
            visionModel,
            visionMinOcrChars = _ollamaSettings.InvoiceImportVisionMinOcrChars,
            visionOnEmptyOcr = _ollamaSettings.InvoiceImportVisionOnEmptyOcr
        });
    }

    /// <summary>
    /// Analyse un fichier de facture et renvoie les données structurées extraites par l'IA.
    /// </summary>
    [HttpPost("invoice-import")]
    [EnableRateLimiting("ai")]
    [RequestSizeLimit(ImportMaxBytes + 256_000)]
    [ProducesResponseType(typeof(ApiResponse<InvoiceImportResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ImportInvoice(
        IFormFile file,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.IsAccountingFirmDelegatedContext)
            return StatusCode(StatusCodes.Status403Forbidden,
                ApiResponse<object>.Fail(FirmDelegatedAiScopePolicy.DeniedScopeMessage));

        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<object>.Fail("Fichier requis."));

        if (file.Length > ImportMaxBytes)
            return BadRequest(ApiResponse<object>.Fail("Fichier trop volumineux (maximum 10 Mo)."));

        try
        {
            await using var stream = file.OpenReadStream();
            var command = new ImportInvoiceFromFileCommand(
                stream, file.FileName, file.ContentType ?? string.Empty, null);
            var result = await _handler.HandleAsync(command, cancellationToken);

            return result.IsSuccess
                ? Ok(ApiResponse<InvoiceImportResultDto>.Ok(result.Value))
                : BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (OllamaRequestException ex)
        {
            _logger.LogWarning("Import facture : erreur Ollama. Status={Status} Detail={Detail}",
                ex.HttpStatusCode, ex.Message);
            return BadRequest(ApiResponse<object>.Fail(ex.UserMessage));
        }
        catch (OpenAiCompatibleRequestException ex)
        {
            _logger.LogWarning("Import facture : erreur fournisseur cloud. Status={Status}", ex.HttpStatusCode);
            return BadRequest(ApiResponse<object>.Fail(ex.UserMessage));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Import facture : erreur inattendue.");
            var message = _environment.IsDevelopment()
                ? ex.Message
                : "Une erreur inattendue s'est produite pendant l'import de la facture. "
                  + "Réessayez ou saisissez-la manuellement.";
            return BadRequest(ApiResponse<object>.Fail(message));
        }
    }

    /// <summary>
    /// Préchauffe le modèle d'import IA (best-effort, non bloquant). Appelé à l'ouverture
    /// de la modale d'import pour masquer le coût de chargement à froid du modèle.
    /// </summary>
    [HttpPost("invoice-import/warm-up")]
    [EnableRateLimiting("ai")]
    public async Task<IActionResult> WarmUp(CancellationToken cancellationToken)
    {
        var result = await _handler.WarmUpAsync(cancellationToken);
        return Ok(new
        {
            accepted = result.Accepted,
            ready = result.Ready,
            model = result.Model,
            error = result.Error,
            requiredGiB = result.RequiredGiB,
            availableGiB = result.AvailableGiB
        });
    }
}
