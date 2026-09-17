using System.Security.Cryptography;
using System.Text;
using FactuTrust.Domain.Common;

namespace FactuTrust.Domain.Entities;

/// <summary>
/// Represents an immutable audit log entry with hash chain integrity.
/// </summary>
public sealed class AuditLog : Entity
{
    public Guid? TenantId { get; private set; }
    public Guid? UserId { get; private set; }
    public string UserEmail { get; private set; } = null!;
    
    public string Action { get; private set; } = null!;
    public string EntityType { get; private set; } = null!;
    public Guid? EntityId { get; private set; }
    
    public string? OldValues { get; private set; }
    public string? NewValues { get; private set; }
    
    public string IpAddress { get; private set; } = null!;
    public string? UserAgent { get; private set; }
    
    public string PreviousHash { get; private set; } = null!;
    public string Hash { get; private set; } = null!;

    private AuditLog() { }

    public static AuditLog Create(
        Guid? tenantId,
        Guid? userId,
        string userEmail,
        string action,
        string entityType,
        Guid? entityId,
        string? oldValues,
        string? newValues,
        string ipAddress,
        string? userAgent,
        string previousHash)
    {
        var log = new AuditLog
        {
            TenantId = tenantId,
            UserId = userId,
            UserEmail = userEmail,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            OldValues = oldValues,
            NewValues = newValues,
            IpAddress = ipAddress,
            UserAgent = userAgent,
            PreviousHash = previousHash
        };

        log.Hash = log.ComputeHash();

        return log;
    }

    /// <summary>
    /// Computes the same SHA-256 (Base64) hash as stored on the row, for verification and administrative chain repair.
    /// </summary>
    public static string ComputeIntegrityHash(
        Guid id,
        DateTime createdAt,
        Guid? tenantId,
        Guid? userId,
        string action,
        string entityType,
        Guid? entityId,
        string? oldValues,
        string? newValues,
        string previousHash)
    {
        var dataToHash =
            $"{id}|{createdAt:O}|{tenantId}|{userId}|{action}|{entityType}|{entityId}|{oldValues}|{newValues}|{previousHash}";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(dataToHash));
        return Convert.ToBase64String(bytes);
    }

    private string ComputeHash() =>
        ComputeIntegrityHash(Id, CreatedAt, TenantId, UserId, Action, EntityType, EntityId, OldValues, NewValues, PreviousHash);

    /// <summary>
    /// Administrative repair only: sets <see cref="PreviousHash"/> and recomputes <see cref="Hash"/> from current payload fields.
    /// </summary>
    public void ResealForChainRepair(string previousHash)
    {
        PreviousHash = previousHash;
        Hash = ComputeHash();
    }

    public bool VerifyIntegrity()
    {
        return Hash == ComputeHash();
    }

    public bool VerifyChain(AuditLog? previousLog)
    {
        if (previousLog is null)
            return PreviousHash == "GENESIS";

        return PreviousHash == previousLog.Hash;
    }
}

/// <summary>
/// Common audit actions.
/// </summary>
public static class AuditActions
{
    public static class Auth
    {
        public const string Login = "Auth.Login";
        public const string LoginFailed = "Auth.LoginFailed";
        public const string Logout = "Auth.Logout";
        public const string PasswordChange = "Auth.PasswordChange";
        public const string TwoFactorEnabled = "Auth.TwoFactorEnabled";
        public const string TwoFactorDisabled = "Auth.TwoFactorDisabled";
    }

    public static class Invoice
    {
        public const string Created = "Invoice.Created";
        public const string Updated = "Invoice.Updated";
        public const string Validated = "Invoice.Validated";
        public const string Signed = "Invoice.Signed";
        public const string Sent = "Invoice.Sent";
        public const string Paid = "Invoice.Paid";
        public const string EffetSettled = "Invoice.EffetSettled";
        public const string Cancelled = "Invoice.Cancelled";
        public const string Archived = "Invoice.Archived";
        public const string Exported = "Invoice.Exported";
        public const string Viewed = "Invoice.Viewed";
    }

    public static class Client
    {
        public const string Created = "Client.Created";
        public const string Updated = "Client.Updated";
        public const string Deleted = "Client.Deleted";
    }

    public static class SalesOrder
    {
        public const string Created = "SalesOrder.Created";
        public const string Updated = "SalesOrder.Updated";
        public const string Confirmed = "SalesOrder.Confirmed";
        public const string Cancelled = "SalesOrder.Cancelled";
        /// <summary>Soldée en abandonnant le reliquat — distinct de l'annulation.</summary>
        public const string Closed = "SalesOrder.Closed";
        public const string Deleted = "SalesOrder.Deleted";
    }

