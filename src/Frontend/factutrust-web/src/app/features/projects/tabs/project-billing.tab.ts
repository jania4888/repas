import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { RouterLink } from '@angular/router';

import { TableModule } from 'primeng/table';

import { InputTextModule } from 'primeng/inputtext';

import { InputNumberModule } from 'primeng/inputnumber';

import { SelectModule } from 'primeng/select';

import { DatePickerModule } from 'primeng/datepicker';

import { MessageModule } from 'primeng/message';

import { DialogModule } from 'primeng/dialog';

import { ProgressBarModule } from 'primeng/progressbar';

import { CheckboxModule } from 'primeng/checkbox';

import { ButtonComponent } from '@shared/components/button/button.component';

import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';

import { ProjectInvoicesSectionComponent } from '../components/project-invoices-section.component';
import {
  ProjectInvoiceTargetChoice,
  ProjectInvoiceTargetDialogComponent
} from '../components/project-invoice-target-dialog.component';

import {

  ProjectApiService,

  ProjectBillingReadiness,

  BillableProjectTask,

  BillableProjectTimeEntry,

  ProjectDetail,

  ProjectDraftInvoice,

  ProjectMilestone,

  ProjectSituation,

  ProjectSubcontractor

} from '../project-api.service';

import {

  TUNISIAN_VAT_OPTIONS,

  canActivate,

  canBeBilled,

  isBtp,

  isFixedPriceBilling,

  parseProjectSituationStatus,

  showMilestones,

  situationStatusBadge,

  toIsoDate

} from '../project-enums';



export interface SupplierOption {

  id: string;

  name: string;

}



const TIME_GROUP_OPTIONS = [

  { label: 'Par membre', value: 'member' },

  { label: 'Par tâche', value: 'task' }

];



const TASK_BILLING_METHOD_OPTIONS = [

  { label: 'Forfaitaire', value: 'fixed' },

  { label: 'À l\'heure', value: 'hourly' }

];



