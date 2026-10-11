namespace FactuTrust.Application.DTOs;

/// <summary>Verrouillage définitif (irréversible) d'un exercice.</summary>
public sealed record FiscalYearLockDto
{
    public int FiscalYear { get; init; }
    public DateTime LockedAt { get; init; }
    public string LockedBy { get; init; } = null!;
}

/// <summary>Type d'écriture d'inventaire proposé par l'assistant (catalogue + comptes par défaut).</summary>
public sealed record InventoryEntryKindDto
{
    public int Kind { get; init; }
    public string Label { get; init; } = null!;
    public string DefaultDebitAccount { get; init; } = null!;
    public string DefaultCreditAccount { get; init; } = null!;
    public bool AutoReverse { get; init; }
    public string Hint { get; init; } = null!;
}

/// <summary>Création d'une écriture d'inventaire assistée (+ son extourne planifiée si applicable).</summary>
public sealed record CreateInventoryEntryRequest
{
    public int Kind { get; init; }
    public DateTime EntryDate { get; init; }
    public string DebitAccount { get; init; } = null!;
    public string CreditAccount { get; init; } = null!;
    public decimal Amount { get; init; }
    public string Label { get; init; } = null!;
    /// <summary>Génère l'extourne au 1er de la période suivante. Défaut selon le type.</summary>
    public bool AutoReverse { get; init; }
}

/// <summary>Résultat de la création : identifiants de l'écriture d'inventaire et de son extourne.</summary>
public sealed record InventoryEntryResultDto
{
    public Guid EntryId { get; init; }
    public Guid? ReversalEntryId { get; init; }
}

/// <summary>Sévérité d'un contrôle de pré-clôture.</summary>
public enum PreClosingSeverity
{
    Info = 0,
    Warning = 1,
    /// <summary>Empêche la clôture annuelle et le verrouillage définitif tant qu'il subsiste.</summary>
    Blocking = 2
}

/// <summary>Résultat d'un contrôle de pré-clôture unitaire.</summary>
public sealed record PreClosingCheckDto
{
    public string Code { get; init; } = null!;
    public string Title { get; init; } = null!;
    public int Severity { get; init; }
    /// <summary>Nombre d'éléments concernés (0 = contrôle satisfait).</summary>
    public int Count { get; init; }
    public string Message { get; init; } = null!;
    /// <summary>Route front de résolution (deep-link), ex. « /accounting/lettering ».</summary>
    public string? DeepLinkRoute { get; init; }
}

/// <summary>Checklist complète des contrôles de pré-clôture d'un exercice.</summary>
public sealed record PreClosingChecklistDto
{
    public int FiscalYear { get; init; }
    public DateTime GeneratedAt { get; init; }
    /// <summary>Vrai si au moins un contrôle bloquant n'est pas satisfait (Count &gt; 0).</summary>
    public bool HasBlocking { get; init; }
    public IReadOnlyList<PreClosingCheckDto> Checks { get; init; } = Array.Empty<PreClosingCheckDto>();
}

/// <summary>
/// Livre d'inventaire d'un exercice : photographie légale figée (états financiers NCT + balance de
/// clôture + provisions détaillées par compte). Composition d'états existants — aucune donnée propre.
/// Un exercice verrouillé (<see cref="IsYearLocked"/>) rend cette photographie immuable.
/// </summary>
public sealed record InventoryBookDto
{
    public int FiscalYear { get; init; }
    public string CompanyName { get; init; } = "Société";
    /// <summary>Liasse consolidée (états NCT + résultat fiscal + amortissements + provisions 5-groupes).</summary>
    public ConsolidatedLiasseDto Liasse { get; init; } = new();
    /// <summary>Balance générale au 31/12 de l'exercice (ouverture ancrée, cf. lot 0).</summary>
    public IReadOnlyList<BalanceRowDto> ClosingBalance { get; init; } = Array.Empty<BalanceRowDto>();
    /// <summary>Provisions détaillées : une ligne par compte des racines 15/29/39/49/59.</summary>
    public IReadOnlyList<FiscalTableRowDto> DetailedProvisions { get; init; } = Array.Empty<FiscalTableRowDto>();
    /// <summary>Vrai si l'exercice est verrouillé définitivement (édition figée) ; sinon provisoire.</summary>
    public bool IsYearLocked { get; init; }
    public DateTime? LockedAt { get; init; }
}

/// <summary>
/// Rapport du centre de contrôle d'intégrité (lecture seule). Réutilise <see cref="PreClosingCheckDto"/>
/// pour chaque contrôle. <see cref="FiscalYear"/> null = diagnostic sur tout l'historique.
/// </summary>
public sealed record AccountingHealthReportDto
{
    /// <summary>Exercice ciblé, ou null pour un diagnostic global (tout l'historique).</summary>
    public int? FiscalYear { get; init; }
    public DateTime GeneratedAt { get; init; }
    /// <summary>Vrai si au moins un contrôle non satisfait (Count &gt; 0), toutes sévérités confondues.</summary>
    public bool HasAnomalies { get; init; }
    public IReadOnlyList<PreClosingCheckDto> Checks { get; init; } = Array.Empty<PreClosingCheckDto>();
}

public sealed record ChartOfAccountDto
{
    public Guid Id { get; init; }
    public string AccountNumber { get; init; } = null!;
    public string Label { get; init; } = null!;
    public int AccountClass { get; init; }
    public string? ParentAccountNumber { get; init; }
    public int NatureType { get; init; }
    public bool IsSystem { get; init; }
    public bool IsActive { get; init; }
    public int Level { get; init; }
    /// <summary>Nature métier : 0 = Général, 1 = Client, 2 = Fournisseur, 3 = Autre (façon Axeane).</summary>
    public int AccountType { get; init; }
    public bool IsAuxiliary { get; init; }
    public string? AffectationAccountNumber { get; init; }
}

public sealed record JournalEntryLineDto
{
    public Guid Id { get; init; }
    public int LineNumber { get; init; }
    public string AccountNumber { get; init; } = null!;
    public string Label { get; init; } = null!;
    public decimal Debit { get; init; }
    public decimal Credit { get; init; }

    /// <summary>
    /// Devise du <c>Money</c> de la ligne : TOUJOURS la devise de tenue. Pour connaître la devise
    /// de l'opération, lire <see cref="JournalEntryDto.CurrencyCode"/>.
    /// </summary>
    public string Currency { get; init; } = null!;

    /// <summary>Montant au débit dans la devise de transaction. 0 en mono-devise.</summary>
    public decimal DebitInCurrency { get; init; }

    /// <summary>Montant au crédit dans la devise de transaction. 0 en mono-devise.</summary>
    public decimal CreditInCurrency { get; init; }

    public string? LetteringCode { get; init; }
    public Guid? ThirdPartyId { get; init; }
    public int ThirdPartyKind { get; init; }
}

public sealed record JournalEntryDto
{
    public Guid Id { get; init; }
    public int EntryNumber { get; init; }
    public string JournalCode { get; init; } = null!;
    public DateTime EntryDate { get; init; }
    public string Label { get; init; } = null!;
    public string? SourceEntityType { get; init; }
    public Guid? SourceEntityId { get; init; }
    public bool IsAutoGenerated { get; init; }
    public bool IsReversed { get; init; }
    /// <summary>Écriture d'origine si cette pièce est une extourne (null sinon).</summary>
    public Guid? ReversesEntryId { get; init; }
    /// <summary>Statut brouillard/validation : 0 = Brouillon, 1 = Validée, 2 = Clôturée.</summary>
    public int Status { get; init; }
    public bool IsDraft { get; init; }
    /// <summary>Référence de la pièce externe justificative (facultative).</summary>
    public string? PieceRef { get; init; }
    /// <summary>Date de la pièce externe, distincte de la date comptable (facultative).</summary>
    public DateTime? PieceDate { get; init; }
    /// <summary>Nombre de pièces jointes (GED) attachées à l'écriture.</summary>
    public int AttachmentCount { get; init; }

