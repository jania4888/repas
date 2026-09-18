using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

public sealed record ProjectListQuery
{
    public string? Search { get; init; }
    public ProjectStatus? Status { get; init; }
    public ProjectKind? Kind { get; init; }
    public Guid? ClientId { get; init; }
    public Guid? OwnerUserId { get; init; }
    public ProjectBillingMode? BillingMode { get; init; }
    public bool? OverdueOnly { get; init; }
    public DateTime? EndDateFrom { get; init; }
    public DateTime? EndDateTo { get; init; }
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 20;
}

public sealed record ProjectListItemDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = null!;
    public Guid ClientId { get; init; }
    public string ClientName { get; init; } = null!;
    public ProjectKind Kind { get; init; }
    public string KindDisplay { get; init; } = null!;
    public ProjectBillingMode BillingMode { get; init; }
    public string BillingModeDisplay { get; init; } = null!;
    public ProjectStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public DateTime? StartDate { get; init; }
    public DateTime? EndDate { get; init; }
    public decimal BudgetHt { get; init; }
    public int OpenTaskCount { get; init; }
    public int OverdueTaskCount { get; init; }
    public string? OwnerUserName { get; init; }
    public int ProgressPercent { get; init; }
    public int CompletedTaskCount { get; init; }
    public int TotalTaskCount { get; init; }
    public bool TimesheetsEnabled { get; init; }
}

public sealed record ProjectDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = null!;
    public string? Description { get; init; }
    public Guid ClientId { get; init; }
    public string ClientName { get; init; } = null!;
    public ProjectKind Kind { get; init; }
    public string KindDisplay { get; init; } = null!;
    public ProjectBillingMode BillingMode { get; init; }
    public string BillingModeDisplay { get; init; } = null!;
    public ProjectStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public DateTime? StartDate { get; init; }
    public DateTime? EndDate { get; init; }
    public decimal BudgetHt { get; init; }
    public string Currency { get; init; } = "TND";
    public Guid? OwnerUserId { get; init; }
    public string? OwnerUserName { get; init; }
    public string? SiteAddress { get; init; }
    public string? ContractNumber { get; init; }
    public bool TimesheetsEnabled { get; init; }
    public Guid? SalesOrderId { get; init; }
    public string? AnalyticAccountCode { get; init; }
    public bool MilestonesEnabled { get; init; }
    public decimal AllocatedHours { get; init; }
    public IReadOnlyList<ProjectPhaseDto> Phases { get; init; } = Array.Empty<ProjectPhaseDto>();
}

public sealed record UpsertProjectDto
{
    public Guid ClientId { get; init; }
    public string Name { get; init; } = null!;
    public string? Description { get; init; }
    public ProjectKind Kind { get; init; }
    public ProjectBillingMode BillingMode { get; init; }
    public DateTime? StartDate { get; init; }
    public DateTime? EndDate { get; init; }
    public decimal BudgetHt { get; init; }
    public Guid? OwnerUserId { get; init; }
    public string? SiteAddress { get; init; }
    public string? ContractNumber { get; init; }
    public bool TimesheetsEnabled { get; init; }
    public bool MilestonesEnabled { get; init; }
    public decimal AllocatedHours { get; init; }
    public string? AnalyticAccountCode { get; init; }
}

public sealed record SalesOrderLineOptionDto
{
    public Guid LineId { get; init; }
    public int LineNumber { get; init; }
    public string ProductName { get; init; } = null!;
    public decimal Quantity { get; init; }
    public decimal DeliveredQuantity { get; init; }
    public decimal PendingDeliveryQuantity { get; init; }
}

public sealed record ProjectPhaseDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = null!;
    public int SortOrder { get; init; }
    public string? Color { get; init; }
}

public sealed record ProjectTaskDto
{
    public Guid Id { get; init; }
    public Guid ProjectId { get; init; }
    public Guid PhaseId { get; init; }
    public string PhaseName { get; init; } = null!;
    public Guid? ParentTaskId { get; init; }
    public string Title { get; init; } = null!;
    public string? Description { get; init; }
    public ProjectTaskStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public ProjectTaskPriority Priority { get; init; }
    public string PriorityDisplay { get; init; } = null!;
    public DateTime? DueDate { get; init; }
    public int ProgressPercent { get; init; }
    public Guid? AssigneeUserId { get; init; }
    public string? AssigneeUserName { get; init; }
    public Guid? EmployeeId { get; init; }
    public decimal EstimatedHours { get; init; }
    public decimal LoggedHours { get; init; }
    public bool IsOverdue { get; init; }
}

