/**
 * View-model pur de la page « Mes approbations » (4.4g2) — AUCUNE dépendance
 * Angular/PrimeNG (testé isolément). `ApprovalRow` aplatit
 * `WorkflowApprovalInboxItemDto` (forme imbriquée H-1) pour le tableau :
 * `id` = `approval.id` (identifiant de décision et `dataKey` de la table) — D-44-80.
 * « Demandé par » (4.5e, D-45-F06) : `startedByName` fourni par l'API (4.5a2), `null` si
 * inconnu ⇒ « — » à l'affichage (jamais de repli sur le Guid `startedBy`, D-44-79 levé).
 */
import type { WorkflowApprovalInboxItemDto, WorkflowApprovalStatus } from '../workflows/studio-workflows.models';

/** Ligne de tableau aplatie depuis `WorkflowApprovalInboxItemDto` (D-44-80) — `id` = `approval.id`. */
export interface ApprovalRow {
  id: string; instanceId: string; workflowKey: string; workflowName: string; stepTitle: string;
  entityKey: string; entityName: string; recordId: string; recordLabel: string | null;
  message: string | null; createdAt: string; dueAt: string | null; startedAt: string;
  startedByName: string | null;
  status: WorkflowApprovalStatus; rowVersion: string;
  /** 4.7 « v1.1 » (ap-f) : renseignés par la route historique (inbox ⇒ `null`). */
  decidedAt: string | null; comment: string | null;
}

export function toApprovalRow(item: WorkflowApprovalInboxItemDto): ApprovalRow {
  const a = item.approval;
  return { id: a.id, instanceId: item.instanceId, workflowKey: item.workflowKey, workflowName: item.workflowName,
           stepTitle: a.title?.trim() || a.stepKey, entityKey: item.entityKey, entityName: item.entityName,
           recordId: item.recordId, recordLabel: item.recordLabel, message: a.message, createdAt: a.createdAt,
           dueAt: a.dueAt, startedAt: item.startedAt, startedByName: item.startedByName ?? null,
           status: a.status, rowVersion: a.rowVersion, decidedAt: a.decidedAt ?? null, comment: a.comment ?? null };
}

export type ApprovalDueState = 'late' | 'soon' | 'later' | 'none';

const DAY_MS = 86_400_000, HOUR_MS = 3_600_000;

export function dueState(dueAt: string | null | undefined, nowMs: number): ApprovalDueState {
  if (!dueAt) return 'none';
  const due = Date.parse(dueAt); if (Number.isNaN(due)) return 'none';
  if (due < nowMs) return 'late';
  return due - nowMs <= DAY_MS ? 'soon' : 'later';                         // D17 : « Sous 24 h » = échéance future ≤ 24 h
}

export function dueLabel(dueAt: string | null | undefined, nowMs: number): string {
  const state = dueState(dueAt, nowMs); if (state === 'none') return '—';
  const delta = Math.abs(Date.parse(dueAt!) - nowMs);
  const amount = delta >= DAY_MS ? `${Math.floor(delta / DAY_MS)} j` : `${Math.max(1, Math.round(delta / HOUR_MS))} h`;
  return state === 'late' ? `En retard de ${amount}` : `Dans ${amount}`;
}

export function approvalKpis(rows: readonly ApprovalRow[], nowMs: number): { pending: number; late: number; soon: number } {
  let late = 0, soon = 0;
  for (const row of rows) { const s = dueState(row.dueAt, nowMs); if (s === 'late') late++; else if (s === 'soon') soon++; }
  return { pending: rows.length, late, soon };
}
