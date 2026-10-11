using FactuTrust.Domain.Authorization;

namespace FactuTrust.Domain.Enums;

/// <summary>
/// Functional modules for per-user access control. Maps to subsets of <see cref="Permissions"/>.
/// </summary>
public enum AppModule
{
    Clients = 0,
    Products = 1,
    Sales = 2,
    Treasury = 3,
    Reports = 4,
    Administration = 5,
    Purchases = 6,
    Stock = 7,
    Accounting = 8,
    CRM = 9,
    Fiscal = 10,
    AI = 11,
    Forecasting = 12,
    Studio = 13,
    Payroll = 14,
    /// <summary>Facturation honoraires du cabinet (firm-native).</summary>
    Honoraires = 15,
    /// <summary>Module Projets / PSA (ESN, services, BTP) — données en base tenant.</summary>
    Projects = 16,
    /// <summary>Contrats récurrents / abonnements B2B.</summary>
    RecurringContracts = 17
}

public static class AppModuleExtensions
{
    public static string ToDisplayString(this AppModule module) => module switch
    {
        AppModule.Clients => "Clients",
        AppModule.Products => "Produits et services",
        AppModule.Sales => "Ventes (factures)",
        AppModule.Treasury => "Trésorerie (paiements)",
        AppModule.Reports => "Rapports",
        AppModule.Administration => "Paramètres et utilisateurs",
        AppModule.Purchases => "Achats",
        AppModule.Stock => "Stock",
        AppModule.Accounting => "Comptabilité",
        AppModule.CRM => "CRM Commercial",
        AppModule.Fiscal => "Fiscal / TEJ",
        AppModule.AI => "Assistant IA",
        AppModule.Forecasting => "Prévisions IA",
        AppModule.Studio => "Studio (low-code)",
        AppModule.Payroll => "RH & Paie",
        AppModule.Honoraires => "Honoraires",
        AppModule.Projects => "Projets",
        AppModule.RecurringContracts => "Contrats récurrents",
        _ => throw new ArgumentOutOfRangeException(nameof(module))
    };

