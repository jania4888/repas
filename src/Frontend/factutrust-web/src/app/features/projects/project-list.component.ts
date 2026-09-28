/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, take } from 'rxjs/operators';
import { MenuItem } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { ProgressBarModule } from 'primeng/progressbar';
import { Textarea } from 'primeng/textarea';
import { Menu, MenuModule } from 'primeng/menu';
import { PopoverModule } from 'primeng/popover';
import { CheckboxModule } from 'primeng/checkbox';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonColumn, SkeletonTableComponent } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ClientService, ClientListItem } from '@core/services/client.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { applyProjectListFiltersFromQuery } from '@core/utils/list-filter-from-query';
import {
  ProjectApiService,
  ProjectAssignableUser,
  ProjectDashboard,
  ProjectDashboardExtended,
  ProjectListItem,
  UpsertProjectPayload
} from './project-api.service';
import {
  PROJECT_BILLING_OPTIONS,
  PROJECT_KIND_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  ProjectKindCode,
  billingOptionsForKind,
  defaultBillingForKind,
  formatDaysUntilDue,
  initialsFromName,
  isBtp,
  projectKindAccentColor,
  projectKindPillClass,
  projectStatusBadge,
  toIsoDate
} from './project-enums';
import { ProjectKanbanTemplatePreviewComponent } from './components/project-kanban-template-preview.component';
import { ProjectListKpiRowComponent } from './components/project-list-kpi-row.component';
import { ProjectFavoritesService } from './project-favorites.service';

const KIND_CARD_HINTS: Record<ProjectKindCode, string> = {
  Generic: $localize`:@@projects.project-list.ts.affaires.generales.cf7cec05:Affaires générales`,
  Esn: $localize`:@@projects.project-list.ts.missions.regie.f9bc89f2:Missions & régie`,
  Btp: 'Chantiers BTP'
};

