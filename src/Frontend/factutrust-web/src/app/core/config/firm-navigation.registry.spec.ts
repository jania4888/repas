import {
  DELEGATED_FIRM_ACHATS_ALLOWED_ROUTES,
  DELEGATED_FIRM_VENTES_ALLOWED_ROUTES,
  FIRM_NATIVE_NAV,
  filterFirmGovernanceNav,
  filterFirmRevisionNav,
  filterDelegatedFirmSectionChildren,
  isDelegatedFirmBlockedSalesPurchasesRoute,
  isDelegatedFirmBlockedAiAssistantRoute,
  isDelegatedReadOnlyRoute,
  isFirmDelegatedReadonly
} from './firm-navigation.registry';
import { filterFirmManagerNav } from './firm-manager-access.config';
import { NavItem, NavSubItem } from './app-navigation.registry';
import { NAV_ID } from './nav-item-ids';

describe('firm-navigation.registry — FIRM_NATIVE_NAV', () => {
  const governanceRoutes = [
    '/firm/governance/permanent-files',
    '/firm/affectation',
    '/firm/governance/time-sheets',
    '/firm/governance/leaves',
    '/firm/payroll',
    '/firm/governance/dossier-time-profitability',
    '/firm/governance/collaborator-rentability',
    '/firm/governance/collaborator-costs'
  ];

  function collectRoutes(items: NavItem[]): string[] {
    const routes: string[] = [];
    for (const item of items) {
      if (item.route) {
        routes.push(item.route);
      }
      if (item.children?.length) {
        for (const child of item.children) {
          if (child.route) {
            routes.push(child.route);
          }
        }
      }
    }
    return routes;
  }

  it('FIRM_NATIVE_NAV includes fiscal schedule route', () => {
    expect(FIRM_NATIVE_NAV.some(i => i.route === '/firm/fiscal-schedule')).toBe(true);
  });

  it('FIRM_NATIVE_NAV no longer includes governance parent section', () => {
    expect(FIRM_NATIVE_NAV.some(i => i.label === 'Gouvernance')).toBe(false);
  });

  it('FIRM_NATIVE_NAV groups dossier and collaborator rentability under one parent', () => {
    const parent = FIRM_NATIVE_NAV.find(i => i.label === 'Rentabilité de collaborateurs');
    expect(parent).toBeTruthy();
    expect(parent!.route).toBeUndefined();
    expect(parent!.children?.map(c => c.route)).toEqual([
      '/firm/governance/dossier-time-profitability',
      '/firm/governance/collaborator-rentability',
      '/firm/governance/collaborator-costs'
    ]);
    expect(FIRM_NATIVE_NAV.some(i => i.label === 'Feuilles de temps et rentabilité')).toBe(false);
    expect(FIRM_NATIVE_NAV.some(i => i.label === 'Rentabilité collaborateurs')).toBe(false);
    const paie = FIRM_NATIVE_NAV.find(i => i.label === 'Paie interne');
    expect(paie?.route).toBe('/firm/payroll');
    expect(paie?.children).toBeUndefined();
  });

  it('FIRM_NATIVE_NAV places Paie interne directly after Congés & Absences', () => {
    const idxConges = FIRM_NATIVE_NAV.findIndex(i => i.label === 'Congés & Absences');
    const idxPaie = FIRM_NATIVE_NAV.findIndex(i => i.label === 'Paie interne');
    const idxRenta = FIRM_NATIVE_NAV.findIndex(i => i.label === 'Rentabilité de collaborateurs');
    expect(idxPaie).toBe(idxConges + 1);
    expect(idxRenta).toBeGreaterThan(idxPaie);
    expect(FIRM_NATIVE_NAV[idxPaie].route).toBe('/firm/payroll');
  });

  it('FIRM_NATIVE_NAV exposes governance routes in expected order (top-level + children)', () => {
    const extractedGovernanceRoutes = collectRoutes(FIRM_NATIVE_NAV).filter(route =>
      governanceRoutes.includes(route)
    );
    expect(extractedGovernanceRoutes).toEqual(governanceRoutes);
  });

  it('FIRM_NATIVE_NAV has no governance dashboard route', () => {
    expect(collectRoutes(FIRM_NATIVE_NAV).includes('/firm/governance/dashboard')).toBe(false);
  });

  it('FIRM_NATIVE_NAV no longer includes Suivi social', () => {
    expect(FIRM_NATIVE_NAV.some(i => i.label === 'Suivi social')).toBe(false);
    expect(collectRoutes(FIRM_NATIVE_NAV)).not.toContain('/firm/governance/social');
  });

  it('FIRM_NATIVE_NAV no longer exposes Notes de frais dirigeants', () => {
    expect(collectRoutes(FIRM_NATIVE_NAV)).not.toContain('/firm/governance/expense-notes');
    expect(FIRM_NATIVE_NAV.some(i => i.label === 'Notes de frais dirigeants')).toBe(false);
  });

  it('filterFirmGovernanceNav removes governance when flag off', () => {
    const filtered = filterFirmGovernanceNav(FIRM_NATIVE_NAV, false);
    expect(filtered.some(i => i.label === 'Gouvernance')).toBe(false);
    expect(filtered.some(i => i.label === 'Rentabilité de collaborateurs')).toBe(false);
    expect(filtered.some(i => i.label === 'Paie interne')).toBe(false);
    expect(collectRoutes(filtered).some(route => route.startsWith('/firm/governance'))).toBe(false);
    expect(collectRoutes(filtered).includes('/firm/affectation')).toBe(false);
    expect(collectRoutes(filtered).includes('/firm/payroll')).toBe(false);
  });

  it('filterFirmGovernanceNav keeps governance when flag on', () => {
    const filtered = filterFirmGovernanceNav(FIRM_NATIVE_NAV, true);
    const extractedGovernanceRoutes = collectRoutes(filtered).filter(route =>
      governanceRoutes.includes(route)
    );
    expect(extractedGovernanceRoutes).toEqual(governanceRoutes);
    expect(filtered.some(i => i.label === 'Rentabilité de collaborateurs')).toBe(true);
    expect(filtered.some(i => i.label === 'Paie interne')).toBe(true);
  });

  it('manager/off matrix keeps visibility equivalent to old behavior', () => {
    const managerFlagOn = collectRoutes(filterFirmGovernanceNav(FIRM_NATIVE_NAV, true)).filter(route =>
      governanceRoutes.includes(route)
    );
    expect(managerFlagOn).toHaveSize(8);

    const managerFlagOff = collectRoutes(filterFirmGovernanceNav(FIRM_NATIVE_NAV, false)).filter(route =>
      governanceRoutes.includes(route)
    );
    expect(managerFlagOff).toHaveSize(0);

    const nonManagerFlagOn = collectRoutes(
      filterFirmManagerNav(filterFirmGovernanceNav(FIRM_NATIVE_NAV, true), false)
    ).filter(route => governanceRoutes.includes(route));
    expect(nonManagerFlagOn).toEqual([
      '/firm/governance/permanent-files',
      '/firm/governance/time-sheets',
      '/firm/governance/leaves'
    ]);

    const nonManagerFlagOff = collectRoutes(
      filterFirmManagerNav(filterFirmGovernanceNav(FIRM_NATIVE_NAV, false), false)
    ).filter(route => governanceRoutes.includes(route));
    expect(nonManagerFlagOff).toHaveSize(0);
  });

  describe('entrée Révision du portefeuille', () => {
    it('expose /firm/revision juste après Chef de mission', () => {
      const idxAssistant = FIRM_NATIVE_NAV.findIndex(i => i.label === 'Chef de mission');
      const idxRevision = FIRM_NATIVE_NAV.findIndex(i => i.label === 'Révision du portefeuille');

      expect(idxAssistant).toBeGreaterThanOrEqual(0);
      expect(idxRevision).toBe(idxAssistant + 1);
      expect(FIRM_NATIVE_NAV[idxRevision].route).toBe('/firm/revision');
    });

    it('est conditionnée par firm:revision:view et non réservée au responsable', () => {
      const entry = FIRM_NATIVE_NAV.find(i => i.route === '/firm/revision');

      expect(entry).toBeTruthy();
      expect(entry!.permissionsAll).toEqual(['firm:revision:view']);
      // Le collaborateur cabinet consulte aussi : l'ACL dossier restreint ensuite son périmètre.
      expect(entry!.managerOnly).toBeUndefined();
      // Une entrée à plat : filterNavItems n'évalue pas les permissions d'un parent à enfants.
      expect(entry!.children).toBeUndefined();
      expect(entry!.modules).toBeUndefined();
    });

    it('filterFirmRevisionNav retire la seule entrée Révision quand le drapeau est éteint', () => {
      const off = filterFirmRevisionNav(FIRM_NATIVE_NAV, false);

      expect(collectRoutes(off)).not.toContain('/firm/revision');
      expect(off).toHaveSize(FIRM_NATIVE_NAV.length - 1);
    });

    it('filterFirmRevisionNav est neutre quand le drapeau est allumé', () => {
      expect(filterFirmRevisionNav(FIRM_NATIVE_NAV, true)).toBe(FIRM_NATIVE_NAV);
    });

    it("n'est pas emportée par l'extinction du drapeau Gouvernance", () => {
      const routes = collectRoutes(filterFirmGovernanceNav(FIRM_NATIVE_NAV, false));

      expect(routes).toContain('/firm/revision');
    });
  });
});

