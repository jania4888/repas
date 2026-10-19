using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Reports;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces.Repositories;

public interface IPurchaseReceiptRepository : IRepository<PurchaseReceipt>
{
    Task<PurchaseReceipt?> GetByIdWithLinesAsync(Guid id, CancellationToken cancellationToken = default);

    Task<PurchaseReceipt?> GetByIdWithDetailsAsync(Guid id, CancellationToken cancellationToken = default);

    Task<(IReadOnlyList<PurchaseReceipt> Items, int TotalCount)> SearchAsync(
        string? searchTerm,
        PurchaseReceiptStatus? status,
        Guid? supplierId,
        Guid? purchaseOrderId,
        DateTime? fromDate,
        DateTime? toDate,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    Task<PurchaseReceiptListSummaryDto> GetSummaryAsync(
        string? searchTerm,
        PurchaseReceiptStatus? status,
        Guid? supplierId,
        Guid? purchaseOrderId,
        DateTime? fromDate,
        DateTime? toDate,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PurchaseReceipt>> GetByPurchaseOrderIdAsync(
        Guid purchaseOrderId,
        CancellationToken cancellationToken = default);

    Task<bool> ExistsNumberAsync(string number, CancellationToken cancellationToken = default);

    /// <summary>
    /// Insère une pièce jointe (nouvelle ligne) sur un bon de réception existant.
    /// Ne passe PAS par <c>UpdateAsync</c> : celui-ci attache le graphe détaché, et un enfant
    /// dont la clé Guid est déjà assignée serait suivi comme Unchanged (jamais INSERT).
    /// Même approche que <c>FiscalScheduleRepository.AddAttachmentAsync</c>.
    /// </summary>
    Task AddAttachmentAsync(PurchaseReceiptAttachment attachment, CancellationToken cancellationToken = default);

    /// <summary>
    /// Supprime une pièce jointe existante (l'entité peut être détachée : seule sa clé sert
    /// à retrouver la ligne à supprimer).
    /// </summary>
    Task DeleteAttachmentAsync(PurchaseReceiptAttachment attachment, CancellationToken cancellationToken = default);

    /// <summary>
    /// Vrai si un bon de réception non annulé existe déjà pour ce fournisseur avec le même
    /// numéro de bon de livraison (comparaison exacte après <c>Trim</c>). Utilisé par l'import
    /// de document pour avertir d'un doublon possible, jamais pour bloquer la création.
    /// </summary>
    Task<bool> ExistsActiveForSupplierDeliveryNoteAsync(
        Guid supplierId,
        string deliveryNoteNumber,
        CancellationToken cancellationToken = default);

    Task<(IReadOnlyList<PurchasesJournalDetailRowDto> Rows, int TotalCount)> GetPurchasesJournalDetailPagedAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        int page,
        int pageSize,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PurchasesJournalDetailRowDto>> GetPurchasesJournalDetailAllAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        int maxRows,
        CancellationToken cancellationToken = default);

    Task<PurchasesJournalTotalsDto> GetPurchasesJournalDetailTotalsAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        CancellationToken cancellationToken = default);

    Task<int> CountPurchasesJournalDetailAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<PurchasesJournalAggregatedRowDto>> GetPurchasesJournalAggregatedAsync(
        DateTime fromDate,
        DateTime toDate,
        Guid? supplierId,
        SalesJournalViewMode groupBy,
        CancellationToken cancellationToken = default);
}