    public static class Stock
    {
        /// <summary>
        /// Une sortie de stock n'a pu être honorée que partiellement, faute de stock disponible.
        /// La vente n'est pas bloquée ; l'écart est tracé pour être réconcilié.
        /// </summary>
        public const string DeductionShortfall = "Stock.DeductionShortfall";
    }

    public static class StockVoucher
    {
        public const string Created = "StockVoucher.Created";
        public const string Updated = "StockVoucher.Updated";
        public const string Validated = "StockVoucher.Validated";
        public const string Cancelled = "StockVoucher.Cancelled";
        public const string Deleted = "StockVoucher.Deleted";
        public const string Exported = "StockVoucher.Exported";
    }

    public static class Product
    {
        public const string Created = "Product.Created";
        public const string Updated = "Product.Updated";
        public const string Deleted = "Product.Deleted";
    }

    public static class User
    {
        public const string Created = "User.Created";
        public const string Updated = "User.Updated";
        public const string Deleted = "User.Deleted";
        public const string RoleChanged = "User.RoleChanged";
        public const string ModuleGrantsChanged = "User.ModuleGrantsChanged";
        public const string Deactivated = "User.Deactivated";
        public const string Reactivated = "User.Reactivated";
    }

    public static class Subscription
    {
        public const string Upgraded = "Subscription.Upgraded";
        public const string Downgraded = "Subscription.Downgraded";
        public const string Cancelled = "Subscription.Cancelled";
        public const string Renewed = "Subscription.Renewed";
    }

    public static class Settings
    {
        public const string Updated = "Settings.Updated";
    }

    public static class Quote
    {
        public const string Created = "Quote.Created";
        public const string Updated = "Quote.Updated";
        public const string Sent = "Quote.Sent";
        public const string Accepted = "Quote.Accepted";
        public const string Rejected = "Quote.Rejected";
        public const string Cancelled = "Quote.Cancelled";
        public const string Converted = "Quote.Converted";
        public const string Viewed = "Quote.Viewed";
    }

    public static class Export
    {
        public const string Pdf = "Export.Pdf";
        public const string Xml = "Export.Xml";
        public const string Data = "Export.Data";
    }

    public static class DeliveryNote
    {
        public const string Created = "DeliveryNote.Created";
        public const string Updated = "DeliveryNote.Updated";
        public const string Confirmed = "DeliveryNote.Confirmed";
        public const string InTransit = "DeliveryNote.InTransit";
        public const string Delivered = "DeliveryNote.Delivered";
        public const string Failed = "DeliveryNote.Failed";
        public const string Invoiced = "DeliveryNote.Invoiced";
        public const string Cancelled = "DeliveryNote.Cancelled";
        public const string Viewed = "DeliveryNote.Viewed";
        public const string Exported = "DeliveryNote.Exported";
        public const string ModificationAttempted = "DeliveryNote.ModificationAttempted";
    }

    public static class SalesReturnNote
    {
        public const string Created = "SalesReturnNote.Created";
        public const string Updated = "SalesReturnNote.Updated";
        public const string Confirmed = "SalesReturnNote.Confirmed";
        public const string Deleted = "SalesReturnNote.Deleted";
        public const string Exported = "SalesReturnNote.Exported";
    }

    public static class Supplier
    {
        public const string Created = "Supplier.Created";
        public const string Updated = "Supplier.Updated";
        public const string Deleted = "Supplier.Deleted";
    }

    public static class PurchaseOrder
    {
        public const string Created = "PurchaseOrder.Created";
        public const string Updated = "PurchaseOrder.Updated";
        public const string Confirmed = "PurchaseOrder.Confirmed";
        public const string GoodsReceived = "PurchaseOrder.GoodsReceived";
        public const string Cancelled = "PurchaseOrder.Cancelled";
        public const string Deleted = "PurchaseOrder.Deleted";
        public const string Exported = "PurchaseOrder.Exported";
        public const string Sent = "PurchaseOrder.Sent";
    }

    public static class PurchaseReceipt
    {
        public const string Created = "PurchaseReceipt.Created";
        public const string Updated = "PurchaseReceipt.Updated";
        public const string Validated = "PurchaseReceipt.Validated";
        public const string Cancelled = "PurchaseReceipt.Cancelled";
        public const string Deleted = "PurchaseReceipt.Deleted";
        public const string Exported = "PurchaseReceipt.Exported";
        public const string AttachmentAdded = "PurchaseReceipt.AttachmentAdded";
        public const string AttachmentDeleted = "PurchaseReceipt.AttachmentDeleted";
    }

