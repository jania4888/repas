import { TestBed } from '@angular/core/testing';
import { DESK_SESSION_PREFIX, DESK_WINDOW_CAP } from './desk-window.model';
import { DeskWindowStore } from './desk-window.store';

describe('DeskWindowStore', () => {
  let store: DeskWindowStore;

  beforeEach(() => {
    clearDeskSession();
    TestBed.configureTestingModule({});
    store = TestBed.inject(DeskWindowStore);
  });

  afterEach(() => clearDeskSession());

  it('restaure uniquement la session du dossier demandé, sans corps de formulaire', () => {
    sessionStorage.setItem(sessionKey('delegated:client-a'), JSON.stringify([
      record('/accounting/chart', '/accounting/chart?from=2026-01-01', 'Plan A', 20)
    ]));
    sessionStorage.setItem(sessionKey('delegated:client-b'), JSON.stringify([
      record('/accounting/ledger', '/accounting/ledger', 'Grand livre B', 30)
    ]));

    store.restore('delegated:client-a');

    expect(store.windows().map(window => window.title)).toEqual(['Plan A']);
    expect(store.windows()[0].url).toBe('/accounting/chart?from=2026-01-01');
    expect(store.windows()[0].hydrated).toBeFalse();
    expect(JSON.stringify(store.windows())).not.toContain('lines');

    store.restore('delegated:client-a');
    expect(store.windows().length).toBe(1);
  });

  it('plafonne la restauration et refuse une 9e fenêtre hydratée sans la détruire', () => {
    const records = Array.from({ length: 10 }, (_, index) =>
      record(`/accounting/report-${index}`, `/accounting/report-${index}`, `Rapport ${index}`, index)
    );
    sessionStorage.setItem(sessionKey('delegated:client-a'), JSON.stringify(records));
    store.restore('delegated:client-a');
    expect(store.windows().length).toBe(DESK_WINDOW_CAP);

    store.setEnabled(true);
    store.setTenantKey('delegated:client-a');
    store.discardAll();
    const destroy = jasmine.createSpy('destroy');
    for (let index = 0; index < DESK_WINDOW_CAP; index++) {
      const key = `/accounting/screen-${index}`;
      store.upsert({ key, url: key, title: `Écran ${index}`, tenantKey: 'delegated:client-a' });
      store.rememberHandle(key, { componentRef: { destroy } });
    }

    expect(store.ensureRoomFor('/accounting/screen-new')).toBeFalse();
    expect(store.windows().length).toBe(DESK_WINDOW_CAP);
    expect(store.find('/accounting/screen-0')).toBeDefined();
    expect(destroy).not.toHaveBeenCalled();
  });

  it('peut évincer une URL de session non hydratée pour faire de la place', () => {
    store.setEnabled(true);
    store.setTenantKey('delegated:client-a');
    for (let index = 0; index < DESK_WINDOW_CAP; index++) {
      store.upsert({
        key: `/accounting/cold-${index}`,
        url: `/accounting/cold-${index}`,
        title: `Froid ${index}`,
        tenantKey: 'delegated:client-a'
      });
    }

    expect(store.ensureRoomFor('/accounting/fresh')).toBeTrue();
    expect(store.windows().length).toBe(DESK_WINDOW_CAP - 1);
    expect(store.windows().every(window => window.hydrated === false)).toBeTrue();
  });

  it('oublie les instances sans effacer la session de l’autre passage dans le dossier', () => {
    store.setEnabled(true);
    store.setTenantKey('delegated:client-a');
    store.upsert({
      key: '/accounting/chart',
      url: '/accounting/chart',
      title: 'Plan A',
      tenantKey: 'delegated:client-a'
    });
    const saved = sessionStorage.getItem(sessionKey('delegated:client-a'));
    const destroy = jasmine.createSpy('destroy');
    store.rememberHandle('/accounting/chart', { componentRef: { destroy } });

    store.discardAll();

    expect(destroy).toHaveBeenCalled();
    expect(store.windows()).toEqual([]);
    expect(sessionStorage.getItem(sessionKey('delegated:client-a'))).toBe(saved);
  });

  it('efface la session seulement quand on le demande (déconnexion)', () => {
    sessionStorage.setItem(sessionKey('delegated:client-a'), JSON.stringify([
      record('/accounting/chart', '/accounting/chart', 'Plan A', 1)
    ]));

    store.clearPersisted('delegated:client-a');

    expect(sessionStorage.getItem(sessionKey('delegated:client-a'))).toBeNull();
  });

  it('reprend un handle sans le détruire, puis le détruit à la fermeture', () => {
    const destroy = jasmine.createSpy('destroy');
    const detached = { componentRef: { destroy, instance: { isDirty: () => true } } };
    store.rememberHandle('/accounting/journal', detached);
    expect(store.find('/accounting/journal')).toBeUndefined();
    expect(store.peekHandle('/accounting/journal')).toBe(detached);

    store.forgetHandle('/accounting/journal');
    expect(destroy).not.toHaveBeenCalled();
    expect(store.hasHandle('/accounting/journal')).toBeFalse();

    store.rememberHandle('/accounting/journal', detached);
    store.destroyHandle('/accounting/journal');
    expect(destroy).toHaveBeenCalled();
  });
});

function record(key: string, url: string, title: string, lastFocusedAt: number) {
  return { key, url, title, minimized: false, lastFocusedAt };
}

function sessionKey(tenant: string): string {
  return `${DESK_SESSION_PREFIX}${tenant}`;
}

function clearDeskSession(): void {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(DESK_SESSION_PREFIX)) sessionStorage.removeItem(key);
  }
}
