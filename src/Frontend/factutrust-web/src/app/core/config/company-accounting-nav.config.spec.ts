import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {
  applyCompanyAccountingSidebar,
  buildCompanyEtatsComptablesNavChildren,
  canManageVatDeclaration,
  canShowVatDeclarationDocLinks,
  COMPANY_ACCOUNTING_ALLOWED_ROUTE_PREFIXES,
  COMPANY_ACCOUNTING_SIDEBAR_CHILDREN,
  isCompanyAllowedAccountingPath,
  isCompanyVatDeclarationReadOnly
} from './company-accounting-nav.config';
import { ACCOUNTING_MODULES } from './accounting-modules.config';
import { NavItem } from './app-navigation.registry';
import { AuthService, User } from '../services/auth.service';

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
  enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  effectivePermissions: ['accounting:read']
};

const firmNativeUser: User = {
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
  twoFactorEnabled: false,
  enabledModuleIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  effectivePermissions: ['accounting:read', 'firm:manage']
};

const firmDelegatedUser: User = {
  ...firmNativeUser,
  accessMode: 'delegated',
  contextTenantId: '00000000-0000-0000-0000-000000000003',
  contextCompanyName: 'Ste Bouzgarou'
};

function setUser(auth: AuthService, u: User | null): void {
  (auth as unknown as { userSignal: { set: (x: User | null) => void } }).userSignal.set(u);
}

describe('company-accounting-nav.config', () => {
  it('allows états comptables routes', () => {
    expect(isCompanyAllowedAccountingPath('/accounting/journal')).toBe(true);
    expect(isCompanyAllowedAccountingPath('/accounting/balance')).toBe(true);
    expect(isCompanyAllowedAccountingPath('/accounting/financial-statements')).toBe(true);
  });

  it('allows accounting AI assistant route', () => {
    expect(isCompanyAllowedAccountingPath('/ai-assistant/comptabilite')).toBe(true);
  });

  it('blocks operational accounting routes', () => {
    expect(isCompanyAllowedAccountingPath('/accounting/manual-entry')).toBe(false);
    expect(isCompanyAllowedAccountingPath('/accounting/home')).toBe(false);
    expect(isCompanyAllowedAccountingPath('/accounting/chart')).toBe(false);
  });

  it('blocks the DM screens for a company user', () => {
    // L'absence de `/accounting/dm/*` de la liste autorisée est DÉLIBÉRÉE : le paramétrage du
    // calcul fiscal appartient au cabinet. Ce test existe pour qu'on ne « corrige » pas cet oubli
    // apparent. Le garde front n'est pas la frontière de sécurité — le contexte cabinet délégué
    // exigé par chaque commande serveur l'est — mais les deux doivent dire la même chose.
    expect(isCompanyAllowedAccountingPath('/accounting/dm/configuration')).toBe(false);
    expect(isCompanyAllowedAccountingPath('/accounting/dm/calcul')).toBe(false);
    expect(isCompanyAllowedAccountingPath('/accounting/dm/modele')).toBe(false);
    expect(isCompanyAllowedAccountingPath('/accounting/dm/suivi')).toBe(false);
    expect(isCompanyAllowedAccountingPath('/accounting/dm')).toBe(false);
    expect(
      COMPANY_ACCOUNTING_ALLOWED_ROUTE_PREFIXES.some(prefix => prefix.startsWith('/accounting/dm'))
    ).toBe(false);
  });

  it('allows fixed-assets sub-routes', () => {
    expect(isCompanyAllowedAccountingPath('/accounting/fixed-assets')).toBe(true);
    expect(isCompanyAllowedAccountingPath('/accounting/fixed-assets/abc-uuid')).toBe(true);
    expect(isCompanyAllowedAccountingPath('/accounting/fixed-assets/depreciation-run')).toBe(true);
  });

  it('allows audit journal route', () => {
    expect(isCompanyAllowedAccountingPath('/audit')).toBe(true);
  });

  it('does not treat non-accounting routes as allowed accounting paths', () => {
    expect(isCompanyAllowedAccountingPath('/invoices')).toBe(false);
    expect(isCompanyAllowedAccountingPath('/dashboard')).toBe(false);
  });

  it('replaces Comptabilité children with the 4 company submenu entries', () => {
    const items: NavItem[] = [
      {
        id: 'accounting',
        label: 'Comptabilité',
        icon: 'fa-solid fa-calculator',
        children: [
          { label: 'Journal', route: '/accounting/journal' },
          { label: 'Saisie manuelle', route: '/accounting/manual-entry' }
        ]
      }
    ];

    const result = applyCompanyAccountingSidebar(items);
    const compta = result.find(i => i.label === 'Comptabilité');

    expect(compta?.children?.map(c => c.label)).toEqual([
      'Assistant Comptabilité',
      'États comptables',
      'Déclaration mensuelle',
      'Liste des immobilisations'
    ]);
  });

  it('nests the 11 états under États comptables from ACCOUNTING_MODULES', () => {
    const etatsModule = ACCOUNTING_MODULES.find(m => m.title === 'États');
    expect(etatsModule?.links.length).toBe(11);

    const children = buildCompanyEtatsComptablesNavChildren();
    expect(children.length).toBe(11);
    expect(children.map(c => c.route)).toEqual(etatsModule!.links.map(l => l.route));
    expect(children.map(c => c.label)).toEqual(etatsModule!.links.map(l => l.label));
    expect(children.map(c => c.icon)).toEqual(etatsModule!.links.map(l => l.icon));

    const etatsEntry = COMPANY_ACCOUNTING_SIDEBAR_CHILDREN.find(c => c.label === 'États comptables');
    expect(etatsEntry?.children?.length).toBe(11);
    expect(etatsEntry?.children?.map(c => c.route)).toEqual(etatsModule!.links.map(l => l.route));
  });
});

describe('canShowVatDeclarationDocLinks', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
  });

  it('returns false for a company user', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, companyUser);
    expect(canShowVatDeclarationDocLinks(auth)).toBe(false);
  });

  it('returns true for an accounting firm in native mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmNativeUser);
    expect(canShowVatDeclarationDocLinks(auth)).toBe(true);
  });

  it('returns true for an accounting firm in delegated mode', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmDelegatedUser);
    expect(canShowVatDeclarationDocLinks(auth)).toBe(true);
  });
});

describe('canManageVatDeclaration / isCompanyVatDeclarationReadOnly', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
  });

  it('company is read-only and cannot manage', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, companyUser);
    expect(canManageVatDeclaration(auth)).toBe(false);
    expect(isCompanyVatDeclarationReadOnly(auth)).toBe(true);
  });

  it('firm can manage and is not company read-only', () => {
    const auth = TestBed.inject(AuthService);
    setUser(auth, firmDelegatedUser);
    expect(canManageVatDeclaration(auth)).toBe(true);
    expect(isCompanyVatDeclarationReadOnly(auth)).toBe(false);
  });
});
