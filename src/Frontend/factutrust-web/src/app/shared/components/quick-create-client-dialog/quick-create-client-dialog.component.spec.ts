import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { QuickCreateClientDialogComponent } from './quick-create-client-dialog.component';
import { cleanNif } from './quick-create-client.utils';
import { ClientService, ClientType } from '@core/services/client.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { DrawerOverlayService } from '@core/services/drawer-overlay.service';

describe('cleanNif', () => {
  it('normalizes valid NIF values', () => {
    expect(cleanNif('8995220/v/v/b/222')).toBe('8995220V/V/B/222');
    expect(cleanNif('8995220VVB222')).toBe('8995220V/V/B/222');
    expect(cleanNif('9622552/e/v/e/552')).toBe('9622552E/V/E/552');
    expect(cleanNif('1772793W/A/M/000')).toBe('1772793W/A/M/000');
  });
});

describe('QuickCreateClientDialogComponent', () => {
  let fixture: ComponentFixture<QuickCreateClientDialogComponent>;
  let component: QuickCreateClientDialogComponent;
  let clientService: jasmine.SpyObj<ClientService>;
  let drawerOverlay: DrawerOverlayService;

  beforeEach(async () => {
    clientService = jasmine.createSpyObj<ClientService>('ClientService', ['createClient', 'getClient']);

    await TestBed.configureTestingModule({
      imports: [QuickCreateClientDialogComponent],
      providers: [
        { provide: ClientService, useValue: clientService },
        {
          provide: ErrorHandlerService,
          useValue: { extractErrorMessage: () => 'Erreur serveur' },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(QuickCreateClientDialogComponent);
    component = fixture.componentInstance;
    component.panelMode = true;
    drawerOverlay = TestBed.inject(DrawerOverlayService);
    fixture.detectChanges();
  });

  function fillValidIndividualForm(): void {
    component.name.set('Jean Dupont');
    component.type.set(ClientType.Individual);
    component.email.set('jean@exemple.tn');
    component.street.set('1 rue Test');
    component.city.set('Tunis');
    component.governorate.set('Tunis');
  }

  it('resets form when opened with Individual as default type', () => {
    component.name.set('stale');
    component.visible = true;
    fixture.detectChanges();

    expect(component.name()).toBe('');
    expect(component.type()).toBe(ClientType.Individual);
    expect(component.nif()).toBe('');
    expect(component.submitAttempted()).toBeFalse();
    expect(component.nameTouched()).toBeFalse();
  });

  it('registers drawer overlay when panel opens and closes', () => {
    component.visible = true;
    fixture.detectChanges();
    expect(drawerOverlay.isOpen()).toBeTrue();

    component.visible = false;
    fixture.detectChanges();
    expect(drawerOverlay.isOpen()).toBeFalse();
  });

  it('allows submit for a complete individual form', () => {
    fillValidIndividualForm();
    expect(component.canSubmit()).toBeTrue();
  });

  it('allows submit when email is empty and rejects an invalid email', () => {
    fillValidIndividualForm();
    component.email.set('');
    expect(component.canSubmit()).toBeTrue();
    expect(component.showEmailError()).toBeFalse();

    component.email.set('pas-un-email');
    component.emailTouched.set(true);
    expect(component.emailValid()).toBeFalse();
    expect(component.canSubmit()).toBeFalse();
    expect(component.showEmailError()).toBeTrue();
  });

  it('reactively enables canSubmit when fields are filled via signals', () => {
    expect(component.canSubmit()).toBeFalse();

    component.name.set('AB');
    expect(component.canSubmit()).toBeFalse();

    component.email.set('jean@exemple.tn');
    component.street.set('1 rue Test');
    component.city.set('Tunis');
    component.governorate.set('Tunis');

    expect(component.canSubmit()).toBeTrue();
  });

  it('enables submit button in DOM when form is valid', () => {
    component.visible = true;
    fillValidIndividualForm();
    fixture.detectChanges();

    const submitBtn = fixture.nativeElement.querySelector('.panel-footer app-button[variant="primary"] button') as HTMLButtonElement;
    expect(submitBtn).toBeTruthy();
    expect(submitBtn.disabled).toBeFalse();
  });

  it('shows consistent name error only when touched and invalid', () => {
    component.name.set('Jean Dupont');
    component.nameTouched.set(true);
    expect(component.showNameError()).toBeFalse();

    component.name.set('A');
    expect(component.showNameError()).toBeTrue();
    expect(component.nameErrorMessage()).toBe('Min. 2 caractères');
  });

  it('blocks submit when name is missing', () => {
    fillValidIndividualForm();
    component.name.set('');
    expect(component.canSubmit()).toBeFalse();
  });

  it('requires NIF for business clients', () => {
    fillValidIndividualForm();
    component.type.set(ClientType.Business);
    component.nif.set('');
    expect(component.canSubmit()).toBeFalse();
    expect(component.nifValid()).toBeFalse();
  });

  it('accepts a valid business NIF', () => {
    fillValidIndividualForm();
    component.type.set(ClientType.Business);
    component.nif.set('8995220/V/V/B/222');
    expect(component.nifValid()).toBeTrue();
    expect(component.canSubmit()).toBeTrue();
  });

  it('accepts lowercase business NIF after normalization', () => {
    fillValidIndividualForm();
    component.type.set(ClientType.Business);
    component.nif.set('9622552/e/v/e/552');
    expect(component.nifValid()).toBeTrue();
    expect(component.canSubmit()).toBeTrue();
  });

  it('sets error message when createClient returns success false', () => {
    fillValidIndividualForm();
    clientService.createClient.and.returnValue(
      of({ success: false, data: null, message: 'Validation echouee', errors: [] } as any)
    );

    component.submit();
    fixture.detectChanges();

    expect(component.errorMessage()).toBe('Validation echouee');
    expect(component.submitting()).toBeFalse();
  });

  it('creates client and emits result on success', () => {
    fillValidIndividualForm();
    const clientId = 'client-1';
    clientService.createClient.and.returnValue(of({ success: true, data: clientId, message: null, errors: [] } as any));
    clientService.getClient.and.returnValue(
      of({
        success: true,
        data: {
          id: clientId,
          code: 'C-001',
          name: 'Jean Dupont',
          email: 'jean@exemple.tn',
          phone: '',
          nif: '',
          type: ClientType.Individual,
          typeDisplay: 'Particulier',
          address: {
            street: '1 rue Test',
            streetLine2: null,
            city: 'Tunis',
            postalCode: null,
            governorate: 'Tunis',
            country: 'Tunisie',
          },
          isActive: true,
          notes: null,
          contactPerson: null,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
        message: null,
        errors: [],
      })
    );

    const emitSpy = spyOn(component.clientCreated, 'emit');
    component.submit();
    fixture.detectChanges();

    expect(emitSpy).toHaveBeenCalled();
    expect(component.visible).toBeFalse();
  });

  it('sets error message on HTTP failure', () => {
    fillValidIndividualForm();
    clientService.createClient.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409 }))
    );

    component.submit();
    fixture.detectChanges();

    expect(component.errorMessage()).toContain('existe');
  });
});
