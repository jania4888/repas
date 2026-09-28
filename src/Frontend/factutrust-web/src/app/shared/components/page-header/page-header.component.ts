import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TooltipModule } from 'primeng/tooltip';

/**
 * En-tête de page avec slot d'actions (`.page-header-actions`).
 * Les overlays (menus popup, dropdowns) projetés ici doivent être attachés au `body`
 * (`appendTo="body"`) — préférer `app-document-actions-menu` pour les menus Actions.
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [CommonModule, TooltipModule],
  template: `
    <div class="page-header">
      <div class="page-header-content">
        <div class="page-header-breadcrumb">
          <ng-content select="[page-breadcrumb]"></ng-content>
        </div>
        <h1 class="page-title">
          {{ title }}
          <ng-content select="[title-addon]"></ng-content>
          @if (hint) {
            <button
              type="button"
              class="page-title-hint"
              [pTooltip]="hint"
              tooltipPosition="bottom"
              aria-label="Informations sur cette page" i18n-aria-label="@@shared.components.page-header.page-header.informations.sur.cette.page.a2b6dd12">
              <i class="pi pi-info-circle" aria-hidden="true"></i>
            </button>
          }
        </h1>
        <p class="page-subtitle" *ngIf="subtitle">{{ subtitle }}</p>
      </div>
      <div class="page-header-actions">
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: [`
    .page-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: var(--spacing-8);
      padding-bottom: var(--spacing-5);
      flex-wrap: wrap;
      gap: var(--spacing-4);
      animation: fadeIn 0.3s ease-out;
      border-bottom: 1px solid transparent;
      border-image: linear-gradient(
        90deg,
        var(--color-border-subtle, #e2e8f0) 0%,
        var(--color-accent-100, #e0e7ff) 30%,
        transparent 70%
      ) 1;
    }

    :host-context(.theme-superieur) .page-header {
      border-image: none;
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
      margin-bottom: 1.25rem;
      padding-bottom: 1rem;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .page-header-content {
      flex: 1;
      min-width: 0;
    }

    .page-header-breadcrumb:empty {
      display: none;
    }

    .page-header-breadcrumb:not(:empty) {
      margin-bottom: 0.35rem;
    }

    .page-title {
      font-size: var(--font-size-3xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-neutral-900);
      margin: 0 0 var(--spacing-2);
      line-height: 1.2;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: var(--spacing-2, 0.5rem);
    }

    .page-title-hint {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      color: var(--color-text-secondary, #64748b);
      cursor: help;
      padding: 0.15rem;
      font-size: 1rem;
      line-height: 1;
      border-radius: var(--radius-full, 999px);
    }

    .page-title-hint:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    :host-context(.theme-superieur) .page-title {
      font-size: 1.75rem;
      letter-spacing: 0;
    }

    .page-subtitle {
      color: var(--color-neutral-600);
      font-size: var(--font-size-base);
      margin: 0;
      font-weight: var(--font-weight-normal);
    }

    .page-header-actions {
      display: flex;
      gap: var(--spacing-3);
      align-items: center;
    }

    @media (max-width: 768px) {
      .page-header {
        margin-bottom: var(--spacing-6);
      }

      .page-title {
        font-size: var(--font-size-2xl);
      }

      .page-header-actions {
        width: 100%;
        justify-content: flex-start;
      }
    }
  `]
})
export class PageHeaderComponent {
  @Input() title = '';
  @Input() subtitle?: string;
  @Input() hint?: string;
}