import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AuthService } from '@core/services/auth.service';
import {
  ACCOUNTING_MODULES,
  ACCOUNTING_HOME_HIDDEN_MODULE_IDS,
  AccountingModuleDef
} from '@core/config/accounting-modules.config';
import { canSeeNavEntry } from '@core/utils/nav-visibility';
import { AppModule } from '@core/models/app-module';

@Component({
  selector: 'app-accounting-home',
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent],
  template: `
    <app-page-header title="Comptabilité" i18n-title="Comptabilité" subtitle="Modules et fonctions de la comptabilité générale" />

    <div class="acc-modules">
      @for (mod of visibleModules(); track mod.title) {
        <section class="acc-module-card">
          <header class="acc-module-head">
            <i [class]="mod.icon" aria-hidden="true"></i>
            <div>
              <h2 class="acc-module-title">{{ mod.title }}</h2>
              <p class="acc-module-desc">{{ mod.description }}</p>
            </div>
          </header>
          <ul class="acc-module-links" role="list">
            @for (link of mod.links; track link.route) {
              <li>
                <a class="acc-link" [routerLink]="link.route">
                  <i [class]="link.icon" aria-hidden="true"></i>
                  <span>{{ link.label }}</span>
                  <i class="pi pi-angle-right acc-link-arrow" aria-hidden="true"></i>
                </a>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
  styles: `
    .acc-modules {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
      gap: var(--spacing-4);
      margin-top: var(--spacing-2);
    }
    .acc-module-card {
      background: var(--color-background-elevated);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm, 0 1px 3px rgba(15, 23, 42, 0.08));
      padding: var(--spacing-4);
      display: flex;
      flex-direction: column;
    }
    .acc-module-head {
      display: flex;
      gap: var(--spacing-3);
      align-items: flex-start;
      padding-bottom: var(--spacing-3);
      margin-bottom: var(--spacing-2);
      border-bottom: 1px solid var(--color-border-subtle);
    }
    .acc-module-head > i {
      font-size: 1.35rem;
      color: var(--color-primary-500, #2563eb);
      margin-top: 2px;
    }
    .acc-module-title { margin: 0; font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .acc-module-desc { margin: 2px 0 0; font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .acc-module-links { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .acc-link {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-md);
      color: var(--color-text-secondary);
      text-decoration: none;
      font-size: var(--font-size-sm);
    }
    .acc-link:hover { background: var(--color-background-subtle); color: var(--color-text-primary); }
    .acc-link > i:first-child { width: 1.1rem; text-align: center; color: var(--color-text-tertiary); }
    .acc-link-arrow { margin-left: auto; font-size: 0.75rem; color: var(--color-text-tertiary); }
  `
})
export class AccountingHomeComponent {
  private readonly auth = inject(AuthService);

  // Source unique partagée avec le sidebar cabinet (mode délégué) — cf. accounting-modules.config.ts.
  readonly visibleModules = computed<AccountingModuleDef[]>(() => {
    return ACCOUNTING_MODULES
      .map(mod => ({
        ...mod,
        links: mod.links.filter(link =>
          canSeeNavEntry(this.auth, {
            modules: link.modules ?? [AppModule.Accounting],
            permissionsAll: link.perms
          }))
      }))
      .filter(mod => !ACCOUNTING_HOME_HIDDEN_MODULE_IDS.has(mod.id))
      .filter(mod => mod.links.length > 0);
  });
}
