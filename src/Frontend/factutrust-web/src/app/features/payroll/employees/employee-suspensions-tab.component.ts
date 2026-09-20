import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { Textarea } from 'primeng/textarea';
import { InputSwitchModule } from 'primeng/inputswitch';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PayrollService, EmployeePayrollSuspension } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { SUSPENSION_TYPE_OPTIONS } from '../payroll-options';

function toIsoDate(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIsoDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Component({
  selector: 'app-employee-suspensions-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    TagModule,
    DialogModule,
    SelectModule,
    DatePickerModule,
    Textarea,
    InputSwitchModule,
    ButtonComponent
  ],
  template: `
    <p class="payroll-info-text">
      Les suspensions approuvées réduisent le brut du mois (prorata) lorsque l'option est activée sur l'exercice.
      Une suspension rémunérée n'entraîne pas de retenue.
    </p>

    @if (!readOnly) {
      <div class="payroll-toolbar mb-3">
        <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()">Ajouter une suspension</app-button>
      </div>
    }

    <p-table [value]="items()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th>Type</th>
          <th>Début</th>
          <th>Fin</th>
          <th>Rémunérée</th>
          <th>Statut</th>
          @if (!readOnly) { <th></th> }
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-s>
        <tr>
          <td>{{ s.typeDisplay }}</td>
          <td>{{ s.startDate | date:'dd/MM/yyyy' }}</td>
          <td>{{ s.endDate ? (s.endDate | date:'dd/MM/yyyy') : '—' }}</td>
          <td>{{ s.isPaid ? 'Oui' : 'Non' }}</td>
          <td>
            <p-tag [value]="s.isApproved ? 'Approuvée' : 'En attente'" [severity]="s.isApproved ? 'success' : 'warn'" />
          </td>
          @if (!readOnly) {
            <td class="actions">
              <button type="button" class="p-button p-button-text p-button-sm" (click)="openDialog(s)">Modifier</button>
              @if (!s.isApproved) {
                <button type="button" class="p-button p-button-text p-button-sm" (click)="approve(s)">Approuver</button>
              }
              <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(s)">Supprimer</button>
            </td>
          }
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td [attr.colspan]="readOnly ? 5 : 6">Aucune suspension enregistrée.</td></tr>
      </ng-template>
    </p-table>

    <p-dialog
      [header]="editingId ? 'Modifier la suspension' : 'Nouvelle suspension'"
      [(visible)]="dialogVisible"
      [modal]="true"
      [style]="{ width: '480px' }">
      <div class="payroll-form-group mb-2">
        <label>Type</label>
        <p-select [options]="suspensionTypeOptions" [(ngModel)]="formType" optionLabel="label" optionValue="value" appendTo="body" styleClass="w-full" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label>Début</label>
          <p-datepicker [(ngModel)]="formStart" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label>Fin</label>
          <p-datepicker [(ngModel)]="formEnd" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
      </div>
      <div class="payroll-form-group switch-row mb-2">
        <label for="isPaid">Suspension rémunérée</label>
        <p-inputSwitch inputId="isPaid" [(ngModel)]="formIsPaid" />
      </div>
      <div class="payroll-form-group mb-2">
        <label>Motif</label>
        <textarea pTextarea [(ngModel)]="formReason" rows="2" class="w-full"></textarea>
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="dialogVisible = false">Annuler</app-button>
        <app-button variant="primary" (click)="save()">Enregistrer</app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .mb-2 { margin-bottom: var(--spacing-2); }
    .mb-3 { margin-bottom: var(--spacing-4); }
    .actions { white-space: nowrap; }
    .w-full { width: 100%; }
    .switch-row { flex-direction: row; align-items: center; justify-content: space-between; }
  `]
})
export class EmployeeSuspensionsTabComponent implements OnInit {
  @Input({ required: true }) employeeId!: string;
  @Input() readOnly = false;

  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  readonly suspensionTypeOptions = SUSPENSION_TYPE_OPTIONS;
  items = signal<EmployeePayrollSuspension[]>([]);
  dialogVisible = false;
  editingId: string | null = null;
  formType = 'Disciplinary';
  formStart: Date | null = null;
  formEnd: Date | null = null;
  formIsPaid = false;
  formReason = '';

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.payroll.listSuspensions(this.employeeId).subscribe({
      next: res => this.items.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: 'Suspensions', detail: 'Chargement impossible.' })
    });
  }

  openDialog(item?: EmployeePayrollSuspension): void {
    if (this.readOnly) return;
    if (item) {
      this.editingId = item.id;
      this.formType = item.type;
      this.formStart = parseIsoDate(item.startDate);
      this.formEnd = parseIsoDate(item.endDate);
      this.formIsPaid = item.isPaid;
      this.formReason = item.reason ?? '';
    } else {
      this.editingId = null;
      this.formType = 'Disciplinary';
      this.formStart = new Date();
      this.formEnd = null;
      this.formIsPaid = false;
      this.formReason = '';
    }
    this.dialogVisible = true;
  }

  save(): void {
    if (this.readOnly || !this.formStart) return;
    const body = {
      type: this.formType,
      startDate: toIsoDate(this.formStart)!,
      endDate: toIsoDate(this.formEnd),
      isPaid: this.formIsPaid,
      reason: this.formReason || undefined
    };
    const req = this.editingId
      ? this.payroll.updateSuspension(this.editingId, body)
      : this.payroll.createSuspension(this.employeeId, body);
    req.subscribe({
      next: () => {
        this.toast.add({
          severity: 'success',
          summary: 'Suspensions',
          detail: this.editingId ? 'Suspension mise à jour.' : 'Suspension enregistrée.'
        });
        this.dialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: 'Suspensions',
        detail: err.error?.message ?? 'Enregistrement impossible.'
      })
    });
  }

  approve(suspension: EmployeePayrollSuspension): void {
    if (this.readOnly) return;
    this.payroll.approveSuspension(suspension.id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Suspensions', detail: 'Suspension approuvée.' });
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: 'Suspensions',
        detail: err.error?.message ?? 'Approbation impossible.'
      })
    });
  }

  confirmDelete(suspension: EmployeePayrollSuspension): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: `Supprimer la suspension du ${suspension.startDate} ?`,
      header: 'Confirmation',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(suspension.id)
    });
  }

  private delete(id: string): void {
    this.payroll.deleteSuspension(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Suspensions', detail: 'Suspension supprimée.' });
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: 'Suspensions',
        detail: err.error?.message ?? 'Suppression impossible.'
      })
    });
  }
}
