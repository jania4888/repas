import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { finalize } from 'rxjs';
import {
  PayrollService,
  type PayrollBook,
  type PayrollReportExportFormat
} from '@core/services/payroll.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { canExportPayroll } from '@core/utils/payroll-access';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingExportMenuComponent } from '../../accounting/shared/accounting-export-menu.component';
import { downloadBlob, exportExtension } from '../../accounting/shared/accounting-download.util';
import {
  PayrollStatGridComponent,
  PayrollEmptyStateComponent,
  PayrollAmountPipe,
  formatPayrollAmount,
  type PayrollStatItem
} from '../shared';
import { MONTH_OPTIONS, formatMonthList, yearOptions } from './payroll-report-options';

@Component({
  selector: 'app-payroll-book',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    SelectModule,
    CheckboxModule,
    MessageModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingExportMenuComponent,
    PayrollStatGridComponent,
    PayrollEmptyStateComponent,
    PayrollAmountPipe
  ],
  template: `
    <app-page-header
      title="Livre de paie simplifié" i18n-title="Livre de paie simplifié"
      subtitle="Registre des salaires par salarié sur une plage de mois. Seuls les cycles validés ou clôturés sont inclus par défaut.">
      @if (canExport()) {
        <app-accounting-export-menu
          [disabled]="loading() || exporting() || !hasResults()"
          (exportFormat)="onExport($event)" />
      }
    </app-page-header>

    <div class="payroll-toolbar">
      <p-select
        [options]="years"
        [(ngModel)]="year"
        optionLabel="label"
        optionValue="value"
        placeholder="Année" i18n-placeholder="Année"
        styleClass="w-10rem"
        ariaLabel="Année" />
      <p-select
        [options]="months"
        [(ngModel)]="fromMonth"
        optionLabel="label"
        optionValue="value"
        placeholder="Mois de" i18n-placeholder="Mois de"
        styleClass="w-10rem"
        ariaLabel="Mois de début" />
      <p-select
        [options]="months"
        [(ngModel)]="toMonth"
        optionLabel="label"
        optionValue="value"
        placeholder="Mois à" i18n-placeholder="Mois à"
        styleClass="w-10rem"
        ariaLabel="Mois de fin" />
      <label class="payroll-report-check">
        <p-checkbox [(ngModel)]="includeCalculated" [binary]="true" inputId="includeCalculated" />
        <span i18n="@@payroll.reports.inclure.les.cycles.calcules.provisoire.316e039e">Inclure les cycles calculés (provisoire)</span>
      </label>
      <app-button variant="primary" icon="pi-refresh" iconPos="left" (click)="load()" i18n="@@payroll.reports.afficher.5e802040">Afficher</app-button>
    </div>

    @if (rangeError()) {
      <p-message severity="error" [text]="rangeError()!" styleClass="mb-3 w-full" />
    }

    @if (book(); as b) {
      @if (b.isProvisional) {
        <p-message
          severity="error"
          [text]="'État provisoire : mois issus de cycles calculés non validés (' + monthList(b.provisionalMonths) + ').'"
          styleClass="mb-3 w-full" />
      }
      @if (b.missingMonths.length > 0) {
        <p-message
          severity="warn"
          [text]="'Mois sans cycle éligible : ' + monthList(b.missingMonths) + '.'"
          styleClass="mb-3 w-full" />
      }
    }

    @if (loading()) {
      <app-payroll-empty-state [loading]="true" [skeletonColumns]="8" />
    } @else if (!book()) {
      <app-payroll-empty-state
        icon="pi-exclamation-circle"
        title="Impossible de charger le livre de paie" i18n-title="Impossible de charger le livre de paie"
        description="Une erreur est survenue. Réessayez ou vérifiez vos droits."
        [showAction]="true"
        actionLabel="Réessayer"
        (actionClick)="load()" />
    } @else if (book()!.lines.length === 0) {
      <app-payroll-empty-state
        icon="pi-book"
        title="Aucun bulletin sur la période" i18n-title="Aucun bulletin sur la période"
        description="Aucun cycle validé ou clôturé sur la plage sélectionnée."
        [showAction]="true"
        actionLabel="Voir les cycles de paie"
        actionRoute="/payroll/runs" />
    } @else {
      <app-payroll-stat-grid [items]="summaryStats()" class="mb-4" />

      <div class="payroll-table-scroll">
        <p-table [value]="book()!.lines" styleClass="p-datatable-sm" [rowHover]="true">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" i18n="@@payroll.reports.matricule.8f74c132">Matricule</th>
              <th scope="col" i18n="@@payroll.reports.salarie.27f97915">Salarié</th>
              <th scope="col" i18n="@@payroll.reports.n.cnss.7f5891f3">N° CNSS</th>
              <th scope="col" class="text-right" i18n="@@payroll.reports.mois.0d304bea">Mois</th>
              <th scope="col" class="text-right" i18n="@@payroll.reports.brut.8fc72d21">Brut</th>
              <th scope="col" class="text-right" i18n="@@payroll.reports.brut.cnssable.fe8d5dba">Brut CNSSable</th>
              <th scope="col" class="text-right" i18n="@@payroll.reports.cnss.sal.5d831d27">CNSS sal.</th>
              <th scope="col" class="text-right" i18n="@@payroll.reports.net.imposable.2439110f">Net imposable</th>
              <th scope="col" class="text-right" i18n="@@payroll.reports.irpp.d47a1edc">IRPP</th>
              <th scope="col" class="text-right" i18n="@@payroll.reports.css.194e13da">CSS</th>
              <th scope="col" class="text-right" i18n="@@payroll.reports.autres.ret.47401df2">Autres ret.</th>
              <th scope="col" class="text-right" i18n="@@payroll.reports.net.a.payer.7835df38">Net à payer</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-l>
            <tr>
              <td data-label="Matricule">{{ l.employeeNumber }}</td>
              <td data-label="Salarié">{{ l.employeeName }}</td>
              <td data-label="N° CNSS">{{ l.cnssNumber || '—' }}</td>
              <td data-label="Mois" class="text-right">{{ l.monthsCount }}</td>
              <td data-label="Brut" class="text-right">{{ l.grossSalary | payrollAmount }}</td>
              <td data-label="Brut CNSSable" class="text-right">{{ l.cnssableGross | payrollAmount }}</td>
              <td data-label="CNSS sal." class="text-right">{{ l.cnssEmployee | payrollAmount }}</td>
              <td data-label="Net imposable" class="text-right">{{ l.netTaxable | payrollAmount }}</td>
              <td data-label="IRPP" class="text-right">{{ l.irpp + l.irppRegularization | payrollAmount }}</td>
              <td data-label="CSS" class="text-right">{{ l.css + l.cssRegularization | payrollAmount }}</td>
              <td data-label="Autres ret." class="text-right">{{ l.otherDeductions | payrollAmount }}</td>
              <td data-label="Net à payer" class="text-right">{{ l.netSalary | payrollAmount }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="footer">
            <tr class="acc-totals-row">
              <td colspan="3">Totaux — {{ book()!.employeeCount }} salarié(s)</td>
              <td class="text-right" i18n="@@payroll.reports.text.1b93795b">—</td>
              <td class="text-right">{{ book()!.totalGross | payrollAmount }}</td>
              <td class="text-right">{{ book()!.totalCnssableGross | payrollAmount }}</td>
              <td class="text-right">{{ book()!.totalCnssEmployee | payrollAmount }}</td>
              <td class="text-right">{{ book()!.totalNetTaxable | payrollAmount }}</td>
              <td class="text-right">{{ book()!.totalIrpp + book()!.totalIrppRegularization | payrollAmount }}</td>
              <td class="text-right">{{ book()!.totalCss + book()!.totalCssRegularization | payrollAmount }}</td>
              <td class="text-right">{{ book()!.totalOtherDeductions | payrollAmount }}</td>
              <td class="text-right">{{ book()!.totalNetSalary | payrollAmount }}</td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }
  `,
  styles: [`
    .mb-4 { margin-bottom: var(--spacing-6); display: block; }
    .mb-3 { margin-bottom: var(--spacing-4); }
    .payroll-report-check {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }
  `]
})
export class PayrollBookComponent implements OnInit {
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  readonly months = MONTH_OPTIONS;
  readonly years = yearOptions();

