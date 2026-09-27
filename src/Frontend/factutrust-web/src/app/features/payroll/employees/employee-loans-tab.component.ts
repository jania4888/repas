/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
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
  { label: $localize`:@@payroll.employee-loans-tab.ts.janvier.7a32ae0f:Janvier`, value: 1 }, { label: $localize`:@@payroll.employee-loans-tab.ts.fevrier.63fc1803:Février`, value: 2 }, { label: $localize`:@@payroll.employee-loans-tab.ts.mars.1778011d:Mars`, value: 3 },
  { label: $localize`:@@payroll.employee-loans-tab.ts.avril.4efeee46:Avril`, value: 4 }, { label: $localize`:@@payroll.employee-loans-tab.ts.mai.afe526a6:Mai`, value: 5 }, { label: $localize`:@@payroll.employee-loans-tab.ts.juin.8b1e84b6:Juin`, value: 6 },
  { label: $localize`:@@payroll.employee-loans-tab.ts.juillet.e8e0920c:Juillet`, value: 7 }, { label: $localize`:@@payroll.employee-loans-tab.ts.aout.460b6696:Août`, value: 8 }, { label: $localize`:@@payroll.employee-loans-tab.ts.septembre.08d23f31:Septembre`, value: 9 },
  { label: $localize`:@@payroll.employee-loans-tab.ts.octobre.0ed28485:Octobre`, value: 10 }, { label: $localize`:@@payroll.employee-loans-tab.ts.novembre.632580af:Novembre`, value: 11 }, { label: $localize`:@@payroll.employee-loans-tab.ts.decembre.03bcd9b0:Décembre`, value: 12 }
];