@Component({

  selector: 'app-project-billing-tab',

  standalone: true,

  imports: [

    CommonModule,

    FormsModule,

    RouterLink,

    TableModule,

    InputTextModule,

    InputNumberModule,

    SelectModule,

    DatePickerModule,

    MessageModule,

    DialogModule,

    ProgressBarModule,

    CheckboxModule,

    ButtonComponent,

    StatusBadgeComponent,

    ProjectInvoicesSectionComponent,
    ProjectInvoiceTargetDialogComponent

  ],

  template: `

    @if (project && !canBeBilled(project.status)) {

      @if (readiness?.blockers?.length) {

        <ul class="blockers mb-3">

          @for (b of readiness!.blockers; track b) {

            <li>{{ b }}</li>

          }

        </ul>

      } @else {

        <p-message severity="warn" styleClass="w-full mb-3"

          text="Activez le projet (statut Brouillon) avant de facturer. La facturation est réservée aux projets Actif ou Terminé." />

      }

      @if (canActivate(project.status) && canUpdate) {

        <app-button class="mb-3" variant="primary" (click)="activate.emit()">Activer le projet</app-button>

      }

    }



    @if (readiness) {

      <div class="card p-3 mb-3">

        <h3 class="mt-0">Prérequis de facturation</h3>

        @if (readiness.blockers.length) {

          <ul class="m-0 pl-3 mb-2">

            @for (b of readiness.blockers; track b) {

              <li>{{ b }}</li>

            }

          </ul>

        }

        <ul class="m-0 pl-3">

          <li>Statut : {{ readiness.statusDisplay }} {{ readiness.canBill ? '✓' : '✗' }}</li>

          <li>Temps validés non facturés : {{ readiness.validatedUninvoicedHours | number:'1.0-1' }} h</li>

          <li>Équipe sans tarif de vente :

            @if (readiness.membersWithoutRate.length) {

              {{ readiness.membersWithoutRate.join(', ') }}

            } @else { aucun }

          </li>

        </ul>

      </div>

    }



    @if (project && canBeBilled(project.status) && canBill) {

      <div class="card p-3 mb-3">

        <h3 class="mt-0">Facturation régie</h3>

        <div class="proj-field-row">

          <label>Grouper par

            <p-select [options]="groupOptions" [(ngModel)]="timeGroupBy" optionLabel="label" optionValue="value" (ngModelChange)="onTimeGroupByChange()" />

          </label>

          @if (timeGroupBy === 'member') {

            <label>Notes

              <input pInputText [(ngModel)]="timeNotes" placeholder="Notes facture" />

            </label>

            <app-button variant="primary" [disabled]="!canInvoiceSelectedTime || invoiceTargetLoading" (click)="openInvoiceTargetDialog('time')">Facturer la sélection</app-button>

          }

        </div>



        @if (timeGroupBy === 'member') {

          @if (!billableTimeEntries.length) {

            <p class="text-muted mt-2 mb-0">Aucun temps éligible à la facturation.</p>

          } @else {

            @if (selectedTimeSummary.hours > 0) {

              <p class="time-selection-summary mt-2 mb-2">

                {{ selectedTimeSummary.hours | number:'1.0-2' }} h sélectionnées ·

                {{ selectedTimeSummary.amountHt | number:'1.3-3' }} {{ project.currency || 'TND' }} HT

              </p>

            }

            <p-table [value]="billableTimeEntries" styleClass="p-datatable-sm mt-2">

              <ng-template pTemplate="header">

                <tr>

                  <th style="width: 3rem">

                    <p-checkbox

                      [binary]="true"

                      [ngModel]="allEligibleTimeSelected"

                      (ngModelChange)="toggleAllEligibleTime($event)"

                      [disabled]="eligibleTimeEntries.length === 0"

                      inputId="bill-time-all" />

                  </th>

                  <th>Date</th>

                  <th>Membre</th>

                  <th>Tâche</th>

                  <th>Heures</th>

                  <th>Tarif h</th>

                  <th>Montant HT</th>

                </tr>

              </ng-template>

              <ng-template pTemplate="body" let-e>

                <tr [class.text-muted]="!e.isEligible">

                  <td>

                    <p-checkbox

                      [binary]="true"

                      [ngModel]="isTimeEntrySelected(e.id)"

                      (ngModelChange)="toggleTimeEntrySelected(e.id, $event)"

                      [disabled]="!e.isEligible"

                      [inputId]="'bill-time-' + e.id" />

                  </td>

                  <td>{{ e.workDate | date:'dd/MM/yyyy' }}</td>

                  <td>{{ e.userName }}</td>

                  <td>

                    {{ e.taskTitle || '—' }}

                    @if (e.blockReason) {

                      <div class="text-sm text-muted">{{ e.blockReason }}</div>

                    }

                  </td>

                  <td>{{ e.hours | number:'1.0-2' }}</td>

                  <td>{{ e.hourlyRate | number:'1.3-3' }}</td>

                  <td>{{ e.previewAmountHt | number:'1.3-3' }}</td>

                </tr>

              </ng-template>

            </p-table>

          }

        }



        @if (timeGroupBy === 'task') {

          <div class="proj-field-row mt-2">

            <label>Mode de facturation

              <p-select [options]="taskBillingMethodOptions" [(ngModel)]="taskBillingMethod" optionLabel="label" optionValue="value" (ngModelChange)="onTaskBillingMethodChange()" />

            </label>

            <label>Notes

              <input pInputText [(ngModel)]="timeNotes" placeholder="Notes facture" />

            </label>

            <app-button variant="primary" [disabled]="!canInvoiceTasks || invoiceTargetLoading" (click)="openInvoiceTargetDialog('tasks')">Facturer les tâches sélectionnées</app-button>

          </div>



          @if (!billableTasks.length) {

            <p class="text-muted mt-2 mb-0">Aucune tâche facturable pour ce mode.</p>

          } @else {

            <p-table [value]="billableTasks" styleClass="p-datatable-sm mt-2">

              <ng-template pTemplate="header">

                <tr>

                  <th style="width: 3rem"></th>

                  <th>Tâche</th>

                  @if (taskBillingMethod === 'hourly') {

                    <th>Heures</th>

                    <th>Tarif h</th>

                    <th>Montant HT</th>

                  } @else {

                    <th>Montant HT</th>

                  }

                </tr>

              </ng-template>

              <ng-template pTemplate="body" let-t>

                <tr [class.text-muted]="taskBillingMethod === 'hourly' && !t.isEligible">

                  <td>

                    <p-checkbox

                      [binary]="true"

                      [ngModel]="isTaskSelected(t.id)"

                      (ngModelChange)="toggleTaskSelected(t.id, $event)"

                      [disabled]="taskBillingMethod === 'hourly' && !t.isEligible"

                      [inputId]="'bill-task-' + t.id" />

                  </td>

                  <td>

                    {{ t.title }}

                    @if (t.blockReason) {

                      <div class="text-sm text-muted">{{ t.blockReason }}</div>

                    }

                  </td>

                  @if (taskBillingMethod === 'hourly') {

                    <td>{{ t.uninvoicedBillableHours | number:'1.0-1' }} h</td>

                    <td>

                      @if (t.isEligible) {

                        <p-inputNumber

                          [(ngModel)]="taskHourlyRates[t.id]"

                          mode="decimal"

                          [minFractionDigits]="3"

                          [min]="0"

                          placeholder="Tarif h" />

                      } @else {

                        {{ t.hourlyRate | number:'1.3-3' }}

                      }

                    </td>

                    <td>{{ taskHourlyTotal(t.id) | number:'1.3-3' }}</td>

                  } @else {

                    <td>

                      @if (isTaskSelected(t.id)) {

                        <p-inputNumber

                          [(ngModel)]="taskAmounts[t.id]"

                          mode="decimal"

                          [minFractionDigits]="3"

                          [min]="0"

                          placeholder="Montant HT" />

                      } @else {

                        —

                      }

                    </td>

                  }

                </tr>

              </ng-template>

            </p-table>

          }

        }

      </div>

    }



    @if (project && isFixedPriceBilling(project.billingMode) && canBeBilled(project.status) && canBill) {

      <div class="card p-3 mb-3">

        <h3 class="mt-0">Forfait</h3>

        <div class="proj-field-row">

          <label>Montant HT

            <p-inputNumber [(ngModel)]="fixedPriceAmount" mode="decimal" [minFractionDigits]="3" />

          </label>

          <label>Notes

            <input pInputText [(ngModel)]="fixedPriceNotes" />

          </label>

          <app-button variant="primary" [disabled]="fixedPriceInvoiced" (click)="emitFixedPrice()">Facturer le forfait</app-button>

        </div>

      </div>

    }



    @if (project && showMilestones(project.kind, project.billingMode)) {

      <h3>Jalons</h3>

      @if (canBill) {

        <div class="proj-field-row mb-2">

          <label>Nom <input pInputText [(ngModel)]="milestoneName" /></label>

          <label>% <p-inputNumber [(ngModel)]="milestonePercent" [min]="0" [max]="100" /></label>

          <label>Montant HT <p-inputNumber [(ngModel)]="milestoneAmount" /></label>

          <label>Échéance <p-datepicker [(ngModel)]="milestoneDue" dateFormat="dd/mm/yy" [showClear]="true" /></label>

          <app-button (click)="addMs()">Ajouter</app-button>

        </div>

      }

      <p-table [value]="milestones" styleClass="p-datatable-sm">

        <ng-template pTemplate="header"><tr><th>Jalon</th><th>%</th><th>Montant</th><th>Échéance</th><th></th></tr></ng-template>

        <ng-template pTemplate="body" let-m>

          <tr>

            <td>{{ m.name }}</td>

            <td>{{ m.percent }}</td>

            <td>{{ m.amountHt | number:'1.3-3' }}</td>

            <td>{{ m.dueDate ? (m.dueDate | date:'shortDate') : '—' }}</td>

            <td>

              @if (!m.invoicedInvoiceId && canBill && project && canBeBilled(project.status)) {

                <app-button size="sm" (click)="invoiceMilestone.emit(m.id)">Facturer</app-button>

              } @else if (m.invoicedInvoiceId) {

                <a [routerLink]="['/invoices', m.invoicedInvoiceId]">Facture</a>

              }

            </td>

          </tr>

        </ng-template>

      </p-table>

    }



    @if (project && isBtp(project.kind)) {

      @if (latestSituationPercent != null) {

        <div class="card p-3 mb-3">

          <h3 class="mt-0">Avancement cumulé chantier</h3>

          <p-progressBar [value]="latestSituationPercent" [showValue]="true" />

        </div>

      }

      <h3>Situations de travaux</h3>

      @if (canBill) {

        <div class="proj-field-row mb-2">

          <label>Début <p-datepicker [(ngModel)]="sitStart" dateFormat="dd/mm/yy" /></label>

          <label>Fin <p-datepicker [(ngModel)]="sitEnd" dateFormat="dd/mm/yy" /></label>

          <label>% cumulé <p-inputNumber [(ngModel)]="sitPercent" /></label>

          <label>Brut HT <p-inputNumber [(ngModel)]="sitGross" /></label>

          <label>Retenue <p-inputNumber [(ngModel)]="sitRetainage" /></label>

          <label>TVA

            <p-select [options]="vatOptions" [(ngModel)]="sitVat" optionLabel="label" optionValue="value" />

          </label>

          <app-button (click)="addSit()">Nouvelle situation</app-button>

        </div>

      }

      <p-table [value]="situations" styleClass="p-datatable-sm">

        <ng-template pTemplate="header"><tr><th>N°</th><th>%</th><th>Net HT</th><th>Retenue</th><th>TTC</th><th>Statut</th><th></th></tr></ng-template>

        <ng-template pTemplate="body" let-s>

          <tr>

            <td>{{ s.number }}</td>

            <td>{{ s.cumulativePercent }}</td>

            <td>{{ s.netAmountHt | number:'1.3-3' }}</td>

            <td>{{ s.retainageAmountHt | number:'1.3-3' }}</td>

            <td>{{ s.totalTtc | number:'1.3-3' }}</td>

            <td><app-status-badge [status]="situationStatusBadge(s.status)" [label]="s.statusDisplay" /></td>

            <td>

              @if (parseProjectSituationStatus(s.status) === 'Draft' && canBill) {

                <app-button size="sm" variant="outline" (click)="openEditSituation(s)">Modifier</app-button>

                <app-button size="sm" (click)="validateSituation.emit(s.id)">Valider</app-button>

              }

              @if (parseProjectSituationStatus(s.status) === 'Validated' && !s.invoiceId && canBill && project && canBeBilled(project.status)) {

                <app-button size="sm" (click)="invoiceSituation.emit(s.id)">Facturer</app-button>

              }

              @if (s.invoiceId) {

                <a [routerLink]="['/invoices', s.invoiceId]">Facture</a>

              }

            </td>

          </tr>

        </ng-template>

      </p-table>

      <h3>Sous-traitants</h3>

      @if (canUpdate) {

        <div class="proj-field-row mb-2">

          <label>Fournisseur <p-select [options]="suppliers" [(ngModel)]="subSupplierId" optionLabel="name" optionValue="id" placeholder="Fournisseur" /></label>

          <label>Marché <input pInputText [(ngModel)]="subRef" /></label>

          <label>Montant HT <p-inputNumber [(ngModel)]="subAmount" /></label>

          <label>Retenue % <p-inputNumber [(ngModel)]="subRetainage" /></label>

          <app-button (click)="addSub()">Ajouter</app-button>

        </div>

      }

      <p-table [value]="subs" styleClass="p-datatable-sm">

        <ng-template pTemplate="header"><tr><th>Fournisseur</th><th>Marché</th><th>Montant</th><th>Retenue %</th>@if (canUpdate) { <th></th> }</tr></ng-template>

        <ng-template pTemplate="body" let-s>

          <tr>

            <td>{{ s.supplierName }}</td>

            <td>{{ s.contractReference }}</td>

            <td>{{ s.amountHt | number:'1.3-3' }}</td>

            <td>{{ s.retainagePercent }}</td>

            @if (canUpdate) {

              <td><app-button size="sm" variant="outline" (click)="openEditSub(s)">Modifier</app-button></td>

            }

          </tr>

        </ng-template>

      </p-table>

    }



    <p-dialog [(visible)]="sitEditVisible" header="Modifier la situation" [modal]="true" [style]="{ width: '32rem' }">

      <div class="proj-field-stack">

        <label>Début <p-datepicker [(ngModel)]="editSitStart" dateFormat="dd/mm/yy" /></label>

        <label>Fin <p-datepicker [(ngModel)]="editSitEnd" dateFormat="dd/mm/yy" /></label>

        <label>% cumulé <p-inputNumber [(ngModel)]="editSitPercent" /></label>

        <label>Brut HT <p-inputNumber [(ngModel)]="editSitGross" /></label>

        <label>Retenue <p-inputNumber [(ngModel)]="editSitRetainage" /></label>

        <label>TVA <p-select [options]="vatOptions" [(ngModel)]="editSitVat" optionLabel="label" optionValue="value" /></label>

      </div>

      <ng-template pTemplate="footer">

        <app-button variant="secondary" (click)="sitEditVisible = false">Annuler</app-button>

        <app-button variant="primary" (click)="saveSituation()">Enregistrer</app-button>

      </ng-template>

    </p-dialog>



    <p-dialog [(visible)]="subEditVisible" header="Modifier le sous-traitant" [modal]="true" [style]="{ width: '28rem' }">

      <div class="proj-field-stack">

        <label>Marché <input pInputText class="w-full" [(ngModel)]="editSubRef" /></label>

        <label>Montant HT <p-inputNumber [(ngModel)]="editSubAmount" /></label>

        <label>Retenue % <p-inputNumber [(ngModel)]="editSubRetainage" /></label>

      </div>

      <ng-template pTemplate="footer">

        <app-button variant="secondary" (click)="subEditVisible = false">Annuler</app-button>

        <app-button variant="primary" (click)="saveSub()">Enregistrer</app-button>

      </ng-template>

    </p-dialog>



    @if (project) {
      <app-project-invoices-section
        [projectId]="project.id"
        [currency]="project.currency"
        [refreshToken]="invoicesRefreshToken" />
    }

    @if (project) {
      <app-project-invoice-target-dialog
        [(visible)]="invoiceTargetVisible"
        [preloadedDrafts]="preloadedDraftInvoices"
        (chosen)="onInvoiceTargetChosen($event)" />
    }

  `,

  styles: [`

    .blockers { color: var(--red-500, #dc2626); padding-left: 1.25rem; }

    .time-selection-summary {

      font-size: var(--font-size-sm);

      color: var(--color-neutral-700);

      font-weight: var(--font-weight-medium);

    }

  `],

})

