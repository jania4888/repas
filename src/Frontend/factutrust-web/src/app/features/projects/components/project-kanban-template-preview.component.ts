import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectKindCode, defaultKanbanColumnsForKind } from '../project-enums';

@Component({
  selector: 'app-project-kanban-template-preview',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="proj-template-preview">
      <div class="proj-template-preview__legend text-sm text-color-secondary mb-2" i18n="@@projects.components.colonnes.kanban.creees.automatiquement.pour.ce.t.7a57ed77"> Colonnes Kanban créées automatiquement pour ce type de projet. </div>
      <div class="proj-kanban proj-kanban--preview">
        @for (col of columns; track col.order) {
          <div class="proj-kanban-col">
            <h3 class="proj-kanban-col-title" [style.border-top-color]="col.color">{{ col.name }}</h3>
            <div class="proj-kanban-card proj-kanban-card--placeholder"></div>
            <div class="proj-kanban-card proj-kanban-card--placeholder proj-kanban-card--short"></div>
          </div>
        }
      </div>
    </div>
  `
})
export class ProjectKanbanTemplatePreviewComponent {
  @Input({ required: true }) kind!: ProjectKindCode | number | string;

  get columns() {
    return defaultKanbanColumnsForKind(this.kind);
  }
}