    public static class SupplierInvoice
    {
        public const string Created = "SupplierInvoice.Created";
        public const string Paid = "SupplierInvoice.Paid";
        public const string EffetSettled = "SupplierInvoice.EffetSettled";
        public const string Cancelled = "SupplierInvoice.Cancelled";
    }

    public static class CashExpense
    {
        public const string Created = "CashExpense.Created";
        public const string Cancelled = "CashExpense.Cancelled";
    }

    public static class CashOperation
    {
        public const string Created = "CashOperation.Created";
        public const string Cancelled = "CashOperation.Cancelled";
    }

    public static class CashRegisterSession
    {
        public const string Opened = "CashRegisterSession.Opened";
        public const string Closed = "CashRegisterSession.Closed";
    }

    public static class BankAccount
    {
        public const string Created = "BankAccount.Created";
        public const string Updated = "BankAccount.Updated";
        public const string Deleted = "BankAccount.Deleted";
        public const string DefaultChanged = "BankAccount.DefaultChanged";
    }

    public static class BankDeposit
    {
        public const string Created = "BankDeposit.Created";
        public const string Cancelled = "BankDeposit.Cancelled";
    }

    public static class WithholdingCertificate
    {
        public const string Created = "WithholdingCertificate.Created";
        public const string Updated = "WithholdingCertificate.Updated";
        public const string Validated = "WithholdingCertificate.Validated";
        public const string Cancelled = "WithholdingCertificate.Cancelled";
        public const string Deleted = "WithholdingCertificate.Deleted";
        public const string Exported = "WithholdingCertificate.Exported";
        public const string PdfGenerated = "WithholdingCertificate.PdfGenerated";
        public const string TejSubmitted = "WithholdingCertificate.TejSubmitted";
    }

    public static class TejExport
    {
        public const string XmlGenerated = "TejExport.XmlGenerated";
        public const string XmlPreviewed = "TejExport.XmlPreviewed";
        public const string ValidationFailed = "TejExport.ValidationFailed";
    }

    public static class Accounting
    {
        public const string ManualEntryCreated = "Accounting.ManualEntryCreated";
        public const string EntryValidated = "Accounting.EntryValidated";
        public const string EntriesBatchValidated = "Accounting.EntriesBatchValidated";
        public const string DraftUpdated = "Accounting.DraftUpdated";
        public const string DraftDeleted = "Accounting.DraftDeleted";
        public const string EntryReversed = "Accounting.EntryReversed";
        public const string DossierImported = "Accounting.DossierImported";
        /// <summary>Personnalisation d'une note annexe NCT (titre, texte, masquage) créée, modifiée ou rétablie.</summary>
        public const string NctNoteOverrideChanged = "Accounting.NctNoteOverrideChanged";
        public const string PeriodClosed = "Accounting.PeriodClosed";
        public const string PeriodReopened = "Accounting.PeriodReopened";
        public const string FiscalYearClosed = "Accounting.FiscalYearClosed";
        public const string VatDeclarationSaved = "Accounting.VatDeclarationSaved";
        public const string VatDeclarationSubmitted = "Accounting.VatDeclarationSubmitted";
        public const string VatDeclarationRectified = "Accounting.VatDeclarationRectified";
        public const string Lettered = "Accounting.Lettered";
        public const string Unlettered = "Accounting.Unlettered";
        public const string SubAccountCreated = "Accounting.SubAccountCreated";
        public const string AccountLabelUpdated = "Accounting.AccountLabelUpdated";
        public const string AccountToggled = "Accounting.AccountToggled";
        public const string AccountReplaced = "Accounting.AccountReplaced";
        public const string JournalCreated = "Accounting.JournalCreated";
        public const string JournalUpdated = "Accounting.JournalUpdated";
        public const string JournalToggled = "Accounting.JournalToggled";
        public const string JournalFamilyCreated = "Accounting.JournalFamilyCreated";
        public const string CurrencyCreated = "Accounting.CurrencyCreated";
        public const string CurrencyUpdated = "Accounting.CurrencyUpdated";
        public const string CurrencyToggled = "Accounting.CurrencyToggled";
        public const string CurrencyRatesSaved = "Accounting.CurrencyRatesSaved";
        /// <summary>Taux de change saisi manuellement, différent de celui de la table.</summary>
        public const string ExchangeRateOverridden = "Accounting.ExchangeRateOverridden";
        /// <summary>Écart de change apuré par une écriture d'ajustement depuis l'écran de lettrage.</summary>
        public const string ExchangeDifferenceSettled = "Accounting.ExchangeDifferenceSettled";
        /// <summary>Réévaluation des positions en devise à la clôture d'une période.</summary>
        public const string ClosingRevaluationRun = "Accounting.ClosingRevaluationRun";
        public const string BudgetPostCreated = "Accounting.BudgetPostCreated";
        public const string BudgetPostUpdated = "Accounting.BudgetPostUpdated";
        public const string BudgetPostToggled = "Accounting.BudgetPostToggled";
        public const string BudgetYearSaved = "Accounting.BudgetYearSaved";
        public const string BudgetInitialValidated = "Accounting.BudgetInitialValidated";

