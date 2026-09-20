import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmployeeService } from '@core/services/employee.service';
import { PayrollService, LeaveRequest, LeaveBalance } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { LEAVE_TYPE_OPTIONS } from '../payroll-options';
import { PayrollStatGridComponent, type PayrollStatItem } from '../shared';

function toIsoDate(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Component({
  selector: 'app-employee-leaves-tab',
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
    Textarea,
    ButtonComponent,
    PayrollStatGridComponent,
    TooltipModule,
    CheckboxModule
  ],
  template: `
    <div class="payroll-toolbar mb-3">
      <label for="balanceYear" class="sr-only">Exercice</label>
      <p-select
        id="balanceYear"
        [options]="yearOptions"
        [(ngModel)]="balanceYear"
        (ngModelChange)="reloadBalance()"
        optionLabel="label"
        optionValue="value"
        placeholder="Exercice"
        styleClass="w-10rem" />
    </div>

    <app-payroll-stat-grid [items]="balanceStats()" [compact]="true" />

    <p class="payroll-info-text">
      Acquisition : 1 jour par 26 jours travaillés, créditée à la validation du cycle de paie.
      Seuls les congés approuvés impactent le calcul de paie. Les absences sans solde et injustifiées réduisent le brut.
      Avec les flags statutaires activés, maladie / maternité / paternité sont calculés automatiquement.
    </p>

    @if (!readOnly) {
      <div class="payroll-toolbar mb-3">
        <app-button variant="outline" icon="pi-heart" (click)="openBirthDialog()">Déclarer une naissance</app-button>
      </div>
    }

    @if (!readOnly) {
      <div class="payroll-toolbar">
        <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()">Ajouter un congé</app-button>
        <app-button variant="outline" (click)="openOpeningDialog()">Solde initial</app-button>
      </div>
    }

    <p-table [value]="items()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th>Type</th>
          <th>Début</th>
          <th>Fin</th>
          <th class="text-right">Jours</th>
          <th>Statut</th>
          @if (!readOnly) { <th></th> }
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-l>
        <tr>
          <td>{{ l.typeDisplay }}</td>
          <td>{{ l.startDate | date:'dd/MM/yyyy' }}</td>
          <td>{{ l.endDate | date:'dd/MM/yyyy' }}</td>
          <td class="text-right">{{ l.days }}</td>
          <td>
            <p-tag [value]="l.isApproved ? 'Approuvé' : 'En attente'" [severity]="l.isApproved ? 'success' : 'warn'" />
          </td>
          @if (!readOnly) {
            <td class="actions">
              @if (!l.isApproved) {
                <button
                  type="button"
                  class="p-button p-button-text p-button-sm"
                  [disabled]="!canApproveLeave(l)"
                  [pTooltip]="approveBlockReason(l)"
                  [tooltipDisabled]="canApproveLeave(l)"
                  tooltipPosition="top"
                  (click)="approve(l)">
                  Approuver
                </button>
              }
              <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(l)">Supprimer</button>
            </td>
          }
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td [attr.colspan]="readOnly ? 5 : 6">Aucun congé enregistré.</td></tr>
      </ng-template>
    </p-table>

    <p-dialog header="Nouveau congé" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '480px' }">
      <div class="payroll-form-group mb-2">
        <label>Type</label>
        <p-select [options]="leaveTypeOptions" [(ngModel)]="formType" optionLabel="label" optionValue="value" appendTo="body" styleClass="w-full" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label>Début</label>
          <p-datepicker [(ngModel)]="formStart" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" (ngModelChange)="computeDays()" />
        </div>
        <div class="payroll-form-group">
          <label>Fin</label>
          <p-datepicker [(ngModel)]="formEnd" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" (ngModelChange)="computeDays()" />
        </div>
      </div>
      <div class="payroll-form-group mb-2">
        <label>Jours</label>
        <p-inputNumber [(ngModel)]="formDays" [min]="0.5" [step]="0.5" styleClass="w-full" />
        @if (computingDays()) {
          <span class="field-hint">Calcul en cours…</span>
        }
        @if (createExceedsBalance()) {
          <span class="field-hint field-hint--warning">
            Solde insuffisant : {{ formDays }} j demandés, {{ balance()?.available ?? 0 }} j disponibles
            @if ((balance()?.pending ?? 0) > 0) {
              ({{ balance()?.pending }} j en attente)
            }.
          </span>
        }
      </div>
      <div class="payroll-form-group mb-2">
        <label>Motif</label>
        <textarea pTextarea [(ngModel)]="formReason" rows="2" class="w-full"></textarea>
      </div>

      @if (formType === 'Sick') {
        <div class="payroll-form-group mb-2">
          <label>N° certificat médical</label>
          <input pInputText [(ngModel)]="formMedicalCertificateNumber" class="w-full" />
        </div>
        <div class="payroll-form-group mb-2">
          <label>Date certificat</label>
          <p-datepicker [(ngModel)]="formMedicalCertificateDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group mb-2 flex align-items-center gap-2">
          <p-checkbox [(ngModel)]="formSubrogationEnabled" [binary]="true" inputId="subrogation" />
          <label for="subrogation">Subrogation (avance IJ CNSS)</label>
        </div>
        <div class="payroll-form-row">
          <div class="payroll-form-group">
            <label>Maintien employeur (%)</label>
            <p-inputNumber [(ngModel)]="formEmployerTopUpPercent" [min]="0" [max]="100" styleClass="w-full" />
          </div>
          <div class="payroll-form-group">
            <label>Jours de maintien</label>
            <p-inputNumber [(ngModel)]="formEmployerTopUpDays" [min]="0" styleClass="w-full" />
          </div>
        </div>
      }

      @if (formType === 'Maternity') {
        <div class="payroll-form-row">
          <div class="payroll-form-group">
            <label>Date prévue accouchement</label>
            <p-datepicker [(ngModel)]="formExpectedBirthDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
          </div>
          <div class="payroll-form-group">
            <label>Date réelle naissance</label>
            <p-datepicker [(ngModel)]="formActualBirthDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
          </div>
        </div>
        <div class="payroll-form-group mb-2">
          <label>N° acte de naissance</label>
          <input pInputText [(ngModel)]="formChildBirthCertificateNumber" class="w-full" />
        </div>
        <div class="payroll-form-group mb-2">
          <label>Maintien employeur (%)</label>
          <p-inputNumber [(ngModel)]="formEmployerTopUpPercent" [min]="0" [max]="100" styleClass="w-full" />
        </div>
      }

      @if (formType === 'Paternity') {
        <div class="payroll-form-group mb-2">
          <label>Date de naissance</label>
          <p-datepicker [(ngModel)]="formActualBirthDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group mb-2">
          <label>N° acte de naissance</label>
          <input pInputText [(ngModel)]="formChildBirthCertificateNumber" class="w-full" />
        </div>
      }

      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="dialogVisible = false">Annuler</app-button>
        <app-button variant="primary" [disabled]="createExceedsBalance()" (click)="create()">Enregistrer</app-button>
      </ng-template>
    </p-dialog>

    <p-dialog header="Solde initial de congés" [(visible)]="openingDialogVisible" [modal]="true" [style]="{ width: '400px' }">
      <p class="payroll-info-text mb-2">Reprise d'historique ou ajustement du solde avant la première validation de paie.</p>
      <div class="payroll-form-group">
        <label>Jours (solde initial)</label>
        <p-inputNumber [(ngModel)]="openingBalanceDays" [min]="0" [minFractionDigits]="1" [maxFractionDigits]="3" styleClass="w-full" />
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="openingDialogVisible = false">Annuler</app-button>
        <app-button variant="primary" (click)="saveOpeningBalance()">Enregistrer</app-button>
      </ng-template>
    </p-dialog>

    <p-dialog header="Déclarer une naissance" [(visible)]="birthDialogVisible" [modal]="true" [style]="{ width: '420px' }">
      <div class="payroll-form-group mb-2">
        <label>Date de naissance</label>
        <p-datepicker [(ngModel)]="birthDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
      </div>
      <div class="payroll-form-group mb-2">
        <label>N° acte de naissance</label>
        <input pInputText [(ngModel)]="birthCertificateNumber" class="w-full" />
      </div>
      <div class="payroll-form-group mb-2 flex align-items-center gap-2">
        <p-checkbox [(ngModel)]="createMaternityLeave" [binary]="true" inputId="matLeave" />
        <label for="matLeave">Créer congé maternité (60 j)</label>
      </div>
      <div class="payroll-form-group mb-2 flex align-items-center gap-2">
        <p-checkbox [(ngModel)]="createPaternityLeave" [binary]="true" inputId="patLeave" />
        <label for="patLeave">Créer congé paternité (2 j)</label>
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="birthDialogVisible = false">Annuler</app-button>
        <app-button variant="primary" (click)="declareBirth()">Enregistrer</app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .mb-2 { margin-bottom: var(--spacing-2); }
    .mb-3 { margin-bottom: var(--spacing-4); }
    .actions { white-space: nowrap; }
    .w-full { width: 100%; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
    .field-hint--warning { color: var(--red-600, #dc2626); }
  `]
})
export class EmployeeLeavesTabComponent implements OnInit {
  @Input({ required: true }) employeeId!: string;
  @Input() readOnly = false;

