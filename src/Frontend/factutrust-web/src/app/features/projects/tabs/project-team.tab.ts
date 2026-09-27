import { Component, EventEmitter, Input, Output } from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { TableModule } from 'primeng/table';

import { InputNumberModule } from 'primeng/inputnumber';

import { SelectModule } from 'primeng/select';

import { MessageModule } from 'primeng/message';

import { DialogModule } from 'primeng/dialog';

import { ButtonComponent } from '@shared/components/button/button.component';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

import {

  ProjectAssignableUser,

  ProjectMember,

  ProjectWorkloadRow,

  UpsertMemberPayload

} from '../project-api.service';

import { PROJECT_ROLE_OPTIONS, parseProjectMemberRole, showWorkload } from '../project-enums';

import { ProjectDetail } from '../project-api.service';



@Component({

  selector: 'app-project-team-tab',

  standalone: true,

  imports: [

    CommonModule,

    FormsModule,

    TableModule,

    InputNumberModule,

    SelectModule,

    MessageModule,

    DialogModule,

    ButtonComponent,

    EmptyStateComponent

  ],

  template: `

    <div class="proj-team-panel">

      @if (missingRate) {

        <p-message severity="warn" styleClass="w-full mb-3"

          text="Sans tarif de vente, la facturation régie est impossible." i18n-text="@@projects.tabs.sans.tarif.de.vente.la.facturation.regie.322064c7" />

      }

      @if (canManage) {

        <section class="proj-detail-card proj-team-add-card mb-3">

          <h3 class="proj-detail-card__title" i18n="@@projects.tabs.ajouter.un.membre.7c75463f">Ajouter un membre</h3>

          <div class="proj-team-add-grid">

            <div class="proj-team-field proj-team-field--user">

              <span class="proj-team-field__label" i18n="@@projects.tabs.utilisateur.967e9ca8">Utilisateur <span class="ft-required">*</span></span>

              <p-select

                styleClass="w-full"

                [options]="availableUsers"

                [(ngModel)]="userId"

                optionLabel="displayName"

                optionValue="id"

                placeholder="Utilisateur" i18n-placeholder="@@projects.tabs.utilisateur.c3b98973" />

            </div>

            <div class="proj-team-field">

              <span class="proj-team-field__label" i18n="@@projects.tabs.role.10918877">Rôle <span class="ft-required">*</span></span>

              <p-select

                styleClass="w-full"

                [options]="roleOptions"

                [(ngModel)]="role"

                optionLabel="label"

                optionValue="value" />

            </div>

            <div class="proj-team-field">

              <span class="proj-team-field__label" i18n="@@projects.tabs.tarif.de.vente.85df29e1">Tarif de vente</span>

              <p-inputNumber

                styleClass="w-full"

                [(ngModel)]="salesRate"

                mode="decimal"

                [min]="0"

                [minFractionDigits]="0"

                [maxFractionDigits]="3" />

            </div>

            <div class="proj-team-field">

              <span class="proj-team-field__label" i18n="@@projects.tabs.cout.h.15db1311">Coût h</span>

              <p-inputNumber

                styleClass="w-full"

                [(ngModel)]="hourlyCost"

                mode="decimal"

                [min]="0"

                [minFractionDigits]="0"

                [maxFractionDigits]="3" />

            </div>

            <div class="proj-team-field">

              <span class="proj-team-field__label" i18n="@@projects.tabs.capacite.h.sem.382f2449">Capacité h/sem <span class="ft-required">*</span></span>

              <p-inputNumber

                styleClass="w-full"

                [(ngModel)]="capacity"

                [min]="0"

                [max]="168" />

            </div>

            <div class="proj-team-add-actions">

              <app-button (click)="add()" i18n="@@projects.tabs.ajouter.87c57ed1">Ajouter</app-button>

            </div>

          </div>

        </section>

      }

      <p-table [value]="members" styleClass="p-datatable-sm proj-team-table">

        <ng-template pTemplate="colgroup">

          <colgroup>

            <col class="proj-team-col-name" />

            <col class="proj-team-col-role" />

            <col class="proj-team-col-rate" />

            <col class="proj-team-col-cost" />

            <col class="proj-team-col-capacity" />

            @if (canManage) {

              <col class="proj-team-col-actions" />

            }

          </colgroup>

        </ng-template>

        <ng-template pTemplate="header">

          <tr>

            <th i18n="@@projects.tabs.nom.7ff20370">Nom</th>

            <th i18n="@@projects.tabs.role.8b824790">Rôle</th>

            <th i18n="@@projects.tabs.tarif.de.vente.f4fedbe5">Tarif de vente</th>

            <th i18n="@@projects.tabs.cout.h.69ed99e9">Coût h</th>

            <th i18n="@@projects.tabs.capacite.25bc0fbf">Capacité</th>

            @if (canManage) { <th></th> }

          </tr>

        </ng-template>

        <ng-template pTemplate="body" let-m>

          <tr>

            <td>{{ m.userName }}</td>

            <td>{{ m.roleDisplay }}</td>

            <td>{{ m.salesRate != null ? (m.salesRate | number:'1.0-3') : '—' }}</td>

            <td>{{ m.hourlyCost != null ? (m.hourlyCost | number:'1.0-3') : '—' }}</td>

            <td i18n="@@projects.tabs.h.sem.e27a914f">{{ m.weeklyCapacityHours }} h/sem</td>

            @if (canManage) {

              <td>

                <div class="proj-team-row-actions">

                  <app-button size="sm" variant="outline" (click)="openEdit(m)" i18n="@@projects.tabs.modifier.f260e757">Modifier</app-button>

                  <app-button size="sm" variant="danger" (click)="remove.emit(m.id)" i18n="@@projects.tabs.retirer.54ec24a1">Retirer</app-button>

                </div>

              </td>

            }

          </tr>

        </ng-template>

        <ng-template pTemplate="emptymessage">

          <tr>

            <td [attr.colspan]="canManage ? 6 : 5">

              <app-empty-state

                icon="pi-users"

                title="Aucun membre" i18n-title="@@projects.tabs.aucun.membre.4749b4d8"

                description="Ajoutez des collaborateurs pour constituer l'équipe du projet." i18n-description="@@projects.tabs.ajoutez.des.collaborateurs.pour.constitu.112754e0"

                [showAction]="false" />

            </td>

          </tr>

        </ng-template>

      </p-table>

      @if (project && showWorkload(project.kind, project.billingMode) && workload.length) {

        <section class="proj-detail-card mt-3">

          <h3 class="proj-detail-card__title" i18n="@@projects.tabs.charge.d4e1aee4">Charge</h3>

          <p-table [value]="workload" styleClass="p-datatable-sm">

            <ng-template pTemplate="header">

              <tr><th i18n="@@projects.tabs.personne.6691d67a">Personne</th><th i18n="@@projects.tabs.capacite.25bc0fbf">Capacité</th><th i18n="@@projects.tabs.planifie.172deb14">Planifié</th><th i18n="@@projects.tabs.saisi.bcbb94e9">Saisi</th></tr>

            </ng-template>

            <ng-template pTemplate="body" let-w>

              <tr>

                <td>{{ w.userName }}</td>

                <td>{{ w.weeklyCapacityHours }}</td>

                <td>{{ w.estimatedHours }}</td>

                <td>{{ w.loggedHours }}</td>

              </tr>

            </ng-template>

          </p-table>

        </section>

      }

      <p-dialog [(visible)]="editVisible" header="Modifier le membre" i18n-header="@@projects.tabs.modifier.le.membre.e109c2f5" [modal]="true" [style]="{ width: '32rem' }">

        <div class="proj-team-edit-form flex flex-column gap-3">

          <div class="proj-team-field">

            <span class="proj-team-field__label" i18n="@@projects.tabs.role.0d616c09">Rôle</span>

            <p-select

              styleClass="w-full"

              [options]="roleOptions"

              [(ngModel)]="editRole"

              optionLabel="label"

              optionValue="value" />

          </div>

          <div class="proj-team-field">

            <span class="proj-team-field__label" i18n="@@projects.tabs.tarif.de.vente.85df29e1">Tarif de vente</span>

            <p-inputNumber

              styleClass="w-full"

              [(ngModel)]="editSales"

              mode="decimal"

              [min]="0"

              [minFractionDigits]="0"

              [maxFractionDigits]="3" />

          </div>

          <div class="proj-team-field">

            <span class="proj-team-field__label" i18n="@@projects.tabs.cout.h.15db1311">Coût h</span>

            <p-inputNumber

              styleClass="w-full"

              [(ngModel)]="editHourly"

              mode="decimal"

              [min]="0"

              [minFractionDigits]="0"

              [maxFractionDigits]="3" />

          </div>

          <div class="proj-team-field">

            <span class="proj-team-field__label" i18n="@@projects.tabs.capacite.h.sem.c6f1f30b">Capacité h/sem</span>

            <p-inputNumber

              styleClass="w-full"

              [(ngModel)]="editCapacity"

              [min]="0"

              [max]="168" />

          </div>

        </div>

        <ng-template pTemplate="footer">

          <app-button variant="secondary" (click)="editVisible = false" i18n="@@projects.tabs.annuler.49ba3292">Annuler</app-button>

          <app-button variant="primary" (click)="saveEdit()" i18n="@@projects.tabs.enregistrer.f7c8bcd8">Enregistrer</app-button>

        </ng-template>

      </p-dialog>

    </div>

  `,

})

