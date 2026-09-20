import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, catchError, map, of, switchMap, timer } from 'rxjs';
import { AuthService } from '@core/services/auth.service';
import { StudioWorkflowsService } from '../workflows/studio-workflows.service';

/**
 * Badge « Mes approbations » (4.4g1) : nombre de demandes d'approbation assignées
 * à l'utilisateur courant, rafraîchi par polling toutes les 60 s. Démarrage
 * idempotent (D2/D23) depuis le shell Studio et la navigation ; un 403/404 de la
 * sonde `countMyApprovals()` (drapeau coupé ou droit absent) arrête le polling
 * définitivement jusqu'à `reset()` ; `reset()` est appelé automatiquement à la
 * déconnexion ou à l'expiration du jeton (effet sur `AuthService.isAuthenticated`,
 * 4.5g / D-44-64) — le compteur repasse à 0 et le polling s'arrête.
 * La sonde porte déjà le contexte `SKIP_ERROR_TOAST` (4.4a2, D-44-03) : aucun
 * toast global n'est ajouté ici. `available` : la sonde a répondu 200 au moins une
 * fois (sert à la navigation des lecteurs sans capacités, 4.5d1) ; retombe à false
 * sur arrêt définitif ou `reset()`.
 */
@Injectable({ providedIn: 'root' })
export class StudioApprovalsBadgeService {
  static readonly POLL_INTERVAL_MS = 60_000;

  private readonly workflows = inject(StudioWorkflowsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private subscription: Subscription | null = null;
  /** true après un 403/404 : plus aucune requête jusqu'à `reset()` (changement d'utilisateur). */
  private stopped = false;

  readonly count = signal(0);
  readonly polling = signal(false);
  /** true dès la première réponse 200 de la sonde ; false après un arrêt définitif (403/404) ou `reset()`. */
  readonly available = signal(false);
  readonly visible = computed(() => this.count() > 0);

  constructor() {
    // D-44-64 : motif NotificationService (core/services/notification.service.ts:64–73). Ne démarre rien ici :
    // start() reste piloté par le shell Studio et la navigation.
    effect(() => {
      if (!this.auth.isAuthenticated()) untracked(() => this.reset());
    });
  }

  /** Idempotent : ne relance rien si un polling tourne ou si la sonde a répondu 403/404 (D2, D23). */
  start(): void {
    if (this.subscription || this.stopped) return;
    this.polling.set(true);
    this.subscription = timer(0, StudioApprovalsBadgeService.POLL_INTERVAL_MS).pipe(
      switchMap(() => this.workflows.countMyApprovals().pipe(
        map(res => (res.success ? (res.data?.count ?? 0) : 0)),
        catchError((err: unknown) => {
          if (err instanceof HttpErrorResponse && (err.status === 403 || err.status === 404)) {
            this.stop(true);
          }
          return of(null); // erreur réseau : on garde la dernière valeur
        })
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(value => {
      if (value !== null) {
        this.count.set(value);
        this.available.set(true);
      }
    });
  }

  /** Forçage après une décision (g2) : une requête immédiate hors cadence. */
  refresh(): void {
    if (this.stopped) return;
    this.workflows.countMyApprovals().subscribe({
      next: res => this.count.set(res.success ? (res.data?.count ?? 0) : 0),
      error: (err: HttpErrorResponse) => {
        if (err.status === 403 || err.status === 404) this.stop(true);
      }
    });
  }

  stop(permanent = false): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.polling.set(false);
    if (permanent) {
      this.stopped = true;
      this.count.set(0);
      this.available.set(false);
    }
  }

  /** Déconnexion / changement de tenant : autorise un nouveau `start()`. */
  reset(): void {
    this.stop(false);
    this.stopped = false;
    this.count.set(0);
    this.available.set(false);
  }
}
