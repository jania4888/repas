import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PayrollService,
  EmployeeSocialFundEnrollment,
  SocialFundScheme,
  UpsertSocialFundEnrollmentRequest
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

@Component({
  selector: 'app-employee-social-funds-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    DialogModule,
    SelectModule,
    DatePickerModule,
    InputNumberModule,
    ButtonComponent,
    PayrollSectionComponent,
    PayrollAmountPipe
  ],
  template: `
    <app-payroll-section
      title="Mutuelles et caisses complémentaires"
      subtitle="Adhésions actives retenues au calcul du cycle de paie."
      icon="pi-heart">
      @if (!readOnly) {
        <div class="payroll-toolbar mb-3">
          <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()">Nouvelle adhésion</app-button>
        </div>
      }

      <p-table [value]="items()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th>Caisse</th>
            <th>Début</th>
            <th>Fin</th>
            <th class="text-right">Part salarié</th>
            <th class="text-right">Part employeur</th>
            @if (!readOnly) { <th></th> }
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-e>
          <tr>
            <td>{{ e.schemeName || e.schemeCode || '—' }}</td>
            <td>{{ e.startDate | date:'dd/MM/yyyy' }}</td>
            <td>{{ e.endDate ? (e.endDate | date:'dd/MM/yyyy') : '—' }}</td>
            <td class="text-right">{{ e.overrideEmployeeAmount != null ? (e.overrideEmployeeAmount | payrollAmount) : 'Barème' }}</td>
            <td class="text-right">{{ e.overrideEmployerAmount != null ? (e.overrideEmployerAmount | payrollAmount) : 'Barème' }}</td>
            @if (!readOnly) {
              <td class="actions">
                <button type="button" class="p-button p-button-text p-button-sm" (click)="editEnrollment(e)">Modifier</button>
                <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(e)">Supprimer</button>
              </td>
            }
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td [attr.colspan]="readOnly ? 5 : 6">Aucune adhésion enregistrée.</td></tr>
        </ng-template>
      </p-table>
    </app-payroll-section>

    <p-dialog [header]="dialogHeader" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '480px' }">
      <div class="payroll-form-group mb-2">
        <label>Caisse / mutuelle</label>
        <p-select [options]="schemes()" optionLabel="name" optionValue="id" [(ngModel)]="formSchemeId" appendTo="body" styleClass="w-full" [disabled]="!!editingId" />
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
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label>Part salarié (override)</label>
          <p-inputNumber [(ngModel)]="formEmployeeOverride" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" placeholder="Barème caisse" />
        </div>
        <div class="payroll-form-group">
          <label>Part employeur (override)</label>
          <p-inputNumber [(ngModel)]="formEmployerOverride" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" placeholder="Barème caisse" />
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
export class EmployeeSocialFundsTabComponent implements OnInit {
  @Input({ required: true }) employeeId!: string;
  @Input() readOnly = false;

  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  items = signal<EmployeeSocialFundEnrollment[]>([]);
  schemes = signal<SocialFundScheme[]>([]);
  dialogVisible = false;
  editingId: string | null = null;
  formSchemeId: string | null = null;
  formStartDate: Date | null = new Date();
  formEndDate: Date | null = null;
  formEmployeeOverride: number | null = null;
  formEmployerOverride: number | null = null;

  get dialogHeader(): string {
    return this.editingId ? "Modifier l'adhésion" : 'Nouvelle adhésion';
  }

  ngOnInit(): void {
    this.loadSchemes();
    this.reload();
  }

  reload(): void {
    this.payroll.listSocialFundEnrollments(this.employeeId).subscribe({
      next: res => this.items.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: 'Mutuelles', detail: 'Chargement impossible.' })
    });
  }

  private loadSchemes(): void {
    this.payroll.listSocialFunds().subscribe({
      next: res => this.schemes.set((res.data ?? []).filter(s => s.isActive)),
      error: () => {}
    });
  }

  openDialog(): void {
    if (this.readOnly) return;
    this.editingId = null;
    this.formSchemeId = null;
    this.formStartDate = new Date();
    this.formEndDate = null;
    this.formEmployeeOverride = null;
    this.formEmployerOverride = null;
    this.dialogVisible = true;
  }

  editEnrollment(e: EmployeeSocialFundEnrollment): void {
    if (this.readOnly) return;
    this.editingId = e.id;
    this.formSchemeId = e.socialFundSchemeId;
    this.formStartDate = new Date(e.startDate);
    this.formEndDate = e.endDate ? new Date(e.endDate) : null;
    this.formEmployeeOverride = e.overrideEmployeeAmount ?? null;
    this.formEmployerOverride = e.overrideEmployerAmount ?? null;
    this.dialogVisible = true;
  }

  save(): void {
    if (this.readOnly || !this.formSchemeId) return;
    if (!this.editingId && !this.formStartDate) return;

    const body: UpsertSocialFundEnrollmentRequest = {
      socialFundSchemeId: this.formSchemeId,
      startDate: this.editingId ? toIsoDate(this.formStartDate)! : toIsoDate(this.formStartDate)!,
      endDate: toIsoDate(this.formEndDate),
      overrideEmployeeAmount: this.formEmployeeOverride ?? undefined,
      overrideEmployerAmount: this.formEmployerOverride ?? undefined
    };

    const req = this.editingId
      ? this.payroll.updateSocialFundEnrollment(this.employeeId, this.editingId, body)
      : this.payroll.createSocialFundEnrollment(this.employeeId, body);

    req.subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Mutuelles', detail: 'Adhésion enregistrée.' });
        this.dialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Mutuelles', detail: err.error?.message ?? 'Enregistrement impossible.' })
    });
  }

  confirmDelete(e: EmployeeSocialFundEnrollment): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: `Supprimer l'adhésion à « ${e.schemeName ?? e.schemeCode} » ?`,
      header: 'Confirmation',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(e.id)
    });
  }

  private delete(id: string): void {
    this.payroll.deleteSocialFundEnrollment(this.employeeId, id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Mutuelles', detail: 'Adhésion supprimée.' });
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Mutuelles', detail: err.error?.message ?? 'Suppression impossible.' })
    });
  }
}
