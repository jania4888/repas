/**
 * Contrat JSON Exchange : enums sérialisés en PascalCase via
 * JsonStringEnumConverter() (Program.cs). Accepte aussi les entiers 0..N.
 */

export type ExchangeThreadStatusCode = 'Open' | 'Closed';
export type ExchangeMessageVisibilityCode = 'ClientVisible' | 'InternalNote';
export type ExchangeRequestStatusCode =
  | 'Open'
  | 'InProgress'
  | 'WaitingClient'
  | 'WaitingFirm'
  | 'Resolved'
  | 'Closed';
export type ExchangeTaskStatusCode = 'Todo' | 'Doing' | 'Done' | 'Cancelled';
export type ExchangeRequestCategoryCode =
  | 'Reclamation'
  | 'Information'
  | 'DocumentManquant'
  | 'Autre';

const THREAD_PASCAL: Record<string, ExchangeThreadStatusCode> = {
  Open: 'Open',
  Closed: 'Closed'
};

const VISIBILITY_PASCAL: Record<string, ExchangeMessageVisibilityCode> = {
  ClientVisible: 'ClientVisible',
  InternalNote: 'InternalNote'
};

const REQUEST_STATUS_PASCAL: Record<string, ExchangeRequestStatusCode> = {
  Open: 'Open',
  InProgress: 'InProgress',
  WaitingClient: 'WaitingClient',
  WaitingFirm: 'WaitingFirm',
  Resolved: 'Resolved',
  Closed: 'Closed'
};

const TASK_STATUS_PASCAL: Record<string, ExchangeTaskStatusCode> = {
  Todo: 'Todo',
  Doing: 'Doing',
  Done: 'Done',
  Cancelled: 'Cancelled'
};

const CATEGORY_PASCAL: Record<string, ExchangeRequestCategoryCode> = {
  Reclamation: 'Reclamation',
  Information: 'Information',
  DocumentManquant: 'DocumentManquant',
  Autre: 'Autre'
};

const THREAD_INT: Record<number, ExchangeThreadStatusCode> = { 0: 'Open', 1: 'Closed' };
const VISIBILITY_INT: Record<number, ExchangeMessageVisibilityCode> = {
  0: 'ClientVisible',
  1: 'InternalNote'
};
const REQUEST_STATUS_INT: Record<number, ExchangeRequestStatusCode> = {
  0: 'Open',
  1: 'InProgress',
  2: 'WaitingClient',
  3: 'WaitingFirm',
  4: 'Resolved',
  5: 'Closed'
};
const TASK_STATUS_INT: Record<number, ExchangeTaskStatusCode> = {
  0: 'Todo',
  1: 'Doing',
  2: 'Done',
  3: 'Cancelled'
};
const CATEGORY_INT: Record<number, ExchangeRequestCategoryCode> = {
  0: 'Reclamation',
  1: 'Information',
  2: 'DocumentManquant',
  3: 'Autre'
};

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
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (n in ints) return ints[n];
    }
  }
  return null;
}

export function parseExchangeThreadStatus(raw: unknown): ExchangeThreadStatusCode | null {
  return parseMapped(raw, THREAD_PASCAL, THREAD_INT);
}

export function parseExchangeMessageVisibility(raw: unknown): ExchangeMessageVisibilityCode | null {
  return parseMapped(raw, VISIBILITY_PASCAL, VISIBILITY_INT);
}

export function parseExchangeRequestStatus(raw: unknown): ExchangeRequestStatusCode | null {
  return parseMapped(raw, REQUEST_STATUS_PASCAL, REQUEST_STATUS_INT);
}

export function parseExchangeTaskStatus(raw: unknown): ExchangeTaskStatusCode | null {
  return parseMapped(raw, TASK_STATUS_PASCAL, TASK_STATUS_INT);
}

export function parseExchangeRequestCategory(raw: unknown): ExchangeRequestCategoryCode | null {
  return parseMapped(raw, CATEGORY_PASCAL, CATEGORY_INT);
}

