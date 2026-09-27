/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { PayrollService, PayrollRunListItem } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { canRunPayroll, isPayrollConsultMode, isCompanyPayrollReadOnly, PAYROLL_FIRM_MANAGED_COMPANY_BANNER, PAYROLL_FIRM_CONSULT_BANNER } from '@core/utils/payroll-access';
import { PayrollConsultBannerComponent, PayrollEmptyStateComponent, PayrollAmountPipe } from '../shared';

@Component({
  selector: 'app-payroll-run-list',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule,
    RouterModule,
    FormsModule,
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
      [title]="firmInternal() ? loc_ui_tern_cycles_de_paie_cabinet_9210b7 : loc_ui_tern_cycles_de_paie_ea07b4"
      [subtitle]="firmInternal() ? loc_ui_tern_paie_interne_du_cabinet_calcul_et_validati_cdd1da : loc_ui_tern_paie_mensuelle_brouillon_calcul_validation_6c9ee2">
      @if (canRun() && !currentMonthExists()) {
        <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="createCurrentMonth()" i18n="@@payroll.runs.nouveau.cycle.mois.courant.0f512e23">Nouveau cycle (mois courant)</app-button>
      }
    </app-page-header>

    <app-payroll-consult-banner
      [visible]="showConsultBanner()"
      [message]="consultBannerMessage()" />

    <div class="payroll-toolbar">
      <p-select
        [options]="yearOptions"
        [(ngModel)]="selectedYear"
        (ngModelChange)="reload()"
        optionLabel="label"
        optionValue="value"
        placeholder="Exercice" i18n-placeholder="Exercice"
        styleClass="w-10rem" />
    </div>

    @if (loading() || !runs().length) {
      <app-payroll-empty-state
        [loading]="loading()"
        [skeletonColumns]="6"
        icon="pi-calendar"
        title="Aucun cycle de paie" i18n-title="Aucun cycle de paie"
        [description]="emptyDescription()"
        [showAction]="canRun() && !loading() && !currentMonthExists()"
        actionLabel="Créer le cycle du mois courant"
        (actionClick)="createCurrentMonth()" />
    }

    @if (!loading() && runs().length) {
      <p-table [value]="runs()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@payroll.runs.periode.de2110b7">Période</th>
            <th i18n="@@payroll.runs.statut.659499f3">Statut</th>
            <th class="text-right" i18n="@@payroll.runs.bulletins.652cc5e0">Bulletins</th>
            <th class="text-right" i18n="@@payroll.runs.brut.8fc72d21">Brut</th>
            <th class="text-right" i18n="@@payroll.runs.net.9bb81c2e">Net</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-r>
          <tr>
            <td>{{ r.label }}</td>
            <td><p-tag [value]="r.statusDisplay | backendLabel" /></td>
            <td class="text-right">{{ r.payslipCount }}</td>
            <td class="text-right">{{ r.totalGross | payrollAmount }}</td>
            <td class="text-right">{{ r.totalNet | payrollAmount }}</td>
            <td>
              <app-button variant="outline" size="sm" icon="pi-external-link" iconPos="left" [routerLink]="[routeBase() + '/runs', r.id]" i18n="@@payroll.runs.ouvrir.42c07747">Ouvrir</app-button>
            </td>
          </tr>
        </ng-template>
      </p-table>
    }
  `
})
export class PayrollRunListComponent implements OnInit {
  readonly loc_ui_tern_cycles_de_paie_cabinet_9210b7 = $localize`:@@ui.tern.cycles.de.paie.cabinet.9210b7:Cycles de paie cabinet`;
  readonly loc_ui_tern_cycles_de_paie_ea07b4 = $localize`:@@ui.tern.cycles.de.paie.ea07b4:Cycles de paie`;
  readonly loc_ui_tern_paie_interne_du_cabinet_calcul_et_validati_cdd1da = $localize`:@@ui.tern.paie.interne.du.cabinet.calcul.et.validati.cdd1da:Paie interne du cabinet : calcul et validation.`;
  readonly loc_ui_tern_paie_mensuelle_brouillon_calcul_validation_6c9ee2 = $localize`:@@ui.tern.paie.mensuelle.brouillon.calcul.validation.6c9ee2:Paie mensuelle : brouillon → calcul → validation → clôture.`;
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly route = inject(ActivatedRoute);

  routeBase = signal('/payroll');
  firmInternal = signal(false);

  selectedYear = new Date().getFullYear();
  yearOptions = Array.from({ length: 5 }, (_, i) => {
    const y = new Date().getFullYear() - 2 + i;
    return { value: y, label: String(y) };
  });
  loading = signal(false);
  runs = signal<PayrollRunListItem[]>([]);
  currentMonthRun = signal<PayrollRunListItem | null>(null);

  canRun = computed(() => canRunPayroll(this.auth));
  showConsultBanner = computed(() => !this.firmInternal() && (isPayrollConsultMode(this.auth) || isCompanyPayrollReadOnly(this.auth)));
  consultBannerMessage = computed(() =>
    isCompanyPayrollReadOnly(this.auth) ? PAYROLL_FIRM_MANAGED_COMPANY_BANNER : PAYROLL_FIRM_CONSULT_BANNER);
  currentMonthExists = computed(() => this.currentMonthRun() !== null);

  emptyDescription = computed(() => this.loading() ? undefined : 'Aucun cycle pour cet exercice.');

  ngOnInit(): void {
    const data = this.route.snapshot.data;
    this.routeBase.set(data['payrollRouteBase'] ?? '/payroll');
    this.firmInternal.set(!!data['firmInternalPayroll']);
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    const now = new Date();
    const currentYear = now.getFullYear();
    this.payroll.listRuns(this.selectedYear).subscribe({
      next: res => {
        const items = res.data ?? [];
        this.runs.set(items);
        this.loading.set(false);
        if (this.selectedYear === currentYear) {
          this.applyCurrentMonthFrom(items, now);
        } else {
          this.refreshCurrentMonthRun();
        }
      },
      error: () => {
        this.toast.add({ severity: 'error', summary: $localize`:@@payroll-run-list.component.summary.Paie:Paie`, detail: $localize`:@@payroll-run-list.component.detail.Impossible d:Impossible de charger les cycles.` });
        this.loading.set(false);
        this.refreshCurrentMonthRun();
      }
    });
  }

  /** Loads runs for the calendar year to know if the current month already has a cycle. */
  refreshCurrentMonthRun(): void {
    const now = new Date();
    this.payroll.listRuns(now.getFullYear()).subscribe({
      next: res => this.applyCurrentMonthFrom(res.data ?? [], now),
      error: () => this.currentMonthRun.set(null)
    });
  }

  createCurrentMonth(): void {
    if (!this.canRun() || this.currentMonthExists()) return;
    const now = new Date();
    this.payroll.createRun(now.getFullYear(), now.getMonth() + 1).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@payroll-run-list.component.summary.Paie:Paie`, detail: $localize`:@@payroll-run-list.component.detail.Cycle créé.:Cycle créé.` });
        this.selectedYear = now.getFullYear();
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@payroll-run-list.component.summary.Paie:Paie`,
        detail: this.errorHandler.extractErrorMessage(err) || 'Création impossible.'
      })
    });
  }

  private applyCurrentMonthFrom(items: PayrollRunListItem[], now: Date): void {
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    this.currentMonthRun.set(
      items.find(r => r.year === year && r.month === month) ?? null
    );
  }
}
