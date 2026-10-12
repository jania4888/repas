namespace FactuTrust.Domain.Enums;

using FactuTrust.Domain.Authorization;

/// <summary>
/// User roles within a tenant/company.
/// </summary>
public enum UserRole
{
    /// <summary>
    /// Full access to all features and settings.
    /// </summary>
    Administrator = 0,

    /// <summary>
    /// Can create, edit, and manage invoices and clients.
    /// Cannot manage users or company settings.
    /// </summary>
    Accountant = 1,

    /// <summary>
    /// Read-only access to their own invoices and payments.
    /// Limited portal access for external clients.
    /// </summary>
    Client = 2,

    /// <summary>
    /// Sales representative. Can manage clients, quotes, invoices, but no settings or reports.
    /// </summary>
    SalesRep = 3,

    /// <summary>
    /// Sales manager. Can do everything a SalesRep can, plus reports and deleting sales documents.
    /// </summary>
    SalesManager = 4,

    /// <summary>
    /// Warehouse staff. Can manage stock, transfers, inventory, but no access to sales or financials.
    /// </summary>
    Warehouse = 5,

    /// <summary>
    /// Purchasing agent. Can manage suppliers and purchase orders/invoices.
    /// </summary>
    Purchaser = 6,

    /// <summary>
    /// Point of sale cashier. Limited to creating invoices/payments and viewing products/stock.
    /// </summary>
    Cashier = 7,

    /// <summary>
    /// Auditor. Read-only access to everything.
    /// </summary>
    Auditor = 8,

    /// <summary>
    /// Supervisor. Full access like Administrator, except cannot manage users.
    /// </summary>
    Supervisor = 9,

    /// <summary>
    /// Developer (low-code "Studio"). Designs custom tables/forms/reports and manages their records.
    /// Has read-only access to whitelisted existing data (clients/products/invoices) for building reports.
    /// </summary>
    Developer = 10,

    /// <summary>
    /// Accounting firm manager. Manages firm users, assignments, and all delegated client dossiers.
    /// Only valid for tenants with Kind = AccountingFirm.
    /// </summary>
    FirmManager = 11,

    /// <summary>
    /// Accounting firm staff. Access to delegated client accounting without user/assignment management.
    /// Only valid for tenants with Kind = AccountingFirm.
    /// </summary>
    FirmAccountant = 12
}

public static class UserRoleExtensions
{
    public static string ToDisplayString(this UserRole role) => role switch
    {
        UserRole.Administrator => "Administrateur",
        UserRole.Accountant => "Comptable",
        UserRole.Client => "Client",
        UserRole.SalesRep => "Commercial",
        UserRole.SalesManager => "Responsable Commercial",
        UserRole.Warehouse => "Magasinier",
        UserRole.Purchaser => "Acheteur",
        UserRole.Cashier => "Caissier",
        UserRole.Auditor => "Auditeur",
        UserRole.Supervisor => "Superviseur",
        UserRole.Developer => "Développeur",
        UserRole.FirmManager => "Responsable cabinet",
        UserRole.FirmAccountant => "Comptable cabinet",
        _ => throw new ArgumentOutOfRangeException(nameof(role))
    };

