import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { SplitButtonModule } from 'primeng/splitbutton';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService, MenuItem } from 'primeng/api';
import { PlatformTenantService } from '@core/services/platform-tenant.service';
import { PlatformPermissionsService } from '@core/services/platform-permissions.service';
import {
  PlatformPermission,
  type PlatformTenantListItemDto,
  type PlatformTenantStatsDto,
  type SavedTenantView,
  type SubscriptionPlanValue,
  type SubscriptionStatusValue,
  type TaxRegimeValue,
  type TenantKindFilterValue,
  type TenantSortKey
} from '@core/models/platform.models';

import { FtPageHeaderComponent } from '@core/ui/page-header/ft-page-header.component';
import { FtKpiCardComponent } from '@core/ui/kpi-card/ft-kpi-card.component';
import { FtFilterToolbarComponent } from '@core/ui/filter-toolbar/ft-filter-toolbar.component';
import { FtChipComponent } from '@core/ui/chip/ft-chip.component';
import { FtEmptyStateComponent } from '@core/ui/empty-state/ft-empty-state.component';
import { FtSkeletonComponent } from '@core/ui/skeleton/ft-skeleton.component';
import { FtCellTenantComponent } from '@core/ui/table-cells/ft-cell-tenant.component';
import { FtBadgeComponent } from '@core/ui/badge/ft-badge.component';
import { FtCellMoneyComponent } from '@core/ui/table-cells/ft-cell-money.component';
import { FtCellRelativeDateComponent } from '@core/ui/table-cells/ft-cell-relative-date.component';
import { FtCellStatusComponent } from '@core/ui/table-cells/ft-cell-status.component';
import { FtCellPlanComponent } from '@core/ui/table-cells/ft-cell-plan.component';
import { FtCellActionsMenuComponent } from '@core/ui/table-cells/ft-cell-actions-menu.component';

import { TENANTS_FR } from './tenants.i18n.fr';
import { TenantQuickViewDrawerComponent } from './tenant-quick-view-drawer.component';

interface ActiveChip {
  key: string;
  label: string;
  value: string;
}