@Component({
  selector: 'app-project-list',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    FormsModule,
    RouterLink,
    TableModule,
    DialogModule,
    SelectModule,
    InputTextModule,
    InputNumberModule,
    DatePickerModule,
    Textarea,
    MenuModule,
    PopoverModule,
    CheckboxModule,
    PageHeaderComponent,
    ButtonComponent,
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    StatusBadgeComponent,
    FormSectionComponent,
    ProjectKanbanTemplatePreviewComponent,
    ProjectListKpiRowComponent,
    ProgressBarModule
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Projets" i18n-title="@@projects.project-list.projets.b1e8cd4d"
      subtitle="Affaires, chantiers et missions" i18n-subtitle="@@projects.project-list.affaires.chantiers.et.missions.5344cbce"
      hint="Affaires, chantiers ESN et missions BTP : suivez avancement, tâches et heures à facturer." i18n-hint="@@projects.project-list.affaires.chantiers.esn.et.missions.btp.s.645f358b">
      <p-menu #exportMenu [popup]="true" [model]="exportMenuItems" appendTo="body" />
      <app-button
        variant="secondary"
        icon="pi-download"
        iconPos="left"
        type="button"
        [disabled]="exporting()"
        (click)="exportMenu.toggle($event)"
        ariaLabel="Exporter la liste des projets" i18n-ariaLabel="@@projects.project-list.exporter.la.liste.des.projets.33c176f5" i18n="@@projects.project-list.exporter.0cd84bdc"> Exporter </app-button>
      <a routerLink="/projects/dashboard" class="p-button p-button-outlined p-button-sm" i18n="@@projects.project-list.tableau.de.bord.cb1cc88a">
        <i class="pi pi-chart-bar" aria-hidden="true"></i> Tableau de bord
      </a>
      @if (canCreate) {
        <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openCreate()" i18n="@@projects.project-list.nouveau.projet.29f05663">Nouveau projet</app-button>
      }
    </app-page-header>

    <app-project-list-kpi-row
      [extended]="dashboardExtended()"
      [basic]="dashboardBasic()"
      (overdueFilter)="applyOverdueFilter()" />

    <div class="ft-filters proj-list-filters">
      <div class="ft-filters__row proj-list-filters__row">
        <span class="p-input-icon-left proj-list-search">
          <i class="pi pi-search"></i>
          <input
            pInputText
            type="search"
            placeholder="Rechercher un projet…" i18n-placeholder="@@projects.project-list.rechercher.un.projet.9923387b"
            [(ngModel)]="search"
            (ngModelChange)="onSearch($event)"
            aria-label="Rechercher un projet" i18n-aria-label="@@projects.project-list.rechercher.un.projet.7ef9017c" />
        </span>

        <p-select
          [options]="statusOptions"
          [(ngModel)]="statusFilter"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les statuts" i18n-placeholder="@@projects.project-list.tous.les.statuts.2d5088af"
          [showClear]="true"
          (onChange)="onFilterChange()" />

        <p-select
          [options]="kindOptions"
          [(ngModel)]="kindFilter"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les types" i18n-placeholder="@@projects.project-list.tous.les.types.5a6be24d"
          [showClear]="true"
          (onChange)="onFilterChange()" />

        <p-select
          [options]="clientOptions()"
          [(ngModel)]="clientFilter"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les clients" i18n-placeholder="@@projects.project-list.tous.les.clients.56f5092c"
          [showClear]="true"
          [filter]="true"
          filterPlaceholder="Rechercher…" i18n-filterPlaceholder="@@projects.project-list.rechercher.ed75dcce"
          (onChange)="onFilterChange()" />

        <button
          type="button"
          class="proj-list-more-filters"
          (click)="advancedPanel.toggle($event)"
          aria-label="Plus de filtres" i18n-aria-label="@@projects.project-list.plus.de.filtres.51cff4a1"><ng-container i18n="@@projects.project-list.plus.de.filtres.a91c9068">
          <i class="pi pi-filter" aria-hidden="true"></i>
          Plus de filtres
          </ng-container>@if (extraFiltersCount() > 0) {
            <span class="proj-list-more-filters__badge">{{ extraFiltersCount() }}</span>
          }
        </button>

        <p-popover #advancedPanel>
          <div class="proj-list-advanced">
            <label class="proj-list-advanced__field">
              <span i18n="@@projects.project-list.chef.de.projet.7a1d6008">Chef de projet</span>
              <p-select
                class="w-full"
                [options]="ownerOptions()"
                [(ngModel)]="ownerFilter"
                optionLabel="label"
                optionValue="value"
                placeholder="Tous" i18n-placeholder="@@projects.project-list.tous.b97ae3b4"
                [showClear]="true"
                (onChange)="onFilterChange()" />
            </label>
            <label class="proj-list-advanced__field">
              <span i18n="@@projects.project-list.mode.de.facturation.d797aff0">Mode de facturation</span>
              <p-select
                class="w-full"
                [options]="billingFilterOptions"
                [(ngModel)]="billingFilter"
                optionLabel="label"
                optionValue="value"
                placeholder="Tous" i18n-placeholder="@@projects.project-list.tous.b97ae3b4"
                [showClear]="true"
                (onChange)="onFilterChange()" />
            </label>
            <div class="proj-list-advanced__dates">
              <label class="proj-list-advanced__field">
                <span i18n="@@projects.project-list.echeance.du.168e2cce">Échéance du</span>
                <p-datepicker [(ngModel)]="endDateFrom" dateFormat="dd/mm/yy" [showIcon]="true" (onSelect)="onFilterChange()" />
              </label>
              <label class="proj-list-advanced__field">
                <span i18n="@@projects.project-list.au.f095160c">au</span>
                <p-datepicker [(ngModel)]="endDateTo" dateFormat="dd/mm/yy" [showIcon]="true" (onSelect)="onFilterChange()" />
              </label>
            </div>
            <label class="proj-list-advanced__check">
              <p-checkbox [(ngModel)]="overdueOnly" [binary]="true" (onChange)="onFilterChange()" inputId="overdueOnly" />
              <span for="overdueOnly" i18n="@@projects.project-list.uniquement.avec.taches.en.retard.ee6f621f">Uniquement avec tâches en retard</span>
            </label>
            @if (extraFiltersCount() > 0) {
              <button type="button" class="proj-list-advanced__reset" (click)="resetExtraFilters()" i18n="@@projects.project-list.reinitialiser.les.filtres.avances.f602005a"> Réinitialiser les filtres avancés </button>
            }
          </div>
        </p-popover>

        <div class="proj-list-filters__actions">
          @if (hasActiveFilters()) {
            <button type="button" class="ft-filters__reset" (click)="resetFilters()" aria-label="Réinitialiser les filtres" i18n-aria-label="@@projects.project-list.reinitialiser.les.filtres.d8915f02" i18n="@@projects.project-list.reinitialiser.9637f51e">
              <i class="pi pi-times"></i>
              Réinitialiser ({{ activeFiltersCount() }})
            </button>
          }
          <app-button variant="secondary" icon="pi-refresh" (click)="refreshAll()" i18n="@@projects.project-list.actualiser.9d3b2a7d">Actualiser</app-button>
        </div>
      </div>
    </div>

    @if (error()) {
      <p class="text-danger p-3" role="alert">{{ error() }}</p>
    }

    <div class="ft-table-card proj-list-table-card">
      @if (loading() && items().length === 0) {
        <app-skeleton-table [rows]="5" [columns]="skeletonCols" />
      } @else {
        <p-table
          [value]="items()"
          [lazy]="true"
          [paginator]="true"
          [rows]="pageSize"
          [rowsPerPageOptions]="[10, 20, 50]"
          [totalRecords]="totalRecords()"
          [loading]="loading()"
          [first]="(page - 1) * pageSize"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} projets" i18n-currentPageReportTemplate="@@projects.project-list.affichage.de.first.a.last.sur.totalrecords.proje.43c25739"
          (onLazyLoad)="onPageChange($event)"
          styleClass="p-datatable-sm proj-list-table"
          [rowHover]="true">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@projects.project-list.projet.a9de3a26">Projet</th>
              <th i18n="@@projects.project-list.client.1bdd79b1">Client</th>
              <th i18n="@@projects.project-list.chef.de.projet.7a1d6008">Chef de projet</th>
              <th i18n="@@projects.project-list.type.3deb7456">Type</th>
              <th i18n="@@projects.project-list.statut.659499f3">Statut</th>
              <th i18n="@@projects.project-list.echeance.f9a77ff6">Échéance</th>
              <th i18n="@@projects.project-list.avancement.e1963fc4">Avancement</th>
              <th i18n="@@projects.project-list.taches.1b018f86">Tâches</th>
              <th class="proj-list-actions-col"></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-p>
            <tr class="proj-row-click" (click)="open(p)">
              <td>
                <div class="proj-list-project-cell">
                  <button
                    type="button"
                    class="proj-fav-btn"
                    [class.proj-fav-btn--active]="isFavorite(p.id)"
                    [attr.aria-label]="isFavorite(p.id) ? loc_ui_tern_retirer_des_favoris_dcaac8 : loc_ui_tern_ajouter_aux_favoris_721554"
                    (click)="toggleFavorite(p.id, $event)">
                    <i class="pi" [class.pi-star-fill]="isFavorite(p.id)" [class.pi-star]="!isFavorite(p.id)"></i>
                  </button>
                  <span class="proj-list-project-icon" [style.background]="kindColor(p.kind)">
                    {{ projectInitial(p.name) }}
                  </span>
                  <div>
                    <strong>{{ p.name }}</strong>
                    <span class="proj-list-project-desc">{{ p.kindDisplay | backendLabel }}</span>
                  </div>
                </div>
              </td>
              <td>
                <span class="proj-list-client">
                  <i class="fa-solid fa-building" aria-hidden="true"></i>
                  {{ p.clientName }}
                </span>
              </td>
              <td>
                @if (p.ownerUserName) {
                  <span class="proj-avatar">{{ initials(p.ownerUserName) }}</span>
                  {{ p.ownerUserName }}
                } @else { — }
              </td>
              <td>
                <span class="proj-kind-pill" [ngClass]="kindPillClass(p.kind)">{{ p.kindDisplay | backendLabel }}</span>
              </td>
              <td>
                <span class="proj-list-status">
                  <span class="proj-list-status-dot" [ngClass]="statusDotClass(p.status)"></span>
                  <app-status-badge [status]="statusBadge(p.status)" [label]="p.statusDisplay | backendLabel" [showIcon]="false" />
                </span>
              </td>
              <td>
                @if (p.endDate) {
                  <div class="proj-list-due">
                    <span><i class="pi pi-calendar" aria-hidden="true"></i> {{ p.endDate | date:'dd/MM/yyyy' }}</span>
                    @if (dueLabel(p.endDate); as lbl) {
                      <span class="proj-list-due__rel" [class.proj-list-due__rel--late]="lbl.includes('retard')">{{ lbl }}</span>
                    }
                  </div>
                } @else { — }
              </td>
              <td class="proj-list-progress-col">
                <span class="proj-list-progress-pct">{{ p.progressPercent ?? 0 }} %</span>
                <p-progressBar [value]="p.progressPercent ?? 0" [showValue]="false" />
              </td>
              <td>
                <div class="proj-list-tasks">
                  <span i18n="@@projects.project-list.ouvertes.51a56e9c">{{ p.openTaskCount }} ouvertes</span>
                  @if (p.overdueTaskCount) {
                    <span class="proj-list-tasks__late" i18n="@@projects.project-list.retard.a24d2f37">{{ p.overdueTaskCount }} retard</span>
                  }
                </div>
              </td>
              <td class="proj-list-actions-col" (click)="$event.stopPropagation()">
                <button
                  type="button"
                  class="proj-dash-row-menu-btn"
                  [attr.aria-label]="loc_ui_tern_actions_pour_cf433f + p.name"
                  (click)="onRowMenu($event, p)">
                  <i class="pi pi-ellipsis-v"></i>
                </button>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="9">
                <app-empty-state
                  icon="pi-briefcase"
                  title="Aucun projet" i18n-title="@@projects.project-list.aucun.projet.c77f3894"
                  description="Créez-en un pour démarrer le suivi d'affaire, de mission ESN ou de chantier BTP." i18n-description="@@projects.project-list.creez.en.un.pour.demarrer.le.suivi.d.aff.f22e7fc5"
                  [showAction]="canCreate"
                  actionLabel="Nouveau projet" i18n-actionLabel="@@projects.project-list.nouveau.projet.dcbfdaf5"
                  (actionClick)="openCreate()" />
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </div>

    <p-menu #rowMenu [popup]="true" [model]="rowMenuItems()" appendTo="body" />

    <p-dialog [(visible)]="createVisible" [modal]="true" header="Nouveau projet" i18n-header="@@projects.project-list.nouveau.projet.29f05663" [style]="{ width: '52rem' }" styleClass="proj-create-dialog">
      <app-form-section title="Identité" i18n-title="@@projects.project-list.identite.3138be1c" icon="pi-id-card" variant="compact">
        <div class="ft-form-grid">
          <div class="ft-field">
            <label for="createName"><ng-container i18n="@@projects.project-list.nom.7ff20370">Nom </ng-container> <span class="ft-required" aria-hidden="true" i18n="@@projects.project-list.text.df58248c">*</span></label>
            <input id="createName" pInputText class="w-full" [(ngModel)]="draft.name" />
          </div>
          <div class="ft-field">
            <label for="createClient"><ng-container i18n="@@projects.project-list.client.1bdd79b1">Client </ng-container> <span class="ft-required" aria-hidden="true" i18n="@@projects.project-list.text.df58248c">*</span></label>
            <p-select inputId="createClient" class="w-full" [options]="clients()" [(ngModel)]="draft.clientId" optionLabel="name" optionValue="id" placeholder="Client" i18n-placeholder="@@projects.project-list.client.1bdd79b1" />
          </div>
          <div class="ft-field ft-field--full">
            <span class="block font-medium" i18n="@@projects.project-list.type.de.projet.46597b92">Type de projet</span>
            <div class="proj-kind-cards">
              @for (opt of kindOptions; track opt.value) {
                <div
                  class="proj-kind-card"
                  [class.proj-kind-card--active]="draft.kind === opt.value"
                  (click)="selectKind($any(opt.value))">
                  <strong>{{ opt.label }}</strong>
                  <span>{{ kindHint(opt.value) }}</span>
                </div>
              }
            </div>
          </div>
        </div>
      </app-form-section>

      <app-form-section title="Aperçu Kanban" i18n-title="@@projects.project-list.apercu.kanban.4f287372" icon="pi-table" variant="compact">
        <app-project-kanban-template-preview [kind]="draft.kind" />
      </app-form-section>

      <app-form-section title="Facturation" i18n-title="@@projects.project-list.facturation.04716c6b" icon="pi-sliders-h" variant="compact">
        <div class="ft-form-grid">
          <div class="ft-field ft-field--full">
            <label for="createBilling" i18n="@@projects.project-list.facturation.04716c6b">Facturation</label>
            <p-select inputId="createBilling" class="w-full" [options]="billingOptionsForKind()" [(ngModel)]="draft.billingMode" optionLabel="label" optionValue="value" />
          </div>
          <div class="ft-field ft-field--full">
            <div class="proj-create-options">
              <div class="proj-create-options__item">
                <p-checkbox [(ngModel)]="draft.timesheetsEnabled" [binary]="true" inputId="createTimesheets" />
                <label for="createTimesheets">
                  <strong i18n="@@projects.project-list.feuilles.de.temps.679cea6a">Feuilles de temps</strong>
                  <span class="text-sm text-color-secondary" i18n="@@projects.project-list.active.la.saisie.et.le.suivi.du.temps.sur.ce.pro.dbd98456">Active la saisie et le suivi du temps sur ce projet.</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </app-form-section>

      <app-form-section title="Détails" i18n-title="@@projects.project-list.details.aaa029e6" icon="pi-file" variant="compact">
        <div class="ft-form-grid">
          <div class="ft-field ft-field--full">
            <label for="createDescription" i18n="@@projects.project-list.description.55f8ebc8">Description</label>
            <textarea id="createDescription" pTextarea class="w-full" rows="2" [(ngModel)]="draft.description"></textarea>
          </div>
          <div class="ft-field">
            <label for="createStart" i18n="@@projects.project-list.debut.f0955314">Début</label>
            <p-datepicker inputId="createStart" class="w-full" [(ngModel)]="startDate" dateFormat="dd/mm/yy" [showIcon]="true" />
          </div>
          <div class="ft-field">
            <label for="createEnd" i18n="@@projects.project-list.fin.4251065f">Fin</label>
            <p-datepicker inputId="createEnd" class="w-full" [(ngModel)]="endDate" dateFormat="dd/mm/yy" [showIcon]="true" />
          </div>
          <div class="ft-field">
            <label for="createOwner" i18n="@@projects.project-list.chef.de.projet.7a1d6008">Chef de projet</label>
            <p-select inputId="createOwner" class="w-full" [options]="users()" [(ngModel)]="draft.ownerUserId" optionLabel="displayName" optionValue="id" placeholder="Optionnel" i18n-placeholder="@@projects.project-list.optionnel.879d6b16" [showClear]="true" />
          </div>
          <div class="ft-field">
            <label for="createBudget" i18n="@@projects.project-list.budget.ht.0374a3ad">Budget HT</label>
            <p-inputNumber inputId="createBudget" class="w-full" [(ngModel)]="draft.budgetHt" mode="decimal" [minFractionDigits]="3" />
          </div>
        </div>
      </app-form-section>

      @if (isBtp(draft.kind)) {
        <app-form-section title="Chantier BTP" i18n-title="@@projects.project-list.chantier.btp.20419af9" icon="pi-building" variant="compact">
          <div class="ft-form-grid">
            <div class="ft-field ft-field--full">
              <label for="createSiteAddress" i18n="@@projects.project-list.adresse.chantier.62e0d1f1">Adresse chantier</label>
              <input id="createSiteAddress" pInputText class="w-full" [(ngModel)]="draft.siteAddress" />
            </div>
            <div class="ft-field ft-field--full">
              <label for="createContractNumber" i18n="@@projects.project-list.n.de.marche.1ce067d5">N° de marché</label>
              <input id="createContractNumber" pInputText class="w-full" [(ngModel)]="draft.contractNumber" />
            </div>
            <p class="ft-hint ft-field--full m-0" i18n="@@projects.project-list.les.situations.de.travaux.et.la.retenue.de.garan.009bee93">Les situations de travaux et la retenue de garantie sont disponibles après activation.</p>
          </div>
        </app-form-section>
      }
      @if (draft.kind === 'Esn') {
        <app-form-section title="Mission ESN" i18n-title="@@projects.project-list.mission.esn.7528bd23" icon="pi-users" variant="compact">
          <p class="text-sm text-color-secondary m-0" i18n="@@projects.project-list.renseignez.le.tarif.de.vente.sur.l.equipe.avant..c64a0c55">Renseignez le tarif de vente sur l'équipe avant de facturer en régie.</p>
        </app-form-section>
      }

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (click)="createVisible = false" i18n="@@projects.project-list.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" (click)="saveCreate()" i18n="@@projects.project-list.creer.1a686172">Créer</app-button>
      </ng-template>
    </p-dialog>
  `
})
export class ProjectListComponent implements OnInit {
  readonly loc_ui_tern_retirer_des_favoris_dcaac8 = $localize`:@@ui.tern.retirer.des.favoris.dcaac8:Retirer des favoris`;
  readonly loc_ui_tern_ajouter_aux_favoris_721554 = $localize`:@@ui.tern.ajouter.aux.favoris.721554:Ajouter aux favoris`;
  readonly loc_ui_tern_actions_pour_cf433f = $localize`:@@ui.tern.actions.pour.cf433f:Actions pour `;
  @ViewChild('rowMenu') rowMenu?: Menu;

  private readonly api = inject(ProjectApiService);
  private readonly clientsApi = inject(ClientService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly favorites = inject(ProjectFavoritesService);
  private readonly search$ = new Subject<string>();

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@projects.project-list.ts.accueil.a8ff8fd2:Accueil`, route: '/' },
    { label: $localize`:@@projects.project-list.ts.projets.b1e8cd4d:Projets` }
  ];
  readonly skeletonCols: SkeletonColumn[] = [
    { width: '18%' }, { width: '12%' }, { width: '12%' }, { width: '10%' },
    { width: '10%' }, { width: '11%' }, { width: '10%' }, { width: '10%' }, { width: '7%' }
  ];
  readonly exportMenuItems: MenuItem[] = [
    { label: $localize`:@@projects.project-list.ts.csv.liste.filtree.0a556cad:CSV — liste filtrée`, icon: 'fa-solid fa-file-csv', command: () => this.exportCsv() }
  ];
  readonly billingFilterOptions = PROJECT_BILLING_OPTIONS;

  readonly items = signal<ProjectListItem[]>([]);
  readonly dashboardExtended = signal<ProjectDashboardExtended | null>(null);
  readonly dashboardBasic = signal<ProjectDashboard | null>(null);
  readonly clients = signal<ClientListItem[]>([]);
  readonly users = signal<ProjectAssignableUser[]>([]);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly totalRecords = signal(0);

  search = '';
  statusFilter: string | null = null;
  kindFilter: string | null = null;
  clientFilter: string | null = null;
  ownerFilter: string | null = null;
  billingFilter: string | null = null;
  overdueOnly = false;
  endDateFrom: Date | null = null;
  endDateTo: Date | null = null;
  page = 1;
  pageSize = 20;
  private initialLoadDone = false;
  private isFirstLoad = true;
  private activeRow = signal<ProjectListItem | null>(null);

  createVisible = false;
  startDate: Date | null = null;
  endDate: Date | null = null;
  draft: UpsertProjectPayload = {
    clientId: '', name: '', kind: 'Generic', billingMode: 'None', budgetHt: 0,
    timesheetsEnabled: true, milestonesEnabled: false, allocatedHours: 0, analyticAccountCode: null
  };

  readonly statusOptions = PROJECT_STATUS_OPTIONS;
  readonly kindOptions = PROJECT_KIND_OPTIONS;
  readonly isBtp = isBtp;
  readonly initials = initialsFromName;
  readonly kindColor = projectKindAccentColor;
  readonly kindPillClass = projectKindPillClass;
  readonly dueLabel = formatDaysUntilDue;

  clientOptions = computed(() =>
    this.clients().map(c => ({ label: c.name, value: c.id }))
  );

  ownerOptions = computed(() =>
    this.users().map(u => ({ label: u.displayName, value: u.id }))
  );

  rowMenuItems = computed((): MenuItem[] => {
    const p = this.activeRow();
    if (!p) return [];
    const favLabel = this.isFavorite(p.id) ? $localize`:@@ui.tern.retirer.des.favoris.dcaac8:Retirer des favoris` : $localize`:@@ui.tern.ajouter.aux.favoris.721554:Ajouter aux favoris`;
    return [
      { label: $localize`:@@projects.project-list.ts.voir.le.projet.4dfb4818:Voir le projet`, icon: 'pi pi-eye', command: () => this.open(p) },
      { label: $localize`:@@projects.project-list.ts.taches.1b018f86:Tâches`, icon: 'pi pi-list', command: () => void this.router.navigate(['/projects', p.id], { fragment: 'tasks' }) },
      { label: $localize`:@@projects.project-list.ts.temps.2986a8c2:Temps`, icon: 'pi pi-clock', command: () => void this.router.navigate(['/projects', p.id], { fragment: 'time' }) },
      { label: favLabel, icon: 'pi pi-star', command: () => this.favorites.toggle(p.id) }
    ];
  });

  billingOptionsForKind() {
    return billingOptionsForKind(this.draft.kind);
  }

  kindHint(value: string): string {
    return KIND_CARD_HINTS[value as ProjectKindCode] ?? '';
  }

  selectKind(kind: ProjectKindCode): void {
    this.draft.kind = kind;
    this.onKindChange();
  }

  extraFiltersCount(): number {
    let n = 0;
    if (this.ownerFilter) n++;
    if (this.billingFilter) n++;
    if (this.endDateFrom) n++;
    if (this.endDateTo) n++;
    if (this.overdueOnly) n++;
    return n;
  }

  hasActiveFilters(): boolean {
    return !!this.search
      || this.statusFilter !== null
      || this.kindFilter !== null
      || this.clientFilter !== null
      || this.extraFiltersCount() > 0;
  }

  activeFiltersCount(): number {
    let count = 0;
    if (this.search) count++;
    if (this.statusFilter !== null) count++;
    if (this.kindFilter !== null) count++;
    if (this.clientFilter !== null) count++;
    count += this.extraFiltersCount();
    return count;
  }

  resetExtraFilters(): void {
    this.ownerFilter = null;
    this.billingFilter = null;
    this.endDateFrom = null;
    this.endDateTo = null;
    this.overdueOnly = false;
    this.page = 1;
    this.load();
  }

  resetFilters(): void {
    this.search = '';
    this.statusFilter = null;
    this.kindFilter = null;
    this.clientFilter = null;
    this.resetExtraFilters();
  }

  applyOverdueFilter(): void {
    this.overdueOnly = true;
    this.page = 1;
    this.load();
  }

  get canCreate(): boolean {
    return this.auth.hasPermission(PERMISSIONS.projects.create);
  }

  ngOnInit(): void {
    this.search$.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => {
      this.page = 1;
      this.load();
    });

    this.route.queryParamMap.pipe(take(1)).subscribe(params => {
      const applied = applyProjectListFiltersFromQuery(params, {
        search: null,
        status: null,
        kind: null,
        clientId: null
      });
      if (applied.search) this.search = applied.search;
      if (applied.status) this.statusFilter = applied.status;
      if (applied.kind) this.kindFilter = applied.kind;
      if (applied.clientId) this.clientFilter = applied.clientId;

      this.load();
      this.loadDashboard();
    });

    this.clientsApi.getClients({ page: 1, pageSize: 100 }).subscribe({
      next: r => { if (r.success && r.data) this.clients.set(r.data.items); },
      error: () => { /* optional */ }
    });

    this.api.users().subscribe({
      next: r => { if (r.success && r.data) this.users.set(r.data); },
      error: () => { /* optional */ }
    });
  }

  refreshAll(): void {
    this.load();
    this.loadDashboard();
  }

  loadDashboard(): void {
    this.api.dashboardExtended('month').subscribe({
      next: r => {
        if (r.success && r.data) {
          this.dashboardExtended.set(r.data);
          this.dashboardBasic.set(null);
        }
      },
      error: () => {
        this.api.dashboard().subscribe({
          next: dr => {
            if (dr.success && dr.data) {
              this.dashboardBasic.set(dr.data);
              this.dashboardExtended.set(null);
            }
          },
          error: err => this.toast.add({
            severity: 'error',
            summary: $localize`:@@project-list.component.summary.Indicateurs:Indicateurs`,
            detail: this.errors.extractErrorMessage(err)
          })
        });
      }
    });
  }

  onSearch(value: string): void {
    this.search$.next(value);
  }

  statusBadge(status: ProjectListItem['status']) {
    return projectStatusBadge(status);
  }

  statusDotClass(status: ProjectListItem['status']): string {
    const badge = projectStatusBadge(status);
    return `proj-list-status-dot--${badge}`;
  }

  projectInitial(name: string): string {
    return name?.trim()?.[0]?.toUpperCase() ?? '?';
  }

  isFavorite(id: string): boolean {
    return this.favorites.isFavorite(id);
  }

  toggleFavorite(id: string, event: Event): void {
    event.stopPropagation();
    this.favorites.toggle(id);
  }

  onRowMenu(event: Event, row: ProjectListItem): void {
    event.preventDefault();
    event.stopPropagation();
    this.activeRow.set(row);
    this.rowMenu?.toggle(event);
  }

  onKindChange(): void {
    this.draft.billingMode = defaultBillingForKind(this.draft.kind);
    const kind = this.draft.kind;
    if (kind === 'Esn') {
      this.draft.timesheetsEnabled = true;
    } else {
      this.draft.timesheetsEnabled = false;
    }
  }

  onFilterChange(): void {
    this.page = 1;
    this.load();
  }

  listParams() {
    return {
      search: this.search || undefined,
      status: this.statusFilter ?? undefined,
      kind: this.kindFilter ?? undefined,
      clientId: this.clientFilter ?? undefined,
      ownerUserId: this.ownerFilter ?? undefined,
      billingMode: this.billingFilter ?? undefined,
      overdueOnly: this.overdueOnly || undefined,
      endDateFrom: toIsoDate(this.endDateFrom) ?? undefined,
      endDateTo: toIsoDate(this.endDateTo) ?? undefined,
      page: this.page,
      pageSize: this.pageSize
    };
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list(this.listParams()).subscribe({
      next: r => {
        this.loading.set(false);
        this.initialLoadDone = true;
        if (r.success && r.data) {
          this.items.set(r.data.items);
          this.totalRecords.set(r.data.totalCount);
          this.page = r.data.page;
        } else {
          this.error.set(r.message || $localize`:@@projects.project-list.ts.chargement.impossible.4c82ffbe:Chargement impossible`);
        }
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errors.extractErrorMessage(err));
      }
    });
  }

  exportCsv(): void {
    this.exporting.set(true);
    const { page, pageSize, ...filters } = this.listParams();
    this.api.exportCsv(filters).subscribe({
      next: blob => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `projets-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        this.toast.add({ severity: 'success', summary: $localize`:@@project-list.component.summary.Export:Export`, detail: $localize`:@@project-list.component.detail.Liste_export_e_e:Liste exportée en CSV.` });
      },
      error: err => {
        this.exporting.set(false);
        this.toast.add({ severity: 'error', summary: $localize`:@@project-list.component.summary.Export:Export`, detail: this.errors.extractErrorMessage(err) });
      }
    });
  }

  onPageChange(event: { first?: number; rows?: number | null }): void {
    const first = event.first ?? 0;
    const rows = event.rows ?? this.pageSize;
    this.page = rows ? Math.floor(first / rows) + 1 : 1;
    this.pageSize = rows || this.pageSize;

    if (this.isFirstLoad && first === 0 && this.initialLoadDone) {
      this.isFirstLoad = false;
      return;
    }

    this.load();
    this.isFirstLoad = false;
  }

  open(p: ProjectListItem): void {
    void this.router.navigate(['/projects', p.id]);
  }

  openCreate(): void {
    this.draft = {
      clientId: this.clients()[0]?.id ?? '',
      name: '',
      kind: 'Generic',
      billingMode: 'None',
      budgetHt: 0,
      description: '',
      ownerUserId: null,
      siteAddress: '',
      contractNumber: '',
      timesheetsEnabled: false,
      milestonesEnabled: false,
      allocatedHours: 0,
      analyticAccountCode: null
    };
    this.startDate = null;
    this.endDate = null;
    this.createVisible = true;
  }

  saveCreate(): void {
    if (!this.draft.name?.trim()) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@project-list.component.summary.Nom requis:Nom requis`, detail: $localize`:@@project-list.component.detail.Indiquez_un_nom_:Indiquez un nom de projet.` });
      return;
    }
    if (!this.draft.clientId) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@project-list.component.summary.Client_requis:Client requis`, detail: $localize`:@@project-list.component.detail.S_lectionnez_un_:Sélectionnez un client.` });
      return;
    }
    const payload: UpsertProjectPayload = {
      ...this.draft,
      startDate: toIsoDate(this.startDate),
      endDate: toIsoDate(this.endDate),
      ownerUserId: this.draft.ownerUserId || null
    };
    this.api.create(payload).subscribe({
      next: r => {
        if (r.success && r.data) {
          this.createVisible = false;
          this.toast.add({ severity: 'success', summary: $localize`:@@project-list.component.summary.Projet créé:Projet créé`, detail: $localize`:@@project-list.component.detail.Pensez_l_activ:Pensez à l’activer pour saisir du temps.` });
          void this.router.navigate(['/projects', r.data]);
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@project-list.component.summary.Cr_ation_impossi:Création impossible`, detail: r.message || $localize`:@@projects.project-list.ts.erreur.ab546c23:Erreur` });
        }
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-list.component.summary.Cr_ation_impossi:Création impossible`, detail: this.errors.extractErrorMessage(err) })
    });
  }
}
