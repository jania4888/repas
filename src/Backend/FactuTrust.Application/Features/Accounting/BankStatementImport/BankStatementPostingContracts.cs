using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.Accounting.BankStatementImport;

/// <summary>
/// Comptabilisation assistée d'un relevé enregistré : propositions par ligne (lecture seule),
/// classification IA des libellés inconnus, génération des brouillons (une écriture par ligne).
/// </summary>
public interface IBankStatementPostingService
{
    /// <summary>
    /// Propositions ligne par ligne. <paramref name="options"/> par défaut (<c>None</c>) : sortie
    /// IDENTIQUE au comportement historique (ni historique de comptabilisation, ni repli 471).
    /// </summary>
    Task<Result<BankStatementProposalsDto>> GetProposalsAsync(Guid statementId, BankProposalOptions? options = null, CancellationToken cancellationToken = default);

    /// <summary>Classe par l'IA un lot de libellés DISTINCTS encore inconnus (résultats mis en cache).</summary>
    Task<Result<BankStatementAiClassificationResult>> ClassifyWithAiAsync(Guid statementId, CancellationToken cancellationToken = default);

    /// <summary>Génère les brouillons demandés ; montants, dates et sens relus en base, jamais pris dans la requête.</summary>
    Task<Result<GenerateBankStatementEntriesResult>> GenerateAsync(Guid statementId, GenerateBankStatementEntriesRequest request, CancellationToken cancellationToken = default);

    /// <summary>Historique paginé des relevés comptabilisés par ce parcours (hors import par rapprochement).</summary>
    Task<Result<PagedResult<BankStatementImportHistoryItemDto>>> GetHistoryAsync(int page, int pageSize, Guid? bankAccountId, CancellationToken cancellationToken = default);
}

/// <summary>
/// Options d'assistance des propositions (étape « historique » + repli 471). Par défaut
/// (<see cref="None"/>), aucune des deux n'est activée : sortie IDENTIQUE au comportement
/// historique — contrat de non-régression explicite (plan §3.9).
/// </summary>
public sealed record BankProposalOptions
{
    public static readonly BankProposalOptions None = new();
    public static readonly BankProposalOptions Full = new() { IncludeHistory = true, SuspenseFallback = true };

    /// <summary>Propose la contrepartie majoritaire déjà utilisée pour un libellé/sens proches (étape 3, avant l'IA).</summary>
    public bool IncludeHistory { get; init; }

    /// <summary>Replie sur le compte d'attente 471 quand le compte reste introuvable (jamais créé).</summary>
    public bool SuspenseFallback { get; init; }
}

public static class BankLineStatuses
{
    /// <summary>Une écriture a déjà été générée depuis cette ligne (brouillon ou validée).</summary>
    public const string Generated = "Generated";

    /// <summary>La ligne est rapprochée d'une écriture.</summary>
    public const string Reconciled = "Reconciled";

    /// <summary>Une écriture existante (paiement saisi, paie, CNSS…) correspond : aucune écriture à créer.</summary>
    public const string AlreadyPosted = "AlreadyPosted";

    /// <summary>Plusieurs écritures existantes pourraient correspondre : à trancher, rien n'est créé par défaut.</summary>
    public const string Ambiguous = "Ambiguous";

    /// <summary>La même opération figure déjà dans un autre relevé enregistré du même compte.</summary>
    public const string AlreadyImported = "AlreadyImported";

    /// <summary>Période close ou exercice verrouillé, compte désactivé.</summary>
    public const string Blocked = "Blocked";

    public const string Proposed = "Proposed";

    /// <summary>Compte ou tiers à compléter avant génération.</summary>
    public const string ToComplete = "ToComplete";
}

public static class BankLineConfidences
{
    public const string Certain = "Certain";
    public const string Probable = "Probable";
    public const string ToCheck = "ToCheck";
}

public static class BankLineSources
{
    public const string ExistingEntry = "ExistingEntry";
    public const string DossierRule = "DossierRule";
    public const string Catalog = "Catalog";
    public const string ThirdPartyMatch = "ThirdPartyMatch";
    public const string Ai = "Ai";

    /// <summary>Contrepartie déjà utilisée pour ce libellé / ce sens dans l'historique du compte (assist=full).</summary>
    public const string History = "History";

    /// <summary>Repli sur le compte d'attente 471 (assist=full), jamais pré-coché par hasard : à reclasser.</summary>
    public const string Fallback = "Fallback";
}