    /// <summary>
    /// All permissions that belong to this module (before role intersection).
    /// </summary>
    public static IReadOnlyList<string> GetPermissionKeys(this AppModule module) => module switch
    {
        AppModule.Clients => new[]
        {
            Permissions.Clients.Create,
            Permissions.Clients.Read,
            Permissions.Clients.Update,
            Permissions.Clients.Delete
        },
        AppModule.Products => new[]
        {
            Permissions.Products.Create,
            Permissions.Products.Read,
            Permissions.Products.Update,
            Permissions.Products.Delete
        },
        AppModule.Sales => new[]
        {
            Permissions.SalesOrders.Create,
            Permissions.SalesOrders.Read,
            Permissions.SalesOrders.Update,
            Permissions.SalesOrders.Delete,
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
            Permissions.Invoices.Create,
            Permissions.Invoices.Read,
            Permissions.Invoices.Update,
            Permissions.Invoices.Delete,
            Permissions.Invoices.Sign,
            Permissions.Invoices.Send,
            Permissions.Pricing.Create,
            Permissions.Pricing.Read,
            Permissions.Pricing.Update,
            Permissions.Pricing.Delete
        },
        AppModule.Treasury => new[]
        {
            Permissions.Payments.Create,
            Permissions.Payments.Read,
            Permissions.Payments.Update
        },
        AppModule.Reports => new[]
        {
            Permissions.Reports.View,
            Permissions.Reports.Export
        },
        AppModule.Administration => new[]
        {
            Permissions.Users.Create,
            Permissions.Users.Read,
            Permissions.Users.Update,
            Permissions.Users.Delete,
            Permissions.Settings.Read,
            Permissions.Settings.Update
        },
        AppModule.Purchases => new[]
        {
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
            Permissions.SupplierInvoices.Delete
        },
        AppModule.Stock => new[]
        {
            Permissions.Stock.Create,
            Permissions.Stock.Read,
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
            Permissions.Inventory.Delete
        },
        AppModule.Accounting => new[]
        {
            Permissions.Accounting.Read,
            Permissions.Accounting.Create,
            Permissions.Accounting.Close,
            Permissions.Accounting.CurrenciesManage,
            Permissions.Accounting.ExchangeRateOverride,
            Permissions.Accounting.Unletter,
            Permissions.Accounting.Validate,
            Permissions.Accounting.Reverse,
            Permissions.Accounting.Import,
            Permissions.Accounting.Declare,
            Permissions.Audit.Read
        },
        AppModule.CRM => new[]
        {
            Permissions.CRM.Read,
            Permissions.CRM.Create,
            Permissions.CRM.Update,
            Permissions.CRM.Delete,
            Permissions.SalesTargets.Read,
            Permissions.SalesTargets.Manage,
            Permissions.Reports.SalesOwn
        },
        AppModule.Fiscal => new[]
        {
            Permissions.WithholdingTax.Read,
            Permissions.WithholdingTax.Create,
            Permissions.WithholdingTax.Edit,
            Permissions.WithholdingTax.Validate,
            Permissions.WithholdingTax.Delete,
            Permissions.WithholdingTax.Export
        },
        AppModule.AI => new[]
        {
            Permissions.AI.Chat
        },
        AppModule.Forecasting => new[]
        {
            Permissions.Forecasting.View,
            Permissions.Forecasting.Manage
        },
        AppModule.Studio => new[]
        {
            Permissions.Studio.DesignEntities,
            Permissions.Studio.DesignForms,
            Permissions.Studio.DesignReports,
            Permissions.CustomData.RecordsRead,
            Permissions.CustomData.RecordsWrite,
            Permissions.CustomData.ReportsView
        },
        AppModule.Payroll => new[]
        {
            Permissions.Payroll.Read,
            Permissions.Payroll.ManageEmployees,
            Permissions.Payroll.RunPayroll,
            Permissions.Payroll.Validate,
            Permissions.Payroll.Declare,
            Permissions.Payroll.Export,
            Permissions.Payroll.Pay,
            Permissions.Payroll.Settings,
            // Ces trois clés sont dans le jeu de base d'Administrator/Accountant/Supervisor
            // (UserRole.cs) mais n'étaient portées par aucune feature Payroll ni par ce tableau :
            // un module activé « sans sous-sélection » (§5.2) faisait silencieusement disparaître
            // ces permissions du plafond effectif — même défaut latent que Treasury/TreasuryForecast.
            Permissions.Payroll.ManageGarnishments,
            Permissions.Payroll.HrDocuments,
            Permissions.Payroll.ManageTermination
        },
        AppModule.Honoraires => new[]
        {
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
        },
        AppModule.Projects => new[]
        {
            Permissions.Projects.Read,
            Permissions.Projects.Create,
            Permissions.Projects.Update,
            Permissions.Projects.Delete,
            Permissions.Projects.ManageTeam,
            Permissions.ProjectTasks.Create,
            Permissions.ProjectTasks.Read,
            Permissions.ProjectTasks.Update,
            Permissions.ProjectTasks.Delete,
            Permissions.ProjectTime.Create,
            Permissions.ProjectTime.Read,
            Permissions.ProjectTime.Submit,
            Permissions.ProjectTime.Validate,
            Permissions.ProjectBilling.Read,
            Permissions.ProjectBilling.Create
        },
        AppModule.RecurringContracts => new[]
        {
            Permissions.RecurringContracts.Read,
            Permissions.RecurringContracts.Create,
            Permissions.RecurringContracts.Update,
            Permissions.RecurringContracts.Delete,
            Permissions.RecurringContracts.Manage,
            Permissions.RecurringContracts.RecordUsage,
            Permissions.RecurringContracts.TriggerBilling
        },
        _ => Array.Empty<string>()
    };

    public static readonly AppModule[] AllValues = Enum.GetValues<AppModule>();

