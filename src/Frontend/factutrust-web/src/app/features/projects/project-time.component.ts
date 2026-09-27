/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { RouterLink } from '@angular/router';

import { TableModule } from 'primeng/table';

import { SelectModule } from 'primeng/select';

import { DatePickerModule } from 'primeng/datepicker';

import { InputNumberModule } from 'primeng/inputnumber';

import { CheckboxModule } from 'primeng/checkbox';

import { InputTextModule } from 'primeng/inputtext';

import { MessageModule } from 'primeng/message';

import { DialogModule } from 'primeng/dialog';

import { TooltipModule } from 'primeng/tooltip';

import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';

import { ButtonComponent } from '@shared/components/button/button.component';

import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';

import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

import { AuthService } from '@core/services/auth.service';

import { ToastService } from '@core/services/toast.service';

import { ErrorHandlerService } from '@core/services/error-handler.service';

import { PERMISSIONS } from '@core/config/permission-keys';

import { ProjectApiService, ProjectListItem, ProjectTask, ProjectTimeEntry } from './project-api.service';

import {
  canCreateTimeEntry,
  canDeleteTimeEntry,
  canEditTimeEntry,
  canReopenSubmittedTimeEntry,
  canReopenValidatedTimeEntry,
  canSubmitTimeEntry,
  canValidateTimeEntry,
  parseProjectTimeStatus,
  timeEntryCreationBlockedMessage,
  timeEntryStatusBadge,
  timeEntryStatusLabel,
  toIsoDate,
  canSaveProjectTimeLine
} from './project-enums';



const TIME_STATUS_FILTER_OPTIONS = [

  { label: $localize`:@@projects.time.filter.brouillon:Brouillon`, value: 'Draft' },

  { label: $localize`:@@projects.time.filter.soumis:Soumis`, value: 'Submitted' },

  { label: $localize`:@@projects.time.filter.valide:Validé`, value: 'Validated' }

];



