using System.Text.Json;
using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Studio.Ai;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Studio.Systems;

/// <summary>
/// Résultat de l'export d'un système Studio (PR 3.3, tranche 3.3c1) : métadonnées + spec ré-importable
/// (<see cref="StudioSystemSpecExporter"/>). Aucun identifiant interne ne sort.
/// </summary>
public sealed record StudioSystemExportDto(
    int SpecVersion,
    string SystemKey,
    string SystemDisplayName,
    DateTime ExportedAt,
    int EntityCount,
    int RelationCount,
    int ViewCount,
    bool IncludesSeed,
    IReadOnlyList<string> Warnings,
    JsonObject Spec);

// ---- Export ----

public sealed record ExportCustomSystemQuery(string Key, bool IncludeSeed = false) : IRequest<Result<StudioSystemExportDto>>;

/// <summary>
/// Export d'un système Studio du tenant courant. Fail-closed : drapeau <c>EnableStudioSystemExport</c>
/// éteint ⇒ 404 ; permission <c>studio:design_entities</c> exigée côté handler (en plus du contrôleur) ;
/// seed bornée par <c>StudioExportMaxSeedRows</c> clampé dans [0, <see cref="StudioAiSystemSpec.MaxSeedRecords"/>].
/// Lecture seule + audit ; les logs ne contiennent que la clé et des compteurs.
/// </summary>
public sealed class ExportCustomSystemQueryHandler : IRequestHandler<ExportCustomSystemQuery, Result<StudioSystemExportDto>>
{
    private readonly ICustomSystemRepository _systems;
    private readonly ICustomEntityRepository _entities;
    private readonly ICustomFieldRepository _fields;
    private readonly ICustomFormRepository _forms;
    private readonly ICustomReportRepository _reports;
    private readonly ICustomRecordViewRepository _views;
    private readonly ICustomRecordRepository _records;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _audit;
    private readonly OllamaSettings _settings;
    private readonly ILogger<ExportCustomSystemQueryHandler>? _logger;

