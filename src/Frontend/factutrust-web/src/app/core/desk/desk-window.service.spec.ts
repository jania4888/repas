import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { DESK_SESSION_PREFIX } from './desk-window.model';
import { DeskLeaveRegistry } from './desk-leave.registry';
import { DeskWindowService } from './desk-window.service';
import { DeskWindowStore } from './desk-window.store';

interface DeskUser {
  id: string;
  tenantId: string;
  accessMode: string;
  contextTenantId?: string | null;
  tenantKind: string;
}

describe('DeskWindowService', () => {
  const user = signal<DeskUser | null>(delegated('client-a'));
  let events: Subject<unknown>;
  let currentNav: { extractedUrl?: { toString(): string }; extras?: { state?: unknown } } | null = null;
  let router: {
    events: Subject<unknown>;
    navigated: boolean;
    url: string;
    getCurrentNavigation: () => typeof currentNav;
    navigateByUrl: jasmine.Spy;
    routerState: { snapshot: { root: { title: string | null; firstChild: null } } };
  };
  let toast: { add: jasmine.Spy };
  let confirmation: { confirm: jasmine.Spy };
  let service: DeskWindowService;
  let store: DeskWindowStore;

  beforeEach(() => {
    clearDeskSession();
    events = new Subject();
    user.set(delegated('client-a'));
    currentNav = null;
    router = {
      events,
      navigated: true,
      url: '/accounting/journal',
      getCurrentNavigation: () => currentNav,
      navigateByUrl: jasmine.createSpy('navigateByUrl').and.resolveTo(true),
      routerState: { snapshot: { root: { title: 'Journal - InstaFact', firstChild: null } } }
    };
    toast = { add: jasmine.createSpy('add') };
    confirmation = { confirm: jasmine.createSpy('confirm') };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: {
          user,
          isAccountingFirm: () => user()?.tenantKind === 'accountingFirm',
          isDelegatedMode: () => user()?.accessMode === 'delegated'
        } },
        { provide: Router, useValue: router },
        { provide: ToastService, useValue: toast },
        { provide: ConfirmationService, useValue: confirmation }
      ]
    });
    service = TestBed.inject(DeskWindowService);
    store = TestBed.inject(DeskWindowStore);
    TestBed.flushEffects();
  });

  afterEach(() => {
    document.querySelector('.p-dialog-mask')?.remove();
    clearDeskSession();
  });

  it('restaure les filtres d’une fenêtre déjà ouverte et refuse la 9e fenêtre hydratée', () => {
    store.upsert({
      key: '/accounting/chart',
      url: '/accounting/chart?from=2026-01-01',
      title: 'Plan',
      tenantKey: 'delegated:client-a'
    });

    expect(service.evaluate('/accounting/chart')).toEqual({
      kind: 'redirect',
      url: '/accounting/chart?from=2026-01-01'
    });
    expect(service.evaluate('/accounting/journal?journalCode=JV').kind).toBe('allow');

    for (let index = 0; index < 6; index++) {
      const key = `/accounting/extra-${index}`;
      store.upsert({ key, url: key, title: `Extra ${index}`, tenantKey: 'delegated:client-a' });
      store.rememberHandle(key, { componentRef: { destroy() {} } });
    }
    store.rememberHandle('/accounting/journal', { componentRef: { destroy() {} } });
    store.rememberHandle('/accounting/chart', { componentRef: { destroy() {} } });

    expect(service.evaluate('/accounting/brand-new')).toEqual({ kind: 'block', reason: 'cap' });
    expect(store.find('/accounting/journal')).toBeDefined();
  });

  it('bloque la bascule tant qu’un dialogue est ouvert', () => {
    document.body.append(Object.assign(document.createElement('div'), { className: 'p-dialog-mask' }));

    expect(service.evaluate('/accounting/chart')).toEqual({ kind: 'block', reason: 'overlay' });
    service.explain('overlay');
    expect(toast.add).toHaveBeenCalledWith(jasmine.objectContaining({
      detail: 'Fermez d\'abord la fenêtre de dialogue.'
    }));
  });

  it('détruit les handles au changement de dossier et ignore la session de l’autre dossier', () => {
    sessionStorage.setItem(sessionKey('delegated:client-b'), JSON.stringify([
      { key: '/accounting/ledger', url: '/accounting/ledger', title: 'Grand livre B', minimized: false, lastFocusedAt: 5 }
    ]));
    const destroy = jasmine.createSpy('destroy');
    store.rememberHandle('/accounting/journal', { componentRef: { destroy, instance: { isDirty: () => true } } });
    const savedA = sessionStorage.getItem(sessionKey('delegated:client-a'));
    expect(savedA).toContain('Journal');

    user.set(delegated('client-b'));
    TestBed.flushEffects();

    expect(destroy).toHaveBeenCalled();
    expect(store.windows().map(window => window.title)).toEqual(['Grand livre B', 'Journal']);
    expect(sessionStorage.getItem(sessionKey('delegated:client-a'))).toBe(savedA);
    expect(store.windows().some(window => window.tenantKey === 'delegated:client-a' && window.key === '/accounting/chart')).toBeFalse();
  });

  it('efface la session du dossier à la déconnexion', () => {
    expect(sessionStorage.getItem(sessionKey('delegated:client-a'))).toContain('/accounting/journal');

    user.set(null);
    TestBed.flushEffects();

    expect(sessionStorage.getItem(sessionKey('delegated:client-a'))).toBeNull();
    expect(store.isEnabled()).toBeFalse();
  });

  it('retire la fenêtre courante sur close-current et ignore access-denied et le cabinet', () => {
    const destroy = jasmine.createSpy('destroy');
    store.rememberHandle('/accounting/journal', { componentRef: { destroy, instance: {} } });
    currentNav = {
      extractedUrl: { toString: () => '/accounting/chart' },
      extras: { state: { deskAction: 'close-current' } }
    };
    events.next(new NavigationStart(1, '/accounting/chart'));
    router.url = '/accounting/chart';
    router.routerState.snapshot.root.title = 'Plan comptable - InstaFact';
    events.next(new NavigationEnd(1, '/accounting/chart', '/accounting/chart'));

    expect(destroy).toHaveBeenCalled();
    expect(store.find('/accounting/journal')).toBeUndefined();
    expect(store.find('/accounting/chart')?.title).toBe('Plan comptable');

    events.next(new NavigationEnd(2, '/access-denied', '/access-denied'));
    events.next(new NavigationEnd(3, '/firm/dashboard', '/firm/dashboard'));
    expect(store.windows().some(window => window.url.includes('access-denied') || window.url.startsWith('/firm'))).toBeFalse();
    expect(store.activeKey()).toBeNull();
  });

  it('ne demande pas de quitter la page pour une bascule, seulement pour une fermeture', () => {
    currentNav = {
      extractedUrl: { toString: () => '/accounting/chart' },
      extras: { state: { deskAction: 'preserve' } }
    };
    expect(service.bypassesDeactivate()).toBeTrue();

    currentNav = {
      extractedUrl: { toString: () => '/accounting/chart' },
      extras: { state: { deskAction: 'close-current' } }
    };
    expect(service.bypassesDeactivate()).toBeFalse();

    currentNav = {
      extractedUrl: { toString: () => '/accounting/chart' },
      extras: { state: { deskAction: 'close-current', deskDiscardConfirmed: true } }
    };
    expect(service.bypassesDeactivate()).toBeTrue();
  });

  it('confirme une seule fois la sortie quand une fenêtre est modifiée', async () => {
    store.setActiveInstance({ isDirty: () => true });
    const pending = TestBed.inject(DeskLeaveRegistry).confirmLeave();
    expect(pending).toEqual(jasmine.any(Promise));
    expect(confirmation.confirm).toHaveBeenCalledWith(jasmine.objectContaining({
      message: jasmine.stringMatching('Journal')
    }));

    confirmation.confirm.calls.mostRecent().args[0].reject();
    await expectAsync(pending as Promise<boolean>).toBeResolvedTo(false);
    expect(store.bypassesDeactivate()).toBeFalse();

    const accepted = TestBed.inject(DeskLeaveRegistry).confirmLeave() as Promise<boolean>;
    confirmation.confirm.calls.mostRecent().args[0].accept();
    await expectAsync(accepted).toBeResolvedTo(true);
    expect(store.bypassesDeactivate()).toBeTrue();
  });

  it('désactive le bureau pour une société et ne garde pas les fenêtres', () => {
    const saved = sessionStorage.getItem(sessionKey('delegated:client-a'));
    user.set({ id: 'user-1', tenantId: 'company-1', accessMode: 'native', tenantKind: 'company' });
    TestBed.flushEffects();

    expect(service.isEnabled()).toBeFalse();
    expect(store.windows()).toEqual([]);
    expect(service.evaluate('/accounting/chart')).toEqual({ kind: 'allow' });
    expect(service.bypassesDeactivate()).toBeFalse();
    expect(sessionStorage.getItem(sessionKey('delegated:client-a'))).toBe(saved);
  });
});

function delegated(contextTenantId: string, id = 'user-1'): DeskUser {
  return {
    id,
    tenantId: 'firm-1',
    accessMode: 'delegated',
    contextTenantId,
    tenantKind: 'accountingFirm'
  };
}

function sessionKey(tenant: string): string {
  return `${DESK_SESSION_PREFIX}${tenant}`;
}

function clearDeskSession(): void {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(DESK_SESSION_PREFIX)) sessionStorage.removeItem(key);
  }
}
