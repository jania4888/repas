import { ComponentFixture, TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { provideRouter, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError, NEVER } from 'rxjs';
import { RegisterComponent } from './register.component';
import { AuthService, ApiResponse, AuthResponse, RegisterRequest } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { cleanNifValue, validateCompanyRegisterFormData } from '../shared/auth-registration.helpers';

/** Mock ApiResponse success pour register */
function validRegisterResponse(): ApiResponse<AuthResponse> {
  return {
    success: true,
    data: {} as AuthResponse,
    message: null,
    errors: []
  };
}

/** Mock ApiResponse failure pour register */
function errorRegisterResponse(errors: string[]): ApiResponse<AuthResponse> {
  return {
    success: false,
    data: {} as AuthResponse,
    message: null,
    errors
  };
}

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;
  let authService: jasmine.SpyObj<AuthService>;
  let router: Router;
  let navigateSpy: jasmine.Spy;
  let warehouseContext: jasmine.SpyObj<WarehouseContextService>;
  let errorHandler: jasmine.SpyObj<ErrorHandlerService>;
  let fb: FormBuilder;

  beforeEach(async () => {
    const authServiceSpy = jasmine.createSpyObj('AuthService', ['register']);
    const warehouseContextSpy = jasmine.createSpyObj('WarehouseContextService', [
      'navigateAfterSuccessfulAuth'
    ]);
    const errorHandlerSpy = jasmine.createSpyObj('ErrorHandlerService', [
      'extractErrorMessage',
      'logError'
    ]);

    await TestBed.configureTestingModule({
      imports: [RegisterComponent, ReactiveFormsModule],
      providers: [
        FormBuilder,
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceSpy },
        { provide: WarehouseContextService, useValue: warehouseContextSpy },
        { provide: ErrorHandlerService, useValue: errorHandlerSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    authService = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService>;
    router = TestBed.inject(Router);
    navigateSpy = spyOn(router, 'navigate');
    warehouseContext = TestBed.inject(WarehouseContextService) as jasmine.SpyObj<WarehouseContextService>;
    errorHandler = TestBed.inject(ErrorHandlerService) as jasmine.SpyObj<ErrorHandlerService>;
    fb = TestBed.inject(FormBuilder);

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('cleanNifValue', () => {
    const expectedNif = '1234567A/B/C/000';

    it('should remove underscores (placeholders) from NIF', () => {
      const result = cleanNifValue('1234567A/B/C/000_');
      expect(result).toBe(expectedNif);
    });

    it('should remove spaces from NIF', () => {
      const result = cleanNifValue('1234567 A/B/C/000');
      expect(result).toBe(expectedNif);
    });

    it('should convert lowercase to uppercase', () => {
      const result = cleanNifValue('1234567a/b/c/000');
      expect(result).toBe(expectedNif);
    });

    it('should handle multiple underscores', () => {
      const result = cleanNifValue('1234567A/B/C/000___');
      expect(result).toBe(expectedNif);
    });

    it('should handle mixed issues', () => {
      const result = cleanNifValue('_1234567 a/b/c/000_');
      expect(result).toBe(expectedNif);
    });

    it('should handle null', () => {
      const result = cleanNifValue(null);
      expect(result).toBe('');
    });

    it('should handle undefined', () => {
      const result = cleanNifValue(undefined);
      expect(result).toBe('');
    });

    it('should handle empty string', () => {
      const result = cleanNifValue('');
      expect(result).toBe('');
    });

    it('should normalize NIF with missing first slash (1234567A/B/C/000)', () => {
      const result = cleanNifValue('1234567A/B/C/000');
      expect(result).toBe(expectedNif);
    });

    it('should normalize NIF without slashes (ex. InputMask unmask)', () => {
      const result = cleanNifValue('1234567ABC000');
      expect(result).toBe(expectedNif);
    });
  });

  describe('validateFormData', () => {
    it('should return no errors for valid data', () => {
      const formValue = {
        taxRegime: 0,
        governorate: 'Monastir',
        phone: '98 455 112',
        nif: '1234567A/B/C/000'
      };

      const errors = validateCompanyRegisterFormData(formValue);
      expect(errors).toEqual([]);
    });

    it('should validate NIF with underscores', () => {
      const formValue = {
        taxRegime: 0,
        governorate: 'Monastir',
        phone: '98455112',
        nif: '1234567A/B/C/000_' // With placeholder
      };

      const errors = validateCompanyRegisterFormData(formValue);
      expect(errors).toEqual([]); // Should pass after cleaning
    });

    it('should validate NIF with spaces', () => {
      const formValue = {
        taxRegime: 0,
        governorate: 'Monastir',
        phone: '98455112',
        nif: '1234567 A/B/C/000' // With spaces
      };

      const errors = validateCompanyRegisterFormData(formValue);
      expect(errors).toEqual([]); // Should pass after cleaning
    });

    it('should validate NIF in lowercase', () => {
      const formValue = {
        taxRegime: 0,
        governorate: 'Monastir',
        phone: '98455112',
        nif: '1234567a/b/c/000' // Lowercase
      };

      const errors = validateCompanyRegisterFormData(formValue);
      expect(errors).toEqual([]); // Should pass after cleaning
    });

    it('should return error for invalid NIF format', () => {
      const formValue = {
        taxRegime: 0,
        governorate: 'Monastir',
        phone: '98455112',
        nif: '1234567A/B/C' // Incomplete
      };

      const errors = validateCompanyRegisterFormData(formValue);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('format du NIF');
    });

    it('should return error for missing taxRegime', () => {
      const formValue = {
        taxRegime: null,
        governorate: 'Monastir',
        phone: '98455112',
        nif: '1234567A/B/C/000'
      };

      const errors = validateCompanyRegisterFormData(formValue);
      expect(errors).toContain('Le régime fiscal est requis');
    });

    it('should return error for missing governorate', () => {
      const formValue = {
        taxRegime: 0,
        governorate: null,
        phone: '98455112',
        nif: '1234567A/B/C/000'
      };

      const errors = validateCompanyRegisterFormData(formValue);
      expect(errors).toContain('Le gouvernorat est requis');
    });

    it('should return error for invalid phone format', () => {
      const formValue = {
        taxRegime: 0,
        governorate: 'Monastir',
        phone: '12345678', // Invalid (starts with 1)
        nif: '1234567A/B/C/000'
      };

      const errors = validateCompanyRegisterFormData(formValue);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('téléphone');
    });

    it('should not validate NIF if only placeholders', () => {
      const formValue = {
        taxRegime: 0,
        governorate: 'Monastir',
        phone: '98455112',
        nif: '_______/__/__/___' // Only placeholders
      };

      const errors = validateCompanyRegisterFormData(formValue);
      // Should not add NIF error for placeholders only
      const nifErrors = errors.filter((e: string) => e.includes('NIF'));
      expect(nifErrors.length).toBe(0);
    });
  });

  describe('onSubmit', () => {
    beforeEach(() => {
      // Set up valid form (including acceptTerms for step 1)
      component.form.patchValue({
        firstName: 'John',
        lastName: 'Doe',
        email: 'test@example.com',
        password: 'Test1234@Password',
        confirmPassword: 'Test1234@Password',
        acceptTerms: true,
        companyName: 'Test Company',
        nif: '1234567A/B/C/000',
        taxRegime: 0,
        companyEmail: 'contact@test.tn',
        phone: '98 455 112',
        street: '155 Rue Test',
        city: 'Monastir',
        governorate: 'Monastir'
      });
    });

    afterEach(() => {
      component.ngOnDestroy();
    });

    it('should not submit if form is invalid', () => {
      component.form.patchValue({ email: '' }); // Make invalid
      
      component.onSubmit();

      expect(authService.register).not.toHaveBeenCalled();
    });

    it('should not submit if password mismatch', () => {
      component.form.patchValue({
        password: 'Test1234@Password',
        confirmPassword: 'DifferentPassword'
      });

      component.onSubmit();

      expect(authService.register).not.toHaveBeenCalled();
      expect(component.error()).toContain('mots de passe');
    });

    it('should not submit if acceptTerms is false', () => {
      component.form.patchValue({ acceptTerms: false });

      component.onSubmit();

      expect(authService.register).not.toHaveBeenCalled();
    });

    it('should clean NIF value before submission', () => {
      component.form.patchValue({
        nif: '1234567A/B/C/000_' // With placeholder
      });

      authService.register.and.returnValue(of(validRegisterResponse()));

      component.onSubmit();

      expect(authService.register).toHaveBeenCalled();
      const callArgs = authService.register.calls.mostRecent().args[0] as RegisterRequest;
      expect(callArgs.nif).toBe('1234567A/B/C/000');
    });

    it('should clean phone number before submission', () => {
      component.form.patchValue({
        phone: '98 455 112' // With spaces
      });

      authService.register.and.returnValue(of(validRegisterResponse()));

      component.onSubmit();

      const callArgs = authService.register.calls.mostRecent().args[0] as RegisterRequest;
      expect(callArgs.phone).toBe('98455112'); // Should have spaces removed
    });

    it('should navigate to dashboard on success', () => {
      authService.register.and.returnValue(of(validRegisterResponse()));

      component.onSubmit();

      expect(warehouseContext.navigateAfterSuccessfulAuth).toHaveBeenCalledWith('/dashboard');
    });

    it('should set error message on failure response', () => {
      authService.register.and.returnValue(of(errorRegisterResponse(['Format du NIF invalide'])));

      component.onSubmit();

      expect(component.error()).toContain('Format du NIF invalide');
    });

    it('should handle HTTP error', () => {
      const httpError = new HttpErrorResponse({
        status: 400,
        error: {
          success: false,
          errors: ['Le NIF est obligatoire']
        }
      });

      errorHandler.extractErrorMessage.and.returnValue('Le NIF est obligatoire');
      authService.register.and.returnValue(throwError(() => httpError));

      component.onSubmit();

      expect(component.error()).toBe('Le NIF est obligatoire');
      expect(errorHandler.logError).toHaveBeenCalled();
    });

    it('should handle network error', () => {
      const httpError = new HttpErrorResponse({
        status: 0,
        error: null
      });

      errorHandler.extractErrorMessage.and.returnValue(
        'Impossible de se connecter au serveur. Vérifiez que le backend est démarré.'
      );
      authService.register.and.returnValue(throwError(() => httpError));

      component.onSubmit();

      expect(component.error()).toContain('se connecter au serveur');
    });

    it('should validate form data before submission', () => {
      component.form.patchValue({
        taxRegime: null // Invalid – form invalid, we return early without calling register
      });

      component.onSubmit();

      expect(authService.register).not.toHaveBeenCalled();
    });

    it('should rotate loading messages while waiting for the API', fakeAsync(() => {
      authService.register.and.returnValue(NEVER);

      component.onSubmit();

      expect(component.loading()).toBeTrue();
      expect(component.loadingMessage()).toContain('Création de votre espace');

      tick(6_000);
      expect(component.loadingMessage()).toContain('Configuration de la base');

      component.ngOnDestroy();
      discardPeriodicTasks();
    }));

    it('should surface a timeout message after 120 seconds', fakeAsync(() => {
      authService.register.and.returnValue(NEVER);

      component.onSubmit();
      tick(120_000);

      expect(component.error()).toContain('plus de temps que prévu');
      expect(component.loading()).toBeFalse();
      discardPeriodicTasks();
    }));
  });

  describe('onNifBlur', () => {
    const expectedNif = '1234567A/B/C/000';

    it('should clean NIF value on blur', () => {
      const nifControl = component.form.get('nif');
      nifControl?.setValue('1234567A/B/C/000_');

      component.onNifBlur();

      expect(nifControl?.value).toBe(expectedNif);
    });

    it('should mark field as touched on blur', () => {
      const nifControl = component.form.get('nif');
      nifControl?.setValue('1234567A/B/C/000_');
      nifControl?.markAsUntouched();

      component.onNifBlur();

      expect(nifControl?.touched).toBe(true);
    });

    it('should rewrite the historical spelling to the carte form', () => {
      const nifControl = component.form.get('nif');
      nifControl?.setValue('1234567/A/B/C/000');

      component.onNifBlur();

      expect(nifControl?.value).toBe('1234567A/B/C/000');
    });

    it('should not update if value is already the carte form', () => {
      const nifControl = component.form.get('nif');
      nifControl?.setValue('1234567A/B/C/000');

      component.onNifBlur();

      expect(nifControl?.value).toBe('1234567A/B/C/000');
    });

    it('should handle empty value', () => {
      const nifControl = component.form.get('nif');
      nifControl?.setValue('');

      component.onNifBlur();

      expect(nifControl?.value).toBe('');
    });
  });

  describe('isCurrentStepValid', () => {
    it('should validate step 0 (account)', () => {
      component.currentStep.set(0);
      component.form.patchValue({
        firstName: 'John',
        lastName: 'Doe',
        email: 'test@example.com',
        password: 'Test1234@Password',
        confirmPassword: 'Test1234@Password',
        acceptTerms: true
      });

      expect(component.isCurrentStepValid()).toBe(true);
    });

    it('should invalidate step 0 if password mismatch', () => {
      component.currentStep.set(0);
      component.form.patchValue({
        firstName: 'John',
        lastName: 'Doe',
        email: 'test@example.com',
        password: 'Test1234@Password',
        confirmPassword: 'Different'
      });

      expect(component.isCurrentStepValid()).toBe(false);
    });

    it('should validate step 1 (company)', () => {
      component.currentStep.set(1);
      component.form.patchValue({
        companyName: 'Test Company',
        nif: '1234567A/B/C/000',
        taxRegime: 0,
        companyEmail: 'contact@test.tn',
        phone: '98455112'
      });

      expect(component.isCurrentStepValid()).toBe(true);
    });

    it('should validate step 2 (address)', () => {
      component.currentStep.set(2);
      component.form.patchValue({
        street: '155 Rue Test',
        city: 'Monastir',
        governorate: 'Monastir'
      });

      expect(component.isCurrentStepValid()).toBe(true);
    });
  });
});
