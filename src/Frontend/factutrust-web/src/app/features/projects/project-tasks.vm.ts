import { erpCollatorCompare } from '@core/i18n/erp-format';
import { ProjectTask } from './project-api.service';
import { computeTaskStatusBreakdown, isTaskCancelled } from './project-detail.vm';
import {
  daysUntilDue,
  parseProjectTaskPriority,
  parseProjectTaskStatus,
  ProjectTaskPriorityCode,
  ProjectTaskStatusCode
} from './project-enums';

export type TaskSortKey = 'dueAsc' | 'dueDesc' | 'priority' | 'title' | 'progress';
export type TaskDueFilterKey = 'overdue' | 'today' | 'week' | 'month' | 'none';

export interface TaskListFilters {
  searchText: string;
  status: ProjectTaskStatusCode | null;
  assigneeId: string | null;
  priority: ProjectTaskPriorityCode | string | null;
  dueFilter: TaskDueFilterKey | null;
}

export interface RootTaskStatusSummary {
  total: number;
  todo: number;
  todoPct: number;
  done: number;
  donePct: number;
  inProgress: number;
  inProgressPct: number;
  waiting: number;
  waitingPct: number;
  overdue: number;
  overduePct: number;
}

export const TASK_VIEW_STORAGE_KEY = 'ft.project-tasks.view';

export const TASK_DUE_FILTER_OPTIONS: { label: string; value: TaskDueFilterKey }[] = [
  { label: $localize`:@@projects.project-tasks.ts.en.retard.40c1dde3:En retard`, value: 'overdue' },
  { label: $localize`:@@projects.project-tasks.ts.aujourd.hui.baca97f6:Aujourd'hui`, value: 'today' },
  { label: $localize`:@@projects.project-tasks.ts.cette.semaine.af7dc0a9:Cette semaine`, value: 'week' },
  { label: $localize`:@@projects.project-tasks.ts.ce.mois.db74c560:Ce mois`, value: 'month' },
  { label: $localize`:@@projects.project-tasks.ts.sans.echeance.4a0d4bf9:Sans échéance`, value: 'none' }
];

export const TASK_SORT_OPTIONS: { label: string; value: TaskSortKey }[] = [
  { label: $localize`:@@projects.project-tasks.ts.echeance.croissant.5f934944:Échéance (croissant)`, value: 'dueAsc' },
  { label: $localize`:@@projects.project-tasks.ts.echeance.decroissant.44a032fe:Échéance (décroissant)`, value: 'dueDesc' },
  { label: $localize`:@@projects.project-tasks.ts.priorite.eede91d2:Priorité`, value: 'priority' },
  { label: $localize`:@@projects.project-tasks.ts.titre.eb97899a:Titre`, value: 'title' },
  { label: $localize`:@@projects.project-tasks.ts.avancement.e1963fc4:Avancement`, value: 'progress' }
];

const PRIORITY_RANK: Record<ProjectTaskPriorityCode, number> = {
  Urgent: 4,
  High: 3,
  Normal: 2,
  Low: 1
};

export function emptyTaskFilters(): TaskListFilters {
  return {
    searchText: '',
    status: null,
    assigneeId: null,
    priority: null,
    dueFilter: null
  };
}

export function rootTasksOnly(tasks: ProjectTask[]): ProjectTask[] {
  return tasks.filter(t => !t.parentTaskId);
}

export function matchesTaskStatus(task: ProjectTask, filterStatus: ProjectTaskStatusCode): boolean {
  if (String(task.status) === filterStatus || task.status === filterStatus) return true;
  return parseProjectTaskStatus(task.status) === filterStatus;
}

export function matchesTaskPriority(task: ProjectTask, filterPriority: ProjectTaskPriorityCode | string): boolean {
  return String(task.priority) === filterPriority || task.priority === filterPriority;
}

export function matchesDueFilter(task: ProjectTask, dueFilter: TaskDueFilterKey): boolean {
  switch (dueFilter) {
    case 'overdue':
      return task.isOverdue;
    case 'none':
      return !task.dueDate;
    case 'today':
      return daysUntilDue(task.dueDate) === 0;
    case 'week': {
      const days = daysUntilDue(task.dueDate);
      return days !== null && days >= 0 && days <= 7;
    }
    case 'month': {
      const days = daysUntilDue(task.dueDate);
      return days !== null && days >= 0 && days <= 30;
    }
    default:
      return true;
  }
}

