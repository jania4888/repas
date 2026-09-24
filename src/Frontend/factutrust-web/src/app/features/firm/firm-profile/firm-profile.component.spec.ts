import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { FirmProfileComponent } from './firm-profile.component';
import { FirmAssignmentService } from '@core/services/firm-assignment.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';

describe('FirmProfileComponent', () => {
  const profile = {
    tenantId: 'f1',
    displayName: 'Cabinet Ahmed',
    description: 'Présentation publique',
    city: 'Tunis',
    governorate: 'Tunis',
    isPublicInDirectory: true,
    professionalRegistrationNumber: 'ORDRE-1',
    contactEmail: 'secret@cabinet.tn',
    contactPhone: '71111222',
    practiceAreas: ['tva'],
    clientSegments: [],
    languages: ['fr'],
    completeness: 100,
    missing: [] as string[]
  };

  function setup() {
    const updateMyProfile = jasmine.createSpy('updateMyProfile').and.returnValue(of({ success: true, data: null }));
    const confirm = jasmine.createSpy('confirm');
    TestBed.configureTestingModule({
      imports: [FirmProfileComponent],
      providers: [
        {
          provide: FirmAssignmentService,
          useValue: {
            getMyProfile: () => of({ success: true, data: { ...profile } }),
            updateMyProfile
          }
        },
        { provide: ToastService, useValue: { add: jasmine.createSpy('add') } },
        { provide: ConfirmationService, useValue: { confirm } }
      ]
    });
    const fixture = TestBed.createComponent(FirmProfileComponent);
    fixture.detectChanges();
    return { fixture, confirm };
  }

  it('shows a public preview without phone or email', () => {
    const { fixture } = setup();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Aperçu société');
    expect(text).toContain('Cabinet Ahmed');
    expect(text).toContain('N° d’inscription');
    const preview = fixture.nativeElement.querySelector('.fp-side') as HTMLElement;
    expect(preview.textContent).not.toContain('71111222');
    expect(preview.textContent).not.toContain('secret@cabinet.tn');
  });

  it('asks for confirmation before hiding the directory profile', () => {
    const { fixture, confirm } = setup();
    fixture.componentInstance.onVisibility(false);
    expect(confirm).toHaveBeenCalled();
    const message = confirm.calls.mostRecent().args[0].message as string;
    expect(message).toContain('ne vous trouveront plus');
    expect(fixture.componentInstance.profile()?.isPublicInDirectory).toBeTrue();
  });
});