/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { TableModule } from 'primeng/table';
import { finalize } from 'rxjs';
import {
  PayrollService,
  type PayslipListItem,
  type RecordPayrollRunPaymentRequest
} from '@core/services/payroll.service';
import { BankAccountService } from '@core/services/bank-account.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PayrollAmountPipe } from '../shared';

interface PayslipPaymentRow {
  payslipId: string;
  employeeName: string;
  employeeNumber: string;
  remainingToPay: number;
  selected: boolean;
  amount: number;
}

@Component({
  selector: 'app-payroll-record-payment-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    SelectModule,
    InputTextModule,
    InputNumberModule,
    CheckboxModule,
    TableModule,
    ButtonComponent,
    PayrollAmountPipe
  ],
  template: `
    <p-dialog
      header="Régler la paie" i18n-header="@@payroll.runs.regler.la.paie.5ab3e218"
      [(visible)]="visibleProxy"
      [modal]="true"
      [style]="{ width: '760px' }"
      (onShow)="onOpen()"
      (onHide)="closed.emit()">
      <p class="hint mb-3" i18n="@@payroll.runs.enregistrez.le.decaissement.apres.confirmation.b.e5561856"> Enregistrez le décaissement après confirmation bancaire. Une écriture JB et un lettrage 421 seront générés. </p>

      <div class="form-grid mb-3">
        <div class="field">
          <label for="pp-date" i18n="@@payroll.runs.date.de.paiement.bd0020ef">Date de paiement</label>
          <input pInputText id="pp-date" type="date" class="w-full" [(ngModel)]="paymentDate" />
        </div>
        <div class="field">
          <label for="pp-method" i18n="@@payroll.runs.mode.a7b93d21">Mode</label>
          <p-select
            inputId="pp-method"
            [options]="methodOptions"
            [(ngModel)]="method"
            optionLabel="label"
            optionValue="value"
            styleClass="w-full" />
        </div>
        @if (method !== 0) {
          <div class="field span-2">
            <label for="pp-bank" i18n="@@payroll.runs.compte.debiteur.b7abcb4f">Compte débiteur</label>
            <p-select
              inputId="pp-bank"
              [options]="accountOptions()"
              [(ngModel)]="bankAccountId"
              optionLabel="label"
              optionValue="value"
              placeholder="Sélectionner un compte" i18n-placeholder="@@payroll.runs.selectionner.un.compte.9009d2c1"
              styleClass="w-full" />
          </div>
        }
        <div class="field">
          <label for="pp-ref" i18n="@@payroll.runs.reference.f8130bb0">Référence</label>
          <input pInputText id="pp-ref" class="w-full" [(ngModel)]="reference" />
        </div>
        <div class="field">
          <label for="pp-notes" i18n="@@payroll.runs.notes.70440046">Notes</label>
          <input pInputText id="pp-notes" class="w-full" [(ngModel)]="notes" />
        </div>
      </div>

      <div class="toolbar mb-2">
        <app-button variant="ghost" size="sm" (click)="selectAll()" i18n="@@payroll.runs.tout.selectionner.06f2c1c0">Tout sélectionner</app-button>
        <strong i18n="@@payroll.runs.total.a86e9581">Total : {{ totalSelected() | payrollAmount }}</strong>
      </div>

      <div class="payroll-table-scroll">
        <p-table [value]="rows()" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th style="width: 3rem"></th>
              <th i18n="@@payroll.runs.salarie.27f97915">Salarié</th>
              <th class="text-right" i18n="@@payroll.runs.reste.a.payer.968444fc">Reste à payer</th>
              <th class="text-right" i18n="@@payroll.runs.montant.4adcd9fc">Montant</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr>
              <td>
                <p-checkbox [(ngModel)]="r.selected" [binary]="true" (onChange)="onRowToggle(r)" />
              </td>
              <td>{{ r.employeeName }}</td>
              <td class="text-right">{{ r.remainingToPay | payrollAmount }}</td>
              <td class="text-right">
                <p-inputNumber
                  [(ngModel)]="r.amount"
                  [minFractionDigits]="3"
                  [maxFractionDigits]="3"
                  [disabled]="!r.selected"
                  mode="decimal"
                  inputStyleClass="text-right" />
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>

      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="visibleProxy = false" i18n="@@payroll.runs.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" [disabled]="!isValid() || saving()" (click)="submit()">
          {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_enregistrer_le_paiement_6495b8 }}
        </app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .hint { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .mb-2 { margin-bottom: var(--spacing-2); }
    .mb-3 { margin-bottom: var(--spacing-4); }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-3); }
    .field label { display: block; margin-bottom: var(--spacing-1); font-size: var(--font-size-sm); }
    .span-2 { grid-column: span 2; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; }
    .w-full { width: 100%; }
    .text-right { text-align: end; }
  `]
})
export class PayrollRecordPaymentDialogComponent implements OnInit {
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_enregistrer_le_paiement_6495b8 = $localize`:@@ui.tern.enregistrer.le.paiement.6495b8:Enregistrer le paiement`;
  private readonly payroll = inject(PayrollService);
  private readonly banks = inject(BankAccountService);
  private readonly toast = inject(ToastService);

