import { Component, Input } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ProgressBarModule } from 'primeng/progressbar';
import { ProjectBudget, ProjectDetail, ProjectTask } from '../../project-api.service';
import {
  budgetUsedPercent,
  countOpenTasks,
  countTotalTasksForProgress,
  formatDaysUntilDue
} from '../../project-detail.vm';

@Component({
  selector: 'app-project-overview-summary-card',
  standalone: true,
  imports: [CommonModule, DatePipe, ProgressBarModule],
  template: `
    @if (project) {
      <section class="proj-detail-card proj-detail-card--summary">
        <h3 class="proj-detail-card__title" i18n="@@projects.components.resume.du.projet.56ccc4ab">Résumé du projet</h3>
        <ul class="proj-detail-summary-list">
          <li>
            <span i18n="@@projects.components.budget.total.b930ffdc">Budget total</span>
            <strong>{{ (budget?.budgetHt ?? project.budgetHt) | number:'1.3-3' }} {{ project.currency }}</strong>
          </li>
          @if (budget && budget.budgetHt > 0) {
            <li class="proj-detail-summary-list__bar">
              <p-progressBar [value]="usedPercent" [showValue]="false" />
              <span i18n="@@projects.components.consomme.3f287fa0">{{ usedPercent }} % consommé</span>
            </li>
          }
          <li>
            <span i18n="@@projects.components.heures.saisies.882ec4a1">Heures saisies</span>
            <strong>{{ budget?.loggedHours ?? 0 | number:'1.0-1' }} h</strong>
          </li>
          <li>
            <span i18n="@@projects.components.a.facturer.acd40e67">À facturer</span>
            <strong>{{ budget?.billableUninvoicedHours ?? 0 | number:'1.0-1' }} h</strong>
          </li>
          <li>
            <span i18n="@@projects.components.taches.ouvertes.639d6d23">Tâches ouvertes</span>
            <strong>{{ openCount }} / {{ totalCount }}</strong>
          </li>
          @if (project.endDate) {
            <li>
              <span i18n="@@projects.components.echeance.f9a77ff6">Échéance</span>
              <strong>{{ project.endDate | date:'shortDate' }}</strong>
              @if (dueLabel) {
                <small>{{ dueLabel }}</small>
              }
            </li>
          }
        </ul>
      </section>
    }
  `
})
export class ProjectOverviewSummaryCardComponent {
  @Input() project: ProjectDetail | null = null;
  @Input() budget: ProjectBudget | null = null;
  @Input() tasks: ProjectTask[] = [];

  get usedPercent(): number {
    return budgetUsedPercent(this.budget, this.project?.budgetHt ?? 0);
  }

  get openCount(): number {
    return countOpenTasks(this.tasks);
  }

  get totalCount(): number {
    return countTotalTasksForProgress(this.tasks);
  }

  get dueLabel(): string | null {
    return formatDaysUntilDue(this.project?.endDate);
  }
}
