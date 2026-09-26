import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectTask } from '../../project-api.service';
import { computeTaskStatusBreakdown } from '../../project-detail.vm';

@Component({
  selector: 'app-project-task-progress-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="proj-detail-card">
      <h3 class="proj-detail-card__title" i18n="@@projects.components.avancement.des.taches.9ed226b4">Avancement des tâches</h3>
      @if (breakdown.total > 0) {
        <div class="proj-detail-task-bar" role="img" [attr.aria-label]="'Avancement des tâches, ' + breakdown.total + ' au total'">
          @if (breakdown.done > 0) {
            <span class="seg seg--done" [style.flex]="breakdown.done" [title]="'Terminées: ' + breakdown.done"></span>
          }
          @if (breakdown.inProgress > 0) {
            <span class="seg seg--progress" [style.flex]="breakdown.inProgress" [title]="'En cours: ' + breakdown.inProgress"></span>
          }
          @if (breakdown.waiting > 0) {
            <span class="seg seg--waiting" [style.flex]="breakdown.waiting" [title]="'En attente: ' + breakdown.waiting"></span>
          }
          @if (breakdown.overdue > 0) {
            <span class="seg seg--overdue" [style.flex]="breakdown.overdue" [title]="'En retard: ' + breakdown.overdue"></span>
          }
          @if (breakdown.todo > 0) {
            <span class="seg seg--todo" [style.flex]="breakdown.todo" [title]="'À faire: ' + breakdown.todo"></span>
          }
        </div>
        <ul class="proj-detail-task-legend">
          <li><span class="dot dot--todo"></span> À faire <strong>{{ breakdown.todo }}</strong></li>
          <li><span class="dot dot--done"></span> Terminées <strong>{{ breakdown.done }}</strong></li>
          <li><span class="dot dot--progress"></span> En cours <strong>{{ breakdown.inProgress }}</strong></li>
          <li><span class="dot dot--waiting"></span> En attente <strong>{{ breakdown.waiting }}</strong></li>
          <li><span class="dot dot--overdue"></span> En retard <strong>{{ breakdown.overdue }}</strong></li>
        </ul>
        <div class="proj-detail-task-total">
          <span i18n="@@projects.components.total.b25928c6">Total</span>
          <strong>{{ breakdown.total }}</strong>
        </div>
      } @else {
        <p class="proj-detail-card__desc proj-detail-card__desc--muted" i18n="@@projects.components.aucune.tache.sur.ce.projet.73db24a7">Aucune tâche sur ce projet.</p>
      }
    </section>
  `
})
export class ProjectTaskProgressCardComponent {
  @Input() tasks: ProjectTask[] = [];

  get breakdown() {
    return computeTaskStatusBreakdown(this.tasks);
  }
}
