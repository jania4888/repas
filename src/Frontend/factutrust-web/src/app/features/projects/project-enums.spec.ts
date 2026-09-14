import {
  billingOptionsForKind,
  canActivate,
  canBeBilled,
  canComplete,
  canHold,
  canHoldOrComplete,
  canReceiveTime,
  canCreateTimeEntry,
  canLogTime,
  showTimeTab,
  showTaskTimeTab,
  canProcessTimeEntries,
  canEditTimeEntry,
  canDeleteTimeEntry,
  canSubmitTimeEntry,
  canValidateTimeEntry,
  canReopenTimeEntry,
  canReopenSubmittedTimeEntry,
  canReopenValidatedTimeEntry,
  timeEntryStatusLabel,
  timeEntryStatusBadge,
  timesheetsDisabledMessage,
  cannotReceiveTimeMessage,
  defaultBillingForKind,
  isBtp,
  isEsn,
  isFixedPriceBilling,
  parseProjectBillingMode,
  parseProjectKind,
  parseProjectStatus,
  parseProjectTaskStatus,
  parseProjectTimeStatus,
  projectStatusBadge,
  showMilestones,
  showWorkload,
  taskStatusBadge,
  taskStatusForPhaseSortOrder,
  computeProjectProgressPercent,
  defaultKanbanColumnsForKind,
  formatDaysUntilDue,
  projectKindPillClass,
  projectUiProfile,
  TUNISIAN_VAT_OPTIONS,
  timeStatusBadge
} from './project-enums';
import { formatLocalDate } from '@core/utils/date.util';

