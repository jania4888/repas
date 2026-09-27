/// <reference types="@angular/localize" />
import { Component, Input, OnInit, inject, signal } from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { TableModule } from 'primeng/table';

import { DialogModule } from 'primeng/dialog';

import { SelectModule } from 'primeng/select';

import { InputNumberModule } from 'primeng/inputnumber';

import { ButtonComponent } from '@shared/components/button/button.component';

import { EmployeeService, EmployeeListItem } from '@core/services/employee.service';

import {

  PayrollService,

  PayrollMealVoucherLine,

  UpsertMealVoucherLineRequest

} from '@core/services/payroll.service';

import { ToastService } from '@core/services/toast.service';

import { ConfirmationService } from '@core/services/confirmation.service';

import { PayrollSectionComponent, PayrollAmountPipe } from '../shared';



@Component({

  selector: 'app-payroll-meal-voucher-grid',

  standalone: true,

  imports: [

    CommonModule,

    FormsModule,

    TableModule,

    DialogModule,

    SelectModule,

    InputNumberModule,

    ButtonComponent,

    PayrollSectionComponent,

    PayrollAmountPipe

  ],

  template: `

    <app-payroll-section

      title="Tickets restaurant" i18n-title="@@payroll.runs.tickets.restaurant.72ed5294"

      subtitle="Saisie mensuelle par salarié. Recalculez le cycle pour intégrer les retenues au bulletin." i18n-subtitle="@@payroll.runs.saisie.mensuelle.par.salarie.recalculez.fa59ee0c"

      icon="pi-shopping-bag">

      @if (!readOnly) {

        <div class="payroll-toolbar mb-3">

          <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()" i18n="@@payroll.runs.ajouter.une.ligne.ba241fd4">Ajouter une ligne</app-button>

        </div>

      }



      <div class="payroll-table-scroll">

      <p-table [value]="lines()" styleClass="p-datatable-sm">

        <ng-template pTemplate="header">

          <tr>

            <th i18n="@@payroll.runs.salarie.27f97915">Salarié</th>

            <th class="text-right" i18n="@@payroll.runs.jours.57960dfb">Jours</th>

            <th class="text-right" i18n="@@payroll.runs.valeur.faciale.7eb109c8">Valeur faciale</th>

            <th class="text-right" i18n="@@payroll.runs.part.employeur.af021705">Part employeur</th>

            <th class="text-right" i18n="@@payroll.runs.part.salarie.93060d7c">Part salarié</th>

            <th class="text-right" i18n="@@payroll.runs.total.b25928c6">Total</th>

            @if (!readOnly) { <th></th> }

          </tr>

        </ng-template>

        <ng-template pTemplate="body" let-line>

          <tr>

            <td>{{ line.employeeName }}</td>

            <td class="text-right">{{ line.days }}</td>

            <td class="text-right">{{ line.faceValue | payrollAmount }}</td>

            <td class="text-right">{{ lineEmployerShare(line) | payrollAmount }}</td>

            <td class="text-right">{{ lineEmployeeShare(line) | payrollAmount }}</td>

            <td class="text-right">{{ lineTotal(line) | payrollAmount }}</td>

            @if (!readOnly) {

              <td class="actions">

                <button type="button" class="p-button p-button-text p-button-sm" (click)="editLine(line)" i18n="@@payroll.runs.modifier.f260e757">Modifier</button>

                <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(line)" i18n="@@payroll.runs.supprimer.1acfc1c7">Supprimer</button>

              </td>

            }

          </tr>

        </ng-template>

        <ng-template pTemplate="emptymessage">

          <tr><td [attr.colspan]="readOnly ? 6 : 7" i18n="@@payroll.runs.aucun.ticket.restaurant.saisi.pour.ce.mois.ad9d1b5d">Aucun ticket restaurant saisi pour ce mois.</td></tr>

        </ng-template>

      </p-table>

      </div>

    </app-payroll-section>



    <p-dialog [header]="editingId ? loc_ui_tern_modifier_les_tickets_restaurant_622ff7 : loc_ui_tern_nouveaux_tickets_restaurant_f9c7a9" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '520px' }">

      <div class="payroll-form-group mb-2">

        <label i18n="@@payroll.runs.salarie.27f97915">Salarié</label>

        <p-select [options]="employees()" optionLabel="fullName" optionValue="id" [(ngModel)]="formEmployeeId" appendTo="body" styleClass="w-full" [disabled]="!!editingId" />

      </div>

      <div class="payroll-form-row">

        <div class="payroll-form-group">

          <label i18n="@@payroll.runs.jours.travailles.4687ee29">Jours travaillés</label>

          <p-inputNumber [(ngModel)]="formDays" [min]="1" [max]="31" styleClass="w-full" />

        </div>

        <div class="payroll-form-group">

          <label i18n="@@payroll.runs.valeur.faciale.tnd.41da4ad5">Valeur faciale (TND)</label>

          <p-inputNumber [(ngModel)]="formFaceValue" [min]="0.001" [minFractionDigits]="3" [maxFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />

        </div>

      </div>

      <div class="payroll-form-group mb-2">

        <label i18n="@@payroll.runs.part.employeur.37c96a45">Part employeur (%)</label>

        <p-inputNumber [(ngModel)]="formEmployerRate" [min]="0" [max]="100" [minFractionDigits]="0" [maxFractionDigits]="2" [locale]="'fr-TN'" styleClass="w-full" />

      </div>

      <ng-template pTemplate="footer">

        <app-button variant="outline" (click)="dialogVisible = false" i18n="@@payroll.runs.annuler.49ba3292">Annuler</app-button>

        <app-button variant="primary" (click)="save()" i18n="@@payroll.runs.enregistrer.f7c8bcd8">Enregistrer</app-button>

      </ng-template>

    </p-dialog>

  `,

  styles: [`

    .mb-2 { margin-bottom: var(--spacing-2); }

    .mb-3 { margin-bottom: var(--spacing-4); }

    .actions { white-space: nowrap; }

    .w-full { width: 100%; }

    .text-right { text-align: right; }

  `]

})

