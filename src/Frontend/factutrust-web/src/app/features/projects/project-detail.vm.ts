import {
  ProjectActivity,
  ProjectAssignableUser,
  ProjectBudget,
  ProjectDetail,
  ProjectMember,
  ProjectTask
} from './project-api.service';
import {
  computeProjectProgressPercent,
  daysUntilDue,
  formatDaysUntilDue,
  parseProjectTaskStatus
} from './project-enums';

export type ProjectHealthTone = 'good' | 'warning' | 'danger';

export interface ProjectHealthLabel {
  text: string;
  tone: ProjectHealthTone;
}

export interface TaskStatusBreakdown {
  done: number;
  inProgress: number;
  waiting: number;
  overdue: number;
  todo: number;
  total: number;
}

export type BudgetDonutSeriesKey = 'actual' | 'time' | 'remaining';

export interface BudgetDonutSlice {
  key: BudgetDonutSeriesKey;
  label: string;
  value: number;
  color: string;
}

export interface ActivityVisual {
  icon: string;
  color: string;
}

const TASK_DONE = new Set(['Done', 3]);
const TASK_CANCELLED = new Set(['Cancelled', 4]);

export function isTaskDone(status: unknown): boolean {
  if (typeof status === 'string') return status === 'Done';
  return status === 3;
}

export function isTaskCancelled(status: unknown): boolean {
  if (typeof status === 'string') return status === 'Cancelled';
  return status === 4;
}

export function isTaskOpen(status: unknown): boolean {
  return !isTaskDone(status) && !isTaskCancelled(status);
}

export function countOpenTasks(tasks: ProjectTask[]): number {
  return tasks.filter(t => isTaskOpen(t.status)).length;
}

export function countOverdueTasks(tasks: ProjectTask[]): number {
  return tasks.filter(t => t.isOverdue).length;
}

export function countCompletedTasks(tasks: ProjectTask[]): number {
  return tasks.filter(t => isTaskDone(t.status)).length;
}

export function countTotalTasksForProgress(tasks: ProjectTask[]): number {
  return tasks.filter(t => !isTaskCancelled(t.status)).length;
}

export function computeTaskProgressPercent(tasks: ProjectTask[]): number {
  const total = countTotalTasksForProgress(tasks);
  if (total <= 0) return 0;
  return computeProjectProgressPercent(countCompletedTasks(tasks), total);
}

export function budgetUsedPercent(budget: ProjectBudget | null, fallbackBudgetHt = 0): number {
  const budgetHt = budget?.budgetHt ?? fallbackBudgetHt;
  if (budgetHt <= 0) return 0;
  const actual = budget?.actualCostHt ?? 0;
  return Math.min(100, Math.round((actual / budgetHt) * 100));
}

export function computeBillableHoursDenominator(tasks: ProjectTask[], loggedHoursFallback = 0): number {
  const estimated = tasks
    .filter(t => !isTaskCancelled(t.status))
    .reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0);
  if (estimated > 0) return estimated;
  return loggedHoursFallback;
}

export function formatPeriodSubtext(endDate: string | null | undefined): string | null {
  const days = daysUntilDue(endDate);
  if (days === null) return null;
  if (days === 0) return "Échéance aujourd'hui";
  if (days > 0) return `${days} jour${days > 1 ? 's' : ''} restant${days > 1 ? 's' : ''}`;
  const late = Math.abs(days);
  return `${late} jour${late > 1 ? 's' : ''} de retard`;
}

function elapsedSchedulePercent(startDate: string | null | undefined, endDate: string | null | undefined): number | null {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate.slice(0, 10));
  const end = new Date(endDate.slice(0, 10));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const span = end.getTime() - start.getTime();
  if (span <= 0) return null;
  const elapsed = today.getTime() - start.getTime();
  return Math.min(100, Math.max(0, Math.round((elapsed / span) * 100)));
}

export function computeProjectHealth(
  tasks: ProjectTask[],
  project: Pick<ProjectDetail, 'startDate' | 'endDate'> | null
): ProjectHealthLabel {
  const overdue = countOverdueTasks(tasks);
  if (overdue > 0) {
    return { text: $localize`:@@projects.project-detail.ts.en.retard.40c1dde3:En retard`, tone: 'danger' };
  }

  const progress = computeTaskProgressPercent(tasks);
  const schedule = elapsedSchedulePercent(project?.startDate, project?.endDate);

  if (schedule === null || progress >= schedule) {
    return { text: $localize`:@@projects.project-detail.ts.en.bonne.voie.3425f307:En bonne voie`, tone: 'good' };
  }

  const gap = schedule - progress;
  if (gap >= 15) {
    return { text: $localize`:@@projects.project-detail.ts.attention.74e0b9c8:Attention`, tone: 'warning' };
  }

  return { text: $localize`:@@projects.project-detail.ts.en.bonne.voie.3425f307:En bonne voie`, tone: 'good' };
}

