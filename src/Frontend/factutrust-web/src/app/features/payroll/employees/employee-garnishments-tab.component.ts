import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PayrollService,
  EmployeeGarnishment,
  UpsertEmployeeGarnishmentRequest
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

const GARNISHMENT_TYPE_OPTIONS = [
  { label: 'Saisie sur salaire', value: 'Garnishment' },
  { label: 'Pension alimentaire', value: 'Alimony' }
];

const GARNISHMENT_KIND_OPTIONS = [
  { label: 'Montant fixe', value: 'FixedAmount' },
  { label: 'Pourcentage du net', value: 'PercentOfNet' }
];

@Component({
  selector: 'app-employee-garnishments-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    TagModule,
    DialogModule,
    SelectModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    ButtonComponent,
    PayrollSectionComponent,
    PayrollAmountPipe
  ],
  template: `
    <app-payroll-section
      title="Saisies sur salaire"
      subtitle="Retenues priorisées selon le barème légal et le net disponible."
      icon="pi-exclamation-triangle">
      @if (!readOnly) {
        <div class="payroll-toolbar mb-3">
          <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()">Nouvelle saisie</app-button>
        </div>
      }

      <p-table [value]="items()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th>Type</th>
            <th>Référence</th>
            <th>Bénéficiaire</th>
            <th>Mode</th>
            <th class="text-right">Montant dû</th>
            <th class="text-right">Déjà retenu</th>
            <th>Statut</th>
            @if (!readOnly) { <th></th> }
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-g>
          <tr>
            <td>{{ g.typeDisplay || g.type }}</td>
            <td>{{ g.reference }}</td>
            <td>{{ g.beneficiaryName }}</td>
            <td>{{ amountLabel(g) }}</td>
            <td class="text-right">{{ g.totalAmountDue != null ? (g.totalAmountDue | payrollAmount) : '—' }}</td>
            <td class="text-right">{{ (g.totalApplied ?? 0) | payrollAmount }}</td>
            <td>
              <p-tag [value]="g.statusDisplay || g.status" [severity]="garnishmentStatusSeverity(g.status)" />
            </td>
            @if (!readOnly) {
              <td class="actions">
                @if (g.status === 'Active') {
                  <button type="button" class="p-button p-button-text p-button-sm" (click)="editGarnishment(g)">Modifier</button>
                  <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmCancel(g)">Annuler</button>
                }
              </td>
            }
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td [attr.colspan]="readOnly ? 7 : 8">Aucune saisie enregistrée.</td></tr>
        </ng-template>
      </p-table>
    </app-payroll-section>

    <p-dialog [header]="editingId ? 'Modifier la saisie' : 'Nouvelle saisie'" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '560px' }">
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label>Type</label>
          <p-select [options]="typeOptions" optionLabel="label" optionValue="value" [(ngModel)]="formType" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label>Priorité</label>
          <p-inputNumber [(ngModel)]="formPriority" [min]="1" styleClass="w-full" />
        </div>
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label>Référence</label>
          <input pInputText [(ngModel)]="formReference" class="w-full" maxlength="100" />
        </div>
        <div class="payroll-form-group">
          <label>Date du titre</label>
          <p-datepicker [(ngModel)]="formIssuedAt" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
      </div>
      <div class="payroll-form-group mb-2">
        <label>Bénéficiaire</label>
        <input pInputText [(ngModel)]="formBeneficiaryName" class="w-full" maxlength="200" />
      </div>
      <div class="payroll-form-group mb-2">
        <label>RIB bénéficiaire (optionnel)</label>
        <input pInputText [(ngModel)]="formBeneficiaryRib" class="w-full" maxlength="20" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label>Mode de calcul</label>
          <p-select [options]="kindOptions" optionLabel="label" optionValue="value" [(ngModel)]="formKind" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          @if (formKind === 'FixedAmount') {
            <label>Montant fixe (TND)</label>
            <p-inputNumber [(ngModel)]="formFixedAmount" [min]="0.001" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
          } @else {
            <label>Pourcentage du net (%)</label>
            <p-inputNumber [(ngModel)]="formPercentOfNet" [min]="0.01" [max]="100" [minFractionDigits]="2" [locale]="'fr-TN'" styleClass="w-full" />
          }
        </div>
      </div>
      <div class="payroll-form-group mb-2">
        <label>Montant total dû (optionnel)</label>
        <p-inputNumber [(ngModel)]="formTotalAmountDue" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label>Date de début</label>
          <p-datepicker [(ngModel)]="formStartDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label>Date de fin</label>
          <p-datepicker [(ngModel)]="formEndDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
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
    .w-full { width: 100%; }
    .text-right { text-align: right; }
    .actions { white-space: nowrap; }
  `]
})
export class EmployeeGarnishmentsTabComponent implements OnInit {
  @Input({ required: true }) employeeId!: string;
  @Input() readOnly = false;

  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  readonly typeOptions = GARNISHMENT_TYPE_OPTIONS;
  readonly kindOptions = GARNISHMENT_KIND_OPTIONS;
  items = signal<EmployeeGarnishment[]>([]);
  dialogVisible = false;
  editingId: string | null = null;
  formType = 'Garnishment';
  formReference = '';
  formIssuedAt: Date | null = new Date();
  formBeneficiaryName = '';
  formBeneficiaryRib = '';
  formPriority = 1;
  formKind = 'FixedAmount';
  formFixedAmount = 0;
  formPercentOfNet = 0;
  formTotalAmountDue: number | null = null;
  formStartDate: Date | null = new Date();
  formEndDate: Date | null = null;

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.payroll.listGarnishments(this.employeeId).subscribe({
      next: res => this.items.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: 'Saisies', detail: 'Chargement impossible.' })
    });
  }

  amountLabel(g: EmployeeGarnishment): string {
    if (g.kind === 'PercentOfNet') {
      return `${g.percentOfNet ?? 0} % du net`;
    }
    return g.fixedAmount != null ? `${g.fixedAmount} TND / mois` : (g.kindDisplay ?? g.kind);
  }

  garnishmentStatusSeverity(status: string): 'success' | 'info' | 'secondary' {
    if (status === 'Completed') return 'success';
    if (status === 'Active') return 'info';
    return 'secondary';
  }

  openDialog(): void {
    if (this.readOnly) return;
    this.editingId = null;
    this.resetForm();
    this.dialogVisible = true;
  }

  editGarnishment(g: EmployeeGarnishment): void {
    if (this.readOnly) return;
    this.editingId = g.id;
    this.formType = g.type;
    this.formReference = g.reference;
    this.formIssuedAt = new Date(g.issuedAt);
    this.formBeneficiaryName = g.beneficiaryName;
    this.formBeneficiaryRib = g.beneficiaryRib ?? '';
    this.formPriority = g.priority;
    this.formKind = g.kind;
    this.formFixedAmount = g.fixedAmount ?? 0;
    this.formPercentOfNet = g.percentOfNet ?? 0;
    this.formTotalAmountDue = g.totalAmountDue ?? null;
    this.formStartDate = new Date(g.startDate);
    this.formEndDate = g.endDate ? new Date(g.endDate) : null;
    this.dialogVisible = true;
  }

  private resetForm(): void {
    this.formType = 'Garnishment';
    this.formReference = '';
    this.formIssuedAt = new Date();
    this.formBeneficiaryName = '';
    this.formBeneficiaryRib = '';
    this.formPriority = 1;
    this.formKind = 'FixedAmount';
    this.formFixedAmount = 0;
    this.formPercentOfNet = 0;
    this.formTotalAmountDue = null;
    this.formStartDate = new Date();
    this.formEndDate = null;
  }

  save(): void {
    if (this.readOnly || !this.formReference.trim() || !this.formBeneficiaryName.trim() || !this.formIssuedAt || !this.formStartDate) return;
    if (this.formKind === 'FixedAmount' && this.formFixedAmount <= 0) return;
    if (this.formKind === 'PercentOfNet' && this.formPercentOfNet <= 0) return;

    const body: UpsertEmployeeGarnishmentRequest = {
      type: this.formType,
      reference: this.formReference.trim(),
      issuedAt: toIsoDate(this.formIssuedAt)!,
      beneficiaryName: this.formBeneficiaryName.trim(),
      beneficiaryRib: this.formBeneficiaryRib.trim() || undefined,
      priority: this.formPriority,
      kind: this.formKind,
      fixedAmount: this.formKind === 'FixedAmount' ? this.formFixedAmount : undefined,
      percentOfNet: this.formKind === 'PercentOfNet' ? this.formPercentOfNet : undefined,
      totalAmountDue: this.formTotalAmountDue ?? undefined,
      startDate: toIsoDate(this.formStartDate)!,
      endDate: toIsoDate(this.formEndDate)
    };

    const req = this.editingId
      ? this.payroll.updateGarnishment(this.employeeId, this.editingId, body)
      : this.payroll.createGarnishment(this.employeeId, body);

    req.subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Saisies', detail: 'Enregistré.' });
        this.dialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Saisies', detail: err.error?.message ?? 'Enregistrement impossible.' })
    });
  }

  confirmCancel(g: EmployeeGarnishment): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: `Annuler la saisie « ${g.reference} » ?`,
      header: 'Confirmation',
      acceptLabel: 'Annuler la saisie',
      rejectLabel: 'Fermer',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.cancel(g.id)
    });
  }

  private cancel(id: string): void {
    this.payroll.deleteGarnishment(this.employeeId, id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Saisies', detail: 'Saisie annulée.' });
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Saisies', detail: err.error?.message ?? 'Annulation impossible.' })
    });
  }
}
