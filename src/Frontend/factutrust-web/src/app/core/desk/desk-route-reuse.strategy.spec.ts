import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot } from '@angular/router';
import { DeskRouteReuseStrategy } from './desk-route-reuse.strategy';
import { DeskWindowStore } from './desk-window.store';

describe('DeskRouteReuseStrategy', () => {
  let strategy: DeskRouteReuseStrategy;
  let store: DeskWindowStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [DeskRouteReuseStrategy] });
    strategy = TestBed.inject(DeskRouteReuseStrategy);
    store = TestBed.inject(DeskWindowStore);
    store.setTenantKey('delegated:client-a');
  });

  it('ne stocke aucun handle hors dossier délégué', () => {
    store.setEnabled(false);
    const page = leaf(['accounting', 'journal']);
    const destroy = jasmine.createSpy('destroy');

    expect(strategy.shouldDetach(page)).toBeFalse();
    strategy.store(page, { componentRef: { destroy } });

    expect(store.hasHandle('/accounting/journal')).toBeFalse();
    expect(destroy).not.toHaveBeenCalled();
    const sameConfig = { path: ':id' };
    expect(strategy.shouldReuseRoute(asset('b', sameConfig), asset('a', sameConfig))).toBeTrue();
  });

  it('détache puis rattache, et store(null) n’appelle pas destroy', () => {
    store.setEnabled(true);
    const page = leaf(['accounting', 'journal']);
    const destroy = jasmine.createSpy('destroy');
    const handle = { componentRef: { destroy, instance: {} } };

    expect(strategy.shouldDetach(page)).toBeTrue();
    strategy.store(page, handle);
    expect(strategy.shouldAttach(page)).toBeTrue();
    expect(strategy.retrieve(page)).toBe(handle as never);

    strategy.store(page, null);
    expect(store.hasHandle('/accounting/journal')).toBeFalse();
    expect(destroy).not.toHaveBeenCalled();
  });

  it('détruit un handle dont le dossier ne correspond plus', () => {
    store.setEnabled(true);
    const page = leaf(['accounting', 'journal']);
    const destroy = jasmine.createSpy('destroy');
    strategy.store(page, { componentRef: { destroy, instance: {} } });
    store.upsert({
      key: '/accounting/journal',
      url: '/accounting/journal',
      title: 'Journal',
      tenantKey: 'delegated:client-a'
    });

    store.setTenantKey('delegated:client-b');

    expect(strategy.shouldAttach(page)).toBeFalse();
    expect(destroy).toHaveBeenCalled();
    expect(store.hasHandle('/accounting/journal')).toBeFalse();
  });

  it('ne réutilise pas la route quand la clé de fenêtre change', () => {
    store.setEnabled(true);
    const config = { path: ':id' };
    expect(strategy.shouldReuseRoute(asset('asset-b', config), asset('asset-a', config))).toBeFalse();

    const journal = { path: 'journal' };
    const filtered = leaf(['accounting', 'journal'], { from: '2026-01-01' }, journal);
    const shifted = leaf(['accounting', 'journal'], { from: '2026-02-01' }, journal);
    expect(strategy.shouldReuseRoute(shifted, filtered)).toBeTrue();

    const entry = { path: 'manual-entry' };
    const fresh = leaf(['accounting', 'manual-entry'], {}, entry);
    const existing = leaf(['accounting', 'manual-entry'], { entryId: '0100056' }, entry);
    expect(strategy.shouldReuseRoute(existing, fresh)).toBeFalse();
  });

  it('ne détache pas une fenêtre en cours de fermeture', () => {
    store.setEnabled(true);
    const page = leaf(['accounting', 'journal']);
    store.markClosing('/accounting/journal');
    expect(strategy.shouldDetach(page)).toBeFalse();
  });
});

function leaf(
  segments: string[],
  query: Record<string, string> = {},
  routeConfig: object = { path: segments.at(-1) ?? '' }
): ActivatedRouteSnapshot {
  return {
    url: segments.map(path => ({ path })),
    queryParams: query,
    parent: null,
    firstChild: null,
    outlet: 'primary',
    routeConfig,
    component: class Page {}
  } as unknown as ActivatedRouteSnapshot;
}

function asset(id: string, routeConfig: object = { path: ':id' }): ActivatedRouteSnapshot {
  return leaf(['accounting', 'fixed-assets', id], {}, routeConfig);
}
