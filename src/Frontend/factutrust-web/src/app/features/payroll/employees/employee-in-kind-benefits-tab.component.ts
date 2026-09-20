import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PayrollService,
  EmployeeInKindBenefit,
  UpsertInKindBenefitRequest
} from '@core/services/payroll.service';
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

const BENEFIT_TYPE_OPTIONS = [
  { label: 'Véhicule de fonction', value: 'CompanyVehicle' },
  { label: 'Logement de fonction', value: 'Housing' },
  { label: 'Autre avantage en nature', value: 'Other' }
];

@Component({
  selector: 'app-employee-in-kind-benefits-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    DialogModule,
    SelectModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    Textarea,
    ButtonComponent,
    PayrollSectionComponent,
    PayrollAmountPipe
  ],
  template: `
    <app-payroll-section
      title="Avantages en nature"
      subtitle="Valorisation mensuelle intégrée au brut imposable et cotisable au calcul."
      icon="pi-home">
      @if (!readOnly) {
        <div class="payroll-toolbar mb-3">
          <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()">Nouvel avantage</app-button>
        </div>
      }

      <p-table [value]="items()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th>Type</th>
            <th>Libellé</th>
            <th class="text-right">Valeur mensuelle</th>
            <th>Début</th>
            <th>Fin</th>
            @if (!readOnly) { <th></th> }
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-b>
          <tr>
            <td>{{ b.typeDisplay || b.type }}</td>
            <td>{{ b.label }}</td>
            <td class="text-right">{{ b.monthlyValue | payrollAmount }}</td>
            <td>{{ b.startDate | date:'dd/MM/yyyy' }}</td>
            <td>{{ b.endDate ? (b.endDate | date:'dd/MM/yyyy') : '—' }}</td>
            @if (!readOnly) {
              <td class="actions">
                <button type="button" class="p-button p-button-text p-button-sm" (click)="editBenefit(b)">Modifier</button>
                <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(b)">Supprimer</button>
              </td>
            }
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td [attr.colspan]="readOnly ? 5 : 6">Aucun avantage en nature enregistré.</td></tr>
        </ng-template>
      </p-table>
    </app-payroll-section>

    <p-dialog [header]="dialogHeader" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '520px' }">
      <div class="payroll-form-group mb-2">
        <label>Type</label>
        <p-select [options]="typeOptions" optionLabel="label" optionValue="value" [(ngModel)]="formType" appendTo="body" styleClass="w-full" />
      </div>
      <div class="payroll-form-group mb-2">
        <label>Libellé</label>
        <input pInputText [(ngModel)]="formLabel" class="w-full" maxlength="200" />
      </div>
      <div class="payroll-form-group mb-2">
        <label>Valeur mensuelle (TND)</label>
        <p-inputNumber [(ngModel)]="formMonthlyValue" [min]="0.001" [minFractionDigits]="3" [maxFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label>Date de début</label>
          <p-datepicker [(ngModel)]="formStartDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" [disabled]="!!editingId" />
        </div>
        <div class="payroll-form-group">
          <label>Date de fin</label>
          <p-datepicker [(ngModel)]="formEndDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
      </div>
      <div class="payroll-form-group mb-2">
        <label>Description</label>
        <textarea pTextarea [(ngModel)]="formDescription" rows="2" class="w-full"></textarea>
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
    .w-full { width: 100%; }
    .text-right { text-align: right; }
    .actions { white-space: nowrap; }
  `]
})
export class EmployeeInKindBenefitsTabComponent implements OnInit {
  @Input({ required: true }) employeeId!: string;
  @Input() readOnly = false;

  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  readonly typeOptions = BENEFIT_TYPE_OPTIONS;
  items = signal<EmployeeInKindBenefit[]>([]);
  dialogVisible = false;
  editingId: string | null = null;
  formType = 'CompanyVehicle';
  formLabel = '';
  formMonthlyValue = 0;
  formStartDate: Date | null = new Date();
  formEndDate: Date | null = null;
  formDescription = '';

  get dialogHeader(): string {
    return this.editingId ? "Modifier l'avantage" : 'Nouvel avantage en nature';
  }

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.payroll.listInKindBenefits(this.employeeId).subscribe({
      next: res => this.items.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: 'Avantages en nature', detail: 'Chargement impossible.' })
    });
  }

  openDialog(): void {
    if (this.readOnly) return;
    this.editingId = null;
    this.formType = 'CompanyVehicle';
    this.formLabel = '';
    this.formMonthlyValue = 0;
    this.formStartDate = new Date();
    this.formEndDate = null;
    this.formDescription = '';
    this.dialogVisible = true;
  }

  editBenefit(b: EmployeeInKindBenefit): void {
    if (this.readOnly) return;
    this.editingId = b.id;
    this.formType = b.type;
    this.formLabel = b.label;
    this.formMonthlyValue = b.monthlyValue;
    this.formStartDate = new Date(b.startDate);
    this.formEndDate = b.endDate ? new Date(b.endDate) : null;
    this.formDescription = b.description ?? '';
    this.dialogVisible = true;
  }

  save(): void {
    if (this.readOnly || !this.formLabel.trim() || this.formMonthlyValue <= 0 || !this.formStartDate) return;

    const body: UpsertInKindBenefitRequest = {
      type: this.formType,
      label: this.formLabel.trim(),
      monthlyValue: this.formMonthlyValue,
      startDate: toIsoDate(this.formStartDate)!,
      endDate: toIsoDate(this.formEndDate),
      description: this.formDescription.trim() || undefined
    };

    const req = this.editingId
      ? this.payroll.updateInKindBenefit(this.employeeId, this.editingId, body)
      : this.payroll.createInKindBenefit(this.employeeId, body);

    req.subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Avantages en nature', detail: 'Enregistré.' });
        this.dialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Avantages en nature', detail: err.error?.message ?? 'Enregistrement impossible.' })
    });
  }

  confirmDelete(b: EmployeeInKindBenefit): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: `Supprimer l'avantage « ${b.label} » ?`,
      header: 'Confirmation',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(b.id)
    });
  }

  private delete(id: string): void {
    this.payroll.deleteInKindBenefit(this.employeeId, id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Avantages en nature', detail: 'Supprimé.' });
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Avantages en nature', detail: err.error?.message ?? 'Suppression impossible.' })
    });
  }
}