public sealed record UpsertProjectTaskDto
{
    public Guid PhaseId { get; init; }
    public Guid? ParentTaskId { get; init; }
    public string Title { get; init; } = null!;
    public string? Description { get; init; }
    public ProjectTaskPriority Priority { get; init; }
    public ProjectTaskStatus? Status { get; init; }
    public DateTime? DueDate { get; init; }
    public Guid? AssigneeUserId { get; init; }
    public Guid? EmployeeId { get; init; }
    public decimal EstimatedHours { get; init; }
    public int ProgressPercent { get; init; }
}

public sealed record MoveProjectTaskDto
{
    public Guid PhaseId { get; init; }
    public ProjectTaskStatus? Status { get; init; }
}

public sealed record ProjectCommentDto
{
    public Guid Id { get; init; }
    public Guid? TaskId { get; init; }
    public Guid AuthorUserId { get; init; }
    public string AuthorName { get; init; } = null!;
    public string Body { get; init; } = null!;
    public DateTime CreatedAt { get; init; }
}

public sealed record ProjectAttachmentDto
{
    public Guid Id { get; init; }
    public Guid? TaskId { get; init; }
    public string FileName { get; init; } = null!;
    public string ContentType { get; init; } = null!;
    public long SizeBytes { get; init; }
    public DateTime CreatedAt { get; init; }
}

public sealed record AddProjectAttachmentDto
{
    public Guid? TaskId { get; init; }
    public string FileName { get; init; } = null!;
    public string ContentType { get; init; } = "application/octet-stream";
    public long SizeBytes { get; init; }
    public string? StoragePath { get; init; }
}

public sealed record ProjectMemberDto
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string UserName { get; init; } = null!;
    public ProjectMemberRole Role { get; init; }
    public string RoleDisplay { get; init; } = null!;
    public decimal? SalesRate { get; init; }
    public decimal? HourlyCost { get; init; }
    public decimal WeeklyCapacityHours { get; init; }
}

public sealed record UpsertProjectMemberDto
{
    public Guid UserId { get; init; }
    public ProjectMemberRole Role { get; init; }
    public decimal? SalesRate { get; init; }
    public decimal? HourlyCost { get; init; }
    public decimal WeeklyCapacityHours { get; init; }
}

public sealed record ProjectActivityDto
{
    public Guid Id { get; init; }
    public Guid? TaskId { get; init; }
    public Guid? ActorUserId { get; init; }
    public string Type { get; init; } = null!;
    public string Message { get; init; } = null!;
    public DateTime CreatedAt { get; init; }
}

public sealed record ProjectTimeEntryDto
{
    public Guid Id { get; init; }
    public Guid ProjectId { get; init; }
    public string ProjectName { get; init; } = null!;
    public Guid? TaskId { get; init; }
    public string? TaskTitle { get; init; }
    public Guid UserId { get; init; }
    public string UserName { get; init; } = null!;
    public DateTime WorkDate { get; init; }
    public decimal Hours { get; init; }
    public bool IsBillable { get; init; }
    public string? Notes { get; init; }
    public ProjectTimeEntryStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public Guid? InvoicedInvoiceId { get; init; }
    public Guid? SalesOrderLineId { get; init; }
    public TimesheetEntrySource EntrySource { get; init; }
    public bool IsTimerRunning { get; init; }
}

public sealed record UpsertProjectTimeEntryDto
{
    public Guid ProjectId { get; init; }
    public Guid? TaskId { get; init; }
    public Guid? UserId { get; init; }
    public DateTime WorkDate { get; init; }
    public decimal Hours { get; init; }
    public bool IsBillable { get; init; }
    public string? Notes { get; init; }
    public Guid? SalesOrderLineId { get; init; }
}

public sealed record ProjectCostLineDto
{
    public Guid Id { get; init; }
    public ProjectCostSource Source { get; init; }
    public string SourceDisplay { get; init; } = null!;
    public Guid? SourceId { get; init; }
    public string Description { get; init; } = null!;
    public decimal AmountHt { get; init; }
    public DateTime OccurredOn { get; init; }
}

