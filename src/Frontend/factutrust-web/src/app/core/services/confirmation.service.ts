import { Injectable, inject } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ConfirmModalComponent } from '@shared/components/confirm-modal/confirm-modal.component';
import { PromptModalComponent } from '@shared/components/confirm-modal/prompt-modal.component';

/**
 * 4.6T1 / D-44-91 — les appelants passaient des classes PrimeNG (`p-button-danger`, …) au wrapper
 * ng-bootstrap : sans effet sur un `<button class="btn …">`. Normalise en classe Bootstrap globale ;
 * une valeur inconnue (ou déjà `btn-*`) est retournée telle quelle.
 */
export function normalizeConfirmButtonClass(cls?: string): string {
  const map: Record<string, string> = {
    'p-button-danger': 'btn-danger',
    'p-button-success': 'btn-success',
    'p-button-secondary': 'btn-secondary',
    'p-button-primary': 'btn-primary',
    'p-button-warning': 'btn-warning',
    'p-button-info': 'btn-info',
    'p-button-help': 'btn-secondary'
  };
  return cls ? (map[cls] ?? cls) : cls!;
}

export interface Confirmation {
  message?: string;
  header?: string;
  icon?: string;
  acceptLabel?: string;
  rejectLabel?: string;
  acceptButtonStyleClass?: string;
  /** Modal width (default `sm`). Use `md` for long French button labels. */
  size?: 'sm' | 'md' | 'lg';
  accept?: () => void;
  reject?: () => void;
}

export interface AlertConfig {
  message: string;
  header?: string;
  icon?: string;
  /** Modal width (default `sm`). Use `md` for longer validation messages. */
  size?: 'sm' | 'md' | 'lg';
  /** Scrollable body for long content (ng-bootstrap). */
  scrollable?: boolean;
}

