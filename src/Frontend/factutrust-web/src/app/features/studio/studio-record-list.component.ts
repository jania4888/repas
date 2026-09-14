import { Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { map } from 'rxjs';
import { TableLazyLoadEvent } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { MenuModule } from 'primeng/menu';
import { MessageService, MenuItem } from 'primeng/api';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { DynamicTableComponent, DynamicRow } from '@shared/studio-runtime/dynamic-table.component';
import { exportRowsCsv, exportRowsXlsx } from '@shared/studio-runtime/studio-export.util';
import { StudioService } from './studio.service';
import { CustomEntity, CustomEntitySchema, CustomField, CustomRecord } from './studio.models';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { SkeletonTableComponent } from '@shared/components/skeleton/skeleton-table.component';
import { StudioAiCapabilitiesService } from './ai/studio-ai-capabilities.service';
import { StudioViewSwitcherComponent } from './views/studio-view-switcher.component';
import { StudioRecordViewRunnerComponent } from './views/studio-record-view-runner.component';
import { STUDIO_RUNTIME_LABELS } from './shared/studio-runtime-labels';

@Component({
  selector: 'app-studio-record-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, ButtonModule, InputTextModule, ToastModule, MenuModule,
    DynamicTableComponent, StudioPageShellComponent, ButtonComponent, SkeletonTableComponent,
    StudioViewSwitcherComponent, StudioRecordViewRunnerComponent
  ],
  template: `
    <p-toast></p-toast>
    @if (entity(); as e) {
      <app-studio-page-shell
        [title]="e.displayNamePlural"
        [subtitle]="subtitleTotal() + ' enregistrement(s)'"
        [breadcrumbs]="breadcrumbs()">
        <div studioActions class="studio-head-actions">
          @if (showViewButton()) {
            <app-button variant="outline" icon="pi-sliders-h" (click)="onNewOrEditView()">
              {{ activeView() ? labels.views.editView : labels.views.newView }}
            </app-button>
          }
          @if (canDesign()) {
            <app-button variant="outline" icon="pi-wrench" routerLink="/studio/{{ e.id }}">Concevoir</app-button>
          }
          @if (canWrite()) {
            <app-button variant="primary" icon="pi-plus" [routerLink]="['/studio/d', entityKey, 'new']">Ajouter</app-button>
          }
        </div>

        <div class="ft-filters">
          <div class="ft-filters__header">
            <h3 class="ft-filters__title"><i class="pi pi-search"></i> Recherche</h3>
          </div>
          <div class="studio-toolbar">
            <input pInputText [(ngModel)]="search" (keyup.enter)="reload()" placeholder="Rechercher…" class="studio-search-input" />
            <button pButton type="button" icon="fa-solid fa-magnifying-glass" label="Rechercher" class="p-button-sm" (click)="reload()"></button>
            <span class="studio-toolbar__spacer"></span>
            @if (!activeView()) {
              <!-- Export masqué quand une vue enregistrée est active : il porterait sur les enregistrements
                   bruts (hors filtres de la vue). -->
              <button pButton type="button" icon="fa-solid fa-download" label="Exporter" class="p-button-sm p-button-outlined"
                [disabled]="total() === 0" (click)="exportMenu.toggle($event)"></button>
              <p-menu #exportMenu [popup]="true" [model]="exportItems" appendTo="body" styleClass="studio-theme"></p-menu>
            }
          </div>
        </div>

        @if (showSwitcher()) {
          <app-studio-view-switcher [views]="views()" [activeId]="activeView()?.id ?? null" (activeIdChange)="onSwitchView($event)" />
        }

        @if (schemaLoading()) {
          <app-skeleton-table [columns]="skeletonCols" [rows]="5" />
        } @else {
          @if (activeView(); as v) {
            <div id="studio-view-panel" role="tabpanel" aria-label="Vue active">
              <app-studio-record-view-runner
                [entityKey]="entityKey"
                [view]="v"
                [allFields]="allFields()"
                [search]="search"
                [showActions]="canWrite()"
                (editRow)="edit($event)"
                (deleteRow)="remove($event)"
                (total)="onRunnerTotal($event)" />
            </div>
          } @else {
            <app-dynamic-table
              [entityKey]="entityKey"
              [allFields]="allFields()"
              [columns]="allFields()"
              [value]="records()"
              [total]="total()"
              [pageSize]="pageSize"
              [loading]="loading()"
              [showActions]="canWrite()"
              (lazyLoad)="onLazy($event)"
              (editRow)="edit($event)"
              (deleteRow)="remove($event)" />
          }
        }
      </app-studio-page-shell>
    }
  `,
  styles: [`
    .studio-head-actions { display: flex; gap: var(--spacing-3); }
  `],
  styleUrl: './shared/studio-layout.scss',
})
export class StudioRecordListComponent implements OnInit {
  private readonly studio = inject(StudioService);
  private readonly toast = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly capabilities = inject(StudioAiCapabilitiesService);

