import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { AuthService } from '../../../services/auth.service';
import { FirmContextService } from '../../../services/firm-context.service';
import {
  getVisibleQuickAccessItems,
  QuickAccessItem,
  QuickAccessSection
} from '../../../config/quick-access.config';

interface QuickAccessSectionGroup {
  key: QuickAccessSection;
  label: string;
  items: ReturnType<typeof getVisibleQuickAccessItems>;
}

const SECTION_LABELS: Record<QuickAccessSection, string> = {
  navigation: $localize`:@@core.quickAccess.section.navigation:Navigation`,
  create: $localize`:@@core.quickAccess.section.create:Créer`
};

const SECTION_ORDER: QuickAccessSection[] = ['navigation', 'create'];

@Component({
  selector: 'app-quick-access-menu',
  standalone: true,
  imports: [CommonModule, RouterModule, NgbDropdownModule],
  template: `
    @if (visibleItems().length > 0) {
      <div
        ngbDropdown
        placement="bottom-start"
        container="body"
        display="dynamic"
        #quickAccessDropdown="ngbDropdown"
        class="quick-access">
        <button
          type="button"
          ngbDropdownToggle
          class="quick-access__trigger"
          id="quickAccessDropdown"
          aria-label="Accès rapide"
          i18n-aria-label="@@core.quickAccess.label"
          aria-haspopup="menu">
          <i class="fa-solid fa-bolt quick-access__trigger-icon" aria-hidden="true"></i>
          <span class="quick-access__trigger-label" i18n="@@core.quickAccess.label">Accès rapide</span>
          <i class="fa-solid fa-chevron-down quick-access__trigger-chevron" aria-hidden="true"></i>
        </button>
        <div
          ngbDropdownMenu
          class="quick-access__panel dropdown-menu"
          aria-labelledby="quickAccessDropdown">
          @for (section of groupedSections(); track section.key) {
            @if (!$first) {
              <div class="quick-access__divider" role="separator"></div>
            }
            <p class="quick-access__section-label">{{ section.label }}</p>
            <ul class="quick-access__list">
              @for (item of section.items; track item.label) {
                <li>
                  @if (item.action) {
                    <button
                      type="button"
                      class="quick-access__item"
                      (click)="onQuickAccessAction(item, quickAccessDropdown)">
                      <span class="quick-access__item-icon" aria-hidden="true">
                        <i [class]="item.icon"></i>
                      </span>
                      <span class="quick-access__item-label">{{ item.label }}</span>
                      <i class="fa-solid fa-arrow-right quick-access__item-arrow" aria-hidden="true"></i>
                    </button>
                  } @else {
                    <a
                      class="quick-access__item"
                      [routerLink]="item.route"
                      (click)="quickAccessDropdown.close()">
                      <span class="quick-access__item-icon" aria-hidden="true">
                        <i [class]="item.icon"></i>
                      </span>
                      <span class="quick-access__item-label">{{ item.label }}</span>
                      <i class="fa-solid fa-arrow-right quick-access__item-arrow" aria-hidden="true"></i>
                    </a>
                  }
                </li>
              }
            </ul>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      flex-shrink: 0;
    }

    .quick-access__trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2, 8px);
      padding: 6px 14px;
      border: 1px solid var(--topbar-divider, rgba(255, 255, 255, 0.2));
      border-radius: 4px;
      background: transparent;
      color: var(--topbar-fg, #fff);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.2;
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;

      &:hover {
        background: var(--topbar-hover-bg, rgba(255, 255, 255, 0.12));
        border-color: rgba(255, 255, 255, 0.35);
        color: var(--topbar-fg, #fff);
      }

      &.show {
        background: var(--topbar-hover-bg, rgba(255, 255, 255, 0.12));
        border-color: rgba(255, 255, 255, 0.35);
        color: var(--topbar-fg, #fff);
      }

      &:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
      }

      &::after {
        display: none;
      }
    }

    .quick-access__trigger-icon {
      font-size: 12px;
      color: var(--topbar-fg, #fff);
    }

    .quick-access__trigger-chevron {
      font-size: 8px;
      color: var(--topbar-fg-muted, rgba(255, 255, 255, 0.75));
      transition: transform 0.2s ease;
    }

    .quick-access__trigger.show .quick-access__trigger-chevron {
      transform: rotate(180deg);
    }

    /* Namespaced panel: works with body container (Ngb) and local menu. */
    .quick-access__panel.dropdown-menu {
      min-width: 360px;
      max-width: calc(100vw - 24px);
      padding: 12px !important;
      margin: 0;
      margin-top: 8px;
      border: 1px solid var(--color-neutral-200, #e2e8f0) !important;
      border-radius: var(--radius-lg, 16px) !important;
      box-shadow: var(--shadow-lg, 0 10px 25px rgba(15, 23, 42, 0.12)) !important;
      background: var(--color-white, #fff) !important;
      z-index: 1000;
    }

    .quick-access__section-label {
      margin: 0 0 var(--spacing-2, 8px);
      padding: 0 4px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--color-neutral-500, #64748b);
      line-height: 1.2;
    }

    .quick-access__divider {
      height: 1px;
      margin: var(--spacing-3, 12px) 0;
      background: var(--color-neutral-200, #e2e8f0);
    }

    .quick-access__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2, 8px);
    }

    .quick-access__item {
      display: flex;
      align-items: center;
      gap: var(--spacing-3, 12px);
      padding: 10px 12px;
      border: 1px solid var(--color-neutral-200, #e2e8f0);
      border-radius: 12px;
      background: var(--color-white, #fff);
      color: var(--color-neutral-700, #334155);
      text-decoration: none;
      width: 100%;
      text-align: start;
      font: inherit;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;

      &:hover {
        background: var(--color-neutral-50, #f8fafc);
        border-color: var(--color-neutral-300, #cbd5e1);
        color: var(--color-neutral-900, #0f172a);
      }

      &:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
      }
    }

    .quick-access__item-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      flex-shrink: 0;
      border-radius: 8px;
      background: var(--color-primary-50, #eff6ff);
      color: var(--color-primary-600, #2563eb);
      font-size: 14px;
    }

    .quick-access__item-label {
      flex: 1;
      min-width: 0;
      font-size: 14px;
      font-weight: 500;
      line-height: 1.35;
      white-space: normal;
    }

    .quick-access__item-arrow {
      flex-shrink: 0;
      font-size: 12px;
      color: var(--color-neutral-400, #94a3b8);
      opacity: 0;
      transform: translateX(-4px);
      transition: opacity 0.15s ease, transform 0.15s ease, color 0.15s ease;
    }

    .quick-access__item:hover .quick-access__item-arrow {
      opacity: 1;
      transform: translateX(0);
      color: var(--color-primary-600, #2563eb);
    }

    @media (max-width: 768px) {
      .quick-access__trigger-label {
        display: none;
      }

      .quick-access__trigger {
        padding: 8px 10px;
      }
    }
  `]
})
export class QuickAccessMenuComponent {
  private authService = inject(AuthService);
  private firmContext = inject(FirmContextService);

  visibleItems = computed(() => getVisibleQuickAccessItems(this.authService));

  groupedSections = computed((): QuickAccessSectionGroup[] => {
    const items = this.visibleItems();
    return SECTION_ORDER
      .map(key => ({
        key,
        label: SECTION_LABELS[key],
        items: items.filter(item => item.section === key)
      }))
      .filter(section => section.items.length > 0);
  });

  async onQuickAccessAction(
    item: QuickAccessItem,
    dropdown: { close: () => void }
  ): Promise<void> {
    dropdown.close();
    if (item.action === 'returnToFirm') {
      await this.firmContext.returnToFirmHome();
    }
  }
}
