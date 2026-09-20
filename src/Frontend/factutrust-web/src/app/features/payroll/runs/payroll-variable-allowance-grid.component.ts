import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { CheckboxModule } from 'primeng/checkbox';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmployeeService, EmployeeListItem } from '@core/services/employee.service';
import {
  PayrollService,
  PayrollVariableAllowanceLine,
  UpsertVariableAllowanceLineRequest
} from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PayrollSectionComponent, PayrollAmountPipe } from '../shared';

@Component({
  selector: 'app-payroll-variable-allowance-grid',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    DialogModule,
    SelectModule,
    InputNumberModule,
    InputTextModule,
    CheckboxModule,
    ButtonComponent,
    PayrollSectionComponent,
    PayrollAmountPipe
  ],
  template: `
    <app-payroll-section
      title="Éléments variables — Primes mensuelles"
      subtitle="Primes saisies pour ce mois uniquement. Pensez à recalculer le cycle pour mettre à jour les bulletins."
      icon="pi-gift">
      @if (!readOnly) {
        <div class="payroll-toolbar mb-3">
          <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()">Ajouter une prime</app-button>
        </div>
      }

      <div class="payroll-table-scroll">
      <p-table [value]="lines()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th>Salarié</th>
            <th>Libellé</th>
            <th class="text-right">Montant</th>
            <th class="text-center">Imposable</th>
            <th class="text-center">CNSS</th>
            @if (!readOnly) { <th></th> }
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-line>
          <tr>
            <td>{{ line.employeeName }}</td>
            <td>{{ line.label }}</td>
            <td class="text-right">{{ line.amount | payrollAmount }}</td>
            <td class="text-center">{{ line.taxable ? 'Oui' : 'Non' }}</td>
            <td class="text-center">{{ line.subjectToCnss ? 'Oui' : 'Non' }}</td>
            @if (!readOnly) {
              <td class="actions">
                <button type="button" class="p-button p-button-text p-button-sm" (click)="editLine(line)">Modifier</button>
                <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(line)">Supprimer</button>
              </td>
            }
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td [attr.colspan]="readOnly ? 5 : 6">Aucune prime variable saisie pour ce mois.</td></tr>
        </ng-template>
      </p-table>
      </div>
    </app-payroll-section>

    <p-dialog [header]="editingId ? 'Modifier la prime' : 'Nouvelle prime variable'" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '520px' }">
      <div class="payroll-form-group mb-2">
        <label>Salarié</label>
        <p-select [options]="employees()" optionLabel="fullName" optionValue="id" [(ngModel)]="formEmployeeId" appendTo="body" styleClass="w-full" [disabled]="!!editingId" />
      </div>
      <div class="payroll-form-group mb-2">
        <label>Libellé</label>
        <input pInputText [(ngModel)]="formLabel" class="w-full" maxlength="200" />
      </div>
      <div class="payroll-form-group mb-2">
        <label>Montant</label>
        <p-inputNumber [(ngModel)]="formAmount" [min]="0.001" [minFractionDigits]="3" [maxFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <p-checkbox [(ngModel)]="formTaxable" [binary]="true" inputId="varTaxable" />
          <label for="varTaxable" class="ml-2">Imposable IRPP</label>
        </div>
        <div class="payroll-form-group">
          <p-checkbox [(ngModel)]="formSubjectToCnss" [binary]="true" inputId="varCnss" />
          <label for="varCnss" class="ml-2">Soumise CNSS</label>
        </div>
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
    .ml-2 { margin-left: var(--spacing-2); }
    .actions { white-space: nowrap; }
    .w-full { width: 100%; }
    .text-center { text-align: center; }
  `]
})
export class PayrollVariableAllowanceGridComponent implements OnInit {
  @Input({ required: true }) year!: number;
  @Input({ required: true }) month!: number;
  @Input() readOnly = false;
  @Input() initialLines: PayrollVariableAllowanceLine[] = [];

  private readonly employeesApi = inject(EmployeeService);
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  lines = signal<PayrollVariableAllowanceLine[]>([]);
  employees = signal<EmployeeListItem[]>([]);
  dialogVisible = false;
  editingId: string | null = null;
  formEmployeeId: string | null = null;
  formLabel = '';
  formAmount = 0;
  formTaxable = true;
  formSubjectToCnss = true;

  ngOnInit(): void {
    this.lines.set(this.initialLines ?? []);
    this.loadEmployees();
  }

  reload(): void {
    this.payroll.listVariableAllowances(this.year, this.month).subscribe({
      next: res => this.lines.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: 'Primes variables', detail: 'Chargement impossible.' })
    });
  }

  private loadEmployees(): void {
    this.employeesApi.list(undefined, true, 1, 500).subscribe({
      next: res => this.employees.set(res.data?.items ?? []),
      error: () => {}
    });
  }

  openDialog(): void {
    if (this.readOnly) return;
    this.editingId = null;
    this.formEmployeeId = null;
    this.formLabel = '';
    this.formAmount = 0;
    this.formTaxable = true;
    this.formSubjectToCnss = true;
    this.dialogVisible = true;
  }

  editLine(line: PayrollVariableAllowanceLine): void {
    if (this.readOnly) return;
    this.editingId = line.id;
    this.formEmployeeId = line.employeeId;
    this.formLabel = line.label;
    this.formAmount = line.amount;
    this.formTaxable = line.taxable;
    this.formSubjectToCnss = line.subjectToCnss;
    this.dialogVisible = true;
  }

  save(): void {
    if (this.readOnly || !this.formEmployeeId || !this.formLabel.trim() || this.formAmount <= 0) return;

    const body: UpsertVariableAllowanceLineRequest = {
      employeeId: this.formEmployeeId,
      year: this.year,
      month: this.month,
      label: this.formLabel.trim(),
      amount: this.formAmount,
      taxable: this.formTaxable,
      subjectToCnss: this.formSubjectToCnss
    };

    const req = this.editingId
      ? this.payroll.updateVariableAllowance(this.editingId, body)
      : this.payroll.createVariableAllowance(body);

    req.subscribe({
      next: () => {
        this.toast.add({
          severity: 'success',
          summary: 'Primes variables',
          detail: 'Enregistré. Recalculez le cycle pour mettre à jour les bulletins.'
        });
        this.dialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: 'Primes variables',
        detail: err?.error?.message ?? 'Enregistrement impossible.'
      })
    });
  }

  confirmDelete(line: PayrollVariableAllowanceLine): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: `Supprimer la prime « ${line.label} » pour ${line.employeeName} ?`,
      header: 'Confirmation',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(line.id)
    });
  }

  private delete(id: string): void {
    this.payroll.deleteVariableAllowance(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Primes variables', detail: 'Supprimé.' });
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: 'Primes variables',
        detail: err?.error?.message ?? 'Suppression impossible.'
      })
    });
  }
}
