import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import {
  COMPANY_CHECKLIST_ITEMS,
  FIRM_CHECKLIST_ITEMS,
  mergeChecklistDone
} from '@core/onboarding/product-onboarding.catalog';
import { OnboardingChecklistItemDef, isItemAgeEligible } from '@core/onboarding/product-onboarding.models';
import {
  isProductOnboardingUiEnabled,
  ProductOnboardingApiService
} from '@core/onboarding/product-onboarding.service';

@Component({
  selector: 'app-onboarding-checklist',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    @if (visible()) {
      <section class="onboarding-checklist" data-tour="onboarding-checklist" aria-label="Premiers pas" i18n-aria-label="Premiers pas">
        <header class="onboarding-checklist__header">
          <div>
            <h2 class="onboarding-checklist__title" i18n="@@shared.onboarding.onboarding-checklist.premiers.pas.975acb5a">Premiers pas</h2>
            <p class="onboarding-checklist__subtitle">{{ progressLabel() }}</p>
          </div>
          <button type="button" class="onboarding-checklist__dismiss" (click)="dismiss()" i18n="@@shared.onboarding.onboarding-checklist.masquer.adb05f2b"> Masquer </button>
        </header>
        <ul class="onboarding-checklist__list">
          @for (item of visibleItems(); track item.id) {
            <li class="onboarding-checklist__row">
              <button
                type="button"
                class="onboarding-checklist__check"
                [class.onboarding-checklist__check--done]="isDone(item.id)"
                [attr.aria-pressed]="isDone(item.id)"
                [attr.aria-label]="isDone(item.id) ? item.label + loc_ui_tern_fait_9007d0 : loc_ui_tern_marquer_comme_fait_75108d + item.label"
                (click)="markDone(item.id)">
                @if (isDone(item.id)) {
                  <i class="fa-solid fa-check" aria-hidden="true"></i>
                }
              </button>
              <a
                class="onboarding-checklist__item"
                [class.onboarding-checklist__item--done]="isDone(item.id)"
                [routerLink]="item.route">
                <span class="onboarding-checklist__label">{{ item.label }}</span>
                <span class="onboarding-checklist__hint">{{ item.description }}</span>
              </a>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [`
    .onboarding-checklist {
      background: var(--color-background-elevated, #fff);
      border: 1px solid var(--color-border-default, #e5e7eb);
      border-radius: var(--radius-lg, 12px);
      padding: 1rem 1.25rem;
      margin-bottom: 1.25rem;
      box-shadow: var(--shadow-sm, 0 1px 2px rgb(0 0 0 / 0.05));
    }
    .onboarding-checklist__header {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: flex-start;
      margin-bottom: 0.75rem;
    }
    .onboarding-checklist__title {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 650;
    }
    .onboarding-checklist__subtitle {
      margin: 0.15rem 0 0;
      color: var(--color-text-secondary, #6b7280);
      font-size: 0.875rem;
    }
    .onboarding-checklist__dismiss {
      border: none;
      background: transparent;
      color: var(--color-text-secondary, #6b7280);
      cursor: pointer;
      font-size: 0.875rem;
    }
    .onboarding-checklist__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.35rem;
    }
    .onboarding-checklist__row {
      display: flex;
      gap: 0.5rem;
      align-items: flex-start;
    }
    .onboarding-checklist__item {
      display: flex;
      flex-direction: column;
      flex: 1;
      gap: 0.1rem;
      padding: 0.55rem 0.4rem;
      border-radius: 8px;
      text-decoration: none;
      color: inherit;
    }
    .onboarding-checklist__item:hover {
      background: var(--color-neutral-50, #f8fafc);
    }
    .onboarding-checklist__item--done .onboarding-checklist__label {
      text-decoration: line-through;
      color: var(--color-text-secondary, #6b7280);
    }
    .onboarding-checklist__check {
      width: 1.25rem;
      height: 1.25rem;
      border-radius: 999px;
      border: 1px solid var(--color-border-default, #d1d5db);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 0.55rem;
      font-size: 0.7rem;
      color: #fff;
      background: transparent;
      padding: 0;
      cursor: pointer;
    }
    .onboarding-checklist__check--done {
      background: var(--color-success-600, #16a34a);
      border-color: var(--color-success-600, #16a34a);
    }
    .onboarding-checklist__label {
      display: block;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .onboarding-checklist__hint {
      display: block;
      font-size: 0.8rem;
      color: var(--color-text-secondary, #6b7280);
    }
  `]
})
export class OnboardingChecklistComponent implements OnInit {
  readonly loc_ui_tern_fait_9007d0 = $localize`:@@ui.tern.fait.9007d0: — fait`;
  readonly loc_ui_tern_marquer_comme_fait_75108d = $localize`:@@ui.tern.marquer.comme.fait.75108d:Marquer comme fait : `;
  private readonly auth = inject(AuthService);
  private readonly api = inject(ProductOnboardingApiService);

  private readonly dismissed = signal(false);
  private readonly doneIds = signal<Set<string>>(new Set());
  private readonly items = signal<OnboardingChecklistItemDef[]>([]);

  readonly visibleItems = computed(() => this.items());
  readonly visible = computed(() => {
    if (!isProductOnboardingUiEnabled()) return false;
    if (this.auth.isDelegatedMode()) return false;
    if (this.dismissed()) return false;
    const list = this.items();
    if (list.length === 0) return false;
    return list.some(item => !this.doneIds().has(item.id));
  });

  readonly progressLabel = computed(() => {
    const list = this.items();
    const done = list.filter(i => this.doneIds().has(i.id)).length;
    return `${done} / ${list.length} étapes terminées`;
  });

  ngOnInit(): void {
    const catalog = this.auth.isAccountingFirm() ? FIRM_CHECKLIST_ITEMS : COMPANY_CHECKLIST_ITEMS;
    this.items.set(catalog.filter(item => this.canSee(item)));

    const local = this.auth.user()?.productOnboardingChecklist;
    if (local?.dismissed) {
      this.dismissed.set(true);
    }
    this.doneIds.set(mergeChecklistDone(local?.doneIds, []));

    this.api.get().subscribe(state => {
      if (!state) {
        return;
      }
      if (!state.enabled) {
        this.dismissed.set(true);
        return;
      }
      this.dismissed.set(state.checklist.dismissed);
      this.doneIds.set(mergeChecklistDone(state.checklist.doneIds, state.autoCompletedIds));
    });
  }

  isDone(id: string): boolean {
    return this.doneIds().has(id);
  }

  dismiss(): void {
    this.dismissed.set(true);
    this.api.patch({ checklistDismissed: true }).subscribe();
  }

  markDone(id: string): void {
    if (this.doneIds().has(id)) {
      return;
    }
    this.doneIds.update(current => new Set([...current, id]));
    this.api.patch({ checklistDoneId: id }).subscribe();
  }

  private canSee(item: OnboardingChecklistItemDef): boolean {
    if (item.adminOnly && !this.auth.isAdmin()) {
      return false;
    }
    if (item.managerOnly && !this.auth.isFirmManager()) {
      return false;
    }
    if (item.permission && !this.auth.hasPermission(item.permission)) {
      return false;
    }
    if (item.modules?.length && !this.auth.hasAllModules(item.modules)) {
      return false;
    }
    if (item.segments?.length && !item.segments.includes(this.auth.user()?.companySegment ?? '')) {
      return false;
    }
    // Plan §3.5 — progressive profiling: hide age-gated items until the tenant is old enough.
    // Fail-open: an absent/unparseable tenant creation date shows the item (pre-Phase-3 behavior).
    if (!isItemAgeEligible(item.minAgeDays, this.auth.user()?.tenantCreatedAtUtc)) {
      return false;
    }
    return true;
  }
}
