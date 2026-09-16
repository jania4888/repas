namespace FactuTrust.Domain.Entities.Projects;

/// <summary>
/// Resolves whether a time entry is billable from user intent and optional sales-order linkage.
/// </summary>
public static class ProjectTimeBillablePolicy
{
    public static bool Resolve(bool requestedBillable, Guid? projectSalesOrderId, Guid? salesOrderLineId)
    {
        if (!requestedBillable)
            return false;
        if (projectSalesOrderId.HasValue && !salesOrderLineId.HasValue)
            return false;
        return true;
    }
}
