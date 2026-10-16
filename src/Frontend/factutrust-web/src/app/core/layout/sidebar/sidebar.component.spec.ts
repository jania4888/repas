import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService, User } from '@core/services/auth.service';
import { FirmContextService } from '@core/services/firm-context.service';
import { FirmAssignmentService } from '@core/services/firm-assignment.service';
import { AccountingFeatureFlagsService } from '@features/accounting/shared/accounting-feature-flags.service';
import { StudioNavService } from '@features/studio/studio-nav.service';
import { StudioAiCapabilitiesService } from '@features/studio/ai/studio-ai-capabilities.service';
import { StudioApprovalsBadgeService } from '@features/studio/approvals/studio-approvals-badge.service';
import { getNavId, NAV_ID } from '@core/config/nav-item-ids';
import { StockFeaturesStore } from '@core/services/stock-features-store.service';
import { SidebarComponent } from './sidebar.component';

const firmUser: User = {
  id: 'u1',
  email: 'firm@test.c',
  firstName: 'O',
  lastName: 'G',
  fullName: 'O G',
  role: 'FirmManager',
  roleDisplay: 'Responsable cabinet',
  tenantId: '00000000-0000-0000-0000-000000000002',
  companyName: 'Cabinet Test',
  tenantKind: 'AccountingFirm',
  twoFactorEnabled: false,
  // Requis depuis le fail-closed : hasModule refuse quand le champ est absent.
  enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  effectivePermissions: ['firm:manage', 'accounting:read']
};

const delegatedUser: User = {
  ...firmUser,
  accessMode: 'delegated',
  contextTenantId: '00000000-0000-0000-0000-000000000003',
  contextCompanyName: 'Ste Bouzgarou',
  effectivePermissions: ['accounting:read', 'invoices:read']
};

function setUser(auth: AuthService, u: User | null): void {
  (auth as unknown as { userSignal: { set: (x: User | null) => void } }).userSignal.set(u);
}

/** Utilisateur entreprise avec le module Studio (13) et les droits workflows (4.4j). */
const studioCompanyUser: User = {
  ...firmUser,
  id: 'u-studio',
  email: 'studio@test.c',
  role: 'Administrator',
  roleDisplay: 'Administrateur',
  tenantId: '00000000-0000-0000-0000-000000000004',
  companyName: 'Ste Studio',
  tenantKind: 'Company',
  enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  effectivePermissions: ['studio:design_entities', 'custom_records:read']
};

// Stubs systématiques (4.4j) : évitent tout appel GET /ai/studio/capabilities ou
// workflows/approvals/mine/count pendant le rendu de la navigation.
function makeCapsStub(): { ensureLoaded: jasmine.Spy; workflowsEnabled: WritableSignal<boolean> } {
  return { ensureLoaded: jasmine.createSpy('ensureLoaded'), workflowsEnabled: signal(false) };
}

function makeBadgeStub(): { start: jasmine.Spy; count: WritableSignal<number>; available: WritableSignal<boolean> } {
  return { start: jasmine.createSpy('start'), count: signal(0), available: signal(false) };
}

