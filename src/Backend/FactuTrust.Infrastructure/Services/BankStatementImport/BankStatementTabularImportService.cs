using System.Security.Cryptography;
using System.Text.Json;
using FactuTrust.Application.Common.Files;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Accounting.BankStatementImport;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.BankStatementImport;

/// <summary>
/// Import CSV / XLSX d'un relevé bancaire, mappé par colonnes, vers le journal de banque — pendant
/// de <see cref="BankStatementImportService"/> pour les fichiers tabulaires. Même cycle de vie de
/// session (<c>AwaitingReview</c> → correction → confirmation) : la confirmation, les corrections et
/// la génération d'écritures restent celles de <see cref="IBankStatementImportService"/> /
/// <c>IBankStatementPostingService</c>, non dupliquées ici.
///
/// <para>
/// Jamais de <c>ex.Message</c> renvoyé au client (voir <see cref="BankStatementTabularReader"/>) :
/// seuls des codes stables (<see cref="BankStatementTabularErrorCodes"/>) sont renvoyés.
/// </para>
/// </summary>
public sealed class BankStatementTabularImportService : IBankStatementTabularImportService
{
    private const string DefaultBankJournalCode = BankJournalRules.DefaultBankJournalCode;
    private const int PurgeBatchSize = 50;

    private readonly ITenantDbContextFactory _contextFactory;
    private readonly ITenantContext _tenantContext;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _audit;
    private readonly BankStatementFileStore _files;
    private readonly AccountingSettings _settings;
    private readonly TimeProvider _time;
    private readonly ILogger<BankStatementTabularImportService> _logger;

    public BankStatementTabularImportService(
        ITenantDbContextFactory contextFactory,
        ITenantContext tenantContext,
        ICurrentUser currentUser,
        IAuditService audit,
        BankStatementFileStore files,
        IOptions<AccountingSettings> settings,
        ILogger<BankStatementTabularImportService> logger,
        TimeProvider? time = null)
    {
        _contextFactory = contextFactory;
        _tenantContext = tenantContext;
        _currentUser = currentUser;
        _audit = audit;
        _files = files;
        _settings = settings.Value;
        _logger = logger;
        _time = time ?? TimeProvider.System;
    }

    private BankStatementImportLimits Limits => _settings.BankStatementImport;

    private Guid? CurrentTenantId => _tenantContext.TenantId ?? _currentUser.TenantId;

    private bool AiBalanceMismatchAsWarning => _settings.IsAiBalanceMismatchAsWarningFor(CurrentTenantId);

    private string UserLabel => _currentUser.Email ?? "system";

    private static Result<T> Fail<T>(string code, string message) => Result.Failure<T>(new Error(code, message));

    // ── Aperçu (sans effet de bord) ────────────────────────────────────────────────────────────

