/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
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
  imports: [BackendLabelPipe, 
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
    <p class="payroll-info-text" i18n="@@payroll.employees.les.suspensions.approuvees.reduisent.le.brut.du..a4d1ac0a"> Les suspensions approuvées réduisent le brut du mois (prorata) lorsque l'option est activée sur l'exercice.
      Une suspension rémunérée n'entraîne pas de retenue. </p>

    @if (!readOnly) {
      <div class="payroll-toolbar mb-3">
        <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()" i18n="@@payroll.employees.ajouter.une.suspension.e7da62de">Ajouter une suspension</app-button>
      </div>
    }

    <p-table [value]="items()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th i18n="@@payroll.employees.type.3deb7456">Type</th>
          <th i18n="@@payroll.employees.debut.f0955314">Début</th>
          <th i18n="@@payroll.employees.fin.4251065f">Fin</th>
          <th i18n="@@payroll.employees.remuneree.e95340ce">Rémunérée</th>
          <th i18n="@@payroll.employees.statut.659499f3">Statut</th>
          @if (!readOnly) { <th></th> }
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-s>
        <tr>
          <td>{{ s.typeDisplay | backendLabel }}</td>
          <td>{{ s.startDate | date:'dd/MM/yyyy' }}</td>
          <td>{{ s.endDate ? (s.endDate | date:'dd/MM/yyyy') : '—' }}</td>
          <td>{{ s.isPaid ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
          <td>
            <p-tag [value]="s.isApproved ? loc_ui_tern_approuvee_7d606a : loc_ui_tern_en_attente_523115" [severity]="s.isApproved ? 'success' : 'warn'" />
          </td>
          @if (!readOnly) {
            <td class="actions">
              <button type="button" class="p-button p-button-text p-button-sm" (click)="openDialog(s)" i18n="@@payroll.employees.modifier.f260e757">Modifier</button>
              @if (!s.isApproved) {
                <button type="button" class="p-button p-button-text p-button-sm" (click)="approve(s)" i18n="@@payroll.employees.approuver.3033e7d6">Approuver</button>
              }
              <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(s)" i18n="@@payroll.employees.supprimer.1acfc1c7">Supprimer</button>
            </td>
          }
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td [attr.colspan]="readOnly ? 5 : 6" i18n="@@payroll.employees.aucune.suspension.enregistree.7e48283d">Aucune suspension enregistrée.</td></tr>
      </ng-template>
    </p-table>

    <p-dialog
      [header]="editingId ? loc_ui_tern_modifier_la_suspension_654454 : loc_ui_tern_nouvelle_suspension_fe6ff0"
      [(visible)]="dialogVisible"
      [modal]="true"
      [style]="{ width: '480px' }">
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.type.3deb7456">Type</label>
        <p-select [options]="suspensionTypeOptions" [(ngModel)]="formType" optionLabel="label" optionValue="value" appendTo="body" styleClass="w-full" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.debut.f0955314">Début</label>
          <p-datepicker [(ngModel)]="formStart" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.fin.4251065f">Fin</label>
          <p-datepicker [(ngModel)]="formEnd" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
      </div>
      <div class="payroll-form-group switch-row mb-2">
        <label for="isPaid" i18n="@@payroll.employees.suspension.remuneree.fe8572b6">Suspension rémunérée</label>
        <p-inputSwitch inputId="isPaid" [(ngModel)]="formIsPaid" />
      </div>
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.motif.2a198f47">Motif</label>
        <textarea pTextarea [(ngModel)]="formReason" rows="2" class="w-full"></textarea>
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
    .actions { white-space: nowrap; }
    .w-full { width: 100%; }
    .switch-row { flex-direction: row; align-items: center; justify-content: space-between; }
  `]
})
export class EmployeeSuspensionsTabComponent implements OnInit {
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  readonly loc_ui_tern_approuvee_7d606a = $localize`:@@ui.tern.approuvee.7d606a:Approuvée`;
  readonly loc_ui_tern_en_attente_523115 = $localize`:@@ui.tern.en.attente.523115:En attente`;
  readonly loc_ui_tern_modifier_la_suspension_654454 = $localize`:@@ui.tern.modifier.la.suspension.654454:Modifier la suspension`;
  readonly loc_ui_tern_nouvelle_suspension_fe6ff0 = $localize`:@@ui.tern.nouvelle.suspension.fe6ff0:Nouvelle suspension`;
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
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@employee-suspensions-tab.component.summary.Suspensions:Suspensions`, detail: $localize`:@@employee-suspensions-tab.component.detail.Chargement_impos:Chargement impossible.` })
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
          summary: $localize`:@@employee-suspensions-tab.component.summary.Suspensions:Suspensions`,
          detail: this.editingId ? $localize`:@@ui.tern.suspension.mise.a.jour.45fd9a:Suspension mise à jour.` : $localize`:@@ui.tern.suspension.enregistree.c7c7a4:Suspension enregistrée.`
        });
        this.dialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@employee-suspensions-tab.component.summary.Suspensions:Suspensions`,
        detail: err.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.`
      })
    });
  }

  approve(suspension: EmployeePayrollSuspension): void {
    if (this.readOnly) return;
    this.payroll.approveSuspension(suspension.id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@employee-suspensions-tab.component.summary.Suspensions:Suspensions`, detail: $localize`:@@employee-suspensions-tab.component.detail.Suspension_appro:Suspension approuvée.` });
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@employee-suspensions-tab.component.summary.Suspensions:Suspensions`,
        detail: err.error?.message ?? $localize`:@@ui.tern.approbation.impossible.7d6318:Approbation impossible.`
      })
    });
  }

  confirmDelete(suspension: EmployeePayrollSuspension): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: `Supprimer la suspension du ${suspension.startDate} ?`,
      header: 'Confirmation',
      acceptLabel: $localize`:@@employee-suspensions-tab.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@employee-suspensions-tab.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(suspension.id)
    });
  }

  private delete(id: string): void {
    this.payroll.deleteSuspension(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@employee-suspensions-tab.component.summary.Suspensions:Suspensions`, detail: $localize`:@@employee-suspensions-tab.component.detail.Suspension_suppr:Suspension supprimée.` });
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@employee-suspensions-tab.component.summary.Suspensions:Suspensions`,
        detail: err.error?.message ?? $localize`:@@ui.tern.suppression.impossible.0dffe4:Suppression impossible.`
      })
    });
  }
}
