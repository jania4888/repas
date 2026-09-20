import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { environment } from '@environments/environment';
import { AuthResponse, AuthService, User } from '@core/services/auth.service';
import { FirmContextService } from '@core/services/firm-context.service';
import { FirmAssignmentService } from '@core/services/firm-assignment.service';
import { AccountingFeatureFlagsService } from '@features/accounting/shared/accounting-feature-flags.service';
import { StudioNavService } from '@features/studio/studio-nav.service';
import { StudioAiCapabilitiesService } from '@features/studio/ai/studio-ai-capabilities.service';
import { StudioApprovalsBadgeService } from '@features/studio/approvals/studio-approvals-badge.service';
import { AppModule } from '@core/models/app-module';
import { SECONDARY_NAV_SECTION_ORDER } from '@core/config/secondary-nav.config';
import { AppNavService } from './app-nav.service';
import { StockFeaturesStore } from './stock-features-store.service';
import { VARIANT_AXES_PATH } from '@features/settings/variant-axes/variant-axes.paths';

const ALL_MODULES = Object.values(AppModule).filter((v): v is number => typeof v === 'number');

const companyUser: User = {
  id: 'u-company',
  email: 'company@test.c',
  firstName: 'A',
  lastName: 'B',
  fullName: 'A B',
  role: 'Administrator',
  roleDisplay: 'Administrateur',
  tenantId: '00000000-0000-0000-0000-000000000001',
  companyName: 'Ste Test',
  tenantKind: 'Company',
  twoFactorEnabled: false,
  enabledModuleIds: ALL_MODULES,
  effectivePermissions: [
    'quotes:read',
    'delivery_notes:read',
    'invoices:read',
    'suppliers:read',
    'purchase_orders:read',
    'supplier_invoices:read',
    'clients:read',
    'products:read',
    'stock:read',
    'stock_transfers:read',
    'stock_vouchers:read',
    'inventory:read',
    'payments:read',
    'reports:view',
    'withholding_tax:read',
    'withholding_tax:export',
    'payroll:read',
    'payroll:declare',
    'payroll:settings',
    'accounting:read',
    'ai:chat'
  ]
};

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
  enabledModuleIds: ALL_MODULES,
  effectivePermissions: [
    'firm:manage',
    'accounting:read',
    'honoraires.invoices:read',
    'honoraires.quotes:read',
    'honoraires.payments:read'
  ]
};

const firmAccountantUser: User = {
  ...firmUser,
  id: 'u2',
  role: 'FirmAccountant',
  roleDisplay: 'Comptable cabinet',
  effectivePermissions: ['accounting:read']
};

const delegatedUser: User = {
  ...firmUser,
  accessMode: 'delegated',
  contextTenantId: '00000000-0000-0000-0000-000000000003',
  contextCompanyName: 'Ste Bouzgarou',
  effectivePermissions: [
    'accounting:read',
    'invoices:read',
    'quotes:read',
    'delivery_notes:read',
    'suppliers:read',
    'purchase_orders:read',
    'supplier_invoices:read',
    'payments:read',
    'reports:view',
    'withholding_tax:read',
    'withholding_tax:export',
    'payroll:read'
  ]
};

function setUser(auth: AuthService, u: User | null): void {
  (auth as unknown as { userSignal: { set: (x: User | null) => void } }).userSignal.set(u);
}

/** Concepteur Studio : droits de conception + lecture des enregistrements (4.4j). */
const studioDesignerUser: User = {
  ...companyUser,
  id: 'u-studio-designer',
  effectivePermissions: [
    ...companyUser.effectivePermissions!,
    'studio:design_entities',
    'custom_records:read'
  ]
};

interface CapsStub {
  ensureLoaded: jasmine.Spy;
  workflowsEnabled: WritableSignal<boolean>;
}

interface BadgeStub {
  start: jasmine.Spy;
  count: WritableSignal<number>;
  available: WritableSignal<boolean>;
}

