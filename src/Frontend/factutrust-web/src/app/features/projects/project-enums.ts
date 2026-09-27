/// <reference types="@angular/localize" />
/**
 * Contrat JSON Projets : enums sérialisés en PascalCase via
 * JsonStringEnumConverter() (Program.cs). Accepte aussi les entiers 0..N
 * et un camelCase accidentel.
 */
import { StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';

export type ProjectStatusCode = 'Draft' | 'Active' | 'OnHold' | 'Completed' | 'Cancelled';
export type ProjectKindCode = 'Generic' | 'Esn' | 'Btp';
export type ProjectBillingModeCode = 'None' | 'TimeAndMaterials' | 'FixedPrice' | 'Milestone' | 'ProgressSituations';
export type ProjectMemberRoleCode = 'Viewer' | 'Member' | 'Manager';
export type ProjectTaskPriorityCode = 'Low' | 'Normal' | 'High' | 'Urgent';
export type ProjectTaskStatusCode = 'Todo' | 'InProgress' | 'Waiting' | 'Done' | 'Cancelled';
export type ProjectTimeEntryStatusCode = 'Draft' | 'Submitted' | 'Validated';
export type ProjectSituationStatusCode = 'Draft' | 'Validated';

export const PROJECT_STATUS_OPTIONS = [
  { label: $localize`:@@projects.filter.brouillon:Brouillon`, value: 'Draft' },
  { label: $localize`:@@projects.filter.actif:Actif`, value: 'Active' },
  { label: $localize`:@@projects.filter.en-pause:En pause`, value: 'OnHold' },
  { label: $localize`:@@projects.filter.termine:Terminé`, value: 'Completed' },
  { label: $localize`:@@projects.filter.annule:Annulé`, value: 'Cancelled' }
];

export const PROJECT_KIND_OPTIONS = [
  { label: 'Général', value: 'Generic' },
  { label: 'ESN / Services', value: 'Esn' },
  { label: 'BTP / Chantier', value: 'Btp' }
];

export const PROJECT_BILLING_OPTIONS = [
  { label: 'Aucune', value: 'None' },
  { label: 'Régie (temps)', value: 'TimeAndMaterials' },
  { label: 'Forfait', value: 'FixedPrice' },
  { label: 'Jalons', value: 'Milestone' },
  { label: 'Situations de travaux', value: 'ProgressSituations' }
];

export const PROJECT_ROLE_OPTIONS = [
  { label: 'Lecteur', value: 'Viewer' },
  { label: 'Membre', value: 'Member' },
  { label: 'Responsable', value: 'Manager' }
];

export const PROJECT_PRIORITY_OPTIONS = [
  { label: 'Basse', value: 'Low' },
  { label: 'Normale', value: 'Normal' },
  { label: 'Haute', value: 'High' },
  { label: 'Urgente', value: 'Urgent' }
];

export const PROJECT_TASK_STATUS_OPTIONS = [
  { label: $localize`:@@projects.filter.a-faire:À faire`, value: 'Todo' },
  { label: $localize`:@@projects.filter.en-cours:En cours`, value: 'InProgress' },
  { label: $localize`:@@projects.filter.en-attente:En attente`, value: 'Waiting' },
  { label: $localize`:@@projects.filter.task-termine:Terminé`, value: 'Done' },
  { label: $localize`:@@projects.filter.task-annule:Annulé`, value: 'Cancelled' }
];

function parseMapped<T extends string>(
  raw: unknown,
  pascal: Record<string, T>,
  ints: Record<number, T>
): T | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw in ints) {
    return ints[raw];
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (pascal[trimmed]) return pascal[trimmed];
    const titled = trimmed.length > 0
      ? trimmed[0].toUpperCase() + trimmed.slice(1)
      : trimmed;
    if (pascal[titled]) return pascal[titled];
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (n in ints) return ints[n];
    }
  }
  return null;
}