    public static IEnumerable<string> GetPermissions(this UserRole role) => role switch
    {
        UserRole.Administrator => new[]
        {
            Permissions.Invoices.Create,
            Permissions.Invoices.Read,
            Permissions.Invoices.Update,
            Permissions.Invoices.Delete,
            Permissions.Invoices.Sign,
            Permissions.Invoices.Send,
            Permissions.Quotes.Create,
            Permissions.Quotes.Read,
            Permissions.Quotes.Update,
            Permissions.Quotes.Delete,
            Permissions.DeliveryNotes.Create,
            Permissions.DeliveryNotes.Read,
            Permissions.DeliveryNotes.Update,
            Permissions.DeliveryNotes.Delete,
            Permissions.SalesReturnNotes.Create,
            Permissions.SalesReturnNotes.Read,
            Permissions.SalesReturnNotes.Update,
            Permissions.SalesReturnNotes.Delete,
            Permissions.SalesOrders.Create,
            Permissions.SalesOrders.Read,
            Permissions.SalesOrders.Update,
            Permissions.SalesOrders.Delete,
            Permissions.Clients.Create,
            Permissions.Clients.Read,
            Permissions.Clients.Update,
            Permissions.Clients.Delete,
            Permissions.Products.Create,
            Permissions.Products.Read,
            Permissions.Products.Update,
            Permissions.Products.Delete,
            Permissions.Pricing.Create,
            Permissions.Pricing.Read,
            Permissions.Pricing.Update,
            Permissions.Pricing.Delete,
            Permissions.Payments.Create,
            Permissions.Payments.Read,
            Permissions.Payments.Update,
            Permissions.Users.Create,
            Permissions.Users.Read,
            Permissions.Users.Update,
            Permissions.Users.Delete,
            Permissions.Settings.Read,
            Permissions.Settings.Update,
            Permissions.Reports.View,
            Permissions.Reports.Export,
            Permissions.Accounting.Read,
            Permissions.Accounting.Create,
            Permissions.Accounting.Close,
            Permissions.Accounting.CurrenciesManage,
            Permissions.Accounting.ExchangeRateOverride,
            Permissions.Accounting.Unletter,
            Permissions.Accounting.Reverse,
            Permissions.Accounting.Import,
            Permissions.Accounting.Declare,
            Permissions.Audit.Read,
            Permissions.Suppliers.Create,
            Permissions.Suppliers.Read,
            Permissions.Suppliers.Update,
            Permissions.Suppliers.Delete,
            Permissions.PurchaseOrders.Create,
            Permissions.PurchaseOrders.Read,
            Permissions.PurchaseOrders.Update,
            Permissions.PurchaseOrders.Delete,
            Permissions.PurchaseReceipts.Create,
            Permissions.PurchaseReceipts.Read,
            Permissions.PurchaseReceipts.Update,
            Permissions.PurchaseReceipts.Delete,
            Permissions.SupplierInvoices.Create,
            Permissions.SupplierInvoices.Read,
            Permissions.SupplierInvoices.Update,
            Permissions.SupplierInvoices.Delete,
            Permissions.Stock.Read,
            Permissions.Stock.Create,
            Permissions.Stock.Update,
            Permissions.Stock.Delete,
            Permissions.StockTransfers.Create,
            Permissions.StockTransfers.Read,
            Permissions.StockTransfers.Update,
            Permissions.StockTransfers.Delete,
            Permissions.StockVouchers.Create,
            Permissions.StockVouchers.Read,
            Permissions.StockVouchers.Update,
            Permissions.StockVouchers.Delete,
            Permissions.Inventory.Create,
            Permissions.Inventory.Read,
            Permissions.Inventory.Update,
            Permissions.Inventory.Delete,
            Permissions.CRM.Read, Permissions.CRM.Create, Permissions.CRM.Update, Permissions.CRM.Delete,
            Permissions.SalesTargets.Read, Permissions.SalesTargets.Manage,
            Permissions.Reports.SalesOwn,
            Permissions.WithholdingTax.Read, Permissions.WithholdingTax.Create, Permissions.WithholdingTax.Edit,
            Permissions.WithholdingTax.Validate, Permissions.WithholdingTax.Delete, Permissions.WithholdingTax.Export,
            Permissions.AI.Chat,
            Permissions.Storefront.Manage,
            Permissions.Forecasting.View,
            Permissions.Forecasting.Manage,
            Permissions.TreasuryForecast.View,
            Permissions.TreasuryForecast.Manage,
            Permissions.Studio.DesignEntities, Permissions.Studio.DesignForms, Permissions.Studio.DesignReports,
            Permissions.CustomData.RecordsRead, Permissions.CustomData.RecordsWrite, Permissions.CustomData.ReportsView,
            Permissions.Payroll.Read, Permissions.Payroll.ManageEmployees, Permissions.Payroll.RunPayroll,
            Permissions.Payroll.Validate, Permissions.Payroll.Declare, Permissions.Payroll.Export, Permissions.Payroll.Pay, Permissions.Payroll.Settings,
            Permissions.Payroll.ManageGarnishments, Permissions.Payroll.HrDocuments, Permissions.Payroll.ManageTermination,
            Permissions.Projects.Read, Permissions.Projects.Create, Permissions.Projects.Update, Permissions.Projects.Delete, Permissions.Projects.ManageTeam,
            Permissions.ProjectTasks.Create, Permissions.ProjectTasks.Read, Permissions.ProjectTasks.Update, Permissions.ProjectTasks.Delete,
            Permissions.ProjectTime.Create, Permissions.ProjectTime.Read, Permissions.ProjectTime.Submit, Permissions.ProjectTime.Validate,
            Permissions.ProjectBilling.Read, Permissions.ProjectBilling.Create,
            Permissions.RecurringContracts.Read, Permissions.RecurringContracts.Create,
            Permissions.RecurringContracts.Update, Permissions.RecurringContracts.Delete,
            Permissions.RecurringContracts.Manage, Permissions.RecurringContracts.RecordUsage,
            Permissions.RecurringContracts.TriggerBilling
        },
        UserRole.Accountant => new[]
        {
            Permissions.Invoices.Create,
            Permissions.Invoices.Read,
            Permissions.Invoices.Update,
            Permissions.Invoices.Sign,
            Permissions.Invoices.Send,
            Permissions.Quotes.Create,
            Permissions.Quotes.Read,
            Permissions.Quotes.Update,
            Permissions.DeliveryNotes.Create,
            Permissions.DeliveryNotes.Read,
            Permissions.DeliveryNotes.Update,
            Permissions.SalesReturnNotes.Create,
            Permissions.SalesReturnNotes.Read,
            Permissions.SalesReturnNotes.Update,
            Permissions.SalesOrders.Create,
            Permissions.SalesOrders.Read,
            Permissions.SalesOrders.Update,
            Permissions.Clients.Create,
            Permissions.Clients.Read,
            Permissions.Clients.Update,
            Permissions.Products.Create,
            Permissions.Products.Read,
            Permissions.Products.Update,
            // Le comptable facture : il doit voir le prix qui s'appliquera, sans le fixer.
            Permissions.Pricing.Read,
            Permissions.Payments.Create,
            Permissions.Payments.Read,
            Permissions.Reports.View,
            Permissions.Reports.Export,
            Permissions.Accounting.Read,
            Permissions.Accounting.Create,
            Permissions.Accounting.Reverse,
            Permissions.Accounting.Import,
            Permissions.Accounting.Declare,
            Permissions.Audit.Read,
            Permissions.Suppliers.Create,
            Permissions.Suppliers.Read,
            Permissions.Suppliers.Update,
            Permissions.PurchaseOrders.Create,
            Permissions.PurchaseOrders.Read,
            Permissions.PurchaseOrders.Update,
            Permissions.PurchaseReceipts.Create,
            Permissions.PurchaseReceipts.Read,
            Permissions.PurchaseReceipts.Update,
            Permissions.SupplierInvoices.Create,
            Permissions.SupplierInvoices.Read,
            Permissions.SupplierInvoices.Update,
            Permissions.Stock.Read,
            Permissions.Stock.Create,
            Permissions.Stock.Update,
            Permissions.StockVouchers.Create,
            Permissions.StockVouchers.Read,
            Permissions.StockVouchers.Update,
            Permissions.StockTransfers.Create,
            Permissions.StockTransfers.Read,
            Permissions.StockTransfers.Update,
            Permissions.Inventory.Create,
            Permissions.Inventory.Read,
            Permissions.Inventory.Update,
            Permissions.WithholdingTax.Read, Permissions.WithholdingTax.Create, Permissions.WithholdingTax.Edit,
            Permissions.WithholdingTax.Validate, Permissions.WithholdingTax.Delete, Permissions.WithholdingTax.Export,
            Permissions.CustomData.RecordsRead, Permissions.CustomData.RecordsWrite, Permissions.CustomData.ReportsView,
            // Le prévisionnel de trésorerie est un outil de comptable : il n'est PAS couvert par
            // Permissions.Forecasting.* (ventes / stock), que ce rôle ne possède pas.
            Permissions.TreasuryForecast.View,
            Permissions.TreasuryForecast.Manage,
            Permissions.Payroll.Read, Permissions.Payroll.ManageEmployees, Permissions.Payroll.RunPayroll,
            Permissions.Payroll.Validate, Permissions.Payroll.Declare, Permissions.Payroll.Export, Permissions.Payroll.Pay, Permissions.Payroll.Settings,
            Permissions.Payroll.ManageGarnishments, Permissions.Payroll.HrDocuments, Permissions.Payroll.ManageTermination,
            Permissions.Projects.Read, Permissions.Projects.Create, Permissions.Projects.Update, Permissions.Projects.Delete, Permissions.Projects.ManageTeam,
            Permissions.ProjectTasks.Create, Permissions.ProjectTasks.Read, Permissions.ProjectTasks.Update, Permissions.ProjectTasks.Delete,
            Permissions.ProjectTime.Create, Permissions.ProjectTime.Read, Permissions.ProjectTime.Submit, Permissions.ProjectTime.Validate,
            Permissions.ProjectBilling.Read, Permissions.ProjectBilling.Create,
            Permissions.RecurringContracts.Read, Permissions.RecurringContracts.TriggerBilling
        },
        UserRole.Client => new[]
        {
            Permissions.Portal.Access,
            Permissions.Portal.InvoicesRead,
            Permissions.Portal.PaymentsRead,
            Permissions.Portal.ProfileRead
        },
        UserRole.SalesRep => new[]
        {
            Permissions.Clients.Create, Permissions.Clients.Read, Permissions.Clients.Update,
            Permissions.Products.Read,
            Permissions.Quotes.Create, Permissions.Quotes.Read, Permissions.Quotes.Update,
            Permissions.DeliveryNotes.Create, Permissions.DeliveryNotes.Read, Permissions.DeliveryNotes.Update, Permissions.DeliveryNotes.Delete,
            Permissions.SalesReturnNotes.Create, Permissions.SalesReturnNotes.Read, Permissions.SalesReturnNotes.Update, Permissions.SalesReturnNotes.Delete,
            Permissions.SalesOrders.Create, Permissions.SalesOrders.Read, Permissions.SalesOrders.Update,
            Permissions.Invoices.Create, Permissions.Invoices.Read, Permissions.Invoices.Update, Permissions.Invoices.Send,
            Permissions.Payments.Read,
            Permissions.CRM.Read, Permissions.CRM.Create, Permissions.CRM.Update,
            Permissions.SalesTargets.Read,
            Permissions.Reports.SalesOwn,
            Permissions.Forecasting.View,
            // Le commercial doit VOIR le prix négocié qui s'appliquera, sans pouvoir le fixer.
            Permissions.Pricing.Read,
            Permissions.Projects.Read, Permissions.Projects.Create, Permissions.Projects.Update,
            Permissions.ProjectTasks.Create, Permissions.ProjectTasks.Read, Permissions.ProjectTasks.Update,
            Permissions.ProjectTime.Create, Permissions.ProjectTime.Read, Permissions.ProjectTime.Submit,
            Permissions.ProjectBilling.Read, Permissions.ProjectBilling.Create,
            Permissions.RecurringContracts.Read, Permissions.RecurringContracts.Create,
            Permissions.RecurringContracts.Update, Permissions.RecurringContracts.RecordUsage
        },
        UserRole.SalesManager => new[]
        {
            Permissions.Clients.Create, Permissions.Clients.Read, Permissions.Clients.Update, Permissions.Clients.Delete,
            Permissions.Products.Read,
            Permissions.Quotes.Create, Permissions.Quotes.Read, Permissions.Quotes.Update, Permissions.Quotes.Delete,
            Permissions.DeliveryNotes.Create, Permissions.DeliveryNotes.Read, Permissions.DeliveryNotes.Update, Permissions.DeliveryNotes.Delete,
            Permissions.SalesReturnNotes.Create, Permissions.SalesReturnNotes.Read, Permissions.SalesReturnNotes.Update, Permissions.SalesReturnNotes.Delete,
            Permissions.SalesOrders.Create, Permissions.SalesOrders.Read, Permissions.SalesOrders.Update, Permissions.SalesOrders.Delete,
            Permissions.Invoices.Create, Permissions.Invoices.Read, Permissions.Invoices.Update, Permissions.Invoices.Delete, Permissions.Invoices.Sign, Permissions.Invoices.Send,
            Permissions.Payments.Read,
            Permissions.Reports.View, Permissions.Reports.Export, Permissions.Reports.SalesOwn,
            Permissions.CRM.Read, Permissions.CRM.Create, Permissions.CRM.Update, Permissions.CRM.Delete,
            Permissions.SalesTargets.Read, Permissions.SalesTargets.Manage,
            Permissions.Forecasting.View,
            Permissions.Forecasting.Manage,
            // Fixer les grilles et les prix négociés relève de la direction commerciale.
            Permissions.Pricing.Create, Permissions.Pricing.Read,
            Permissions.Pricing.Update, Permissions.Pricing.Delete,
            Permissions.Projects.Read, Permissions.Projects.Create, Permissions.Projects.Update, Permissions.Projects.Delete, Permissions.Projects.ManageTeam,
            Permissions.ProjectTasks.Create, Permissions.ProjectTasks.Read, Permissions.ProjectTasks.Update, Permissions.ProjectTasks.Delete,
            Permissions.ProjectTime.Create, Permissions.ProjectTime.Read, Permissions.ProjectTime.Submit, Permissions.ProjectTime.Validate,
            Permissions.ProjectBilling.Read, Permissions.ProjectBilling.Create,
            Permissions.RecurringContracts.Read, Permissions.RecurringContracts.Create,
            Permissions.RecurringContracts.Update, Permissions.RecurringContracts.Delete,
            Permissions.RecurringContracts.Manage, Permissions.RecurringContracts.RecordUsage,
            Permissions.RecurringContracts.TriggerBilling
        },
        UserRole.Warehouse => new[]
        {
            Permissions.Products.Read,
            Permissions.Stock.Read, Permissions.Stock.Create, Permissions.Stock.Update, Permissions.Stock.Delete,
            Permissions.StockTransfers.Create, Permissions.StockTransfers.Read, Permissions.StockTransfers.Update, Permissions.StockTransfers.Delete,
            Permissions.StockVouchers.Create, Permissions.StockVouchers.Read, Permissions.StockVouchers.Update, Permissions.StockVouchers.Delete,
            Permissions.Inventory.Create, Permissions.Inventory.Read, Permissions.Inventory.Update, Permissions.Inventory.Delete,
            Permissions.Forecasting.View,
            Permissions.Projects.Read
        },
        UserRole.Purchaser => new[]
        {
            Permissions.Products.Read,
            Permissions.Suppliers.Create, Permissions.Suppliers.Read, Permissions.Suppliers.Update, Permissions.Suppliers.Delete,
            Permissions.PurchaseOrders.Create, Permissions.PurchaseOrders.Read, Permissions.PurchaseOrders.Update, Permissions.PurchaseOrders.Delete,
            Permissions.PurchaseReceipts.Create, Permissions.PurchaseReceipts.Read, Permissions.PurchaseReceipts.Update, Permissions.PurchaseReceipts.Delete,
            Permissions.SupplierInvoices.Create, Permissions.SupplierInvoices.Read, Permissions.SupplierInvoices.Update, Permissions.SupplierInvoices.Delete,
            Permissions.Stock.Read,
            Permissions.StockVouchers.Read,
            Permissions.Forecasting.View,
            Permissions.Forecasting.Manage,
            Permissions.Projects.Read, Permissions.ProjectBilling.Read
        },
        UserRole.Cashier => new[]
        {
            Permissions.Clients.Read,
            Permissions.Products.Read,
            Permissions.Invoices.Create, Permissions.Invoices.Read,
            Permissions.Payments.Create,
            Permissions.Payments.Read,
            Permissions.Stock.Read,
            // La caisse interroge le résolveur de prix à chaque rattachement client : sans cette
            // lecture, elle facturerait le catalogue là où une grille s'applique.
            Permissions.Pricing.Read
        },
        UserRole.Auditor => new[]
        {
            Permissions.Clients.Read,
            Permissions.Products.Read,
            Permissions.Invoices.Read,
            Permissions.SalesOrders.Read,
            Permissions.DeliveryNotes.Read,
            Permissions.SalesReturnNotes.Read,
            Permissions.Payments.Read,
            Permissions.Reports.View, Permissions.Reports.Export,
            Permissions.Accounting.Read,
            Permissions.Audit.Read,
            Permissions.Suppliers.Read,
            Permissions.PurchaseOrders.Read,
            Permissions.PurchaseReceipts.Read,
            Permissions.SupplierInvoices.Read,
            Permissions.Stock.Read,
            Permissions.StockVouchers.Read,
            Permissions.WithholdingTax.Read,
            Permissions.Forecasting.View,
            // Lecture seule : l'auditeur consulte la projection, il ne la recalcule pas.
            Permissions.TreasuryForecast.View,
            Permissions.CustomData.RecordsRead, Permissions.CustomData.ReportsView,
            Permissions.Projects.Read, Permissions.ProjectTasks.Read, Permissions.ProjectTime.Read, Permissions.ProjectBilling.Read
        },
        UserRole.Supervisor => new[]
        {
            Permissions.Invoices.Create, Permissions.Invoices.Read, Permissions.Invoices.Update, Permissions.Invoices.Delete, Permissions.Invoices.Sign, Permissions.Invoices.Send,
            Permissions.Quotes.Create, Permissions.Quotes.Read, Permissions.Quotes.Update, Permissions.Quotes.Delete,
            Permissions.DeliveryNotes.Create, Permissions.DeliveryNotes.Read, Permissions.DeliveryNotes.Update, Permissions.DeliveryNotes.Delete,
            Permissions.SalesReturnNotes.Create, Permissions.SalesReturnNotes.Read, Permissions.SalesReturnNotes.Update, Permissions.SalesReturnNotes.Delete,
            Permissions.SalesOrders.Create, Permissions.SalesOrders.Read, Permissions.SalesOrders.Update, Permissions.SalesOrders.Delete,
            Permissions.Clients.Create, Permissions.Clients.Read, Permissions.Clients.Update, Permissions.Clients.Delete,
            Permissions.Products.Create, Permissions.Products.Read, Permissions.Products.Update, Permissions.Products.Delete,
            Permissions.Pricing.Create, Permissions.Pricing.Read, Permissions.Pricing.Update, Permissions.Pricing.Delete,
            Permissions.Payments.Create, Permissions.Payments.Read, Permissions.Payments.Update,
            Permissions.Settings.Read,
            Permissions.Settings.Update,
            Permissions.Reports.View, Permissions.Reports.Export,
            Permissions.Accounting.Read,
            Permissions.Accounting.Create,
            Permissions.Accounting.Close,
            Permissions.Accounting.CurrenciesManage,
            Permissions.Accounting.ExchangeRateOverride,
            Permissions.Accounting.Unletter,
            Permissions.Accounting.Reverse,
            Permissions.Accounting.Import,
            Permissions.Accounting.Declare,
            Permissions.Audit.Read,
            Permissions.Suppliers.Create, Permissions.Suppliers.Read, Permissions.Suppliers.Update, Permissions.Suppliers.Delete,
            Permissions.PurchaseOrders.Create, Permissions.PurchaseOrders.Read, Permissions.PurchaseOrders.Update, Permissions.PurchaseOrders.Delete,
            Permissions.PurchaseReceipts.Create, Permissions.PurchaseReceipts.Read, Permissions.PurchaseReceipts.Update, Permissions.PurchaseReceipts.Delete,
            Permissions.SupplierInvoices.Create, Permissions.SupplierInvoices.Read, Permissions.SupplierInvoices.Update, Permissions.SupplierInvoices.Delete,
            Permissions.Stock.Read, Permissions.Stock.Create, Permissions.Stock.Update, Permissions.Stock.Delete,
            Permissions.StockTransfers.Create, Permissions.StockTransfers.Read, Permissions.StockTransfers.Update, Permissions.StockTransfers.Delete,
            Permissions.StockVouchers.Create, Permissions.StockVouchers.Read, Permissions.StockVouchers.Update, Permissions.StockVouchers.Delete,
            Permissions.Inventory.Create, Permissions.Inventory.Read, Permissions.Inventory.Update, Permissions.Inventory.Delete,
            Permissions.CRM.Read, Permissions.CRM.Create, Permissions.CRM.Update, Permissions.CRM.Delete,
            Permissions.SalesTargets.Read, Permissions.SalesTargets.Manage,
            Permissions.Reports.SalesOwn,
            Permissions.WithholdingTax.Read, Permissions.WithholdingTax.Create, Permissions.WithholdingTax.Edit,
            Permissions.WithholdingTax.Validate, Permissions.WithholdingTax.Delete, Permissions.WithholdingTax.Export,
            Permissions.AI.Chat,
            Permissions.Storefront.Manage,
            Permissions.Forecasting.View,
            Permissions.Forecasting.Manage,
            Permissions.TreasuryForecast.View,
            Permissions.TreasuryForecast.Manage,
            Permissions.Studio.DesignEntities, Permissions.Studio.DesignForms, Permissions.Studio.DesignReports,
            Permissions.CustomData.RecordsRead, Permissions.CustomData.RecordsWrite, Permissions.CustomData.ReportsView,
            Permissions.Payroll.Read, Permissions.Payroll.ManageEmployees, Permissions.Payroll.RunPayroll,
            Permissions.Payroll.Validate, Permissions.Payroll.Declare, Permissions.Payroll.Export, Permissions.Payroll.Pay, Permissions.Payroll.Settings,
            Permissions.Payroll.ManageGarnishments, Permissions.Payroll.HrDocuments, Permissions.Payroll.ManageTermination,
            Permissions.Projects.Read, Permissions.Projects.Create, Permissions.Projects.Update, Permissions.Projects.Delete, Permissions.Projects.ManageTeam,
            Permissions.ProjectTasks.Create, Permissions.ProjectTasks.Read, Permissions.ProjectTasks.Update, Permissions.ProjectTasks.Delete,
            Permissions.ProjectTime.Create, Permissions.ProjectTime.Read, Permissions.ProjectTime.Submit, Permissions.ProjectTime.Validate,
            Permissions.ProjectBilling.Read, Permissions.ProjectBilling.Create
        },
        UserRole.Developer => new[]
        {
            // Design-time: build custom tables, forms, and reports.
            Permissions.Studio.DesignEntities, Permissions.Studio.DesignForms, Permissions.Studio.DesignReports,
            // Runtime: full use of the custom data they design.
            Permissions.CustomData.RecordsRead, Permissions.CustomData.RecordsWrite, Permissions.CustomData.ReportsView,
            // Read-only access to whitelisted existing sources, needed to build reports/views over them.
            Permissions.Reports.View,
            Permissions.Clients.Read,
            Permissions.Products.Read,
            Permissions.Invoices.Read,
            Permissions.Projects.Read
        },
        UserRole.FirmManager => DelegatedPermissionCatalog.FirmManagerDelegated
            .Concat(DelegatedPermissionCatalog.FirmNativePermissions)
            .Distinct()
            .ToArray(),
        UserRole.FirmAccountant => DelegatedPermissionCatalog.FirmAccountantDelegated
            .Distinct()
            .ToArray(),
        _ => Array.Empty<string>()
    };
}

