import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    @if (routerLink) {
      <a
        [routerLink]="routerLink"
        [queryParams]="queryParams"
        class="btn btn-{{ variant }} btn-{{ size }}"
        [class.btn-icon-only]="iconOnly"
        [class.btn-icon-always-visible]="iconOnly && iconAlwaysVisible"
        [attr.aria-label]="ariaLabel || null"
        [attr.aria-describedby]="ariaDescribedBy || null"
        (click)="onClick($event)">
        <ng-container *ngTemplateOutlet="innerContent"></ng-container>
      </a>
    } @else {
      <button
        class="btn btn-{{ variant }} btn-{{ size }}"
        [class.btn-icon-only]="iconOnly"
        [class.btn-icon-always-visible]="iconOnly && iconAlwaysVisible"
        [disabled]="disabled"
        [type]="type"
        [attr.aria-label]="ariaLabel || null"
        [attr.aria-describedby]="ariaDescribedBy || null"
        (click)="onClick($event)">
        <ng-container *ngTemplateOutlet="innerContent"></ng-container>
      </button>
    }
    <!--
      C8 fix: a single physical <ng-content> declaration shared by both branches above via
      ngTemplateOutlet. Angular only ever attaches projected content to the FIRST <ng-content>
      it finds at compile time, regardless of which conditional branch is actually rendered — so
      having two separate <ng-content> tags (one per branch, as before) left the routerLink (<a>)
      branch permanently empty (icon-less export/nav buttons rendered as blank boxes, see
      captures 2401/2410). Routing both branches through the same <ng-template> keeps exactly one
      <ng-content> in the compiled template.
    -->
    <ng-template #innerContent>
      @if (icon && !iconOnly) {
        <i class="pi {{ icon }}" [class.icon-left]="iconPos === 'left'" [class.icon-right]="iconPos === 'right'"></i>
      }
      @if (iconOnly && icon) {
        <i class="pi {{ icon }}"></i>
      }
      @if (!iconOnly) {
        <ng-content></ng-content>
      }
    </ng-template>
  `,
  styles: [`
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-6);
      border-radius: var(--radius-lg);
      font-weight: var(--font-weight-medium);
      font-size: var(--font-size-base);
      transition: all var(--transition-fast);
      border: none;
      cursor: pointer;
      font-family: var(--font-family);
    }

    .btn-primary {
      background: var(--color-primary-600);
      background-image: none;
      color: white;
      box-shadow: 0 4px 14px rgba(56, 98, 245, 0.22);
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--color-primary-700);
      background-image: none;
      box-shadow: 0 6px 18px rgba(56, 98, 245, 0.28);
      transform: translateY(-2px);
    }
    .btn-primary:active:not(:disabled) { transform: translateY(0); }

    .btn-secondary {
      background: var(--color-background-subtle);
      color: var(--color-text-primary);
      border: 1px solid var(--color-border-default);
    }
    .btn-secondary:hover:not(:disabled) {
      background: var(--color-neutral-200);
      border-color: var(--color-border-strong);
    }

    .btn-outline {
      background: transparent;
      color: var(--color-primary-600);
      border: 2px solid var(--color-primary-600);
    }
    .btn-outline:hover:not(:disabled) {
      background: var(--color-primary-50);
      border-color: var(--color-primary-700);
    }

    .btn-ghost {
      background: transparent;
      color: var(--color-text-secondary);
    }
    .btn-ghost:hover:not(:disabled) {
      background: var(--color-background-subtle);
      color: var(--color-text-primary);
    }
    .btn-ghost.btn-icon-always-visible {
      background: var(--color-primary-200);
      color: var(--color-primary-700);
    }
    .btn-ghost.btn-icon-always-visible:hover:not(:disabled) {
      background: var(--color-primary-300);
      color: var(--color-primary-800);
    }

    /* Variante 'soft' : look indigo doux pour actions secondaires premium */
    .btn-soft {
      background: var(--color-accent-50, #eef2ff);
      color: var(--color-accent-700, #4338ca);
      border: 1px solid var(--color-accent-100, #e0e7ff);
    }
    .btn-soft:hover:not(:disabled) {
      background: var(--color-accent-100, #e0e7ff);
      border-color: var(--color-accent-300, #a5b4fc);
      transform: translateY(-1px);
    }
    .btn-soft:active:not(:disabled) { transform: translateY(0); }

    .btn-danger {
      background: var(--gradient-danger, linear-gradient(135deg, #ef4444 0%, #dc2626 100%));
      background-color: var(--color-danger-600, #dc2626);
      color: white;
      box-shadow: 0 2px 4px rgba(220, 38, 38, 0.3);
    }
    .btn-danger:hover:not(:disabled) {
      background-color: var(--color-danger-700, #b91c1c);
      box-shadow: 0 4px 8px rgba(220, 38, 38, 0.4);
      transform: translateY(-2px);
    }
    .btn-danger:active:not(:disabled) { transform: translateY(0); }

    .btn-success {
      background: var(--color-success-50, #f0fdf4);
      color: var(--color-success-700, #15803d);
      border: 1px solid var(--color-success-300, #86efac);
    }
    .btn-success:hover:not(:disabled) {
      background: var(--color-success-100, #dcfce7);
      border-color: var(--color-success-400, #4ade80);
      color: var(--color-success-800, #166534);
    }
    .btn-success:active:not(:disabled) { transform: translateY(0); }

    .btn-sm { padding: var(--spacing-2) var(--spacing-4); font-size: var(--font-size-sm); }
    .btn-xs { padding: var(--spacing-1) var(--spacing-2); font-size: var(--font-size-xs); }
    .btn-lg { padding: var(--spacing-4) var(--spacing-8); font-size: var(--font-size-lg); }
    .btn-icon-only { padding: var(--spacing-3); width: 40px; height: 40px; }
    .btn-sm.btn-icon-only { padding: var(--spacing-2); width: 32px; height: 32px; }
    .btn-xs.btn-icon-only { padding: var(--spacing-1); width: 28px; height: 28px; }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
    }

    .btn:focus-visible {
      outline: 3px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    .btn .icon-left { margin-inline-end: var(--spacing-1); }
    .btn .icon-right { margin-inline-start: var(--spacing-1); }
    
    // Link variant (anchor tag)
    a.btn {
      text-decoration: none;
      display: inline-flex;
    }
  `]
})
export class ButtonComponent {
  @Input() variant: 'primary' | 'secondary' | 'outline' | 'ghost' | 'soft' | 'danger' | 'success' = 'primary';
  @Input() size: 'xs' | 'sm' | 'md' | 'lg' = 'md';
  @Input() icon?: string;
  @Input() iconPos: 'left' | 'right' = 'left';
  @Input() iconOnly = false;
  @Input() disabled = false;
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() ariaLabel?: string;
  @Input() ariaDescribedBy?: string;
  @Input() routerLink?: string | string[];
  @Input() queryParams?: Record<string, string | number | boolean | null | undefined>;
  /** When true and iconOnly, uses a higher-contrast icon color for visibility (e.g. in table action columns). */
  @Input() iconAlwaysVisible = false;
  @Output() clicked = new EventEmitter<MouseEvent>();

  onClick(event: MouseEvent): void {
    if (!this.disabled) {
      this.clicked.emit(event);
    }
  }
}