    /// <summary>
    /// Modules réservés aux plans payants — NON disponibles sur le plan Free et NON proposés
    /// librement par le wizard d'inscription. Source de vérité unique partagée entre
    /// <c>PlanSeeder</c> (Infrastructure — seeding du plan Free + alignement) et le mapper du
    /// catalogue sectoriel (Application — flag <c>AvailableOnFreePlan</c> exposé au wizard).
    /// Politique actuelle (2026-09) : liste vide — tous les modules sont disponibles sur Free ;
    /// seules les limites de quota (<see cref="SubscriptionLimits"/>) et les features de plan
    /// différencient Free de Monthly/Annual.
    /// Retour arrière : réinsérer AI, Forecasting, Studio, Payroll ici, régénérer les snapshots
    /// sector-catalog, restaurer <c>PREMIUM_MODULE_IDS</c> côté frontend, redémarrer l'API
    /// (<c>AlignFreePlanWizardModulesAsync</c> repassera ces modules à <c>IsIncluded=false</c> sur Free).
    /// <see cref="AppModule.Honoraires"/> reste exclu partout (natif cabinet) et n'apparaît pas ici.
    /// </summary>
    public static IReadOnlyCollection<AppModule> PaidPlanModuleIds { get; } = Array.Empty<AppModule>();

    /// <summary>True si <paramref name="module"/> est réservé aux plans payants (voir <see cref="PaidPlanModuleIds"/>).</summary>
    public static bool IsPaidPlanOnly(this AppModule module) => PaidPlanModuleIds.Contains(module);

    private static readonly Lazy<IReadOnlySet<string>> AllModulesPermissionUniverseLazy = new(() =>
    {
        var union = new HashSet<string>();
        foreach (var module in AllValues)
            foreach (var key in module.GetModulePermissionUniverse())
                union.Add(key);
        return union;
    });

    /// <summary>
    /// Union of every <see cref="AppModule"/>'s <see cref="GetModulePermissionUniverse"/> — every
    /// permission key reachable through the per-user module-grant system at all, regardless of role
    /// or which module is enabled. Used to identify permission keys that are NOT module-gated (e.g.
    /// <c>storefront:manage</c>, which has no owning <see cref="AppModule"/>): those must never be
    /// silently dropped just because a user has some (any) module grants configured, since no grant
    /// checkbox could ever have controlled them in the first place (plan §5.2/§7.2.1 — module
    /// customization must never produce a permission delta of REMOVAL).
    /// </summary>
    public static IReadOnlySet<string> GetAllModulesPermissionUniverse() => AllModulesPermissionUniverseLazy.Value;

    /// <summary>
    /// Full permission universe of a module: <see cref="GetPermissionKeys"/> plus every permission
    /// reachable through any of its sub-features (<see cref="ModuleFeatureCatalog"/>). Some modules
    /// (e.g. Treasury) have features that carry permissions absent from the flat module key list
    /// (e.g. <c>treasury_forecast:view/manage</c>) — a module enabled "without sub-selection" must
    /// still preserve those, otherwise activating the module can silently drop base permissions.
    /// </summary>
    public static IReadOnlySet<string> GetModulePermissionUniverse(this AppModule module)
    {
        var universe = new HashSet<string>(module.GetPermissionKeys());
        foreach (var featureKey in ModuleFeatureCatalog.GetValidFeatureKeys(module))
        {
            foreach (var permission in ModuleFeatureCatalog.GetPermissionsForFeature(module, featureKey))
                universe.Add(permission);
        }

        return universe;
    }

    /// <summary>
    /// True if <paramref name="effectivePermissions"/> contains at least one permission key mapped to this module.
    /// </summary>
    public static bool HasAnyEffectivePermission(this AppModule module, IReadOnlySet<string> effectivePermissions)
    {
        foreach (var key in module.GetPermissionKeys())
        {
            if (effectivePermissions.Contains(key))
                return true;
        }

        return false;
    }

    /// <summary>
    /// When per-user module grants exist, UI/JWT module list must match what the role can actually do:
    /// keep only modules toggled on whose keys intersect <paramref name="effectivePermissions"/>.
    /// </summary>
    public static IReadOnlyList<AppModule> FilterToModulesWithEffectivePermissions(
        IReadOnlyList<AppModule> modulesEnabledByGrantToggle,
        IReadOnlySet<string> effectivePermissions)
    {
        var result = new List<AppModule>();
        foreach (var m in modulesEnabledByGrantToggle)
        {
            if (m.HasAnyEffectivePermission(effectivePermissions))
                result.Add(m);
        }

        return result;
    }
}
