import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { deskWindowGuard } from './desk-window.guard';
import { DeskWindowService } from './desk-window.service';

describe('deskWindowGuard', () => {
  let evaluate: jasmine.Spy;
  let explain: jasmine.Spy;
  let parseUrl: jasmine.Spy;

  beforeEach(() => {
    evaluate = jasmine.createSpy('evaluate').and.returnValue({ kind: 'allow' });
    explain = jasmine.createSpy('explain');
    parseUrl = jasmine.createSpy('parseUrl').and.callFake((url: string) => ({ redirected: url }));
    TestBed.configureTestingModule({
      providers: [
        { provide: DeskWindowService, useValue: { evaluate, explain } },
        {
          provide: Router,
          useValue: {
            getCurrentNavigation: () => ({ extras: { state: { deskAction: 'preserve' } } }),
            parseUrl
          }
        }
      ]
    });
  });

  function run(url: string) {
    return TestBed.runInInjectionContext(() => deskWindowGuard({} as never, { url } as never));
  }

  it('laisse passer une navigation autorisée', () => {
    expect(run('/accounting/chart')).toBeTrue();
    expect(evaluate).toHaveBeenCalledWith('/accounting/chart', { deskAction: 'preserve', deskDiscardConfirmed: false });
    expect(explain).not.toHaveBeenCalled();
  });

  it('refuse le plafond et l’explique, sans créer de fenêtre', () => {
    evaluate.and.returnValue({ kind: 'block', reason: 'cap' });
    expect(run('/accounting/ledger')).toBeFalse();
    expect(explain).toHaveBeenCalledWith('cap');
  });

  it('renvoie vers l’URL mémorisée au lieu d’écraser les filtres', () => {
    evaluate.and.returnValue({ kind: 'redirect', url: '/accounting/journal?from=2026-01-01' });
    const decision = run('/accounting/journal') as unknown as { redirected: string };
    expect(decision).toEqual({ redirected: '/accounting/journal?from=2026-01-01' });
  });
});
