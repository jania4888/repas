using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Services;

public interface IAccountingReportingService
{
    Task<Result<IReadOnlyList<ChartOfAccountDto>>> GetChartOfAccountsAsync(CancellationToken cancellationToken = default);
    /// <param name="take">
    /// Nombre maximum de pièces, après le tri date/numéro décroissant.
    /// Nul : toute la période (journal, export, archive). Borné de 1 à 30.
    /// </param>
    Task<Result<IReadOnlyList<JournalEntryDto>>> GetJournalEntriesAsync(
        string? journalCode,
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default,
        int? take = null);

    /// <summary>
    /// Charge une écriture par identifiant (lignes + nombre de PJ). Indépendant de la politique
    /// brouillard des états : une pièce en brouillon reste accessible pour l'écran d'édition.
    /// </summary>
    Task<Result<JournalEntryDto>> GetJournalEntryByIdAsync(
        Guid id, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<LedgerRowDto>>> GetLedgerAsync(
        string accountNumber,
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Grand livre général : les comptes d'une plage restitués en séquence, chacun avec son report
    /// à nouveau, ses mouvements (solde progressif démarré au report), ses totaux et son solde de
    /// clôture. <paramref name="accountFrom"/>/<paramref name="accountTo"/> nuls = tous les comptes ;
    /// <paramref name="includeUnmoved"/> conserve les comptes sans mouvement mais avec un report.
    /// </summary>
    Task<Result<GeneralLedgerDto>> GetLedgerRangeAsync(
        string? accountFrom,
        string? accountTo,
        DateTime from,
        DateTime to,
        bool includeUnmoved = false,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Récapitulatif du grand livre : soldes agrégés par racine de compte à <paramref name="level"/>
    /// chiffres (1 = classe, 2 = sous-classe…). Même source et mêmes règles que la balance générale.
    /// </summary>
    Task<Result<IReadOnlyList<BalanceRowDto>>> GetLedgerRecapAsync(
        int level,
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<BalanceRowDto>>> GetBalanceAsync(
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default);
    /// <summary>
    /// Balance détaillée : la balance générale, chaque compte suivi du détail de ses mouvements.
    /// Composition de <see cref="GetBalanceAsync"/> et <see cref="GetLedgerRangeAsync"/>.
    /// </summary>
    Task<Result<DetailedBalanceDto>> GetDetailedBalanceAsync(
        string? accountFrom,
        string? accountTo,
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Balance par période : un exercice ventilé en 12 colonnes mensuelles, ouverture ancrée sur
    /// l'à-nouveau de l'exercice quand il existe.
    /// </summary>
    Task<Result<PeriodicBalanceDto>> GetBalanceByPeriodAsync(
        int fiscalYear,
        CancellationToken cancellationToken = default);

    Task<Result<AccountingDashboardDto>> GetDashboardAsync(CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<AccountingPeriodDto>>> GetPeriodsAsync(CancellationToken cancellationToken = default);
    Task<Result<BalanceSheetDto>> GetBalanceSheetAsync(int fiscalYear, CancellationToken cancellationToken = default);
    Task<Result<IncomeStatementDto>> GetIncomeStatementAsync(int fiscalYear, CancellationToken cancellationToken = default);

    /// <summary>Liasse NCT (bilan + résultat structurés + flux + variation capitaux + notes), sur écritures validées, avec comparatif N-1.</summary>
    Task<Result<NctFinancialStatementsDto>> GetNctStatementsAsync(int fiscalYear, CancellationToken cancellationToken = default);

    /// <summary>
    /// Balance auxiliaire : une ligne par tiers (client ou fournisseur) — ouverture, mouvements,
    /// clôture — à partir des lignes d'écriture portant un ThirdPartyId. Brouillons inclus selon
    /// la politique de consultation.
    /// </summary>
    Task<Result<IReadOnlyList<AuxiliaryBalanceRowDto>>> GetAuxiliaryBalanceAsync(
        ThirdPartyKind kind, DateTime from, DateTime to, CancellationToken cancellationToken = default);

    /// <summary>Grand livre d'un tiers : solde d'ouverture + mouvements avec solde progressif.</summary>
    Task<Result<ThirdPartyLedgerDto>> GetThirdPartyLedgerAsync(
        Guid thirdPartyId, ThirdPartyKind kind, DateTime from, DateTime to, CancellationToken cancellationToken = default);

    /// <summary>
    /// Récapitulatifs de journaux sur une période : centralisateur (journaux × mois),
    /// récapitulation (journaux × comptes) ou totaux journaux. Les sous-totaux par journal et le
    /// total général sont toujours calculés, quel que soit l'axe. Même politique brouillard que le
    /// journal (consultation).
    /// </summary>
    Task<Result<JournalSummaryDto>> GetJournalSummaryAsync(
        DateTime from, DateTime to, JournalSummaryGrouping grouping,
        string? journalCode = null, CancellationToken cancellationToken = default);

    /// <summary>Recherche multicritère de lignes d'écriture (compte, journal, période, montant, libellé, lettrage, statut, réf. pièce).</summary>
    Task<Result<IReadOnlyList<JournalSearchRowDto>>> SearchJournalEntriesAsync(
        string? accountNumber, string? journalCode, DateTime? from, DateTime? to,
        decimal? minAmount, decimal? maxAmount, string? label, string? letteringCode, int? status, int take,
        string? pieceRef = null,
        int? entryNumber = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// État budgétaire : budget (Initial/Révisé) vs réalisé par poste sur un exercice, avec détail
    /// mensuel, cumuls jusqu'au mois demandé, écart et % de consommation. Le réalisé affecte chaque
    /// compte au poste dont le préfixe correspondant est le plus long (compté une seule fois) ; les
    /// comptes des classes 6/7 non couverts alimentent des lignes « Hors postes ».
    /// </summary>
    Task<Result<BudgetReportDto>> GetBudgetReportAsync(
        int fiscalYear, int? throughMonth, CancellationToken cancellationToken = default);
}
