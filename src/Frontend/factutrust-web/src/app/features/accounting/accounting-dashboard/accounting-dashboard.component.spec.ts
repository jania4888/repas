import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFrTN from '@angular/common/locales/fr-TN';
import localeFrTNExtra from '@angular/common/locales/extra/fr-TN';
import { FirmContextService } from '@core/services/firm-context.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AccountingService, AccountingOverviewDashboardDto } from '../services/accounting.service';
import { FiscalScheduleService } from '../services/fiscal-schedule.service';
import { AccountingDashboardComponent } from './accounting-dashboard.component';

// `AppDatePipe` résout la locale FR vers 'fr-TN' (@core/i18n/erp-locale.types) ; cette
// donnée de locale n'est enregistrée qu'au boot (src/main.ts) et doit donc être ajoutée
// ici pour que le pipe fonctionne dans l'environnement de test Karma.
registerLocaleData(localeFrTN, 'fr-TN', localeFrTNExtra);

function buildOverview(overrides: Partial<AccountingOverviewDashboardDto> = {}): AccountingOverviewDashboardDto {
  const kpi = { current: 1000, previous: 900, deltaAbsolute: 100, deltaPercent: 11.1 };
  return {
    fiscalYear: 2026,
    month: 10,
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    periodLabel: 'Octobre 2026',
    comparison: 'previous-month',
    comparisonFiscalYear: 2026,
    comparisonMonth: 9,
    comparisonLabel: 'vs Septembre 2026',
    currency: 'TND',
    generatedAt: '2026-10-17T10:00:00Z',
    hasEntriesInPeriod: true,
    availableYears: [2025, 2026],
    totalRevenue: kpi,
    totalExpenses: kpi,
    netResult: kpi,
    availableCash: kpi,
    revenueByMonth: [{ month: 1, label: 'Jan', current: 100, previousYear: 90 }],
    netResultByMonth: [{ month: 1, label: 'Jan', revenue: 100, expenses: 50, netResult: 50 }],
    expenseBreakdown: [{ key: 'purchases', label: 'Achats', amount: 100, percent: 50 }],
    mainAccounts: [
      {
        accountPrefix: '512',
        label: 'Banque',
        nature: 'Debit',
        balance: 1000,
        previousBalance: 900,
        deltaAbsolute: 100,
        deltaPercent: 11.1,
        sparkline: [1, 2, 3]
      }
    ],
    clients: { asOf: '2026-10-17', total: 500, notDue: 400, overdue: 100, thirdPartyCount: 3 },
    suppliers: { asOf: '2026-10-17', total: 200, notDue: 150, overdue: 50, thirdPartyCount: 2 },
    recentEntries: [
      {
        id: 'e1',
        entryDate: '2026-10-15',
        journalCode: 'VT',
        entryNumber: 1,
        pieceRef: 'F-1',
        label: 'Vente',
        totalDebit: 100,
        totalCredit: 100,
        isReversed: false
      }
    ],
    upcomingDeadlines: [
      {
        id: 'd1',
        obligationType: 0,
        obligationLabel: 'TVA mensuelle',
        dueDate: '2026-10-28',
        daysRemaining: 3,
        estimatedAmount: 300,
        currency: 'TND',
        status: 0,
        statusDisplay: 'En attente'
      }
    ],
    recentDocuments: [
      {
        id: 'doc1',
        source: 'journal-entry',
        ownerId: 'e1',
        ownerLabel: 'Vente',
        fileName: 'facture.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        createdAt: '2026-10-17T09:00:00Z',
        downloadPath: '/x'
      }
    ],
    warnings: [],
    ...overrides
  };
}

