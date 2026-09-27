import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  signal,
  computed,
  OnChanges,
  SimpleChanges,
  HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { InvoiceService, PaymentDto } from '@core/services/invoice.service';
import { AuthService } from '@core/services/auth.service';
import {
  SupplierInvoiceService,
  SupplierPaymentItem
} from '@core/services/supplier-invoice.service';
import { RecordPaymentDialogComponent } from '@shared/components/record-payment-dialog/record-payment-dialog.component';
import { ButtonComponent } from '@shared/components/button/button.component';

/** Contexte facture pour le panneau (compatible PaymentListItem). */
export interface InvoicePaymentsPanelContext {
  id: string;
  number: string;
  type: 'client' | 'supplier';
  totalAmount: number;
  totalPaid?: number;
  remainingAmount?: number;
  currency: string;
}

/** Ligne affichée dans la liste des paiements. */
interface PaymentRow {
  id: string;
  date: string;
  amount: number;
  currency: string;
  methodDisplay: string;
  reference: string | null;
  notes: string | null;
}

@Component({
  selector: 'app-invoice-payments-panel',
  standalone: true,
  imports: [BackendLabelPipe, CommonModule, ButtonComponent, RecordPaymentDialogComponent],
  template: `
    <div class="panel-overlay" (click)="onClose()" role="presentation">
      <div
        class="panel-content"
        (click)="$event.stopPropagation()"
        role="dialog"
        [attr.aria-label]="loc_ui_tern_paiements_de_la_facture_c5d629 + (invoice?.number ?? '')"
        [attr.aria-modal]="'true'">
        <div class="panel-header">
          <h2 class="panel-title" id="invoice-payments-panel-title">
            Paiements — Facture {{ invoice?.number ?? '' }}
          </h2>
          <button
            type="button"
            class="panel-close"
            (click)="onClose()"
            aria-label="Fermer le panneau" i18n-aria-label="Fermer le panneau">
            <i class="pi pi-times"></i>
          </button>
        </div>

        @if (invoice && !loading()) {
          <div class="panel-summary" id="invoice-payments-summary" role="region" aria-labelledby="invoice-payments-summary-title">
            <h3 class="panel-summary-title" id="invoice-payments-summary-title" i18n="@@shared.components.invoice-payments-panel.invoice-payments-panel.recapitulatif.d5b5de6d">Récapitulatif</h3>
            <div class="panel-summary-row">
              <span class="panel-summary-label" i18n="@@shared.components.invoice-payments-panel.invoice-payments-panel.montant.total.dd001537">Montant total</span>
              <span class="panel-summary-value">{{ formatAmount(invoice.totalAmount) }} {{ invoice.currency }}</span>
            </div>
            <div class="panel-summary-row">
              <span class="panel-summary-label" i18n="@@shared.components.invoice-payments-panel.invoice-payments-panel.total.paye.57d30be5">Total payé</span>
              <span class="panel-summary-value">{{ formatAmount(effectiveTotalPaid()) }} {{ invoice.currency }}</span>
            </div>
            <div class="panel-summary-row panel-summary-row--remaining">
              <span class="panel-summary-label" i18n="@@shared.components.invoice-payments-panel.invoice-payments-panel.reste.a.payer.968444fc">Reste à payer</span>
              <span class="panel-summary-value panel-summary-value--remaining">{{ formatAmount(effectiveRemainingAmount()) }} {{ invoice.currency }}</span>
            </div>
          </div>
        }

        <div class="panel-body">
          @if (loading()) {
            <div class="panel-loading">
              <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
              <p i18n="@@shared.components.invoice-payments-panel.invoice-payments-panel.chargement.des.paiements.23bdaf2d">Chargement des paiements…</p>
            </div>
          } @else if (paymentRows().length === 0) {
            <div class="panel-empty">
              <i class="pi pi-wallet" aria-hidden="true"></i>
              <p i18n="@@shared.components.invoice-payments-panel.invoice-payments-panel.aucun.paiement.enregistre.pour.cette.facture.088793e0">Aucun paiement enregistré pour cette facture.</p>
            </div>
          } @else {
            <div class="panel-list">
              @for (row of paymentRows(); track row.id) {
                <div class="panel-item">
                  <div class="panel-item-main">
                    <span class="panel-item-date">{{ row.date }}</span>
                    <span class="panel-item-amount">{{ formatAmount(row.amount) }} {{ row.currency }}</span>
                  </div>
                  <div class="panel-item-meta">
                    @if (row.methodDisplay) {
                      <span class="panel-item-method">{{ row.methodDisplay | backendLabel }}</span>
                    }
                    @if (row.reference) {
                      <span class="panel-item-ref">{{ row.reference }}</span>
                    }
                    @if (row.notes) {
                      <span class="panel-item-notes">{{ row.notes }}</span>
                    }
                  </div>
                </div>
              }
            </div>
          }

          @if (invoice && !loading() && showRecordPayment()) {
            <div class="panel-actions">
              <app-button
                variant="primary"
                size="md"
                icon="pi-plus"
                label="Ajouter un paiement" i18n-label="Ajouter un paiement"
                (click)="openRecordPaymentDialog()"
                [disabled]="effectiveRemainingAmount() <= 0"
                ariaLabel="Ajouter un paiement pour cette facture">
              </app-button>
            </div>
          }
        </div>
      </div>
    </div>

    <app-record-payment-dialog
      [(visible)]="recordDialogVisible"
      [invoiceId]="invoice?.id ?? ''"
      [invoiceNumber]="invoice?.number ?? ''"
      [totalAmount]="invoice?.totalAmount ?? 0"
      [totalPaid]="effectiveTotalPaid()"
      [remainingAmount]="effectiveRemainingAmount()"
      [currency]="invoice?.currency ?? loc_ui_tern_tnd_51da21"
      [invoiceType]="invoice?.type ?? 'client'"
      (paymentRecorded)="onPaymentRecorded()">
    </app-record-payment-dialog>
  `,
  styles: [`
    .panel-overlay {
      position: fixed;
      inset: 0;
      z-index: var(--z-drawer-overlay);
      display: flex;
      justify-content: flex-end;
      align-items: stretch;
      background: rgba(15, 23, 42, 0.25);
      backdrop-filter: blur(4px);
      animation: panelFadeIn 200ms ease-out;
    }

    .panel-content {
      position: relative;
      z-index: var(--z-drawer-panel);
      width: min(480px, 100vw);
      max-height: 100dvh;
      height: 100%;
      background: var(--color-white);
      box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: panelSlideInRight 250ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-5);
      border-bottom: 1px solid var(--color-border-subtle);
      flex-shrink: 0;
    }

    .panel-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      margin: 0;
      color: var(--color-text-primary);
    }

    .panel-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-neutral-100);
      color: var(--color-text-tertiary);
      cursor: pointer;
      transition: all 200ms ease;
    }

    .panel-close:hover {
      background: var(--color-neutral-200);
      color: var(--color-text-primary);
    }

    .panel-summary {
      padding: var(--spacing-4) var(--spacing-5);
      border-bottom: 1px solid var(--color-border-subtle);
      background: var(--color-neutral-50);
    }

    .panel-summary-title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      margin: 0 0 var(--spacing-3) 0;
    }

    .panel-summary-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: var(--spacing-2) 0;
    }

    .panel-summary-row--remaining {
      margin-top: var(--spacing-2);
      padding-top: var(--spacing-3);
      border-top: 1px solid var(--color-border-subtle);
    }

    .panel-summary-label {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .panel-summary-value {
      font-family: 'JetBrains Mono', monospace;
      font-variant-numeric: tabular-nums;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .panel-summary-value--remaining {
      font-weight: var(--font-weight-bold);
      color: var(--color-primary-600);
    }

    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-5);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-5);
      min-height: 0;
    }

    .panel-loading,
    .panel-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-10);
      color: var(--color-text-tertiary);
      text-align: center;
    }

    .panel-loading .pi-spinner,
    .panel-empty .pi-wallet {
      font-size: 2.5rem;
      margin-bottom: var(--spacing-4);
      opacity: 0.6;
    }

    .panel-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    .panel-item {
      padding: var(--spacing-4);
      border-radius: var(--radius-xl);
      border: 1px solid var(--color-border-subtle);
      background: var(--color-neutral-50);
    }

    .panel-item-main {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: var(--spacing-2);
    }

    .panel-item-date {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .panel-item-amount {
      font-family: 'JetBrains Mono', monospace;
      font-variant-numeric: tabular-nums;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-bold);
      color: var(--color-primary-600);
    }

    .panel-item-meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-2);
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .panel-item-method {
      font-weight: var(--font-weight-medium);
    }

    .panel-actions {
      margin-top: auto;
      padding-top: var(--spacing-4);
      border-top: 1px solid var(--color-border-subtle);
    }

    @keyframes panelFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes panelSlideInRight {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
  `]
})
export class InvoicePaymentsPanelComponent implements OnChanges {
  readonly loc_ui_tern_paiements_de_la_facture_c5d629 = $localize`:@@ui.tern.paiements.de.la.facture.c5d629:Paiements de la facture `;
  readonly loc_ui_tern_tnd_51da21 = $localize`:@@ui.tern.tnd.51da21:TND`;
  @Input() invoice: InvoicePaymentsPanelContext | null = null;
  @Input() allowRecordPayment = true;
  @Output() closed = new EventEmitter<void>();
  @Output() paymentRecorded = new EventEmitter<void>();

