using FactuTrust.Domain.Enums;

namespace FactuTrust.Domain.Authorization;

/// <summary>
/// Permissions granted to accounting firms when operating in delegated client context.
/// </summary>
public static class DelegatedPermissionCatalog
{
    /// <summary>Full accounting + fiscal write access plus read-only operational context.</summary>
    public static readonly IReadOnlyList<string> FirmManagerDelegated = new[]
    {
        Permissions.Accounting.Read,
        Permissions.Accounting.Create,
        Permissions.Accounting.Delete,
        Permissions.Accounting.Close,
        Permissions.Accounting.CurrenciesManage,
        Permissions.Accounting.ExchangeRateOverride,
        Permissions.Accounting.Unletter,
        Permissions.Accounting.Validate,
        Permissions.Accounting.Reverse,
        Permissions.Accounting.Import,
        Permissions.Accounting.Declare,
        Permissions.WithholdingTax.Read,
        Permissions.WithholdingTax.Create,
        Permissions.WithholdingTax.Edit,
        Permissions.WithholdingTax.Validate,
        Permissions.WithholdingTax.Delete,
        Permissions.WithholdingTax.Export,
        Permissions.Audit.Read,
        Permissions.Clients.Read,
        Permissions.Invoices.Read,
        Permissions.Quotes.Read,
        Permissions.DeliveryNotes.Read,
        Permissions.SalesReturnNotes.Read,
        Permissions.Payments.Read,
        Permissions.Suppliers.Read,
        Permissions.PurchaseOrders.Read,
        Permissions.PurchaseReceipts.Read,
        Permissions.SupplierInvoices.Read,
        Permissions.Reports.View,
        Permissions.Reports.Export,
        // Trésorerie prévisionnelle — consultation seule. Le `:manage` serait de toute façon
        // retiré par IsWritePermissionDeniedInDelegatedMode : le recalcul reste au client.
        Permissions.TreasuryForecast.View,
        // Payroll (RH & Paie) — consultation dossiers salariés ; cycles/DTS/paramètres en écriture.
        Permissions.Payroll.Read,
        Permissions.Payroll.RunPayroll,
        Permissions.Payroll.Validate,
        Permissions.Payroll.Declare,
        Permissions.Payroll.Export,
        Permissions.Payroll.Pay,
        Permissions.Payroll.Settings,
        Permissions.AI.Chat
    };

    /// <summary>Accounting operations without period close; same read-only ops context.</summary>
    public static readonly IReadOnlyList<string> FirmAccountantDelegated = new[]
    {
        Permissions.Accounting.Read,
        Permissions.Accounting.Create,
        Permissions.Accounting.Delete,
        Permissions.Accounting.Unletter,
        Permissions.Accounting.Validate,
        Permissions.Accounting.Reverse,
        Permissions.Accounting.Import,
        Permissions.Accounting.Declare,
        Permissions.WithholdingTax.Read,
        Permissions.WithholdingTax.Create,
        Permissions.WithholdingTax.Edit,
        Permissions.WithholdingTax.Validate,
        Permissions.WithholdingTax.Export,
        Permissions.Audit.Read,
        Permissions.Clients.Read,
        Permissions.Invoices.Read,
        Permissions.Quotes.Read,
        Permissions.DeliveryNotes.Read,
        Permissions.SalesReturnNotes.Read,
        Permissions.Payments.Read,
        Permissions.Suppliers.Read,
        Permissions.PurchaseOrders.Read,
        Permissions.PurchaseReceipts.Read,
        Permissions.SupplierInvoices.Read,
        Permissions.Reports.View,
        // Trésorerie prévisionnelle — consultation seule (cf. commentaire côté FirmManager).
        Permissions.TreasuryForecast.View,
        // Payroll (RH & Paie) — consultation dossiers salariés ; cycles/DTS/paramètres en écriture.
        Permissions.Payroll.Read,
        Permissions.Payroll.RunPayroll,
        Permissions.Payroll.Validate,
        Permissions.Payroll.Declare,
        Permissions.Payroll.Export,
        Permissions.Payroll.Pay,
        Permissions.Payroll.Settings,
        Permissions.AI.Chat
    };