@Component({
  selector: 'app-platform-tenants-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TableModule,
    InputTextModule,
    ButtonModule,
    SelectModule,
    CheckboxModule,
    SplitButtonModule,
    TooltipModule,
    FtPageHeaderComponent,
    FtKpiCardComponent,
    FtFilterToolbarComponent,
    FtChipComponent,
    FtEmptyStateComponent,
    FtSkeletonComponent,
    FtBadgeComponent,
    FtCellTenantComponent,
    FtCellMoneyComponent,
    FtCellRelativeDateComponent,
    FtCellStatusComponent,
    FtCellPlanComponent,
    FtCellActionsMenuComponent,
    TenantQuickViewDrawerComponent
  ],
  template: `
    <ft-page-header [title]="t('list.title')" [subtitle]="t('list.subtitle')">
      <ng-container ftActions>
        <p-button
          [label]="t('list.actions.export')"
          icon="pi pi-download"
          [outlined]="true"
          [disabled]="true"
          pTooltip="Export CSV — bientôt"
          tooltipPosition="bottom"
        />
        @if (canCreateTenant() && canCreateFirm()) {
          <p-splitButton
            [label]="t('list.actions.create')"
            icon="pi pi-plus"
            [model]="createTenantMenuItems()"
            (onClick)="goCreateCompany()"
          />
        } @else if (canCreateTenant()) {
          <!-- Cabinets désactivés sur cette instance : pas de menu, l'entreprise reste créable. -->
          <p-button
            [label]="t('list.actions.create')"
            icon="pi pi-plus"
            (onClick)="goCreateCompany()"
          />
        } @else {
          <p-button
            [label]="t('list.actions.create')"
            icon="pi pi-plus"
            [disabled]="true"
            pTooltip="Permission platform.tenants:write requise"
            tooltipPosition="bottom"
          />
        }
      </ng-container>
    </ft-page-header>

    <!-- KPIs row -->
    <section class="kpi-row" role="region" aria-label="Indicateurs clés">
      <ft-kpi-card
        [label]="t('kpi.total')"
        [value]="stats()?.totalTenants ?? null"
        [delta]="totalDeltaFraction()"
        [hint]="totalHint()"
        [sparkline]="stats()?.newSignupsTimeseries30d ?? null"
        tone="info"
        icon="pi pi-building"
        [clickable]="true"
        [active]="!hasActiveFilters()"
        [loading]="statsLoading()"
        (cardClick)="resetFilters()"
      />
      <ft-kpi-card
        [label]="t('kpi.paying')"
        [value]="stats()?.payingSubscribers ?? null"
        [hint]="payingHint()"
        tone="success"
        icon="pi pi-credit-card"
        [clickable]="true"
        [active]="filterSegment() === 'paying'"
        [loading]="statsLoading()"
        (cardClick)="filterToSegment('paying')"
      />
      <ft-kpi-card
        [label]="t('kpi.conversion')"
        [value]="conversionPercent()"
        [delta]="stats()?.trialConversionDelta30d ?? null"
        [hint]="t('kpi.conversion.hint')"
        tone="info"
        icon="pi pi-chart-line"
        [loading]="statsLoading()"
      />
      <ft-kpi-card
        [label]="t('kpi.risk')"
        [value]="stats()?.riskCount ?? null"
        [hint]="t('kpi.risk.hint')"
        tone="danger"
        icon="pi pi-shield"
        [clickable]="true"
        [active]="filterSubStatus() === 4 || filterSubStatus() === 5"
        [loading]="statsLoading()"
        (cardClick)="filterToRisk()"
      />
    </section>

    <!-- Toolbar -->
    <ft-filter-toolbar>
      <span class="search-wrap">
        <i class="pi pi-search" aria-hidden="true"></i>
        <input
          type="search"
          pInputText
          [ngModel]="searchDraft()"
          (ngModelChange)="onSearchChange($event)"
          [placeholder]="t('filters.search.placeholder')"
          aria-label="Recherche entreprises"
        />
      </span>
      <p-select
        [options]="segmentOptions"
        [ngModel]="filterSegment()"
        (ngModelChange)="setFilter('segment', $event)"
        optionLabel="label"
        optionValue="value"
        [placeholder]="t('filters.segment')"
        [showClear]="true"
        styleClass="ft-dd"
      />
      <p-select
        [options]="planOptions"
        [ngModel]="filterPlan()"
        (ngModelChange)="setFilter('plan', $event)"
        optionLabel="label"
        optionValue="value"
        [placeholder]="t('filters.plan')"
        [showClear]="true"
        styleClass="ft-dd"
      />
      <p-select
        [options]="subStatusOptions"
        [ngModel]="filterSubStatus()"
        (ngModelChange)="setFilter('subscriptionStatus', $event)"
        optionLabel="label"
        optionValue="value"
        [placeholder]="t('filters.status')"
        [showClear]="true"
        styleClass="ft-dd"
      />
      <p-select
        [options]="activeOptions"
        [ngModel]="filterActive()"
        (ngModelChange)="setFilter('isActive', $event)"
        optionLabel="label"
        optionValue="value"
        [placeholder]="t('filters.tenantState')"
        [showClear]="true"
        styleClass="ft-dd"
      />
      <p-select
        [options]="taxOptions"
        [ngModel]="filterTax()"
        (ngModelChange)="setFilter('taxRegime', $event)"
        optionLabel="label"
        optionValue="value"
        [placeholder]="t('filters.taxRegime')"
        [showClear]="true"
        styleClass="ft-dd"
      />
      <p-select
        [options]="kindOptions"
        [ngModel]="filterKind()"
        (ngModelChange)="setFilter('kind', $event)"
        optionLabel="label"
        optionValue="value"
        [placeholder]="t('filters.kind')"
        [showClear]="true"
        styleClass="ft-dd"
      />

      <ng-container ftActions>
        <p-splitButton
          [label]="t('filters.savedViews')"
          icon="pi pi-bookmark"
          severity="secondary"
          [outlined]="true"
          [model]="savedViewsMenu()"
          (onClick)="onSaveCurrentView()"
        />
        <p-button
          [label]="t('filters.reset')"
          icon="pi pi-filter-slash"
          [text]="true"
          [disabled]="!hasActiveFilters()"
          (onClick)="resetFilters()"
        />
      </ng-container>

      <ng-container ftChips>
        @for (chip of activeChips(); track chip.key) {
          <ft-chip [label]="chip.label" [value]="chip.value" (remove)="clearFilter(chip.key)" />
        }
        @if (activeChips().length > 1) {
          <button class="chip-clear" (click)="resetFilters()">
            {{ t('filters.activeChips.clearAll') }}
          </button>
        }
      </ng-container>
    </ft-filter-toolbar>

    <!-- Bulk action bar (sticky) -->
    @if (selectedRows().length > 0) {
      <div class="bulk-bar" role="region" aria-label="Actions groupées">
        <span class="bulk-bar__count">
          {{ t('bulk.selected').replace('{count}', String(selectedRows().length)) }}
        </span>
        <p-button [label]="t('bulk.suspend')" icon="pi pi-pause" severity="warn" [outlined]="true" size="small" [disabled]="true" pTooltip="Disponible avec Lot D2" tooltipPosition="top" />
        <p-button [label]="t('bulk.export')" icon="pi pi-download" [outlined]="true" size="small" [disabled]="true" pTooltip="Disponible bientôt" tooltipPosition="top" />
        <p-button [label]="t('bulk.email')" icon="pi pi-envelope" [outlined]="true" size="small" [disabled]="true" pTooltip="Disponible avec Lot C2" tooltipPosition="top" />
        <p-button icon="pi pi-times" [text]="true" size="small" [ariaLabel]="t('bulk.clear')" (onClick)="clearSelection()" />
      </div>
    }

    <!-- Table -->
    <p-table
      [value]="rows()"
      [loading]="loading()"
      [lazy]="true"
      [first]="tableFirst()"
      (onLazyLoad)="onLazyLoad($event)"
      [paginator]="totalCount() > 0"
      [rows]="pageSize()"
      [totalRecords]="totalCount()"
      [rowsPerPageOptions]="[10, 25, 50, 100]"
      [showCurrentPageReport]="totalCount() > 0"
      [currentPageReportTemplate]="t('pagination.template')"
      [(selection)]="selectedRowsModel"
      dataKey="tenantId"
      [sortField]="sortField()"
      [sortOrder]="sortOrder()"
      [customSort]="false"
      responsiveLayout="scroll"
      styleClass="p-datatable-sm ft-table"
      [tableStyle]="{ 'min-width': '64rem' }"
    >
      <ng-template pTemplate="header">
        <tr>
          <th scope="col" style="width:2.6rem">
            <p-tableHeaderCheckbox />
          </th>
          <th scope="col" pSortableColumn="name">
            {{ t('col.companyName') }} <p-sortIcon field="name" />
          </th>
          <th scope="col">{{ t('col.nif') }}</th>
          <th scope="col">{{ t('col.taxRegime') }}</th>
          <th scope="col" pSortableColumn="plan">
            {{ t('col.plan') }} <p-sortIcon field="plan" />
          </th>
          <th scope="col" pSortableColumn="status">
            {{ t('col.status') }} <p-sortIcon field="status" />
          </th>
          <th scope="col" pSortableColumn="mrr" class="num">
            {{ t('col.mrr') }} <p-sortIcon field="mrr" />
          </th>
          <th scope="col" pSortableColumn="lastActivity">
            {{ t('col.lastActivity') }} <p-sortIcon field="lastActivity" />
          </th>
          <th scope="col" class="col-actions">{{ t('col.actions') }}</th>
        </tr>
      </ng-template>

      <ng-template pTemplate="body" let-row>
        <tr (click)="openQuickView(row, $event)" class="clickable">
          <td (click)="$event.stopPropagation()">
            <p-tableCheckbox [value]="row" />
          </td>
          <td>
            <ft-cell-tenant
              [name]="row.companyName"
              [email]="row.companyEmail"
              [seed]="row.tenantId"
            />
            <!-- Un cabinet comptable siège dans la même table qu'une entreprise : sans ce badge,
                 rien ne les distingue. Une valeur absente vaut Company (API antérieure). -->
            @if (row.kind === 'AccountingFirm') {
              <ft-badge tone="info" size="sm">{{ t('kind.accountingFirm') }}</ft-badge>
            }
            <!-- Affiche uniquement l'anomalie : un dossier Pending/Failed existe mais sa base
                 n'est pas exploitable. Le cas nominal reste invisible pour ne pas alourdir la table. -->
            @if (row.provisioningStatus === 'Pending') {
              <ft-badge tone="warning" size="sm">{{ t('provisioning.pending') }}</ft-badge>
            } @else if (row.provisioningStatus === 'Failed') {
              <ft-badge tone="danger" size="sm">{{ t('provisioning.failed') }}</ft-badge>
            }
          </td>
          <td><code class="cell-mono">{{ row.nif ?? '—' }}</code></td>
          <td>{{ row.taxRegimeDisplay }}</td>
          <td>
            <ft-cell-plan
              [planCode]="row.subscriptionPlan"
              [planDisplay]="row.subscriptionPlanDisplay"
            />
          </td>
          <td>
            <ft-cell-status
              [status]="row.subscriptionStatus"
              [statusDisplay]="row.subscriptionStatusDisplay"
            />
          </td>
          <td class="num">
            <ft-cell-money [amount]="row.mrrTnd ?? null" [fractionDigits]="0" />
          </td>
          <td>
            <ft-cell-relative-date [date]="row.lastActivityAt ?? null" />
          </td>
          <td class="col-actions" (click)="$event.stopPropagation()">
            <ft-cell-actions-menu [items]="rowActionsById().get(row.tenantId) ?? []" />
          </td>
        </tr>
      </ng-template>

      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="9">
            <ft-empty-state
              [variant]="hasActiveFilters() ? 'search-no-result' : 'table-empty'"
              [title]="hasActiveFilters() ? t('empty.noResult.title') : t('empty.noTenant.title')"
              [description]="hasActiveFilters() ? t('empty.noResult.desc') : t('empty.noTenant.desc')"
            >
              @if (hasActiveFilters()) {
                <p-button
                  [label]="t('filters.reset')"
                  icon="pi pi-filter-slash"
                  [outlined]="true"
                  (onClick)="resetFilters()"
                />
              }
            </ft-empty-state>
          </td>
        </tr>
      </ng-template>

      <ng-template pTemplate="loadingbody">
        @for (i of skeletonRows; track $index) {
          <tr>
            <td><ft-skeleton shape="rect" width="1rem" height="1rem" /></td>
            <td>
              <div class="skel-cell">
                <ft-skeleton shape="circle" width="1.75rem" height="1.75rem" />
                <div style="flex:1">
                  <ft-skeleton shape="line" width="70%" />
                  <ft-skeleton shape="line" width="50%" />
                </div>
              </div>
            </td>
            <td><ft-skeleton shape="line" width="6rem" /></td>
            <td><ft-skeleton shape="line" width="5rem" /></td>
            <td><ft-skeleton shape="line" width="4rem" /></td>
            <td><ft-skeleton shape="line" width="5rem" /></td>
            <td class="num"><ft-skeleton shape="line" width="3rem" /></td>
            <td><ft-skeleton shape="line" width="5rem" /></td>
            <td class="col-actions"><ft-skeleton shape="circle" width="1.6rem" height="1.6rem" /></td>
          </tr>
        }
      </ng-template>
    </p-table>

    <!-- Quick view drawer -->
    <app-tenant-quick-view-drawer
      [visible]="drawerOpen()"
      (visibleChange)="drawerOpen.set($event)"
      [tenantId]="drawerTenantId()"
    />
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .chip-clear {
        background: transparent;
        border: 0;
        color: var(--ft-text-muted);
        font-size: 0.78rem;
        cursor: pointer;
        padding: 0.2rem 0.5rem;
        border-radius: var(--ft-radius-sm);
        transition: color var(--duration-fast) var(--easing-standard);
      }

      .chip-clear:hover {
        color: var(--ft-accent);
      }

      /* Bulk action bar */
      .bulk-bar {
        position: sticky;
        bottom: 1rem;
        z-index: var(--z-dropdown);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--gap-sm);
        padding: 0.65rem 1rem;
        margin-bottom: var(--gap-md);
        background: var(--ft-surface);
        border: 1px solid var(--ft-accent-border);
        border-radius: var(--ft-radius);
        box-shadow: var(--ft-elev-3);
      }

      .bulk-bar__count {
        font-size: 0.85rem;
        color: var(--ft-text);
        font-weight: 500;
      }

      /* Table polish */
      .clickable {
        cursor: pointer;
      }

      .skel-cell {
        display: flex;
        align-items: center;
        gap: 0.6rem;
      }
    `
  ]
})
export class PlatformTenantsPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(PlatformTenantService);
  private readonly messages = inject(MessageService);
  private readonly router = inject(Router);
  private readonly permissions = inject(PlatformPermissionsService);
  private readonly destroy$ = new Subject<void>();
  private readonly searchInput$ = new Subject<string>();

  // Helper template
  protected readonly String = String;
  protected readonly skeletonRows = Array.from({ length: 8 });

  protected t(key: keyof typeof TENANTS_FR): string {
    return TENANTS_FR[key];
  }

  readonly canCreateTenant = computed(
    () => this.permissions.isLoaded() && this.permissions.has(PlatformPermission.TenantsWrite)
  );

  /**
   * Drapeau serveur `Features:AccountingFirms:Enabled`, remonté par
   * `GET /platform/auth/me/permissions`. Sans lui, l'opérateur remplit tout le formulaire cabinet
   * pour ne découvrir qu'à la soumission que l'endpoint répond 404. Purement ergonomique : la
   * garde qui fait autorité reste celle du serveur.
   */
  readonly canCreateFirm = computed(() => this.permissions.hasFeature('accountingFirms'));

  /**
   * Référence stable, et non une méthode qui rebâtit le tableau à chaque lecture.
   *
   * Le setter `model` du TieredMenu de PrimeNG reconstruit ses `processedItems` à chaque
   * affectation, et son `ngFor` interne n'a pas de `trackBy` : un tableau neuf à chaque cycle de
   * détection fait détruire puis recréer les `<li>`. Comme l'item écoute `(mouseenter)`, le
   * survoler suffit à déclencher ce cycle ; le `<li>` disparaît entre `mousedown` et `mouseup` et
   * le navigateur n'émet alors aucun `click` : la commande ne part jamais. Même raison que le
   * cache de `rowActionsById`.
   */
  readonly createTenantMenuItems = computed<MenuItem[]>(() => [
    {
      label: TENANTS_FR['list.actions.createFirm'],
      icon: 'pi pi-briefcase',
      command: () => {
        void this.router.navigate(['/tenants/new/firm']);
      }
    }
  ]);

  goCreateCompany(): void {
    void this.router.navigate(['/tenants/new/company']);
  }

  // ----- Filter state (signals) -----
  readonly searchDraft = signal('');
  private readonly searchApplied = signal('');
  readonly filterSegment = signal<string | null>(null);
  readonly filterPlan = signal<SubscriptionPlanValue | null>(null);
  readonly filterSubStatus = signal<SubscriptionStatusValue | null>(null);
  readonly filterActive = signal<boolean | null>(null);
  readonly filterTax = signal<TaxRegimeValue | null>(null);
  readonly filterKind = signal<TenantKindFilterValue | null>(null);

  // ----- Pagination + sort state -----
  readonly tableFirst = signal(0);
  readonly pageSize = signal(25);
  readonly sortField = signal<string>('name');
  readonly sortOrder = signal<number>(1); // 1 = asc, -1 = desc

  // ----- Data state -----
  readonly stats = signal<PlatformTenantStatsDto | null>(null);
  readonly statsLoading = signal(false);
  readonly rows = signal<PlatformTenantListItemDto[]>([]);
  readonly totalCount = signal(0);
  readonly loading = signal(false);

  // ----- Selection -----
  readonly selectedRows = signal<PlatformTenantListItemDto[]>([]);
  // p-table requires a property accessor for `[(selection)]`, so we expose
  // a getter/setter pair backed by the signal.
  get selectedRowsModel(): PlatformTenantListItemDto[] {
    return this.selectedRows();
  }
  set selectedRowsModel(value: PlatformTenantListItemDto[]) {
    this.selectedRows.set(value ?? []);
  }

  // ----- Drawer -----
  readonly drawerOpen = signal(false);
  readonly drawerTenantId = signal<string | null>(null);

  /** Cache stable des items kebab (évite de recréer command/routerLink à chaque CD). */
  readonly rowActionsById = computed(() => {
    this.permissions.current();
    const map = new Map<string, MenuItem[]>();
    for (const row of this.rows()) {
      map.set(row.tenantId, this.buildRowActions(row));
    }
    return map;
  });

  private lastLazyKey = '';

  // ----- Saved views -----
  private readonly savedViewsSig = signal<SavedTenantView[]>([]);

  // ----- Dropdown options -----
  readonly segmentOptions = [
    { label: TENANTS_FR['segment.paying'], value: 'paying' },
    { label: TENANTS_FR['segment.nonPaying'], value: 'non_paying' }
  ];
  readonly planOptions: { label: string; value: SubscriptionPlanValue }[] = [
    { label: TENANTS_FR['plan.free'], value: 0 },
    { label: TENANTS_FR['plan.monthly'], value: 1 },
    { label: TENANTS_FR['plan.annual'], value: 2 }
  ];
  readonly subStatusOptions: { label: string; value: SubscriptionStatusValue }[] = [
    { label: TENANTS_FR['status.active'], value: 0 },
    { label: TENANTS_FR['status.trial'], value: 1 },
    { label: TENANTS_FR['status.expired'], value: 2 },
    { label: TENANTS_FR['status.cancelled'], value: 3 },
    { label: TENANTS_FR['status.pastDue'], value: 4 },
    { label: TENANTS_FR['status.suspended'], value: 5 }
  ];
  readonly activeOptions = [
    { label: TENANTS_FR['tenantState.active'], value: true },
    { label: TENANTS_FR['tenantState.inactive'], value: false }
  ];
  readonly taxOptions: { label: string; value: TaxRegimeValue }[] = [
    { label: TENANTS_FR['taxRegime.real'], value: 0 },
    { label: TENANTS_FR['taxRegime.flatRate'], value: 1 },
    { label: TENANTS_FR['taxRegime.exempt'], value: 2 }
  ];
  readonly kindOptions: { label: string; value: TenantKindFilterValue }[] = [
    { label: TENANTS_FR['kind.company'], value: 0 },
    { label: TENANTS_FR['kind.accountingFirm'], value: 1 }
  ];

  // ----- Computed: hint texts & deltas -----
  readonly hasActiveFilters = computed(
    () =>
      !!this.searchApplied() ||
      this.filterSegment() !== null ||
      this.filterPlan() !== null ||
      this.filterSubStatus() !== null ||
      this.filterActive() !== null ||
      this.filterTax() !== null ||
      this.filterKind() !== null
  );

  /** Convertit le delta absolu (count) en fraction pour le badge `+xx %`. */
  readonly totalDeltaFraction = computed(() => {
    const s = this.stats();
    if (!s || s.totalDelta30d === null || s.totalDelta30d === undefined) return null;
    const previousTotal = s.totalTenants - s.totalDelta30d;
    return previousTotal > 0 ? s.totalDelta30d / previousTotal : null;
  });

  readonly totalHint = computed(() => {
    const delta = this.stats()?.totalDelta30d;
    if (delta === null || delta === undefined) return null;
    return `+${delta} sur 30j`;
  });

  readonly conversionPercent = computed(() => {
    const rate = this.stats()?.trialConversionRate30d;
    if (rate === null || rate === undefined) return null;
    return Math.round(rate * 100);
  });

  readonly payingHint = computed(() => {
    const mrr = this.stats()?.mrrEstimateTnd;
    if (mrr === null || mrr === undefined) return null;
    const formatter = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 0 });
    return `≈ ${formatter.format(mrr)} TND/mois`;
  });

  /** Chips de filtres actifs synchronisées avec l'état des signaux. */
  readonly activeChips = computed<ActiveChip[]>(() => {
    const chips: ActiveChip[] = [];
    if (this.searchApplied()) {
      chips.push({ key: 'search', label: 'Recherche', value: `"${this.searchApplied()}"` });
    }
    if (this.filterSegment()) {
      const opt = this.segmentOptions.find((o) => o.value === this.filterSegment());
      chips.push({ key: 'segment', label: TENANTS_FR['filters.segment'], value: opt?.label ?? '?' });
    }
    if (this.filterPlan() !== null) {
      const opt = this.planOptions.find((o) => o.value === this.filterPlan());
      chips.push({ key: 'plan', label: TENANTS_FR['filters.plan'], value: opt?.label ?? '?' });
    }
    if (this.filterSubStatus() !== null) {
      const opt = this.subStatusOptions.find((o) => o.value === this.filterSubStatus());
      chips.push({ key: 'subscriptionStatus', label: TENANTS_FR['filters.status'], value: opt?.label ?? '?' });
    }
    if (this.filterActive() !== null) {
      const opt = this.activeOptions.find((o) => o.value === this.filterActive());
      chips.push({ key: 'isActive', label: TENANTS_FR['filters.tenantState'], value: opt?.label ?? '?' });
    }
    if (this.filterTax() !== null) {
      const opt = this.taxOptions.find((o) => o.value === this.filterTax());
      chips.push({ key: 'taxRegime', label: TENANTS_FR['filters.taxRegime'], value: opt?.label ?? '?' });
    }
    if (this.filterKind() !== null) {
      const opt = this.kindOptions.find((o) => o.value === this.filterKind());
      chips.push({ key: 'kind', label: TENANTS_FR['filters.kind'], value: opt?.label ?? '?' });
    }
    return chips;
  });

  /** Menu déroulant "Vues" (préréglages + vues utilisateur). */
  readonly savedViewsMenu = computed<MenuItem[]>(() => {
    const builtIns = this.api.builtInViews;
    const userViews = this.savedViewsSig();

    const items: MenuItem[] = builtIns.map((v) => ({
      label: v.name,
      icon: 'pi pi-bookmark',
      command: () => this.applyView(v)
    }));

    if (userViews.length > 0) {
      items.push({ separator: true });
      for (const v of userViews) {
        items.push({
          label: v.name,
          icon: 'pi pi-user',
          command: () => this.applyView(v)
        });
        items.push({
          label: TENANTS_FR['filters.savedViews.delete'] + ' : ' + v.name,
          icon: 'pi pi-trash',
          styleClass: 'mu-danger',
          command: () => this.deleteSavedView(v.id)
        });
      }
    }

    items.push({ separator: true });
    items.push({
      label: TENANTS_FR['filters.savedViews.save'],
      icon: 'pi pi-plus',
      disabled: !this.hasActiveFilters(),
      command: () => this.onSaveCurrentView()
    });

    return items;
  });

  ngOnInit(): void {
    this.savedViewsSig.set(this.api.loadSavedViews());
    this.loadStats();

    // Live search avec debounce 300ms
    this.searchInput$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((value) => {
        this.searchApplied.set(value.trim());
        this.tableFirst.set(0);
        this.loadList();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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

  onLazyLoad(event: TableLazyLoadEvent): void {
    const first = event.first ?? 0;
    const rows = event.rows ?? 25;
    let sortField = this.sortField();
    let sortOrder = this.sortOrder();

    if (event.sortField && typeof event.sortField === 'string') {
      sortField = event.sortField;
    }
    if (event.sortOrder !== null && event.sortOrder !== undefined) {
      sortOrder = event.sortOrder;
    }

    const key = `${first}|${rows}|${sortField}|${sortOrder}`;
    if (key === this.lastLazyKey) {
      return;
    }
    this.lastLazyKey = key;

    this.tableFirst.set(first);
    this.pageSize.set(rows);
    this.sortField.set(sortField);
    this.sortOrder.set(sortOrder);
    this.loadList();
  }

  onSearchChange(value: string): void {
    this.searchDraft.set(value);
    this.searchInput$.next(value);
  }

  setFilter<K extends 'segment' | 'plan' | 'subscriptionStatus' | 'isActive' | 'taxRegime' | 'kind'>(
    key: K,
    value: unknown
  ): void {
    switch (key) {
      case 'segment':
        this.filterSegment.set(value as string | null);
        break;
      case 'plan':
        this.filterPlan.set(value as SubscriptionPlanValue | null);
        break;
      case 'subscriptionStatus':
        this.filterSubStatus.set(value as SubscriptionStatusValue | null);
        break;
      case 'isActive':
        this.filterActive.set(value as boolean | null);
        break;
      case 'taxRegime':
        this.filterTax.set(value as TaxRegimeValue | null);
        break;
      case 'kind':
        this.filterKind.set(value as TenantKindFilterValue | null);
        break;
    }
    this.tableFirst.set(0);
    this.loadList();
  }

  clearFilter(key: string): void {
    switch (key) {
      case 'search':
        this.searchDraft.set('');
        this.searchApplied.set('');
        break;
      case 'segment':
        this.filterSegment.set(null);
        break;
      case 'plan':
        this.filterPlan.set(null);
        break;
      case 'subscriptionStatus':
        this.filterSubStatus.set(null);
        break;
      case 'isActive':
        this.filterActive.set(null);
        break;
      case 'taxRegime':
        this.filterTax.set(null);
        break;
      case 'kind':
        this.filterKind.set(null);
        break;
    }
    this.tableFirst.set(0);
    this.loadList();
  }

  resetFilters(): void {
    this.searchDraft.set('');
    this.searchApplied.set('');
    this.filterSegment.set(null);
    this.filterPlan.set(null);
    this.filterSubStatus.set(null);
    this.filterActive.set(null);
    this.filterTax.set(null);
    this.filterKind.set(null);
    this.tableFirst.set(0);
    this.loadList();
  }

  filterToSegment(segment: string): void {
    this.filterSegment.set(segment);
    this.filterSubStatus.set(null);
    this.tableFirst.set(0);
    this.loadList();
  }

  filterToRisk(): void {
    // KPI "tenants en risque" → préfiltre PastDue (4) ; on pourrait alterner avec Suspended (5).
    const current = this.filterSubStatus();
    this.filterSubStatus.set(current === 4 ? 5 : 4);
    this.filterSegment.set(null);
    this.tableFirst.set(0);
    this.loadList();
  }

  applyView(view: SavedTenantView): void {
    const f = view.filters;
    this.searchDraft.set(f.search ?? '');
    this.searchApplied.set(f.search ?? '');
    this.filterSegment.set(f.segment ?? null);
    this.filterPlan.set(f.plan ?? null);
    this.filterSubStatus.set(f.subscriptionStatus ?? null);
    this.filterActive.set(f.isActive ?? null);
    this.filterTax.set(f.taxRegime ?? null);
    this.filterKind.set(f.kind ?? null);
    this.tableFirst.set(0);
    this.loadList();
  }

  onSaveCurrentView(): void {
    if (!this.hasActiveFilters()) {
      this.messages.add({
        severity: 'info',
        summary: 'Aucun filtre actif',
        detail: 'Appliquez au moins un filtre avant de sauvegarder une vue.'
      });
      return;
    }
    const name = window.prompt(TENANTS_FR['filters.savedViews.namePrompt']);
    if (!name) return;
    const filters = {
      search: this.searchApplied() || undefined,
      segment: this.filterSegment() ?? undefined,
      plan: this.filterPlan() ?? undefined,
      subscriptionStatus: this.filterSubStatus() ?? undefined,
      isActive: this.filterActive() ?? undefined,
      taxRegime: this.filterTax() ?? undefined,
      kind: this.filterKind() ?? undefined
    };
    const saved = this.api.saveView(name, filters);
    this.savedViewsSig.set([...this.savedViewsSig(), saved]);
    this.messages.add({
      severity: 'success',
      summary: 'Vue sauvegardée',
      detail: `« ${saved.name} » est disponible dans le menu Vues.`
    });
  }

  deleteSavedView(id: string): void {
    this.api.deleteSavedView(id);
    this.savedViewsSig.set(this.savedViewsSig().filter((v) => v.id !== id));
  }

  clearSelection(): void {
    this.selectedRows.set([]);
  }

  openQuickView(row: PlatformTenantListItemDto, event?: MouseEvent): void {
    // Cmd/Ctrl + click → nouvel onglet plein écran
    if (event && (event.metaKey || event.ctrlKey)) {
      const url = this.router.serializeUrl(this.router.createUrlTree(['/tenants', row.tenantId]));
      window.open(url, '_blank', 'noopener');
      return;
    }
    this.drawerTenantId.set(row.tenantId);
    this.drawerOpen.set(true);
  }

  private buildRowActions(row: PlatformTenantListItemDto): MenuItem[] {
    return [
      {
        label: TENANTS_FR['rowAction.viewDetails'],
        icon: 'pi pi-arrow-right',
        routerLink: ['/tenants', row.tenantId]
      },
      {
        label: TENANTS_FR['rowAction.quickView'],
        icon: 'pi pi-eye',
        command: () => this.openQuickView(row)
      },
      {
        label: TENANTS_FR['rowAction.editSubscription'],
        icon: 'pi pi-pencil',
        routerLink: ['/tenants', row.tenantId]
      },
      ...(this.permissions.has(PlatformPermission.AiManage)
        ? [
            {
              label: TENANTS_FR['rowAction.aiConfig'],
              icon: 'pi pi-microchip-ai',
              routerLink: ['/tenants', row.tenantId],
              queryParams: { tab: 'ai' }
            }
          ]
        : []),
      { separator: true },
      {
        label: row.isActive
          ? TENANTS_FR['rowAction.suspend']
          : TENANTS_FR['rowAction.reactivate'],
        icon: row.isActive ? 'pi pi-pause' : 'pi pi-play',
        disabled: true // Lot D2
      },
      {
        label: TENANTS_FR['rowAction.sendEmail'],
        icon: 'pi pi-envelope',
        disabled: true // Lot C2
      },
      {
        label: TENANTS_FR['rowAction.viewAudit'],
        icon: 'pi pi-history',
        disabled: true // Lot B3
      },
      { separator: true },
      {
        label: TENANTS_FR['rowAction.copyId'],
        icon: 'pi pi-copy',
        command: () => this.copyTenantId(row.tenantId)
      }
    ];
  }

  private copyTenantId(tenantId: string): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(tenantId)
        .then(() =>
          this.messages.add({
            severity: 'success',
            summary: 'Copié',
            detail: 'Identifiant copié dans le presse-papiers.'
          })
        )
        .catch(() =>
          this.messages.add({
            severity: 'warn',
            summary: 'Impossible',
            detail: 'Le presse-papiers n’est pas accessible.'
          })
        );
    }
  }

  /** Calcule le numéro de page (1-based) à partir de tableFirst + pageSize. */
  private currentPage(): number {
    const ps = this.pageSize();
    return ps > 0 ? Math.floor(this.tableFirst() / ps) + 1 : 1;
  }

  private mapSortField(): TenantSortKey | undefined {
    const f = this.sortField();
    if (!f) return undefined;
    const allowed: TenantSortKey[] = [
      'name',
      'createdAt',
      'lastActivity',
      'plan',
      'status',
      'endDate',
      'mrr'
    ];
    return (allowed as readonly string[]).includes(f) ? (f as TenantSortKey) : 'name';
  }

  private syncLazyKeyFromState(): void {
    this.lastLazyKey = `${this.tableFirst()}|${this.pageSize()}|${this.sortField()}|${this.sortOrder()}`;
  }

  private loadList(): void {
    this.syncLazyKeyFromState();
    this.loading.set(true);
    this.api
      .list({
        search: this.searchApplied() || undefined,
        segment: this.filterSegment() ?? undefined,
        plan: this.filterPlan() ?? undefined,
        subscriptionStatus: this.filterSubStatus() ?? undefined,
        isActive: this.filterActive() ?? undefined,
        taxRegime: this.filterTax() ?? undefined,
        kind: this.filterKind() ?? undefined,
        page: this.currentPage(),
        pageSize: this.pageSize(),
        sortBy: this.mapSortField(),
        sortDir: this.sortOrder() === -1 ? 'desc' : 'asc'
      })
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          if (res.success && res.data) {
            this.rows.set(res.data.items ?? []);
            this.totalCount.set(res.data.totalCount ?? 0);
          } else {
            this.messages.add({
              severity: 'error',
              summary: 'Erreur',
              detail: res.message ?? 'Chargement impossible'
            });
          }
        },
        error: () => {
          this.loading.set(false);
          this.messages.add({
            severity: 'error',
            summary: 'Erreur',
            detail: 'Impossible de contacter l’API'
          });
        }
      });
  }
}
