import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { Textarea } from 'primeng/textarea';
import { ProgressBarModule } from 'primeng/progressbar';
import { CheckboxModule } from 'primeng/checkbox';
import { Menu, MenuModule } from 'primeng/menu';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import {
  ProjectAssignableUser,
  ProjectDetail,
  ProjectTask,
  UpsertTaskPayload
} from '../project-api.service';
import {
  PROJECT_PRIORITY_OPTIONS,
  PROJECT_TASK_STATUS_OPTIONS,
  ProjectTaskStatusCode,
  canReceiveTime,
  canCreateTimeEntry as canCreateTimeEntryOnProject,
  formatDaysUntilDue,
  initialsFromName,
  parseProjectTaskPriority,
  toIsoDate
} from '../project-enums';
import {
  ProjectTaskKpiRowComponent,
  TaskStatusChipKey
} from '../components/project-task-kpi-row.component';
import { ProjectKanbanBoardComponent } from '../components/project-kanban-board.component';
import { CreateTimePayload } from './project-time.tab';
import {
  TASK_DUE_FILTER_OPTIONS,
  TASK_SORT_OPTIONS,
  TASK_VIEW_STORAGE_KEY,
  TaskDueFilterKey,
  TaskListFilters,
  TaskSortKey,
  activeFilterCount,
  emptyTaskFilters,
  filterAndSortRootTasks,
  filterRootTasks,
  hasAnyRootTasks,
  taskPriorityDotClass,
  taskStatusPillClass
} from '../project-tasks.vm';
import { erpDateLocale } from '@core/i18n/erp-format';

type TaskView = 'list' | 'board' | 'calendar' | 'planning';

