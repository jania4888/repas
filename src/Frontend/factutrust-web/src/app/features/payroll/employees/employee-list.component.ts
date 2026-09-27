/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { EmployeeService, EmployeeListItem } from '@core/services/employee.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { canManagePayrollEmployees, isPayrollConsultMode } from '@core/utils/payroll-access';
import {
  PayrollConsultBannerComponent,
  PayrollEmptyStateComponent,
  PayrollAmountPipe
} from '../shared';

type StatusFilter = 'all' | 'active' | 'inactive';

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    InputTextModule,
    TableModule,
    TagModule,
    SelectModule,
    PageHeaderComponent,
    ButtonComponent,
    PayrollConsultBannerComponent,
    PayrollEmptyStateComponent,
    PayrollAmountPipe
  ],
  template: `
    <app-page-header
      [title]="firmInternal() ? loc_ui_tern_salaries_du_cabinet_791140 : loc_ui_tern_salaries_ce6838"
      [subtitle]="firmInternal() ? loc_ui_tern_paie_interne_collaborateurs_du_cabinet_74de5b : loc_ui_tern_dossiers_salaries_et_contrats_de_travail_b70e08">
      @if (canManage()) {
        <app-button variant="primary" icon="pi-plus" iconPos="left" [routerLink]="routeBase() + '/employees/new'" i18n="@@payroll.employees.nouveau.salarie.c5cbf8b1">Nouveau salarié</app-button>
      }
    </app-page-header>

    <app-payroll-consult-banner
      [visible]="showConsultBanner()"
      message="Mode consultation — la gestion des dossiers salariés est réservée à la société cliente." />

    <div class="payroll-toolbar">
      <input pInputText type="text" placeholder="Rechercher…" i18n-placeholder="Rechercher…" [(ngModel)]="search" (ngModelChange)="load()" class="w-full md:w-20rem" />
      <p-select
        [options]="statusOptions"
        [(ngModel)]="statusFilter"
        (ngModelChange)="load()"
        optionLabel="label"
        optionValue="value"
        placeholder="Statut" i18n-placeholder="Statut"
        styleClass="w-12rem" />
    </div>

    @if (loading() || !items().length) {
      <app-payroll-empty-state
        [loading]="loading()"
        [skeletonColumns]="7"
        icon="pi-users"
        title="Aucun salarié" i18n-title="Aucun salarié"
        [description]="loading() ? undefined : 'Aucun salarié ne correspond à vos critères.'"
        [showAction]="canManage() && !loading()"
        actionLabel="Nouveau salarié"
        [actionRoute]="routeBase() + '/employees/new'" />
    }

    @if (!loading() && items().length) {
      <p-table [value]="items()" [paginator]="true" [rows]="20" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@payroll.employees.matricule.8f74c132">Matricule</th>
            <th i18n="@@payroll.employees.nom.7ff20370">Nom</th>
            <th i18n="@@payroll.employees.cnss.a04d171a">CNSS</th>
            <th i18n="@@payroll.employees.poste.86abf0cd">Poste</th>
            <th class="text-right" i18n="@@payroll.employees.salaire.base.6035beae">Salaire base</th>
            <th i18n="@@payroll.employees.statut.659499f3">Statut</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-e>
          <tr>
            <td>{{ e.employeeNumber }}</td>
            <td>{{ e.fullName }}</td>
            <td>
              @if (e.cnssNumber) {
                {{ e.cnssNumber }}
              } @else {
                <p-tag value="CNSS manquant" severity="warn" />
              }
            </td>
            <td>{{ e.jobTitle || '—' }}</td>
            <td class="text-right">{{ e.currentBaseSalary | payrollAmount }}</td>
            <td>
              <p-tag [value]="e.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033" [severity]="e.isActive ? 'success' : 'secondary'" />
              @if (e.parentClaimsStatus === 'Incomplete') {
                <p-tag value="Parents à compléter" severity="warn" class="ml-1" />
              }
              @if (e.parentClaimsStatus === 'Conflict') {
                <p-tag value="Conflit parents" severity="danger" class="ml-1" />
              }
            </td>
            <td>
              <app-button variant="outline" size="sm" icon="pi-eye" iconPos="left" [routerLink]="[routeBase() + '/employees', e.id]" i18n="@@payroll.employees.voir.8a754f1f">Voir</app-button>
            </td>
          </tr>
        </ng-template>
      </p-table>
    }
  `
})
export class EmployeeListComponent implements OnInit {
  readonly loc_ui_tern_salaries_du_cabinet_791140 = $localize`:@@ui.tern.salaries.du.cabinet.791140:Salariés du cabinet`;
  readonly loc_ui_tern_salaries_ce6838 = $localize`:@@ui.tern.salaries.ce6838:Salariés`;
  readonly loc_ui_tern_paie_interne_collaborateurs_du_cabinet_74de5b = $localize`:@@ui.tern.paie.interne.collaborateurs.du.cabinet.74de5b:Paie interne — collaborateurs du cabinet.`;
  readonly loc_ui_tern_dossiers_salaries_et_contrats_de_travail_b70e08 = $localize`:@@ui.tern.dossiers.salaries.et.contrats.de.travail.b70e08:Dossiers salariés et contrats de travail.`;
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  private readonly employees = inject(EmployeeService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  routeBase = signal('/payroll');
  firmInternal = signal(false);

  search = '';
  statusFilter: StatusFilter = 'all';
  loading = signal(false);
  items = signal<EmployeeListItem[]>([]);

  readonly statusOptions = [
    { value: 'all' as const, label: 'Tous' },
    { value: 'active' as const, label: 'Actifs' },
    { value: 'inactive' as const, label: 'Inactifs' }
  ];

  canManage = computed(() => canManagePayrollEmployees(this.auth));
  showConsultBanner = computed(() => !this.firmInternal() && isPayrollConsultMode(this.auth));

  ngOnInit(): void {
    const data = this.route.snapshot.data;
    this.routeBase.set(data['payrollRouteBase'] ?? '/payroll');
    this.firmInternal.set(!!data['firmInternalPayroll']);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    const isActive = this.statusFilter === 'all' ? undefined : this.statusFilter === 'active';
    this.employees.list(this.search || undefined, isActive).subscribe({
      next: res => {
        this.items.set(res.data?.items ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.toast.add({ severity: 'error', summary: $localize`:@@employee-list.component.summary.Salariés:Salariés`, detail: $localize`:@@employee-list.component.detail.Impossible d:Impossible de charger les salariés.` });
        this.loading.set(false);
      }
    });
  }
}
