import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProgressBarModule } from 'primeng/progressbar';
import { ProjectActivity, ProjectBudget, ProjectDetail, ProjectTask } from '../project-api.service';
import {
  budgetUsedPercent,
  countOpenTasks,
  countTotalTasksForProgress,
  formatDaysUntilDue,
  upcomingTasks
} from '../project-detail.vm';

@Component({
  selector: 'app-project-summary-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, ProgressBarModule],
  template: `
    @if (project) {
      <aside class="proj-sidebar-panel">
        <section class="proj-sidebar-section">
          <h3 class="proj-sidebar-title" i18n="@@projects.components.resume.du.projet.56ccc4ab">Résumé du projet</h3>
          @if (budget) {
            <div class="proj-sidebar-budget">
              <span class="proj-sidebar-label" i18n="@@projects.components.budget.total.b930ffdc">Budget total</span>
              <strong>{{ budget.budgetHt | number:'1.3-3' }} {{ project.currency }}</strong>
              @if (budget.budgetHt > 0) {
                <p-progressBar [value]="budgetUsedPercentValue" [showValue]="false" styleClass="mt-2" />
                <span class="text-sm text-color-secondary">{{ budgetUsedPercentValue }} % consommé</span>
              }
            </div>
            <dl class="proj-sidebar-dl">
              <dt i18n="@@projects.components.heures.saisies.882ec4a1">Heures saisies</dt>
              <dd>{{ budget.loggedHours | number:'1.0-1' }} h</dd>
              <dt i18n="@@projects.components.a.facturer.acd40e67">À facturer</dt>
              <dd>{{ budget.billableUninvoicedHours | number:'1.0-1' }} h</dd>
            </dl>
          }
        </section>

        <section class="proj-sidebar-section">
          <h3 class="proj-sidebar-title" i18n="@@projects.components.prochaines.echeances.69960f97">Prochaines échéances</h3>
          @if (upcoming.length) {
            <ul class="proj-sidebar-list">
              @for (t of upcoming; track t.id) {
                <li>
                  <a [routerLink]="['/projects', project.id, 'tasks', t.id]">{{ t.title }}</a>
                  <span [class.text-danger]="t.isOverdue">
                    {{ t.dueDate ? (t.dueDate | date:'shortDate') : '—' }}
                    @if (daysLeft(t.dueDate); as label) {
                      · {{ label }}
                    }
                  </span>
                </li>
              }
            </ul>
          } @else {
            <p class="text-sm text-color-secondary m-0" i18n="@@projects.components.aucune.echeance.a.venir.2c15f4e9">Aucune échéance à venir.</p>
          }
        </section>

        <section class="proj-sidebar-section">
          <h3 class="proj-sidebar-title" i18n="@@projects.components.activite.recente.524eaf8e">Activité récente</h3>
          @if (activities.length) {
            <ul class="proj-sidebar-activity">
              @for (a of activities.slice(0, 5); track a.id) {
                <li>
                  <span class="proj-sidebar-activity-msg">{{ a.message }}</span>
                  <time>{{ a.createdAt | date:'short' }}</time>
                </li>
              }
            </ul>
          } @else {
            <p class="text-sm text-color-secondary m-0" i18n="@@projects.components.aucune.activite.7407727b">Aucune activité.</p>
          }
        </section>
      </aside>
    }
  `
})
export class ProjectSummarySidebarComponent {
  @Input() project: ProjectDetail | null = null;
  @Input() budget: ProjectBudget | null = null;
  @Input() tasks: ProjectTask[] = [];
  @Input() activities: ProjectActivity[] = [];

  get budgetUsedPercentValue(): number {
    return budgetUsedPercent(this.budget, this.project?.budgetHt ?? 0);
  }

  get upcoming(): ProjectTask[] {
    return upcomingTasks(this.tasks);
  }

  daysLeft(dueDate: string | null | undefined): string | null {
    return formatDaysUntilDue(dueDate);
  }
}
