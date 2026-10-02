using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Import IA d'un relevé bancaire vers le journal de banque : analyse (session), relecture,
/// confirmation (enregistrement du relevé). Les montants et dates ne viennent JAMAIS du client
/// après l'analyse : la confirmation et la génération relisent le résultat serveur.
/// </summary>
public interface IBankStatementImportService
{
    /// <summary>Reçoit le fichier, le stocke, lit sa couche texte (déterministe) et ouvre une session.</summary>
    Task<Result<BankStatementImportSessionDto>> StartAsync(StartBankStatementImportRequest request, CancellationToken cancellationToken = default);

    Task<Result<BankStatementImportSessionDto>> GetAsync(Guid sessionId, CancellationToken cancellationToken = default);

    /// <summary>Annule une analyse non confirmée et supprime son fichier.</summary>
    Task<Result> CancelAsync(Guid sessionId, CancellationToken cancellationToken = default);

    /// <summary>Enregistre le relevé (contrôle de soldes vert obligatoire) et rend son identifiant.</summary>
    Task<Result<ConfirmBankStatementImportResult>> ConfirmAsync(Guid sessionId, ConfirmBankStatementImportRequest request, CancellationToken cancellationToken = default);

    /// <summary>Pièce justificative d'un relevé enregistré par ce parcours (fichier d'origine).</summary>
    Task<Result<BankStatementSourceFile>> GetSourceFileAsync(Guid statementId, CancellationToken cancellationToken = default);
}

/// <param name="FileName">Nom d'origine assaini (affichage et téléchargement seulement, jamais un chemin).</param>
public sealed record BankStatementSourceFile(byte[] Content, string ContentType, string FileName);

public sealed record StartBankStatementImportRequest
{
    public required Stream Content { get; init; }
    public required string FileName { get; init; }
    public required string ContentType { get; init; }
    public required long Length { get; init; }
    public required Guid BankAccountId { get; init; }
    public string JournalCode { get; init; } = "JB";

    /// <summary>L'utilisateur a le droit d'utiliser l'IA (<c>ai:chat</c>) pour les pages scannées.</summary>
    public bool AllowAi { get; init; }
}

public sealed record ConfirmBankStatementImportRequest
{
    /// <summary>
    /// Corrections manuelles de lignes lues par OCR / IA (jamais d'une lecture déterministe),
    /// auditées. Vide dans le cas courant.
    /// </summary>
    public IReadOnlyList<StatementLineCorrection> Corrections { get; init; } = Array.Empty<StatementLineCorrection>();
}

public sealed record StatementLineCorrection
{
    public int LineIndex { get; init; }
    public DateOnly? TransactionDate { get; init; }
    public decimal? Amount { get; init; }
    public bool? IsDebit { get; init; }
    public string? Label { get; init; }
}

public sealed record ConfirmBankStatementImportResult(Guid StatementId, int LineCount, int AlreadyImportedCount);

public sealed record BankStatementImportSessionDto
{
    public Guid Id { get; init; }
    public string Status { get; init; } = string.Empty;
    public int ProgressPercent { get; init; }
    public Guid BankAccountId { get; init; }
    public string JournalCode { get; init; } = string.Empty;
    public string FileName { get; init; } = string.Empty;
    public int PageCount { get; init; }

    /// <summary>« layout », « layout+ai » ou « ai ».</summary>
    public string? ExtractionMethod { get; init; }

    public string? ProfileId { get; init; }

    /// <summary>« local » / « external » quand l'IA a lu au moins une page.</summary>
    public string? AiProviderKind { get; init; }

    public string? ErrorCode { get; init; }
    public Guid? StatementId { get; init; }
    public DateTime ExpiresAt { get; init; }
    public ExtractedBankStatement? Extraction { get; init; }
    public BankStatementBalanceCheckDto? BalanceCheck { get; init; }

    /// <summary>Vrai si la confirmation est possible (aucun signalement bloquant).</summary>
    public bool CanConfirm { get; init; }

    /// <summary>Rang (1…N) du relevé dans un fichier qui en contient plusieurs ; null = fichier d'un seul relevé.</summary>
    public int? SegmentIndex { get; init; }

    public int? SegmentCount { get; init; }

    /// <summary>Les autres relevés du même fichier (une session chacun), dans l'ordre chronologique.</summary>
    public IReadOnlyList<BankStatementImportSiblingDto> Siblings { get; init; } = Array.Empty<BankStatementImportSiblingDto>();
}

