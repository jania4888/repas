import { TestBed } from '@angular/core/testing';
import { DeskWindowService } from './desk-window.service';
import { deskAwareCanDeactivate } from './desk-deactivate';
import { shouldBypassDeskDeactivate } from './desk-deactivate.logic';

describe('shouldBypassDeskDeactivate', () => {
  it('ne court-circuite jamais la confirmation hors dossier délégué', () => {
    expect(shouldBypassDeskDeactivate({
      enabled: false,
      bypass: true,
      state: { deskDiscardConfirmed: true },
      nextUrl: '/accounting/journal'
    })).toBeFalse();
  });

  it('conserve la fenêtre lors d’un changement ou d’une réduction', () => {
    expect(shouldBypassDeskDeactivate({
      enabled: true,
      bypass: false,
      state: {},
      nextUrl: '/accounting/chart'
    })).toBeTrue();
    expect(shouldBypassDeskDeactivate({
      enabled: true,
      bypass: false,
      state: { deskAction: 'preserve' },
      nextUrl: '/desk'
    })).toBeTrue();
  });

  it('laisse la confirmation s’exécuter à la fermeture, sauf abandon déjà accepté', () => {
    expect(shouldBypassDeskDeactivate({
      enabled: true,
      bypass: false,
      state: { deskAction: 'close-current' },
      nextUrl: '/accounting/journal'
    })).toBeFalse();
    expect(shouldBypassDeskDeactivate({
      enabled: true,
      bypass: false,
      state: { deskAction: 'close-current', deskDiscardConfirmed: true },
      nextUrl: '/accounting/journal'
    })).toBeTrue();
  });
});

describe('deskAwareCanDeactivate', () => {
  let bypass = false;

  beforeEach(() => {
    bypass = false;
    TestBed.configureTestingModule({
      providers: [{ provide: DeskWindowService, useValue: { bypassesDeactivate: () => bypass } }]
    });
  });

  it('n’appelle pas la confirmation quand la fenêtre est conservée, et l’appelle à la fermeture', () => {
    const canDeactivate = jasmine.createSpy('canDeactivate').and.returnValue(false);
    const guard = deskAwareCanDeactivate<{ canDeactivate: () => boolean }>(component => component.canDeactivate());

    bypass = true;
    const preserved = TestBed.runInInjectionContext(() =>
      guard({ canDeactivate }, {} as never, {} as never, {} as never)
    );
    expect(preserved).toBeTrue();
    expect(canDeactivate).not.toHaveBeenCalled();

    bypass = false;
    const closed = TestBed.runInInjectionContext(() =>
      guard({ canDeactivate }, {} as never, {} as never, {} as never)
    );
    expect(closed).toBeFalse();
    expect(canDeactivate).toHaveBeenCalledTimes(1);
  });
});