@Component({
  selector: 'app-project-tasks-tab',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule,
    FormsModule,
    RouterLink,
    TableModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    Textarea,
    ProgressBarModule,
    CheckboxModule,
    MenuModule,
    ButtonComponent,
    EmptyStateComponent,
    ProjectTaskKpiRowComponent,
    ProjectKanbanBoardComponent
  ],
  template: `
    <div class="proj-tasks-toolbar">
      <div class="proj-tasks-view-switch" role="group" aria-label="Mode d'affichage" i18n-aria-label="@@projects.tabs.mode.d.affichage.316f4977">
        <button type="button" class="proj-tasks-view-btn" [class.proj-tasks-view-btn--active]="view === 'list'" (click)="setView('list')" i18n="@@projects.tabs.liste.4231be17">Liste</button>
        <button type="button" class="proj-tasks-view-btn" [class.proj-tasks-view-btn--active]="view === 'board'" (click)="setView('board')" i18n="@@projects.tabs.tableau.bb6d7e52">Tableau</button>
        <button type="button" class="proj-tasks-view-btn" [class.proj-tasks-view-btn--active]="view === 'calendar'" (click)="setView('calendar')" i18n="@@projects.tabs.calendrier.4c83736b">Calendrier</button>
        <button type="button" class="proj-tasks-view-btn" [class.proj-tasks-view-btn--active]="view === 'planning'" (click)="setView('planning')" i18n="@@projects.tabs.gantt.98162a7c">Gantt</button>
      </div>

      <div class="proj-tasks-toolbar__actions">
        @if (canCreate) {
          <div class="proj-tasks-create-split">
            <app-button variant="primary" icon="pi-plus" (click)="openCreate()" i18n="@@projects.tabs.nouvelle.tache.4804fb4e">Nouvelle tâche</app-button>
            <button type="button" class="proj-tasks-create-chevron btn btn-primary btn-sm" aria-label="Créer dans une colonne" i18n-aria-label="@@projects.tabs.creer.dans.une.colonne.415ad52f" (click)="phaseMenu.toggle($event)">
              <i class="pi pi-chevron-down"></i>
            </button>
            <p-menu #phaseMenu [popup]="true" [model]="phaseMenuItems" appendTo="body" />
          </div>
        }

        <button type="button" class="proj-tasks-tool-btn" (click)="focusFilters()"><ng-container i18n="@@projects.tabs.filtres.a2a5c940">
          <i class="pi pi-filter"></i>
          Filtres
          </ng-container>@if (filterCount > 0) {
            <span class="proj-tasks-badge">{{ filterCount }}</span>
          }
        </button>

        <button type="button" class="proj-tasks-tool-btn" (click)="sortMenu.toggle($event)" i18n="@@projects.tabs.trier.b4569ffd">
          <i class="pi pi-sort-alt"></i>
          Trier
        </button>
        <p-menu #sortMenu [popup]="true" [model]="sortMenuItems" appendTo="body" />

        <button type="button" class="proj-tasks-tool-btn proj-tasks-tool-btn--icon" aria-label="Actualiser" i18n-aria-label="@@projects.tabs.actualiser.8e0def29" (click)="refresh.emit()">
          <i class="pi pi-refresh"></i>
        </button>
      </div>
    </div>

    <app-project-task-kpi-row
      [tasks]="tasks"
      [activeChip]="activeStatusChip"
      (chipClick)="onStatusChip($event)" />

    <div #filtersAnchor class="ft-filters proj-tasks-filters mb-3">
      <div class="ft-filters__row">
        <span class="p-input-icon-left proj-tasks-search">
          <i class="pi pi-search"></i>
          <input #searchInput pInputText type="text" placeholder="Rechercher une tâche…" i18n-placeholder="@@projects.tabs.rechercher.une.tache.4a14baa4" [(ngModel)]="filters.searchText" />
        </span>
        <p-select [options]="statusOptions" [(ngModel)]="filters.status" optionLabel="label" optionValue="value" placeholder="Statut" i18n-placeholder="@@projects.tabs.statut.5bbedf8a" [showClear]="true" (ngModelChange)="syncStatusChip()" />
        <p-select [options]="users" [(ngModel)]="filters.assigneeId" optionLabel="displayName" optionValue="id" placeholder="Responsable" i18n-placeholder="@@projects.tabs.responsable.30f6a3fc" [showClear]="true" />
        <p-select [options]="priorityOptions" [(ngModel)]="filters.priority" optionLabel="label" optionValue="value" placeholder="Priorité" i18n-placeholder="@@projects.tabs.priorite.1afa2ae5" [showClear]="true" />
        <p-select [options]="dueFilterOptions" [(ngModel)]="filters.dueFilter" optionLabel="label" optionValue="value" placeholder="Échéance" i18n-placeholder="@@projects.tabs.echeance.3f104ac8" [showClear]="true" (ngModelChange)="syncStatusChip()" />
        @if (filterCount > 0) {
          <button type="button" class="ft-filters__reset" (click)="resetFilters()" i18n="@@projects.tabs.reinitialiser.5bafd023">
            <i class="pi pi-filter-slash"></i>
            Réinitialiser
          </button>
        }
      </div>
    </div>

    @if (selectedIds.size > 0) {
      <div class="proj-tasks-selection-bar">
        <span i18n="@@projects.tabs.selectionnee.s.899fdf7b">{{ selectedIds.size }} sélectionnée(s)</span>
        <button type="button" class="proj-tasks-link-btn" (click)="clearSelection()" i18n="@@projects.tabs.effacer.fe23de7b">Effacer</button>
      </div>
    }

    @if (view === 'list') {
      <p-table
        [value]="displayTasks"
        styleClass="p-datatable-sm proj-tasks-table"
        [rowHover]="true"
        [paginator]="displayTasks.length > 0"
        [rows]="10"
        [rowsPerPageOptions]="[10, 20, 50]"
        paginatorDropdownAppendTo="body"
        currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} tâches" i18n-currentPageReportTemplate="@@projects.tabs.affichage.de.first.a.last.sur.totalrecor.3defe1da"
        [showCurrentPageReport]="true">
        <ng-template pTemplate="header">
          <tr>
            <th class="proj-tasks-col-check" i18n="@@projects.tabs.selection.95c033fe"><span class="sr-only">Sélection</span></th>
            <th i18n="@@projects.tabs.tache.43c8425c">Tâche</th>
            <th i18n="@@projects.tabs.responsable.44b58814">Responsable</th>
            <th i18n="@@projects.tabs.statut.659499f3">Statut</th>
            <th i18n="@@projects.tabs.priorite.eede91d2">Priorité</th>
            <th i18n="@@projects.tabs.echeance.f9a77ff6">Échéance</th>
            <th i18n="@@projects.tabs.avancement.e1963fc4">Avancement</th>
            <th i18n="@@projects.tabs.temps.estime.b398ea0b">Temps estimé</th>
            <th class="proj-tasks-col-actions" i18n="@@projects.tabs.actions.07f0f729"><span class="sr-only">Actions</span></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-t>
          <tr class="proj-tasks-row" (click)="openTask(t)">
            <td (click)="$event.stopPropagation()">
              <p-checkbox [binary]="true" [ngModel]="isSelected(t.id)" (ngModelChange)="toggleSelected(t.id, $event)" [inputId]="'sel-' + t.id" />
            </td>
            <td>
              <div class="proj-tasks-task-cell">
                <span class="proj-tasks-task-icon" [style.background]="phaseColor(t.phaseId)">
                  <i class="pi pi-file"></i>
                </span>
                <div>
                  <strong class="proj-tasks-task-title">{{ t.title }}</strong>
                  <span class="proj-tasks-task-sub">{{ t.phaseName }}</span>
                  @if (subCount(t.id)) {
                    <span class="proj-tasks-task-sub"> · {{ doneCount(t.id) }}/{{ subCount(t.id) }}</span>
                  }
                </div>
              </div>
            </td>
            <td>
              @if (t.assigneeUserName) {
                <span class="proj-tasks-assignee">
                  <span class="proj-avatar">{{ initials(t.assigneeUserName) }}</span>
                  {{ t.assigneeUserName }}
                </span>
              } @else {
                <span class="text-color-secondary">—</span>
              }
            </td>
            <td>
              <span class="proj-task-pill" [ngClass]="statusPillClass(t.status)">
                <i class="pi pi-chevron-right" aria-hidden="true"></i>
                {{ t.statusDisplay | backendLabel }}
              </span>
            </td>
            <td>
              <span class="proj-pri-dot" [ngClass]="priorityDotClass(t.priority)"></span>
              {{ t.priorityDisplay }}
            </td>
            <td [class.proj-tasks-due--late]="t.isOverdue">
              @if (t.dueDate) {
                <span>{{ t.dueDate | date:'shortDate' }}</span>
                @if (dueLabel(t.dueDate); as rel) {
                  <span class="proj-tasks-due-rel">{{ rel }}</span>
                }
              } @else {
                —
              }
            </td>
            <td>
              <div class="proj-tasks-progress">
                <p-progressBar [value]="t.progressPercent" [showValue]="false" />
                <span>{{ t.progressPercent }} %</span>
              </div>
            </td>
            <td>{{ t.loggedHours | number:'1.0-1' }} / {{ t.estimatedHours | number:'1.0-1' }} h</td>
            <td class="proj-tasks-row-actions" (click)="$event.stopPropagation()">
              @if (canLogTime) {
                <button type="button" class="proj-tasks-icon-btn" aria-label="Saisir du temps" i18n-aria-label="@@projects.tabs.saisir.du.temps.8ed6704b" (click)="openLogTime(t)">
                  <i class="pi pi-play"></i>
                </button>
              }
              <button type="button" class="proj-tasks-icon-btn" aria-label="Actions" i18n-aria-label="@@projects.tabs.actions.7291fcf5" (click)="openRowMenu($event, t)">
                <i class="pi pi-ellipsis-v"></i>
              </button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="9">
            @if (hasTasks) {
              <app-empty-state icon="pi-search" title="Aucun résultat" i18n-title="@@projects.tabs.aucun.resultat.16cf2d7f" description="Ajustez vos filtres ou réinitialisez la recherche." i18n-description="@@projects.tabs.ajustez.vos.filtres.ou.reinitialisez.la.1102b36d" />
            } @else {
              <app-empty-state icon="pi-check-square" title="Aucune tâche" i18n-title="@@projects.tabs.aucune.tache.dc5a089d" description="Créez une tâche pour alimenter le Kanban." i18n-description="@@projects.tabs.creez.une.tache.pour.alimenter.le.kanban.a6d038a7"
                [showAction]="canCreate" actionLabel="Nouvelle tâche" i18n-actionLabel="@@projects.tabs.nouvelle.tache.21828a02" (actionClick)="openCreate()" />
            }
          </td></tr>
        </ng-template>
      </p-table>
      <p-menu #rowMenu [popup]="true" [model]="rowMenuItems" appendTo="body" />
    }

    @if (view === 'board' && project) {
      <app-project-kanban-board
        [project]="project"
        [tasks]="filteredRootTasks"
        [canUpdateTask]="canUpdateTask"
        (move)="move.emit($event)"
        (openTask)="openTask($event)" />
    }

    @if (view === 'calendar') {
      <div class="cal-nav flex gap-2 align-items-center mb-2">
        <app-button size="sm" variant="outline" (click)="shiftMonth(-1)">‹</app-button>
        <strong>{{ monthLabel }}</strong>
        <app-button size="sm" variant="outline" (click)="shiftMonth(1)">›</app-button>
      </div>
      <div class="proj-cal-grid">
        @for (d of monthDays; track d.key) {
          <div class="proj-cal-cell" [class.proj-cal-cell--muted]="!d.inMonth">
            <div class="proj-cal-day">{{ d.day }}</div>
            @for (t of d.tasks; track t.id) {
              <a class="proj-cal-task" [routerLink]="['/projects', t.projectId, 'tasks', t.id]">{{ t.title }}</a>
            }
          </div>
        }
      </div>
    }

    @if (view === 'planning') {
      <div class="planning">
        @for (t of filteredRootTasks; track t.id) {
          <div class="proj-planning-row">
            <div class="proj-planning-label" [routerLink]="['/projects', t.projectId, 'tasks', t.id]">{{ t.title }}</div>
            <div class="proj-planning-track">
              @if (t.dueDate && project?.startDate) {
                <div class="proj-planning-bar" [style.inset-inline-start.%]="barLeft(t)" [style.width.%]="barWidth(t)">
                  <span>{{ t.progressPercent }}%</span>
                  <i class="proj-planning-fill" [style.width.%]="t.progressPercent"></i>
                </div>
              }
            </div>
          </div>
        }
        @if (!rootTasks.length) {
          <p class="text-color-secondary" i18n="@@projects.tabs.aucune.tache.a.planifier.be7fc4da">Aucune tâche à planifier.</p>
        }
      </div>
    }

    <p-dialog [(visible)]="dialog" header="Nouvelle tâche" i18n-header="@@projects.tabs.nouvelle.tache.b5089ccf" [modal]="true" [style]="{ width: '32rem' }" [draggable]="false">
      <div class="task-create-form">
        <div class="task-create-field">
          <label for="task-create-title" i18n="@@projects.tabs.titre.ba469872">Titre <span class="ft-required">*</span></label>
          <input
            id="task-create-title"
            pInputText
            class="w-full"
            [(ngModel)]="title"
            placeholder="Ex. : rédiger la proposition commerciale" i18n-placeholder="@@projects.tabs.ex.rediger.la.proposition.commerciale.e7b43768" />
        </div>

        <div class="task-create-field">
          <label for="task-create-phase" i18n="@@projects.tabs.colonne.80d0759a">Colonne <span class="ft-required">*</span></label>
          <p-select
            inputId="task-create-phase"
            class="w-full"
            [options]="project?.phases || []"
            [(ngModel)]="phaseId"
            optionLabel="name"
            optionValue="id"
            placeholder="Sélectionner une colonne" i18n-placeholder="@@projects.tabs.selectionner.une.colonne.3dedb558"
            appendTo="body" />
        </div>

        <div class="task-create-field">
          <label for="task-create-assignee" i18n="@@projects.tabs.assigne.be552b5f">Assigné</label>
          <p-select
            inputId="task-create-assignee"
            class="w-full"
            [options]="users"
            [(ngModel)]="assigneeId"
            optionLabel="displayName"
            optionValue="id"
            placeholder="Non assigné" i18n-placeholder="@@projects.tabs.non.assigne.5d59e3ca"
            [showClear]="true"
            appendTo="body" />
        </div>

        <div class="task-create-field">
          <label for="task-create-priority" i18n="@@projects.tabs.priorite.eede91d2">Priorité</label>
          <p-select
            inputId="task-create-priority"
            class="w-full"
            [options]="priorityOptions"
            [(ngModel)]="priority"
            optionLabel="label"
            optionValue="value"
            appendTo="body" />
        </div>

        <div class="task-create-field">
          <label for="task-create-due" i18n="@@projects.tabs.echeance.f9a77ff6">Échéance</label>
          <p-datepicker
            inputId="task-create-due"
            class="w-full"
            [(ngModel)]="dueDate"
            dateFormat="dd/mm/yy"
            placeholder="jj/mm/aa" i18n-placeholder="@@projects.tabs.jj.mm.aa.48162879"
            [showIcon]="true"
            appendTo="body" />
        </div>

        <div class="task-create-field">
          <label for="task-create-estimate" i18n="@@projects.tabs.estimation.h.25cfef6a">Estimation (h)</label>
          <p-inputNumber
            inputId="task-create-estimate"
            class="w-full"
            [(ngModel)]="estimatedHours"
            [min]="0"
            mode="decimal"
            [minFractionDigits]="0"
            [maxFractionDigits]="2" />
        </div>

        <div class="task-create-field">
          <label for="task-create-description" i18n="@@projects.tabs.description.55f8ebc8">Description</label>
          <textarea
            id="task-create-description"
            pTextarea
            class="w-full"
            [(ngModel)]="description"
            rows="3"
            placeholder="Détails, contexte, critères d'acceptation…" i18n-placeholder="@@projects.project-tasks.details.contexte.criteres.d.acceptation.1cc3c21f"></textarea>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="secondary" (click)="dialog = false" i18n="@@projects.tabs.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" (click)="submit()" i18n="@@projects.tabs.creer.1a686172">Créer</app-button>
      </ng-template>
    </p-dialog>

    <p-dialog [(visible)]="logTimeVisible" header="Saisir du temps" i18n-header="@@projects.tabs.saisir.du.temps.c078bb5f" [modal]="true" [style]="{ width: '32rem' }" [draggable]="false">
      @if (logTimeTask) {
        <p class="task-create-intro" i18n="@@projects.tabs.tache.7176d005">Tâche : <strong>{{ logTimeTask.title }}</strong></p>
        <div class="task-create-form">
          <div class="task-create-field">
            <label for="log-time-date" i18n="@@projects.tabs.date.5d1227ad">Date <span class="ft-required">*</span></label>
            <p-datepicker
              inputId="log-time-date"
              class="w-full"
              [(ngModel)]="logWorkDate"
              dateFormat="dd/mm/yy"
              placeholder="jj/mm/aa" i18n-placeholder="@@projects.tabs.jj.mm.aa.48162879"
              [showIcon]="true"
              appendTo="body" />
          </div>

          <div class="task-create-field">
            <label for="log-time-hours" i18n="@@projects.tabs.heures.99e18c3d">Heures <span class="ft-required">*</span></label>
            <p-inputNumber
              inputId="log-time-hours"
              class="w-full"
              [(ngModel)]="logHours"
              [min]="0.25"
              [max]="24"
              [step]="0.25"
              mode="decimal"
              [minFractionDigits]="0"
              [maxFractionDigits]="2" />
          </div>

          <div class="task-create-check">
            <p-checkbox [(ngModel)]="logBillable" [binary]="true" inputId="logBillable" />
            <label for="logBillable" i18n="@@projects.tabs.facturable.63134237">Facturable</label>
          </div>

          <div class="task-create-field">
            <label for="log-time-notes" i18n="@@projects.tabs.notes.70440046">Notes</label>
            <textarea
              id="log-time-notes"
              pTextarea
              class="w-full"
              [(ngModel)]="logNotes"
              rows="3"
              placeholder="Détails, contexte…" i18n-placeholder="@@projects.project-tasks.details.contexte.18aa02a6"></textarea>
          </div>
        </div>
      }
      <ng-template pTemplate="footer">
        <app-button variant="secondary" (click)="logTimeVisible = false" i18n="@@projects.tabs.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" [disabled]="!canSubmitLogTime" (click)="submitLogTime()" i18n="@@projects.tabs.enregistrer.f7c8bcd8">Enregistrer</app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .task-create-form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }

    .task-create-field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }

    .task-create-field label {
      font-size: var(--font-size-sm);
      font-weight: 400;
      color: var(--color-text-secondary);
    }

    .task-create-intro {
      margin: 0 0 var(--spacing-3);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      line-height: 1.5;
    }

    .task-create-check {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .task-create-check label {
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      cursor: pointer;
    }
  `]
})
export class ProjectTasksTabComponent implements OnInit {
  @ViewChild('filtersAnchor') filtersAnchor?: ElementRef<HTMLElement>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('rowMenu') rowMenu?: Menu;