const STATUS_PASCAL: Record<string, ProjectStatusCode> = {
  Draft: 'Draft',
  Active: 'Active',
  OnHold: 'OnHold',
  Completed: 'Completed',
  Cancelled: 'Cancelled'
};
const STATUS_INT: Record<number, ProjectStatusCode> = {
  0: 'Draft',
  1: 'Active',
  2: 'OnHold',
  3: 'Completed',
  4: 'Cancelled'
};

const KIND_PASCAL: Record<string, ProjectKindCode> = {
  Generic: 'Generic',
  Esn: 'Esn',
  Btp: 'Btp'
};
const KIND_INT: Record<number, ProjectKindCode> = { 0: 'Generic', 1: 'Esn', 2: 'Btp' };

const BILLING_PASCAL: Record<string, ProjectBillingModeCode> = {
  None: 'None',
  TimeAndMaterials: 'TimeAndMaterials',
  FixedPrice: 'FixedPrice',
  Milestone: 'Milestone',
  ProgressSituations: 'ProgressSituations'
};
const BILLING_INT: Record<number, ProjectBillingModeCode> = {
  0: 'None',
  1: 'TimeAndMaterials',
  2: 'FixedPrice',
  3: 'Milestone',
  4: 'ProgressSituations'
};

const ROLE_PASCAL: Record<string, ProjectMemberRoleCode> = {
  Viewer: 'Viewer',
  Member: 'Member',
  Manager: 'Manager'
};
const ROLE_INT: Record<number, ProjectMemberRoleCode> = { 0: 'Viewer', 1: 'Member', 2: 'Manager' };

const PRIORITY_PASCAL: Record<string, ProjectTaskPriorityCode> = {
  Low: 'Low',
  Normal: 'Normal',
  High: 'High',
  Urgent: 'Urgent'
};
const PRIORITY_INT: Record<number, ProjectTaskPriorityCode> = {
  0: 'Low',
  1: 'Normal',
  2: 'High',
  3: 'Urgent'
};

const TASK_STATUS_PASCAL: Record<string, ProjectTaskStatusCode> = {
  Todo: 'Todo',
  InProgress: 'InProgress',
  Waiting: 'Waiting',
  Done: 'Done',
  Cancelled: 'Cancelled'
};
const TASK_STATUS_INT: Record<number, ProjectTaskStatusCode> = {
  0: 'Todo',
  1: 'InProgress',
  2: 'Waiting',
  3: 'Done',
  4: 'Cancelled'
};

const TIME_PASCAL: Record<string, ProjectTimeEntryStatusCode> = {
  Draft: 'Draft',
  Submitted: 'Submitted',
  Validated: 'Validated'
};
const TIME_INT: Record<number, ProjectTimeEntryStatusCode> = {
  0: 'Draft',
  1: 'Submitted',
  2: 'Validated'
};

const SITUATION_PASCAL: Record<string, ProjectSituationStatusCode> = {
  Draft: 'Draft',
  Validated: 'Validated'
};
const SITUATION_INT: Record<number, ProjectSituationStatusCode> = { 0: 'Draft', 1: 'Validated' };

export function parseProjectStatus(raw: unknown): ProjectStatusCode | null {
  return parseMapped(raw, STATUS_PASCAL, STATUS_INT);
}
export function parseProjectKind(raw: unknown): ProjectKindCode | null {
  return parseMapped(raw, KIND_PASCAL, KIND_INT);
}
export function parseProjectBillingMode(raw: unknown): ProjectBillingModeCode | null {
  return parseMapped(raw, BILLING_PASCAL, BILLING_INT);
}
export function parseProjectMemberRole(raw: unknown): ProjectMemberRoleCode | null {
  return parseMapped(raw, ROLE_PASCAL, ROLE_INT);
}
export function parseProjectTaskPriority(raw: unknown): ProjectTaskPriorityCode | null {
  return parseMapped(raw, PRIORITY_PASCAL, PRIORITY_INT);
}
export function parseProjectTaskStatus(raw: unknown): ProjectTaskStatusCode | null {
  return parseMapped(raw, TASK_STATUS_PASCAL, TASK_STATUS_INT);
}
export function parseProjectTimeStatus(raw: unknown): ProjectTimeEntryStatusCode | null {
  return parseMapped(raw, TIME_PASCAL, TIME_INT);
}
export function parseProjectSituationStatus(raw: unknown): ProjectSituationStatusCode | null {
  return parseMapped(raw, SITUATION_PASCAL, SITUATION_INT);
}

