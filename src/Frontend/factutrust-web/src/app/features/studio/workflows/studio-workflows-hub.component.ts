import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, map } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MessageService } from 'primeng/api';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonTableComponent } from '@shared/components/skeleton/skeleton-table.component';
import { StudioPageShellComponent } from '../shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from '../shared/studio-breadcrumb.util';
import { StudioService } from '../studio.service';
import { CustomEntity } from '../studio.models';
import { STUDIO_WORKFLOW_LABELS, formatWorkflowLabel } from './studio-workflow-labels';
import { workflowErrorMessage } from './studio-workflow-http.util';
import { WorkflowDefinitionDto, WorkflowTrigger } from './studio-workflows.models';
import { StudioWorkflowsService } from './studio-workflows.service';

type HubWorkflow = WorkflowDefinitionDto & { entityName: string };

/**
 * Hub `/studio/workflows` (4.4d) : liste les workflows de toutes les tables actives non-jonction
 * (ou d'une table via `?entity=`), avec activation (`toggleWorkflow`), duplication
 * (`duplicateWorkflow`) et suppression confirmée (`deleteWorkflow`). Aucune route `workflows/new`
 * ou `workflows/:id` n'existe encore (D-44-19, elles arrivent en 4.4e1) : le bouton « Nouveau
 * workflow » pointe déjà vers `/studio/workflows/new`. Pas de colonne « Dernière exécution »
 * (D17/D18 : le DTO ne l'expose pas). `data-testid` figés (`wf-hub-new`, `wf-hub-row-<id>`,
 * `wf-hub-toggle-<id>`) consommés par les tests Playwright de 4.4l1.
 */
