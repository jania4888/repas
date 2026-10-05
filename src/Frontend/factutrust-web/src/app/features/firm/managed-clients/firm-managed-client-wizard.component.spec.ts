import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { NEVER } from 'rxjs';
import { FirmManagedClientWizardComponent } from './firm-managed-client-wizard.component';
import { FirmManagedClientsService } from '@core/services/firm-managed-clients.service';
import { FirmGovernanceService } from '@core/services/firm-governance.service';
import { FirmContextService } from '@core/services/firm-context.service';
import { ToastService } from '@core/services/toast.service';

describe('FirmManagedClientWizardComponent', () => {
  let fixture: ComponentFixture<FirmManagedClientWizardComponent>;
  let component: FirmManagedClientWizardComponent;
  let create: jasmine.Spy;

  beforeEach(async () => {
    create = jasmine.createSpy('create').and.returnValue(NEVER);

    await TestBed.configureTestingModule({
      imports: [FirmManagedClientWizardComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: FirmManagedClientsService, useValue: { create } },
        { provide: FirmGovernanceService, useValue: { listAssignableAccountants: () => NEVER } },
        { provide: FirmContextService, useValue: { switchClient: () => Promise.resolve() } },
        { provide: ToastService, useValue: { add: jasmine.createSpy('add') } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(FirmManagedClientWizardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  function fillIdentity(): void {
    component.generalForm.patchValue({
      companyName: 'Société Exemple SARL',
      street: 'Rue de la République',
      city: 'Tunis',
      governorate: 'Tunis',
      phone: '',
      email: ''
    });
  }

  it('affiche le masque de matricule fiscal et un téléphone sans astérisque', () => {
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('p-inputmask#nif, p-inputmask[id="nif"]')).not.toBeNull();
    expect(host.textContent).toContain('Format : 1772793W/A/M/000');
    const phoneLabel = host.querySelector('label[for="phone"]');
    expect(phoneLabel?.textContent).toContain('Téléphone');
    expect(phoneLabel?.querySelector('.req')).toBeNull();
  });

  it('rejette un matricule incomplet et n avance pas', () => {
    fillIdentity();
    component.generalForm.controls.nif.setValue('1772793_/A/_/___');
    component.canonicalizeNifField();

    expect(component.generalForm.controls.nif.value).toBe('1772793_/A/_/___');
    expect(component.generalForm.invalid).toBeTrue();

    component.next();
    expect(component.step()).toBe(1);
  });

  it('accepte un matricule canonique collé et un téléphone vide', () => {
    fillIdentity();
    component.generalForm.controls.nif.setValue('1772793W/A/M/000');

    expect(component.generalForm.valid).toBeTrue();
  });

  it('canonise la graphie historique au blur', () => {
    component.generalForm.controls.nif.setValue('1772793/W/A/M/000');
    component.canonicalizeNifField();

    expect(component.generalForm.controls.nif.value).toBe('1772793W/A/M/000');
    expect(component.generalForm.controls.nif.valid).toBeTrue();
  });

  it('rejette un téléphone invalide', () => {
    fillIdentity();
    component.generalForm.controls.nif.setValue('1772793W/A/M/000');
    component.generalForm.controls.phone.setValue('123');

    expect(component.generalForm.invalid).toBeTrue();
    component.next();
    expect(component.step()).toBe(1);
  });

  it('envoie un NIF canonisé et un téléphone null', () => {
    fillIdentity();
    component.generalForm.controls.nif.setValue('1772793w/a/m/000');
    component.generalForm.controls.phone.setValue('   ');

    component.create();

    expect(create).toHaveBeenCalled();
    const body = create.calls.mostRecent().args[0];
    expect(body.nif).toBe('1772793W/A/M/000');
    expect(body.nif).not.toContain('_');
    expect(body.phone).toBeNull();
  });
});