export function canActivate(raw: unknown): boolean {
  const s = parseProjectStatus(raw);
  return s === 'Draft' || s === 'OnHold';
}
/** @deprecated Prefer canHold / canComplete for lifecycle actions. */
export function canHoldOrComplete(raw: unknown): boolean {
  return canHold(raw);
}

export function canHold(raw: unknown): boolean {
  return parseProjectStatus(raw) === 'Active';
}

export function canComplete(raw: unknown): boolean {
  const s = parseProjectStatus(raw);
  return s === 'Active' || s === 'OnHold';
}
export function canCancel(raw: unknown): boolean {
  const s = parseProjectStatus(raw);
  return s === 'Draft' || s === 'Active' || s === 'OnHold';
}
export function canReceiveTime(raw: unknown): boolean {
  return parseProjectStatus(raw) === 'Active';
}

export function canProcessExistingTime(raw: unknown): boolean {
  const s = parseProjectStatus(raw);
  return s === 'Active' || s === 'OnHold' || s === 'Completed';
}

export interface ProjectTimeLoggingContext {
  status: unknown;
  timesheetsEnabled?: boolean;
}

export function canCreateTimeEntry(project: ProjectTimeLoggingContext | null | undefined): boolean {
  if (!project) return false;
  return canReceiveTime(project.status) && project.timesheetsEnabled !== false;
}

/** Valide les champs minimaux d'une ligne de temps projet (saisie manuelle). */
export function canSaveProjectTimeLine(
  taskId: string | null | undefined,
  hours: number | null | undefined
): boolean {
  return !!taskId && typeof hours === 'number' && hours > 0 && hours <= 24;
}

/** @deprecated Use canCreateTimeEntry for new time entry; showTimeTab for tab visibility. */
export function canLogTime(project: ProjectTimeLoggingContext | null | undefined): boolean {
  return canCreateTimeEntry(project);
}

export function showTimeTab(project: ProjectTimeLoggingContext | null | undefined): boolean {
  if (!project) return false;
  if (project.timesheetsEnabled === false) return false;
  return canProcessExistingTime(project.status);
}

export interface ProjectProfitabilityTabContext {
  billingMode?: ProjectBillingModeCode | number | string | null;
}

export function showProfitabilityTab(project: ProjectProfitabilityTabContext | null | undefined): boolean {
  if (!project) return false;
  const mode = parseProjectBillingMode(project.billingMode);
  return mode !== null && mode !== 'None';
}

export interface ProjectTaskTimeTabContext {
  loggedHours: number;
}

/** Onglet « Temps passé » sur la fiche tâche : saisie projet ou historique sur la tâche. */
export function showTaskTimeTab(
  project: ProjectTimeLoggingContext | null | undefined,
  task: ProjectTaskTimeTabContext | null | undefined
): boolean {
  if (showTimeTab(project)) return true;
  return (task?.loggedHours ?? 0) > 0;
}

export function canProcessTimeEntries(project: ProjectTimeLoggingContext | null | undefined): boolean {
  return showTimeTab(project);
}

export function timesheetsDisabledMessage(): string {
  return 'La saisie des temps est désactivée pour ce projet.';
}