    /// <summary>Devise dans laquelle l'opération a été traitée. Devise de tenue en mono-devise.</summary>
    public string CurrencyCode { get; init; } = null!;

    /// <summary>Taux appliqué : unités de devise de tenue pour UNE unité de la devise de transaction.</summary>
    public decimal ExchangeRate { get; init; }

    /// <summary>Vrai si le taux a été saisi manuellement au lieu d'être repris de la table.</summary>
    public bool ExchangeRateOverridden { get; init; }

    public IReadOnlyList<JournalEntryLineDto> Lines { get; init; } = Array.Empty<JournalEntryLineDto>();
}

public sealed record LedgerRowDto
{
    public DateTime EntryDate { get; init; }
    public string JournalCode { get; init; } = null!;
    public int PieceNumber { get; init; }
    public string Label { get; init; } = null!;

    /// <summary>Montants et solde progressif : TOUJOURS en devise de tenue.</summary>
    public decimal Debit { get; init; }
    public decimal Credit { get; init; }
    public decimal RunningBalance { get; init; }

    /// <summary>Devise de l'opération d'origine. Devise de tenue en mono-devise.</summary>
    public string CurrencyCode { get; init; } = null!;

    /// <summary>Montant de la ligne dans sa devise d'origine. 0 en mono-devise.</summary>
    public decimal AmountInCurrency { get; init; }
}

public sealed record BalanceRowDto
{
    public string AccountNumber { get; init; } = null!;
    public string Label { get; init; } = null!;
    public decimal OpeningDebit { get; init; }
    public decimal OpeningCredit { get; init; }
    public decimal MovementDebit { get; init; }
    public decimal MovementCredit { get; init; }
    public decimal ClosingDebit { get; init; }
    public decimal ClosingCredit { get; init; }

    /// <summary>
    /// Devises etrangeres presentes sur le compte, triees. Vide pour un compte tenu uniquement en
    /// devise de tenue.
    ///
    /// <para>
    /// <b>Une liste, et non « la » devise du compte.</b> Une ligne de balance agrege un compte
    /// toutes devises confondues : un fournisseur regle en euros puis en dollars porte deux devises,
    /// et n'en afficher qu'une seule serait faux. Les montants restent, eux, en devise de tenue.
    /// </para>
    /// </summary>
    public IReadOnlyList<string> ForeignCurrencies { get; init; } = Array.Empty<string>();
}

/// <summary>
/// Un compte du grand livre général : report à nouveau, mouvements de la période avec solde
/// progressif, totaux et solde de clôture.
/// </summary>
public sealed record GeneralLedgerAccountDto
{
    public string AccountNumber { get; init; } = null!;
    public string Label { get; init; } = null!;
    /// <summary>Solde reporté à l'ouverture de la période (débit − crédit).</summary>
    public decimal OpeningBalance { get; init; }
    public IReadOnlyList<LedgerRowDto> Rows { get; init; } = Array.Empty<LedgerRowDto>();
    public decimal TotalDebit { get; init; }
    public decimal TotalCredit { get; init; }
    /// <summary>Solde de clôture = ouverture + débits − crédits.</summary>
    public decimal ClosingBalance { get; init; }
}

/// <summary>
/// Grand livre général : les comptes d'une plage restitués en séquence. Le total des mouvements
/// s'articule avec la balance générale de la même période.
/// </summary>
public sealed record GeneralLedgerDto
{
    public DateTime From { get; init; }
    public DateTime To { get; init; }
    public IReadOnlyList<GeneralLedgerAccountDto> Accounts { get; init; } = Array.Empty<GeneralLedgerAccountDto>();
    public decimal TotalDebit { get; init; }
    public decimal TotalCredit { get; init; }
    /// <summary>Contrôle d'auto-cohérence : total débit = total crédit au millime.</summary>
    public bool IsBalanced { get; init; }
}

/// <summary>Ligne de balance détaillée : le solde du compte suivi de ses mouvements.</summary>
public sealed record DetailedBalanceAccountDto
{
    public BalanceRowDto Balance { get; init; } = null!;
    public IReadOnlyList<LedgerRowDto> Rows { get; init; } = Array.Empty<LedgerRowDto>();
}

/// <summary>
/// Balance détaillée : la balance générale et, sous chaque compte, le détail de ses mouvements.
/// Composition de la balance et du grand livre général — aucune règle de calcul propre.
/// </summary>
public sealed record DetailedBalanceDto
{
    public DateTime From { get; init; }
    public DateTime To { get; init; }
    public IReadOnlyList<DetailedBalanceAccountDto> Accounts { get; init; } = Array.Empty<DetailedBalanceAccountDto>();
    public decimal TotalMovementDebit { get; init; }
    public decimal TotalMovementCredit { get; init; }
}

/// <summary>Ligne de balance par période : ouverture, 12 colonnes mensuelles, clôture.</summary>
public sealed record PeriodicBalanceRowDto
{
    public string AccountNumber { get; init; } = null!;
    public string Label { get; init; } = null!;
    /// <summary>Solde d'ouverture de l'exercice (débit − crédit).</summary>
    public decimal Opening { get; init; }
    /// <summary>Débits par mois, indices 0 (janvier) à 11 (décembre).</summary>
    public IReadOnlyList<decimal> MonthlyDebit { get; init; } = Array.Empty<decimal>();
    /// <summary>Crédits par mois, indices 0 (janvier) à 11 (décembre).</summary>
    public IReadOnlyList<decimal> MonthlyCredit { get; init; } = Array.Empty<decimal>();
    /// <summary>Solde de clôture = ouverture + Σ débits − Σ crédits.</summary>
    public decimal Closing { get; init; }
}

/// <summary>Balance par période : un exercice ventilé en 12 colonnes mensuelles.</summary>
public sealed record PeriodicBalanceDto
{
    public int FiscalYear { get; init; }
    public IReadOnlyList<PeriodicBalanceRowDto> Rows { get; init; } = Array.Empty<PeriodicBalanceRowDto>();
    public decimal TotalDebit { get; init; }
    public decimal TotalCredit { get; init; }
    /// <summary>Contrôle d'auto-cohérence : total débit = total crédit au millime.</summary>
    public bool IsBalanced { get; init; }
}

/// <summary>Résultat d'une édition de masse de brouillons : appliqués vs ignorés (non-brouillon / refusés).</summary>
public sealed record MassDraftUpdateResultDto
{
    public int Updated { get; init; }
    /// <summary>Ids ignorés : introuvables, non-brouillon, ou en période clôturée.</summary>
    public int Skipped { get; init; }
}

/// <summary>Résultat d'une suppression de masse de brouillons.</summary>
public sealed record MassDraftDeleteResultDto
{
    public int Deleted { get; init; }
    public int Skipped { get; init; }
}

/// <summary>
/// Résultat d'une correction de masse par extourne : écritures effectivement contre-passées vs
/// ignorées (brouillon, déjà extournée, introuvable). Aucune écriture n'est jamais modifiée.
/// </summary>
public sealed record MassReversalResultDto
{
    public int Reversed { get; init; }
    public int Skipped { get; init; }
    /// <summary>Identifiants des écritures d'extourne créées.</summary>
    public IReadOnlyList<Guid> ReversalEntryIds { get; init; } = Array.Empty<Guid>();
}

/// <summary>Requête de correction de masse par extourne. Le motif est obligatoire (il est repris dans chaque libellé).</summary>
public sealed record MassReverseEntriesRequest
{
    public IReadOnlyList<Guid> Ids { get; init; } = Array.Empty<Guid>();
    public string Reason { get; init; } = string.Empty;
}

/// <summary>Axe de regroupement d'un récapitulatif de journaux.</summary>
public enum JournalSummaryGrouping
{
    /// <summary>Centralisateur : journaux × mois.</summary>
    Month = 0,

    /// <summary>Récapitulation : journaux × comptes.</summary>
    Account = 1,