export class ProjectBillingTabComponent implements OnChanges {

  private readonly api = inject(ProjectApiService);

  @Input() project: ProjectDetail | null = null;

  @Input() readiness: ProjectBillingReadiness | null = null;

  @Input() billableTasks: BillableProjectTask[] = [];

  @Input() billableTimeEntries: BillableProjectTimeEntry[] = [];

  @Input() milestones: ProjectMilestone[] = [];

  @Input() situations: ProjectSituation[] = [];

  @Input() subs: ProjectSubcontractor[] = [];

  @Input() suppliers: SupplierOption[] = [];

  @Input() canBill = false;

  @Input() canUpdate = false;

  @Input() invoicesRefreshToken = 0;

  @Output() activate = new EventEmitter<void>();

  @Output() invoiceTime = new EventEmitter<{ groupBy: string; notes?: string; timeEntryIds: string[]; targetInvoiceId?: string }>();

  @Output() invoiceTasks = new EventEmitter<{ method: 'fixed' | 'hourly'; notes?: string; tasks: { taskId: string; amountHt?: number; hourlyRate?: number }[]; targetInvoiceId?: string }>();

  @Output() invoiceDraftLoadError = new EventEmitter<string>();

  @Output() refreshBillableTasks = new EventEmitter<'fixed' | 'hourly'>();

