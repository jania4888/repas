import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  computed,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DISMISS_REASON_CODES, DismissReasonCode } from '../../models/forecasting.models';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';

/**
 * Modal that forces the user to pick a standardised reason before dismissing a recommendation
 * (fix F-M7). Selecting "Other" reveals a free-text field that becomes mandatory in that branch.
 *
 * Emits {@link confirm} with the final string passed to <c>POST /v2/{id}/dismiss</c>.
 * Backed by Angular signals + OnPush change detection for tight rendering.
 *
 * Accessibility (WCAG 2.1 AA):
 *   • <c>role="dialog"</c> + <c>aria-modal="true"</c> + labelled by <c>aria-labelledby</c>
 *   • <c>Escape</c> closes the modal (host listener)
 *   • Backdrop click closes (with stop-propagation on the panel)
 *   • Confirm button is disabled until a valid reason is composed
 */
@Component({
  selector: 'app-dismiss-reason-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, FocusTrapDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (click)="onCancel()" role="presentation">
      <div
        class="modal-panel"
        appFocusTrap
        (click)="$event.stopPropagation()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dismiss-modal-title">
        <header class="modal-header">
          <div>
            <h3 id="dismiss-modal-title" i18n="@@forecasting.components.ecarter.la.recommandation.e44fd9e5">Écarter la recommandation</h3>
            <span class="modal-subtitle" *ngIf="productName">{{ productName }}</span>
          </div>
          <button class="close-btn" type="button" (click)="onCancel()" aria-label="Fermer" i18n-aria-label="Fermer">
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </header>

        <div class="modal-body">
          <p class="hint" i18n="@@forecasting.components.indiquez.pourquoi.cette.recommandation.est.ecart.d7371962">Indiquez pourquoi cette recommandation est écartée. Cette information est conservée
            dans l'historique des décisions et accessible aux auditeurs.</p>

          <label class="field">
            <span class="field-label">Raison <span class="required" aria-hidden="true" i18n="@@forecasting.components.text.df58248c">*</span></span>
            <select
              [(ngModel)]="selectedCode"
              (ngModelChange)="onSelectCode($event)"
              aria-required="true">
              @for (code of reasonCodes; track code) {
                <option [value]="code">{{ codeLabel(code) }}</option>
              }
            </select>
          </label>

          @if (selectedCode() === 'Other') {
            <label class="field">
              <span class="field-label">Précisez <span class="required" aria-hidden="true" i18n="@@forecasting.components.text.df58248c">*</span></span>
              <textarea
                [(ngModel)]="customText"
                (ngModelChange)="customText.set($event)"
                maxlength="500"
                rows="3"
                aria-required="true"
                placeholder="Saisissez la raison du rejet (max 500 caractères)…" i18n-placeholder="Saisissez la raison du rejet (max 500 caractères)…">
              </textarea>
            </label>
          }

          @if (showValidationError()) {
            <p class="error" role="alert" i18n="@@forecasting.components.la.raison.du.rejet.est.obligatoire.veuillez.choi.ff21bb63">La raison du rejet est obligatoire. Veuillez choisir une option ou détailler votre motif.</p>
          }
        </div>

        <footer class="modal-footer">
          <button class="btn btn-secondary" type="button" (click)="onCancel()" i18n="@@forecasting.components.annuler.49ba3292">Annuler</button>
          <button
            class="btn btn-danger"
            type="button"
            (click)="onConfirm()"
            [disabled]="!canConfirm()" i18n="@@forecasting.components.confirmer.l.abandon.130aa235">Confirmer l'abandon</button>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .modal-panel { background: white; border-radius: 10px; width: 100%; max-width: 480px; box-shadow: 0 20px 60px rgba(0,0,0,.18); display: flex; flex-direction: column; max-height: 90vh; }
    .modal-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 1.25rem 1.25rem .75rem; border-bottom: 1px solid var(--color-neutral-200, #e5e7eb); }
    .modal-header h3 { margin: 0 0 .15rem; font-size: 1.1rem; font-weight: 600; color: var(--color-neutral-900, #111827); }
    .modal-subtitle { font-size: .8rem; color: var(--color-neutral-500, #9ca3af); }
    .close-btn { background: none; border: none; cursor: pointer; padding: .25rem .5rem; color: var(--color-neutral-400, #9ca3af); font-size: 1.1rem; }
    .close-btn:hover { color: var(--color-neutral-700, #374151); }
    .modal-body { padding: 1rem 1.25rem; overflow-y: auto; }
    .hint { margin: 0 0 1rem; color: var(--color-neutral-600, #6b7280); font-size: .9rem; }
    .field { display: flex; flex-direction: column; gap: .35rem; margin-bottom: 1rem; font-size: .9rem; }
    .field-label { color: var(--color-neutral-700, #374151); font-weight: 500; }
    .field select, .field textarea { padding: .5rem .65rem; border: 1px solid var(--color-neutral-300, #d1d5db); border-radius: 6px; font: inherit; resize: vertical; }
    .field select:focus, .field textarea:focus { outline: 2px solid var(--color-primary-400, #60a5fa); outline-offset: 1px; }
    .required { color: var(--color-danger-600, #dc2626); }
    .error { margin: .25rem 0 0; padding: .5rem .75rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; color: #991b1b; font-size: .85rem; }
    .modal-footer { display: flex; justify-content: flex-end; gap: .5rem; padding: .75rem 1.25rem 1rem; border-top: 1px solid var(--color-neutral-200, #e5e7eb); }
    .btn { padding: .5rem 1rem; border-radius: 6px; border: 1px solid transparent; cursor: pointer; font-size: .9rem; font-weight: 500; }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .btn-secondary { background: white; border-color: var(--color-neutral-300, #d1d5db); color: var(--color-neutral-800, #1f2937); }
    .btn-secondary:hover:not(:disabled) { background: var(--color-neutral-50, #f9fafb); }
    .btn-danger { background: var(--color-danger-600, #dc2626); color: white; }
    .btn-danger:hover:not(:disabled) { background: var(--color-danger-700, #b91c1c); }
  `]
})
export class DismissReasonModalComponent {
  /** Optional product name displayed in the modal header for context. */
  @Input() productName?: string | null;

  /** Emitted with the resolved reason string when the user confirms. */
  @Output() confirm = new EventEmitter<string>();

  /** Emitted when the user closes (cancel/Escape/backdrop). */
  @Output() cancel = new EventEmitter<void>();

  readonly reasonCodes = DISMISS_REASON_CODES;
  readonly selectedCode = signal<DismissReasonCode>('SupplierUnavailable');
  readonly customText = signal<string>('');
  readonly submitAttempted = signal<boolean>(false);

  /** Computed resolved reason: standardised label OR custom text. Empty when invalid. */
  readonly resolvedReason = computed(() => {
    const code = this.selectedCode();
    if (code === 'Other') {
      const txt = this.customText().trim();
      return txt;
    }
    return this.codeLabel(code);
  });

  readonly canConfirm = computed(() => this.resolvedReason().length > 0);
  readonly showValidationError = computed(() => this.submitAttempted() && !this.canConfirm());

  onSelectCode(code: DismissReasonCode): void {
    this.selectedCode.set(code);
    if (code !== 'Other') this.customText.set('');
  }

  onConfirm(): void {
    this.submitAttempted.set(true);
    if (!this.canConfirm()) return;
    this.confirm.emit(this.resolvedReason());
  }

  onCancel(): void {
    this.cancel.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.onCancel();
  }

  codeLabel(code: DismissReasonCode): string {
    switch (code) {
      case 'SupplierUnavailable':     return 'Fournisseur indisponible';
      case 'BudgetExhausted':         return 'Budget épuisé';
      case 'DemandOverestimated':     return 'Demande surévaluée';
      case 'AlternativeStockAvailable': return 'Stock alternatif disponible';
      case 'Other':                   return 'Autre…';
    }
  }
}
