/**
 * Socle typé des workflows Studio (4.4a1) : DTO de l'API, unions snake_case, constantes et
 * utilitaires purs. AUCUNE dépendance Angular/PrimeNG (le fichier pourra être tiré dans le
 * chunk `initial` par la navigation). Miroir des records C# :
 * `StudioWorkflowDtos.cs`, `StudioWorkflowApprovalFeatures.cs`, `StudioWorkflowRuntimeFeatures.cs`
 * (les ancres ligne sont reprises en commentaire sur chaque interface).
 */
import { CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import type { RecordViewFilterOp } from '../views/studio-record-views.models';
import { slugifyKey } from '../shared/studio-text.util';

// ---------------------------------------------------------------------------------------------
// Unions (miroir `StudioWorkflowEnumNames`, Domain/Enums/StudioWorkflowEnums.cs l.76–155 :
// les DTO exposent des `string` déjà snake_case).
// ---------------------------------------------------------------------------------------------

export type WorkflowTrigger = 'on_create' | 'on_update' | 'field_changed' | 'manual' | 'scheduled'; // 'scheduled' accepté depuis 4.7b1 (cron UTC + filtres)
export type WorkflowInstanceStatus = 'running' | 'waiting' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
export type WorkflowStepRunStatus = 'succeeded' | 'skipped' | 'failed' | 'suspended';
export type WorkflowApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
export type WorkflowStepOutcome = 'continue' | 'skip' | 'goto' | 'stop' | 'suspend' | 'fail';
export type WorkflowStepType = 'condition' | 'update_field' | 'erp_action' | 'notify' | 'approval' | 'wait' | 'create_record';
export type StepPropertyKind = 'string' | 'int' | 'bool' | 'field' | 'fieldMap' | 'filters' | 'mapping' | 'recipient' | 'template' | 'enum' | 'entity'; // StudioWorkflowStepTypes.cs l.170 (D9)

// ---------------------------------------------------------------------------------------------
// DTO (miroir `StudioWorkflowDtos.cs` l.9–132, `StudioWorkflowApprovalFeatures.cs` l.16–36,
// `StudioWorkflowRuntimeFeatures.cs` l.18–21).
// ---------------------------------------------------------------------------------------------

/** StudioWorkflowStepsSpec.cs — config `field_changed` (`field`/`from`/`to`) et `scheduled` (`cron` + `filters`, 4.7b1/b4), ≤ 2 Ko. */
export interface WorkflowTriggerConfig { field?: string; from?: unknown; to?: unknown; cron?: string; filters?: WorkflowFilterSpec[] }

/** Filtre de condition ; `value2` = borne haute de `between`. */
export interface WorkflowFilterSpec { field: string; op: RecordViewFilterOp; value?: unknown; value2?: unknown }

export interface WorkflowParamMapping { param: string; source: 'field' | 'const' | 'template'; value: string | null }

/** `approval.assignee` : `user` | `role` seulement ; `startedBy` réservé à `notify.to`. */
export interface WorkflowRecipient { kind: 'user' | 'role' | 'startedBy'; value?: string | null }

export type WorkflowStepSpec = { key: string; type: WorkflowStepType; label?: string | null } & Record<string, unknown>;

export interface WorkflowStepsDocument { version: 1; steps: WorkflowStepSpec[] }

/** StudioWorkflowDtos.cs l.9–17. */
export interface SaveWorkflowRequest { key: string; name: string; description?: string | null; trigger: WorkflowTrigger; triggerConfig?: WorkflowTriggerConfig | null; steps: WorkflowStepsDocument; isActive: boolean; rowVersion?: string | null }

/** StudioWorkflowDtos.cs l.27. */
export interface WorkflowValidationIssueDto { path: string; message: string }

/** StudioWorkflowDtos.cs l.20–24. */
export interface WorkflowValidationResultDto { isValid: boolean; errors: WorkflowValidationIssueDto[]; warnings: WorkflowValidationIssueDto[]; stepCount: number }

/** StudioWorkflowDtos.cs l.40–47. */
export interface StepCatalogPropertyDto { name: string; kind: StepPropertyKind; required: boolean; help: string; allowedValues?: string[] | null; min?: number | null; max?: number | null }

/** StudioWorkflowDtos.cs l.33–37. */
export interface StepCatalogEntryDto { type: WorkflowStepType; label: string; description: string; properties: StepCatalogPropertyDto[] }

/** StudioWorkflowDtos.cs l.30 — `{ entries }` seulement (D8). */
export interface WorkflowStepCatalogDto { entries: StepCatalogEntryDto[] }

/** StudioWorkflowDtos.cs l.54–69. */
export interface WorkflowDefinitionDto { id: string; entityDefinitionId: string; key: string; name: string; description: string | null; trigger: WorkflowTrigger; triggerConfig: WorkflowTriggerConfig | null; steps: WorkflowStepsDocument; stepCount: number; version: number; isActive: boolean; openInstances: number; createdAt: string; updatedAt: string; rowVersion: string }

/**
 * StudioWorkflowDtos.cs l.72–90 — 18 champs (D-44-01 : `entityDefinitionId` + `originInstanceId`).
 * D-44-27 : `workflowKey` / `workflowName` sont `string?` côté C# — null quand la définition a
 * été supprimée (StudioWorkflowFeatures.cs l.847, `d?.Key` / `d?.Name`).
 */
export interface WorkflowInstanceDto { id: string; workflowDefinitionId: string; entityDefinitionId: string; workflowKey: string | null; workflowName: string | null; definitionVersion: number; recordId: string; trigger: WorkflowTrigger; status: WorkflowInstanceStatus; currentStepIndex: number; currentStepKey: string | null; dueAt: string | null; startedBy: string | null; startedAt: string; completedAt: string | null; depth: number; originInstanceId: string | null; error: string | null; startedByName?: string | null }

/**
 * StudioWorkflowDtos.cs l.93–102. D-44-28 : `finishedAt` est `DateTime` NON nullable côté C#
 * (toujours renseigné à l'enregistrement de la ligne, moteur `RunSegmentAsync`) — jamais null sur
 * le fil (l'annexe indiquait `string | null`).
 */
export interface WorkflowStepRunDto { stepIndex: number; stepKey: string; stepType: WorkflowStepType; status: WorkflowStepRunStatus; outcome: WorkflowStepOutcome | null; result: Record<string, unknown> | null; error: string | null; startedAt: string; finishedAt: string }

/** StudioWorkflowDtos.cs l.105–119. */
export interface WorkflowApprovalDto { id: string; instanceId: string; stepKey: string; assigneeUserId: string | null; assigneeRole: string | null; title: string; message: string | null; status: WorkflowApprovalStatus; decidedBy: string | null; decidedAt: string | null; comment: string | null; dueAt: string | null; createdAt: string; rowVersion: string }

/** StudioWorkflowDtos.cs l.122–126. */
export interface WorkflowInstanceDetailDto { instance: WorkflowInstanceDto; steps: WorkflowStepRunDto[]; approvals: WorkflowApprovalDto[]; context: Record<string, unknown> }

/** StudioWorkflowDtos.cs l.132. */
export interface WorkflowDeletionResultDto { cancelledInstances: number }

/**
 * StudioWorkflowApprovalFeatures.cs l.28–38 — forme IMBRIQUÉE : l'approbation + son contexte
 * d'affichage (`workflowKey`/`workflowName` valent « — » si la définition a été supprimée).
 * `startedByName` (4.5a2 — nom lisible du demandeur, `null` si utilisateur supprimé / inconnu) est
 * ajouté EN FIN du contrat et optionnel côté TS : tolère un backend pas encore déployé.
 */
export interface WorkflowApprovalInboxItemDto { approval: WorkflowApprovalDto; instanceId: string; workflowKey: string; workflowName: string; entityKey: string; entityName: string; recordId: string; recordLabel: string | null; startedBy: string | null; startedAt: string; startedByName?: string | null }

/** StudioWorkflowRuntimeFeatures.cs l.19. */
export interface RunnableWorkflowDto { id: string; key: string; name: string; description: string | null; stepCount: number }

/** StudioWorkflowDtos.cs (4.5c2) — ligne de la liste globale du tenant : définition + table porteuse (`PagedResult` côté API, D-44-20). */
export interface WorkflowDefinitionListItemDto { workflow: WorkflowDefinitionDto; entityKey: string; entityDisplayName: string }

/** StudioWorkflowApprovalFeatures.cs l.22. */
export interface ApprovalCountDto { count: number }

/** StudioWorkflowApprovalFeatures.cs l.17. */
export interface ApprovalDecisionRequest { comment?: string | null }

/** StudioWorkflowDtos.cs l.129. */
export interface WorkflowToggleRequest { isActive: boolean }

/** StudioWorkflowRuntimeFeatures.cs l.22 (`CancelInstanceRequest`, motif ≤ 500 caractères). */
export interface WorkflowCancelRequest { reason?: string | null }

// ---------------------------------------------------------------------------------------------
// Constantes (miroir `StudioWorkflowStepsSpec.cs` l.40–49, `StudioKey.cs` l.32,
// `StudioWorkflowFeatures.cs` `MaxCopies = 9` l.656,
// `StudioWorkflowRuntimeFeatures.cs` `MaxReasonLength = 500` l.214).
// ---------------------------------------------------------------------------------------------

export const WORKFLOW_LIMITS = { maxWorkflowsPerEntity: 20, maxSteps: 30, maxFilters: 10, maxSetPairs: 10, maxMapping: 20, maxDueHours: 720, maxStepsJsonBytes: 65_536, maxTriggerConfigBytes: 2_048, maxCancelReason: 500, maxCopies: 9, maxInstancesPerRecord: 200 } as const;
export const STEP_KEY_REGEX = /^[a-z][a-z0-9_]{1,63}$/;   // StudioKey.IsValidShape
export const SAVE_AS_REGEX = /^[a-z][a-z0-9_]{0,31}$/;    // SaveAsRegex
export const COMPUTED_FIELD_TYPES: readonly CustomFieldType[] = [CustomFieldType.AutoNumber, CustomFieldType.Formula, CustomFieldType.Lookup, CustomFieldType.Rollup]; // D16 (enum l.6–29 : 16, 17, 18, 19)
export const WORKFLOW_TRIGGERS: readonly { value: WorkflowTrigger; soon?: true }[] = [{ value: 'on_create' }, { value: 'on_update' }, { value: 'field_changed' }, { value: 'manual' }, { value: 'scheduled' }]; // 4.7b4 : 'scheduled' sélectionnable (`soon` reste pour de futurs déclencheurs)

/**
 * Variables de gabarit « {{…}} » réellement résolues par `StudioTemplateRenderer.cs` l.69–91 :
 * champ nu (`{{montant}}`), `{{_now}}` et chemins de contexte `_previous`, `_approval`, `_results`,
 * `_startedBy` (PAS de préfixe `record.` ni de jeton `{{startedBy}}` nu — D-44-29).
 */
export const TEMPLATE_VARIABLES: readonly string[] = ['{{<champ>}}', '{{_now}}', '{{_previous.<champ>}}', '{{_approval.<clé>.status}}', '{{_results.<clé>.<prop>}}', '{{_startedBy.email}}'];

export const WORKFLOW_STEP_TYPES: readonly WorkflowStepType[] = ['condition', 'update_field', 'erp_action', 'notify', 'approval', 'wait', 'create_record'];
export const OPEN_INSTANCE_STATUSES: readonly WorkflowInstanceStatus[] = ['running', 'waiting', 'waiting_approval'];

// ---------------------------------------------------------------------------------------------
// Utilitaires purs.
// ---------------------------------------------------------------------------------------------

/** Sous-ensemble strict de l'union `severity` de p-tag (tag.d.ts l.31) ; `'contrast'` non utilisé — fait foi pour 4.4e2/4.4f et la partie B. */
export type WorkflowSeverity = 'success' | 'info' | 'warn' | 'danger' | 'secondary';

export function isOpenInstance(status: WorkflowInstanceStatus): boolean { return OPEN_INSTANCE_STATUSES.includes(status); }

export function instanceStatusSeverity(status: WorkflowInstanceStatus): WorkflowSeverity {
  switch (status) { case 'completed': return 'success'; case 'running': return 'info'; case 'waiting': case 'waiting_approval': return 'warn'; case 'failed': return 'danger'; default: return 'secondary'; }
}

export function approvalStatusSeverity(status: WorkflowApprovalStatus): WorkflowSeverity {
  switch (status) { case 'approved': return 'success'; case 'pending': return 'warn'; case 'rejected': case 'expired': return 'danger'; default: return 'secondary'; }
}

export function stepRunStatusSeverity(status: WorkflowStepRunStatus): WorkflowSeverity {
  switch (status) { case 'succeeded': return 'success'; case 'suspended': return 'warn'; case 'failed': return 'danger'; default: return 'secondary'; }
}

/** Enveloppe de `slugifyKey` (shared/studio-text.util.ts, 4.5h) ; préfixe `wf_` si chiffre initial (D-44-12). */
export function slugifyWorkflowKey(input: string): string { return slugifyKey(input, 'wf_'); }

export function stepsJsonBytes(doc: WorkflowStepsDocument): number { return new TextEncoder().encode(JSON.stringify(doc)).length; }

// ---------------------------------------------------------------------------------------------
// 4.7c2 — trace de la simulation pure `POST workflows/{id}/test` (4.7c1, R17). Les verdicts
// sont figés côté serveur (`WorkflowTestVerdicts`) : ne jamais traduire ces valeurs.
// ---------------------------------------------------------------------------------------------

export const WORKFLOW_TEST_VERDICTS = {
  wouldRun: 'would_run',
  skipped: 'skipped',
  wouldSuspend: 'would_suspend',
  wouldFail: 'would_fail',
} as const;

export type WorkflowTestVerdict = (typeof WORKFLOW_TEST_VERDICTS)[keyof typeof WORKFLOW_TEST_VERDICTS];

export interface WorkflowTestStepTraceDto {
  key: string;
  type: string;
  label: string | null;
  verdict: string;
  detail: string | null;
  rendered: Record<string, unknown> | null;
}

export interface WorkflowTestResultDto {
  recordId: string;
  entityKey: string;
  evaluatedSteps: number;
  suspended: boolean;
  steps: WorkflowTestStepTraceDto[];
  warnings: string[];
}
