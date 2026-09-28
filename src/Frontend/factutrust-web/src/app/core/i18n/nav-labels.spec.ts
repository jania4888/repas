import { ALL_NAV_ITEMS, type NavItem, type NavSubItem } from '@core/config/app-navigation.registry';
import { NAV_LABELS } from './nav-labels';
import { resolveNavLabel, resolveSubNavLabel } from './erp-nav-label.util';

/**
 * En français (aucune traduction chargée), le libellé affiché doit rester celui du registre :
 * NAV_LABELS n'apporte que la traduction, jamais un autre texte source.
 */
describe('NAV_LABELS — parité française avec le registre de navigation', () => {
  const entries: Array<{ item: NavItem | NavSubItem; depth: number }> = [];
  const walk = (items: Array<NavItem | NavSubItem>, depth: number) => {
    for (const item of items) {
      entries.push({ item, depth });
      if (item.children?.length) walk(item.children, depth + 1);
    }
  };
  walk(ALL_NAV_ITEMS, 0);

  it('chaque entrée identifiée a un texte source identique au libellé du registre', () => {
    const mismatches = entries
      .filter(({ item }) => item.id && NAV_LABELS[item.id] != null && NAV_LABELS[item.id] !== item.label)
      .map(({ item }) => `${item.id}: « ${NAV_LABELS[item.id!]} » ≠ « ${item.label} »`);
    expect(mismatches).toEqual([]);
  });

  it('le libellé résolu est celui du registre', () => {
    for (const { item, depth } of entries) {
      const resolved = depth === 0 ? resolveNavLabel(item as NavItem) : resolveSubNavLabel(item as NavSubItem);
      expect(resolved).withContext(item.id ?? item.label).toBe(item.label);
    }
  });
});