/// <summary>
/// Permission constants for authorization.
/// </summary>
public static class Permissions
{
    public static class Invoices
    {
        public const string Create = "invoices:create";
        public const string Read = "invoices:read";
        public const string Update = "invoices:update";
        public const string Delete = "invoices:delete";
        public const string Sign = "invoices:sign";
        public const string Send = "invoices:send";
    }

    public static class Clients
    {
        public const string Create = "clients:create";
        public const string Read = "clients:read";
        public const string Update = "clients:update";
        public const string Delete = "clients:delete";
    }

    public static class Products
    {
        public const string Create = "products:create";
        public const string Read = "products:read";
        public const string Update = "products:update";
        public const string Delete = "products:delete";
    }

    public static class Payments
    {
        public const string Create = "payments:create";
        public const string Read = "payments:read";
        public const string Update = "payments:update";
    }

    public static class Users
    {
        public const string Create = "users:create";
        public const string Read = "users:read";
        public const string Update = "users:update";
        public const string Delete = "users:delete";
    }

    public static class Settings
    {
        public const string Read = "settings:read";
        public const string Update = "settings:update";
    }

    public static class Reports
    {
        public const string View = "reports:view";
        public const string Export = "reports:export";
        public const string SalesOwn = "reports:sales_own";
    }

