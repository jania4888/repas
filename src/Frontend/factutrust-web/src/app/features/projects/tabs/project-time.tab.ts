/// <reference types="@angular/localize" />
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { RouterLink } from '@angular/router';

import { TableModule } from 'primeng/table';

import { DatePickerModule } from 'primeng/datepicker';

import { InputNumberModule } from 'primeng/inputnumber';

import { CheckboxModule } from 'primeng/checkbox';

import { InputTextModule } from 'primeng/inputtext';

import { SelectModule } from 'primeng/select';

import { MessageModule } from 'primeng/message';

import { DialogModule } from 'primeng/dialog';

import { TooltipModule } from 'primeng/tooltip';

import { ButtonComponent } from '@shared/components/button/button.component';

import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

import { ProjectDetail, ProjectTask, ProjectTimeEntry } from '../project-api.service';

import {
  canCreateTimeEntry,
  canDeleteTimeEntry,
  canEditTimeEntry,
  canReopenSubmittedTimeEntry,
  canReopenValidatedTimeEntry,
  canSubmitTimeEntry,
  canValidateTimeEntry,
  parseProjectStatus,
  parseProjectTimeStatus,
  timeEntryCreationBlockedMessage,
  timeEntryStatusBadge,
  timeEntryStatusLabel,
  toIsoDate,
  canSaveProjectTimeLine
} from '../project-enums';



export interface CreateTimePayload {

  projectId: string;

  taskId?: string | null;

  workDate: string;

  hours: number;

  isBillable: boolean;

  notes?: string;

}



export interface TimeFilterPayload {

  from?: string;

  to?: string;

  status?: string;

}



const TIME_STATUS_FILTER_OPTIONS = [

  { label: $localize`:@@projects.time.tab.filter.brouillon:Brouillon`, value: 'Draft' },

  { label: $localize`:@@projects.time.tab.filter.soumis:Soumis`, value: 'Submitted' },

  { label: $localize`:@@projects.time.tab.filter.valide:Validé`, value: 'Validated' }

];



