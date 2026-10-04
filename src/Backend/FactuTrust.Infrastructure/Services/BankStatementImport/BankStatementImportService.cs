using System.Security.Cryptography;
using System.Text.Json;
using FactuTrust.Application.Common.Files;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Banking;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>
/// Analyse et enregistrement d'un relevé bancaire importé pour comptabilisation assistée.
///
/// <para>
/// Le chemin historique du rapprochement (<c>BankReconciliationService.ImportStatementAsync</c>)
/// n'est pas utilisé ni modifié : il refuse les soldes débiteurs (<c>Money.Create</c>) et ne
/// contrôle pas la complétude. Ici, l'enregistrement n'a lieu que si le contrôle de soldes est
/// exact, et les soldes sont stockés signés.
/// </para>
/// Journaux : compteurs, identifiants et RIB masqué seulement — jamais de libellé ni de nom.
/// </summary>
public sealed class BankStatementImportService : IBankStatementImportService
{
    internal static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.General);

    private const string DefaultBankJournalCode = BankJournalRules.DefaultBankJournalCode;
    private const int PurgeBatchSize = 50;

    private readonly ITenantDbContextFactory _contextFactory;
    private readonly ITenantContext _tenantContext;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _audit;
    private readonly IBankStatementAiExtraction _ai;
    private readonly BankStatementFileStore _files;
    private readonly BankStatementLayoutExtractor _extractor;
    private readonly AccountingSettings _settings;
    private readonly TimeProvider _time;
    private readonly ILogger<BankStatementImportService> _logger;

    public BankStatementImportService(
        ITenantDbContextFactory contextFactory,
        ITenantContext tenantContext,
        ICurrentUser currentUser,
        IAuditService audit,
        IBankStatementAiExtraction ai,
        BankStatementFileStore files,
        BankStatementLayoutExtractor extractor,
        IOptions<AccountingSettings> settings,
        ILogger<BankStatementImportService> logger,
        TimeProvider? time = null)
    {
        _contextFactory = contextFactory;
        _tenantContext = tenantContext;
        _currentUser = currentUser;
        _audit = audit;
        _ai = ai;
        _files = files;
        _extractor = extractor;
        _settings = settings.Value;
        _logger = logger;
        _time = time ?? TimeProvider.System;
    }

    private BankStatementImportLimits Limits => _settings.BankStatementImport;

    private Guid? CurrentTenantId => _tenantContext.TenantId ?? _currentUser.TenantId;

    /// <summary>Drapeau D4 effectif pour le dossier courant : écart de solde en avertissement quand tout a été lu par l'IA.</summary>
    private bool AiBalanceMismatchAsWarning => _settings.IsAiBalanceMismatchAsWarningFor(CurrentTenantId);

    /// <summary>Origine d'une relance (D3), consignée dans l'audit <c>BankStatementAnalyzed</c> de la nouvelle session.</summary>
    private sealed record RelaunchOrigin(Guid PreviousSessionId, bool Retarget, bool Retry);

    // ── Analyse ─────────────────────────────────────────────────────────────────────────────

    public Task<Result<BankStatementImportSessionDto>> StartAsync(StartBankStatementImportRequest request, CancellationToken cancellationToken = default) =>
        StartCoreAsync(request, relaunch: null, cancellationToken);

    private async Task<Result<BankStatementImportSessionDto>> StartCoreAsync(
        StartBankStatementImportRequest request, RelaunchOrigin? relaunch, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.Disabled, "L'import de relevés bancaires n'est pas activé.");

        var tenantId = CurrentTenantId;
        if (tenantId is null)
            return Result.Failure<BankStatementImportSessionDto>(Error.Forbidden("Dossier introuvable."));

        // 1. Fichier : taille, extension autorisée, signature binaire (pas de confiance dans l'en-tête HTTP).
        if (request.Length <= 0)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.FileRequired, "Fichier requis.");
        if (request.Length > Limits.MaxFileBytes)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.FileTooLarge,
                $"Fichier trop volumineux (maximum {Limits.MaxFileBytes / (1024 * 1024)} Mo).");

        var extension = Path.GetExtension(request.FileName ?? string.Empty).ToLowerInvariant();
        if (!BankStatementFileStore.IsAllowedExtension(extension))
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.FileRejected,
                "Format non accepté : PDF ou image (PNG, JPEG, WEBP) uniquement.");

        var content = await ReadBoundedAsync(request.Content, Limits.MaxFileBytes, cancellationToken);
        if (content is null)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.FileTooLarge,
                $"Fichier trop volumineux (maximum {Limits.MaxFileBytes / (1024 * 1024)} Mo).");

        var header = content.AsMemory(0, Math.Min(UploadValidator.RequiredHeaderBytes, content.Length));
        var validation = UploadValidator.Validate(request.FileName ?? string.Empty, request.ContentType ?? string.Empty,
            content.Length, header, Limits.MaxFileBytes);
        if (!validation.IsValid)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.FileRejected, validation.ErrorMessage ?? "Fichier refusé.");

        if (extension is not ".pdf" &&
            BankStatementImageMegapixelGuard.ExceedsMegapixelLimit(content, Limits.EffectiveMaxImageMegapixels))
        {
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.FileRejected,
                "Image trop grande pour l'analyse (résolution maximale dépassée).");
        }

        await using var ctx = _contextFactory.CreateContext();

        // 2. Compte bancaire et journal.
        var account = await ctx.BankAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == request.BankAccountId, cancellationToken);
        var accountCheck = CheckBankAccount(account);
        if (accountCheck is not null)
            return Result.Failure<BankStatementImportSessionDto>(accountCheck);

        var journalCode = (string.IsNullOrWhiteSpace(request.JournalCode) ? DefaultBankJournalCode : request.JournalCode).Trim().ToUpperInvariant();
        if (!await BankJournalRules.IsBankJournalAsync(ctx, journalCode, cancellationToken))
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.JournalInvalid,
                $"Le journal « {journalCode} » n'est pas un journal de banque actif.");

        // 3. Même fichier déjà enregistré pour ce compte ? Même analyse déjà ouverte ?
        var hash = Convert.ToHexString(SHA256.HashData(content));
        var now = _time.GetUtcNow().UtcDateTime;
        if (await ctx.BankStatements.AsNoTracking().AnyAsync(s => s.BankAccountId == account!.Id && s.SourceFileHash == hash, cancellationToken))
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.AlreadyImported, "Ce relevé a déjà été importé pour ce compte bancaire.");

        var open = await ctx.BankStatementImportSessions.AsNoTracking()
            .Where(s => s.BankAccountId == account!.Id && s.FileHash == hash && s.ExpiresAt > now
                        && (s.Status == BankStatementImportSessionStatus.AwaitingReview || s.Status == BankStatementImportSessionStatus.Extracting))
            .OrderByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (open is not null)
            return Result.Success(Project(open));

        await PurgeExpiredAsync(ctx, now, cancellationToken);

        // 4. Lecture déterministe (rapide, même pour 20 pages) ; les pages scannées iront à l'IA.
        //    Un fichier qui assemble plusieurs relevés (ex. deux mois) donne une session par relevé.
        var extractions = extension == ".pdf"
            ? _extractor.ExtractAll(content)
            : new[] { ImageOnlyExtraction() };
        if (extractions.Count > 1)
        {
            return await StartSeveralAsync(ctx, account!, journalCode, hash, content, extension,
                validation.SafeFileName ?? "releve" + extension, request.ContentType ?? string.Empty,
                extractions, tenantId.Value, now, request.AllowAi, relaunch, cancellationToken);
        }

        var (extraction, needsAi, ai) = await ApplyAiReadingPlanAsync(
            extractions[0], account!, tenantId.Value, request.AllowAi, content, extension, cancellationToken);
        var plan = extraction.AiPlan;

        if (needsAi && ai is { Available: true } && await IsAiReadingInProgressAsync(ctx, now, plan is not null, cancellationToken))
        {
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.AnalysisInProgress,
                "Une autre lecture IA de relevé est en cours pour ce dossier : réessayez dans quelques minutes.");
        }

        // 5. Session + fichier.
        var session = BankStatementImportSession.Create(account!.Id, journalCode, validation.SafeFileName ?? "releve" + extension, hash,
            content.Length, request.ContentType ?? string.Empty, now.AddHours(Math.Max(1, Limits.SessionRetentionHours)));
        session.SetAuditInfo(UserLabel, false);

        try
        {
            session.AttachFile(await _files.SaveSessionFileAsync(tenantId.Value, session.Id, extension, content, cancellationToken));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            _logger.LogError(ex, "Import relevé : stockage du fichier impossible (session {SessionId}).", session.Id);
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.Storage, "Le fichier n'a pas pu être enregistré sur le serveur.");
        }

        var json = JsonSerializer.Serialize(extraction, JsonOptions);
        var aiScheduled = needsAi && ai is { Available: true };
        if (aiScheduled)
            session.StartAiExtraction(ai!.ProviderKind ?? "local", json, extraction.ProfileId, extraction.PageCount);
        else
            session.CompleteExtraction(json, ExtractionMethodWithoutAi(plan, extension), extraction.ProfileId, extraction.PageCount);

        ctx.BankStatementImportSessions.Add(session);
        await ctx.SaveChangesAsync(cancellationToken);

        if (aiScheduled)
            _ai.Schedule(tenantId.Value, session.Id);

        var auditValues = AnalyzedAuditValues(session, extraction, plan, aiScheduled ? ai : null, ai, relaunch);
        auditValues["UnresolvedPages"] = extraction.UnresolvedPages.Count;
        if (plan is not null && aiScheduled)
            auditValues["AiModel"] = plan.Engine == BankStatementAiEngines.Vision ? ai!.VisionModelRef ?? ai.ModelRef : ai!.ModelRef;
        await _audit.LogAsync(AuditActions.Accounting.BankStatementAnalyzed, nameof(BankStatementImportSession), session.Id,
            newValues: auditValues,
            cancellationToken: cancellationToken);

        _logger.LogInformation(
            "Import relevé : session {SessionId}, profil {Profile}, {Pages} page(s), {Lines} ligne(s), {Unresolved} page(s) pour l'IA, moteur {Engine}, RIB …{Rib}.",
            session.Id, extraction.ProfileId, extraction.PageCount, extraction.Lines.Count, extraction.UnresolvedPages.Count,
            aiScheduled ? plan?.Engine ?? ai!.Engine ?? "text" : "aucun",
            MaskRib(extraction.Header.Rib));

        return Result.Success(Project(session));
    }

    /// <summary>
    /// Méthode d'extraction d'une session terminée sans tâche IA : en mode « IA seule », aucune ligne
    /// n'a été lue (<c>none</c>) ; sinon valeur historique (<c>layout</c> pour un PDF, <c>ai</c> pour une image).
    /// </summary>
    private static string ExtractionMethodWithoutAi(BankStatementAiPlan? plan, string extension) =>
        plan is { IsAiOnly: true }
            ? BankStatementImportExtractionMethods.None
            : extension == ".pdf" ? BankStatementImportExtractionMethods.Layout : BankStatementImportExtractionMethods.Ai;

    /// <summary>
    /// Valeurs communes de l'audit <c>BankStatementAnalyzed</c> : compteurs, plan de lecture, moteur,
    /// cause d'indisponibilité et origine d'une relance (D3). Jamais de libellé ni de RIB en clair.
    /// </summary>
    private static Dictionary<string, object?> AnalyzedAuditValues(
        BankStatementImportSession session,
        ExtractedBankStatement extraction,
        BankStatementAiPlan? plan,
        BankStatementAiAvailability? scheduledAi,
        BankStatementAiAvailability? checkedAi,
        RelaunchOrigin? relaunch)
    {
        var values = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["BankAccountId"] = session.BankAccountId,
            ["JournalCode"] = session.JournalCode,
            ["ProfileId"] = extraction.ProfileId,
            ["PageCount"] = extraction.PageCount,
            ["LineCount"] = extraction.Lines.Count,
            ["Blocking"] = extraction.Issues.Count(i => i.Severity == StatementIssueSeverity.Blocking),
            ["AiProvider"] = scheduledAi?.ProviderKind
        };

        if (plan is not null)
        {
            values["AiMode"] = plan.Mode ?? BankStatementAiReadingModes.Complement;
            values["AiEngine"] = scheduledAi is null ? null : plan.Engine ?? scheduledAi.Engine;
            values["AiScannedPages"] = plan.ScannedPages.Count;
            values["AiTextPages"] = plan.TextPages.Count;
            values["AiCalls"] = plan.EstimatedCalls;
            values["AiReason"] = plan.Reason;
        }

        if (checkedAi is { Available: false })
            values["AiUnavailableReason"] = checkedAi.ReasonCode ?? checkedAi.Reason;
        else if (checkedAi is { VisionUnavailableReason: not null })
            values["VisionUnavailableReason"] = checkedAi.VisionUnavailableReason;

        if (relaunch is not null)
        {
            values["Retarget"] = relaunch.Retarget;
            values["Retry"] = relaunch.Retry;
            values["PreviousSessionId"] = relaunch.PreviousSessionId;
        }

        return values;
    }

    public async Task<Result<BankStatementImportSessionDto>> GetAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.Disabled, "L'import de relevés bancaires n'est pas activé.");

        await using var ctx = _contextFactory.CreateContext();
        var session = await ctx.BankStatementImportSessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sessionId, cancellationToken);
        return session is null
            ? Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.SessionNotFound, "Analyse de relevé introuvable.")
            : Result.Success(await WithSiblingsAsync(ctx, session, cancellationToken));
    }

    /// <summary>
    /// Fichier à plusieurs relevés : une session par relevé (empreinte dérivée, cf.
    /// <see cref="StatementSegmentFingerprint"/>), chacune contrôlée et confirmée séparément. Les relevés
    /// déjà importés ou déjà en cours d'analyse sont repris tels quels. Pas de lecture IA dans ce cas :
    /// un relevé scanné d'un tel fichier est signalé, à importer seul.
    /// </summary>
    private async Task<Result<BankStatementImportSessionDto>> StartSeveralAsync(
        TenantDbContext ctx,
        BankAccount account,
        string journalCode,
        string fileHash,
        byte[] content,
        string extension,
        string safeFileName,
        string contentType,
        IReadOnlyList<ExtractedBankStatement> extractions,
        Guid tenantId,
        DateTime now,
        bool allowAi,
        RelaunchOrigin? relaunch,
        CancellationToken cancellationToken)
    {
        var count = extractions.Count;
        var prefix = StatementSegmentFingerprint.GroupPrefix(fileHash);
        var imported = await ctx.BankStatements.AsNoTracking()
            .Where(s => s.BankAccountId == account.Id && s.SourceFileHash != null && s.SourceFileHash.StartsWith(prefix))
            .Select(s => s.SourceFileHash!)
            .ToListAsync(cancellationToken);
        var open = await ctx.BankStatementImportSessions.AsNoTracking()
            .Where(s => s.BankAccountId == account.Id && s.FileHash.StartsWith(prefix) && s.ExpiresAt > now
                        && (s.Status == BankStatementImportSessionStatus.AwaitingReview || s.Status == BankStatementImportSessionStatus.Extracting))
            .ToListAsync(cancellationToken);

        var segments = new List<(int Index, ExtractedBankStatement Extraction, bool NeedsAi, BankStatementAiAvailability? Ai)>();
        for (var i = 0; i < count; i++)
        {
            var fingerprint = StatementSegmentFingerprint.Create(fileHash, i + 1, count);
            if (imported.Contains(fingerprint) || open.Any(s => s.FileHash == fingerprint))
                continue;

            var prepared = await ApplyAiReadingPlanAsync(extractions[i], account, tenantId, allowAi, content, extension, cancellationToken);
            segments.Add((i, prepared.Extraction, prepared.NeedsAi, prepared.Ai));
        }

        if (segments.Any(s => s.NeedsAi && s.Ai is { Available: true })
            && await IsAiReadingInProgressAsync(ctx, now, segments.Any(s => s.Extraction.AiPlan is not null), cancellationToken))
        {
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.AnalysisInProgress,
                "Une autre lecture IA de relevé est en cours pour ce dossier : réessayez dans quelques minutes.");
        }

        var created = new List<BankStatementImportSession>();
        var aiSessionIds = new List<Guid>();
        foreach (var (index, extraction, needsAi, ai) in segments)
        {
            var fingerprint = StatementSegmentFingerprint.Create(fileHash, index + 1, count);
            var session = BankStatementImportSession.Create(account.Id, journalCode, safeFileName, fingerprint,
                content.Length, contentType, now.AddHours(Math.Max(1, Limits.SessionRetentionHours)));
            session.SetAuditInfo(UserLabel, false);
            try
            {
                session.AttachFile(await _files.SaveSessionFileAsync(tenantId, session.Id, extension, content, cancellationToken));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
            {
                _logger.LogError(ex, "Import relevé : stockage du fichier impossible (session {SessionId}).", session.Id);
                foreach (var done in created)
                    _files.TryDelete(done.StoragePath);
                return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.Storage, "Le fichier n'a pas pu être enregistré sur le serveur.");
            }

            var json = JsonSerializer.Serialize(extraction, JsonOptions);
            var aiScheduled = needsAi && ai is { Available: true };
            if (aiScheduled)
                session.StartAiExtraction(ai!.ProviderKind ?? "local", json, extraction.ProfileId, extraction.PageCount);
            else
                session.CompleteExtraction(json, ExtractionMethodWithoutAi(extraction.AiPlan, extension), extraction.ProfileId, extraction.PageCount);

            ctx.BankStatementImportSessions.Add(session);
            created.Add(session);
            if (aiScheduled)
                aiSessionIds.Add(session.Id);
        }

        if (created.Count == 0 && open.Count == 0)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.AlreadyImported,
                "Les relevés de ce fichier ont déjà été importés pour ce compte bancaire.");

        if (created.Count > 0)
            await ctx.SaveChangesAsync(cancellationToken);

        if (aiSessionIds.Count == 1)
            _ai.Schedule(tenantId, aiSessionIds[0]);
        else if (aiSessionIds.Count > 1)
            _ai.ScheduleMany(tenantId, aiSessionIds);

        foreach (var (index, extraction, _, ai) in segments)
        {
            var fingerprint = StatementSegmentFingerprint.Create(fileHash, index + 1, count);
            var session = created.FirstOrDefault(s => s.FileHash == fingerprint);
            if (session is null)
                continue;
            var aiScheduled = session.Status == BankStatementImportSessionStatus.Extracting;
            var auditValues = AnalyzedAuditValues(session, extraction, extraction.AiPlan, aiScheduled ? ai : null, ai, relaunch);
            auditValues["Segment"] = session.FileHash[^5..];
            await _audit.LogAsync(AuditActions.Accounting.BankStatementAnalyzed, nameof(BankStatementImportSession), session.Id,
                newValues: auditValues,
                cancellationToken: cancellationToken);
        }

        _logger.LogInformation(
            "Import relevé : fichier de {Count} relevés, {Created} session(s) ouverte(s), {Reused} reprise(s), {Imported} déjà importé(s).",
            count, created.Count, open.Count, imported.Count);

        var first = created.Concat(open)
            .OrderBy(s => StatementSegmentFingerprint.TryParse(s.FileHash, out _, out var index, out _) ? index : int.MaxValue)
            .First();
        return Result.Success(await WithSiblingsAsync(ctx, first, cancellationToken));
    }

    /// <summary>Projection d'une session et, si elle provient d'un fichier à plusieurs relevés, de ses sœurs.</summary>
    private async Task<BankStatementImportSessionDto> WithSiblingsAsync(TenantDbContext ctx, BankStatementImportSession session, CancellationToken cancellationToken)
    {
        var dto = Project(session);
        if (!StatementSegmentFingerprint.TryParse(session.FileHash, out var prefix, out _, out _))
            return dto;

        var siblings = await ctx.BankStatementImportSessions.AsNoTracking()
            .Where(s => s.BankAccountId == session.BankAccountId && s.FileHash.StartsWith(prefix) && s.Id != session.Id
                        && s.Status != BankStatementImportSessionStatus.Cancelled)
            .ToListAsync(cancellationToken);

        return dto with
        {
            Siblings = siblings
                .Select(s =>
                {
                    StatementSegmentFingerprint.TryParse(s.FileHash, out _, out var index, out _);
                    var header = s.ResultJson is null ? null : Deserialize(s.ResultJson)?.Header;
                    return new BankStatementImportSiblingDto(s.Id, index, header?.PeriodStart, header?.PeriodEnd, s.Status.ToString(), s.StatementId);
                })
                .GroupBy(s => s.SegmentIndex)
                .Select(g => g.First())
                .OrderBy(s => s.SegmentIndex)
                .ToList()
        };
    }

    public async Task<Result> CancelAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return Result.Failure(new Error(BankStatementImportErrorCodes.Disabled, "L'import de relevés bancaires n'est pas activé."));

        await using var ctx = _contextFactory.CreateContext();
        var session = await ctx.BankStatementImportSessions.FirstOrDefaultAsync(s => s.Id == sessionId, cancellationToken);
        if (session is null)
            return Result.Failure(new Error(BankStatementImportErrorCodes.SessionNotFound, "Analyse de relevé introuvable."));
        if (session.Status == BankStatementImportSessionStatus.Confirmed)
            return Result.Failure(new Error(BankStatementImportErrorCodes.SessionNotReviewable, "Ce relevé est déjà enregistré."));

        _files.TryDelete(session.StoragePath);
        session.ForgetFile();
        session.Cancel();
        session.SetAuditInfo(UserLabel, true);
        await ctx.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    public Task<Result<BankStatementImportSessionDto>> RetargetAsync(
        Guid sessionId, Guid bankAccountId, CancellationToken cancellationToken = default) =>
        RelaunchAsync(sessionId, bankAccountId, cancellationToken);

    public Task<Result<BankStatementImportSessionDto>> RetryAsync(Guid sessionId, CancellationToken cancellationToken = default) =>
        RelaunchAsync(sessionId, targetBankAccountId: null, cancellationToken);

    /// <summary>
    /// Relance (D3) : même fichier, nouvelle session, même compte (<c>retry</c>) ou autre compte
    /// (<c>retarget</c>). Toutes les vérifications — statut, compte, lecture IA déjà en cours — précèdent
    /// l'annulation de la session d'origine : un refus la laisse intacte.
    /// </summary>
    private async Task<Result<BankStatementImportSessionDto>> RelaunchAsync(
        Guid sessionId, Guid? targetBankAccountId, CancellationToken cancellationToken)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.Disabled, "L'import de relevés bancaires n'est pas activé.");

        var retry = targetBankAccountId is null;
        await using var ctx = _contextFactory.CreateContext();
        var session = await ctx.BankStatementImportSessions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == sessionId, cancellationToken);
        if (session is null || string.IsNullOrEmpty(session.StoragePath))
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.SessionNotFound, "Analyse de relevé introuvable.");

        if (session.Status is not (BankStatementImportSessionStatus.AwaitingReview or BankStatementImportSessionStatus.Failed))
        {
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.SessionNotReviewable,
                "Seule une analyse terminée (en attente de relecture ou en échec) peut être relancée.");
        }

        if (retry && !IsRelaunchable(session))
        {
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.SessionNotReviewable,
                "Cette analyse ne peut pas être relancée : seule une lecture IA indisponible, interrompue ou en échec se relance.");
        }

        var bankAccountId = targetBankAccountId ?? session.BankAccountId;
        if (!retry)
        {
            if (bankAccountId == session.BankAccountId)
            {
                return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.SameBankAccount,
                    "Le relevé est déjà analysé pour ce compte bancaire : choisissez un autre compte.");
            }

            var target = await ctx.BankAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == bankAccountId, cancellationToken);
            var accountCheck = CheckBankAccount(target);
            if (accountCheck is not null)
                return Result.Failure<BankStatementImportSessionDto>(accountCheck);
        }

        // Une seule lecture IA à la fois : le refus (409) précède l'annulation de la session d'origine.
        var now = _time.GetUtcNow().UtcDateTime;
        if (await IsAiReadingInProgressAsync(ctx, now, _settings.IsAiForAllDocumentsEnabledFor(CurrentTenantId), cancellationToken))
        {
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.AnalysisInProgress,
                "Une autre lecture IA de relevé est en cours pour ce dossier : réessayez dans quelques minutes.");
        }

        byte[]? content;
        try
        {
            content = await _files.ReadAsync(session.StoragePath, cancellationToken);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "Import relevé : fichier de la session {SessionId} illisible pour la relance.", session.Id);
            content = null;
        }

        if (content is null)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.Storage, "Le fichier du relevé est introuvable.");

        var cancelled = await CancelAsync(sessionId, cancellationToken);
        if (cancelled.IsFailure)
            return Result.Failure<BankStatementImportSessionDto>(cancelled.Error);

        await using var stream = new MemoryStream(content);
        return await StartCoreAsync(new StartBankStatementImportRequest
        {
            Content = stream,
            FileName = session.FileName,
            ContentType = session.ContentType,
            Length = content.Length,
            BankAccountId = bankAccountId,
            JournalCode = session.JournalCode,
            AllowAi = _currentUser.HasPermission(Permissions.AI.Chat)
        }, new RelaunchOrigin(session.Id, Retarget: !retry, Retry: retry), cancellationToken);
    }

    /// <summary>
    /// Une session se relance (D3) si la lecture IA n'a pas pu avoir lieu : en attente de relecture
    /// avec un blocage <c>statement.ai_unavailable</c>, ou en échec pour une cause IA
    /// (<see cref="BankStatementImportSessionErrorCodes.Relaunchable"/>).
    /// </summary>
    private static bool IsRelaunchable(BankStatementImportSession session)
    {
        if (session.Status == BankStatementImportSessionStatus.Failed)
            return session.ErrorCode is { } code && BankStatementImportSessionErrorCodes.Relaunchable.Contains(code);

        if (session.Status != BankStatementImportSessionStatus.AwaitingReview || session.ResultJson is null)
            return false;

        var extraction = Deserialize(session.ResultJson);
        return extraction is not null
               && extraction.Issues.Any(i => i.Code == StatementIssueCodes.AiUnavailable && i.Severity == StatementIssueSeverity.Blocking);
    }

    // ── Confirmation ────────────────────────────────────────────────────────────────────────

    public async Task<Result<ConfirmBankStatementImportResult>> ConfirmAsync(
        Guid sessionId, ConfirmBankStatementImportRequest request, CancellationToken cancellationToken = default)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return Fail<ConfirmBankStatementImportResult>(BankStatementImportErrorCodes.Disabled, "L'import de relevés bancaires n'est pas activé.");

        var tenantId = _tenantContext.TenantId ?? _currentUser.TenantId;
        if (tenantId is null)
            return Result.Failure<ConfirmBankStatementImportResult>(Error.Forbidden("Dossier introuvable."));

        await using var ctx = _contextFactory.CreateContext();
        var session = await ctx.BankStatementImportSessions.FirstOrDefaultAsync(s => s.Id == sessionId, cancellationToken);
        if (session is null)
            return Fail<ConfirmBankStatementImportResult>(BankStatementImportErrorCodes.SessionNotFound, "Analyse de relevé introuvable.");
        if (session.Status != BankStatementImportSessionStatus.AwaitingReview || session.ResultJson is null)
            return Fail<ConfirmBankStatementImportResult>(BankStatementImportErrorCodes.SessionNotReviewable,
                "Cette analyse n'est pas (ou plus) en attente de relecture.");

        var extraction = Deserialize(session.ResultJson);
        if (extraction is null)
            return Fail<ConfirmBankStatementImportResult>(BankStatementImportErrorCodes.SessionNotReviewable, "Résultat d'analyse illisible : relancez l'import.");

        // Corrections : seulement sur des lignes lues par OCR / IA, auditées une à une ; une ligne
        // exclue est retirée du relevé (ses signalements avec elle), les autres sont renumérotées.
        var correctedLines = 0;
        var excludedLines = 0;
        if (request.Corrections.Count > 0)
        {
            var corrected = ApplyCorrections(extraction, request.Corrections, out var correctionError, out var trail);
            if (correctionError is not null)
                return Result.Failure<ConfirmBankStatementImportResult>(correctionError);
            foreach (var (before, after) in trail)
            {
                await _audit.LogAsync(AuditActions.Accounting.BankStatementExtractionCorrected, nameof(BankStatementImportSession), session.Id,
                    oldValues: before,
                    newValues: after,
                    cancellationToken: cancellationToken);
            }

            excludedLines = request.Corrections.Count(c => c.Exclude);
            correctedLines = request.Corrections.Count - excludedLines;
            extraction = corrected!;
            session.ReplaceResult(JsonSerializer.Serialize(extraction, JsonOptions));
        }

        // Contrôle recalculé côté serveur : jamais d'enregistrement d'un relevé incomplet. En mode
        // « IA seule » (D4), un écart de solde est un avertissement qui exige l'accusé explicite.
        var aiBalanceMismatchAsWarning = AiBalanceMismatchAsWarning;
        extraction = BankStatementBalanceCheck.Reevaluate(extraction, aiBalanceMismatchAsWarning);
        var blocking = extraction.Issues.Where(i => i.Severity == StatementIssueSeverity.Blocking).ToList();
        if (blocking.Count > 0)
        {
            return Fail<ConfirmBankStatementImportResult>(BankStatementImportErrorCodes.BlockingIssues,
                "Le relevé ne peut pas être enregistré : " + string.Join(" ", blocking.Take(3).Select(i => i.Message)));
        }

        if (extraction.Lines.Count == 0)
        {
            return Fail<ConfirmBankStatementImportResult>(BankStatementImportErrorCodes.BlockingIssues,
                "Le relevé ne peut pas être enregistré : aucune opération lue.");
        }

        if (extraction.Header.OpeningBalance is null && extraction.Header.ClosingBalance is null)
        {
            return Fail<ConfirmBankStatementImportResult>(BankStatementImportErrorCodes.BlockingIssues,
                "Le relevé ne peut pas être enregistré : ni le solde initial ni le solde final n'ont été lus. Relancez l'analyse ou saisissez le relevé manuellement.");
        }

        var balanceWarning = BankStatementBalanceCheck.HasBalanceWarning(extraction);
        if (balanceWarning && !request.AcknowledgeBalanceWarning)
        {
            return Fail<ConfirmBankStatementImportResult>(BankStatementImportErrorCodes.BalanceWarningNotAcknowledged,
                "Le relevé ne boucle pas au millime : confirmez explicitement l'import en l'état.");
        }

        var account = await ctx.BankAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == session.BankAccountId, cancellationToken);
        var accountCheck = CheckBankAccount(account);
        if (accountCheck is not null)
            return Result.Failure<ConfirmBankStatementImportResult>(accountCheck);
        if (await ctx.BankStatements.AsNoTracking().AnyAsync(s => s.BankAccountId == account!.Id && s.SourceFileHash == session.FileHash, cancellationToken))
            return Fail<ConfirmBankStatementImportResult>(BankStatementImportErrorCodes.AlreadyImported, "Ce relevé a déjà été importé pour ce compte bancaire.");

        var alreadyImported = await CountAlreadyImportedAsync(ctx, account!.Id, extraction, cancellationToken);

        // Tout document par l'IA : l'ancien assistant refusait un relevé dont TOUTES les opérations
        // étaient déjà importées ; ce garde-fou est repris ici (un relevé déjà saisi par l'ancien
        // chemin n'a pas d'empreinte de fichier à comparer).
        if (_settings.IsAiForAllDocumentsEnabledFor(_tenantContext.TenantId) && extraction.Lines.Count > 0 && alreadyImported >= extraction.Lines.Count)
        {
            return Fail<ConfirmBankStatementImportResult>(BankStatementImportErrorCodes.AlreadyImported,
                "Toutes les opérations de ce relevé figurent déjà dans un relevé importé pour ce compte bancaire.");
        }

        // Traçabilité D4 : l'écart constaté et l'accusé sont conservés avec le relevé (null = non évaluable).
        var balance = BankStatementBalanceCheck.Evaluate(extraction.Header, extraction.Lines);
        var statement = BuildStatement(extraction, account!, session);
        statement.RecordBalanceCheck(balance.Difference, balanceWarning && request.AcknowledgeBalanceWarning);
        ctx.BankStatements.Add(statement);

        session.Confirm(statement.Id);
        session.SetAuditInfo(UserLabel, true);
        await ctx.SaveChangesAsync(cancellationToken);

        // Le fichier devient la pièce justificative du relevé (best-effort : l'enregistrement est fait).
        try
        {
            var moved = _files.MoveToStatement(tenantId.Value, session.StoragePath, statement.Id);
            if (moved is not null)
            {
                session.AttachFile(moved);
                await ctx.SaveChangesAsync(cancellationToken);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException or DbUpdateException)
        {
            _logger.LogWarning(ex, "Import relevé : déplacement du fichier de la session {SessionId} impossible.", session.Id);
        }

        var plan = extraction.AiPlan;
        await _audit.LogAsync(AuditActions.Accounting.BankStatementImported, nameof(BankStatement), statement.Id,
            newValues: new
            {
                statement.BankAccountId,
                LineCount = statement.Lines.Count,
                AlreadyImportedCount = alreadyImported,
                statement.PeriodStart,
                statement.PeriodEnd,
                ImportMethod = statement.ImportMethod.ToString(),
                SessionId = session.Id,
                session.ExtractionMethod,
                BalanceChecked = balance.Difference is not null,
                balance.IsBalanced,
                BalanceDifference = balance.Difference,
                BalanceAcknowledged = statement.BalanceAcknowledged,
                AiEngine = plan?.Engine,
                AiMode = plan?.Mode,
                TextFallbackPages = plan?.FallbackPages.Count ?? 0,
                VisionModel = plan?.PageReadings.Where(r => !r.IsTextFallback && !r.IsFailed).Select(r => r.Model).FirstOrDefault(m => m is not null),
                CorrectedLines = correctedLines,
                ExcludedLines = excludedLines
            },
            cancellationToken: cancellationToken);

        return Result.Success(new ConfirmBankStatementImportResult(statement.Id, statement.Lines.Count, alreadyImported));
    }

    // ── Pièce justificative ─────────────────────────────────────────────────────────────────

    public async Task<Result<BankStatementSourceFile>> GetSourceFileAsync(Guid statementId, CancellationToken cancellationToken = default)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return Fail<BankStatementSourceFile>(BankStatementImportErrorCodes.Disabled, "L'import de relevés bancaires n'est pas activé.");

        await using var ctx = _contextFactory.CreateContext();
        var source = await ctx.BankStatementImportSessions.AsNoTracking()
            .Where(s => s.StatementId == statementId && s.Status == BankStatementImportSessionStatus.Confirmed)
            .Select(s => new { s.StoragePath, s.FileName })
            .FirstOrDefaultAsync(cancellationToken);

        byte[]? content = null;
        if (source?.StoragePath is not null)
        {
            try
            {
                content = await _files.ReadAsync(source.StoragePath, cancellationToken);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
            {
                _logger.LogWarning(ex, "Import relevé : pièce justificative du relevé {StatementId} illisible.", statementId);
            }
        }

        if (content is null)
            return Fail<BankStatementSourceFile>(BankStatementImportErrorCodes.SourceFileNotFound, "Pièce justificative introuvable pour ce relevé.");

        var extension = Path.GetExtension(source!.StoragePath!).ToLowerInvariant();
        return Result.Success(new BankStatementSourceFile(content, SourceContentType(extension), DownloadName(source.FileName, extension)));
    }

    private static string SourceContentType(string extension) => extension switch
    {
        ".pdf" => "application/pdf",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        _ => "application/octet-stream"
    };

    /// <summary>Nom de téléchargement : nom d'origine sans chemin ni caractère interdit, extension du fichier stocké.</summary>
    internal static string DownloadName(string? originalName, string extension)
    {
        // Séparateurs normalisés à la main : sous Linux, Path.GetFileName ignore « \ ».
        var lastSegment = (originalName ?? string.Empty).Replace('\\', '/').Split('/')[^1];
        var stem = Path.GetFileNameWithoutExtension(lastSegment);
        var invalid = Path.GetInvalidFileNameChars();
        var clean = new string(stem.Select(c => invalid.Contains(c) || c is ':' or '"' or '*' or '?' or '<' or '>' or '|' || char.IsControl(c) ? '_' : c).ToArray())
            .Trim(' ', '.');
        if (clean.Length == 0)
            clean = "releve";
        if (clean.Length > 120)
            clean = clean[..120];
        return clean + extension;
    }

    // ── Plan de lecture IA (drapeau « tout document par l'IA ») ──────────────────────────────

    /// <summary>
    /// Ajuste le plan au fournisseur et aux plafonds : avec une IA externe, le texte des pages lisibles
    /// ne part pas sans autorisation explicite (seules les pages scannées, comme avant) ; au-delà de
    /// <see cref="BankStatementImportLimits.MaxAiPages"/> pages scannées ou de
    /// <see cref="BankStatementImportLimits.MaxAiCalls"/> appels, l'IA est déclarée indisponible.
    /// </summary>
    private async Task<(ExtractedBankStatement Extraction, bool NeedsAi, BankStatementAiAvailability? Ai)> ApplyAiReadingPlanAsync(
        ExtractedBankStatement rawExtraction,
        BankAccount account,
        Guid tenantId,
        bool allowAi,
        byte[] content,
        string extension,
        CancellationToken cancellationToken)
    {
        var extraction = AddAccountChecks(rawExtraction, account);

        if (extraction.PageCount > Limits.EffectiveMaxPages && !extraction.Issues.Any(i => i.Code == StatementIssueCodes.TooManyPages))
        {
            extraction = extraction with
            {
                Issues = extraction.Issues.Append(new StatementExtractionIssue(StatementIssueCodes.TooManyPages, StatementIssueSeverity.Blocking,
                    $"Le relevé compte {extraction.PageCount} pages (maximum {Limits.EffectiveMaxPages}).")).ToList()
            };
        }

        // Mode « IA seule » (D1/D3) : toutes les pages vont à l'IA, un RIB différent n'empêche plus la
        // lecture ; mode « complément » : seules les pages non lues avec certitude.
        var aiForAll = _settings.IsAiForAllDocumentsEnabledFor(tenantId);
        var aiOnly = _settings.IsAiOnlyReadingEnabledFor(tenantId);
        var plan = aiOnly
            ? BankStatementAiReadingPlanner.SelectAiOnly(extraction)
            : aiForAll ? BankStatementAiReadingPlanner.Select(extraction) : null;
        if (plan is { IsEmpty: true } && BankStatementAiReadingPlanner.NotFixableBlocker(extraction, plan.Mode) is not null)
        {
            extraction = extraction with
            {
                Issues = extraction.Issues.Append(new StatementExtractionIssue(
                    StatementIssueCodes.AiNotStarted,
                    StatementIssueSeverity.Info,
                    BuildAiNotStartedMessage(extraction, account, ribMismatchKillsPlan: !plan.IsAiOnly))).ToList()
            };
        }

        var needsAi = plan is not null
            ? !plan.IsEmpty
            : extraction.UnresolvedPages.Count > 0 && !extraction.Issues.Any(i => i.Code == StatementIssueCodes.TooManyPages);
        BankStatementAiAvailability? ai = null;
        if (needsAi)
        {
            ai = allowAi
                ? await _ai.CheckAvailabilityAsync(cancellationToken)
                : BankStatementAiAvailability.Unavailable("Lecture IA non autorisée pour cet utilisateur.");

            if (plan is null)
            {
                if (ai.Available && extraction.UnresolvedPages.Count > Limits.MaxAiPages)
                    ai = BankStatementAiAvailability.Unavailable($"Trop de pages scannées ({extraction.UnresolvedPages.Count}, maximum {Limits.MaxAiPages}).");
            }
            else if (plan.IsAiOnly)
            {
                // Pré-vol D2 : moteur choisi et indisponibilité DITE avant tout appel (jamais de repli muet).
                (plan, ai, var preflight) = FitAiOnlyPlan(plan, ai);
                if (preflight.Count > 0)
                    extraction = extraction with { Issues = extraction.Issues.Concat(preflight).ToList() };
                needsAi = ai.Available && !plan.IsEmpty;
            }
            else if (ai.Available)
            {
                (plan, ai, var planIssue) = FitPlan(plan, ai, content, extension);
                if (planIssue is not null)
                    extraction = extraction with { Issues = extraction.Issues.Append(planIssue).ToList() };
                needsAi = !plan.IsEmpty;
            }

            if (!ai.Available && plan is not { IsAiOnly: true })
            {
                var what = plan is { TextPages.Count: > 0 } ? "Relevé non lu avec certitude" : "Pages scannées non lues";
                extraction = extraction with
                {
                    Issues = extraction.Issues.Append(new StatementExtractionIssue(StatementIssueCodes.AiUnavailable, StatementIssueSeverity.Blocking,
                        $"{what} : {ai.Reason}")).ToList()
                };
            }
        }

        if (plan is not null)
            extraction = extraction with { AiPlan = plan };

        return (extraction, needsAi, ai);
    }

    /// <summary>
    /// Pré-vol du mode « IA seule » (D2) : GLM-OCR prêt ⇒ moteur <c>vision</c> ; sinon repli sur le
    /// modèle texte local, annoncé par un avertissement global et un avertissement par page
    /// (<c>statement.ai_text_fallback</c>) ; sans repli possible ⇒ blocage explicite, aucune page envoyée.
    /// IA externe non autorisée et plafond <see cref="BankStatementImportLimits.EffectiveMaxAiPages"/> sont
    /// refusés en amont. Le plan reste décrit (pages, mode) même quand rien n'est lancé.
    /// </summary>
    private (BankStatementAiPlan Plan, BankStatementAiAvailability Ai, IReadOnlyList<StatementExtractionIssue> Issues) FitAiOnlyPlan(
        BankStatementAiPlan plan, BankStatementAiAvailability ai)
    {
        var issues = new List<StatementExtractionIssue>();

        if (!ai.Available)
        {
            issues.Add(Blocking(StatementIssueCodes.AiUnavailable,
                $"Lecture IA impossible : {Trimmed(ai.Reason, "moteur IA indisponible")}. Réessayez plus tard ou contactez l'administrateur."));
            return (plan, ai, issues);
        }

        if (string.Equals(ai.ProviderKind, "external", StringComparison.Ordinal) && !Limits.AiComplementAllowExternal)
        {
            const string reason = "IA externe non autorisée pour les relevés bancaires : le document ne quitte pas la plateforme";
            issues.Add(Blocking(StatementIssueCodes.AiUnavailable, $"Lecture IA impossible : {reason}. Contactez l'administrateur."));
            return (plan, BankStatementAiAvailability.Unavailable(reason, BankStatementAiAvailabilityReasons.ExternalNotAllowed), issues);
        }

        var pages = plan.PlannedPages.Count;
        if (pages > Limits.EffectiveMaxAiPages)
        {
            var reason = $"Trop de pages à lire ({pages}, maximum {Limits.EffectiveMaxAiPages}). Scindez le PDF par relevé ou par mois.";
            issues.Add(Blocking(StatementIssueCodes.AiUnavailable, reason));
            return (plan, BankStatementAiAvailability.Unavailable(reason), issues);
        }

        if (ai.IsVision && Limits.VisionReadingEnabled)
        {
            plan = BankStatementAiReadingPlanner.WithVisionEstimate(plan with { Engine = BankStatementAiEngines.Vision }, Limits.EffectiveVisionEstimatedSecondsPerPage);
            return (plan, ai, issues);
        }

        var cause = Trimmed(ai.VisionUnavailableReason, Limits.VisionReadingEnabled ? "modèle vision non prêt" : "lecture vision désactivée");
        if (Limits.VisionTextFallbackEnabled)
        {
            plan = BankStatementAiReadingPlanner.WithEstimate(plan with { Engine = BankStatementAiEngines.Text }, plan.TextPages.Count, Limits.EffectiveAiEstimatedSecondsPerCall);
            if (Limits.VisionReadingEnabled)
            {
                issues.Add(new StatementExtractionIssue(StatementIssueCodes.AiUnavailable, StatementIssueSeverity.Warning,
                    $"Modèle GLM-OCR indisponible ({cause}) : le relevé est lu par le modèle texte local, moins précis sur les pages scannées."));
                foreach (var page in plan.PlannedPages)
                {
                    issues.Add(new StatementExtractionIssue(StatementIssueCodes.AiTextFallback, StatementIssueSeverity.Warning,
                        $"Page {page} : lue par le modèle texte local (GLM-OCR indisponible).", page));
                }
            }

            return (plan, ai, issues);
        }

        issues.Add(Blocking(StatementIssueCodes.AiUnavailable,
            $"Lecture IA impossible : {cause}. Réessayez plus tard ou contactez l'administrateur."));
        return (plan, BankStatementAiAvailability.Unavailable(cause, BankStatementAiAvailabilityReasons.VisionModelUnavailable), issues);

        static StatementExtractionIssue Blocking(string code, string message) => new(code, StatementIssueSeverity.Blocking, message);

        static string Trimmed(string? reason, string fallback)
        {
            var text = string.IsNullOrWhiteSpace(reason) ? fallback : reason.Trim();
            return text.TrimEnd('.');
        }
    }

    private (BankStatementAiPlan Plan, BankStatementAiAvailability Ai, StatementExtractionIssue? Issue) FitPlan(
        BankStatementAiPlan plan, BankStatementAiAvailability ai, byte[] content, string extension)
    {
        StatementExtractionIssue? issue = null;
        if (plan.TextPages.Count > 0 && string.Equals(ai.ProviderKind, "external", StringComparison.Ordinal) && !Limits.AiComplementAllowExternal)
        {
            issue = new StatementExtractionIssue(StatementIssueCodes.AiUnavailable, StatementIssueSeverity.Blocking,
                "Pages lisibles non relues : la relecture du texte d'un relevé par une IA externe n'est pas autorisée sur cette plateforme.");
            plan = plan with
            {
                TextPages = Array.Empty<int>(),
                Reason = plan.ScannedPages.Count > 0 ? BankStatementAiReadingReasons.Scanned : null
            };
        }

        if (string.Equals(ai.Engine, "vision", StringComparison.Ordinal) && Limits.VisionReadingEnabled)
        {
            plan = plan with { Engine = "vision" };
            plan = BankStatementAiReadingPlanner.WithVisionEstimate(plan, Limits.EffectiveVisionEstimatedSecondsPerPage);
            var pageCount = plan.ScannedPages.Count + plan.TextPages.Count;
            if (pageCount > Limits.MaxAiPages)
            {
                ai = BankStatementAiAvailability.Unavailable($"Trop de pages à lire ({pageCount}, maximum {Limits.MaxAiPages}).");
            }
            else if (plan.EstimatedCalls > Limits.EffectiveMaxAiCalls)
            {
                ai = BankStatementAiAvailability.Unavailable(
                    $"relevé trop long pour la lecture IA ({plan.EstimatedCalls} pages nécessaires, maximum {Limits.EffectiveMaxAiCalls}).");
            }

            return (plan, ai, issue);
        }

        var textCalls = plan.TextPages.Count > 0 && extension == ".pdf"
            ? _extractor.BuildAiTextChunks(content, plan.TextPages, Limits.EffectiveAiTextOperationsPerCall).Count
            : 0;
        plan = BankStatementAiReadingPlanner.WithEstimate(plan, textCalls, Limits.EffectiveAiEstimatedSecondsPerCall) with { Engine = "text" };

        if (plan.ScannedPages.Count > Limits.MaxAiPages)
        {
            ai = BankStatementAiAvailability.Unavailable($"Trop de pages scannées ({plan.ScannedPages.Count}, maximum {Limits.MaxAiPages}).");
        }
        else if (plan.EstimatedCalls > Limits.EffectiveMaxAiCalls)
        {
            ai = BankStatementAiAvailability.Unavailable(
                $"relevé trop long pour la lecture IA ({plan.EstimatedCalls} appels nécessaires, maximum {Limits.EffectiveMaxAiCalls}).");
        }

        return (plan, ai, issue);
    }

    private static string BuildAiNotStartedMessage(ExtractedBankStatement extraction, BankAccount account, bool ribMismatchKillsPlan)
    {
        if (ribMismatchKillsPlan && extraction.Issues.Any(i => i.Code == StatementIssueCodes.RibMismatch))
        {
            var readRib = extraction.Header.Rib is { } r ? MaskRib(r) : "…";
            var accountRib = MaskRib(TunisianIban.NormalizeRibDigits(account.Rib));
            return $"Lecture IA non lancée : ce relevé appartient à un autre compte bancaire (…{readRib}). "
                   + $"Choisissez le compte …{readRib} ou corrigez le RIB du compte …{accountRib}, puis relancez l'analyse.";
        }

        return "Lecture IA non lancée : un contrôle bloquant empêche la relecture automatique. Corrigez le signalement puis relancez l'analyse.";
    }

    /// <summary>
    /// Une lecture IA est-elle déjà en cours pour ce dossier (une seule à la fois) ? Avec le plan de
    /// lecture, une session restée « en cours » au-delà du budget maximal (tâche perdue) ne bloque plus.
    /// </summary>
    private async Task<bool> IsAiReadingInProgressAsync(TenantDbContext ctx, DateTime now, bool ignoreStale, CancellationToken cancellationToken)
    {
        if (!ignoreStale)
        {
            return await ctx.BankStatementImportSessions.AnyAsync(
                s => s.Status == BankStatementImportSessionStatus.Extracting && s.ExpiresAt > now, cancellationToken);
        }

        var staleBefore = now.AddMinutes(-(Limits.EffectiveAiJobBudgetMinutes + 30));
        return await ctx.BankStatementImportSessions.AnyAsync(
            s => s.Status == BankStatementImportSessionStatus.Extracting && s.ExpiresAt > now && s.CreatedAt > staleBefore,
            cancellationToken);
    }

    // ── Règles ──────────────────────────────────────────────────────────────────────────────

    private static Error? CheckBankAccount(BankAccount? account)
    {
        if (account is null)
            return new Error(BankStatementImportErrorCodes.BankAccountNotFound, "Compte bancaire introuvable.");
        if (!account.IsActive)
            return new Error(BankStatementImportErrorCodes.BankAccountInactive, "Ce compte bancaire est désactivé.");
        if (string.IsNullOrWhiteSpace(account.ChartOfAccountNumber))
            return new Error(BankStatementImportErrorCodes.BankAccountWithoutGlAccount,
                "Ce compte bancaire n'est relié à aucun compte comptable 532 : reliez-le avant d'importer un relevé.");
        if (!string.Equals(account.Currency, "TND", StringComparison.OrdinalIgnoreCase))
            return new Error(BankStatementImportErrorCodes.CurrencyNotSupported,
                "Seuls les comptes en dinars (TND) sont pris en charge par l'import de relevés.");
        return null;
    }

    /// <summary>RIB du relevé ≠ RIB du compte choisi ⇒ bloquant ; devise imprimée ≠ TND ⇒ bloquant.</summary>
    private static ExtractedBankStatement AddAccountChecks(ExtractedBankStatement extraction, BankAccount account)
    {
        var issues = extraction.Issues.ToList();
        var accountRib = TunisianIban.NormalizeRibDigits(account.Rib);
        if (extraction.Header.Rib is { } rib && accountRib.Length == 20 && rib != accountRib)
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.RibMismatch, StatementIssueSeverity.Blocking,
                $"Le RIB du relevé (…{MaskRib(rib)}) ne correspond pas au compte bancaire choisi (…{MaskRib(accountRib)})."));
        }

        if (extraction.Header.Currency is { } currency && !string.Equals(currency, "TND", StringComparison.OrdinalIgnoreCase))
        {
            issues.Add(new StatementExtractionIssue(StatementIssueCodes.CurrencyNotSupported, StatementIssueSeverity.Blocking,
                $"Relevé en {currency} : seuls les relevés en dinars (TND) sont pris en charge."));
        }

        return extraction with { Issues = issues };
    }

    private static ExtractedBankStatement ImageOnlyExtraction() => new()
    {
        Header = new ExtractedStatementHeader(),
        Lines = Array.Empty<ExtractedStatementLine>(),
        Issues = new[]
        {
            new StatementExtractionIssue(StatementIssueCodes.NoTextLayer, StatementIssueSeverity.Blocking,
                "Image de relevé : lecture par OCR / IA nécessaire.", 1)
        },
        ProfileId = BankStatementProfileRegistry.GenericProfileId,
        PageCount = 1,
        UnresolvedPages = new[] { 1 }
    };

    private const int MaxCorrectedLabelLength = 500;

    /// <summary>
    /// Applique les corrections de lignes (indices de la lecture courante). Une ligne exclue est retirée,
    /// ses signalements avec elle ; les lignes suivantes et leurs signalements sont renumérotés. Une
    /// correction de montant / sens / date lève les signalements IA de relecture de la ligne ; une ligne
    /// qui resterait sans montant est refusée. <paramref name="trail"/> : avant / après par correction,
    /// pour l'audit (jamais de libellé).
    /// </summary>
    private static ExtractedBankStatement? ApplyCorrections(
        ExtractedBankStatement extraction,
        IReadOnlyList<StatementLineCorrection> corrections,
        out Error? error,
        out List<(object Before, object After)> trail)
    {
        error = null;
        trail = new List<(object Before, object After)>();
        var lines = extraction.Lines.ToList();
        if (corrections.Count > lines.Count)
        {
            error = new Error(BankStatementImportErrorCodes.CorrectionNotAllowed, "Plus de corrections que de lignes lues.");
            return null;
        }

        var excluded = new HashSet<int>();
        var corrected = new Dictionary<int, CorrectedFields>();
        foreach (var correction in corrections)
        {
            if (correction.LineIndex < 0 || correction.LineIndex >= lines.Count)
            {
                error = new Error(BankStatementImportErrorCodes.CorrectionNotAllowed, "Ligne à corriger introuvable.");
                return null;
            }

            var line = lines[correction.LineIndex];
            if (line.Source == StatementLineSource.Layout)
            {
                error = new Error(BankStatementImportErrorCodes.CorrectionNotAllowed,
                    "Une ligne lue directement dans le PDF ne se corrige pas : seules les lignes lues par OCR / IA peuvent l'être.");
                return null;
            }

            if (correction.Exclude)
            {
                excluded.Add(correction.LineIndex);
                trail.Add((Snapshot(line), ExcludedSnapshot(line)));
                continue;
            }

            if (correction.Amount is <= 0)
            {
                error = new Error(BankStatementImportErrorCodes.CorrectionNotAllowed, "Le montant corrigé doit être strictement positif.");
                return null;
            }

            if (correction.Label is { Length: > MaxCorrectedLabelLength })
            {
                error = new Error(BankStatementImportErrorCodes.CorrectionNotAllowed,
                    $"Libellé corrigé trop long ({MaxCorrectedLabelLength} caractères maximum).");
                return null;
            }

            var updated = line with
            {
                TransactionDate = correction.TransactionDate ?? line.TransactionDate,
                Amount = correction.Amount is { } amount ? Math.Round(amount, 3) : line.Amount,
                IsDebit = correction.IsDebit ?? line.IsDebit,
                Label = string.IsNullOrWhiteSpace(correction.Label) ? line.Label : correction.Label.Trim(),
                Source = StatementLineSource.Manual
            };
            lines[correction.LineIndex] = updated;
            trail.Add((Snapshot(line), Snapshot(updated)));
            var fields = (correction.Amount is not null ? CorrectedFields.Amount : CorrectedFields.None)
                | (correction.IsDebit is not null ? CorrectedFields.Side : CorrectedFields.None)
                | (correction.TransactionDate is not null ? CorrectedFields.Date : CorrectedFields.None);
            corrected[correction.LineIndex] = corrected.GetValueOrDefault(correction.LineIndex) | fields;
        }

        var firstWithoutAmount = lines.Select((l, i) => (Line: l, Index: i)).FirstOrDefault(x => !excluded.Contains(x.Index) && x.Line.Amount <= 0);
        if (firstWithoutAmount.Line is not null)
        {
            error = new Error(BankStatementImportErrorCodes.CorrectionNotAllowed,
                $"Ligne {firstWithoutAmount.Index + 1} sans montant : corrigez le montant ou excluez la ligne.");
            return null;
        }

        // Signalements : ceux des lignes exclues disparaissent ; ceux des lignes relues sont levés quand
        // le champ en cause (montant, sens, date) a été corrigé ; les indices des autres suivent la
        // renumérotation.
        var issues = new List<StatementExtractionIssue>();
        foreach (var issue in extraction.Issues)
        {
            if (issue.LineIndex is not { } lineIndex)
            {
                issues.Add(issue);
                continue;
            }

            if (excluded.Contains(lineIndex))
                continue;
            var fields = corrected.GetValueOrDefault(lineIndex);
            if (issue.Code == StatementIssueCodes.AiLineNeedsReview && ReviewLifted(issue.Message, fields))
                continue;
            if (issue.Code == StatementIssueCodes.AiAmountNotGrounded && fields.HasFlag(CorrectedFields.Amount))
                continue;

            var shift = excluded.Count(e => e < lineIndex);
            issues.Add(shift == 0 ? issue : issue with { LineIndex = lineIndex - shift });
        }

        var kept = lines
            .Where((_, i) => !excluded.Contains(i))
            .Select((l, i) => l.Index == i ? l : l with { Index = i })
            .ToList();

        return extraction with { Lines = kept, Issues = issues };
    }

    [Flags]
    private enum CorrectedFields
    {
        None = 0,
        Amount = 1,
        Side = 2,
        Date = 4
    }

    /// <summary>
    /// Un <see cref="StatementIssueCodes.AiLineNeedsReview"/> nomme ce qui était illisible (« montant »,
    /// « date », « débit et crédit ») : il est levé quand chaque champ nommé a été corrigé. Libellé
    /// inconnu : toute correction de montant, de sens ou de date le lève.
    /// </summary>
    private static bool ReviewLifted(string message, CorrectedFields fields)
    {
        var required = CorrectedFields.None;
        if (message.Contains("montant", StringComparison.OrdinalIgnoreCase))
            required |= CorrectedFields.Amount;
        if (message.Contains("date", StringComparison.OrdinalIgnoreCase))
            required |= CorrectedFields.Date;
        if (message.Contains("débit et crédit", StringComparison.OrdinalIgnoreCase) || message.Contains("sens", StringComparison.OrdinalIgnoreCase))
            required |= CorrectedFields.Side;
        return required == CorrectedFields.None ? fields != CorrectedFields.None : (fields & required) == required;
    }

    private static object ExcludedSnapshot(ExtractedStatementLine line) =>
        new { LineIndex = line.Index, Excluded = true, line.TransactionDate, line.Amount, line.IsDebit, LabelLength = line.Label.Length, line.Source };

    private BankStatement BuildStatement(ExtractedBankStatement extraction, BankAccount account, BankStatementImportSession session)
    {
        var lines = extraction.Lines;
        var periodStart = extraction.Header.PeriodStart ?? lines.Min(l => l.TransactionDate);
        var periodEnd = extraction.Header.PeriodEnd ?? lines.Max(l => l.TransactionDate);
        var accountNumber = string.IsNullOrWhiteSpace(account.Rib) ? account.ChartOfAccountNumber! : TunisianIban.NormalizeRibDigits(account.Rib);

        // D4 : un solde non lu (avertissement reconnu) est déduit de l'autre et des opérations.
        var movement = lines.Where(l => !l.IsDebit).Sum(l => l.Amount) - lines.Where(l => l.IsDebit).Sum(l => l.Amount);
        var opening = extraction.Header.OpeningBalance?.Value ?? extraction.Header.ClosingBalance!.Value - movement;
        var closing = extraction.Header.ClosingBalance?.Value ?? opening + movement;

        var statement = BankStatement.Create(
            account.BankName,
            accountNumber,
            periodEnd.ToDateTime(TimeOnly.MinValue),
            periodStart.ToDateTime(TimeOnly.MinValue),
            periodEnd.ToDateTime(TimeOnly.MinValue),
            Money.FromSignedAmount(opening, Money.DefaultCurrency),
            Money.FromSignedAmount(closing, Money.DefaultCurrency));
        statement.SetAuditInfo(UserLabel, false);

        var isImage = session.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase);
        var method = session.ExtractionMethod switch
        {
            BankStatementImportExtractionMethods.Layout => BankStatementImportMethod.PdfText,
            _ when isImage => BankStatementImportMethod.Image,
            _ => BankStatementImportMethod.PdfLlm
        };
        statement.SetProvenance(account.Id, account.ChartOfAccountNumber, session.FileName, session.FileHash, method);

        foreach (var line in lines)
        {
            var date = line.TransactionDate.ToDateTime(TimeOnly.MinValue);
            var description = Truncate(line.Label, 500);
            var reference = BankLabelReferences.Extract(line.Label)?.Number ?? string.Empty;
            var entity = BankStatementLine.Create(
                statement.Id,
                date,
                Truncate(reference, 100),
                description,
                Money.Create(line.Amount, Money.DefaultCurrency),
                line.IsDebit,
                line.ValueDate?.ToDateTime(TimeOnly.MinValue),
                BankStatementLine.ComputeFingerprint(accountNumber, date, line.Amount, line.IsDebit, reference, description));
            entity.SetAuditInfo(UserLabel, false);
            statement.Lines.Add(entity);
        }

        return statement;
    }

    /// <summary>
    /// Lignes déjà présentes dans un relevé enregistré du même compte (chevauchement de périodes),
    /// comptées en MULTI-ensemble : trois commissions identiques le même jour ne sont pas une seule.
    /// </summary>
    private static async Task<int> CountAlreadyImportedAsync(TenantDbContext ctx, Guid bankAccountId, ExtractedBankStatement extraction, CancellationToken cancellationToken)
    {
        if (extraction.Lines.Count == 0)
            return 0;
        var from = extraction.Lines.Min(l => l.TransactionDate).ToDateTime(TimeOnly.MinValue);
        var to = extraction.Lines.Max(l => l.TransactionDate).ToDateTime(TimeOnly.MinValue);

        var existing = await ctx.BankStatementLines.AsNoTracking()
            .Where(l => l.BankStatement.BankAccountId == bankAccountId && l.TransactionDate >= from && l.TransactionDate <= to)
            .Select(l => new { l.TransactionDate, Amount = l.Amount.Amount, l.IsDebit, l.Description })
            .ToListAsync(cancellationToken);

        var available = existing
            .GroupBy(l => (DateOnly.FromDateTime(l.TransactionDate), l.Amount, l.IsDebit, BankLabelNormalizer.Normalize(l.Description)))
            .ToDictionary(g => g.Key, g => g.Count());

        var count = 0;
        foreach (var line in extraction.Lines)
        {
            var key = (line.TransactionDate, line.Amount, line.IsDebit, BankLabelNormalizer.Normalize(Truncate(line.Label, 500)));
            if (available.TryGetValue(key, out var left) && left > 0)
            {
                available[key] = left - 1;
                count++;
            }
        }

        return count;
    }

    private async Task PurgeExpiredAsync(TenantDbContext ctx, DateTime now, CancellationToken cancellationToken)
    {
        var expired = await ctx.BankStatementImportSessions
            .Where(s => s.Status != BankStatementImportSessionStatus.Confirmed && s.ExpiresAt < now)
            .OrderBy(s => s.ExpiresAt)
            .Take(PurgeBatchSize)
            .ToListAsync(cancellationToken);
        if (expired.Count == 0)
            return;

        foreach (var session in expired)
            ctx.BankStatementImportSessions.Remove(session);
        await ctx.SaveChangesAsync(cancellationToken);
        // Fichiers supprimés après la base : un fichier orphelin vaut mieux qu'une ligne sans fichier.
        foreach (var session in expired)
            _files.TryDelete(session.StoragePath);
    }

    // ── Projection ──────────────────────────────────────────────────────────────────────────

    /// <summary>Projection pour le dossier courant (drapeau D4 effectif).</summary>
    private BankStatementImportSessionDto Project(BankStatementImportSession session) => ToDto(session, AiBalanceMismatchAsWarning);

    /// <summary>Projection historique (écart de solde bloquant) : conservée pour les appels hors dossier.</summary>
    internal static BankStatementImportSessionDto ToDto(BankStatementImportSession session) => ToDto(session, aiBalanceMismatchAsWarning: false);

    /// <param name="aiBalanceMismatchAsWarning">
    /// D4 : quand tout a été lu par l'IA, les codes de solde sont des avertissements et la confirmation
    /// exige l'accusé explicite (<see cref="BankStatementImportSessionDto.RequiresBalanceAcknowledgement"/>).
    /// </param>
    internal static BankStatementImportSessionDto ToDto(BankStatementImportSession session, bool aiBalanceMismatchAsWarning)
    {
        var extraction = session.ResultJson is null ? null : Deserialize(session.ResultJson);
        if (extraction is not null && session.Status == BankStatementImportSessionStatus.AwaitingReview)
            extraction = BankStatementBalanceCheck.Reevaluate(extraction, aiBalanceMismatchAsWarning);

        BankStatementBalanceCheckDto? check = null;
        if (extraction is { UnresolvedPages.Count: 0, Lines.Count: > 0 })
        {
            var outcome = BankStatementBalanceCheck.Evaluate(extraction.Header, extraction.Lines);
            check = new BankStatementBalanceCheckDto(outcome.SumDebits, outcome.SumCredits, outcome.ComputedClosing, outcome.Difference, outcome.IsBalanced);
        }

        var canConfirm = session.Status == BankStatementImportSessionStatus.AwaitingReview
                         && extraction is not null
                         && extraction.Lines.Count > 0
                         && !extraction.HasBlockingIssue;

        return new BankStatementImportSessionDto
        {
            Id = session.Id,
            Status = session.Status.ToString(),
            ProgressPercent = session.ProgressPercent,
            BankAccountId = session.BankAccountId,
            JournalCode = session.JournalCode,
            FileName = session.FileName,
            PageCount = session.PageCount,
            ExtractionMethod = session.ExtractionMethod,
            ProfileId = session.ProfileId,
            AiProviderKind = session.AiProviderKind,
            ErrorCode = session.ErrorCode,
            StatementId = session.StatementId,
            ExpiresAt = session.ExpiresAt,
            Extraction = extraction,
            BalanceCheck = check,
            SegmentIndex = StatementSegmentFingerprint.TryParse(session.FileHash, out _, out var segmentIndex, out _) ? segmentIndex : null,
            SegmentCount = StatementSegmentFingerprint.TryParse(session.FileHash, out _, out _, out var segmentCount) ? segmentCount : null,
            CanConfirm = canConfirm,
            RequiresBalanceAcknowledgement = canConfirm && BankStatementBalanceCheck.HasBalanceWarning(extraction!)
        };
    }

    internal static ExtractedBankStatement? Deserialize(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<ExtractedBankStatement>(json, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static object Snapshot(ExtractedStatementLine line) =>
        new { line.Index, line.TransactionDate, line.Amount, line.IsDebit, LabelLength = line.Label.Length, line.Source };

    private string UserLabel => _currentUser.Email ?? "system";

    private static string MaskRib(string? rib) => string.IsNullOrEmpty(rib) || rib.Length < 4 ? "????" : rib[^4..];

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];

    private static Result<T> Fail<T>(string code, string message) => Result.Failure<T>(new Error(code, message));

    private static async Task<byte[]?> ReadBoundedAsync(Stream stream, long max, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > max)
                return null;
            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }
}
