import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ProjectDashboardSearchComponent } from './project-dashboard-search.component';

@Component({
  selector: 'app-project-dashboard-hero',
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonComponent, ProjectDashboardSearchComponent],
  template: `
    <div class="proj-dash-hero">
      <div class="proj-dash-hero__text">
        <h1 class="proj-dash-hero__title">{{ greeting }}</h1>
        <p class="proj-dash-hero__subtitle" i18n="@@projects.components.voici.l.avancement.de.vos.projets.bb8da1a7">Voici l'avancement de vos projets.</p>
      </div>
      <div class="proj-dash-hero__actions">
        <app-project-dashboard-search />
        @if (canCreate) {
          <app-button variant="primary" icon="pi-plus" routerLink="/projects" i18n="@@projects.components.nouveau.projet.29f05663">Nouveau projet</app-button>
        }
        <app-button variant="outline" routerLink="/projects" i18n="@@projects.components.liste.des.projets.7f394c5f">Liste des projets</app-button>
      </div>
    </div>
  `
})
export class ProjectDashboardHeroComponent {
  @Input() greeting = 'Bonjour !';
  @Input() canCreate = false;
}
