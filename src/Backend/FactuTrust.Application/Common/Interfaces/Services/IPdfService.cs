using FactuTrust.Application.Common.Enums;
using FactuTrust.Application.Common.Models;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;

namespace FactuTrust.Application.Common.Interfaces.Services;

/// <summary>
/// Service for generating PDF documents.
/// </summary>
public interface IPdfService
{
    /// <summary>Génère le PDF de la déclaration mensuelle des impôts (toutes les cases).</summary>
    Task<byte[]> GenerateVatDeclarationPdfAsync(VatDeclarationDto declaration, string companyName, CancellationToken cancellationToken = default);

    /// <summary>
    /// Génère la déclaration mensuelle sur le <b>formulaire officiel de la DGI</b>
    /// (« التصريح الشهري بالأداءات ») : le gabarit préimprimé est repris tel quel et seules les
    /// valeurs sont tamponnées dans les cases réglementaires.
    /// </summary>
    /// <param name="withholdingLines">
    /// Ventilation de la retenue à la source par ligne officielle du formulaire. Null ou vide =
    /// seul le total est reporté.
    /// </param>
    /// <param name="configuredBoxes">
    /// Cases issues des rubriques paramétrées. Null ou vide = aucune ventilation configurée.
    /// </param>
    Task<byte[]> GenerateMonthlyDeclarationOfficialFormPdfAsync(
        VatDeclarationDto declaration,
        IReadOnlyDictionary<string, decimal>? withholdingLines = null,
        IReadOnlyDictionary<string, decimal>? configuredBoxes = null,
        CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF de la liasse NCT (bilan, résultat, flux, capitaux, notes agrégées) — chemin legacy.</summary>
    Task<byte[]> GenerateNctLiassePdfAsync(NctFinancialStatementsDto statements, string companyName, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF NCT filtré (dialogue États financiers) avec notes détaillées compte/compte.</summary>
    Task<byte[]> GenerateNctLiassePdfAsync(NctLiasseExportView exportView, string companyName, CancellationToken cancellationToken = default);

    /// <summary>
    /// Génère le PDF d'un état Studio (low-code). Rendu GÉNÉRIQUE piloté par le seul
    /// <c>ReportResultDto</c> : colonnes dimension/mesure, lignes, totaux — donc tout état créé dans
    /// le Studio (y compris par l'IA) devient imprimable sans rendu dédié.
    /// </summary>
    Task<byte[]> GenerateStudioReportPdfAsync(
        Features.Studio.Common.StudioReportPdfContext context, CancellationToken cancellationToken = default);

    // ── États comptables cœur & complémentaires (rendu tabulaire professionnel) ────────────

    /// <summary>Génère le PDF du journal, regroupé par code journal, avec sous-totaux et total général.</summary>
    Task<byte[]> GenerateJournalPdfAsync(IReadOnlyList<JournalEntryDto> entries, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF d'un récapitulatif de journaux (centralisateur, récapitulation ou totaux).</summary>
    Task<byte[]> GenerateJournalSummaryPdfAsync(JournalSummaryDto summary, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF du grand livre d'un compte (mouvements + solde progressif).</summary>
    Task<byte[]> GenerateLedgerPdfAsync(string accountNumber, IReadOnlyList<LedgerRowDto> rows, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF du grand livre général : comptes en séquence, report à nouveau, sous-total par compte.</summary>
    Task<byte[]> GenerateGeneralLedgerPdfAsync(GeneralLedgerDto ledger, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF de la balance générale (ouverture / mouvements / clôture) avec totaux.</summary>
    Task<byte[]> GenerateBalancePdfAsync(IReadOnlyList<BalanceRowDto> rows, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF de la balance détaillée (soldes + détail des mouvements par compte).</summary>
    Task<byte[]> GenerateDetailedBalancePdfAsync(DetailedBalanceDto balance, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF de la balance par période (12 colonnes mensuelles).</summary>
    Task<byte[]> GeneratePeriodicBalancePdfAsync(PeriodicBalanceDto balance, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF de la balance auxiliaire (une ligne par tiers) avec totaux.</summary>
    Task<byte[]> GenerateAuxiliaryBalancePdfAsync(IReadOnlyList<AuxiliaryBalanceRowDto> rows, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF de l'état de rapprochement bancaire (soldes confrontés, suspens, écart).</summary>
    Task<byte[]> GenerateBankReconciliationStatementPdfAsync(BankReconciliationStatementDto statement, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF du grand livre d'un tiers (solde d'ouverture + mouvements + lettrage).</summary>
    Task<byte[]> GenerateThirdPartyLedgerPdfAsync(ThirdPartyLedgerDto ledger, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF de la balance âgée (tranches d'antériorité) avec totaux.</summary>
    Task<byte[]> GenerateAgingPdfAsync(IReadOnlyList<AgingReportRowDto> rows, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF du bilan (actif / passif) avec comparatif N-1.</summary>
    Task<byte[]> GenerateBalanceSheetPdfAsync(BalanceSheetDto dto, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF du compte de résultat (produits / charges) avec comparatif N-1.</summary>
    Task<byte[]> GenerateIncomeStatementPdfAsync(IncomeStatementDto dto, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF de la détermination du résultat fiscal (réintégrations/déductions + calcul de l'impôt).</summary>
    Task<byte[]> GenerateFiscalResultPdfAsync(FiscalResultDeclarationDto dto, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>
    /// Génère le PDF du rapport de contrôle d'intégrité : synthèse de conformité, répartition par
    /// module, puis détail des anomalies (sévérité, compte, période, montant, statut).
    /// </summary>
    Task<byte[]> GenerateAccountingAuditPdfAsync(AccountingAuditPdfContext context, CancellationToken cancellationToken = default);

    /// <summary>
    /// Génère le PDF du <b>dossier de révision</b> : synthèse, puis une note de travail par
    /// anomalie avec sa gravité, son impact chiffré, sa pièce et l'action retenue.
    /// </summary>
    Task<byte[]> GenerateRevisionDossierPdfAsync(RevisionDossierPdfContext context, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF de la liasse consolidée (états NCT + détermination fiscale + tableaux annexes).</summary>
    Task<byte[]> GenerateConsolidatedLiassePdfAsync(ConsolidatedLiasseDto dto, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF du livre d'inventaire (états NCT + provisions détaillées + balance de clôture).</summary>
    Task<byte[]> GenerateInventoryBookPdfAsync(InventoryBookDto dto, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF du tableau d'amortissement d'un emprunt (échéancier + totaux).</summary>
    Task<byte[]> GenerateLoanSchedulePdfAsync(LoanScheduleDto schedule, AccountingReportHeader header, CancellationToken cancellationToken = default);

    /// <summary>
    /// Generates a PDF for a sales invoice (full layout with issuer branding).
    /// </summary>
    Task<byte[]> GenerateInvoicePdfAsync(InvoicePdfContext context, CancellationToken cancellationToken = default);

    /// <summary>
    /// Génère le PDF d'une facture en appliquant un modèle visuel donné. Si <paramref name="templateKey"/>
    /// est le modèle par défaut (ou null/inconnu), le rendu historique est utilisé (zéro régression).
    /// </summary>
    Task<byte[]> GenerateInvoicePdfAsync(InvoicePdfContext context, string? templateKey, CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Generates a PDF for multiple invoices (report).
    /// </summary>
    /// <param name="invoices">The invoices to include in the report.</param>
    /// <param name="fromDate">Optional start date for the period (displayed in header).</param>
    /// <param name="toDate">Optional end date for the period (displayed in header).</param>
    /// <param name="company">Optional company for branding in the report header.</param>
    /// <param name="clientName">Optional client name when report is filtered by client.</param>
    Task<byte[]> GenerateInvoiceReportPdfAsync(
        IEnumerable<Invoice> invoices,
        DateTime? fromDate = null,
        DateTime? toDate = null,
        Company? company = null,
        string? clientName = null,
        CancellationToken cancellationToken = default);
    
    /// <summary>
    /// Generates a PDF for multiple delivery notes (report).
    /// </summary>
    Task<byte[]> GenerateDeliveryNoteReportPdfAsync(
        IEnumerable<DeliveryNote> deliveryNotes,
        DateTime? fromDate = null,
        DateTime? toDate = null,
        Company? company = null,
        string? clientName = null,
        CancellationToken cancellationToken = default);

    Task<byte[]> GenerateSalesJournalReportPdfAsync(
        SalesJournalPdfContext context,
        CancellationToken cancellationToken = default);

    Task<byte[]> GeneratePurchasesJournalReportPdfAsync(
        PurchasesJournalPdfContext context,
        CancellationToken cancellationToken = default);

    Task<byte[]> GenerateStockStatusReportPdfAsync(
        StockStatusPdfContext context,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Generates a PDF for a quote (devis).
    /// </summary>
    Task<byte[]> GenerateQuotePdfAsync(Quote quote, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF d'un devis avec un modèle visuel donné (défaut/inconnu = rendu historique).</summary>
    Task<byte[]> GenerateQuotePdfAsync(Quote quote, Company? issuer, string? templateKey, CancellationToken cancellationToken = default);

    /// <summary>
    /// Generates a PDF for a purchase order (bon de commande fournisseur).
    /// </summary>
    Task<byte[]> GeneratePurchaseOrderPdfAsync(PurchaseOrder purchaseOrder, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF d'un bon de commande avec un modèle visuel donné (défaut/inconnu = rendu historique).</summary>
    Task<byte[]> GeneratePurchaseOrderPdfAsync(PurchaseOrder purchaseOrder, Company? issuer, string? templateKey, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF individuel d'un bon de livraison avec un modèle visuel.</summary>
    Task<byte[]> GenerateDeliveryNotePdfAsync(DeliveryNote deliveryNote, Company? issuer, string? templateKey, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF individuel d'un bon de retour client.</summary>
    Task<byte[]> GenerateSalesReturnNotePdfAsync(SalesReturnNote note, Company? issuer, string? templateKey, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF d'une facture d'achat (fournisseur) avec un modèle visuel.</summary>
    Task<byte[]> GenerateSupplierInvoicePdfAsync(SupplierInvoice supplierInvoice, Company? issuer, string? templateKey, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF d'un bon de réception d'achat.</summary>
    Task<byte[]> GeneratePurchaseReceiptPdfAsync(PurchaseReceipt receipt, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF d'un bon d'entrée ou de sortie de stock.</summary>
    Task<byte[]> GenerateStockVoucherPdfAsync(StockVoucher voucher, CancellationToken cancellationToken = default);

    /// <summary>
    /// Generates a PDF for a stock transfer between warehouses.
    /// </summary>
    Task<byte[]> GenerateStockTransferPdfAsync(StockTransfer stockTransfer, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF d'un bulletin de paie.</summary>
    Task<byte[]> GeneratePayslipPdfAsync(PayslipDetailDto payslip, string companyName, CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF d'un certificat de retenue à la source salariale.</summary>
    Task<byte[]> GeneratePayrollWithholdingCertificatePdfAsync(
        PayrollWithholdingCertificateLineDto line,
        PayrollWithholdingCertificateBatchDto batch,
        CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF du livre de paie simplifié (état de contrôle).</summary>
    Task<byte[]> GeneratePayrollBookPdfAsync(
        PayrollBookDto book,
        AccountingReportHeader header,
        CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF du journal de paie (vue par salarié ou ventilation comptable).</summary>
    Task<byte[]> GeneratePayrollJournalPdfAsync(
        PayrollJournalDto journal,
        PayrollJournalView view,
        AccountingReportHeader header,
        CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF du bordereau mensuel de versement des cotisations CNSS.</summary>
    Task<byte[]> GenerateCnssContributionRemittancePdfAsync(
        CnssContributionRemittanceDto remittance,
        CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF d'un certificat de travail.</summary>
    Task<byte[]> GenerateEmploymentCertificatePdfAsync(
        EmploymentCertificateDto certificate,
        CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF d'une attestation de salaire.</summary>
    Task<byte[]> GenerateSalaryCertificatePdfAsync(
        SalaryCertificateDto certificate,
        CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF d'un solde de tout compte.</summary>
    Task<byte[]> GenerateSoldeToutComptePdfAsync(
        SoldeToutCompteDto settlement,
        CancellationToken cancellationToken = default);

    /// <summary>Génère le PDF d'une attestation CIVP/SIVP.</summary>
    Task<byte[]> GenerateCivpAttestationPdfAsync(
        CivpAttestationDto attestation,
        CancellationToken cancellationToken = default);
}