@Component({

  selector: 'app-project-time',

  standalone: true,

  imports: [

    CommonModule,

    FormsModule,

    RouterLink,

    TableModule,

    SelectModule,

    DatePickerModule,

    InputNumberModule,

    CheckboxModule,

    InputTextModule,

    MessageModule,

    DialogModule,

    TooltipModule,

    PageHeaderComponent,

    ButtonComponent,

    BreadcrumbComponent,

    StatusBadgeComponent,

    EmptyStateComponent

  ],

  template: `

    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header title="Saisie des temps" i18n-title="Saisie des temps" subtitle="Temps projet (indépendant des feuilles cabinet)" />

    <div class="card p-3 mb-3">

      <div class="proj-field-row">

        <label>Projet

          <p-select [options]="projects()" [(ngModel)]="projectId" optionLabel="name" optionValue="id" placeholder="Projet" i18n-placeholder="Projet" [showClear]="true" (onChange)="onProjectChange()" />

        </label>

        <label>Période

          <p-datepicker [(ngModel)]="dateRange" selectionMode="range" dateFormat="dd/mm/yy" placeholder="Filtrer" i18n-placeholder="Filtrer" [showClear]="true" (onSelect)="load()" (onClear)="load()" />

        </label>

        <label>Statut

          <p-select [options]="statusFilterOptions" [(ngModel)]="statusFilter" optionLabel="label" optionValue="value" placeholder="Tous" i18n-placeholder="Tous" [showClear]="true" (onChange)="load()" />

        </label>

        <app-button variant="secondary" (click)="load()" i18n="@@projects.project-time.actualiser.9d3b2a7d">Actualiser</app-button>

      </div>

    </div>

    @if (selectedProject() && !canCreateTimeEntry(selectedProject()!)) {
      <p-message severity="warn" styleClass="w-full mb-3"
        [text]="timeLoggingBlockedMessage(selectedProject()!)" />
    }

    @if (selectedProject() && canCreateTimeEntry(selectedProject()!) && canCreate) {

      <div class="card p-3 mb-3">

        <h3 class="mt-0" i18n="@@projects.project-time.nouvelle.ligne.21957286">Nouvelle ligne</h3>

        <div class="proj-field-row">

          <label><ng-container i18n="@@projects.project-time.date.eb9a4bc1">Date </ng-container> <p-datepicker [(ngModel)]="workDate" dateFormat="dd/mm/yy" /></label>

          <label><ng-container i18n="@@projects.project-time.tache.43c8425c">Tâche </ng-container> <p-select [options]="tasks()" [(ngModel)]="taskId" optionLabel="title" optionValue="id" placeholder="Tâche" i18n-placeholder="Tâche" [showClear]="true" /></label>

          <label><ng-container i18n="@@projects.project-time.heures.b4448c06">Heures </ng-container> <p-inputNumber [(ngModel)]="hours" [min]="0.25" [max]="24" [step]="0.25" /></label>

          <label class="flex-row align-items-center gap-2" style="flex-direction:row">

            <p-checkbox [(ngModel)]="isBillable" [binary]="true" inputId="billable" />

            <span i18n="@@projects.project-time.facturable.63134237">Facturable</span>

          </label>

          <label><ng-container i18n="@@projects.project-time.notes.70440046">Notes </ng-container> <input pInputText [(ngModel)]="notes" /></label>

          <app-button variant="primary" [disabled]="!canSaveLine" (click)="create()" i18n="@@projects.project-time.enregistrer.f7c8bcd8">Enregistrer</app-button>

        </div>

      </div>

    }

    @if (error()) { <p class="text-danger p-3" role="alert">{{ error() }}</p> }

    <p-table [value]="entries()" styleClass="p-datatable-sm">

      <ng-template pTemplate="header">

        <tr>

          <th i18n="@@projects.project-time.date.eb9a4bc1">Date</th>

          <th i18n="@@projects.project-time.projet.a9de3a26">Projet</th>

          <th i18n="@@projects.project-time.tache.43c8425c">Tâche</th>

          <th i18n="@@projects.project-time.heures.b4448c06">Heures</th>

          <th i18n="@@projects.project-time.facturable.63134237">Facturable</th>

          <th i18n="@@projects.project-time.statut.659499f3">Statut</th>

          <th></th>

        </tr>

      </ng-template>

      <ng-template pTemplate="body" let-e>

        <tr>

          <td>{{ e.workDate | date:'shortDate' }}</td>

          <td>{{ e.projectName }}</td>

          <td>{{ e.taskTitle || '—' }}</td>

          <td>{{ e.hours }}</td>

          <td>{{ e.isBillable ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>

          <td>
            <app-status-badge [status]="timeEntryStatusBadge(e)" [label]="timeEntryStatusLabel(e)" />
          </td>

          <td class="proj-time-row-actions">

            @if (canEditTimeEntry(e) && canCreate) {
              <app-button size="sm" variant="ghost" icon="pi-pencil" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Modifier" i18n-pTooltip="Modifier" tooltipPosition="top"
                ariaLabel="Modifier" (click)="openEdit(e)" />
            }

            @if (canDeleteTimeEntry(e) && canCreate) {
              <app-button size="sm" variant="ghost" icon="pi-trash" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Supprimer" i18n-pTooltip="Supprimer" tooltipPosition="top"
                ariaLabel="Supprimer" (click)="deleteEntry(e.id)" />
            }

            @if (canSubmitTimeEntry(e) && canSubmit) {
              <app-button size="sm" variant="ghost" icon="pi-send" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Soumettre" i18n-pTooltip="Soumettre" tooltipPosition="top"
                ariaLabel="Soumettre" (click)="submit(e.id)" />
            }

            @if (canValidateTimeEntry(e) && canValidate) {
              <app-button size="sm" variant="primary" icon="pi-check" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Valider" i18n-pTooltip="Valider" tooltipPosition="top"
                ariaLabel="Valider" (click)="validate(e.id)" />
            }

            @if (canReopenSubmittedTimeEntry(e) && canSubmit) {
              <app-button size="sm" variant="ghost" icon="pi-undo" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Rouvrir en brouillon" i18n-pTooltip="Rouvrir en brouillon" tooltipPosition="top"
                ariaLabel="Rouvrir en brouillon" (click)="reopen(e.id)" />
            }

            @if (canReopenValidatedTimeEntry(e) && canValidate) {
              <app-button size="sm" variant="ghost" icon="pi-undo" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Rouvrir en brouillon" i18n-pTooltip="Rouvrir en brouillon" tooltipPosition="top"
                ariaLabel="Rouvrir en brouillon" (click)="reopen(e.id)" />
            }

            @if (e.invoicedInvoiceId) {

              <app-button
                size="sm"
                variant="ghost"
                icon="pi-receipt"
                [iconOnly]="true"
                [iconAlwaysVisible]="true"
                [routerLink]="['/invoices', e.invoicedInvoiceId]"
                pTooltip="Voir la facture" i18n-pTooltip="Voir la facture"
                tooltipPosition="top"
                ariaLabel="Voir la facture" />

            }

          </td>

        </tr>

      </ng-template>

      <ng-template pTemplate="emptymessage">

        <tr><td colspan="7">

          <app-empty-state icon="pi-clock" title="Aucun temps" i18n-title="Aucun temps" description="Choisissez un projet actif pour saisir une ligne." [showAction]="false" />

        </td></tr>

      </ng-template>

    </p-table>



    <p-dialog [(visible)]="editVisible" header="Modifier le temps" i18n-header="Modifier le temps" [modal]="true" [style]="{ width: '28rem' }">

      <div class="proj-field-stack">

        <label><ng-container i18n="@@projects.project-time.date.eb9a4bc1">Date </ng-container> <p-datepicker [(ngModel)]="editWorkDate" dateFormat="dd/mm/yy" /></label>

        <label><ng-container i18n="@@projects.project-time.tache.43c8425c">Tâche </ng-container> <p-select [options]="tasks()" [(ngModel)]="editTaskId" optionLabel="title" optionValue="id" [showClear]="true" /></label>

        <label><ng-container i18n="@@projects.project-time.heures.b4448c06">Heures </ng-container> <p-inputNumber [(ngModel)]="editHours" [min]="0.25" [max]="24" [step]="0.25" /></label>

        <label class="proj-field-stack__check">

          <p-checkbox [(ngModel)]="editBillable" [binary]="true" inputId="editBillableGlobal" />

          <span i18n="@@projects.project-time.facturable.63134237">Facturable</span>

        </label>

        <label><ng-container i18n="@@projects.project-time.notes.70440046">Notes </ng-container> <input pInputText class="w-full" [(ngModel)]="editNotes" /></label>

      </div>

      <ng-template pTemplate="footer">

        <app-button variant="secondary" (click)="editVisible = false" i18n="@@projects.project-time.annuler.49ba3292">Annuler</app-button>

        <app-button variant="primary" [disabled]="!canSaveEditLine" (click)="saveEdit()" i18n="@@projects.project-time.enregistrer.f7c8bcd8">Enregistrer</app-button>

      </ng-template>

    </p-dialog>

  `,


})

