/// <reference types="@angular/localize" />
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
      title="Avances sur salaire" i18n-title="@@payroll.employees.avances.sur.salaire.6e2ebd50"
      subtitle="Les avances en cours sont retenues au calcul du cycle et soldées à la validation." i18n-subtitle="@@payroll.employees.les.avances.en.cours.sont.retenues.au.ca.a9e0027e"
      icon="pi-wallet">
      @if (!readOnly) {
        <div class="payroll-toolbar mb-3">
          <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()" i18n="@@payroll.employees.nouvelle.avance.1d2cf479">Nouvelle avance</app-button>
        </div>
      }

      <p-table [value]="items()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@payroll.employees.date.eb9a4bc1">Date</th>
            <th class="text-right" i18n="@@payroll.employees.montant.4adcd9fc">Montant</th>
            <th i18n="@@payroll.employees.motif.2a198f47">Motif</th>
            <th i18n="@@payroll.employees.statut.659499f3">Statut</th>
            @if (!readOnly) { <th></th> }
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-a>
          <tr>
            <td>{{ a.date | date:'dd/MM/yyyy' }}</td>
            <td class="text-right">{{ a.amount | payrollAmount }}</td>
            <td>{{ a.reason || '—' }}</td>
            <td>
              <p-tag [value]="a.isSettled ? loc_ui_tern_soldee_7fecce : loc_ui_tern_en_cours_bc9b53" [severity]="a.isSettled ? 'secondary' : 'info'" />
            </td>
            @if (!readOnly) {
              <td>
                @if (!a.isSettled) {
                  <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(a)" i18n="@@payroll.employees.supprimer.1acfc1c7">Supprimer</button>
                }
              </td>
            }
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td [attr.colspan]="readOnly ? 4 : 5" i18n="@@payroll.employees.aucune.avance.enregistree.d952f6b0">Aucune avance enregistrée.</td></tr>
        </ng-template>
      </p-table>
    </app-payroll-section>

    <p-dialog header="Nouvelle avance" i18n-header="@@payroll.employees.nouvelle.avance.1d2cf479" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '420px' }">
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.date.eb9a4bc1">Date</label>
        <p-datepicker [(ngModel)]="formDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
      </div>
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.montant.tnd.e877352d">Montant (TND)</label>
        <p-inputNumber [(ngModel)]="formAmount" [minFractionDigits]="3" [min]="0.001" [locale]="'fr-TN'" styleClass="w-full" />
      </div>
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.motif.2a198f47">Motif</label>
        <textarea pTextarea [(ngModel)]="formReason" rows="2" class="w-full"></textarea>
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="dialogVisible = false" i18n="@@payroll.employees.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" (click)="create()" i18n="@@payroll.employees.enregistrer.f7c8bcd8">Enregistrer</app-button>
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
  readonly loc_ui_tern_soldee_7fecce = $localize`:@@ui.tern.soldee.7fecce:Soldée`;
  readonly loc_ui_tern_en_cours_bc9b53 = $localize`:@@ui.tern.en.cours.bc9b53:En cours`;
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
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@employee-advances-tab.component.summary.Avances:Avances`, detail: $localize`:@@employee-advances-tab.component.detail.Chargement_impos:Chargement impossible.` })
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
        this.toast.add({ severity: 'success', summary: $localize`:@@employee-advances-tab.component.summary.Avances:Avances`, detail: $localize`:@@employee-advances-tab.component.detail.Avance_enregistr:Avance enregistrée.` });
        this.dialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@employee-advances-tab.component.summary.Avances:Avances`, detail: err.error?.message ?? $localize`:@@ui.tern.creation.impossible.5661a5:Création impossible.` })
    });
  }

  confirmDelete(advance: EmployeeAdvance): void {
    if (this.readOnly || advance.isSettled) return;
    this.confirmation.confirm({
      message: $localize`:@@payroll.employee-advances-tab.ts.supprimer.l.avance.de.amount.tnd.ef871a93:Supprimer l'avance de ${advance.amount}:amount: TND ?`,
      header: $localize`:@@payroll.employee-advances-tab.ts.confirmation.3424edc2:Confirmation`,
      acceptLabel: $localize`:@@employee-advances-tab.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@employee-advances-tab.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(advance.id)
    });
  }

  private delete(id: string): void {
    this.payroll.deleteAdvance(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@employee-advances-tab.component.summary.Avances:Avances`, detail: $localize`:@@employee-advances-tab.component.detail.Avance_supprim_e:Avance supprimée.` });
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@employee-advances-tab.component.summary.Avances:Avances`,
        detail: err.error?.message ?? $localize`:@@ui.tern.suppression.impossible.avance.peut.etre.de.c8f021:Suppression impossible (avance peut-être déjà soldée).`
      })
    });
  }
}