@Component({
  selector: 'app-studio-workflows-hub',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, RouterLink, ButtonModule, InputTextModule, PaginatorModule, SelectModule, TableModule, TagModule,
    ToastModule, ToggleSwitchModule, TooltipModule, StudioPageShellComponent, SkeletonTableComponent
  ],
  template: `
    <app-studio-page-shell [title]="L.hub.title" [subtitle]="L.hub.subtitle" [breadcrumbs]="breadcrumbs">
      <!-- 4.6d1 (D-44-95) : hôte des toasts — les succès/erreurs des écritures étaient muets sur cette page. -->
      <p-toast styleClass="studio-theme" />
      <button pButton type="button" studioActions data-testid="wf-hub-new" [label]="L.hub.newWorkflow"
        icon="fa-solid fa-plus" routerLink="/studio/workflows/new" [queryParams]="{ entity: entityId() }"
        [disabled]="newDisabled()"></button>

      <div class="studio-toolbar">
        <p-select [options]="entities()" [ngModel]="entityId()" (ngModelChange)="onEntityChange($event)"
          optionLabel="displayName" optionValue="id" [showClear]="true" filter appendTo="body"
          panelStyleClass="studio-theme" [placeholder]="L.hub.allTables" [attr.aria-label]="L.hub.columns.table" />
        <input pInputText type="search" class="studio-search-input" [placeholder]="L.hub.search"
          [ngModel]="search()" (ngModelChange)="onSearchInput($event)" [attr.aria-label]="L.hub.search" />
        <span class="studio-toolbar__spacer"></span>
        @if (!loading()) {
          <span class="studio-muted">{{ counter() }} workflow(s)</span>
        }
      </div>

      @if (loading()) {
        <app-skeleton-table [rows]="5" [columns]="skeletonColumns" />
      } @else if (visible().length === 0) {
        <div class="wf-hub-empty">
          <i class="fa-solid fa-diagram-project" aria-hidden="true"></i>
          <h3>{{ L.hub.emptyTitle }}</h3>
          <p class="studio-muted">{{ L.hub.emptyHint }}</p>
          <button pButton type="button" [label]="L.hub.newWorkflow" icon="fa-solid fa-plus"
            routerLink="/studio/workflows/new" [queryParams]="{ entity: entityId() }" [disabled]="newDisabled()"></button>
        </div>
      } @else {
        <p-table [value]="visible()" dataKey="id" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>{{ L.hub.columns.name }}</th>
              <th>{{ L.hub.columns.table }}</th>
              <th>{{ L.hub.columns.trigger }}</th>
              <th class="studio-num">{{ L.hub.columns.steps }}</th>
              <th>{{ L.hub.columns.active }}</th>
              <th class="studio-num">{{ L.hub.columns.openInstances }}</th>
              <th class="studio-actions">{{ L.hub.columns.actions }}</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-w>
            <tr [attr.data-testid]="'wf-hub-row-' + w.id">
              <td>
                <a [routerLink]="['/studio/workflows', w.id]">{{ w.name }}</a>
                <div class="studio-muted">{{ w.key }}</div>
              </td>
              <td>{{ w.entityName }}</td>
              <td>{{ triggerLabel(w.trigger) }}</td>
              <td class="studio-num">{{ w.stepCount }}</td>
              <td>
                <p-toggleswitch [ngModel]="w.isActive" (onChange)="toggle(w, $event.checked)"
                  [attr.data-testid]="'wf-hub-toggle-' + w.id" [inputId]="'wf-toggle-' + w.id"
                  [ariaLabel]="L.hub.columns.active" />
              </td>
              <td class="studio-num">
                @if (w.openInstances > 0) {
                  <p-tag severity="warn" [value]="w.openInstances.toString()" />
                } @else {
                  <span class="studio-muted">—</span>
                }
              </td>
              <td class="studio-actions">
                <button pButton type="button" icon="fa-solid fa-pen" class="p-button-text p-button-rounded"
                  [routerLink]="['/studio/workflows', w.id]" [pTooltip]="L.hub.edit"></button>
                <button pButton type="button" icon="fa-solid fa-copy" class="p-button-text p-button-rounded"
                  (click)="duplicate(w)" [pTooltip]="L.hub.duplicate"></button>
                <button pButton type="button" icon="fa-solid fa-trash" class="p-button-text p-button-rounded"
                  severity="danger" (click)="remove(w)" [pTooltip]="L.hub.delete"></button>
              </td>
            </tr>
          </ng-template>
        </p-table>
        <!-- 4.6a1 (D-46-F01) : pagination serveur, motif des projets IA — seulement en vue « Toutes les tables ». -->
        @if (!entityId() && totalCount() > pageSize) {
          <p-paginator [first]="(page() - 1) * pageSize" [rows]="pageSize" [totalRecords]="totalCount()"
            [showCurrentPageReport]="false" (onPageChange)="onPage($event)" data-testid="wf-hub-paginator" />
        }
      }
    </app-studio-page-shell>
  `,
  styles: [`
    .wf-hub-empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--spacing-2); padding: var(--spacing-8, 3rem) var(--spacing-4); }
    .wf-hub-empty > i { font-size: 2rem; color: var(--color-primary-500); margin-bottom: var(--spacing-2); }
    .wf-hub-empty > h3 { margin: 0; font-size: var(--font-size-lg); }
    .wf-hub-empty > p { margin: 0 0 var(--spacing-3); }
  `],
  styleUrl: '../shared/studio-layout.scss'
})
export class StudioWorkflowsHubComponent implements OnInit {
  private readonly studio = inject(StudioService);
  private readonly workflowsSvc = inject(StudioWorkflowsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  readonly L = STUDIO_WORKFLOW_LABELS;
  readonly breadcrumbs = STUDIO_BREADCRUMBS.workflows();
  readonly skeletonColumns = [{ width: '30%' }, { width: '15%' }, { width: '15%' }, { width: '8%' }, { width: '8%' }, { width: '10%' }, { width: '14%' }];

  readonly entities = signal<CustomEntity[]>([]);
  readonly entityId = signal<string | null>(null);
  readonly workflows = signal<HubWorkflow[]>([]);
  readonly loading = signal(true);
  readonly search = signal('');
  /** 4.6a1 : état de la pagination serveur de la vue « Toutes les tables » (page 1-based, taille fixe ≤ borne API 200). */
  readonly page = signal(1);
  readonly pageSize = 50;
  readonly totalCount = signal(0);
  /** Valeur de recherche réellement envoyée au serveur (après debounce) en vue « Toutes les tables ». */
  readonly searchServer = signal<string | null>(null);
  private readonly search$ = new Subject<string>();
  private readonly destroyRef = inject(DestroyRef);
  protected readonly formatWorkflowLabel = formatWorkflowLabel;

  /**
   * 4.6a1 (D-46-F02) : en vue « Toutes les tables », recherche et pagination sont côté serveur
   * (`GET workflows?search=&page=&pageSize=`) — la liste affichée est la page renvoyée, dans
   * l'ordre du serveur (nom croissant). Avec `?entity=`, le filtre local est conservé (une table
   * dépasse rarement la vingtaine de workflows ; le chemin `listWorkflows(entityId)` n'est pas paginé).
   */
  readonly visible = computed(() => {
    if (!this.entityId()) return this.workflows();
    const q = this.search().trim().toLowerCase();
    return this.workflows().filter(w => !q || w.name.toLowerCase().includes(q) || w.key.includes(q));
  });
  /** Compteur de la barre d'outils : filtre local en mode « une table », `totalCount` du serveur sinon. */
  readonly counter = computed(() => this.entityId() ? this.visible().length : this.totalCount());
  /** Sans table choisie et plus d'une table : la clé technique doit être choisie dans le concepteur (4.4e1). */
  readonly newDisabled = computed(() => !this.entityId() && this.entities().length > 1);

  ngOnInit(): void {
    this.entityId.set(this.route.snapshot.queryParamMap.get('entity'));
    // Recherche serveur debouncée (motif `studio-view-designer`) : seulement en vue « Toutes les tables » ;
    // toute recherche ramène à la page 1.
    this.search$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (this.entityId()) return;
      this.searchServer.set(value.trim() || null);
      this.page.set(1);
      this.load();
    });
    this.studio.listEntities(false).subscribe({
      next: r => {
        const list = (r.data ?? []).filter(e => e.kind !== 'Junction');
        this.entities.set(list);
        this.load();
      },
      error: () => {
        this.loading.set(false);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: this.L.hub.loadError });
      }
    });
  }

  /**
   * 4.5f (D-45-F07, D-44-20 clos) : sans `?entity=`, UNE requête paginée `GET workflows` au lieu
   * de N `forkJoin` par table. 4.6a1 : la page demandée (`page`, taille fixe `pageSize`) et la
   * recherche serveur (`searchServer`, LIKE côté API, tronquée à 128) sont passées au serveur ;
   * la page est affichée dans l'ordre du serveur (nom croissant) — un tri local par table
   * disperserait les lignes d'une page à l'autre. Avec `?entity=`, le chemin `listWorkflows(entityId)`
   * est conservé (table inconnue / jonction ⇒ liste vide sans appel, comme avant) avec tri local.
   */
  private load(): void {
    this.loading.set(true);
    const entityId = this.entityId();
    const entity = entityId ? this.entities().find(e => e.id === entityId) : undefined;
    if (entityId && !entity) {
      this.workflows.set([]);
      this.totalCount.set(0);
      this.loading.set(false);
      return;
    }
    const src$ = entity
      ? this.workflowsSvc.listWorkflows(entity.id).pipe(map(r => {
          // Tri local par nom (une seule table : la clé `entityName` serait constante).
          const items = (r.data ?? []).map(w => ({ ...w, entityName: entity.displayName }));
          items.sort((a, b) => a.name.localeCompare(b.name));
          return { items, total: items.length };
        }))
      : this.workflowsSvc.listAllWorkflows(this.searchServer(), this.page(), this.pageSize).pipe(map(r => ({
          items: (r.data?.items ?? []).map(i => ({ ...i.workflow, entityName: i.entityDisplayName })),
          total: r.data?.totalCount ?? 0
        })));
    src$.pipe(catchError(() => {
      this.toast.add({ severity: 'error', summary: 'Erreur', detail: this.L.hub.loadError });
      return of({ items: [] as HubWorkflow[], total: 0 });
    })).subscribe(({ items, total }) => {
      this.workflows.set(items);
      this.totalCount.set(total);
      this.loading.set(false);
    });
  }

  triggerLabel(trigger: WorkflowTrigger): string {
    return this.L.triggers[trigger];
  }

  /** Saisie du champ de recherche : filtre local immédiat en mode « une table », recherche serveur debouncée sinon. */
  onSearchInput(value: string): void {
    this.search.set(value);
    this.search$.next(value);
  }

  /** Changement de page du paginator (motif des projets IA : `event.page` est 0-based). */
  onPage(event: PaginatorState): void {
    const next = (event.page ?? 0) + 1;
    if (next === this.page()) return;
    this.page.set(next);
    this.load();
  }

  onEntityChange(id: string | null): void {
    this.entityId.set(id);
    this.router.navigate([], { relativeTo: this.route, queryParams: { entity: id || null }, queryParamsHandling: 'merge', replaceUrl: true });
    if (!id) {
      // Retour à la vue « Toutes les tables » : page 1 et recherche serveur alignée sur le champ.
      this.page.set(1);
      this.searchServer.set(this.search().trim() || null);
    }
    this.load();
  }

  toggle(w: WorkflowDefinitionDto, isActive: boolean): void {
    this.workflowsSvc.toggleWorkflow(w.id, isActive).subscribe({
      next: r => {
        if (r.success && r.data) {
          this.replace(r.data);
          this.toast.add({ severity: 'success', summary: this.L.hub.title, detail: formatWorkflowLabel(this.L.hub.toggled, { state: isActive ? this.L.hub.stateActive : this.L.hub.stateInactive }) });
        }
      },
      // Écriture en skipErrorUi ⇒ toast local (§0.5).
      error: (err: HttpErrorResponse) => {
        this.replace(w);
        this.toast.add({ severity: err.status === 409 ? 'warn' : 'error', summary: 'Erreur', detail: err.status === 409 ? this.L.designer.conflict : (workflowErrorMessage(err) || this.L.hub.loadError) });
      }
    });
  }

  duplicate(w: WorkflowDefinitionDto): void {
    this.workflowsSvc.duplicateWorkflow(w.id).subscribe({
      next: r => {
        if (r.success) {
          this.toast.add({ severity: 'success', summary: this.L.hub.title, detail: this.L.hub.duplicated });
          this.load();
        }
      },
      // 409 = clé `<key>_copy<n>` déjà prise (maxCopies 9) ; 400 « Limite du plan » = 20 workflows/table (WORKFLOW_LIMITS.maxWorkflowsPerEntity).
      error: (err: HttpErrorResponse) => this.toast.add({ severity: 'warn', summary: 'Erreur', detail: err.status === 409 ? this.L.hub.duplicateKey : err.status === 400 && workflowErrorMessage(err).startsWith('Limite du plan') ? this.L.designer.quota : (workflowErrorMessage(err) || this.L.hub.loadError) })
    });
  }

  remove(w: WorkflowDefinitionDto): void {
    this.confirm.confirm({
      header: this.L.hub.deleteTitle,
      message: w.openInstances > 0
        ? formatWorkflowLabel(this.L.hub.deleteWithInstances, { name: w.name, count: w.openInstances })
        : formatWorkflowLabel(this.L.hub.deleteMessage, { name: w.name }),
      acceptLabel: this.L.hub.delete,
      acceptButtonStyleClass: 'btn-danger',
      icon: 'fa-solid fa-triangle-exclamation',
      accept: () => this.workflowsSvc.deleteWorkflow(w.id).subscribe({
        next: r => {
          this.toast.add({ severity: 'success', summary: this.L.hub.title, detail: formatWorkflowLabel(this.L.hub.deleted, { count: r.data?.cancelledInstances ?? 0 }) });
          this.load();
        },
        error: (err: HttpErrorResponse) => this.toast.add({ severity: 'error', summary: 'Erreur', detail: workflowErrorMessage(err) || this.L.hub.loadError })
      })
    });
  }

  private replace(w: WorkflowDefinitionDto): void {
    this.workflows.update(list => list.map(x => (x.id === w.id ? { ...w, entityName: x.entityName } : x)));
  }
}
