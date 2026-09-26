import { Component, EventEmitter, Input, Output, inject, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { Textarea } from 'primeng/textarea';
import { OverlayOptions } from 'primeng/api';
import { ButtonComponent } from '@shared/components/button/button.component';
import { InvoiceService, RecordPaymentRequest } from '@core/services/invoice.service';
import { SupplierInvoiceService } from '@core/services/supplier-invoice.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { DrawerOverlayService } from '@core/services/drawer-overlay.service';
import { formatLocalDate } from '@core/utils/date.util';

/** Aligné sur FactuTrust.Domain.Enums.PaymentMethod.Traite. */
const TRAITE_METHOD_VALUE = 5;

const PAYMENT_METHOD_OPTIONS = [
  { label: 'Espèces', value: 0 },
  { label: 'Virement bancaire', value: 1 },
  { label: 'Chèque', value: 2 },
  { label: 'Carte bancaire', value: 3 },
  { label: 'Paiement mobile', value: 4 },
  { label: 'Traite (effet de commerce)', value: TRAITE_METHOD_VALUE },
  { label: 'Autre', value: 99 }
];

/** Aligné sur InstaFact.Domain.Enums.PaymentMethod.Cash — défaut facture client (UI). */
const DEFAULT_CLIENT_PAYMENT_METHOD = 0;

const ALLOWED_PAYMENT_METHOD_VALUES = new Set<number>(
  PAYMENT_METHOD_OPTIONS.map((o) => o.value)
);

@Component({
  selector: 'app-record-payment-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    DatePickerModule,
    SelectModule,
    Textarea,
    ButtonComponent
  ],
  template: `
    <ng-template #formContent>
      <div class="modal-content">
        <p class="dialog-intro" *ngIf="invoiceNumber">
          Facture {{ invoiceNumber }} — Montant total : {{ totalAmount | number:'1.3-3' }} {{ currency }}
          @if (totalPaid > 0) {
            <br>
            <span class="remaining-info">Restant dû : {{ remainingAmount | number:'1.3-3' }} {{ currency }}</span>
          }
        </p>

        <div class="form-fields">
          <div class="form-group">
            <label for="paymentDate">Date de paiement <span class="required" i18n="@@shared.components.record-payment-dialog.record-payment-dialog.text.df58248c">*</span></label>
            <p-datepicker
              id="paymentDate"
              [(ngModel)]="paymentDate"
              [showIcon]="true"
              dateFormat="dd/mm/yy"
              [maxDate]="maxDate"
              placeholder="Sélectionnez la date" i18n-placeholder="Sélectionnez la date"
              inputId="paymentDate"
              [appendTo]="panelMode ? 'body' : undefined"
              [baseZIndex]="panelMode ? drawerPrimeBaseZIndex : undefined"
              styleClass="w-full">
            </p-datepicker>
            <small class="field-hint" i18n="@@shared.components.record-payment-dialog.record-payment-dialog.date.a.laquelle.le.paiement.a.ete.recu.cbe00fec">Date à laquelle le paiement a été reçu</small>
          </div>

          <div class="form-group">
            <label for="amount">Montant net encaissé ({{ currency }}) <span class="required" i18n="@@shared.components.record-payment-dialog.record-payment-dialog.text.df58248c">*</span></label>
            <p-inputNumber
              id="amount"
              [(ngModel)]="amount"
              [min]="0.001"
              [max]="maxNetAmount"
              [maxFractionDigits]="3"
              [minFractionDigits]="3"
              mode="decimal"
              placeholder="Montant reçu (banque)" i18n-placeholder="Montant reçu (banque)"
              styleClass="w-full">
            </p-inputNumber>
            <small class="field-hint">{{ totalPaid > 0 ? 'Restant dû TTC : ' + (remainingAmount | number:'1.3-3') + ' ' + currency : 'Par défaut : solde TTC' }}</small>
          </div>

          @if (invoiceType === 'client') {
            <div class="form-group">
              <label for="whSubie">Retenue à la source subie ({{ currency }})</label>
              <p-inputNumber
                id="whSubie"
                [(ngModel)]="clientWithholdingAmount"
                (ngModelChange)="onWithholdingChange()"
                [min]="0"
                [max]="remainingAmount"
                [maxFractionDigits]="3"
                [minFractionDigits]="3"
                mode="decimal"
                placeholder="0 si aucune" i18n-placeholder="0 si aucune"
                styleClass="w-full">
              </p-inputNumber>
              <small class="field-hint" i18n="@@shared.components.record-payment-dialog.record-payment-dialog.montant.retenu.par.le.client.hors.export.tej.dec.702a5336">Montant retenu par le client (hors export TEJ déclarant). Net + retenue ne peut pas dépasser le restant dû.</small>
            </div>
          }

          <div class="form-group">
            <label for="method">
              Mode de paiement
              @if (invoiceType === 'client') {
                <span class="required" aria-hidden="true" i18n="@@shared.components.record-payment-dialog.record-payment-dialog.text.df58248c">*</span>
              }
            </label>
            <p-select
              id="method"
              [options]="paymentMethodOptions"
              [(ngModel)]="selectedMethod"
              placeholder="Sélectionnez un mode" i18n-placeholder="Sélectionnez un mode"
              optionLabel="label"
              optionValue="value"
              [showClear]="true"
              [appendTo]="panelMode ? 'body' : null"
              [overlayOptions]="panelMode ? drawerOverlayOptions : undefined"
              [attr.aria-invalid]="invoiceType === 'client' && selectedMethod === null"
              [attr.aria-describedby]="invoiceType === 'client' && selectedMethod === null ? 'method-required-hint' : null"
              styleClass="w-full">
            </p-select>
            @if (invoiceType === 'client' && selectedMethod === null) {
              <small id="method-required-hint" class="field-hint field-error" role="alert" i18n="@@shared.components.record-payment-dialog.record-payment-dialog.veuillez.selectionner.un.mode.de.paiement.861ed82e">Veuillez sélectionner un mode de paiement.</small>
            }
          </div>

          @if (isTraite) {
            <div class="form-group">
              <label for="effetDueDate">Échéance de la traite <span class="required" i18n="@@shared.components.record-payment-dialog.record-payment-dialog.text.df58248c">*</span></label>
              <p-datepicker
                id="effetDueDate"
                [(ngModel)]="effetDueDate"
                [showIcon]="true"
                dateFormat="dd/mm/yy"
                placeholder="Date d'échéance de l'effet" i18n-placeholder="Date d'échéance de l'effet"
                inputId="effetDueDate"
                [appendTo]="panelMode ? 'body' : undefined"
                [baseZIndex]="panelMode ? drawerPrimeBaseZIndex : undefined"
                styleClass="w-full">
              </p-datepicker>
              <small class="field-hint" i18n="@@shared.components.record-payment-dialog.record-payment-dialog.date.a.laquelle.l.effet.arrivera.a.echeance.enca.212b4555">Date à laquelle l'effet arrivera à échéance (encaissement/paiement)</small>
              @if (effetDueDate === null) {
                <small class="field-hint field-error" role="alert" i18n="@@shared.components.record-payment-dialog.record-payment-dialog.l.echeance.de.la.traite.est.obligatoire.35bbf8eb">L'échéance de la traite est obligatoire.</small>
              }
            </div>
          }

          <div class="form-group">
            <label for="reference">{{ isTraite ? 'N° de l\'effet' : 'Référence de paiement' }}</label>
            <input
              pInputText
              id="reference"
              [(ngModel)]="reference"
              [placeholder]="invoiceType === 'supplier' ? 'Ex: virement, chèque n°…' : 'Ex: n° chèque, n° virement'"
              class="w-full">
            <small class="field-hint" i18n="@@shared.components.record-payment-dialog.record-payment-dialog.optionnel.n.de.cheque.virement.etc.6a50a6f2">Optionnel — N° de chèque, virement, etc.</small>
          </div>

          <div class="form-group">
            <label for="notes" i18n="@@shared.components.record-payment-dialog.record-payment-dialog.notes.70440046">Notes</label>
            <textarea
              pTextarea
              id="notes"
              [(ngModel)]="notes"
              placeholder="Notes internes (optionnel)" i18n-placeholder="Notes internes (optionnel)"
              [rows]="2"
              class="w-full">
            </textarea>
          </div>
        </div>

        @if (errorMessage()) {
          <div class="error-message" role="alert">
            <i class="pi pi-exclamation-triangle"></i>
            {{ errorMessage() }}
          </div>
        }
      </div>
    </ng-template>

    <ng-template #footerActions>
      <app-button variant="outline" icon="pi-times" iconPos="left" (click)="close()" i18n="@@shared.components.record-payment-dialog.record-payment-dialog.annuler.49ba3292">Annuler</app-button>
      <app-button
        variant="primary"
        icon="pi-check"
        iconPos="left"
        [disabled]="submitting() || !isValid()"
        (click)="submit()">
        {{ submitting() ? 'Enregistrement...' : 'Enregistrer le paiement' }}
      </app-button>
    </ng-template>

    @if (panelMode && visible) {
      <div class="panel-overlay" (click)="close()" role="presentation">
        <div
          class="panel-content"
          (click)="$event.stopPropagation()"
          role="dialog"
          [attr.aria-label]="dialogTitle"
          aria-modal="true">
          <div class="panel-header">
            <h2 class="panel-title" id="record-payment-panel-title">{{ dialogTitle }}</h2>
            <button
              type="button"
              class="panel-close"
              (click)="close()"
              aria-label="Fermer le panneau" i18n-aria-label="Fermer le panneau">
              <i class="pi pi-times"></i>
            </button>
          </div>
          <div class="panel-body">
            <ng-container *ngTemplateOutlet="formContent"></ng-container>
          </div>
          <div class="panel-footer">
            <ng-container *ngTemplateOutlet="footerActions"></ng-container>
          </div>
        </div>
      </div>
    }

    @if (!panelMode) {
      <p-dialog
        [header]="dialogTitle"
        [(visible)]="visible"
        [modal]="true"
        [style]="{ width: '480px' }"
        [draggable]="false"
        [closable]="true"
        (onHide)="onHide()"
        [contentStyle]="{ overflow: 'visible' }">
        <ng-container *ngTemplateOutlet="formContent"></ng-container>
        <ng-template pTemplate="footer">
          <div class="dialog-footer">
            <ng-container *ngTemplateOutlet="footerActions"></ng-container>
          </div>
        </ng-template>
      </p-dialog>
    }
  `,
  styles: [`
    .modal-content {
      padding: var(--spacing-5) var(--spacing-6);
    }

    .panel-body .modal-content {
      padding: 0;
    }

    .dialog-intro {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin: 0 0 var(--spacing-4) 0;
      padding: var(--spacing-3) var(--spacing-4);
      background: var(--color-background-elevated, #fff);
      border: 1px solid var(--color-border-subtle);
      border-left: 4px solid var(--color-primary-500);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-sm);
    }

    .remaining-info {
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
    }

    .form-fields {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .form-group label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .form-group label .required {
      color: var(--color-error-600);
    }

    .field-hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      margin-top: 2px;
    }

    .field-error {
      color: var(--color-error-700);
      font-weight: var(--font-weight-medium);
    }

    .w-full {
      width: 100%;
    }

    .error-message {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-3);
      background: var(--color-error-50);
      border: 1px solid var(--color-error-200);
      border-radius: var(--radius-md);
      color: var(--color-error-700);
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-4);
    }

    .error-message i {
      flex-shrink: 0;
    }

    .dialog-footer,
    .panel-footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-3);
    }

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
      width: min(520px, 100vw);
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

    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-5);
      min-height: 0;
    }

    .panel-footer {
      gap: var(--spacing-4);
      padding: var(--spacing-4) var(--spacing-5);
      padding-bottom: calc(var(--spacing-4) + env(safe-area-inset-bottom, 0px));
      border-top: 1px solid var(--color-border-subtle);
      background: var(--color-background-subtle);
      flex-shrink: 0;
    }

    @keyframes panelFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes panelSlideInRight {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }

    :host ::ng-deep {
      .p-dialog {
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-xl);
        overflow: hidden;
      }

      .p-dialog-content {
        border-radius: 0;
        padding: 0;
      }

      .p-dialog-header {
        padding: var(--spacing-4) var(--spacing-6);
        border-bottom: 1px solid var(--color-border-subtle);
        background: var(--color-background-elevated);
      }

      .p-dialog-header .p-dialog-title {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }

      .p-dialog-footer {
        padding: var(--spacing-4) var(--spacing-6);
        border-top: 1px solid var(--color-border-subtle);
        background: var(--color-background-subtle);
      }

      .p-datepicker,
      .p-select,
      .p-inputnumber {
        width: 100%;
      }
    }
  `]
})
export class RecordPaymentDialogComponent {
  @Input() panelMode = false;
  @Input() invoiceId = '';
  @Input() invoiceNumber = '';
  @Input() totalAmount = 0;
  @Input() totalPaid = 0;
  @Input() remainingAmount = 0;
  @Input() currency = 'TND';
  @Input() invoiceType: 'client' | 'supplier' = 'client';