public sealed record BankStatementProposalsDto
{
    public Guid StatementId { get; init; }
    public Guid? BankAccountId { get; init; }
    public string BankName { get; init; } = string.Empty;
    public string? BankGlAccount { get; init; }
    public DateTime PeriodStart { get; init; }
    public DateTime PeriodEnd { get; init; }
    public decimal OpeningBalance { get; init; }
    public decimal ClosingBalance { get; init; }
    public IReadOnlyList<BankLineProposalDto> Lines { get; init; } = Array.Empty<BankLineProposalDto>();

    /// <summary>Libellés distincts sans proposition, que l'IA peut encore classer.</summary>
    public int UnclassifiedDistinctLabels { get; init; }
}

public sealed record BankLineProposalDto
{
    public Guid LineId { get; init; }
    public DateTime TransactionDate { get; init; }
    public DateTime? ValueDate { get; init; }
    public string Label { get; init; } = string.Empty;
    public string Reference { get; init; } = string.Empty;
    public decimal Amount { get; init; }
    public bool IsDebit { get; init; }
    public bool IsReconciled { get; init; }

    public string Status { get; init; } = BankLineStatuses.ToComplete;
    public string? Confidence { get; init; }
    public string? Source { get; init; }
    public string Explanation { get; init; } = string.Empty;

    public string? AccountNumber { get; init; }
    public string? AccountLabel { get; init; }

    /// <summary>« found », « inactive », « missing » ou « none » (aucun compte proposé).</summary>
    public string AccountStatus { get; init; } = "none";

    public Guid? ThirdPartyId { get; init; }
    public ThirdPartyKind ThirdPartyKind { get; init; }
    public string? ThirdPartyName { get; init; }

    /// <summary>Le compte proposé est un compte collectif : un tiers est obligatoire.</summary>
    public bool RequiresThirdParty { get; init; }

    public BankLineVatSplitDto? VatSplit { get; init; }
    public BankLineEntryRefDto? ExistingEntry { get; init; }
    public BankLineEntryRefDto? GeneratedEntry { get; init; }
    public int CandidateCount { get; init; }
    public IReadOnlyList<BankLineDiagnosticDto> Diagnostics { get; init; } = Array.Empty<BankLineDiagnosticDto>();

    /// <summary>Pré-cochée pour la génération (proposition sûre, rien à compléter).</summary>
    public bool SelectedByDefault { get; init; }
}

/// <param name="Implied">TVA déduite du taux (non imprimée) plutôt que lue (« DONT TVA »).</param>
public sealed record BankLineVatSplitDto(decimal NetAmount, decimal VatAmount, string VatAccountNumber, bool Implied);

public sealed record BankLineEntryRefDto(Guid JournalEntryId, Guid? JournalEntryLineId, string Reference, DateTime EntryDate, bool IsDraft);

public sealed record BankLineDiagnosticDto(string Code, string Severity, string Message);

public sealed record BankStatementAiClassificationResult(int Classified, int Remaining, string? ProviderKind);

public sealed record GenerateBankStatementEntriesRequest
{
    public string JournalCode { get; init; } = "JB";
    public IReadOnlyList<GenerateBankStatementEntryItem> Items { get; init; } = Array.Empty<GenerateBankStatementEntryItem>();

    /// <summary>Génération tout ou rien : voir <see cref="BankStatementPostingErrorCodes"/> (atomic_*).</summary>
    public bool Atomic { get; init; }

    /// <summary>Active l'historique + le repli 471 dans les propositions utilisées par la génération (voir <see cref="BankProposalOptions"/>).</summary>
    public bool Assist { get; init; }

    /// <summary>Lignes du relevé explicitement exclues de cette génération (choix délibéré de l'utilisateur, mode atomique).</summary>
    public IReadOnlyList<Guid> ExcludedLineIds { get; init; } = Array.Empty<Guid>();
}

public sealed record GenerateBankStatementEntryItem
{
    public Guid LineId { get; init; }
    public string AccountNumber { get; init; } = string.Empty;
    public Guid? ThirdPartyId { get; init; }
    public ThirdPartyKind ThirdPartyKind { get; init; }

    /// <summary>Ventilation HT / TVA (commission TVA comprise) ; le montant de TVA est contrôlé côté serveur.</summary>
    public decimal? VatAmount { get; init; }

    public string? VatAccountNumber { get; init; }

