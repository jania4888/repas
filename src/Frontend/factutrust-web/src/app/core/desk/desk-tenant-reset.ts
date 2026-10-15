import { Injectable } from '@angular/core';

/**
 * Point d'extension sans dépendance vers la comptabilité.
 * Les caches métier (catalogue de journaux, etc.) s'y inscrivent eux-mêmes
 * pour ne pas tirer leurs services dans le paquet de démarrage.
 */
@Injectable({ providedIn: 'root' })
export class DeskTenantReset {
  private readonly resets: Array<() => void> = [];

  register(reset: () => void): void {
    this.resets.push(reset);
  }

  run(): void {
    for (const reset of this.resets) {
      reset();
    }
  }
}