    public static class Quotes
    {
        public const string Create = "quotes:create";
        public const string Read = "quotes:read";
        public const string Update = "quotes:update";
        public const string Delete = "quotes:delete";
    }

    public static class DeliveryNotes
    {
        public const string Create = "delivery_notes:create";
        public const string Read = "delivery_notes:read";
        public const string Update = "delivery_notes:update";
        public const string Delete = "delivery_notes:delete";
    }

    /// <summary>
    /// Bons de retour client (articles livrés non facturés). Distincts des avoirs.
    /// </summary>
    public static class SalesReturnNotes
    {
        public const string Create = "return_notes:create";
        public const string Read = "return_notes:read";
        public const string Update = "return_notes:update";
        public const string Delete = "return_notes:delete";
    }

    public static class Suppliers
    {
        public const string Create = "suppliers:create";
        public const string Read = "suppliers:read";
        public const string Update = "suppliers:update";
        public const string Delete = "suppliers:delete";
    }

    public static class PurchaseOrders
    {
        public const string Create = "purchase_orders:create";
        public const string Read = "purchase_orders:read";
        public const string Update = "purchase_orders:update";
        public const string Delete = "purchase_orders:delete";
    }

    /// <summary>
    /// Bons de réception d'achat (réceptions fournisseur).
    /// </summary>
    public static class PurchaseReceipts
    {
        public const string Create = "purchase_receipts:create";
        public const string Read = "purchase_receipts:read";
        public const string Update = "purchase_receipts:update";
        public const string Delete = "purchase_receipts:delete";
    }

