import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DashboardPanelComponent } from '@shared/components/dashboard/dashboard-panel.component';
import { ProjectDashboardExtended } from '../project-api.service';
import {
  daysUntilDue,
  initialsFromName,
  taskPriorityColor,
  taskPriorityIcon
} from '../project-enums';

@Component({
  selector: 'app-project-dashboard-sidebar',
  standalone: true,
  imports: [BackendLabelPipe, CommonModule, RouterLink, DashboardPanelComponent],
  template: `
    @if (data) {
      <div class="proj-dash-sidebar">
        <app-dashboard-panel title="Tâches à venir" i18n-title="Tâches à venir">
          @if (data.upcomingTasks.length) {
            <ul class="proj-dash-task-list">
              @for (t of data.upcomingTasks; track t.id) {
                <li class="proj-dash-task-item">
                  <span class="proj-dash-task-icon" [style.color]="priorityColor(t.priority)">
                    <i [class]="priorityIcon(t.priority)" aria-hidden="true"></i>
                  </span>
                  <div class="proj-dash-task-body">
                    <a [routerLink]="['/projects', t.projectId, 'tasks', t.id]">{{ t.title }}</a>
                    <span class="proj-dash-task-project">{{ t.projectName }}</span>
                  </div>
                  <span class="proj-dash-task-due" [class.proj-dash-task-due--urgent]="isDueUrgent(t)">
                    {{ t.dueDate | date:'shortDate' }}
                  </span>
                </li>
              }
            </ul>
          } @else {
            <p class="text-sm text-color-secondary m-0" i18n="@@projects.components.aucune.echeance.248d93b0">Aucune échéance.</p>
          }
        </app-dashboard-panel>

        <app-dashboard-panel title="Membres actifs" i18n-title="Membres actifs">
          @if (data.activeMembers.length) {
            <ul class="proj-dash-member-list">
              @for (m of data.activeMembers; track m.userId) {
                <li class="proj-dash-member-item">
                  <span class="proj-avatar">{{ initials(m.displayName) }}</span>
                  <div class="proj-dash-member-body">
                    <strong>{{ m.displayName }}</strong>
                    @if (m.roleDisplay) {
                      <span class="proj-dash-member-role">{{ m.roleDisplay | backendLabel }}</span>
                    }
                  </div>
                  <span
                    class="proj-dash-status-dot"
                    [class.proj-dash-status-dot--online]="m.activityStatus === 'online'"
                    [class.proj-dash-status-dot--away]="m.activityStatus === 'away'"
                    [attr.title]="activityLabel(m.activityStatus)"
                    [attr.aria-label]="activityLabel(m.activityStatus)"></span>
                </li>
              }
            </ul>
          } @else {
            <p class="text-sm text-color-secondary m-0" i18n="@@projects.components.aucune.activite.recente.58d9c15c">Aucune activité récente.</p>
          }
        </app-dashboard-panel>
      </div>
    }
  `
})
export class ProjectDashboardSidebarComponent {
  @Input() data: ProjectDashboardExtended | null = null;

  readonly initials = initialsFromName;
  readonly priorityIcon = taskPriorityIcon;
  readonly priorityColor = taskPriorityColor;

  isDueUrgent(t: { dueDate?: string | null; isOverdue: boolean }): boolean {
    if (t.isOverdue) return true;
    const days = daysUntilDue(t.dueDate);
    return days != null && days <= 3;
  }

  activityLabel(status: string | undefined): string {
    if (status === 'online') return 'Actif récemment';
    if (status === 'away') return 'Actif cette semaine';
    return 'Inactif';
  }
}