  private readonly router = inject(Router);

  @Input() project: ProjectDetail | null = null;
  @Input() tasks: ProjectTask[] = [];
  @Input() users: ProjectAssignableUser[] = [];
  @Input() canCreate = false;
  @Input() canUpdateTask = false;
  @Input() canCreateTime = false;

  @Output() create = new EventEmitter<UpsertTaskPayload>();
  @Output() move = new EventEmitter<{ taskId: string; phaseId: string; status?: ProjectTaskStatusCode }>();
  @Output() refresh = new EventEmitter<void>();
  @Output() logTime = new EventEmitter<CreateTimePayload>();

  view: TaskView = 'list';
  dialog = false;
  filters: TaskListFilters = emptyTaskFilters();
  sortKey: TaskSortKey = 'dueAsc';
  activeStatusChip: TaskStatusChipKey | null = null;
  selectedIds = new Set<string>();
  rowMenuItems: MenuItem[] = [];
  private rowMenuTask: ProjectTask | null = null;
  private boardTasksCache: ProjectTask[] = [];
  private boardTasksCacheKey = '';

  logTimeVisible = false;
  logTimeTask: ProjectTask | null = null;
  logWorkDate: Date = new Date();
  logHours = 1;
  logBillable = true;
  logNotes = '';

  title = '';
  phaseId = '';
  assigneeId: string | null = null;
  priority: 'Low' | 'Normal' | 'High' | 'Urgent' = 'Normal';
  dueDate: Date | null = null;
  estimatedHours = 0;
  description = '';
  cursor = new Date();