    /// <summary>
    /// Commandes clients (bons de commande client). Distinctes de <see cref="PurchaseOrders"/>,
    /// qui couvre l'achat fournisseur : un commercial peut avoir l'une sans l'autre.
    /// </summary>
    public static class SalesOrders
    {
        public const string Create = "sales_orders:create";
        public const string Read = "sales_orders:read";
        public const string Update = "sales_orders:update";
        public const string Delete = "sales_orders:delete";
    }

    /// <summary>
    /// Grilles tarifaires et prix négociés. Séparé des devis et factures : décider du prix de
    /// vente est une responsabilité de direction commerciale, pas de saisie documentaire.
    /// </summary>
    public static class Pricing
    {
        public const string Create = "pricing:create";
        public const string Read = "pricing:read";
        public const string Update = "pricing:update";
        public const string Delete = "pricing:delete";
    }

    public static class SupplierInvoices
    {
        public const string Create = "supplier_invoices:create";
        public const string Read = "supplier_invoices:read";
        public const string Update = "supplier_invoices:update";
        public const string Delete = "supplier_invoices:delete";
    }

    public static class Stock
    {
        public const string Create = "stock:create";
        public const string Read = "stock:read";
        public const string Update = "stock:update";
        public const string Delete = "stock:delete";
    }

