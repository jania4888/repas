import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { FirmDashboardComponent } from './firm-dashboard.component';
import { FirmDashboardService } from '@core/services/firm-dashboard.service';
import { FirmGovernanceService } from '@core/services/firm-governance.service';
import { FirmFeatureFlagsService } from '@core/services/firm-feature-flags.service';
import { AuthService } from '@core/services/auth.service';
import { FirmInvitationActionsService } from '../shared/firm-invitation-actions.service';
import { FirmAssignmentService } from '@core/services/firm-assignment.service';
import { ProductOnboardingApiService } from '@core/onboarding/product-onboarding.service';

const firmPayload = {
  success: true,
  data: {
    activeClientsCount: 6,
    pendingInvitationsCount: 1,
    inactiveDossiersCount: 1,
    vatDraftsCount: 1,
    overdueSchedulesCount: 95,
    upcomingWithin7DaysCount: 20,
    tejPendingCount: 30,
    liasseDraftsCount: 0,
    dtsPendingCount: 4,
    overdueEstimatedAmount: 1200,
    upcoming7DaysEstimatedAmount: 500,
    clients: [
      {
        assignmentId: 'a1',
        companyTenantId: 't1',
        companyName: 'Ste X',
        activeSince: '2026-01-01',
        isInactive30Days: false
      }
    ],
    pendingInvitations: [
      {
        id: 'inv1',
        companyName: 'Ste Y',
        requestedAt: '2026-03-01T10:00:00Z',
        notes: 'test'
      }
    ]
  },
  message: null,
  errors: [] as string[]
};

const govPayload = {
  success: true,
  data: {
    activeDossiersCount: 6,
    permanentFilesCompleteCount: 2,
    permanentFilesInProgressCount: 1,
    totalBillableHoursMonth: 4.25,
    totalBillableHoursYear: 4.25,
    pendingExpenseNotesCount: 0,
    overdueFiscalSchedulesCount: 95,
    unreadNotificationsCount: 0
  },
  message: null,
  errors: [] as string[]
};

