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

    /// <summary>
    /// Relance l'analyse du fichier d'une session sur un autre compte bancaire (ex. RIB corrigé).
    /// Session <c>AwaitingReview</c> ou <c>Failed</c> seulement, compte différent du compte courant ;
    /// le contrôle « une analyse par dossier » (409) est fait AVANT d'annuler la session d'origine.
    /// </summary>
    Task<Result<BankStatementImportSessionDto>> RetargetAsync(Guid sessionId, Guid bankAccountId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Relance la lecture complète du fichier d'une session sur le même compte. Autorisé seulement
    /// pour une session relançable : <c>AwaitingReview</c> avec signalement bloquant
    /// <c>statement.ai_unavailable</c> (IA indisponible avant lancement) ou <c>Failed</c> avec un code
    /// <see cref="BankStatementImportSessionErrorCodes.Relaunchable"/>.
    /// </summary>
    Task<Result<BankStatementImportSessionDto>> RetryAsync(Guid sessionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Numéro du compte d'attente 471 actif résolu dans le plan comptable du dossier (compte exact,
    /// sinon unique enfant actif, sinon parent actif le plus proche), ou <c>null</c> si absent/inactif.
    /// Jamais créé. Utilisé seulement pour l'affichage des capacités (<c>GET capabilities</c>).
    /// </summary>
    Task<string?> GetSuspenseAccountNumberAsync(CancellationToken cancellationToken = default);
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

public sealed record RetargetBankStatementImportRequest(Guid BankAccountId);

public sealed record ConfirmBankStatementImportRequest
{
    /// <summary>
    /// Corrections manuelles de lignes lues par OCR / IA (jamais d'une lecture déterministe),
    /// auditées. Vide dans le cas courant.
    /// </summary>
    public IReadOnlyList<StatementLineCorrection> Corrections { get; init; } = Array.Empty<StatementLineCorrection>();

    /// <summary>
    /// Accusé explicite (D4) : l'utilisateur confirme l'import d'un relevé lu entièrement par l'IA dont
    /// le contrôle de solde reste en avertissement (écart au millime, solde non lu). Exigé quand
    /// <see cref="BankStatementImportSessionDto.RequiresBalanceAcknowledgement"/> est vrai ; sinon
    /// ignoré. L'écart lui-même est recalculé côté serveur, jamais reçu du client.
    /// </summary>
    public bool AcknowledgeBalanceWarning { get; init; }
}

public sealed record StatementLineCorrection
{
    public int LineIndex { get; init; }
    public DateOnly? TransactionDate { get; init; }
    public decimal? Amount { get; init; }
    public bool? IsDebit { get; init; }
    public string? Label { get; init; }

    /// <summary>
    /// Retire la ligne du relevé (ligne IA fantôme, total de page lu comme une opération…). Les
    /// autres champs sont ignorés ; les lignes suivantes sont réindexées. Jamais sur une ligne
    /// de lecture déterministe.
    /// </summary>
    public bool Exclude { get; init; }
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

    /// <summary>
    /// Méthode de lecture (<see cref="BankStatementImportExtractionMethods"/>) : « layout »,
    /// « layout+ai », « ai » (historique) ; « ai-vision », « ai-text », « none » en lecture IA seule.
    /// </summary>
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

    /// <summary>
    /// Vrai quand la confirmation exige l'accusé explicite de l'utilisateur
    /// (<see cref="ConfirmBankStatementImportRequest.AcknowledgeBalanceWarning"/>) : relevé lu
    /// entièrement par l'IA dont un contrôle de solde reste en avertissement. Calculé côté
    /// serveur ; le front ne dérive rien.
    /// </summary>
    public bool RequiresBalanceAcknowledgement { get; init; }

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

    /// <summary>
    /// Tout relevé PDF ou image doit passer par l'import IA : l'assistant de rapprochement y bascule
    /// ces fichiers au lieu de son aperçu historique. Toujours faux quand l'import est désactivé.
    /// </summary>
    public bool AllDocumentsViaAi { get; init; }

    /// <summary><c>vision</c> (GLM-OCR) ou <c>text</c> lorsque l'IA est disponible.</summary>
    public string? AiEngine { get; init; }

    /// <summary>
    /// Pourquoi aucune lecture IA n'est possible (<see cref="BankStatementAiAvailabilityReasons"/> :
    /// <c>engine_unavailable</c>, <c>external_not_allowed</c>, <c>text_model_unavailable</c>) ;
    /// null quand l'IA est disponible.
    /// </summary>
    public string? AiUnavailableReason { get; init; }

    /// <summary>
    /// Pourquoi le modèle vision (GLM-OCR) n'est pas prêt alors que l'IA reste disponible via le
    /// modèle texte (message lisible, sans secret) ; null quand GLM-OCR est prêt ou que l'IA est
    /// indisponible.
    /// </summary>
    public string? VisionUnavailableReason { get; init; }

    // ── Import tabulaire (CSV / XLSX) ──

    /// <summary>Sous-drapeau <c>BankStatementTabularImportEnabled</c> effectif (exige <see cref="Enabled"/>).</summary>
    public bool TabularEnabled { get; init; }

    /// <summary>Extensions tabulaires acceptées, p. ex. <c>[".csv", ".xlsx"]</c> ; vide si <see cref="TabularEnabled"/> est faux.</summary>
    public IReadOnlyList<string> TabularExtensions { get; init; } = Array.Empty<string>();

    public int MaxTabularRows { get; init; }

    /// <summary>Nombre maximal de lignes pour une génération atomique (tout ou rien).</summary>
    public int MaxAtomicLines { get; init; }

    /// <summary>Numéro du compte d'attente 471 actif résolu dans le plan du dossier ; null si introuvable.</summary>
    public string? SuspenseAccountNumber { get; init; }
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

    /// <summary>Avertissement de solde (D4) sans <c>AcknowledgeBalanceWarning</c> : HTTP 400.</summary>
    public const string BalanceWarningNotAcknowledged = "bank_statement_import.balance_warning_not_acknowledged";

    /// <summary>Re-ciblage vers le compte déjà analysé : HTTP 400 (utiliser la relance).</summary>
    public const string SameBankAccount = "bank_statement_import.same_bank_account";
}