  @Input() set visible(value: boolean) {
    const wasVisible = this._visible;
    this._visible = value;
    if (value && !wasVisible) {
      if (this.panelMode) {
        this.drawerOverlay.registerOpen();
      }
      if (this.invoiceId) {
        this.resetForm();
      }
    } else if (!value && wasVisible && this.panelMode) {
      this.drawerOverlay.registerClose();
    }
  }
  get visible(): boolean {
    return this._visible;
  }
  private _visible = false;

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() paymentRecorded = new EventEmitter<void>();

  private invoiceService = inject(InvoiceService);
  private supplierInvoiceService = inject(SupplierInvoiceService);
  private readonly auth = inject(AuthService);
  private readonly toastService = inject(ToastService);
  readonly drawerOverlay = inject(DrawerOverlayService);

  readonly drawerOverlayOptions: OverlayOptions = { baseZIndex: 1200 };
  readonly drawerPrimeBaseZIndex = 1200;

  paymentDate: Date = new Date();
  amount = 0;
  clientWithholdingAmount = 0;
  selectedMethod: number | null = null;
  effetDueDate: Date | null = null;
  reference = '';
  notes = '';
  submitting = signal(false);
  errorMessage = signal('');

  readonly paymentMethodOptions = PAYMENT_METHOD_OPTIONS;
  readonly maxDate = new Date();