  @Output() refreshBillableTimeEntries = new EventEmitter<void>();

  @Output() invoiceFixedPrice = new EventEmitter<{ amountHt: number; notes?: string }>();

  @Output() addMilestone = new EventEmitter<{ name: string; percent: number; amountHt: number; dueDate?: string | null }>();

  @Output() invoiceMilestone = new EventEmitter<string>();

  @Output() addSituation = new EventEmitter<{

    periodStart: string;

    periodEnd: string;

    cumulativePercent: number;

    grossAmountHt: number;

    retainageAmountHt: number;

    vatRatePercent: number;

  }>();

  @Output() updateSituation = new EventEmitter<{

    id: string;

    payload: {

      periodStart: string;

      periodEnd: string;

      cumulativePercent: number;

      grossAmountHt: number;

      retainageAmountHt: number;

      vatRatePercent: number;

    };

  }>();

  @Output() validateSituation = new EventEmitter<string>();

  @Output() invoiceSituation = new EventEmitter<string>();

  @Output() addSubcontractor = new EventEmitter<{

    supplierId: string;

    contractReference?: string;

    amountHt: number;

    retainagePercent: number;

  }>();

  @Output() updateSubcontractor = new EventEmitter<{

    id: string;

    payload: { contractReference?: string; amountHt: number; retainagePercent: number };

  }>();



