import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectTask } from '../project-api.service';
import { ProjectTaskStatusCode } from '../project-enums';
import { computeRootTaskStatusSummary, TaskDueFilterKey } from '../project-tasks.vm';

export type TaskStatusChipKey = 'total' | 'todo' | 'done' | 'inProgress' | 'waiting' | 'overdue';

@Component({
  selector: 'app-project-task-kpi-row',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="proj-tasks-status-bar" role="list" aria-label="Répartition des tâches" i18n-aria-label="@@projects.components.repartition.des.taches.709d2410">
      <button
        type="button"
        class="proj-tasks-status-chip"
        [class.proj-tasks-status-chip--active]="activeChip === 'total'"
        role="listitem"
        [attr.aria-label]="loc_ui_tern_total_00dda8 + summary.total + loc_ui_tern_taches_20fef1"
        (click)="onChip('total')">
        <span class="proj-tasks-status-chip__label" i18n="@@projects.components.total.b25928c6">Total</span>
        <strong class="proj-tasks-status-chip__value">{{ summary.total }}</strong>
      </button>
      <button
        type="button"
        class="proj-tasks-status-chip proj-tasks-status-chip--todo"
        [class.proj-tasks-status-chip--active]="activeChip === 'todo'"
        role="listitem"
        [attr.aria-label]="loc_ui_tern_a_faire_5268a2 + summary.todo + ', ' + summary.todoPct + loc_ui_tern_pour_cent_8f8638"
        (click)="onChip('todo')">
        <span class="proj-tasks-status-chip__label" i18n="@@projects.components.a.faire.262bf4ea">À faire</span>
        <strong class="proj-tasks-status-chip__value">{{ summary.todo }}</strong>
        <span class="proj-tasks-status-chip__pct">{{ summary.todoPct }} %</span>
      </button>
      <button
        type="button"
        class="proj-tasks-status-chip proj-tasks-status-chip--done"
        [class.proj-tasks-status-chip--active]="activeChip === 'done'"
        role="listitem"
        [attr.aria-label]="loc_ui_tern_terminees_486f0e + summary.done + ', ' + summary.donePct + loc_ui_tern_pour_cent_8f8638"
        (click)="onChip('done')">
        <span class="proj-tasks-status-chip__label" i18n="@@projects.components.terminees.7d7f40ab">Terminées</span>
        <strong class="proj-tasks-status-chip__value">{{ summary.done }}</strong>
        <span class="proj-tasks-status-chip__pct">{{ summary.donePct }} %</span>
      </button>
      <button
        type="button"
        class="proj-tasks-status-chip proj-tasks-status-chip--progress"
        [class.proj-tasks-status-chip--active]="activeChip === 'inProgress'"
        role="listitem"
        [attr.aria-label]="loc_ui_tern_en_cours_494671 + summary.inProgress + ', ' + summary.inProgressPct + loc_ui_tern_pour_cent_8f8638"
        (click)="onChip('inProgress')">
        <span class="proj-tasks-status-chip__label" i18n="@@projects.components.en.cours.bc9b533a">En cours</span>
        <strong class="proj-tasks-status-chip__value">{{ summary.inProgress }}</strong>
        <span class="proj-tasks-status-chip__pct">{{ summary.inProgressPct }} %</span>
      </button>
      <button
        type="button"
        class="proj-tasks-status-chip proj-tasks-status-chip--waiting"
        [class.proj-tasks-status-chip--active]="activeChip === 'waiting'"
        role="listitem"
        [attr.aria-label]="loc_ui_tern_en_attente_b9cac2 + summary.waiting + ', ' + summary.waitingPct + loc_ui_tern_pour_cent_8f8638"
        (click)="onChip('waiting')">
        <span class="proj-tasks-status-chip__label" i18n="@@projects.components.en.attente.5231158f">En attente</span>
        <strong class="proj-tasks-status-chip__value">{{ summary.waiting }}</strong>
        <span class="proj-tasks-status-chip__pct">{{ summary.waitingPct }} %</span>
      </button>
      <button
        type="button"
        class="proj-tasks-status-chip proj-tasks-status-chip--overdue"
        [class.proj-tasks-status-chip--active]="activeChip === 'overdue'"
        role="listitem"
        [attr.aria-label]="loc_ui_tern_en_retard_e9139f + summary.overdue + ', ' + summary.overduePct + loc_ui_tern_pour_cent_8f8638"
        (click)="onChip('overdue')">
        <span class="proj-tasks-status-chip__label" i18n="@@projects.components.en.retard.40c1dde3">En retard</span>
        <strong class="proj-tasks-status-chip__value">{{ summary.overdue }}</strong>
        <span class="proj-tasks-status-chip__pct">{{ summary.overduePct }} %</span>
      </button>
    </div>
  `
})
export class ProjectTaskKpiRowComponent {
  readonly loc_ui_tern_total_00dda8 = $localize`:@@ui.tern.total.00dda8:Total `;
  readonly loc_ui_tern_taches_20fef1 = $localize`:@@ui.tern.taches.20fef1: tâches`;
  readonly loc_ui_tern_a_faire_5268a2 = $localize`:@@ui.tern.a.faire.5268a2:À faire `;
  readonly loc_ui_tern_pour_cent_8f8638 = $localize`:@@ui.tern.pour.cent.8f8638: pour cent`;
  readonly loc_ui_tern_terminees_486f0e = $localize`:@@ui.tern.terminees.486f0e:Terminées `;
  readonly loc_ui_tern_en_cours_494671 = $localize`:@@ui.tern.en.cours.494671:En cours `;
  readonly loc_ui_tern_en_attente_b9cac2 = $localize`:@@ui.tern.en.attente.b9cac2:En attente `;
  readonly loc_ui_tern_en_retard_e9139f = $localize`:@@ui.tern.en.retard.e9139f:En retard `;
  @Input() tasks: ProjectTask[] = [];
  @Input() activeChip: TaskStatusChipKey | null = null;

  @Output() chipClick = new EventEmitter<{
    chip: TaskStatusChipKey;
    status: ProjectTaskStatusCode | null;
    dueFilter: TaskDueFilterKey | null;
  }>();

  get summary() {
    return computeRootTaskStatusSummary(this.tasks);
  }

  onChip(chip: TaskStatusChipKey): void {
    if (chip === 'total') {
      this.chipClick.emit({ chip, status: null, dueFilter: null });
      return;
    }
    if (chip === 'todo') {
      this.chipClick.emit({ chip, status: 'Todo', dueFilter: null });
      return;
    }
    if (chip === 'done') {
      this.chipClick.emit({ chip, status: 'Done', dueFilter: null });
      return;
    }
    if (chip === 'inProgress') {
      this.chipClick.emit({ chip, status: 'InProgress', dueFilter: null });
      return;
    }
    if (chip === 'waiting') {
      this.chipClick.emit({ chip, status: 'Waiting', dueFilter: null });
      return;
    }
    this.chipClick.emit({ chip, status: null, dueFilter: 'overdue' });
  }
}