public sealed record BankStatementImportSiblingDto(
    Guid Id,
    int SegmentIndex,
    DateOnly? PeriodStart,
    DateOnly? PeriodEnd,
    string Status,
    Guid? StatementId);

/// <summary>
/// Empreinte d'un relevé extrait d'un fichier qui en contient plusieurs : les 58 premiers caractères
/// du SHA-256 du fichier puis « -IP/NN » (rang/nombre), soit 64 caractères comme une empreinte
/// ordinaire (hexadécimale, sans « - » ni « / », donc jamais confondue). Chaque relevé garde ainsi sa
/// propre déduplication (session ouverte, relevé déjà importé, confirmation) sans changer le schéma ;
/// ses relevés frères partagent le préfixe.
/// </summary>
public static class StatementSegmentFingerprint
{
    private const int PrefixLength = 58;

    public static string Create(string fileHash, int index, int count) =>
        $"{fileHash[..PrefixLength]}-{index:D2}/{count:D2}";

    /// <summary>Préfixe commun aux relevés frères (« … - »), pour une recherche par début de chaîne.</summary>
    public static string GroupPrefix(string fileHash) => fileHash[..PrefixLength] + "-";

    public static bool TryParse(string? fingerprint, out string groupPrefix, out int index, out int count)
    {
        groupPrefix = string.Empty;
        index = count = 0;
        if (fingerprint is not { Length: PrefixLength + 6 } || fingerprint[PrefixLength] != '-' || fingerprint[PrefixLength + 3] != '/')
            return false;
        if (!int.TryParse(fingerprint.AsSpan(PrefixLength + 1, 2), out index) || !int.TryParse(fingerprint.AsSpan(PrefixLength + 4, 2), out count))
            return false;
        groupPrefix = fingerprint[..(PrefixLength + 1)];
        return index >= 1 && index <= count;
    }
}

public sealed record BankStatementBalanceCheckDto(
    decimal SumDebits,
    decimal SumCredits,
    decimal? ComputedClosing,
    decimal? Difference,
    bool IsBalanced);

/// <summary>
/// Capacités de l'import, lues par le front à l'ouverture de la saisie manuelle et du rapprochement.
/// Fonctionnalité éteinte : réponse 200 <see cref="Disabled"/> (et non 404, que le navigateur journalise
/// comme une erreur à chaque visite) ; elle ne révèle ni limites, ni banques, ni fournisseur IA.
/// </summary>
public sealed record BankStatementImportCapabilitiesDto(
    bool Enabled,
    bool AiAvailable,
    string? AiProviderKind,
    long MaxFileBytes,
    int MaxPages,
    IReadOnlyList<string> AcceptedExtensions,
    IReadOnlyList<string> RecognizedBanks)
{
    public static BankStatementImportCapabilitiesDto Disabled { get; } =
        new(false, false, null, 0, 0, Array.Empty<string>(), Array.Empty<string>());
}

/// <summary>Codes d'erreur stables de l'import (testés par le front, traduits côté API).</summary>
public static class BankStatementImportErrorCodes
{
    public const string Disabled = "bank_statement_import.disabled";
    public const string FileRequired = "bank_statement_import.file_required";
    public const string FileTooLarge = "bank_statement_import.file_too_large";
    public const string FileRejected = "bank_statement_import.file_rejected";
    public const string BankAccountNotFound = "bank_statement_import.bank_account_not_found";
    public const string BankAccountInactive = "bank_statement_import.bank_account_inactive";
    public const string BankAccountWithoutGlAccount = "bank_statement_import.bank_account_without_gl_account";
    public const string CurrencyNotSupported = "bank_statement_import.currency_not_supported";
    public const string JournalInvalid = "bank_statement_import.journal_invalid";
    public const string AlreadyImported = "bank_statement_import.already_imported";
    public const string AnalysisInProgress = "bank_statement_import.analysis_in_progress";
    public const string SessionNotFound = "bank_statement_import.session_not_found";
    public const string SessionNotReviewable = "bank_statement_import.session_not_reviewable";
    public const string BlockingIssues = "bank_statement_import.blocking_issues";
    public const string CorrectionNotAllowed = "bank_statement_import.correction_not_allowed";
    public const string Storage = "bank_statement_import.storage";
    public const string SourceFileNotFound = "bank_statement_import.source_file_not_found";
}
