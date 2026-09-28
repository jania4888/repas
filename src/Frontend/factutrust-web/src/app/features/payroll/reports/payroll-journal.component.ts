/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { TabsModule } from 'primeng/tabs';
import { finalize } from 'rxjs';
import {
  PayrollService,
  type PayrollJournal,
  type PayrollJournalView,
  type PayrollReportExportFormat
} from '@core/services/payroll.service';
import { AuthService } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
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
import { MONTH_OPTIONS, yearOptions } from './payroll-report-options';

/** Vue exportée selon l'onglet actif. */
const VIEW_BY_TAB: PayrollJournalView[] = ['ByEmployee', 'Accounting'];

@Component({
  selector: 'app-payroll-journal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    SelectModule,
    CheckboxModule,
    MessageModule,
    TabsModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingExportMenuComponent,
    PayrollStatGridComponent,
    PayrollEmptyStateComponent,
    PayrollAmountPipe
  ],
  template: `
    <app-page-header
      title="Journal de paie" i18n-title="@@payroll.reports.journal.de.paie.240f3575"
      subtitle="Détail mensuel par salarié et ventilation comptable de l'écriture de paie." i18n-subtitle="@@payroll.reports.detail.mensuel.par.salarie.et.ventilatio.23eaf8bb">
      @if (canExport()) {
        <app-accounting-export-menu
          [disabled]="loading() || exporting() || !journal()"
          (exportFormat)="onExport($event)" />
      }
    </app-page-header>

    <div class="payroll-toolbar">
      <p-select
        [options]="years"
        [(ngModel)]="year"
        optionLabel="label"
        optionValue="value"
        placeholder="Année" i18n-placeholder="@@payroll.reports.annee.1f910d98"
        styleClass="w-10rem"
        ariaLabel="Année" i18n-ariaLabel="@@payroll.reports.annee.64155901" />
      <p-select
        [options]="months"
        [(ngModel)]="month"
        optionLabel="label"
        optionValue="value"
        placeholder="Mois" i18n-placeholder="@@payroll.reports.mois.0d304bea"
        styleClass="w-10rem"
        ariaLabel="Mois" i18n-ariaLabel="@@payroll.reports.mois.cb4e6ce5" />
      <label class="payroll-report-check">
        <p-checkbox [(ngModel)]="includeCalculated" [binary]="true" inputId="includeCalculatedJournal" />
        <span i18n="@@payroll.reports.inclure.les.cycles.calcules.provisoire.316e039e">Inclure les cycles calculés (provisoire)</span>
      </label>
      <app-button variant="primary" icon="pi-refresh" iconPos="left" (click)="load()" i18n="@@payroll.reports.afficher.5e802040">Afficher</app-button>
    </div>

    @if (error()) {
      <p-message severity="warn" [text]="error()!" styleClass="mb-3 w-full" />
    }

    @if (journal(); as j) {
      @if (j.isProvisional) {
        <p-message
          severity="error"
          text="État provisoire : le cycle est calculé mais pas encore validé." i18n-text="@@payroll.reports.etat.provisoire.le.cycle.est.calcule.mai.4708047b"
          styleClass="mb-3 w-full" />
      }
      @if (!j.isBalanced) {
        <p-message
          severity="error"
          text="Contrôle : total débit ≠ total crédit sur la ventilation comptable. Vérifiez les totaux du cycle." i18n-text="@@payroll.reports.controle.total.debit.total.credit.sur.la.7e476a59"
          styleClass="mb-3 w-full" />
      }
    }

    @if (loading()) {
      <app-payroll-empty-state [loading]="true" [skeletonColumns]="8" />
    } @else if (!journal()) {
      <app-payroll-empty-state
        icon="pi-file"
        title="Aucun journal disponible" i18n-title="@@payroll.reports.aucun.journal.disponible.690b5900"
        [description]="error() ?? loc_selectionnez_une_periode_disposant_d_53f3bd"
        [showAction]="true"
        actionLabel="Voir les cycles de paie" i18n-actionLabel="@@payroll.reports.voir.les.cycles.de.paie.fd141467"
        actionRoute="/payroll/runs" />
    } @else {
      <app-payroll-stat-grid [items]="summaryStats()" class="mb-4" />

      <p-tabs [(value)]="activeTabIndex" [lazy]="true">
        <p-tablist>
          <p-tab [value]="0" i18n="@@payroll.reports.par.salarie.02075338">Par salarié</p-tab>
          <p-tab [value]="1" i18n="@@payroll.reports.ventilation.comptable.00194489">Ventilation comptable</p-tab>
        </p-tablist>
        <p-tabpanels>
        <p-tabpanel [value]="0">
          <div class="payroll-table-scroll">
            <p-table [value]="journal()!.lines" styleClass="p-datatable-sm" [rowHover]="true">
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col" i18n="@@payroll.reports.matricule.8f74c132">Matricule</th>
                  <th scope="col" i18n="@@payroll.reports.salarie.27f97915">Salarié</th>
                  <th scope="col" class="text-right" i18n="@@payroll.reports.brut.8fc72d21">Brut</th>
                  <th scope="col" class="text-right" i18n="@@payroll.reports.cnss.sal.5d831d27">CNSS sal.</th>
                  <th scope="col" class="text-right" i18n="@@payroll.reports.net.imposable.2439110f">Net imposable</th>
                  <th scope="col" class="text-right" i18n="@@payroll.reports.irpp.d47a1edc">IRPP</th>
                  <th scope="col" class="text-right" i18n="@@payroll.reports.css.194e13da">CSS</th>
                  <th scope="col" class="text-right" i18n="@@payroll.reports.autres.ret.47401df2">Autres ret.</th>
                  <th scope="col" class="text-right" i18n="@@payroll.reports.net.a.payer.7835df38">Net à payer</th>
                  <th scope="col" class="text-right" i18n="@@payroll.reports.charges.pat.81ada456">Charges pat.</th>
                  <th scope="col" class="text-right" i18n="@@payroll.reports.cout.employeur.99313d1f">Coût employeur</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-l>
                <tr>
                  <td data-label="Matricule" i18n-data-label="@@payroll.payroll-journal.matricule.8f74c132">{{ l.employeeNumber }}</td>
                  <td data-label="Salarié" i18n-data-label="@@payroll.payroll-journal.salarie.27f97915">{{ l.employeeName }}</td>
                  <td data-label="Brut" i18n-data-label="@@payroll.payroll-journal.brut.8fc72d21" class="text-right">{{ l.grossSalary | payrollAmount }}</td>
                  <td data-label="CNSS sal." i18n-data-label="@@payroll.payroll-journal.cnss.sal.5d831d27" class="text-right">{{ l.cnssEmployee | payrollAmount }}</td>
                  <td data-label="Net imposable" i18n-data-label="@@payroll.payroll-journal.net.imposable.2439110f" class="text-right">{{ l.monthlyNetTaxable | payrollAmount }}</td>
                  <td data-label="IRPP" class="text-right">{{ l.irpp + l.irppRegularization | payrollAmount }}</td>
                  <td data-label="CSS" class="text-right">{{ l.css + l.cssRegularization | payrollAmount }}</td>
                  <td data-label="Autres ret." i18n-data-label="@@payroll.payroll-journal.autres.ret.47401df2" class="text-right">{{ l.otherDeductions | payrollAmount }}</td>
                  <td data-label="Net à payer" i18n-data-label="@@payroll.payroll-journal.net.a.payer.7835df38" class="text-right">{{ l.netSalary | payrollAmount }}</td>
                  <td data-label="Charges pat." i18n-data-label="@@payroll.payroll-journal.charges.pat.81ada456" class="text-right">{{ l.totalEmployerCharges | payrollAmount }}</td>
                  <td data-label="Coût employeur" i18n-data-label="@@payroll.payroll-journal.cout.employeur.99313d1f" class="text-right">{{ l.totalCost | payrollAmount }}</td>
                </tr>
              </ng-template>
              <ng-template pTemplate="footer">
                <tr class="acc-totals-row">
                  <td colspan="2" i18n="@@payroll.reports.totaux.salarie.s.a3f99c62">Totaux — {{ journal()!.employeeCount }} salarié(s)</td>
                  <td class="text-right">{{ journal()!.totalGross | payrollAmount }}</td>
                  <td class="text-right">{{ journal()!.totalCnssEmployee | payrollAmount }}</td>
                  <td class="text-right">{{ journal()!.totalNetTaxable | payrollAmount }}</td>
                  <td class="text-right">{{ journal()!.totalIrpp + journal()!.totalIrppRegularization | payrollAmount }}</td>
                  <td class="text-right">{{ journal()!.totalCss + journal()!.totalCssRegularization | payrollAmount }}</td>
                  <td class="text-right">{{ journal()!.totalOtherDeductions | payrollAmount }}</td>
                  <td class="text-right">{{ journal()!.totalNetSalary | payrollAmount }}</td>
                  <td class="text-right">{{ journal()!.totalEmployerCharges | payrollAmount }}</td>
                  <td class="text-right">{{ journal()!.totalEmployerCost | payrollAmount }}</td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        </p-tabpanel>

        <p-tabpanel [value]="1">
          <p-message
            [severity]="journal()!.accountingLinesArePosted ? 'info' : 'warn'"
            [text]="accountingOrigin()"
            styleClass="mb-3 w-full" />

          @if (journal()!.accountingLines.length === 0) {
            <app-payroll-empty-state
              icon="pi-book"
              title="Aucune ventilation comptable" i18n-title="@@payroll.reports.aucune.ventilation.comptable.d850aeb3"
              description="Le cycle ne produit pas d'écriture exploitable." i18n-description="@@payroll.reports.le.cycle.ne.produit.pas.d.ecriture.explo.b26f7314" />
          } @else {
            <div class="payroll-table-scroll">
              <p-table [value]="journal()!.accountingLines" styleClass="p-datatable-sm" [rowHover]="true">
                <ng-template pTemplate="header">
                  <tr>
                    <th scope="col" i18n="@@payroll.reports.compte.c45740bb">Compte</th>
                    <th scope="col" i18n="@@payroll.reports.libelle.f5485bba">Libellé</th>
                    <th scope="col" class="text-right" i18n="@@payroll.reports.debit.f528224f">Débit</th>
                    <th scope="col" class="text-right" i18n="@@payroll.reports.credit.19194bdf">Crédit</th>
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-l>
                  <tr>
                    <td data-label="Compte" i18n-data-label="@@payroll.payroll-journal.compte.c45740bb">{{ l.accountNumber }}</td>
                    <td data-label="Libellé" i18n-data-label="@@payroll.payroll-journal.libelle.f5485bba">{{ l.accountLabel || l.label }}</td>
                    <td data-label="Débit" i18n-data-label="@@payroll.payroll-journal.debit.f528224f" class="text-right">{{ l.debit ? (l.debit | payrollAmount) : '—' }}</td>
                    <td data-label="Crédit" i18n-data-label="@@payroll.payroll-journal.credit.19194bdf" class="text-right">{{ l.credit ? (l.credit | payrollAmount) : '—' }}</td>
                  </tr>
                </ng-template>
                <ng-template pTemplate="footer">
                  <tr class="acc-totals-row">
                    <td colspan="2" i18n="@@payroll.reports.totaux.a1ca02f8">Totaux</td>
                    <td class="text-right">{{ journal()!.totalDebit | payrollAmount }}</td>
                    <td class="text-right">{{ journal()!.totalCredit | payrollAmount }}</td>
                  </tr>
                </ng-template>
              </p-table>
            </div>
          }
        </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
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
export class PayrollJournalComponent implements OnInit {
  protected readonly loc_selectionnez_une_periode_disposant_d_53f3bd = $localize`:@@payroll.payroll-journal.tpl.selectionnez.une.periode.disposant.d.un.53f3bd68:Sélectionnez une période disposant d'un cycle de paie.`;

  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  readonly months = MONTH_OPTIONS;
  readonly years = yearOptions();

  year = new Date().getFullYear();
  month = new Date().getMonth() + 1;
  includeCalculated = false;
  activeTabIndex = 0;

  journal = signal<PayrollJournal | null>(null);
  loading = signal(false);
  exporting = signal(false);
  error = signal<string | null>(null);

  readonly canExport = computed(() => canExportPayroll(this.auth));

  accountingOrigin = computed(() => {
    const j = this.journal();
    if (!j) return '';
    return j.accountingLinesArePosted
      ? $localize`:@@ui.tern.ecriture.comptabilisee.n.ph.journal.ph.41db32:Écriture comptabilisée n° ${j.accountingEntryNumber}:p0: — journal ${j.accountingJournalCode}:p1:.`
      : $localize`:@@ui.tern.ventilation.simulee.le.cycle.n.est.pas.enc.5d3f88:Ventilation simulée : le cycle n'est pas encore comptabilisé.`;
  });

  summaryStats = computed((): PayrollStatItem[] => {
    const j = this.journal();
    if (!j) return [];
    return [
      { label: $localize`:@@payroll.payroll-journal.ts.salaries.ce68387d:Salariés`, value: j.employeeCount, icon: 'pi-users', variant: 'primary' },
      { label: $localize`:@@payroll.payroll-journal.ts.masse.brute.4700a550:Masse brute`, value: formatPayrollAmount(j.totalGross, false), icon: 'pi-chart-bar', variant: 'primary' },
      { label: $localize`:@@payroll.payroll-journal.ts.net.a.payer.7835df38:Net à payer`, value: formatPayrollAmount(j.totalNetSalary, false), icon: 'pi-wallet', variant: 'success', featured: true },
      { label: $localize`:@@payroll.payroll-journal.ts.charges.patronales.a7e5e0ee:Charges patronales`, value: formatPayrollAmount(j.totalEmployerCharges, false), icon: 'pi-building', variant: 'warning' },
      { label: $localize`:@@payroll.payroll-journal.ts.cout.employeur.99313d1f:Coût employeur`, value: formatPayrollAmount(j.totalEmployerCost, false), icon: 'pi-briefcase', variant: 'warning' }
    ];
  });

  ngOnInit(): void {
    // Deep-link depuis le détail d'un cycle : ?year=2026&month=3.
    const params = this.route.snapshot.queryParamMap;
    const year = Number(params.get('year'));
    const month = Number(params.get('month'));
    if (Number.isInteger(year) && year >= 2000 && year <= 2100) this.year = year;
    if (Number.isInteger(month) && month >= 1 && month <= 12) this.month = month;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.payroll
      .getPayrollJournal(this.year, this.month, this.includeCalculated)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: res => this.journal.set(res.data ?? null),
        error: err => {
          this.journal.set(null);
          this.error.set(
            this.errorHandler.extractErrorMessage(err) || $localize`:@@payroll.payroll-journal.ts.impossible.de.generer.le.journal.de.paie.780d573a:Impossible de générer le journal de paie.`
          );
        }
      });
  }

  onExport(format: PayrollReportExportFormat): void {
    const j = this.journal();
    if (!j) return;
    const view = VIEW_BY_TAB[this.activeTabIndex] ?? 'ByEmployee';
    this.exporting.set(true);

    this.payroll
      .exportPayrollJournal(this.year, this.month, this.includeCalculated, format, view)
      .pipe(finalize(() => this.exporting.set(false)))
      .subscribe({
        next: blob => {
          const viewSuffix = view === 'Accounting' ? '_comptable' : '';
          const provisional = j.isProvisional ? '_provisoire' : '';
          const month = String(this.month).padStart(2, '0');
          downloadBlob(
            blob,
            `journal_paie_${this.year}_${month}${viewSuffix}${provisional}.${exportExtension(format)}`
          );
        },
        error: err =>
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@payroll-journal.component.summary.Journal_de_paie:Journal de paie`,
            detail: this.errorHandler.extractErrorMessage(err) || $localize`:@@payroll.payroll-journal.ts.export.impossible.a061adcb:Export impossible.`
          })
      });
  }
}
