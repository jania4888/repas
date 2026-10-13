using FactuTrust.Domain.Common;

namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Import CSV / XLSX d'un relevé bancaire, mappé par colonnes, vers le journal de banque — pendant
/// de <see cref="IBankStatementImportService"/> pour les fichiers tabulaires (pas de lecture IA).
/// Mêmes garanties que le chemin PDF/IA : rien n'est écrit par <see cref="PreviewAsync"/> (aperçu sans
/// état), et la session créée par <see cref="StartAsync"/> suit exactement le même cycle de vie
/// (<c>AwaitingReview</c> → correction → confirmation) que le chemin « Layout ».
/// </summary>
public interface IBankStatementTabularImportService
{
    /// <summary>
    /// Aperçu sans état : détection du format/encodage/délimiteur, mappage suggéré (ou mémorisé pour
    /// <paramref name="bankAccountId"/>), 20 premières lignes brutes et interprétées, signalements.
    /// N'ouvre aucune session, n'écrit aucun fichier, ne journalise aucun audit.
    /// </summary>
    Task<Result<BankStatementTabularPreviewDto>> PreviewAsync(
        BankStatementTabularPreviewRequest request, CancellationToken cancellationToken = default);

    /// <summary>Crée la session (fichier + mappage final) ; renvoie le DTO de session existant, déjà en <c>AwaitingReview</c>.</summary>
    Task<Result<BankStatementImportSessionDto>> StartAsync(
        StartBankStatementImportRequest request, BankStatementTabularMappingDto mapping, CancellationToken cancellationToken = default);
}

public sealed record BankStatementTabularPreviewRequest
{
    public required Stream Content { get; init; }
    public required string FileName { get; init; }
    public required long Length { get; init; }

    /// <summary>Content-Type déclaré par le client (multipart) : utilisé par <c>UploadValidator.Validate</c>, comme pour <c>StartAsync</c>.</summary>
    public string? ContentType { get; init; }

    /// <summary>Mappage proposé par le client (ex. l'utilisateur a changé une colonne) ; sinon mappage suggéré/mémorisé.</summary>
    public BankStatementTabularMappingDto? Mapping { get; init; }

    /// <summary>Compte bancaire pressenti, pour relire un mappage mémorisé (<see cref="BankStatementTabularMappingDto.RememberMapping"/>).</summary>
    public Guid? BankAccountId { get; init; }
}

/// <summary>Mappage de colonnes CSV/XLSX fermé par l'utilisateur — jamais interprété comme du texte libre.</summary>
public sealed record BankStatementTabularMappingDto
{
    public int HeaderRowIndex { get; init; }
    public int? SheetIndex { get; init; }

    /// <summary><c>dd/MM/yyyy</c>, <c>dd-MM-yyyy</c>, <c>dd.MM.yyyy</c>, <c>yyyy-MM-dd</c>, <c>MM/dd/yyyy</c>, <c>dd/MM/yy</c>.</summary>
    public required string DateFormat { get; init; }

    /// <summary><c>,</c> ou <c>.</c>.</summary>
    public required string DecimalSeparator { get; init; }

    /// <summary><c>debitCredit</c> (deux colonnes) ou <c>signed</c> (une colonne signée).</summary>
    public required string AmountMode { get; init; }

    /// <summary><c>negativeIsDebit</c> (défaut) ou <c>negativeIsCredit</c> — seulement pour <c>signed</c>.</summary>
    public string? SignConvention { get; init; }

    public required int DateColumn { get; init; }
    public int? ValueDateColumn { get; init; }

    /// <summary>1 à 3 colonnes jointes par une espace pour former le libellé.</summary>
    public required IReadOnlyList<int> LabelColumns { get; init; }

    public int? ReferenceColumn { get; init; }
    public int? DebitColumn { get; init; }
    public int? CreditColumn { get; init; }
    public int? AmountColumn { get; init; }
    public int? BalanceColumn { get; init; }