    /// <summary>Totaux journaux : sous-totaux par journal, sans détail.</summary>
    Totals = 2
}

/// <summary>Mois couvert par un récapitulatif (pilote les colonnes du centralisateur).</summary>
public sealed record JournalSummaryPeriodDto
{
    public int Year { get; init; }
    public int Month { get; init; }
    /// <summary>Libellé court « MM/yyyy ».</summary>
    public string Label { get; init; } = null!;
}

/// <summary>
/// Case d'un récapitulatif : croisement d'un journal avec un mois (centralisateur) ou un compte
/// (récapitulation). Les champs de l'axe non retenu restent nuls.
/// </summary>
public sealed record JournalSummaryCellDto
{
    public string JournalCode { get; init; } = null!;
    public string JournalLabel { get; init; } = null!;
    public int? Year { get; init; }
    public int? Month { get; init; }
    public string? AccountNumber { get; init; }
    public string? AccountLabel { get; init; }
    public decimal Debit { get; init; }
    public decimal Credit { get; init; }
}

/// <summary>Sous-total d'un journal sur la période (toujours renseigné, quel que soit l'axe).</summary>
public sealed record JournalSummaryTotalDto
{
    public string JournalCode { get; init; } = null!;
    public string JournalLabel { get; init; } = null!;
    public decimal Debit { get; init; }
    public decimal Credit { get; init; }
    /// <summary>Nombre d'écritures (pièces) distinctes, pas de lignes.</summary>
    public int EntryCount { get; init; }
}

/// <summary>
/// Récapitulatif de journaux sur une période : centralisateur (journaux × mois), récapitulation
/// (journaux × comptes) ou totaux seuls. Même politique brouillard que le journal.
/// </summary>
public sealed record JournalSummaryDto
{
    public JournalSummaryGrouping Grouping { get; init; }
    public DateTime From { get; init; }
    public DateTime To { get; init; }
    public IReadOnlyList<JournalSummaryPeriodDto> Periods { get; init; } = Array.Empty<JournalSummaryPeriodDto>();
    public IReadOnlyList<JournalSummaryCellDto> Cells { get; init; } = Array.Empty<JournalSummaryCellDto>();
    public IReadOnlyList<JournalSummaryTotalDto> JournalTotals { get; init; } = Array.Empty<JournalSummaryTotalDto>();
    public decimal TotalDebit { get; init; }
    public decimal TotalCredit { get; init; }
    /// <summary>Contrôle d'auto-cohérence : total débit = total crédit au millime.</summary>
    public bool IsBalanced { get; init; }
}

/// <summary>Ligne de balance auxiliaire : soldes d'un tiers (client ou fournisseur) sur ses comptes rattachés.</summary>
public sealed record AuxiliaryBalanceRowDto
{
    public Guid ThirdPartyId { get; init; }
    public string ThirdPartyName { get; init; } = null!;
    public decimal OpeningDebit { get; init; }
    public decimal OpeningCredit { get; init; }
    public decimal MovementDebit { get; init; }
    public decimal MovementCredit { get; init; }
    public decimal ClosingDebit { get; init; }
    public decimal ClosingCredit { get; init; }
}

/// <summary>Grand livre d'un tiers : mouvements + solde progressif (démarré au solde d'ouverture).</summary>
public sealed record ThirdPartyLedgerDto
{
    public Guid ThirdPartyId { get; init; }
    public string ThirdPartyName { get; init; } = null!;
    /// <summary>Solde (débit − crédit) antérieur à la période demandée.</summary>
    public decimal OpeningBalance { get; init; }
    public IReadOnlyList<ThirdPartyLedgerRowDto> Rows { get; init; } = Array.Empty<ThirdPartyLedgerRowDto>();
}

public sealed record ThirdPartyLedgerRowDto
{
    public DateTime EntryDate { get; init; }
    public string JournalCode { get; init; } = null!;
    public int PieceNumber { get; init; }
    public string? PieceRef { get; init; }
    public string AccountNumber { get; init; } = null!;
    public string Label { get; init; } = null!;
    public decimal Debit { get; init; }
    public decimal Credit { get; init; }
    public decimal RunningBalance { get; init; }
    public string? LetteringCode { get; init; }

    /// <summary>Devise de l'operation d'origine. Devise de tenue en mono-devise.</summary>
    public string CurrencyCode { get; init; } = null!;

    /// <summary>Montant de la ligne dans sa devise d'origine. 0 en mono-devise.</summary>
    public decimal AmountInCurrency { get; init; }
}

public sealed record AgingReportRowDto
{
    public Guid ThirdPartyId { get; init; }
    public string ThirdPartyName { get; init; } = null!;
    public decimal Total { get; init; }
    public decimal NotYetDue { get; init; }
    public decimal Days0To30 { get; init; }
    public decimal Days31To60 { get; init; }
    public decimal Days61To90 { get; init; }
    public decimal DaysOver90 { get; init; }
    public decimal? DsoOrDpo { get; init; }
}

public sealed record VatRateBreakdownDto
{
    public int RatePercent { get; init; }
    public decimal TaxableBase { get; init; }
    public decimal VatAmount { get; init; }
}

/// <summary>Résumé société pour affichage comptable (sans données sensibles settings).</summary>
public sealed record TenantCompanySummaryDto
{
    public string CompanyName { get; init; } = null!;
    public string Nif { get; init; } = null!;
    public string TaxRegimeDisplay { get; init; } = null!;
    public string? TradeName { get; init; }
    public string? AddressLine { get; init; }
    public string? CnssEmployerNumber { get; init; }
}

public sealed record VatDeclarationDto
{
    public int Year { get; init; }
    public int Month { get; init; }
    public decimal CollectedVat19 { get; init; }
    public decimal CollectedVat13 { get; init; }
    public decimal CollectedVat7 { get; init; }
    public decimal DeductibleVatGoods { get; init; }
    public decimal DeductibleVatAssets { get; init; }
    public decimal PreviousCredit { get; init; }
    public decimal VatDue { get; init; }
    public decimal CreditToCarry { get; init; }
    public string Currency { get; init; } = null!;
    public int Status { get; init; }

    // Déclaration mensuelle unique (V2) — additif ; 0 tant que le workflow V2 n'est pas activé/renseigné.
    public decimal Fodec { get; init; }
    public decimal DroitTimbre { get; init; }
    public decimal Tcl { get; init; }
    public decimal Tfp { get; init; }
    public decimal Foprolos { get; init; }
    public decimal WithholdingTax { get; init; }
    public decimal Acomptes { get; init; }

    // ── Familles produites par la déclaration paramétrable ───────────────────
    // Valent 0 pour tout dossier resté en calcul historique.

    /// <summary>Droit de consommation.</summary>
    public decimal ConsumptionDuty { get; init; }

    /// <summary>Taxe hôtelière.</summary>
    public decimal HotelTax { get; init; }

    /// <summary>Droit de licence.</summary>
    public decimal LicenceFee { get; init; }

    /// <summary>
    /// Régime de calcul appliqué à cette période : 0 = historique, 1 = contrôle de parité,
    /// 2 = paramétré. Renseigné par le serveur ; l'écran s'en sert pour dire d'où viennent les
    /// montants plutôt que de le deviner.
    /// </summary>
    public int MonthlyDeclarationMode { get; init; }

    /// <summary>
    /// Détail par rubrique produit par le moteur paramétré. Vide en calcul historique.
    /// </summary>
    public IReadOnlyList<MonthlyDeclarationLineDto> Lines { get; init; } =
        Array.Empty<MonthlyDeclarationLineDto>();

    /// <summary>
    /// Signalements du calcul (compte inconnu, cycle de paie non arrêté, famille incluse sans
    /// rubrique…). Vide en calcul historique.
    /// </summary>
    public IReadOnlyList<MonthlyDeclarationDiagnosticDto> MonthlyDeclarationDiagnostics { get; init; } =
        Array.Empty<MonthlyDeclarationDiagnosticDto>();

