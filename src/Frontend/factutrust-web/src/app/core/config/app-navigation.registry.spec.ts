import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService, User } from '../services/auth.service';
import {
  ALL_NAV_ITEMS,
  buildFlatNavSearchEntries,
  filterNavItems,
  getAllNavSearchEntries,
  getVisibleNavSearchEntries,
  NavItem,
  NavSubItem
} from './app-navigation.registry';
import { AppModule } from '@core/models/app-module';
import { reportsGroupIsContiguousSuffix, showReportsSeparator } from '@core/utils/nav-section';
import { VARIANT_AXES_PATH } from '@features/settings/variant-axes/variant-axes.paths';

const companyUser: User = {
  id: 'u1',
  email: 'company@test.c',
  firstName: 'A',
  lastName: 'B',
  fullName: 'A B',
  role: 'Administrator',
  roleDisplay: 'Administrateur',
  tenantId: '00000000-0000-0000-0000-000000000001',
  companyName: 'Société Test',
  tenantKind: 'Company',
  twoFactorEnabled: false,
  // Requis depuis le fail-closed : hasModule refuse quand le champ est absent.
  enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  effectivePermissions: ['accounting:read', 'invoices:read']
};

const delegatedFirmUser: User = {
  id: 'u2',
  email: 'firm@test.c',
  firstName: 'O',
  lastName: 'G',
  fullName: 'O G',
  role: 'FirmManager',
  roleDisplay: 'Responsable cabinet',
  tenantId: '00000000-0000-0000-0000-000000000002',
  companyName: 'Cabinet Test',
  tenantKind: 'AccountingFirm',
  accessMode: 'delegated',
  contextTenantId: '00000000-0000-0000-0000-000000000003',
  contextCompanyName: 'Ste Bouzgarou',
  twoFactorEnabled: false,
  enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  effectivePermissions: ['accounting:read', 'treasury:read', 'invoices:read']
};

function setUser(auth: AuthService, u: User | null): void {
  (auth as unknown as { userSignal: { set: (x: User | null) => void } }).userSignal.set(u);
}