describe('SidebarComponent — firm navigation', () => {
  let capsStub: ReturnType<typeof makeCapsStub>;
  let badgeStub: ReturnType<typeof makeBadgeStub>;

  beforeEach(() => {
    capsStub = makeCapsStub();
    badgeStub = makeBadgeStub();
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: FirmAssignmentService,
          useValue: {
            getActiveClients: () => of({ success: true, data: [] }),
            getIncomingInvitations: () => of({ success: true, data: [] })
          }
        },
        {
          provide: AccountingFeatureFlagsService,
          useValue: { flags: () => ({ fixedAssetsEnabled: true }) }
        },
        {
          provide: StudioNavService,
          useValue: { items: () => [] }
        },
        {
          provide: StudioAiCapabilitiesService,
          useValue: capsStub
        },
        {
          provide: StudioApprovalsBadgeService,
          useValue: badgeStub
        }
      ]
    });
  });

  it('shows firm native sidemenu labels when not in delegated mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const labels = fixture.componentInstance.navItems().map(i => i.label);
    expect(labels).toContain('Mes dossiers clients');
    expect(labels).not.toContain('Ventes');
    expect(labels).not.toContain('Documentation');
  });

  it('does not show Echeancier fiscal in firm native sidemenu', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const labels = fixture.componentInstance.navItems().map(i => i.label);
    expect(labels).not.toContain('Echeancier fiscal');
  });

  it('shows pending invitations badge on Invitations, not elsewhere', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: FirmAssignmentService,
          useValue: {
            getActiveClients: () => of({ success: true, data: [] }),
            getIncomingInvitations: () =>
              of({ success: true, data: [{ id: 'inv-1' }] })
          }
        },
        {
          provide: AccountingFeatureFlagsService,
          useValue: { flags: () => ({ fixedAssetsEnabled: true }) }
        },
        {
          provide: StudioNavService,
          useValue: { items: () => [] }
        },
        {
          provide: StudioAiCapabilitiesService,
          useValue: makeCapsStub()
        },
        {
          provide: StudioApprovalsBadgeService,
          useValue: makeBadgeStub()
        }
      ]
    });

    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const items = fixture.componentInstance.navItems();
    const invitations = items.find(i => i.label === 'Invitations');
    expect(invitations?.badge).toBe(1);
    expect(items.find(i => i.label === 'Echeancier fiscal')).toBeUndefined();
  });

  it('shows delegated sidemenu sections when in delegated mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const labels = fixture.componentInstance.navItems().map(i => i.label);
    expect(labels.some(l => l.startsWith('Dossier :'))).toBe(true);
    expect(labels).toContain('Ventes');
    expect(labels).not.toContain('Mes dossiers clients');
    expect(labels).not.toContain('Documentation');
  });

  it('keeps moved modules in sidebar for delegated accounting-firm mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...delegatedUser,
      enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14],
      effectivePermissions: [
        'accounting:read',
        'invoices:read',
        'quotes:read',
        'delivery_notes:read',
        'supplier_invoices:read',
        'suppliers:read',
        'purchase_orders:read',
        'payments:read',
        'payroll:read',
        'payroll:declare',
        'payroll:settings',
        'reports:view'
      ]
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const labels = fixture.componentInstance.navItems().map(i => i.label);
    expect(labels).toContain('Ventes');
    expect(labels).toContain('Achats');
    expect(labels).toContain('Trésorerie');
    expect(labels).toContain('RH & Paie');
  });

  it('uses action items for return and change dossier in delegated mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const dossierSection = fixture.componentInstance.navItems().find(i => i.label.startsWith('Dossier :'));
    expect(dossierSection?.children?.find(c => c.label === 'Retour au cabinet')?.action).toBe('returnToFirm');
    expect(dossierSection?.children?.find(c => c.label === 'Changer de dossier')?.action).toBe('changeDossier');
  });

  it('shows the expected ventes and achats submenus in delegated mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...delegatedUser,
      effectivePermissions: [
        'invoices:read',
        'quotes:read',
        'delivery_notes:read',
        'reports:view',
        'supplier_invoices:read',
        'suppliers:read',
        'purchase_orders:read'
      ]
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const ventes = fixture.componentInstance.navItems().find(i => i.label === 'Ventes');
    // « États analytiques » (route /reports/analytics) est bloqué en mode délégué,
    // cf. firm-navigation.registry.ts.
    expect(ventes?.children?.map(c => c.label)).toEqual([
      'Factures',
      'Factures impayées',
      'Solde par client',
      'Rapports'
    ]);

    const achats = fixture.componentInstance.navItems().find(i => i.label === 'Achats');
    // « États analytiques » (route /reports/purchases-analytics) est bloqué de la même façon.
    expect(achats?.children?.map(c => c.label)).toEqual([
      'Factures fournisseurs',
      'Factures impayées',
      'Journal d\'achats',
      'Solde par fournisseur',
      'Rapports'
    ]);
  });

  it('splits accounting into module menus in delegated mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const items = fixture.componentInstance.navItems();
    const labels = items.map(i => i.label);

    // Les modules comptables visibles sont des menus de premier niveau.
    expect(labels).not.toContain('Configuration');
    expect(labels).not.toContain('Traitements');
    expect(labels).not.toContain('États');
    expect(labels).not.toContain('Liasse fiscale');
    expect(labels).toContain('Budgétaire');
    expect(labels).toContain('Declarations');
    expect(labels).toContain('Gestion immobilisations');

    // « Comptabilité » devient un accès direct au hub (route, sans sous-menu).
    const compta = items.find(i => i.label === 'Comptabilité');
    expect(compta?.route).toBe('/accounting/home');
    expect(compta?.children).toBeUndefined();

    const declarations = items.find(i => i.label === 'Declarations');
    const declarationLabels = declarations?.children?.map(c => c.label) ?? [];
    expect(declarationLabels).toContain('Declaration mensuelle');
  });

  it('shows four accounting submenus for company users with AI access', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...firmUser,
      tenantKind: 'Company',
      role: 'Admin',
      roleDisplay: 'Administrateur',
      effectivePermissions: ['accounting:read', 'accounting:create', 'ai:chat']
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const items = fixture.componentInstance.navItems();
    const compta = items.find(i => i.label === 'Comptabilité');
    expect(compta?.children?.map(c => c.label)).toEqual([
      'Assistant Comptabilité',
      'États comptables',
      'Déclaration mensuelle',
      'Liste des immobilisations'
    ]);
    expect(items.map(i => i.label)).not.toContain('Traitements');
    expect(items.map(i => i.label)).not.toContain('Documentation');
  });

  it('renders the Assistant IA rail glyph and BETA badge without the company logo', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...firmUser,
      tenantKind: 'Company',
      role: 'Admin',
      roleDisplay: 'Administrateur',
      effectivePermissions: ['accounting:read', 'accounting:create', 'ai:chat']
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a.rail-link')
    ) as HTMLElement[];
    const assistant = links.find(link => link.textContent?.includes('Assistant IA'));
    expect(assistant).toBeTruthy();
    expect(assistant!.querySelector('i.fa-wand-magic-sparkles')).toBeTruthy();
    expect(assistant!.querySelector('.rail-beta-badge')?.textContent).toContain('BETA');
    expect(assistant!.querySelector('img.rail-icon-img--assistant')).toBeNull();
  });

  it('hides accounting assistant submenu when company user lacks ai:chat', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...firmUser,
      tenantKind: 'Company',
      role: 'Admin',
      roleDisplay: 'Administrateur',
      effectivePermissions: ['accounting:read']
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const compta = fixture.componentInstance.navItems().find(i => i.label === 'Comptabilité');
    expect(compta?.children?.map(c => c.label)).toEqual([
      'États comptables',
      'Déclaration mensuelle',
      'Liste des immobilisations'
    ]);
  });

  it('hides fixed assets submenu for company when feature flag is disabled', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: FirmAssignmentService,
          useValue: {
            getActiveClients: () => of({ success: true, data: [] }),
            getIncomingInvitations: () => of({ success: true, data: [] })
          }
        },
        {
          provide: AccountingFeatureFlagsService,
          useValue: { flags: () => ({ fixedAssetsEnabled: false }) }
        },
        {
          provide: StudioNavService,
          useValue: { items: () => [] }
        },
        {
          provide: StudioAiCapabilitiesService,
          useValue: makeCapsStub()
        },
        {
          provide: StudioApprovalsBadgeService,
          useValue: makeBadgeStub()
        }
      ]
    });

    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...firmUser,
      tenantKind: 'Company',
      role: 'Admin',
      roleDisplay: 'Administrateur',
      effectivePermissions: ['accounting:read']
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const compta = fixture.componentInstance.navItems().find(i => i.label === 'Comptabilité');
    expect(compta?.children?.map(c => c.label)).toEqual([
      'États comptables',
      'Déclaration mensuelle'
    ]);
  });

  it("affiche le badge d'un sous-menu Studio quand count > 0", () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, studioCompanyUser);
    TestBed.inject(FirmContextService).syncFromUser();
    capsStub.workflowsEnabled.set(true);
    badgeStub.count.set(4);

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const studio = fixture.componentInstance.navItems().find(i => i.label === 'Studio');
    expect(studio).toBeTruthy();
    fixture.componentInstance.toggleSubmenu(studio!);
    fixture.detectChanges();

    const badges = fixture.nativeElement.querySelectorAll(
      '[data-testid="nav-child-badge"]'
    ) as NodeListOf<HTMLElement>;
    expect(badges.length).toBe(1);
    expect(badges[0].textContent?.trim()).toBe('4');
    expect(badges[0].getAttribute('aria-label')).toBe('4 en attente');
  });

  it("n'affiche pas de badge de sous-menu à 0", () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, studioCompanyUser);
    TestBed.inject(FirmContextService).syncFromUser();
    capsStub.workflowsEnabled.set(true);

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const studio = fixture.componentInstance.navItems().find(i => i.label === 'Studio');
    expect(studio).toBeTruthy();
    fixture.componentInstance.toggleSubmenu(studio!);
    fixture.detectChanges();

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.submenu-link') as NodeListOf<HTMLElement>
    ).map(a => a.textContent?.trim());
    expect(labels.some(l => l?.includes('Workflows'))).toBeTrue();
    expect(labels.some(l => l?.includes('Mes approbations'))).toBeTrue();
    expect(fixture.nativeElement.querySelector('[data-testid="nav-child-badge"]')).toBeNull();
  });
});