    /// <summary>
    /// Écart maximal, en millimes, entre le calcul historique et le calcul paramétré sur cette
    /// période. C'est la mesure qui autorise — ou non — la bascule du dossier.
    /// </summary>
    public long ParityMaxGapMillimes { get; init; }

    /// <summary>Total net à payer = TVA due + FODEC + timbre + TCL + TFP + FOPROLOS + RS + DC + taxe hôtelière + droit de licence − acomptes (plancher 0).</summary>
    public decimal TotalToPay { get; init; }
    public int Version { get; init; } = 1;
    public bool IsRectificative { get; init; }
    /// <summary>Vrai si la déclaration mensuelle unique (V2) est activée pour ce dossier.</summary>
    public bool MonthlyDeclarationV2Enabled { get; init; }

    // Métadonnées (null si déclaration jamais enregistrée).
    public DateTime? CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
    public DateTime? SubmittedAt { get; init; }
    public string? CreatedBy { get; init; }
    public string? UpdatedBy { get; init; }

    // Contexte période.
    public DateTime FilingDeadline { get; init; }
    public string DeclarationTypeDisplay { get; init; } = null!;

    // Détail TVA par taux (collectée).
    public IReadOnlyList<VatRateBreakdownDto> CollectedVatBreakdown { get; init; } = Array.Empty<VatRateBreakdownDto>();

    // Bases déductibles et CA.
    public decimal DeductiblePurchasesTaxableBase { get; init; }
    public decimal SalesTaxableBase { get; init; }
    public decimal SalesGrossBase { get; init; }
    /// <summary>Base HT éligible FODEC (lignes IsFodecApplicable) pour la période.</summary>
    public decimal FodecTaxableBase { get; init; }

    // Taux configurés (%) utilisés pour le préremplissage FODEC/TCL — exposés pour l'affichage et le
    // calcul de la valeur suggérée côté écran (cohérence Base × Taux vs montant saisi).
    public decimal FodecRatePercent { get; init; }
    public decimal TclRatePercent { get; init; }

    // Résumé société (tenant courant — accessible cabinet délégué via accounting:read).
    public string CompanyName { get; init; } = null!;
    public string Nif { get; init; } = null!;
    public string TaxRegimeDisplay { get; init; } = null!;
    public string? TradeName { get; init; }

    /// <summary>
    /// Adresse du siège social sur une ligne. Requise par l'en-tête du formulaire officiel DGI
    /// (« العنوان أو المقر الاجتماعي ») ; non affichée par l'écran de saisie.
    /// </summary>
    public string? AddressLine { get; init; }

    /// <summary>
    /// Reflet de <c>AccountingSettings.MonthlyDeclarationOfficialFormEnabled</c> : pilote
    /// l'affichage de l'action « Formulaire officiel » côté client.
    /// </summary>
    public bool OfficialFormEnabled { get; init; }

    // ── Assiette des taxes sur salaires (module paie) ──────────────────────
    // Portées par la déclaration elle-même — et non par la seule suggestion — parce que le
    // formulaire officiel doit les imprimer en regard des montants déposés.

    /// <summary>Assiette TFP/FOPROLOS : masse salariale soumise du mois. 0 si indéterminable.</summary>
    public decimal PayrollTaxBase { get; init; }

    /// <summary>Taux de TFP effectivement appliqué par le cycle de paie (1 % ou 2 %). 0 si inconnu.</summary>
    public decimal TfpRatePercent { get; init; }

    /// <summary>Taux de FOPROLOS effectivement appliqué par le cycle de paie. 0 si inconnu.</summary>
    public decimal FoprolosRatePercent { get; init; }

    /// <summary>
    /// Masse salariale brute du mois. Conservée pour le contrat API ; l'assiette des articles 1 et 3
    /// du formulaire officiel est <see cref="PayrollSalariesNetTaxableBase"/>.
    /// </summary>
    public decimal PayrollSalariesGrossBase { get; init; }

    /// <summary>
    /// Net imposable cumulé des salariés du mois — assiette des articles 1 (IRPP) et 3 (CSS)
    /// du formulaire officiel. 0 sans cycle de paie exploitable.
    /// </summary>
    public decimal PayrollSalariesNetTaxableBase { get; init; }

    /// <summary>IRPP salarial du mois, régularisations comprises. 0 sans cycle exploitable.</summary>
    public decimal PayrollWithholdingIrpp { get; init; }

    /// <summary>CSS salariale du mois, régularisations comprises. 0 sans cycle exploitable.</summary>
    public decimal PayrollWithholdingCss { get; init; }

    /// <summary>
    /// Somme des débits validés sur le compte 613 (et sous-comptes) du mois — assiette RS loyers
    /// article 4 personnes physiques. Toujours recalculée (contexte live).
    /// </summary>
    public decimal RentWithholdingBase { get; init; }

    /// <summary>Retenue 10 % sur <see cref="RentWithholdingBase"/> (article 4, personnes physiques).</summary>
    public decimal RentWithholdingAmount { get; init; }

    /// <summary>
    /// Recalcul temps réel de la période depuis les modules (ventes, achats, retenue à la source,
    /// paie). Toujours renseigné quand la V2 est active.
    ///
    /// <para>
    /// Les montants de premier niveau sont ceux <b>déclarés</b> : tant qu'une déclaration existe en
    /// base, ce sont les valeurs déposées, figées. Cette section porte ce que les modules
    /// produiraient aujourd'hui — l'écart entre les deux est ce que l'écran signale à
    /// l'utilisateur, qui reste seul à décider de réaligner.
    /// </para>
    /// </summary>
    public VatDeclarationComputedDto? Suggested { get; init; }
}

/// <summary>
/// Photographie temps réel d'une période, telle que les modules la produiraient. Jamais persistée :
/// c'est une proposition, pas une déclaration.
/// </summary>
public sealed record VatDeclarationComputedDto
{
    public decimal CollectedVat19 { get; init; }
    public decimal CollectedVat13 { get; init; }
    public decimal CollectedVat7 { get; init; }
    public decimal DeductibleVatGoods { get; init; }
    public decimal DeductibleVatAssets { get; init; }
    public decimal PreviousCredit { get; init; }
    public decimal VatDue { get; init; }
    public decimal CreditToCarry { get; init; }

    public decimal Fodec { get; init; }
    public decimal DroitTimbre { get; init; }
    public decimal Tcl { get; init; }
    public decimal Tfp { get; init; }
    public decimal Foprolos { get; init; }
    public decimal WithholdingTax { get; init; }

    /// <summary>Part de la RS provenant des factures fournisseurs.</summary>
    public decimal WithholdingFromInvoices { get; init; }

    /// <summary>Part de la RS provenant des traitements et salaires (IRPP + CSS).</summary>
    public decimal WithholdingFromSalaries { get; init; }

    /// <summary>Part de la RS provenant des débits journal 613 (loyers PP 10 %).</summary>
    public decimal WithholdingFromRentJournal { get; init; }

    /// <summary>Part de la RS produite par les rubriques paramétrées (0 en calcul historique).</summary>
    public decimal WithholdingFromRubrics { get; init; }

    /// <summary>Droit de consommation.</summary>
    public decimal ConsumptionDuty { get; init; }

    /// <summary>Taxe hôtelière.</summary>
    public decimal HotelTax { get; init; }

    /// <summary>Droit de licence.</summary>
    public decimal LicenceFee { get; init; }

    /// <summary>Total à payer si l'on retenait l'intégralité des valeurs calculées.</summary>
    public decimal TotalToPay { get; init; }

    // ── Contexte paie, pour expliquer l'origine des montants à l'écran ──────

    /// <summary>Un cycle de paie existe pour la période, quel que soit son statut.</summary>
    public bool PayrollRunExists { get; init; }

    /// <summary>Statut du cycle de paie (`null` si aucun cycle).</summary>
    public int? PayrollRunStatus { get; init; }

