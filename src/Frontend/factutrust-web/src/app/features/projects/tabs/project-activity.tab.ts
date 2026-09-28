import { Component, Input } from '@angular/core';
import { ProjectActivity, ProjectAssignableUser } from '../project-api.service';
import { ProjectActivityTimelineComponent } from '../components/overview/project-activity-timeline.component';

@Component({
  selector: 'app-project-activity-tab',
  standalone: true,
  imports: [ProjectActivityTimelineComponent],
  template: `
    <app-project-activity-timeline
      [activities]="activities"
      [users]="users"
      [compact]="false"
      [limit]="100"
      title="Historique d'activité" i18n-title="@@projects.tabs.historique.d.activite.2c445950" />
  `
})
export class ProjectActivityTabComponent {
  @Input() activities: ProjectActivity[] = [];
  @Input() users: ProjectAssignableUser[] = [];
}
