import { Injectable } from '@angular/core';

/**
 * Pont sans cycle : le bureau s'inscrit au démarrage, la sortie de dossier et la
 * déconnexion demandent la confirmation avant de toucher au jeton.
 */
@Injectable({ providedIn: 'root' })
export class DeskLeaveRegistry {
  private confirm: (() => boolean | Promise<boolean>) | null = null;
  private onAbort: (() => void) | null = null;
  private cancelled = false;

  register(confirm: () => boolean | Promise<boolean>, onAbort: () => void): void {
    this.confirm = confirm;
    this.onAbort = onAbort;
  }

  /**
   * `true` synchrone quand aucune saisie n'est en cours, pour ne pas décaler les
   * requêtes HTTP que les tests et les appelants attendent dans le même tour.
   */
  confirmLeave(): boolean | Promise<boolean> {
    this.cancelled = false;
    if (!this.confirm) return true;
    const result = this.confirm();
    if (result instanceof Promise) {
      return result.then(ok => {
        this.cancelled = !ok;
        return ok;
      });
    }
    this.cancelled = !result;
    return result;
  }

  wasCancelled(): boolean {
    return this.cancelled;
  }

  abortTeardown(): void {
    this.onAbort?.();
  }
}
