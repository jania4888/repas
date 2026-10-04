import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule, TableLazyLoadEvent } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TabsModule } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';

import { PlatformSessionsService } from '@core/services/platform-sessions.service';
import { PlatformSecurityService } from '@core/services/platform-security.service';
import { PlatformPermissionsService } from '@core/services/platform-permissions.service';
import {
  PlatformPermission,
  type FailedLoginAttemptDto,
  type FailedLoginAttemptsPageDto,
  type UserSessionDto,
  type UserSessionsPageDto
} from '@core/models/platform.models';

import { FtPageHeaderComponent } from '@core/ui/page-header/ft-page-header.component';
import { FtKpiCardComponent } from '@core/ui/kpi-card/ft-kpi-card.component';
import { FtFilterToolbarComponent } from '@core/ui/filter-toolbar/ft-filter-toolbar.component';
import { FtBadgeComponent } from '@core/ui/badge/ft-badge.component';
import { FtAvatarComponent } from '@core/ui/avatar/ft-avatar.component';
import { FtEmptyStateComponent } from '@core/ui/empty-state/ft-empty-state.component';
import { FtSkeletonComponent } from '@core/ui/skeleton/ft-skeleton.component';
import { FtConfirmActionComponent } from '@core/ui/confirm-action/ft-confirm-action.component';
import { FtCellRelativeDateComponent } from '@core/ui/table-cells/ft-cell-relative-date.component';
import type { FtTone } from '@core/ui/badge/ft-badge.component';

import { SECURITY_FR } from './security.i18n.fr';