describe('AccountingDashboardComponent', () => {
  let fixture: ComponentFixture<AccountingDashboardComponent>;
  let component: AccountingDashboardComponent;

  const apiSpy = jasmine.createSpyObj<AccountingService>('AccountingService', [
    'getDashboardOverview',
    'downloadEntryAttachment'
  ]);
  const fiscalScheduleSpy = jasmine.createSpyObj<FiscalScheduleService>('FiscalScheduleService', [
    'downloadAttachment'
  ]);
  const firmContextSpy = jasmine.createSpyObj<FirmContextService>('FirmContextService', [], {
    activeClient: signal({ tenantId: 't1', companyName: 'Client Delta' })
  });
  const errorHandlerSpy = jasmine.createSpyObj<ErrorHandlerService>('ErrorHandlerService', ['extractErrorMessage']);

  beforeEach(async () => {
    apiSpy.getDashboardOverview.calls.reset();
    apiSpy.downloadEntryAttachment.calls.reset();
    fiscalScheduleSpy.downloadAttachment.calls.reset();
    errorHandlerSpy.extractErrorMessage.and.returnValue('Erreur réseau');

    apiSpy.getDashboardOverview.and.returnValue(of({ success: true, data: buildOverview() }));

    await TestBed.configureTestingModule({
      imports: [AccountingDashboardComponent],
      providers: [
        provideRouter([]),
        { provide: AccountingService, useValue: apiSpy },
        { provide: FiscalScheduleService, useValue: fiscalScheduleSpy },
        { provide: FirmContextService, useValue: firmContextSpy },
        { provide: ErrorHandlerService, useValue: errorHandlerSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AccountingDashboardComponent);
    component = fixture.componentInstance;
  });

  it('shows the loading skeleton before the first response arrives', () => {
    apiSpy.getDashboardOverview.and.returnValue(of({ success: true, data: buildOverview() }).pipe());
    fixture.detectChanges();
    expect(component.loading()).toBeFalse(); // of() emits synchronously, so loading flips immediately
  });

  it('renders the 4 KPI cards and the dossier name in the subtitle once loaded', () => {
    fixture.detectChanges();
    expect(component.data()).toBeTruthy();
    expect(component.subtitle()).toContain('Client Delta');

    const statCards = fixture.nativeElement.querySelectorAll('app-stat-card');
    expect(statCards.length).toBe(4);
  });

  it('shows the empty state when the period has no validated entries', () => {
    apiSpy.getDashboardOverview.and.returnValue(of({ success: true, data: buildOverview({ hasEntriesInPeriod: false }) }));
    fixture.detectChanges();

    expect(component.isEmpty()).toBeTrue();
    const emptyState = fixture.nativeElement.querySelector('app-empty-state');
    expect(emptyState).toBeTruthy();
  });

  it('shows the error banner when the API responds with success: false', () => {
    apiSpy.getDashboardOverview.and.returnValue(of({ success: false, error: 'Boom' }));
    fixture.detectChanges();

    expect(component.error()).toBe('Boom');
    const banner = fixture.nativeElement.querySelector('app-accounting-status-banner');
    expect(banner).toBeTruthy();
  });

  it('shows the error banner when the request throws (network error)', () => {
    apiSpy.getDashboardOverview.and.returnValue(throwError(() => new Error('network down')));
    fixture.detectChanges();

    expect(errorHandlerSpy.extractErrorMessage).toHaveBeenCalled();
    expect(component.error()).toBe('Erreur réseau');
  });

  it('reloads with the selected period and comparison when the period changes', () => {
    fixture.detectChanges();
    apiSpy.getDashboardOverview.calls.reset();
    apiSpy.getDashboardOverview.and.returnValue(of({ success: true, data: buildOverview() }));

    component.onPeriodChange('2025-3');
    fixture.detectChanges();

    expect(apiSpy.getDashboardOverview).toHaveBeenCalledWith(
      jasmine.objectContaining({ fiscalYear: 2025, month: 3, comparison: 'previous-month' })
    );
  });

  it('calls window.print when exporting', () => {
    fixture.detectChanges();
    const printSpy = spyOn(window, 'print');
    jasmine.clock().install();
    component.print();
    expect(component.printing()).toBeTrue();
    jasmine.clock().tick(1);
    jasmine.clock().uninstall();
    expect(printSpy).toHaveBeenCalled();
  });

  it('downloads via the journal-entry service when the document source is a journal entry', () => {
    fixture.detectChanges();
    apiSpy.downloadEntryAttachment.and.returnValue(of(new Blob(['x'])));

    component.downloadDocument(buildOverview().recentDocuments[0]);

    expect(apiSpy.downloadEntryAttachment).toHaveBeenCalledWith('e1', 'doc1');
    expect(fiscalScheduleSpy.downloadAttachment).not.toHaveBeenCalled();
  });

  it('downloads via the fiscal-schedule service when the document source is a fiscal schedule', () => {
    fixture.detectChanges();
    fiscalScheduleSpy.downloadAttachment.and.returnValue(of(new Blob(['x'])));

    component.downloadDocument({ ...buildOverview().recentDocuments[0], source: 'fiscal-schedule' });

    expect(fiscalScheduleSpy.downloadAttachment).toHaveBeenCalledWith('e1', 'doc1');
    expect(apiSpy.downloadEntryAttachment).not.toHaveBeenCalled();
  });
});
