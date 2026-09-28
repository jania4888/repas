import { Injectable, inject } from '@angular/core';
import { ConfirmationService } from '@core/services/confirmation.service';

/**
 * Affiche une modale « Limite atteinte » pour les HTTP 429 (rate-limit / throttle),
 * avec déduplication pour éviter plusieurs modales sur des appels rapprochés identiques.
 */
@Injectable({ providedIn: 'root' })
export class HttpRateLimitDialogService {
  private readonly confirmation = inject(ConfirmationService);
  private lastDedupeKey = '';
  private lastShownAt = 0;
  private readonly dedupWindowMs = 2500;

  /**
   * @param message Texte utilisateur (généralement issu du backend, ex. quota dépassé).
   * @param dedupeKey Clé stable pour fusionner les 429 identiques (ex. méthode + URL).
   */
  showRateLimitExceeded(message: string, dedupeKey: string): void {
    const trimmed = (message || '').trim() || $localize`:@@core.http-rate-limit-dialog.ts.trop.de.requetes.reessayez.dans.quelques.03b4ab7e:Trop de requêtes. Réessayez dans quelques instants.`;
    const now = Date.now();
    if (dedupeKey === this.lastDedupeKey && now - this.lastShownAt < this.dedupWindowMs) {
      return;
    }
    this.lastDedupeKey = dedupeKey;
    this.lastShownAt = now;

    this.confirmation.alert({
      message: trimmed,
      header: $localize`:@@core.http-rate-limit-dialog.ts.limite.atteinte.df38c459:Limite atteinte`,
      icon: 'pi pi-clock',
      size: 'sm'
    });
  }
}