@Component({
  selector: 'app-platform-security-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FormsModule,
    TableModule,
    InputTextModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    TabsModule,
    TooltipModule,
    FtPageHeaderComponent,
    FtKpiCardComponent,
    FtFilterToolbarComponent,
    FtBadgeComponent,
    FtAvatarComponent,
    FtEmptyStateComponent,
    FtSkeletonComponent,
    FtConfirmActionComponent,
    FtCellRelativeDateComponent
  ],
  template: `
    <ft-page-header [title]="t('list.title')" [subtitle]="t('list.subtitle')">
      <ng-container ftActions>
        <p-button
          [label]="t('list.actions.refresh')"
          icon="pi pi-refresh"
          [outlined]="true"
          [disabled]="anyLoading()"
          (onClick)="reload()" />
      </ng-container>
    </ft-page-header>

    <p-tabs
      [value]="activeTab()"
      (valueChange)="onTabChange($event)"
      class="ft-security-tabs"
      [lazy]="true">

      <!-- ===== Tab Sessions ===== -->
      <p-tablist>
        <p-tab [value]="0">{{ t('tab.sessions') }}</p-tab>
        <p-tab [value]="1">{{ t('tab.failedLogins') }}</p-tab>
      </p-tablist>
      <p-tabpanels>
      <p-tabpanel [value]="0">
        <section class="kpi-row kpi-row--compact" role="region" aria-label="Sessions">
          <ft-kpi-card
            [label]="t('sessions.kpi.total')"
            [value]="sessionsPage()?.totalCount ?? null"
            [hint]="t('sessions.kpi.total.hint')"
            tone="info"
            icon="pi pi-key"
            [loading]="sessionsLoading()" />
          <ft-kpi-card
            [label]="t('sessions.kpi.active')"
            [value]="sessionsPage()?.activeCount ?? null"
            [hint]="t('sessions.kpi.active.hint')"
            tone="success"
            icon="pi pi-check-circle"
            [loading]="sessionsLoading()" />
          <ft-kpi-card
            [label]="t('sessions.kpi.revoked')"
            [value]="sessionsPage()?.revokedCount ?? null"
            [hint]="t('sessions.kpi.revoked.hint')"
            tone="neutral"
            icon="pi pi-ban"
            [loading]="sessionsLoading()" />
        </section>

        <ft-filter-toolbar>
          <p-select
            [options]="activeOnlyOptions"
            [ngModel]="filterActiveOnly()"
            (ngModelChange)="onFilterActiveChange($event)"
            optionLabel="label"
            optionValue="value"
            [placeholder]="t('sessions.filter.activeOnly')"
            styleClass="ft-dd" />
        </ft-filter-toolbar>

        <p-table
          [value]="sessionsPage()?.items ?? []"
          [loading]="sessionsLoading()"
          [lazy]="true"
          [first]="sessionsFirst()"
          (onLazyLoad)="onSessionsLazyLoad($event)"
          [paginator]="(sessionsPage()?.totalCount ?? 0) > 0"
          [rows]="sessionsPageSize()"
          [totalRecords]="sessionsPage()?.totalCount ?? 0"
          [rowsPerPageOptions]="[25, 50, 100]"
          [showCurrentPageReport]="true"
          [currentPageReportTemplate]="'{first}–{last} sur {totalRecords}'"
          responsiveLayout="scroll"
          styleClass="p-datatable-sm ft-table"
          [tableStyle]="{ 'min-width': '64rem' }">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col">{{ t('sessions.col.user') }}</th>
              <th scope="col">{{ t('sessions.col.ip') }}</th>
              <th scope="col">{{ t('sessions.col.userAgent') }}</th>
              <th scope="col">{{ t('sessions.col.issuedAt') }}</th>
              <th scope="col">{{ t('sessions.col.expiresAt') }}</th>
              <th scope="col">{{ t('sessions.col.state') }}</th>
              <th scope="col" class="col-actions">{{ t('sessions.col.actions') }}</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-row>
            <tr>
              <td>
                <div class="cell-user">
                  <ft-avatar [name]="row.userEmail" [seed]="row.userId" size="sm" />
                  <code class="cell-mono">{{ row.userEmail }}</code>
                </div>
              </td>
              <td><code class="cell-mono">{{ row.ipAddress }}</code></td>
              <td class="ua-cell" [pTooltip]="row.userAgent ?? ''">{{ row.userAgent ?? '—' }}</td>
              <td><ft-cell-relative-date [date]="row.issuedAt" /></td>
              <td>{{ row.expiresAt | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td>
                @if (row.isActive) {
                  <ft-badge tone="success" [withDot]="true" size="sm">{{ t('sessions.state.active') }}</ft-badge>
                } @else if (row.revokedAt) {
                  <ft-badge tone="danger" [withDot]="true" size="sm">{{ t('sessions.state.revoked') }}</ft-badge>
                } @else {
                  <ft-badge tone="neutral" [withDot]="true" size="sm">{{ t('sessions.state.expired') }}</ft-badge>
                }
              </td>
              <td class="col-actions">
                @if (row.isActive && canManage()) {
                  <p-button
                    icon="pi pi-ban"
                    [text]="true"
                    severity="danger"
                    size="small"
                    [pTooltip]="t('sessions.action.revoke')"
                    tooltipPosition="left"
                    (onClick)="askRevoke(row)" />
                }
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7">
                <ft-empty-state
                  variant="table-empty"
                  [title]="t('sessions.empty.title')"
                  [description]="t('sessions.empty.desc')" />
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="loadingbody">
            @for (i of skeletonRows; track $index) {
              <tr>
                <td><ft-skeleton shape="line" width="60%" /></td>
                <td><ft-skeleton shape="line" width="6rem" /></td>
                <td><ft-skeleton shape="line" width="60%" /></td>
                <td><ft-skeleton shape="line" width="5rem" /></td>
                <td><ft-skeleton shape="line" width="6rem" /></td>
                <td><ft-skeleton shape="line" width="5rem" /></td>
                <td class="col-actions"><ft-skeleton shape="circle" width="1.5rem" height="1.5rem" /></td>
              </tr>
            }
          </ng-template>
        </p-table>
      </p-tabpanel>

      <!-- ===== Tab Failed logins ===== -->
      <p-tabpanel [value]="1">
        <section class="kpi-row kpi-row--compact" role="region" aria-label="Tentatives échouées">
          <ft-kpi-card
            [label]="t('failed.kpi.total')"
            [value]="failedPage()?.totalCount ?? null"
            [hint]="t('failed.kpi.total.hint')"
            tone="warning"
            icon="pi pi-shield"
            [loading]="failedLoading()" />
          <ft-kpi-card
            [label]="t('failed.kpi.last24h')"
            [value]="failedPage()?.last24h ?? null"
            [hint]="t('failed.kpi.last24h.hint')"
            tone="info"
            icon="pi pi-clock"
            [loading]="failedLoading()" />
          <ft-kpi-card
            [label]="t('failed.kpi.lastHour')"
            [value]="failedPage()?.lastHour ?? null"
            [hint]="t('failed.kpi.lastHour.hint')"
            [tone]="(failedPage()?.lastHour ?? 0) > 10 ? 'danger' : 'neutral'"
            icon="pi pi-bolt"
            [loading]="failedLoading()" />
        </section>

        @if ((failedPage()?.topSuspiciousIps?.length ?? 0) > 0) {
          <article class="alert" role="alert">
            <i class="pi pi-exclamation-triangle"></i>
            <div>
              <strong>{{ t('failed.alert.bruteForce.title') }}</strong>
              <p>{{ t('failed.alert.bruteForce.desc') }}</p>
              <ul class="ip-list">
                @for (ip of failedPage()?.topSuspiciousIps ?? []; track ip.ipAddress) {
                  <li>
                    <code>{{ ip.ipAddress }}</code>
                    <ft-badge tone="danger" size="sm">{{ ip.count }} tentatives</ft-badge>
                    <span class="muted">dernière : {{ ip.lastSeen | date: 'HH:mm:ss' }}</span>
                  </li>
                }
              </ul>
            </div>
          </article>
        }

        <ft-filter-toolbar>
          <input
            type="text"
            pInputText
            [(ngModel)]="filterEmail"
            (ngModelChange)="onFailedFilterDebounced()"
            [placeholder]="t('failed.filters.email')" />
          <input
            type="text"
            pInputText
            [(ngModel)]="filterIp"
            (ngModelChange)="onFailedFilterDebounced()"
            [placeholder]="t('failed.filters.ip')" />
          <p-datepicker
            [(ngModel)]="filterFrom"
            (ngModelChange)="onFailedFilterChange()"
            [placeholder]="t('failed.filters.from')"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            [showClear]="true"
            styleClass="ft-cal" />
          <p-datepicker
            [(ngModel)]="filterTo"
            (ngModelChange)="onFailedFilterChange()"
            [placeholder]="t('failed.filters.to')"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            [showClear]="true"
            styleClass="ft-cal" />

          <ng-container ftActions>
            <p-button
              [label]="t('failed.filters.reset')"
              icon="pi pi-filter-slash"
              [text]="true"
              [disabled]="!hasFailedFilters()"
              (onClick)="resetFailedFilters()" />
          </ng-container>
        </ft-filter-toolbar>

        <p-table
          [value]="failedPage()?.items ?? []"
          [loading]="failedLoading()"
          [lazy]="true"
          [first]="failedFirst()"
          (onLazyLoad)="onFailedLazyLoad($event)"
          [paginator]="(failedPage()?.totalCount ?? 0) > 0"
          [rows]="failedPageSize()"
          [totalRecords]="failedPage()?.totalCount ?? 0"
          [rowsPerPageOptions]="[25, 50, 100, 200]"
          [showCurrentPageReport]="true"
          [currentPageReportTemplate]="'{first}–{last} sur {totalRecords}'"
          responsiveLayout="scroll"
          styleClass="p-datatable-sm ft-table"
          [tableStyle]="{ 'min-width': '54rem' }">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col">{{ t('failed.col.attemptAt') }}</th>
              <th scope="col">{{ t('failed.col.email') }}</th>
              <th scope="col">{{ t('failed.col.ip') }}</th>
              <th scope="col">{{ t('failed.col.reason') }}</th>
              <th scope="col">{{ t('failed.col.userAgent') }}</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.attemptAt | date: 'dd/MM/yyyy HH:mm:ss' }}</td>
              <td><code class="cell-mono">{{ row.email }}</code></td>
              <td><code class="cell-mono">{{ row.ipAddress }}</code></td>
              <td><ft-badge [tone]="reasonTone(row.reason)" size="sm">{{ row.reasonDisplay }}</ft-badge></td>
              <td class="ua-cell" [pTooltip]="row.userAgent ?? ''">{{ row.userAgent ?? '—' }}</td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="5">
                <ft-empty-state
                  variant="all-clear"
                  [title]="t('failed.empty.title')"
                  [description]="t('failed.empty.desc')" />
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="loadingbody">
            @for (i of skeletonRows; track $index) {
              <tr>
                <td><ft-skeleton shape="line" width="9rem" /></td>
                <td><ft-skeleton shape="line" width="60%" /></td>
                <td><ft-skeleton shape="line" width="6rem" /></td>
                <td><ft-skeleton shape="line" width="5rem" /></td>
                <td><ft-skeleton shape="line" width="60%" /></td>
              </tr>
            }
          </ng-template>
        </p-table>
      </p-tabpanel>
      </p-tabpanels>
    </p-tabs>

    <!-- Modal de confirmation révocation -->
    <ft-confirm-action
      [(visible)]="revokeDialogOpen"
      variant="destructive"
      [title]="t('sessions.confirm.revokeTitle')"
      [description]="t('sessions.confirm.revokeDesc')"
      [confirmKeyword]="t('sessions.confirm.confirmKeyword')"
      [confirmLabel]="t('sessions.confirm.confirmLabel')"
      confirmIcon="pi pi-ban"
      [busy]="revoking()"
      (confirmed)="onRevokeConfirmed()" />
  `,
  styles: [
    `
      :host {
        display: block;
      }

      :host ::ng-deep .ft-security-tabs .p-tablist-tab-list {
        background: transparent;
        border-bottom: 1px solid var(--ft-border);
      }

      :host ::ng-deep .ft-security-tabs .p-tab {
        background: transparent;
        color: var(--ft-text-muted);
        border-color: transparent;
        font-weight: 500;
      }

      :host ::ng-deep .ft-security-tabs .p-tab.p-tab-active {
        color: var(--ft-accent);
        border-color: var(--ft-accent);
      }

      :host ::ng-deep .ft-security-tabs .p-tabpanels {
        background: transparent;
        padding: var(--gap-md) 0 0;
      }

      .alert {
        display: flex;
        gap: var(--gap-md);
        padding: var(--gap-md);
        border-radius: var(--ft-radius);
        margin-bottom: var(--gap-md);
        background: var(--ft-danger-surface);
        border: 1px solid var(--ft-danger-border);
      }

      .alert .pi {
        font-size: 1.4rem;
        color: var(--ft-danger-text);
        flex-shrink: 0;
      }

      .alert strong {
        color: var(--ft-text);
        display: block;
        margin-bottom: 0.2rem;
      }

      .alert p {
        margin: 0 0 var(--gap-xs);
        color: var(--ft-text-muted);
        font-size: 0.85rem;
      }

      .ip-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }

      .ip-list li {
        display: flex;
        gap: 0.6rem;
        align-items: center;
        flex-wrap: wrap;
        font-size: 0.85rem;
      }

      .ip-list code {
        font-family: ui-monospace, SFMono-Regular, monospace;
        background: var(--ft-surface-2);
        padding: 0.1rem 0.4rem;
        border-radius: var(--ft-radius-sm);
        color: var(--ft-accent);
      }

      .muted {
        color: var(--ft-text-muted);
        font-size: 0.78rem;
      }

      .cell-user {
        display: inline-flex;
        gap: 0.5rem;
        align-items: center;
      }

      .cell-mono {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 0.78rem;
        color: var(--ft-text-muted);
      }

      .ua-cell {
        max-width: 12rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--ft-text-muted);
        font-size: 0.78rem;
      }

      .col-actions {
        text-align: end;
        white-space: nowrap;
        width: 4rem;
      }
    `
  ]
})
export class PlatformSecurityPageComponent implements OnInit {
  private readonly sessionsApi = inject(PlatformSessionsService);
  private readonly securityApi = inject(PlatformSecurityService);
  private readonly permissions = inject(PlatformPermissionsService);
  private readonly toast = inject(MessageService);