  milestoneName = '';

  milestoneAmount = 0;

  milestonePercent = 0;

  milestoneDue: Date | null = null;

  sitPercent = 0;

  sitGross = 0;

  sitRetainage = 0;

  sitVat = 19;

  sitStart = new Date();

  sitEnd = new Date();

  subSupplierId = '';

  subRef = '';

  subAmount = 0;

  subRetainage = 0;

  timeGroupBy = 'member';

  taskBillingMethod: 'fixed' | 'hourly' = 'hourly';

  selectedTaskIds = new Set<string>();

  selectedTimeEntryIds = new Set<string>();

  taskAmounts: Record<string, number> = {};

  taskHourlyRates: Record<string, number> = {};

  timeNotes = '';

  fixedPriceAmount = 0;

  fixedPriceNotes = '';

  fixedPriceInvoiced = false;



  sitEditVisible = false;

  private editSitId = '';

  editSitStart = new Date();

  editSitEnd = new Date();

  editSitPercent = 0;

  editSitGross = 0;

  editSitRetainage = 0;

  editSitVat = 19;



  subEditVisible = false;

  private editSubId = '';

  editSubRef = '';

  editSubAmount = 0;

  editSubRetainage = 0;



  readonly groupOptions = TIME_GROUP_OPTIONS;

