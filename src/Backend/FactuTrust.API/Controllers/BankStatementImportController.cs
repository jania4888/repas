using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.BankStatementImport;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers;

/// <summary>
/// Import IA d'un relevé bancaire vers le journal de banque (saisie manuelle › Import ›
/// « Importer un relevé bancaire »).
///
/// <para>
/// Sous <c>/api/accounting</c> : chemin déjà ouvert en écriture aux cabinets en mode délégué.
/// Permissions existantes uniquement (aucune nouvelle) : lecture = <c>accounting:read</c>,
/// analyse/confirmation = <c>accounting:create</c>, lecture IA des pages scannées = <c>ai:chat</c>.
/// Aucun paramètre de modèle n'est accepté du client.
/// </para>
/// </summary>
[ApiController]
[Route("api/accounting/bank-statement-import")]
[Authorize]
public sealed class BankStatementImportController : ControllerBase
{
    private readonly IBankStatementImportService _service;
    private readonly IBankStatementPostingService _posting;
    private readonly IBankStatementAiExtraction _ai;
    private readonly BankStatementProfileRegistry _profiles;
    private readonly ICurrentUser _currentUser;
    private readonly AccountingSettings _settings;

    public BankStatementImportController(
        IBankStatementImportService service,
        IBankStatementPostingService posting,
        IBankStatementAiExtraction ai,
        BankStatementProfileRegistry profiles,
        ICurrentUser currentUser,
        IOptions<AccountingSettings> settings)
    {
        _service = service;
        _posting = posting;
        _ai = ai;
        _profiles = profiles;
        _currentUser = currentUser;
        _settings = settings.Value;
    }

