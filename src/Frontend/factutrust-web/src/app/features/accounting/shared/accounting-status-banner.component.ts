import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';

export type AccountingBannerVariant = 'error' | 'success' | 'warning' | 'info';

@Component({
  selector: 'app-accounting-status-banner',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    @if (message) {
      <div
        class="accounting-status-banner"
        [class.accounting-status-banner--error]="variant === 'error'"
        [class.accounting-status-banner--success]="variant === 'success'"
        [class.accounting-status-banner--warning]="variant === 'warning'"
        [class.accounting-status-banner--info]="variant === 'info'"
        [attr.role]="variant === 'error' ? 'alert' : 'status'"
        [attr.aria-live]="variant === 'error' ? 'assertive' : 'polite'">
        <div class="accounting-status-banner__content">
          @if (title) {
            <strong class="accounting-status-banner__title">{{ title }}</strong>
          }
          <span class="accounting-status-banner__text">{{ message }}</span>
        </div>
        @if (showRetry) {
          <div class="accounting-status-banner__actions">
            <button
              pButton
              type="button"
              class="p-button-sm p-button-outlined"
              [attr.aria-label]="retryLabel"
              (click)="retry.emit()">
              {{ retryLabel }}
            </button>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .accounting-status-banner {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--spacing-4);
      padding: var(--spacing-4);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-subtle);
      margin-bottom: var(--spacing-4);
    }
    .accounting-status-banner__content {
      flex: 1;
      min-width: 0;
      font-size: var(--font-size-sm);
    }
    .accounting-status-banner__title {
      display: block;
      margin-bottom: var(--spacing-1);
      font-weight: var(--font-weight-semibold);
    }
    .accounting-status-banner__text {
      color: var(--color-text-primary);
    }
    .accounting-status-banner--error {
      background: var(--color-error-50);
      border-color: var(--color-error-200);
      color: var(--color-error-800);
    }
    .accounting-status-banner--error .accounting-status-banner__title {
      color: var(--color-error-800);
    }
    .accounting-status-banner--success {
      background: var(--color-success-50);
      border-color: var(--color-success-200);
      color: var(--color-success-800);
    }
    .accounting-status-banner--warning {
      background: var(--color-warning-50);
      border-color: var(--color-warning-200);
      color: var(--color-warning-800);
    }
    .accounting-status-banner--info {
      background: var(--color-info-50);
      border-color: var(--color-info-200);
      color: var(--color-info-800);
    }
    .accounting-status-banner__actions {
      flex-shrink: 0;
    }
  `
})
export class AccountingStatusBannerComponent {
  @Input() variant: AccountingBannerVariant = 'info';
  @Input() title = '';
  @Input() message = '';
  @Input() showRetry = false;
  @Input() retryLabel = $localize`:@@accounting.accounting-status-banner.ts.reessayer.895d416b:Réessayer`;
  @Output() readonly retry = new EventEmitter<void>();
}