@Component({
  selector: 'app-employee-loans-tab',
  standalone: true,
  imports: [BackendLabelPipe, 
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
      title="Prêts salariés" i18n-title="@@payroll.employees.prets.salaries.6e48cdbc"
      subtitle="Remboursement mensuel sans intérêt, retenu au calcul et soldé à la validation." i18n-subtitle="@@payroll.employees.remboursement.mensuel.sans.interet.reten.b2cb8d7e"
      icon="pi-credit-card">
      @if (!readOnly) {
        <div class="payroll-toolbar mb-3">
          <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openCreateDialog()" i18n="@@payroll.employees.nouveau.pret.349e5648">Nouveau prêt</app-button>
        </div>
      }

      <p-table [value]="items()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@payroll.employees.reference.f8130bb0">Référence</th>
            <th class="text-right" i18n="@@payroll.employees.capital.2bd8d265">Capital</th>
            <th class="text-right" i18n="@@payroll.employees.echeance.f9a77ff6">Échéance</th>
            <th class="text-right" i18n="@@payroll.employees.reste.du.cca882d3">Reste dû</th>
            <th i18n="@@payroll.employees.debut.f0955314">Début</th>
            <th i18n="@@payroll.employees.statut.659499f3">Statut</th>
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
              <p-tag [value]="(loan.statusDisplay | backendLabel) || loan.status" [severity]="loanStatusSeverity(loan.status)" />
            </td>
            <td class="actions">
              <button type="button" class="p-button p-button-text p-button-sm" (click)="showSchedule(loan)" i18n="@@payroll.employees.echeancier.7930f4ee">Échéancier</button>
              @if (!readOnly && loan.status === 'Active') {
                <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmCancel(loan)" i18n="@@payroll.employees.annuler.49ba3292">Annuler</button>
              }
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="7" i18n="@@payroll.employees.aucun.pret.enregistre.de37b23a">Aucun prêt enregistré.</td></tr>
        </ng-template>
      </p-table>
    </app-payroll-section>

    <p-dialog header="Nouveau prêt salarié" i18n-header="@@payroll.employees.nouveau.pret.salarie.2e5e83f2" [(visible)]="createDialogVisible" [modal]="true" [style]="{ width: '480px' }">
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.reference.f8130bb0">Référence</label>
        <input pInputText [(ngModel)]="formReference" class="w-full" maxlength="50" />
      </div>
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.montant.tnd.e877352d">Montant (TND)</label>
        <p-inputNumber [(ngModel)]="formPrincipal" [min]="0.001" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
      </div>
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.nombre.d.echeances.a343d39c">Nombre d'échéances</label>
        <p-inputNumber [(ngModel)]="formInstallmentCount" [min]="1" [max]="120" styleClass="w-full" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.mois.de.debut.282e76ac">Mois de début</label>
          <p-select [options]="monthOptions" optionLabel="label" optionValue="value" [(ngModel)]="formStartMonth" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.annee.de.debut.14d1b202">Année de début</label>
          <p-inputNumber [(ngModel)]="formStartYear" [useGrouping]="false" [min]="2000" [max]="2100" styleClass="w-full" />
        </div>
      </div>
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.notes.70440046">Notes</label>
        <textarea pTextarea [(ngModel)]="formNotes" rows="2" class="w-full"></textarea>
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="createDialogVisible = false" i18n="@@payroll.employees.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" (click)="create()" i18n="@@payroll.employees.enregistrer.f7c8bcd8">Enregistrer</app-button>
      </ng-template>
    </p-dialog>

    <p-dialog header="Échéancier du prêt" i18n-header="@@payroll.employees.echeancier.du.pret.13ba504e" [(visible)]="scheduleDialogVisible" [modal]="true" [style]="{ width: '560px' }">
      @if (selectedLoan()) {
        <p class="mb-3" i18n="@@payroll.employees.echeances.ceaf8940"><strong>{{ selectedLoan()!.reference }}</strong> — {{ selectedLoan()!.installmentCount }} échéances</p>
        <p-table [value]="scheduleLines()" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@payroll.employees.text.d08f88df">#</th>
              <th i18n="@@payroll.employees.periode.de2110b7">Période</th>
              <th class="text-right" i18n="@@payroll.employees.montant.4adcd9fc">Montant</th>
              <th i18n="@@payroll.employees.statut.659499f3">Statut</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-line>
            <tr>
              <td>{{ line.sequenceNumber }}</td>
              <td>{{ line.month }}/{{ line.year }}</td>
              <td class="text-right">{{ line.amount | payrollAmount }}</td>
              <td>{{ line.isSettled ? loc_ui_tern_soldee_7fecce : loc_ui_tern_a_venir_5ae4e5 }}</td>
            </tr>
          </ng-template>
        </p-table>
      }
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="scheduleDialogVisible = false" i18n="@@payroll.employees.fermer.5ab4ec64">Fermer</app-button>
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
  readonly loc_ui_tern_soldee_7fecce = $localize`:@@ui.tern.soldee.7fecce:Soldée`;
  readonly loc_ui_tern_a_venir_5ae4e5 = $localize`:@@ui.tern.a.venir.5ae4e5:À venir`;
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
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@employee-loans-tab.component.summary.Prêts:Prêts`, detail: $localize`:@@employee-loans-tab.component.detail.Chargement_impos:Chargement impossible.` })
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
        this.toast.add({ severity: 'success', summary: $localize`:@@employee-loans-tab.component.summary.Prêts:Prêts`, detail: $localize`:@@employee-loans-tab.component.detail.Pr_t_enregistr_:Prêt enregistré.` });
        this.createDialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@employee-loans-tab.component.summary.Prêts:Prêts`, detail: err.error?.message ?? $localize`:@@ui.tern.creation.impossible.5661a5:Création impossible.` })
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
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@employee-loans-tab.component.summary.Prêts:Prêts`, detail: $localize`:@@employee-loans-tab.component.detail._ch_ancier_intro:Échéancier introuvable.` })
    });
  }

  confirmCancel(loan: EmployeeLoan): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: $localize`:@@payroll.employee-loans-tab.ts.annuler.le.pret.reference.04f467ce:Annuler le prêt « ${loan.reference}:reference: » ?`,
      header: $localize`:@@payroll.employee-loans-tab.ts.confirmation.3424edc2:Confirmation`,
      acceptLabel: $localize`:@@employee-loans-tab.component.acceptLabel.Annuler_le_pr_t:Annuler le prêt`,
      rejectLabel: $localize`:@@employee-loans-tab.component.rejectLabel.Fermer:Fermer`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.cancel(loan.id)
    });
  }

  private cancel(loanId: string): void {
    this.payroll.cancelLoan(loanId).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@employee-loans-tab.component.summary.Prêts:Prêts`, detail: $localize`:@@employee-loans-tab.component.detail.Pr_t_annul_:Prêt annulé.` });
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@employee-loans-tab.component.summary.Prêts:Prêts`,
        detail: err.error?.message ?? $localize`:@@ui.tern.annulation.impossible.echeances.peut.etre..5d91e7:Annulation impossible (échéances peut-être déjà retenues).`
      })
    });
  }
}
