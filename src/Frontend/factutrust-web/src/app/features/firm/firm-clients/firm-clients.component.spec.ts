import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { FirmClientsComponent } from './firm-clients.component';
import { FirmAssignmentService } from '@core/services/firm-assignment.service';
import { FirmContextService } from '@core/services/firm-context.service';
import { FirmAreaCoherenceService } from '@core/services/firm-area-coherence.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { FirmFeatureFlagsService } from '@core/services/firm-feature-flags.service';
import { FirmGovernanceActionsService } from '../shared/firm-governance-actions.service';
import { FirmGovernanceService } from '@core/services/firm-governance.service';

describe('FirmClientsComponent', () => {
  let fixture: ComponentFixture<FirmClientsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FirmClientsComponent],
      providers: [
        {
          provide: FirmAssignmentService,
          useValue: {
            getActiveClients: () => of({
              success: true,
              data: [{
                assignmentId: 'a1',
                companyTenantId: 't1',
                companyName: 'Ste X',
                activeSince: '2026-01-01',
                hasPermanentFile: false
              }]
            })
          }
        },
        { provide: FirmContextService, useValue: { switchClient: jasmine.createSpy('switchClient').and.returnValue(Promise.resolve()) } },
        // Stub : le service reel s'abonne a router.events, absent du Router simule ci-dessous.
        { provide: FirmAreaCoherenceService, useValue: { enforceNow: () => undefined } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)) } },
        { provide: AuthService, useValue: { isFirmManager: () => false, isFirmAccountant: () => true } },
        { provide: ToastService, useValue: { add: jasmine.createSpy('add') } },
        { provide: ConfirmationService, useValue: { confirm: jasmine.createSpy('confirm') } },
        { provide: FirmFeatureFlagsService, useValue: { isEnabled: () => true } },
        {
          provide: FirmGovernanceActionsService,
          useValue: {
            initializePermanentFile: jasmine.createSpy('initializePermanentFile').and.returnValue(Promise.resolve(true)),
            openPermanentFile: jasmine.createSpy('openPermanentFile')
          }
        },
        {
          provide: FirmGovernanceService,
          useValue: {
            listAssignableAccountants: () => of({ success: true, data: [] }),
            assignManager: () => of({ success: true, data: null }),
            assignManagerBulk: () => of({ success: true, data: { succeeded: 0, failed: [] } })
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(FirmClientsComponent);
    fixture.detectChanges();
  });

  it('affiche le bouton initialiser dossier permanent quand gouvernance activée', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Initialiser dossier permanent');
  });
});