describe('SidebarComponent — collapse', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: FirmAssignmentService,
          useValue: {
            getActiveClients: () => of({ success: true, data: [] }),
            getIncomingInvitations: () => of({ success: true, data: [] })
          }
        },
        {
          provide: AccountingFeatureFlagsService,
          useValue: { flags: () => ({ fixedAssetsEnabled: true }) }
        },
        {
          provide: StudioNavService,
          useValue: { items: () => [] }
        },
        {
          provide: StudioAiCapabilitiesService,
          useValue: makeCapsStub()
        },
        {
          provide: StudioApprovalsBadgeService,
          useValue: makeBadgeStub()
        }
      ]
    });
  });

  it('uses horizontal row layout on rail links when expanded', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', false);
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('.rail-link') as HTMLElement;
    expect(getComputedStyle(link).flexDirection).toBe('row');
  });

  it('applies sidebar-collapsed class when collapsed input is true', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();

    const sidebar = fixture.nativeElement.querySelector('#sidebar') as HTMLElement;
    expect(sidebar.classList.contains('sidebar-collapsed')).toBe(true);
  });

  it('hides rail labels in DOM when collapsed', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();

    const label = fixture.nativeElement.querySelector('.rail-label') as HTMLElement;
    expect(getComputedStyle(label).display).toBe('none');
  });

  it('uses collapsed rail width token on sidebar element', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();

    const sidebar = fixture.nativeElement.querySelector('#sidebar') as HTMLElement;
    expect(getComputedStyle(sidebar).getPropertyValue('--sidebar-rail-width').trim()).toBe('72px');
  });

  it('shows the brand lockup and hides the icon-only mark when expanded', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', false);
    fixture.detectChanges();

    const lockup = fixture.nativeElement.querySelectorAll('.icon-brand-lockup');
    const iconOnly = fixture.nativeElement.querySelectorAll('.icon-logo-only');
    expect(lockup.length).toBe(1);
    expect(iconOnly.length).toBe(0);
    // Fond marine du mode délégué : variante « Insta » blanc.
    expect((lockup[0] as HTMLImageElement).src).toContain('instafact-shell-lockup-on-navy.webp');
    const lockupFilter = getComputedStyle(lockup[0] as HTMLImageElement).filter;
    expect(lockupFilter).not.toContain('invert');
    expect(lockupFilter).not.toContain('brightness(0)');
  });

  it('uses the theme-blue lockup outside the delegated skin', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', false);
    fixture.detectChanges();

    const lockup = fixture.nativeElement.querySelector('.icon-brand-lockup') as HTMLImageElement;
    expect(lockup.src).toContain('instafact-shell-lockup.webp');
    expect(lockup.src).not.toContain('on-navy');
    expect(lockup.alt).toBe('InstaFact');
  });

  it('uses the theme-blue lockup for a company user', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, studioCompanyUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', false);
    fixture.detectChanges();

    const lockup = fixture.nativeElement.querySelector('.icon-brand-lockup') as HTMLImageElement;
    expect(lockup.src).toContain('instafact-shell-lockup.webp');
    expect(lockup.src).not.toContain('on-navy');
  });

  it('sizes the expanded lockup from brand height minus inset', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', false);
    fixture.detectChanges();

    const sidebar = fixture.nativeElement.querySelector('#sidebar') as HTMLElement;
    const lockup = fixture.nativeElement.querySelector('.icon-brand-lockup') as HTMLImageElement;
    expect(getComputedStyle(sidebar).getPropertyValue('--sidebar-brand-logo-inset').trim()).toBe('8px');
    expect(getComputedStyle(lockup).maxHeight).toBe('40px');

    sidebar.style.setProperty('--sidebar-brand-height', '92px');
    expect(getComputedStyle(lockup).maxHeight).toBe('84px');
  });

  it('shows the icon-only mark and hides the brand lockup when collapsed', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();

    const lockup = fixture.nativeElement.querySelectorAll('.icon-brand-lockup');
    const iconOnly = fixture.nativeElement.querySelectorAll('.icon-logo-only');
    expect(lockup.length).toBe(0);
    expect(iconOnly.length).toBe(1);
    expect((iconOnly[0] as HTMLImageElement).src).toContain('instafact-shell-icon.webp');
  });

  it('keeps the collapsed icon within the 72px rail', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();

    const sidebar = fixture.nativeElement.querySelector('#sidebar') as HTMLElement;
    const icon = fixture.nativeElement.querySelector('.icon-logo-only') as HTMLImageElement;
    expect(getComputedStyle(sidebar).getPropertyValue('--sidebar-rail-width').trim()).toBe('72px');
    expect(parseFloat(getComputedStyle(icon).width)).toBeLessThanOrEqual(52);
    expect(parseFloat(getComputedStyle(icon).width)).toBeGreaterThanOrEqual(32);
  });

  it('clears expandedParentId when collapsed becomes true', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', false);
    fixture.detectChanges();

    const ventes = fixture.componentInstance.navItems().find(i => i.label === 'Ventes');
    expect(ventes).toBeTruthy();
    fixture.componentInstance.toggleSubmenu(ventes!);
    expect(fixture.componentInstance.expandedParentId).toBe(NAV_ID.sales);

    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.expandedParentId).toBeNull();
  });

  it('emits requestExpand and opens section when parent clicked in collapsed mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();

    const expandSpy = jasmine.createSpy('requestExpand');
    fixture.componentInstance.requestExpand.subscribe(expandSpy);

    const ventes = fixture.componentInstance.navItems().find(i => i.label === 'Ventes');
    expect(ventes).toBeTruthy();
    fixture.componentInstance.toggleSubmenu(ventes!);

    expect(expandSpy).toHaveBeenCalled();
    expect(fixture.componentInstance.expandedParentId).toBe(NAV_ID.sales);
  });

  it('toggles submenu section when expanded and parent clicked twice', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', false);
    fixture.detectChanges();

    const ventes = fixture.componentInstance.navItems().find(i => i.label === 'Ventes');
    fixture.componentInstance.toggleSubmenu(ventes!);
    expect(fixture.componentInstance.expandedParentId).toBe(NAV_ID.sales);
    fixture.componentInstance.toggleSubmenu(ventes!);
    expect(fixture.componentInstance.expandedParentId).toBeNull();
  });

  it('applies sidebar--firm-delegated class only in delegated accounting-firm mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const nativeFixture = TestBed.createComponent(SidebarComponent);
    nativeFixture.detectChanges();
    const nativeSidebar = nativeFixture.nativeElement.querySelector('#sidebar') as HTMLElement;
    expect(nativeSidebar.classList.contains('sidebar--firm-delegated')).toBe(false);
    expect(nativeFixture.componentInstance.isFirmDelegatedSkin()).toBe(false);

    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const delegatedFixture = TestBed.createComponent(SidebarComponent);
    delegatedFixture.detectChanges();
    const delegatedSidebar = delegatedFixture.nativeElement.querySelector('#sidebar') as HTMLElement;
    expect(delegatedSidebar.classList.contains('sidebar--firm-delegated')).toBe(true);
    expect(delegatedFixture.componentInstance.isFirmDelegatedSkin()).toBe(true);
  });

  it('renders delegated footer with Contrôle & Audit in delegated mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...delegatedUser,
      effectivePermissions: [...(delegatedUser.effectivePermissions ?? []), 'audit:read']
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const footerLabels = fixture.componentInstance.delegatedFooterNav().map(i => i.label);
    expect(footerLabels).toContain('Contrôle & Audit');
    expect(footerLabels).toContain('Paramètres');
    expect(footerLabels).toContain("Centre d'aide");

    const footer = fixture.nativeElement.querySelector('.sidebar-delegated-footer');
    expect(footer).toBeTruthy();
  });

  it('extracts Font Awesome icon key for delegated icon boxes', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.getIconKey('fa-solid fa-bag-shopping')).toBe('fa-bag-shopping');
    expect(fixture.componentInstance.getIconKey(undefined)).toBeNull();
  });

  it('toggles footer submenu independently from rail submenu', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...delegatedUser,
      effectivePermissions: [...(delegatedUser.effectivePermissions ?? []), 'audit:read']
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const audit = fixture.componentInstance.delegatedFooterNav().find(i => i.label === 'Contrôle & Audit');
    expect(audit).toBeTruthy();

    fixture.componentInstance.toggleFooterSubmenu(audit!);
    expect(fixture.componentInstance.expandedFooterLabel).toBe('Contrôle & Audit');
    expect(fixture.componentInstance.expandedParentId).toBeNull();

    const ventes = fixture.componentInstance.navItems().find(i => i.label === 'Ventes');
    fixture.componentInstance.toggleSubmenu(ventes!);
    expect(fixture.componentInstance.expandedParentId).toBe(NAV_ID.sales);
    expect(fixture.componentInstance.expandedFooterLabel).toBeNull();
  });

  it('sets data-tour on rail items that have a tourId', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const ventesAnchor = fixture.nativeElement.querySelector('[data-tour="nav-ventes"]');
    expect(ventesAnchor).toBeTruthy();
  });

  it('expandSectionForTour opens then restoreSectionAfterTour restores', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, delegatedUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const previous = fixture.componentInstance.expandSectionForTour('ventes');
    expect(fixture.componentInstance.expandedParentId).toBe(NAV_ID.sales);
    fixture.componentInstance.restoreSectionAfterTour(previous);
    expect(fixture.componentInstance.expandedParentId).toBe(previous);
  });

  const reportsCompanyUser: User = {
    ...firmUser,
    role: 'Administrator',
    roleDisplay: 'Administrateur',
    tenantKind: 'Company',
    companyName: 'Ste Test',
    enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 17],
    effectivePermissions: ['invoices:read', 'reports:view', 'recurring_contracts:read', 'crm:read']
  };

  function expandSection(fixture: ReturnType<typeof TestBed.createComponent<SidebarComponent>>, label: string): void {
    const section = fixture.componentInstance.navItems().find(item => item.label === label);
    expect(section).withContext(label).toBeTruthy();
    fixture.componentInstance.toggleSubmenu(section!);
    fixture.detectChanges();
  }

  it('draws a non-link Rapports heading before sales report forms', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, reportsCompanyUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    expandSection(fixture, 'Ventes');

    const heading = fixture.nativeElement.querySelector('.submenu-separator__label') as HTMLElement | null;
    expect(heading?.tagName).toBe('H4');
    expect(heading?.textContent?.trim()).toBe('Rapports');
    expect(heading?.closest('a,button')).toBeNull();

    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a.submenu-link') as NodeListOf<HTMLAnchorElement>
    );
    const labels = links.map(link => link.textContent?.trim());
    expect(labels.indexOf('Contrats récurrents')).toBeLessThan(labels.indexOf('Journal de ventes'));
    const hub = links.find(link => link.textContent?.trim() === 'Rapports');
    expect(hub?.getAttribute('href')).toContain('/reports/sales');
    expect(fixture.nativeElement.querySelectorAll('.submenu-separator').length).toBe(1);
  });

  it('omits the Rapports heading when no report child is visible', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...reportsCompanyUser,
      effectivePermissions: ['invoices:read', 'recurring_contracts:read']
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    expandSection(fixture, 'Ventes');

    expect(fixture.nativeElement.querySelector('.submenu-separator')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Factures');
    expect(fixture.nativeElement.textContent).not.toContain('Journal de ventes');
  });

  it('does not draw a Rapports heading in a section without report forms', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, reportsCompanyUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    expandSection(fixture, 'CRM Commercial');

    expect(fixture.nativeElement.querySelector('.submenu-separator')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Opportunités');
  });

  const treasuryCompanyUser: User = {
    ...firmUser,
    role: 'Administrator',
    roleDisplay: 'Administrateur',
    tenantKind: 'Company',
    companyName: 'Ste Test',
    enabledModuleIds: [3, 4],
    effectivePermissions: ['payments:read', 'reports:view']
  };

  it('places the treasury journal under the Rapports heading', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, treasuryCompanyUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    expandSection(fixture, 'Trésorerie');

    const list = fixture.nativeElement.querySelector('ul.submenu-list') as HTMLElement;
    const links = Array.from(list.querySelectorAll('a.submenu-link') as NodeListOf<HTMLAnchorElement>);
    const labels = links.map(link => link.textContent?.trim());
    expect(labels).toEqual([
      'Caisse',
      'Comptes bancaires',
      'Paiements clients',
      'Paiements fournisseurs',
      'Journal de trésorerie',
      'Rapports'
    ]);

    const hub = links.find(link => link.textContent?.trim() === 'Rapports');
    expect(hub?.getAttribute('href')).toContain('/reports/payments');

    const heading = list.querySelector('.submenu-separator__label') as HTMLElement | null;
    expect(heading?.tagName).toBe('H4');
    expect(heading?.textContent?.trim()).toBe('Rapports');
    expect(heading?.closest('a,button')).toBeNull();
    expect(list.querySelectorAll('.submenu-separator').length).toBe(1);

    const journalLink = links.find(link => link.textContent?.trim() === 'Journal de trésorerie');
    expect(journalLink?.getAttribute('href')).toContain('/payments/cash-journal');
    const journalItem = journalLink?.closest('li');
    const separator = heading?.closest('li');
    const reportsItem = hub?.closest('li');
    expect(separator?.nextElementSibling).toBe(journalItem);
    expect(journalItem?.nextElementSibling).toBe(reportsItem);
  });

  it('keeps the treasury journal under Rapports when reports:view is missing', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...treasuryCompanyUser,
      effectivePermissions: ['payments:read']
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    expandSection(fixture, 'Trésorerie');

    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a.submenu-link') as NodeListOf<HTMLAnchorElement>
    );
    const labels = links.map(link => link.textContent?.trim());
    expect(labels.at(-1)).toBe('Journal de trésorerie');
    expect(labels).not.toContain('Rapports');
    const journalLink = links.find(link => link.textContent?.trim() === 'Journal de trésorerie');
    expect(journalLink?.getAttribute('href')).toContain('/payments/cash-journal');

    const heading = fixture.nativeElement.querySelector('.submenu-separator__label') as HTMLElement | null;
    expect(heading?.textContent?.trim()).toBe('Rapports');
    expect(heading?.closest('a,button')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.submenu-separator').length).toBe(1);
    expect(heading?.closest('li')?.nextElementSibling).toBe(journalLink?.closest('li'));
    expect(links.some(link => link.getAttribute('href')?.includes('/reports/payments'))).toBeFalse();
  });

  const settingsCompanyUser: User = {
    ...firmUser,
    id: 'u-settings',
    email: 'settings@test.c',
    role: 'Administrator',
    roleDisplay: 'Administrateur',
    tenantKind: 'Company',
    companyName: 'Ste Test',
    enabledModuleIds: [1, 2, 5, 10, 14],
    effectivePermissions: [
      'settings:read',
      'settings:update',
      'pricing:read',
      'products:read',
      'withholding_tax:read',
      'payroll:settings'
    ]
  };

  it('colors settings submenu icons by stable id without reusing that id on other sliders', () => {
    const auth = TestBed.inject(AuthService);
    const store = TestBed.inject(StockFeaturesStore);
    spyOn(store, 'ensureLoaded');
    spyOn(store, 'productVariantsEnabled').and.returnValue(true);
    setUser(auth, settingsCompanyUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();

    const settings = fixture.componentInstance.navItems().find(item => getNavId(item) === NAV_ID.settings);
    expect(settings).toBeTruthy();
    fixture.componentInstance.toggleSubmenu(settings!);
    fixture.detectChanges();
    expect(fixture.componentInstance.expandedParentId).toBe(NAV_ID.settings);

    const icons = Array.from(
      fixture.nativeElement.querySelectorAll('ul.submenu-list a.submenu-link i') as NodeListOf<HTMLElement>
    );
    expect(icons.map(icon => icon.getAttribute('data-nav-id'))).toEqual([
      'settings--settings',
      'settings--settings-modules',
      'settings--settings-promotions',
      'settings--settings-variant-axes'
    ]);
    expect(icons.map(icon => Array.from(icon.classList).sort().join(' '))).toEqual([
      'fa-sliders fa-solid',
      'fa-solid fa-th-large',
      'fa-bullhorn fa-solid',
      'fa-solid fa-th-large'
    ].map(value => value.split(' ').sort().join(' ')));
    expect(icons.every(icon => icon.getAttribute('aria-hidden') === 'true')).toBeTrue();

    expandSection(fixture, 'Fiscal / TEJ');
    const fiscalSliders = Array.from(
      fixture.nativeElement.querySelectorAll('ul.submenu-list i.fa-sliders') as NodeListOf<HTMLElement>
    );
    expect(fiscalSliders.map(icon => icon.getAttribute('data-nav-id'))).toEqual([
      'fiscal-tej--withholding-tax-settings'
    ]);

    expandSection(fixture, 'RH & Paie');
    const payrollSliders = Array.from(
      fixture.nativeElement.querySelectorAll('ul.submenu-list i.fa-sliders') as NodeListOf<HTMLElement>
    );
    expect(payrollSliders.map(icon => icon.getAttribute('data-nav-id'))).toEqual([
      'hr-payroll--payroll-settings'
    ]);
  });
});
