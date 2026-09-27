/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PayrollService, type PayrollPayment } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PayrollAmountPipe, PayrollSectionComponent } from '../shared';

@Component({
  selector: 'app-payroll-payments-panel',
  standalone: true,
  imports: [BackendLabelPipe, CommonModule, ButtonComponent, PayrollAmountPipe, PayrollSectionComponent],
  template: `
    <app-payroll-section title="Paiements enregistrés" i18n-title="@@payroll.runs.paiements.enregistres.1ae9a974" icon="pi-wallet">
      @if (loading()) {
        <p i18n="@@payroll.runs.chargement.01cba1df">Chargement…</p>
      } @else if (payments().length === 0) {
        <p class="text-secondary" i18n="@@payroll.runs.aucun.paiement.enregistre.pour.ce.cycle.d471868c">Aucun paiement enregistré pour ce cycle.</p>
      } @else {
        <div class="payments-list">
          @for (p of payments(); track p.id) {
            <div class="payment-card" [class.cancelled]="p.isCancelled">
              <div class="payment-header">
                <div>
                  <strong>{{ p.paymentDate | date:'dd/MM/yyyy' }}</strong>
                  <span class="ml-2">{{ p.methodDisplay | backendLabel }}</span>
                  @if (p.isCancelled) {
                    <span class="badge-cancelled" i18n="@@payroll.runs.annule.34cd87cc">Annulé</span>
                  }
                </div>
                <strong>{{ p.amount | payrollAmount }}</strong>
              </div>
              @if (p.reference) {
                <div class="text-secondary" i18n="@@payroll.runs.ref.ed57a16b">Réf. {{ p.reference }}</div>
              }
              <ul class="lines">
                @for (l of p.lines; track l.id) {
                  <li>{{ l.employeeName }} — {{ l.amount | payrollAmount }}</li>
                }
              </ul>
              @if (!p.isCancelled && canCancel()) {
                <app-button variant="ghost" size="sm" (click)="cancelOne(p)" i18n="@@payroll.runs.annuler.ce.paiement.9c2d376a">Annuler ce paiement</app-button>
              }
            </div>
          }
        </div>
      }
    </app-payroll-section>
  `,
  styles: [`
    .text-secondary { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
    .ml-2 { margin-left: var(--spacing-2); }
    .payments-list { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .payment-card { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--spacing-3); }
    .payment-card.cancelled { opacity: 0.7; }
    .payment-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-2); }
    .badge-cancelled { margin-left: var(--spacing-2); color: var(--color-danger); font-size: var(--font-size-sm); }
    .lines { margin: var(--spacing-2) 0; padding-left: var(--spacing-4); font-size: var(--font-size-sm); }
  `]
})
export class PayrollPaymentsPanelComponent implements OnInit {
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  runId = input.required<string>();
  canCancel = input(true);
  refreshed = output<void>();

  loading = signal(false);
  payments = signal<PayrollPayment[]>([]);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.payroll.listRunPayments(this.runId(), true).subscribe({
      next: res => {
        this.payments.set(res.data ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.add({ severity: 'error', summary: $localize`:@@payroll-payments-panel.component.summary.Paie:Paie`, detail: $localize`:@@payroll-payments-panel.component.detail.Impossible_de_ch:Impossible de charger les paiements.` });
      }
    });
  }

  async cancelOne(p: PayrollPayment): Promise<void> {
    const reason = await this.confirmation.prompt({
      header: $localize`:@@payroll.payroll-payments-panel.ts.annuler.le.paiement.6a672eb2:Annuler le paiement`,
      message: $localize`:@@payroll.payroll-payments-panel.ts.saisissez.le.motif.d.annulation.du.paiem.e9153bbd:Saisissez le motif d'annulation du paiement :`,
      acceptLabel: $localize`:@@payroll-payments-panel.component.acceptLabel.Annuler_le_paiem:Annuler le paiement`,
      rejectLabel: $localize`:@@payroll-payments-panel.component.rejectLabel.Conserver:Conserver`,
      acceptButtonStyleClass: 'btn-danger',
      required: true
    });
    if (!reason) return;
    this.payroll.cancelPayment(p.id, reason).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@payroll-payments-panel.component.summary.Paie:Paie`, detail: $localize`:@@payroll-payments-panel.component.detail.Paiement_annul_:Paiement annulé.` });
        this.load();
        this.refreshed.emit();
      },
      error: err =>
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@payroll-payments-panel.component.summary.Paie:Paie`,
          detail: err?.error?.message ?? $localize`:@@ui.tern.annulation.impossible.814b7d:Annulation impossible.`
        })
    });
  }
}
