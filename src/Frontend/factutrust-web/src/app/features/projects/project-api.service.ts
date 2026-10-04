import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@environments/environment';
import {
  ProjectBillingModeCode,
  ProjectKindCode,
  ProjectMemberRoleCode,
  ProjectStatusCode,
  ProjectTaskPriorityCode,
  ProjectTaskStatusCode,
  ProjectTimeEntryStatusCode
} from './project-enums';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string | null;
  error?: string;
  errors?: string[];
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface ProjectListItem {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  kind: ProjectKindCode | number;
  kindDisplay: string;
  billingMode: ProjectBillingModeCode | number;
  billingModeDisplay: string;
  status: ProjectStatusCode | number;
  statusDisplay: string;
  startDate?: string | null;
  endDate?: string | null;
  budgetHt: number;
  openTaskCount: number;
  overdueTaskCount: number;
  ownerUserName?: string | null;
  progressPercent: number;
  completedTaskCount: number;
  totalTaskCount: number;
  timesheetsEnabled: boolean;
}

export interface ProjectPhase {
  id: string;
  name: string;
  sortOrder: number;
  color?: string | null;
}

export interface ProjectDetail {
  id: string;
  name: string;
  description?: string | null;
  clientId: string;
  clientName: string;
  kind: ProjectKindCode | number;
  kindDisplay: string;
  billingMode: ProjectBillingModeCode | number;
  billingModeDisplay: string;
  status: ProjectStatusCode | number;
  statusDisplay: string;
  startDate?: string | null;
  endDate?: string | null;
  budgetHt: number;
  currency: string;
  ownerUserId?: string | null;
  ownerUserName?: string | null;
  siteAddress?: string | null;
  contractNumber?: string | null;
  timesheetsEnabled: boolean;
  milestonesEnabled: boolean;
  allocatedHours: number;
  analyticAccountCode?: string | null;
  phases: ProjectPhase[];
}

export interface ProjectTask {
  id: string;
  projectId: string;
  phaseId: string;
  phaseName: string;
  parentTaskId?: string | null;
  title: string;
  description?: string | null;
  status: ProjectTaskStatusCode | number;
  statusDisplay: string;
  priority: ProjectTaskPriorityCode | number;
  priorityDisplay: string;
  dueDate?: string | null;
  progressPercent: number;
  assigneeUserId?: string | null;
  assigneeUserName?: string | null;
  estimatedHours: number;
  loggedHours: number;
  isOverdue: boolean;
}

export interface ProjectTimeEntry {
  id: string;
  projectId: string;
  projectName: string;
  taskId?: string | null;
  taskTitle?: string | null;
  userId: string;
  userName: string;
  workDate: string;
  hours: number;
  isBillable: boolean;
  notes?: string | null;
  status: ProjectTimeEntryStatusCode | number;
  statusDisplay: string;
  invoicedInvoiceId?: string | null;
}

export interface ProjectBudget {
  budgetHt: number;
  actualCostHt: number;
  timeCostHt: number;
  remainingHt: number;
  loggedHours: number;
  billableUninvoicedHours: number;
}

export interface ProjectMember {
  id: string;
  userId: string;
  userName: string;
  role: ProjectMemberRoleCode | number;
  roleDisplay: string;
  salesRate?: number | null;
  hourlyCost?: number | null;
  weeklyCapacityHours: number;
}