    /// <summary>Libellé d'écriture (par défaut : libellé bancaire).</summary>
    public string? Label { get; init; }

    /// <summary>Mémoriser l'affectation comme règle du dossier.</summary>
    public bool RememberRule { get; init; }
}

public sealed record GenerateBankStatementEntriesResult
{
    public int Created { get; init; }
    public int Skipped { get; init; }
    public int Failed { get; init; }
    public int? FirstEntryNumber { get; init; }
    public int? LastEntryNumber { get; init; }
    public IReadOnlyList<GenerateBankStatementLineOutcome> Outcomes { get; init; } = Array.Empty<GenerateBankStatementLineOutcome>();

    /// <summary>Génération tout ou rien demandée (reflète <c>GenerateBankStatementEntriesRequest.Atomic</c>).</summary>
    public bool Atomic { get; init; }

    /// <summary>
    /// En mode atomique : <c>true</c> si les écritures ont été écrites, <c>false</c> si la
    /// transaction a été annulée (pré-validation en échec ou conflit de concurrence) — alors
    /// <see cref="Outcomes"/> détaille chaque ligne (« failed »/code, ou « ready ») et
    /// <see cref="Code"/> porte le code de rejet. Toujours <c>true</c> hors mode atomique.
    /// </summary>
    public bool Committed { get; init; } = true;

    /// <summary>Code de rejet atomique (<c>atomic_rejected</c> / <c>atomic_conflict</c>) quand <see cref="Committed"/> est faux.</summary>
    public string? Code { get; init; }
}

/// <param name="Outcome">« created », « already_posted », « excluded », « ready », « failed ».</param>
public sealed record GenerateBankStatementLineOutcome(Guid LineId, string Outcome, string? Code, string? Message, Guid? JournalEntryId, int? EntryNumber);

/// <summary>Un relevé comptabilisé par ce parcours (hors import par rapprochement) — historique.</summary>
public sealed record BankStatementImportHistoryItemDto
{
    public Guid Id { get; init; }
    public string BankName { get; init; } = string.Empty;
    public string MaskedRib { get; init; } = "????";
    public DateTime PeriodStart { get; init; }
    public DateTime PeriodEnd { get; init; }
    public int LineCount { get; init; }
    public int PostedCount { get; init; }
    public BankStatementImportMethod ImportMethod { get; init; }
    public DateTime ImportedAt { get; init; }
    public string? ImportedBy { get; init; }
}

/// <summary>Codes d'erreur stables de la comptabilisation assistée.</summary>
public static class BankStatementPostingErrorCodes
{
    public const string StatementNotFound = "bank_statement_posting.statement_not_found";
    public const string StatementWithoutGlAccount = "bank_statement_posting.statement_without_gl_account";
    public const string DraftsDisabled = "bank_statement_posting.drafts_disabled";
    public const string TooManyItems = "bank_statement_posting.too_many_items";
    public const string JournalInvalid = "bank_statement_posting.journal_invalid";
    public const string LineNotFound = "bank_statement_posting.line_not_found";
    public const string AlreadyPosted = "bank_statement_posting.already_posted";
    public const string AccountInvalid = "bank_statement_posting.account_invalid";
    public const string ThirdPartyRequired = "bank_statement_posting.third_party_required";
    public const string ThirdPartyInvalid = "bank_statement_posting.third_party_invalid";
    public const string VatInvalid = "bank_statement_posting.vat_invalid";
    public const string PeriodClosed = "bank_statement_posting.period_closed";
    public const string AiUnavailable = "bank_statement_posting.ai_unavailable";

    /// <summary>Génération atomique : plus de lignes que <c>MaxAtomicGenerationLines</c> ; scinder par période.</summary>
    public const string AtomicTooManyLines = "bank_statement_posting.atomic_too_many_lines";

    /// <summary>Génération atomique : une ligne non réglée du relevé n'est ni soumise, ni explicitement exclue.</summary>
    public const string AtomicIncomplete = "bank_statement_posting.atomic_incomplete";

    /// <summary>Génération atomique : la pré-validation a trouvé au moins un échec ; rien n'a été écrit.</summary>
    public const string AtomicRejected = "bank_statement_posting.atomic_rejected";

    /// <summary>Génération atomique : conflit de concurrence (verrou non obtenu ou index unique violé).</summary>
    public const string AtomicConflict = "bank_statement_posting.atomic_conflict";
}
