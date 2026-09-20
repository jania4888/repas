namespace FactuTrust.Domain.Enums;

/// <summary>
/// Available subscription plans for FactuTrust.
/// </summary>
public enum SubscriptionPlan
{
    /// <summary>
    /// Free tier with limited features.
    /// </summary>
    Free = 0,

    /// <summary>
    /// Monthly subscription with full features.
    /// </summary>
    Monthly = 1,

    /// <summary>
    /// Annual subscription with full features and discounts.
    /// </summary>
    Annual = 2
}

/// <summary>
/// Status of a subscription.
/// </summary>
public enum SubscriptionStatus
{
    /// <summary>
    /// Subscription is active and valid.
    /// </summary>
    Active = 0,

    /// <summary>
    /// Trial period active.
    /// </summary>
    Trial = 1,

    /// <summary>
    /// Subscription has expired.
    /// </summary>
    Expired = 2,

    /// <summary>
    /// Subscription was cancelled.
    /// </summary>
    Cancelled = 3,

    /// <summary>
    /// Payment failed, grace period active.
    /// </summary>
    PastDue = 4,

    /// <summary>
    /// Account suspended due to payment issues.
    /// </summary>
    Suspended = 5
}

/// <summary>
/// Limits for each subscription plan.
/// </summary>
public static class SubscriptionLimits
{
    public static class Free
    {
        public const int MaxInvoicesPerMonth = 10;
        public const int MaxQuotesPerMonth = 10;
        public const int MaxClients = 20;
        public const int MaxProducts = 50;
        public const long MaxStorageBytes = 100 * 1024 * 1024; // 100 MB
        public const bool ElectronicSignature = false;
        public const bool XmlExport = false;
        public const bool PaymentTracking = false;
        public const bool PrioritySupport = false;
        public const int MaxUsers = 5;
        // Low-code Studio quotas. A single generated "system" can hold several tables, so this allows
        // a few multi-table systems on the free tier (was 10, too low for the Studio AI builder).
        public const int MaxCustomEntities = 50;
        public const int MaxCustomFieldsPerEntity = 30;
        public const int MaxCustomRecordsPerEntity = 1000;
        /// <summary>Vues enregistrées par table Studio (PR 2.3).</summary>
        public const int MaxCustomRecordViewsPerEntity = 20;
        /// <summary>Workflows par table Studio (PR 4.1).</summary>
        public const int MaxWorkflowsPerEntity = 20;
        /// <summary>Étapes maximales par workflow Studio (PR 4.1).</summary>
        public const int MaxWorkflowSteps = 30;
        /// <summary>Instances de workflow conservées par enregistrement (PR 4.1).</summary>
        public const int MaxWorkflowInstancesPerRecord = 200;
    }

    public static class Monthly
    {
        public const int MaxInvoicesPerMonth = int.MaxValue; // Unlimited
        public const int MaxQuotesPerMonth = int.MaxValue;
        public const int MaxClients = int.MaxValue;
        public const int MaxProducts = int.MaxValue;
        public const long MaxStorageBytes = 5L * 1024 * 1024 * 1024; // 5 GB
        public const bool ElectronicSignature = true;
        public const bool XmlExport = true;
        public const bool PaymentTracking = true;
        public const bool PrioritySupport = false;
        public const int MaxUsers = int.MaxValue;
    }

    public static class Annual
    {
        public const int MaxInvoicesPerMonth = int.MaxValue;
        public const int MaxQuotesPerMonth = int.MaxValue;
        public const int MaxClients = int.MaxValue;
        public const int MaxProducts = int.MaxValue;
        public const long MaxStorageBytes = 20L * 1024 * 1024 * 1024; // 20 GB
        public const bool ElectronicSignature = true;
        public const bool XmlExport = true;
        public const bool PaymentTracking = true;
        public const bool PrioritySupport = true;
        public const int MaxUsers = int.MaxValue;
    }

    public static int GetMaxUsers(SubscriptionPlan plan) => plan switch
    {
        SubscriptionPlan.Free => Free.MaxUsers,
        SubscriptionPlan.Monthly => Monthly.MaxUsers,
        SubscriptionPlan.Annual => Annual.MaxUsers,
        _ => Free.MaxUsers
    };

    public static int GetMaxInvoicesPerMonth(SubscriptionPlan plan) => plan switch
    {
        SubscriptionPlan.Free => Free.MaxInvoicesPerMonth,
        SubscriptionPlan.Monthly => Monthly.MaxInvoicesPerMonth,
        SubscriptionPlan.Annual => Annual.MaxInvoicesPerMonth,
        _ => 0
    };

    public static int GetMaxQuotesPerMonth(SubscriptionPlan plan) => plan switch
    {
        SubscriptionPlan.Free => Free.MaxQuotesPerMonth,
        SubscriptionPlan.Monthly => Monthly.MaxQuotesPerMonth,
        SubscriptionPlan.Annual => Annual.MaxQuotesPerMonth,
        _ => 0
    };

    public static bool HasFeature(SubscriptionPlan plan, string feature) => feature.ToLowerInvariant() switch
    {
        "electronicsignature" => plan != SubscriptionPlan.Free,
        "xmlexport" => plan != SubscriptionPlan.Free,
        "paymenttracking" => plan != SubscriptionPlan.Free,
        "prioritysupport" => plan == SubscriptionPlan.Annual,
        _ => true
    };
}

public static class SubscriptionPlanExtensions
{
    public static string ToDisplayString(this SubscriptionPlan plan) => plan switch
    {
        SubscriptionPlan.Free => "Gratuit",
        SubscriptionPlan.Monthly => "Mensuel",
        SubscriptionPlan.Annual => "Annuel",
        _ => throw new ArgumentOutOfRangeException(nameof(plan))
    };

    public static string ToDisplayString(this SubscriptionStatus status) => status switch
    {
        SubscriptionStatus.Active => "Actif",
        SubscriptionStatus.Trial => "Période d'essai",
        SubscriptionStatus.Expired => "Expiré",
        SubscriptionStatus.Cancelled => "Annulé",
        SubscriptionStatus.PastDue => "Paiement en retard",
        SubscriptionStatus.Suspended => "Suspendu",
        _ => throw new ArgumentOutOfRangeException(nameof(status))
    };
}