export interface ProjectComment {
  id: string;
  taskId?: string | null;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface ProjectAttachment {
  id: string;
  taskId?: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ProjectActivity {
  id: string;
  taskId?: string | null;
  actorUserId?: string | null;
  type: string;
  message: string;
  createdAt: string;
}

export interface ProjectCostLine {
  id: string;
  source: number | string;
  sourceDisplay: string;
  description: string;
  amountHt: number;
  occurredOn: string;
}

export interface ProjectPurchaseOrder {
  id: string;
  number: string;
  supplierName: string;
  orderDate: string;
  status: number;
  statusDisplay: string;
  statusCss: string;
  totalHt: number;
}

export interface ProjectMilestone {
  id: string;
  name: string;
  percent: number;
  amountHt: number;
  dueDate?: string | null;
  invoicedInvoiceId?: string | null;
}

export interface ProjectSituation {
  id: string;
  number: number;
  periodStart: string;
  periodEnd: string;
  cumulativePercent: number;
  grossAmountHt: number;
  retainageAmountHt: number;
  netAmountHt: number;
  vatRatePercent: number;
  vatAmount: number;
  totalTtc: number;
  status: number | string;
  statusDisplay: string;
  invoiceId?: string | null;
}

export interface ProjectSubcontractor {
  id: string;
  supplierId: string;
  supplierName: string;
  contractReference?: string | null;
  amountHt: number;
  retainagePercent: number;
}

export interface ProjectWorkloadRow {
  userId: string;
  userName: string;
  weeklyCapacityHours: number;
  estimatedHours: number;
  loggedHours: number;
}

export interface ProjectAssignableUser {
  id: string;
  displayName: string;
}

export interface ProjectDashboard {
  activeProjects: number;
  openTasks: number;
  overdueTasks: number;
  uninvoicedBillableHours: number;
}

export interface ProjectStatusBreakdown {
  status: ProjectStatusCode | number;
  statusDisplay: string;
  count: number;
  percent: number;
}

export interface ProjectTaskTrendPoint {
  date: string;
  created: number;
  completed: number;
  pending: number;
  overdue: number;
}

export interface ProjectRecentRow {
  id: string;
  name: string;
  description?: string | null;
  kind: ProjectKindCode | number;
  kindDisplay: string;
  clientName: string;
  ownerUserName?: string | null;
  progressPercent: number;
  status: ProjectStatusCode | number;
  statusDisplay: string;
  endDate?: string | null;
}

export interface ProjectUpcomingTaskRow {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  dueDate?: string | null;
  assigneeUserName?: string | null;
  priority: ProjectTaskPriorityCode | number;
  priorityDisplay: string;
  isOverdue: boolean;
}

export interface ProjectActiveMemberRow {
  userId: string;
  displayName: string;
  roleDisplay?: string | null;
  lastActivityAt?: string | null;
  activityStatus: 'online' | 'away' | 'offline' | string;
}

export interface ProjectDashboardKpiTrends {
  activeProjectsChangePercent?: number | null;
  openTasksChangePercent?: number | null;
  completedTasksChangePercent?: number | null;
  overdueTasksChangePercent?: number | null;
  uninvoicedBillableHoursChangePercent?: number | null;
  averageProgressChangePercent?: number | null;
}

export interface ProjectPerformanceMiniStat {
  label: string;
  changePercent: number;
  isPositive: boolean;
}

export interface ProjectPerformanceSummary {
  title: string;
  stats: ProjectPerformanceMiniStat[];
}

export interface ProjectDashboardExtended extends ProjectDashboard {
  completedTasks: number;
  totalProjects: number;
  averageProgressPercent: number;
  progressTargetPercent: number;
  kpiTrends?: ProjectDashboardKpiTrends | null;
  performanceSummary?: ProjectPerformanceSummary | null;
  projectStatusBreakdown: ProjectStatusBreakdown[];
  taskTrend: ProjectTaskTrendPoint[];
  recentProjects: ProjectRecentRow[];
  upcomingTasks: ProjectUpcomingTaskRow[];
  activeMembers: ProjectActiveMemberRow[];
}

export type ProjectSearchResultKind = 'Project' | 'Task' | 'Attachment';

export interface ProjectSearchResult {
  kind: ProjectSearchResultKind | number;
  id: string;
  projectId: string;
  title: string;
  subtitle?: string | null;
  statusDisplay?: string | null;
  score: number;
}

export interface ProjectSearchResponse {
  query: string;
  results: ProjectSearchResult[];
}

export interface ProjectBillingReadiness {
  canBill: boolean;
  canInvoiceTime: boolean;
  canReceiveTime: boolean;
  status: ProjectStatusCode | number;
  statusDisplay: string;
  validatedUninvoicedHours: number;
  membersWithoutRate: string[];
  blockers: string[];
}

export interface BillableProjectTask {
  id: string;
  title: string;
  uninvoicedBillableHours: number;
  hourlyRate: number;
  previewAmountHt: number;
  isEligible: boolean;
  blockReason?: string | null;
}

export interface BillableProjectTimeEntry {
  id: string;
  userId: string;
  userName: string;
  workDate: string;
  taskId?: string | null;
  taskTitle?: string | null;
  hours: number;
  hourlyRate: number;
  previewAmountHt: number;
  isEligible: boolean;
  blockReason?: string | null;
}

export interface ProjectDraftInvoice {
  invoiceId: string;
  number: string;
  issueDate: string;
  amountHT: number;
  lineCount: number;
}

export interface ProjectLinkedInvoice {
  invoiceId: string;
  number: string;
  issueDate: string;
  clientName: string;
  amountHT: number;
  amountVat: number;
  amountTTC: number;
  currency: string;
  status: string;
  statusDisplay: string;
  isCreditNote: boolean;
  createdAt: string;
  billingKind?: string | null;
}

export interface UpsertProjectPayload {
  clientId: string;
  name: string;
  description?: string | null;
  kind: ProjectKindCode | number;
  billingMode: ProjectBillingModeCode | number;
  startDate?: string | null;
  endDate?: string | null;
  budgetHt: number;
  ownerUserId?: string | null;
  siteAddress?: string | null;
  contractNumber?: string | null;
  timesheetsEnabled: boolean;
  milestonesEnabled: boolean;
  allocatedHours: number;
  analyticAccountCode?: string | null;
}

export interface ProjectSettingsPayload {
  billingMode: ProjectBillingModeCode | number;
  timesheetsEnabled: boolean;
  milestonesEnabled: boolean;
  allocatedHours: number;
}

export interface UpsertTaskPayload {
  phaseId: string;
  parentTaskId?: string | null;
  title: string;
  description?: string | null;
  priority: ProjectTaskPriorityCode | number;
  status?: ProjectTaskStatusCode | number;
  dueDate?: string | null;
  assigneeUserId?: string | null;
  estimatedHours: number;
  progressPercent: number;
}

export interface UpsertMemberPayload {
  userId: string;
  role: ProjectMemberRoleCode | number;
  salesRate?: number | null;
  hourlyCost?: number | null;
  weeklyCapacityHours: number;
}

@Injectable({ providedIn: 'root' })
export class ProjectApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/projects`;

  list(params: {
    search?: string;
    status?: string | number;
    kind?: string | number;
    clientId?: string;
    ownerUserId?: string;
    billingMode?: string | number;
    overdueOnly?: boolean;
    endDateFrom?: string;
    endDateTo?: string;
    page?: number;
    pageSize?: number;
  }): Observable<ApiResponse<PagedResult<ProjectListItem>>> {
    let p = new HttpParams()
      .set('page', String(params.page ?? 1))
      .set('pageSize', String(params.pageSize ?? 20));
    if (params.search) p = p.set('search', params.search);
    if (params.status !== undefined && params.status !== null && params.status !== '') {
      p = p.set('status', String(params.status));
    }
    if (params.kind !== undefined && params.kind !== null && params.kind !== '') {
      p = p.set('kind', String(params.kind));
    }
    if (params.clientId) p = p.set('clientId', params.clientId);
    if (params.ownerUserId) p = p.set('ownerUserId', params.ownerUserId);
    if (params.billingMode !== undefined && params.billingMode !== null && params.billingMode !== '') {
      p = p.set('billingMode', String(params.billingMode));
    }
    if (params.overdueOnly) p = p.set('overdueOnly', 'true');
    if (params.endDateFrom) p = p.set('endDateFrom', params.endDateFrom);
    if (params.endDateTo) p = p.set('endDateTo', params.endDateTo);
    return this.http.get<ApiResponse<PagedResult<ProjectListItem>>>(this.base, { params: p });
  }

  exportCsv(params: {
    search?: string;
    status?: string | number;
    kind?: string | number;
    clientId?: string;
    ownerUserId?: string;
    billingMode?: string | number;
    overdueOnly?: boolean;
    endDateFrom?: string;
    endDateTo?: string;
  }): Observable<Blob> {
    let p = new HttpParams();
    if (params.search) p = p.set('search', params.search);
    if (params.status !== undefined && params.status !== null && params.status !== '') {
      p = p.set('status', String(params.status));
    }
    if (params.kind !== undefined && params.kind !== null && params.kind !== '') {
      p = p.set('kind', String(params.kind));
    }
    if (params.clientId) p = p.set('clientId', params.clientId);
    if (params.ownerUserId) p = p.set('ownerUserId', params.ownerUserId);
    if (params.billingMode !== undefined && params.billingMode !== null && params.billingMode !== '') {
      p = p.set('billingMode', String(params.billingMode));
    }
    if (params.overdueOnly) p = p.set('overdueOnly', 'true');
    if (params.endDateFrom) p = p.set('endDateFrom', params.endDateFrom);
    if (params.endDateTo) p = p.set('endDateTo', params.endDateTo);
    return this.http.get(`${this.base}/export`, { params: p, responseType: 'blob' });
  }

  dashboard(): Observable<ApiResponse<ProjectDashboard>> {
    return this.http.get<ApiResponse<ProjectDashboard>>(`${this.base}/dashboard`);
  }

  dashboardExtended(period?: 'week' | 'month'): Observable<ApiResponse<ProjectDashboardExtended>> {
    let p = new HttpParams();
    if (period) p = p.set('period', period);
    return this.http.get<ApiResponse<ProjectDashboardExtended>>(`${this.base}/dashboard/extended`, { params: p });
  }

  search(query: string, limit = 8): Observable<ApiResponse<ProjectSearchResponse>> {
    let p = new HttpParams().set('q', query).set('limit', String(limit));
    return this.http.get<ApiResponse<ProjectSearchResponse>>(`${this.base}/search`, { params: p });
  }

  users(): Observable<ApiResponse<ProjectAssignableUser[]>> {
    return this.http.get<ApiResponse<ProjectAssignableUser[]>>(`${this.base}/users`);
  }

  get(id: string): Observable<ApiResponse<ProjectDetail>> {
    return this.http.get<ApiResponse<ProjectDetail>>(`${this.base}/${id}`);
  }

  create(payload: UpsertProjectPayload): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(this.base, payload);
  }

  update(id: string, payload: UpsertProjectPayload): Observable<ApiResponse<boolean>> {
    return this.http.put<ApiResponse<boolean>>(`${this.base}/${id}`, payload);
  }

  activate(id: string): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(`${this.base}/${id}/activate`, {});
  }

  hold(id: string): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(`${this.base}/${id}/hold`, {});
  }

  complete(id: string): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(`${this.base}/${id}/complete`, {});
  }

  cancel(id: string): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(`${this.base}/${id}/cancel`, {});
  }

  tasks(projectId: string): Observable<ApiResponse<ProjectTask[]>> {
    return this.http.get<ApiResponse<ProjectTask[]>>(`${this.base}/${projectId}/tasks`);
  }

  getTask(taskId: string): Observable<ApiResponse<ProjectTask>> {
    return this.http.get<ApiResponse<ProjectTask>>(`${this.base}/tasks/${taskId}`);
  }

  createTask(projectId: string, payload: UpsertTaskPayload): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.base}/${projectId}/tasks`, payload);
  }

  updateTask(taskId: string, payload: UpsertTaskPayload): Observable<ApiResponse<boolean>> {
    return this.http.put<ApiResponse<boolean>>(`${this.base}/tasks/${taskId}`, payload);
  }

  deleteTask(taskId: string): Observable<ApiResponse<boolean>> {
    return this.http.delete<ApiResponse<boolean>>(`${this.base}/tasks/${taskId}`);
  }

  moveTask(taskId: string, phaseId: string, status?: ProjectTaskStatusCode | number): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(`${this.base}/tasks/${taskId}/move`, { phaseId, status });
  }

  comments(projectId: string, taskId?: string): Observable<ApiResponse<ProjectComment[]>> {
    let p = new HttpParams();
    if (taskId) p = p.set('taskId', taskId);
    return this.http.get<ApiResponse<ProjectComment[]>>(`${this.base}/${projectId}/comments`, { params: p });
  }

  addComment(projectId: string, body: string, taskId?: string): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.base}/${projectId}/comments`, { body, taskId });
  }

  attachments(projectId: string): Observable<ApiResponse<ProjectAttachment[]>> {
    return this.http.get<ApiResponse<ProjectAttachment[]>>(`${this.base}/${projectId}/attachments`);
  }

  addAttachment(projectId: string, payload: { fileName: string; contentType: string; sizeBytes: number; taskId?: string }): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.base}/${projectId}/attachments`, payload);
  }

  uploadAttachment(projectId: string, file: File, taskId?: string): Observable<ApiResponse<string>> {
    const fd = new FormData();
    fd.append('file', file);
    if (taskId) fd.append('taskId', taskId);
    return this.http.post<ApiResponse<string>>(`${this.base}/${projectId}/attachments/upload`, fd);
  }

  downloadAttachment(projectId: string, attachmentId: string): Observable<Blob> {
    return this.http.get(`${this.base}/${projectId}/attachments/${attachmentId}/download`, { responseType: 'blob' });
  }

  deleteAttachment(projectId: string, attachmentId: string): Observable<ApiResponse<boolean>> {
    return this.http.delete<ApiResponse<boolean>>(`${this.base}/${projectId}/attachments/${attachmentId}`);
  }

  members(projectId: string): Observable<ApiResponse<ProjectMember[]>> {
    return this.http.get<ApiResponse<ProjectMember[]>>(`${this.base}/${projectId}/members`);
  }

  addMember(projectId: string, payload: UpsertMemberPayload): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.base}/${projectId}/members`, payload);
  }

  updateMember(memberId: string, payload: UpsertMemberPayload): Observable<ApiResponse<boolean>> {
    return this.http.put<ApiResponse<boolean>>(`${this.base}/members/${memberId}`, payload);
  }

  removeMember(memberId: string): Observable<ApiResponse<boolean>> {
    return this.http.delete<ApiResponse<boolean>>(`${this.base}/members/${memberId}`);
  }

  activity(projectId: string): Observable<ApiResponse<ProjectActivity[]>> {
    return this.http.get<ApiResponse<ProjectActivity[]>>(`${this.base}/${projectId}/activity`);
  }

  time(params: {
    projectId?: string;
    from?: string;
    to?: string;
    status?: string | number;
  }): Observable<ApiResponse<ProjectTimeEntry[]>> {
    let p = new HttpParams();
    if (params.projectId) p = p.set('projectId', params.projectId);
    if (params.from) p = p.set('from', params.from);
    if (params.to) p = p.set('to', params.to);
    if (params.status !== undefined) p = p.set('status', String(params.status));
    return this.http.get<ApiResponse<ProjectTimeEntry[]>>(`${this.base}/time`, { params: p });
  }

  createTime(payload: {
    projectId: string;
    taskId?: string | null;
    workDate: string;
    hours: number;
    isBillable: boolean;
    notes?: string;
  }): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.base}/time`, payload);
  }

  submitTime(id: string): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(`${this.base}/time/${id}/submit`, {});
  }

  validateTime(id: string): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(`${this.base}/time/${id}/validate`, {});
  }

  updateTime(id: string, payload: {
    projectId: string;
    taskId?: string | null;
    workDate: string;
    hours: number;
    isBillable: boolean;
    notes?: string;
  }): Observable<ApiResponse<boolean>> {
    return this.http.put<ApiResponse<boolean>>(`${this.base}/time/${id}`, payload);
  }

  deleteTime(id: string): Observable<ApiResponse<boolean>> {
    return this.http.delete<ApiResponse<boolean>>(`${this.base}/time/${id}`);
  }

  reopenTime(id: string): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(`${this.base}/time/${id}/reopen`, {});
  }

  costs(projectId: string): Observable<ApiResponse<ProjectCostLine[]>> {
    return this.http.get<ApiResponse<ProjectCostLine[]>>(`${this.base}/${projectId}/costs`);
  }

  addCost(projectId: string, payload: unknown): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.base}/${projectId}/costs`, payload);
  }

  budget(projectId: string): Observable<ApiResponse<ProjectBudget>> {
    return this.http.get<ApiResponse<ProjectBudget>>(`${this.base}/${projectId}/budget`);
  }

  milestones(projectId: string): Observable<ApiResponse<ProjectMilestone[]>> {
    return this.http.get<ApiResponse<ProjectMilestone[]>>(`${this.base}/${projectId}/milestones`);
  }

  addMilestone(projectId: string, payload: unknown): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.base}/${projectId}/milestones`, payload);
  }

  updateMilestone(milestoneId: string, payload: unknown): Observable<ApiResponse<boolean>> {
    return this.http.put<ApiResponse<boolean>>(`${this.base}/milestones/${milestoneId}`, payload);
  }

  workload(projectId: string): Observable<ApiResponse<ProjectWorkloadRow[]>> {
    return this.http.get<ApiResponse<ProjectWorkloadRow[]>>(`${this.base}/${projectId}/workload`);
  }

  billingReadiness(projectId: string): Observable<ApiResponse<ProjectBillingReadiness>> {
    return this.http.get<ApiResponse<ProjectBillingReadiness>>(`${this.base}/${projectId}/billing/readiness`);
  }

  billableTasks(projectId: string, method: 'fixed' | 'hourly'): Observable<ApiResponse<BillableProjectTask[]>> {
    return this.http.get<ApiResponse<BillableProjectTask[]>>(`${this.base}/${projectId}/billing/billable-tasks`, { params: { method } });
  }

  billableTimeEntries(projectId: string): Observable<ApiResponse<BillableProjectTimeEntry[]>> {
    return this.http.get<ApiResponse<BillableProjectTimeEntry[]>>(`${this.base}/${projectId}/billing/billable-time-entries`);
  }

  compatibleDraftInvoices(projectId: string): Observable<ApiResponse<ProjectDraftInvoice[]>> {
    return this.http.get<ApiResponse<ProjectDraftInvoice[]>>(`${this.base}/${projectId}/billing/draft-invoices`);
  }

  invoiceTime(
    projectId: string,
    timeEntryIds: string[],
    notes?: string,
    targetInvoiceId?: string
  ): Observable<ApiResponse<{ invoiceId: string; billingId: string }>> {
    return this.http.post<ApiResponse<{ invoiceId: string; billingId: string }>>(
      `${this.base}/${projectId}/billing/time`,
      // targetInvoiceId seulement s'il est renseigné : la forme du payload reste stable.
      { groupBy: 'member', notes, timeEntryIds, ...(targetInvoiceId ? { targetInvoiceId } : {}) }
    );
  }

  invoiceTasks(
    projectId: string,
    method: 'fixed' | 'hourly',
    tasks: { taskId: string; amountHt?: number; hourlyRate?: number }[],
    notes?: string,
    targetInvoiceId?: string
  ): Observable<ApiResponse<{ invoiceId: string; billingId: string }>> {
    return this.http.post<ApiResponse<{ invoiceId: string; billingId: string }>>(
      `${this.base}/${projectId}/billing/tasks`,
      { method, notes, tasks, ...(targetInvoiceId ? { targetInvoiceId } : {}) }
    );
  }

  invoiceMilestone(projectId: string, milestoneId: string, notes?: string): Observable<ApiResponse<{ invoiceId: string; billingId: string }>> {
    return this.http.post<ApiResponse<{ invoiceId: string; billingId: string }>>(`${this.base}/${projectId}/billing/milestone`, { milestoneId, notes });
  }

  invoiceFixedPrice(projectId: string, amountHt: number, notes?: string): Observable<ApiResponse<{ invoiceId: string; billingId: string }>> {
    return this.http.post<ApiResponse<{ invoiceId: string; billingId: string }>>(`${this.base}/${projectId}/billing/fixed-price`, { amountHt, notes });
  }

  situations(projectId: string): Observable<ApiResponse<ProjectSituation[]>> {
    return this.http.get<ApiResponse<ProjectSituation[]>>(`${this.base}/${projectId}/situations`);
  }

  createSituation(projectId: string, payload: unknown): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.base}/${projectId}/situations`, payload);
  }

  updateSituation(situationId: string, payload: unknown): Observable<ApiResponse<boolean>> {
    return this.http.put<ApiResponse<boolean>>(`${this.base}/situations/${situationId}`, payload);
  }

  validateSituation(situationId: string): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(`${this.base}/situations/${situationId}/validate`, {});
  }

  invoiceSituation(projectId: string, situationId: string): Observable<ApiResponse<{ invoiceId: string; billingId: string }>> {
    return this.http.post<ApiResponse<{ invoiceId: string; billingId: string }>>(`${this.base}/${projectId}/billing/situation`, { situationId });
  }

  linkedInvoices(projectId: string): Observable<ApiResponse<ProjectLinkedInvoice[]>> {
    return this.http.get<ApiResponse<ProjectLinkedInvoice[]>>(`${this.base}/${projectId}/linked-invoices`);
  }

  subcontractors(projectId: string): Observable<ApiResponse<ProjectSubcontractor[]>> {
    return this.http.get<ApiResponse<ProjectSubcontractor[]>>(`${this.base}/${projectId}/subcontractors`);
  }

  addSubcontractor(projectId: string, payload: unknown): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.base}/${projectId}/subcontractors`, payload);
  }

  updateSubcontractor(subcontractorId: string, payload: unknown): Observable<ApiResponse<boolean>> {
    return this.http.put<ApiResponse<boolean>>(`${this.base}/subcontractors/${subcontractorId}`, payload);
  }

  stockExit(projectId: string, payload: unknown): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.base}/${projectId}/stock-exit`, payload);
  }

  assignPurchaseOrder(projectId: string, purchaseOrderId: string): Observable<ApiResponse<boolean>> {
    return this.http.post<ApiResponse<boolean>>(`${this.base}/${projectId}/purchase-orders`, { purchaseOrderId });
  }

  listPurchaseOrders(projectId: string): Observable<ApiResponse<ProjectPurchaseOrder[]>> {
    return this.http.get<ApiResponse<ProjectPurchaseOrder[]>>(`${this.base}/${projectId}/purchase-orders`);
  }
}