  private readonly employees = inject(EmployeeService);
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  readonly leaveTypeOptions = LEAVE_TYPE_OPTIONS;
  items = signal<LeaveRequest[]>([]);
  balance = signal<LeaveBalance | null>(null);
  balanceYear = new Date().getFullYear();
  yearOptions = Array.from({ length: 5 }, (_, i) => {
    const y = new Date().getFullYear() - 2 + i;
    return { value: y, label: String(y) };
  });
  dialogVisible = false;
  openingDialogVisible = false;
  openingBalanceDays = 0;
  formType = 'Paid';
  formStart: Date | null = null;
  formEnd: Date | null = null;
  formDays = 1;
  formReason = '';
  formMedicalCertificateNumber = '';
  formMedicalCertificateDate: Date | null = null;
  formSubrogationEnabled = false;
  formEmployerTopUpPercent: number | null = null;
  formEmployerTopUpDays: number | null = null;
  formExpectedBirthDate: Date | null = null;
  formActualBirthDate: Date | null = null;
  formChildBirthCertificateNumber = '';
  birthDialogVisible = false;
  birthDate: Date | null = new Date();
  birthCertificateNumber = '';
  createMaternityLeave = true;
  createPaternityLeave = true;
  computingDays = signal(false);

  balanceStats = computed((): PayrollStatItem[] => {
    const b = this.balance();
    const pending = b?.pending ?? 0;
    const available = b?.available ?? 0;
    return [
      { label: 'Acquis', value: b ? `${b.totalAcquired} j` : '—', icon: 'pi-calendar-plus', variant: 'primary' },
      { label: 'Consommés', value: b ? `${b.consumed} j` : '—', icon: 'pi-calendar-minus', variant: 'warning' },
      {
        label: 'En attente',
        value: b ? `${pending} j` : '—',
        icon: 'pi-clock',
        variant: pending > 0 ? 'warning' : 'primary'
      },
      {
        label: 'Disponibles',
        value: b ? `${available} j` : '—',
        icon: 'pi-calendar',
        variant: available <= 0 ? 'error' : 'success',
        featured: true
      }
    ];
  });

