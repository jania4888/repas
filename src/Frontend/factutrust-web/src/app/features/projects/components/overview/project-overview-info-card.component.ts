import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, Input } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ProjectDetail } from '../../project-api.service';
import { initialsFromName, isBtp } from '../../project-enums';

@Component({
  selector: 'app-project-overview-info-card',
  standalone: true,
  imports: [BackendLabelPipe, CommonModule, DatePipe],
  template: `
    @if (project) {
      <section class="proj-detail-card">
        <h3 class="proj-detail-card__title" i18n="@@projects.components.informations.generales.be6ba6e5">Informations générales</h3>
        <dl class="proj-detail-dl">
          <dt i18n="@@projects.components.client.1bdd79b1">Client</dt>
          <dd>{{ project.clientName }}</dd>
          <dt i18n="@@projects.components.chef.de.projet.7a1d6008">Chef de projet</dt>
          <dd class="proj-detail-dl__person">
            @if (project.ownerUserName) {
              <span class="proj-avatar">{{ initials(project.ownerUserName) }}</span>
              {{ project.ownerUserName }}
            } @else {
              —
            }
          </dd>
          <dt i18n="@@projects.components.type.3deb7456">Type</dt>
          <dd>{{ project.kindDisplay | backendLabel }}</dd>
          <dt i18n="@@projects.components.facturation.04716c6b">Facturation</dt>
          <dd>{{ project.billingModeDisplay | backendLabel }}</dd>
          <dt i18n="@@projects.components.devise.eb2e42c4">Devise</dt>
          <dd>{{ project.currency }}</dd>
          <dt i18n="@@projects.components.periode.de2110b7">Période</dt>
          <dd>
            {{ project.startDate ? (project.startDate | date:'shortDate') : '—' }}
            → {{ project.endDate ? (project.endDate | date:'shortDate') : '—' }}
          </dd>
          @if (isBtp(project.kind)) {
            <dt i18n="@@projects.components.chantier.3847afdb">Chantier</dt>
            <dd>{{ project.siteAddress || '—' }}</dd>
            <dt i18n="@@projects.components.n.marche.6eb7d3b6">N° marché</dt>
            <dd>{{ project.contractNumber || '—' }}</dd>
          }
        </dl>
        @if (project.description) {
          <p class="proj-detail-card__desc">{{ project.description }}</p>
        } @else {
          <p class="proj-detail-card__desc proj-detail-card__desc--muted" i18n="@@projects.components.pas.de.description.e0780fd2">Pas de description.</p>
        }
      </section>
    }
  `
})
export class ProjectOverviewInfoCardComponent {
  @Input() project: ProjectDetail | null = null;
  readonly initials = initialsFromName;
  readonly isBtp = isBtp;
}