        // ── Déclaration mensuelle paramétrable ───────────────────────────────
        public const string MonthlyDeclarationRubricCreated = "Accounting.MonthlyDeclarationRubricCreated";
        public const string MonthlyDeclarationRubricUpdated = "Accounting.MonthlyDeclarationRubricUpdated";
        public const string MonthlyDeclarationRubricToggled = "Accounting.MonthlyDeclarationRubricToggled";
        public const string MonthlyDeclarationRubricDeleted = "Accounting.MonthlyDeclarationRubricDeleted";
        public const string MonthlyDeclarationFamilyToggled = "Accounting.MonthlyDeclarationFamilyToggled";
        /// <summary>Changement de régime de calcul du dossier (Legacy / Parity / Configured).</summary>
        public const string MonthlyDeclarationModeChanged = "Accounting.MonthlyDeclarationModeChanged";
        public const string MonthlyDeclarationConfigDuplicated = "Accounting.MonthlyDeclarationConfigDuplicated";
        public const string MonthlyDeclarationConfigImported = "Accounting.MonthlyDeclarationConfigImported";
        /// <summary>
        /// Exécution du calcul paramétré sur une période. La charge utile porte les totaux par
        /// famille <b>et</b> les codes de diagnostic : c'est la trace qui expliquera, des mois plus
        /// tard, pourquoi un montant déposé diffère d'un recalcul.
        /// </summary>
        public const string MonthlyDeclarationComputed = "Accounting.MonthlyDeclarationComputed";
        public const string ThirdPartyProfileSaved = "Accounting.ThirdPartyProfileSaved";
        public const string ThirdPartyCodesGenerated = "Accounting.ThirdPartyCodesGenerated";
        public const string FecExported = "Accounting.FecExported";
        public const string JournalTemplateCreated = "Accounting.JournalTemplateCreated";
        public const string JournalTemplateUpdated = "Accounting.JournalTemplateUpdated";
        public const string JournalTemplateDeleted = "Accounting.JournalTemplateDeleted";
        public const string RecurringEntryGenerated = "Accounting.RecurringEntryGenerated";
        public const string InventoryEntryCreated = "Accounting.InventoryEntryCreated";
        public const string FiscalYearLocked = "Accounting.FiscalYearLocked";
        public const string AttachmentAdded = "Accounting.AttachmentAdded";
        public const string AttachmentDeleted = "Accounting.AttachmentDeleted";
        public const string FiscalScheduleCreated = "Accounting.FiscalScheduleCreated";
        public const string FiscalScheduleUpdated = "Accounting.FiscalScheduleUpdated";
        public const string FiscalScheduleDeleted = "Accounting.FiscalScheduleDeleted";
        public const string FiscalScheduleDeposited = "Accounting.FiscalScheduleDeposited";
        public const string FiscalSchedulePaymentCaptured = "Accounting.FiscalSchedulePaymentCaptured";
        public const string FiscalScheduleReminderScheduled = "Accounting.FiscalScheduleReminderScheduled";
        public const string FiscalScheduleValidated = "Accounting.FiscalScheduleValidated";
        public const string FiscalScheduleGenerated = "Accounting.FiscalScheduleGenerated";
        public const string FiscalScheduleAttachmentAdded = "Accounting.FiscalScheduleAttachmentAdded";
        public const string FiscalScheduleAttachmentDeleted = "Accounting.FiscalScheduleAttachmentDeleted";
        public const string BankStatementImported = "Accounting.BankStatementImported";
        public const string BankLineReconciled = "Accounting.BankLineReconciled";
        public const string BankLineUnreconciled = "Accounting.BankLineUnreconciled";
        public const string BankEntryCreatedFromLine = "Accounting.BankEntryCreatedFromLine";
    }
}