export class PayrollMealVoucherGridComponent implements OnInit {
  readonly loc_ui_tern_modifier_les_tickets_restaurant_622ff7 = $localize`:@@ui.tern.modifier.les.tickets.restaurant.622ff7:Modifier les tickets restaurant`;
  readonly loc_ui_tern_nouveaux_tickets_restaurant_f9c7a9 = $localize`:@@ui.tern.nouveaux.tickets.restaurant.f9c7a9:Nouveaux tickets restaurant`;

  @Input({ required: true }) year!: number;

  @Input({ required: true }) month!: number;

  @Input() readOnly = false;

  @Input() initialLines: PayrollMealVoucherLine[] = [];



  private readonly employeesApi = inject(EmployeeService);

  private readonly payroll = inject(PayrollService);

  private readonly toast = inject(ToastService);

  private readonly confirmation = inject(ConfirmationService);



  lines = signal<PayrollMealVoucherLine[]>([]);

  employees = signal<EmployeeListItem[]>([]);

  dialogVisible = false;

  editingId: string | null = null;

  formEmployeeId: string | null = null;

  formDays = 22;

  formFaceValue = 0;

  formEmployerRate = 50;



  ngOnInit(): void {

    this.lines.set(this.initialLines ?? []);

    this.loadEmployees();

  }



  lineTotal(line: PayrollMealVoucherLine): number {

    return line.totalValue ?? line.days * line.faceValue;

  }



  lineEmployerShare(line: PayrollMealVoucherLine): number {

    if (line.employerContribution != null) return line.employerContribution;

    return this.lineTotal(line) * line.employerContributionRate / 100;

  }



  lineEmployeeShare(line: PayrollMealVoucherLine): number {

    if (line.employeeContribution != null) return line.employeeContribution;

    return this.lineTotal(line) - this.lineEmployerShare(line);

  }



  reload(): void {

    this.payroll.listMealVouchers(this.year, this.month).subscribe({

      next: res => this.lines.set(res.data ?? []),

      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@payroll-meal-voucher-grid.component.summary.Tickets_restaura:Tickets restaurant`, detail: $localize`:@@payroll-meal-voucher-grid.component.detail.Chargement_impos:Chargement impossible.` })

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

    this.formDays = 22;

    this.formFaceValue = 0;

    this.formEmployerRate = 50;

    this.dialogVisible = true;

  }



  editLine(line: PayrollMealVoucherLine): void {

    if (this.readOnly) return;

    this.editingId = line.id;

    this.formEmployeeId = line.employeeId;

    this.formDays = line.days;

    this.formFaceValue = line.faceValue;

    this.formEmployerRate = line.employerContributionRate;

    this.dialogVisible = true;

  }



  save(): void {

    if (this.readOnly || !this.formEmployeeId || this.formDays <= 0 || this.formFaceValue <= 0) return;



    const body: UpsertMealVoucherLineRequest = {

      employeeId: this.formEmployeeId,

      year: this.year,

      month: this.month,

      days: this.formDays,

      faceValue: this.formFaceValue,

      employerContributionRate: this.formEmployerRate

    };



    const req = this.editingId

      ? this.payroll.updateMealVoucher(this.editingId, body)

      : this.payroll.createMealVoucher(body);



    req.subscribe({

      next: () => {

        this.toast.add({

          severity: 'success',

          summary: $localize`:@@payroll-meal-voucher-grid.component.summary.Tickets_restaura:Tickets restaurant`,

          detail: $localize`:@@payroll-meal-voucher-grid.component.detail.Enregistr_Reca:Enregistré. Recalculez le cycle pour mettre à jour les bulletins.`

        });

        this.dialogVisible = false;

        this.reload();

      },

      error: err => this.toast.add({

        severity: 'error',

        summary: $localize`:@@payroll-meal-voucher-grid.component.summary.Tickets_restaura:Tickets restaurant`,

        detail: err?.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.`

      })

    });

  }



  confirmDelete(line: PayrollMealVoucherLine): void {

    if (this.readOnly) return;

    this.confirmation.confirm({

      message: `Supprimer les tickets restaurant de ${line.employeeName} ?`,

      header: 'Confirmation',

      acceptLabel: $localize`:@@payroll-meal-voucher-grid.component.acceptLabel.Supprimer:Supprimer`,

      rejectLabel: $localize`:@@payroll-meal-voucher-grid.component.rejectLabel.Annuler:Annuler`,

      acceptButtonStyleClass: 'btn-danger',

      accept: () => this.delete(line.id)

    });

  }



  private delete(id: string): void {

    this.payroll.deleteMealVoucher(id).subscribe({

      next: () => {

        this.toast.add({ severity: 'success', summary: $localize`:@@payroll-meal-voucher-grid.component.summary.Tickets_restaura:Tickets restaurant`, detail: $localize`:@@payroll-meal-voucher-grid.component.detail.Supprimé.:Supprimé.` });

        this.reload();

      },

      error: err => this.toast.add({

        severity: 'error',

        summary: $localize`:@@payroll-meal-voucher-grid.component.summary.Tickets_restaura:Tickets restaurant`,

        detail: err?.error?.message ?? $localize`:@@ui.tern.suppression.impossible.0dffe4:Suppression impossible.`

      })

    });

  }

}