  private readonly invoiceService = inject(InvoiceService);
  private readonly supplierInvoiceService = inject(SupplierInvoiceService);
  private readonly auth = inject(AuthService);

  readonly showRecordPayment = computed(
    () => this.allowRecordPayment && !this.auth.isFirmDelegatedReadonly()
  );

  loading = signal(false);
  recordDialogVisible = false;
  private paymentsClient = signal<PaymentDto[]>([]);
  private paymentsSupplier = signal<SupplierPaymentItem[]>([]);

  paymentRows = computed<PaymentRow[]>(() => {
    const inv = this.invoice;
    if (!inv) return [];
    if (inv.type === 'client') {
      return this.paymentsClient().map(p => this.toPaymentRow(p));
    }
    return this.paymentsSupplier().map(p => this.toPaymentRowSupplier(p));
  });

  effectiveTotalPaid = computed(() => {
    const rows = this.paymentRows();
    return rows.reduce((sum, r) => sum + r.amount, 0);
  });

  effectiveRemainingAmount = computed(() => {
    const inv = this.invoice;
    if (!inv) return 0;
    return Math.max(0, inv.totalAmount - this.effectiveTotalPaid());
  });

  ngOnChanges(changes: SimpleChanges): void {
    const inv = changes['invoice']?.currentValue as InvoicePaymentsPanelContext | null;
    if (inv?.id) {
      this.loadPayments(inv);
    } else {
      this.paymentsClient.set([]);
      this.paymentsSupplier.set([]);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.invoice) {
      this.onClose();
    }
  }

