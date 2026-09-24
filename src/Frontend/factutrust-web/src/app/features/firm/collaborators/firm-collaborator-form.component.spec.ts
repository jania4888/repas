import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { FirmCollaboratorFormComponent } from './firm-collaborator-form.component';
import { FirmCollaboratorsService, FirmUser } from '@core/services/firm-collaborators.service';
import { FirmGovernanceService } from '@core/services/firm-governance.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

describe('FirmCollaboratorFormComponent', () => {
  // Conforme à la politique Identity du serveur (12 caractères, 4 familles, 4 distincts).
  const VALID_PASSWORD = 'Password1!23';

  const firmUser: FirmUser = {
    id: 'user-1',
    email: 'collab@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 12,
    roleDisplay: 'Comptable cabinet',
    isActive: true,
    emailConfirmed: true,
    civility: 1,
    qualification: 'Expert',
    phoneNumber: '+21620000000',
    phoneLandline: null,
    useFirmAddress: true,
    addressLine: '1 rue Test',
    postalCode: '1000',
    city: 'Tunis',
    country: 'Tunisie',
    hasCni: false,
    binomes: []
  };

  function setup(options: {
    data?: Record<string, unknown>;
    id?: string | null;
    url?: string;
    createResult?: ReturnType<typeof of> | ReturnType<typeof throwError>;
    autoProvisionOnCreate?: boolean;
  }): ComponentFixture<FirmCollaboratorFormComponent> {
    const id = options.id ?? null;
    const url = options.url ?? (id ? `/firm/collaborateurs/${id}` : '/firm/collaborateurs/new');

    TestBed.configureTestingModule({
      imports: [FirmCollaboratorFormComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        ErrorHandlerService,
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: options.data ?? {},
              paramMap: convertToParamMap(id ? { id } : {})
            }
          }
        },
        {
          provide: Router,
          useValue: {
            url,
            navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true))
          }
        },
        {
          provide: FirmCollaboratorsService,
          useValue: {
            getFirmAddress: jasmine.createSpy('getFirmAddress').and.returnValue(
              of({
                addressLine: 'Cabinet Ave',
                postalCode: '1001',
                city: 'Tunis',
                country: 'Tunisie'
              })
            ),
            getById: jasmine.createSpy('getById').and.returnValue(of(firmUser)),
            list: jasmine.createSpy('list').and.returnValue(of([firmUser])),
            create: jasmine.createSpy('create').and.returnValue(
              options.createResult ?? of(firmUser)
            ),
            update: jasmine.createSpy('update')
          }
        },
        {
          provide: FirmGovernanceService,
          useValue: {
            listCollaboratorCosts: jasmine.createSpy('listCollaboratorCosts').and.returnValue(of([])),
            getPayrollProvisioningStatus: jasmine.createSpy('getPayrollProvisioningStatus').and.returnValue(
              of({
                data: {
                  internalPayrollEnabled: true,
                  autoProvisionOnCollaboratorCreate: options.autoProvisionOnCreate ?? false,
                  activePayrollEmployees: 0,
                  collaborators: [],
                  collaboratorsWithIncompleteIdentity: 0
                }
              })
            )
          }
        },
        { provide: ToastService, useValue: { add: jasmine.createSpy('add') } }
      ]
    });

    const fixture = TestBed.createComponent(FirmCollaboratorFormComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('enters create mode when route data mode is create', () => {
    const fixture = setup({ data: { mode: 'create' } });
    const component = fixture.componentInstance;

    expect(component.mode).toBe('create');
    expect(component.readOnly).toBeFalse();
    expect(component.title).toBe("Création d'un nouveau collaborateur");
    expect(component.form.disabled).toBeFalse();
  });

  it('enters create mode when id is absent (regression /new without data)', () => {
    const fixture = setup({
      data: {},
      id: null,
      url: '/firm/collaborateurs/new'
    });
    const component = fixture.componentInstance;

    expect(component.mode).toBe('create');
    expect(component.readOnly).toBeFalse();
    expect(component.title).toBe("Création d'un nouveau collaborateur");
  });

  it('enters edit mode on /collaborateurs/:id/edit', () => {
    const fixture = setup({
      id: 'user-1',
      url: '/firm/collaborateurs/user-1/edit'
    });
    const component = fixture.componentInstance;

    expect(component.mode).toBe('edit');
    expect(component.readOnly).toBeFalse();
    expect(component.title).toBe('Modification du collaborateur');
    expect(component.form.disabled).toBeFalse();
  });

  it('enters view mode on /collaborateurs/:id', () => {
    const fixture = setup({
      id: 'user-1',
      url: '/firm/collaborateurs/user-1'
    });
    const component = fixture.componentInstance;

    expect(component.mode).toBe('view');
    expect(component.readOnly).toBeTrue();
    expect(component.title).toBe('Consultation du collaborateur');
    expect(component.form.disabled).toBeTrue();
  });

  it('shows business duplicate-email message on create failure (not Http failure response)', () => {
    const businessMessage =
      "Le nom d'utilisateur et l'adresse email 'karim45@yahoo.com' sont déjà utilisés.";
    const httpError = new HttpErrorResponse({
      status: 400,
      statusText: 'Bad Request',
      url: 'https://localhost:7001/api/firm/users',
      error: {
        success: false,
        data: null,
        message: null,
        error: businessMessage
      }
    });

    const fixture = setup({
      data: { mode: 'create' },
      createResult: throwError(() => httpError)
    });
    const component = fixture.componentInstance;
    const toast = TestBed.inject(ToastService);

    component.form.patchValue({
      lastName: 'karim',
      firstName: 'Ferchiou',
      email: 'karim45@yahoo.com'
    });
    component.save();

    expect(toast.add).toHaveBeenCalledWith(
      jasmine.objectContaining({
        severity: 'error',
        summary: 'Erreur',
        detail: businessMessage
      })
    );
    expect(toast.add).not.toHaveBeenCalledWith(
      jasmine.objectContaining({
        detail: jasmine.stringMatching(/Http failure response/i)
      })
    );
    expect(component.form.controls.email.hasError('server')).toBeTrue();
    expect(component.form.controls.email.getError('server')).toBe(businessMessage);
  });

  it('does not navigate when create fails with payroll provision error', () => {
    const payrollMessage =
      "Impossible de créer le salarié paie : aucune base de paie n'est rattachée au cabinet.";
    const httpError = new HttpErrorResponse({
      status: 400,
      statusText: 'Bad Request',
      url: 'https://localhost:7001/api/firm/users',
      error: {
        success: false,
        data: null,
        message: null,
        error: payrollMessage
      }
    });

    const fixture = setup({
      data: { mode: 'create' },
      createResult: throwError(() => httpError)
    });
    const component = fixture.componentInstance;
    const router = TestBed.inject(Router);
    const toast = TestBed.inject(ToastService);

    component.form.patchValue({
      lastName: 'Test',
      firstName: 'Payroll',
      email: 'payroll-fail@example.com',
      password: VALID_PASSWORD
    });
    component.save();

    expect(router.navigate).not.toHaveBeenCalled();
    expect(toast.add).toHaveBeenCalledWith(
      jasmine.objectContaining({
        severity: 'error',
        detail: `Collaborateur non créé : ${payrollMessage}`
      })
    );
  });

  it('shows Paie tab when auto-provision flag is on in create mode', () => {
    const fixture = setup({ data: { mode: 'create' }, autoProvisionOnCreate: true });
    fixture.detectChanges();

    expect(fixture.componentInstance.autoProvisionEnabled()).toBeTrue();
    const tabLabels = Array.from(fixture.nativeElement.querySelectorAll('p-tab'))
      .map((el: unknown) => (el as Element).textContent?.trim());
    expect(tabLabels).toContain('Paie');
  });

  it('includes payroll in create payload when auto-provision is enabled', () => {
    const fixture = setup({ data: { mode: 'create' }, autoProvisionOnCreate: true });
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.form.patchValue({
      lastName: 'Test',
      firstName: 'Payroll',
      email: 'payroll-ok@example.com',
      password: VALID_PASSWORD
    });

    const payrollPayload = {
      employeeNumber: 'CAB-99',
      hireDate: '2025-06-01',
      contract: {
        type: 'Cdi',
        regime: 'Rsna',
        weeklyRegime: 'FortyEightHours',
        startDate: '2025-06-01',
        baseSalary: 1500,
        workAccidentRate: 0.4,
        jobTitle: 'Collaborateur cabinet'
      }
    };

    component.payrollOnboarding = {
      form: { invalid: false, markAllAsTouched: () => undefined },
      buildPayload: () => payrollPayload,
      markAllAsTouched: () => undefined
    } as unknown as typeof component.payrollOnboarding;

    const api = TestBed.inject(FirmCollaboratorsService);
    component.save();

    expect(api.create).toHaveBeenCalledWith(
      jasmine.objectContaining({ payroll: payrollPayload }),
      null
    );
  });

  describe('password policy', () => {
    function fillIdentity(component: FirmCollaboratorFormComponent, password: string): void {
      component.form.patchValue({
        lastName: 'Sami',
        firstName: 'Mango',
        email: 'mango.sami@example.com',
        password
      });
    }

    it('keeps the form valid with an empty password (invitation flow)', () => {
      const component = setup({ data: { mode: 'create' } }).componentInstance;
      fillIdentity(component, '');

      expect(component.form.valid).toBeTrue();
    });

    it('blocks a password the server would refuse, without calling the API', () => {
      const component = setup({ data: { mode: 'create' } }).componentInstance;
      fillIdentity(component, 'Test1234');

      expect(component.form.controls.password.hasError('passwordPolicy')).toBeTrue();
      expect(component.form.invalid).toBeTrue();

      component.save();
      expect(TestBed.inject(FirmCollaboratorsService).create).not.toHaveBeenCalled();
    });

    it('shows what the password is missing', () => {
      const fixture = setup({ data: { mode: 'create' } });
      fillIdentity(fixture.componentInstance, 'Test1234');
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent)
        .toContain('Il manque : 12 caractères minimum, un caractère spécial.');
    });

    it('accepts a compliant password', () => {
      const component = setup({ data: { mode: 'create' } }).componentInstance;
      fillIdentity(component, VALID_PASSWORD);

      expect(component.form.valid).toBeTrue();
    });
  });

  it('rejects in create mode an email with characters the server refuses as a login', () => {
    const component = setup({ data: { mode: 'create' } }).componentInstance;
    component.form.patchValue({ lastName: 'Brien', firstName: 'O', email: "o'brien@example.com" });

    expect(component.form.controls.email.hasError('pattern')).toBeTrue();
    expect(component.form.invalid).toBeTrue();
  });

  it('does not apply the login charset rule to the read-only email in edit mode', () => {
    const component = setup({ id: 'user-1', url: '/firm/collaborateurs/user-1/edit' }).componentInstance;
    component.form.controls.email.setValue("o'brien@example.com");

    expect(component.form.controls.email.hasError('pattern')).toBeFalse();
  });

  it('opens the general tab on load', () => {
    const component = setup({ data: { mode: 'create' }, autoProvisionOnCreate: true }).componentInstance;

    expect(component.activeTab).toBe(0);
  });

  it('flags the password field and returns to the general tab when the server refuses the password', () => {
    const serverMessage = 'Le mot de passe doit contenir au moins 12 caractères.';
    const httpError = new HttpErrorResponse({
      status: 400,
      statusText: 'Bad Request',
      url: 'https://localhost:7001/api/firm/users',
      error: { success: false, data: null, message: serverMessage, errors: [serverMessage], code: 'Validation.Password' }
    });
    const fixture = setup({ data: { mode: 'create' }, createResult: throwError(() => httpError) });
    const component = fixture.componentInstance;
    component.form.patchValue({
      lastName: 'Sami',
      firstName: 'Mango',
      email: 'mango.sami@example.com',
      password: VALID_PASSWORD
    });
    component.activeTab = 1; // l'utilisateur enregistre depuis l'onglet Paie

    component.save();

    expect(component.form.controls.password.getError('server')).toBe(serverMessage);
    expect(component.form.controls.email.hasError('server')).toBeFalse();
    expect(component.activeTab).toBe(0);
    expect(TestBed.inject(ToastService).add).toHaveBeenCalledWith(
      jasmine.objectContaining({ severity: 'error', detail: serverMessage })
    );
  });

  it('flags the email field from the Validation.Email code', () => {
    const serverMessage = "L'adresse email contient des caractères non autorisés.";
    const httpError = new HttpErrorResponse({
      status: 400,
      error: { success: false, data: null, message: serverMessage, errors: [serverMessage], code: 'Validation.Email' }
    });
    const component = setup({ data: { mode: 'create' }, createResult: throwError(() => httpError) }).componentInstance;
    component.form.patchValue({ lastName: 'Sami', firstName: 'Mango', email: 'mango.sami@example.com' });

    component.save();

    expect(component.form.controls.email.getError('server')).toBe(serverMessage);
    expect(component.form.controls.password.hasError('server')).toBeFalse();
  });

  it('clears the server error on the password once the user edits it', () => {
    const component = setup({ data: { mode: 'create' } }).componentInstance;
    component.form.controls.password.setErrors({ server: 'refusé' });

    component.form.controls.password.setValue(VALID_PASSWORD);

    expect(component.form.controls.password.hasError('server')).toBeFalse();
  });
});
