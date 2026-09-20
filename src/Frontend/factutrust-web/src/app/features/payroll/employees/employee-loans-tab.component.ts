import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PayrollService,
  EmployeeLoan,
  EmployeeLoanInstallment,
  CreateEmployeeLoanRequest
} from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PayrollSectionComponent, PayrollAmountPipe } from '../shared';

const MONTH_OPTIONS = [
  { label: 'Janvier', value: 1 }, { label: 'Février', value: 2 }, { label: 'Mars', value: 3 },
  { label: 'Avril', value: 4 }, { label: 'Mai', value: 5 }, { label: 'Juin', value: 6 },
  { label: 'Juillet', value: 7 }, { label: 'Août', value: 8 }, { label: 'Septembre', value: 9 },
  { label: 'Octobre', value: 10 }, { label: 'Novembre', value: 11 }, { label: 'Décembre', value: 12 }
];

@Component({
  selector: 'app-employee-loans-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    TagModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    Textarea,
    SelectModule,
    ButtonComponent,
    PayrollSectionComponent,
    PayrollAmountPipe
  ],
  template: `
    <app-payroll-section
      title="Prêts salariés"
      subtitle="Remboursement mensuel sans intérêt, retenu au calcul et soldé à la validation."
      icon="pi-credit-card">
      @if (!readOnly) {
        <div class="payroll-toolbar mb-3">
          <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openCreateDialog()">Nouveau prêt</app-button>
        </div>
      }

      <p-table [value]="items()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th>Référence</th>
            <th class="text-right">Capital</th>
            <th class="text-right">Échéance</th>
            <th class="text-right">Reste dû</th>
            <th>Début</th>
            <th>Statut</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-loan>
          <tr>
            <td>{{ loan.reference }}</td>
            <td class="text-right">{{ loan.principal | payrollAmount }}</td>
            <td class="text-right">{{ loan.monthlyInstallmentAmount | payrollAmount }}</td>
            <td class="text-right">{{ (loan.remainingBalance ?? 0) | payrollAmount }}</td>
            <td>{{ loan.startMonth }}/{{ loan.startYear }}</td>
            <td>
              <p-tag [value]="loan.statusDisplay || loan.status" [severity]="loanStatusSeverity(loan.status)" />
            </td>
            <td class="actions">
              <button type="button" class="p-button p-button-text p-button-sm" (click)="showSchedule(loan)">Échéancier</button>
              @if (!readOnly && loan.status === 'Active') {
                <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmCancel(loan)">Annuler</button>
              }
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="7">Aucun prêt enregistré.</td></tr>
        </ng-template>
      </p-table>
    </app-payroll-section>

    <p-dialog header="Nouveau prêt salarié" [(visible)]="createDialogVisible" [modal]="true" [style]="{ width: '480px' }">
      <div class="payroll-form-group mb-2">
        <label>Référence</label>
        <input pInputText [(ngModel)]="formReference" class="w-full" maxlength="50" />
      </div>
      <div class="payroll-form-group mb-2">
        <label>Montant (TND)</label>
        <p-inputNumber [(ngModel)]="formPrincipal" [min]="0.001" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
      </div>
      <div class="payroll-form-group mb-2">
        <label>Nombre d'échéances</label>
        <p-inputNumber [(ngModel)]="formInstallmentCount" [min]="1" [max]="120" styleClass="w-full" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label>Mois de début</label>
          <p-select [options]="monthOptions" optionLabel="label" optionValue="value" [(ngModel)]="formStartMonth" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label>Année de début</label>
          <p-inputNumber [(ngModel)]="formStartYear" [useGrouping]="false" [min]="2000" [max]="2100" styleClass="w-full" />
        </div>
      </div>
      <div class="payroll-form-group mb-2">
        <label>Notes</label>
        <textarea pTextarea [(ngModel)]="formNotes" rows="2" class="w-full"></textarea>
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="createDialogVisible = false">Annuler</app-button>
        <app-button variant="primary" (click)="create()">Enregistrer</app-button>
      </ng-template>
    </p-dialog>

    <p-dialog header="Échéancier du prêt" [(visible)]="scheduleDialogVisible" [modal]="true" [style]="{ width: '560px' }">
      @if (selectedLoan()) {
        <p class="mb-3"><strong>{{ selectedLoan()!.reference }}</strong> — {{ selectedLoan()!.installmentCount }} échéances</p>
        <p-table [value]="scheduleLines()" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>#</th>
              <th>Période</th>
              <th class="text-right">Montant</th>
              <th>Statut</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-line>
            <tr>
              <td>{{ line.sequenceNumber }}</td>
              <td>{{ line.month }}/{{ line.year }}</td>
              <td class="text-right">{{ line.amount | payrollAmount }}</td>
              <td>{{ line.isSettled ? 'Soldée' : 'À venir' }}</td>
            </tr>
          </ng-template>
        </p-table>
      }
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="scheduleDialogVisible = false">Fermer</app-button>
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
export class EmployeeLoansTabComponent implements OnInit {
  @Input({ required: true }) employeeId!: string;
  @Input() readOnly = false;

  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  readonly monthOptions = MONTH_OPTIONS;
  items = signal<EmployeeLoan[]>([]);
  selectedLoan = signal<EmployeeLoan | null>(null);
  scheduleLines = signal<EmployeeLoanInstallment[]>([]);
  createDialogVisible = false;
  scheduleDialogVisible = false;
  formReference = '';
  formPrincipal = 0;
  formInstallmentCount = 12;
  formStartMonth = new Date().getMonth() + 1;
  formStartYear = new Date().getFullYear();
  formNotes = '';

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.payroll.listEmployeeLoans(this.employeeId).subscribe({
      next: res => this.items.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: 'Prêts', detail: 'Chargement impossible.' })
    });
  }

  loanStatusSeverity(status: string): 'success' | 'info' | 'secondary' | 'warning' {
    if (status === 'FullyRepaid') return 'success';
    if (status === 'Active') return 'info';
    if (status === 'Cancelled') return 'secondary';
    return 'warning';
  }

  openCreateDialog(): void {
    if (this.readOnly) return;
    this.formReference = '';
    this.formPrincipal = 0;
    this.formInstallmentCount = 12;
    this.formStartMonth = new Date().getMonth() + 1;
    this.formStartYear = new Date().getFullYear();
    this.formNotes = '';
    this.createDialogVisible = true;
  }

  create(): void {
    if (this.readOnly || !this.formReference.trim() || this.formPrincipal <= 0 || this.formInstallmentCount <= 0) return;

    const body: CreateEmployeeLoanRequest = {
      reference: this.formReference.trim(),
      principal: this.formPrincipal,
      installmentCount: this.formInstallmentCount,
      startYear: this.formStartYear,
      startMonth: this.formStartMonth,
      notes: this.formNotes.trim() || undefined
    };

    this.payroll.createEmployeeLoan(this.employeeId, body).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Prêts', detail: 'Prêt enregistré.' });
        this.createDialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Prêts', detail: err.error?.message ?? 'Création impossible.' })
    });
  }

  showSchedule(loan: EmployeeLoan): void {
    if (loan.installments?.length) {
      this.selectedLoan.set(loan);
      this.scheduleLines.set(loan.installments);
      this.scheduleDialogVisible = true;
      return;
    }
    this.payroll.getLoan(loan.id).subscribe({
      next: res => {
        this.selectedLoan.set(res.data ?? null);
        this.scheduleLines.set(res.data?.installments ?? []);
        this.scheduleDialogVisible = true;
      },
      error: () => this.toast.add({ severity: 'error', summary: 'Prêts', detail: 'Échéancier introuvable.' })
    });
  }

  confirmCancel(loan: EmployeeLoan): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: `Annuler le prêt « ${loan.reference} » ?`,
      header: 'Confirmation',
      acceptLabel: 'Annuler le prêt',
      rejectLabel: 'Fermer',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.cancel(loan.id)
    });
  }

  private cancel(loanId: string): void {
    this.payroll.cancelLoan(loanId).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Prêts', detail: 'Prêt annulé.' });
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: 'Prêts',
        detail: err.error?.message ?? 'Annulation impossible (échéances peut-être déjà retenues).'
      })
    });
  }
}