export function isThreadOpen(raw: unknown): boolean {
  return parseExchangeThreadStatus(raw) === 'Open';
}

export function isThreadClosed(raw: unknown): boolean {
  return parseExchangeThreadStatus(raw) === 'Closed';
}

export function isInternalNote(raw: unknown): boolean {
  return parseExchangeMessageVisibility(raw) === 'InternalNote';
}

export function isRequestActionable(raw: unknown): boolean {
  const s = parseExchangeRequestStatus(raw);
  return s !== null && s !== 'Closed';
}

export function isRequestOpen(raw: unknown): boolean {
  return parseExchangeRequestStatus(raw) === 'Open';
}

export function canResolveRequest(raw: unknown): boolean {
  const s = parseExchangeRequestStatus(raw);
  return s === 'Open' || s === 'InProgress' || s === 'WaitingClient' || s === 'WaitingFirm';
}

export function canCompleteTask(raw: unknown): boolean {
  const s = parseExchangeTaskStatus(raw);
  return s === 'Todo' || s === 'Doing';
}

export function threadStatusLabel(raw: unknown): string {
  const s = parseExchangeThreadStatus(raw);
  if (s === 'Open') return $localize`:@@exchanges.exchange-status.ts.en.cours.bc9b533a:En cours`;
  if (s === 'Closed') return $localize`:@@exchanges.exchange-status.ts.clos.189812eb:Clos`;
  return $localize`:@@exchanges.exchange-status.ts.inconnu.f3cfc645:Inconnu`;
}

export function requestStatusLabel(raw: unknown): string {
  const s = parseExchangeRequestStatus(raw);
  switch (s) {
    case 'Open':
      return $localize`:@@exchanges.exchange-status.ts.ouverte.61589002:Ouverte`;
    case 'InProgress':
      return $localize`:@@exchanges.exchange-status.ts.en.cours.bc9b533a:En cours`;
    case 'WaitingClient':
      return $localize`:@@exchanges.exchange-status.ts.attente.client.6b243335:Attente client`;
    case 'WaitingFirm':
      return $localize`:@@exchanges.exchange-status.ts.attente.cabinet.9986eb84:Attente cabinet`;
    case 'Resolved':
      return $localize`:@@exchanges.exchange-status.ts.resolue.29df7ce6:Résolue`;
    case 'Closed':
      return $localize`:@@exchanges.exchange-status.ts.cloturee.da2e2bc8:Clôturée`;
    default:
      return '';
  }
}

export function categoryLabel(raw: unknown): string {
  const c = parseExchangeRequestCategory(raw);
  switch (c) {
    case 'Reclamation':
      return $localize`:@@exchanges.exchange-status.ts.reclamation.33d37f8b:Réclamation`;
    case 'Information':
      return $localize`:@@exchanges.exchange-status.ts.information.0eb5ed50:Information`;
    case 'DocumentManquant':
      return $localize`:@@exchanges.exchange-status.ts.document.manquant.854cb44d:Document manquant`;
    case 'Autre':
      return $localize`:@@exchanges.exchange-status.ts.autre.43dacf9e:Autre`;
    default:
      return '';
  }
}

export function taskStatusLabel(raw: unknown): string {
  const s = parseExchangeTaskStatus(raw);
  switch (s) {
    case 'Todo':
      return $localize`:@@exchanges.exchange-status.ts.a.faire.262bf4ea:À faire`;
    case 'Doing':
      return $localize`:@@exchanges.exchange-status.ts.en.cours.bc9b533a:En cours`;
    case 'Done':
      return $localize`:@@exchanges.exchange-status.ts.terminee.45936892:Terminée`;
    case 'Cancelled':
      return $localize`:@@exchanges.exchange-status.ts.annulee.2776573b:Annulée`;
    default:
      return '';
  }
}