    /// <summary>
    /// Lignes à ignorer en plus de l'en-tête et des pieds de page détectés automatiquement.
    /// Numéros de ligne DU FICHIER, 1-based (la 1ère ligne du fichier — généralement l'en-tête — est
    /// la ligne 1), identique à <c>rowNumber</c> dans <c>rows[]</c>/<c>parsedLines[]</c> : jamais un
    /// index 0-based interne, et jamais relatif aux lignes de données (une ligne d'en-tête à l'index
    /// 0 fait que la première ligne de données est le numéro 2, pas 1).
    /// </summary>
    public IReadOnlyList<int>? IgnoredRows { get; init; }

    public decimal? OpeningBalance { get; init; }
    public decimal? ClosingBalance { get; init; }

    /// <summary>Mémoriser ce mappage pour le compte bancaire de la session (hors soldes et lignes ignorées).</summary>
    public bool? RememberMapping { get; init; }

    /// <summary>Forçage facultatif de l'encodage détecté (ex. <c>windows-1252</c>).</summary>
    public string? Encoding { get; init; }

    /// <summary>Forçage facultatif du délimiteur CSV détecté.</summary>
    public string? Delimiter { get; init; }
}

public sealed record BankStatementTabularColumnDto(int Index, string Letter, string Header, IReadOnlyList<string> Samples);

public sealed record BankStatementTabularRowDto(int RowNumber, IReadOnlyList<string> Cells);

public sealed record BankStatementTabularParsedLineDto(
    int RowNumber,
    DateOnly? TransactionDate,
    DateOnly? ValueDate,
    string? Label,
    decimal? Amount,
    bool? IsDebit,
    string? Error);

public sealed record BankStatementTabularIssueDto(string Code, StatementIssueSeverity Severity, int? RowNumber);

public sealed record BankStatementTabularPreviewDto
{
    /// <summary><c>csv</c> ou <c>xlsx</c>.</summary>
    public required string Format { get; init; }

    public required string Encoding { get; init; }
    public string? Delimiter { get; init; }
    public required int HeaderRowIndex { get; init; }
    public IReadOnlyList<string> SheetNames { get; init; } = Array.Empty<string>();
    public required int TotalRowCount { get; init; }
    public required IReadOnlyList<BankStatementTabularColumnDto> Columns { get; init; }
    public required BankStatementTabularMappingDto SuggestedMapping { get; init; }
    public BankStatementTabularMappingDto? SavedMapping { get; init; }
    public DateTime? SavedMappingUpdatedAt { get; init; }

    /// <summary>Au plus 20 lignes brutes, cellules tronquées à 200 caractères.</summary>
    public IReadOnlyList<BankStatementTabularRowDto> Rows { get; init; } = Array.Empty<BankStatementTabularRowDto>();

    /// <summary>Au plus 20 lignes interprétées avec le mappage courant.</summary>
    public IReadOnlyList<BankStatementTabularParsedLineDto> ParsedLines { get; init; } = Array.Empty<BankStatementTabularParsedLineDto>();

    public IReadOnlyList<BankStatementTabularIssueDto> Issues { get; init; } = Array.Empty<BankStatementTabularIssueDto>();
    public required int OperationRowCount { get; init; }
    public required int IgnoredFooterRows { get; init; }
    public required bool AmbiguousDateFormat { get; init; }
}

/// <summary>
/// Codes d'erreur HTTP spécifiques à l'import CSV/XLSX, préfixés <c>bank_statement_import.</c> comme
/// <see cref="BankStatementImportErrorCodes"/>. Tous à 400 sauf <see cref="TabularDisabled"/> (404 sans corps,
/// même traitement que <see cref="BankStatementImportErrorCodes.Disabled"/>). Le doublon de fichier reste le
/// code existant <see cref="BankStatementImportErrorCodes.AlreadyImported"/> (409).
/// </summary>
public static class BankStatementTabularErrorCodes
{
    private const string Prefix = "bank_statement_import.";

    public const string TabularDisabled = Prefix + "tabular_disabled";
    public const string TabularUnreadable = Prefix + "tabular_unreadable";
    public const string TabularMappingInvalid = Prefix + "tabular_mapping_invalid";
    public const string TabularNoLines = Prefix + "tabular_no_lines";
    public const string TabularTooManyRows = Prefix + "tabular_too_many_rows";
    public const string TabularRejected = Prefix + "tabular_rejected";
}
