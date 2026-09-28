import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-form-section',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="form-section" [class.form-section--compact]="variant === 'compact'">
      <div class="form-section-header">
        @if (icon) {
          <i class="pi {{ icon }}"></i>
        }
        @if (number != null && variant !== 'compact') {
          <span class="section-number">{{ number }}</span>
        }
        <h3>{{ title }}</h3>
      </div>
      <div class="form-section-body">
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: [`
    .form-section {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--card-padding);
      margin-bottom: var(--spacing-6);
      border: 1px solid var(--color-border-subtle);
      border-inline-start: 4px solid var(--color-primary-500);
      box-shadow: var(--shadow-md);
    }

    .form-section-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      margin-bottom: var(--spacing-5);
      padding-bottom: var(--spacing-4);
      border-bottom: 2px solid var(--color-primary-100);
    }

    .form-section-header .pi {
      font-size: var(--font-size-xl);
      color: var(--color-primary-600);
    }

    .section-number {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: var(--color-primary-600);
      color: white;
      border-radius: var(--radius-full);
      font-weight: var(--font-weight-bold);
      font-size: var(--font-size-sm);
      flex-shrink: 0;
    }

    .form-section-header h3 {
      margin: 0;
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .form-section--compact {
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-3);
      box-shadow: var(--shadow-sm);
    }

    .form-section--compact .form-section-header {
      margin-bottom: var(--spacing-3);
      padding-bottom: var(--spacing-2);
      border-bottom-width: 1px;
    }

    .form-section--compact .form-section-header .pi {
      font-size: var(--font-size-lg);
    }

    .form-section--compact .form-section-header h3 {
      font-size: var(--font-size-base);
    }

  `]
})
export class FormSectionComponent {
  @Input() title = '';
  @Input() icon?: string;
  @Input() number?: number;
  @Input() variant: 'default' | 'compact' = 'default';
}