    public static class StockTransfers
    {
        public const string Create = "stock_transfers:create";
        public const string Read = "stock_transfers:read";
        public const string Update = "stock_transfers:update";
        public const string Delete = "stock_transfers:delete";
    }

    public static class StockVouchers
    {
        public const string Create = "stock_vouchers:create";
        public const string Read = "stock_vouchers:read";
        public const string Update = "stock_vouchers:update";
        public const string Delete = "stock_vouchers:delete";
    }

    public static class Inventory
    {
        public const string Create = "inventory:create";
        public const string Read = "inventory:read";
        public const string Update = "inventory:update";
        public const string Delete = "inventory:delete";
    }

    public static class Accounting
    {
        public const string Read = "accounting:read";
        public const string Create = "accounting:create";
        public const string Close = "accounting:close";

        /// <summary>Valider les écritures en brouillard (workflow de révision cabinet).</summary>
        public const string Validate = "accounting:validate";

        /// <summary>Supprimer une écriture comptable en brouillon et ses pièces justificatives. Réservé au cabinet en mode délégué.</summary>
        public const string Delete = "accounting:delete";

        /// <summary>Contre-passer (extourner) une écriture validée.</summary>
        public const string Reverse = "accounting:reverse";

        /// <summary>Importer une reprise de dossier (écritures + balance d'ouverture).</summary>
        public const string Import = "accounting:import";

