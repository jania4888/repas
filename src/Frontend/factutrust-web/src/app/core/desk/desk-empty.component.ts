/// <reference types="@angular/localize" />
import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AppNavService } from '@core/services/app-nav.service';
import { deskShortcuts } from './desk-shortcuts';
import { DeskWindowService } from './desk-window.service';

@Component({
  selector: 'app-desk-empty',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (enabled()) {
      <section class="desk-empty">
        <h2 class="desk-empty__title">{{ emptyTitle }}</h2>
        <p class="desk-empty__body">{{ emptyBody }}</p>
        @if (shortcuts().length > 0) {
          <ul class="desk-empty__grid">
            @for (shortcut of shortcuts(); track shortcut.route) {
              <li>
                <a class="desk-empty__link" [routerLink]="shortcut.route">
                  @if (shortcut.icon) {
                    <i [class]="shortcut.icon" aria-hidden="true"></i>
                  }
                  <span>{{ shortcut.label }}</span>
                </a>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .desk-empty {
      padding: var(--spacing-6, 1.5rem);
    }
    .desk-empty__title {
      margin: 0 0 0.35rem;
      font-size: 1.125rem;
      color: var(--sidebar-delegated-navy, #0a1f44);
    }
    .desk-empty__body {
      margin: 0 0 1.25rem;
      color: var(--color-neutral-600, #475569);
    }
    .desk-empty__grid {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin: 0;
      padding: 0;
    }
    .desk-empty__link {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 2.5rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid rgba(10, 31, 68, 0.12);
      border-radius: 0.5rem;
      background: #fff;
      color: var(--sidebar-delegated-navy, #0a1f44);
      text-decoration: none;
    }
    .desk-empty__link:hover {
      border-color: var(--sidebar-delegated-gold, #d4af37);
    }
  `]
})
export class DeskEmptyComponent {
  private readonly desk = inject(DeskWindowService);
  private readonly nav = inject(AppNavService);
  private readonly router = inject(Router);

  readonly enabled = this.desk.enabled;
  readonly emptyTitle = $localize`:@@core.desk.empty.title:Aucune fenêtre ouverte`;
  readonly emptyBody = $localize`:@@core.desk.empty.body:Ouvrez un écran depuis le menu, ou reprenez un raccourci.`;
  readonly shortcuts = computed(() => deskShortcuts(this.nav.navItems()));

  constructor() {
    if (!this.desk.isEnabled()) {
      void this.router.navigateByUrl('/dashboard', { replaceUrl: true });
    }
  }
}
