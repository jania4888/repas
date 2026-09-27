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
        <app-button class="mb-3" variant="primary" (click)="activate.emit()" i18n="@@projects.tabs.activer.le.projet.1aa2449c">Activer le projet</app-button>
      }
    }



    <div class="proj-field-row mb-3">

      <label><ng-container i18n="@@projects.tabs.periode.de2110b7">Période

        </ng-container><p-datepicker [(ngModel)]="dateRange" selectionMode="range" dateFormat="dd/mm/yy" placeholder="Filtrer" i18n-placeholder="@@projects.tabs.filtrer.91561998" [showClear]="true" (onSelect)="applyFilters()" (onClear)="applyFilters()" />

      </label>

      <label><ng-container i18n="@@projects.tabs.statut.659499f3">Statut

        </ng-container><p-select [options]="statusFilterOptions" [(ngModel)]="statusFilter" optionLabel="label" optionValue="value" placeholder="Tous" i18n-placeholder="@@projects.tabs.tous.44ef5eb5" [showClear]="true" (onChange)="applyFilters()" />

      </label>

    </div>



    @if (project && canCreateTimeEntry(project) && canCreate) {

      <div class="card p-3 mb-3">

        <h3 class="mt-0" i18n="@@projects.tabs.nouvelle.ligne.21957286">Nouvelle ligne</h3>

        <div class="proj-field-row">

          <label><ng-container i18n="@@projects.tabs.date.eb9a4bc1">Date

            </ng-container><p-datepicker [(ngModel)]="workDate" dateFormat="dd/mm/yy" />

          </label>

          <label><ng-container i18n="@@projects.tabs.tache.43c8425c">Tâche

            </ng-container><p-select [options]="tasks" [(ngModel)]="taskId" optionLabel="title" optionValue="id" placeholder="Tâche" i18n-placeholder="@@projects.tabs.tache.0ee45862" [showClear]="true" />

          </label>

          <label><ng-container i18n="@@projects.tabs.heures.b4448c06">Heures

            </ng-container><p-inputNumber [(ngModel)]="hours" [min]="0.25" [max]="24" [step]="0.25" />

          </label>

          <label class="flex-row align-items-center gap-2" style="flex-direction:row">

            <p-checkbox [(ngModel)]="isBillable" [binary]="true" inputId="billableTab" />

            <span for="billableTab" i18n="@@projects.tabs.facturable.1a246798">Facturable</span>

          </label>

          <label><ng-container i18n="@@projects.tabs.notes.70440046">Notes

            </ng-container><input pInputText [(ngModel)]="notes" />

          </label>

          <app-button variant="primary" [disabled]="!canSaveLine" (click)="submit()" i18n="@@projects.tabs.enregistrer.f7c8bcd8">Enregistrer</app-button>

        </div>

      </div>

    }



    <p-table [value]="entries" styleClass="p-datatable-sm">

      <ng-template pTemplate="header">

        <tr><th i18n="@@projects.tabs.date.eb9a4bc1">Date</th><th i18n="@@projects.tabs.personne.6691d67a">Personne</th><th i18n="@@projects.tabs.tache.43c8425c">Tâche</th><th i18n="@@projects.tabs.heures.b4448c06">Heures</th><th i18n="@@projects.tabs.facturable.63134237">Facturable</th><th i18n="@@projects.tabs.statut.659499f3">Statut</th><th></th></tr>

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
                [iconAlwaysVisible]="true" pTooltip="Modifier" i18n-pTooltip="@@projects.tabs.modifier.99f59cf6" tooltipPosition="top"
                ariaLabel="Modifier" i18n-ariaLabel="@@projects.tabs.modifier.ead890f7" (click)="openEdit(e)" />
            }

            @if (canDeleteTimeEntry(e) && canCreate) {
              <app-button size="sm" variant="ghost" icon="pi-trash" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Supprimer" i18n-pTooltip="@@projects.tabs.supprimer.afe959c2" tooltipPosition="top"
                ariaLabel="Supprimer" i18n-ariaLabel="@@projects.tabs.supprimer.d9f6d96e" (click)="deleteEntry.emit(e.id)" />
            }

            @if (canSubmitTimeEntry(e) && canSubmit) {
              <app-button size="sm" variant="ghost" icon="pi-send" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Soumettre" i18n-pTooltip="@@projects.tabs.soumettre.ea813e98" tooltipPosition="top"
                ariaLabel="Soumettre" i18n-ariaLabel="@@projects.tabs.soumettre.6557d5be" (click)="submitEntry.emit(e.id)" />
            }

            @if (canValidateTimeEntry(e) && canValidate) {
              <app-button size="sm" variant="primary" icon="pi-check" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Valider" i18n-pTooltip="@@projects.tabs.valider.ccecc0b2" tooltipPosition="top"
                ariaLabel="Valider" i18n-ariaLabel="@@projects.tabs.valider.8ef67b67" (click)="validateEntry.emit(e.id)" />
            }

            @if (canReopenSubmittedTimeEntry(e) && canSubmit) {
              <app-button size="sm" variant="ghost" icon="pi-undo" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Rouvrir en brouillon" i18n-pTooltip="@@projects.tabs.rouvrir.en.brouillon.3f1983a1" tooltipPosition="top"
                ariaLabel="Rouvrir en brouillon" i18n-ariaLabel="@@projects.tabs.rouvrir.en.brouillon.000b775a" (click)="reopenEntry.emit(e.id)" />
            }

            @if (canReopenValidatedTimeEntry(e) && canValidate) {
              <app-button size="sm" variant="ghost" icon="pi-undo" [iconOnly]="true"
                [iconAlwaysVisible]="true" pTooltip="Rouvrir en brouillon" i18n-pTooltip="@@projects.tabs.rouvrir.en.brouillon.3f1983a1" tooltipPosition="top"
                ariaLabel="Rouvrir en brouillon" i18n-ariaLabel="@@projects.tabs.rouvrir.en.brouillon.000b775a" (click)="reopenEntry.emit(e.id)" />
            }

            @if (e.invoicedInvoiceId) {

              <app-button
                size="sm"
                variant="ghost"
                icon="pi-receipt"
                [iconOnly]="true"
                [iconAlwaysVisible]="true"
                [routerLink]="['/invoices', e.invoicedInvoiceId]"
                pTooltip="Voir la facture" i18n-pTooltip="@@projects.tabs.voir.la.facture.cd2665e8"
                tooltipPosition="top"
                ariaLabel="Voir la facture" i18n-ariaLabel="@@projects.tabs.voir.la.facture.23283cea" />

            }

          </td>

        </tr>

      </ng-template>

      <ng-template pTemplate="emptymessage">

        <tr><td colspan="7">

          <app-empty-state icon="pi-clock" title="Aucun temps saisi" i18n-title="@@projects.tabs.aucun.temps.saisi.954bf30b" description="Les temps projet sont indépendants des feuilles cabinet." i18n-description="@@projects.tabs.les.temps.projet.sont.independants.des.f.98ed5db8" [showAction]="false" />

        </td></tr>

      </ng-template>

    </p-table>



    <p-dialog [(visible)]="editVisible" header="Modifier le temps" i18n-header="@@projects.tabs.modifier.le.temps.7b614c8c" [modal]="true" [style]="{ width: '28rem' }">

      <div class="proj-field-stack">

        <label><ng-container i18n="@@projects.tabs.date.eb9a4bc1">Date </ng-container><p-datepicker [(ngModel)]="editWorkDate" dateFormat="dd/mm/yy" /></label>

        <label><ng-container i18n="@@projects.tabs.tache.43c8425c">Tâche </ng-container><p-select [options]="tasks" [(ngModel)]="editTaskId" optionLabel="title" optionValue="id" [showClear]="true" /></label>

        <label><ng-container i18n="@@projects.tabs.heures.b4448c06">Heures </ng-container><p-inputNumber [(ngModel)]="editHours" [min]="0.25" [max]="24" [step]="0.25" /></label>

        <label class="proj-field-stack__check">

          <p-checkbox [(ngModel)]="editBillable" [binary]="true" inputId="editBillable" />

          <span i18n="@@projects.tabs.facturable.db9bbbb2">Facturable</span>

        </label>

        <label><ng-container i18n="@@projects.tabs.notes.70440046">Notes </ng-container><input pInputText class="w-full" [(ngModel)]="editNotes" /></label>

      </div>

      <ng-template pTemplate="footer">

        <app-button variant="secondary" (click)="editVisible = false" i18n="@@projects.tabs.annuler.49ba3292">Annuler</app-button>

        <app-button variant="primary" [disabled]="!canSaveEditLine" (click)="saveEdit()" i18n="@@projects.tabs.enregistrer.f7c8bcd8">Enregistrer</app-button>

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

