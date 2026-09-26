import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectMember } from '../../project-api.service';
import { initialsFromName } from '../../project-enums';
import { isManagerRole, previewTeamMembers } from '../../project-detail.vm';

@Component({
  selector: 'app-project-team-preview-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="proj-detail-card">
      <h3 class="proj-detail-card__title" i18n="@@projects.components.equipe.du.projet.5903aa75">Équipe du projet</h3>
      @if (preview.length) {
        <ul class="proj-detail-team-list">
          @for (m of preview; track m.id) {
            <li>
              <span class="proj-avatar">{{ initials(m.userName) }}</span>
              <div class="proj-detail-team-list__info">
                <strong>{{ m.userName }}</strong>
                <span>{{ m.roleDisplay }}</span>
              </div>
              <span class="proj-detail-team-badge" [class.proj-detail-team-badge--lead]="isManager(m.role)">
                {{ isManager(m.role) ? 'Chef' : 'Membre' }}
              </span>
            </li>
          }
        </ul>
        <button type="button" class="proj-detail-link" (click)="viewTeam.emit()" i18n="@@projects.components.voir.l.equipe.fa7cc8b0">Voir l'équipe →</button>
      } @else {
        <p class="proj-detail-card__desc proj-detail-card__desc--muted" i18n="@@projects.components.aucun.membre.assigne.614fbe24">Aucun membre assigné.</p>
      }
    </section>
  `
})
export class ProjectTeamPreviewCardComponent {
  @Input() members: ProjectMember[] = [];
  @Output() viewTeam = new EventEmitter<void>();

  readonly initials = initialsFromName;
  readonly isManager = isManagerRole;

  get preview(): ProjectMember[] {
    return previewTeamMembers(this.members);
  }
}
