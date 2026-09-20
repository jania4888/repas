import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ProjectBillingTabComponent } from './project-billing.tab';
import { BillableProjectTask, BillableProjectTimeEntry, ProjectApiService } from '../project-api.service';

describe('ProjectBillingTabComponent', () => {
  let component: ProjectBillingTabComponent;
  let apiSpy: jasmine.SpyObj<ProjectApiService>;

  beforeEach(async () => {
    apiSpy = jasmine.createSpyObj<ProjectApiService>('ProjectApiService', ['compatibleDraftInvoices']);
    apiSpy.compatibleDraftInvoices.and.returnValue(of({ success: true, data: [] }));

    await TestBed.configureTestingModule({
      imports: [ProjectBillingTabComponent],
      providers: [{ provide: ProjectApiService, useValue: apiSpy }]
    }).compileComponents();

    const fixture: ComponentFixture<ProjectBillingTabComponent> = TestBed.createComponent(ProjectBillingTabComponent);
    component = fixture.componentInstance;
    component.project = {
      id: 'proj-1',
      name: 'P',
      clientId: 'c1',
      clientName: 'Client',
      status: 'Active',
      currency: 'TND'
    } as never;
  });

  const sampleTimeEntry = (id: string, eligible = true): BillableProjectTimeEntry => ({
    id,
    userId: 'u1',
    userName: 'Alice',
    workDate: '2026-08-01',
    hours: 5,
    hourlyRate: 80,
    previewAmountHt: 400,
    isEligible: eligible,
    blockReason: eligible ? null : 'Pas de tarif de vente'
  });

  it('canInvoiceTasks requires selected tasks with amounts in fixed mode', () => {
    component.taskBillingMethod = 'fixed';
    component.billableTasks = [{ id: 't1', title: 'A', uninvoicedBillableHours: 0, hourlyRate: 0, previewAmountHt: 0, isEligible: true }];
    component.toggleTaskSelected('t1', true);
    expect(component.canInvoiceTasks).toBe(false);

    component.taskAmounts['t1'] = 100;
    expect(component.canInvoiceTasks).toBe(true);
  });

  it('canInvoiceTasks requires eligible tasks with hourly rate in hourly mode', () => {
    component.taskBillingMethod = 'hourly';
    component.billableTasks = [
      { id: 't1', title: 'A', uninvoicedBillableHours: 5, hourlyRate: 80, previewAmountHt: 400, isEligible: true },
      { id: 't2', title: 'B', uninvoicedBillableHours: 2, hourlyRate: 0, previewAmountHt: 0, isEligible: false, blockReason: 'Pas de tarif' }
    ] as BillableProjectTask[];

    component.toggleTaskSelected('t1', true);
    component.taskHourlyRates['t1'] = 80;
    expect(component.canInvoiceTasks).toBe(true);

    component.taskHourlyRates['t1'] = 0;
    expect(component.canInvoiceTasks).toBe(false);

    component.taskHourlyRates['t1'] = 80;
    component.toggleTaskSelected('t2', true);
    expect(component.canInvoiceTasks).toBe(false);
  });

  it('canInvoiceSelectedTime is false without selection', () => {
    component.billableTimeEntries = [sampleTimeEntry('e1')];
    expect(component.canInvoiceSelectedTime).toBeFalse();
  });

  it('canInvoiceSelectedTime is true with eligible selection', () => {
    component.billableTimeEntries = [sampleTimeEntry('e1')];
    component.toggleTimeEntrySelected('e1', true);
    expect(component.canInvoiceSelectedTime).toBeTrue();
  });

  it('canInvoiceSelectedTime is false when ineligible entry is selected', () => {
    component.billableTimeEntries = [sampleTimeEntry('e1', false)];
    component.selectedTimeEntryIds.add('e1');
    expect(component.canInvoiceSelectedTime).toBeFalse();
  });

  it('emitInvoiceTime transmits timeEntryIds', () => {
    const spy = jasmine.createSpy('invoiceTime');
    component.invoiceTime.subscribe(spy);
    component.timeNotes = 'note';
    component.toggleTimeEntrySelected('e1', true);
    component.toggleTimeEntrySelected('e2', true);
    component.emitInvoiceTime();
    expect(spy).toHaveBeenCalledWith({ groupBy: 'member', notes: 'note', timeEntryIds: ['e1', 'e2'], targetInvoiceId: undefined });
  });

  it('onTimeGroupByChange to member emits refreshBillableTimeEntries', () => {
    const spy = jasmine.createSpy('refreshTime');
    component.refreshBillableTimeEntries.subscribe(spy);
    component.timeGroupBy = 'member';
    component.onTimeGroupByChange();
    expect(spy).toHaveBeenCalled();
    expect(component.selectedTimeEntryIds.size).toBe(0);
  });

  it('selectedTimeSummary sums selected eligible entries', () => {
    component.billableTimeEntries = [
      sampleTimeEntry('e1'),
      { ...sampleTimeEntry('e2'), hours: 2, previewAmountHt: 160 }
    ];
    component.toggleTimeEntrySelected('e1', true);
    component.toggleTimeEntrySelected('e2', true);
    expect(component.selectedTimeSummary.hours).toBe(7);
    expect(component.selectedTimeSummary.amountHt).toBe(560);
  });

  it('toggleAllEligibleTime selects only eligible entries', () => {
    component.billableTimeEntries = [sampleTimeEntry('e1'), sampleTimeEntry('e2', false)];
    component.toggleAllEligibleTime(true);
    expect(component.selectedTimeEntryIds.has('e1')).toBeTrue();
    expect(component.selectedTimeEntryIds.has('e2')).toBeFalse();
  });

  it('emitInvoiceTasks builds payload for fixed mode', () => {
    const spy = jasmine.createSpy('invoiceTasks');
    component.invoiceTasks.subscribe(spy);
    component.taskBillingMethod = 'fixed';
    component.toggleTaskSelected('t1', true);
    component.taskAmounts['t1'] = 250;
    component.timeNotes = 'forfait';
    component.emitInvoiceTasks();
    expect(spy).toHaveBeenCalledWith({
      method: 'fixed',
      notes: 'forfait',
      tasks: [{ taskId: 't1', amountHt: 250, hourlyRate: undefined }],
      targetInvoiceId: undefined
    });
  });

  it('taskHourlyTotal recalculates when rate changes', () => {
    component.billableTasks = [
      { id: 't1', title: 'A', uninvoicedBillableHours: 3, hourlyRate: 90, previewAmountHt: 270, isEligible: true }
    ] as BillableProjectTask[];
    component.taskHourlyRates['t1'] = 100;
    expect(component.taskHourlyTotal('t1')).toBe(300);
  });

  it('emitInvoiceTasks builds payload for hourly mode', () => {
    const spy = jasmine.createSpy('invoiceTasks');
    component.invoiceTasks.subscribe(spy);
    component.taskBillingMethod = 'hourly';
    component.toggleTaskSelected('t1', true);
    component.taskHourlyRates['t1'] = 100;
    component.emitInvoiceTasks();
    expect(spy).toHaveBeenCalledWith({
      method: 'hourly',
      notes: undefined,
      tasks: [{ taskId: 't1', amountHt: undefined, hourlyRate: 100 }],
      targetInvoiceId: undefined
    });
  });

  it('openInvoiceTargetDialog with no drafts emits invoiceTime without opening modal', () => {
    const spy = jasmine.createSpy('invoiceTime');
    component.invoiceTime.subscribe(spy);
    component.billableTimeEntries = [sampleTimeEntry('e1')];
    component.toggleTimeEntrySelected('e1', true);
    apiSpy.compatibleDraftInvoices.and.returnValue(of({ success: true, data: [] }));

    component.openInvoiceTargetDialog('time');

    expect(component.invoiceTargetVisible).toBeFalse();
    expect(spy).toHaveBeenCalledWith({
      groupBy: 'member',
      notes: undefined,
      timeEntryIds: ['e1'],
      targetInvoiceId: undefined
    });
  });

  it('openInvoiceTargetDialog with no drafts emits invoiceTasks without opening modal', () => {
    const spy = jasmine.createSpy('invoiceTasks');
    component.invoiceTasks.subscribe(spy);
    component.taskBillingMethod = 'fixed';
    component.billableTasks = [
      { id: 't1', title: 'A', uninvoicedBillableHours: 0, hourlyRate: 0, previewAmountHt: 0, isEligible: true }
    ];
    component.toggleTaskSelected('t1', true);
    component.taskAmounts['t1'] = 150;
    apiSpy.compatibleDraftInvoices.and.returnValue(of({ success: true, data: [] }));

    component.openInvoiceTargetDialog('tasks');

    expect(component.invoiceTargetVisible).toBeFalse();
    expect(spy).toHaveBeenCalledWith({
      method: 'fixed',
      notes: undefined,
      tasks: [{ taskId: 't1', amountHt: 150, hourlyRate: undefined }],
      targetInvoiceId: undefined
    });
  });

  it('openInvoiceTargetDialog with drafts opens modal without immediate emit', () => {
    const spy = jasmine.createSpy('invoiceTime');
    component.invoiceTime.subscribe(spy);
    apiSpy.compatibleDraftInvoices.and.returnValue(
      of({
        success: true,
        data: [{ invoiceId: 'inv-1', number: 'FAC-1', issueDate: '2026-01-01', amountHT: 100, lineCount: 1 }]
      })
    );

    component.openInvoiceTargetDialog('time');

    expect(component.invoiceTargetVisible).toBeTrue();
    expect(spy).not.toHaveBeenCalled();
    expect(component.preloadedDraftInvoices.length).toBe(1);
  });

  it('openInvoiceTargetDialog on API error emits invoiceDraftLoadError', () => {
    const errSpy = jasmine.createSpy('draftLoadError');
    component.invoiceDraftLoadError.subscribe(errSpy);
    apiSpy.compatibleDraftInvoices.and.returnValue(throwError(() => new Error('network')));

    component.openInvoiceTargetDialog('time');

    expect(errSpy).toHaveBeenCalled();
    expect(component.invoiceTargetVisible).toBeFalse();
  });
});
