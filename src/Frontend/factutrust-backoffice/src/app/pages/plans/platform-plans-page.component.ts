import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { MessageService } from 'primeng/api';

import {
  PlatformPlansService,
  type CreatePlanRequest,
  type UpdatePlanRequest
} from '@core/services/platform-plans.service';
import { BillingPeriod, type ClonePlanRequest, type PlanDto } from '@core/models/platform.models';

import { FtPageHeaderComponent } from '@core/ui/page-header/ft-page-header.component';
import { FtBadgeComponent } from '@core/ui/badge/ft-badge.component';
import { FtSkeletonComponent } from '@core/ui/skeleton/ft-skeleton.component';
import { FtEmptyStateComponent } from '@core/ui/empty-state/ft-empty-state.component';
import { FtConfirmActionComponent } from '@core/ui/confirm-action/ft-confirm-action.component';
import { FtTndCurrencyPipe } from '@core/pipes/ft-tnd-currency.pipe';
import type { FtTone } from '@core/ui/badge/ft-badge.component';

import { PLANS_FR } from './plans.i18n.fr';
import { PlanCloneDialogComponent } from './plan-clone-dialog.component';
import { PlanFormDialogComponent } from './plan-form-dialog.component';

@Component({
  selector: 'app-platform-plans-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonModule,
    TooltipModule,
    ToggleSwitchModule,
    FtPageHeaderComponent,
    FtBadgeComponent,
    FtSkeletonComponent,
    FtEmptyStateComponent,
    FtConfirmActionComponent,
    FtTndCurrencyPipe,
    PlanCloneDialogComponent,
    PlanFormDialogComponent
  ],
  template: `
    <ft-page-header [title]="t('list.title')" [subtitle]="t('list.subtitle')">
      <ng-container ftActions>
        <span class="archived-toggle">
          <p-toggleswitch
            [(ngModel)]="includeArchived"
            (ngModelChange)="onIncludeArchivedChange($event)" />
          <label class="muted">{{ t('list.actions.includeArchived') }}</label>
        </span>
        <p-button
          [label]="t('list.actions.refresh')"
          icon="pi pi-refresh"
          [outlined]="true"
          [disabled]="loading()"
          (onClick)="load()" />
        <p-button
          [label]="t('action.create')"
          icon="pi pi-plus"
          severity="primary"
          [disabled]="loading()"
          (onClick)="openCreate()" />
      </ng-container>
    </ft-page-header>

    @if (loading()) {
      <div class="grid">
        @for (i of skeletonCards; track $index) {
          <ft-skeleton shape="rect" width="100%" height="22rem" />
        }
      </div>
    } @else if (plans().length === 0) {
      <ft-empty-state
        variant="table-empty"
        [title]="t('empty.title')"
        [description]="t('empty.desc')"
      />
    } @else {
      <div class="grid">
        @for (plan of plans(); track plan.id) {
          <article class="plan-card" [class.plan-card--archived]="!plan.isActive">
            <header class="plan-card__head">
              <div class="plan-card__title">
                <h3>{{ plan.name }}</h3>
                <code>{{ plan.code }}</code>
              </div>
              <div class="plan-card__chips">
                @if (!plan.isActive) {
                  <ft-badge tone="neutral" size="sm">{{ t('card.archived') }}</ft-badge>
                }
                <ft-badge [tone]="plan.isPublic ? 'success' : 'neutral'" size="sm">
                  {{ plan.isPublic ? t('card.public') : t('card.private') }}
                </ft-badge>
              </div>
            </header>

            <div class="plan-card__price">
              @if (plan.basePriceTND > 0) {
                <span class="price">{{ plan.basePriceTND | ftTndCurrency: { fractionDigits: 0 } }}</span>
                <span class="muted">/ {{ plan.billingPeriodDisplay.toLowerCase() }}</span>
              } @else {
                <span class="price-free">{{ plan.billingPeriodDisplay }}</span>
              }
            </div>

            @if (plan.description) {
              <p class="plan-card__desc">{{ plan.description }}</p>
            }

            <p class="plan-card__meta">
              <span>
                @if (plan.subscriptionsCount > 0) {
                  <strong>{{ plan.subscriptionsCount }}</strong>
                  {{ t('card.subscriptions').replace('{count} ', '') }}
                } @else {
                  {{ t('card.subscriptions.zero') }}
                }
              </span>
              @if (plan.trialDays > 0) {
                <span class="muted">·</span>
                <span class="muted">
                  {{ plan.trialDays }} j d’essai
                </span>
              }
              <span class="muted">·</span>
              <span class="muted">
                {{ includedModulesCount(plan) }} / {{ plan.modules.length }} modules
              </span>
            </p>

            <!-- Limits -->
            @if (plan.limits.length > 0) {
              <section class="section">
                <h4>{{ t('section.limits') }}</h4>
                <dl class="kv">
                  @for (l of plan.limits; track l.key) {
                    <div>
                      <dt>{{ l.key }}</dt>
                      <dd><code>{{ l.value }}</code></dd>
                    </div>
                  }
                </dl>
              </section>
            }

            <!-- Features -->
            @if (plan.features.length > 0) {
              <section class="section">
                <h4>{{ t('section.features') }}</h4>
                <ul class="features">
                  @for (f of plan.features; track f.featureKey) {
                    <li [class.off]="!f.enabled">
                      <i class="pi" [class.pi-check-circle]="f.enabled" [class.pi-times-circle]="!f.enabled"></i>
                      {{ f.featureKey }}
                    </li>
                  }
                </ul>
              </section>
            }

            <!-- Modules -->
            @if (plan.modules.length > 0) {
              <section class="section">
                <h4>{{ t('section.modules') }}</h4>
                <div class="modules">
                  @for (m of plan.modules; track m.module) {
                    <ft-badge [tone]="m.isIncluded ? 'success' : 'neutral'" size="sm">
                      <i class="pi" [class.pi-check]="m.isIncluded" [class.pi-times]="!m.isIncluded"></i>
                      {{ m.moduleDisplay }}
                    </ft-badge>
                  }
                </div>
              </section>
            }

            <footer class="plan-card__actions">
              @if (plan.isActive) {
                <p-button
                  [label]="t('action.edit')"
                  icon="pi pi-pencil"
                  [outlined]="true"
                  size="small"
                  [disabled]="busy()"
                  (onClick)="openEdit(plan)"
                />
              }
              <p-button
                [label]="t('action.clone')"
                icon="pi pi-copy"
                [outlined]="true"
                size="small"
                [disabled]="busy()"
                (onClick)="openClone(plan)"
              />
              @if (plan.isActive) {
                <p-button
                  [label]="t('action.archive')"
                  icon="pi pi-archive"
                  severity="warn"
                  [outlined]="true"
                  size="small"
                  [disabled]="busy() || plan.subscriptionsCount > 0"
                  [pTooltip]="plan.subscriptionsCount > 0 ? 'Impossible : abonnements actifs' : ''"
                  tooltipPosition="top"
                  (onClick)="openArchive(plan)"
                />
              } @else {
                <p-button
                  [label]="t('action.reactivate')"
                  icon="pi pi-undo"
                  severity="success"
                  [outlined]="true"
                  size="small"
                  [disabled]="busy()"
                  (onClick)="reactivate(plan)"
                />
              }
            </footer>
          </article>
        }
      </div>
    }

    <!-- Modals -->
    <app-plan-form-dialog
      [(visible)]="formDialogOpen"
      [editing]="formTarget()"
      [busy]="busy()"
      (confirmed)="onFormConfirmed($event)"
      (cancelled)="formDialogOpen = false" />

    <app-plan-clone-dialog
      [(visible)]="cloneDialogOpen"
      [source]="cloneTarget()"
      [busy]="busy()"
      (confirmed)="onCloneConfirmed($event)" />

    <ft-confirm-action
      [(visible)]="archiveDialogOpen"
      variant="destructive"
      [title]="t('archive.title')"
      [description]="t('archive.desc')"
      [confirmKeyword]="t('archive.confirmKeyword')"
      [confirmLabel]="t('archive.confirmLabel')"
      confirmIcon="pi pi-archive"
      [busy]="busy()"
      (confirmed)="onArchiveConfirmed()" />
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .archived-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        margin-right: 0.5rem;
      }

      .archived-toggle label {
        font-size: 0.78rem;
        cursor: pointer;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
        gap: var(--gap-md);
      }

      .plan-card {
        background: var(--ft-surface);
        border: 1px solid var(--ft-border);
        border-radius: var(--ft-radius-lg);
        padding: var(--gap-md);
        display: flex;
        flex-direction: column;
        gap: var(--gap-sm);
      }

      .plan-card--archived {
        opacity: 0.7;
        border-color: var(--ft-neutral-border);
      }

      .plan-card__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--gap-sm);
      }

      .plan-card__title h3 {
        margin: 0 0 0.2rem;
        color: var(--ft-text);
        font-size: 1.05rem;
      }

      .plan-card__title code {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 0.78rem;
        color: var(--ft-accent);
        background: var(--ft-surface-2);
        padding: 0.05rem 0.4rem;
        border-radius: var(--ft-radius-sm);
      }

      .plan-card__chips {
        display: flex;
        gap: 0.3rem;
        flex-wrap: wrap;
      }

      .plan-card__price {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
      }

      .price {
        font-size: 1.6rem;
        font-weight: 700;
        color: var(--ft-text);
        font-feature-settings: var(--font-feature-tabular);
      }

      .price-free {
        font-size: 1.2rem;
        font-weight: 600;
        color: var(--ft-success-text);
      }

      .plan-card__desc {
        margin: 0;
        color: var(--ft-text-muted);
        font-size: 0.85rem;
        line-height: 1.5;
      }

      .plan-card__meta {
        margin: 0;
        font-size: 0.82rem;
        color: var(--ft-text);
        display: flex;
        gap: 0.4rem;
        flex-wrap: wrap;
        align-items: center;
      }

      .muted {
        color: var(--ft-text-muted);
      }

      .section {
        margin-top: var(--gap-sm);
      }

      .section h4 {
        margin: 0 0 0.5rem;
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ft-text-muted);
        font-weight: 600;
      }

      .kv {
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.35rem 0.8rem;
      }

      .kv > div {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.4rem;
        font-size: 0.8rem;
      }

      .kv dt {
        margin: 0;
        color: var(--ft-text-muted);
      }

      .kv dd {
        margin: 0;
        color: var(--ft-text);
      }

      .kv code {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 0.78rem;
        color: var(--ft-text);
        word-break: break-all;
      }

      .features {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.25rem 0.6rem;
      }

      .features li {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.78rem;
        color: var(--ft-text);
      }

      .features li.off {
        color: var(--ft-text-muted);
        text-decoration: line-through;
      }

      .features .pi-check-circle {
        color: var(--ft-success-text);
      }

      .features .pi-times-circle {
        color: var(--ft-text-subtle);
      }

      .modules {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
      }

      .modules .pi {
        font-size: 0.7rem;
        margin-right: 0.2rem;
      }

      .plan-card__actions {
        display: flex;
        gap: 0.4rem;
        justify-content: flex-end;
        margin-top: auto;
        padding-top: var(--gap-sm);
        border-top: 1px solid var(--ft-border);
      }
    `
  ]
})
export class PlatformPlansPageComponent implements OnInit {
  private readonly api = inject(PlatformPlansService);
  private readonly toast = inject(MessageService);