export class ProjectTeamTabComponent {

  @Input() project: ProjectDetail | null = null;

  @Input() members: ProjectMember[] = [];

  @Input() users: ProjectAssignableUser[] = [];

  @Input() workload: ProjectWorkloadRow[] = [];

  @Input() canManage = false;

  @Output() addMember = new EventEmitter<UpsertMemberPayload>();

  @Output() updateMember = new EventEmitter<{ id: string; payload: UpsertMemberPayload }>();

  @Output() remove = new EventEmitter<string>();



  userId = '';

  role: 'Viewer' | 'Member' | 'Manager' = 'Member';

  salesRate: number | null = null;

  hourlyCost: number | null = null;

  capacity = 40;

  readonly roleOptions = PROJECT_ROLE_OPTIONS;

  readonly showWorkload = showWorkload;



  get availableUsers(): ProjectAssignableUser[] {

    const memberIds = new Set(this.members.map(m => m.userId));

    return this.users.filter(u => !memberIds.has(u.id));

  }



  get missingRate(): boolean {

    return this.members.some(m => !(m.salesRate && m.salesRate > 0));

  }



  add(): void {

    if (!this.userId) return;

    this.addMember.emit({

      userId: this.userId,

      role: this.role,

      salesRate: this.salesRate,

      hourlyCost: this.hourlyCost,

      weeklyCapacityHours: this.capacity

    });

    this.userId = '';

  }



  editVisible = false;

  private editId = '';

  private editUserId = '';

  editRole: 'Viewer' | 'Member' | 'Manager' = 'Member';

  editSales: number | null = null;

  editHourly: number | null = null;

  editCapacity = 40;



  openEdit(m: ProjectMember): void {

    this.editId = m.id;

    this.editUserId = m.userId;

    this.editRole = parseProjectMemberRole(m.role) ?? 'Member';

    this.editSales = m.salesRate ?? null;

    this.editHourly = m.hourlyCost ?? null;

    this.editCapacity = m.weeklyCapacityHours;

    this.editVisible = true;

  }



  saveEdit(): void {

    this.updateMember.emit({

      id: this.editId,

      payload: {

        userId: this.editUserId,

        role: this.editRole,

        salesRate: this.editSales,

        hourlyCost: this.editHourly,

        weeklyCapacityHours: this.editCapacity

      }

    });

    this.editVisible = false;

  }

}