  onClose(): void {
    this.closed.emit();
  }

  openRecordPaymentDialog(): void {
    if (!this.showRecordPayment()) return;
    this.recordDialogVisible = true;
  }

  onPaymentRecorded(): void {
    if (this.invoice) {
      this.loadPayments(this.invoice);
    }
    this.paymentRecorded.emit();
  }

  private loadPayments(inv: InvoicePaymentsPanelContext): void {
    this.loading.set(true);
    if (inv.type === 'client') {
      this.invoiceService.getInvoicePayments(inv.id).subscribe({
        next: res => {
          this.loading.set(false);
          this.paymentsClient.set(res.success && res.data ? res.data : []);
          this.paymentsSupplier.set([]);
        },
        error: () => {
          this.loading.set(false);
          this.paymentsClient.set([]);
        }
      });
    } else {
      this.supplierInvoiceService.getPayments(inv.id).subscribe({
        next: res => {
          this.loading.set(false);
          this.paymentsSupplier.set(res.success && res.data ? res.data : []);
          this.paymentsClient.set([]);
        },
        error: () => {
          this.loading.set(false);
          this.paymentsSupplier.set([]);
        }
      });
    }
  }

  private toPaymentRow(p: PaymentDto): PaymentRow {
    return {
      id: p.id,
      date: this.formatDate(p.paymentDate),
      amount: p.amount,
      currency: p.currency,
      methodDisplay: p.methodDisplay ?? '',
      reference: p.reference ?? null,
      notes: p.notes ?? null
    };
  }

  private toPaymentRowSupplier(p: SupplierPaymentItem): PaymentRow {
    return {
      id: p.id,
      date: this.formatDate(p.paymentDate),
      amount: p.amount,
      currency: p.currency,
      methodDisplay: p.methodDisplay ?? '',
      reference: p.reference ?? null,
      notes: p.notes ?? null
    };
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  formatAmount(amount: number): string {
    return amount.toLocaleString('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
  }
}