  protected readonly skeletonCards = Array.from({ length: 3 });

  protected t(key: keyof typeof PLANS_FR): string {
    return PLANS_FR[key];
  }

  readonly plans = signal<PlanDto[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  protected includeArchived = false;

  // Modals
  formDialogOpen = false;
  cloneDialogOpen = false;
  archiveDialogOpen = false;
  readonly formTarget = signal<PlanDto | null>(null);
  readonly cloneTarget = signal<PlanDto | null>(null);
  readonly archiveTarget = signal<PlanDto | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list(this.includeArchived).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.success && res.data) this.plans.set(res.data);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.toastError(undefined, err);
      }
    });
  }

  onIncludeArchivedChange(_value: boolean): void {
    this.load();
  }

  includedModulesCount(plan: PlanDto): number {
    return plan.modules.filter((m) => m.isIncluded).length;
  }

  // ----- Create / Edit -----------------------------------------------------
  openCreate(): void {
    this.formTarget.set(null);
    this.formDialogOpen = true;
  }

  openEdit(plan: PlanDto): void {
    this.formTarget.set(plan);
    this.formDialogOpen = true;
  }

  onFormConfirmed(payload: {
    isEdit: boolean;
    id?: string;
    create?: CreatePlanRequest;
    update?: UpdatePlanRequest;
  }): void {
    if (payload.isEdit && payload.id && payload.update) {
      this.busy.set(true);
      this.api.update(payload.id, payload.update).subscribe({
        next: (res) => {
          this.busy.set(false);
          if (res.success) {
            this.formDialogOpen = false;
            this.toast.add({
              severity: 'success',
              summary: PLANS_FR['toast.update.success'],
              detail: payload.update?.name
            });
            this.load();
          } else {
            this.toastError(res.message);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.toastError(err?.error?.message, err);
        }
      });
    } else if (!payload.isEdit && payload.create) {
      this.busy.set(true);
      this.api.create(payload.create).subscribe({
        next: (res) => {
          this.busy.set(false);
          if (res.success) {
            this.formDialogOpen = false;
            this.toast.add({
              severity: 'success',
              summary: PLANS_FR['toast.create.success'],
              detail: payload.create?.code
            });
            this.load();
          } else {
            this.toastError(res.message);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.busy.set(false);
          this.toastError(err?.error?.message, err);
        }
      });
    }
  }

  // ----- Clone -------------------------------------------------------------
  openClone(plan: PlanDto): void {
    this.cloneTarget.set(plan);
    this.cloneDialogOpen = true;
  }

  onCloneConfirmed(payload: { source: PlanDto; request: ClonePlanRequest }): void {
    this.busy.set(true);
    this.api.clone(payload.source.id, payload.request).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.cloneDialogOpen = false;
        if (res.success) {
          this.toast.add({
            severity: 'success',
            summary: PLANS_FR['toast.clone.success'],
            detail: payload.request.newCode
          });
          this.load();
        } else {
          this.toastError(res.message);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.toastError(err?.error?.message, err);
      }
    });
  }

  // ----- Archive -----------------------------------------------------------
  openArchive(plan: PlanDto): void {
    this.archiveTarget.set(plan);
    this.archiveDialogOpen = true;
  }

  onArchiveConfirmed(): void {
    const target = this.archiveTarget();
    if (!target) return;
    this.busy.set(true);
    this.api.archive(target.id).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.archiveDialogOpen = false;
        if (res.success) {
          this.toast.add({
            severity: 'success',
            summary: PLANS_FR['toast.archive.success'],
            detail: target.name
          });
          this.load();
        } else {
          this.toastError(res.message);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.toastError(err?.error?.message, err);
      }
    });
  }

  reactivate(plan: PlanDto): void {
    this.busy.set(true);
    this.api.reactivate(plan.id).subscribe({
      next: (res) => {
        this.busy.set(false);
        if (res.success) {
          this.toast.add({
            severity: 'success',
            summary: PLANS_FR['toast.reactivate.success'],
            detail: plan.name
          });
          this.load();
        } else {
          this.toastError(res.message);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.toastError(err?.error?.message, err);
      }
    });
  }

  private toastError(detail?: string | null, err?: HttpErrorResponse): void {
    let resolved = detail;
    if (!resolved && err) {
      // eslint-disable-next-line no-console
      console.error('[PlansPage] API error', err.status, err.url, err.error ?? err.message);
      resolved = this.humanizeHttpError(err);
    }
    this.toast.add({
      severity: 'error',
      summary: PLANS_FR['toast.error.title'],
      detail: resolved ?? PLANS_FR['toast.error.detail']
    });
  }

  private humanizeHttpError(err: HttpErrorResponse): string {
    if (err.status === 0) return PLANS_FR['toast.error.networkUnreachable'];
    if (err.status === 401) return PLANS_FR['toast.error.sessionExpired'];
    if (err.status === 403) return PLANS_FR['toast.error.forbidden'];
    if (err.status === 404) return PLANS_FR['toast.error.notFound'];
    if (err.status === 400) {
      const apiMessage = (err.error as { message?: string } | null)?.message;
      return apiMessage ?? PLANS_FR['toast.error.badRequest'];
    }
    if (err.status >= 500) return PLANS_FR['toast.error.server'];
    const fallbackMessage = (err.error as { message?: string } | null)?.message;
    return fallbackMessage ?? `HTTP ${err.status}`;
  }
}