describe('app-navigation.registry', () => {
  describe('buildFlatNavSearchEntries', () => {
    it('does not duplicate routes', () => {
      const entries = buildFlatNavSearchEntries();
      const routes = entries.map(e => e.route);
      expect(routes.length).toBe(new Set(routes).size);
    });

    it('includes invoices list with keywords', () => {
      const invoices = buildFlatNavSearchEntries().find(e => e.route === '/invoices');
      expect(invoices).toBeDefined();
      expect(invoices!.label.toLowerCase()).toContain('facture');
      expect(invoices!.keywords?.some(k => k.toLowerCase().includes('facture'))).toBe(true);
    });

    it('includes quick-access create routes', () => {
      const routes = buildFlatNavSearchEntries().map(e => e.route);
      expect(routes).toContain('/invoices/new');
    });

    it('assigns stable ids', () => {
      const entries = buildFlatNavSearchEntries();
      expect(entries.every(e => e.id.length > 0)).toBe(true);
      expect(entries.map(e => e.id).length).toBe(new Set(entries.map(e => e.id)).size);
    });

    it('does not include documentation routes', () => {
      const routes = buildFlatNavSearchEntries().map(e => e.route);
      expect(routes.some(route => route.startsWith('/documentation'))).toBe(false);
    });
  });

  describe('getVisibleNavSearchEntries — company accounting restriction', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()]
      });
    });

    it('excludes operational accounting routes for company users', () => {
      const auth = TestBed.inject(AuthService);
      setUser(auth, companyUser);

      const labels = getVisibleNavSearchEntries(auth).map(e => e.label);
      expect(labels).not.toContain('Saisie manuelle');
      expect(labels).not.toContain('Plan comptable');
    });

    it('excludes documentation routes for company users', () => {
      const auth = TestBed.inject(AuthService);
      setUser(auth, companyUser);

      const routes = getVisibleNavSearchEntries(auth).map(e => e.route);
      expect(routes.some(route => route.startsWith('/documentation'))).toBe(false);
    });

    it('includes allowed accounting state routes for company users', () => {
      const auth = TestBed.inject(AuthService);
      setUser(auth, companyUser);

      const routes = getVisibleNavSearchEntries(auth).map(e => e.route);
      expect(routes).toContain('/accounting/journal');
      expect(routes).toContain('/accounting/vat-declaration');
    });

    it('includes accounting assistant route when company user has ai:chat', () => {
      const auth = TestBed.inject(AuthService);
      setUser(auth, { ...companyUser, effectivePermissions: ['accounting:read', 'ai:chat'] });

      const routes = getVisibleNavSearchEntries(auth).map(e => e.route);
      expect(routes).toContain('/ai-assistant/comptabilite');
    });

    it('excludes accounting assistant route when company user lacks ai:chat', () => {
      const auth = TestBed.inject(AuthService);
      setUser(auth, companyUser);

      const routes = getVisibleNavSearchEntries(auth).map(e => e.route);
      expect(routes).not.toContain('/ai-assistant/comptabilite');
    });
  });

  describe('filterNavItems — nested children', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()]
      });
    });

    it('removes Journal d\'audit without audit:read but keeps hub and other états', () => {
      const auth = TestBed.inject(AuthService);
      setUser(auth, companyUser);

      const items: NavItem[] = [
        {
          label: 'Comptabilité',
          children: [
            {
              label: 'États comptables',
              route: '/accounting/financial-statements',
              modules: [0],
              permissionsAll: ['accounting:read'],
              children: [
                {
                  label: 'Journal',
                  route: '/accounting/journal',
                  modules: [0],
                  permissionsAll: ['accounting:read']
                },
                {
                  label: "Journal d'audit",
                  route: '/audit',
                  modules: [0],
                  permissionsAll: ['audit:read']
                }
              ]
            }
          ]
        }
      ];

      const filtered = filterNavItems(auth, items);
      const etats = filtered[0]?.children?.[0];
      expect(etats?.label).toBe('États comptables');
      expect(etats?.children?.map(c => c.label)).toEqual(['Journal']);
      expect(etats?.children?.some(c => c.label === "Journal d'audit")).toBeFalse();
    });
  });

  describe('getVisibleNavSearchEntries — firm delegated accounting restriction', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()]
      });
    });

    it('includes declaration search entries for delegated firm users', () => {
      const auth = TestBed.inject(AuthService);
      setUser(auth, delegatedFirmUser);

      const entries = getVisibleNavSearchEntries(auth);
      const routes = entries.map(e => e.route);
      const labels = entries.map(e => e.label);

      expect(routes).toContain('/accounting/vat-declaration');
      expect(labels).toContain('Declarations · TVA');
    });

    it('keeps vat-declaration visible for company users', () => {
      const auth = TestBed.inject(AuthService);
      setUser(auth, companyUser);

      const routes = getVisibleNavSearchEntries(auth).map(e => e.route);
      expect(routes).toContain('/accounting/vat-declaration');
    });
  });

  describe('forecasting navigation after Calendrier TN removal', () => {
    it('does not expose /forecasting/calendar in the search index', () => {
      const routes = buildFlatNavSearchEntries().map(e => e.route);
      expect(routes).not.toContain('/forecasting/calendar');
    });

    it('keeps the remaining Prévisions IA routes', () => {
      const routes = buildFlatNavSearchEntries().map(e => e.route);
      expect(routes).toContain('/forecasting/revenue');
      expect(routes).toContain('/forecasting/replenishment');
      expect(routes).toContain('/forecasting/promotions');
      expect(routes).toContain('/forecasting/abc-xyz');
    });

    it('does not list Calendrier commercial under Prévisions IA', () => {
      const forecasting = ALL_NAV_ITEMS.find(i => i.label === 'Prévisions IA');
      const childRoutes = forecasting?.children?.map(c => c.route) ?? [];
      const childLabels = forecasting?.children?.map(c => c.label) ?? [];

      expect(childRoutes).not.toContain('/forecasting/calendar');
      expect(childLabels).not.toContain('Calendrier commercial');
    });
  });

  describe('sales navigation after Brouillons récurrents removal', () => {
    it('does not expose /recurring-contracts/pending-drafts in the search index', () => {
      const routes = buildFlatNavSearchEntries().map(e => e.route);
      expect(routes).not.toContain('/recurring-contracts/pending-drafts');
    });

    it('keeps the Contrats récurrents entry', () => {
      const routes = buildFlatNavSearchEntries().map(e => e.route);
      expect(routes).toContain('/recurring-contracts');
    });

    it('does not list Brouillons récurrents under Ventes', () => {
      const sales = ALL_NAV_ITEMS.find(i => i.label === 'Ventes');
      const childRoutes = sales?.children?.map(c => c.route) ?? [];
      const childLabels = sales?.children?.map(c => c.label) ?? [];

      expect(childRoutes).not.toContain('/recurring-contracts/pending-drafts');
      expect(childLabels).not.toContain('Brouillons récurrents');
      expect(childRoutes).toContain('/recurring-contracts');
    });
  });

  describe('promotions navigation placement', () => {
    it('lists promotions under Paramètres and not under Ventes', () => {
      const ventes = ALL_NAV_ITEMS.find(i => i.label === 'Ventes');
      const settings = ALL_NAV_ITEMS.find(i => i.label === 'Paramètres');

      const ventesRoutes = ventes?.children?.map(c => c.route) ?? [];
      const settingsRoutes = settings?.children?.map(c => c.route) ?? [];

      expect(ventesRoutes).not.toContain('/settings/promotions');
      expect(ventesRoutes).not.toContain('/pricing/promotions');
      expect(settingsRoutes).toContain('/settings/promotions');
    });
  });

  describe('variant axes navigation placement', () => {
    it('lists Axes de variantes under Paramètres and not under Fiches', () => {
      const fiches = ALL_NAV_ITEMS.find(i => i.label === 'Fiches');
      const settings = ALL_NAV_ITEMS.find(i => i.label === 'Paramètres');

      const fichesRoutes = fiches?.children?.map(c => c.route) ?? [];
      const settingsChildren = settings?.children ?? [];
      const entry = settingsChildren.find(c => c.route === VARIANT_AXES_PATH);

      expect(fichesRoutes).not.toContain('/product-attributes');
      expect(fichesRoutes).not.toContain(VARIANT_AXES_PATH);
      expect(entry).toBeDefined();
      expect(entry!.label).toBe('Axes de variantes');
      expect(entry!.platformSettingsOnly).toBeTrue();
      expect(entry!.permissionsAll).toContain('products:read');
    });
  });

  describe('avoir de vente navigation entry', () => {
    it('lists Avoir de vente under Ventes as a read list', () => {
      const ventes = ALL_NAV_ITEMS.find(i => i.label === 'Ventes');
      const entry = ventes?.children?.find(c => c.route === '/invoices/credit-notes');

      expect(entry).toBeDefined();
      expect(entry!.label).toBe('Avoir de vente');
      expect(entry!.permissionsAll).toContain('invoices:read');
    });
  });

  describe('Factures et avoirs (CA HT) search entry', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()]
      });
    });

    it('is search-only: no sidebar entry under Ventes', () => {
      const ventes = ALL_NAV_ITEMS.find(i => i.label === 'Ventes');
      const routes = ventes?.children?.map(c => c.route) ?? [];
      expect(routes).not.toContain('/invoices/revenue');
    });

    it('is exposed to global search with invoices:read + Sales module', () => {
      const auth = TestBed.inject(AuthService);
      setUser(auth, companyUser);

      const entry = getAllNavSearchEntries(auth).find(e => e.route === '/invoices/revenue');
      expect(entry).toBeDefined();
      expect(entry!.group).toBe('page');
      expect(entry!.permissionsAll).toEqual(['invoices:read']);
      expect(entry!.modules).toEqual([AppModule.Sales]);
      expect(entry!.keywords?.some(k => k.includes('ca ht'))).toBe(true);
    });

    it('is hidden from search without invoices:read', () => {
      const auth = TestBed.inject(AuthService);
      setUser(auth, { ...companyUser, effectivePermissions: ['accounting:read'] });

      const routes = getAllNavSearchEntries(auth).map(e => e.route);
      expect(routes).not.toContain('/invoices/revenue');
    });
  });

  describe('bon de retour navigation entry', () => {
    it('places Bon de retour between Bon de Livraison and Factures', () => {
      const ventes = ALL_NAV_ITEMS.find(i => i.label === 'Ventes');
      const labels = (ventes?.children ?? []).map(c => c.label);
      const bl = labels.indexOf('Bon de Livraison');
      const brt = labels.indexOf('Bon de retour');
      const invoices = labels.indexOf('Factures');

      expect(bl).toBeGreaterThanOrEqual(0);
      expect(brt).toBe(bl + 1);
      expect(invoices).toBe(brt + 1);
    });

    it('requires return_notes:read', () => {
      const ventes = ALL_NAV_ITEMS.find(i => i.label === 'Ventes');
      const entry = ventes?.children?.find(c => c.route === '/return-notes');
      expect(entry).toBeDefined();
      expect(entry!.permissionsAll).toContain('return_notes:read');
    });
  });

  describe('Stock · État de stock', () => {
    it('exposes /reports/stock-status under Stock with reports and stock permissions', () => {
      const stock = ALL_NAV_ITEMS.find(i => i.id === 'stock');
      const entry = stock?.children?.find(c => c.id === 'stock--stock-status');
      expect(entry?.route).toBe('/reports/stock-status');
      expect(entry?.permissionsAll).toEqual(['reports:view', 'stock:read']);
    });
  });

  describe('Declarations · Paiements navigation entry (fuite menu ⇔ route)', () => {
    it('requires treasury_forecast:view, matching the /treasury/cash-forecast route guard', () => {
      const comptabilite = ALL_NAV_ITEMS.find(i => i.label === 'Comptabilité');
      const entry = comptabilite?.children?.find(c => c.route === '/treasury');

      expect(entry).toBeDefined();
      // `/treasury` redirige vers `/treasury/cash-forecast` (garde: treasury_forecast:view).
      // `treasury:read` n'existe dans aucune policy backend : l'ancienne valeur rendait
      // cette entrée invisible pour tout le monde, quel que soit le rôle.
      expect(entry!.permissionsAll).toEqual(['treasury_forecast:view']);
    });
  });

  describe('reports submenu group', () => {
    function isSidebarReportRoute(route: string | undefined): boolean {
      if (!route) {
        return false;
      }
      const path = route.split('?')[0].split('#')[0];
      return path === '/reports' || path.startsWith('/reports/') || path.startsWith('/payroll/reports/');
    }

    function assertChildren(children: NavSubItem[] | undefined): void {
      expect(reportsGroupIsContiguousSuffix(children)).toBeTrue();
      for (const child of children ?? []) {
        const marked = child.navGroup === 'reports';
        expect(marked).toBe(isSidebarReportRoute(child.route));
        if (marked) {
          expect(child.route).toBeTruthy();
          expect(child.permissionsAll?.length).toBeGreaterThan(0);
        }
        assertChildren(child.children);
      }
    }

    it('marks only real report routes and keeps each group as a contiguous suffix', () => {
      for (const item of ALL_NAV_ITEMS) {
        assertChildren(item.children);
      }
    });

    it('keeps Contrats récurrents operational and ahead of the sales report block', () => {
      const sales = ALL_NAV_ITEMS.find(i => i.id === 'sales');
      const routes = sales?.children?.map(c => c.route) ?? [];
      const contracts = routes.indexOf('/recurring-contracts');
      const journal = routes.indexOf('/reports/sales-journal');

      expect(contracts).toBeGreaterThanOrEqual(0);
      expect(journal).toBeGreaterThan(contracts);
      expect(sales?.children?.find(c => c.route === '/recurring-contracts')?.navGroup).toBeUndefined();
      expect(sales?.children?.find(c => c.route === '/recurring-contracts')?.permissionsAll).toEqual([
        'recurring_contracts:read'
      ]);
    });

    it('places payroll report forms after the operational and settings entries', () => {
      const hr = ALL_NAV_ITEMS.find(i => i.id === 'hr-payroll');
      expect(hr?.children?.slice(-2).map(c => c.route)).toEqual([
        '/payroll/reports/payroll-book',
        '/payroll/reports/payroll-journal'
      ]);
      expect(hr?.children?.find(c => c.route === '/payroll/declarations')?.navGroup).toBeUndefined();
    });

    it('leaves the treasury cash journal outside the reports group', () => {
      const treasury = ALL_NAV_ITEMS.find(i => i.id === 'treasury');
      expect(treasury?.children?.find(c => c.route === '/payments/cash-journal')?.navGroup).toBeUndefined();
    });

    it('places the treasury cash journal immediately above the reports link', () => {
      const treasury = ALL_NAV_ITEMS.find(i => i.id === 'treasury');
      const children = treasury?.children ?? [];
      expect(children.map(c => c.route)).toEqual([
        '/treasury/cash-forecast',
        '/ai-assistant/tresorerie',
        '/payments/cash-desk',
        '/payments/bank-accounts',
        '/payments/clients',
        '/payments/suppliers',
        '/payments/cash-journal',
        '/reports/payments'
      ]);

      const journal = children.find(c => c.route === '/payments/cash-journal');
      expect(journal?.permissionsAll).toEqual(['payments:read']);
      expect(journal?.modules).toEqual([AppModule.Treasury]);
      expect(journal?.navGroup).toBeUndefined();

      const reports = children[children.length - 1];
      expect(reports?.route).toBe('/reports/payments');
      expect(reports?.navGroup).toBe('reports');
      expect(reports?.permissionsAll).toEqual(['reports:view', 'payments:read']);

      const reportsIndex = children.findIndex(c => c.route === '/reports/payments');
      expect(children.map((_, index) => showReportsSeparator(children, index))).toEqual(
        children.map((_, index) => index === reportsIndex)
      );
    });

    it('keeps the same report routes in search', () => {
      const routes = buildFlatNavSearchEntries().map(e => e.route);
      expect(routes).toContain('/reports/sales');
      expect(routes).toContain('/reports/sales-journal');
      expect(routes).toContain('/reports/purchases');
      expect(routes).toContain('/reports/stock-status');
      expect(routes).toContain('/payroll/reports/payroll-book');
      expect(routes).toContain('/payroll/reports/payroll-journal');
      expect(routes).toContain('/recurring-contracts');
    });
  });

  describe('Assistant IA rail icon', () => {
    it('uses the sparkles glyph and a beta flag, not the company logo', () => {
      const item = ALL_NAV_ITEMS.find(i => i.id === 'ai-assistant');
      expect(item?.icon).toBe('fa-solid fa-wand-magic-sparkles');
      expect(item?.beta).toBeTrue();
      expect(item?.railIconAsset).toBeUndefined();
      expect(item?.route).toBe('/ai-assistant');
      expect(item?.permissionsAll).toEqual(['ai:chat']);
      expect(item?.modules).toEqual([AppModule.AI]);
    });
  });
});