  protected readonly skeletonRows = Array.from({ length: 6 });

  protected t(key: keyof typeof SECURITY_FR): string {
    return SECURITY_FR[key];
  }

  // ----- Tabs --------------------------------------------------------------
  readonly activeTab = signal(0);

  // ----- Sessions state ----------------------------------------------------
  readonly sessionsPage = signal<UserSessionsPageDto | null>(null);
  readonly sessionsLoading = signal(false);
  readonly sessionsFirst = signal(0);
  readonly sessionsPageSize = signal(25);
  readonly filterActiveOnly = signal<boolean | null>(true);

  protected readonly activeOnlyOptions = [
    { label: SECURITY_FR['sessions.filter.allStates'], value: null },
    { label: SECURITY_FR['sessions.filter.active'], value: true },
    { label: SECURITY_FR['sessions.filter.revoked'], value: false }
  ];

  // ----- Failed logins state -----------------------------------------------
  readonly failedPage = signal<FailedLoginAttemptsPageDto | null>(null);
  readonly failedLoading = signal(false);
  readonly failedFirst = signal(0);
  readonly failedPageSize = signal(25);

  protected filterEmail = '';
  protected filterIp = '';
  protected filterFrom: Date | null = null;
  protected filterTo: Date | null = null;
  private failedDebounce: ReturnType<typeof setTimeout> | null = null;

