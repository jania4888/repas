using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

public interface IJournalEntryRepository
{
    /// <summary>
    /// Charge une écriture SUIVIE (avec lignes + période) dans un contexte unique, applique la mutation
    /// domaine puis persiste. Nécessaire pour les mutations qui reconfigurent les lignes (ex. édition de
    /// brouillon) : le suivi de modifications supprime correctement les anciennes lignes et insère les
    /// nouvelles. Retourne NotFound si l'écriture n'existe pas, sinon le résultat de la mutation.
    /// </summary>
    Task<Result> MutateAsync(Guid id, Func<JournalEntry, Result> mutate, CancellationToken cancellationToken = default);
    Task<JournalEntry?> GetBySourceAsync(string sourceEntityType, Guid sourceEntityId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Comme <see cref="GetBySourceAsync"/>, mais ignore les écritures extournées et rend la plus
    /// récente. Indispensable dès qu'une même source peut porter plusieurs écritures successives
    /// (cycle de paie rouvert puis revalidé) : <see cref="GetBySourceAsync"/> est un
    /// <c>FirstOrDefault</c> sans tri et deviendrait alors non déterministe.
    /// </summary>
    Task<JournalEntry?> GetActiveBySourceAsync(string sourceEntityType, Guid sourceEntityId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Vrai s'il existe au moins une écriture NON extournée (<c>!IsReversed</c>) portant ce
    /// <paramref name="sourceEntityType"/>, quel que soit le <c>SourceEntityId</c>. Utilisé pour
    /// détecter l'existence d'un cycle de paie comptabilisé (dossier, pas mois précis) et router
    /// le décaissement « Salaires nets » vers 425 (dette déjà constatée) plutôt que 640.
    /// </summary>
    Task<bool> ExistsActiveBySourceTypeAsync(string sourceEntityType, CancellationToken cancellationToken = default);

    /// <summary>
    /// Toutes les écritures NON extournées (<c>!IsReversed</c>) dont le <c>SourceEntityType</c> figure
    /// dans <paramref name="sourceTypes"/>, avec leurs lignes, triées par date d'écriture puis numéro.
    /// Lecture seule utilisée par le diagnostic de conformité paie (plan §5.4) : inventaire des
    /// imputations erronées, détection des doublons actifs par source, cycles sans écriture.
    /// </summary>
    Task<IReadOnlyList<JournalEntry>> ListActiveBySourceTypesAsync(
        IReadOnlyCollection<string> sourceTypes,
        CancellationToken cancellationToken = default);

    Task<JournalEntry?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// À appeler UNIQUEMENT dans une transaction ambiante (<see cref="FactuTrust.Application.Common.Interfaces.ITenantUnitOfWork"/>) :
    /// verrouille la ligne d'écriture ET ses lignes jusqu'au commit avec <c>XLOCK, HOLDLOCK</c>
    /// (verrou exclusif). Les décisions prises sur le résultat (garde-fous, codes de lettrage,
    /// totaux avant modification) doivent l'être sur cette lecture verrouillée, jamais sur
    /// <see cref="GetByIdAsync"/>.
    ///
    /// Pourquoi XLOCK et pas UPDLOCK : UPDLOCK (verrou U) est compatible avec les verrous partagés
    /// (S). Or les concurrents à sérialiser (la lecture de décision de
    /// <c>ValidateJournalEntryCommandHandler</c>, la validation des lignes de
    /// <c>LetteringService.ManualLetterAsync</c>) exécutent des LECTURES ORDINAIRES avant d'écrire.
    /// Sous UPDLOCK, ces lectures passeraient pendant notre transaction : la validation sauverait
    /// ensuite un graphe périmé (exception de concurrence EF sur des lignes supprimées, ou
    /// réécriture de scalaires périmés), et le lettrage pourrait deadlocker sur escalade de verrou
    /// après avoir lu les anciennes lignes sous S. XLOCK (verrou X, incompatible avec S) force ces
    /// lectures concurrentes à ATTENDRE notre commit/rollback, puis à relire l'état commité pour
    /// décider sur des données fraîches.
    ///
    /// Suppose un niveau d'isolation ReadCommitted VERROUILLANT (pas de
    /// <c>READ_COMMITTED_SNAPSHOT</c>) : c'est le réglage par défaut de SQL Server / du conteneur
    /// mssql utilisé ; avec le mode snapshot activé, les lecteurs ne seraient plus bloqués par le
    /// verrou (ils liraient leur propre version antérieure au lieu d'attendre).
    ///
    /// Repli sans verrou sur provider non relationnel (InMemory des tests) : comportement
    /// identique à <see cref="GetByIdAsync"/>.
    /// </summary>
    Task<JournalEntry?> GetByIdForUpdateAsync(Guid id, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<JournalEntry>> GetDraftsByPeriodAsync(Guid periodId, string? journalCode, CancellationToken cancellationToken = default);
    Task<int> CountDraftsAsync(CancellationToken cancellationToken = default);
    Task<int> CountDraftsByFiscalYearAsync(int fiscalYear, CancellationToken cancellationToken = default);
    /// <summary>
    /// Positions ouvertes en devise à une date donnée, agrégées par compte et par devise.
    ///
    /// <para>
    /// Ne retient que les comptes <b>monétaires</b> (classes 4 et 5 : tiers et trésorerie) : ce sont
    /// les seuls que la réévaluation de clôture concerne. Les lignes déjà lettrées sont exclues —
    /// une opération soldée n'a plus de position à réévaluer.
    /// </para>
    ///
    /// <para>
    /// Les positions sont exprimées en <b>débit net</b> (débits − crédits), dans la devise et en
    /// devise de tenue : une créance donne un montant positif, une dette un montant négatif.
    /// </para>
    /// </summary>
    Task<IReadOnlyList<(string AccountNumber, string CurrencyCode, decimal NetInCurrency, decimal NetFunctional)>>
        GetOpenForeignCurrencyPositionsAsync(DateTime asOf, CancellationToken cancellationToken = default);

    /// <summary>
    /// Lignes désignées, avec leur écriture (donc leur devise de transaction). Lecture seule ;
    /// rejoint la transaction ambiante si elle existe.
    /// </summary>
    Task<IReadOnlyList<JournalEntryLine>> GetLinesByIdsAsync(IReadOnlyList<Guid> lineIds, CancellationToken cancellationToken = default);

    Task<JournalEntry> AddAsync(JournalEntry entity, CancellationToken cancellationToken = default);
    Task UpdateAsync(JournalEntry entity, CancellationToken cancellationToken = default);
    Task RemoveAsync(JournalEntry entity, CancellationToken cancellationToken = default);
    Task<int> ReserveNextEntryNumberAsync(string journalCode, int fiscalYear, CancellationToken cancellationToken = default);
    Task<decimal> SumDebitsByAccountAsync(string accountNumber, DateTime from, DateTime to, CancellationToken cancellationToken = default);

    /// <summary>
    /// Somme des débits sur un compte ou ses sous-comptes (préfixe). Consommé par la déclaration
    /// mensuelle (assiette RS loyers 613) : brouillons exclus, comme <see cref="SumDebitsByAccountAsync"/>.
    /// </summary>
    Task<decimal> SumDebitsByAccountPrefixAsync(string accountPrefix, DateTime from, DateTime to, CancellationToken cancellationToken = default);

    /// <summary>
    /// Débits ET crédits agrégés par compte sur une période, pour un ENSEMBLE de comptes exacts et
    /// de racines, en UNE seule requête. Brouillons et extournes exclus : c'est une sortie légale,
    /// pas un état de consultation.
    /// </summary>
    /// <param name="exactAccounts">Numéros à rapprocher à l'identique.</param>
    /// <param name="accountPrefixes">Racines : le compte et toute sa descendance.</param>
    /// <returns>
    /// Mouvement par numéro de compte <b>réellement rencontré</b> : un compte demandé mais sans
    /// mouvement sur la période est simplement absent du dictionnaire, il ne vaut pas zéro par
    /// défaut — c'est à l'appelant de distinguer « pas de mouvement » de « compte inexistant ».
    /// </returns>
    /// <remarks>
    /// Une seule requête, quel que soit le nombre de rubriques : l'appelant réunit les comptes de
    /// toutes les rubriques avant d'appeler. Découper par rubrique ramènerait une requête par ligne
    /// de déclaration, soit une centaine d'allers-retours pour un seul calcul.
    /// </remarks>
    Task<IReadOnlyDictionary<string, AccountPeriodMovement>> SumMovementsByAccountsAsync(
        IReadOnlyCollection<string> exactAccounts,
        IReadOnlyCollection<string> accountPrefixes,
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Mouvements de TVA caisse comptabilisés sur la période, en montants SIGNÉS :
    /// écritures SourceEntityType="CashOperation" (Y COMPRIS extournées) portant du 436711,
    /// PLUS leurs extournes manuelles (SourceEntityType="ManualReversal" dont ReversesEntryId
    /// référence une écriture caisse). Par taux : Σ(crédits − débits) sur 436711 et 707.
    /// Peut être NÉGATIF sur la période où une extourne est passée.
    /// </summary>
    Task<IReadOnlyList<CashSaleVatPosting>> GetPostedCashSaleVatByRateAsync(
        DateTime from, DateTime to, CancellationToken cancellationToken = default);
}

/// <summary>
/// Mouvement de TVA caisse agrégé par taux, tel que réellement comptabilisé (cf.
/// <see cref="IJournalEntryRepository.GetPostedCashSaleVatByRateAsync"/>). <see cref="HtBase"/> et
/// <see cref="VatAmount"/> peuvent être négatifs (période portant une extourne).
/// </summary>
public sealed record CashSaleVatPosting(int RatePercent, decimal HtBase, decimal VatAmount);