export function cannotReceiveTimeMessage(raw: unknown): string {
  const s = parseProjectStatus(raw);
  switch (s) {
    case 'Draft':
      return 'Activez le projet pour saisir du temps. La saisie est interdite en statut Brouillon.';
    case 'OnHold':
      return 'La saisie de temps est interdite pour un projet en pause.';
    case 'Completed':
      return 'Aucune nouvelle saisie de temps n\'est autorisée sur un projet terminé.';
    case 'Cancelled':
      return 'Aucune nouvelle saisie de temps n\'est autorisée sur un projet annulé.';
    default:
      return 'Activez le projet pour saisir du temps. La saisie est réservée aux projets Actif.';
  }
}

export function timeEntryCreationBlockedMessage(raw: unknown): string {
  const s = parseProjectStatus(raw);
  if (s === 'OnHold' || s === 'Completed') {
    return 'La saisie de nouveaux temps est désactivée. Les temps déjà saisis restent consultables et traitables.';
  }
  return cannotReceiveTimeMessage(raw);
}

export interface TimeEntryActionContext {
  status: unknown;
  invoicedInvoiceId?: string | null;
  statusDisplay?: string;
}

export function isInvoicedTimeEntry(entry: TimeEntryActionContext): boolean {
  return !!entry.invoicedInvoiceId;
}

export function canEditTimeEntry(entry: TimeEntryActionContext): boolean {
  return parseProjectTimeStatus(entry.status) === 'Draft' && !isInvoicedTimeEntry(entry);
}

export function canDeleteTimeEntry(entry: TimeEntryActionContext): boolean {
  return canEditTimeEntry(entry);
}

export function canSubmitTimeEntry(entry: TimeEntryActionContext): boolean {
  return parseProjectTimeStatus(entry.status) === 'Draft' && !isInvoicedTimeEntry(entry);
}

export function canValidateTimeEntry(entry: TimeEntryActionContext): boolean {
  return parseProjectTimeStatus(entry.status) === 'Submitted';
}

export function canReopenTimeEntry(entry: TimeEntryActionContext): boolean {
  if (isInvoicedTimeEntry(entry)) return false;
  const s = parseProjectTimeStatus(entry.status);
  return s === 'Submitted' || s === 'Validated';
}

export function canReopenSubmittedTimeEntry(entry: TimeEntryActionContext): boolean {
  return canReopenTimeEntry(entry) && parseProjectTimeStatus(entry.status) === 'Submitted';
}

export function canReopenValidatedTimeEntry(entry: TimeEntryActionContext): boolean {
  return canReopenTimeEntry(entry) && parseProjectTimeStatus(entry.status) === 'Validated';
}

export function timeEntryStatusLabel(entry: TimeEntryActionContext): string {
  if (isInvoicedTimeEntry(entry)) return 'Facturé';
  if (entry.statusDisplay) return entry.statusDisplay;
  return parseProjectTimeStatus(entry.status) ?? 'Draft';
}

export function timeEntryStatusBadge(entry: TimeEntryActionContext): StatusBadgeStatus {
  if (isInvoicedTimeEntry(entry)) return 'paid';
  return timeStatusBadge(entry.status);
}

export function canBeBilled(raw: unknown): boolean {
  const s = parseProjectStatus(raw);
  return s === 'Active' || s === 'Completed';
}
export function canEditProject(raw: unknown): boolean {
  const s = parseProjectStatus(raw);
  return s === 'Draft' || s === 'Active' || s === 'OnHold';
}

export function isEsn(raw: unknown): boolean {
  return parseProjectKind(raw) === 'Esn';
}
export function isBtp(raw: unknown): boolean {
  return parseProjectKind(raw) === 'Btp';
}
export function isMilestoneBilling(raw: unknown): boolean {
  return parseProjectBillingMode(raw) === 'Milestone';
}
export function showMilestones(kind: unknown, billingMode: unknown): boolean {
  if (isEsn(kind)) return true;
  if (parseProjectKind(kind) === 'Generic') {
    const mode = parseProjectBillingMode(billingMode);
    return mode === 'Milestone' || mode === 'TimeAndMaterials';
  }
  return false;
}