  // ----- Revoke dialog -----------------------------------------------------
  readonly revokeTarget = signal<UserSessionDto | null>(null);
  readonly revoking = signal(false);
  revokeDialogOpen = false;

  // ----- Computed ----------------------------------------------------------
  readonly canManage = computed(() => this.permissions.has(PlatformPermission.AdminsManage));
  readonly anyLoading = computed(() => this.sessionsLoading() || this.failedLoading());
  readonly hasFailedFilters = computed(
    () =>
      this.filterEmail.trim() !== '' ||
      this.filterIp.trim() !== '' ||
      this.filterFrom !== null ||
      this.filterTo !== null
  );

  ngOnInit(): void {
    this.loadSessions();
    this.loadFailed();
  }

  reload(): void {
    if (this.activeTab() === 0) this.loadSessions();
    else this.loadFailed();
  }

  onTabChange(index: string | number | undefined): void {
    const tabIndex = typeof index === 'number' ? index : Number(index);
    this.activeTab.set(tabIndex);
    if (tabIndex === 0 && !this.sessionsPage()) this.loadSessions();
    if (tabIndex === 1 && !this.failedPage()) this.loadFailed();
  }

  // ----- Sessions ----------------------------------------------------------
  onSessionsLazyLoad(event: TableLazyLoadEvent): void {
    this.sessionsFirst.set(event.first ?? 0);
    this.sessionsPageSize.set(event.rows ?? 25);
    this.loadSessions();
  }