  readonly taskBillingMethodOptions = TASK_BILLING_METHOD_OPTIONS;

  readonly vatOptions = TUNISIAN_VAT_OPTIONS;

  readonly canBeBilled = canBeBilled;

  readonly canActivate = canActivate;

  readonly isBtp = isBtp;

  readonly isFixedPriceBilling = isFixedPriceBilling;

  readonly showMilestones = showMilestones;

  readonly parseProjectSituationStatus = parseProjectSituationStatus;

  readonly situationStatusBadge = situationStatusBadge;



  ngOnChanges(changes: SimpleChanges): void {
    if (changes['project']?.currentValue && this.fixedPriceAmount === 0) {
      this.fixedPriceAmount = (changes['project'].currentValue as ProjectDetail).budgetHt;
    }

    if (changes['billableTimeEntries']) {
      this.selectedTimeEntryIds.clear();
    }

    if (changes['billableTasks'] && this.taskBillingMethod === 'hourly') {
      for (const t of this.billableTasks) {
        if (t.isEligible) {
          this.taskHourlyRates[t.id] = t.hourlyRate;
        }
      }
    }
  }



  get canInvoiceTime(): boolean {

    if (this.readiness?.canInvoiceTime !== undefined) {

      return this.readiness.canInvoiceTime;

    }

    return !!this.readiness && this.readiness.canBill && this.readiness.validatedUninvoicedHours > 0

      && this.readiness.membersWithoutRate.length === 0;

  }



  get canInvoiceSelectedTime(): boolean {

    if (this.selectedTimeEntryIds.size === 0) return false;

    return [...this.selectedTimeEntryIds].every(id => {

      const entry = this.billableTimeEntries.find(e => e.id === id);

      return !!entry?.isEligible;

    });

  }



  get eligibleTimeEntries(): BillableProjectTimeEntry[] {

    return this.billableTimeEntries.filter(e => e.isEligible);

  }



  get allEligibleTimeSelected(): boolean {

    const eligible = this.eligibleTimeEntries;

    return eligible.length > 0 && eligible.every(e => this.selectedTimeEntryIds.has(e.id));

  }



  get selectedTimeSummary(): { hours: number; amountHt: number } {

    let hours = 0;

    let amountHt = 0;

    for (const id of this.selectedTimeEntryIds) {

      const entry = this.billableTimeEntries.find(e => e.id === id);

      if (entry?.isEligible) {

        hours += entry.hours;

        amountHt += entry.previewAmountHt;

      }

    }

    return { hours, amountHt };

  }