    public ExportCustomSystemQueryHandler(
        ICustomSystemRepository systems,
        ICustomEntityRepository entities,
        ICustomFieldRepository fields,
        ICustomFormRepository forms,
        ICustomReportRepository reports,
        ICustomRecordViewRepository views,
        ICustomRecordRepository records,
        ICurrentUser currentUser,
        IAuditService audit,
        IOptions<OllamaSettings> settings,
        ILogger<ExportCustomSystemQueryHandler>? logger = null)
    {
        _systems = systems;
        _entities = entities;
        _fields = fields;
        _forms = forms;
        _reports = reports;
        _views = views;
        _records = records;
        _currentUser = currentUser;
        _audit = audit;
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task<Result<StudioSystemExportDto>> Handle(ExportCustomSystemQuery request, CancellationToken cancellationToken)
    {
        if (!_settings.EnableStudioSystemExport)
            return Result.Failure<StudioSystemExportDto>(Error.NotFound("Fonctionnalité non disponible."));

        if (!StudioContext.TryGet(_currentUser, out var tenantId, out _, out var err))
            return Result.Failure<StudioSystemExportDto>(err);

        if (!_currentUser.HasPermission(Permissions.Studio.DesignEntities))
            return Result.Failure<StudioSystemExportDto>(Error.Unauthorized("Permission de conception Studio requise."));

        var key = (request.Key ?? string.Empty).Trim().ToLowerInvariant();
        if (key.Length == 0 || !StudioKey.IsValidShape(key))
            return Result.Failure<StudioSystemExportDto>(Error.Validation("key", "Clé système invalide."));

        var system = await _systems.GetByKeyAsync(tenantId, key, cancellationToken);
        if (system is null || !system.IsActive)
            return Result.Failure<StudioSystemExportDto>(new Error("CustomSystem.NotFound", $"CustomSystem with key '{request.Key}' was not found."));

        // ---- Chargement séquentiel (Standard et Junction : champs ; Standard seulement : formulaire, rapports, vues) ----
        var entities = await _entities.ListBySystemIdAsync(tenantId, system.Id, cancellationToken);

        var fieldsByEntity = new Dictionary<Guid, IReadOnlyList<CustomFieldDefinition>>();
        var formByEntity = new Dictionary<Guid, CustomFormDefinition?>();
        var reportsByEntity = new Dictionary<Guid, IReadOnlyList<CustomReportDefinition>>();
        var viewsByEntity = new Dictionary<Guid, IReadOnlyList<CustomRecordViewDefinition>>();

        foreach (var entity in entities.Where(e => e.IsActive))
        {
            fieldsByEntity[entity.Id] = await _fields.ListByEntityAsync(tenantId, entity.Id, includeInactive: false, cancellationToken);
            if (entity.Kind != CustomEntityKind.Standard) continue;

            formByEntity[entity.Id] = await _forms.GetDefaultByEntityAsync(tenantId, entity.Id, cancellationToken);

            var reports = await _reports.ListAsync(tenantId, entity.Key, cancellationToken);
            reportsByEntity[entity.Id] = reports.Where(r => r.DataSourceKind == CustomReportDataSourceKind.CustomEntity).ToList();

            viewsByEntity[entity.Id] = await _views.ListByEntityAsync(tenantId, entity.Id, false, cancellationToken);
        }

        // ---- Seed (optionnelle, bornée) ----
        var maxRows = Math.Clamp(_settings.StudioExportMaxSeedRows, 0, StudioAiSystemSpec.MaxSeedRecords);
        Dictionary<Guid, IReadOnlyList<CustomRecord>>? seedByEntity = null;
        if (request.IncludeSeed && maxRows > 0)
        {
            seedByEntity = new Dictionary<Guid, IReadOnlyList<CustomRecord>>();
            foreach (var entity in entities.Where(e => e.IsActive && e.Kind == CustomEntityKind.Standard))
                seedByEntity[entity.Id] = await _records.GetAllForReportAsync(tenantId, entity.Id, maxRows, cancellationToken);
        }

        var exportedAt = DateTime.UtcNow;
        var result = StudioSystemSpecExporter.Export(
            new StudioSystemExportInput(system, entities, fieldsByEntity, formByEntity, reportsByEntity, viewsByEntity, seedByEntity),
            maxRows,
            exportedAt);

        await StudioAudit.SafeLogAsync(_audit, "Studio.System.Exported", "CustomSystem", system.Id,
            null, new { systemKey = system.Key, includeSeed = request.IncludeSeed, entityCount = result.EntityCount }, cancellationToken);

        _logger?.LogInformation(
            "Studio export {SystemKey}: {EntityCount} tables, {RelationCount} relations, seed={IncludesSeed}",
            system.Key, result.EntityCount, result.RelationCount, result.IncludesSeed);

        return Result.Success(new StudioSystemExportDto(
            StudioSystemSpecExporter.SpecVersion,
            system.Key,
            system.DisplayName,
            exportedAt,
            result.EntityCount,
            result.RelationCount,
            result.ViewCount,
            result.IncludesSeed,
            result.Warnings,
            result.Spec));
    }
}

// ---- Duplication « (copie) » + Import (tranche 3.3c2) ----

/// <summary>Duplication d'un système du tenant : export sans seed → plan <c>CreateSystem</c> Pending.</summary>
public sealed record DuplicateCustomSystemCommand(string Key, string? DisplayNameOverride = null)
    : IRequest<Result<StudioAiPlanCreationResponse>>;

/// <summary>Corps optionnel de <c>POST api/studio/systems/{key}/duplicate</c> (tranche 3.3d).</summary>
public sealed record DuplicateCustomSystemRequest(string? DisplayName);

/// <summary>
/// Corps de <c>POST api/studio/systems/import</c>. <c>Spec</c> accepte un objet JSON ou une chaîne JSON
/// (tolérance client).
/// </summary>
public sealed record ImportCustomSystemRequest(JsonNode? Spec, string? DisplayNameOverride = null, bool IncludeSeed = true);

public sealed record ImportCustomSystemCommand(ImportCustomSystemRequest Request)
    : IRequest<Result<StudioAiPlanCreationResponse>>;

/// <summary>Nom par défaut d'une copie : « &lt;DisplayName&gt; (copie) », borné à 128 caractères.</summary>
internal static class StudioSystemCopyNaming
{
    public const string CopySuffix = " (copie)";

