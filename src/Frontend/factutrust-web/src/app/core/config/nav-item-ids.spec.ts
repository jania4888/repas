import { ALL_NAV_ITEMS, type NavItem, type NavSubItem } from './app-navigation.registry';
import { getNavId } from './nav-item-ids';

describe('nav item ids', () => {
  const all: Array<NavItem | NavSubItem> = [];
  const walk = (items: Array<NavItem | NavSubItem>) => {
    for (const item of items) {
      all.push(item);
      if (item.children?.length) walk(item.children);
    }
  };
  walk(ALL_NAV_ITEMS);

  it('every nav item has a unique non-empty id', () => {
    const missing = all.filter(i => !i.id).map(i => i.label);
    expect(missing).toEqual([]);
    const ids = all.map(i => i.id);
    const duplicates = ids.filter((id, idx) => ids.indexOf(id) !== idx);
    expect(duplicates).toEqual([]);
    expect(ids.length).toBeGreaterThan(50);
  });

  it('getNavId ne lève jamais : une entrée dynamique sans id reçoit un id dérivé du libellé', () => {
    expect(getNavId({ id: 'sales', label: 'Ventes' })).toBe('sales');
    expect(getNavId({ label: 'Dossier : ACME' })).toBe('nav-label:Dossier : ACME');
  });
});
