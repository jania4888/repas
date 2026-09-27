import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError, timeout, TimeoutError, catchError } from 'rxjs';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RegisterFirmComponent } from './register-firm.component';
import { AuthService, ApiResponse, AuthResponse } from '@core/services/auth.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

function validFirmResponse(): ApiResponse<AuthResponse> {
  return { success: true, data: {} as AuthResponse, message: null, errors: [] };
}

describe('RegisterFirmComponent', () => {
  let component: RegisterFirmComponent;
  let fixture: ComponentFixture<RegisterFirmComponent>;
  let authService: jasmine.SpyObj<AuthService>;
  let warehouseContext: jasmine.SpyObj<WarehouseContextService>;
  let errorHandler: jasmine.SpyObj<ErrorHandlerService>;

  beforeEach(async () => {
    const authSpy = jasmine.createSpyObj('AuthService', ['registerFirm']);
    const warehouseSpy = jasmine.createSpyObj('WarehouseContextService', ['navigateAfterSuccessfulAuth']);
    const errorSpy = jasmine.createSpyObj('ErrorHandlerService', ['extractErrorMessage', 'logError']);

    await TestBed.configureTestingModule({
      imports: [RegisterFirmComponent, ReactiveFormsModule],
      providers: [
        FormBuilder,
        provideRouter([]),
        provideNoopAnimations(),
        // Sélecteur de langue (ErpLocaleService → préférences utilisateur via HTTP).
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authSpy },
        { provide: WarehouseContextService, useValue: warehouseSpy },
        { provide: ErrorHandlerService, useValue: errorSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterFirmComponent);
    component = fixture.componentInstance;
    authService = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService>;
    warehouseContext = TestBed.inject(WarehouseContextService) as jasmine.SpyObj<WarehouseContextService>;
    errorHandler = TestBed.inject(ErrorHandlerService) as jasmine.SpyObj<ErrorHandlerService>;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not advance step when step 1 is invalid', () => {
    component.nextStep();
    expect(component.currentStep()).toBe(0);
  });

  it('should advance to step 2 when step 1 is valid', () => {
    component.form.patchValue({
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean@example.com',
      password: 'SecurePass123!',
      confirmPassword: 'SecurePass123!',
      acceptTerms: true
    });
    component.nextStep();
    expect(component.currentStep()).toBe(1);
  });

  it('should block submit on password mismatch', () => {
    fillValidForm(component);
    component.form.patchValue({ confirmPassword: 'OtherPass123!' });
    component.submit();
    expect(authService.registerFirm).not.toHaveBeenCalled();
    expect(component.error()).toContain('ne correspondent pas');
  });

  it('should send cleaned payload on successful validation', () => {
    fillValidForm(component);
    authService.registerFirm.and.returnValue(of(validFirmResponse()));

    component.submit();

    expect(authService.registerFirm).toHaveBeenCalled();
    const payload = authService.registerFirm.calls.mostRecent().args[0];
    expect(payload.nif).toBe('1234567A/B/C/000');
    expect(payload.phone).toBe('98455112');
    expect(payload.email).toBe('manager@example.com');
    expect(payload.firmName).toBe('Cabinet Test');
    expect(payload.isPublicInDirectory).toBeTrue();
    expect(warehouseContext.navigateAfterSuccessfulAuth).toHaveBeenCalledWith('/firm/dashboard');
  });

  it('should display API error via ErrorHandlerService', () => {
    fillValidForm(component);
    errorHandler.extractErrorMessage.and.returnValue('Email déjà utilisé');
    authService.registerFirm.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400 })));

    component.submit();

    expect(component.error()).toBe('Email déjà utilisé');
    expect(errorHandler.logError).toHaveBeenCalled();
  });
});

function fillValidForm(component: RegisterFirmComponent): void {
  component.form.patchValue({
    firstName: 'Jean',
    lastName: 'Dupont',
    email: 'manager@example.com',
    password: 'SecurePass123!',
    confirmPassword: 'SecurePass123!',
    acceptTerms: true,
    firmName: 'Cabinet Test',
    nif: '1234567/A/B/C/000',
    firmEmail: 'contact@cabinet.tn',
    phone: '98 455 112',
    street: '10 rue de la République',
    city: 'Monastir',
    governorate: 'Monastir',
    isPublicInDirectory: true
  });
  component.form.markAllAsTouched();
  component.form.updateValueAndValidity();
}