export class ProjectTimeComponent implements OnInit {
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;

  private readonly api = inject(ProjectApiService);

  private readonly auth = inject(AuthService);

  private readonly toast = inject(ToastService);

  private readonly errors = inject(ErrorHandlerService);



  readonly breadcrumbItems: BreadcrumbItem[] = [

    { label: 'Accueil', route: '/' },

    { label: 'Projets', route: '/projects' },

    { label: 'Saisie des temps' }

  ];

  readonly entries = signal<ProjectTimeEntry[]>([]);

  readonly projects = signal<ProjectListItem[]>([]);

  readonly tasks = signal<ProjectTask[]>([]);

  readonly error = signal<string | null>(null);

  projectId: string | null = null;

  taskId: string | null = null;

  workDate = new Date();

  hours = 8;

  isBillable = true;

  notes = '';

  dateRange: Date[] | null = null;

  statusFilter: string | null = null;

  readonly statusFilterOptions = TIME_STATUS_FILTER_OPTIONS;



  editVisible = false;

  private editId = '';

  private editProjectId = '';

  editWorkDate = new Date();

  editHours = 8;

  editBillable = true;

  editNotes = '';

  editTaskId: string | null = null;



  readonly canCreateTimeEntry = canCreateTimeEntry;
  readonly parseProjectTimeStatus = parseProjectTimeStatus;
  readonly canEditTimeEntry = canEditTimeEntry;
  readonly canDeleteTimeEntry = canDeleteTimeEntry;
  readonly canSubmitTimeEntry = canSubmitTimeEntry;
  readonly canValidateTimeEntry = canValidateTimeEntry;
  readonly canReopenSubmittedTimeEntry = canReopenSubmittedTimeEntry;
  readonly canReopenValidatedTimeEntry = canReopenValidatedTimeEntry;
  readonly timeEntryStatusBadge = timeEntryStatusBadge;
  readonly timeEntryStatusLabel = timeEntryStatusLabel;



