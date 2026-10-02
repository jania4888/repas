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

    // ── Analyse ─────────────────────────────────────────────────────────────────────────────

    public async Task<Result<BankStatementImportSessionDto>> StartAsync(StartBankStatementImportRequest request, CancellationToken cancellationToken = default)
    {
        if (!_settings.BankStatementAiPostingEnabled)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.Disabled, "L'import de relevés bancaires n'est pas activé.");

        var tenantId = _tenantContext.TenantId ?? _currentUser.TenantId;
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
            return Result.Success(ToDto(open));

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
                extractions, tenantId.Value, now, cancellationToken);
        }

        var extraction = AddAccountChecks(extractions[0], account!);

        if (extraction.PageCount > Limits.MaxPages && !extraction.Issues.Any(i => i.Code == StatementIssueCodes.TooManyPages))
        {
            extraction = extraction with
            {
                Issues = extraction.Issues.Append(new StatementExtractionIssue(StatementIssueCodes.TooManyPages, StatementIssueSeverity.Blocking,
                    $"Le relevé compte {extraction.PageCount} pages (maximum {Limits.MaxPages}).")).ToList()
            };
        }

        var needsAi = extraction.UnresolvedPages.Count > 0 && !extraction.Issues.Any(i => i.Code == StatementIssueCodes.TooManyPages);
        BankStatementAiAvailability? ai = null;
        if (needsAi)
        {
            ai = request.AllowAi
                ? await _ai.CheckAvailabilityAsync(cancellationToken)
                : BankStatementAiAvailability.Unavailable("Lecture IA non autorisée pour cet utilisateur.");

            if (ai.Available && extraction.UnresolvedPages.Count > Limits.MaxAiPages)
                ai = BankStatementAiAvailability.Unavailable($"Trop de pages scannées ({extraction.UnresolvedPages.Count}, maximum {Limits.MaxAiPages}).");

            if (ai.Available && await ctx.BankStatementImportSessions.AnyAsync(
                    s => s.Status == BankStatementImportSessionStatus.Extracting && s.ExpiresAt > now, cancellationToken))
            {
                return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.AnalysisInProgress,
                    "Une autre lecture IA de relevé est en cours pour ce dossier : réessayez dans quelques minutes.");
            }

            if (!ai.Available)
            {
                extraction = extraction with
                {
                    Issues = extraction.Issues.Append(new StatementExtractionIssue(StatementIssueCodes.AiUnavailable, StatementIssueSeverity.Blocking,
                        $"Pages scannées non lues : {ai.Reason}")).ToList()
                };
            }
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
            session.CompleteExtraction(json, extension == ".pdf" ? "layout" : "ai", extraction.ProfileId, extraction.PageCount);

        ctx.BankStatementImportSessions.Add(session);
        await ctx.SaveChangesAsync(cancellationToken);

        if (aiScheduled)
            _ai.Schedule(tenantId.Value, session.Id);

        await _audit.LogAsync(AuditActions.Accounting.BankStatementAnalyzed, nameof(BankStatementImportSession), session.Id,
            newValues: new
            {
                session.BankAccountId,
                session.JournalCode,
                extraction.ProfileId,
                extraction.PageCount,
                LineCount = extraction.Lines.Count,
                UnresolvedPages = extraction.UnresolvedPages.Count,
                Blocking = extraction.Issues.Count(i => i.Severity == StatementIssueSeverity.Blocking),
                AiProvider = aiScheduled ? ai!.ProviderKind : null
            },
            cancellationToken: cancellationToken);

        _logger.LogInformation(
            "Import relevé : session {SessionId}, profil {Profile}, {Pages} page(s), {Lines} ligne(s), {Unresolved} page(s) pour l'IA, RIB …{Rib}.",
            session.Id, extraction.ProfileId, extraction.PageCount, extraction.Lines.Count, extraction.UnresolvedPages.Count,
            MaskRib(extraction.Header.Rib));

        return Result.Success(ToDto(session));
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

        var created = new List<BankStatementImportSession>();
        for (var i = 0; i < count; i++)
        {
            var fingerprint = StatementSegmentFingerprint.Create(fileHash, i + 1, count);
            if (imported.Contains(fingerprint) || open.Any(s => s.FileHash == fingerprint))
                continue;

            var extraction = AddAccountChecks(extractions[i], account);
            if (extraction.UnresolvedPages.Count > 0)
            {
                extraction = extraction with
                {
                    Issues = extraction.Issues.Append(new StatementExtractionIssue(StatementIssueCodes.AiUnavailable, StatementIssueSeverity.Blocking,
                        "Pages scannées non lues : dans un fichier à plusieurs relevés, importez ce relevé seul pour qu'il soit lu par l'IA.")).ToList()
                };
            }

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

            session.CompleteExtraction(JsonSerializer.Serialize(extraction, JsonOptions), "layout", extraction.ProfileId, extraction.PageCount);
            ctx.BankStatementImportSessions.Add(session);
            created.Add(session);
        }

        if (created.Count == 0 && open.Count == 0)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.AlreadyImported,
                "Les relevés de ce fichier ont déjà été importés pour ce compte bancaire.");

        if (created.Count > 0)
            await ctx.SaveChangesAsync(cancellationToken);

        foreach (var session in created)
        {
            var extraction = Deserialize(session.ResultJson!);
            await _audit.LogAsync(AuditActions.Accounting.BankStatementAnalyzed, nameof(BankStatementImportSession), session.Id,
                newValues: new
                {
                    session.BankAccountId,
                    session.JournalCode,
                    extraction?.ProfileId,
                    extraction?.PageCount,
                    LineCount = extraction?.Lines.Count ?? 0,
                    Segment = session.FileHash[^5..],
                    Blocking = extraction?.Issues.Count(i => i.Severity == StatementIssueSeverity.Blocking) ?? 0,
                    AiProvider = (string?)null
                },
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
    private static async Task<BankStatementImportSessionDto> WithSiblingsAsync(TenantDbContext ctx, BankStatementImportSession session, CancellationToken cancellationToken)
    {
        var dto = ToDto(session);
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

        // Corrections : seulement sur des lignes lues par OCR / IA, auditées une à une.
        if (request.Corrections.Count > 0)
        {
            var corrected = ApplyCorrections(extraction, request.Corrections, out var correctionError);
            if (correctionError is not null)
                return Result.Failure<ConfirmBankStatementImportResult>(correctionError);
            foreach (var correction in request.Corrections)
            {
                await _audit.LogAsync(AuditActions.Accounting.BankStatementExtractionCorrected, nameof(BankStatementImportSession), session.Id,
                    oldValues: Snapshot(extraction.Lines[correction.LineIndex]),
                    newValues: Snapshot(corrected!.Lines[correction.LineIndex]),
                    cancellationToken: cancellationToken);
            }

            extraction = corrected!;
            session.ReplaceResult(JsonSerializer.Serialize(extraction, JsonOptions));
        }

        // Contrôle recalculé côté serveur : jamais d'enregistrement d'un relevé incomplet.
        extraction = BankStatementBalanceCheck.Reevaluate(extraction);
        var blocking = extraction.Issues.Where(i => i.Severity == StatementIssueSeverity.Blocking).ToList();
        if (blocking.Count > 0)
        {
            return Fail<ConfirmBankStatementImportResult>(BankStatementImportErrorCodes.BlockingIssues,
                "Le relevé ne peut pas être enregistré : " + string.Join(" ", blocking.Take(3).Select(i => i.Message)));
        }

        var account = await ctx.BankAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == session.BankAccountId, cancellationToken);
        var accountCheck = CheckBankAccount(account);
        if (accountCheck is not null)
            return Result.Failure<ConfirmBankStatementImportResult>(accountCheck);
        if (await ctx.BankStatements.AsNoTracking().AnyAsync(s => s.BankAccountId == account!.Id && s.SourceFileHash == session.FileHash, cancellationToken))
            return Fail<ConfirmBankStatementImportResult>(BankStatementImportErrorCodes.AlreadyImported, "Ce relevé a déjà été importé pour ce compte bancaire.");

        var statement = BuildStatement(extraction, account!, session);
        ctx.BankStatements.Add(statement);

        var alreadyImported = await CountAlreadyImportedAsync(ctx, account!.Id, extraction, cancellationToken);

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

        await _audit.LogAsync(AuditActions.Accounting.BankStatementImported, nameof(BankStatement), statement.Id,
            newValues: new
            {
                statement.BankAccountId,
                LineCount = statement.Lines.Count,
                AlreadyImportedCount = alreadyImported,
                statement.PeriodStart,
                statement.PeriodEnd,
                ImportMethod = statement.ImportMethod.ToString(),
                SessionId = session.Id
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

    private static ExtractedBankStatement? ApplyCorrections(
        ExtractedBankStatement extraction, IReadOnlyList<StatementLineCorrection> corrections, out Error? error)
    {
        error = null;
        var lines = extraction.Lines.ToList();
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

            if (correction.Amount is <= 0)
            {
                error = new Error(BankStatementImportErrorCodes.CorrectionNotAllowed, "Le montant corrigé doit être strictement positif.");
                return null;
            }

            lines[correction.LineIndex] = line with
            {
                TransactionDate = correction.TransactionDate ?? line.TransactionDate,
                Amount = correction.Amount is { } amount ? Math.Round(amount, 3) : line.Amount,
                IsDebit = correction.IsDebit ?? line.IsDebit,
                Label = string.IsNullOrWhiteSpace(correction.Label) ? line.Label : correction.Label.Trim(),
                Source = StatementLineSource.Manual
            };
        }

        return extraction with { Lines = lines };
    }

    private BankStatement BuildStatement(ExtractedBankStatement extraction, BankAccount account, BankStatementImportSession session)
    {
        var lines = extraction.Lines;
        var periodStart = extraction.Header.PeriodStart ?? lines.Min(l => l.TransactionDate);
        var periodEnd = extraction.Header.PeriodEnd ?? lines.Max(l => l.TransactionDate);
        var accountNumber = string.IsNullOrWhiteSpace(account.Rib) ? account.ChartOfAccountNumber! : TunisianIban.NormalizeRibDigits(account.Rib);

        var statement = BankStatement.Create(
            account.BankName,
            accountNumber,
            periodEnd.ToDateTime(TimeOnly.MinValue),
            periodStart.ToDateTime(TimeOnly.MinValue),
            periodEnd.ToDateTime(TimeOnly.MinValue),
            Money.FromSignedAmount(extraction.Header.OpeningBalance!.Value, Money.DefaultCurrency),
            Money.FromSignedAmount(extraction.Header.ClosingBalance!.Value, Money.DefaultCurrency));
        statement.SetAuditInfo(UserLabel, false);

        var method = session.ExtractionMethod switch
        {
            "layout" => BankStatementImportMethod.PdfText,
            "ai" when session.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) => BankStatementImportMethod.Image,
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

    internal static BankStatementImportSessionDto ToDto(BankStatementImportSession session)
    {
        var extraction = session.ResultJson is null ? null : Deserialize(session.ResultJson);
        if (extraction is not null && session.Status == BankStatementImportSessionStatus.AwaitingReview)
            extraction = BankStatementBalanceCheck.Reevaluate(extraction);

        BankStatementBalanceCheckDto? check = null;
        if (extraction is { UnresolvedPages.Count: 0, Lines.Count: > 0 })
        {
            var outcome = BankStatementBalanceCheck.Evaluate(extraction.Header, extraction.Lines);
            check = new BankStatementBalanceCheckDto(outcome.SumDebits, outcome.SumCredits, outcome.ComputedClosing, outcome.Difference, outcome.IsBalanced);
        }

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
            CanConfirm = session.Status == BankStatementImportSessionStatus.AwaitingReview
                         && extraction is not null
                         && extraction.Lines.Count > 0
                         && !extraction.HasBlockingIssue
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