    /// <summary>Libellé du statut du cycle, prêt à afficher.</summary>
    public string? PayrollRunStatusDisplay { get; init; }

    /// <summary>
    /// Faux quand un cycle existe sans être validé ni clôturé : ses montants sont volontairement
    /// ignorés, et l'écran doit inviter à le valider plutôt qu'à saisir à la main.
    /// </summary>
    public bool PayrollRunUsable { get; init; }
}

public sealed record AccountingDashboardDto
{
    public decimal VatDueEstimate { get; init; }
    public decimal OverdueReceivablesOver90 { get; init; }
    public int UnpostedInvoiceCount { get; init; }
    public DateTime NextVatDeadline { get; init; }
    public decimal MonthlyRevenue { get; init; }
    public decimal PreviousMonthRevenue { get; init; }
    public decimal AvailableCash { get; init; }
    public int OpenPeriodsCount { get; init; }
    /// <summary>Nombre d'écritures en brouillard (0 tant que le workflow brouillard n'est pas activé).</summary>
    public int DraftEntriesCount { get; init; }
}

public sealed record AccountingPeriodDto
{
    public Guid Id { get; init; }
    public int FiscalYear { get; init; }
    public int Month { get; init; }
    public DateTime StartDate { get; init; }
    public DateTime EndDate { get; init; }
    public bool IsClosed { get; init; }
}

public sealed record CreateSubAccountRequest
{
    public string AccountNumber { get; init; } = null!;
    public string Label { get; init; } = null!;
    public int AccountClass { get; init; }
    public string? ParentAccountNumber { get; init; }
    public int NatureType { get; init; }
    /// <summary>Nature métier : 0 = Général (défaut), 1 = Client, 2 = Fournisseur, 3 = Autre.</summary>
    public int AccountType { get; init; }
    public bool IsAuxiliary { get; init; }
    public string? AffectationAccountNumber { get; init; }
    /// <summary>Ignorés si le compte n'est pas une feuille 5321/5324. RIB et IBAN facultatifs, mais ensemble.</summary>
    public string? BankCode { get; init; }
    public string? Rib { get; init; }
    public string? Iban { get; init; }
    public string? BankCurrency { get; init; }
    public string? SwiftBic { get; init; }
}

public sealed record CreateManualJournalEntryRequest
{
    public string JournalCode { get; init; } = "JOD";
    public DateTime EntryDate { get; init; }
    public string Label { get; init; } = null!;
    /// <summary>Référence de la pièce externe justificative (facultative, ≤ 50 caractères).</summary>
    public string? PieceRef { get; init; }
    /// <summary>Date de la pièce externe (facultative).</summary>
    public DateTime? PieceDate { get; init; }
    public IReadOnlyList<ManualJournalLineRequest> Lines { get; init; } = Array.Empty<ManualJournalLineRequest>();

    /// <summary>Devise de la transaction. Vide ou absente = devise de tenue.</summary>
    public string? CurrencyCode { get; init; }

    /// <summary>
    /// Taux souhaité. Le serveur part TOUJOURS de la table des taux : une valeur différente n'est
    /// acceptée que dans la tolérance configurée et avec la permission de surcharge.
    /// </summary>
    public decimal? ExchangeRate { get; init; }
}

public sealed record ManualJournalLineRequest
{
    public string AccountNumber { get; init; } = null!;
    public string LineLabel { get; init; } = null!;

    /// <summary>
    /// Montant au débit en devise de tenue. <b>Ignoré</b> lorsque l'écriture est en devise : le
    /// serveur recalcule alors la contre-valeur depuis <see cref="DebitInCurrency"/>.
    /// </summary>
    public decimal Debit { get; init; }

    /// <summary>Montant au crédit en devise de tenue. Mêmes règles que <see cref="Debit"/>.</summary>
    public decimal Credit { get; init; }

    /// <summary>Montant au débit dans la devise de transaction.</summary>
    public decimal DebitInCurrency { get; init; }

    /// <summary>Montant au crédit dans la devise de transaction.</summary>
    public decimal CreditInCurrency { get; init; }

    /// <summary>Tiers optionnel (plan tiers) : auxiliarise la ligne (GL tiers, lettrage, FEC).</summary>
    public Guid? ThirdPartyId { get; init; }
    /// <summary>Obligatoire si ThirdPartyId est fourni : 1 = client, 2 = fournisseur.</summary>
    public int? ThirdPartyKind { get; init; }
}

/// <summary>Une ligne d'écriture résultant d'une recherche (avec le contexte de la pièce).</summary>
public sealed record JournalSearchRowDto
{
    public Guid EntryId { get; init; }
    /// <summary>Id de la ligne d'écriture (utilisé notamment par le rapprochement bancaire).</summary>
    public Guid LineId { get; init; }
    public DateTime EntryDate { get; init; }
    public string JournalCode { get; init; } = null!;
    public int EntryNumber { get; init; }
    public string AccountNumber { get; init; } = null!;
    public string Label { get; init; } = null!;
    /// <summary>Montants TOUJOURS en devise de tenue.</summary>
    public decimal Debit { get; init; }
    public decimal Credit { get; init; }
    public string? LetteringCode { get; init; }
    public int Status { get; init; }
    public bool IsDraft { get; init; }
    /// <summary>Référence de la pièce externe de l'écriture (facultative).</summary>
    public string? PieceRef { get; init; }

    /// <summary>Devise de l'opération d'origine. Devise de tenue en mono-devise.</summary>
    public string CurrencyCode { get; init; } = null!;

    /// <summary>Montant de la ligne dans sa devise d'origine. 0 en mono-devise.</summary>
    public decimal AmountInCurrency { get; init; }
}

/// <summary>Mise à jour d'une écriture EN BROUILLON (le journal et la date restent figés — ils numérotent la pièce).</summary>
public sealed record UpdateDraftJournalEntryRequest
{
    public string Label { get; init; } = null!;
    /// <summary>Référence de la pièce externe justificative (facultative, ≤ 50 caractères).</summary>
    public string? PieceRef { get; init; }
    /// <summary>Date de la pièce externe (facultative).</summary>
    public DateTime? PieceDate { get; init; }
    public IReadOnlyList<ManualJournalLineRequest> Lines { get; init; } = Array.Empty<ManualJournalLineRequest>();

    /// <summary>Devise de la transaction. Vide ou absente = devise de tenue.</summary>
    public string? CurrencyCode { get; init; }

    /// <summary>Taux souhaité. Mêmes règles de surcharge qu'à la création.</summary>
    public decimal? ExchangeRate { get; init; }
}

/// <summary>Validation par lot des écritures en brouillon d'une période (optionnellement d'un journal donné).</summary>
public sealed record ValidateJournalEntriesBatchRequest
{
    public Guid PeriodId { get; init; }
    public string? JournalCode { get; init; }
}

/// <summary>Requête d'édition de masse de brouillons : ids + champs à changer (tous facultatifs).</summary>
public sealed record MassUpdateDraftEntriesRequest
{
    public IReadOnlyList<Guid> Ids { get; init; } = Array.Empty<Guid>();
    public string? NewJournalCode { get; init; }
    public DateTime? NewDate { get; init; }
    public string? NewLabel { get; init; }
}

/// <summary>Requête de suppression de masse de brouillons.</summary>
public sealed record MassDeleteDraftEntriesRequest
{
    public IReadOnlyList<Guid> Ids { get; init; } = Array.Empty<Guid>();
}

/// <summary>Extourne (contre-passation) manuelle d'une écriture validée.</summary>
public sealed record ReverseJournalEntryRequest
{
    public string Reason { get; init; } = null!;
}

/// <summary>Remplacement d'un compte par un autre sur les lignes d'écriture des périodes ouvertes.</summary>
public sealed record ReplaceAccountRequest
{
    public string OldAccount { get; init; } = null!;
    public string NewAccount { get; init; } = null!;
}

public sealed record UpdateAccountLabelRequest
{
    public string Label { get; init; } = null!;
}

