using FactuTrust.API.Authorization;
using FactuTrust.API.Http;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace FactuTrust.API.Controllers.Projects;

[ApiController]
[Route("api/projects")]
[Authorize]
public sealed class ProjectsController : ControllerBase
{
    private readonly IProjectService _service;
    private readonly ProjectsOptions _options;

    public ProjectsController(IProjectService service, IOptions<ProjectsOptions> options)
    {
        _service = service;
        _options = options.Value;
    }

    private ActionResult? GuardEnabled()
    {
        if (!_options.Enabled)
            return StatusCode(StatusCodes.Status503ServiceUnavailable, ApiResponse<object>.Fail(
                "Le module Projets est désactivé. Activez Features:Projects:Enabled."));
        return null;
    }

    [HttpGet]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<PagedResult<ProjectListItemDto>>>> List(
        [FromQuery] string? search,
        [FromQuery] ProjectStatus? status,
        [FromQuery] ProjectKind? kind,
        [FromQuery] Guid? clientId,
        [FromQuery] Guid? ownerUserId,
        [FromQuery] ProjectBillingMode? billingMode,
        [FromQuery] bool? overdueOnly,
        [FromQuery] DateTime? endDateFrom,
        [FromQuery] DateTime? endDateTo,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var query = new ProjectListQuery
        {
            Search = search,
            Status = status,
            Kind = kind,
            ClientId = clientId,
            OwnerUserId = ownerUserId,
            BillingMode = billingMode,
            OverdueOnly = overdueOnly,
            EndDateFrom = endDateFrom,
            EndDateTo = endDateTo,
            Page = page,
            PageSize = pageSize
        };
        var result = await _service.ListAsync(query, cancellationToken);
        return Ok(ApiResponse<PagedResult<ProjectListItemDto>>.Ok(result));
    }

