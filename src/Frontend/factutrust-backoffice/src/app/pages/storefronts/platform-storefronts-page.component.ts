import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';

import {
  PlatformStorefrontService,
  type PlatformStorefrontProfileDto,
  type StorefrontListFilter,
  type StorefrontStatsDto
} from '@core/services/platform-storefront.service';

import { FtPageHeaderComponent } from '@core/ui/page-header/ft-page-header.component';
import { FtKpiCardComponent } from '@core/ui/kpi-card/ft-kpi-card.component';
import { FtEmptyStateComponent } from '@core/ui/empty-state/ft-empty-state.component';
import { FtSkeletonComponent } from '@core/ui/skeleton/ft-skeleton.component';

import { STOREFRONTS_FR } from './storefronts.i18n.fr';
import { StorefrontCardComponent } from './storefront-card.component';
import { StorefrontApproveDialogComponent } from './storefront-approve-dialog.component';
import { StorefrontRejectDialogComponent } from './storefront-reject-dialog.component';

interface TabState {
  filter: StorefrontListFilter;
  loading: boolean;
  rows: PlatformStorefrontProfileDto[];
  loaded: boolean;
}

@Component({
  selector: 'app-platform-storefronts-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    ButtonModule,
    TabsModule,
    TooltipModule,
    FtPageHeaderComponent,
    FtKpiCardComponent,
    FtEmptyStateComponent,
    FtSkeletonComponent,
    StorefrontCardComponent,
    StorefrontApproveDialogComponent,
    StorefrontRejectDialogComponent
  ],
  template: `
    <ft-page-header [title]="t('list.title')" [subtitle]="t('list.subtitle')">
      <ng-container ftActions>
        <p-button
          [label]="t('list.actions.refresh')"
          icon="pi pi-refresh"
          [outlined]="true"
          [disabled]="anyLoading()"
          (onClick)="reloadAll()"
        />
      </ng-container>
    </ft-page-header>

    <!-- KPIs -->
    <section class="kpi-row" role="region" aria-label="Indicateurs vitrines">
      <ft-kpi-card
        [label]="t('kpi.pending')"
        [value]="stats()?.pending ?? null"
        [hint]="t('kpi.pending.hint')"
        tone="warning"
        icon="pi pi-clock"
        [clickable]="true"
        [active]="activeIndex() === 0"
        [loading]="statsLoading()"
        (cardClick)="goToTab(0)"
      />
      <ft-kpi-card
        [label]="t('kpi.published')"
        [value]="stats()?.published ?? null"
        [hint]="t('kpi.published.hint')"
        tone="success"
        icon="pi pi-check-circle"
        [clickable]="true"
        [active]="activeIndex() === 1"
        [loading]="statsLoading()"
        (cardClick)="goToTab(1)"
      />
      <ft-kpi-card
        [label]="t('kpi.rejected')"
        [value]="stats()?.rejected ?? null"
        [hint]="t('kpi.rejected.hint')"
        tone="danger"
        icon="pi pi-times-circle"
        [clickable]="true"
        [active]="activeIndex() === 2"
        [loading]="statsLoading()"
        (cardClick)="goToTab(2)"
      />
      <ft-kpi-card
        [label]="t('kpi.suspended')"
        [value]="stats()?.suspended ?? null"
        [hint]="t('kpi.suspended.hint')"
        tone="neutral"
        icon="pi pi-pause-circle"
        [clickable]="true"
        [active]="activeIndex() === 3"
        [loading]="statsLoading()"
        (cardClick)="goToTab(3)"
      />
    </section>

    <!-- Tabs -->
    <p-tabs
      [value]="activeIndex()"
      (valueChange)="onTabChange($event)"
      class="ft-storefronts-tabs"
      [lazy]="true"
    >
      <p-tablist>
        <p-tab [value]="0">{{ t('tab.pending') }} ({{ stats()?.pending ?? '…' }})</p-tab>
        <p-tab [value]="1">{{ t('tab.published') }} ({{ stats()?.published ?? '…' }})</p-tab>
        <p-tab [value]="2">{{ t('tab.rejected') }} ({{ stats()?.rejected ?? '…' }})</p-tab>
        <p-tab [value]="3">{{ t('tab.suspended') }} ({{ stats()?.suspended ?? '…' }})</p-tab>
      </p-tablist>
      <p-tabpanels>
      <p-tabpanel [value]="0">
        <ng-container *ngTemplateOutlet="grid; context: { state: pendingTab() }" />
      </p-tabpanel>
      <p-tabpanel [value]="1">
        <ng-container *ngTemplateOutlet="grid; context: { state: publishedTab() }" />
      </p-tabpanel>
      <p-tabpanel [value]="2">
        <ng-container *ngTemplateOutlet="grid; context: { state: rejectedTab() }" />
      </p-tabpanel>
      <p-tabpanel [value]="3">
        <ng-container *ngTemplateOutlet="grid; context: { state: suspendedTab() }" />
      </p-tabpanel>
      </p-tabpanels>
    </p-tabs>

    <!-- Grid template -->
    <ng-template #grid let-state="state">
      @if (state.loading) {
        <div class="grid">
          @for (i of skeletonCards; track $index) {
            <ft-skeleton shape="rect" width="100%" height="22rem" />
          }
        </div>
      } @else if (state.rows.length === 0) {
        <ft-empty-state
          [variant]="emptyVariant(state.filter)"
          [title]="emptyTitle(state.filter)"
          [description]="emptyDesc(state.filter)"
        />
      } @else {
        <div class="grid">
          @for (row of state.rows; track row.id) {
            <app-storefront-card
              [data]="row"
              [busy]="busyId() === row.id"
              [busyAction]="busyId() === row.id ? busyAction() : null"
              (approveClick)="onApprove($event)"
              (rejectClick)="onReject($event)"
            />
          }
        </div>
      }
    </ng-template>

    <!-- Modals -->
    <app-storefront-approve-dialog
      [(visible)]="approveDialogOpen"
      [data]="dialogTarget()"
      [busy]="busyAction() === 'approve'"
      (confirmed)="confirmApprove($event)"
    />
    <app-storefront-reject-dialog
      [(visible)]="rejectDialogOpen"
      [data]="dialogTarget()"
      [busy]="busyAction() === 'reject'"
      (confirmed)="confirmReject($event)"
    />
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
        gap: var(--gap-md);
        padding: var(--gap-md) 0;
      }

      :host ::ng-deep .ft-storefronts-tabs .p-tablist-tab-list {
        background: transparent;
        border-bottom: 1px solid var(--ft-border);
      }

      :host ::ng-deep .ft-storefronts-tabs .p-tab {
        background: transparent;
        color: var(--ft-text-muted);
        border-color: transparent;
        font-weight: 500;
      }

      :host ::ng-deep .ft-storefronts-tabs .p-tab.p-tab-active {
        color: var(--ft-accent);
        border-color: var(--ft-accent);
      }

      :host ::ng-deep .ft-storefronts-tabs .p-tabpanels {
        background: transparent;
        padding: 0;
      }
    `
  ]
})
export class PlatformStorefrontsPageComponent implements OnInit {
  private readonly api = inject(PlatformStorefrontService);
  private readonly toast = inject(MessageService);