// Stubs systématiques (4.4j) : évitent tout appel GET /ai/studio/capabilities ou
// workflows/approvals/mine/count que l'afterEach ne draine pas.
function makeCapsStub(): CapsStub {
  return { ensureLoaded: jasmine.createSpy('ensureLoaded'), workflowsEnabled: signal(false) };
}

function makeBadgeStub(): BadgeStub {
  return { start: jasmine.createSpy('start'), count: signal(0), available: signal(false) };
}

describe('AppNavService — secondary nav parity', () => {
  let capsStub: CapsStub;
  let badgeStub: BadgeStub;

  beforeEach(() => {
    capsStub = makeCapsStub();
    badgeStub = makeBadgeStub();
    TestBed.configureTestingModule({
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

  it('exposes secondary sections in the requested order for a company user', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, companyUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    const labels = nav.secondaryNavSections().map(s => s.label);

    expect(labels).toEqual([...SECONDARY_NAV_SECTION_ORDER]);
    expect(nav.hasSecondaryNav()).toBeTrue();
  });

  it('keeps secondary routes as a subset of sidebar routes (parity)', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, companyUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    const sidebarRoutes = new Set(
      nav
        .navItems()
        .flatMap(item => [
          ...(item.route ? [item.route] : []),
          ...(item.children?.map(c => c.route).filter((r): r is string => !!r) ?? [])
        ])
    );
    const secondaryRoutes = nav.secondaryNavSections().flatMap(item => [
      ...(item.route ? [item.route] : []),
      ...(item.children?.map(c => c.route).filter((r): r is string => !!r) ?? [])
    ]);

    for (const route of secondaryRoutes) {
      expect(sidebarRoutes.has(route)).withContext(route).toBeTrue();
    }
  });

  it('hides secondary nav in firm native mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    expect(nav.secondaryNavSections()).toEqual([]);
    expect(nav.hasSecondaryNav()).toBeFalse();
  });

  it('hides manager-only firm nav entries for FirmAccountant', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmAccountantUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    const labels = nav.navItems().map(item => item.label);
    const routes = nav
      .navItems()
      .flatMap(item => [
        ...(item.route ? [item.route] : []),
        ...(item.children?.map(c => c.route).filter((r): r is string => !!r) ?? [])
      ]);

    expect(labels).not.toContain('Facturation');
    expect(labels).not.toContain('Paiements');
    expect(labels).not.toContain('Rentabilité de collaborateurs');
    expect(labels).not.toContain('Paie interne');
    expect(routes).not.toContain('/firm/collaborateurs');
    expect(routes).not.toContain('/firm/billing/invoices');
    expect(routes).not.toContain('/firm/billing/payments');
    expect(routes).not.toContain('/firm/governance/dossier-time-profitability');
    expect(routes).not.toContain('/firm/payroll');
    expect(routes).toContain('/firm/governance/time-sheets');
    expect(routes).toContain('/firm/settings');
    expect(labels).not.toContain('Suivi social');
    expect(routes).not.toContain('/firm/governance/social');
  });

  it('shows manager-only firm nav entries for FirmManager', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    const labels = nav.navItems().map(item => item.label);
    const routes = nav
      .navItems()
      .flatMap(item => [
        ...(item.route ? [item.route] : []),
        ...(item.children?.map(c => c.route).filter((r): r is string => !!r) ?? [])
      ]);

    expect(labels).toContain('Facturation');
    expect(labels).not.toContain('Paiements');
    expect(labels).toContain('Rentabilité de collaborateurs');
    expect(labels).toContain('Paie interne');
    expect(labels).not.toContain('Suivi social');
    expect(routes).not.toContain('/firm/governance/social');
    expect(routes).toContain('/firm/collaborateurs');
    expect(routes).toContain('/firm/billing/invoices');
    expect(routes).toContain('/firm/payroll');
    expect(routes).toContain('/firm/billing/payments');

    const facturation = nav.navItems().find(i => i.label === 'Facturation');
    expect(facturation?.children?.map(c => c.label)).toEqual([
      'Factures',
      'Avoirs',
      'Devis',
      'Encaissements'
    ]);
    expect(facturation?.children?.some(c => c.route === '/firm/billing/payments')).toBe(true);
  });

  it('hides the portfolio revision entry without firm:revision:view', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmAccountantUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    const routes = nav.navItems().map(item => item.route);

    expect(routes).not.toContain('/firm/revision');
  });

  it('shows the portfolio revision entry to both firm roles that hold firm:revision:view', () => {
    const auth = TestBed.inject(AuthService);
    const context = TestBed.inject(FirmContextService);
    const nav = TestBed.inject(AppNavService);

    for (const base of [firmUser, firmAccountantUser]) {
      setUser(auth, {
        ...base,
        effectivePermissions: [...base.effectivePermissions!, 'firm:revision:view']
      });
      context.syncFromUser();

      const items = nav.navItems();
      const idxAssistant = items.findIndex(i => i.route === '/firm/assistant');
      const idxRevision = items.findIndex(i => i.route === '/firm/revision');

      expect(idxRevision)
        .withContext(`${base.role} doit voir /firm/revision`)
        .toBeGreaterThanOrEqual(0);
      expect(items[idxRevision].label).toBe('Révision du portefeuille');
      // « Chef de mission » n'est visible que via firm:ai:chat, absent de ces deux jeux de
      // permissions : on vérifie l'ordre seulement lorsqu'il est effectivement rendu.
      if (idxAssistant >= 0) {
        expect(idxRevision).toBe(idxAssistant + 1);
      }
    }
  });

  it('shows accounting modules only in secondary nav for delegated accounting-firm mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...delegatedUser,
      enabledModuleIds: [...ALL_MODULES, AppModule.Payroll],
      effectivePermissions: [
        ...delegatedUser.effectivePermissions!,
        'payroll:read',
        'payroll:declare',
        'payroll:settings'
      ]
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    const labels = nav.secondaryNavSections().map(s => s.label);
    const sidebarLabels = nav.navItems().map(s => s.label);

    expect(labels).not.toContain('Ventes');
    expect(labels).not.toContain('Achats');
    expect(labels).not.toContain('Trésorerie');
    expect(labels).not.toContain('RH & Paie');
    expect(labels).not.toContain('Fiscal / TEJ');
    expect(labels).toContain('Configuration');
    expect(labels).toContain('Traitements');
    expect(labels).toContain('États');
    expect(labels).toContain('Liasse fiscale');

    expect(sidebarLabels).toContain('Ventes');
    expect(sidebarLabels).toContain('Achats');
    expect(sidebarLabels).toContain('Trésorerie');
    expect(sidebarLabels).toContain('RH & Paie');
  });

  it('hides Ventes/Achats/Trésorerie in sidebar for firm-managed delegated dossiers', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...delegatedUser,
      isFirmManaged: true,
      enabledModuleIds: [
        AppModule.Accounting,
        AppModule.Fiscal,
        AppModule.Reports,
        AppModule.Payroll
      ],
      effectivePermissions: [
        ...delegatedUser.effectivePermissions!,
        'payroll:read',
        'payroll:declare',
        'payroll:settings'
      ]
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    const sidebarLabels = nav.navItems().map(s => s.label);

    expect(sidebarLabels).not.toContain('Ventes');
    expect(sidebarLabels).not.toContain('Achats');
    expect(sidebarLabels).not.toContain('Trésorerie');
    expect(sidebarLabels).toContain('RH & Paie');
  });

  it('exposes delegated footer nav with audit and help links', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...delegatedUser,
      effectivePermissions: [...(delegatedUser.effectivePermissions ?? []), 'audit:read']
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    expect(nav.delegatedFooterNav().map(i => i.label)).toEqual([
      'Contrôle & Audit',
      'Paramètres',
      "Centre d'aide"
    ]);

    const help = nav.delegatedFooterNav().find(i => i.label === "Centre d'aide");
    expect(help?.externalUrl).toContain('https://');
  });

  it('returns empty delegated footer nav outside delegated mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    expect(nav.delegatedFooterNav()).toEqual([]);
  });

  it('omits empty sections after permission filtering', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...companyUser,
      effectivePermissions: ['invoices:read', 'quotes:read', 'delivery_notes:read']
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    const labels = nav.secondaryNavSections().map(s => s.label);

    expect(labels).toContain('Ventes');
    expect(labels).not.toContain('Stock');
    expect(labels).not.toContain('RH & Paie');
  });

  it('hides "CRM Commercial" from the sidebar for a BTP & Construction company without the CRM module (plan §6.2)', () => {
    const auth = TestBed.inject(AuthService);
    // Mirrors a BTP & Construction sector provisioning: core modules + BTP's recommended set
    // (Purchases, Stock, Projects, Fiscal) — CRM is not part of that segment's matrix.
    setUser(auth, {
      ...companyUser,
      enabledModuleIds: [
        AppModule.Administration,
        AppModule.Clients,
        AppModule.Products,
        AppModule.Sales,
        AppModule.Treasury,
        AppModule.Reports,
        AppModule.Purchases,
        AppModule.Stock,
        AppModule.Projects,
        AppModule.Fiscal
      ]
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    const labels = nav.navItems().map(i => i.label);

    expect(labels).not.toContain('CRM Commercial');
  });

  it('shows "CRM Commercial" in the sidebar once the CRM module + crm:read are granted', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...companyUser,
      enabledModuleIds: [AppModule.Administration, AppModule.Sales, AppModule.CRM],
      effectivePermissions: ['crm:read']
    });
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    const labels = nav.navItems().map(i => i.label);

    expect(labels).toContain('CRM Commercial');
  });

  function settingsChildRoutes(nav: AppNavService): string[] {
    return (
      nav
        .navItems()
        .find(i => i.label === 'Paramètres')
        ?.children?.map(c => c.route)
        .filter((r): r is string => !!r) ?? []
    );
  }

  it('hides Axes de variantes under Paramètres when product variants are disabled', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, companyUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const store = TestBed.inject(StockFeaturesStore);
    spyOn(store, 'productVariantsEnabled').and.returnValue(false);

    const nav = TestBed.inject(AppNavService);
    expect(settingsChildRoutes(nav)).not.toContain(VARIANT_AXES_PATH);
  });

  it('shows Axes de variantes under Paramètres when product variants are enabled', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, companyUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const store = TestBed.inject(StockFeaturesStore);
    spyOn(store, 'productVariantsEnabled').and.returnValue(true);

    const nav = TestBed.inject(AppNavService);
    expect(settingsChildRoutes(nav)).toContain(VARIANT_AXES_PATH);
  });

  function studioChildLabels(nav: AppNavService): string[] {
    return nav.navItems().find(i => i.label === 'Studio')?.children?.map(c => c.label) ?? [];
  }

  it('ajoute Workflows et Mes approbations à la section Studio quand workflowsEnabled est vrai', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, studioDesignerUser);
    TestBed.inject(FirmContextService).syncFromUser();
    capsStub.workflowsEnabled.set(true);

    const nav = TestBed.inject(AppNavService);
    const labels = studioChildLabels(nav);

    expect(labels).toEqual(['Concepteur de tables', 'Assistant IA', 'Workflows', 'Mes approbations']);
    const studio = nav.navItems().find(i => i.label === 'Studio');
    const workflows = studio?.children?.find(c => c.label === 'Workflows');
    expect(workflows?.route).toBe('/studio/workflows');
    expect(workflows?.permissionsAll).toEqual(['studio:design_entities']);
    const approvals = studio?.children?.find(c => c.label === 'Mes approbations');
    expect(approvals?.route).toBe('/studio/approvals');
    expect(approvals?.permissionsAll).toEqual(['custom_records:read']);
    expect(approvals?.badge).toBeNull(); // compteur à 0 ⇒ pas de badge
  });

  it('masque ces entrées quand la capacité est fausse', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, studioDesignerUser);
    TestBed.inject(FirmContextService).syncFromUser();

    const nav = TestBed.inject(AppNavService);
    const labels = studioChildLabels(nav);

    expect(labels).toEqual(['Concepteur de tables', 'Assistant IA']);
    expect(labels).not.toContain('Workflows');
    expect(labels).not.toContain('Mes approbations');
  });

  it('porte le compteur du badge sur Mes approbations et démarre le polling pour un concepteur', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, studioDesignerUser);
    TestBed.inject(FirmContextService).syncFromUser();
    capsStub.workflowsEnabled.set(true);
    badgeStub.count.set(4);

    const nav = TestBed.inject(AppNavService);
    const approvals = nav
      .navItems()
      .find(i => i.label === 'Studio')
      ?.children?.find(c => c.label === 'Mes approbations');

    expect(approvals?.badge).toBe(4);
    expect(badgeStub.start).toHaveBeenCalled();
    expect(capsStub.ensureLoaded).toHaveBeenCalled();

    // Sans studio:design_entities : ni chargement des capacités ni polling (403 évités).
    badgeStub.start.calls.reset();
    capsStub.ensureLoaded.calls.reset();
    setUser(auth, companyUser);
    TestBed.inject(FirmContextService).syncFromUser();

    nav.navItems();

    expect(badgeStub.start).not.toHaveBeenCalled();
    expect(capsStub.ensureLoaded).not.toHaveBeenCalled();
  });

  // 4.5d1 (D11 levée) : un lecteur `custom_records:read` sans `studio:design_entities` voit
  // « Mes approbations » dès que la sonde du badge a répondu 200 (`available`), sans jamais
  // charger les capacités (403 pour ce profil) ; « Workflows » reste réservé au concepteur.
  it("affiche « Mes approbations » avec son badge pour un lecteur custom_records:read sans design_entities quand la sonde du badge répond", () => {
    const auth = TestBed.inject(AuthService);
    const readerUser: User = {
      ...companyUser,
      id: 'u-studio-reader',
      effectivePermissions: [...(companyUser.effectivePermissions ?? []), 'custom_records:read']
    };
    setUser(auth, readerUser);
    TestBed.inject(FirmContextService).syncFromUser();
    capsStub.workflowsEnabled.set(false);
    badgeStub.available.set(true);
    badgeStub.count.set(2);

    const nav = TestBed.inject(AppNavService);
    const studio = nav.navItems().find(i => i.label === 'Studio');
    const approvals = studio?.children?.find(c => c.label === 'Mes approbations');

    expect(approvals).toBeDefined();
    expect(approvals?.badge).toBe(2);
    expect(studioChildLabels(nav)).not.toContain('Workflows');
    expect(badgeStub.start).toHaveBeenCalled();
    expect(capsStub.ensureLoaded).not.toHaveBeenCalled();
  });

  it("masque « Mes approbations » pour un lecteur quand la sonde a répondu 404 (drapeau coupé)", () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, {
      ...companyUser,
      id: 'u-studio-reader',
      effectivePermissions: [...(companyUser.effectivePermissions ?? []), 'custom_records:read']
    });
    TestBed.inject(FirmContextService).syncFromUser();
    capsStub.workflowsEnabled.set(true); // ignorée pour un lecteur : seule la sonde fait foi
    badgeStub.available.set(false);

    const nav = TestBed.inject(AppNavService);

    expect(studioChildLabels(nav)).not.toContain('Mes approbations');
    expect(studioChildLabels(nav)).not.toContain('Workflows');
    expect(badgeStub.start).toHaveBeenCalled();
    expect(capsStub.ensureLoaded).not.toHaveBeenCalled();
  });

  // D-44-88 / D-44-92 : les vrais services écrivent un signal de façon synchrone
  // (`_state.set(…)` dans ensureLoaded(), `polling.set(true)` dans start()). Appelés
  // directement dans le computed navItems, ils levaient NG0600 (page blanche pour un
  // concepteur, 4.4j). Des stubs qui écrivent un signal reproduisent ce comportement :
  // le test échoue si les appels sortent du bloc `untracked(...)`.
  it("n'écrit aucun signal dans le computed navItems (NG0600) quand ensureLoaded() et start() écrivent des signaux", () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, studioDesignerUser);
    TestBed.inject(FirmContextService).syncFromUser();
    const capsState = signal(0);
    const polling = signal(false);
    capsStub.ensureLoaded.and.callFake(() => capsState.set(1));
    badgeStub.start.and.callFake(() => polling.set(true));

    const nav = TestBed.inject(AppNavService);

    expect(() => nav.navItems()).not.toThrow();
    expect(capsState()).toBe(1);
    expect(polling()).toBeTrue();
  });
});

