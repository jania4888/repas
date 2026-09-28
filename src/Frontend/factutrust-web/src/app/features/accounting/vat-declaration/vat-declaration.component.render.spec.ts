import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorCode } from '@core/utils/api-error-code';
import { AuthService, User } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ToastService } from '@core/services/toast.service';
import { AccountingService, VatDeclarationDto } from '../services/accounting.service';
import { VatDeclarationComponent } from './vat-declaration.component';

const vatDeclarationDto: VatDeclarationDto = {
  year: 2026,
  month: 7,
  collectedVat19: 657.02,
  collectedVat13: 67.6,
  collectedVat7: 601.65,
  deductibleVatGoods: 0,
  deductibleVatAssets: 0,
  previousCredit: 0,
  vatDue: 1326.27,
  creditToCarry: 0,
  currency: 'TND',
  status: 0,
  fodec: 125.73,
  droitTimbre: 7,
  tcl: 27.799,
  tfp: 0,
  foprolos: 0,
  withholdingTax: 0,
  acomptes: 0,
  totalToPay: 1486.799,
  version: 1,
  isRectificative: false,
  monthlyDeclarationV2Enabled: true,
  filingDeadline: '2026-08-22',
  declarationTypeDisplay: 'Déclaration mensuelle unique',
  collectedVatBreakdown: [
    { ratePercent: 19, taxableBase: 3458, vatAmount: 657.02 },
    { ratePercent: 13, taxableBase: 520, vatAmount: 67.6 },
    { ratePercent: 7, taxableBase: 8595, vatAmount: 601.65 }
  ],
  deductiblePurchasesTaxableBase: 0,
  salesTaxableBase: 12573,
  salesGrossBase: 13899.27,
  fodecTaxableBase: 8000
};

const submittedDto: VatDeclarationDto = { ...vatDeclarationDto, status: 1 };

const companyUser: User = {
  id: 'u1',
  email: 'company@test.c',
  firstName: 'A',
  lastName: 'B',
  fullName: 'A B',
  role: 'Administrator',
  roleDisplay: 'Administrateur',
  tenantId: '00000000-0000-0000-0000-000000000001',
  companyName: 'Société Test',
  tenantKind: 'Company',
  twoFactorEnabled: false,
  enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  effectivePermissions: ['accounting:read']
};

const firmDelegatedUser: User = {
  id: 'u2',
  email: 'firm@test.c',
  firstName: 'O',
  lastName: 'G',
  fullName: 'O G',
  role: 'FirmManager',
  roleDisplay: 'Responsable cabinet',
  tenantId: '00000000-0000-0000-0000-000000000002',
  companyName: 'Cabinet Test',
  tenantKind: 'AccountingFirm',
  accessMode: 'delegated',
  contextTenantId: '00000000-0000-0000-0000-000000000003',
  contextCompanyName: 'Ste Bouzgarou',
  twoFactorEnabled: false,
  enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  effectivePermissions: ['accounting:read', 'firm:manage']
};

function setUser(auth: AuthService, u: User | null): void {
  (auth as unknown as { userSignal: { set: (x: User | null) => void } }).userSignal.set(u);
}

describe('VatDeclarationComponent render', () => {
  let fixture: ComponentFixture<VatDeclarationComponent>;
  let accountingMock: {
    getVatDeclaration: jasmine.Spy;
  };

  beforeEach(async () => {
    accountingMock = {
      getVatDeclaration: jasmine.createSpy('getVatDeclaration').and.returnValue(
        of({ success: true, data: vatDeclarationDto })
      )
    };

    await TestBed.configureTestingModule({
      imports: [VatDeclarationComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Title, useValue: { setTitle: () => undefined } },
        { provide: ToastService, useValue: { add: () => undefined } },
        {
          provide: ErrorHandlerService,
          useValue: {
            extractErrorMessage: (err: { error?: { error?: string }; message?: string } | string) => {
              if (typeof err === 'string') return err;
              return err?.error?.error ?? err?.message ?? 'Erreur';
            },
            getApiErrorCode: (err: unknown) => apiErrorCode(err)
          }
        },
        { provide: AccountingService, useValue: accountingMock }
      ]
    }).compileComponents();
  });

  async function renderForUser(user: User): Promise<void> {
    setUser(TestBed.inject(AuthService), user);
    fixture = TestBed.createComponent(VatDeclarationComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('hides section 5 for a company user', async () => {
    accountingMock.getVatDeclaration.and.returnValue(of({ success: true, data: submittedDto }));
    await renderForUser(companyUser);
    expect(fixture.nativeElement.textContent).not.toContain('5. Pièces justificatives');
    expect(fixture.nativeElement.textContent).toContain('1. Informations générales');
  });

  it('shows section 5 for an accounting firm user', async () => {
    await renderForUser(firmDelegatedUser);
    expect(fixture.nativeElement.textContent).toContain('5. Pièces justificatives');
    expect(fixture.nativeElement.textContent).toContain('Journal des ventes');
  });

  it('company with submitted declaration: write actions hidden, PDF visible', async () => {
    accountingMock.getVatDeclaration.and.returnValue(of({ success: true, data: submittedDto }));
    await renderForUser(companyUser);
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Enregistrer brouillon');
    expect(text).not.toContain('Soumettre');
    expect(text).not.toContain('Rectificative');
    expect(text).not.toContain('Aperçu');
    expect(text).toContain('Exporter PDF');
    expect(text).toContain('TOTAL À PAYER');
  });

  it('company without submitted declaration: shows empty state', async () => {
    accountingMock.getVatDeclaration.and.returnValue(
      of({ success: false, error: "Aucune déclaration soumise n'est disponible pour cette période." })
    );
    await renderForUser(companyUser);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Aucune déclaration mensuelle soumise par le cabinet');
    expect(text).not.toContain('1. Informations générales');
    expect(text).not.toContain('Enregistrer brouillon');
  });

  it('company without submitted declaration, message translated by the API: recognised by its code', async () => {
    accountingMock.getVatDeclaration.and.returnValue(
      throwError(() => new HttpErrorResponse({
        status: 400,
        error: { success: false, message: 'لا يوجد أي تصريح مقدَّم لهذه الفترة.', error: 'لا يوجد أي تصريح مقدَّم لهذه الفترة.', code: 'VatDeclaration.NotSubmitted' }
      }))
    );
    await renderForUser(companyUser);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Aucune déclaration mensuelle soumise par le cabinet');
    expect(text).not.toContain('لا يوجد أي تصريح');
  });

  it('firm on draft keeps write actions', async () => {
    await renderForUser(firmDelegatedUser);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Enregistrer brouillon');
    expect(text).toContain('Soumettre');
    expect(text).toContain('Rectificative');
    expect(text).toContain('Aperçu');
  });
});
