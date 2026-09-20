import { EnvironmentInjector, Injectable, Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';

/**
 * 4.6T2 / D-44-56 — point d'entrée unique pour les requêtes média de largeur (remplace les
 * `window.matchMedia` / `BreakpointObserver.observe` dispersés, avec nettoyage automatique).
 * Seuils inchangés : large ≥ 1 280 px, étroit ≤ 1 279 px.
 * `prefersReducedMotion` est exposé en lecture pour réutilisation future ; les usages existants
 * (marketing/3D, lectures ponctuelles `innerWidth`) ne sont PAS migrés ici (consignés D-46-T02).
 */
@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly injector = inject(EnvironmentInjector);   // `matches()` appelable hors contexte d'injection

  /** ≥ 1 280 px : bureau large (panneaux latéraux permanents). */
  readonly isWide = this.matches('(min-width: 1280px)');
  /** ≤ 1 279 px : tablette / écran étroit (panneaux en tiroir). */
  readonly isNarrow = this.matches('(max-width: 1279px)');
  /** `(prefers-reduced-motion: reduce)` — lecture réactive, non migrée dans cette tranche. */
  readonly prefersReducedMotion = this.matches('(prefers-reduced-motion: reduce)');

  /** Signal réactif d'une requête média arbitraire (état initial synchrone + changements). */
  matches(query: string): Signal<boolean> {
    return toSignal(
      this.breakpoints.observe(query).pipe(map(s => s.matches)),
      { initialValue: this.breakpoints.isMatched(query), injector: this.injector }
    );
  }
}