  readonly statusOptions = PROJECT_TASK_STATUS_OPTIONS;
  readonly priorityOptions = PROJECT_PRIORITY_OPTIONS;
  readonly dueFilterOptions = TASK_DUE_FILTER_OPTIONS;
  readonly initials = initialsFromName;
  readonly statusPillClass = taskStatusPillClass;
  readonly priorityDotClass = taskPriorityDotClass;
  readonly dueLabel = formatDaysUntilDue;
  readonly parsePriority = parseProjectTaskPriority;

  readonly sortMenuItems: MenuItem[] = TASK_SORT_OPTIONS.map(o => ({
    label: o.label,
    command: () => { this.sortKey = o.value; }
  }));

  ngOnInit(): void {
    const stored = localStorage.getItem(TASK_VIEW_STORAGE_KEY);
    if (stored === 'list' || stored === 'board' || stored === 'calendar' || stored === 'planning') {
      this.view = stored;
    }
  }

  get phaseMenuItems(): MenuItem[] {
    return (this.project?.phases ?? []).map(p => ({
      label: $localize`:@@projects.project-tasks.ts.dans.name.260e4e47:Dans ${p.name}:name:`,
      command: () => this.openCreate(p.id)
    }));
  }

  get filterCount(): number {
    return activeFilterCount(this.filters);
  }

