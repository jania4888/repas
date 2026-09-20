import { TestBed } from '@angular/core/testing';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { Subject } from 'rxjs';
import { ViewportService } from './viewport.service';

describe('ViewportService (4.6T2, D-44-56)', () => {
  let service: ViewportService;
  let streams: Record<string, Subject<BreakpointState>>;
  let matched: Record<string, boolean>;

  beforeEach(() => {
    streams = {};
    matched = {
      '(min-width: 1280px)': true,
      '(max-width: 1279px)': false,
      '(prefers-reduced-motion: reduce)': false
    };
    TestBed.configureTestingModule({
      providers: [{
        provide: BreakpointObserver,
        useValue: {
          observe: (q: string) => (streams[q] ??= new Subject<BreakpointState>()).asObservable(),
          isMatched: (q: string) => matched[q] ?? false
        }
      }]
    });
    service = TestBed.inject(ViewportService);
  });

  const emit = (query: string, matches: boolean) =>
    streams[query].next({ matches, breakpoints: { [query]: matches } });

  it('expose l’état initial synchrone des seuils standard (isMatched)', () => {
    expect(service.isWide()).toBeTrue();
    expect(service.isNarrow()).toBeFalse();
    expect(service.prefersReducedMotion()).toBeFalse();
  });

  it('met à jour les signaux quand la requête change (seuils 1 280 / 1 279 px inchangés)', () => {
    emit('(min-width: 1280px)', false);
    emit('(max-width: 1279px)', true);
    expect(service.isWide()).toBeFalse();
    expect(service.isNarrow()).toBeTrue();
  });

  it('sert une requête média arbitraire (calendrier : max-width 767 px) avec initial puis changements', () => {
    const mobile = service.matches('(max-width: 767px)');
    expect(mobile()).toBeFalse();
    emit('(max-width: 767px)', true);
    expect(mobile()).toBeTrue();
  });
});
