import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AuthService } from '@core/services/auth.service';
import {
  ACCOUNTING_MODULES,
  AccountingModuleDef,
  AccountingModuleLink
} from '@core/config/accounting-modules.config';
import { COMPANY_ACCOUNTING_ETATS_MODULE_ID } from '@core/config/company-accounting-nav.config';
import { canSeeNavEntry } from '@core/utils/nav-visibility';
import { AppModule } from '@core/models/app-module';

@Component({
  selector: 'app-accounting-financial-statements',
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent],
  template: `
    <app-page-header
      [title]="pageTitle()"
      [subtitle]="pageSubtitle()" />

    <div class="acc-modules">
      @if (visibleLinks().length) {
        <section class="acc-module-card">
          <ul class="acc-module-links" role="list">
            @for (link of visibleLinks(); track link.route) {
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
export class AccountingFinancialStatementsComponent {
  private readonly auth = inject(AuthService);

  private readonly etatsModule = computed<AccountingModuleDef | undefined>(() =>
    ACCOUNTING_MODULES.find(m => m.id === COMPANY_ACCOUNTING_ETATS_MODULE_ID)
  );

  readonly pageTitle = computed(() => 'États comptables');
  readonly pageSubtitle = computed(() => this.etatsModule()?.description ?? $localize`:@@ui.tern.journal.grand.livre.balance.et.bilans.94bb71:Journal, grand livre, balance et bilans`);

  readonly visibleLinks = computed<AccountingModuleLink[]>(() => {
    const mod = this.etatsModule();
    if (!mod) {
      return [];
    }
    return mod.links.filter(link =>
      canSeeNavEntry(this.auth, {
        modules: link.modules ?? [AppModule.Accounting],
        permissionsAll: link.perms
      })
    );
  });
}
