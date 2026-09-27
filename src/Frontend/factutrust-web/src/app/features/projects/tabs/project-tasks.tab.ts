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
      <div class="proj-tasks-view-switch" role="group" aria-label="Mode d'affichage">
        <button type="button" class="proj-tasks-view-btn" [class.proj-tasks-view-btn--active]="view === 'list'" (click)="setView('list')">Liste</button>
        <button type="button" class="proj-tasks-view-btn" [class.proj-tasks-view-btn--active]="view === 'board'" (click)="setView('board')">Tableau</button>
        <button type="button" class="proj-tasks-view-btn" [class.proj-tasks-view-btn--active]="view === 'calendar'" (click)="setView('calendar')">Calendrier</button>
        <button type="button" class="proj-tasks-view-btn" [class.proj-tasks-view-btn--active]="view === 'planning'" (click)="setView('planning')">Gantt</button>
      </div>

      <div class="proj-tasks-toolbar__actions">
        @if (canCreate) {
          <div class="proj-tasks-create-split">
            <app-button variant="primary" icon="pi-plus" (click)="openCreate()">Nouvelle tâche</app-button>
            <button type="button" class="proj-tasks-create-chevron btn btn-primary btn-sm" aria-label="Créer dans une colonne" (click)="phaseMenu.toggle($event)">
              <i class="pi pi-chevron-down"></i>
            </button>
            <p-menu #phaseMenu [popup]="true" [model]="phaseMenuItems" appendTo="body" />
          </div>
        }

        <button type="button" class="proj-tasks-tool-btn" (click)="focusFilters()">
          <i class="pi pi-filter"></i>
          Filtres
          @if (filterCount > 0) {
            <span class="proj-tasks-badge">{{ filterCount }}</span>
          }
        </button>

        <button type="button" class="proj-tasks-tool-btn" (click)="sortMenu.toggle($event)">
          <i class="pi pi-sort-alt"></i>
          Trier
        </button>
        <p-menu #sortMenu [popup]="true" [model]="sortMenuItems" appendTo="body" />

        <button type="button" class="proj-tasks-tool-btn proj-tasks-tool-btn--icon" aria-label="Actualiser" (click)="refresh.emit()">
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
          <input #searchInput pInputText type="text" placeholder="Rechercher une tâche…" [(ngModel)]="filters.searchText" />
        </span>
        <p-select [options]="statusOptions" [(ngModel)]="filters.status" optionLabel="label" optionValue="value" placeholder="Statut" [showClear]="true" (ngModelChange)="syncStatusChip()" />
        <p-select [options]="users" [(ngModel)]="filters.assigneeId" optionLabel="displayName" optionValue="id" placeholder="Responsable" [showClear]="true" />
        <p-select [options]="priorityOptions" [(ngModel)]="filters.priority" optionLabel="label" optionValue="value" placeholder="Priorité" [showClear]="true" />
        <p-select [options]="dueFilterOptions" [(ngModel)]="filters.dueFilter" optionLabel="label" optionValue="value" placeholder="Échéance" [showClear]="true" (ngModelChange)="syncStatusChip()" />
        @if (filterCount > 0) {
          <button type="button" class="ft-filters__reset" (click)="resetFilters()">
            <i class="pi pi-filter-slash"></i>
            Réinitialiser
          </button>
        }
      </div>
    </div>

    @if (selectedIds.size > 0) {
      <div class="proj-tasks-selection-bar">
        <span>{{ selectedIds.size }} sélectionnée(s)</span>
        <button type="button" class="proj-tasks-link-btn" (click)="clearSelection()">Effacer</button>
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
        currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} tâches"
        [showCurrentPageReport]="true">
        <ng-template pTemplate="header">
          <tr>
            <th class="proj-tasks-col-check"><span class="sr-only">Sélection</span></th>
            <th>Tâche</th>
            <th>Responsable</th>
            <th>Statut</th>
            <th>Priorité</th>
            <th>Échéance</th>
            <th>Avancement</th>
            <th>Temps estimé</th>
            <th class="proj-tasks-col-actions"><span class="sr-only">Actions</span></th>
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
                <button type="button" class="proj-tasks-icon-btn" aria-label="Saisir du temps" (click)="openLogTime(t)">
                  <i class="pi pi-play"></i>
                </button>
              }
              <button type="button" class="proj-tasks-icon-btn" aria-label="Actions" (click)="openRowMenu($event, t)">
                <i class="pi pi-ellipsis-v"></i>
              </button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="9">
            @if (hasTasks) {
              <app-empty-state icon="pi-search" title="Aucun résultat" description="Ajustez vos filtres ou réinitialisez la recherche." />
            } @else {
              <app-empty-state icon="pi-check-square" title="Aucune tâche" description="Créez une tâche pour alimenter le Kanban."
                [showAction]="canCreate" actionLabel="Nouvelle tâche" (actionClick)="openCreate()" />
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
                <div class="proj-planning-bar" [style.left.%]="barLeft(t)" [style.width.%]="barWidth(t)">
                  <span>{{ t.progressPercent }}%</span>
                  <i class="proj-planning-fill" [style.width.%]="t.progressPercent"></i>
                </div>
              }
            </div>
          </div>
        }
        @if (!rootTasks.length) {
          <p class="text-color-secondary">Aucune tâche à planifier.</p>
        }
      </div>
    }

    <p-dialog [(visible)]="dialog" header="Nouvelle tâche" [modal]="true" [style]="{ width: '32rem' }" [draggable]="false">
      <div class="task-create-form">
        <div class="task-create-field">
          <label for="task-create-title">Titre <span class="ft-required">*</span></label>
          <input
            id="task-create-title"
            pInputText
            class="w-full"
            [(ngModel)]="title"
            placeholder="Ex. : rédiger la proposition commerciale" />
        </div>

        <div class="task-create-field">
          <label for="task-create-phase">Colonne <span class="ft-required">*</span></label>
          <p-select
            inputId="task-create-phase"
            class="w-full"
            [options]="project?.phases || []"
            [(ngModel)]="phaseId"
            optionLabel="name"
            optionValue="id"
            placeholder="Sélectionner une colonne"
            appendTo="body" />
        </div>

        <div class="task-create-field">
          <label for="task-create-assignee">Assigné</label>
          <p-select
            inputId="task-create-assignee"
            class="w-full"
            [options]="users"
            [(ngModel)]="assigneeId"
            optionLabel="displayName"
            optionValue="id"
            placeholder="Non assigné"
            [showClear]="true"
            appendTo="body" />
        </div>

        <div class="task-create-field">
          <label for="task-create-priority">Priorité</label>
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
          <label for="task-create-due">Échéance</label>
          <p-datepicker
            inputId="task-create-due"
            class="w-full"
            [(ngModel)]="dueDate"
            dateFormat="dd/mm/yy"
            placeholder="jj/mm/aa"
            [showIcon]="true"
            appendTo="body" />
        </div>

        <div class="task-create-field">
          <label for="task-create-estimate">Estimation (h)</label>
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
          <label for="task-create-description">Description</label>
          <textarea
            id="task-create-description"
            pTextarea
            class="w-full"
            [(ngModel)]="description"
            rows="3"
            placeholder="Détails, contexte, critères d'acceptation…"></textarea>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="secondary" (click)="dialog = false">Annuler</app-button>
        <app-button variant="primary" (click)="submit()">Créer</app-button>
      </ng-template>
    </p-dialog>

    <p-dialog [(visible)]="logTimeVisible" header="Saisir du temps" [modal]="true" [style]="{ width: '32rem' }" [draggable]="false">
      @if (logTimeTask) {
        <p class="task-create-intro">Tâche : <strong>{{ logTimeTask.title }}</strong></p>
        <div class="task-create-form">
          <div class="task-create-field">
            <label for="log-time-date">Date <span class="ft-required">*</span></label>
            <p-datepicker
              inputId="log-time-date"
              class="w-full"
              [(ngModel)]="logWorkDate"
              dateFormat="dd/mm/yy"
              placeholder="jj/mm/aa"
              [showIcon]="true"
              appendTo="body" />
          </div>

          <div class="task-create-field">
            <label for="log-time-hours">Heures <span class="ft-required">*</span></label>
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
            <label for="logBillable">Facturable</label>
          </div>

          <div class="task-create-field">
            <label for="log-time-notes">Notes</label>
            <textarea
              id="log-time-notes"
              pTextarea
              class="w-full"
              [(ngModel)]="logNotes"
              rows="3"
              placeholder="Détails, contexte…"></textarea>
          </div>
        </div>
      }
      <ng-template pTemplate="footer">
        <app-button variant="secondary" (click)="logTimeVisible = false">Annuler</app-button>
        <app-button variant="primary" [disabled]="!canSubmitLogTime" (click)="submitLogTime()">Enregistrer</app-button>
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
      label: `Dans ${p.name}`,
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
    return this.cursor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
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
        label: 'Ouvrir',
        icon: 'pi pi-external-link',
        command: () => this.openTask(task)
      }
    ];
    if (this.canLogTime) {
      items.push({
        label: 'Saisir du temps',
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
