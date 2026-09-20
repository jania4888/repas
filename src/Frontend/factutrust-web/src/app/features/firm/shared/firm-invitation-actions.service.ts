import { Injectable, inject } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';
import { FirmAssignmentService } from '@core/services/firm-assignment.service';
import { FirmBadgeService } from '@core/services/firm-badge.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { RejectInvitationDialogComponent } from './reject-invitation-dialog.component';

export interface FirmInvitationRef {
  id: string;
  companyName: string;
}

/**
 * Comportement unique des actions Accepter/Refuser d'une invitation cabinet,
 * partagé entre le tableau de bord et la page Invitations : confirmation →
 * appel API → toast maison → invalidation du badge sidebar.
 * Retourne `true` si l'action a abouti (le composant appelant recharge alors).
 */
@Injectable({ providedIn: 'root' })
export class FirmInvitationActionsService {
  private readonly assignments = inject(FirmAssignmentService);
  private readonly firmBadge = inject(FirmBadgeService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly modal = inject(NgbModal);

  accept(inv: FirmInvitationRef): Promise<boolean> {
    return new Promise(resolve => {
      this.confirmation.confirm({
        header: 'Accepter la demande',
        message: `Accepter la demande de liaison de « ${inv.companyName} » ? Le dossier deviendra accessible à votre cabinet.`,
        icon: 'pi pi-check-circle',
        acceptLabel: 'Accepter',
        rejectLabel: 'Annuler',
        acceptButtonStyleClass: 'btn-success',
        accept: () => {
          this.assignments.acceptInvitation(inv.id).subscribe({
            next: r => {
              if (r.success) {
                this.toast.add({ severity: 'success', summary: 'Demande acceptée', detail: `${inv.companyName} fait désormais partie de vos dossiers.` });
                this.firmBadge.invalidate();
                resolve(true);
              } else {
                this.toast.add({ severity: 'error', summary: 'Action impossible', detail: r.message ?? 'Une erreur est survenue.' });
                resolve(false);
              }
            },
            error: err => {
              this.toast.add({ severity: 'error', summary: 'Action impossible', detail: this.errorText(err) });
              resolve(false);
            }
          });
        },
        reject: () => resolve(false)
      });
    });
  }

  async reject(inv: FirmInvitationRef): Promise<boolean> {
    const ref = this.modal.open(RejectInvitationDialogComponent, {
      container: 'body',
      centered: true,
      backdrop: 'static',
      keyboard: true,
      size: 'sm'
    });
    ref.componentInstance.companyName = inv.companyName;

    let reason: string;
    try {
      reason = await ref.result;
    } catch {
      return false; // fermé/annulé
    }

    try {
      const r = await firstValueFrom(this.assignments.rejectInvitation(inv.id, reason || undefined));
      if (r.success) {
        this.toast.add({ severity: 'info', summary: 'Demande refusée', detail: `La demande de ${inv.companyName} a été refusée.` });
        this.firmBadge.invalidate();
        return true;
      }
      this.toast.add({ severity: 'error', summary: 'Action impossible', detail: r.message ?? 'Une erreur est survenue.' });
      return false;
    } catch (err) {
      this.toast.add({ severity: 'error', summary: 'Action impossible', detail: this.errorText(err) });
      return false;
    }
  }

  private errorText(err: unknown): string {
    const msg = (err as { error?: { message?: string } })?.error?.message;
    return msg ?? 'Une erreur est survenue. Veuillez réessayer.';
  }
}
