import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
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

  { label: $localize`:@@projects.project-billing.ts.par.membre.c6ebe5de:Par membre`, value: 'member' },

  { label: $localize`:@@projects.project-billing.ts.par.tache.df47b881:Par tâche`, value: 'task' }

];



const TASK_BILLING_METHOD_OPTIONS = [

  { label: $localize`:@@projects.project-billing.ts.forfaitaire.4d28efbd:Forfaitaire`, value: 'fixed' },

  { label: $localize`:@@projects.project-billing.ts.a.l.heure.9d6f7161:À l'heure`, value: 'hourly' }

];



@Component({

  selector: 'app-project-billing-tab',

  standalone: true,

  imports: [
    BackendLabelPipe,

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

          text="Activez le projet (statut Brouillon) avant de facturer. La facturation est réservée aux projets Actif ou Terminé." i18n-text="@@projects.tabs.activez.le.projet.statut.brouillon.avant.45a8ed34" />

      }

      @if (canActivate(project.status) && canUpdate) {

        <app-button class="mb-3" variant="primary" (click)="activate.emit()" i18n="@@projects.tabs.activer.le.projet.1aa2449c">Activer le projet</app-button>

      }

    }



    @if (readiness) {

      <div class="card p-3 mb-3">

        <h3 class="mt-0" i18n="@@projects.tabs.prerequis.de.facturation.ded03f12">Prérequis de facturation</h3>

        @if (readiness.blockers.length) {

          <ul class="m-0 pl-3 mb-2">

            @for (b of readiness.blockers; track b) {

              <li>{{ b }}</li>

            }

          </ul>

        }

        <ul class="m-0 pl-3">

          <li i18n="@@projects.tabs.statut.120dd2cf">Statut : {{ readiness.statusDisplay | backendLabel }} {{ readiness.canBill ? '✓' : '✗' }}</li>

          <li i18n="@@projects.tabs.temps.valides.non.factures.h.f21297d8">Temps validés non facturés : {{ readiness.validatedUninvoicedHours | number:'1.0-1' }} h</li>

          <li><ng-container i18n="@@projects.tabs.equipe.sans.tarif.de.vente.b3c061fc">Équipe sans tarif de vente :

            </ng-container>@if (readiness.membersWithoutRate.length) {

              {{ readiness.membersWithoutRate.join(', ') }}

            } @else {<ng-container i18n="@@projects.tabs.aucun.6bcf7eeb"> aucun </ng-container>}

          </li>

        </ul>

      </div>

    }



    @if (project && canBeBilled(project.status) && canBill) {

      <div class="card p-3 mb-3">

        <h3 class="mt-0" i18n="@@projects.tabs.facturation.regie.c756b217">Facturation régie</h3>

        <div class="proj-field-row">

          <label><ng-container i18n="@@projects.tabs.grouper.par.48438b59">Grouper par

            </ng-container><p-select [options]="groupOptions" [(ngModel)]="timeGroupBy" optionLabel="label" optionValue="value" (ngModelChange)="onTimeGroupByChange()" />

          </label>

          @if (timeGroupBy === 'member') {

            <label><ng-container i18n="@@projects.tabs.notes.70440046">Notes

              </ng-container><input pInputText [(ngModel)]="timeNotes" placeholder="Notes facture" i18n-placeholder="@@projects.tabs.notes.facture.8eafdc1b" />

            </label>

            <app-button variant="primary" [disabled]="!canInvoiceSelectedTime || invoiceTargetLoading" (click)="openInvoiceTargetDialog('time')" i18n="@@projects.tabs.facturer.la.selection.37788e00">Facturer la sélection</app-button>

          }

        </div>



        @if (timeGroupBy === 'member') {

          @if (!billableTimeEntries.length) {

            <p class="text-muted mt-2 mb-0" i18n="@@projects.tabs.aucun.temps.eligible.a.la.facturation.7b718dfb">Aucun temps éligible à la facturation.</p>

          } @else {

            @if (selectedTimeSummary.hours > 0) {

              <p class="time-selection-summary mt-2 mb-2" i18n="@@projects.tabs.h.selectionnees.ht.92777045">

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

                  <th i18n="@@projects.tabs.date.eb9a4bc1">Date</th>

                  <th i18n="@@projects.tabs.membre.bbc7e799">Membre</th>

                  <th i18n="@@projects.tabs.tache.43c8425c">Tâche</th>

                  <th i18n="@@projects.tabs.heures.b4448c06">Heures</th>

                  <th i18n="@@projects.tabs.tarif.h.4b2597c3">Tarif h</th>

                  <th i18n="@@projects.tabs.montant.ht.3df1d6fe">Montant HT</th>

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

            <label><ng-container i18n="@@projects.tabs.mode.de.facturation.d797aff0">Mode de facturation

              </ng-container><p-select [options]="taskBillingMethodOptions" [(ngModel)]="taskBillingMethod" optionLabel="label" optionValue="value" (ngModelChange)="onTaskBillingMethodChange()" />

            </label>

            <label><ng-container i18n="@@projects.tabs.notes.70440046">Notes

              </ng-container><input pInputText [(ngModel)]="timeNotes" placeholder="Notes facture" i18n-placeholder="@@projects.tabs.notes.facture.8eafdc1b" />

            </label>

            <app-button variant="primary" [disabled]="!canInvoiceTasks || invoiceTargetLoading" (click)="openInvoiceTargetDialog('tasks')" i18n="@@projects.tabs.facturer.les.taches.selectionnees.ec248c1c">Facturer les tâches sélectionnées</app-button>

          </div>



          @if (!billableTasks.length) {

            <p class="text-muted mt-2 mb-0" i18n="@@projects.tabs.aucune.tache.facturable.pour.ce.mode.70fb424e">Aucune tâche facturable pour ce mode.</p>

          } @else {

            <p-table [value]="billableTasks" styleClass="p-datatable-sm mt-2">

              <ng-template pTemplate="header">

                <tr>

                  <th style="width: 3rem"></th>

                  <th i18n="@@projects.tabs.tache.43c8425c">Tâche</th>

                  @if (taskBillingMethod === 'hourly') {

                    <th i18n="@@projects.tabs.heures.b4448c06">Heures</th>

                    <th i18n="@@projects.tabs.tarif.h.4b2597c3">Tarif h</th>

                    <th i18n="@@projects.tabs.montant.ht.3df1d6fe">Montant HT</th>

                  } @else {

                    <th i18n="@@projects.tabs.montant.ht.3df1d6fe">Montant HT</th>

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

                          placeholder="Tarif h" i18n-placeholder="@@projects.tabs.tarif.h.c48d565c" />

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

                          placeholder="Montant HT" i18n-placeholder="@@projects.tabs.montant.ht.31afcc24" />

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

        <h3 class="mt-0" i18n="@@projects.tabs.forfait.e1dca3c1">Forfait</h3>

        <div class="proj-field-row">

          <label><ng-container i18n="@@projects.tabs.montant.ht.3df1d6fe">Montant HT

            </ng-container><p-inputNumber [(ngModel)]="fixedPriceAmount" mode="decimal" [minFractionDigits]="3" />

          </label>

          <label><ng-container i18n="@@projects.tabs.notes.70440046">Notes

            </ng-container><input pInputText [(ngModel)]="fixedPriceNotes" />

          </label>

          <app-button variant="primary" [disabled]="fixedPriceInvoiced" (click)="emitFixedPrice()" i18n="@@projects.tabs.facturer.le.forfait.c7f92c2b">Facturer le forfait</app-button>

        </div>

      </div>

    }



    @if (project && showMilestones(project.kind, project.billingMode)) {

      <h3 i18n="@@projects.tabs.jalons.4bb628c9">Jalons</h3>

      @if (canBill) {

        <div class="proj-field-row mb-2">

          <label><ng-container i18n="@@projects.tabs.nom.7ff20370">Nom </ng-container><input pInputText [(ngModel)]="milestoneName" /></label>

          <label>% <p-inputNumber [(ngModel)]="milestonePercent" [min]="0" [max]="100" /></label>

          <label><ng-container i18n="@@projects.tabs.montant.ht.3df1d6fe">Montant HT </ng-container><p-inputNumber [(ngModel)]="milestoneAmount" /></label>

          <label><ng-container i18n="@@projects.tabs.echeance.f9a77ff6">Échéance </ng-container><p-datepicker [(ngModel)]="milestoneDue" dateFormat="dd/mm/yy" [showClear]="true" /></label>

          <app-button (click)="addMs()" i18n="@@projects.tabs.ajouter.87c57ed1">Ajouter</app-button>

        </div>

      }

      <p-table [value]="milestones" styleClass="p-datatable-sm">

        <ng-template pTemplate="header"><tr><th i18n="@@projects.tabs.jalon.6e891b2f">Jalon</th><th>%</th><th i18n="@@projects.tabs.montant.4adcd9fc">Montant</th><th i18n="@@projects.tabs.echeance.f9a77ff6">Échéance</th><th></th></tr></ng-template>

        <ng-template pTemplate="body" let-m>

          <tr>

            <td>{{ m.name }}</td>

            <td>{{ m.percent }}</td>

            <td>{{ m.amountHt | number:'1.3-3' }}</td>

            <td>{{ m.dueDate ? (m.dueDate | date:'shortDate') : '—' }}</td>

            <td>

              @if (!m.invoicedInvoiceId && canBill && project && canBeBilled(project.status)) {

                <app-button size="sm" (click)="invoiceMilestone.emit(m.id)" i18n="@@projects.tabs.facturer.98d65a13">Facturer</app-button>

              } @else if (m.invoicedInvoiceId) {

                <a [routerLink]="['/invoices', m.invoicedInvoiceId]" i18n="@@projects.tabs.facture.31828596">Facture</a>

              }

            </td>

          </tr>

        </ng-template>

      </p-table>

    }



    @if (project && isBtp(project.kind)) {

      @if (latestSituationPercent != null) {

        <div class="card p-3 mb-3">

          <h3 class="mt-0" i18n="@@projects.tabs.avancement.cumule.chantier.a77c3879">Avancement cumulé chantier</h3>

          <p-progressBar [value]="latestSituationPercent" [showValue]="true" />

        </div>

      }

      <h3 i18n="@@projects.tabs.situations.de.travaux.0d67835b">Situations de travaux</h3>

      @if (canBill) {

        <div class="proj-field-row mb-2">

          <label><ng-container i18n="@@projects.tabs.debut.f0955314">Début </ng-container><p-datepicker [(ngModel)]="sitStart" dateFormat="dd/mm/yy" /></label>

          <label><ng-container i18n="@@projects.tabs.fin.4251065f">Fin </ng-container><p-datepicker [(ngModel)]="sitEnd" dateFormat="dd/mm/yy" /></label>

          <label><ng-container i18n="@@projects.tabs.cumule.1c3be77d">% cumulé </ng-container><p-inputNumber [(ngModel)]="sitPercent" /></label>

          <label><ng-container i18n="@@projects.tabs.brut.ht.1988da69">Brut HT </ng-container><p-inputNumber [(ngModel)]="sitGross" /></label>

          <label><ng-container i18n="@@projects.tabs.retenue.88cf18f4">Retenue </ng-container><p-inputNumber [(ngModel)]="sitRetainage" /></label>

          <label>TVA

            <p-select [options]="vatOptions" [(ngModel)]="sitVat" optionLabel="label" optionValue="value" />

          </label>

          <app-button (click)="addSit()" i18n="@@projects.tabs.nouvelle.situation.c39ab90e">Nouvelle situation</app-button>

        </div>

      }

      <p-table [value]="situations" styleClass="p-datatable-sm">

        <ng-template pTemplate="header"><tr><th>N°</th><th>%</th><th i18n="@@projects.tabs.net.ht.8d95a22f">Net HT</th><th i18n="@@projects.tabs.retenue.88cf18f4">Retenue</th><th>TTC</th><th i18n="@@projects.tabs.statut.659499f3">Statut</th><th></th></tr></ng-template>

        <ng-template pTemplate="body" let-s>

          <tr>

            <td>{{ s.number }}</td>

            <td>{{ s.cumulativePercent }}</td>

            <td>{{ s.netAmountHt | number:'1.3-3' }}</td>

            <td>{{ s.retainageAmountHt | number:'1.3-3' }}</td>

            <td>{{ s.totalTtc | number:'1.3-3' }}</td>

            <td><app-status-badge [status]="situationStatusBadge(s.status)" [label]="s.statusDisplay | backendLabel" /></td>

            <td>

              @if (parseProjectSituationStatus(s.status) === 'Draft' && canBill) {

                <app-button size="sm" variant="outline" (click)="openEditSituation(s)" i18n="@@projects.tabs.modifier.f260e757">Modifier</app-button>

                <app-button size="sm" (click)="validateSituation.emit(s.id)" i18n="@@projects.tabs.valider.be4220f7">Valider</app-button>

              }

              @if (parseProjectSituationStatus(s.status) === 'Validated' && !s.invoiceId && canBill && project && canBeBilled(project.status)) {

                <app-button size="sm" (click)="invoiceSituation.emit(s.id)" i18n="@@projects.tabs.facturer.98d65a13">Facturer</app-button>

              }

              @if (s.invoiceId) {

                <a [routerLink]="['/invoices', s.invoiceId]" i18n="@@projects.tabs.facture.93d3ce90">Facture</a>

              }

            </td>

          </tr>

        </ng-template>

      </p-table>

      <h3 i18n="@@projects.tabs.sous.traitants.4193cfad">Sous-traitants</h3>

      @if (canUpdate) {

        <div class="proj-field-row mb-2">

          <label><ng-container i18n="@@projects.tabs.fournisseur.97d91d89">Fournisseur </ng-container><p-select [options]="suppliers" [(ngModel)]="subSupplierId" optionLabel="name" optionValue="id" placeholder="Fournisseur" i18n-placeholder="@@projects.tabs.fournisseur.c366796b" /></label>

          <label><ng-container i18n="@@projects.tabs.marche.eb9aa674">Marché </ng-container><input pInputText [(ngModel)]="subRef" /></label>

          <label><ng-container i18n="@@projects.tabs.montant.ht.3df1d6fe">Montant HT </ng-container><p-inputNumber [(ngModel)]="subAmount" /></label>

          <label><ng-container i18n="@@projects.tabs.retenue.5558c11d">Retenue % </ng-container><p-inputNumber [(ngModel)]="subRetainage" /></label>

          <app-button (click)="addSub()" i18n="@@projects.tabs.ajouter.87c57ed1">Ajouter</app-button>

        </div>

      }

      <p-table [value]="subs" styleClass="p-datatable-sm">

        <ng-template pTemplate="header"><tr><th i18n="@@projects.tabs.fournisseur.97d91d89">Fournisseur</th><th i18n="@@projects.tabs.marche.eb9aa674">Marché</th><th i18n="@@projects.tabs.montant.4adcd9fc">Montant</th><th i18n="@@projects.tabs.retenue.5558c11d">Retenue %</th>@if (canUpdate) { <th></th> }</tr></ng-template>

        <ng-template pTemplate="body" let-s>

          <tr>

            <td>{{ s.supplierName }}</td>

            <td>{{ s.contractReference }}</td>

            <td>{{ s.amountHt | number:'1.3-3' }}</td>

            <td>{{ s.retainagePercent }}</td>

            @if (canUpdate) {

              <td><app-button size="sm" variant="outline" (click)="openEditSub(s)" i18n="@@projects.tabs.modifier.f260e757">Modifier</app-button></td>

            }

          </tr>

        </ng-template>

      </p-table>

    }



    <p-dialog [(visible)]="sitEditVisible" header="Modifier la situation" i18n-header="@@projects.tabs.modifier.la.situation.05ee825b" [modal]="true" [style]="{ width: '32rem' }">

      <div class="proj-field-stack">

        <label><ng-container i18n="@@projects.tabs.debut.f0955314">Début </ng-container><p-datepicker [(ngModel)]="editSitStart" dateFormat="dd/mm/yy" /></label>

        <label><ng-container i18n="@@projects.tabs.fin.4251065f">Fin </ng-container><p-datepicker [(ngModel)]="editSitEnd" dateFormat="dd/mm/yy" /></label>

        <label><ng-container i18n="@@projects.tabs.cumule.1c3be77d">% cumulé </ng-container><p-inputNumber [(ngModel)]="editSitPercent" /></label>

        <label><ng-container i18n="@@projects.tabs.brut.ht.1988da69">Brut HT </ng-container><p-inputNumber [(ngModel)]="editSitGross" /></label>

        <label><ng-container i18n="@@projects.tabs.retenue.88cf18f4">Retenue </ng-container><p-inputNumber [(ngModel)]="editSitRetainage" /></label>

        <label>TVA <p-select [options]="vatOptions" [(ngModel)]="editSitVat" optionLabel="label" optionValue="value" /></label>

      </div>

      <ng-template pTemplate="footer">

        <app-button variant="secondary" (click)="sitEditVisible = false" i18n="@@projects.tabs.annuler.49ba3292">Annuler</app-button>

        <app-button variant="primary" (click)="saveSituation()" i18n="@@projects.tabs.enregistrer.f7c8bcd8">Enregistrer</app-button>

      </ng-template>

    </p-dialog>



    <p-dialog [(visible)]="subEditVisible" header="Modifier le sous-traitant" i18n-header="@@projects.tabs.modifier.le.sous.traitant.6f8cd804" [modal]="true" [style]="{ width: '28rem' }">

      <div class="proj-field-stack">

        <label><ng-container i18n="@@projects.tabs.marche.eb9aa674">Marché </ng-container><input pInputText class="w-full" [(ngModel)]="editSubRef" /></label>

        <label><ng-container i18n="@@projects.tabs.montant.ht.3df1d6fe">Montant HT </ng-container><p-inputNumber [(ngModel)]="editSubAmount" /></label>

        <label><ng-container i18n="@@projects.tabs.retenue.5558c11d">Retenue % </ng-container><p-inputNumber [(ngModel)]="editSubRetainage" /></label>

      </div>

      <ng-template pTemplate="footer">

        <app-button variant="secondary" (click)="subEditVisible = false" i18n="@@projects.tabs.annuler.49ba3292">Annuler</app-button>

        <app-button variant="primary" (click)="saveSub()" i18n="@@projects.tabs.enregistrer.f7c8bcd8">Enregistrer</app-button>

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
          this.invoiceDraftLoadError.emit(res.message || $localize`:@@projects.project-billing.ts.impossible.de.charger.les.factures.broui.b9154541:Impossible de charger les factures brouillon.`);
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
        this.invoiceDraftLoadError.emit($localize`:@@projects.project-billing.ts.impossible.de.charger.les.factures.broui.b9154541:Impossible de charger les factures brouillon.`);
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

