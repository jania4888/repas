using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Files;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Application.Features.PurchaseReceipts.DocumentImport;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Import d'un bon de réception à partir d'un document fournisseur (PDF, JPG, PNG) : lit le
/// document et renvoie une proposition de pré-remplissage en LECTURE SEULE (fournisseur, lignes,
/// totaux, avertissements). N'écrit jamais rien en base — la création réutilise les endpoints
/// existants (<c>POST api/suppliers</c>, <c>POST api/products</c>, <c>POST api/purchasereceipts</c>,
/// <c>POST api/purchasereceipts/{id}/attachments</c>). Voir le plan, section 1.
///
/// Volontairement indépendant de <c>AccountingSettings.DocumentImportEnabled</c> (contrairement à
/// <c>AccountingDocumentImportController</c>) : ce commutateur ne concerne que la comptabilité.
/// </summary>
[Route("api/purchasereceipts/import-document")]
[ApiController]
[Authorize(Policy = PermissionPolicies.PurchaseReceiptsCreate)]
[Authorize(Policy = PermissionPolicies.AiChat)]
public sealed class PurchaseReceiptDocumentImportController : ControllerBase
{
    /// <summary>Taille maximale du fichier importé (10 Mo), alignée sur les autres imports de documents.</summary>
    public const long ImportMaxBytes = 10 * 1024 * 1024;

    /// <summary>
    /// Restriction volontairement plus stricte que <see cref="UploadValidator"/> : WEBP et les
    /// autres formats de son allow-list générale ne sont pas acceptés ici, car
    /// <c>PurchaseReceiptAttachment.Create</c> ne les prend pas en charge.
    /// </summary>
    private static readonly IReadOnlySet<string> AcceptedContentTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "application/pdf", "image/jpeg", "image/png"
    };

    private readonly ImportPurchaseReceiptFromDocumentHandler _handler;
    private readonly ICurrentUser _currentUser;
    private readonly IDocumentExtractionProvider? _externalExtraction;
    private readonly ILogger<PurchaseReceiptDocumentImportController> _logger;
    private readonly IHostEnvironment _environment;

    public PurchaseReceiptDocumentImportController(
        ImportPurchaseReceiptFromDocumentHandler handler,
        ICurrentUser currentUser,
        ILogger<PurchaseReceiptDocumentImportController> logger,
        IHostEnvironment environment,
        IDocumentExtractionProvider? externalExtraction = null)
    {
        _handler = handler;
        _currentUser = currentUser;
        _logger = logger;
        _environment = environment;
        _externalExtraction = externalExtraction;
    }

    /// <summary>Capacités de cet import (service d'extraction, OCR, droits), pour piloter l'UI.</summary>
    [HttpGet("capabilities")]
    [ProducesResponseType(typeof(ApiResponse<PurchaseReceiptImportCapabilitiesDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetCapabilities(CancellationToken cancellationToken)
    {
        var externalAvailable = _externalExtraction is not null
            && await _externalExtraction.IsAvailableAsync(cancellationToken);

        var extractionProvider = externalAvailable ? "docstrange" : "llm";

        var dto = new PurchaseReceiptImportCapabilitiesDto(
            Available: true,
            ExtractionProvider: extractionProvider,
            OcrAvailable: true,
            VisionCapable: true,
            ExternalProcessing: externalAvailable,
            MaxFileBytes: ImportMaxBytes,
            AcceptedContentTypes: AcceptedContentTypes.ToArray(),
            CanCreateSupplier: _currentUser.HasPermission(Permissions.Suppliers.Create),
            CanCreateProduct: _currentUser.HasPermission(Permissions.Products.Create),
            CanAttach: _currentUser.HasPermission(Permissions.PurchaseReceipts.Update));

        return Ok(ApiResponse<PurchaseReceiptImportCapabilitiesDto>.Ok(dto));
    }

    /// <summary>
    /// Analyse le document fourni et renvoie une proposition de pré-remplissage. Ne crée et ne
    /// modifie rien.
    /// </summary>
    [HttpPost("")]
    [EnableRateLimiting("ai")]
    [RequestSizeLimit(ImportMaxBytes + 256_000)]
    [Consumes("multipart/form-data")]
    [ProducesResponseType(typeof(ApiResponse<PurchaseReceiptImportProposalDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> Propose(IFormFile file, CancellationToken cancellationToken = default)
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
            var (header, bytesRead) = await UploadValidator.ReadHeaderAsync(
                stream, UploadValidator.RequiredHeaderBytes, cancellationToken);

            var validation = UploadValidator.Validate(
                file.FileName, file.ContentType, file.Length, header.AsMemory(0, bytesRead), ImportMaxBytes);
            if (!validation.IsValid)
                return BadRequest(ApiResponse<object>.Fail(validation.ErrorMessage!));

            // Restriction supplémentaire : seuls PDF/JPEG/PNG sont acceptés ici, même si
            // UploadValidator accepterait d'autres formats de son allow-list générale (WEBP, GIF…).
            if (!AcceptedContentTypes.Contains(file.ContentType?.Trim() ?? string.Empty))
                return BadRequest(ApiResponse<object>.Fail(
                    "Seuls les fichiers PDF, JPEG ou PNG sont acceptés pour cet import."));

            using var buffer = new MemoryStream();
            stream.Position = 0;
            await stream.CopyToAsync(buffer, cancellationToken);
            buffer.Position = 0;

            var command = new ImportPurchaseReceiptFromDocumentCommand(
                buffer, validation.SafeFileName!, file.ContentType ?? string.Empty);
            var result = await _handler.HandleAsync(command, cancellationToken);

            return result.IsSuccess
                ? Ok(ApiResponse<PurchaseReceiptImportProposalDto>.Ok(result.Value))
                : BadRequest(ApiResponse<object>.Fail(result.Error.Description));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (OllamaRequestException ex)
        {
            _logger.LogWarning("Import de document de bon de réception : erreur Ollama. Status={Status}", ex.HttpStatusCode);
            return BadRequest(ApiResponse<object>.Fail(ex.UserMessage));
        }
        catch (OpenAiCompatibleRequestException ex)
        {
            _logger.LogWarning("Import de document de bon de réception : erreur fournisseur cloud. Status={Status}", ex.HttpStatusCode);
            return BadRequest(ApiResponse<object>.Fail(ex.UserMessage));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Import de document de bon de réception : erreur inattendue.");
            var message = _environment.IsDevelopment()
                ? ex.Message
                : "Une erreur inattendue s'est produite pendant l'analyse du document. "
                  + "Réessayez ou saisissez le bon de réception manuellement.";
            return BadRequest(ApiResponse<object>.Fail(message));
        }
    }
}