  get canLogTime(): boolean {
    return this.canCreateTime && !!this.project && canCreateTimeEntryOnProject(this.project);
  }

  get canSubmitLogTime(): boolean {
    return typeof this.logHours === 'number' && this.logHours > 0 && this.logHours <= 24;
  }

  get hasTasks(): boolean {
    return hasAnyRootTasks(this.tasks);
  }

  get filteredRootTasks(): ProjectTask[] {
    const key = this.boardTasksKey();
    if (key !== this.boardTasksCacheKey) {
      this.boardTasksCacheKey = key;
      this.boardTasksCache = filterRootTasks(this.tasks, this.filters);
    }
    return this.boardTasksCache;
  }

  private boardTasksKey(): string {
    const taskKey = this.tasks.map(t => `${t.id}:${t.phaseId}:${t.status}`).join('|');
    const f = this.filters;
    return `${taskKey}::${f.searchText}::${f.status ?? ''}::${f.assigneeId ?? ''}::${f.priority ?? ''}::${f.dueFilter ?? ''}`;
  }

  get displayTasks(): ProjectTask[] {
    return filterAndSortRootTasks(this.tasks, this.filters, this.sortKey);
  }

  get rootTasks(): ProjectTask[] {
    return this.tasks.filter(t => !t.parentTaskId);
  }

