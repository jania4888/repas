import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CdkDragDrop,
  DragDropModule,
  transferArrayItem
} from '@angular/cdk/drag-drop';
import { ProgressBarModule } from 'primeng/progressbar';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ProjectDetail, ProjectTask } from '../project-api.service';
import {
  PROJECT_TASK_STATUS_OPTIONS,
  ProjectTaskStatusCode,
  parseProjectTaskStatus,
  taskStatusForPhaseSortOrder
} from '../project-enums';

export interface ProjectTaskMoveEvent {
  taskId: string;
  phaseId: string;
  status?: ProjectTaskStatusCode;
}

@Component({
  selector: 'app-project-kanban-board',
  standalone: true,
  imports: [BackendLabelPipe, CommonModule, DragDropModule, ProgressBarModule, EmptyStateComponent],
  styleUrls: ['../projects.scss'],
  template: `
    @if (!project) {
      <p class="text-color-secondary" i18n="@@projects.components.projet.introuvable.85f8f1d0">Projet introuvable.</p>
    } @else if (!hasVisibleTasks) {
      <app-empty-state
        icon="pi-check-square"
        title="Aucune tâche visible" i18n-title="@@projects.components.aucune.tache.visible.2097ba88"
        description="Créez une tâche ou ajustez vos filtres pour alimenter le Kanban." />
    } @else {
      <div class="proj-kanban" [class.proj-kanban--readonly]="!canUpdateTask">
        @for (phase of project.phases; track phase.id) {
          <div
            class="proj-kanban-col"
            [class.proj-kanban-col--readonly]="!canUpdateTask"
            cdkDropList
            [id]="phase.id"
            [cdkDropListData]="columnTasks[phase.id]"
            [cdkDropListConnectedTo]="connectedPhaseIds"
            (cdkDropListDropped)="onDrop($event, phase.id)">
            <h3
              class="proj-kanban-col-title"
              [style.border-top-color]="phase.color || 'var(--primary-500)'">
              {{ phase.name }}
              <span class="proj-kanban-col-count">{{ columnTasks[phase.id].length }}</span>
            </h3>
            <div class="proj-kanban-col-body">
              @for (task of columnTasks[phase.id]; track task.id) {
                <div
                  class="proj-kanban-card"
                  [class.proj-kanban-card--pending]="isPending(task.id)"
                  cdkDrag
                  [cdkDragData]="task"
                  [cdkDragDisabled]="!canUpdateTask || isPending(task.id)"
                  (cdkDragStarted)="dragging = true"
                  (cdkDragEnded)="onDragEnded()">
                  <button
                    type="button"
                    class="proj-kanban-card__body"
                    (click)="onCardClick(task)">
                    <strong>{{ task.title }}</strong>
                    <div class="text-sm">{{ task.priorityDisplay | backendLabel }}</div>
                    <div class="text-sm">{{ task.assigneeUserName || 'Non assigné' }}</div>
                    <div class="text-sm">
                      {{ task.loggedHours | number:'1.0-1' }} / {{ task.estimatedHours | number:'1.0-1' }} h
                    </div>
                    <p-progressBar [value]="task.progressPercent" [showValue]="false" styleClass="mt-1" />
                    @if (task.isOverdue) {
                      <span class="text-danger" i18n="@@projects.components.en.retard.40c1dde3">En retard</span>
                    }
                  </button>
                </div>
              }
            </div>
          </div>
        }
      </div>
      @if (!canUpdateTask) {
        <p class="proj-kanban-readonly-hint text-sm text-color-secondary" i18n="@@projects.components.vous.n.avez.pas.les.droits.pour.deplacer.les.tac.81b95700"> Vous n'avez pas les droits pour déplacer les tâches sur ce tableau. </p>
      } @else {
        <p class="proj-kanban-readonly-hint text-sm text-color-secondary" i18n="@@projects.components.glissez.une.carte.vers.une.autre.colonne.pour.ch.6b8f1b8b"> Glissez une carte vers une autre colonne pour changer son statut. </p>
      }
    }
  `
})
export class ProjectKanbanBoardComponent implements OnInit, OnChanges {
  @Input() project: ProjectDetail | null = null;
  /** Root tasks already filtered for the board (no subtasks). */
  @Input() tasks: ProjectTask[] = [];
  @Input() canUpdateTask = false;