  get canInvoiceTasks(): boolean {

    if (!this.selectedTaskIds.size) return false;

    if (this.taskBillingMethod === 'fixed') {

      return [...this.selectedTaskIds].every(id => (this.taskAmounts[id] ?? 0) > 0);

    }

    return [...this.selectedTaskIds].every(id => {

      const task = this.billableTasks.find(t => t.id === id);

      return !!task?.isEligible && (this.taskHourlyRates[id] ?? 0) > 0;

    });

  }



  get latestSituationPercent(): number | null {

    if (!this.situations.length) return null;

    const sorted = [...this.situations].sort((a, b) => b.number - a.number);

    return sorted[0]?.cumulativePercent ?? null;

  }



  invoiceTargetVisible = false;
  invoiceTargetLoading = false;
  preloadedDraftInvoices: ProjectDraftInvoice[] = [];
  private pendingInvoiceAction: 'time' | 'tasks' | null = null;

  openInvoiceTargetDialog(action: 'time' | 'tasks'): void {
    if (!this.project || this.invoiceTargetLoading) return;
    this.pendingInvoiceAction = action;
    this.invoiceTargetLoading = true;
    this.api.compatibleDraftInvoices(this.project.id).subscribe({
      next: res => {
        this.invoiceTargetLoading = false;
        if (!res.success) {
          this.invoiceDraftLoadError.emit(res.message || 'Impossible de charger les factures brouillon.');
          this.pendingInvoiceAction = null;
          return;
        }
        const drafts = res.data ?? [];
        if (drafts.length === 0) {
          this.onInvoiceTargetChosen({});
          return;
        }
        this.preloadedDraftInvoices = drafts;
        this.invoiceTargetVisible = true;
      },
      error: () => {
        this.invoiceTargetLoading = false;
        this.pendingInvoiceAction = null;
        this.invoiceDraftLoadError.emit('Impossible de charger les factures brouillon.');
      }
    });
  }

  onInvoiceTargetChosen(choice: ProjectInvoiceTargetChoice): void {
    const targetInvoiceId = choice.targetInvoiceId;
    if (this.pendingInvoiceAction === 'time') {
      this.emitInvoiceTime(targetInvoiceId);
    } else if (this.pendingInvoiceAction === 'tasks') {
      this.emitInvoiceTasks(targetInvoiceId);
    }
    this.pendingInvoiceAction = null;
    this.preloadedDraftInvoices = [];
  }

  emitInvoiceTime(targetInvoiceId?: string): void {

    this.invoiceTime.emit({

      groupBy: 'member',

      notes: this.timeNotes || undefined,

      timeEntryIds: [...this.selectedTimeEntryIds],

      targetInvoiceId

    });

  }



  onTimeGroupByChange(): void {

    this.selectedTaskIds.clear();

    this.selectedTimeEntryIds.clear();

    this.taskAmounts = {};

    this.taskHourlyRates = {};

    if (this.timeGroupBy === 'task') {

      this.refreshBillableTasks.emit(this.taskBillingMethod);

    } else if (this.timeGroupBy === 'member') {

      this.refreshBillableTimeEntries.emit();

    }

  }



  onTaskBillingMethodChange(): void {

    this.selectedTaskIds.clear();

    this.taskAmounts = {};

    this.taskHourlyRates = {};

    this.refreshBillableTasks.emit(this.taskBillingMethod);

  }



  isTaskSelected(taskId: string): boolean {

    return this.selectedTaskIds.has(taskId);

  }



  isTimeEntrySelected(entryId: string): boolean {

    return this.selectedTimeEntryIds.has(entryId);

  }



  toggleTimeEntrySelected(entryId: string, selected: boolean): void {

    if (selected) this.selectedTimeEntryIds.add(entryId);

    else this.selectedTimeEntryIds.delete(entryId);

  }



  toggleAllEligibleTime(selected: boolean): void {

    if (selected) {

      for (const e of this.eligibleTimeEntries) {

        this.selectedTimeEntryIds.add(e.id);

      }

    } else {

      for (const e of this.eligibleTimeEntries) {

        this.selectedTimeEntryIds.delete(e.id);

      }

    }

  }



