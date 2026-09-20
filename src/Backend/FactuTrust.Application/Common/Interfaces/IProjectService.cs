using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Common.Interfaces;

public interface IProjectService
{
    Task<PagedResult<ProjectListItemDto>> ListAsync(ProjectListQuery query, CancellationToken cancellationToken = default);
    Task<byte[]> ExportListCsvAsync(ProjectListQuery query, CancellationToken cancellationToken = default);
    Task<ProjectSearchResponseDto> SearchAsync(string? query, int limit, CancellationToken cancellationToken = default);
    Task<ProjectDashboardDto> GetDashboardAsync(CancellationToken cancellationToken = default);
    Task<ProjectDashboardExtendedDto> GetDashboardExtendedAsync(string? period, CancellationToken cancellationToken = default);
    Task<ProjectDto?> GetAsync(Guid id, CancellationToken cancellationToken = default);
    Task<Result<Guid>> CreateAsync(UpsertProjectDto dto, CancellationToken cancellationToken = default);
    Task<Result> UpdateAsync(Guid id, UpsertProjectDto dto, CancellationToken cancellationToken = default);
    Task<Result> ActivateAsync(Guid id, CancellationToken cancellationToken = default);
    Task<Result> HoldAsync(Guid id, CancellationToken cancellationToken = default);
    Task<Result> CompleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<Result> CancelAsync(Guid id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ProjectTaskDto>> ListTasksAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<ProjectTaskDto?> GetTaskAsync(Guid taskId, CancellationToken cancellationToken = default);
    Task<Result<Guid>> CreateTaskAsync(Guid projectId, UpsertProjectTaskDto dto, CancellationToken cancellationToken = default);
    Task<Result> UpdateTaskAsync(Guid taskId, UpsertProjectTaskDto dto, CancellationToken cancellationToken = default);
    Task<Result> MoveTaskAsync(Guid taskId, MoveProjectTaskDto dto, CancellationToken cancellationToken = default);
    Task<Result> DeleteTaskAsync(Guid taskId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ProjectCommentDto>> ListCommentsAsync(Guid projectId, Guid? taskId, CancellationToken cancellationToken = default);
    Task<Result<Guid>> AddCommentAsync(Guid projectId, string body, Guid? taskId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ProjectAttachmentDto>> ListAttachmentsAsync(Guid projectId, Guid? taskId, CancellationToken cancellationToken = default);
    Task<Result<Guid>> AddAttachmentAsync(Guid projectId, AddProjectAttachmentDto dto, CancellationToken cancellationToken = default);
    Task<Result<Guid>> UploadAttachmentAsync(Guid projectId, Stream content, string fileName, string contentType, long sizeBytes, Guid? taskId, CancellationToken cancellationToken = default);
    Task<Result<ProjectAttachmentFile>> DownloadAttachmentAsync(Guid projectId, Guid attachmentId, CancellationToken cancellationToken = default);
    Task<Result> DeleteAttachmentAsync(Guid projectId, Guid attachmentId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ProjectMemberDto>> ListMembersAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result<Guid>> AddMemberAsync(Guid projectId, UpsertProjectMemberDto dto, CancellationToken cancellationToken = default);
    Task<Result> UpdateMemberAsync(Guid memberId, UpsertProjectMemberDto dto, CancellationToken cancellationToken = default);
    Task<Result> RemoveMemberAsync(Guid memberId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ProjectActivityDto>> ListActivitiesAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ProjectAssignableUserDto>> ListAssignableUsersAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ProjectTimeEntryDto>> ListTimeEntriesAsync(Guid? projectId, DateTime? from, DateTime? to, ProjectTimeEntryStatus? status, CancellationToken cancellationToken = default);
    Task<Result<Guid>> CreateTimeEntryAsync(UpsertProjectTimeEntryDto dto, CancellationToken cancellationToken = default);
    Task<Result> UpdateTimeEntryAsync(Guid id, UpsertProjectTimeEntryDto dto, CancellationToken cancellationToken = default);
    Task<Result> SubmitTimeEntryAsync(Guid id, CancellationToken cancellationToken = default);
    Task<Result> ValidateTimeEntryAsync(Guid id, CancellationToken cancellationToken = default);
    Task<Result> DeleteTimeEntryAsync(Guid id, CancellationToken cancellationToken = default);
    Task<Result> ReopenTimeEntryAsync(Guid id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ProjectCostLineDto>> ListCostLinesAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result<Guid>> AddManualCostAsync(Guid projectId, AddProjectCostLineDto dto, CancellationToken cancellationToken = default);
    Task<ProjectBudgetDto> GetBudgetAsync(Guid projectId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ProjectMilestoneDto>> ListMilestonesAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result<Guid>> AddMilestoneAsync(Guid projectId, UpsertProjectMilestoneDto dto, CancellationToken cancellationToken = default);
    Task<Result> UpdateMilestoneAsync(Guid milestoneId, UpsertProjectMilestoneDto dto, CancellationToken cancellationToken = default);

    Task<ProjectBillingReadinessDto?> GetBillingReadinessAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<BillableProjectTaskDto>> GetBillableTasksAsync(Guid projectId, string method, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<BillableProjectTimeEntryDto>> GetBillableTimeEntriesAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ProjectDraftInvoiceDto>> GetCompatibleDraftInvoicesAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result<ProjectInvoiceResultDto>> InvoiceTimeAsync(Guid projectId, InvoiceTimeDto dto, CancellationToken cancellationToken = default);
    Task<Result<ProjectInvoiceResultDto>> InvoiceTasksAsync(Guid projectId, InvoiceTasksDto dto, CancellationToken cancellationToken = default);
    Task<Result<ProjectInvoiceResultDto>> InvoiceMilestoneAsync(Guid projectId, InvoiceMilestoneDto dto, CancellationToken cancellationToken = default);
    Task<Result<ProjectInvoiceResultDto>> InvoiceFixedPriceAsync(Guid projectId, InvoiceFixedPriceDto dto, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ProjectLinkedInvoiceDto>?> GetLinkedInvoicesAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ProjectWorkloadRowDto>> GetWorkloadAsync(Guid projectId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ProjectSituationDto>> ListSituationsAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result<Guid>> CreateSituationAsync(Guid projectId, UpsertProjectSituationDto dto, CancellationToken cancellationToken = default);
    Task<Result> UpdateSituationAsync(Guid situationId, UpsertProjectSituationDto dto, CancellationToken cancellationToken = default);
    Task<Result> ValidateSituationAsync(Guid situationId, CancellationToken cancellationToken = default);
    Task<Result<ProjectInvoiceResultDto>> InvoiceSituationAsync(Guid projectId, InvoiceSituationDto dto, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ProjectSubcontractorDto>> ListSubcontractorsAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result<Guid>> AddSubcontractorAsync(Guid projectId, UpsertProjectSubcontractorDto dto, CancellationToken cancellationToken = default);
    Task<Result> UpdateSubcontractorAsync(Guid subcontractorId, UpsertProjectSubcontractorDto dto, CancellationToken cancellationToken = default);

    Task<Result<Guid>> RecordStockExitAsync(Guid projectId, RecordProjectStockExitDto dto, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ProjectPurchaseOrderDto>> ListPurchaseOrdersAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result> AssignPurchaseOrderAsync(Guid projectId, AssignPurchaseOrderDto dto, CancellationToken cancellationToken = default);

    Task<ProjectProfitabilityDto?> GetProfitabilityAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result> LinkSalesOrderAsync(Guid projectId, LinkProjectSalesOrderDto dto, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ProjectUpdateDto>> ListProjectUpdatesAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result<Guid>> CreateProjectUpdateAsync(Guid projectId, CreateProjectUpdateDto dto, CancellationToken cancellationToken = default);
    Task<Result> MarkMilestoneReachedAsync(Guid milestoneId, bool reached, CancellationToken cancellationToken = default);
    Task<Result> SyncMilestoneProgressAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<Result> SetProductServiceBillingPolicyAsync(ServiceProductBillingPolicyDto dto, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<SalesOrderLineOptionDto>> ListProjectSalesOrderLinesAsync(Guid projectId, CancellationToken cancellationToken = default);
}