  year = new Date().getFullYear();
  fromMonth = 1;
  toMonth = new Date().getMonth() + 1;
  includeCalculated = false;

  book = signal<PayrollBook | null>(null);
  loading = signal(false);
  exporting = signal(false);

  readonly canExport = computed(() => canExportPayroll(this.auth));
  readonly hasResults = computed(() => (this.book()?.lines.length ?? 0) > 0);

  rangeError = signal<string | null>(null);

  summaryStats = computed((): PayrollStatItem[] => {
    const b = this.book();
    if (!b) return [];
    const totalDeductions =
      b.totalCnssEmployee + b.totalIrpp + b.totalIrppRegularization
      + b.totalCss + b.totalCssRegularization + b.totalOtherDeductions;

    return [
      { label: 'Salariés', value: b.employeeCount, icon: 'pi-users', variant: 'primary' },
      { label: 'Masse brute', value: formatPayrollAmount(b.totalGross, false), icon: 'pi-chart-bar', variant: 'primary' },
      { label: 'Total retenues', value: formatPayrollAmount(totalDeductions, false), icon: 'pi-minus-circle', variant: 'warning' },
      { label: 'Net à payer', value: formatPayrollAmount(b.totalNetSalary, false), icon: 'pi-wallet', variant: 'success', featured: true },
      { label: 'Coût employeur', value: formatPayrollAmount(b.totalEmployerCost, false), icon: 'pi-building', variant: 'warning' }
    ];
  });