  onFilterActiveChange(value: boolean | null): void {
    this.filterActiveOnly.set(value);
    this.sessionsFirst.set(0);
    this.loadSessions();
  }

  private loadSessions(): void {
    this.sessionsLoading.set(true);
    const page = Math.floor(this.sessionsFirst() / this.sessionsPageSize()) + 1;
    this.sessionsApi
      .list({
        activeOnly: this.filterActiveOnly() ?? undefined,
        page,
        pageSize: this.sessionsPageSize()
      })
      .subscribe({
        next: (res) => {
          this.sessionsLoading.set(false);
          if (res.success && res.data) this.sessionsPage.set(res.data);
        },
        error: () => {
          this.sessionsLoading.set(false);
          this.toastError();
        }
      });
  }

  askRevoke(row: UserSessionDto): void {
    this.revokeTarget.set(row);
    this.revokeDialogOpen = true;
  }

  onRevokeConfirmed(): void {
    const target = this.revokeTarget();
    if (!target) return;
    this.revoking.set(true);
    this.sessionsApi.revoke(target.id, 'AdminBackofficeRevoke').subscribe({
      next: (res) => {
        this.revoking.set(false);
        this.revokeDialogOpen = false;
        if (res.success) {
          this.toast.add({
            severity: 'success',
            summary: SECURITY_FR['toast.revoke.success'],
            detail: target.userEmail
          });
          this.loadSessions();
        } else {
          this.toastError(res.message);
        }
      },
      error: () => {
        this.revoking.set(false);
        this.revokeDialogOpen = false;
        this.toastError();
      }
    });
  }

