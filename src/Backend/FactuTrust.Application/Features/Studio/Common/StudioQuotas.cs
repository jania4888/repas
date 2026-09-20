namespace FactuTrust.Application.Features.Studio.Common;

/// <summary>
/// Plan-limit keys for low-code Studio quotas + generous fallbacks used when a tenant's plan rows
/// predate these keys (existing installs that won't be re-seeded). Keys must match PlanSeeder.
/// </summary>
public static class StudioQuotas
{
    public const string MaxEntitiesKey = "MaxCustomEntities";
    public const string MaxFieldsKey = "MaxCustomFieldsPerEntity";
    public const string MaxRecordsKey = "MaxCustomRecordsPerEntity";
    /// <summary>Vues enregistrées par table (PR 2.3).</summary>
    public const string MaxRecordViewsKey = "MaxCustomRecordViewsPerEntity";

    public const int MaxEntitiesFallback = 50;
    public const int MaxFieldsFallback = 100;
    public const int MaxRecordsFallback = 100_000;
    public const int MaxRecordViewsFallback = 20;

    /// <summary>Workflows Studio (PR 4.1).</summary>
    public const string MaxWorkflowsKey = "MaxWorkflowsPerEntity";
    public const string MaxWorkflowStepsKey = "MaxWorkflowSteps";
    public const string MaxWorkflowInstancesPerRecordKey = "MaxWorkflowInstancesPerRecord";

    public const int MaxWorkflowsFallback = 20;
    public const int MaxWorkflowStepsFallback = 30;
    public const int MaxWorkflowInstancesPerRecordFallback = 200;
}