        /// <summary>Établir/soumettre les déclarations fiscales (TVA, déclaration mensuelle).</summary>
        public const string Declare = "accounting:declare";

        /// <summary>Configurer le catalogue des devises et leurs taux de change.</summary>
        public const string CurrenciesManage = "accounting:currencies_manage";

        /// <summary>
        /// Saisir un taux de change différent de celui de la table, dans la limite de la tolérance
        /// configurée. Le taux détermine le montant en dinar porté en comptabilité : sans cette
        /// permission le champ est en lecture seule, et toute dérogation est tracée à l'audit.
        /// </summary>
        public const string ExchangeRateOverride = "accounting:exchange_rate_override";

        /// <summary>
        /// Défaire un lettrage (manuel). Séparation des tâches (D6) : un comptable société peut
        /// lettrer (<see cref="Create"/>) mais ne peut pas défaire ; seuls les rôles de supervision
        /// et le cabinet comptable délégué le peuvent.
        /// </summary>
        public const string Unletter = "accounting:unletter";
    }

    public static class Audit
    {
        public const string Read = "audit:read";
    }

    public static class CRM
    {
        public const string Read = "crm:read";
        public const string Create = "crm:create";
        public const string Update = "crm:update";
        public const string Delete = "crm:delete";
    }

    public static class SalesTargets
    {
        public const string Read = "sales_targets:read";
        public const string Manage = "sales_targets:manage";
    }

    public static class WithholdingTax
    {
        public const string Read = "withholding_tax:read";
        public const string Create = "withholding_tax:create";
        public const string Edit = "withholding_tax:edit";
        public const string Validate = "withholding_tax:validate";
        public const string Delete = "withholding_tax:delete";
        public const string Export = "withholding_tax:export";
    }

    public static class AI
    {
        public const string Chat = "ai:chat";
    }

    /// <summary>
    /// Permissions for the AI Forecasting module (sales/revenue forecasting, replenishment,
    /// promotion recommendations, ABC/XYZ classification, Tunisian commercial calendar).
    /// </summary>
    public static class Forecasting
    {
        /// <summary>Read forecasts, recommendations, classifications, and the commercial calendar.</summary>
        public const string View = "forecasting:view";

        /// <summary>Approve/dismiss recommendations, prepare draft purchase orders or discounts, trigger manual recompute.</summary>
        public const string Manage = "forecasting:manage";
    }

    /// <summary>
    /// Permissions du module « Trésorerie prévisionnelle par IA » (projection du solde de
    /// trésorerie, scénarios probabilisés, alertes de tension, engagements récurrents).
    /// Distinctes de <see cref="Forecasting"/> : le prévisionnel de trésorerie s'adresse au
    /// comptable et à la direction financière, qui ne disposent pas des droits du module
    /// Prévisions IA (ventes / stock).
    /// </summary>
    public static class TreasuryForecast
    {
        /// <summary>Consulter la projection, les scénarios, les alertes et les flux attendus.</summary>
        public const string View = "treasury_forecast:view";

        /// <summary>
        /// Déclencher un recalcul, gérer les engagements récurrents et les seuils de la jauge.
        /// </summary>
        public const string Manage = "treasury_forecast:manage";
    }

    /// <summary>
    /// Permissions governing the public 3D virtual street storefront module.
    /// Only granted to roles allowed to commit the company to a public publication
    /// (Administrator, Supervisor) to ensure legal/brand accountability.
    /// </summary>
    public static class Storefront
    {
        public const string Manage = "storefront:manage";
    }

    /// <summary>
    /// Design-time permissions for the low-code "Studio": creating/editing custom tables (entities),
    /// forms, and reports. Granted to Developer (and Administrator/Supervisor for oversight).
    /// </summary>
    public static class Studio
    {
        public const string DesignEntities = "studio:design_entities";
        public const string DesignForms = "studio:design_forms";
        public const string DesignReports = "studio:design_reports";
    }

    /// <summary>
    /// Runtime permissions for end users to consume what the Studio produces:
    /// reading/writing custom records and viewing custom reports.
    /// </summary>
    public static class CustomData
    {
        public const string RecordsRead = "custom_records:read";
        public const string RecordsWrite = "custom_records:write";
        public const string ReportsView = "custom_reports:view";
    }

