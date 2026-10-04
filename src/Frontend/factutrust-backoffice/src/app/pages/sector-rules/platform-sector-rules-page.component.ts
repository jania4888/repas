import { ChangeDetectionStrategy, Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { MessageService } from 'primeng/api';

import { PlatformSectorRulesService } from '@core/services/platform-sector-rules.service';
import { PlatformPermissionsService } from '@core/services/platform-permissions.service';
import { PlatformPermission, PlatformRole } from '@core/models/platform.models';
import type { SectorRuleSetAdminDto } from '@core/models/sector-rules.models';

import { FtPageHeaderComponent } from '@core/ui/page-header/ft-page-header.component';
import { FtSkeletonComponent } from '@core/ui/skeleton/ft-skeleton.component';
import { FtConfirmActionComponent } from '@core/ui/confirm-action/ft-confirm-action.component';

import { SECTOR_RULES_FR } from './sector-rules.i18n.fr';
import { SectorSegmentsTabComponent } from './sector-segments-tab.component';
import { SectorDomainsTabComponent } from './sector-domains-tab.component';
import { SectorSegmentDomainsTabComponent } from './sector-segment-domains-tab.component';
import { SectorModuleRulesTabComponent } from './sector-module-rules-tab.component';
import { SectorModuleDependenciesTabComponent } from './sector-module-dependencies-tab.component';
import { SectorDefaultSettingsTabComponent } from './sector-default-settings-tab.component';
import { SectorDataTemplatesTabComponent } from './sector-data-templates-tab.component';

/**
 * Phase 2 (WP-F7) — Page d'administration « Règles sectorielles ».
 *
 * Charge le dump complet (`getAll()`) une seule fois puis distribue les slices aux 7 onglets ;
 * chaque onglet émet `changed` après une mutation réussie, ce qui déclenche un `reload()` qui
 * relance ce même dump. Un seul appel réseau au chargement (et après chaque sauvegarde), ce qui
 * évite la tempête de 7 requêtes parallèles évoquée dans le plan tout en restant simple à
 * maintenir pour un volume de données de configuration limité.
 */
@Component({
  selector: 'app-platform-sector-rules-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonModule,
    TabsModule,
    FtPageHeaderComponent,
    FtSkeletonComponent,
    FtConfirmActionComponent,
    SectorSegmentsTabComponent,
    SectorDomainsTabComponent,
    SectorSegmentDomainsTabComponent,
    SectorModuleRulesTabComponent,
    SectorModuleDependenciesTabComponent,
    SectorDefaultSettingsTabComponent,
    SectorDataTemplatesTabComponent
  ],
  template: `
    <ft-page-header [title]="t('page.title')" [subtitle]="t('page.subtitle')">
      <ng-container ftActions>
        <p-button [label]="t('page.actions.refresh')" icon="pi pi-refresh" [outlined]="true" [disabled]="loading()" (onClick)="reload()" />
        @if (canSeeResync()) {
          <p-button
            [label]="t('page.actions.resync')"
            icon="pi pi-sync"
            severity="warn"
            [outlined]="true"
            [disabled]="loading()"
            (onClick)="openResync()"
          />
        }
        <p-button
          [label]="t('page.actions.newSegment')"
          icon="pi pi-plus"
          severity="primary"
          [disabled]="!canManage() || activeTab() !== 0"
          (onClick)="openNewSegment()"
        />
      </ng-container>
    </ft-page-header>

    @if (ruleSet(); as rs) {
      <div class="source-banner">
        <i class="pi pi-database" aria-hidden="true"></i>
        <span>
          <strong>Règles actives : </strong>
          {{ t('banner.version').replace('{version}', rs.version.toString()) }}
        </span>
      </div>

      <p-tabs class="ft-tab-view" [value]="activeTab()" (valueChange)="onTabChange($event)">
        <p-tablist>
          <p-tab [value]="0"><i class="pi pi-sitemap"></i><span>{{ t('tab.segments') }}</span></p-tab>
          <p-tab [value]="1"><i class="pi pi-compass"></i><span>{{ t('tab.domains') }}</span></p-tab>
          <p-tab [value]="2"><i class="pi pi-table"></i><span>{{ t('tab.associations') }}</span></p-tab>
          <p-tab [value]="3"><i class="pi pi-th-large"></i><span>{{ t('tab.moduleRules') }}</span></p-tab>
          <p-tab [value]="4"><i class="pi pi-link"></i><span>{{ t('tab.dependencies') }}</span></p-tab>
          <p-tab [value]="5"><i class="pi pi-cog"></i><span>{{ t('tab.settings') }}</span></p-tab>
          <p-tab [value]="6"><i class="pi pi-file-import"></i><span>{{ t('tab.templates') }}</span></p-tab>
        </p-tablist>
        <p-tabpanels>
          <p-tabpanel [value]="0">
            <app-sector-segments-tab #segmentsTab [segments]="rs.segments" [moduleRules]="rs.moduleRules" (changed)="reload()" />
          </p-tabpanel>
          <p-tabpanel [value]="1">
            <app-sector-domains-tab [domains]="rs.domains" (changed)="reload()" />
          </p-tabpanel>
          <p-tabpanel [value]="2">
            <app-sector-segment-domains-tab
              [segments]="rs.segments"
              [domains]="rs.domains"
              [segmentDomains]="rs.segmentDomains"
              (changed)="reload()"
            />
          </p-tabpanel>
          <p-tabpanel [value]="3">
            <app-sector-module-rules-tab
              [segments]="rs.segments"
              [domains]="rs.domains"
              [moduleRules]="rs.moduleRules"
              [dependencies]="rs.moduleDependencies"
              (changed)="reload()"
            />
          </p-tabpanel>
          <p-tabpanel [value]="4">
            <app-sector-module-dependencies-tab [dependencies]="rs.moduleDependencies" (changed)="reload()" />
          </p-tabpanel>
          <p-tabpanel [value]="5">
            <app-sector-default-settings-tab
              [defaultSettings]="rs.settings"
              [segments]="rs.segments"
              [domains]="rs.domains"
              (changed)="reload()"
            />
          </p-tabpanel>
          <p-tabpanel [value]="6">
            <app-sector-data-templates-tab [dataTemplates]="rs.templates" (changed)="reload()" />
          </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
    } @else if (loading()) {
      <div class="loading-block" aria-busy="true">
        <ft-skeleton shape="rect" width="100%" height="3rem" />
        <ft-skeleton shape="rect" width="100%" height="20rem" />
      </div>
    }

    <ft-confirm-action
      [(visible)]="resyncVisible"
      [title]="t('resync.title')"
      [description]="t('resync.desc')"
      variant="destructive"
      [confirmKeyword]="t('resync.confirmKeyword')"
      [confirmLabel]="t('resync.confirmLabel')"
      confirmIcon="pi pi-sync"
      [busy]="resyncBusy()"
      (confirmed)="confirmResync()"
    >
      <label class="force-field">
        <input type="checkbox" [(ngModel)]="resyncForce" />
        {{ t('resync.force') }}
      </label>
    </ft-confirm-action>
  `,
  styles: [
    `
      :host { display: block; }
      .loading-block { display: flex; flex-direction: column; gap: 1rem; margin-top: 0.5rem; }
      .source-banner {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.65rem 1rem;
        border: 1px solid var(--ft-border, #30363d);
        background: var(--ft-surface-2, #0d1117);
        border-radius: 8px;
        margin-bottom: 1rem;
        color: var(--ft-text-muted, #8b949e);
        font-size: 0.85rem;
      }
      .source-banner i { color: var(--ft-info-text, #79c0ff); }
      .force-field { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; margin-top: 0.5rem; }

      :host ::ng-deep .ft-tab-view .p-tablist-tab-list {
        background: transparent;
        border-bottom: 1px solid var(--ft-border, #30363d);
      }
      :host ::ng-deep .ft-tab-view .p-tab {
        background: transparent;
        color: var(--ft-text-muted, #8b949e);
        border-color: transparent;
      }
      :host ::ng-deep .ft-tab-view .p-tab.p-tab-active {
        color: var(--ft-accent, #58a6ff);
        border-color: var(--ft-accent, #58a6ff);
        background: transparent;
      }
      :host ::ng-deep .ft-tab-view .p-tabpanels {
        background: transparent;
        padding: 1.1rem 0 0;
      }
    `
  ]
})
export class PlatformSectorRulesPageComponent implements OnInit {
  private readonly api = inject(PlatformSectorRulesService);
  private readonly permissions = inject(PlatformPermissionsService);
  private readonly toast = inject(MessageService);