  protected readonly skeletonCards = Array.from({ length: 6 });

  protected t(key: keyof typeof STOREFRONTS_FR): string {
    return STOREFRONTS_FR[key];
  }

  // ----- State -----
  readonly stats = signal<StorefrontStatsDto | null>(null);
  readonly statsLoading = signal(false);
  readonly activeIndex = signal(0);

  readonly pendingTab = signal<TabState>({ filter: 'pending', loading: false, rows: [], loaded: false });
  readonly publishedTab = signal<TabState>({ filter: 'published', loading: false, rows: [], loaded: false });
  readonly rejectedTab = signal<TabState>({ filter: 'rejected', loading: false, rows: [], loaded: false });
  readonly suspendedTab = signal<TabState>({ filter: 'suspended', loading: false, rows: [], loaded: false });

  readonly anyLoading = computed(
    () =>
      this.statsLoading() ||
      this.pendingTab().loading ||
      this.publishedTab().loading ||
      this.rejectedTab().loading ||
      this.suspendedTab().loading
  );

  // Modals
  approveDialogOpen = false;
  rejectDialogOpen = false;
  readonly dialogTarget = signal<PlatformStorefrontProfileDto | null>(null);
  readonly busyId = signal<string | null>(null);
  readonly busyAction = signal<'approve' | 'reject' | null>(null);

  ngOnInit(): void {
    this.loadStats();
    this.loadTab(0);
  }

  // ----- Tabs -----
  onTabChange(index: string | number | undefined): void {
    const tabIndex = typeof index === 'number' ? index : Number(index);
    if (Number.isNaN(tabIndex)) return;
    this.activeIndex.set(tabIndex);
    this.loadTab(tabIndex);
  }

  goToTab(index: number): void {
    this.activeIndex.set(index);
    this.loadTab(index);
  }

  reloadAll(): void {
    this.loadStats();
    // Reset loaded flags pour forcer rechargement de la tab active
    this.pendingTab.update((s) => ({ ...s, loaded: false }));
    this.publishedTab.update((s) => ({ ...s, loaded: false }));
    this.rejectedTab.update((s) => ({ ...s, loaded: false }));
    this.suspendedTab.update((s) => ({ ...s, loaded: false }));
    this.loadTab(this.activeIndex());
  }

  private loadStats(): void {
    this.statsLoading.set(true);
    this.api.stats().subscribe({
      next: (res) => {
        this.statsLoading.set(false);
        if (res.success && res.data) this.stats.set(res.data);
      },
      error: () => {
        this.statsLoading.set(false);
      }
    });
  }

