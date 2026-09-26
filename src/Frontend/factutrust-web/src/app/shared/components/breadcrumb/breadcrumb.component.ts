import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

export interface BreadcrumbItem {
  label: string;
  route?: string;
  icon?: string;
}

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <nav 
      class="app-breadcrumb-nav" 
      [class.on-dark]="variant === 'on-dark'" 
      aria-label="Fil d'Ariane" i18n-aria-label="Fil d'Ariane">
      <ol class="app-breadcrumb-list">
        @for (item of items; track $index) {
          <li class="app-breadcrumb-item">
            @if (item.route && !isLast($index)) {
              <a [routerLink]="item.route" class="app-breadcrumb-link">
                @if (item.icon) {
                  <i [class]="'fa ' + (item.icon.startsWith('pi-') ? 'fa-' + item.icon.slice(3) : item.icon)"></i>
                }
                <span>{{ item.label }}</span>
              </a>
            } @else {
              <span class="app-breadcrumb-current" [attr.aria-current]="getAriaCurrent($index)">
                @if (item.icon) {
                  <i [class]="'fa ' + (item.icon.startsWith('pi-') ? 'fa-' + item.icon.slice(3) : item.icon)"></i>
                }
                <span>{{ item.label }}</span>
              </span>
            }
            @if (!isLast($index)) {
              <i class="fa fa-chevron-right app-breadcrumb-separator" aria-hidden="true"></i>
            }
          </li>
        }
      </ol>
    </nav>
  `,
  styles: [`
    .app-breadcrumb-nav {
      margin-bottom: var(--spacing-4);
    }

    .app-breadcrumb-list {
      display: flex;
      align-items: center;
      flex-wrap: nowrap;
      gap: var(--spacing-2);
      list-style: none;
      padding: 0;
      margin: 0;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .app-breadcrumb-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      white-space: nowrap;
    }

    .app-breadcrumb-link {
      display: flex;
      align-items: center;
      gap: var(--spacing-1);
      color: var(--color-neutral-600);
      text-decoration: none;
      font-size: var(--font-size-sm);
      transition: color var(--transition-fast);

      &:hover {
        color: var(--color-primary-600);
      }

      &:focus-visible {
        outline: 2px solid var(--color-primary-600);
        outline-offset: 2px;
        border-radius: var(--radius-sm);
      }

      i {
        font-size: var(--font-size-xs);
      }
    }

    .app-breadcrumb-current {
      display: flex;
      align-items: center;
      gap: var(--spacing-1);
      color: var(--color-neutral-900);
      font-weight: var(--font-weight-medium);
      font-size: var(--font-size-sm);

      i {
        font-size: var(--font-size-xs);
      }
    }

    .app-breadcrumb-separator {
      color: var(--color-neutral-400);
      font-size: var(--font-size-xs);
      margin: 0 var(--spacing-1);
    }

    /* On Dark Variant — topbar : texte lisible sur fond bleu, sans pilule */
    .app-breadcrumb-nav.on-dark {
      margin-bottom: 0;
      padding: 0;
      background: transparent;
      border: none;
      border-radius: 0;
      backdrop-filter: none;
    }

    .app-breadcrumb-nav.on-dark .app-breadcrumb-link {
      color: rgba(255, 255, 255, 0.78);

      &:hover {
        color: #fff;
        text-shadow: none;
      }

      &:focus-visible {
        outline-color: rgba(255, 255, 255, 0.85);
      }
    }

    .app-breadcrumb-nav.on-dark .app-breadcrumb-current {
      color: #fff;
      font-weight: 600;
      text-shadow: none;
    }

    .app-breadcrumb-nav.on-dark .app-breadcrumb-separator {
      color: rgba(255, 255, 255, 0.45);
    }
  `]
})
export class BreadcrumbComponent {
  @Input() items: BreadcrumbItem[] = [];
  @Input() variant: 'default' | 'on-dark' = 'default';

  isLast(index: number): boolean {
    return index === this.items.length - 1;
  }

  getAriaCurrent(index: number): string | undefined {
    return this.isLast(index) ? 'page' : undefined;
  }
}
