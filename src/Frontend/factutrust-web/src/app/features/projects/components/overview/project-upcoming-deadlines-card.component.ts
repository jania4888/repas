import { Component, Input } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProjectDetail, ProjectTask } from '../../project-api.service';
import { formatDaysUntilDue, upcomingTasks } from '../../project-detail.vm';

@Component({
  selector: 'app-project-upcoming-deadlines-card',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink],
  template: `
    @if (project) {
      <section class="proj-detail-card">
        <h3 class="proj-detail-card__title" i18n="@@projects.components.prochaines.echeances.69960f97">Prochaines échéances</h3>
        @if (items.length) {
          <ul class="proj-detail-deadlines">
            @for (t of items; track t.id) {
              <li>
                <span class="proj-detail-deadlines__icon"><i class="pi pi-calendar"></i></span>
                <div>
                  <a [routerLink]="['/projects', project.id, 'tasks', t.id]">{{ t.title }}</a>
                  <span>{{ t.dueDate | date:'shortDate' }}</span>
                </div>
                @if (relative(t.dueDate); as rel) {
                  <span class="proj-detail-deadlines__rel" [class.proj-detail-deadlines__rel--late]="t.isOverdue">{{ rel }}</span>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="proj-detail-card__desc proj-detail-card__desc--muted" i18n="@@projects.components.aucune.echeance.a.venir.2c15f4e9">Aucune échéance à venir.</p>
        }
      </section>
    }
  `
})
export class ProjectUpcomingDeadlinesCardComponent {
  @Input() project: ProjectDetail | null = null;
  @Input() tasks: ProjectTask[] = [];

  get items(): ProjectTask[] {
    return upcomingTasks(this.tasks);
  }

  relative(dueDate: string | null | undefined): string | null {
    return formatDaysUntilDue(dueDate);
  }
}