  private loadTab(index: number): void {
    const tabSignal = this.tabSignalFor(index);
    const state = tabSignal();
    if (state.loaded || state.loading) return;

    tabSignal.update((s) => ({ ...s, loading: true }));

    const filter = state.filter;
    const obs =
      filter === 'pending' ? this.api.listPending() : this.api.listByStatus(filter);

    obs.subscribe({
      next: (res) => {
        if (res.success && res.data) {
          tabSignal.set({ filter, loading: false, rows: res.data, loaded: true });
        } else {
          tabSignal.set({ filter, loading: false, rows: [], loaded: true });
          this.toast.add({
            severity: 'warn',
            summary: 'Liste',
            detail: res.message ?? 'Réponse vide'
          });
        }
      },
      error: () => {
        tabSignal.set({ filter, loading: false, rows: [], loaded: true });
        this.toast.add({
          severity: 'error',
          summary: STOREFRONTS_FR['toast.error.title'],
          detail: STOREFRONTS_FR['toast.error.detail']
        });
      }
    });
  }

  private tabSignalFor(index: number) {
    switch (index) {
      case 1:
        return this.publishedTab;
      case 2:
        return this.rejectedTab;
      case 3:
        return this.suspendedTab;
      case 0:
      default:
        return this.pendingTab;
    }
  }

  // ----- Empty states ------------------------------------------------------
  protected emptyVariant(filter: StorefrontListFilter): 'all-clear' | 'table-empty' {
    return filter === 'pending' ? 'all-clear' : 'table-empty';
  }

  protected emptyTitle(filter: StorefrontListFilter): string {
    switch (filter) {
      case 'pending':
        return STOREFRONTS_FR['empty.pending.title'];
      case 'published':
        return STOREFRONTS_FR['empty.published.title'];
      case 'rejected':
        return STOREFRONTS_FR['empty.rejected.title'];
      case 'suspended':
        return STOREFRONTS_FR['empty.suspended.title'];
      default:
        return '—';
    }
  }

  protected emptyDesc(filter: StorefrontListFilter): string {
    switch (filter) {
      case 'pending':
        return STOREFRONTS_FR['empty.pending.desc'];
      case 'published':
        return STOREFRONTS_FR['empty.published.desc'];
      case 'rejected':
        return STOREFRONTS_FR['empty.rejected.desc'];
      case 'suspended':
        return STOREFRONTS_FR['empty.suspended.desc'];
      default:
        return '';
    }
  }

  // ----- Modal handlers ----------------------------------------------------
  onApprove(row: PlatformStorefrontProfileDto): void {
    this.dialogTarget.set(row);
    this.approveDialogOpen = true;
  }

  onReject(row: PlatformStorefrontProfileDto): void {
    this.dialogTarget.set(row);
    this.rejectDialogOpen = true;
  }

  confirmApprove(row: PlatformStorefrontProfileDto): void {
    this.busyId.set(row.id);
    this.busyAction.set('approve');
    this.api.approve(row.id).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.busyAction.set(null);
        this.approveDialogOpen = false;
        if (res.success) {
          this.toast.add({
            severity: 'success',
            summary: STOREFRONTS_FR['toast.approve.success'],
            detail: res.message ?? row.displayName
          });
          this.removeRowFromCurrentTab(row.id);
          this.loadStats();
        } else {
          this.toast.add({
            severity: 'error',
            summary: 'Échec',
            detail: res.errors?.join(' ') ?? res.message ?? 'Approbation refusée'
          });
        }
      },
      error: () => {
        this.busyId.set(null);
        this.busyAction.set(null);
        this.approveDialogOpen = false;
        this.toast.add({
          severity: 'error',
          summary: STOREFRONTS_FR['toast.error.title'],
          detail: 'Publication refusée.'
        });
      }
    });
  }

  confirmReject(payload: { data: PlatformStorefrontProfileDto; reason: string }): void {
    const { data, reason } = payload;
    this.busyId.set(data.id);
    this.busyAction.set('reject');
    this.api.reject(data.id, reason).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.busyAction.set(null);
        this.rejectDialogOpen = false;
        if (res.success) {
          this.toast.add({
            severity: 'success',
            summary: STOREFRONTS_FR['toast.reject.success'],
            detail: res.message ?? data.displayName
          });
          this.removeRowFromCurrentTab(data.id);
          this.loadStats();
        } else {
          this.toast.add({
            severity: 'error',
            summary: 'Échec',
            detail: res.errors?.join(' ') ?? res.message ?? 'Refus impossible'
          });
        }
      },
      error: () => {
        this.busyId.set(null);
        this.busyAction.set(null);
        this.rejectDialogOpen = false;
        this.toast.add({
          severity: 'error',
          summary: STOREFRONTS_FR['toast.error.title'],
          detail: 'Refus impossible.'
        });
      }
    });
  }

  /** Retire la ligne traitée de la tab active (l'API la déplace vers une autre liste). */
  private removeRowFromCurrentTab(id: string): void {
    const tabSig = this.tabSignalFor(this.activeIndex());
    tabSig.update((s) => ({
      ...s,
      rows: s.rows.filter((r) => r.id !== id)
    }));
    // Invalide les autres tabs : la ligne y est peut-être maintenant
    this.publishedTab.update((s) => ({ ...s, loaded: false }));
    this.rejectedTab.update((s) => ({ ...s, loaded: false }));
    this.suspendedTab.update((s) => ({ ...s, loaded: false }));
  }
}
