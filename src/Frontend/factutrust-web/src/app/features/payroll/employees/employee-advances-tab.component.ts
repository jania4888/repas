import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { Textarea } from 'primeng/textarea';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmployeeService } from '@core/services/employee.service';
import { PayrollService, EmployeeAdvance } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PayrollSectionComponent, PayrollAmountPipe } from '../shared';

function toIsoDate(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Component({
  selector: 'app-employee-advances-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    TagModule,
    DialogModule,
    DatePickerModule,
    InputNumberModule,
    Textarea,
    ButtonComponent,
    PayrollSectionComponent,
    PayrollAmountPipe
  ],
  template: `
    <app-payroll-section
      title="Avances sur salaire"
      subtitle="Les avances en cours sont retenues au calcul du cycle et soldées à la validation."
      icon="pi-wallet">
      @if (!readOnly) {
        <div class="payroll-toolbar mb-3">
          <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()">Nouvelle avance</app-button>
        </div>
      }

      <p-table [value]="items()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th>Date</th>
            <th class="text-right">Montant</th>
            <th>Motif</th>
            <th>Statut</th>
            @if (!readOnly) { <th></th> }
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-a>
          <tr>
            <td>{{ a.date | date:'dd/MM/yyyy' }}</td>
            <td class="text-right">{{ a.amount | payrollAmount }}</td>
            <td>{{ a.reason || '—' }}</td>
            <td>
              <p-tag [value]="a.isSettled ? 'Soldée' : 'En cours'" [severity]="a.isSettled ? 'secondary' : 'info'" />
            </td>
            @if (!readOnly) {
              <td>
                @if (!a.isSettled) {
                  <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(a)">Supprimer</button>
                }
              </td>
            }
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td [attr.colspan]="readOnly ? 4 : 5">Aucune avance enregistrée.</td></tr>
        </ng-template>
      </p-table>
    </app-payroll-section>

    <p-dialog header="Nouvelle avance" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '420px' }">
      <div class="payroll-form-group mb-2">
        <label>Date</label>
        <p-datepicker [(ngModel)]="formDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
      </div>
      <div class="payroll-form-group mb-2">
        <label>Montant (TND)</label>
        <p-inputNumber [(ngModel)]="formAmount" [minFractionDigits]="3" [min]="0.001" [locale]="'fr-TN'" styleClass="w-full" />
      </div>
      <div class="payroll-form-group mb-2">
        <label>Motif</label>
        <textarea pTextarea [(ngModel)]="formReason" rows="2" class="w-full"></textarea>
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="dialogVisible = false">Annuler</app-button>
        <app-button variant="primary" (click)="create()">Enregistrer</app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .mb-2 { margin-bottom: var(--spacing-2); }
    .mb-3 { margin-bottom: var(--spacing-4); }
    .w-full { width: 100%; }
  `]
})
export class EmployeeAdvancesTabComponent implements OnInit {
  @Input({ required: true }) employeeId!: string;
  @Input() readOnly = false;

  private readonly employees = inject(EmployeeService);
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  items = signal<EmployeeAdvance[]>([]);
  dialogVisible = false;
  formDate: Date | null = new Date();
  formAmount = 0;
  formReason = '';

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.employees.listAdvances(this.employeeId).subscribe({
      next: res => this.items.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: 'Avances', detail: 'Chargement impossible.' })
    });
  }

  openDialog(): void {
    if (this.readOnly) return;
    this.formDate = new Date();
    this.formAmount = 0;
    this.formReason = '';
    this.dialogVisible = true;
  }

  create(): void {
    if (this.readOnly || !this.formDate || this.formAmount <= 0) return;
    this.payroll.createAdvance({
      employeeId: this.employeeId,
      date: toIsoDate(this.formDate)!,
      amount: this.formAmount,
      reason: this.formReason || undefined
    }).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Avances', detail: 'Avance enregistrée.' });
        this.dialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Avances', detail: err.error?.message ?? 'Création impossible.' })
    });
  }

  confirmDelete(advance: EmployeeAdvance): void {
    if (this.readOnly || advance.isSettled) return;
    this.confirmation.confirm({
      message: `Supprimer l'avance de ${advance.amount} TND ?`,
      header: 'Confirmation',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(advance.id)
    });
  }

  private delete(id: string): void {
    this.payroll.deleteAdvance(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Avances', detail: 'Avance supprimée.' });
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: 'Avances',
        detail: err.error?.message ?? 'Suppression impossible (avance peut-être déjà soldée).'
      })
    });
  }
}