public sealed record SaveVatDeclarationRequest
{
    public int Year { get; init; }
    public int Month { get; init; }
    public bool Submit { get; init; }

    // Déclaration mensuelle unique (V2) — ignorés quand le workflow V2 est désactivé.
    public decimal Fodec { get; init; }
    public decimal DroitTimbre { get; init; }
    public decimal Tcl { get; init; }
    public decimal Tfp { get; init; }
    public decimal Foprolos { get; init; }
    public decimal WithholdingTax { get; init; }
    public decimal Acomptes { get; init; }
    /// <summary>Quand vrai et qu'une déclaration existe déjà, applique une rectificative (au lieu de refuser).</summary>
    public bool IsRectificative { get; init; }
}

public sealed record FiscalScheduleFiltersDto
{
    public Guid? CompanyTenantId { get; init; }
    public int? FiscalYear { get; init; }
    public int? PeriodMonth { get; init; }
    public int? PeriodQuarter { get; init; }
    public int? ObligationType { get; init; }
    public int? Status { get; init; }
    public Guid? ResponsibleUserId { get; init; }
    public DateTime? DueFrom { get; init; }
    public DateTime? DueTo { get; init; }
    public string? Search { get; init; }
    public bool IncludeCancelled { get; init; }
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 25;
}

public sealed record FiscalScheduleSummaryDto
{
    public int UpcomingWithin7DaysCount { get; init; }
    public decimal UpcomingWithin7DaysAmount { get; init; }
    public int UpcomingAfter7DaysCount { get; init; }
    public decimal UpcomingAfter7DaysAmount { get; init; }
    public int OverdueCount { get; init; }
    public decimal OverdueAmount { get; init; }
    public int DepositedThisMonthCount { get; init; }
    public decimal DepositedThisMonthAmount { get; init; }
    public int TotalCount { get; init; }
    public decimal TotalAmount { get; init; }
}

public sealed record FiscalScheduleEntryDto
{
    public Guid Id { get; init; }
    public Guid? CompanyTenantId { get; init; }
    public string? CompanyName { get; init; }
    public int ObligationType { get; init; }
    public string ObligationTypeDisplay { get; init; } = null!;
    public string ObligationLabel { get; init; } = null!;
    public int FiscalYear { get; init; }
    public int? PeriodMonth { get; init; }
    public int? PeriodQuarter { get; init; }
    public DateTime? PeriodStart { get; init; }
    public DateTime? PeriodEnd { get; init; }
    public string PeriodDisplay { get; init; } = null!;
    public DateTime DueDate { get; init; }
    public decimal EstimatedAmount { get; init; }
    public string Currency { get; init; } = null!;
    public int Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public int SourceType { get; init; }
    public Guid? SourceId { get; init; }
    public DateTime? DepositDate { get; init; }
    public DateTime? PaymentDate { get; init; }
    public DateTime? ValidatedAt { get; init; }
    public string? ValidatedBy { get; init; }
    public Guid? ResponsibleUserId { get; init; }
    public string? ResponsibleName { get; init; }
    public string? Observations { get; init; }
    public DateTime? LastReminderAt { get; init; }
    public int? LastReminderChannel { get; init; }
    public int AttachmentCount { get; init; }
    public int HistoryCount { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
    public string? CreatedBy { get; init; }
    public string? UpdatedBy { get; init; }
    public int Version { get; init; }
}

public sealed record FiscalScheduleListDto
{
    public FiscalScheduleSummaryDto Summary { get; init; } = new();
    public IReadOnlyList<FiscalScheduleEntryDto> Items { get; init; } = Array.Empty<FiscalScheduleEntryDto>();
    public IReadOnlyList<FirmClientDossierDto> Companies { get; init; } = Array.Empty<FirmClientDossierDto>();
    public int Page { get; init; }
    public int PageSize { get; init; }
    public int TotalCount { get; init; }
}

public sealed record CreateFiscalScheduleEntryRequest
{
    public int ObligationType { get; init; }
    public string ObligationLabel { get; init; } = null!;
    public int FiscalYear { get; init; }
    public int? PeriodMonth { get; init; }
    public int? PeriodQuarter { get; init; }
    public DateTime? PeriodStart { get; init; }
    public DateTime? PeriodEnd { get; init; }
    public DateTime DueDate { get; init; }
    public decimal EstimatedAmount { get; init; }
    public string Currency { get; init; } = "TND";
    public Guid? ResponsibleUserId { get; init; }
    public string? ResponsibleName { get; init; }
    public string? Observations { get; init; }
}

public sealed record UpdateFiscalScheduleEntryRequest
{
    public int ObligationType { get; init; }
    public string ObligationLabel { get; init; } = null!;
    public int FiscalYear { get; init; }
    public int? PeriodMonth { get; init; }
    public int? PeriodQuarter { get; init; }
    public DateTime? PeriodStart { get; init; }
    public DateTime? PeriodEnd { get; init; }
    public DateTime DueDate { get; init; }
    public decimal EstimatedAmount { get; init; }
    public string Currency { get; init; } = "TND";
    public Guid? ResponsibleUserId { get; init; }
    public string? ResponsibleName { get; init; }
    public string? Observations { get; init; }
}

public sealed record MarkFiscalScheduleDepositedRequest
{
    public DateTime DepositDate { get; init; }
    public string? Observations { get; init; }
}

public sealed record CaptureFiscalSchedulePaymentRequest
{
    public DateTime PaymentDate { get; init; }
    public string? Observations { get; init; }
}

public sealed record ScheduleFiscalReminderRequest
{
    public int Channel { get; init; }
    public DateTime? ReminderAt { get; init; }
}

public sealed record MarkFiscalScheduleValidatedRequest
{
    public DateTime ValidatedDate { get; init; }
    public string? Observations { get; init; }
}

public sealed record FiscalScheduleAttachmentDto
{
    public Guid Id { get; init; }
    public Guid FiscalScheduleEntryId { get; init; }
    public string FileName { get; init; } = null!;
    public string ContentType { get; init; } = null!;
    public long SizeBytes { get; init; }
    public DateTime CreatedAt { get; init; }
    public string? UploadedBy { get; init; }
}

public sealed record FiscalScheduleHistoryDto
{
    public Guid Id { get; init; }
    public Guid FiscalScheduleEntryId { get; init; }
    public string Action { get; init; } = null!;
    public string Summary { get; init; } = null!;
    public string? OldValuesJson { get; init; }
    public string? NewValuesJson { get; init; }
    public DateTime CreatedAt { get; init; }
    public string? CreatedBy { get; init; }
}

public sealed record AuditLogEntryDto
{
    public Guid Id { get; init; }
    public DateTime CreatedAt { get; init; }
    public Guid? UserId { get; init; }
    public string UserEmail { get; init; } = null!;
    public string Action { get; init; } = null!;
    public string EntityType { get; init; } = null!;
    public Guid? EntityId { get; init; }
    /// <summary>Optional human-readable label (e.g. invoice number) when resolvable without N+1 batch load.</summary>
    public string? EntityLabel { get; init; }
}

/// <summary>
/// Projection interne de l'historique paginé d'une entité précise (Studio 4.7 — D5, historique
/// d'enregistrement) : jamais d'IP, d'agent utilisateur ni de hash d'intégrité (réservés à la
/// console d'audit). Le nom affichable de l'auteur est résolu par l'appelant (couche Application).
/// </summary>
public sealed record AuditEntityHistoryRowDto
{
    public Guid Id { get; init; }
    public string Action { get; init; } = null!;
    public DateTime CreatedAt { get; init; }
    public Guid? UserId { get; init; }
    public string? OldValues { get; init; }
    public string? NewValues { get; init; }
}

public sealed record AuditLogDetailDto
{
    public Guid Id { get; init; }
    public DateTime CreatedAt { get; init; }
    public Guid? UserId { get; init; }
    public string UserEmail { get; init; } = null!;
    public string Action { get; init; } = null!;
    public string EntityType { get; init; } = null!;
    public Guid? EntityId { get; init; }
    public string? EntityLabel { get; init; }
    public string? OldValues { get; init; }
    public string? NewValues { get; init; }
    public string IpAddress { get; init; } = null!;
    public string? UserAgent { get; init; }
    public string PreviousHash { get; init; } = null!;
    public string Hash { get; init; } = null!;
}

public sealed record AuditChainVerificationDto
{
    public bool IsValid { get; init; }
    public int EntryCount { get; init; }
    public string? FirstBrokenEntryId { get; init; }