  runId = input.required<string>();
  payslips = input.required<PayslipListItem[]>();
  visible = input(false);
  closed = output<void>();
  paymentRecorded = output<void>();

  visibleProxy = false;
  paymentDate = new Date().toISOString().slice(0, 10);
  method = 1;
  bankAccountId: string | null = null;
  reference = '';
  notes = '';
  saving = signal(false);
  rows = signal<PayslipPaymentRow[]>([]);
  accountOptions = signal<{ label: string; value: string }[]>([]);

  readonly methodOptions = [
    { label: $localize`:@@payroll.payroll-record-payment-dialog.ts.virement.afbaf950:Virement`, value: 1 },
    { label: $localize`:@@payroll.payroll-record-payment-dialog.ts.cheque.8bbb89a9:Chèque`, value: 2 },
    { label: $localize`:@@payroll.payroll-record-payment-dialog.ts.especes.b7679d62:Espèces`, value: 0 },
    { label: $localize`:@@payroll.payroll-record-payment-dialog.ts.carte.8bb68357:Carte`, value: 3 },
    { label: $localize`:@@payroll.payroll-record-payment-dialog.ts.autre.43dacf9e:Autre`, value: 99 }
  ];

  totalSelected = computed(() =>
    this.rows().filter(r => r.selected).reduce((s, r) => s + (r.amount || 0), 0)
  );

  ngOnInit(): void {
    this.syncVisible();
  }

  private syncVisible(): void {
    this.visibleProxy = this.visible();
  }

  onOpen(): void {
    this.rows.set(
      this.payslips()
        .filter(p => (p.remainingToPay ?? p.netSalary) > 0)
        .map(p => ({
          payslipId: p.id,
          employeeName: p.employeeName,
          employeeNumber: p.employeeNumber,
          remainingToPay: p.remainingToPay ?? p.netSalary,
          selected: true,
          amount: p.remainingToPay ?? p.netSalary
        }))
    );
    this.banks.list().subscribe({
      next: res => {
        const items = (res.data ?? []).map(a => ({
          label: `${a.designation || a.bankName} — ${a.iban}`,
          value: a.id
        }));
        this.accountOptions.set(items);
        const def = (res.data ?? []).find(a => a.isDefault);
        if (def) this.bankAccountId = def.id;
      }
    });
  }

  selectAll(): void {
    this.rows.update(list => list.map(r => ({ ...r, selected: true, amount: r.remainingToPay })));
  }

  onRowToggle(row: PayslipPaymentRow): void {
    if (row.selected && row.amount <= 0) row.amount = row.remainingToPay;
  }

  isValid(): boolean {
    if (!this.paymentDate) return false;
    if (this.method !== 0 && !this.bankAccountId) return false;
    const selected = this.rows().filter(r => r.selected);
    if (selected.length === 0) return false;
    return selected.every(r => r.amount > 0 && r.amount <= r.remainingToPay + 0.001);
  }

  submit(): void {
    if (!this.isValid()) return;
    const body: RecordPayrollRunPaymentRequest = {
      paymentDate: this.paymentDate,
      method: this.method,
      bankAccountId: this.method === 0 ? undefined : this.bankAccountId ?? undefined,
      reference: this.reference || undefined,
      notes: this.notes || undefined,
      payslipAmounts: this.rows()
        .filter(r => r.selected)
        .map(r => ({ payslipId: r.payslipId, amount: r.amount }))
    };
    this.saving.set(true);
    this.payroll
      .recordRunPayment(this.runId(), body)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.toast.add({ severity: 'success', summary: $localize`:@@payroll-record-payment-dialog.component.summary.Paie:Paie`, detail: $localize`:@@payroll-record-payment-dialog.component.detail.Paiement_enregis:Paiement enregistré.` });
          this.visibleProxy = false;
          this.paymentRecorded.emit();
        },
        error: err =>
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@payroll-record-payment-dialog.component.summary.Paie:Paie`,
            detail: err?.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.`
          })
      });
  }
}