public sealed record AddProjectCostLineDto
{
    public string Description { get; init; } = null!;
    public decimal AmountHt { get; init; }
    public DateTime OccurredOn { get; init; }
}

public sealed record ProjectBudgetDto
{
    public decimal BudgetHt { get; init; }
    public decimal ActualCostHt { get; init; }
    public decimal TimeCostHt { get; init; }
    public decimal RemainingHt { get; init; }
    public decimal LoggedHours { get; init; }
    public decimal BillableUninvoicedHours { get; init; }
}

public sealed record ProjectMilestoneDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = null!;
    public decimal Percent { get; init; }
    public decimal AmountHt { get; init; }
    public DateTime? DueDate { get; init; }
    public Guid? InvoicedInvoiceId { get; init; }
    public Guid? SalesOrderLineId { get; init; }
    public bool IsReached { get; init; }
    public DateTime? ReachedAt { get; init; }
}

public sealed record UpsertProjectMilestoneDto
{
    public string Name { get; init; } = null!;
    public decimal Percent { get; init; }
    public decimal AmountHt { get; init; }
    public DateTime? DueDate { get; init; }
    public Guid? SalesOrderLineId { get; init; }
}

public sealed record ProjectSituationDto
{
    public Guid Id { get; init; }
    public int Number { get; init; }
    public DateTime PeriodStart { get; init; }
    public DateTime PeriodEnd { get; init; }
    public decimal CumulativePercent { get; init; }
    public decimal GrossAmountHt { get; init; }
    public decimal RetainageAmountHt { get; init; }
    public decimal NetAmountHt { get; init; }
    public int VatRatePercent { get; init; }
    public decimal VatAmount { get; init; }
    public decimal TotalTtc { get; init; }
    public ProjectSituationStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public Guid? InvoiceId { get; init; }
}

public sealed record UpsertProjectSituationDto
{
    public DateTime PeriodStart { get; init; }
    public DateTime PeriodEnd { get; init; }
    public decimal CumulativePercent { get; init; }
    public decimal GrossAmountHt { get; init; }
    public decimal RetainageAmountHt { get; init; }
    public int VatRatePercent { get; init; } = 19;
}

public sealed record ProjectSubcontractorDto
{
    public Guid Id { get; init; }
    public Guid SupplierId { get; init; }
    public string SupplierName { get; init; } = null!;
    public string? ContractReference { get; init; }
    public decimal AmountHt { get; init; }
    public decimal RetainagePercent { get; init; }
}

public sealed record UpsertProjectSubcontractorDto
{
    public Guid SupplierId { get; init; }
    public string? ContractReference { get; init; }
    public decimal AmountHt { get; init; }
    public decimal RetainagePercent { get; init; }
}

public sealed record InvoiceTimeDto
{
    public string GroupBy { get; init; } = "member";
    public string? Notes { get; init; }
    /// <summary>Entrées à facturer. Si vide : toutes les saisies éligibles (comportement legacy).</summary>
    public IReadOnlyList<Guid> TimeEntryIds { get; init; } = Array.Empty<Guid>();
}

public sealed record InvoiceTaskLineDto
{
    public Guid TaskId { get; init; }
    public decimal? AmountHt { get; init; }
    public decimal? HourlyRate { get; init; }
}

public sealed record InvoiceTasksDto
{
    public string Method { get; init; } = "hourly";
    public string? Notes { get; init; }
    public IReadOnlyList<InvoiceTaskLineDto> Tasks { get; init; } = Array.Empty<InvoiceTaskLineDto>();
}

public sealed record BillableProjectTaskDto
{
    public Guid Id { get; init; }
    public string Title { get; init; } = null!;
    public decimal UninvoicedBillableHours { get; init; }
    public decimal HourlyRate { get; init; }
    public decimal PreviewAmountHt { get; init; }
    public bool IsEligible { get; init; }
    public string? BlockReason { get; init; }
}