    public async Task<Result<BankStatementTabularPreviewDto>> PreviewAsync(
        BankStatementTabularPreviewRequest request, CancellationToken cancellationToken = default)
    {
        if (!_settings.TabularImportEffective)
            return Fail<BankStatementTabularPreviewDto>(BankStatementTabularErrorCodes.TabularDisabled, "L'import CSV/XLSX n'est pas activé.");

        var extension = Path.GetExtension(request.FileName ?? string.Empty).ToLowerInvariant();
        if (extension is not (".csv" or ".xlsx"))
            return Fail<BankStatementTabularPreviewDto>(BankStatementTabularErrorCodes.TabularUnreadable, "Format non accepté : CSV ou XLSX uniquement.");

        if (request.Length <= 0 || request.Length > Limits.MaxFileBytes)
            return Fail<BankStatementTabularPreviewDto>(BankStatementTabularErrorCodes.TabularRejected,
                $"Fichier vide ou trop volumineux (maximum {Limits.MaxFileBytes / (1024 * 1024)} Mo).");

        var content = await BankStatementImportGuards.ReadBoundedAsync(request.Content, Limits.MaxFileBytes, cancellationToken);
        if (content is null)
            return Fail<BankStatementTabularPreviewDto>(BankStatementTabularErrorCodes.TabularRejected,
                $"Fichier trop volumineux (maximum {Limits.MaxFileBytes / (1024 * 1024)} Mo).");

        // Même contrôle que StartAsync (magie/MIME/extension/double-extension), pas seulement les
        // octets magiques XLSX : un fichier refusé au démarrage doit l'être dès l'aperçu.
        var previewHeader = content.AsMemory(0, Math.Min(UploadValidator.RequiredHeaderBytes, content.Length));
        var previewValidation = UploadValidator.Validate(request.FileName ?? string.Empty, request.ContentType ?? string.Empty,
            content.Length, previewHeader, Limits.MaxFileBytes);
        if (!previewValidation.IsValid)
            return Fail<BankStatementTabularPreviewDto>(BankStatementTabularErrorCodes.TabularRejected, previewValidation.ErrorMessage ?? "Fichier refusé.");

        cancellationToken.ThrowIfCancellationRequested();

        // SheetIndex/Encoding/Delimiter du mappage explicitement fourni par le client honorés dès le
        // chargement (un mappage mémorisé/suggéré n'a pas encore été résolu à ce stade).
        var tableResult = BankStatementTabularReader.LoadRawTable(
            content, extension, Limits, request.Mapping?.Encoding, request.Mapping?.Delimiter, request.Mapping?.SheetIndex);
        if (tableResult.IsFailure)
            return Result.Failure<BankStatementTabularPreviewDto>(tableResult.Error);
        var table = tableResult.Value;

        // Mappage CLIENT (explicitement fourni) validé avant toute interprétation : un mappage
        // suggéré ou mémorisé est toujours valide par construction, celui-ci ne l'est pas forcément.
        if (request.Mapping is not null)
        {
            var clientMappingCheck = BankStatementTabularReader.ValidateMapping(request.Mapping, table.ColumnCount);
            if (clientMappingCheck is not null)
                return Result.Failure<BankStatementTabularPreviewDto>(clientMappingCheck);
        }

        BankStatementTabularMappingDto? savedMapping = null;
        DateTime? savedMappingUpdatedAt = null;
        if (request.BankAccountId is { } bankAccountId)
        {
            await using var ctx = _contextFactory.CreateContext();
            var entity = await ctx.BankStatementTabularMappings.AsNoTracking()
                .FirstOrDefaultAsync(m => m.BankAccountId == bankAccountId, cancellationToken);
            if (entity is not null)
            {
                var candidate = TryDeserializeMapping(entity.MappingJson);
                // Un mappage dont les index dépassent les colonnes du fichier n'est pas proposé.
                if (candidate is not null && BankStatementTabularReader.ValidateMapping(candidate, table.ColumnCount) is null)
                {
                    savedMapping = candidate;
                    savedMappingUpdatedAt = entity.UpdatedAt ?? entity.CreatedAt;
                }
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
        var suggested = BankStatementTabularReader.SuggestMapping(table);
        var effective = request.Mapping ?? savedMapping ?? suggested;

        var parsed = BankStatementTabularReader.ParseLines(table, effective);
        var operationLines = parsed.Where(p => !p.IsFooter).ToList();
        var footerCount = parsed.Count(p => p.IsFooter);
        var ambiguous = BankStatementTabularReader.DetectAmbiguousDateFormat(table, effective.DateColumn);

        cancellationToken.ThrowIfCancellationRequested();
        var columns = BuildColumns(table, effective.HeaderRowIndex);
        var rows = table.Rows.Take(20)
            .Select((r, i) => new BankStatementTabularRowDto(i + 1, r.Select(c => BankStatementImportGuards.Truncate(c, 200)).ToList()))
            .ToList();
        var parsedLines = operationLines.Take(20)
            .Select(p => new BankStatementTabularParsedLineDto(p.RowNumber, p.TransactionDate, p.ValueDate, p.Label, p.Amount, p.IsDebit, p.Error))
            .ToList();

        var issues = operationLines.Where(p => p.Error is not null)
            .Select(p => new BankStatementTabularIssueDto(p.Error!, StatementIssueSeverity.Blocking, p.RowNumber))
            .ToList();

        var dto = new BankStatementTabularPreviewDto
        {
            Format = table.Format,
            Encoding = table.Encoding,
            Delimiter = table.Delimiter,
            HeaderRowIndex = table.HeaderRowIndex,
            SheetNames = table.SheetNames,
            TotalRowCount = table.Rows.Count,
            Columns = columns,
            SuggestedMapping = suggested,
            SavedMapping = savedMapping,
            SavedMappingUpdatedAt = savedMappingUpdatedAt,
            Rows = rows,
            ParsedLines = parsedLines,
            Issues = issues,
            OperationRowCount = operationLines.Count,
            IgnoredFooterRows = footerCount,
            AmbiguousDateFormat = ambiguous
        };

        return Result.Success(dto);
    }

    private static IReadOnlyList<BankStatementTabularColumnDto> BuildColumns(BankStatementTabularReader.RawTable table, int? headerRowIndexOverride = null)
    {
        var headerRowIndex = headerRowIndexOverride is { } idx && idx >= 0 ? idx : table.HeaderRowIndex;
        var columnCount = table.ColumnCount;
        var headerRow = headerRowIndex < table.Rows.Count ? table.Rows[headerRowIndex] : Array.Empty<string>();
        var columns = new List<BankStatementTabularColumnDto>(columnCount);
        for (var c = 0; c < columnCount; c++)
        {
            var columnHeader = c < headerRow.Length ? headerRow[c] : string.Empty;
            var samples = table.Rows.Skip(headerRowIndex + 1)
                .Select(r => c < r.Length ? r[c] : string.Empty)
                .Where(v => !string.IsNullOrWhiteSpace(v))
                .Take(5)
                .ToList();
            columns.Add(new BankStatementTabularColumnDto(c, ColumnLetter(c), columnHeader, samples));
        }
        return columns;
    }

    private static string ColumnLetter(int index)
    {
        var n = index + 1;
        var letters = string.Empty;
        while (n > 0)
        {
            var rem = (n - 1) % 26;
            letters = (char)('A' + rem) + letters;
            n = (n - 1) / 26;
        }
        return letters;
    }

    private static BankStatementTabularMappingDto? TryDeserializeMapping(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<BankStatementTabularMappingDto>(json, BankStatementImportService.JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // ── Démarrage de session ───────────────────────────────────────────────────────────────────

    public async Task<Result<BankStatementImportSessionDto>> StartAsync(
        StartBankStatementImportRequest request, BankStatementTabularMappingDto mapping, CancellationToken cancellationToken = default)
    {
        if (!_settings.TabularImportEffective)
            return Fail<BankStatementImportSessionDto>(BankStatementTabularErrorCodes.TabularDisabled, "L'import CSV/XLSX n'est pas activé.");

        var tenantId = CurrentTenantId;
        if (tenantId is null)
            return Result.Failure<BankStatementImportSessionDto>(Error.Forbidden("Dossier introuvable."));

        if (request.Length <= 0)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.FileRequired, "Fichier requis.");
        if (request.Length > Limits.MaxFileBytes)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.FileTooLarge,
                $"Fichier trop volumineux (maximum {Limits.MaxFileBytes / (1024 * 1024)} Mo).");

        var extension = Path.GetExtension(request.FileName ?? string.Empty).ToLowerInvariant();
        if (extension is not (".csv" or ".xlsx"))
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.FileRejected, "Format non accepté : CSV ou XLSX uniquement.");

        var content = await BankStatementImportGuards.ReadBoundedAsync(request.Content, Limits.MaxFileBytes, cancellationToken);
        if (content is null)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.FileTooLarge,
                $"Fichier trop volumineux (maximum {Limits.MaxFileBytes / (1024 * 1024)} Mo).");

        var header = content.AsMemory(0, Math.Min(UploadValidator.RequiredHeaderBytes, content.Length));
        var validation = UploadValidator.Validate(request.FileName ?? string.Empty, request.ContentType ?? string.Empty,
            content.Length, header, Limits.MaxFileBytes);
        if (!validation.IsValid)
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.FileRejected, validation.ErrorMessage ?? "Fichier refusé.");