@Component({

  selector: 'app-project-time-tab',

  standalone: true,

  imports: [

    CommonModule,

    FormsModule,

    RouterLink,

    TableModule,

    DatePickerModule,

    InputNumberModule,

    CheckboxModule,

    InputTextModule,

    SelectModule,

    MessageModule,

    DialogModule,

    TooltipModule,

    ButtonComponent,

    StatusBadgeComponent,

    EmptyStateComponent

  ],

  template: `

    @if (project && !canCreateTimeEntry(project)) {
      <p-message severity="warn" styleClass="w-full mb-3"
        [text]="timeLoggingBlockedMessage()" />
      @if (canActivate && isDraftProject(project)) {
        <app-button class="mb-3" variant="primary" (click)="activate.emit()">Activer le projet</app-button>
      }
    }



    <div class="proj-field-row mb-3">

      <label>Période

        <p-datepicker [(ngModel)]="dateRange" selectionMode="range" dateFormat="dd/mm/yy" placeholder="Filtrer" [showClear]="true" (onSelect)="applyFilters()" (onClear)="applyFilters()" />

      </label>

      <label>Statut

        <p-select [options]="statusFilterOptions" [(ngModel)]="statusFilter" optionLabel="label" optionValue="value" placeholder="Tous" [showClear]="true" (onChange)="applyFilters()" />

      </label>

    </div>



    @if (project && canCreateTimeEntry(project) && canCreate) {

      <div class="card p-3 mb-3">

        <h3 class="mt-0">Nouvelle ligne</h3>

        <div class="proj-field-row">

          <label>Date

            <p-datepicker [(ngModel)]="workDate" dateFormat="dd/mm/yy" />

          </label>

          <label>Tâche

            <p-select [options]="tasks" [(ngModel)]="taskId" optionLabel="title" optionValue="id" placeholder="Tâche" [showClear]="true" />

          </label>

          <label>Heures

            <p-inputNumber [(ngModel)]="hours" [min]="0.25" [max]="24" [step]="0.25" />

          </label>

          <label class="flex-row align-items-center gap-2" style="flex-direction:row">

            <p-checkbox [(ngModel)]="isBillable" [binary]="true" inputId="billableTab" />

            <span for="billableTab">Facturable</span>

          </label>

          <label>Notes

            <input pInputText [(ngModel)]="notes" />

          </label>

          <app-button variant="primary" [disabled]="!canSaveLine" (click)="submit()">Enregistrer</app-button>

        </div>

      </div>

    }



    <p-table [value]="entries" styleClass="p-datatable-sm">

      <ng-template pTemplate="header">

        <tr><th>Date</th><th>Personne</th><th>Tâche</th><th>Heures</th><th>Facturable</th><th>Statut</th><th></th></tr>

      </ng-template>

      <ng-template pTemplate="body" let-e>

        <tr>

          <td>{{ e.workDate | date:'shortDate' }}</td>

          <td>{{ e.userName }}</td>

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
                ariaLabel="Supprimer" (click)="deleteEntry.emit(e.id)" />
            }

            @if (canSubmitTimeEntry(e) && canSubmit) {
              <app-button size="sm" variant="ghost" icon="pi-send" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Soumettre" tooltipPosition="top"
                ariaLabel="Soumettre" (click)="submitEntry.emit(e.id)" />
            }

            @if (canValidateTimeEntry(e) && canValidate) {
              <app-button size="sm" variant="primary" icon="pi-check" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Valider" tooltipPosition="top"
                ariaLabel="Valider" (click)="validateEntry.emit(e.id)" />
            }

            @if (canReopenSubmittedTimeEntry(e) && canSubmit) {
              <app-button size="sm" variant="ghost" icon="pi-undo" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Rouvrir en brouillon" tooltipPosition="top"
                ariaLabel="Rouvrir en brouillon" (click)="reopenEntry.emit(e.id)" />
            }

            @if (canReopenValidatedTimeEntry(e) && canValidate) {
              <app-button size="sm" variant="ghost" icon="pi-undo" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Rouvrir en brouillon" tooltipPosition="top"
                ariaLabel="Rouvrir en brouillon" (click)="reopenEntry.emit(e.id)" />
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

          <app-empty-state icon="pi-clock" title="Aucun temps saisi" description="Les temps projet sont indépendants des feuilles cabinet." [showAction]="false" />

        </td></tr>

      </ng-template>

    </p-table>



    <p-dialog [(visible)]="editVisible" header="Modifier le temps" [modal]="true" [style]="{ width: '28rem' }">

      <div class="proj-field-stack">

        <label>Date <p-datepicker [(ngModel)]="editWorkDate" dateFormat="dd/mm/yy" /></label>

        <label>Tâche <p-select [options]="tasks" [(ngModel)]="editTaskId" optionLabel="title" optionValue="id" [showClear]="true" /></label>

        <label>Heures <p-inputNumber [(ngModel)]="editHours" [min]="0.25" [max]="24" [step]="0.25" /></label>

        <label class="proj-field-stack__check">

          <p-checkbox [(ngModel)]="editBillable" [binary]="true" inputId="editBillable" />

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

export class ProjectTimeTabComponent {

  @Input() project: ProjectDetail | null = null;

  @Input() entries: ProjectTimeEntry[] = [];

  @Input() tasks: ProjectTask[] = [];

  @Input() canCreate = false;

  @Input() canSubmit = false;

  @Input() canValidate = false;

  @Input() canActivate = false;

  @Output() create = new EventEmitter<CreateTimePayload>();

  @Output() updateEntry = new EventEmitter<{ id: string; payload: CreateTimePayload }>();

  @Output() filterChange = new EventEmitter<TimeFilterPayload>();

  @Output() submitEntry = new EventEmitter<string>();

  @Output() validateEntry = new EventEmitter<string>();

  @Output() deleteEntry = new EventEmitter<string>();

  @Output() reopenEntry = new EventEmitter<string>();

  @Output() activate = new EventEmitter<void>();



  workDate = new Date();

  hours = 8;

  isBillable = true;

  notes = '';

  taskId: string | null = null;

  dateRange: Date[] | null = null;

  statusFilter: string | null = null;

  readonly statusFilterOptions = TIME_STATUS_FILTER_OPTIONS;



  editVisible = false;

  private editId = '';

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

  timeLoggingBlockedMessage(): string {
    if (!this.project) return '';
    return timeEntryCreationBlockedMessage(this.project.status);
  }

  get canSaveLine(): boolean {
    return canSaveProjectTimeLine(this.taskId, this.hours);
  }

  get canSaveEditLine(): boolean {
    return canSaveProjectTimeLine(this.editTaskId, this.editHours);
  }

  isDraftProject(project: ProjectDetail): boolean {
    return parseProjectStatus(project.status) === 'Draft';
  }

  applyFilters(): void {

    const from = this.dateRange?.[0] ? toIsoDate(this.dateRange[0])?.slice(0, 10) : undefined;

    const to = this.dateRange?.[1] ? toIsoDate(this.dateRange[1])?.slice(0, 10) : undefined;

    this.filterChange.emit({

      from: from ?? undefined,

      to: to ?? undefined,

      status: this.statusFilter ?? undefined

    });

  }



  submit(): void {

    if (!this.project || !this.canSaveLine) return;

    const workDate = toIsoDate(this.workDate);

    if (!workDate) return;

    this.create.emit({

      projectId: this.project.id,

      taskId: this.taskId,

      workDate,

      hours: this.hours,

      isBillable: this.isBillable,

      notes: this.notes

    });

    this.notes = '';

  }



  openEdit(e: ProjectTimeEntry): void {

    this.editId = e.id;

    this.editWorkDate = new Date(e.workDate);

    this.editHours = e.hours;

    this.editBillable = e.isBillable;

    this.editNotes = e.notes ?? '';

    this.editTaskId = e.taskId ?? null;

    this.editVisible = true;

  }



  saveEdit(): void {

    if (!this.project || !this.canSaveEditLine) return;

    const workDate = toIsoDate(this.editWorkDate);

    if (!workDate) return;

    this.updateEntry.emit({

      id: this.editId,

      payload: {

        projectId: this.project.id,

        taskId: this.editTaskId,

        workDate,

        hours: this.editHours,

        isBillable: this.editBillable,

        notes: this.editNotes

      }

    });

    this.editVisible = false;

  }

}

