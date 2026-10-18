namespace FactuTrust.Application.DTOs;

/// <summary>
/// Tableau de bord comptable d'un dossier, affiché à l'ouverture d'un dossier délégué par le
/// cabinet (<c>GET /api/accounting/dashboard/overview</c>). Distinct de
/// <see cref="AccountingDashboardDto"/> (dashboard historique de l'entreprise), qui reste inchangé.
/// </summary>
public sealed record AccountingOverviewDashboardDto
{
    public int FiscalYear { get; init; }
    public int Month { get; init; }
    public DateTime PeriodStart { get; init; }
    public DateTime PeriodEnd { get; init; }
    /// <summary>Libellé fr-FR capitalisé de la période, ex. « Octobre 2026 ».</summary>
    public string PeriodLabel { get; init; } = null!;
    /// <summary>Fenêtre de comparaison : <c>previous-month</c> ou <c>previous-year</c>.</summary>
    public string Comparison { get; init; } = null!;
    public int ComparisonFiscalYear { get; init; }
    public int ComparisonMonth { get; init; }
    public string ComparisonLabel { get; init; } = null!;
    public string Currency { get; init; } = "TND";
    public DateTime GeneratedAt { get; init; }
    /// <summary>Faux quand aucune écriture validée ne porte sur le mois sélectionné (état vide côté UI).</summary>
    public bool HasEntriesInPeriod { get; init; }
    /// <summary>Exercices sélectionnables (années ayant des écritures validées ∪ année courante), décroissants.</summary>
    public IReadOnlyList<int> AvailableYears { get; init; } = Array.Empty<int>();

    public OverviewKpiDto TotalRevenue { get; init; } = null!;
    public OverviewKpiDto TotalExpenses { get; init; } = null!;
    public OverviewKpiDto NetResult { get; init; } = null!;
    public OverviewKpiDto AvailableCash { get; init; } = null!;

    public IReadOnlyList<MonthlyRevenuePointDto> RevenueByMonth { get; init; } = Array.Empty<MonthlyRevenuePointDto>();
    public IReadOnlyList<MonthlyNetResultPointDto> NetResultByMonth { get; init; } = Array.Empty<MonthlyNetResultPointDto>();
    public IReadOnlyList<ExpenseCategoryDto> ExpenseBreakdown { get; init; } = Array.Empty<ExpenseCategoryDto>();
    public IReadOnlyList<MainAccountRowDto> MainAccounts { get; init; } = Array.Empty<MainAccountRowDto>();

    /// <summary>Situation clients (411) à la date du jour ; null si la balance âgée n'a pas pu être calculée.</summary>
    public ThirdPartySituationDto? Clients { get; init; }
    /// <summary>Situation fournisseurs (401) à la date du jour ; null si la balance âgée n'a pas pu être calculée.</summary>
    public ThirdPartySituationDto? Suppliers { get; init; }

    public IReadOnlyList<RecentJournalEntryDto> RecentEntries { get; init; } = Array.Empty<RecentJournalEntryDto>();
    public IReadOnlyList<UpcomingFiscalDeadlineDto> UpcomingDeadlines { get; init; } = Array.Empty<UpcomingFiscalDeadlineDto>();
    public IReadOnlyList<RecentDocumentDto> RecentDocuments { get; init; } = Array.Empty<RecentDocumentDto>();
    /// <summary>Avertissements non bloquants (ex. balance âgée indisponible).</summary>
    public IReadOnlyList<string> Warnings { get; init; } = Array.Empty<string>();
}

/// <summary>KPI du mois sélectionné, sa valeur sur la fenêtre de comparaison et sa variation.</summary>
public sealed record OverviewKpiDto
{
    public decimal Current { get; init; }
    public decimal Previous { get; init; }
    public decimal DeltaAbsolute { get; init; }
    /// <summary>Variation en % (1 décimale) ; null quand la valeur précédente est nulle.</summary>
    public decimal? DeltaPercent { get; init; }
}