public sealed record BillableProjectTimeEntryDto
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string UserName { get; init; } = null!;
    public DateTime WorkDate { get; init; }
    public Guid? TaskId { get; init; }
    public string? TaskTitle { get; init; }
    public decimal Hours { get; init; }
    public decimal HourlyRate { get; init; }
    public decimal PreviewAmountHt { get; init; }
    public bool IsEligible { get; init; }
    public string? BlockReason { get; init; }
}

public sealed record InvoiceMilestoneDto
{
    public Guid MilestoneId { get; init; }
    public string? Notes { get; init; }
}

public sealed record InvoiceSituationDto
{
    public Guid SituationId { get; init; }
    public string? Notes { get; init; }
}

public sealed record InvoiceFixedPriceDto
{
    public decimal AmountHt { get; init; }
    public string? Notes { get; init; }
}

public sealed record ProjectInvoiceResultDto
{
    public Guid InvoiceId { get; init; }
    public Guid BillingId { get; init; }
}

/// <summary>Facture commerciale émise depuis un projet (GET /projects/{id}/linked-invoices).</summary>
public sealed record ProjectLinkedInvoiceDto
{
    public Guid InvoiceId { get; init; }
    public string Number { get; init; } = null!;
    /// <summary>Date d'émission (IssueDate).</summary>
    public DateTime IssueDate { get; init; }
    public string ClientName { get; init; } = null!;
    /// <summary>SubTotal HT (négatif pour un avoir).</summary>
    public decimal AmountHT { get; init; }
    /// <summary>Total TVA (négatif pour un avoir).</summary>
    public decimal AmountVat { get; init; }
    /// <summary>TotalAmount TTC (négatif pour un avoir).</summary>
    public decimal AmountTTC { get; init; }
    public string Currency { get; init; } = null!;
    public InvoiceStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public bool IsCreditNote { get; init; }
    public DateTime CreatedAt { get; init; }
    /// <summary>Type de facturation projet (régie, jalon, etc.) ; null pour un avoir sans lien direct.</summary>
    public ProjectBillingKind? BillingKind { get; init; }
}

public sealed record RecordProjectStockExitDto
{
    public Guid ProductId { get; init; }
    public Guid? WarehouseId { get; init; }
    public decimal Quantity { get; init; }
    public string? Notes { get; init; }
}

public sealed record AssignPurchaseOrderDto
{
    public Guid PurchaseOrderId { get; init; }
}

/// <summary>Purchase order linked to a project (budget tab list).</summary>
public sealed record ProjectPurchaseOrderDto
{
    public Guid Id { get; init; }
    public string Number { get; init; } = null!;
    public string SupplierName { get; init; } = null!;
    public DateTime OrderDate { get; init; }
    public PurchaseOrderStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public string StatusCss { get; init; } = null!;
    public decimal TotalHt { get; init; }
}

public sealed record ProjectWorkloadRowDto
{
    public Guid UserId { get; init; }
    public string UserName { get; init; } = null!;
    public decimal WeeklyCapacityHours { get; init; }
    public decimal EstimatedHours { get; init; }
    public decimal LoggedHours { get; init; }
}

public sealed record ProjectAssignableUserDto
{
    public Guid Id { get; init; }
    public string DisplayName { get; init; } = null!;
}

public sealed record ProjectDashboardDto
{
    public int ActiveProjects { get; init; }
    public int OpenTasks { get; init; }
    public int OverdueTasks { get; init; }
    public decimal UninvoicedBillableHours { get; init; }
}

public sealed record ProjectStatusBreakdownDto
{
    public ProjectStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public int Count { get; init; }
    public int Percent { get; init; }
}

public sealed record ProjectTaskTrendPointDto
{
    public DateTime Date { get; init; }
    public int Created { get; init; }
    public int Completed { get; init; }
    public int Pending { get; init; }
    public int Overdue { get; init; }
}

public sealed record ProjectRecentRowDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = null!;
    public string? Description { get; init; }
    public ProjectKind Kind { get; init; }
    public string KindDisplay { get; init; } = null!;
    public string ClientName { get; init; } = null!;
    public string? OwnerUserName { get; init; }
    public int ProgressPercent { get; init; }
    public ProjectStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public DateTime? EndDate { get; init; }
}

