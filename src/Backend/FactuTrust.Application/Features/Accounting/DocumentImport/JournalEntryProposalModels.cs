namespace FactuTrust.Application.Features.Accounting.DocumentImport;

/// <summary>Sens de la pièce du point de vue du dossier comptable.</summary>
public static class DocumentDirections
{
    public const string Sale = "SALE";
    public const string Purchase = "PURCHASE";
}

/// <summary>État d'un compte proposé vis-à-vis du plan comptable du dossier.</summary>
public static class ProposedAccountStatuses
{
    public const string Found = "found";
    public const string Inactive = "inactive";
    public const string Missing = "missing";
}

/// <summary>Rôle d'une ligne proposée, pour l'affichage et le regroupement.</summary>
public static class ProposedLineRoles
{
    public const string ThirdParty = "thirdparty";
    public const string Revenue = "revenue";
    public const string Expense = "expense";
    public const string Vat = "vat";
    public const string Fodec = "fodec";
    public const string Stamp = "stamp";
}

public static class ProposalSeverities
{
    public const string Info = "info";
    public const string Warning = "warning";
    /// <summary>Empêche l'application de la proposition tant que l'utilisateur n'a pas tranché.</summary>
    public const string Blocking = "blocking";
}

public static class ProposalDiagnosticCodes
{
    public const string AccountMissing = "AccountMissing";
    public const string AccountInactive = "AccountInactive";
    public const string TotalsMismatch = "TotalsMismatch";
    public const string VatBreakdownRecomputed = "VatBreakdownRecomputed";
    public const string ThirdPartyNotMatched = "ThirdPartyNotMatched";
    public const string DirectionAmbiguous = "DirectionAmbiguous";
    public const string PeriodClosed = "PeriodClosed";
    public const string FutureDate = "FutureDate";
    public const string AlreadyPosted = "AlreadyPosted";
    public const string DuplicatePieceRef = "DuplicatePieceRef";
    public const string DocumentNotInvoice = "DocumentNotInvoice";
    public const string WithholdingIgnored = "WithholdingIgnored";
    public const string ExtractionWarning = "ExtractionWarning";
    public const string MissingIssueDate = "MissingIssueDate";

    // Rapprochement tiers/compte auxiliaire par matricule fiscal (plan « Matricule fiscal sur les
    // comptes auxiliaires et rattachement à l'import de facture », §4.3) : avertissements seulement,
    // ne bloquent jamais l'application de la proposition. Volontairement absents du
    // CLIENT_RECALC_DIAGNOSTIC_CODES front : un recalcul client ne doit pas effacer un texte serveur
    // qui cite des numéros de compte déterminés côté serveur.
    /// <summary>Compte auxiliaire ou fiche rattaché par similarité de nom (pas par matricule fiscal).</summary>
    public const string ThirdPartyMatchedByName = "ThirdPartyMatchedByName";
    /// <summary>Plusieurs comptes auxiliaires ou fiches correspondent au nom : aucun n'a été choisi.</summary>
    public const string ThirdPartyAmbiguous = "ThirdPartyAmbiguous";
    /// <summary>La fiche rapprochée pointe vers un autre compte collectif que l'auxiliaire retenu par MF.</summary>
    public const string ThirdPartyAccountConflict = "ThirdPartyAccountConflict";
}

public sealed record ProposalDiagnosticDto(
    string Severity,
    string Code,
    string Message,
    int? RelatedLineIndex = null);

/// <summary>Tiers rapproché (ou données extraites d'un tiers à créer).</summary>
public sealed record ProposedThirdPartyDto
{
    /// <summary>1 = client, 2 = fournisseur (<c>ThirdPartyKind</c>).</summary>
    public int Kind { get; init; }

    /// <summary>Renseigné uniquement si un tiers existant a été rapproché.</summary>
    public Guid? MatchedId { get; init; }

    public string? MatchedName { get; init; }

    /// <summary>Comment le rapprochement a été obtenu : "nif", "name" ou null.</summary>
    public string? MatchedBy { get; init; }

    /// <summary>Compte collectif retenu (profil comptable du tiers, sinon défaut 4111/4011).</summary>
    public string CollectiveAccountNumber { get; init; } = "";

    /// <summary>Compte auxiliaire rapproché (ex. "40114"), si un compte 401x/411x spécifique a été trouvé.</summary>
    public Guid? MatchedAccountId { get; init; }
    public string? MatchedAccountNumber { get; init; }
    public string? MatchedAccountLabel { get; init; }
    /// <summary>Comment le compte auxiliaire a été rapproché : "nif", "name" ou null.</summary>
    public string? MatchedAccountBy { get; init; }

    // Données extraites de la pièce — servent à pré-remplir la création d'un tiers.
    public string? Name { get; init; }
    public string? Nif { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? Street { get; init; }
    public string? City { get; init; }
    public string? PostalCode { get; init; }
    public string? Governorate { get; init; }
}

public sealed record ProposedLineDto
{
    public string AccountNumber { get; init; } = "";
    public string? AccountLabel { get; init; }
    /// <summary>Voir <see cref="ProposedAccountStatuses"/>.</summary>
    public string AccountStatus { get; init; } = ProposedAccountStatuses.Found;
    /// <summary>Voir <see cref="ProposedLineRoles"/>.</summary>
    public string Role { get; init; } = "";
    public string Label { get; init; } = "";
    public decimal Debit { get; init; }
    public decimal Credit { get; init; }
    /// <summary>Taux de TVA de la ligne, à titre indicatif (non persisté par l'API d'écriture).</summary>
    public int? VatRatePercent { get; init; }
    public Guid? ThirdPartyId { get; init; }
    public int? ThirdPartyKind { get; init; }
}

/// <summary>
/// Proposition d'écriture issue d'une pièce importée. Purement consultative : rien n'est écrit en
/// base. L'enregistrement passe par le chemin existant <c>POST /api/accounting/journal</c>.
/// </summary>
public sealed record JournalEntryProposalDto
{
    /// <summary>"SALE" ou "PURCHASE". Voir <see cref="DocumentDirections"/>.</summary>
    public string Direction { get; init; } = DocumentDirections.Purchase;

    /// <summary>Explication de la détection du sens, affichée à l'utilisateur.</summary>
    public string? DirectionReason { get; init; }

    public string JournalCode { get; init; } = "";
    public DateOnly? EntryDate { get; init; }
    public string Label { get; init; } = "";
    public string? PieceRef { get; init; }
    public DateOnly? PieceDate { get; init; }

    public ProposedThirdPartyDto? ThirdParty { get; init; }

    public IReadOnlyList<ProposedLineDto> Lines { get; init; } = Array.Empty<ProposedLineDto>();

    public decimal TotalDebit { get; init; }
    /// <summary>Égal à <see cref="TotalDebit"/> par construction : la contrepartie est calculée.</summary>
    public decimal TotalCredit { get; init; }

    /// <summary>TTC lu sur la pièce, pour afficher l'écart éventuel avec le total calculé.</summary>
    public decimal? DocumentTotalTtc { get; init; }

    public AccountingDocumentExtractionDto Extraction { get; init; } = new();

    public IReadOnlyList<ProposalDiagnosticDto> Diagnostics { get; init; } = Array.Empty<ProposalDiagnosticDto>();

    /// <summary>Vrai si un diagnostic bloquant interdit l'application de la proposition.</summary>
    public bool HasBlockingDiagnostic =>
        Diagnostics.Any(d => d.Severity == ProposalSeverities.Blocking);
}