    /// <summary>
    /// <c>IntegrityMismatch</c> when the stored hash does not match the payload;
    /// <c>ChainMismatch</c> when the link to the previous entry is wrong.
    /// </summary>
    public string? FirstFailureReason { get; init; }

    /// <summary>
    /// Count of distinct PreviousHash values (other than GENESIS) that appear on more than one row — often indicates concurrent writes before the fix.
    /// </summary>
    public int DuplicatePreviousHashGroupCount { get; init; }
}

public sealed record BankStatementDto
{
    public Guid Id { get; init; }
    public string BankName { get; init; } = null!;
    public string AccountNumber { get; init; } = null!;
    public DateTime StatementDate { get; init; }
    public DateTime PeriodStart { get; init; }
    public DateTime PeriodEnd { get; init; }
    public decimal OpeningBalance { get; init; }
    public decimal ClosingBalance { get; init; }
    public Guid? BankAccountId { get; init; }
    public string? ChartOfAccountNumber { get; init; }
    public string? SourceFileName { get; init; }
    public int ImportMethod { get; init; }
    public IReadOnlyList<BankStatementLineDto> Lines { get; init; } = Array.Empty<BankStatementLineDto>();
    /// <summary>Nombre de lignes ignorées au dédoublonnage (option « Ignorer les écritures déjà importées »).</summary>
    public int SkippedDuplicateCount { get; init; }
}

public sealed record BankStatementLineDto
{
    public Guid Id { get; init; }
    public DateTime TransactionDate { get; init; }
    public string Reference { get; init; } = null!;
    public string Description { get; init; } = null!;
    public decimal Amount { get; init; }
    public bool IsDebit { get; init; }
    public bool IsReconciled { get; init; }
    public Guid? ReconciledJournalEntryLineId { get; init; }
}

/// <summary>Poste de suspens d'un état de rapprochement (écriture non pointée ou ligne de relevé non comptabilisée).</summary>
public sealed record BankReconciliationItemDto
{
    public DateTime Date { get; init; }
    public string Reference { get; init; } = null!;
    public string Label { get; init; } = null!;
    public decimal Debit { get; init; }
    public decimal Credit { get; init; }
}

/// <summary>
/// État de rapprochement d'un relevé bancaire : confrontation du solde comptable du compte banque
/// (ancré, cf. lot 0) et du solde du relevé, suspens des deux côtés, et écart qui doit être nul.
/// Lecture seule — aucune écriture, aucune persistance.
/// </summary>
public sealed record BankReconciliationStatementDto
{
    public Guid StatementId { get; init; }
    public string BankName { get; init; } = null!;
    public string AccountNumber { get; init; } = null!;
    public string ChartOfAccountNumber { get; init; } = null!;
    public DateTime PeriodStart { get; init; }
    public DateTime PeriodEnd { get; init; }
    /// <summary>Solde du relevé (B_rel).</summary>
    public decimal StatementClosingBalance { get; init; }
    /// <summary>Solde comptable ancré du compte banque à la date de fin (B_acc = débit − crédit).</summary>
    public decimal AccountingBalance { get; init; }
    /// <summary>Écritures sur le compte banque non encore pointées sur un relevé (chèques émis non débités…).</summary>
    public IReadOnlyList<BankReconciliationItemDto> UnreconciledBookItems { get; init; } = Array.Empty<BankReconciliationItemDto>();
    /// <summary>Lignes du relevé non encore comptabilisées (frais, agios…).</summary>
    public IReadOnlyList<BankReconciliationItemDto> UnreconciledStatementItems { get; init; } = Array.Empty<BankReconciliationItemDto>();
    /// <summary>Solde du relevé corrigé des écritures non pointées (B_rel_corrigé).</summary>
    public decimal AdjustedStatementBalance { get; init; }
    /// <summary>Solde comptable corrigé des lignes de relevé non comptabilisées (B_acc_corrigé).</summary>
    public decimal AdjustedAccountingBalance { get; init; }
    /// <summary>Écart = B_acc_corrigé − B_rel_corrigé, doit être nul.</summary>
    public decimal Difference { get; init; }
    /// <summary>Vrai si l'écart est nul au millime.</summary>
    public bool IsReconciled { get; init; }
}

public sealed record ImportBankStatementRequest
{
    public string BankName { get; init; } = null!;
    public string AccountNumber { get; init; } = null!;
    public DateTime StatementDate { get; init; }
    public DateTime PeriodStart { get; init; }
    public DateTime PeriodEnd { get; init; }
    public decimal OpeningBalance { get; init; }
    public decimal ClosingBalance { get; init; }
    public string Currency { get; init; } = "TND";
    public Guid? BankAccountId { get; init; }
    public string? ChartOfAccountNumber { get; init; }
    public string? SourceFileName { get; init; }
    public string? SourceFileHash { get; init; }
    public int ImportMethod { get; init; }
    /// <summary>
    /// Option « Ignorer les écritures déjà importées » : exclut les lignes dont l'empreinte
    /// existe déjà pour le même compte bancaire. Désactivée (false) = comportement historique.
    /// </summary>
    public bool SkipAlreadyImported { get; init; }
    public IReadOnlyList<ImportBankStatementLineRequest> Lines { get; init; } = Array.Empty<ImportBankStatementLineRequest>();
}

public sealed record ImportBankStatementLineRequest
{
    public DateTime TransactionDate { get; init; }
    public DateTime? ValueDate { get; init; }
    public string Reference { get; init; } = null!;
    public string Description { get; init; } = null!;
    public decimal Amount { get; init; }
    public bool IsDebit { get; init; }
}

public sealed record ReconcileLineRequest
{
    public Guid BankStatementLineId { get; init; }
    public Guid JournalEntryLineId { get; init; }
}

/// <summary>Statut d'association d'une ligne de relevé lors de l'association automatique.</summary>
public enum BankLineAssociationStatus
{
    /// <summary>Aucune écriture candidate — à comptabiliser (créer une écriture).</summary>
    NotAssociated = 0,
    /// <summary>Plusieurs candidats — rapprochement manuel requis.</summary>
    ToReconcile = 1,
    /// <summary>Un seul candidat exact — proposé pour rapprochement (non persisté).</summary>
    Associated = 2
}

/// <summary>Proposition d'association d'une ligne de relevé (résultat de l'association automatique).</summary>
public sealed record BankLineAssociationDto
{
    public Guid BankStatementLineId { get; init; }
    public DateTime TransactionDate { get; init; }
    public string Description { get; init; } = null!;
    public decimal Amount { get; init; }
    public bool IsDebit { get; init; }
    public int Status { get; init; }
    /// <summary>Ligne d'écriture proposée quand Status = Associé.</summary>
    public Guid? ProposedJournalEntryLineId { get; init; }
    /// <summary>Référence lisible de l'écriture proposée (ex. « JV/124 — 31/05 — 4111 »).</summary>
    public string? ProposedEntryRef { get; init; }
    public int CandidateCount { get; init; }
}

/// <summary>Récapitulatif chiffré du rapprochement d'un relevé.</summary>
public sealed record BankReconciliationSummaryDto
{
    public int ImportedCount { get; init; }
    public int AutoMatchedCount { get; init; }
    public int ToReconcileCount { get; init; }
    public int NotAssociatedCount { get; init; }
    public decimal TotalCredit { get; init; }
    public decimal TotalDebit { get; init; }
    /// <summary>Solde net du relevé = crédits − débits.</summary>
    public decimal StatementBalance { get; init; }
}

public sealed record AutoAssociationResultDto
{
    public IReadOnlyList<BankLineAssociationDto> Associations { get; init; } = Array.Empty<BankLineAssociationDto>();
    public BankReconciliationSummaryDto Summary { get; init; } = new();
}

/// <summary>Paire ligne de relevé ↔ ligne d'écriture confirmée pour rapprochement en lot.</summary>
public sealed record ReconcilePairRequest
{
    public Guid BankStatementLineId { get; init; }
    public Guid JournalEntryLineId { get; init; }
}

public sealed record ApplyAssociationsRequest
{
    public IReadOnlyList<ReconcilePairRequest> Pairs { get; init; } = Array.Empty<ReconcilePairRequest>();
}

public sealed record ApplyAssociationsResultDto
{
    public int AppliedCount { get; init; }
    public IReadOnlyList<string> Failures { get; init; } = Array.Empty<string>();
}

/// <summary>Comptabilisation directe d'une ligne de relevé non rapprochée (écriture 532 ↔ contrepartie).</summary>
public sealed record CreateEntryForLineRequest
{
    public string JournalCode { get; init; } = "BQ";
    public string CounterpartyAccount { get; init; } = null!;
    public string? Label { get; init; }
}

/// <summary>Pièce justificative attachée à une écriture (GED).</summary>
public sealed record JournalEntryAttachmentDto
{
    public Guid Id { get; init; }
    public Guid JournalEntryId { get; init; }
    public string FileName { get; init; } = null!;
    public string ContentType { get; init; } = null!;
    public long SizeBytes { get; init; }
    public DateTime CreatedAt { get; init; }
    public string? UploadedBy { get; init; }
}

/// <summary>Lettrage manuel de lignes d'un même compte (partiel autorisé sur demande explicite).</summary>
public sealed record LetterEntriesRequest
{
    public IReadOnlyList<Guid> JournalEntryLineIds { get; init; } = Array.Empty<Guid>();
    public bool AllowPartial { get; init; }

