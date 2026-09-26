import { Component, inject, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { PosStateService } from '../../services/pos-state.service';
import { PaymentMethod } from '../../../invoices/invoice-wizard/models/invoice-wizard.models';
import { SplitPaymentComponent } from '../split-payment/split-payment.component';
import {
  RefundInvoiceIdDialogComponent,
  REFUND_INVOICE_DIALOG_OPTIONS
} from '@shared/components/refund-invoice-id-dialog/refund-invoice-id-dialog.component';
import { LinkedInvoiceRef } from '@core/services/invoice-reference-resolver.service';

@Component({
  selector: 'app-payment-actions',
  standalone: true,
  imports: [CommonModule, SplitPaymentComponent],
  template: `
    <div class="payment-actions">
      <!-- Payment Method or Split -->
      @if (posState.canValidate()) {
        @if (posState.isSplitPayment()) {
          <app-split-payment />
        } @else {
        <div class="payment-actions__methods">
          @for (method of paymentMethods; track method.value) {
            <button
              class="payment-actions__method"
              [class.payment-actions__method--active]="posState.paymentMethod() === method.value"
              (click)="posState.setPaymentMethod(method.value)"
              [title]="method.label">
              <i [class]="method.icon || 'pi pi-money-bill'"></i>
              <span>{{ method.shortLabel }}</span>
            </button>
          }
        </div>
        <button
          type="button"
          class="payment-actions__split-toggle"
          (click)="posState.enableSplitPayment()">
          <i class="pi pi-wallet"></i> Paiement fractionné
        </button>
        }
        <div class="payment-actions__print-mode">
          <button
            type="button"
            class="payment-actions__print-btn"
            [class.payment-actions__print-btn--active]="posState.printMode() === 'pdf'"
            (click)="posState.setPrintMode('pdf')"
            title="PDF" i18n-title="PDF"
            aria-label="Mode PDF" i18n-aria-label="Mode PDF">
            <i class="pi pi-file-pdf"></i>
          </button>
          <button
            type="button"
            class="payment-actions__print-btn"
            [class.payment-actions__print-btn--active]="posState.printMode() === 'receipt'"
            (click)="posState.setPrintMode('receipt')"
            title="Ticket thermique" i18n-title="Ticket thermique"
            aria-label="Ticket thermique" i18n-aria-label="Ticket thermique">
            <i class="pi pi-list"></i>
          </button>
          <button
            type="button"
            class="payment-actions__print-btn"
            [class.payment-actions__print-btn--active]="posState.printMode() === 'both'"
            (click)="posState.setPrintMode('both')"
            title="PDF + Ticket" i18n-title="PDF + Ticket"
            aria-label="PDF et ticket" i18n-aria-label="PDF et ticket">
            <i class="pi pi-print"></i>
          </button>
        </div>
      }


      <!-- Primary Action: Validate & Print -->
      <button
        class="payment-actions__primary"
        [class.payment-actions__primary--loading]="posState.isProcessing()"
        [class.payment-actions__primary--quick]="posState.isQuickMode()"
        [class.payment-actions__primary--credit]="posState.isCreditNote()"
        [disabled]="!posState.canValidate() || posState.isProcessing()"
        [attr.aria-busy]="posState.isProcessing()"
        aria-live="polite"
        (click)="onValidate.emit()"
        type="button">
        @if (posState.isProcessing()) {
          <i class="pi pi-spin pi-spinner"></i>
          <span i18n="@@pos.components.traitement.en.cours.7acd4176">Traitement en cours...</span>
        } @else if (posState.isCreditNote()) {
          <i class="pi pi-file-edit payment-actions__primary-icon"></i>
          <span class="payment-actions__primary-text" i18n="@@pos.components.creer.avoir.f5.46aefca5">Creer Avoir (F5)</span>
        } @else {
          <i class="pi pi-print payment-actions__primary-icon"></i>
          <span class="payment-actions__primary-text" i18n="@@pos.components.valider.imprimer.f5.a59cb971">Valider & Imprimer (F5)</span>
          <span class="payment-actions__primary-check">
            <i class="pi pi-check"></i>
          </span>
        }
      </button>

      <!-- Secondary Actions -->
      <div class="payment-actions__secondary">
        @if (!posState.isQuickMode()) {
        <button
          class="payment-actions__btn-secondary"
          [disabled]="!posState.canSaveDraft() || posState.isProcessing()"
          (click)="onSaveDraft.emit()"
          type="button">
          <i class="pi pi-save"></i>
          <span i18n="@@pos.components.brouillon.57d2d7a7">Brouillon</span>
        </button>
        <button
          class="payment-actions__btn-secondary"
          [disabled]="!posState.canValidate() || posState.isProcessing()"
          (click)="onSendEmail.emit()"
          type="button">
          <i class="pi pi-envelope"></i>
          <span i18n="@@pos.components.email.84add5b2">Email</span>
        </button>
        }
        <button
          class="payment-actions__btn-secondary"
          [disabled]="posState.lines().length === 0 || posState.isProcessing()"
          (click)="onHold.emit()"
          type="button">
          <i class="pi pi-pause"></i>
          <span i18n="@@pos.components.mettre.en.attente.3adee259">Mettre en attente</span>
        </button>
        <button
          class="payment-actions__btn-danger"
          [disabled]="posState.lines().length === 0 || posState.isProcessing()"
          (click)="onCancel.emit()"
          type="button">
          <i class="pi pi-trash"></i>
          <span i18n="@@pos.components.vider.13901111">Vider</span>
        </button>
        @if (posState.isCreditNote()) {
          <button
            class="payment-actions__btn-warning"
            type="button"
            (click)="posState.disableCreditNoteMode()">
            <i class="pi pi-times"></i>
            <span i18n="@@pos.components.annuler.avoir.0c4de98d">Annuler avoir</span>
          </button>
        } @else {
          <button
            class="payment-actions__btn-secondary"
            type="button"
            (click)="openRefundInvoiceIdDialog()">
            <i class="pi pi-file-edit"></i>
            <span i18n="@@pos.components.avoir.8ee24717">Avoir</span>
          </button>
        }
      </div>

      <!-- Error Display -->
      @if (posState.lastError()) {
        <div class="payment-actions__error">
          <i class="pi pi-exclamation-triangle"></i>
          <span>{{ posState.lastError() }}</span>
          <button class="payment-actions__error-close" (click)="posState.setError(null)">
            <i class="pi pi-times"></i>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .payment-actions .pi,
    .payment-actions i.pi {
      font-family: 'primeicons' !important;
      display: inline-block;
      line-height: 1;
    }

    .payment-actions {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }



    .payment-actions__methods {
      display: flex;
      padding: var(--spacing-1);
      background: var(--pos-cmd-methods-bg);
      border-radius: var(--radius-2xl);
      gap: var(--spacing-1);
    }

    .payment-actions__method {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-1);
      padding: var(--spacing-2) var(--spacing-3);
      border: none;
      border-radius: var(--radius-xl);
      background: transparent;
      color: var(--color-neutral-700);
      font-size: var(--font-size-xs);
      font-family: var(--font-family);
      cursor: pointer;
      transition: all var(--transition-normal);
      flex: 1;
      justify-content: center;
    }

    .payment-actions__method i {
      font-size: 1.125rem;
      color: inherit;
      font-family: 'primeicons';
    }

    .payment-actions__method:hover:not(:disabled) {
      background: var(--color-white);
      color: var(--color-neutral-800);
      box-shadow: var(--shadow-xs);
    }

    .payment-actions__method--active {
      background: var(--color-white);
      color: var(--color-text-primary);
      font-weight: var(--font-weight-semibold);
      box-shadow: var(--shadow-sm);
    }

    .payment-actions__method--active i {
      color: var(--color-success-600);
    }

    .payment-actions__method:focus-visible {
      outline: 3px solid var(--color-primary-400);
      outline-offset: 2px;
    }

    .payment-actions__print-mode {
      display: flex;
      gap: var(--spacing-1);
    }

    .payment-actions__print-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      background: var(--color-white);
      color: var(--color-neutral-700);
      cursor: pointer;
      transition: all var(--transition-normal);
    }

    .payment-actions__print-btn i {
      font-size: 1.125rem;
      color: inherit;
      font-family: 'primeicons';
    }

    .payment-actions__print-btn:hover:not(:disabled) {
      background: var(--color-neutral-50);
      color: var(--color-text-primary);
      border-color: var(--color-border-strong);
    }

    .payment-actions__print-btn--active {
      background: var(--color-primary-100);
      color: var(--color-primary-600);
      border-color: var(--color-primary-300);
    }

    .payment-actions__print-btn--active i {
      color: var(--color-primary-600);
    }

    .payment-actions__print-btn:focus-visible {
      outline: 3px solid var(--color-primary-400);
      outline-offset: 2px;
    }

    .payment-actions__split-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      width: 100%;
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px dashed var(--color-border-default);
      border-radius: var(--radius-lg);
      background: transparent;
      color: var(--color-neutral-700);
      font-size: var(--font-size-sm);
      cursor: pointer;
      margin-top: var(--spacing-2);
      transition: all var(--transition-normal);
    }

    .payment-actions__split-toggle i {
      font-size: 1rem;
      font-family: 'primeicons';
    }

    .payment-actions__split-toggle:hover {
      border-color: var(--color-primary-300);
      color: var(--color-primary-600);
      background: var(--color-primary-50);
    }

    .payment-actions__split-toggle:focus-visible {
      outline: 3px solid var(--color-primary-400);
      outline-offset: 2px;
    }

    .payment-actions__primary {
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      height: 54px;
      padding: 0 var(--spacing-5);
      border: none;
      border-radius: var(--radius-2xl);
      background: var(--pos-cmd-primary-gradient);
      color: var(--color-white);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-bold);
      font-family: var(--font-family);
      letter-spacing: 0.02em;
      cursor: pointer;
      transition: all var(--pos-transition-smooth);
      box-shadow: var(--pos-cmd-primary-shadow);
    }

    .payment-actions__primary:hover:not(:disabled) {
      box-shadow: var(--pos-cmd-primary-shadow-hover);
      transform: translateY(-2px);
    }

    .payment-actions__primary:active:not(:disabled) {
      transform: translateY(0) scale(0.98);
    }

    .payment-actions__primary:focus-visible {
      outline: none;
      box-shadow: var(--pos-cmd-primary-shadow), 0 0 0 3px var(--color-white), 0 0 0 6px var(--color-primary-500);
    }

    .payment-actions__primary-icon {
      font-size: 1.15rem;
      color: var(--color-white);
      flex-shrink: 0;
      font-family: 'primeicons';
    }

    .payment-actions__primary-text {
      flex: 1;
      text-align: center;
    }

    .payment-actions__primary-check {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--radius-full);
      background: rgba(255, 255, 255, 0.3);
      flex-shrink: 0;
    }

    .payment-actions__primary-check i {
      font-size: 0.875rem;
      color: var(--color-white);
      font-family: 'primeicons';
    }

    .payment-actions__primary--loading {
      justify-content: center;
      gap: var(--spacing-2);
    }

    .payment-actions__primary--loading .pi-spinner {
      font-size: 1.25rem;
      color: var(--color-white);
      font-family: 'primeicons';
    }

    .payment-actions__primary--loading::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      height: 3px;
      background: rgba(255, 255, 255, 0.6);
      animation: paymentPrimaryProgress 3s linear infinite;
    }

    @keyframes paymentPrimaryProgress {
      0% { width: 0; }
      100% { width: 100%; }
    }

    .payment-actions__primary--loading {
      animation: pulseSubtle 1.5s ease-in-out infinite;
    }

    .payment-actions__primary--quick {
      min-height: 56px;
      font-size: var(--font-size-lg);
    }

    .payment-actions__primary--credit {
      background: var(--pos-cmd-credit-gradient);
    }

    .payment-actions__primary--credit:hover:not(:disabled) {
      background: var(--pos-cmd-credit-gradient-hover);
    }

    .payment-actions__btn-warning {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-4);
      border: 1px solid var(--color-warning-200);
      border-radius: var(--radius-lg);
      background: var(--color-warning-100);
      color: var(--color-warning-700);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      font-family: var(--font-family);
      cursor: pointer;
      transition: all var(--transition-normal);
    }

    .payment-actions__btn-warning:hover {
      background: var(--color-warning-200);
      border-color: var(--color-warning-500);
      color: var(--color-warning-700);
    }

    .payment-actions__btn-warning i {
      color: inherit;
      flex-shrink: 0;
      font-size: 1rem;
      font-family: 'primeicons';
    }

    .payment-actions__btn-warning:focus-visible {
      outline: 3px solid var(--color-warning-500);
      outline-offset: 2px;
    }

    .payment-actions__primary:disabled {
      background: var(--color-neutral-300);
      cursor: not-allowed;
      box-shadow: none;
    }

    .payment-actions__secondary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
      gap: var(--spacing-2);
    }

    .payment-actions__secondary .payment-actions__btn-secondary,
    .payment-actions__secondary .payment-actions__btn-danger,
    .payment-actions__secondary .payment-actions__btn-warning {
      min-width: 0;
    }

    .payment-actions__secondary .payment-actions__btn-secondary span,
    .payment-actions__secondary .payment-actions__btn-danger span,
    .payment-actions__secondary .payment-actions__btn-warning span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .payment-actions__btn-secondary {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      flex: 1;
      height: 40px;
      padding: 0 var(--spacing-4);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-2xl);
      background: var(--color-white);
      color: var(--color-neutral-800);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      font-family: var(--font-family);
      cursor: pointer;
      transition: all var(--transition-normal);
    }

    .payment-actions__btn-secondary i {
      font-size: 1rem;
      color: inherit;
      flex-shrink: 0;
      font-family: 'primeicons';
    }

    .payment-actions__btn-secondary:hover:not(:disabled) {
      background: var(--color-neutral-50);
      border-color: var(--color-border-strong);
      color: var(--color-primary-600);
      box-shadow: var(--shadow-sm);
    }

    .payment-actions__btn-secondary:focus-visible {
      outline: 3px solid var(--color-primary-400);
      outline-offset: 2px;
    }

    .payment-actions__btn-secondary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .payment-actions__btn-danger {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      flex: 1;
      height: 40px;
      padding: 0 var(--spacing-4);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-2xl);
      background: var(--color-white);
      color: var(--color-error-600);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      font-family: var(--font-family);
      cursor: pointer;
      transition: all var(--transition-normal);
    }

    .payment-actions__btn-danger i {
      font-size: 1rem;
      color: inherit;
      flex-shrink: 0;
      font-family: 'primeicons';
    }

    .payment-actions__btn-danger:hover:not(:disabled) {
      background: var(--color-error-50);
      border-color: var(--color-error-300);
      color: var(--color-error-700);
      box-shadow: 0 2px 8px rgba(220, 38, 38, 0.12);
    }

    .payment-actions__btn-danger:hover:not(:disabled) i {
      color: inherit;
    }

    .payment-actions__btn-danger:focus-visible {
      outline: 3px solid var(--color-error-500);
      outline-offset: 2px;
    }

    .payment-actions__btn-danger:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .payment-actions__btn-danger:disabled i {
      color: inherit;
    }

    .payment-actions__error {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      background: var(--color-error-100);
      border: 1px solid var(--color-error-200);
      border-left: 3px solid var(--color-error-500);
      border-radius: var(--radius-xl);
      animation: paymentErrorShake 400ms ease-out forwards;
    }

    @keyframes paymentErrorShake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-2px); }
      40% { transform: translateX(2px); }
      60% { transform: translateX(-1px); }
      80% { transform: translateX(1px); }
    }

    .payment-actions__error i:first-child {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: var(--radius-full);
      background: var(--color-error-200);
      color: var(--color-error-600);
      font-size: 1rem;
      flex-shrink: 0;
      font-family: 'primeicons';
    }

    .payment-actions__error span {
      flex: 1;
      font-size: var(--font-size-sm);
      color: var(--color-error-700);
    }

    .payment-actions__error-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--color-error-500);
      cursor: pointer;
      font-size: 0.875rem;
      flex-shrink: 0;
      transition: all var(--transition-normal);
    }

    .payment-actions__error-close i {
      font-family: 'primeicons';
    }

    .payment-actions__error-close:hover {
      background: var(--color-error-200);
      color: var(--color-error-700);
    }

    .payment-actions__error-close:focus-visible {
      outline: 3px solid var(--color-error-500);
      outline-offset: 2px;
    }

    @media (max-width: 768px) {
      .payment-actions__method {
        min-height: 44px;
      }

      .payment-actions__primary {
        min-height: 52px;
      }

      .payment-actions__btn-secondary,
      .payment-actions__btn-danger {
        min-height: 44px;
      }
    }
  `]
})
export class PaymentActionsComponent {
  @Output() onValidate = new EventEmitter<void>();
  @Output() onSaveDraft = new EventEmitter<void>();
  @Output() onSendEmail = new EventEmitter<void>();
  @Output() onHold = new EventEmitter<void>();
  @Output() onCancel = new EventEmitter<void>();
  @Output() creditNoteInvoiceSelected = new EventEmitter<LinkedInvoiceRef>();

  readonly posState = inject(PosStateService);
  private readonly ngbModal = inject(NgbModal);

  readonly paymentMethods = [
    { value: PaymentMethod.Cash, label: 'Espèces', shortLabel: 'Espèces', icon: 'pi pi-money-bill' },
    { value: PaymentMethod.Card, label: 'Carte bancaire', shortLabel: 'Carte', icon: 'pi pi-credit-card' },
    { value: PaymentMethod.BankTransfer, label: 'Virement', shortLabel: 'Virement', icon: 'pi pi-building' },
    { value: PaymentMethod.Check, label: 'Chèque', shortLabel: 'Chèque', icon: 'pi pi-file' },
    { value: PaymentMethod.Effect, label: 'Effet', shortLabel: 'Effet', icon: 'pi pi-book' }
  ];

  openRefundInvoiceIdDialog(): void {
    const ref = this.ngbModal.open(RefundInvoiceIdDialogComponent, REFUND_INVOICE_DIALOG_OPTIONS);
    ref.result.then(
      (linkedInvoice: LinkedInvoiceRef) => {
        if (linkedInvoice?.id) {
          this.creditNoteInvoiceSelected.emit(linkedInvoice);
        }
      },
      () => { }
    ).catch(() => { });
  }
}