export function computeTaskStatusBreakdown(tasks: ProjectTask[]): TaskStatusBreakdown {
  const active = tasks.filter(t => !isTaskCancelled(t.status));
  const breakdown: TaskStatusBreakdown = {
    done: 0,
    inProgress: 0,
    waiting: 0,
    overdue: 0,
    todo: 0,
    total: active.length
  };

  for (const task of active) {
    if (task.isOverdue && !isTaskDone(task.status)) {
      breakdown.overdue += 1;
      continue;
    }
    const status = parseProjectTaskStatus(task.status);
    switch (status) {
      case 'Done':
        breakdown.done += 1;
        break;
      case 'InProgress':
        breakdown.inProgress += 1;
        break;
      case 'Waiting':
        breakdown.waiting += 1;
        break;
      default:
        breakdown.todo += 1;
        break;
    }
  }

  return breakdown;
}

export function buildBudgetDonutSlices(budget: ProjectBudget | null, currency: string): BudgetDonutSlice[] {
  if (!budget || budget.budgetHt <= 0) {
    return [];
  }
  const remainder = Math.max(0, budget.budgetHt - budget.actualCostHt);
  const slices: BudgetDonutSlice[] = [
    { key: 'actual', label: $localize`:@@projects.project-detail.ts.couts.realises.ec3348c9:Coûts réalisés`, value: budget.actualCostHt, color: '#2563eb' },
    { key: 'time', label: $localize`:@@projects.project-detail.ts.cout.temps.91eada0d:Coût temps`, value: budget.timeCostHt, color: '#7c3aed' },
    { key: 'remaining', label: $localize`:@@projects.project-detail.ts.reste.68135bb8:Reste`, value: remainder, color: '#e2e8f0' }
  ];
  return slices.filter(s => s.value > 0 || s.key === 'remaining');
}

export function upcomingTasks(tasks: ProjectTask[], limit = 3): ProjectTask[] {
  const open = tasks.filter(
    t =>
      !t.parentTaskId &&
      isTaskOpen(t.status) &&
      t.dueDate
  );
  return open
    .slice()
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    .slice(0, limit);
}

export function formatTimeAgoFr(isoDate: string, now = new Date()): string {
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return '';
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return "à l'instant";

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days} jour${days > 1 ? 's' : ''}`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `il y a ${weeks} sem.`;

  const months = Math.floor(days / 30);
  return `il y a ${months} mois`;
}

const ACTIVITY_VISUALS: Record<string, ActivityVisual> = {
  created: { icon: 'pi-plus-circle', color: '#2563eb' },
  updated: { icon: 'pi-pencil', color: '#64748b' },
  completed: { icon: 'pi-check-circle', color: '#16a34a' },
  task_created: { icon: 'pi-check-square', color: '#2563eb' },
  task_moved: { icon: 'pi-arrows-h', color: '#7c3aed' },
  comment: { icon: 'pi-comment', color: '#64748b' },
  file: { icon: 'pi-file', color: '#d97706' },
  invoiced: { icon: 'pi-wallet', color: '#16a34a' }
};

export function activityVisual(type: string): ActivityVisual {
  return ACTIVITY_VISUALS[type] ?? { icon: 'pi-info-circle', color: '#64748b' };
}

export function resolveActivityActorName(
  activity: ProjectActivity,
  users: ProjectAssignableUser[]
): string | null {
  const actorId = activity.actorUserId;
  if (!actorId) return null;
  return users.find(u => u.id === actorId)?.displayName ?? null;
}

export function previewTeamMembers(members: ProjectMember[], limit = 5): ProjectMember[] {
  const sorted = members.slice().sort((a, b) => {
    const roleOrder = (r: unknown) => (r === 'Manager' || r === 2 ? 0 : 1);
    return roleOrder(a.role) - roleOrder(b.role) || a.userName.localeCompare(b.userName);
  });
  return sorted.slice(0, limit);
}

export function isManagerRole(role: unknown): boolean {
  return role === 'Manager' || role === 2;
}

export { formatDaysUntilDue, daysUntilDue };