    /// <summary>Capacités : activation, IA disponible (et de quel type), limites, banques reconnues.</summary>
    [HttpGet("capabilities")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetCapabilities(CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();

        var canUseAi = _currentUser.HasPermission(Permissions.AI.Chat);
        var ai = canUseAi ? await _ai.CheckAvailabilityAsync(cancellationToken) : null;
        return Ok(ApiResponse<object>.Ok(new
        {
            enabled = true,
            aiAvailable = ai?.Available == true,
            aiProviderKind = ai?.Available == true ? ai.ProviderKind : null,
            maxFileBytes = _settings.BankStatementImport.MaxFileBytes,
            maxPages = _settings.BankStatementImport.MaxPages,
            acceptedExtensions = new[] { ".pdf", ".png", ".jpg", ".jpeg", ".webp" },
            recognizedBanks = _profiles.Profiles
                .Where(p => p.Id != BankStatementProfileRegistry.GenericProfileId && p.BankName is not null)
                .Select(p => p.BankName)
                .ToArray()
        }));
    }

    /// <summary>
    /// Analyse un relevé : lecture déterministe immédiate ; pages scannées confiées à l'IA en tâche
    /// de fond (statut « Extracting », à suivre par GET sessions/{id}). Rien n'est comptabilisé.
    /// </summary>
    [HttpPost("sessions")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    [EnableRateLimiting("ai")]
    [RequestSizeLimit(10 * 1024 * 1024 + 256_000)]
    public async Task<IActionResult> Start(
        IFormFile? file,
        [FromForm] Guid bankAccountId,
        [FromForm] string? journalCode,
        CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();
        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<object>.FailWithCode("Fichier requis.", BankStatementImportErrorCodes.FileRequired));

        await using var stream = file.OpenReadStream();
        var result = await _service.StartAsync(new StartBankStatementImportRequest
        {
            Content = stream,
            FileName = file.FileName,
            ContentType = file.ContentType ?? string.Empty,
            Length = file.Length,
            BankAccountId = bankAccountId,
            JournalCode = string.IsNullOrWhiteSpace(journalCode) ? "JB" : journalCode,
            AllowAi = _currentUser.HasPermission(Permissions.AI.Chat)
        }, cancellationToken);

        return result.IsSuccess
            ? Ok(ApiResponse<BankStatementImportSessionDto>.Ok(result.Value))
            : Failure(result.Error);
    }

    [HttpGet("sessions/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> Get(Guid id, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();
        var result = await _service.GetAsync(id, cancellationToken);
        return result.IsSuccess
            ? Ok(ApiResponse<BankStatementImportSessionDto>.Ok(result.Value))
            : Failure(result.Error);
    }

    [HttpDelete("sessions/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> Cancel(Guid id, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();
        var result = await _service.CancelAsync(id, cancellationToken);
        return result.IsSuccess ? Ok(ApiResponse<object>.Ok(new { cancelled = true })) : Failure(result.Error);
    }

    /// <summary>Enregistre le relevé relu (contrôle de soldes exact obligatoire, recalculé côté serveur).</summary>
    [HttpPost("sessions/{id:guid}/confirm")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> Confirm(Guid id, [FromBody] ConfirmBankStatementImportRequest? request, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();
        var result = await _service.ConfirmAsync(id, request ?? new ConfirmBankStatementImportRequest(), cancellationToken);
        return result.IsSuccess
            ? Ok(ApiResponse<ConfirmBankStatementImportResult>.Ok(result.Value))
            : Failure(result.Error);
    }

    /// <summary>Propositions de comptabilisation ligne par ligne (lecture seule).</summary>
    [HttpGet("statements/{statementId:guid}/proposals")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetProposals(Guid statementId, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();
        var result = await _posting.GetProposalsAsync(statementId, cancellationToken);
        return result.IsSuccess ? Ok(ApiResponse<BankStatementProposalsDto>.Ok(result.Value)) : Failure(result.Error);
    }

    /// <summary>Pièce justificative : fichier d'origine d'un relevé enregistré par ce parcours (jamais servi statiquement).</summary>
    [HttpGet("statements/{statementId:guid}/source-file")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetSourceFile(Guid statementId, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();
        var result = await _service.GetSourceFileAsync(statementId, cancellationToken);
        if (!result.IsSuccess)
            return Failure(result.Error);
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(result.Value.Content, result.Value.ContentType, result.Value.FileName);
    }

    /// <summary>Classe par l'IA un lot de libellés distincts encore inconnus (rappeler tant qu'il en reste).</summary>
    [HttpPost("statements/{statementId:guid}/ai-classify")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    [EnableRateLimiting("ai")]
    public async Task<IActionResult> ClassifyWithAi(Guid statementId, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();
        if (!_currentUser.HasPermission(Permissions.AI.Chat))
            return StatusCode(StatusCodes.Status403Forbidden,
                ApiResponse<object>.FailWithCode("La classification par l'IA n'est pas autorisée pour cet utilisateur.", BankStatementPostingErrorCodes.AiUnavailable));
        var result = await _posting.ClassifyWithAiAsync(statementId, cancellationToken);
        return result.IsSuccess ? Ok(ApiResponse<BankStatementAiClassificationResult>.Ok(result.Value)) : Failure(result.Error);
    }

    /// <summary>
    /// Génère les écritures demandées, en brouillard, une par ligne de relevé. Montants, dates et
    /// sens relus en base ; seuls le compte, le tiers, la TVA et le libellé viennent de la requête.
    /// </summary>
    [HttpPost("statements/{statementId:guid}/generate")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> Generate(Guid statementId, [FromBody] GenerateBankStatementEntriesRequest request, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();
        var result = await _posting.GenerateAsync(statementId, request ?? new GenerateBankStatementEntriesRequest(), cancellationToken);
        return result.IsSuccess ? Ok(ApiResponse<GenerateBankStatementEntriesResult>.Ok(result.Value)) : Failure(result.Error);
    }

    private IActionResult Failure(Error error)
    {
        var body = ApiResponse<object>.FailWithCode(error.Description, error.Code);
        return error.Code switch
        {
            BankStatementImportErrorCodes.Disabled => NotFound(),
            BankStatementImportErrorCodes.SessionNotFound or BankStatementImportErrorCodes.BankAccountNotFound
                or BankStatementImportErrorCodes.SourceFileNotFound
                or BankStatementPostingErrorCodes.StatementNotFound => NotFound(body),
            BankStatementImportErrorCodes.AlreadyImported or BankStatementImportErrorCodes.AnalysisInProgress => Conflict(body),
            _ when error.Code.StartsWith("Forbidden", StringComparison.OrdinalIgnoreCase) => StatusCode(StatusCodes.Status403Forbidden, body),
            _ => BadRequest(body)
        };
    }
}