    /// <summary>
    /// « Manual » (défaut) ou « Suggestion » (Phase 3, informatif). Toute autre valeur est
    /// refusée par <c>LetterAccountEntriesCommandValidator</c> (plan §4.3).
    /// </summary>
    public string? Origin { get; init; }

    /// <summary>Phase 3 : identifiant de la proposition validée, recopié dans l'audit (≤ 32 caractères).</summary>
    public string? SuggestionKey { get; init; }
}

/// <summary>« Compléter un lettrage partiel » (plan §4.4, D7) : ajoute des lignes à un groupe « P ».</summary>
public sealed record CompletePartialLetteringRequest
{
    public IReadOnlyList<Guid> JournalEntryLineIds { get; init; } = Array.Empty<Guid>();
    public bool AllowPartial { get; init; }
}

/// <summary>Délettrage d'un groupe par son code (libère les lignes et supprime le groupe).</summary>
/// <summary>
/// Apurement de l'écart de change d'une sélection de lettrage. Le compte d'imputation est saisi à
/// chaque fois : aucun défaut n'est persisté.
/// </summary>
public sealed record SettleExchangeDifferenceRequest
{
    public IReadOnlyList<Guid> JournalEntryLineIds { get; init; } = Array.Empty<Guid>();
    public string AccountNumber { get; init; } = null!;
}

public sealed record UnletterEntriesRequest
{
    public string Code { get; init; } = null!;
}

public sealed record FiscalYearDto
{
    public Guid Id { get; init; }
    public int Year { get; init; }
    public DateTime StartDate { get; init; }
    public DateTime EndDate { get; init; }
    public bool IsClosed { get; init; }
    public string Currency { get; init; } = null!;
}

public sealed record FinancialStatementLineDto
{
    public string AccountNumber { get; init; } = null!;
    public string Label { get; init; } = null!;
    public int AccountClass { get; init; }
    public decimal Amount { get; init; }
    public decimal? PreviousYearAmount { get; init; }
}

public sealed record BalanceSheetDto
{
    public IReadOnlyList<FinancialStatementLineDto> Assets { get; init; } = Array.Empty<FinancialStatementLineDto>();
    public IReadOnlyList<FinancialStatementLineDto> Liabilities { get; init; } = Array.Empty<FinancialStatementLineDto>();
    public decimal TotalAssets { get; init; }
    public decimal TotalLiabilities { get; init; }
    public decimal NetResult { get; init; }
}

public sealed record IncomeStatementDto
{
    public IReadOnlyList<FinancialStatementLineDto> Revenue { get; init; } = Array.Empty<FinancialStatementLineDto>();
    public IReadOnlyList<FinancialStatementLineDto> Expenses { get; init; } = Array.Empty<FinancialStatementLineDto>();
    public decimal TotalRevenue { get; init; }
    public decimal TotalExpenses { get; init; }
    public decimal NetResult { get; init; }
}

public sealed record JournalEntryTemplateDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = null!;
    public string? Description { get; init; }
    public string JournalCode { get; init; } = null!;
    public string? LabelTemplate { get; init; }
    public bool IsActive { get; init; }
    public int UsageCount { get; init; }

    // Récurrence planifiée (0 = None, 1 = mensuelle, 2 = trimestrielle, 3 = annuelle).
    public int RecurrenceFrequency { get; init; }
    public int? RecurrenceDayOfMonth { get; init; }
    public DateTime? RecurrenceStartDate { get; init; }
    public DateTime? RecurrenceEndDate { get; init; }
    public DateTime? NextRunDate { get; init; }
    public DateTime? LastRunAt { get; init; }
    public bool IsRecurring { get; init; }

    public IReadOnlyList<JournalEntryTemplateLineDto> Lines { get; init; } = Array.Empty<JournalEntryTemplateLineDto>();
}

public sealed record JournalEntryTemplateLineDto
{
    public Guid Id { get; init; }
    public int LineNumber { get; init; }
    public string AccountNumber { get; init; } = null!;
    public string? LineLabelTemplate { get; init; }
    public decimal? FixedDebit { get; init; }
    public decimal? FixedCredit { get; init; }
}

public sealed record CreateJournalEntryTemplateRequest
{
    public string Name { get; init; } = null!;
    public string? Description { get; init; }
    public string JournalCode { get; init; } = "JOD";
    public string? LabelTemplate { get; init; }
    /// <summary>Récurrence : 0 = aucune, 1 = mensuelle, 2 = trimestrielle, 3 = annuelle.</summary>
    public int RecurrenceFrequency { get; init; }
    public int? RecurrenceDayOfMonth { get; init; }
    public DateTime? RecurrenceStartDate { get; init; }
    public DateTime? RecurrenceEndDate { get; init; }
    public IReadOnlyList<JournalEntryTemplateLineRequest> Lines { get; init; } = Array.Empty<JournalEntryTemplateLineRequest>();
}

public sealed record UpdateJournalEntryTemplateRequest
{
    public string Name { get; init; } = null!;
    public string? Description { get; init; }
    public string JournalCode { get; init; } = "JOD";
    public string? LabelTemplate { get; init; }
    public bool? IsActive { get; init; }
    /// <summary>Récurrence : 0 = aucune (désactive), 1 = mensuelle, 2 = trimestrielle, 3 = annuelle.</summary>
    public int RecurrenceFrequency { get; init; }
    public int? RecurrenceDayOfMonth { get; init; }
    public DateTime? RecurrenceStartDate { get; init; }
    public DateTime? RecurrenceEndDate { get; init; }
    public IReadOnlyList<JournalEntryTemplateLineRequest> Lines { get; init; } = Array.Empty<JournalEntryTemplateLineRequest>();
}

public sealed record JournalEntryTemplateLineRequest
{
    public int LineNumber { get; init; }
    public string AccountNumber { get; init; } = null!;
    public string? LineLabelTemplate { get; init; }
    public decimal? FixedDebit { get; init; }
    public decimal? FixedCredit { get; init; }
}