describe('project-enums', () => {
  it('parses project status from PascalCase, camelCase and numbers', () => {
    expect(parseProjectStatus('Draft')).toBe('Draft');
    expect(parseProjectStatus('draft')).toBe('Draft');
    expect(parseProjectStatus(0)).toBe('Draft');
    expect(parseProjectStatus('0')).toBe('Draft');
    expect(parseProjectStatus('Active')).toBe('Active');
    expect(parseProjectStatus(1)).toBe('Active');
    expect(parseProjectStatus('OnHold')).toBe('OnHold');
    expect(parseProjectStatus(2)).toBe('OnHold');
  });

  it('exposes lifecycle helpers matching backend CanReceiveTime / CanBeBilled', () => {
    expect(canActivate('Draft')).toBe(true);
    expect(canActivate('OnHold')).toBe(true);
    expect(canActivate('Active')).toBe(false);
    expect(canHold('Active')).toBe(true);
    expect(canHold('OnHold')).toBe(false);
    expect(canComplete('Active')).toBe(true);
    expect(canComplete('OnHold')).toBe(true);
    expect(canComplete('Draft')).toBe(false);
    expect(canHoldOrComplete('Active')).toBe(true);
    expect(canReceiveTime('Draft')).toBe(false);
    expect(canReceiveTime('Active')).toBe(true);
    expect(canBeBilled('Draft')).toBe(false);
    expect(canBeBilled('Active')).toBe(true);
    expect(canBeBilled('Completed')).toBe(true);
    expect(canBeBilled(0)).toBe(false);
    expect(canBeBilled(1)).toBe(true);
  });

  it('filters billing options by kind', () => {
    expect(billingOptionsForKind('Btp').some(o => o.value === 'ProgressSituations')).toBe(true);
    expect(billingOptionsForKind('Esn').some(o => o.value === 'ProgressSituations')).toBe(false);
  });

  it('maps kanban phase sortOrder to task status', () => {
    expect(taskStatusForPhaseSortOrder('Generic', 0)).toBe('Todo');
    expect(taskStatusForPhaseSortOrder('Generic', 3)).toBe('Done');
    expect(taskStatusForPhaseSortOrder('Esn', 4)).toBe('Done');
    expect(taskStatusForPhaseSortOrder('Btp', 1)).toBe('InProgress');
  });

  it('parses kind and billing mode', () => {
    expect(parseProjectKind('Esn')).toBe('Esn');
    expect(parseProjectKind('esn')).toBe('Esn');
    expect(parseProjectKind(1)).toBe('Esn');
    expect(parseProjectKind(2)).toBe('Btp');
    expect(isEsn('Esn')).toBe(true);
    expect(isBtp('Btp')).toBe(true);
    expect(isBtp('Esn')).toBe(false);
    expect(parseProjectBillingMode('TimeAndMaterials')).toBe('TimeAndMaterials');
    expect(parseProjectBillingMode(1)).toBe('TimeAndMaterials');
    expect(parseProjectBillingMode(4)).toBe('ProgressSituations');
    expect(defaultBillingForKind('Esn')).toBe('TimeAndMaterials');
    expect(defaultBillingForKind('Btp')).toBe('ProgressSituations');
    expect(defaultBillingForKind('Generic')).toBe('None');
  });

  it('shows milestones for ESN and Generic+Milestone', () => {
    expect(showMilestones('Esn', 'None')).toBe(true);
    expect(showMilestones('Generic', 'Milestone')).toBe(true);
    expect(showMilestones('Btp', 'ProgressSituations')).toBe(false);
  });

  it('parses task and time statuses and maps badges', () => {
    expect(parseProjectTaskStatus('InProgress')).toBe('InProgress');
    expect(parseProjectTaskStatus(1)).toBe('InProgress');
    expect(parseProjectTimeStatus('Draft')).toBe('Draft');
    expect(parseProjectTimeStatus(0)).toBe('Draft');
    expect(parseProjectTimeStatus(1)).toBe('Submitted');
    expect(projectStatusBadge('Draft')).toBe('draft');
    expect(projectStatusBadge('Active')).toBe('active');
    expect(taskStatusBadge('Done')).toBe('validated');
    expect(timeStatusBadge(0)).toBe('draft');
    expect(timeStatusBadge('Validated')).toBe('validated');
  });

  it('hides the invoice action while the project is still Draft', () => {
    expect(canBeBilled('Draft')).toBe(false);
    expect(canBeBilled('Brouillon')).toBe(false);
  });

  it('gates time logging on project status and timesheets flag', () => {
    expect(canCreateTimeEntry({ status: 'Active', timesheetsEnabled: true })).toBe(true);
    expect(canLogTime({ status: 'Active', timesheetsEnabled: true })).toBe(true);
    expect(canCreateTimeEntry({ status: 'Active', timesheetsEnabled: false })).toBe(false);
    expect(canCreateTimeEntry({ status: 'OnHold', timesheetsEnabled: true })).toBe(false);
    expect(canCreateTimeEntry({ status: 'Completed', timesheetsEnabled: true })).toBe(false);
    expect(timesheetsDisabledMessage()).toContain('désactivée');
    expect(cannotReceiveTimeMessage('OnHold')).toContain('pause');
  });

  it('shows time tab when timesheets enabled on active, on hold or completed projects', () => {
    expect(showTimeTab({ status: 'Active', timesheetsEnabled: true })).toBe(true);
    expect(showTimeTab({ status: 'Active', timesheetsEnabled: false })).toBe(false);
    expect(showTimeTab({ status: 'OnHold', timesheetsEnabled: true })).toBe(true);
    expect(showTimeTab({ status: 'Completed', timesheetsEnabled: true })).toBe(true);
    expect(showTimeTab({ status: 'Draft', timesheetsEnabled: true })).toBe(false);
    expect(showTimeTab({ status: 'Cancelled', timesheetsEnabled: true })).toBe(false);
    expect(canProcessTimeEntries({ status: 'Completed', timesheetsEnabled: true })).toBe(true);
  });

  it('shows task time tab when project time tab is hidden but task has logged hours', () => {
    const projectOff = { status: 'Active', timesheetsEnabled: false };
    expect(showTaskTimeTab(projectOff, { loggedHours: 0 })).toBe(false);
    expect(showTaskTimeTab(projectOff, { loggedHours: 2.5 })).toBe(true);
    expect(showTaskTimeTab({ status: 'Active', timesheetsEnabled: true }, { loggedHours: 0 })).toBe(true);
  });

  it('derives time entry actions and invoiced display', () => {
    const draft = { status: 'Draft', statusDisplay: 'Brouillon' };
    const submitted = { status: 'Submitted', statusDisplay: 'Soumis' };
    const validated = { status: 'Validated', statusDisplay: 'Validé' };
    const invoiced = { status: 'Validated', statusDisplay: 'Validé', invoicedInvoiceId: 'inv-1' };

    expect(canEditTimeEntry(draft)).toBe(true);
    expect(canDeleteTimeEntry(draft)).toBe(true);
    expect(canSubmitTimeEntry(draft)).toBe(true);
    expect(canValidateTimeEntry(draft)).toBe(false);
    expect(canReopenTimeEntry(submitted)).toBe(true);
    expect(canReopenSubmittedTimeEntry(submitted)).toBe(true);
    expect(canReopenValidatedTimeEntry(submitted)).toBe(false);
    expect(canReopenTimeEntry(validated)).toBe(true);
    expect(canReopenValidatedTimeEntry(validated)).toBe(true);
    expect(canEditTimeEntry(invoiced)).toBe(false);
    expect(canReopenTimeEntry(invoiced)).toBe(false);
    expect(timeEntryStatusLabel(invoiced)).toBe('Facturé');
    expect(timeEntryStatusBadge(invoiced)).toBe('paid');
  });

  it('shows workload for ESN and TimeAndMaterials billing', () => {
    expect(showWorkload('Esn', 'None')).toBe(true);
    expect(showWorkload('Generic', 'TimeAndMaterials')).toBe(true);
    expect(showWorkload('Generic', 'FixedPrice')).toBe(false);
    expect(showWorkload('Btp', 'ProgressSituations')).toBe(false);
  });

  it('detects fixed-price billing mode', () => {
    expect(isFixedPriceBilling('FixedPrice')).toBe(true);
    expect(isFixedPriceBilling('TimeAndMaterials')).toBe(false);
    expect(isFixedPriceBilling(2)).toBe(true);
  });

  it('exposes Tunisian VAT options', () => {
    expect(TUNISIAN_VAT_OPTIONS.map(o => o.value)).toEqual([0, 7, 13, 19]);
  });

  it('computes project progress percent safely', () => {
    expect(computeProjectProgressPercent(2, 5)).toBe(40);
    expect(computeProjectProgressPercent(0, 0)).toBe(0);
  });

  it('exposes kanban columns per kind for creation wizard', () => {
    expect(defaultKanbanColumnsForKind('Esn')[0].name).toBe('Backlog');
    expect(defaultKanbanColumnsForKind('Btp')[0].name).toBe('Préparation');
  });

  it('returns UI profile emphasis by kind', () => {
    expect(projectUiProfile('Esn').emphasizeTabs).toContain('time');
    expect(projectUiProfile('Btp').showSiteChip).toBe(true);
  });

  it('formats relative due labels', () => {
    const today = new Date();
    // formatLocalDate et non toISOString() : cette dernière convertit en UTC et décale d'un jour
    // pour les fuseaux positifs. En Tunisie (UTC+1), entre minuit et 1 h, l'UTC est encore la
    // veille — le test échouait donc une heure par nuit, alors que `daysUntilDue` raisonne, lui,
    // en date locale.
    const iso = (d: Date) => formatLocalDate(d);
    expect(formatDaysUntilDue(null)).toBeNull();
    expect(formatDaysUntilDue(iso(today))).toBe("Aujourd'hui");

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(formatDaysUntilDue(iso(tomorrow))).toBe('Demain');

    const late = new Date(today);
    late.setDate(late.getDate() - 3);
    expect(formatDaysUntilDue(iso(late))).toBe('En retard de 3 jours');
  });

  it('maps kind to pill css class', () => {
    expect(projectKindPillClass('Esn')).toBe('proj-kind-pill--esn');
    expect(projectKindPillClass('Btp')).toBe('proj-kind-pill--btp');
    expect(projectKindPillClass('Generic')).toBe('proj-kind-pill--generic');
  });
});
