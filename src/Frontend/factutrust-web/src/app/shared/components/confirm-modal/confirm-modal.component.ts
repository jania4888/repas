import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="modal-header confirm-modal-header">
      @if (icon) {
        <i [class]="icon + loc_ui_tern_confirm_modal_icon_e3a84f" aria-hidden="true"></i>
      }
      <h5 class="modal-title" id="confirmModalTitle">{{ header }}</h5>
      <button 
        type="button" 
        class="btn-close" 
        (click)="modal.dismiss()"
        [attr.aria-label]="loc_fermer_5ab4ec"
        tabindex="0">
      </button>
    </div>
    <div class="modal-body confirm-modal-body">
      <p class="confirm-modal-message">{{ message }}</p>
    </div>
    <div class="modal-footer confirm-modal-footer">
      @if (showRejectButton) {
        <button 
          type="button" 
          class="btn btn-secondary confirm-modal-btn-reject"
          (click)="modal.dismiss()"
          [attr.aria-label]="rejectLabel"
          tabindex="0">
          {{ rejectLabel }}
        </button>
      }
      <button 
        type="button" 
        [class]="loc_ui_tern_btn_confirm_modal_btn_accept_23fde5 + acceptButtonStyleClass"
        (click)="modal.close()"
        [attr.aria-label]="acceptLabel"
        tabindex="0">
        {{ acceptLabel }}
      </button>
    </div>
  `,
  styles: [`
    /* Force pointer events et z-index pour garantir l'interactivité */
    :host {
      display: block;
      pointer-events: auto !important;
    }

    .confirm-modal-header,
    .confirm-modal-body,
    .confirm-modal-footer {
      pointer-events: auto !important;
    }

    .confirm-modal-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-3, 0.75rem);
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
      padding: var(--spacing-4, 1rem) var(--spacing-5, 1.25rem);
    }

    .confirm-modal-icon {
      font-size: var(--font-size-2xl, 1.5rem);
      color: var(--color-warning-600, #d97706);
      flex-shrink: 0;
    }

    .modal-title {
      flex: 1;
      margin: 0;
      font-size: var(--font-size-lg, 1.125rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text-primary, #0f172a);
    }

    .btn-close {
      pointer-events: auto !important;
      cursor: pointer !important;
      opacity: 0.5;
      transition: opacity var(--transition-fast, 150ms);
    }

    .btn-close:hover,
    .btn-close:focus {
      opacity: 1;
    }

    .btn-close:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    .confirm-modal-body {
      padding: var(--spacing-5, 1.25rem);
    }

    .confirm-modal-message {
      margin: 0;
      font-size: var(--font-size-base, 1rem);
      line-height: var(--line-height-normal, 1.5);
      color: var(--color-text-secondary, #475569);
      white-space: pre-line;
    }

    .confirm-modal-footer {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: var(--spacing-3, 0.75rem);
      padding: var(--spacing-4, 1rem) var(--spacing-5, 1.25rem);
      border-top: 1px solid var(--color-border-subtle, #e2e8f0);
      background: var(--color-background-subtle, #f8fafc);
    }

    /* Neutralise Bootstrap sibling margins that conflict with gap */
    .confirm-modal-footer > * {
      margin: 0 !important;
    }

    .confirm-modal-footer .btn {
      pointer-events: auto !important;
      cursor: pointer !important;
      position: relative;
      z-index: 1;
      flex: 0 1 auto;
      min-width: 0;
      max-width: 100%;
      white-space: normal;
      text-align: center;
      line-height: 1.25;
      padding: var(--spacing-2, 0.5rem) var(--spacing-4, 1rem);
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      border-radius: var(--radius-md, 0.375rem);
      transition: all var(--transition-fast, 150ms);
    }

    .confirm-modal-btn-reject {
      background: var(--color-white, #ffffff);
      border: 1px solid var(--color-border-default, #cbd5e1);
      color: var(--color-text-primary, #0f172a);
    }

    .confirm-modal-btn-reject:hover {
      background: var(--color-neutral-100, #f1f5f9);
      border-color: var(--color-border-strong, #94a3b8);
    }

    .confirm-modal-btn-reject:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    .confirm-modal-btn-accept {
      background: var(--color-primary-600, #2563eb);
      border: 1px solid var(--color-primary-600, #2563eb);
      color: white;
    }

    .confirm-modal-btn-accept:hover {
      background: var(--color-primary-700, #1d4ed8);
      border-color: var(--color-primary-700, #1d4ed8);
    }

    .confirm-modal-btn-accept:focus-visible {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: 2px;
    }

    /* Support pour les classes PrimeNG passées en paramètre */
    .confirm-modal-btn-accept.p-button-success {
      background: var(--color-success-600, #16a34a);
      border-color: var(--color-success-600, #16a34a);
    }

    .confirm-modal-btn-accept.p-button-success:hover {
      background: var(--color-success-700, #15803d);
      border-color: var(--color-success-700, #15803d);
    }

    .confirm-modal-btn-accept.p-button-danger,
    .confirm-modal-btn-accept.btn-danger {
      background: var(--color-error-600, #dc2626);
      border-color: var(--color-error-600, #dc2626);
    }

    .confirm-modal-btn-accept.p-button-danger:hover,
    .confirm-modal-btn-accept.btn-danger:hover {
      background: var(--color-error-700, #b91c1c);
      border-color: var(--color-error-700, #b91c1c);
    }

    /* Responsive */
    @media (max-width: 576px) {
      .confirm-modal-footer {
        flex-direction: column;
        align-items: stretch;
      }

      .confirm-modal-footer .btn {
        width: 100%;
      }
    }
  `]
})
export class ConfirmModalComponent {
  protected readonly loc_fermer_5ab4ec = $localize`:@@shared.confirm-modal.tpl.fermer.5ab4ec64:Fermer`;

  readonly loc_ui_tern_confirm_modal_icon_e3a84f = " confirm-modal-icon";
  readonly loc_ui_tern_btn_confirm_modal_btn_accept_23fde5 = "btn confirm-modal-btn-accept ";
  @Input() message = $localize`:@@shared.confirm-modal.ts.etes.vous.sur.25c63265:Êtes-vous sûr ?`;
  @Input() header = $localize`:@@shared.confirm-modal.ts.confirmation.3424edc2:Confirmation`;
  @Input() icon = '';
  @Input() acceptLabel = $localize`:@@shared.confirm-modal.ts.oui.eaa02f3f:Oui`;
  @Input() rejectLabel = $localize`:@@shared.confirm-modal.ts.non.a7219939:Non`;
  @Input() acceptButtonStyleClass = 'btn-primary';
  /** When false, only the accept button is shown (alert mode). */
  @Input() showRejectButton = true;

  constructor(public modal: NgbActiveModal) {}
}