export function filterRootTasks(tasks: ProjectTask[], filters: TaskListFilters): ProjectTask[] {
  let list = rootTasksOnly(tasks);
  const q = filters.searchText.trim().toLowerCase();
  if (q) {
    list = list.filter(
      t =>
        t.title.toLowerCase().includes(q) ||
        (t.phaseName?.toLowerCase().includes(q) ?? false)
    );
  }
  if (filters.status) {
    list = list.filter(t => matchesTaskStatus(t, filters.status!));
  }
  if (filters.assigneeId) {
    list = list.filter(t => t.assigneeUserId === filters.assigneeId);
  }
  if (filters.priority) {
    list = list.filter(t => matchesTaskPriority(t, filters.priority!));
  }
  if (filters.dueFilter) {
    list = list.filter(t => matchesDueFilter(t, filters.dueFilter!));
  }
  return list;
}

function priorityRank(task: ProjectTask): number {
  const p = parseProjectTaskPriority(task.priority);
  return p ? PRIORITY_RANK[p] : 0;
}

function dueSortKey(task: ProjectTask, missingLast: boolean): number {
  if (!task.dueDate) return missingLast ? Number.MAX_SAFE_INTEGER : -1;
  const t = new Date(task.dueDate.slice(0, 10)).getTime();
  return Number.isNaN(t) ? (missingLast ? Number.MAX_SAFE_INTEGER : -1) : t;
}

export function sortRootTasks(tasks: ProjectTask[], sortKey: TaskSortKey): ProjectTask[] {
  const list = tasks.slice();
  switch (sortKey) {
    case 'dueAsc':
      return list.sort((a, b) => dueSortKey(a, true) - dueSortKey(b, true));
    case 'dueDesc':
      return list.sort((a, b) => dueSortKey(b, false) - dueSortKey(a, false));
    case 'priority':
      return list.sort((a, b) => priorityRank(b) - priorityRank(a) || erpCollatorCompare(a.title, b.title));
    case 'title':
      return list.sort((a, b) => erpCollatorCompare(a.title, b.title));
    case 'progress':
      return list.sort((a, b) => b.progressPercent - a.progressPercent || erpCollatorCompare(a.title, b.title));
    default:
      return list;
  }
}

export function filterAndSortRootTasks(
  tasks: ProjectTask[],
  filters: TaskListFilters,
  sortKey: TaskSortKey = 'dueAsc'
): ProjectTask[] {
  return sortRootTasks(filterRootTasks(tasks, filters), sortKey);
}

export function activeFilterCount(filters: TaskListFilters): number {
  let count = 0;
  if (filters.searchText.trim()) count++;
  if (filters.status) count++;
  if (filters.assigneeId) count++;
  if (filters.priority) count++;
  if (filters.dueFilter) count++;
  return count;
}

export function computeRootTaskStatusSummary(tasks: ProjectTask[]): RootTaskStatusSummary {
  const roots = rootTasksOnly(tasks).filter(t => !isTaskCancelled(t.status));
  const breakdown = computeTaskStatusBreakdown(roots);
  const pct = (n: number) => (breakdown.total ? Math.round((n / breakdown.total) * 100) : 0);
  return {
    total: breakdown.total,
    todo: breakdown.todo,
    todoPct: pct(breakdown.todo),
    done: breakdown.done,
    donePct: pct(breakdown.done),
    inProgress: breakdown.inProgress,
    inProgressPct: pct(breakdown.inProgress),
    waiting: breakdown.waiting,
    waitingPct: pct(breakdown.waiting),
    overdue: breakdown.overdue,
    overduePct: pct(breakdown.overdue)
  };
}

export function taskStatusPillClass(status: unknown): string {
  switch (parseProjectTaskStatus(status)) {
    case 'InProgress':
      return 'proj-task-pill--progress';
    case 'Waiting':
      return 'proj-task-pill--waiting';
    case 'Done':
      return 'proj-task-pill--done';
    case 'Cancelled':
      return 'proj-task-pill--cancelled';
    default:
      return 'proj-task-pill--todo';
  }
}

export function taskPriorityDotClass(priority: unknown): string {
  const p = parseProjectTaskPriority(priority);
  switch (p) {
    case 'Urgent':
      return 'proj-pri-dot--urgent';
    case 'High':
      return 'proj-pri-dot--high';
    case 'Low':
      return 'proj-pri-dot--low';
    default:
      return 'proj-pri-dot--normal';
  }
}

export function hasAnyRootTasks(tasks: ProjectTask[]): boolean {
  return rootTasksOnly(tasks).some(t => !isTaskCancelled(t.status));
}