  toggleTaskSelected(taskId: string, selected: boolean): void {

    if (selected) {

      this.selectedTaskIds.add(taskId);

      if (this.taskBillingMethod === 'fixed' && this.taskAmounts[taskId] === undefined) {

        this.taskAmounts[taskId] = 0;

      }

    } else {

      this.selectedTaskIds.delete(taskId);

      delete this.taskAmounts[taskId];

    }

  }



  taskHourlyTotal(taskId: string): number {
    const task = this.billableTasks.find(t => t.id === taskId);
    const hours = task?.uninvoicedBillableHours ?? 0;
    const rate = this.taskHourlyRates[taskId] ?? 0;
    return Math.round(hours * rate * 1000) / 1000;
  }



  emitInvoiceTasks(targetInvoiceId?: string): void {

    const tasks = [...this.selectedTaskIds].map(taskId => ({

      taskId,

      amountHt: this.taskBillingMethod === 'fixed' ? this.taskAmounts[taskId] : undefined,

      hourlyRate: this.taskBillingMethod === 'hourly' ? this.taskHourlyRates[taskId] : undefined

    }));

    this.invoiceTasks.emit({

      method: this.taskBillingMethod,

      notes: this.timeNotes || undefined,

      tasks,

      targetInvoiceId

    });

  }



  emitFixedPrice(): void {

    this.invoiceFixedPrice.emit({ amountHt: this.fixedPriceAmount, notes: this.fixedPriceNotes || undefined });

    this.fixedPriceInvoiced = true;

  }



  addMs(): void {

    if (!this.milestoneName.trim()) return;

    this.addMilestone.emit({

      name: this.milestoneName,

      percent: this.milestonePercent,

      amountHt: this.milestoneAmount,

      dueDate: toIsoDate(this.milestoneDue)?.slice(0, 10) ?? null

    });

    this.milestoneName = '';

    this.milestonePercent = 0;

    this.milestoneDue = null;

  }



  addSit(): void {

    const start = toIsoDate(this.sitStart);

    const end = toIsoDate(this.sitEnd);

    if (!start || !end) return;

    this.addSituation.emit({

      periodStart: start,

      periodEnd: end,

      cumulativePercent: this.sitPercent,

      grossAmountHt: this.sitGross,

      retainageAmountHt: this.sitRetainage,

      vatRatePercent: this.sitVat

    });

  }



  openEditSituation(s: ProjectSituation): void {

    this.editSitId = s.id;

    this.editSitStart = new Date(s.periodStart);

    this.editSitEnd = new Date(s.periodEnd);

    this.editSitPercent = s.cumulativePercent;

    this.editSitGross = s.grossAmountHt;

    this.editSitRetainage = s.retainageAmountHt;

    this.editSitVat = s.vatRatePercent;

    this.sitEditVisible = true;

  }



  saveSituation(): void {

    const start = toIsoDate(this.editSitStart);

    const end = toIsoDate(this.editSitEnd);

    if (!start || !end) return;

    this.updateSituation.emit({

      id: this.editSitId,

      payload: {

        periodStart: start,

        periodEnd: end,

        cumulativePercent: this.editSitPercent,

        grossAmountHt: this.editSitGross,

        retainageAmountHt: this.editSitRetainage,

        vatRatePercent: this.editSitVat

      }

    });

    this.sitEditVisible = false;

  }



  addSub(): void {

    if (!this.subSupplierId) return;

    this.addSubcontractor.emit({

      supplierId: this.subSupplierId,

      contractReference: this.subRef || undefined,

      amountHt: this.subAmount,

      retainagePercent: this.subRetainage

    });

  }



  openEditSub(s: ProjectSubcontractor): void {

    this.editSubId = s.id;

    this.editSubRef = s.contractReference ?? '';

    this.editSubAmount = s.amountHt;

    this.editSubRetainage = s.retainagePercent;

    this.subEditVisible = true;

  }



  saveSub(): void {

    this.updateSubcontractor.emit({

      id: this.editSubId,

      payload: {

        contractReference: this.editSubRef || undefined,

        amountHt: this.editSubAmount,

        retainagePercent: this.editSubRetainage

      }

    });

    this.subEditVisible = false;

  }

}