/** Group messages by calendar day for date separators. */
export function messageDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function messageDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday.getTime() - startMsg.getTime()) / 86_400_000);
  if (diffDays === 0) return $localize`:@@exchanges.exchange-status.ts.aujourd.hui.baca97f6:Aujourd'hui`;
  if (diffDays === 1) return $localize`:@@exchanges.exchange-status.ts.hier.e6faf8c2:Hier`;
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export type ExchangeAuditEventTypeCode =
  | 'ThreadOpened'
  | 'MessageSent'
  | 'InternalNoteAdded'
  | 'RequestCreated'
  | 'RequestStatusChanged'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'DocumentShared'
  | 'ThreadClosed'
  | 'ThreadReopened'
  | 'AppointmentSuggested'
  | 'TaskStatusChanged'
  | 'RequestCommented'
  | 'RequestAssigned';

const AUDIT_PASCAL: Record<string, ExchangeAuditEventTypeCode> = {
  ThreadOpened: 'ThreadOpened',
  MessageSent: 'MessageSent',
  InternalNoteAdded: 'InternalNoteAdded',
  RequestCreated: 'RequestCreated',
  RequestStatusChanged: 'RequestStatusChanged',
  TaskCreated: 'TaskCreated',
  TaskCompleted: 'TaskCompleted',
  DocumentShared: 'DocumentShared',
  ThreadClosed: 'ThreadClosed',
  ThreadReopened: 'ThreadReopened',
  AppointmentSuggested: 'AppointmentSuggested',
  TaskStatusChanged: 'TaskStatusChanged',
  RequestCommented: 'RequestCommented',
  RequestAssigned: 'RequestAssigned'
};

const AUDIT_INT: Record<number, ExchangeAuditEventTypeCode> = {
  0: 'ThreadOpened',
  1: 'MessageSent',
  2: 'InternalNoteAdded',
  3: 'RequestCreated',
  4: 'RequestStatusChanged',
  5: 'TaskCreated',
  6: 'TaskCompleted',
  7: 'DocumentShared',
  8: 'ThreadClosed',
  9: 'ThreadReopened',
  10: 'AppointmentSuggested',
  11: 'TaskStatusChanged',
  12: 'RequestCommented',
  13: 'RequestAssigned'
};

const AUDIT_LABELS: Record<ExchangeAuditEventTypeCode, string> = {
  ThreadOpened: $localize`:@@exchanges.exchange-status.ts.echange.ouvert.09a217d7:Échange ouvert`,
  MessageSent: $localize`:@@exchanges.exchange-status.ts.message.envoye.3414873e:Message envoyé`,
  InternalNoteAdded: $localize`:@@exchanges.exchange-status.ts.note.interne.ajoutee.68b6b52b:Note interne ajoutée`,
  RequestCreated: $localize`:@@exchanges.exchange-status.ts.demande.creee.a251dbcc:Demande créée`,
  RequestStatusChanged: $localize`:@@exchanges.exchange-status.ts.statut.de.demande.modifie.862bd42a:Statut de demande modifié`,
  TaskCreated: $localize`:@@exchanges.exchange-status.ts.tache.creee.80944c5c:Tâche créée`,
  TaskCompleted: $localize`:@@exchanges.exchange-status.ts.tache.terminee.c076ace1:Tâche terminée`,
  DocumentShared: $localize`:@@exchanges.exchange-status.ts.document.partage.7743e6ac:Document partagé`,
  ThreadClosed: $localize`:@@exchanges.exchange-status.ts.echange.clos.0c2b7790:Échange clos`,
  ThreadReopened: $localize`:@@exchanges.exchange-status.ts.echange.rouvert.2edbb79d:Échange rouvert`,
  AppointmentSuggested: $localize`:@@exchanges.exchange-status.ts.rendez.vous.suggere.e7ba6e42:Rendez-vous suggéré`,
  TaskStatusChanged: $localize`:@@exchanges.exchange-status.ts.statut.de.tache.modifie.00fb8356:Statut de tâche modifié`,
  RequestCommented: $localize`:@@exchanges.exchange-status.ts.commentaire.sur.une.demande.ddea6460:Commentaire sur une demande`,
  RequestAssigned: $localize`:@@exchanges.exchange-status.ts.demande.assignee.339a3efd:Demande assignée`
};

