import { Injectable, Injector, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { resolveFirmAreaRedirect, stripRoutePath } from '@core/config/firm-area-access';
import { AuthService } from '@core/services/auth.service';

/** Au-delà, on cesse d'agir : une cible qui se redirige en boucle ne doit pas figer l'application. */
const MAX_CONSECUTIVE_ACTIONS = 3;

/**
 * Re-ancre l'URL quand c'est le JETON qui change, sans navigation.
 *
 * Les gardes de route ne rejouent pas sans navigation (cf. `auth.service.ts`,
 * `handleDelegatedContextLoss`). Or un rafraîchissement silencieux peut réinstaller un jeton
 * délégué alors que l'utilisateur est resté sur une page cabinet : l'habillage bascule en mode
 * dossier autour du tableau de bord cabinet. Cet effet observe (URL achevée, mode) et ramène
 * l'utilisateur dans la zone correspondant à son jeton.
 *
 * Il ne modifie JAMAIS le contexte (pas de `clearContext`) : le jeton fait foi, l'URL est
 * l'artefact périmé.
 */
@Injectable({ providedIn: 'root' })
export class FirmAreaCoherenceService {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  /** URL de la dernière navigation ACHEVÉE : jamais `router.url`, qui bouge pendant les gardes. */
  private readonly settledUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url)
    ),
    { initialValue: this.router.url }
  );

  private started = false;
  private lastAction: string | null = null;
  private consecutiveActions = 0;

  /** Démarrage explicite (MainLayoutComponent) : aucun effet dans les shells auth/portail ni en test. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    effect(
      () => {
        this.settledUrl();
        this.auth.isAccountingFirm();
        this.auth.isDelegatedMode();
        this.enforceNow();
      },
      { injector: this.injector }
    );
  }

  /**
   * Point d'entrée unique, également appelé après une ouverture de dossier dont la navigation a
   * été annulée ou redirigée. Différé d'une microtâche puis relu : une navigation en vol décide
   * elle-même, on ne lui court pas après (double navigation = View Transition interrompue).
   */
  enforceNow(): void {
    void Promise.resolve().then(() => this.enforce());
  }

  private enforce(): void {
    if (this.router.getCurrentNavigation() !== null) {
      return;
    }

    const path = stripRoutePath(this.settledUrl());
    const target = resolveFirmAreaRedirect(path, {
      isAccountingFirm: this.auth.isAccountingFirm(),
      isDelegated: this.auth.isDelegatedMode()
    });

    if (!target || target === path) {
      this.lastAction = null;
      this.consecutiveActions = 0;
      return;
    }

    const action = `${target}|${path}`;
    if (action === this.lastAction) {
      return;
    }

    if (this.consecutiveActions >= MAX_CONSECUTIVE_ACTIONS) {
      console.warn('[firm-area-coherence] redirections consecutives abandonnees', action);
      return;
    }

    this.lastAction = action;
    this.consecutiveActions += 1;
    void this.router.navigateByUrl(target);
  }
}
