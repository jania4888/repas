/// <reference types="@angular/localize" />
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
      title="Mutuelles et caisses complémentaires" i18n-title="Mutuelles et caisses complémentaires"
      subtitle="Adhésions actives retenues au calcul du cycle de paie."
      icon="pi-heart">
      @if (!readOnly) {
        <div class="payroll-toolbar mb-3">
          <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()" i18n="@@payroll.employees.nouvelle.adhesion.8dbabad1">Nouvelle adhésion</app-button>
        </div>
      }

      <p-table [value]="items()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@payroll.employees.caisse.ce5a5c98">Caisse</th>
            <th i18n="@@payroll.employees.debut.f0955314">Début</th>
            <th i18n="@@payroll.employees.fin.4251065f">Fin</th>
            <th class="text-right" i18n="@@payroll.employees.part.salarie.93060d7c">Part salarié</th>
            <th class="text-right" i18n="@@payroll.employees.part.employeur.af021705">Part employeur</th>
            @if (!readOnly) { <th></th> }
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-e>
          <tr>
            <td>{{ e.schemeName || e.schemeCode || '—' }}</td>
            <td>{{ e.startDate | date:'dd/MM/yyyy' }}</td>
            <td>{{ e.endDate ? (e.endDate | date:'dd/MM/yyyy') : '—' }}</td>
            <td class="text-right">{{ e.overrideEmployeeAmount != null ? (e.overrideEmployeeAmount | payrollAmount) : loc_ui_tern_bareme_35a41e }}</td>
            <td class="text-right">{{ e.overrideEmployerAmount != null ? (e.overrideEmployerAmount | payrollAmount) : loc_ui_tern_bareme_35a41e }}</td>
            @if (!readOnly) {
              <td class="actions">
                <button type="button" class="p-button p-button-text p-button-sm" (click)="editEnrollment(e)" i18n="@@payroll.employees.modifier.f260e757">Modifier</button>
                <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(e)" i18n="@@payroll.employees.supprimer.1acfc1c7">Supprimer</button>
              </td>
            }
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td [attr.colspan]="readOnly ? 5 : 6" i18n="@@payroll.employees.aucune.adhesion.enregistree.04899747">Aucune adhésion enregistrée.</td></tr>
        </ng-template>
      </p-table>
    </app-payroll-section>

    <p-dialog [header]="dialogHeader" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '480px' }">
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.caisse.mutuelle.9db228d3">Caisse / mutuelle</label>
        <p-select [options]="schemes()" optionLabel="name" optionValue="id" [(ngModel)]="formSchemeId" appendTo="body" styleClass="w-full" [disabled]="!!editingId" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.date.de.debut.706438ab">Date de début</label>
          <p-datepicker [(ngModel)]="formStartDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" [disabled]="!!editingId" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.date.de.fin.716a6d8d">Date de fin</label>
          <p-datepicker [(ngModel)]="formEndDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.part.salarie.override.957c1463">Part salarié (override)</label>
          <p-inputNumber [(ngModel)]="formEmployeeOverride" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" placeholder="Barème caisse" i18n-placeholder="Barème caisse" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.part.employeur.override.0fe0dbc4">Part employeur (override)</label>
          <p-inputNumber [(ngModel)]="formEmployerOverride" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" placeholder="Barème caisse" i18n-placeholder="Barème caisse" />
        </div>
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="dialogVisible = false" i18n="@@payroll.employees.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" (click)="save()" i18n="@@payroll.employees.enregistrer.f7c8bcd8">Enregistrer</app-button>
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
  readonly loc_ui_tern_bareme_35a41e = $localize`:@@ui.tern.bareme.35a41e:Barème`;
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
    return this.editingId ? $localize`:@@ui.tern.modifier.l.adhesion.1216d6:Modifier l'adhésion` : $localize`:@@ui.tern.nouvelle.adhesion.8dbaba:Nouvelle adhésion`;
  }

  ngOnInit(): void {
    this.loadSchemes();
    this.reload();
  }

  reload(): void {
    this.payroll.listSocialFundEnrollments(this.employeeId).subscribe({
      next: res => this.items.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@employee-social-funds-tab.component.summary.Mutuelles:Mutuelles`, detail: $localize`:@@employee-social-funds-tab.component.detail.Chargement_impos:Chargement impossible.` })
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
        this.toast.add({ severity: 'success', summary: $localize`:@@employee-social-funds-tab.component.summary.Mutuelles:Mutuelles`, detail: $localize`:@@employee-social-funds-tab.component.detail.Adh_sion_enregis:Adhésion enregistrée.` });
        this.dialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@employee-social-funds-tab.component.summary.Mutuelles:Mutuelles`, detail: err.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.` })
    });
  }

  confirmDelete(e: EmployeeSocialFundEnrollment): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: `Supprimer l'adhésion à « ${e.schemeName ?? e.schemeCode} » ?`,
      header: 'Confirmation',
      acceptLabel: $localize`:@@employee-social-funds-tab.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@employee-social-funds-tab.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(e.id)
    });
  }

  private delete(id: string): void {
    this.payroll.deleteSocialFundEnrollment(this.employeeId, id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@employee-social-funds-tab.component.summary.Mutuelles:Mutuelles`, detail: $localize`:@@employee-social-funds-tab.component.detail.Adh_sion_supprim:Adhésion supprimée.` });
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@employee-social-funds-tab.component.summary.Mutuelles:Mutuelles`, detail: err.error?.message ?? $localize`:@@ui.tern.suppression.impossible.0dffe4:Suppression impossible.` })
    });
  }
}