  get canCreate(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTime.create); }

  get canSubmit(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTime.submit); }

  get canValidate(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTime.validate); }

  get canSaveLine(): boolean {
    return canSaveProjectTimeLine(this.taskId, this.hours);
  }

  get canSaveEditLine(): boolean {
    return canSaveProjectTimeLine(this.editTaskId, this.editHours);
  }



  selectedProject(): ProjectListItem | undefined {

    return this.projects().find(p => p.id === this.projectId);

  }

  timeLoggingBlockedMessage(project: ProjectListItem): string {
    return timeEntryCreationBlockedMessage(project.status);
  }



  ngOnInit(): void {

    this.api.list({ page: 1, pageSize: 100 }).subscribe({

      next: r => {
        if (r.success && r.data) {
          this.projects.set(r.data.items.filter(p => canCreateTimeEntry(p)));
        }
      },

      error: err => this.error.set(this.errors.extractErrorMessage(err))

    });

    this.load();

  }



  onProjectChange(): void {

    this.taskId = null;

    this.tasks.set([]);

    if (this.projectId) {

      this.api.tasks(this.projectId).subscribe(r => {

        if (r.success && r.data) this.tasks.set(r.data);

      });

    }

    this.load();

  }



  load(): void {

    this.error.set(null);

    const from = this.dateRange?.[0] ? toIsoDate(this.dateRange[0])?.slice(0, 10) : undefined;

    const to = this.dateRange?.[1] ? toIsoDate(this.dateRange[1])?.slice(0, 10) : undefined;

    this.api.time({

      projectId: this.projectId ?? undefined,

      from,

      to,

      status: this.statusFilter ?? undefined

    }).subscribe({

      next: r => {

        if (r.success && r.data) this.entries.set(r.data);

      },

      error: err => this.error.set(this.errors.extractErrorMessage(err))

    });

  }



  create(): void {

    if (!this.projectId) {

      this.error.set('Choisissez un projet');

      return;

    }

    if (!this.canSaveLine) return;

    const workDate = toIsoDate(this.workDate);

    if (!workDate) return;

    this.api.createTime({

      projectId: this.projectId,

      taskId: this.taskId,

      workDate,

      hours: this.hours,

      isBillable: this.isBillable,

      notes: this.notes

    }).subscribe({

      next: r => {

        if (r.success) {

          this.toast.add({ severity: 'success', summary: $localize`:@@project-time.component.summary.Temps_enregistr_:Temps enregistré` });

          this.notes = '';

          this.load();

        } else this.error.set(r.message || 'Enregistrement impossible');

      },

      error: err => this.error.set(this.errors.extractErrorMessage(err))

    });

  }



  openEdit(e: ProjectTimeEntry): void {

    this.editId = e.id;

    this.editProjectId = e.projectId;

    this.editWorkDate = new Date(e.workDate);

    this.editHours = e.hours;

    this.editBillable = e.isBillable;

    this.editNotes = e.notes ?? '';

    this.editTaskId = e.taskId ?? null;

    this.editVisible = true;

  }



  saveEdit(): void {

    if (!this.canSaveEditLine) return;

    const workDate = toIsoDate(this.editWorkDate);

    if (!workDate) return;

    this.api.updateTime(this.editId, {

      projectId: this.editProjectId,

      taskId: this.editTaskId,

      workDate,

      hours: this.editHours,

      isBillable: this.editBillable,

      notes: this.editNotes

    }).subscribe({

      next: () => {

        this.toast.add({ severity: 'success', summary: $localize`:@@project-time.component.summary.Temps mis à :Temps mis à jour` });

        this.editVisible = false;

        this.load();

      },

      error: err => this.error.set(this.errors.extractErrorMessage(err))

    });

  }



  submit(id: string): void {

    this.api.submitTime(id).subscribe({

      next: () => this.load(),

      error: err => this.error.set(this.errors.extractErrorMessage(err))

    });

  }



  validate(id: string): void {

    this.api.validateTime(id).subscribe({

      next: () => this.load(),

      error: err => this.error.set(this.errors.extractErrorMessage(err))

    });

  }

  deleteEntry(id: string): void {
    this.api.deleteTime(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@project-time.component.summary.Temps suppri:Temps supprimé` });
        this.load();
      },
      error: err => this.error.set(this.errors.extractErrorMessage(err))
    });
  }

  reopen(id: string): void {
    this.api.reopenTime(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@project-time.component.summary.Temps_rouvert_en:Temps rouvert en brouillon` });
        this.load();
      },
      error: err => this.error.set(this.errors.extractErrorMessage(err))
    });
  }

}