describe('firm-navigation.registry — delegated firm sales/purchases', () => {
  const ventesChildren: NavSubItem[] = [
    { label: 'Devis', route: '/quotes' },
    { label: 'Factures', route: '/invoices' },
    { label: 'Factures impayées', route: '/invoices/unpaid' },
    { label: 'Rapports', route: '/reports/sales' },
    { label: 'Rapport Bénéfices', route: '/reports/profit' }
  ];

  const achatsChildren: NavSubItem[] = [
    { label: 'Fournisseurs', route: '/suppliers' },
    { label: 'Factures fournisseurs', route: '/supplier-invoices' },
    { label: 'Factures impayées', route: '/supplier-invoices/unpaid' },
    { label: 'Rapports', route: '/reports/purchases' }
  ];

  it('allowlists contain exactly four ventes and achats routes', () => {
    expect(DELEGATED_FIRM_VENTES_ALLOWED_ROUTES.size).toBe(4);
    expect(DELEGATED_FIRM_ACHATS_ALLOWED_ROUTES.size).toBe(6);
  });

  it('filterDelegatedFirmSectionChildren keeps only allowed ventes items', () => {
    const filtered = filterDelegatedFirmSectionChildren(NAV_ID.sales, ventesChildren);
    expect(filtered.map(c => c.label)).toEqual(['Factures', 'Factures impayées', 'Rapports']);
  });

  it('filterDelegatedFirmSectionChildren keeps only allowed achats items', () => {
    const filtered = filterDelegatedFirmSectionChildren(NAV_ID.purchases, achatsChildren);
    expect(filtered.map(c => c.label)).toEqual([
      'Factures fournisseurs',
      'Factures impayées',
      'Rapports'
    ]);
  });

  it('isDelegatedFirmBlockedSalesPurchasesRoute blocks quotes and analytics', () => {
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/quotes')).toBe(true);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/quotes/new')).toBe(true);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/reports/analytics')).toBe(true);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/reports/profit')).toBe(true);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/suppliers')).toBe(true);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/delivery-notes')).toBe(true);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/return-notes')).toBe(true);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/return-notes/new')).toBe(true);
  });

  it('isDelegatedFirmBlockedSalesPurchasesRoute allows invoices and sales/purchases reports', () => {
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/invoices')).toBe(false);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/invoices/unpaid')).toBe(false);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/invoices/abc-123')).toBe(false);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/reports/sales')).toBe(false);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/reports/purchases')).toBe(false);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/supplier-invoices')).toBe(false);
  });

  it('isDelegatedFirmBlockedSalesPurchasesRoute blocks reports hub and other report sections', () => {
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/reports')).toBe(true);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/reports/fiches')).toBe(true);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/reports/stock')).toBe(true);
    expect(isDelegatedFirmBlockedSalesPurchasesRoute('/reports/stock-status')).toBe(true);
  });

  it('isDelegatedReadOnlyRoute no longer includes quotes or suppliers', () => {
    expect(isDelegatedReadOnlyRoute('/quotes')).toBe(false);
    expect(isDelegatedReadOnlyRoute('/suppliers')).toBe(false);
    expect(isDelegatedReadOnlyRoute('/invoices')).toBe(true);
    expect(isDelegatedReadOnlyRoute('/payments')).toBe(true);
  });

  it('isDelegatedFirmBlockedAiAssistantRoute allows accounting assistant only', () => {
    expect(isDelegatedFirmBlockedAiAssistantRoute('/ai-assistant/comptabilite')).toBe(false);
    expect(isDelegatedFirmBlockedAiAssistantRoute('/ai-assistant/ventes')).toBe(true);
    expect(isDelegatedFirmBlockedAiAssistantRoute('/ai-assistant/achats')).toBe(true);
    expect(isDelegatedFirmBlockedAiAssistantRoute('/ai-assistant/stock')).toBe(true);
    expect(isDelegatedFirmBlockedAiAssistantRoute('/ai-assistant/tresorerie')).toBe(true);
    expect(isDelegatedFirmBlockedAiAssistantRoute('/ai-assistant/crm')).toBe(true);
    expect(isDelegatedFirmBlockedAiAssistantRoute('/ai-assistant')).toBe(true);
    expect(isDelegatedFirmBlockedAiAssistantRoute('/accounting/journal')).toBe(false);
  });
});

describe('firm-navigation.registry — isFirmDelegatedReadonly', () => {
  it('returns true only for accounting firm in delegated mode', () => {
    expect(
      isFirmDelegatedReadonly({ isAccountingFirm: () => true, isDelegatedMode: () => true })
    ).toBe(true);
    expect(
      isFirmDelegatedReadonly({ isAccountingFirm: () => true, isDelegatedMode: () => false })
    ).toBe(false);
    expect(
      isFirmDelegatedReadonly({ isAccountingFirm: () => false, isDelegatedMode: () => true })
    ).toBe(false);
    expect(
      isFirmDelegatedReadonly({ isAccountingFirm: () => false, isDelegatedMode: () => false })
    ).toBe(false);
  });
});