export interface PromptConfig {
  message?: string;
  header?: string;
  icon?: string;
  placeholder?: string;
  acceptLabel?: string;
  rejectLabel?: string;
  acceptButtonStyleClass?: string;
  /** When true (default), the accept button is disabled until a non-empty value is entered. */
  required?: boolean;
  maxLength?: number;
  /** Modal width (default `md`). */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Service de confirmation pour afficher des modales de confirmation.
 * Utilise ng-bootstrap pour garantir la compatibilité avec le design system.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmationService {
  private modal = inject(NgbModal);

  /**
   * Affiche une modale de confirmation avec un message et des actions.
   *
   * @param confirmation Configuration de la modale (message, labels, callbacks, etc.)
   *
   * @example
   * confirmationService.confirm({
   *   message: 'Êtes-vous sûr de vouloir supprimer cet élément ?',
   *   header: 'Confirmation de suppression',
   *   icon: 'pi pi-exclamation-triangle',
   *   acceptLabel: 'Supprimer',
   *   rejectLabel: 'Annuler',
   *   acceptButtonStyleClass: 'btn-danger',
   *   accept: () => { this.deleteItem(); },
   *   reject: () => { console.log('Cancelled'); }
   * });
   *
   * @example Long labels (inventory cancel) — use size `md` so both actions fit side-by-side
   * confirmationService.confirm({
   *   header: 'Annuler l\'inventaire',
   *   acceptLabel: 'Annuler l\'inventaire',
   *   rejectLabel: 'Continuer le comptage',
   *   size: 'md',
   *   acceptButtonStyleClass: 'btn-danger',
   *   accept: () => { this.cancelInventory(); }
   * });
   */
  confirm(confirmation: Confirmation): void {
    const ref = this.modal.open(ConfirmModalComponent, {
      container: 'body', // Garantit que la modal est attachée au body (au-dessus de tout)
      centered: true,
      backdrop: 'static', // Empêche la fermeture en cliquant sur le backdrop
      keyboard: true, // Permet la fermeture avec ESC
      size: confirmation.size ?? 'sm',
      windowClass: 'confirm-modal-window', // Classe personnalisée pour le z-index
      modalDialogClass: 'confirm-modal-dialog', // Classe pour le dialog
      scrollable: false
    });

    // Configuration du composant modal
    ref.componentInstance.message = confirmation.message ?? 'Êtes-vous sûr ?';
    ref.componentInstance.header = confirmation.header ?? 'Confirmation';
    ref.componentInstance.icon = confirmation.icon ?? '';
    ref.componentInstance.acceptLabel = confirmation.acceptLabel ?? 'Oui';
    ref.componentInstance.rejectLabel = confirmation.rejectLabel ?? 'Non';
    ref.componentInstance.acceptButtonStyleClass = normalizeConfirmButtonClass(confirmation.acceptButtonStyleClass) ?? 'btn-primary';

    // Gestion des résultats
    ref.result.then(
      // Accepté (modal.close() appelé)
      () => {
        try {
          confirmation.accept?.();
        } catch (error) {
          console.error('[ConfirmationService] Error in accept callback:', error);
        }
      },
      // Rejeté (modal.dismiss() appelé ou ESC pressé)
      (reason) => {
        try {
          confirmation.reject?.();
        } catch (error) {
          console.error('[ConfirmationService] Error in reject callback:', error);
        }
      }
    ).catch((error) => {
      // Gestion des erreurs non prévues
      console.error('[ConfirmationService] Unexpected error:', error);
      try {
        confirmation.reject?.();
      } catch (callbackError) {
        console.error('[ConfirmationService] Error in reject callback after error:', callbackError);
      }
    });
  }

  /**
   * Affiche une modale d'alerte avec un message (un seul bouton OK).
   * Utilisé pour les erreurs métier (ex. impossible de supprimer car factures liées).
   */
  alert(config: AlertConfig): void {
    const ref = this.modal.open(ConfirmModalComponent, {
      container: 'body',
      centered: true,
      backdrop: 'static',
      keyboard: true,
      size: config.size ?? 'sm',
      windowClass: 'confirm-modal-window',
      modalDialogClass: 'confirm-modal-dialog',
      scrollable: config.scrollable ?? false
    });

    ref.componentInstance.message = config.message;
    ref.componentInstance.header = config.header ?? 'Erreur';
    ref.componentInstance.icon = config.icon ?? 'pi pi-exclamation-triangle';
    ref.componentInstance.acceptLabel = 'OK';
    ref.componentInstance.acceptButtonStyleClass = 'btn-primary';
    ref.componentInstance.showRejectButton = false;

    ref.result.then(
      () => {},
      () => {}
    ).catch(() => {});
  }

  /**
   * Affiche une modale de saisie texte (remplace `window.prompt`). Retourne la valeur saisie
   * (trimée) à la confirmation, ou `null` en cas d'annulation / fermeture.
   *
   * @example
   * const reason = await confirmationService.prompt({
   *   header: 'Annuler les paiements',
   *   message: 'Motif d\\'annulation :',
   *   acceptLabel: 'Annuler les paiements',
   *   acceptButtonStyleClass: 'btn-danger',
   *   required: true
   * });
   * if (!reason) return;
   */
  prompt(config: PromptConfig): Promise<string | null> {
    const ref = this.modal.open(PromptModalComponent, {
      container: 'body',
      centered: true,
      backdrop: 'static',
      keyboard: true,
      size: config.size ?? 'md',
      windowClass: 'confirm-modal-window',
      modalDialogClass: 'confirm-modal-dialog',
      scrollable: false
    });

    ref.componentInstance.message = config.message ?? '';
    ref.componentInstance.header = config.header ?? 'Saisie';
    ref.componentInstance.icon = config.icon ?? '';
    ref.componentInstance.placeholder = config.placeholder ?? '';
    ref.componentInstance.acceptLabel = config.acceptLabel ?? 'Confirmer';
    ref.componentInstance.rejectLabel = config.rejectLabel ?? 'Annuler';
    ref.componentInstance.acceptButtonStyleClass = normalizeConfirmButtonClass(config.acceptButtonStyleClass) ?? 'btn-primary';
    ref.componentInstance.required = config.required ?? true;
    ref.componentInstance.maxLength = config.maxLength ?? 500;

    return ref.result.then(
      v => (typeof v === 'string' ? v : null),
      () => null
    );
  }
}