  @ViewChild('segmentsTab') private segmentsTab?: SectorSegmentsTabComponent;

  protected t(key: keyof typeof SECTOR_RULES_FR): string {
    return SECTOR_RULES_FR[key];
  }

  readonly canManage = computed(() => this.permissions.has(PlatformPermission.SectorRulesManage));
  /** WP-B9 : le seed-from-catalog est réservé au rôle SuperAdmin (policy `SuperAdminOnly`, qui
   *  mappe le rôle exact `PlatformAdmin` côté backend). */
  readonly canSeeResync = computed(() => this.permissions.hasRole(PlatformRole.PlatformAdmin));

  readonly ruleSet = signal<SectorRuleSetAdminDto | null>(null);
  readonly loading = signal(true);
  readonly activeTab = signal(0);

  resyncVisible = false;
  resyncForce = false;
  readonly resyncBusy = signal(false);

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.api.getAll().subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.ruleSet.set(res.data);
        } else {
          this.toastError(res.message);
        }
      },
      error: err => {
        this.loading.set(false);
        this.toastError((err as { error?: { message?: string } })?.error?.message);
      }
    });
  }

  onTabChange(value: string | number | undefined): void {
    const idx = typeof value === 'number' ? value : Number(value);
    if (!Number.isNaN(idx)) this.activeTab.set(idx);
  }

  openNewSegment(): void {
    // Le bouton d'en-tête délègue à l'onglet Segments (seul propriétaire du dialogue de création).
    this.activeTab.set(0);
    this.segmentsTab?.openCreate();
  }

  openResync(): void {
    this.resyncForce = false;
    this.resyncVisible = true;
  }

  confirmResync(): void {
    this.resyncBusy.set(true);
    this.api.seedFromCatalog(this.resyncForce).subscribe({
      next: res => {
        this.resyncBusy.set(false);
        this.resyncVisible = false;
        if (res.success) {
          this.toast.add({ severity: 'success', summary: 'Resynchronisation terminée' });
          this.reload();
        } else {
          this.toastError(res.message);
        }
      },
      error: err => {
        this.resyncBusy.set(false);
        this.resyncVisible = false;
        this.toastError((err as { error?: { message?: string } })?.error?.message);
      }
    });
  }

  private toastError(message?: string | null): void {
    this.toast.add({
      severity: 'error',
      summary: SECTOR_RULES_FR['toast.error.title'],
      detail: message ?? SECTOR_RULES_FR['toast.error.generic']
    });
  }
}
