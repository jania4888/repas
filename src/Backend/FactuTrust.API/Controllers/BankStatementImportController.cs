using System.Text.Json;
using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.MultiTenancy;
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
    /// <summary>Options de désérialisation du mappage CSV/XLSX (champ formulaire JSON, camelCase côté client).</summary>
    private static readonly JsonSerializerOptions MappingJsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IBankStatementImportService _service;
    private readonly IBankStatementTabularImportService _tabular;
    private readonly IBankStatementPostingService _posting;
    private readonly IBankStatementAiExtraction _ai;
    private readonly BankStatementProfileRegistry _profiles;
    private readonly ICurrentUser _currentUser;
    private readonly ITenantContext _tenantContext;
    private readonly AccountingSettings _settings;

    public BankStatementImportController(
        IBankStatementImportService service,
        IBankStatementTabularImportService tabular,
        IBankStatementPostingService posting,
        IBankStatementAiExtraction ai,
        BankStatementProfileRegistry profiles,
        ICurrentUser currentUser,
        ITenantContext tenantContext,
        IOptions<AccountingSettings> settings)
    {
        _service = service;
        _tabular = tabular;
        _posting = posting;
        _ai = ai;
        _profiles = profiles;
        _currentUser = currentUser;
        _tenantContext = tenantContext;
        _settings = settings.Value;
    }

    /// <summary>
    /// Capacités : activation, IA disponible (et de quel type), limites, banques reconnues.
    /// Fonctionnalité éteinte : 200 avec <c>enabled=false</c> (les autres actions restent en 404).
    /// <paramref name="includeAi"/> = false : pas de sonde du moteur IA (écrans qui ne lisent que <c>enabled</c>).
    /// </summary>
    [HttpGet("capabilities")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetCapabilities([FromQuery] bool includeAi = true, CancellationToken cancellationToken = default)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return Ok(ApiResponse<BankStatementImportCapabilitiesDto>.Ok(BankStatementImportCapabilitiesDto.Disabled));

        var canUseAi = includeAi && _currentUser.HasPermission(Permissions.AI.Chat);
        var ai = canUseAi ? await _ai.CheckAvailabilityAsync(cancellationToken) : null;
        var tabularEnabled = _settings.TabularImportEffective;
        return Ok(ApiResponse<BankStatementImportCapabilitiesDto>.Ok(new BankStatementImportCapabilitiesDto(
            Enabled: true,
            AiAvailable: ai?.Available == true,
            AiProviderKind: ai?.Available == true ? ai.ProviderKind : null,
            MaxFileBytes: _settings.BankStatementImport.MaxFileBytes,
            MaxPages: _settings.BankStatementImport.EffectiveMaxPages,
            AcceptedExtensions: new[] { ".pdf", ".png", ".jpg", ".jpeg", ".webp" },
            RecognizedBanks: _profiles.Profiles
                .Where(p => p.Id != BankStatementProfileRegistry.GenericProfileId && p.BankName is not null)
                .Select(p => p.BankName!)
                .Distinct(StringComparer.Ordinal)
                .ToArray())
        {
            AllDocumentsViaAi = _settings.IsAiForAllDocumentsEnabledFor(_tenantContext.TenantId),
            AiEngine = ai?.Available == true ? ai.Engine : null,
            AiUnavailableReason = canUseAi && ai?.Available != true
                ? ai?.ReasonCode ?? BankStatementAiAvailabilityReasons.EngineUnavailable
                : null,
            VisionUnavailableReason = ai?.Available == true ? ai.VisionUnavailableReason : null,
            TabularEnabled = tabularEnabled,
            TabularExtensions = tabularEnabled ? new[] { ".csv", ".xlsx" } : Array.Empty<string>(),
            MaxTabularRows = _settings.BankStatementImport.MaxTabularRows,
            MaxAtomicLines = _settings.BankStatementImport.MaxAtomicGenerationLines,
            SuspenseAccountNumber = await _service.GetSuspenseAccountNumberAsync(cancellationToken)
        }));
    }

    [HttpPost("sessions/{id:guid}/retarget")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    [EnableRateLimiting("ai")]
    public async Task<IActionResult> Retarget(Guid id, [FromBody] RetargetBankStatementImportRequest request, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();
        var result = await _service.RetargetAsync(id, request.BankAccountId, cancellationToken);
        return result.IsSuccess
            ? Ok(ApiResponse<BankStatementImportSessionDto>.Ok(result.Value))
            : Failure(result.Error);
    }

    /// <summary>
    /// Relance la lecture d'une session dont l'IA était indisponible, interrompue ou en échec (D3) :
    /// même fichier, même compte, nouvelle session ; la session d'origine est annulée seulement si la
    /// relance est acceptée. Aucun paramètre : le modèle n'est jamais choisi par le client.
    /// </summary>
    [HttpPost("sessions/{id:guid}/retry")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    [EnableRateLimiting("ai")]
    public async Task<IActionResult> Retry(Guid id, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();
        var result = await _service.RetryAsync(id, cancellationToken);
        return result.IsSuccess
            ? Ok(ApiResponse<BankStatementImportSessionDto>.Ok(result.Value))
            : Failure(result.Error);
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

    /// <summary>
    /// Aperçu sans état d'un fichier CSV/XLSX : format/encodage/délimiteur détectés, mappage proposé
    /// (ou mémorisé pour <paramref name="bankAccountId"/>), 20 premières lignes, signalements. Aucune
    /// session n'est ouverte, aucun fichier n'est écrit sur le serveur.
    /// </summary>
    [HttpPost("tabular/preview")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    [EnableRateLimiting("accounting-suggestions")]
    [RequestSizeLimit(10 * 1024 * 1024 + 256_000)]
    public async Task<IActionResult> PreviewTabular(
        IFormFile? file,
        [FromForm] string? mapping,
        [FromForm] Guid? bankAccountId,
        CancellationToken cancellationToken)
    {
        if (!_settings.TabularImportEffective)
            return NotFound();
        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<object>.FailWithCode("Fichier requis.", BankStatementImportErrorCodes.FileRequired));

        var mappingDto = TryParseMapping(mapping);
        if (mapping is not null && mappingDto is null)
            return BadRequest(ApiResponse<object>.FailWithCode("Mappage illisible.", BankStatementTabularErrorCodes.TabularMappingInvalid));

        await using var stream = file.OpenReadStream();
        var result = await _tabular.PreviewAsync(new BankStatementTabularPreviewRequest
        {
            Content = stream,
            FileName = file.FileName,
            Length = file.Length,
            Mapping = mappingDto,
            BankAccountId = bankAccountId
        }, cancellationToken);

        return result.IsSuccess
            ? Ok(ApiResponse<BankStatementTabularPreviewDto>.Ok(result.Value))
            : Failure(result.Error);
    }

    /// <summary>
    /// Ouvre une session CSV/XLSX avec le mappage final de colonnes de l'utilisateur. Même cycle de
    /// vie que <see cref="Start"/> (session en <c>AwaitingReview</c>, correction puis confirmation).
    /// </summary>
    [HttpPost("sessions/tabular")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    [EnableRateLimiting("accounting-bulk")]
    [RequestSizeLimit(10 * 1024 * 1024 + 256_000)]
    public async Task<IActionResult> StartTabular(
        IFormFile? file,
        [FromForm] Guid bankAccountId,
        [FromForm] string? journalCode,
        [FromForm] string? mapping,
        CancellationToken cancellationToken)
    {
        if (!_settings.TabularImportEffective)
            return NotFound();
        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<object>.FailWithCode("Fichier requis.", BankStatementImportErrorCodes.FileRequired));

        var mappingDto = TryParseMapping(mapping);
        if (mappingDto is null)
            return BadRequest(ApiResponse<object>.FailWithCode("Mappage requis ou illisible.", BankStatementTabularErrorCodes.TabularMappingInvalid));

        await using var stream = file.OpenReadStream();
        var result = await _tabular.StartAsync(new StartBankStatementImportRequest
        {
            Content = stream,
            FileName = file.FileName,
            ContentType = file.ContentType ?? string.Empty,
            Length = file.Length,
            BankAccountId = bankAccountId,
            JournalCode = string.IsNullOrWhiteSpace(journalCode) ? "JB" : journalCode
        }, mappingDto, cancellationToken);

        return result.IsSuccess
            ? Ok(ApiResponse<BankStatementImportSessionDto>.Ok(result.Value))
            : Failure(result.Error);
    }

    private static BankStatementTabularMappingDto? TryParseMapping(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;
        try
        {
            return JsonSerializer.Deserialize<BankStatementTabularMappingDto>(json, MappingJsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
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

    /// <summary>Propositions de comptabilisation ligne par ligne (lecture seule). <c>assist=full</c> : historique du dossier + repli 471.</summary>
    [HttpGet("statements/{statementId:guid}/proposals")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetProposals(Guid statementId, [FromQuery] string? assist, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();
        var options = string.Equals(assist, "full", StringComparison.OrdinalIgnoreCase) ? BankProposalOptions.Full : BankProposalOptions.None;
        var result = await _posting.GetProposalsAsync(statementId, options, cancellationToken);
        return result.IsSuccess ? Ok(ApiResponse<BankStatementProposalsDto>.Ok(result.Value)) : Failure(result.Error);
    }

    /// <summary>Historique paginé des relevés importés par ce parcours (plan §3.8).</summary>
    [HttpGet("statements")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetHistory(
        [FromQuery] int page, [FromQuery] int pageSize, [FromQuery] Guid? bankAccountId, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return NotFound();
        var result = await _posting.GetHistoryAsync(page, pageSize, bankAccountId, cancellationToken);
        return result.IsSuccess
            ? Ok(ApiResponse<PagedResult<BankStatementImportHistoryItemDto>>.Ok(result.Value))
            : Failure(result.Error);
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
        if (error.Metadata is { Count: > 0 } metadata && metadata.TryGetValue("data", out var data))
            body = body with { Data = data };

        return error.Code switch
        {
            BankStatementImportErrorCodes.Disabled or BankStatementTabularErrorCodes.TabularDisabled => NotFound(),
            BankStatementImportErrorCodes.SessionNotFound or BankStatementImportErrorCodes.BankAccountNotFound
                or BankStatementImportErrorCodes.SourceFileNotFound
                or BankStatementPostingErrorCodes.StatementNotFound => NotFound(body),
            BankStatementImportErrorCodes.AlreadyImported or BankStatementImportErrorCodes.AnalysisInProgress
                or BankStatementPostingErrorCodes.AtomicConflict => Conflict(body),
            _ when error.Code.StartsWith("Forbidden", StringComparison.OrdinalIgnoreCase) => StatusCode(StatusCodes.Status403Forbidden, body),
            _ => BadRequest(body)
        };
    }
}