    public static class Firm
    {
        public const string Manage = "firm:manage";
        public const string UsersManage = "firm:users:manage";
        public const string AssignmentsManage = "firm:assignments:manage";

        /// <summary>
        /// Consulter l'agent « Chef de mission » (assistant IA du cabinet en mode natif).
        /// Distincte de <see cref="AI.Chat"/> : l'assistant cabinet a son propre catalogue d'outils
        /// (portefeuille de dossiers) et sa propre surface HTTP, il n'ouvre pas l'assistant tenant.
        /// </summary>
        public const string AiChat = "firm:ai:chat";

        /// <summary>
        /// Déclencher une relance d'échéance fiscale depuis l'agent « Chef de mission ».
        /// Réservée au responsable de cabinet : un collaborateur consulte mais n'envoie pas.
        /// </summary>
        public const string AiRemind = "firm:ai:remind";

        /// <summary>
        /// Consulter la révision de portefeuille : anomalies consolidées des dossiers, file de
        /// travail, dossier de révision. Accordée au responsable comme au collaborateur —
        /// l'ACL dossier restreint ensuite chacun à son périmètre réel.
        /// </summary>
        public const string RevisionView = "firm:revision:view";

        /// <summary>
        /// Lancer un balayage de portefeuille et publier un dossier de révision. Réservée au
        /// responsable de cabinet : un balayage mobilise toutes les bases dossiers.
        /// </summary>
        public const string RevisionManage = "firm:revision:manage";
    }

    public static class HonorairesInvoices
    {
        public const string Create = "honoraires.invoices:create";
        public const string Read = "honoraires.invoices:read";
        public const string Update = "honoraires.invoices:update";
        public const string Delete = "honoraires.invoices:delete";
        public const string Validate = "honoraires.invoices:validate";
        public const string Send = "honoraires.invoices:send";
    }

    public static class HonorairesQuotes
    {
        public const string Create = "honoraires.quotes:create";
        public const string Read = "honoraires.quotes:read";
        public const string Update = "honoraires.quotes:update";
        public const string Delete = "honoraires.quotes:delete";
        public const string Convert = "honoraires.quotes:convert";
    }

    public static class HonorairesPayments
    {
        public const string Create = "honoraires.payments:create";
        public const string Read = "honoraires.payments:read";
    }

    /// <summary>
    /// Permissions du module RH & Paie (dossiers salariés, cycles de paie, bulletins,
    /// déclarations sociales, paramétrage de l'exercice).
    /// </summary>
    public static class Payroll
    {
        /// <summary>Consulter salariés, cycles de paie, bulletins et déclarations.</summary>
        public const string Read = "payroll:read";
        /// <summary>Créer et modifier les dossiers salariés et leurs contrats.</summary>
        public const string ManageEmployees = "payroll:manage_employees";
        /// <summary>Créer et calculer les cycles de paie (bulletins).</summary>
        public const string RunPayroll = "payroll:run";
        /// <summary>Valider et clôturer un cycle de paie.</summary>
        public const string Validate = "payroll:validate";
        /// <summary>Établir les déclarations sociales (DTS CNSS).</summary>
        public const string Declare = "payroll:declare";
        /// <summary>Exporter bulletins et déclarations.</summary>
        public const string Export = "payroll:export";
        /// <summary>Enregistrer les paiements de salaires (lien trésorerie).</summary>
        public const string Pay = "payroll:pay";
        /// <summary>Gérer les paramètres de paie (barème, taux, comptes comptables).</summary>
        public const string Settings = "payroll:settings";
        /// <summary>Gérer les saisies sur salaire et pensions alimentaires.</summary>
        public const string ManageGarnishments = "payroll:manage_garnishments";
        /// <summary>Générer les documents RH (STC, certificat de travail, attestation de salaire).</summary>
        public const string HrDocuments = "payroll:hr_documents";
        /// <summary>Traiter les ruptures de contrat et indemnités de départ.</summary>
        public const string ManageTermination = "payroll:manage_termination";
    }

    public static class Projects
    {
        public const string Read = "projects:read";
        public const string Create = "projects:create";
        public const string Update = "projects:update";
        public const string Delete = "projects:delete";
        public const string ManageTeam = "projects:manage_team";
    }

    public static class ProjectTasks
    {
        public const string Create = "project_tasks:create";
        public const string Read = "project_tasks:read";
        public const string Update = "project_tasks:update";
        public const string Delete = "project_tasks:delete";
    }

    public static class ProjectTime
    {
        public const string Create = "project_time:create";
        public const string Read = "project_time:read";
        public const string Submit = "project_time:submit";
        public const string Validate = "project_time:validate";
    }

    public static class ProjectBilling
    {
        public const string Read = "project_billing:read";
        public const string Create = "project_billing:create";
    }

    public static class Portal
    {
        public const string Access = "portal:access";
        public const string InvoicesRead = "portal:invoices:read";
        public const string PaymentsRead = "portal:payments:read";
        public const string ProfileRead = "portal:profile:read";
    }

    public static class RecurringContracts
    {
        public const string Read = "recurring_contracts:read";
        public const string Create = "recurring_contracts:create";
        public const string Update = "recurring_contracts:update";
        public const string Delete = "recurring_contracts:delete";
        public const string Manage = "recurring_contracts:manage";
        public const string RecordUsage = "recurring_contracts:usage";
        public const string TriggerBilling = "recurring_contracts:billing";
    }
}