  createExceedsBalance(): boolean {
    if (this.formType !== 'Paid') return false;
    const available = this.balance()?.available;
    if (available == null) return false;
    return this.formDays > available;
  }

  canApproveLeave(leave: LeaveRequest): boolean {
    if (leave.isApproved || leave.type !== 'Paid') return true;
    const balance = this.balance();
    if (!balance) return false;

    const leaveYear = new Date(leave.startDate).getFullYear();
    if (leaveYear !== this.balanceYear) return false;

    return leave.days <= balance.available + leave.days;
  }

  approveBlockReason(leave: LeaveRequest): string {
    if (this.canApproveLeave(leave)) return '';

    const leaveYear = new Date(leave.startDate).getFullYear();
    if (leaveYear !== this.balanceYear) {
      return `Solde affiché pour l'exercice ${this.balanceYear}.`;
    }

    const balance = this.balance();
    if (!balance) return 'Solde indisponible.';

    const availableForLeave = balance.available + leave.days;
    return `Solde insuffisant : ${leave.days} j demandés, ${availableForLeave} j disponibles (${balance.pending} j en attente).`;
  }

  ngOnInit(): void {
    this.reload();
    this.reloadBalance();
  }

  reload(): void {
    this.employees.listLeaves(this.employeeId).subscribe({
      next: res => this.items.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: 'Congés', detail: 'Chargement impossible.' })
    });
  }

  reloadBalance(): void {
    this.employees.getLeaveBalance(this.employeeId, this.balanceYear).subscribe({
      next: res => this.balance.set(res.data ?? null),
      error: () => this.balance.set(null)
    });
  }

  openDialog(): void {
    if (this.readOnly) return;
    this.formType = 'Paid';
    this.formStart = new Date();
    this.formEnd = new Date();
    this.formDays = 1;
    this.resetStatutoryFields();
    this.dialogVisible = true;
    this.computeDays();
  }

  openOpeningDialog(): void {
    if (this.readOnly) return;
    this.openingBalanceDays = this.balance()?.openingBalance ?? 0;
    this.openingDialogVisible = true;
  }

  computeDays(): void {
    if (!this.formStart || !this.formEnd) return;
    const start = toIsoDate(this.formStart);
    const end = toIsoDate(this.formEnd);
    if (!start || !end) return;
    this.computingDays.set(true);
    this.payroll.computeLeaveDays(start, end).subscribe({
      next: res => {
        if (res.data != null && res.data > 0) this.formDays = res.data;
        this.computingDays.set(false);
      },
      error: () => this.computingDays.set(false)
    });
  }

  saveOpeningBalance(): void {
    if (this.readOnly) return;
    this.employees.setLeaveOpeningBalance(this.employeeId, this.openingBalanceDays).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Congés', detail: 'Solde initial enregistré.' });
        this.openingDialogVisible = false;
        this.reloadBalance();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: 'Congés',
        detail: err?.error?.message ?? 'Enregistrement impossible.'
      })
    });
  }

  create(): void {
    if (this.readOnly || !this.formStart || !this.formEnd) return;
    if (this.createExceedsBalance()) {
      this.toast.add({
        severity: 'error',
        summary: 'Congés',
        detail: `Solde insuffisant : ${this.formDays} j demandés, ${this.balance()?.available ?? 0} j disponibles.`
      });
      return;
    }
    this.payroll.createLeave({
      employeeId: this.employeeId,
      type: this.formType,
      startDate: toIsoDate(this.formStart)!,
      endDate: toIsoDate(this.formEnd)!,
      days: this.formDays,
      reason: this.formReason || undefined,
      medicalCertificateNumber: this.formMedicalCertificateNumber || undefined,
      medicalCertificateDate: toIsoDate(this.formMedicalCertificateDate),
      subrogationEnabled: this.formSubrogationEnabled,
      employerTopUpPercent: this.formEmployerTopUpPercent ?? undefined,
      employerTopUpDays: this.formEmployerTopUpDays ?? undefined,
      expectedBirthDate: toIsoDate(this.formExpectedBirthDate),
      actualBirthDate: toIsoDate(this.formActualBirthDate),
      childBirthCertificateNumber: this.formChildBirthCertificateNumber || undefined
    }).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Congés', detail: 'Congé enregistré.' });
        this.dialogVisible = false;
        this.reload();
        this.reloadBalance();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Congés', detail: err.error?.message ?? 'Création impossible.' })
    });
  }

  approve(leave: LeaveRequest): void {
    if (this.readOnly || !this.canApproveLeave(leave)) return;
    this.payroll.approveLeave(leave.id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Congés', detail: 'Congé approuvé.' });
        this.reload();
        this.reloadBalance();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Congés', detail: err.error?.message ?? 'Approbation impossible.' })
    });
  }

  confirmDelete(leave: LeaveRequest): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: `Supprimer le congé du ${leave.startDate} ?`,
      header: 'Confirmation',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(leave.id)
    });
  }

  private delete(id: string): void {
    this.payroll.deleteLeave(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Congés', detail: 'Congé supprimé.' });
        this.reload();
        this.reloadBalance();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Congés', detail: err.error?.message ?? 'Suppression impossible.' })
    });
  }

  openBirthDialog(): void {
    if (this.readOnly) return;
    this.birthDate = new Date();
    this.birthCertificateNumber = '';
    this.createMaternityLeave = true;
    this.createPaternityLeave = true;
    this.birthDialogVisible = true;
  }

  declareBirth(): void {
    if (this.readOnly || !this.birthDate) return;
    const actualBirthDate = toIsoDate(this.birthDate);
    if (!actualBirthDate) return;

    this.payroll.declareBirth({
      employeeId: this.employeeId,
      actualBirthDate,
      childBirthCertificateNumber: this.birthCertificateNumber || undefined,
      createMaternityLeave: this.createMaternityLeave,
      createPaternityLeave: this.createPaternityLeave
    }).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Congés', detail: 'Naissance déclarée.' });
        this.birthDialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: 'Congés',
        detail: err?.error?.message ?? 'Déclaration impossible.'
      })
    });
  }

  private resetStatutoryFields(): void {
    this.formReason = '';
    this.formMedicalCertificateNumber = '';
    this.formMedicalCertificateDate = null;
    this.formSubrogationEnabled = false;
    this.formEmployerTopUpPercent = null;
    this.formEmployerTopUpDays = null;
    this.formExpectedBirthDate = null;
    this.formActualBirthDate = null;
    this.formChildBirthCertificateNumber = '';
  }
}