function makeRegisterTestJwt(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = btoa(JSON.stringify({ exp }));
  return `e.${payload}.s`;
}

// Tâche 1.3 du plan : fraîcheur de la session frontend après inscription — le
// signal utilisateur (et donc la navigation calculée) doit refléter les modules
// choisis à l'inscription sans rechargement de page ni relogin.
describe('AppNavService — sidebar freshness right after register()', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
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
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Le warm-up IA post-inscription et le chargement des feature flags Stock sont des
    // effets de bord fire-and-forget non testés ici : on les draine avant verify().
    httpMock.match(r => r.url.endsWith('/ai/warm-up')).forEach(r => r.flush({ warmed: true }));
    httpMock
      .match(r => r.url.includes('/stock/features'))
      .forEach(r => r.flush({ success: true, data: {}, message: null, errors: [] }));
    httpMock.verify();
  });

  it('exposes Ventes/Achats/Stock in navItems() right after register(), with no reload', () => {
    const auth = TestBed.inject(AuthService);
    TestBed.inject(FirmContextService).syncFromUser();
    const nav = TestBed.inject(AppNavService);

    // Avant inscription : aucun utilisateur, navigation vide (sauf éléments publics).
    expect(nav.navItems().map(i => i.label)).not.toContain('Ventes');

    const registeredUser: User = {
      ...companyUser,
      id: 'u-registered',
      // Commerce · Textile avec Achats/Stock/Fiscal : Core + [Purchases, Stock, Fiscal].
      enabledModuleIds: [
        AppModule.Clients,
        AppModule.Products,
        AppModule.Sales,
        AppModule.Treasury,
        AppModule.Reports,
        AppModule.Administration,
        AppModule.Purchases,
        AppModule.Stock,
        AppModule.Fiscal
      ]
    };
    const authData: AuthResponse = {
      accessToken: makeRegisterTestJwt(),
      refreshToken: 'r',
      expiresAt: '',
      user: registeredUser,
      requires2Fa: false
    };

    auth.register({
      email: 'a@b.c',
      password: 'x',
      confirmPassword: 'x',
      firstName: 'A',
      lastName: 'B',
      companyName: 'Ste Test',
      nif: '1234567',
      taxRegime: 0,
      street: 'Rue 1',
      city: 'Tunis',
      governorate: 'Tunis',
      companyEmail: 'co@b.c',
      phone: '20000000',
      companySegment: 'commerce',
      businessDomain: 'textile-habillement',
      enabledModules: registeredUser.enabledModuleIds
    }).subscribe();

    const req = httpMock.expectOne(
      r => r.url === `${environment.apiUrl}/auth/register` && r.method === 'POST'
    );
    req.flush({ success: true, data: authData, message: null, errors: [] });

    // Sans rechargement ni relogin : navItems() (computed) reflète déjà les
    // nouveaux modules dès que le signal utilisateur change.
    const labels = nav.navItems().map(i => i.label);
    expect(labels).toContain('Ventes');
    expect(labels).toContain('Achats');
    expect(labels).toContain('Stock');
  });
});