public sealed record ProjectUpcomingTaskRowDto
{
    public Guid Id { get; init; }
    public Guid ProjectId { get; init; }
    public string ProjectName { get; init; } = null!;
    public string Title { get; init; } = null!;
    public DateTime? DueDate { get; init; }
    public string? AssigneeUserName { get; init; }
    public ProjectTaskPriority Priority { get; init; }
    public string PriorityDisplay { get; init; } = null!;
    public bool IsOverdue { get; init; }
}

public sealed record ProjectActiveMemberRowDto
{
    public Guid UserId { get; init; }
    public string DisplayName { get; init; } = null!;
    public string? RoleDisplay { get; init; }
    public DateTime? LastActivityAt { get; init; }
    public string ActivityStatus { get; init; } = "offline";
}

public sealed record ProjectDashboardKpiTrendsDto
{
    public int? ActiveProjectsChangePercent { get; init; }
    public int? OpenTasksChangePercent { get; init; }
    public int? CompletedTasksChangePercent { get; init; }
    public int? OverdueTasksChangePercent { get; init; }
    public int? UninvoicedBillableHoursChangePercent { get; init; }
    public int? AverageProgressChangePercent { get; init; }
}

public sealed record ProjectPerformanceMiniStatDto
{
    public string Label { get; init; } = null!;
    public int ChangePercent { get; init; }
    public bool IsPositive { get; init; }
}

public sealed record ProjectPerformanceSummaryDto
{
    public string Title { get; init; } = null!;
    public IReadOnlyList<ProjectPerformanceMiniStatDto> Stats { get; init; } = Array.Empty<ProjectPerformanceMiniStatDto>();
}

public sealed record ProjectDashboardExtendedDto
{
    public int ActiveProjects { get; init; }
    public int OpenTasks { get; init; }
    public int OverdueTasks { get; init; }
    public decimal UninvoicedBillableHours { get; init; }
    public int CompletedTasks { get; init; }
    public int TotalProjects { get; init; }
    public int AverageProgressPercent { get; init; }
    public int ProgressTargetPercent { get; init; } = 90;
    public ProjectDashboardKpiTrendsDto? KpiTrends { get; init; }
    public ProjectPerformanceSummaryDto? PerformanceSummary { get; init; }
    public IReadOnlyList<ProjectStatusBreakdownDto> ProjectStatusBreakdown { get; init; } = Array.Empty<ProjectStatusBreakdownDto>();
    public IReadOnlyList<ProjectTaskTrendPointDto> TaskTrend { get; init; } = Array.Empty<ProjectTaskTrendPointDto>();
    public IReadOnlyList<ProjectRecentRowDto> RecentProjects { get; init; } = Array.Empty<ProjectRecentRowDto>();
    public IReadOnlyList<ProjectUpcomingTaskRowDto> UpcomingTasks { get; init; } = Array.Empty<ProjectUpcomingTaskRowDto>();
    public IReadOnlyList<ProjectActiveMemberRowDto> ActiveMembers { get; init; } = Array.Empty<ProjectActiveMemberRowDto>();
}

public enum ProjectSearchResultKind
{
    Project = 0,
    Task = 1,
    Attachment = 2
}

public sealed record ProjectSearchResultDto
{
    public ProjectSearchResultKind Kind { get; init; }
    public Guid Id { get; init; }
    public Guid ProjectId { get; init; }
    public string Title { get; init; } = null!;
    public string? Subtitle { get; init; }
    public string? StatusDisplay { get; init; }
    public int Score { get; init; }
}

public sealed record ProjectSearchResponseDto
{
    public string Query { get; init; } = "";
    public IReadOnlyList<ProjectSearchResultDto> Results { get; init; } = Array.Empty<ProjectSearchResultDto>();
}

public sealed record ProjectBillingReadinessDto
{
    public bool CanBill { get; init; }
    public bool CanInvoiceTime { get; init; }
    public bool CanReceiveTime { get; init; }
    public ProjectStatus Status { get; init; }
    public string StatusDisplay { get; init; } = null!;
    public decimal ValidatedUninvoicedHours { get; init; }
    public IReadOnlyList<string> MembersWithoutRate { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> Blockers { get; init; } = Array.Empty<string>();
}

public sealed class ProjectAttachmentFile
{
    public required Stream Content { get; init; }
    public required string ContentType { get; init; }
    public required string FileName { get; init; }
}
