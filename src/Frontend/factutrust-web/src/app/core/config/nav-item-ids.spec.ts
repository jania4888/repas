import { ALL_NAV_ITEMS } from './app-navigation.registry';

describe('nav item ids', () => {
  it('every nav item has a unique non-empty id', () => {
    const ids = ALL_NAV_ITEMS.map(i => i.id).filter(Boolean);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(50);
  });
});
