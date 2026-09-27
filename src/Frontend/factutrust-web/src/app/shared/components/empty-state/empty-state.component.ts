import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="empty-state">
      @if (illustration) {
        <div
          class="empty-state-illustration"
          [style.background-image]="'url(' + illustrationPath + ')'"
          role="img"
          [attr.aria-hidden]="true"></div>
      } @else {
        <div class="empty-state-icon">
          <i class="pi {{ icon }}" [style.font-size]="iconSize"></i>
        </div>
      }
      <h3 class="empty-state-title">{{ title }}</h3>
      @if (description) {
        <p class="empty-state-description">{{ description }}</p>
      }
      @if (showAction && actionLabel && actionRoute) {
        <a [routerLink]="actionRoute" class="empty-state-action">
          {{ actionLabel }}
        </a>
      }
      @if (showAction && actionLabel && !actionRoute && actionClick) {
        <button type="button" (click)="actionClick.emit()" class="empty-state-action">
          {{ actionLabel }}
        </button>
      }
      @if (secondaryAction) {
        <p class="empty-state-secondary" [innerHTML]="secondaryAction"></p>
      }
    </div>
  `,
  styles: [`
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
      text-align: center;
      min-height: 300px;
    }

    .empty-state-illustration {
      width: 200px;
      height: 200px;
      margin: 0 auto var(--spacing-6);
      opacity: 0.6;
      color: var(--color-text-tertiary);
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
    }

    .empty-state-icon {
      color: var(--color-neutral-400);
      margin-bottom: var(--spacing-4);
    }

    .empty-state-title {
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0 0 var(--spacing-3);
    }

    .empty-state-description {
      font-size: var(--font-size-base);
      color: var(--color-text-secondary);
      margin: 0 0 var(--spacing-6);
      max-width: 400px;
      line-height: var(--line-height-relaxed);
    }

    .empty-state-action {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-5);
      background: var(--color-primary-600);
      color: white;
      border-radius: var(--radius-lg);
      text-decoration: none;
      font-weight: var(--font-weight-medium);
      transition: all var(--transition-fast);
      border: none;
      cursor: pointer;
      font-family: var(--font-family);
      font-size: var(--font-size-base);
      box-shadow: var(--shadow-primary);
    }

    .empty-state-action:hover {
      background: var(--color-primary-700);
      transform: translateY(-2px);
      box-shadow: var(--shadow-primary-hover);
    }

    .empty-state-action:focus-visible {
      outline: 3px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    .empty-state-action:active {
      transform: translateY(0);
    }

    .empty-state-secondary {
      margin-top: var(--spacing-4);
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
    }

    .empty-state-secondary a {
      color: var(--color-primary-600);
      text-decoration: underline;
    }
  `]
})
export class EmptyStateComponent {
  @Input() icon = 'pi-inbox';
  @Input() iconSize = '3rem';
  @Input() illustration?: string;
  @Input() title = $localize`:@@shared.empty-state.ts.aucun.element.03196fc9:Aucun élément`;
  @Input() description?: string;
  /** When false, primary CTA (link or button) is not rendered (e.g. read-only user). */
  @Input() showAction = true;
  @Input() actionLabel?: string;
  @Input() actionRoute?: string;
  @Input() secondaryAction?: string;
  @Output() actionClick = new EventEmitter<void>();

  get illustrationPath(): string {
    if (!this.illustration) return '';
    return this.illustration.startsWith('http') || this.illustration.startsWith('/')
      ? this.illustration
      : `/assets/illustrations/${this.illustration}`;
  }
}