    /// <summary>« &lt;DisplayName&gt; (copie) », nom source tronqué pour rester ≤ <see cref="StudioAiPlanCreation.MaxDisplayNameOverrideLength"/>.</summary>
    public static string CopyName(string displayName)
    {
        var name = (displayName ?? string.Empty).Trim();
        var maxBase = StudioAiPlanCreation.MaxDisplayNameOverrideLength - CopySuffix.Length;
        if (name.Length > maxBase)
        {
            // Ne jamais couper une paire de substitution (emoji) : un demi-surrogate isolé deviendrait U+FFFD.
            if (char.IsHighSurrogate(name[maxBase - 1])) maxBase--;
            name = name[..maxBase].TrimEnd();
        }
        return name + CopySuffix;
    }
}

/// <summary>
/// Chemin commun duplication/import : gardes (deux drapeaux ⇒ 404, tenant, permission), override de nom,
/// doublons, canonisation, délégation à <c>CreateStudioAiPlanCommand</c>. Aucune écriture hors le plan Pending.
/// Jamais le chemin « from-spec » (D-c2-3) ; jamais le contenu de la spec dans une erreur ou un log.
/// </summary>
internal static class StudioSystemPlanning
{
    public static Result<StudioAiPlanCreationResponse>? Guard(OllamaSettings settings, ICurrentUser currentUser)
    {
        if (!(settings.EnableStudioSystemExport && settings.EnableStudioAiPlanPreview))
            return Result.Failure<StudioAiPlanCreationResponse>(Error.NotFound("Fonctionnalité non disponible."));

        if (!StudioContext.TryGet(currentUser, out _, out _, out var err))
            return Result.Failure<StudioAiPlanCreationResponse>(err);

        if (!currentUser.HasPermission(Permissions.Studio.DesignEntities))
            return Result.Failure<StudioAiPlanCreationResponse>(Error.Unauthorized("Permission de conception Studio requise."));

        return null;
    }