        await using var ctx = _contextFactory.CreateContext();

        var account = await ctx.BankAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == request.BankAccountId, cancellationToken);
        var accountCheck = BankStatementImportGuards.CheckBankAccount(account);
        if (accountCheck is not null)
            return Result.Failure<BankStatementImportSessionDto>(accountCheck);

        var journalCode = (string.IsNullOrWhiteSpace(request.JournalCode) ? DefaultBankJournalCode : request.JournalCode).Trim().ToUpperInvariant();
        if (!await BankJournalRules.IsBankJournalAsync(ctx, journalCode, cancellationToken))
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.JournalInvalid,
                $"Le journal « {journalCode} » n'est pas un journal de banque actif.");

        var tableResult = BankStatementTabularReader.LoadRawTable(
            content, extension, Limits, mapping.Encoding, mapping.Delimiter, mapping.SheetIndex);
        if (tableResult.IsFailure)
            return Result.Failure<BankStatementImportSessionDto>(tableResult.Error);
        var table = tableResult.Value;

        var mappingCheck = BankStatementTabularReader.ValidateMapping(mapping, table.ColumnCount);
        if (mappingCheck is not null)
            return Result.Failure<BankStatementImportSessionDto>(mappingCheck);

        var hash = Convert.ToHexString(SHA256.HashData(content));
        var now = _time.GetUtcNow().UtcDateTime;

        if (await BankStatementImportGuards.IsAlreadyImportedAsync(ctx, account!.Id, hash, cancellationToken))
            return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.AlreadyImported, "Ce relevé a déjà été importé pour ce compte bancaire.");

        var extractionResult = BankStatementTabularReader.BuildExtraction(table, mapping, Limits, account.Rib);
        if (extractionResult.IsFailure)
            return Result.Failure<BankStatementImportSessionDto>(extractionResult.Error);
        var extraction = extractionResult.Value;

        await BankStatementImportGuards.PurgeExpiredAsync(ctx, _files, PurgeBatchSize, now, cancellationToken);

        var extractionMethod = table.Format;
        var json = JsonSerializer.Serialize(extraction, BankStatementImportService.JsonOptions);
        var expiresAt = now.AddHours(Math.Max(1, Limits.SessionRetentionHours));

        // Même fichier (même compte, même empreinte), nouveau mappage soumis par l'utilisateur : la
        // session déjà ouverte voit son résultat remplacé plutôt que d'en ouvrir une seconde.
        var existing = await ctx.BankStatementImportSessions.FirstOrDefaultAsync(
            s => s.BankAccountId == account.Id && s.FileHash == hash
                 && s.Status == BankStatementImportSessionStatus.AwaitingReview
                 && (s.ExtractionMethod == BankStatementImportExtractionMethods.Csv || s.ExtractionMethod == BankStatementImportExtractionMethods.Xlsx),
            cancellationToken);

        BankStatementImportSession session;
        var isNewSession = existing is null;
        if (existing is not null)
        {
            // Même fichier, nouveau mappage soumis par l'utilisateur : le journal choisi et
            // l'expiration doivent eux aussi être rafraîchis, pas seulement le résultat.
            existing.RenewForReimport(journalCode, json, expiresAt);
            session = existing;
        }
        else
        {
            session = BankStatementImportSession.Create(account.Id, journalCode, validation.SafeFileName ?? "releve" + extension, hash,
                content.Length, request.ContentType ?? string.Empty, expiresAt);
            session.SetAuditInfo(UserLabel, false);

            try
            {
                session.AttachFile(await _files.SaveSessionFileAsync(tenantId.Value, session.Id, extension, content, cancellationToken));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
            {
                _logger.LogError(ex, "Import relevé CSV/XLSX : stockage du fichier impossible (session {SessionId}).", session.Id);
                return Fail<BankStatementImportSessionDto>(BankStatementImportErrorCodes.Storage, "Le fichier n'a pas pu être enregistré sur le serveur.");
            }

            session.CompleteExtraction(json, extractionMethod, extraction.ProfileId, extraction.PageCount);
            ctx.BankStatementImportSessions.Add(session);
        }

        await ctx.SaveChangesAsync(cancellationToken);

        if (mapping.RememberMapping == true && extraction.Lines.Count > 0)
            await RememberMappingAsync(ctx, account.Id, extractionMethod, mapping, cancellationToken);

        await _audit.LogAsync(AuditActions.Accounting.BankStatementAnalyzed, nameof(BankStatementImportSession), session.Id,
            newValues: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["BankAccountId"] = account.Id,
                ["JournalCode"] = journalCode,
                ["ExtractionMethod"] = extractionMethod,
                ["Lines"] = extraction.Lines.Count,
                ["UnresolvedPages"] = 0,
                ["IsNewSession"] = isNewSession
            },
            cancellationToken: cancellationToken);

        _logger.LogInformation(
            "Import relevé CSV/XLSX : session {SessionId}, {Lines} ligne(s), RIB …{Rib}.",
            session.Id, extraction.Lines.Count, BankStatementImportGuards.MaskRib(extraction.Header.Rib));

        return Result.Success(BankStatementImportService.ToDto(session, AiBalanceMismatchAsWarning));
    }

    /// <summary>
    /// Mémorise le mappage pour le compte bancaire (une ligne par compte), SANS les soldes saisis
    /// ni les lignes ignorées de cette session (propres au fichier, jamais réutilisables).
    /// </summary>
    private async Task RememberMappingAsync(
        TenantDbContext ctx, Guid bankAccountId, string format, BankStatementTabularMappingDto mapping, CancellationToken cancellationToken)
    {
        var reusable = mapping with { OpeningBalance = null, ClosingBalance = null, IgnoredRows = null, RememberMapping = null };
        var json = JsonSerializer.Serialize(reusable, BankStatementImportService.JsonOptions);
        if (json.Length > FactuTrust.Domain.Entities.BankStatementTabularMapping.MappingJsonMaxLength)
            return; // Garde-fou silencieux : un mappage anormalement long n'est simplement pas mémorisé.

        async Task UpdateExistingAsync(FactuTrust.Domain.Entities.BankStatementTabularMapping target)
        {
            target.Update(format, json);
            target.SetAuditInfo(UserLabel, true);
            await ctx.SaveChangesAsync(cancellationToken);
        }

        var entity = await ctx.BankStatementTabularMappings.FirstOrDefaultAsync(m => m.BankAccountId == bankAccountId, cancellationToken);
        if (entity is null)
        {
            entity = FactuTrust.Domain.Entities.BankStatementTabularMapping.Create(bankAccountId, format, json);
            entity.SetAuditInfo(UserLabel, false);
            ctx.BankStatementTabularMappings.Add(entity);

            try
            {
                await ctx.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException)
            {
                // Course concurrente : une autre requête a inséré la ligne de ce compte entre notre
                // lecture et notre écriture (index unique sur BankAccountId) — on retente en UPDATE
                // plutôt que de renvoyer une 500 pour un simple doublon de mémorisation de mappage.
                ctx.Entry(entity).State = EntityState.Detached;
                var concurrent = await ctx.BankStatementTabularMappings.FirstOrDefaultAsync(m => m.BankAccountId == bankAccountId, cancellationToken);
                if (concurrent is null)
                    throw;

                await UpdateExistingAsync(concurrent);
                entity = concurrent;
            }
        }
        else
        {
            await UpdateExistingAsync(entity);
        }

        await _audit.LogAsync(AuditActions.Accounting.BankStatementTabularMappingSaved, nameof(FactuTrust.Domain.Entities.BankStatementTabularMapping), entity.Id,
            newValues: new Dictionary<string, object?>(StringComparer.Ordinal) { ["BankAccountId"] = bankAccountId, ["Format"] = format },
            cancellationToken: cancellationToken);
    }
}