export function parseExchangeAuditEventType(raw: unknown): ExchangeAuditEventTypeCode | null {
  return parseMapped(raw, AUDIT_PASCAL, AUDIT_INT);
}

export function auditEventLabel(raw: unknown): string {
  const code = parseExchangeAuditEventType(raw);
  if (code) return AUDIT_LABELS[code];
  if (raw == null || raw === '') return $localize`:@@exchanges.exchange-status.ts.evenement.c040c1a9:Événement`;
  return $localize`:@@exchanges.exchange-status.ts.evenement.raw.9e9bc6f2:Événement ${raw}:raw:`;
}

const ROLE_LABELS: Record<string, string> = {
  Administrator: $localize`:@@exchanges.exchange-status.ts.administrateur.1d8141b2:Administrateur`,
  FirmManager: $localize`:@@exchanges.exchange-status.ts.responsable.cabinet.887948b9:Responsable cabinet`,
  FirmAccountant: $localize`:@@exchanges.exchange-status.ts.comptable.cabinet.d12d50ed:Comptable cabinet`,
  Accountant: $localize`:@@exchanges.exchange-status.ts.comptable.36cf0a9e:Comptable`,
  Manager: $localize`:@@exchanges.exchange-status.ts.manager.babe3050:Manager`,
  User: $localize`:@@exchanges.exchange-status.ts.utilisateur.0b20cd7f:Utilisateur`,
  Employee: $localize`:@@exchanges.exchange-status.ts.collaborateur.a66377cf:Collaborateur`
};

export function participantRoleLabel(role: string | null | undefined): string {
  if (!role) return '';
  const trimmed = role.trim();
  return ROLE_LABELS[trimmed] ?? trimmed;
}

/** Map request status to a shared StatusBadgeStatus-compatible key. */
export function requestStatusBadge(
  raw: unknown
): 'pending' | 'active' | 'validated' | 'cancelled' | 'draft' | 'overdue' | 'accepted' | 'inactive' {
  const s = parseExchangeRequestStatus(raw);
  switch (s) {
    case 'Open':
      return 'overdue';
    case 'InProgress':
      return 'active';
    case 'WaitingClient':
    case 'WaitingFirm':
      return 'pending';
    case 'Resolved':
      return 'accepted';
    case 'Closed':
      return 'inactive';
    default:
      return 'draft';
  }
}

export function taskStatusBadge(raw: unknown): 'pending' | 'active' | 'validated' | 'cancelled' | 'draft' {
  const s = parseExchangeTaskStatus(raw);
  switch (s) {
    case 'Todo':
      return 'pending';
    case 'Doing':
      return 'active';
    case 'Done':
      return 'validated';
    case 'Cancelled':
      return 'cancelled';
    default:
      return 'draft';
  }
}

export function threadStatusBadge(raw: unknown): 'active' | 'cancelled' | 'draft' {
  const s = parseExchangeThreadStatus(raw);
  if (s === 'Open') return 'active';
  if (s === 'Closed') return 'cancelled';
  return 'draft';
}

/** File extension → PrimeIcons class (without `pi ` prefix). */
export function documentIconClass(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'pdf':
      return 'pi-file-pdf';
    case 'doc':
    case 'docx':
      return 'pi-file-word';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'pi-file-excel';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return 'pi-image';
    case 'zip':
    case 'rar':
    case '7z':
      return 'pi-box';
    default:
      return 'pi-file';
  }
}

export type ExchangeRequestPriorityCode = 'Low' | 'Normal' | 'High';
export type RequestListFilter =
  | 'all'
  | 'active'
  | 'open'
  | 'inProgress'
  | 'waiting'
  | 'resolved'
  | 'closed';

const PRIORITY_PASCAL: Record<string, ExchangeRequestPriorityCode> = {
  Low: 'Low',
  Normal: 'Normal',
  High: 'High'
};
const PRIORITY_INT: Record<number, ExchangeRequestPriorityCode> = {
  0: 'Low',
  1: 'Normal',
  2: 'High'
};

