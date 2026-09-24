import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FirmInvitationsComponent } from './firm-invitations.component';
import { FirmAssignmentService, FirmClientAssignment } from '@core/services/firm-assignment.service';
import { AuthService } from '@core/services/auth.service';
import { FirmInvitationActionsService } from '../shared/firm-invitation-actions.service';
import { of } from 'rxjs';

describe('FirmInvitationsComponent', () => {
  let fixture: ComponentFixture<FirmInvitationsComponent>;
  let component: FirmInvitationsComponent;

  const invitation: FirmClientAssignment = {
    id: 'a1',
    companyTenantId: 'c1',
    companyName: 'Société Hadad',
    firmTenantId: 'f1',
    firmDisplayName: 'Cabinet',
    status: 0,
    statusDisplay: 'En attente',
    requestedAt: '2026-07-20T10:00:00Z',
    companyProfile: {
      schemaVersion: 1,
      capturedAtUtc: '2026-07-20T10:00:00Z',
      companyName: 'Société Hadad',
      nif: '1234567/A/B/C/000',
      taxRegime: 0,
      street: '12 rue Test',
      city: 'Tunis',
      governorate: 'Tunis',
      email: 'contact@hadad.tn',
      phone: '+21620123456'
    }
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FirmInvitationsComponent],
      providers: [
        {
          provide: FirmAssignmentService,
          useValue: {
            getIncomingInvitations: () => of({ success: true, data: [invitation] }),
            getMyProfile: () => of({ success: true, data: { governorate: 'Tunis', completeness: 100, isPublicInDirectory: true, missing: [] } })
          }
        },
        {
          provide: AuthService,
          useValue: { isFirmManager: () => true }
        },
        {
          provide: FirmInvitationActionsService,
          useValue: { accept: jasmine.createSpy('accept'), reject: jasmine.createSpy('reject') }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(FirmInvitationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose company profile in items', () => {
    expect(component.items()[0].companyProfile?.nif).toBe('1234567/A/B/C/000');
  });

  it('formatLocation joins city and governorate', () => {
    expect(component.formatLocation(invitation)).toBe('Tunis, Tunis');
  });

  it('formatContact joins email and phone', () => {
    expect(component.formatContact(invitation)).toContain('contact@hadad.tn');
  });
});
