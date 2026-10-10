import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Observable, of, throwError } from 'rxjs';
import { FirmClientsComponent } from './firm-clients.component';
import { FirmAssignmentService, FirmClientDossier } from '@core/services/firm-assignment.service';
import { FirmContextService } from '@core/services/firm-context.service';
import { FirmAreaCoherenceService } from '@core/services/firm-area-coherence.service';
import { FIRM_DELEGATED_HOME_ROUTE } from '@core/config/firm-area-access';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { FirmFeatureFlagsService } from '@core/services/firm-feature-flags.service';
import { FirmGovernanceActionsService } from '../shared/firm-governance-actions.service';
import { FirmGovernanceService } from '@core/services/firm-governance.service';

function dossier(
  partial: Partial<FirmClientDossier> & Pick<FirmClientDossier, 'assignmentId' | 'companyName'>
): FirmClientDossier {
  return {
    companyTenantId: `t-${partial.assignmentId}`,
    activeSince: '2026-10-02',
    hasPermanentFile: false,
    permanentFileStatus: null,
    assignedAccountantName: 'Cabinet salem',
    assignedAccountantUserId: 'u-salem',
    isAwaitingAccountantAssignment: false,
    isFirmManaged: true,
    ...partial
  };
}

const steX = dossier({
  assignmentId: 'a1',
  companyTenantId: 't1',
  companyName: 'Ste X',
  activeSince: '2026-01-01'
});

const texto = dossier({
  assignmentId: 'a-texto',
  companyName: 'Ste Texto',
  assignedAccountantName: 'Cabinet Rania',
  assignedAccountantUserId: 'u-rania',
  hasPermanentFile: true,
  permanentFileStatus: 2,
  permanentFileStatusDisplay: 'Complet',
  isFirmManaged: false
});

const alia = dossier({
  assignmentId: 'a-alia',
  companyName: 'Sté Alía',
  assignedAccountantName: 'Cabinet salem',
  hasPermanentFile: true,
  permanentFileStatus: 1,
  permanentFileStatusDisplay: 'En cours',
  isFirmManaged: true
});

interface SetupOptions {
  role?: 'manager' | 'accountant';
  governance?: boolean;
  clients?: FirmClientDossier[];
  success?: boolean;
  message?: string | null;
  error?: { error?: { message?: string } } | null;
}