  ngOnInit(): void {
    // Deep-link depuis un cycle de paie : ?year=2026&fromMonth=1&toMonth=6.
    const params = this.route.snapshot.queryParamMap;
    const year = Number(params.get('year'));
    const from = Number(params.get('fromMonth'));
    const to = Number(params.get('toMonth'));
    if (Number.isInteger(year) && year >= 2000 && year <= 2100) this.year = year;
    if (Number.isInteger(from) && from >= 1 && from <= 12) this.fromMonth = from;
    if (Number.isInteger(to) && to >= 1 && to <= 12) this.toMonth = to;
    this.load();
  }

  load(): void {
    if (this.fromMonth > this.toMonth) {
      this.rangeError.set('Le mois de fin ne peut pas précéder le mois de début.');
      return;
    }
    this.rangeError.set(null);
    this.loading.set(true);

    this.payroll
      .getPayrollBook(this.year, this.fromMonth, this.toMonth, this.includeCalculated)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: res => this.book.set(res.data ?? null),
        error: () => {
          this.book.set(null);
          this.toast.add({ severity: 'error', summary: 'Livre de paie', detail: 'Impossible de générer le livre de paie.' });
        }
      });
  }

  onExport(format: PayrollReportExportFormat): void {
    if (!this.hasResults()) return;
    const b = this.book()!;
    this.exporting.set(true);

    this.payroll
      .exportPayrollBook(this.year, this.fromMonth, this.toMonth, this.includeCalculated, format)
      .pipe(finalize(() => this.exporting.set(false)))
      .subscribe({
        next: blob => {
          const suffix = b.isProvisional ? '_provisoire' : '';
          const from = String(this.fromMonth).padStart(2, '0');
          const to = String(this.toMonth).padStart(2, '0');
          downloadBlob(blob, `livre_paie_${this.year}_${from}-${to}${suffix}.${exportExtension(format)}`);
        },
        error: () =>
          this.toast.add({ severity: 'error', summary: 'Livre de paie', detail: "Export impossible." })
      });
  }

  monthList(months: number[]): string {
    return formatMonthList(months);
  }
}