export function parseExchangeRequestPriority(raw: unknown): ExchangeRequestPriorityCode | null {
  return parseMapped(raw, PRIORITY_PASCAL, PRIORITY_INT);
}

export function priorityLabel(raw: unknown): string {
  const p = parseExchangeRequestPriority(raw);
  switch (p) {
    case 'Low':
      return $localize`:@@exchanges.exchange-status.ts.basse.66ecf01a:Basse`;
    case 'Normal':
      return $localize`:@@exchanges.exchange-status.ts.normale.c82c13b2:Normale`;
    case 'High':
      return $localize`:@@exchanges.exchange-status.ts.haute.ab500e10:Haute`;
    default:
      return '';
  }
}

export function isPriorityHigh(raw: unknown): boolean {
  return parseExchangeRequestPriority(raw) === 'High';
}

export function isRequestWaiting(raw: unknown): boolean {
  const s = parseExchangeRequestStatus(raw);
  return s === 'WaitingClient' || s === 'WaitingFirm';
}

export function canSetWaiting(raw: unknown): boolean {
  const s = parseExchangeRequestStatus(raw);
  return s === 'InProgress' || s === 'WaitingClient' || s === 'WaitingFirm';
}

export function canResumeRequest(raw: unknown): boolean {
  return isRequestWaiting(raw);
}

export function canAssignRequest(raw: unknown, isFirm: boolean): boolean {
  if (!isFirm) return false;
  const s = parseExchangeRequestStatus(raw);
  return s !== null && s !== 'Resolved' && s !== 'Closed';
}

export function requestMatchesFilter(
  status: unknown,
  filter: RequestListFilter,
  query: string,
  title: string,
  description: string,
  number: number
): boolean {
  const s = parseExchangeRequestStatus(status);
  switch (filter) {
    case 'active':
      if (s !== 'Open' && s !== 'InProgress' && s !== 'WaitingClient' && s !== 'WaitingFirm') return false;
      break;
    case 'open':
      if (s !== 'Open') return false;
      break;
    case 'inProgress':
      if (s !== 'InProgress') return false;
      break;
    case 'waiting':
      if (s !== 'WaitingClient' && s !== 'WaitingFirm') return false;
      break;
    case 'resolved':
      if (s !== 'Resolved') return false;
      break;
    case 'closed':
      if (s !== 'Closed') return false;
      break;
    default:
      break;
  }
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    title.toLowerCase().includes(q) ||
    (description ?? '').toLowerCase().includes(q) ||
    String(number).includes(q)
  );
}

export function assigneeDisplayName(
  participants: { userId: string; displayName: string }[] | null | undefined,
  assigneeUserId?: string | null
): string {
  if (!assigneeUserId) return $localize`:@@exchanges.exchange-status.ts.non.assignee.493d0bb2:Non assignée`;
  const name = participants?.find(p => p.userId === assigneeUserId)?.displayName?.trim();
  return name || $localize`:@@exchanges.exchange-status.ts.participant.a77366e9:Participant`;
}

export function formatFileSize(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return $localize`:@@exchanges.exchange-status.ts.tofixed.ko.fc4c85dc:${(n / 1024).toFixed(1)}:toFixed: Ko`;
  return $localize`:@@exchanges.exchange-status.ts.tofixed.mo.66e70c71:${(n / (1024 * 1024)).toFixed(1)}:toFixed: Mo`;
}

export interface RequestAuditPayload {
  requestId?: string;
  status?: string;
  number?: number;
  fileName?: string;
  assigneeUserId?: string;
}

export function parseRequestAuditPayload(json?: string | null): RequestAuditPayload {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as RequestAuditPayload;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function auditEventBelongsToRequest(
  eventType: unknown,
  payloadJson: string | undefined,
  request: { id: string; number: number }
): boolean {
  const code = parseExchangeAuditEventType(eventType);
  const payload = parseRequestAuditPayload(payloadJson);
  if (payload.requestId) return payload.requestId.toLowerCase() === request.id.toLowerCase();
  if (code === 'RequestCreated' && payload.number != null) return payload.number === request.number;
  return false;
}