export function showWorkload(kind: unknown, billingMode: unknown): boolean {
  if (isEsn(kind)) return true;
  return parseProjectBillingMode(billingMode) === 'TimeAndMaterials';
}

export function isFixedPriceBilling(raw: unknown): boolean {
  return parseProjectBillingMode(raw) === 'FixedPrice';
}

export const TUNISIAN_VAT_OPTIONS = [
  { label: '0 %', value: 0 },
  { label: '7 %', value: 7 },
  { label: '13 %', value: 13 },
  { label: '19 %', value: 19 }
];

export function defaultBillingForKind(kind: unknown): ProjectBillingModeCode {
  const k = parseProjectKind(kind);
  if (k === 'Esn') return 'TimeAndMaterials';
  if (k === 'Btp') return 'ProgressSituations';
  return 'None';
}

export function billingOptionsForKind(kind: unknown): typeof PROJECT_BILLING_OPTIONS {
  if (isBtp(kind)) return PROJECT_BILLING_OPTIONS;
  return PROJECT_BILLING_OPTIONS.filter(o => o.value !== 'ProgressSituations');
}

/** Maps Kanban column sortOrder to task status (aligned with default phase seeds). */
const PHASE_STATUS_BY_KIND: Record<ProjectKindCode, ProjectTaskStatusCode[]> = {
  Generic: ['Todo', 'InProgress', 'Waiting', 'Done', 'Cancelled'],
  Esn: ['Todo', 'Waiting', 'InProgress', 'Waiting', 'Done'],
  Btp: ['Todo', 'InProgress', 'Waiting', 'Waiting', 'Done']
};

export function taskStatusForPhaseSortOrder(kind: unknown, sortOrder: number): ProjectTaskStatusCode | null {
  const k = parseProjectKind(kind) ?? 'Generic';
  const mapping = PHASE_STATUS_BY_KIND[k];
  if (sortOrder < 0 || sortOrder >= mapping.length) return null;
  return mapping[sortOrder];
}

export function projectStatusBadge(raw: unknown): StatusBadgeStatus {
  switch (parseProjectStatus(raw)) {
    case 'Active':
      return 'active';
    case 'OnHold':
      return 'pending';
    case 'Completed':
      return 'validated';
    case 'Cancelled':
      return 'cancelled';
    default:
      return 'draft';
  }
}

export function taskStatusBadge(raw: unknown): StatusBadgeStatus {
  switch (parseProjectTaskStatus(raw)) {
    case 'InProgress':
      return 'active';
    case 'Waiting':
      return 'pending';
    case 'Done':
      return 'validated';
    case 'Cancelled':
      return 'cancelled';
    default:
      return 'draft';
  }
}

export function timeStatusBadge(raw: unknown): StatusBadgeStatus {
  switch (parseProjectTimeStatus(raw)) {
    case 'Submitted':
      return 'pending';
    case 'Validated':
      return 'validated';
    default:
      return 'draft';
  }
}

export function situationStatusBadge(raw: unknown): StatusBadgeStatus {
  return parseProjectSituationStatus(raw) === 'Validated' ? 'validated' : 'draft';
}

