/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { finalize } from 'rxjs';
import { PayrollService } from '@core/services/payroll.service';
import { BankAccountService, hasCompleteBankIdentity, type BankAccountDto } from '@core/services/bank-account.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PayrollAmountPipe } from '../shared';

@Component({
  selector: 'app-cnss-remittance-payment-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    SelectModule,
    InputTextModule,
    DatePickerModule,
    ButtonComponent,
    PayrollAmountPipe
  ],
  template: `
    <p-dialog
      header="Enregistrer le versement CNSS" i18n-header="@@payroll.declarations.enregistrer.le.versement.cnss.eeced899"
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [modal]="true"
      [style]="{ width: '480px' }"
      (onShow)="onOpen()">
      <p class="hint mb-3">
        <ng-container i18n="@@payroll.declarations.montant.a.verser.compte.453.66ffbe27"> Montant à verser (compte 453) : </ng-container> <strong>{{ totalDue() | payrollAmount }}</strong>
      </p>

      <div class="field mb-3">
        <label for="cnss-pay-date" i18n="@@payroll.declarations.date.de.paiement.bd0020ef">Date de paiement</label>
        <p-datepicker
          inputId="cnss-pay-date"
          [(ngModel)]="paymentDate"
          dateFormat="dd/mm/yy"
          [showIcon]="true"
          styleClass="w-full" />
      </div>

      <div class="field mb-3">
        <label for="cnss-pay-method" i18n="@@payroll.declarations.mode.a7b93d21">Mode</label>
        <p-select
          inputId="cnss-pay-method"
          [options]="methodOptions"
          [(ngModel)]="method"
          optionLabel="label"
          optionValue="value"
          styleClass="w-full" />
      </div>

      @if (method !== 0) {
        <div class="field mb-3">
          <label for="cnss-pay-account" i18n="@@payroll.declarations.compte.bancaire.debiteur.fa313693">Compte bancaire débiteur</label>
          <p-select
            inputId="cnss-pay-account"
            [options]="accountOptions()"
            [(ngModel)]="bankAccountId"
            optionLabel="label"
            optionValue="value"
            placeholder="Sélectionner un compte" i18n-placeholder="@@payroll.declarations.selectionner.un.compte.9009d2c1"
            styleClass="w-full" />
        </div>
      }

      <div class="field mb-3">
        <label for="cnss-pay-ref" i18n="@@payroll.declarations.reference.f8130bb0">Référence</label>
        <input pInputText id="cnss-pay-ref" class="w-full" [(ngModel)]="reference" />
      </div>

      <div class="field mb-3">
        <label for="cnss-pay-notes" i18n="@@payroll.declarations.notes.70440046">Notes</label>
        <input pInputText id="cnss-pay-notes" class="w-full" [(ngModel)]="notes" />
      </div>

      <ng-template pTemplate="footer">
        <app-button variant="ghost" (click)="visibleChange.emit(false)" i18n="@@payroll.declarations.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" [disabled]="saving()" (click)="submit()">
          {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_confirmer_80a664 }}
        </app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .hint { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .mb-3 { margin-bottom: var(--spacing-4); }
    .field label { display: block; margin-bottom: var(--spacing-1); font-size: var(--font-size-sm); }
  `]
})
export class CnssRemittancePaymentDialogComponent implements OnInit {
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_confirmer_80a664 = $localize`:@@ui.tern.confirmer.80a664:Confirmer`;
  private readonly payroll = inject(PayrollService);
  private readonly bankAccounts = inject(BankAccountService);
  private readonly toast = inject(ToastService);

  visible = input(false);
  year = input.required<number>();
  month = input.required<number>();
  totalDue = input(0);

  visibleChange = output<boolean>();
  recorded = output<void>();

  paymentDate: Date = new Date();
  method = 1;
  bankAccountId: string | null = null;
  reference = '';
  notes = '';

  saving = signal(false);
  accounts = signal<BankAccountDto[]>([]);

  methodOptions = [
    { value: 1, label: $localize`:@@payroll.cnss-remittance-payment-dialog.ts.virement.bancaire.8306f08e:Virement bancaire` },
    { value: 2, label: $localize`:@@payroll.cnss-remittance-payment-dialog.ts.cheque.8bbb89a9:Chèque` },
    { value: 0, label: $localize`:@@payroll.cnss-remittance-payment-dialog.ts.especes.b7679d62:Espèces` }
  ];

  accountOptions = computed(() =>
    this.accounts()
      .filter(a => a.isActive && hasCompleteBankIdentity(a))
      .map(a => ({
        value: a.id,
        label: `${a.designation || a.bankName} — ${a.iban}`
      }))
  );

  ngOnInit(): void {
    this.bankAccounts.list().subscribe({
      next: res => {
        this.accounts.set(res.data ?? []);
        const def = (res.data ?? []).find(a => a.isDefault && hasCompleteBankIdentity(a));
        if (def) this.bankAccountId = def.id;
      },
      error: () => this.accounts.set([])
    });
  }

  onOpen(): void {
    this.paymentDate = new Date();
    this.method = 1;
    this.reference = '';
    this.notes = '';
  }

  submit(): void {
    if (this.method !== 0 && !this.bankAccountId) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@cnss-remittance-payment-dialog.component.summary.Versement_CNSS:Versement CNSS`, detail: $localize`:@@cnss-remittance-payment-dialog.component.detail.S_lectionnez_un_:Sélectionnez un compte bancaire.` });
      return;
    }

    this.saving.set(true);
    const date = this.paymentDate.toISOString().slice(0, 10);
    this.payroll.recordCnssRemittancePayment({
      year: this.year(),
      month: this.month(),
      paymentDate: date,
      method: this.method,
      bankAccountId: this.bankAccountId ?? undefined,
      reference: this.reference || undefined,
      notes: this.notes || undefined
    }).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@cnss-remittance-payment-dialog.component.summary.Versement_CNSS:Versement CNSS`, detail: $localize`:@@cnss-remittance-payment-dialog.component.detail.Versement_enregi:Versement enregistré.` });
        this.recorded.emit();
      },
      error: err =>
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@cnss-remittance-payment-dialog.component.summary.Versement_CNSS:Versement CNSS`,
          detail: err?.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.`
        })
    });
  }
}