/// <summary>Point mensuel du chiffre d'affaires (comptes 70), exercice courant vs exercice précédent.</summary>
public sealed record MonthlyRevenuePointDto
{
    public int Month { get; init; }
    public string Label { get; init; } = null!;
    public decimal Current { get; init; }
    public decimal PreviousYear { get; init; }
}

/// <summary>Point mensuel produits / charges / résultat net de l'exercice courant.</summary>
public sealed record MonthlyNetResultPointDto
{
    public int Month { get; init; }
    public string Label { get; init; } = null!;
    public decimal Revenue { get; init; }
    public decimal Expenses { get; init; }
    public decimal NetResult { get; init; }
}

/// <summary>Part d'une famille de charges (classe 6) dans le mois sélectionné.</summary>
public sealed record ExpenseCategoryDto
{
    public string Key { get; init; } = null!;
    public string Label { get; init; } = null!;
    public decimal Amount { get; init; }
    /// <summary>Part en % du total des charges du mois (1 décimale) ; 0 quand le total est nul.</summary>
    public decimal Percent { get; init; }
}

/// <summary>Ligne du suivi des comptes principaux (plan NCT) ; solde en signe brut débit − crédit.</summary>
public sealed record MainAccountRowDto
{
    public string AccountPrefix { get; init; } = null!;
    public string Label { get; init; } = null!;
    /// <summary><c>Debit</c> ou <c>Credit</c> : nature attendue du solde.</summary>
    public string Nature { get; init; } = null!;
    public decimal Balance { get; init; }
    public decimal PreviousBalance { get; init; }
    public decimal DeltaAbsolute { get; init; }
    public decimal? DeltaPercent { get; init; }
    /// <summary>Soldes de fin de mois de janvier au mois sélectionné.</summary>
    public IReadOnlyList<decimal> Sparkline { get; init; } = Array.Empty<decimal>();
}

/// <summary>Situation clients ou fournisseurs à la date du jour, agrégée depuis la balance âgée.</summary>
public sealed record ThirdPartySituationDto
{
    public DateTime AsOf { get; init; }
    public decimal Total { get; init; }
    public decimal NotDue { get; init; }
    public decimal Overdue { get; init; }
    public int ThirdPartyCount { get; init; }
}

/// <summary>Écriture récente listée au tableau de bord.</summary>
public sealed record RecentJournalEntryDto
{
    public Guid Id { get; init; }
    public DateTime EntryDate { get; init; }
    public string JournalCode { get; init; } = null!;
    public int EntryNumber { get; init; }
    public string? PieceRef { get; init; }
    public string Label { get; init; } = null!;
    public decimal TotalDebit { get; init; }
    public decimal TotalCredit { get; init; }
    public bool IsReversed { get; init; }
}

/// <summary>Échéance fiscale ou sociale à venir (non annulée, non payée, à partir d'aujourd'hui).</summary>
public sealed record UpcomingFiscalDeadlineDto
{
    public Guid Id { get; init; }
    public int ObligationType { get; init; }
    public string ObligationLabel { get; init; } = null!;
    public DateTime DueDate { get; init; }
    public int DaysRemaining { get; init; }
    public decimal EstimatedAmount { get; init; }
    public string Currency { get; init; } = "TND";
    public int Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
}

/// <summary>
/// Document récent : pièce jointe d'écriture (<c>journal-entry</c>) ou d'échéance fiscale
/// (<c>fiscal-schedule</c>). Le chemin de stockage n'est jamais exposé ; seul le chemin de
/// téléchargement relatif à l'API (protégé par <c>AccountingRead</c>) est renvoyé.
/// </summary>
public sealed record RecentDocumentDto
{
    public Guid Id { get; init; }
    public string Source { get; init; } = null!;
    public Guid OwnerId { get; init; }
    public string OwnerLabel { get; init; } = null!;
    public string FileName { get; init; } = null!;
    public string ContentType { get; init; } = null!;
    public long SizeBytes { get; init; }
    public DateTime CreatedAt { get; init; }
    public string DownloadPath { get; init; } = null!;
}