    public static IReadOnlyList<string> GetDelegatedPermissions(UserRole role) => role switch
    {
        UserRole.FirmManager => FirmManagerDelegated,
        UserRole.FirmAccountant => FirmAccountantDelegated,
        _ => Array.Empty<string>()
    };

    /// <summary>Permissions for firm native context (cabinet home, not client dossier).</summary>
    public static readonly IReadOnlyList<string> FirmNativePermissions = new[]
    {
        Permissions.Firm.Manage,
        Permissions.Firm.UsersManage,
        Permissions.Firm.AssignmentsManage,
        Permissions.Settings.Read,
        Permissions.Settings.Update,
        Permissions.HonorairesInvoices.Create,
        Permissions.HonorairesInvoices.Read,
        Permissions.HonorairesInvoices.Update,
        Permissions.HonorairesInvoices.Delete,
        Permissions.HonorairesInvoices.Validate,
        Permissions.HonorairesInvoices.Send,
        Permissions.HonorairesQuotes.Create,
        Permissions.HonorairesQuotes.Read,
        Permissions.HonorairesQuotes.Update,
        Permissions.HonorairesQuotes.Delete,
        Permissions.HonorairesQuotes.Convert,
        Permissions.HonorairesPayments.Create,
        Permissions.HonorairesPayments.Read
    };

    /// <summary>Honoraires permissions for FirmAccountant in native firm context (no delete).</summary>
    public static readonly IReadOnlyList<string> FirmNativeHonorairesAccountant = new[]
    {
        Permissions.HonorairesInvoices.Create,
        Permissions.HonorairesInvoices.Read,
        Permissions.HonorairesInvoices.Update,
        Permissions.HonorairesInvoices.Validate,
        Permissions.HonorairesInvoices.Send,
        Permissions.HonorairesQuotes.Create,
        Permissions.HonorairesQuotes.Read,
        Permissions.HonorairesQuotes.Update,
        Permissions.HonorairesQuotes.Convert,
        Permissions.HonorairesPayments.Create,
        Permissions.HonorairesPayments.Read
    };

    /// <summary>
    /// Paie interne cabinet — responsable (tenant natif, flag EnableFirmInternalPayroll).
    /// </summary>
    /// <remarks>
    /// Le cabinet est l'employeur de ses propres salariés : il doit disposer du cycle complet,
    /// du calcul jusqu'au paiement et à la déclaration. S'en tenir au calcul rendait les écrans
    /// de déclaration et de règlement inaccessibles (403) alors même qu'ils sont routés.
    /// </remarks>
    public static readonly IReadOnlyList<string> FirmNativePayrollManagerPermissions = new[]
    {
        Permissions.Payroll.Read,
        Permissions.Payroll.ManageEmployees,
        Permissions.Payroll.RunPayroll,
        Permissions.Payroll.Validate,
        Permissions.Payroll.Settings,
        Permissions.Payroll.Declare,
        Permissions.Payroll.Export,
        Permissions.Payroll.Pay,
        Permissions.Payroll.HrDocuments,
        Permissions.Payroll.ManageTermination,
        Permissions.Payroll.ManageGarnishments
    };

    /// <summary>Paie interne cabinet — comptable (lecture seule).</summary>
    public static readonly IReadOnlyList<string> FirmNativePayrollAccountantPermissions = new[]
    {
        Permissions.Payroll.Read
    };

    public static bool IsWritePermissionDeniedInDelegatedMode(string permission) =>
        permission.Contains(":create", StringComparison.Ordinal) ||
        permission.Contains(":update", StringComparison.Ordinal) ||
        permission.Contains(":delete", StringComparison.Ordinal) ||
        permission.Contains(":manage", StringComparison.Ordinal) ||
        permission.Contains(":sign", StringComparison.Ordinal) ||
        permission.Contains(":send", StringComparison.Ordinal) ||
        permission.Contains(":close", StringComparison.Ordinal) &&
        !permission.StartsWith("accounting:", StringComparison.Ordinal) &&
        !permission.StartsWith("withholding_tax:", StringComparison.Ordinal);
}
