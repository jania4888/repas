import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, Subject } from 'rxjs';
import { EmployeeDetailComponent } from './employee-detail.component';
import { EmployeeService } from '@core/services/employee.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PayrollService } from '@core/services/payroll.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { Tabs } from 'primeng/tabs';
import { EmployeeLeavesTabComponent } from './employee-leaves-tab.component';
import { EmployeeAdvancesTabComponent } from './employee-advances-tab.component';

describe('EmployeeDetailComponent', () => {
  const employeeServiceSpy = jasmine.createSpyObj<EmployeeService>('EmployeeService', ['getById', 'listLeaves', 'listAdvances', 'getLeaveBalance']);
  const toastSpy = jasmine.createSpyObj<ToastService>('ToastService', ['add']);
  const confirmSpy = jasmine.createSpyObj<ConfirmationService>('ConfirmationService', ['confirm']);

  const employeeData = {
    id: 'e1',
    employeeNumber: 'EMP-1',
    firstName: 'Ali',
    lastName: 'Ben',
    fullName: 'Ali Ben',
    maritalStatus: 'Single',
    maritalStatusDisplay: 'Célibataire',
    isHeadOfFamily: false,
    dependentChildren: 0,
    studentChildren: 0,
    disabledChildren: 0,
    dependentParents: 0,
    hireDate: '2026-01-01',
    isActive: true,
    contracts: [] as never[]
  };

  function createAuthMock(canManage: boolean) {
    return {
      hasPermission: (p: string) => canManage && p === PERMISSIONS.payroll.manageEmployees,
      isAccountingFirm: () => !canManage,
      isDelegatedMode: () => !canManage
    };
  }

  async function setup(
    canManage: boolean,
    routeData: Record<string, unknown> = {}
  ): Promise<ComponentFixture<EmployeeDetailComponent>> {
    employeeServiceSpy.getById.and.returnValue(of({ success: true, data: employeeData }));
    employeeServiceSpy.listLeaves.and.returnValue(of({ success: true, data: [] }));
    employeeServiceSpy.listAdvances.and.returnValue(of({ success: true, data: [] }));
    employeeServiceSpy.getLeaveBalance.and.returnValue(of({
      success: true,
      data: { employeeId: 'e1', year: 2026, openingBalance: 0, accruedInYear: 0, totalAcquired: 0, consumed: 0, remaining: 0, pending: 0, available: 0 }
    }));
    await TestBed.configureTestingModule({
      imports: [EmployeeDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: EmployeeService, useValue: employeeServiceSpy },
        { provide: PayrollService, useValue: {
          getParameters: () => of({ success: true, data: { monthlySmig: 528.32 } }),
          getFeatureFlags: () => of({ success: true, data: { hrDocumentsEnabled: false } }),
          // Onglets salariés : chacun appelle une méthode de lecture au ngOnInit.
          listSocialFunds: () => of({ success: true, data: [] }),
          listSocialFundEnrollments: () => of({ success: true, data: [] }),
          listInKindBenefits: () => of({ success: true, data: [] }),
          listEmployeeLoans: () => of({ success: true, data: [] }),
          listGarnishments: () => of({ success: true, data: [] }),
          listSuspensions: () => of({ success: true, data: [] }),
          listCnssIjClaims: () => of({ success: true, data: [] })
        } },
        { provide: ToastService, useValue: toastSpy },
        { provide: ConfirmationService, useValue: confirmSpy },
        // `ngOnInit` lit les données de route (base de route, mode paie interne cabinet) :
        // sans `snapshot.data`, le composant échoue avant même d'être rendu.
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'e1' }, data: routeData } } },
        { provide: AuthService, useValue: createAuthMock(canManage) }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(EmployeeDetailComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('hides manage actions and renders employee tabs read-only', async () => {
    const fixture = await setup(false);
    const el = fixture.nativeElement as HTMLElement;
    const tabs = fixture.debugElement.query(By.directive(Tabs)).componentInstance as Tabs;

    expect(el.textContent).not.toContain('Désactiver');

    tabs.updateValue(1);
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Ajouter un contrat');

    tabs.updateValue(2);
    fixture.detectChanges();
    const leaves = fixture.debugElement.query(By.directive(EmployeeLeavesTabComponent));
    expect(leaves).not.toBeNull();
    expect((leaves.componentInstance as EmployeeLeavesTabComponent).readOnly).toBeTrue();

    tabs.updateValue(5);
    fixture.detectChanges();
    const advances = fixture.debugElement.query(By.directive(EmployeeAdvancesTabComponent));
    expect(advances).not.toBeNull();
    expect((advances.componentInstance as EmployeeAdvancesTabComponent).readOnly).toBeTrue();
  });

  it('shows privileged actions and writable employee tabs when user can manage employees', async () => {
    const fixture = await setup(true);
    const el = fixture.nativeElement as HTMLElement;
    const tabs = fixture.debugElement.query(By.directive(Tabs)).componentInstance as Tabs;

    expect(el.textContent).toContain('Désactiver');

    tabs.updateValue(1);
    fixture.detectChanges();
    expect(el.textContent).toContain('Ajouter un contrat');

    tabs.updateValue(2);
    fixture.detectChanges();
    const leaves = fixture.debugElement.query(By.directive(EmployeeLeavesTabComponent));
    expect(leaves).not.toBeNull();
    expect((leaves.componentInstance as EmployeeLeavesTabComponent).readOnly).toBeFalse();

    tabs.updateValue(5);
    fixture.detectChanges();
    const advances = fixture.debugElement.query(By.directive(EmployeeAdvancesTabComponent));
    expect(advances).not.toBeNull();
    expect((advances.componentInstance as EmployeeAdvancesTabComponent).readOnly).toBeFalse();
  });

  it('bascule en mode cabinet et force les congés en lecture seule', async () => {
    // Les congés du cabinet ont une source unique : ils se saisissent côté RH et sont reportés
    // ici à l'approbation. L'onglet doit donc être en lecture seule, même pour un responsable.
    const fixture = await setup(true, { firmInternalPayroll: true, payrollRouteBase: '/firm/payroll' });
    const tabs = fixture.debugElement.query(By.directive(Tabs)).componentInstance as Tabs;

    expect(fixture.componentInstance.firmInternal()).toBeTrue();
    expect(fixture.componentInstance.routeBase()).toBe('/firm/payroll');

    tabs.updateValue(2);
    fixture.detectChanges();
    const leaves = fixture.debugElement.query(By.directive(EmployeeLeavesTabComponent));
    expect(leaves).not.toBeNull();
    expect((leaves.componentInstance as EmployeeLeavesTabComponent).readOnly).toBeTrue();
  });

  it('reste en mode paie client quand la route ne dit rien', async () => {
    // Non-régression : le parcours paie client est strictement inchangé.
    const fixture = await setup(true);

    expect(fixture.componentInstance.firmInternal()).toBeFalse();
    expect(fixture.componentInstance.routeBase()).toBe('/payroll');
  });

  it('ouvre Informations dès le montage et conserve l’onglet choisi ensuite', async () => {
    const fixture = await setup(true);
    const el = fixture.nativeElement as HTMLElement;
    const tabs = fixture.debugElement.query(By.directive(Tabs)).componentInstance as Tabs;
    const infoTab = el.querySelector('.p-tab.p-tab-active');

    expect(fixture.componentInstance.activeTab).toBe(0);
    expect(tabs.value()).toBe(0);
    expect(el.textContent).toContain('CIN');
    expect(infoTab?.textContent).toContain('Informations');
    expect(infoTab?.getAttribute('aria-selected')).toBe('true');
    expect(el.textContent).not.toContain('Ajouter un contrat');

    tabs.updateValue(1);
    expect(fixture.componentInstance.activeTab).toBe(1);
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTab).toBe(1);
    expect(tabs.value()).toBe(1);
    expect(el.textContent).toContain('Ajouter un contrat');
  });

  it('conserve l’onglet Contrats après rechargement de la fiche', async () => {
    const fixture = await setup(true);
    const el = fixture.nativeElement as HTMLElement;
    const tabs = fixture.debugElement.query(By.directive(Tabs)).componentInstance as Tabs;
    const pending = new Subject<{ success: boolean; data: typeof employeeData }>();

    tabs.updateValue(1);
    fixture.detectChanges();
    employeeServiceSpy.getById.and.returnValue(pending.asObservable());
    fixture.componentInstance.reload();
    fixture.detectChanges();

    expect(el.textContent).toContain('Chargement');

    pending.next({ success: true, data: employeeData });
    fixture.detectChanges();

    expect(fixture.componentInstance.activeTab).toBe(1);
    expect(el.textContent).toContain('Ajouter un contrat');
  });
});
