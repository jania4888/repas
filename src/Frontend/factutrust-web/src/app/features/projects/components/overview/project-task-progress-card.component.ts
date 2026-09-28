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
        <div class="proj-detail-task-bar" role="img" [attr.aria-label]="loc_ui_tern_avancement_des_taches_a384a2 + breakdown.total + loc_ui_tern_au_total_4472e5">
          @if (breakdown.done > 0) {
            <span class="seg seg--done" [style.flex]="breakdown.done" [title]="loc_ui_tern_terminees_519a63 + breakdown.done"></span>
          }
          @if (breakdown.inProgress > 0) {
            <span class="seg seg--progress" [style.flex]="breakdown.inProgress" [title]="loc_ui_tern_en_cours_1e028d + breakdown.inProgress"></span>
          }
          @if (breakdown.waiting > 0) {
            <span class="seg seg--waiting" [style.flex]="breakdown.waiting" [title]="loc_ui_tern_en_attente_6fb786 + breakdown.waiting"></span>
          }
          @if (breakdown.overdue > 0) {
            <span class="seg seg--overdue" [style.flex]="breakdown.overdue" [title]="loc_ui_tern_en_retard_fb64f5 + breakdown.overdue"></span>
          }
          @if (breakdown.todo > 0) {
            <span class="seg seg--todo" [style.flex]="breakdown.todo" [title]="loc_ui_tern_a_faire_802f46 + breakdown.todo"></span>
          }
        </div>
        <ul class="proj-detail-task-legend">
          <li i18n="@@projects.components.a.faire.68be8950"><span class="dot dot--todo"></span> À faire <strong>{{ breakdown.todo }}</strong></li>
          <li i18n="@@projects.components.terminees.eb847074"><span class="dot dot--done"></span> Terminées <strong>{{ breakdown.done }}</strong></li>
          <li i18n="@@projects.components.en.cours.e3eac576"><span class="dot dot--progress"></span> En cours <strong>{{ breakdown.inProgress }}</strong></li>
          <li i18n="@@projects.components.en.attente.98484715"><span class="dot dot--waiting"></span> En attente <strong>{{ breakdown.waiting }}</strong></li>
          <li i18n="@@projects.components.en.retard.e99e239a"><span class="dot dot--overdue"></span> En retard <strong>{{ breakdown.overdue }}</strong></li>
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
  readonly loc_ui_tern_avancement_des_taches_a384a2 = $localize`:@@ui.tern.avancement.des.taches.a384a2:Avancement des tâches, `;
  readonly loc_ui_tern_au_total_4472e5 = $localize`:@@ui.tern.au.total.4472e5: au total`;
  readonly loc_ui_tern_terminees_519a63 = $localize`:@@ui.tern.terminees.519a63:Terminées: `;
  readonly loc_ui_tern_en_cours_1e028d = $localize`:@@ui.tern.en.cours.1e028d:En cours: `;
  readonly loc_ui_tern_en_attente_6fb786 = $localize`:@@ui.tern.en.attente.6fb786:En attente: `;
  readonly loc_ui_tern_en_retard_fb64f5 = $localize`:@@ui.tern.en.retard.fb64f5:En retard: `;
  readonly loc_ui_tern_a_faire_802f46 = $localize`:@@ui.tern.a.faire.802f46:À faire: `;
  @Input() tasks: ProjectTask[] = [];

  get breakdown() {
    return computeTaskStatusBreakdown(this.tasks);
  }
}
