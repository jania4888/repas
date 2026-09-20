import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { FirmCollaboratorsService } from '@core/services/firm-collaborators.service';
import { downloadBlob } from '@features/accounting/shared/accounting-download.util';
import { FirmLeavesService } from './data-access/firm-leaves.service';
import { FIRM_LEAVE_STATUS, FirmLeaveRequest, FirmLeaveType } from './data-access/firm-leaves.models';
import { FirmLeaveRequestDialogComponent } from './firm-leave-request-dialog.component';

@Component({
  selector: 'app-firm-leaves-requests',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TableModule, ButtonModule, SelectModule,
    TagModule, DatePickerModule, DialogModule, FirmLeaveRequestDialogComponent
  ],
  template: `
    <div class="toolbar">
      <button type="button" pButton label="Demander" icon="pi pi-plus" class="p-button-sm" (click)="openCreate()"></button>
      <button type="button" pButton label="Modifier" icon="pi pi-pencil" class="p-button-sm p-button-outlined"
        [disabled]="!canEdit()" (click)="openEdit()"></button>
      <button type="button" pButton label="Soumettre" icon="pi pi-send" class="p-button-sm p-button-outlined"
        [disabled]="!canSubmit()" (click)="submitSelected()"></button>
      <button type="button" pButton label="Annuler" icon="pi pi-ban" class="p-button-sm p-button-outlined p-button-danger"
        [disabled]="!canCancel()" (click)="cancelSelected()"></button>
      <button type="button" pButton label="Détails" icon="pi pi-eye" class="p-button-sm p-button-outlined"
        [disabled]="!selected()" (click)="detailVisible = true"></button>
      @if (isManager()) {
        <button type="button" pButton label="Exporter Excel" icon="pi pi-file-excel" class="p-button-sm p-button-outlined"
          (click)="exportList()"></button>
        <button type="button" pButton label="Synthèse Excel" icon="pi pi-table" class="p-button-sm p-button-outlined"
          (click)="exportSynthesis()"></button>
      }
    </div>

    <div class="filters">
      @if (isManager()) {
        <p-select [(ngModel)]="filterUserId" [options]="collaborators()" optionLabel="label" optionValue="value"
          placeholder="Collaborateur" [showClear]="true" [filter]="true" (onChange)="reload()" />
      }
      <p-select [(ngModel)]="filterStatus" [options]="statusOptions" optionLabel="label" optionValue="value"
        placeholder="Statut" [showClear]="true" (onChange)="reload()" />
      <p-select [(ngModel)]="filterTypeId" [options]="types()" optionLabel="label" optionValue="id"
        placeholder="Type" [showClear]="true" (onChange)="reload()" />
      <p-select [(ngModel)]="filterYear" [options]="yearOptions" placeholder="Année" (onChange)="reload()" />
      <button type="button" pButton label="Réinitialiser" class="p-button-text p-button-sm" (click)="resetFilters()"></button>
    </div>

    <div class="fc-card">
      <p-table [value]="rows()" [loading]="loading()"         selectionMode="single" [(selection)]="selection"
        dataKey="id" (onRowSelect)="onSelect($any($event).data)" (onRowUnselect)="selected.set(null)">
        <ng-template pTemplate="header">
          <tr>
            <th>Collaborateur</th>
            <th>Date début</th>
            <th>Date fin</th>
            <th>Nb jours</th>
            <th>Date demande</th>
            <th>Type</th>
            <th>Traité par</th>
            <th>Statut</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-r>
          <tr [pSelectableRow]="r">
            <td>{{ r.collaboratorName }}</td>
            <td>{{ r.startDate | date:'dd/MM/yyyy' }}</td>
            <td>{{ r.endDate | date:'dd/MM/yyyy' }}</td>
            <td>{{ r.days }}</td>
            <td>{{ (r.submittedAt || r.createdAt) | date:'dd/MM/yyyy' }}</td>
            <td><span class="type-dot" [style.background]="r.leaveTypeColorHex"></span>{{ r.leaveTypeLabel }}</td>
            <td>{{ r.processedByName || '—' }}</td>
            <td><p-tag [value]="r.statusDisplay" [severity]="severity(r.status)" /></td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    <app-firm-leave-request-dialog
      [(visible)]="dialogVisible"
      [types]="types()"
      [editRequest]="editReq"
      (saved)="reload()" />

    <p-dialog header="Détail de la demande" [(visible)]="detailVisible" [modal]="true" [style]="{width:'480px'}" appendTo="body">
      @if (selected(); as s) {
        <dl class="detail">
          <dt>Collaborateur</dt><dd>{{ s.collaboratorName }}</dd>
          <dt>Type</dt><dd>{{ s.leaveTypeLabel }}</dd>
          <dt>Période</dt><dd>{{ s.startDate | date:'dd/MM/yyyy' }} → {{ s.endDate | date:'dd/MM/yyyy' }} ({{ s.days }} j.)</dd>
          <dt>Statut</dt><dd>{{ s.statusDisplay }}</dd>
          <dt>Motif</dt><dd>{{ s.reason || '—' }}</dd>
          <dt>Traité par</dt><dd>{{ s.processedByName || '—' }}</dd>
          @if (s.rejectionReason) { <dt>Motif refus</dt><dd>{{ s.rejectionReason }}</dd> }
        </dl>
      }
    </p-dialog>
  `,
  styles: [`
    .toolbar, .filters { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: .75rem; align-items: center; }
    .fc-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 8px; }
    .type-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .detail { display: grid; grid-template-columns: 140px 1fr; gap: .4rem .75rem; }
    .detail dt { color: #64748b; }
  `]
})
export class FirmLeavesRequestsComponent implements OnInit {
  private readonly api = inject(FirmLeavesService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly confirm = inject(ConfirmationService);
  private readonly collabApi = inject(FirmCollaboratorsService);

  readonly isManager = this.auth.isFirmManager;
  readonly loading = signal(false);
  readonly rows = signal<FirmLeaveRequest[]>([]);
  readonly types = signal<FirmLeaveType[]>([]);
  readonly selected = signal<FirmLeaveRequest | null>(null);
  readonly collaborators = signal<{ label: string; value: string }[]>([]);
  selection: FirmLeaveRequest | null = null;
  dialogVisible = false;
  detailVisible = false;
  editReq: FirmLeaveRequest | null = null;

  filterUserId?: string;
  filterStatus?: number;
  filterTypeId?: string;
  filterYear = new Date().getFullYear();
  readonly yearOptions = [2025, 2026, 2027, 2028].map(y => ({ label: String(y), value: y }));
  readonly statusOptions = [
    { label: 'Brouillon', value: 0 },
    { label: 'En attente', value: 1 },
    { label: 'Acceptée', value: 2 },
    { label: 'Refusée', value: 3 },
    { label: 'Annulée', value: 4 }
  ];

  ngOnInit(): void {
    this.api.listTypes(true).subscribe({ next: r => this.types.set(r.data ?? []) });
    if (this.isManager()) {
      this.collabApi.list({ isActive: true }).subscribe({
        next: list => this.collaborators.set(list.map(u => ({
          label: `${u.firstName} ${u.lastName}`.trim(), value: u.id
        })))
      });
    }
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.api.listRequests({
      userId: this.filterUserId,
      status: this.filterStatus,
      typeId: this.filterTypeId,
      year: this.filterYear
    }).subscribe({
      next: r => { this.rows.set(r.data ?? []); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  resetFilters(): void {
    this.filterUserId = undefined;
    this.filterStatus = undefined;
    this.filterTypeId = undefined;
    this.filterYear = new Date().getFullYear();
    this.reload();
  }

  onSelect(row: FirmLeaveRequest): void { this.selected.set(row); }

  canEdit(): boolean {
    const s = this.selected();
    return !!s && (s.status === FIRM_LEAVE_STATUS.Draft || s.status === FIRM_LEAVE_STATUS.Rejected);
  }

  canSubmit(): boolean {
    const s = this.selected();
    return !!s && (s.status === FIRM_LEAVE_STATUS.Draft || s.status === FIRM_LEAVE_STATUS.Rejected);
  }

  canCancel(): boolean {
    const s = this.selected();
    return !!s && (s.status === FIRM_LEAVE_STATUS.Draft || s.status === FIRM_LEAVE_STATUS.Submitted);
  }

  openCreate(): void { this.editReq = null; this.dialogVisible = true; }

  openEdit(): void {
    this.editReq = this.selected();
    this.dialogVisible = true;
  }

  submitSelected(): void {
    const s = this.selected();
    if (!s) return;
    this.confirm.confirm({
      header: 'Soumettre la demande',
      message: 'Confirmer la soumission de cette demande pour validation ?',
      acceptLabel: 'Soumettre',
      accept: () => {
        this.api.submit(s.id).subscribe({
          next: r => {
            if (r.success) {
              this.toast.add({ severity: 'success', summary: 'Congés', detail: 'Demande soumise' });
              this.reload();
            } else {
              this.toast.add({
                severity: 'error',
                summary: 'Erreur',
                detail: this.apiResponseError(r, 'Soumission impossible.')
              });
            }
          },
          error: err => {
            this.toast.add({
              severity: 'error',
              summary: 'Erreur',
              detail: this.errorHandler.extractErrorMessage(err) || 'Soumission impossible.'
            });
          }
        });
      }
    });
  }

  cancelSelected(): void {
    const s = this.selected();
    if (!s) return;
    this.confirm.confirm({
      header: 'Annuler la demande',
      message: 'Confirmer l’annulation de cette demande ?',
      acceptLabel: 'Annuler la demande',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.api.cancel(s.id).subscribe({
          next: r => {
            if (r.success) {
              this.toast.add({ severity: 'success', summary: 'Congés', detail: 'Demande annulée' });
              this.reload();
            } else {
              this.toast.add({
                severity: 'error',
                summary: 'Erreur',
                detail: this.apiResponseError(r, 'Annulation impossible.')
              });
            }
          },
          error: err => {
            this.toast.add({
              severity: 'error',
              summary: 'Erreur',
              detail: this.errorHandler.extractErrorMessage(err) || 'Annulation impossible.'
            });
          }
        });
      }
    });
  }

  exportList(): void {
    this.api.exportList(this.filterYear, this.filterStatus, this.filterTypeId).subscribe({
      next: blob => downloadBlob(blob, `conges_${this.filterYear}.xlsx`)
    });
  }

  exportSynthesis(): void {
    this.api.exportSynthesis(this.filterYear).subscribe({
      next: blob => downloadBlob(blob, `conges_synthese_${this.filterYear}.xlsx`)
    });
  }

  severity(status: number): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | undefined {
    switch (status) {
      case 1: return 'info';
      case 2: return 'success';
      case 3: return 'danger';
      case 4: return 'secondary';
      default: return 'warn';
    }
  }

  private apiResponseError(res: { message?: string | null; errors?: string[]; error?: string }, fallback: string): string {
    return res.message || res.errors?.[0] || res.error || fallback;
  }
}