    /// <summary>
    /// Résout le nom affiché (override trimé sinon <paramref name="defaultName"/>), détecte les doublons,
    /// canonise et crée le plan Pending.
    /// </summary>
    public static async Task<Result<StudioAiPlanCreationResponse>> PlanFromParsedSpecAsync(
        ParsedSystemSpec parsed,
        string? displayNameOverride,
        string defaultName,
        IMediator mediator,
        ICurrentUser currentUser,
        ICustomEntityRepository? customEntities,
        CancellationToken ct)
    {
        var hasOverride = !string.IsNullOrWhiteSpace(displayNameOverride);
        var displayName = hasOverride ? displayNameOverride!.Trim() : defaultName.Trim();
        if (displayName.Length > StudioAiPlanCreation.MaxDisplayNameOverrideLength)
            return Result.Failure<StudioAiPlanCreationResponse>(hasOverride
                ? Error.Validation("displayNameOverride", "Le nom affiché dépasse 128 caractères.")
                : Error.Validation("spec", "system.displayName dépasse 128 caractères."));
        // La clé système est re-slugifiée à l'exécution depuis displayName (UniqueSystemKeyAsync) : aucune clé ici.
        parsed = parsed with { SystemDisplayName = displayName };

        // Indices de doublons contre les tables actives du tenant (UNE lecture, jamais d'écriture).
        var duplicates = await StudioAiPlanCreation.DetectDuplicatesAsync(parsed, customEntities, currentUser, ct);

        var canonical = StudioAiSpecCanonical.CanonicalSystem(parsed);
        var summary = StudioAiPlanSummary.ForSystem(parsed, duplicates);

        // Même délégation que from-template : permission et audit « Studio.AiPlan.Created » inclus.
        var created = await mediator.Send(new CreateStudioAiPlanCommand(StudioAiPlanKind.CreateSystem, canonical, summary), ct);
        if (created.IsFailure)
            return Result.Failure<StudioAiPlanCreationResponse>(created.Error);

        return Result.Success(new StudioAiPlanCreationResponse(
            created.Value, StudioAiPlanCreation.ToFreshSpecDto(created.Value, canonical)));
    }
}

/// <summary>
/// Duplique un système du tenant en plan <c>CreateSystem</c> Pending (nom « … (copie) » par défaut).
/// Fail-closed : <c>EnableStudioSystemExport</c> ET <c>EnableStudioAiPlanPreview</c> requis ⇒ sinon 404.
/// </summary>
public sealed class DuplicateCustomSystemCommandHandler
    : IRequestHandler<DuplicateCustomSystemCommand, Result<StudioAiPlanCreationResponse>>
{
    private readonly IMediator _mediator;
    private readonly ICurrentUser _currentUser;
    private readonly OllamaSettings _settings;
    private readonly IAuditService _audit;
    private readonly ICustomEntityRepository? _customEntities;
    private readonly ILogger<DuplicateCustomSystemCommandHandler>? _logger;

    public DuplicateCustomSystemCommandHandler(
        IMediator mediator,
        ICurrentUser currentUser,
        IOptions<OllamaSettings> settings,
        IAuditService audit,
        ICustomEntityRepository? customEntities = null,
        ILogger<DuplicateCustomSystemCommandHandler>? logger = null)
    {
        _mediator = mediator;
        _currentUser = currentUser;
        _settings = settings.Value;
        _audit = audit;
        _customEntities = customEntities;
        _logger = logger;
    }

    public async Task<Result<StudioAiPlanCreationResponse>> Handle(DuplicateCustomSystemCommand request, CancellationToken cancellationToken)
    {
        if (StudioSystemPlanning.Guard(_settings, _currentUser) is { } guard)
            return guard;

        // Export sans seed ; l'échec (404 CustomSystem.NotFound, clé invalide…) est propagé tel quel.
        var export = await _mediator.Send(new ExportCustomSystemQuery(request.Key, IncludeSeed: false), cancellationToken);
        if (export.IsFailure)
            return Result.Failure<StudioAiPlanCreationResponse>(export.Error);

        var specJson = export.Value.Spec.ToJsonString();
        if (!StudioAiSystemSpec.TryParse(specJson, out var parsed, out var parseError) || parsed is null)
            return Result.Failure<StudioAiPlanCreationResponse>(
                Error.Validation("spec", parseError ?? "Le système exporté ne peut pas être ré-importé."));

        // Les avertissements d'export (relations hors système, formules → texte) remontent dans l'aperçu du plan.
        parsed = parsed with { Warnings = (parsed.Warnings ?? Array.Empty<string>()).Concat(export.Value.Warnings).ToList() };

        var result = await StudioSystemPlanning.PlanFromParsedSpecAsync(
            parsed, request.DisplayNameOverride, StudioSystemCopyNaming.CopyName(export.Value.SystemDisplayName),
            _mediator, _currentUser, _customEntities, cancellationToken);
        if (result.IsFailure)
            return result;

        await StudioAudit.SafeLogAsync(_audit, "Studio.System.DuplicateRequested", "CustomSystem", null,
            null, new { sourceKey = export.Value.SystemKey, planId = result.Value.Plan.Id }, cancellationToken);

        _logger?.LogInformation("Studio duplicate {SourceKey}: plan {PlanId} created", export.Value.SystemKey, result.Value.Plan.Id);

        return result;
    }
}

/// <summary>
/// Importe une spec système (export d'un autre tenant, fichier édité…) en plan <c>CreateSystem</c> Pending.
/// Fail-closed (deux drapeaux), taille ≤ <see cref="StudioAiPlanWorkbench.MaxSpecJsonLength"/>, nom ≤ 128.
/// </summary>
public sealed class ImportCustomSystemCommandHandler
    : IRequestHandler<ImportCustomSystemCommand, Result<StudioAiPlanCreationResponse>>
{
    private readonly IMediator _mediator;
    private readonly ICurrentUser _currentUser;
    private readonly OllamaSettings _settings;
    private readonly IAuditService _audit;
    private readonly ICustomEntityRepository? _customEntities;
    private readonly ILogger<ImportCustomSystemCommandHandler>? _logger;

    public ImportCustomSystemCommandHandler(
        IMediator mediator,
        ICurrentUser currentUser,
        IOptions<OllamaSettings> settings,
        IAuditService audit,
        ICustomEntityRepository? customEntities = null,
        ILogger<ImportCustomSystemCommandHandler>? logger = null)
    {
        _mediator = mediator;
        _currentUser = currentUser;
        _settings = settings.Value;
        _audit = audit;
        _customEntities = customEntities;
        _logger = logger;
    }

    public async Task<Result<StudioAiPlanCreationResponse>> Handle(ImportCustomSystemCommand request, CancellationToken cancellationToken)
    {
        if (StudioSystemPlanning.Guard(_settings, _currentUser) is { } guard)
            return guard;

        var body = request.Request;
        if (body.Spec is null)
            return Result.Failure<StudioAiPlanCreationResponse>(Error.Validation("spec", "La spécification est vide."));

        // Normalisation : chaîne JSON tolérée ⇒ re-parsée ; le résultat doit être un objet.
        JsonNode? node = body.Spec;
        if (node is JsonValue value && value.TryGetValue<string>(out var raw))
        {
            // Borne mesurée sur la chaîne brute avant tout parse (défense en profondeur, comme from-spec).
            if (raw.Length > StudioAiPlanWorkbench.MaxSpecJsonLength)
                return Result.Failure<StudioAiPlanCreationResponse>(Error.Validation("spec", "La spec dépasse 256 Ko."));
            try { node = JsonNode.Parse(raw); }
            catch (JsonException)
            {
                return Result.Failure<StudioAiPlanCreationResponse>(Error.Validation("spec", "La spécification n'est pas un JSON valide."));
            }
        }
        if (node is not JsonObject obj)
            return Result.Failure<StudioAiPlanCreationResponse>(Error.Validation("spec", "La spécification doit être un objet JSON."));

        var specJson = obj.ToJsonString();
        if (specJson.Length > StudioAiPlanWorkbench.MaxSpecJsonLength)
            return Result.Failure<StudioAiPlanCreationResponse>(Error.Validation("spec", "La spec dépasse 256 Ko."));

        if (!body.IncludeSeed && obj.ContainsKey("seed"))
        {
            // Copie : la requête appelante n'est pas mutée.
            obj = obj.DeepClone().AsObject();
            obj.Remove("seed");
            specJson = obj.ToJsonString();
        }

        if (!StudioAiSystemSpec.TryParse(specJson, out var parsed, out var parseError) || parsed is null)
            return Result.Failure<StudioAiPlanCreationResponse>(
                Error.Validation("spec", parseError ?? "La spécification est invalide."));

        var result = await StudioSystemPlanning.PlanFromParsedSpecAsync(
            parsed, body.DisplayNameOverride, parsed.SystemDisplayName,
            _mediator, _currentUser, _customEntities, cancellationToken);
        if (result.IsFailure)
            return result;

        // TryParse n'accepte que « specVersion » absent ou égal à SupportedSpecVersion : la valeur auditée est donc celle-ci.
        await StudioAudit.SafeLogAsync(_audit, "Studio.System.ImportRequested", "CustomSystem", null,
            null, new { specVersion = StudioAiSystemSpec.SupportedSpecVersion, entityCount = parsed.Entities.Count, includeSeed = body.IncludeSeed, planId = result.Value.Plan.Id }, cancellationToken);

        _logger?.LogInformation("Studio import: {EntityCount} tables, plan {PlanId} created", parsed.Entities.Count, result.Value.Plan.Id);

        return result;
    }
}
