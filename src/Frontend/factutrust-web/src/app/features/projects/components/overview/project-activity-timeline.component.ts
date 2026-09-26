import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectActivity, ProjectAssignableUser } from '../../project-api.service';
import {
  activityVisual,
  formatTimeAgoFr,
  resolveActivityActorName
} from '../../project-detail.vm';

@Component({
  selector: 'app-project-activity-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="proj-detail-card" [class.proj-detail-card--timeline]="compact">
      @if (showTitle) {
        <h3 class="proj-detail-card__title">{{ title }}</h3>
      }
      @if (displayItems.length) {
        <ul class="proj-detail-timeline">
          @for (a of displayItems; track a.id) {
            <li>
              <span class="proj-detail-timeline__icon" [style.color]="visual(a.type).color">
                <i class="pi" [ngClass]="visual(a.type).icon"></i>
              </span>
              <div class="proj-detail-timeline__body">
                <p class="proj-detail-timeline__msg">{{ a.message }}</p>
                <span class="proj-detail-timeline__meta">
                  @if (actor(a); as name) {
                    <strong>{{ name }}</strong> ·
                  }
                  <time>{{ formatTimeAgoFr(a.createdAt) }}</time>
                </span>
              </div>
            </li>
          }
        </ul>
        @if (compact && activities.length > limit) {
          <button type="button" class="proj-detail-link proj-detail-link--block" (click)="viewAll.emit()" i18n="@@projects.components.voir.toute.l.activite.f006b3ea">Voir toute l'activité →</button>
        }
      } @else {
        <p class="proj-detail-card__desc proj-detail-card__desc--muted" i18n="@@projects.components.aucune.activite.pour.l.instant.c875fc7a">Aucune activité pour l'instant.</p>
      }
    </section>
  `
})
export class ProjectActivityTimelineComponent {
  @Input() activities: ProjectActivity[] = [];
  @Input() users: ProjectAssignableUser[] = [];
  @Input() limit = 5;
  @Input() compact = false;
  @Input() showTitle = true;
  @Input() title = 'Activité récente';
  @Output() viewAll = new EventEmitter<void>();

  readonly visual = activityVisual;
  readonly formatTimeAgoFr = formatTimeAgoFr;

  get displayItems(): ProjectActivity[] {
    return this.compact ? this.activities.slice(0, this.limit) : this.activities;
  }

  actor(a: ProjectActivity): string | null {
    return resolveActivityActorName(a, this.users);
  }
}
