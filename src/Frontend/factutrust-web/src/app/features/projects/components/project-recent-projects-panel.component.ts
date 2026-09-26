import { Component, Input, ViewChild, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ProgressBarModule } from 'primeng/progressbar';
import { Menu, MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { DashboardPanelComponent } from '@shared/components/dashboard/dashboard-panel.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ProjectDashboardExtended, ProjectRecentRow } from '../project-api.service';
import {
  initialsFromName,
  projectKindAccentColor,
  projectStatusBadge
} from '../project-enums';

@Component({
  selector: 'app-project-recent-projects-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TableModule,
    ProgressBarModule,
    MenuModule,
    DashboardPanelComponent,
    StatusBadgeComponent,
    EmptyStateComponent
  ],
  template: `
    <app-dashboard-panel title="Projets récents" i18n-title="Projets récents" [subtitle]="tableSubtitle()" [flush]="true">
      <div panel-actions class="proj-dash-table-search">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input
          type="search"
          [(ngModel)]="searchQuery"
          placeholder="Rechercher…" i18n-placeholder="Rechercher…"
          aria-label="Rechercher dans les projets récents" i18n-aria-label="Rechercher dans les projets récents" />
      </div>

      <p-table
        [value]="filteredRows()"
        styleClass="p-datatable-sm proj-dash-table"
        [rowHover]="true"
        [paginator]="filteredRows().length > rowsPerPage"
        [rows]="rowsPerPage"
        [showCurrentPageReport]="true"
        currentPageReportTemplate="Afficher {first} à {last} sur {totalRecords} projets">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@projects.components.projet.a9de3a26">Projet</th>
            <th i18n="@@projects.components.client.1bdd79b1">Client</th>
            <th i18n="@@projects.components.chef.de.projet.7a1d6008">Chef de projet</th>
            <th i18n="@@projects.components.avancement.e1963fc4">Avancement</th>
            <th i18n="@@projects.components.statut.659499f3">Statut</th>
            <th i18n="@@projects.components.echeance.f9a77ff6">Échéance</th>
            <th class="proj-dash-actions-col"></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-p>
          <tr class="proj-row-click" [routerLink]="['/projects', p.id]">
            <td>
              <div class="proj-dash-project-cell">
                <span class="proj-dash-project-icon" [style.background]="kindColor(p.kind)">
                  {{ projectInitial(p.name) }}
                </span>
                <div>
                  <strong>{{ p.name }}</strong>
                  @if (p.description) {
                    <span class="proj-dash-project-desc">{{ p.description }}</span>
                  } @else if (p.kindDisplay) {
                    <span class="proj-dash-project-desc">{{ p.kindDisplay }}</span>
                  }
                </div>
              </div>
            </td>
            <td>{{ p.clientName }}</td>
            <td>
              @if (p.ownerUserName) {
                <span class="proj-avatar">{{ initials(p.ownerUserName) }}</span>
                {{ p.ownerUserName }}
              } @else { — }
            </td>
            <td class="proj-dash-progress-col">
              <p-progressBar [value]="p.progressPercent" [showValue]="false" />
              <span class="proj-dash-progress-pct">{{ p.progressPercent }} %</span>
            </td>
            <td><app-status-badge [status]="statusBadge(p.status)" [label]="p.statusDisplay" /></td>
            <td>{{ p.endDate ? (p.endDate | date:'shortDate') : '—' }}</td>
            <td class="proj-dash-actions-col" (click)="$event.stopPropagation()">
              <button
                type="button"
                class="proj-dash-row-menu-btn"
                [attr.aria-label]="'Actions pour ' + p.name"
                (click)="onMenuClick($event, p)">
                <i class="pi pi-ellipsis-v"></i>
              </button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="7">
              <app-empty-state icon="pi-briefcase" title="Aucun projet" i18n-title="Aucun projet" [showAction]="false" />
            </td>
          </tr>
        </ng-template>
      </p-table>
      <p-menu #rowMenu [popup]="true" [model]="menuItems()" appendTo="body" />
    </app-dashboard-panel>
  `
})
export class ProjectRecentProjectsPanelComponent {
  @ViewChild('rowMenu') rowMenu?: Menu;

  @Input() data: ProjectDashboardExtended | null = null;
  readonly rowsPerPage = 5;

  searchQuery = '';
  private readonly activeRow = signal<ProjectRecentRow | null>(null);

  readonly statusBadge = projectStatusBadge;
  readonly initials = initialsFromName;
  readonly kindColor = projectKindAccentColor;

  filteredRows = computed(() => {
    const rows = this.data?.recentProjects ?? [];
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(p =>
      p.name.toLowerCase().includes(q)
      || p.clientName.toLowerCase().includes(q)
      || (p.ownerUserName?.toLowerCase().includes(q) ?? false)
      || (p.description?.toLowerCase().includes(q) ?? false));
  });

  tableSubtitle(): string | undefined {
    const total = this.data?.totalProjects;
    return total != null ? `${total} projet(s) au total` : undefined;
  }

  projectInitial(name: string): string {
    return name?.trim()?.[0]?.toUpperCase() ?? '?';
  }

  onMenuClick(event: Event, row: ProjectRecentRow): void {
    event.preventDefault();
    event.stopPropagation();
    this.activeRow.set(row);
    this.rowMenu?.toggle(event);
  }

  menuItems = computed((): MenuItem[] => {
    const p = this.activeRow();
    if (!p) return [];
    return [
      { label: 'Voir le projet', icon: 'pi pi-eye', routerLink: ['/projects', p.id] },
      { label: 'Tâches', icon: 'pi pi-list', routerLink: ['/projects', p.id], fragment: 'tasks' },
      { label: 'Liste des projets', icon: 'pi pi-briefcase', routerLink: ['/projects'] }
    ];
  });
}
