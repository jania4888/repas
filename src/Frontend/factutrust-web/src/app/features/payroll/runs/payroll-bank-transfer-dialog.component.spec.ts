import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { PayrollBankTransferDialogComponent } from './payroll-bank-transfer-dialog.component';
import { PayrollService } from '@core/services/payroll.service';
import { BankAccountService } from '@core/services/bank-account.service';
import { ToastService } from '@core/services/toast.service';

describe('PayrollBankTransferDialogComponent', () => {
  let fixture: ComponentFixture<PayrollBankTransferDialogComponent>;
  let payroll: jasmine.SpyObj<PayrollService>;

  const emptyPreview = {
    payrollRunId: 'run-1',
    year: 2026,
    month: 8,
    periodLabel: 'Paie 08/2026',
    transferLabel: 'Paie 08/2026',
    eligibleCount: 0,
    totalAmount: 0,
    lines: [],
    excludedLines: [],
    warnings: [{ code: 'EmployeesExcluded', message: 'Aucun éligible' }]
  };

  const fullPreview = {
    ...emptyPreview,
    eligibleCount: 2,
    totalAmount: 2500.5,
    lines: [
      {
        employeeId: 'e1',
        payslipId: 'p1',
        employeeNumber: 'EMP001',
        lastName: 'Ben Ali',
        firstName: 'Ahmed',
        fullName: 'Ahmed Ben Ali',
        rib: '20001234567890123456',
        iban: 'TN5920001234567890123456',
        netSalary: 1500.25,
        transferLabel: 'Paie 08/2026'
      }
    ]
  };

  beforeEach(() => {
    payroll = jasmine.createSpyObj('PayrollService', ['getBankTransferPreview', 'exportBankTransfer']);
    payroll.getBankTransferPreview.and.returnValue(of({ success: true, data: emptyPreview }));
    payroll.exportBankTransfer.and.returnValue(of(new Blob(['x'])));

    TestBed.configureTestingModule({
      imports: [PayrollBankTransferDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: PayrollService, useValue: payroll },
        {
          provide: BankAccountService,
          useValue: { list: () => of({ success: true, data: [] }) }
        },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['add']) }
      ]
    });

    fixture = TestBed.createComponent(PayrollBankTransferDialogComponent);
    fixture.componentRef.setInput('runId', 'run-1');
    fixture.componentRef.setInput('periodLabel', 'Paie 08/2026');
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
  });

  it('loads preview on open and disables download when empty', () => {
    fixture.componentInstance.onOpen();
    fixture.detectChanges();
    expect(payroll.getBankTransferPreview).toHaveBeenCalled();
    expect(fixture.componentInstance.canDownload()).toBeFalse();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Télécharger CSV');
  });

  it('hides an incomplete chart projection from the transfer account list', () => {
    fixture.componentInstance.accounts.set([
      {
        id: 'complete',
        companyId: 'c1',
        bankCode: '10',
        bankName: 'STB',
        designation: null,
        agencyName: null,
        rib: '10006035123456789012',
        iban: 'TN5910006035123456789012',
        swiftBic: null,
        isDefault: true,
        isActive: true,
        chartOfAccountNumber: '53210001',
        currency: 'TND',
        hasBankingIdentity: true
      },
      {
        id: 'projection',
        companyId: 'c1',
        bankCode: '08',
        bankName: 'Banque Biat',
        designation: 'Banque Biat',
        agencyName: null,
        rib: '',
        iban: '',
        swiftBic: null,
        isDefault: false,
        isActive: true,
        chartOfAccountNumber: '53211',
        currency: 'TND',
        hasBankingIdentity: false
      }
    ]);
    fixture.detectChanges();
    expect(fixture.componentInstance.accountOptions().map(o => o.value)).toEqual(['complete']);
  });

  it('enables download when eligible lines exist', () => {
    payroll.getBankTransferPreview.and.returnValue(of({ success: true, data: fullPreview }));
    fixture.componentInstance.onOpen();
    fixture.detectChanges();
    expect(fixture.componentInstance.canDownload()).toBeTrue();
    expect(fixture.componentInstance.maskRib('20001234567890123456')).toBe('****3456');
  });
});
