import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiResponse } from '@core/services/auth.service';
import { FirmGovernanceService } from '@core/services/firm-governance.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';

export interface FirmClientRef {
  assignmentId: string;
  companyName: string;
}

@Injectable({ providedIn: 'root' })
export class FirmGovernanceActionsService {
  private readonly governance = inject(FirmGovernanceService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly router = inject(Router);

  async initializePermanentFile(client: FirmClientRef): Promise<boolean> {
    try {
      const r = await firstValueFrom(this.governance.upsertPermanentFile(client.assignmentId, {
        wizardStep: 1,
        companyName: client.companyName
      }));
      if (r.success) {
        this.toast.add({
          severity: 'success',
          summary: 'Dossier permanent',
          detail: `Initialisation de « ${client.companyName} ».`
        });
        await this.router.navigate(['/firm/governance/permanent-files', client.assignmentId], {
          queryParams: { mode: 'edit' }
        });
        return true;
      }
      this.toast.add({ severity: 'error', summary: 'Action impossible', detail: r.message ?? 'Une erreur est survenue.' });
      return false;
    } catch (err) {
      this.toast.add({ severity: 'error', summary: 'Action impossible', detail: this.errorText(err) });
      return false;
    }
  }

  openPermanentFile(assignmentId: string, mode: 'view' | 'edit' = 'edit'): void {
    void this.router.navigate(['/firm/governance/permanent-files', assignmentId], {
      queryParams: { mode }
    });
  }

  submitExpenseNote(noteId: string): Promise<boolean> {
    return this.confirmAndCall(
      {
        header: 'Soumettre la note',
        message: 'Soumettre cette note de frais pour approbation ?',
        icon: 'pi pi-send',
        acceptLabel: 'Soumettre',
        acceptButtonStyleClass: 'btn-primary'
      },
      () => this.governance.submitExpenseNote(noteId),
      'Note soumise.',
      'Soumission impossible.'
    );
  }

  processExpenseNote(noteId: string, approve: boolean): Promise<boolean> {
    if (approve) {
      return this.confirmAndCall(
        {
          header: 'Approuver la note',
          message: 'Approuver cette note de frais dirigeant ?',
          icon: 'pi pi-check-circle',
          acceptLabel: 'Approuver',
          acceptButtonStyleClass: 'btn-success'
        },
        () => this.governance.processExpenseNote(noteId, true),
        'Note approuvée.',
        'Approbation impossible.'
      );
    }

    return this.confirmAndCall(
      {
        header: 'Rejeter la note',
        message: 'Rejeter cette note de frais ? Le dirigeant pourra la corriger et la resoumettre.',
        icon: 'pi pi-times-circle',
        acceptLabel: 'Rejeter',
        acceptButtonStyleClass: 'btn-danger'
      },
      () => this.governance.processExpenseNote(noteId, false),
      'Note rejetée.',
      'Rejet impossible.'
    );
  }

  reimburseExpenseNote(noteId: string): Promise<boolean> {
    return this.confirmAndCall(
      {
        header: 'Marquer remboursée',
        message: 'Confirmer le remboursement de cette note de frais ?',
        icon: 'pi pi-wallet',
        acceptLabel: 'Confirmer',
        acceptButtonStyleClass: 'btn-success'
      },
      () => this.governance.markExpenseNoteReimbursed(noteId),
      'Note marquée remboursée.',
      'Action impossible.'
    );
  }

  private confirmAndCall(
    opts: {
      header: string;
      message: string;
      icon: string;
      acceptLabel: string;
      acceptButtonStyleClass: string;
    },
    call: () => Observable<ApiResponse<unknown>>,
    successDetail: string,
    errorSummary: string
  ): Promise<boolean> {
    return new Promise(resolve => {
      this.confirmation.confirm({
        ...opts,
        rejectLabel: 'Annuler',
        accept: () => {
          call().subscribe({
            next: r => {
              if (r.success) {
                this.toast.add({ severity: 'success', summary: 'Note de frais', detail: successDetail });
                resolve(true);
              } else {
                this.toast.add({ severity: 'error', summary: errorSummary, detail: r.message ?? 'Une erreur est survenue.' });
                resolve(false);
              }
            },
            error: err => {
              this.toast.add({ severity: 'error', summary: errorSummary, detail: this.errorText(err) });
              resolve(false);
            }
          });
        },
        reject: () => resolve(false)
      });
    });
  }

  private errorText(err: unknown): string {
    const msg = (err as { error?: { message?: string } })?.error?.message;
    return msg ?? 'Une erreur est survenue. Veuillez réessayer.';
  }
}