  @Output() move = new EventEmitter<ProjectTaskMoveEvent>();
  @Output() openTask = new EventEmitter<ProjectTask>();

  columnTasks: Record<string, ProjectTask[]> = {};
  connectedPhaseIds: string[] = [];
  dragging = false;

  private readonly pendingIds = new Set<string>();
  private lastSyncKey = '';

  ngOnInit(): void {
    this.syncFromInputs(true);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['project'] || changes['tasks']) {
      this.syncFromInputs(false);
    }
  }

  get hasVisibleTasks(): boolean {
    return this.tasks.length > 0;
  }

  isPending(taskId: string): boolean {
    return this.pendingIds.has(taskId);
  }

  onDragEnded(): void {
    window.setTimeout(() => {
      this.dragging = false;
    }, 0);
  }

  onCardClick(task: ProjectTask): void {
    if (this.dragging) return;
    this.openTask.emit(task);
  }

  onDrop(event: CdkDragDrop<ProjectTask[]>, targetPhaseId: string): void {
    if (!this.canUpdateTask || !this.project) return;
    if (event.previousContainer === event.container) return;

    const task = event.item.data as ProjectTask;
    if (!task || task.phaseId === targetPhaseId) return;

    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex
    );

    const phase = this.project.phases.find(p => p.id === targetPhaseId);
    const status = phase
      ? taskStatusForPhaseSortOrder(this.project.kind, phase.sortOrder) ?? undefined
      : undefined;

    this.applyOptimisticMove(task, targetPhaseId, phase?.name, status);
    this.pendingIds.add(task.id);
    this.lastSyncKey = this.buildSyncKey();
    this.move.emit({ taskId: task.id, phaseId: targetPhaseId, status });
  }

  private syncFromInputs(force: boolean): void {
    this.connectedPhaseIds = this.project?.phases.map(p => p.id) ?? [];

    const key = this.buildSyncKey();
    if (!force && key === this.lastSyncKey) {
      // Server confirmed the optimistic layout — re-enable drag without rebuilding CDK arrays.
      this.pendingIds.clear();
      return;
    }

    this.rebuildColumns();
    this.pendingIds.clear();
    this.lastSyncKey = key;
  }

  private buildSyncKey(): string {
    const phases = this.project?.phases.map(p => p.id).join(',') ?? '';
    const tasks = this.tasks.map(t => `${t.id}:${t.phaseId}:${t.status}:${t.progressPercent}`).join('|');
    return `${phases}::${tasks}`;
  }

  private rebuildColumns(): void {
    const grouped: Record<string, ProjectTask[]> = {};
    for (const phase of this.project?.phases ?? []) {
      grouped[phase.id] = [];
    }
    for (const task of this.tasks) {
      if (grouped[task.phaseId]) {
        grouped[task.phaseId].push(task);
      }
    }
    this.columnTasks = grouped;
  }

  private applyOptimisticMove(
    task: ProjectTask,
    phaseId: string,
    phaseName: string | undefined,
    status: ProjectTaskStatusCode | undefined
  ): void {
    task.phaseId = phaseId;
    if (phaseName) {
      task.phaseName = phaseName;
    }
    if (!status) return;
    const previousStatus = parseProjectTaskStatus(task.status);
    task.status = status;
    task.statusDisplay = statusLabel(status);
    if (status === 'Done') {
      task.progressPercent = 100;
    } else if (previousStatus === 'Done') {
      task.progressPercent = 0;
    }
  }
}

function statusLabel(status: ProjectTaskStatusCode): string {
  return PROJECT_TASK_STATUS_OPTIONS.find(o => o.value === status)?.label ?? status;
}
