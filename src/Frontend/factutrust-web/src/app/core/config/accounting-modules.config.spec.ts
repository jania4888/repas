import {
  ACCOUNTING_HOME_HIDDEN_MODULE_IDS,
  ACCOUNTING_MODULE_ID,
  ACCOUNTING_MODULES,
  getFirmDelegatedAccountingModules,
  isAccountingModuleHiddenFromHome
} from './accounting-modules.config';

describe('accounting-modules.config', () => {
  describe('ACCOUNTING_HOME_HIDDEN_MODULE_IDS', () => {
    it('hides Budgétaire and Declarations from the accounting home hub', () => {
      expect(ACCOUNTING_HOME_HIDDEN_MODULE_IDS.has(ACCOUNTING_MODULE_ID.budget)).toBe(true);
      expect(ACCOUNTING_HOME_HIDDEN_MODULE_IDS.has(ACCOUNTING_MODULE_ID.declarations)).toBe(true);
    });

    it('isAccountingModuleHiddenFromHome reflects the hub hidden set', () => {
      expect(isAccountingModuleHiddenFromHome(ACCOUNTING_MODULE_ID.budget)).toBe(true);
      expect(isAccountingModuleHiddenFromHome(ACCOUNTING_MODULE_ID.declarations)).toBe(true);
      expect(isAccountingModuleHiddenFromHome(ACCOUNTING_MODULE_ID.fixedAssets)).toBe(false);
    });
  });

  describe('getFirmDelegatedAccountingModules', () => {
    it('includes Budgétaire and Declarations in delegated sidebar modules', () => {
      const titles = getFirmDelegatedAccountingModules().map(m => m.title);

      expect(titles).not.toContain('Configuration');
      expect(titles).not.toContain('Traitements');
      expect(titles).not.toContain('États');
      expect(titles).not.toContain('Liasse fiscale');
      expect(titles).toContain('Budgétaire');
      expect(titles).toContain('Declarations');
      expect(titles).toContain('Gestion immobilisations');
    });
  });

  for (const DM_ROUTE of [
    '/accounting/dm/configuration',
    '/accounting/dm/calcul',
    '/accounting/dm/modele',
    '/accounting/dm/suivi'
  ]) {
    describe(`écran DM ${DM_ROUTE}`, () => {
      it('est rattachée à Declarations, sous accounting:read', () => {
        const declarations = ACCOUNTING_MODULES.find(m => m.title === 'Declarations');
        const link = declarations?.links.find(l => l.route === DM_ROUTE);

        expect(link).toBeDefined();
        expect(link?.perms).toEqual(['accounting:read']);
      });

      it("n'est rattachée à aucun autre module que Declarations", () => {
        // Décisif : la liste des routes autorisées aux sociétés est construite à partir des liens du
        // module « États ». Y déplacer cet écran l'ouvrirait aux sociétés sans que personne ne
        // touche à la configuration de navigation société.
        const owners = ACCOUNTING_MODULES.filter(m => m.links.some(l => l.route === DM_ROUTE)).map(
          m => m.title
        );

        expect(owners).toEqual(['Declarations']);
      });

      it('reste visible dans le rail cabinet délégué', () => {
        const delegated = getFirmDelegatedAccountingModules()
          .flatMap(m => m.links)
          .map(l => l.route);

        expect(delegated).toContain(DM_ROUTE);
      });
    });
  }

  describe('États icons', () => {
    it('uses a Free Font Awesome glyph for Journaux auxiliaires and unique icons', () => {
      const etatsModule = ACCOUNTING_MODULES.find(m => m.title === 'États');
      expect(etatsModule).toBeDefined();
      expect(etatsModule!.links.length).toBe(11);

      const subJournals = etatsModule!.links.find(l => l.route === '/accounting/sub-journals');
      expect(subJournals?.icon).toBe('fa-solid fa-book-bookmark');
      expect(etatsModule!.links.every(l => !l.icon.includes('fa-books'))).toBe(true);

      const icons = etatsModule!.links.map(l => l.icon);
      expect(new Set(icons).size).toBe(icons.length);
      expect(icons.every(icon => /^fa-solid fa-[a-z0-9-]+$/.test(icon))).toBe(true);
    });
  });
});