export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function toIsoDateOnly(value: Date | string | null | undefined): string | null {
  const iso = toIsoDate(value);
  return iso ? iso.slice(0, 10) : null;
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export interface KanbanColumnPreview {
  name: string;
  order: number;
  color: string;
}

/** Mirrors backend ProjectPhase.DefaultColumnsFor — used for creation wizard preview. */
export function defaultKanbanColumnsForKind(kind: unknown): KanbanColumnPreview[] {
  const k = parseProjectKind(kind) ?? 'Generic';
  if (k === 'Esn') {
    return [
      { name: 'Backlog', order: 0, color: '#64748b' },
      { name: 'Spécifications', order: 1, color: '#7c3aed' },
      { name: 'Réalisation', order: 2, color: '#2563eb' },
      { name: 'Recette', order: 3, color: '#d97706' },
      { name: 'Livré', order: 4, color: '#16a34a' }
    ];
  }
  if (k === 'Btp') {
    return [
      { name: 'Préparation', order: 0, color: '#64748b' },
      { name: 'Exécution', order: 1, color: '#2563eb' },
      { name: 'Contrôle', order: 2, color: '#d97706' },
      { name: 'Réception', order: 3, color: '#7c3aed' },
      { name: 'Clôturé', order: 4, color: '#16a34a' }
    ];
  }
  return [
    { name: 'À faire', order: 0, color: '#64748b' },
    { name: 'En cours', order: 1, color: '#2563eb' },
    { name: 'En attente', order: 2, color: '#d97706' },
    { name: 'Terminé', order: 3, color: '#16a34a' },
    { name: 'Annulé', order: 4, color: '#dc2626' }
  ];
}

export interface ProjectUiProfile {
  kindLabel: string;
  emphasizeTabs: TabKey[];
  showSiteChip: boolean;
}

export type TabKey = 'overview' | 'tasks' | 'time' | 'budget' | 'profitability' | 'team' | 'files' | 'billing' | 'activity' | 'settings';

export function projectUiProfile(kind: unknown): ProjectUiProfile {
  if (isBtp(kind)) {
    return { kindLabel: 'BTP / Chantier', emphasizeTabs: ['budget', 'billing', 'tasks'], showSiteChip: true };
  }
  if (isEsn(kind)) {
    return { kindLabel: 'ESN / Services', emphasizeTabs: ['time', 'billing', 'team', 'tasks'], showSiteChip: false };
  }
  return { kindLabel: 'Général', emphasizeTabs: ['overview', 'tasks'], showSiteChip: false };
}

export function computeProjectProgressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

/** Couleur d'accent pour l'icône lettre projet (dashboard). */
export function projectKindAccentColor(kind: unknown): string {
  if (isBtp(kind)) return '#d97706';
  if (isEsn(kind)) return '#2563eb';
  return '#64748b';
}

/** Icône Font Awesome pour priorité tâche (sidebar dashboard). */
export function taskPriorityIcon(priority: unknown): string {
  const p = typeof priority === 'string' ? priority : String(priority ?? '');
  if (p === 'Urgent' || p === '3') return 'fa-solid fa-circle-exclamation';
  if (p === 'High' || p === '2') return 'fa-solid fa-flag';
  if (p === 'Low' || p === '0') return 'fa-solid fa-circle';
  return 'fa-solid fa-list-check';
}

export function taskPriorityColor(priority: unknown): string {
  const p = typeof priority === 'string' ? priority : String(priority ?? '');
  if (p === 'Urgent' || p === '3') return '#dc2626';
  if (p === 'High' || p === '2') return '#d97706';
  if (p === 'Low' || p === '0') return '#64748b';
  return '#2563eb';
}

export function initialsFromName(name: string | null | undefined): string {
  if (!name?.trim()) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
}

export function daysUntilDue(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate.slice(0, 10));
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / 86400000);
}

/** Libellé relatif pour une échéance projet (liste). */
export function formatDaysUntilDue(dueDate: string | null | undefined): string | null {
  const days = daysUntilDue(dueDate);
  if (days === null) return null;
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Demain';
  if (days > 1) return `Dans ${days} jours`;
  if (days === -1) return 'En retard de 1 jour';
  return `En retard de ${Math.abs(days)} jours`;
}

export function projectKindPillClass(kind: unknown): string {
  if (isBtp(kind)) return 'proj-kind-pill--btp';
  if (isEsn(kind)) return 'proj-kind-pill--esn';
  return 'proj-kind-pill--generic';
}