  get monthLabel(): string {
    return this.cursor.toLocaleDateString(erpDateLocale('fr-FR'), { month: 'long', year: 'numeric' });
  }

  get monthDays(): { key: string; day: number; inMonth: boolean; tasks: ProjectTask[] }[] {
    const y = this.cursor.getFullYear();
    const m = this.cursor.getMonth();
    const first = new Date(y, m, 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      cells.push({
        key,
        day: d.getDate(),
        inMonth: d.getMonth() === m,
        tasks: this.tasks.filter(t => t.dueDate && t.dueDate.slice(0, 10) === key)
      });
    }
    return cells;
  }

  setView(view: TaskView): void {
    this.view = view;
    localStorage.setItem(TASK_VIEW_STORAGE_KEY, view);
  }

  focusFilters(): void {
    this.filtersAnchor?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => this.searchInput?.nativeElement.focus(), 150);
  }

  resetFilters(): void {
    this.filters = emptyTaskFilters();
    this.activeStatusChip = null;
  }

  onStatusChip(ev: { chip: TaskStatusChipKey; status: ProjectTaskStatusCode | null; dueFilter: TaskDueFilterKey | null }): void {
    if (this.activeStatusChip === ev.chip) {
      this.activeStatusChip = null;
      this.filters = { ...this.filters, status: null, dueFilter: null };
      return;
    }
    this.activeStatusChip = ev.chip;
    this.filters = {
      ...this.filters,
      status: ev.status,
      dueFilter: ev.dueFilter
    };
  }

  syncStatusChip(): void {
    const { status, dueFilter } = this.filters;
    if (dueFilter === 'overdue' && !status) {
      this.activeStatusChip = 'overdue';
    } else if (status === 'Todo') {
      this.activeStatusChip = 'todo';
    } else if (status === 'Done') {
      this.activeStatusChip = 'done';
    } else if (status === 'InProgress') {
      this.activeStatusChip = 'inProgress';
    } else if (status === 'Waiting') {
      this.activeStatusChip = 'waiting';
    } else if (!status && !dueFilter && !this.filters.searchText && !this.filters.assigneeId && !this.filters.priority) {
      this.activeStatusChip = 'total';
    } else {
      this.activeStatusChip = null;
    }
  }

  phaseColor(phaseId: string): string {
    return this.project?.phases.find(p => p.id === phaseId)?.color ?? 'var(--color-primary-600, #2563eb)';
  }

  subCount(id: string): number {
    return this.tasks.filter(t => t.parentTaskId === id).length;
  }

  doneCount(id: string): number {
    return this.tasks.filter(t => t.parentTaskId === id && (t.status === 'Done' || t.status === 3)).length;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  toggleSelected(id: string, checked: boolean): void {
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
  }

  clearSelection(): void {
    this.selectedIds.clear();
  }

  openTask(t: ProjectTask): void {
    void this.router.navigate(['/projects', t.projectId, 'tasks', t.id]);
  }

  openRowMenu(event: Event, task: ProjectTask): void {
    this.rowMenuTask = task;
    const items: MenuItem[] = [
      {
        label: $localize`:@@projects.project-tasks.ts.ouvrir.42c07747:Ouvrir`,
        icon: 'pi pi-external-link',
        command: () => this.openTask(task)
      }
    ];
    if (this.canLogTime) {
      items.push({
        label: $localize`:@@projects.project-tasks.ts.saisir.du.temps.829487f5:Saisir du temps`,
        icon: 'pi pi-clock',
        command: () => this.openLogTime(task)
      });
    }
    this.rowMenuItems = items;
    this.rowMenu?.toggle(event);
  }

  openLogTime(task: ProjectTask): void {
    this.logTimeTask = task;
    this.logWorkDate = new Date();
    this.logHours = 1;
    this.logBillable = true;
    this.logNotes = '';
    this.logTimeVisible = true;
  }

  submitLogTime(): void {
    const task = this.logTimeTask;
    const project = this.project;
    if (!task || !project || !this.canSubmitLogTime) return;
    this.logTime.emit({
      projectId: project.id,
      taskId: task.id,
      workDate: toIsoDate(this.logWorkDate) ?? new Date().toISOString(),
      hours: this.logHours,
      isBillable: this.logBillable,
      notes: this.logNotes.trim() || undefined
    });
    this.logTimeVisible = false;
  }

  shiftMonth(delta: number): void {
    this.cursor = new Date(this.cursor.getFullYear(), this.cursor.getMonth() + delta, 1);
  }

  openCreate(phaseId?: string): void {
    this.title = '';
    this.phaseId = phaseId ?? this.project?.phases[0]?.id ?? '';
    this.assigneeId = null;
    this.priority = 'Normal';
    this.dueDate = null;
    this.estimatedHours = 0;
    this.description = '';
    this.dialog = true;
  }

  submit(): void {
    if (!this.title.trim() || !this.phaseId) return;
    this.create.emit({
      phaseId: this.phaseId,
      title: this.title.trim(),
      description: this.description || null,
      priority: this.priority,
      dueDate: toIsoDate(this.dueDate),
      assigneeUserId: this.assigneeId,
      estimatedHours: this.estimatedHours,
      progressPercent: 0
    });
    this.dialog = false;
  }

  barLeft(t: ProjectTask): number {
    const range = this.range();
    if (!range || !t.dueDate || !this.project?.startDate) return 0;
    const barStart = new Date(this.project.startDate).getTime();
    const offset = Math.max(0, (barStart - range.start.getTime()) / range.span);
    return Math.min(95, offset * 100);
  }

  barWidth(t: ProjectTask): number {
    const range = this.range();
    if (!range || !t.dueDate || !this.project?.startDate) return 0;
    const barStart = new Date(this.project.startDate).getTime();
    const barEnd = new Date(t.dueDate).getTime();
    const width = Math.max(0, (barEnd - barStart) / range.span);
    return Math.min(100 - this.barLeft(t), Math.max(2, width * 100));
  }

  private range(): { start: Date; end: Date; span: number } | null {
    const projectStart = this.project?.startDate ? new Date(this.project.startDate).getTime() : NaN;
    const projectEnd = this.project?.endDate ? new Date(this.project.endDate).getTime() : NaN;
    const dueDates = this.tasks
      .map(t => t.dueDate ? new Date(t.dueDate).getTime() : NaN)
      .filter(n => !Number.isNaN(n));
    const startMs = !Number.isNaN(projectStart)
      ? projectStart
      : (dueDates.length ? Math.min(...dueDates) : Date.now());
    const endMs = !Number.isNaN(projectEnd)
      ? projectEnd
      : (dueDates.length ? Math.max(...dueDates) : startMs + 86400000 * 30);
    const span = Math.max(1, endMs - startMs);
    return { start: new Date(startMs), end: new Date(endMs), span };
  }
}
