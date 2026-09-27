import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

/**
 * Modale de saisie texte générique (remplace `window.prompt`). Résout `modal.close(value.trim())`
 * à la confirmation, `modal.dismiss()` à l'annulation. Quand `required` est vrai, le bouton de
 * confirmation est désactivé tant que la valeur est vide.
 */
@Component({
  selector: 'app-prompt-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-header prompt-modal-header">
      @if (icon) {
        <i [class]="icon + loc_ui_tern_prompt_modal_icon_d0bfa1" aria-hidden="true"></i>
      }
      <h5 class="modal-title" id="promptModalTitle">{{ header }}</h5>
      <button type="button" class="btn-close" (click)="modal.dismiss()" aria-label="Fermer" i18n-aria-label="@@shared.components.confirm-modal.prompt-modal.fermer.5ab4ec64"></button>
    </div>
    <div class="modal-body prompt-modal-body">
      @if (message) {
        <p class="prompt-modal-message">{{ message }}</p>
      }
      <textarea
        #input
        [(ngModel)]="value"
        [maxlength]="maxLength"
        rows="3"
        class="prompt-modal-textarea"
        [placeholder]="placeholder"
        (keydown.control.enter)="accept()"></textarea>
      <small class="prompt-modal-hint">{{ value.length }} / {{ maxLength }}</small>
    </div>
    <div class="modal-footer prompt-modal-footer">
      <button type="button" class="btn btn-secondary" (click)="modal.dismiss()">{{ rejectLabel }}</button>
      <button
        type="button"
        [class]="loc_ui_tern_btn_6a21bb + acceptButtonStyleClass"
        [disabled]="required && !value.trim()"
        (click)="accept()">{{ acceptLabel }}</button>
    </div>
  `,
  styles: [`
    .prompt-modal-header {
      display: flex; align-items: center; gap: var(--spacing-3, 0.75rem);
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
      padding: var(--spacing-4, 1rem) var(--spacing-5, 1.25rem);
    }
    .prompt-modal-icon { font-size: var(--font-size-2xl, 1.5rem); color: var(--color-warning-600, #d97706); flex-shrink: 0; }
    .modal-title { flex: 1; margin: 0; font-size: var(--font-size-lg, 1.125rem); font-weight: var(--font-weight-semibold, 600); color: var(--color-text-primary, #0f172a); }
    .btn-close { opacity: 0.5; cursor: pointer; transition: opacity var(--transition-fast, 150ms); }
    .btn-close:hover, .btn-close:focus { opacity: 1; }
    .prompt-modal-body { padding: var(--spacing-5, 1.25rem); }
    .prompt-modal-message { margin: 0 0 var(--spacing-4, 1rem); color: var(--color-text-secondary, #475569); white-space: pre-line; }
    .prompt-modal-textarea {
      width: 100%; resize: vertical; padding: 0.6rem 0.75rem;
      border: 1px solid var(--color-border-default, #cbd5e1); border-radius: var(--radius-md, 0.5rem);
      font-family: inherit; font-size: var(--font-size-sm, 0.875rem);
    }
    .prompt-modal-textarea:focus { outline: none; border-color: var(--color-primary-500, #3b82f6); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16); }
    .prompt-modal-hint { display: block; margin-top: 4px; font-size: var(--font-size-xs, 0.75rem); color: var(--color-text-tertiary, #94a3b8); }
    .prompt-modal-footer {
      display: flex; justify-content: flex-end; gap: var(--spacing-3, 0.75rem);
      padding: var(--spacing-4, 1rem) var(--spacing-5, 1.25rem);
      border-top: 1px solid var(--color-border-subtle, #e2e8f0); background: var(--color-background-subtle, #f8fafc);
    }
    .prompt-modal-footer > * { margin: 0 !important; }
    .prompt-modal-footer .btn {
      min-width: 100px; padding: 0.5rem 1rem; font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500); border-radius: var(--radius-md, 0.375rem); cursor: pointer;
    }
    .btn-secondary { background: #fff; border: 1px solid var(--color-border-default, #cbd5e1); color: var(--color-text-primary, #0f172a); }
    .btn-primary { background: var(--color-primary-600, #2563eb); border: 1px solid var(--color-primary-600, #2563eb); color: #fff; }
    .btn-primary:hover:not(:disabled) { background: var(--color-primary-700, #1d4ed6); }
    .btn-danger { background: var(--color-error-600, #dc2626); border: 1px solid var(--color-error-600, #dc2626); color: #fff; }
    .btn-danger:hover:not(:disabled) { background: var(--color-error-700, #b91c1c); }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
  `]
})
export class PromptModalComponent {
  readonly loc_ui_tern_prompt_modal_icon_d0bfa1 = " prompt-modal-icon";
  readonly loc_ui_tern_btn_6a21bb = "btn ";
  @Input() message = '';
  @Input() header = 'Saisie';
  @Input() icon = '';
  @Input() placeholder = '';
  @Input() acceptLabel = 'Confirmer';
  @Input() rejectLabel = 'Annuler';
  @Input() acceptButtonStyleClass = 'btn-primary';
  @Input() required = true;
  @Input() maxLength = 500;
  value = '';
  readonly modal = inject(NgbActiveModal);

  accept(): void {
    if (this.required && !this.value.trim()) return;
    this.modal.close(this.value.trim());
  }
}