describe('FirmDashboardComponent', () => {
  let fixture: ComponentFixture<FirmDashboardComponent>;
  let govGetDashboard: jasmine.Spy;
  let firmGetDashboard: jasmine.Spy;
  let featureFlags: { isEnabled: jasmine.Spy };

  async function setup(opts: {
    governanceEnabled: boolean;
    govError?: boolean;
    isFirmManager?: boolean;
  }): Promise<void> {
    firmGetDashboard = jasmine.createSpy('getDashboard').and.returnValue(of(firmPayload));
    govGetDashboard = jasmine
      .createSpy('getDashboard')
      .and.returnValue(opts.govError ? throwError(() => new Error('gov down')) : of(govPayload));
    featureFlags = {
      isEnabled: jasmine.createSpy('isEnabled').and.callFake((key: string) =>
        key === 'firmGovernance' || key === 'firmDecisionTables' ? opts.governanceEnabled : false
      )
    };

    await TestBed.configureTestingModule({
      imports: [FirmDashboardComponent, RouterTestingModule],
      providers: [
        { provide: FirmDashboardService, useValue: { getDashboard: firmGetDashboard, getDecisionTables: jasmine.createSpy('getDecisionTables').and.returnValue(of({
          success: true,
          data: {
            criticalFiscalSchedules: [],
            atRiskDossiers: [],
            negativeMargins: [],
            pendingTimeSheets: [],
            honorairesAlerts: [],
            meta: { generatedAt: '2026-03-12', partialFailures: [] }
          },
          message: null,
          errors: []
        })) } },
        { provide: FirmGovernanceService, useValue: { getDashboard: govGetDashboard } },
        { provide: FirmFeatureFlagsService, useValue: featureFlags },
        {
          provide: AuthService,
          useValue: {
            user: () => ({
              companyName: 'Cabinet Test',
              productOnboardingStatus: 'Completed',
              productOnboardingChecklist: { dismissed: true, doneIds: [] }
            }),
            isFirmManager: () => opts.isFirmManager ?? true,
            isAccountingFirm: () => true,
            isDelegatedMode: () => false,
            isAdmin: () => false,
            hasPermission: () => true
          }
        },
        {
          provide: ProductOnboardingApiService,
          useValue: {
            get: () => of(null),
            patch: () => of(null),
            replayTick: () => 0,
            isTourRunning: () => false,
            requestReplay: () => undefined
          }
        },
        {
          provide: FirmAssignmentService,
          useValue: {
            getMyProfile: () => of({
              success: true,
              data: { completeness: 100, isPublicInDirectory: true, missing: [] }
            })
          }
        },
        {
          provide: FirmInvitationActionsService,
          useValue: {
            accept: jasmine.createSpy('accept').and.returnValue(Promise.resolve(true)),
            reject: jasmine.createSpy('reject').and.returnValue(Promise.resolve(true))
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(FirmDashboardComponent);
    fixture.detectChanges();
  }

  it('flag off: charge uniquement le dashboard ops (pas d’appel gouvernance)', async () => {
    await setup({ governanceEnabled: false });
    const text = fixture.nativeElement.textContent as string;

    expect(firmGetDashboard).toHaveBeenCalled();
    expect(govGetDashboard).not.toHaveBeenCalled();
    expect(text).toContain('Dossiers actifs');
    expect(text).toContain('Invitations en attente');
    expect(text).toContain('Échéances en retard');
    expect(text).toContain('TEJ en attente');
    expect(text).not.toContain('Dossiers permanents complets');
    expect(text).not.toContain('Feuilles de temps');
    expect(text).not.toContain('Conformité, productivité et pilotage multi-dossiers');
  });

  it('flag on: affiche KPIs gouvernance et tuiles modules honnêtes', async () => {
    await setup({ governanceEnabled: true });
    const text = fixture.nativeElement.textContent as string;

    expect(firmGetDashboard).toHaveBeenCalled();
    expect(govGetDashboard).toHaveBeenCalled();
    expect(text).toContain('Dossiers permanents complets');
    expect(text).toContain('DP en cours');
    expect(text).toContain('Heures facturables (mois)');
    expect(text).toContain('Notes de frais en attente');
    expect(text).toContain('Dossiers permanents');
    expect(text).toContain('Feuilles de temps');
    expect(text).toContain('Notes de frais');
    expect(text).toContain('Invitations clients');
    expect(text).not.toContain('Suivi social & paie');
    expect(text).not.toContain('Gestion des portefeuilles');
    expect(text).toContain('Conformité, productivité et pilotage multi-dossiers');
    // dédup: une seule occurrence des libellés partagés
    expect(text.split('Dossiers actifs').length - 1).toBe(1);
    expect(text.split('Échéances en retard').length - 1).toBe(1);
  });

  it('erreur gouvernance: affiche toujours les KPIs ops', async () => {
    await setup({ governanceEnabled: true, govError: true });
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Dossiers actifs');
    expect(text).toContain('Échéances en retard');
    expect(text).toContain('Mes dossiers');
    expect(text).not.toContain('Dossiers permanents complets');
  });

  it('FirmManager voit la section pilotage décisionnel', async () => {
    await setup({ governanceEnabled: true, isFirmManager: true });
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Pilotage décisionnel');
  });

  it('collaborateur ne voit pas la section pilotage décisionnel', async () => {
    await setup({ governanceEnabled: true, isFirmManager: false });
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Pilotage décisionnel');
  });

  it('FirmManager voit les actions Accepter / Refuser sur les invitations', async () => {
    await setup({ governanceEnabled: true, isFirmManager: true });
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Accepter');
    expect(text).toContain('Refuser');
    expect(text).toMatch(/1[,.]?200/);
    expect(text).toContain('TND estimés');
  });
});