  // ----- Failed logins -----------------------------------------------------
  onFailedLazyLoad(event: TableLazyLoadEvent): void {
    this.failedFirst.set(event.first ?? 0);
    this.failedPageSize.set(event.rows ?? 25);
    this.loadFailed();
  }

  onFailedFilterChange(): void {
    this.failedFirst.set(0);
    this.loadFailed();
  }

  onFailedFilterDebounced(): void {
    if (this.failedDebounce) clearTimeout(this.failedDebounce);
    this.failedDebounce = setTimeout(() => this.onFailedFilterChange(), 350);
  }

  resetFailedFilters(): void {
    this.filterEmail = '';
    this.filterIp = '';
    this.filterFrom = null;
    this.filterTo = null;
    this.onFailedFilterChange();
  }

  private loadFailed(): void {
    this.failedLoading.set(true);
    const page = Math.floor(this.failedFirst() / this.failedPageSize()) + 1;
    this.securityApi
      .failedLogins({
        email: this.filterEmail || undefined,
        ipAddress: this.filterIp || undefined,
        from: this.filterFrom ? this.filterFrom.toISOString() : undefined,
        to: this.filterTo ? this.filterTo.toISOString() : undefined,
        page,
        pageSize: this.failedPageSize()
      })
      .subscribe({
        next: (res) => {
          this.failedLoading.set(false);
          if (res.success && res.data) this.failedPage.set(res.data);
        },
        error: () => {
          this.failedLoading.set(false);
          this.toastError();
        }
      });
  }

  // ----- Helpers ----------------------------------------------------------
  reasonTone(reason: number): FtTone {
    // 0=UserNotFound, 1=WrongPassword, 2=AccountLocked, 3=AccountInactive,
    // 4=NotAPlatformAdmin, 5=BoundToTenant, 6=TwoFactorInvalid
    switch (reason) {
      case 1: // WrongPassword
        return 'warning';
      case 2: // Locked
        return 'danger';
      case 6: // 2FA invalid
        return 'danger';
      case 0: // UserNotFound
      case 4: // NotAPlatformAdmin
        return 'info';
      default:
        return 'neutral';
    }
  }

  private toastError(detail?: string | null): void {
    this.toast.add({
      severity: 'error',
      summary: SECURITY_FR['toast.error.title'],
      detail: detail ?? SECURITY_FR['toast.error.detail']
    });
  }
}
