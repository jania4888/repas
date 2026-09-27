import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Modale « Erreur de validation » pour les HTTP 400 au format ValidationErrorResponse,
 * avec déduplication pour éviter plusieurs modales sur requêtes parallèles identiques.
 */
@Injectable({ providedIn: 'root' })
export class HttpValidationDialogService {
  private readonly confirmation = inject(ConfirmationService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private lastDedupeKey = '';
  private lastShownAt = 0;
  private readonly dedupWindowMs = 2500;

  /**
   * @param error Réponse HTTP 400 structurée (FluentValidation).
   * @param dedupeKey Clé stable (ex. méthode + URL) pour fusionner les doublons.
   */
  showValidationFailed(error: HttpErrorResponse, dedupeKey: string): void {
    const message = this.errorHandler.formatValidationDialogBody(error).trim() || 'Veuillez corriger les données saisies.';
    const now = Date.now();
    if (dedupeKey === this.lastDedupeKey && now - this.lastShownAt < this.dedupWindowMs) {
      return;
    }
    this.lastDedupeKey = dedupeKey;
    this.lastShownAt = now;

    this.confirmation.alert({
      message,
      header: $localize`:@@core.http-validation-dialog.ts.erreur.de.validation.ccce3082:Erreur de validation`,
      icon: 'pi pi-exclamation-circle',
      size: 'md',
      scrollable: true
    });
  }
}