  protected readonly labels = STUDIO_RUNTIME_LABELS;

  readonly entity = signal<CustomEntity | null>(null);
  readonly schema = signal<CustomEntitySchema | null>(null);
  readonly allFields = signal<CustomField[]>([]);
  readonly records = signal<CustomRecord[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly schemaLoading = signal(true);
  readonly breadcrumbs = signal<BreadcrumbItem[]>([]);

  readonly skeletonCols = [{ width: '20%' }, { width: '30%' }, { width: '20%' }, { width: '15%' }];

  exportItems: MenuItem[] = [
    { label: 'CSV — page courante', icon: 'fa-solid fa-file-csv', command: () => this.exportCsv(false) },
    { label: 'Excel — page courante', icon: 'fa-solid fa-file-excel', command: () => this.exportXlsx(false) },
    { label: 'CSV — toutes les lignes', icon: 'fa-solid fa-file-csv', command: () => this.exportCsv(true) },
    { label: 'Excel — toutes les lignes', icon: 'fa-solid fa-file-excel', command: () => this.exportXlsx(true) },
  ];

  entityKey = '';
  search = '';
  page = 1;
  pageSize = 25;
  private fetched = false;

  // `?view=` lu de façon réactive (queryParamMap) : la navigation via le switcher ne recrée pas le
  // composant (V14/E14), un `route.snapshot` figé au premier chargement ne verrait jamais le changement.
  private readonly activeViewIdParam = toSignal(
    this.route.queryParamMap.pipe(map(params => params.get('view'))),
    { initialValue: null }
  );
  readonly activeViewId = computed(() => this.activeViewIdParam());

  readonly views = computed(() => this.schema()?.views ?? []);
  // Repli strict : tant que les capacités ne sont pas confirmées (`ready`), la page ignore `?view=`
  // et se comporte exactement comme avant 2.5a (zéro régression). La course « schéma arrivé avant
  // les capacités » ne doit jamais déclencher un `/run` ni monter le runner.
  readonly recordViewsEnabled = computed(() =>
    this.capabilities.state() === 'ready' && this.capabilities.capabilities().recordViewsEnabled === true);
  // Vue effective : `?view=<id>` si présente, sinon la vue `isDefault`, sinon la « Liste » brute.
  readonly activeView = computed(() => {
    if (!this.recordViewsEnabled()) return null;
    const views = this.views();
    const fromParam = views.find(v => v.id === this.activeViewId());
    return fromParam ?? views.find(v => v.isDefault) ?? null;
  });
  readonly showSwitcher = computed(() => this.recordViewsEnabled() && this.views().length > 0);
  readonly showViewButton = computed(() => this.recordViewsEnabled() && this.canDesignForms());

  canWrite = () => this.auth.hasPermission(PERMISSIONS.customData.recordsWrite);
  canDesign = () => this.auth.hasPermission(PERMISSIONS.studio.designEntities);
  canDesignForms = () => this.auth.hasPermission(PERMISSIONS.studio.designForms);

  ngOnInit(): void {
    this.entityKey = this.route.snapshot.paramMap.get('key') ?? '';
    this.capabilities.ensureLoaded();
    this.studio.getSchema(this.entityKey).subscribe({
      next: res => {
        this.schemaLoading.set(false);
        if (res.success) {
          this.entity.set(res.data.entity);
          this.schema.set(res.data);
          this.allFields.set(res.data.fields.filter(f => f.isActive));
          this.breadcrumbs.set(STUDIO_BREADCRUMBS.records(res.data.entity.displayNamePlural, this.entityKey));
          // Load the first page explicitly so data never depends on the child table's lazy event firing.
          this.fetch();
        }
      },
      error: () => {
        this.schemaLoading.set(false);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Schéma introuvable.' });
      }
    });
  }

  onSwitchView(viewId: string | null): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: viewId },
      queryParamsHandling: 'merge'
    });
  }

  onNewOrEditView(): void {
    const v = this.activeView();
    const segments = v ? ['/studio/d', this.entityKey, 'views', v.id] : ['/studio/d', this.entityKey, 'views', 'new'];
    this.router.navigate(segments);
  }

  private readonly runner = viewChild(StudioRecordViewRunnerComponent);
  /** Total rapporté par le runner (vue active) ; pris en compte par le sous-titre. */
  private readonly runnerTotal = signal<number | null>(null);
  readonly subtitleTotal = computed(() => this.activeView() ? (this.runnerTotal() ?? 0) : this.total());

  onRunnerTotal(total: number): void {
    this.runnerTotal.set(total);
  }

  onLazy(event: TableLazyLoadEvent): void {
    const first = event.first ?? 0;
    const rows = event.rows ?? this.pageSize;
    const nextPage = Math.floor(first / rows) + 1;
    // Ignore the table's mount echo once the initial load has run (avoids a redundant re-query).
    if (this.fetched && nextPage === this.page && rows === this.pageSize) return;
    this.pageSize = rows;
    this.page = nextPage;
    this.fetch();
  }

  // Vue active ⇒ la recherche opère sur le `/run` du runner (pas sur la liste brute masquée).
  reload(): void {
    const runner = this.runner();
    if (runner) runner.reload();
    else {
      this.page = 1;
      this.fetch();
    }
  }

  private fetch(): void {
    this.fetched = true;
    this.loading.set(true);
    this.studio.listRecords(this.entityKey, this.search.trim() || null, this.page, this.pageSize).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success) {
          this.records.set(res.data.items ?? []);
          this.total.set(res.data.totalCount ?? 0);
        }
      },
      error: () => {
        this.loading.set(false);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Chargement impossible.' });
      }
    });
  }

  private exportColumns() {
    return this.allFields().map(f => ({ key: f.key, label: f.label }));
  }

  exportCsv(all: boolean): void {
    if (all) this.exportAll('csv');
    else exportRowsCsv(this.entity()?.displayNamePlural || this.entityKey, this.exportColumns(), this.exportRows());
  }

  exportXlsx(all: boolean): void {
    if (all) this.exportAll('xlsx');
    else exportRowsXlsx(this.entity()?.displayNamePlural || this.entityKey, this.exportColumns(), this.exportRows());
  }

  private exportRows(): Record<string, unknown>[] {
    return this.records().map(r => r.data ?? {});
  }

  private exportAll(format: 'csv' | 'xlsx'): void {
    const max = Math.min(this.total(), 10000);
    this.studio.listRecords(this.entityKey, this.search.trim() || null, 1, max).subscribe({
      next: res => {
        if (!res.success) return;
        const rows = (res.data.items ?? []).map(r => r.data ?? {});
        const cols = this.exportColumns();
        const name = this.entity()?.displayNamePlural || this.entityKey;
        if (format === 'csv') exportRowsCsv(name, cols, rows);
        else exportRowsXlsx(name, cols, rows);
      }
    });
  }

  edit(row: DynamicRow): void {
    this.router.navigate(['/studio/d', this.entityKey, row.id, 'edit']);
  }

  remove(row: DynamicRow): void {
    this.confirmation.confirm({
      message: 'Supprimer cet enregistrement ? Cette action est irréversible.',
      header: 'Confirmation',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      accept: () => {
        this.studio.deleteRecord(this.entityKey, row.id).subscribe({
          next: res => {
            if (res.success) {
              this.toast.add({ severity: 'success', summary: 'Supprimé' });
              this.reload();
            }
          },
          error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Suppression impossible.' })
        });
      }
    });
  }
}
