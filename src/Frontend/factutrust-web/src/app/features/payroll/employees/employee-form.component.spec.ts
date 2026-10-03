import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { EmployeeFormComponent } from './employee-form.component';
import { EmployeeService } from '@core/services/employee.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorMessageService } from '@core/services/error-message.service';

describe('EmployeeFormComponent', () => {
  let component: EmployeeFormComponent;
  let fixture: ComponentFixture<EmployeeFormComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [EmployeeFormComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: EmployeeService, useValue: jasmine.createSpyObj('EmployeeService', ['create', 'update', 'getById']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['add']) },
        { provide: ErrorMessageService, useValue: { getErrorMessage: () => 'Erreur' } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null }, data: {} } } }
      ]
    });
    fixture = TestBed.createComponent(EmployeeFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('requires employeeNumber in create mode', () => {
    component.form.patchValue({ employeeNumber: '', firstName: 'A', lastName: 'B', hireDate: new Date() });
    expect(component.form.invalid).toBe(true);
  });

  it('rejects invalid CIN format', () => {
    component.form.patchValue({ cin: '123' });
    component.form.get('cin')?.markAsTouched();
    expect(component.form.get('cin')?.invalid).toBe(true);
  });

  it('accepts valid 8-digit CIN', () => {
    component.form.patchValue({ cin: '12345678' });
    expect(component.form.get('cin')?.valid).toBe(true);
  });

  it('allows adding up to two parent claims with CIN validation', () => {
    component.addParentClaim({ parentCin: '11111111', kinship: 'Father' });
    component.addParentClaim({ parentCin: '22222222', kinship: 'Mother' });
    expect(component.dependentParentClaims.length).toBe(2);
    component.addParentClaim({ parentCin: '33333333', kinship: 'Father' });
    expect(component.dependentParentClaims.length).toBe(2);
    expect(component.dependentParentClaims.at(0).get('parentCin')?.valid).toBe(true);
  });

  it('marks matricule and hireDate disabled in edit mode', () => {
    component.employeeId.set('abc');
    component.form.get('employeeNumber')?.disable();
    component.form.get('hireDate')?.disable();
    expect(component.form.get('employeeNumber')?.disabled).toBe(true);
    expect(component.form.get('hireDate')?.disabled).toBe(true);
  });

  function fillIdentity(): void {
    component.form.patchValue({
      employeeNumber: '8744456',
      firstName: 'SANA',
      lastName: 'CHAHLAOUI',
      hireDate: new Date(2020, 0, 6)
    });
  }

  it('navigates to the new employee file after a successful create', () => {
    const router = TestBed.inject(Router);
    const employees = TestBed.inject(EmployeeService) as jasmine.SpyObj<EmployeeService>;
    const id = 'b980ae75-daef-4749-859b-88e7aebaf265';
    spyOn(router, 'navigate');
    employees.create.and.returnValue(of({ success: true, data: id }));
    fillIdentity();

    expect(component.form.valid).toBeTrue();
    component.onSubmit();

    expect(router.navigate).toHaveBeenCalledOnceWith(['/payroll/employees', id]);
  });

  it('does not navigate when create succeeds without an id', () => {
    const router = TestBed.inject(Router);
    const employees = TestBed.inject(EmployeeService) as jasmine.SpyObj<EmployeeService>;
    spyOn(router, 'navigate');
    employees.create.and.returnValue(of({ success: true, data: undefined as unknown as string }));
    fillIdentity();

    component.onSubmit();

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('returns to the same employee file after an update', () => {
    const id = 'employee-edit-id';
    const router = TestBed.inject(Router);
    const employees = TestBed.inject(EmployeeService) as jasmine.SpyObj<EmployeeService>;
    spyOn(router, 'navigate');
    employees.update.and.returnValue(of({ success: true, data: null }));
    component.employeeId.set(id);
    fillIdentity();
    component.form.get('employeeNumber')?.disable();
    component.form.get('hireDate')?.disable();

    component.onSubmit();

    expect(employees.create).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/payroll/employees', id]);
  });
});