describe('FirmClientsComponent', () => {
  let fixture: ComponentFixture<FirmClientsComponent>;
  let getActiveClients: jasmine.Spy;
  let toastAdd: jasmine.Spy;
  let confirm: jasmine.Spy;
  let switchClient: jasmine.Spy;
  let enforceNow: jasmine.Spy;
  let initializePermanentFile: jasmine.Spy;

  async function setup(opts: SetupOptions = {}): Promise<void> {
    const role = opts.role ?? 'accountant';
    const governance = opts.governance ?? true;
    const clients = opts.clients ?? [steX];
    getActiveClients = jasmine.createSpy('getActiveClients').and.returnValue(
      opts.error
        ? throwError(() => opts.error)
        : of({
          success: opts.success ?? true,
          data: clients,
          message: opts.message ?? null,
          errors: []
        })
    );
    toastAdd = jasmine.createSpy('add');
    confirm = jasmine.createSpy('confirm');
    switchClient = jasmine.createSpy('switchClient').and.resolveTo(undefined);
    enforceNow = jasmine.createSpy('enforceNow');
    initializePermanentFile = jasmine.createSpy('initializePermanentFile').and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [FirmClientsComponent, NoopAnimationsModule, RouterTestingModule],
      providers: [
        { provide: FirmAssignmentService, useValue: { getActiveClients, revokeClient: () => of({ success: true, data: null, message: null, errors: [] }) } },
        { provide: FirmContextService, useValue: { switchClient } },
        { provide: FirmAreaCoherenceService, useValue: { enforceNow } },
        {
          provide: AuthService,
          useValue: {
            isFirmManager: () => role === 'manager',
            isFirmAccountant: () => role === 'accountant'
          }
        },
        { provide: ToastService, useValue: { add: toastAdd } },
        { provide: ConfirmationService, useValue: { confirm } },
        { provide: FirmFeatureFlagsService, useValue: { isEnabled: () => governance } },
        {
          provide: FirmGovernanceActionsService,
          useValue: {
            initializePermanentFile,
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
  }

  function text(): string {
    return fixture.nativeElement.textContent as string;
  }

  describe('comptable, dossier sans permanent', () => {
    beforeEach(async () => {
      await setup();
    });

    it('affiche le bouton initialiser dossier permanent quand gouvernance activée', () => {
      expect(text()).toContain('Initialiser dossier permanent');
      expect(fixture.nativeElement.querySelector('.fc-actions i.pi.pi-folder-open')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[aria-label="Initialiser dossier permanent"] i.pi.pi-file-plus')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.fc-actions i.pi.pi-book')).toBeNull();
    });

    it('masque créer, affecter et résilier', () => {
      expect(text()).not.toContain('Créer un dossier client');
      expect(fixture.nativeElement.querySelector('.fc-actions [aria-label="Affecter"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('.fc-actions [aria-label="Résilier"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[aria-label="Ouvrir la comptabilité"]')).not.toBeNull();
    });
  });

  describe('recherche et affichage', () => {
    beforeEach(async () => {
      await setup({ role: 'manager', clients: [alia, texto] });
    });

    it('filtre par société sans rappeler l’API', () => {
      expect(getActiveClients).toHaveBeenCalledTimes(1);
      fixture.componentInstance.onSearchChange('Texto');
      fixture.detectChanges();
      expect(getActiveClients).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.filteredClients().map(r => r.companyName)).toEqual(['Ste Texto']);
      expect(text()).toContain('Ste Texto');
      expect(text()).not.toContain('Sté Alía');
      expect(text()).toContain('1 dossier sur 2');
    });

    it('réinitialise les filtres et la page', () => {
      fixture.componentInstance.tableFirst.set(15);
      fixture.componentInstance.onSearchChange('Texto');
      fixture.detectChanges();
      expect(fixture.componentInstance.tableFirst()).toBe(0);
      expect(text()).toContain('Réinitialiser');

      fixture.componentInstance.resetFilters();
      fixture.detectChanges();
      expect(fixture.componentInstance.filteredClients().length).toBe(2);
      expect(text()).toContain('Sté Alía');
      expect(text()).toContain('Ste Texto');
      expect(text()).not.toContain('Réinitialiser');
    });

    it('affiche un message quand aucun dossier ne correspond', () => {
      fixture.componentInstance.onSearchChange('zzzz-introuvable');
      fixture.detectChanges();
      expect(text()).toContain('Aucun dossier ne correspond aux filtres.');
      expect(fixture.nativeElement.querySelector('#fc-search')).not.toBeNull();
    });

    it('borne la saisie de recherche', () => {
      const input = fixture.nativeElement.querySelector('#fc-search') as HTMLInputElement;
      expect(input.maxLength).toBe(80);
      expect(input.getAttribute('autocomplete')).toBe('off');
    });

    it('affiche le nom XSS comme texte, sans balise', () => {
      const payload = 'Ste <img src=x onerror=alert(1)>';
      fixture.componentInstance.clients.set([
        dossier({ assignmentId: 'xss', companyName: payload, assignedAccountantName: 'Cabinet salem' })
      ]);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('img')).toBeNull();
      expect(text()).toContain(payload);
    });

    it('conserve les filtres après rechargement', () => {
      fixture.componentInstance.onSearchChange('Texto');
      getActiveClients.and.returnValue(of({
        success: true,
        data: [alia, texto],
        message: null,
        errors: []
      }));
      fixture.componentInstance.load();
      fixture.detectChanges();
      expect(fixture.componentInstance.search()).toBe('Texto');
      expect(fixture.componentInstance.filteredClients().map(r => r.assignmentId)).toEqual(['a-texto']);
    });

    it('affiche le glyphe prévu sur chaque action', () => {
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('i.pi.pi-plus')).not.toBeNull();

      const actions = root.querySelectorAll('.fc-actions');
      expect(actions.length).toBe(2);

      const first = actions[0];
      expect(first.querySelector('i.pi.pi-folder-open')).not.toBeNull();
      expect(first.querySelector('i.pi.pi-book')).not.toBeNull();
      expect(first.querySelector('i.pi.pi-file-plus')).toBeNull();
      expect(first.querySelector('[aria-label="Affecter"] i.pi.pi-user-plus')).not.toBeNull();
      expect(first.querySelector('[aria-label="Résilier"] i.pi.pi-times')).not.toBeNull();

      const withPermanentFile = actions[1];
      expect(withPermanentFile.querySelector('i.pi.pi-book')).not.toBeNull();
      expect(withPermanentFile.querySelector('i.pi.pi-file-plus')).toBeNull();

      fixture.componentInstance.onSearchChange('Texto');
      fixture.detectChanges();
      expect(root.querySelector('.ft-filters__reset i.pi.pi-filter-slash')).not.toBeNull();
    });

    it('expose les actions manager et exige une confirmation avant résiliation', () => {
      expect(text()).toContain('Créer un dossier client');
      expect(fixture.nativeElement.querySelector('.fc-actions [aria-label="Affecter"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.fc-actions [aria-label="Résilier"]')).not.toBeNull();
      expect(text()).toContain('Comptabilité');
      expect(fixture.nativeElement.querySelector('.p-datatable-sm, .p-datatable')).not.toBeNull();

      const resilier = fixture.nativeElement.querySelector('.fc-actions [aria-label="Résilier"]') as HTMLButtonElement;
      resilier.click();
      expect(confirm).toHaveBeenCalled();
      const message = confirm.calls.mostRecent().args[0].message as string;
      expect(message).toContain('Sté Alía');
      expect(message).not.toContain('<');
    });

    it('ouvre le dossier via le contexte cabinet, sans navigation forcée si elle aboutit', async () => {
      const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
      const open = fixture.nativeElement.querySelector('[aria-label="Ouvrir la comptabilité"]') as HTMLButtonElement;
      open.click();
      await fixture.whenStable();
      expect(switchClient).toHaveBeenCalledWith(alia.companyTenantId);
      expect(navigate).toHaveBeenCalledWith([FIRM_DELEGATED_HOME_ROUTE]);
      expect(enforceNow).not.toHaveBeenCalled();
    });

    it('ignore une taille de page hors liste', () => {
      fixture.componentInstance.onTablePage({ first: -4, rows: 99999 });
      expect(fixture.componentInstance.tableRows()).toBe(15);
      expect(fixture.componentInstance.tableFirst()).toBe(0);
      fixture.componentInstance.onTablePage({ first: 25, rows: 25 });
      expect(fixture.componentInstance.tableRows()).toBe(25);
      expect(fixture.componentInstance.tableFirst()).toBe(25);
    });
  });

  describe('liste vide', () => {
    it('affiche l’état comptable sans barre de recherche', async () => {
      await setup({ role: 'accountant', clients: [] });
      expect(text()).toContain('Aucun dossier affecté');
      expect(fixture.nativeElement.querySelector('#fc-search')).toBeNull();
    });

    it('affiche l’état manager avec l’invitation à créer', async () => {
      await setup({ role: 'manager', clients: [] });
      expect(text()).toContain('Aucun dossier client');
      expect(text()).toContain('Invitations');
      expect(fixture.nativeElement.querySelector('#fc-search')).toBeNull();
    });
  });

  describe('échec de chargement', () => {
    it('n’affiche pas un faux état vide et propose de réessayer', async () => {
      await setup({ error: { error: { message: 'Serveur indisponible' } } });
      expect(text()).toContain('Impossible de charger les dossiers');
      expect(text()).toContain('Serveur indisponible');
      expect(text()).not.toContain('Aucun dossier client');
      expect(text()).not.toContain('Aucun dossier affecté');
      expect(toastAdd).toHaveBeenCalled();

      getActiveClients.and.returnValue(of({
        success: true,
        data: [texto],
        message: null,
        errors: []
      }) as Observable<unknown>);
      const retry = Array.from(fixture.nativeElement.querySelectorAll('button'))
        .find(b => (b as HTMLButtonElement).textContent?.includes('Réessayer')) as HTMLButtonElement;
      retry.click();
      fixture.detectChanges();
      expect(text()).toContain('Ste Texto');
      expect(text()).not.toContain('Impossible de charger les dossiers');
    });

    it('conserve la liste déjà affichée si un rechargement échoue', async () => {
      await setup({ role: 'manager', clients: [alia, texto] });
      getActiveClients.and.returnValue(throwError(() => ({ error: { message: 'Coupure réseau' } })));
      fixture.componentInstance.load();
      fixture.detectChanges();
      expect(fixture.componentInstance.clients().length).toBe(2);
      expect(text()).toContain('Coupure réseau');
      expect(text()).toContain('Ste Texto');
      expect(text()).toContain('Réessayer');
    });
  });

  describe('gouvernance désactivée', () => {
    beforeEach(async () => {
      await setup({ role: 'manager', governance: false, clients: [steX] });
    });

    it('masque le filtre et les actions de dossier permanent', () => {
      expect(fixture.nativeElement.querySelector('#fc-dp')).toBeNull();
      expect(text()).not.toContain('Initialiser dossier permanent');
      expect(fixture.nativeElement.querySelector('.fc-actions [aria-label="Affecter"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('.fc-actions [aria-label="Résilier"]')).not.toBeNull();
      expect(text()).toContain('—');
    });
  });

  it('initialise le dossier permanent avec l’identifiant du dossier', async () => {
    await setup();
    const btn = fixture.nativeElement.querySelector('[aria-label="Initialiser dossier permanent"]') as HTMLButtonElement;
    btn.click();
    expect(initializePermanentFile).toHaveBeenCalledWith({
      assignmentId: 'a1',
      companyName: 'Ste X'
    });
  });
});
