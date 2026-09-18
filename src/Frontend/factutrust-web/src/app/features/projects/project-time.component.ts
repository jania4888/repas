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

  { label: 'Brouillon', value: 'Draft' },

  { label: 'Soumis', value: 'Submitted' },

  { label: 'Validé', value: 'Validated' }

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

    <app-page-header title="Saisie des temps" subtitle="Temps projet (indépendant des feuilles cabinet)" />

    <div class="card p-3 mb-3">

      <div class="proj-field-row">

        <label>Projet

          <p-select [options]="projects()" [(ngModel)]="projectId" optionLabel="name" optionValue="id" placeholder="Projet" [showClear]="true" (onChange)="onProjectChange()" />

        </label>

        <label>Période

          <p-datepicker [(ngModel)]="dateRange" selectionMode="range" dateFormat="dd/mm/yy" placeholder="Filtrer" [showClear]="true" (onSelect)="load()" (onClear)="load()" />

        </label>

        <label>Statut

          <p-select [options]="statusFilterOptions" [(ngModel)]="statusFilter" optionLabel="label" optionValue="value" placeholder="Tous" [showClear]="true" (onChange)="load()" />

        </label>

        <app-button variant="secondary" (click)="load()">Actualiser</app-button>

      </div>

    </div>

    @if (selectedProject() && !canCreateTimeEntry(selectedProject()!)) {
      <p-message severity="warn" styleClass="w-full mb-3"
        [text]="timeLoggingBlockedMessage(selectedProject()!)" />
    }

    @if (selectedProject() && canCreateTimeEntry(selectedProject()!) && canCreate) {

      <div class="card p-3 mb-3">

        <h3 class="mt-0">Nouvelle ligne</h3>

        <div class="proj-field-row">

          <label>Date <p-datepicker [(ngModel)]="workDate" dateFormat="dd/mm/yy" /></label>

          <label>Tâche <p-select [options]="tasks()" [(ngModel)]="taskId" optionLabel="title" optionValue="id" placeholder="Tâche" [showClear]="true" /></label>

          <label>Heures <p-inputNumber [(ngModel)]="hours" [min]="0.25" [max]="24" [step]="0.25" /></label>

          <label class="flex-row align-items-center gap-2" style="flex-direction:row">

            <p-checkbox [(ngModel)]="isBillable" [binary]="true" inputId="billable" />

            <span>Facturable</span>

          </label>

          <label>Notes <input pInputText [(ngModel)]="notes" /></label>

          <app-button variant="primary" [disabled]="!canSaveLine" (click)="create()">Enregistrer</app-button>

        </div>

      </div>

    }

    @if (error()) { <p class="text-danger p-3" role="alert">{{ error() }}</p> }

    <p-table [value]="entries()" styleClass="p-datatable-sm">

      <ng-template pTemplate="header">

        <tr>

          <th>Date</th>

          <th>Projet</th>

          <th>Tâche</th>

          <th>Heures</th>

          <th>Facturable</th>

          <th>Statut</th>

          <th></th>

        </tr>

      </ng-template>

      <ng-template pTemplate="body" let-e>

        <tr>

          <td>{{ e.workDate | date:'shortDate' }}</td>

          <td>{{ e.projectName }}</td>

          <td>{{ e.taskTitle || '—' }}</td>

          <td>{{ e.hours }}</td>

          <td>{{ e.isBillable ? 'Oui' : 'Non' }}</td>

          <td>
            <app-status-badge [status]="timeEntryStatusBadge(e)" [label]="timeEntryStatusLabel(e)" />
          </td>

          <td class="proj-time-row-actions">

            @if (canEditTimeEntry(e) && canCreate) {
              <app-button size="sm" variant="ghost" icon="pi-pencil" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Modifier" tooltipPosition="top"
                ariaLabel="Modifier" (click)="openEdit(e)" />
            }

            @if (canDeleteTimeEntry(e) && canCreate) {
              <app-button size="sm" variant="ghost" icon="pi-trash" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Supprimer" tooltipPosition="top"
                ariaLabel="Supprimer" (click)="deleteEntry(e.id)" />
            }

            @if (canSubmitTimeEntry(e) && canSubmit) {
              <app-button size="sm" variant="ghost" icon="pi-send" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Soumettre" tooltipPosition="top"
                ariaLabel="Soumettre" (click)="submit(e.id)" />
            }

            @if (canValidateTimeEntry(e) && canValidate) {
              <app-button size="sm" variant="primary" icon="pi-check" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Valider" tooltipPosition="top"
                ariaLabel="Valider" (click)="validate(e.id)" />
            }

            @if (canReopenSubmittedTimeEntry(e) && canSubmit) {
              <app-button size="sm" variant="ghost" icon="pi-undo" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Rouvrir en brouillon" tooltipPosition="top"
                ariaLabel="Rouvrir en brouillon" (click)="reopen(e.id)" />
            }

            @if (canReopenValidatedTimeEntry(e) && canValidate) {
              <app-button size="sm" variant="ghost" icon="pi-undo" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Rouvrir en brouillon" tooltipPosition="top"
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
                pTooltip="Voir la facture"
                tooltipPosition="top"
                ariaLabel="Voir la facture" />

            }

          </td>

        </tr>

      </ng-template>

      <ng-template pTemplate="emptymessage">

        <tr><td colspan="7">

          <app-empty-state icon="pi-clock" title="Aucun temps" description="Choisissez un projet actif pour saisir une ligne." [showAction]="false" />

        </td></tr>

      </ng-template>

    </p-table>



    <p-dialog [(visible)]="editVisible" header="Modifier le temps" [modal]="true" [style]="{ width: '28rem' }">

      <div class="proj-field-stack">

        <label>Date <p-datepicker [(ngModel)]="editWorkDate" dateFormat="dd/mm/yy" /></label>

        <label>Tâche <p-select [options]="tasks()" [(ngModel)]="editTaskId" optionLabel="title" optionValue="id" [showClear]="true" /></label>

        <label>Heures <p-inputNumber [(ngModel)]="editHours" [min]="0.25" [max]="24" [step]="0.25" /></label>

        <label class="proj-field-stack__check">

          <p-checkbox [(ngModel)]="editBillable" [binary]="true" inputId="editBillableGlobal" />

          <span>Facturable</span>

        </label>

        <label>Notes <input pInputText class="w-full" [(ngModel)]="editNotes" /></label>

      </div>

      <ng-template pTemplate="footer">

        <app-button variant="secondary" (click)="editVisible = false">Annuler</app-button>

        <app-button variant="primary" [disabled]="!canSaveEditLine" (click)="saveEdit()">Enregistrer</app-button>

      </ng-template>

    </p-dialog>

  `,


})

export class ProjectTimeComponent implements OnInit {

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

          this.toast.add({ severity: 'success', summary: 'Temps enregistré' });

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

        this.toast.add({ severity: 'success', summary: 'Temps mis à jour' });

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
        this.toast.add({ severity: 'success', summary: 'Temps supprimé' });
        this.load();
      },
      error: err => this.error.set(this.errors.extractErrorMessage(err))
    });
  }

  reopen(id: string): void {
    this.api.reopenTime(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Temps rouvert en brouillon' });
        this.load();
      },
      error: err => this.error.set(this.errors.extractErrorMessage(err))
    });
  }

}