    [HttpGet("export")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<IActionResult> Export(
        [FromQuery] string? search,
        [FromQuery] ProjectStatus? status,
        [FromQuery] ProjectKind? kind,
        [FromQuery] Guid? clientId,
        [FromQuery] Guid? ownerUserId,
        [FromQuery] ProjectBillingMode? billingMode,
        [FromQuery] bool? overdueOnly,
        [FromQuery] DateTime? endDateFrom,
        [FromQuery] DateTime? endDateTo,
        CancellationToken cancellationToken = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var query = new ProjectListQuery
        {
            Search = search,
            Status = status,
            Kind = kind,
            ClientId = clientId,
            OwnerUserId = ownerUserId,
            BillingMode = billingMode,
            OverdueOnly = overdueOnly,
            EndDateFrom = endDateFrom,
            EndDateTo = endDateTo
        };
        var bytes = await _service.ExportListCsvAsync(query, cancellationToken);
        var fileName = $"projets-{DateTime.UtcNow:yyyyMMdd-HHmm}.csv";
        return File(bytes, "text/csv; charset=utf-8", fileName);
    }

    [HttpGet("dashboard")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<ProjectDashboardDto>>> Dashboard(CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<ProjectDashboardDto>.Ok(await _service.GetDashboardAsync(cancellationToken)));
    }

    [HttpGet("dashboard/extended")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<ProjectDashboardExtendedDto>>> DashboardExtended(
        [FromQuery] string? period,
        CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<ProjectDashboardExtendedDto>.Ok(await _service.GetDashboardExtendedAsync(period, cancellationToken)));
    }

    [HttpGet("search")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<ProjectSearchResponseDto>>> Search(
        [FromQuery] string? q,
        [FromQuery] int limit = 8,
        CancellationToken cancellationToken = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<ProjectSearchResponseDto>.Ok(await _service.SearchAsync(q, limit, cancellationToken)));
    }

    [HttpGet("users")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectAssignableUserDto>>>> Users(CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectAssignableUserDto>>.Ok(await _service.ListAssignableUsersAsync(cancellationToken)));
    }

    [HttpGet("time")]
    [Authorize(Policy = PermissionPolicies.ProjectTimeRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectTimeEntryDto>>>> Time(
        [FromQuery] Guid? projectId,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] ProjectTimeEntryStatus? status,
        CancellationToken cancellationToken = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.ListTimeEntriesAsync(projectId, from, to, status, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<ProjectTimeEntryDto>>.Ok(result));
    }

    [HttpPost("time")]
    [Authorize(Policy = PermissionPolicies.ProjectTimeCreate)]
    public async Task<ActionResult<ApiResponse<Guid>>> CreateTime([FromBody] UpsertProjectTimeEntryDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.CreateTimeEntryAsync(dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value));
    }

    [HttpPut("time/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectTimeCreate)]
    public async Task<IActionResult> UpdateTime(Guid id, [FromBody] UpsertProjectTimeEntryDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.UpdateTimeEntryAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("time/{id:guid}/submit")]
    [Authorize(Policy = PermissionPolicies.ProjectTimeSubmit)]
    public async Task<IActionResult> SubmitTime(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.SubmitTimeEntryAsync(id, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("time/{id:guid}/validate")]
    [Authorize(Policy = PermissionPolicies.ProjectTimeValidate)]
    public async Task<IActionResult> ValidateTime(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.ValidateTimeEntryAsync(id, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpDelete("time/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectTimeCreate)]
    public async Task<IActionResult> DeleteTime(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.DeleteTimeEntryAsync(id, cancellationToken);
        return ResultHttp.ToActionResult(this, result);
    }

    [HttpPost("time/{id:guid}/reopen")]
    public async Task<IActionResult> ReopenTime(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.ReopenTimeEntryAsync(id, cancellationToken);
        return ResultHttp.ToActionResult(this, result);
    }

    [HttpGet("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<ProjectDto>>> Get(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var dto = await _service.GetAsync(id, cancellationToken);
        if (dto is null) return NotFound(ApiResponse<ProjectDto>.Fail("Projet introuvable"));
        return Ok(ApiResponse<ProjectDto>.Ok(dto));
    }

    [HttpPost]
    [Authorize(Policy = PermissionPolicies.ProjectsCreate)]
    public async Task<ActionResult<ApiResponse<Guid>>> Create([FromBody] UpsertProjectDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.CreateAsync(dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpsertProjectDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.UpdateAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("{id:guid}/activate")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<IActionResult> Activate(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.ActivateAsync(id, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("{id:guid}/hold")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<IActionResult> Hold(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.HoldAsync(id, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("{id:guid}/complete")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<IActionResult> Complete(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.CompleteAsync(id, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("{id:guid}/cancel")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<IActionResult> Cancel(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.CancelAsync(id, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpGet("{id:guid}/tasks")]
    [Authorize(Policy = PermissionPolicies.ProjectTasksRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectTaskDto>>>> Tasks(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectTaskDto>>.Ok(await _service.ListTasksAsync(id, cancellationToken)));
    }

    [HttpGet("tasks/{taskId:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectTasksRead)]
    public async Task<ActionResult<ApiResponse<ProjectTaskDto>>> TaskDetail(Guid taskId, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var dto = await _service.GetTaskAsync(taskId, cancellationToken);
        if (dto is null) return NotFound(ApiResponse<ProjectTaskDto>.Fail("Tâche introuvable"));
        return Ok(ApiResponse<ProjectTaskDto>.Ok(dto));
    }

    [HttpPost("{id:guid}/tasks")]
    [Authorize(Policy = PermissionPolicies.ProjectTasksCreate)]
    public async Task<ActionResult<ApiResponse<Guid>>> CreateTask(Guid id, [FromBody] UpsertProjectTaskDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.CreateTaskAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value));
    }

    [HttpPut("tasks/{taskId:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectTasksUpdate)]
    public async Task<IActionResult> UpdateTask(Guid taskId, [FromBody] UpsertProjectTaskDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.UpdateTaskAsync(taskId, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("tasks/{taskId:guid}/move")]
    [Authorize(Policy = PermissionPolicies.ProjectTasksUpdate)]
    public async Task<IActionResult> MoveTask(Guid taskId, [FromBody] MoveProjectTaskDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.MoveTaskAsync(taskId, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpDelete("tasks/{taskId:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectTasksDelete)]
    public async Task<IActionResult> DeleteTask(Guid taskId, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.DeleteTaskAsync(taskId, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpGet("{id:guid}/comments")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectCommentDto>>>> Comments(Guid id, [FromQuery] Guid? taskId, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectCommentDto>>.Ok(await _service.ListCommentsAsync(id, taskId, cancellationToken)));
    }

    [HttpPost("{id:guid}/comments")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<ActionResult<ApiResponse<Guid>>> AddComment(Guid id, [FromBody] ProjectCommentBodyDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.AddCommentAsync(id, dto.Body, dto.TaskId, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value));
    }

    [HttpGet("{id:guid}/attachments")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectAttachmentDto>>>> Attachments(Guid id, [FromQuery] Guid? taskId, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectAttachmentDto>>.Ok(await _service.ListAttachmentsAsync(id, taskId, cancellationToken)));
    }

    [HttpPost("{id:guid}/attachments")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<ActionResult<ApiResponse<Guid>>> AddAttachment(Guid id, [FromBody] AddProjectAttachmentDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.AddAttachmentAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value));
    }

    [HttpPost("{id:guid}/attachments/upload")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    [RequestSizeLimit(10 * 1024 * 1024 + 512_000)]
    public async Task<ActionResult<ApiResponse<Guid>>> UploadAttachment(
        Guid id,
        [FromForm] IFormFile file,
        [FromForm] Guid? taskId,
        CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<Guid>.Fail("Fichier requis."));
        await using var stream = file.OpenReadStream();
        var result = await _service.UploadAttachmentAsync(
            id, stream, file.FileName, file.ContentType ?? "application/octet-stream", file.Length, taskId, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value, "Pièce jointe ajoutée"));
    }

    [HttpGet("{id:guid}/attachments/{attachmentId:guid}/download")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<IActionResult> DownloadAttachment(Guid id, Guid attachmentId, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.DownloadAttachmentAsync(id, attachmentId, cancellationToken);
        if (result.IsFailure) return NotFound(ApiResponse<object>.Fail(result.Error.Description));
        return File(result.Value.Content, result.Value.ContentType, result.Value.FileName);
    }

    [HttpDelete("{id:guid}/attachments/{attachmentId:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<IActionResult> DeleteAttachment(Guid id, Guid attachmentId, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.DeleteAttachmentAsync(id, attachmentId, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true, "Pièce jointe supprimée"));
    }

    [HttpGet("{id:guid}/members")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectMemberDto>>>> Members(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectMemberDto>>.Ok(await _service.ListMembersAsync(id, cancellationToken)));
    }

    [HttpPost("{id:guid}/members")]
    [Authorize(Policy = PermissionPolicies.ProjectsManageTeam)]
    public async Task<ActionResult<ApiResponse<Guid>>> AddMember(Guid id, [FromBody] UpsertProjectMemberDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.AddMemberAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value));
    }

    [HttpPut("members/{memberId:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectsManageTeam)]
    public async Task<IActionResult> UpdateMember(Guid memberId, [FromBody] UpsertProjectMemberDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.UpdateMemberAsync(memberId, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpDelete("members/{memberId:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectsManageTeam)]
    public async Task<IActionResult> RemoveMember(Guid memberId, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.RemoveMemberAsync(memberId, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpGet("{id:guid}/activity")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectActivityDto>>>> Activity(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectActivityDto>>.Ok(await _service.ListActivitiesAsync(id, cancellationToken)));
    }

    [HttpGet("{id:guid}/costs")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectCostLineDto>>>> Costs(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectCostLineDto>>.Ok(await _service.ListCostLinesAsync(id, cancellationToken)));
    }

    [HttpPost("{id:guid}/costs")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<ActionResult<ApiResponse<Guid>>> AddCost(Guid id, [FromBody] AddProjectCostLineDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.AddManualCostAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value));
    }

    [HttpGet("{id:guid}/budget")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<ProjectBudgetDto>>> Budget(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<ProjectBudgetDto>.Ok(await _service.GetBudgetAsync(id, cancellationToken)));
    }

    [HttpGet("{id:guid}/milestones")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectMilestoneDto>>>> Milestones(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectMilestoneDto>>.Ok(await _service.ListMilestonesAsync(id, cancellationToken)));
    }

    [HttpPost("{id:guid}/milestones")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingCreate)]
    public async Task<ActionResult<ApiResponse<Guid>>> AddMilestone(Guid id, [FromBody] UpsertProjectMilestoneDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.AddMilestoneAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value));
    }

    [HttpPut("milestones/{milestoneId:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingCreate)]
    public async Task<IActionResult> UpdateMilestone(Guid milestoneId, [FromBody] UpsertProjectMilestoneDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.UpdateMilestoneAsync(milestoneId, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpGet("{id:guid}/billing/readiness")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<ProjectBillingReadinessDto>>> BillingReadiness(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var dto = await _service.GetBillingReadinessAsync(id, cancellationToken);
        if (dto is null) return NotFound(ApiResponse<ProjectBillingReadinessDto>.Fail("Projet introuvable"));
        return Ok(ApiResponse<ProjectBillingReadinessDto>.Ok(dto));
    }

    [HttpGet("{id:guid}/workload")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectWorkloadRowDto>>>> Workload(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectWorkloadRowDto>>.Ok(await _service.GetWorkloadAsync(id, cancellationToken)));
    }

    [HttpGet("{id:guid}/billing/billable-tasks")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<BillableProjectTaskDto>>>> BillableTasks(Guid id, [FromQuery] string method = "hourly", CancellationToken cancellationToken = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        if (await _service.GetAsync(id, cancellationToken) is null)
            return NotFound(ApiResponse<IReadOnlyList<BillableProjectTaskDto>>.Fail("Projet introuvable"));
        var items = await _service.GetBillableTasksAsync(id, method, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<BillableProjectTaskDto>>.Ok(items));
    }

    [HttpGet("{id:guid}/billing/billable-time-entries")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<BillableProjectTimeEntryDto>>>> BillableTimeEntries(
        Guid id, CancellationToken cancellationToken = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        if (await _service.GetAsync(id, cancellationToken) is null)
            return NotFound(ApiResponse<IReadOnlyList<BillableProjectTimeEntryDto>>.Fail("Projet introuvable"));
        var items = await _service.GetBillableTimeEntriesAsync(id, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<BillableProjectTimeEntryDto>>.Ok(items));
    }

    [HttpGet("{id:guid}/billing/draft-invoices")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectDraftInvoiceDto>>>> CompatibleDraftInvoices(
        Guid id, CancellationToken cancellationToken = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        if (await _service.GetAsync(id, cancellationToken) is null)
            return NotFound(ApiResponse<IReadOnlyList<ProjectDraftInvoiceDto>>.Fail("Projet introuvable"));
        var items = await _service.GetCompatibleDraftInvoicesAsync(id, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<ProjectDraftInvoiceDto>>.Ok(items));
    }

    [HttpPost("{id:guid}/billing/tasks")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingCreate)]
    public async Task<ActionResult<ApiResponse<ProjectInvoiceResultDto>>> InvoiceTasks(Guid id, [FromBody] InvoiceTasksDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.InvoiceTasksAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<ProjectInvoiceResultDto>.Fail(result.Error.Description));
        return Ok(ApiResponse<ProjectInvoiceResultDto>.Ok(result.Value));
    }

    [HttpPost("{id:guid}/billing/time")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingCreate)]
    public async Task<ActionResult<ApiResponse<ProjectInvoiceResultDto>>> InvoiceTime(Guid id, [FromBody] InvoiceTimeDto? dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.InvoiceTimeAsync(id, dto ?? new InvoiceTimeDto(), cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<ProjectInvoiceResultDto>.Fail(result.Error.Description));
        return Ok(ApiResponse<ProjectInvoiceResultDto>.Ok(result.Value));
    }

    [HttpPost("{id:guid}/billing/milestone")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingCreate)]
    public async Task<ActionResult<ApiResponse<ProjectInvoiceResultDto>>> InvoiceMilestone(Guid id, [FromBody] InvoiceMilestoneDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.InvoiceMilestoneAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<ProjectInvoiceResultDto>.Fail(result.Error.Description));
        return Ok(ApiResponse<ProjectInvoiceResultDto>.Ok(result.Value));
    }

    [HttpPost("{id:guid}/billing/fixed-price")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingCreate)]
    public async Task<ActionResult<ApiResponse<ProjectInvoiceResultDto>>> InvoiceFixedPrice(Guid id, [FromBody] InvoiceFixedPriceDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.InvoiceFixedPriceAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<ProjectInvoiceResultDto>.Fail(result.Error.Description));
        return Ok(ApiResponse<ProjectInvoiceResultDto>.Ok(result.Value));
    }

    [HttpGet("{id:guid}/situations")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectSituationDto>>>> Situations(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectSituationDto>>.Ok(await _service.ListSituationsAsync(id, cancellationToken)));
    }

    [HttpPost("{id:guid}/situations")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingCreate)]
    public async Task<ActionResult<ApiResponse<Guid>>> CreateSituation(Guid id, [FromBody] UpsertProjectSituationDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.CreateSituationAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value));
    }

    [HttpPut("situations/{situationId:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingCreate)]
    public async Task<IActionResult> UpdateSituation(Guid situationId, [FromBody] UpsertProjectSituationDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.UpdateSituationAsync(situationId, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("situations/{situationId:guid}/validate")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingCreate)]
    public async Task<IActionResult> ValidateSituation(Guid situationId, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.ValidateSituationAsync(situationId, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("{id:guid}/billing/situation")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingCreate)]
    public async Task<ActionResult<ApiResponse<ProjectInvoiceResultDto>>> InvoiceSituation(Guid id, [FromBody] InvoiceSituationDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.InvoiceSituationAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<ProjectInvoiceResultDto>.Fail(result.Error.Description));
        return Ok(ApiResponse<ProjectInvoiceResultDto>.Ok(result.Value));
    }

    [HttpGet("{id:guid}/linked-invoices")]
    [Authorize(Policy = PermissionPolicies.ProjectBillingRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectLinkedInvoiceDto>>>> LinkedInvoices(
        Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var items = await _service.GetLinkedInvoicesAsync(id, cancellationToken);
        if (items is null) return NotFound(ApiResponse<IReadOnlyList<ProjectLinkedInvoiceDto>>.Fail("Projet introuvable"));
        return Ok(ApiResponse<IReadOnlyList<ProjectLinkedInvoiceDto>>.Ok(items));
    }

    [HttpGet("{id:guid}/subcontractors")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectSubcontractorDto>>>> Subcontractors(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectSubcontractorDto>>.Ok(await _service.ListSubcontractorsAsync(id, cancellationToken)));
    }

    [HttpPost("{id:guid}/subcontractors")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<ActionResult<ApiResponse<Guid>>> AddSubcontractor(Guid id, [FromBody] UpsertProjectSubcontractorDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.AddSubcontractorAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value));
    }

    [HttpPut("subcontractors/{subcontractorId:guid}")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<IActionResult> UpdateSubcontractor(Guid subcontractorId, [FromBody] UpsertProjectSubcontractorDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.UpdateSubcontractorAsync(subcontractorId, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("{id:guid}/stock-exit")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<ActionResult<ApiResponse<Guid>>> StockExit(Guid id, [FromBody] RecordProjectStockExitDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.RecordStockExitAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value));
    }

    [HttpGet("{id:guid}/purchase-orders")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectPurchaseOrderDto>>>> ListPurchaseOrders(
        Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectPurchaseOrderDto>>.Ok(
            await _service.ListPurchaseOrdersAsync(id, cancellationToken)));
    }

    [HttpPost("{id:guid}/purchase-orders")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<IActionResult> AssignPo(Guid id, [FromBody] AssignPurchaseOrderDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.AssignPurchaseOrderAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpGet("{id:guid}/profitability")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<ProjectProfitabilityDto>>> Profitability(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var dto = await _service.GetProfitabilityAsync(id, cancellationToken);
        if (dto is null) return NotFound(ApiResponse<ProjectProfitabilityDto>.Fail("Projet introuvable"));
        return Ok(ApiResponse<ProjectProfitabilityDto>.Ok(dto));
    }

    [HttpPost("{id:guid}/link-sales-order")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<IActionResult> LinkSalesOrder(Guid id, [FromBody] LinkProjectSalesOrderDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.LinkSalesOrderAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpGet("{id:guid}/sales-order-lines")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<SalesOrderLineOptionDto>>>> SalesOrderLines(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<SalesOrderLineOptionDto>>.Ok(await _service.ListProjectSalesOrderLinesAsync(id, cancellationToken)));
    }

    [HttpGet("{id:guid}/updates")]
    [Authorize(Policy = PermissionPolicies.ProjectsRead)]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ProjectUpdateDto>>>> ProjectUpdates(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        return Ok(ApiResponse<IReadOnlyList<ProjectUpdateDto>>.Ok(await _service.ListProjectUpdatesAsync(id, cancellationToken)));
    }

    [HttpPost("{id:guid}/updates")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<ActionResult<ApiResponse<Guid>>> CreateProjectUpdate(Guid id, [FromBody] CreateProjectUpdateDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.CreateProjectUpdateAsync(id, dto, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<Guid>.Fail(result.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(result.Value));
    }

    [HttpPost("milestones/{milestoneId:guid}/reached")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<IActionResult> MarkMilestoneReached(Guid milestoneId, [FromQuery] bool reached = true, CancellationToken cancellationToken = default)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.MarkMilestoneReachedAsync(milestoneId, reached, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("{id:guid}/milestones/sync")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<IActionResult> SyncMilestones(Guid id, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var result = await _service.SyncMilestoneProgressAsync(id, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPut("products/{productId:guid}/service-billing-policy")]
    [Authorize(Policy = PermissionPolicies.ProjectsUpdate)]
    public async Task<IActionResult> SetServiceBillingPolicy(Guid productId, [FromBody] ServiceProductBillingPolicyDto dto, CancellationToken cancellationToken)
    {
        if (GuardEnabled() is { } guard) return guard;
        var body = dto with { ProductId = productId };
        var result = await _service.SetProductServiceBillingPolicyAsync(body, cancellationToken);
        if (result.IsFailure) return BadRequest(ApiResponse<bool>.Fail(result.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }
}

public sealed record ProjectCommentBodyDto(string Body, Guid? TaskId);
