import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { DialogModule } from 'primeng/dialog';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { FirmLeavesService } from './data-access/firm-leaves.service';
import {
  FIRM_LEAVE_MIRROR_STATE,
  FIRM_LEAVE_STATUS,
  FirmLeaveMirrorResult,
  FirmLeaveRequest
} from './data-access/firm-leaves.models';

@Component({
  selector: 'app-firm-leaves-validation',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, ButtonModule, TagModule, InputTextModule, DialogModule],
  template: `
    <div class="fc-card">
      <p-table [value]="rows()" [loading]="loading()">
        <ng-template pTemplate="header">
          <tr>
            <th>Collaborateur</th>
            <th>Type</th>
            <th>Période</th>
            <th>Durée</th>
            <th>Motif</th>
            <th>Soumise le</th>
            <th class="actions">Actions</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-r>
          <tr>
            <td>{{ r.collaboratorName }}</td>
            <td>{{ r.leaveTypeLabel }}</td>
            <td>{{ r.startDate | date:'dd/MM/yyyy' }} → {{ r.endDate | date:'dd/MM/yyyy' }}</td>
            <td>{{ r.days }} j.</td>
            <td>{{ r.reason || '—' }}</td>
            <td>{{ r.submittedAt | date:'dd/MM/yyyy' }}</td>
            <td class="actions">
              <button type="button" pButton icon="pi pi-check" class="p-button-rounded p-button-success p-button-sm"
                (click)="approve(r)"></button>
              <button type="button" pButton icon="pi pi-times" class="p-button-rounded p-button-danger p-button-sm"
                (click)="openReject(r)"></button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="7">Aucune demande en attente.</td></tr>
        </ng-template>
      </p-table>
    </div>

    <p-dialog header="Refuser la demande" [(visible)]="rejectVisible" [modal]="true" [style]="{width:'420px'}" appendTo="body">
      <label>Motif du refus
        <input pInputText [(ngModel)]="rejectReason" class="w-full" maxlength="500" />
      </label>
      <ng-template pTemplate="footer">
        <button type="button" pButton label="Annuler" class="p-button-text" (click)="rejectVisible=false"></button>
        <button type="button" pButton label="Refuser" class="p-button-danger" (click)="confirmReject()"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .fc-card { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:8px; }
    .actions { display:flex; gap:.35rem; justify-content:flex-end; white-space:nowrap; }
    .w-full { width:100%; }
    label { display:grid; gap:.35rem; }
  `]
})
export class FirmLeavesValidationComponent implements OnInit {
  private readonly api = inject(FirmLeavesService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmationService);

  readonly loading = signal(false);
  readonly rows = signal<FirmLeaveRequest[]>([]);
  rejectVisible = false;
  rejectReason = '';
  private rejectTarget: FirmLeaveRequest | null = null;

  ngOnInit(): void { this.reload(); }

  reload(): void {
    this.loading.set(true);
    this.api.listRequests({ status: FIRM_LEAVE_STATUS.Submitted, year: new Date().getFullYear() }).subscribe({
      next: r => { this.rows.set(r.data ?? []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  approve(r: FirmLeaveRequest): void {
    this.confirm.confirm({
      header: 'Accepter',
      message: `Accepter la demande de ${r.collaboratorName} (${r.days} j.) ?`,
      acceptLabel: 'Accepter',
      acceptButtonStyleClass: 'btn-success',
      accept: () => {
        this.api.process(r.id, true).subscribe({
          next: res => {
            if (res.success) {
              this.toast.add({ severity: 'success', summary: 'Congés', detail: 'Demande acceptée' });
              this.notifyPayrollMirror(res.data?.payrollMirror);
              this.reload();
            } else this.toast.add({ severity: 'error', summary: 'Erreur', detail: res.message ?? '' });
          },
          error: err => this.toast.add({ severity: 'error', summary: 'Erreur', detail: err?.error?.message || 'Échec' })
        });
      }
    });
  }

  openReject(r: FirmLeaveRequest): void {
    this.rejectTarget = r;
    this.rejectReason = '';
    this.rejectVisible = true;
  }

  confirmReject(): void {
    if (!this.rejectTarget) return;
    this.api.process(this.rejectTarget.id, false, this.rejectReason || undefined).subscribe({
      next: res => {
        this.rejectVisible = false;
        if (res.success) {
          this.toast.add({ severity: 'info', summary: 'Congés', detail: 'Demande refusée' });
          this.reload();
        } else this.toast.add({ severity: 'error', summary: 'Erreur', detail: res.message ?? '' });
      }
    });
  }

  /**
   * Signale à l'approbateur ce que le congé a produit — ou n'a pas pu produire — en paie.
   * L'approbation reste acquise dans tous les cas : seul le report peut échouer.
   */
  private notifyPayrollMirror(mirror?: FirmLeaveMirrorResult): void {
    if (!mirror || mirror.isApplied || mirror.state === FIRM_LEAVE_MIRROR_STATE.noPayrollEffect) return;

    this.toast.add({
      severity: mirror.state === FIRM_LEAVE_MIRROR_STATE.blockedFrozenPayroll ? 'warn' : 'error',
      summary: 'Report en paie',
      detail: mirror.message ?? mirror.stateDisplay,
      life: 10000
    });
  }
}
