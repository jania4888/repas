import { Injectable, inject } from '@angular/core';
import { ConfirmationService } from '@core/services/confirmation.service';

/**
 * Affiche une modale « Accès refusé » pour les HTTP 403 (hors flux contexte/tenant),
 * avec déduplication pour éviter plusieurs modales sur des appels parallèles.
 */
@Injectable({ providedIn: 'root' })
export class HttpForbiddenDialogService {
  private readonly confirmation = inject(ConfirmationService);
  private lastDedupeKey = '';
  private lastShownAt = 0;
  private readonly dedupWindowMs = 2500;

  /**
   * @param message Texte utilisateur (souvent issu de extractErrorMessage).
   * @param dedupeKey Clé stable pour fusionner les 403 identiques (ex. méthode + URL).
   */
  showAccessDenied(message: string, dedupeKey: string): void {
    const trimmed = (message || '').trim() || $localize`:@@core.http-forbidden-dialog.ts.acces.non.autorise.95c7fdf1:Accès non autorisé.`;
    const now = Date.now();
    if (dedupeKey === this.lastDedupeKey && now - this.lastShownAt < this.dedupWindowMs) {
      return;
    }
    this.lastDedupeKey = dedupeKey;
    this.lastShownAt = now;

    this.confirmation.alert({
      message: trimmed,
      header: $localize`:@@core.http-forbidden-dialog.ts.acces.refuse.db4ecaf4:Accès refusé`,
      icon: 'pi pi-exclamation-triangle'
    });
  }
}
