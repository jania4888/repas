using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.Entities;

public enum BankStatementImportSessionStatus
{
    /// <summary>Fichier reçu, lecture non commencée.</summary>
    Pending = 0,

    /// <summary>Lecture IA des pages scannées en cours (tâche de fond).</summary>
    Extracting = 1,

    /// <summary>Extraction terminée : en attente de relecture et de confirmation.</summary>
    AwaitingReview = 2,

    /// <summary>Relevé enregistré (<see cref="BankStatementImportSession.StatementId"/>).</summary>
    Confirmed = 3,

    Failed = 4,
    Cancelled = 5
}

/// <summary>
/// Analyse d'un relevé bancaire importé (PDF / image) avant son enregistrement. Porte le résultat
/// d'extraction (JSON) le temps de la relecture ; le fichier source est stocké hors wwwroot.
/// Une session non confirmée expire et est purgée.
/// </summary>
public sealed class BankStatementImportSession : Entity
{
    public const int FileNameMaxLength = 255;

    public Guid BankAccountId { get; private set; }
    public string JournalCode { get; private set; } = null!;
    public string FileName { get; private set; } = null!;

    /// <summary>SHA-256 du fichier (hexadécimal majuscule) : détecte le ré-import du même relevé.</summary>
    public string FileHash { get; private set; } = null!;

    public long FileSize { get; private set; }
    public string ContentType { get; private set; } = null!;

    /// <summary>Chemin relatif au dossier du tenant ; null une fois le fichier purgé.</summary>
    public string? StoragePath { get; private set; }

    public int PageCount { get; private set; }
    public BankStatementImportSessionStatus Status { get; private set; }
    public int ProgressPercent { get; private set; }

    /// <summary>« layout » (lecture déterministe), « layout+ai » ou « ai ».</summary>
    public string? ExtractionMethod { get; private set; }

    public string? ProfileId { get; private set; }

    /// <summary>« local » / « external » quand l'IA a lu au moins une page (affiché et audité).</summary>
    public string? AiProviderKind { get; private set; }

    public string? ResultJson { get; private set; }
    public string? ErrorCode { get; private set; }
    public Guid? StatementId { get; private set; }
    public DateTime ExpiresAt { get; private set; }
    /// <summary>Jeton de concurrence (rowversion SQL, généré par la base ; vide côté client).</summary>
    public byte[] RowVersion { get; private set; } = Array.Empty<byte>();

    private BankStatementImportSession() { }

    public static BankStatementImportSession Create(
        Guid bankAccountId,
        string journalCode,
        string fileName,
        string fileHash,
        long fileSize,
        string contentType,
        DateTime expiresAt)
    {
        if (bankAccountId == Guid.Empty)
            throw new ArgumentException("Compte bancaire requis.", nameof(bankAccountId));
        if (string.IsNullOrWhiteSpace(journalCode))
            throw new ArgumentException("Journal requis.", nameof(journalCode));
        if (string.IsNullOrWhiteSpace(fileHash))
            throw new ArgumentException("Empreinte du fichier requise.", nameof(fileHash));

        var name = string.IsNullOrWhiteSpace(fileName) ? "releve" : fileName.Trim();
        return new BankStatementImportSession
        {
            BankAccountId = bankAccountId,
            JournalCode = journalCode.Trim().ToUpperInvariant(),
            FileName = name.Length > FileNameMaxLength ? name[..FileNameMaxLength] : name,
            FileHash = fileHash.Trim().ToUpperInvariant(),
            FileSize = fileSize,
            ContentType = contentType,
            Status = BankStatementImportSessionStatus.Pending,
            ExpiresAt = expiresAt
        };
    }

    public void AttachFile(string storagePath) => StoragePath = storagePath;

    public void ForgetFile() => StoragePath = null;

    /// <summary>
    /// Bascule en lecture IA des pages scannées ; <paramref name="interimResultJson"/> porte ce qui a
    /// déjà été lu de façon déterministe (fusionné par la tâche de fond).
    /// </summary>
    public void StartAiExtraction(string aiProviderKind, string interimResultJson, string profileId, int pageCount)
    {
        Status = BankStatementImportSessionStatus.Extracting;
        AiProviderKind = aiProviderKind;
        ResultJson = interimResultJson;
        ProfileId = profileId;
        PageCount = pageCount;
        ProgressPercent = 0;
    }

    public void ReportProgress(int percent) => ProgressPercent = Math.Clamp(percent, 0, 100);

    public void CompleteExtraction(string resultJson, string extractionMethod, string profileId, int pageCount)
    {
        ResultJson = resultJson;
        ExtractionMethod = extractionMethod;
        ProfileId = profileId;
        PageCount = pageCount;
        ProgressPercent = 100;
        ErrorCode = null;
        Status = BankStatementImportSessionStatus.AwaitingReview;
    }

    /// <summary>Remplace le résultat (corrections manuelles avant confirmation, auditées par l'appelant).</summary>
    public void ReplaceResult(string resultJson)
    {
        if (Status != BankStatementImportSessionStatus.AwaitingReview)
            throw new InvalidOperationException("Seule une extraction en attente de relecture peut être corrigée.");
        ResultJson = resultJson;
    }

    /// <summary>
    /// Même fichier (même compte, même empreinte) réanalysé avec un nouveau mappage CSV/XLSX : le
    /// résultat ET le journal choisi ET l'expiration sont tous rafraîchis — contrairement à
    /// <see cref="ReplaceResult"/>, qui ne touche que le résultat (corrections de relecture).
    /// </summary>
    public void RenewForReimport(string journalCode, string resultJson, DateTime expiresAt)
    {
        if (Status != BankStatementImportSessionStatus.AwaitingReview)
            throw new InvalidOperationException("Seule une extraction en attente de relecture peut être corrigée.");
        if (string.IsNullOrWhiteSpace(journalCode))
            throw new ArgumentException("Journal requis.", nameof(journalCode));

        JournalCode = journalCode.Trim().ToUpperInvariant();
        ResultJson = resultJson;
        ExpiresAt = expiresAt;
    }

    public void Fail(string errorCode)
    {
        ErrorCode = errorCode;
        Status = BankStatementImportSessionStatus.Failed;
    }

    public void Cancel()
    {
        if (Status == BankStatementImportSessionStatus.Confirmed)
            throw new InvalidOperationException("Un relevé déjà enregistré ne peut pas être annulé ici.");
        Status = BankStatementImportSessionStatus.Cancelled;
    }

    public void Confirm(Guid statementId)
    {
        if (Status != BankStatementImportSessionStatus.AwaitingReview)
            throw new InvalidOperationException("Seule une extraction relue peut être confirmée.");
        StatementId = statementId;
        Status = BankStatementImportSessionStatus.Confirmed;
    }

    public bool IsTerminal => Status is BankStatementImportSessionStatus.Confirmed
        or BankStatementImportSessionStatus.Failed
        or BankStatementImportSessionStatus.Cancelled;
}