  get dialogTitle(): string {
    return this.invoiceType === 'client' ? 'Enregistrer un paiement' : 'Payer la facture';
  }

  /** Vrai lorsque le mode sélectionné est la traite (effet de commerce). */
  get isTraite(): boolean {
    return this.selectedMethod === TRAITE_METHOD_VALUE;
  }

  get maxNetAmount(): number {
    const w = this.invoiceType === 'client' ? (this.clientWithholdingAmount ?? 0) : 0;
    return Math.max(0.001, this.remainingAmount - w);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.panelMode && this.visible) {
      this.close();
    }
  }

  private resetForm(): void {
    this.paymentDate = new Date();
    this.clientWithholdingAmount = 0;
    this.amount = this.remainingAmount > 0 ? this.remainingAmount : this.totalAmount;
    this.selectedMethod =
      this.invoiceType === 'client' ? DEFAULT_CLIENT_PAYMENT_METHOD : null;
    this.effetDueDate = null;
    this.reference = '';
    this.notes = '';
    this.errorMessage.set('');
  }

  isValid(): boolean {
    if (!this.paymentDate) return false;
    if (this.amount <= 0) return false;
    const w = this.invoiceType === 'client' ? (this.clientWithholdingAmount ?? 0) : 0;
    if (w < 0) return false;
    if (this.amount + w > this.remainingAmount + 0.0005) return false;
    if (this.invoiceType === 'client') {
      if (this.selectedMethod === null) return false;
      if (!ALLOWED_PAYMENT_METHOD_VALUES.has(this.selectedMethod)) return false;
    }
    // Une traite exige une échéance (côté client comme fournisseur).
    if (this.isTraite && !this.effetDueDate) return false;
    return true;
  }

  onWithholdingChange(): void {
    if (this.amount > this.maxNetAmount) {
      this.amount = Math.round(this.maxNetAmount * 1000) / 1000;
    }
  }

  close(): void {
    this.visible = false;
    this.visibleChange.emit(false);
  }

  onHide(): void {
    this.visibleChange.emit(false);
  }

  submit(): void {
    if (this.submitting()) return;

    if (this.auth.isFirmDelegatedReadonly()) {
      this.toastService.add({
        severity: 'warn',
        summary: 'Lecture seule',
        detail: 'L\'enregistrement de paiements est interdit en mode dossier client pour le cabinet comptable.'
      });
      return;
    }

    if (this.invoiceType === 'client') {
      if (this.selectedMethod === null || !ALLOWED_PAYMENT_METHOD_VALUES.has(this.selectedMethod)) {
        this.errorMessage.set('Veuillez sélectionner un mode de paiement.');
        return;
      }
    }

    if (this.isTraite && !this.effetDueDate) {
      this.errorMessage.set('Veuillez saisir l\'échéance de la traite.');
      return;
    }

    if (!this.isValid()) return;

    this.errorMessage.set('');
    this.submitting.set(true);

    if (this.invoiceType === 'client') {
      this.submitClientPayment();
    } else {
      this.submitSupplierPayment();
    }
  }

  private submitClientPayment(): void {
    const w = this.clientWithholdingAmount ?? 0;
    const request: RecordPaymentRequest = {
      paymentDate: this.formatDate(this.paymentDate),
      amount: this.amount,
      method: this.selectedMethod!,
      reference: this.reference.trim() || undefined,
      notes: this.notes.trim() || undefined,
      ...(w > 0 ? { clientWithholdingAmount: w } : {}),
      ...(this.isTraite && this.effetDueDate ? { effetDueDate: this.formatDate(this.effetDueDate) } : {})
    };

    this.invoiceService.recordPayment(this.invoiceId, request).subscribe({
      next: (response) => {
        this.submitting.set(false);
        if (response.success) {
          this.paymentRecorded.emit();
          this.close();
        } else {
          this.errorMessage.set(this.getErrorMessage({ error: response }, 'Erreur lors de l\'enregistrement du paiement'));
        }
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(this.getErrorMessage(err, 'Erreur lors de l\'enregistrement du paiement'));
      }
    });
  }

  private submitSupplierPayment(): void {
    const request = {
      paymentDate: this.formatDate(this.paymentDate),
      amount: this.amount,
      method: this.selectedMethod ?? undefined,
      reference: this.reference.trim() || undefined,
      notes: this.notes.trim() || undefined,
      ...(this.isTraite && this.effetDueDate ? { effetDueDate: this.formatDate(this.effetDueDate) } : {})
    };

    this.supplierInvoiceService.recordPayment(this.invoiceId, request).subscribe({
      next: (response) => {
        this.submitting.set(false);
        if (response.success) {
          this.paymentRecorded.emit();
          this.close();
        } else {
          this.errorMessage.set(this.getErrorMessage({ error: response }, 'Erreur lors de l\'enregistrement'));
        }
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(this.getErrorMessage(err, 'Erreur lors de l\'enregistrement'));
      }
    });
  }

  private formatDate(d: Date): string {
    return formatLocalDate(d);
  }

  /**
   * Extrait le message d'erreur de la réponse HTTP de manière robuste.
   * Gère les formats ApiResponse (message, errors) et les erreurs ASP.NET (title, detail).
   */
  private getErrorMessage(err: unknown, fallback: string): string {
    const body = err && typeof err === 'object' && 'error' in err
      ? (err as { error?: unknown }).error
      : err;
    if (body && typeof body === 'object') {
      const rec = body as Record<string, unknown>;
      const msg = rec['message'] ?? rec['title'];
      if (typeof msg === 'string' && msg.trim()) return msg;
      const errors = rec['errors'];
      if (Array.isArray(errors) && errors[0] && typeof errors[0] === 'string') return errors[0];
      const detail = rec['detail'];
      if (typeof detail === 'string' && detail.trim()) return detail;
    }
    return fallback;
  }
}
