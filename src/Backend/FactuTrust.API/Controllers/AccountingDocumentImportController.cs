using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.AI;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Import d'une facture (vente ou achat) depuis la saisie manuelle d'écritures : détection des
/// zones de la pièce puis proposition de l'écriture selon le plan comptable tunisien.
///
/// Cet endpoint est en LECTURE SEULE : il propose, il n'enregistre rien. L'écriture est ensuite
/// créée par le chemin existant <c>POST /api/accounting/journal</c>, inchangé.
/// </summary>
[ApiController]
[Route("api/accounting/document-import")]
[Authorize(Policy = PermissionPolicies.AccountingCreate)]
public sealed class AccountingDocumentImportController : ControllerBase
{
    /// <summary>Taille maximale du fichier importé (10 Mo), alignée sur /api/ai/invoice-import.</summary>
    public const long ImportMaxBytes = 10 * 1024 * 1024;

    private readonly IAccountingDocumentExtractor _extractor;
    private readonly IAccountingEntryProposalService _proposalService;
    private readonly IAiOcrService _ocr;
    private readonly IOllamaModelReadinessChecker _readinessChecker;
    private readonly ICurrentUser _currentUser;
    private readonly IImportAiModelResolutionService _importModelResolver;
    private readonly AccountingSettings _accountingSettings;
    private readonly OllamaSettings _ollamaSettings;
    private readonly ILogger<AccountingDocumentImportController> _logger;
    private readonly IHostEnvironment _environment;

    public AccountingDocumentImportController(
        IAccountingDocumentExtractor extractor,
        IAccountingEntryProposalService proposalService,
        IAiOcrService ocr,
        IOllamaModelReadinessChecker readinessChecker,
        IImportAiModelResolutionService importModelResolver,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> accountingSettings,
        IOptions<OllamaSettings> ollamaSettings,
        ILogger<AccountingDocumentImportController> logger,
        IHostEnvironment environment)
    {
        _extractor = extractor;
        _proposalService = proposalService;
        _ocr = ocr;
        _readinessChecker = readinessChecker;
        _importModelResolver = importModelResolver;
        _currentUser = currentUser;
        _accountingSettings = accountingSettings.Value;
        _ollamaSettings = ollamaSettings.Value;
        _logger = logger;
        _environment = environment;
    }

    /// <summary>Capacités d'import (OCR, modèles configurés) pour diagnostic support.</summary>
    [HttpGet("capabilities")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetCapabilities(CancellationToken cancellationToken)
    {
        if (!_accountingSettings.DocumentImportEnabled)
            return NotFound();

        var resolution = await _importModelResolver.ResolveAsync(null, cancellationToken);
        var vision = await _importModelResolver.ResolveEffectiveVisionModelIdAsync(null, forBankStatement: false, cancellationToken);
        var visionModelReady = false;
        if (!string.IsNullOrWhiteSpace(vision))
        {
            var readiness = await _readinessChecker.CheckAsync(vision, cancellationToken);
            visionModelReady = readiness.IsReady;
        }

        return Ok(new
        {
            enabled = true,
            // Le parseur natif fonctionne sans IA ni OCR : il lit la couche texte des factures
            // émises par InstaFact.
            nativeParserEnabled = true,
            aiFallbackAvailable = CanUseAi(),
            ocrAvailable = _ocr.IsAvailable,
            importModel = resolution.Model.ProviderModelId ?? resolution.Model.CanonicalModelRef,
            effectiveImportModelSource = resolution.Source.ToString(),
            visionCapable = resolution.IsVisionCapable,
            visionModel = vision,
            visionModelReady
        });
    }

    /// <summary>
    /// Analyse une pièce et renvoie la proposition d'écriture correspondante. Aucune donnée n'est
    /// écrite : l'utilisateur relit, corrige puis enregistre depuis la saisie manuelle.
    /// </summary>
    /// <param name="direction">
    /// "SALE" ou "PURCHASE" pour forcer le sens lorsque l'utilisateur corrige la détection
    /// automatique, sans avoir à re-téléverser le fichier.
    /// </param>
    [HttpPost("propose")]
    [EnableRateLimiting("ai")]
    [RequestSizeLimit(ImportMaxBytes + 256_000)]
    [ProducesResponseType(typeof(ApiResponse<JournalEntryProposalDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Propose(
        IFormFile file,
        [FromQuery] string? direction = null,
        CancellationToken cancellationToken = default)
    {
        if (!_accountingSettings.DocumentImportEnabled)
            return NotFound();

        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<object>.Fail("Fichier requis."));

        if (file.Length > ImportMaxBytes)
            return BadRequest(ApiResponse<object>.Fail("Fichier trop volumineux (maximum 10 Mo)."));

        var normalizedDirection = NormalizeDirection(direction);
        if (direction is not null && normalizedDirection is null)
            return BadRequest(ApiResponse<object>.Fail("Le sens doit valoir « SALE » ou « PURCHASE »."));

        try
        {
            await using var stream = file.OpenReadStream();

            var extraction = await _extractor.ExtractAsync(
                new AccountingDocumentExtractionRequest
                {
                    FileStream = stream,
                    FileName = file.FileName,
                    ContentType = file.ContentType ?? string.Empty,
                    ModelOverride = null,
                    AllowAiFallback = CanUseAi()
                },
                cancellationToken);

            if (extraction.IsFailure)
                return BadRequest(ApiResponse<object>.Fail(extraction.Error.Description));

            var proposal = await _proposalService.ProposeAsync(
                extraction.Value, normalizedDirection, cancellationToken);

            return proposal.IsSuccess
                ? Ok(ApiResponse<JournalEntryProposalDto>.Ok(proposal.Value))
                : BadRequest(ApiResponse<object>.Fail(proposal.Error.Description));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (OllamaRequestException ex)
        {
            _logger.LogWarning("Import pièce comptable : erreur Ollama. Status={Status} Detail={Detail}",
                ex.HttpStatusCode, ex.Message);
            return BadRequest(ApiResponse<object>.Fail(ex.UserMessage));
        }
        catch (OpenAiCompatibleRequestException ex)
        {
            _logger.LogWarning("Import pièce comptable : erreur fournisseur cloud. Status={Status}", ex.HttpStatusCode);
            return BadRequest(ApiResponse<object>.Fail(ex.UserMessage));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Import pièce comptable : erreur inattendue.");
            var message = _environment.IsDevelopment()
                ? ex.Message
                : "Une erreur inattendue s'est produite pendant l'analyse de la pièce. "
                  + "Réessayez ou saisissez l'écriture manuellement.";
            return BadRequest(ApiResponse<object>.Fail(message));
        }
    }

    /// <summary>
    /// Le repli IA consomme le quota de l'assistant : il exige la permission correspondante.
    /// Sans elle, seul le parseur natif est tenté — il n'appelle aucun modèle.
    /// </summary>
    private bool CanUseAi() => _currentUser.HasPermission(Permissions.AI.Chat);

    private static string? NormalizeDirection(string? direction)
    {
        if (string.IsNullOrWhiteSpace(direction))
            return null;

        var value = direction.Trim().ToUpperInvariant();
        return value is DocumentDirections.Sale or DocumentDirections.Purchase ? value : null;
    }
}
